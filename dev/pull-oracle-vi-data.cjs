'use strict';
// 오라클 VI · 대주 기록을 로컬로 옮긴다(2026-11-20 사용자 결정: VI · 대주는 오라클에서만 돌리고 분석은 로컬, 오라클 저장공간은 최소로).
// 매일 21:00 Windows 작업 스케줄러(MarketThrough-20261123-daily-oracle-vi-pull)가 실행한다. 결과는 outputs/scheduled/oracle-vi-pull.log에 한 줄씩.
//  - 받는 것(오라클 market-through/data → 로컬 data 같은 자리):
//      vi-monitor/charts/<날짜>/*, vi-monitor/gap-records/*.jsonl, vi-monitor/futures-events/*.jsonl, vi-monitor/amount-check-*.jsonl, vi-monitor/days/*.json
//    대주 30초 기록 short-stoploss/realtime-<날짜>.jsonl은 outputs/oracle-short-stoploss/로 받는다(로컬 대주 엔진이 data/short-stoploss의 지난 날짜 파일을 지우므로).
//  - 오라클에서 지우는 것: 오늘(KST)보다 이전 날짜의 charts · gap-records · futures-events · amount-check 파일 중, 로컬로 받은 사본의 크기 · sha256이 원본과 같은 것만.
//    오늘 파일은 받기만 하고 남긴다(다음 날 마지막 내용으로 다시 받은 뒤 지운다). days/는 오라클 VI 창이 마지막 하루치를 쓰므로 지우지 않는다(오라클이 스스로 1일만 남김).
//    대주 30초 기록은 오라클 대주 엔진이 날짜가 바뀌면 스스로 지운다.
//  - 로컬 보호: 2026-11-21 전 날짜(로컬 VI 시험 기간) 파일은 로컬에 있으면 덮어쓰지 않는다.
// 사용: node dev/pull-oracle-vi-data.cjs [--dry]   (--dry: 받기 · 지우기 없이 목록만)
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
// 시험용: --remote <오라클 경로> --local <로컬 폴더>로 바꿀 수 있다(기본은 실제 위치)
const opt = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const root = path.resolve(opt('local', path.resolve(__dirname, '..')));
const HOST = 'ubuntu@134.185.111.202', REMOTE = opt('remote', 'market-through/data');
const PROTECT_BEFORE = '2026-11-21';
const logFile = path.join(root, 'outputs', 'scheduled', 'oracle-vi-pull.log');
const dry = process.argv.includes('--dry');
const kstNow = () => new Date(Date.now() + 9 * 3600000).toISOString();
const today = kstNow().slice(0, 10);
const log = line => { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, `[${kstNow().slice(0, 19).replace('T', ' ')}] ${line}\n`); console.log(line); };
const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', HOST];
const ssh = (cmd, input) => execFileSync('ssh', [...sshArgs, cmd], { encoding: input === undefined ? 'utf8' : undefined, input, timeout: 600000, maxBuffer: 1 << 30 });
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 파일 경로 → 날짜와 로컬 저장 위치. 대상이 아니면 null.
function classify(rel) {
    let m;
    if ((m = /^vi-monitor\/charts\/(\d{4}-\d{2}-\d{2})\/[0-9A-Za-z_]+\.json$/.exec(rel))) return { day: m[1], local: path.join(root, 'data', rel), remove: true };
    if ((m = /^vi-monitor\/(gap-records|futures-events)\/(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(rel))) return { day: m[2], local: path.join(root, 'data', rel), remove: true };
    if ((m = /^vi-monitor\/amount-check-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(rel))) return { day: m[1], local: path.join(root, 'data', rel), remove: true };
    if ((m = /^vi-monitor\/days\/(\d{4}-\d{2}-\d{2})\.json$/.exec(rel))) return { day: m[1], local: path.join(root, 'data', rel), remove: false };
    if ((m = /^short-stoploss\/realtime-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(rel))) return { day: m[1], local: path.join(root, 'outputs', 'oracle-short-stoploss', path.basename(rel)), remove: false };
    // 끝자리 28 계좌(2026-11-21)의 30초 기록은 outputs/oracle-short-stoploss-28/로
    if ((m = /^short-stoploss-28\/realtime-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(rel))) return { day: m[1], local: path.join(root, 'outputs', 'oracle-short-stoploss-28', path.basename(rel)), remove: false };
    return null;
}
try {
    // 1) 오라클 목록: 상대경로 · 크기 · sha256
    const listing = ssh(`cd ${REMOTE} && { find vi-monitor/charts vi-monitor/gap-records vi-monitor/futures-events vi-monitor/days -type f 2>/dev/null; ls vi-monitor/amount-check-*.jsonl short-stoploss/realtime-*.jsonl short-stoploss-28/realtime-*.jsonl 2>/dev/null; } | while read f; do echo "$(sha256sum "$f" | cut -d' ' -f1) $(stat -c %s "$f") $f"; done; true`);
    const remote = listing.split('\n').map(l => l.trim().split(' ')).filter(p => p.length === 3 && /^[a-f0-9]{64}$/.test(p[0]))
        .map(([hash, size, rel]) => ({ hash, size: Number(size), rel, ...classify(rel) })).filter(f => f.local);
    const want = remote.filter(f => {
        if (!fs.existsSync(f.local)) return true;
        if (f.day < PROTECT_BEFORE) return false; // 로컬 VI 시험 기간 파일은 덮어쓰지 않는다
        return fs.statSync(f.local).size !== f.size || sha(f.local) !== f.hash;
    });
    log(`오라클 ${remote.length}개 파일 · 받을 것 ${want.length}개${dry ? ' (--dry)' : ''}`);
    // 2) 받기: tar로 한 번에 받아 임시 폴더에 풀고, 파일마다 크기 · sha256을 확인한 뒤 제자리로 옮긴다
    let copied = 0;
    if (want.length && !dry) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-vi-pull-'));
        try {
            // --format=pax: 이름에 한글이 있어도 Windows tar가 풀 수 있게 UTF-8로 적는다(2026-11-23, 백업 스크립트와 같은 이유).
            const archive = ssh(`cd ${REMOTE} && tar --format=pax -cf - -T -`, want.map(f => f.rel).join('\n') + '\n');
            fs.writeFileSync(path.join(tmp, 'pull.tar'), archive);
            execFileSync('tar', ['xf', 'pull.tar'], { cwd: tmp, timeout: 600000 });
            for (const f of want) {
                const got = path.join(tmp, ...f.rel.split('/'));
                if (!fs.existsSync(got) || fs.statSync(got).size !== f.size || sha(got) !== f.hash) { log(`확인 실패(받지 않음): ${f.rel}`); continue; }
                fs.mkdirSync(path.dirname(f.local), { recursive: true }); fs.copyFileSync(got, f.local); copied++;
            }
        } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    // 3) 오라클에서 지우기: 오늘 이전 날짜 · 지우는 대상 · 로컬 사본이 원본과 같은 것만
    const removable = remote.filter(f => f.remove && f.day < today && fs.existsSync(f.local) && fs.statSync(f.local).size === f.size && sha(f.local) === f.hash);
    let removed = 0;
    if (removable.length && !dry) {
        ssh(`cd ${REMOTE} && while IFS= read -r f; do case "$f" in vi-monitor/charts/*|vi-monitor/gap-records/*|vi-monitor/futures-events/*|vi-monitor/amount-check-*) rm -f -- "$f";; esac; done; find vi-monitor/charts -mindepth 1 -type d -empty -delete 2>/dev/null; true`, removable.map(f => f.rel).join('\n') + '\n');
        removed = removable.length;
    }
    const usage = ssh(`cd ${REMOTE} && du -sh vi-monitor short-stoploss short-stoploss-28 2>/dev/null | tr '\\n' ' '; df -h / | tail -1 | awk '{print "여유 " $4}'`).trim();
    log(`완료 · 새로 받음 ${copied} · 오라클에서 지움 ${removed}${dry ? `(지울 대상 ${removable.length})` : ''} · 오라클 ${usage}`);
} catch (error) {
    log('실패 · ' + String(error.message || error).split('\n')[0].slice(0, 200));
    process.exitCode = 1;
}
