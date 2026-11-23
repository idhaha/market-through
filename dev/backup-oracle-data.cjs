'use strict';
// 오라클 차트 자료 백업(2026-11-21 사용자 결정: 차트 자료는 오라클에 보관하고, 백업을 위해 매일 로컬로 복사한다).
// 매일 21:30 Windows 작업 스케줄러(MarketThrough-20261121-daily-oracle-data-backup)가 실행한다.
//  - 오라클 market-through/data 아래 파일을 outputs/oracle-data-backup/data/ 같은 자리로 복사한다.
//    크기 · sha256이 다른 파일만 받고, 받은 사본도 크기 · sha256을 확인한 뒤 제자리에 둔다.
//  - 오라클에서는 아무것도 지우거나 고치지 않는다(복사만). 오라클에서 없어진 파일도 로컬 백업에서는 지우지 않는다.
//  - 받지 않는 것: auth-private(인증 정보), 토큰 폴더(*-token, nh-plug), 임시 파일(*.tmp), 이름에 token이 든 파일,
//    VI 기록(vi-monitor)과 대주 30초 기록(short-stoploss*/realtime-*) — 이 둘은 dev/pull-oracle-vi-data.cjs가 21:00에 따로 옮긴다.
// 결과: outputs/scheduled/oracle-data-backup.log 한 줄씩.
// 사용: node dev/backup-oracle-data.cjs [--dry]   (--dry: 받지 않고 목록만)
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const opt = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const root = path.resolve(__dirname, '..');
const HOST = 'ubuntu@134.185.111.202', REMOTE = 'market-through/data';
const target = path.resolve(opt('target', path.join(root, 'outputs', 'oracle-data-backup', 'data')));
const logFile = path.join(root, 'outputs', 'scheduled', 'oracle-data-backup.log');
const dry = process.argv.includes('--dry');
const kstNow = () => new Date(Date.now() + 9 * 3600000).toISOString();
const log = line => { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, `[${kstNow().slice(0, 19).replace('T', ' ')}] ${line}\n`); console.log(line); };
const ssh = (cmd, input) => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', HOST, cmd],
    { encoding: input === undefined ? 'utf8' : undefined, input, timeout: 900000, maxBuffer: 2 ** 31 });
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 받지 않는 경로(오라클 목록 명령과 같은 규칙을 여기서 한 번 더 확인한다).
function excluded(rel) {
    const parts = rel.split('/'), top = parts[0], name = parts.at(-1);
    if (parts.some(p => p === '..' || p === '.' || p === '')) return true;
    if (top === 'auth-private' || top === 'vi-monitor' || top === 'nh-plug' || /-token$/.test(top)) return true;
    if (/token/i.test(name) || /\.tmp$/.test(name)) return true;
    if (/^short-stoploss/.test(top) && /^realtime-/.test(name)) return true;
    return false;
}
module.exports = { excluded };
if (require.main === module) {
    try {
        // 1) 오라클 목록: sha256 · 크기 · 상대경로. 제외 폴더는 들어가지도 않는다(-prune).
        const listing = ssh(`cd ${REMOTE} && find . -mindepth 1 \\( -name auth-private -o -name vi-monitor -o -name nh-plug -o -name '*-token' \\) -prune -o -type f ! -iname '*token*' ! -name '*.tmp' -print | sed 's|^\\./||' | while IFS= read -r f; do echo "$(sha256sum "$f" | cut -d' ' -f1) $(stat -c %s "$f") $f"; done; true`);
        const remote = listing.split('\n').map(line => /^([a-f0-9]{64}) (\d+) (.+)$/.exec(line.trim())).filter(Boolean)
            .map(([, hash, size, rel]) => ({ hash, size: Number(size), rel })).filter(f => !excluded(f.rel));
        const localOf = f => path.join(target, ...f.rel.split('/'));
        const want = remote.filter(f => { const l = localOf(f); return !fs.existsSync(l) || fs.statSync(l).size !== f.size || sha(l) !== f.hash; });
        const bytes = want.reduce((sum, f) => sum + f.size, 0);
        log(`오라클 ${remote.length}개 파일 · 받을 것 ${want.length}개(${(bytes / 1048576).toFixed(1)}MB)${dry ? ' (--dry)' : ''}`);
        // 2) tar로 한 번에 받아 임시 폴더에 풀고, 파일마다 확인한 뒤 제자리로 옮긴다.
        let copied = 0, failed = 0;
        if (want.length && !dry) {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-data-backup-'));
            try {
                // --format=pax: 한글 폴더 이름(background-refresh/snapshots/거래대금 순위-…)을 UTF-8로 적는다. 기본 형식으로 묶으면
                // Windows tar가 "Invalid empty pathname"으로 풀지 못해 2026-11-22 21:30 백업 전체가 실패했다.
                fs.writeFileSync(path.join(tmp, 'pull.tar'), ssh(`cd ${REMOTE} && tar --format=pax -cf - -T -`, want.map(f => f.rel).join('\n') + '\n'));
                execFileSync('tar', ['xf', 'pull.tar'], { cwd: tmp, timeout: 900000 });
                for (const f of want) {
                    const got = path.join(tmp, ...f.rel.split('/'));
                    // 받는 동안 오라클이 파일을 고쳤으면(오늘 파일) 다음 날 다시 받는다.
                    if (!fs.existsSync(got) || fs.statSync(got).size !== f.size || sha(got) !== f.hash) { failed++; continue; }
                    const l = localOf(f); fs.mkdirSync(path.dirname(l), { recursive: true });
                    fs.copyFileSync(got, l + '.part'); fs.renameSync(l + '.part', l); copied++;
                }
            } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
        }
        const usage = ssh(`cd ${REMOTE} && du -sh . | cut -f1; df -h / | tail -1 | awk '{print $4}'`).trim().split('\n');
        log(`완료 · 새로 받음 ${copied}${failed ? ` · 받는 중 바뀌어 다음에 받을 것 ${failed}` : ''} · 오라클 data ${usage[0]} · 오라클 여유 ${usage[1]}`);
    } catch (error) {
        log('실패 · ' + String(error.message || error).split('\n')[0].slice(0, 200));
        process.exitCode = 1;
    }
}
