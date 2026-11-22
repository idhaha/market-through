'use strict';
// 오라클 중복 자료 정리(2026-11-22 사용자 기준: 같은 자료의 소스는 한 곳). docs/CHART_DATA_STORAGE.md "소스는 한 곳".
//  - 지울 묶음(--set)을 이름으로 고른다. 기본은 아무것도 지우지 않는다.
//  - 오라클 파일마다 로컬 백업(outputs/oracle-data-backup/data, dev/backup-oracle-data.cjs)에 크기 · sha256이 같은 사본이
//    있을 때만 지운다. 사본이 없거나 다르면 남기고 알린다(먼저 백업을 다시 돌린다).
//  - 오늘(한국 날짜) 파일은 지우지 않는다. 묶음 규칙에 맞지 않는 파일(목록 · 설정 파일 등)은 건드리지 않는다.
//  - 기본은 목록만 보여 준다(--apply일 때만 지운다). 로컬 백업은 지우지 않는다.
// 사용: node dev/oracle-remove-duplicate-data.cjs --set supply-minute [--set ...] [--apply]
// 결과: outputs/scheduled/oracle-duplicate-cleanup.log
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const HOST = 'ubuntu@134.185.111.202', REMOTE = 'market-through/data';
const DAY = '(\\d{4}-\\d{2}-\\d{2}|\\d{8})';
// 묶음: 이름 → 지울 파일 규칙(data 아래 상대경로). 같은 자료를 화면이 읽는 다른 한 곳이 이미 갖고 있는 것만 둔다.
const SETS = {
    // 키움 종목 분봉 수급(수집 · 조회 코드 2026-11-22 삭제). 화면은 kis-supply만 읽는다. watchlist.json · market-day.json은 남긴다.
    'supply-minute': new RegExp(`^supply/[0-9A-Za-z]{6}/${DAY}\\.json(\\.gz)?$`),
    // 화면이 읽지 않는 멈춘 비교 수집본(2026-11-22 사용자 결정으로 지움, 수집 코드도 없앰).
    'ls-supply': new RegExp(`^ls-supply/[0-9A-Za-z]{6}/${DAY}\\.json(\\.gz)?$`),
    'ls-market-supply-raw': new RegExp(`^ls-market-supply/raw/[A-Z0-9]+/${DAY}\\.json(\\.gz)?$`),
    'kis-turnover': new RegExp(`^kis-turnover/[A-Z0-9]+/${DAY}\\.json(\\.gz)?$`),
    'kis-concentration': new RegExp(`^kis-concentration/\\d{4}/${DAY}\\.json(\\.gz)?$`),
    // 한투 현물 시장 분봉 수급(2026-11-22 수집 중단). 현물은 키움(kiwoom-market-supply)이 화면 소스. 선물(FUTURE · FUTKQ0)은 남긴다.
    'kis-spot-market-supply': new RegExp(`^market-supply/(KOSPI0|KOSDAQ)/${DAY}\\.json(\\.gz)?$`)
};
const dayOf = rel => { const m = /(\d{4})-?(\d{2})-?(\d{2})\.json(\.gz)?$/.exec(rel); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// remote: [{ rel, size, hash }]. 지울 것(remove)과 남길 것(skip, 이유)을 나눈다.
function plan(remote, { sets, backup, today }) {
    const rules = sets.map(name => { if (!SETS[name]) throw new Error(`모르는 묶음: ${name}`); return SETS[name]; });
    const remove = [], skip = [];
    for (const f of remote) {
        if (f.rel.split('/').some(p => p === '..' || p === '.' || p === '') || !rules.some(rule => rule.test(f.rel))) continue;
        if (dayOf(f.rel) >= today) { skip.push({ ...f, why: '오늘 파일' }); continue; }
        const local = path.join(backup, ...f.rel.split('/'));
        if (!fs.existsSync(local)) { skip.push({ ...f, why: '로컬 백업 없음' }); continue; }
        if (fs.statSync(local).size !== f.size || sha(local) !== f.hash) { skip.push({ ...f, why: '로컬 백업과 다름' }); continue; }
        remove.push(f);
    }
    return { remove, skip };
}
// 묶음이 보는 data 아래 첫 폴더(RegExp.source는 '/'를 '\/'로 적는다).
const topOf = name => /^[a-z0-9-]+$/i.exec(SETS[name].source.slice(1).replace(/\\\//g, '/').split('/')[0])[0];
module.exports = { SETS, plan, topOf };

if (require.main === module) {
    const sets = process.argv.flatMap((a, i, all) => a === '--set' ? [all[i + 1]] : []);
    const apply = process.argv.includes('--apply');
    const logFile = path.join(root, 'outputs', 'scheduled', 'oracle-duplicate-cleanup.log');
    const kst = () => new Date(Date.now() + 9 * 3600000).toISOString();
    const log = line => { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, `[${kst().slice(0, 19).replace('T', ' ')}] ${line}\n`); console.log(line); };
    const ssh = (cmd, input) => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', HOST, cmd],
        { encoding: 'utf8', input, timeout: 600000, maxBuffer: 2 ** 30 });
    try {
        if (!sets.length) throw new Error('--set 으로 지울 묶음을 고르세요: ' + Object.keys(SETS).join(', '));
        const tops = [...new Set(sets.map(name => { if (!SETS[name]) throw new Error(`모르는 묶음: ${name}`); return topOf(name); }))];
        const listing = ssh(`cd ${REMOTE} && for d in ${tops.join(' ')}; do [ -d "$d" ] && find "$d" -type f; done | while IFS= read -r f; do echo "$(sha256sum "$f" | cut -d' ' -f1) $(stat -c %s "$f") $f"; done; true`);
        const remote = listing.split('\n').map(line => /^([a-f0-9]{64}) (\d+) (.+)$/.exec(line.trim())).filter(Boolean)
            .map(([, hash, size, rel]) => ({ hash, size: Number(size), rel }));
        const { remove, skip } = plan(remote, { sets, backup: path.join(root, 'outputs', 'oracle-data-backup', 'data'), today: kst().slice(0, 10) });
        log(`묶음 ${sets.join(',')} · 지울 것 ${remove.length}개(${(remove.reduce((n, f) => n + f.size, 0) / 1024).toFixed(0)}KB) · 남김 ${skip.length}개${apply ? '' : ' (목록만, --apply 없음)'}`);
        for (const f of skip) log(`  남김 ${f.rel} · ${f.why}`);
        if (!apply) { for (const f of remove) console.log('  지울 것 ' + f.rel); }
        else if (remove.length) {
            ssh(`cd ${REMOTE} && xargs -d '\\n' rm -f --`, remove.map(f => f.rel).join('\n') + '\n');
            const left = ssh(`cd ${REMOTE} && while IFS= read -r f; do [ -e "$f" ] && echo "$f"; done; true`, remove.map(f => f.rel).join('\n') + '\n').trim();
            log(left ? `지우지 못함: ${left.split('\n').length}개` : `지움 ${remove.length}개 · 오라클에서 없어진 것 확인`);
            if (left) process.exitCode = 1;
        }
    } catch (error) {
        log('실패 · ' + String(error.message || error).split('\n')[0].slice(0, 200));
        process.exitCode = 1;
    }
}
