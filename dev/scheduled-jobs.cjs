'use strict';
// Jobs started by Windows Task Scheduler (no model involved). Each job only runs scripts and writes results
// to outputs/; analysis is done later on request. Log: outputs/scheduled/<job>.log
// Usage: node dev/scheduled-jobs.cjs <job>
//   restore-20261105    after the 11/5 VI test: local server with market alert off, Oracle market alert back on
//                       (Oracle VI monitor stays off until the 11/6 NVI probe; user decision)
//   note-test-20261105  run dev/tests/quick-note.test.cjs and keep its output
//   nvi-probe-20261106  LS NVI/UVI/DVI key probe 07:58-08:06 plus Kiwoom NXT VIs for comparison
//   expiry-20261112     stock futures expiry day: record t8401 months, then t8463 rows until 16:30
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const job = process.argv[2] || '';
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
fs.mkdirSync(path.join(root, 'outputs', 'scheduled'), { recursive: true });
const logFile = path.join(root, 'outputs', 'scheduled', job + '.log');
const log = (msg, extra) => fs.appendFileSync(logFile, `[${kst(Date.now())}] ${msg}${extra === undefined ? '' : ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra))}\n`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const oracle = 'ubuntu@134.185.111.202';
const ssh = command => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', oracle, command], { encoding: 'utf8', timeout: 180000 }).trim();
// Each Oracle LS socket with its open time (fd creation) and bytes received, to find the unexpected extra socket.
const oracleLsDetail = () => ssh("ss -tnpiH state established '( dport = :9443 )' | paste - - | sed -E 's/.*:([0-9]+) +([0-9.]+):9443.*fd=([0-9]+).*bytes_received:([0-9]+).*lastrcv:([0-9]+).*/port=\\1 peer=\\2 fd=\\3 rcv=\\4 lastrcv_ms=\\5/'; for pf in $(ss -tnp state established '( dport = :9443 )' | grep -oE 'pid=[0-9]+,fd=[0-9]+'); do p=${pf#pid=}; p=${p%%,*}; f=${pf##*fd=}; echo fd=$f opened=$(date -d @$(stat -c %Y /proc/$p/fd/$f) +%H:%M:%S); done");
const localLsDetail = () => { try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-NetTCPConnection -RemotePort 9443 -State Established -ErrorAction SilentlyContinue | ForEach-Object { $c = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess)).CommandLine; '{0} opened={1} {2}' -f $_.RemoteAddress, $_.CreationTime.ToString('HH:mm:ss'), $c }"], { encoding: 'utf8', timeout: 60000 }).trim(); } catch { return null; } };
const oracleLsCount = () => Number(ssh('ss -tn state established | grep -c ":9443" || true'));
const localLsCount = () => { try { return execFileSync('netstat', ['-ano'], { encoding: 'utf8' }).split('\n').filter(l => /:9443\s/.test(l) && /ESTABLISHED/.test(l)).length; } catch { return null; } };
function run(args, outName) {
    return new Promise(resolve => {
        const o = outName ? fs.openSync(path.join(root, 'outputs', 'scheduled', outName), 'a') : 'ignore';
        const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', o, o] });
        log('started', { args, pid: child.pid });
        child.on('exit', code => { log('exited', { args: args.slice(0, 2), code }); resolve(code); });
    });
}

const jobs = {
    async 'restore-20261105'() {
        // The test runner restarts the local server at ~20:06 with old settings; wait for it to finish first.
        const runner = path.join(root, 'outputs', 'local-rest-vi-20261105', 'runner.jsonl');
        for (let i = 0; i < 90 && !(fs.existsSync(runner) && /"state":"completed"/.test(fs.readFileSync(runner, 'utf8'))); i++) await wait(10000);
        log('runner completed seen', /"state":"completed"/.test(fs.readFileSync(runner, 'utf8')));
        await run(['dev/local-rest-vi-test.cjs', '--day', '2026-11-05', '--restart-after-only']);
        await wait(15000);
        log('local LS :9443 connections', localLsCount());
        // Oracle: remove only the market alert test lines; VI_MONITOR_REALTIME=false and its comment stay.
        log('oracle restore', ssh([
            'cd ~/market-through',
            'cp .env ~/env-backup-20261105-2010 && chmod 600 ~/env-backup-20261105-2010',
            "sed -i '/^# 2026-11-05 LS session test: market alert realtime off (remove after test)$/d;/^MARKET_ALERT_REALTIME=false$/d' .env",
            "grep -nE '^(MARKET_ALERT_REALTIME|VI_MONITOR_REALTIME)=|2026-11-05' .env || true",
            'pm2 reload market-through --update-env >/dev/null && sleep 30',
            "pm2 jlist | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const p of JSON.parse(s))if(p.name==='market-through')console.log('pm2',p.pm2_env.status,'restarts',p.pm2_env.restart_time)})\"",
            "pm2 logs market-through --err --lines 40 --nostream 2>/dev/null | tail -15"].join(' && ')));
        await wait(60000);
        log('oracle LS :9443 connections (expect 2: market alert + stock program)', oracleLsCount());
    },
    async 'note-test-20261105'() {
        const code = await run(['--test', 'dev/tests/quick-note.test.cjs'], 'note-test-20261105.out.log');
        log('quick-note test exit code', code);
    },
    async 'nvi-probe-20261106'() {
        const remote = oracleLsCount(), local = localLsCount();
        log('LS :9443 connections before probe', { oracle: remote, local });
        log('oracle sockets', oracleLsDetail()); log('local sockets', localLsDetail());
        if (remote >= 3) { log('ABORT: Oracle already uses 3 LS sessions, the probe would exceed the limit'); return; }
        await Promise.all([
            run(['dev/ls-nvi-key-probe.cjs', '--until', '08:06', '--from-day', '20261105', '--count', '40', '--out', 'outputs/nvi-probe-20261106'], 'nvi-probe-20261106.out.log'),
            run(['dev/vi-compare-live.cjs', '--no-ls', '--until', '08:07', '--out', 'outputs/nvi-probe-20261106/kiwoom'], 'nvi-probe-20261106-kiwoom.out.log')]);
        log('LS :9443 connections after probe', { oracle: oracleLsCount(), local: localLsCount() });
        log('oracle sockets', oracleLsDetail()); log('local sockets', localLsDetail());
    },
    async 'ls-trace-20261106'() {
        // Why does one service end up with 2 LS sockets? Reproduce locally (on 11/5 the local server with only the
        // market alert on held 2 sockets) with every 9443 socket traced: opener code, registrations, close cause.
        // Meanwhile record Oracle's sockets (open time, bytes received) each minute to compare the pattern.
        const out = path.join(root, 'outputs', 'ls-socket-trace-20261106');
        fs.mkdirSync(out, { recursive: true });
        const probeLog = path.join(root, 'outputs', 'scheduled', 'nvi-probe-20261106.log');
        for (let i = 0; i < 30 && !(fs.existsSync(probeLog) && /job done|job failed|ABORT/.test(fs.readFileSync(probeLog, 'utf8'))); i++) await wait(10000);
        log('nvi probe finished before trace', fs.existsSync(probeLog) && /job done|ABORT/.test(fs.readFileSync(probeLog, 'utf8')));
        await run(['dev/local-rest-vi-test.cjs', '--day', '2026-11-06', '--restart-trace', 'outputs/ls-socket-trace-20261106/local-trace.jsonl']);
        const end = Date.parse('2026-11-06T08:40:00+09:00');
        while (Date.now() < end) {
            await wait(60000);
            let oracleSockets = null; try { oracleSockets = oracleLsDetail(); } catch (e) { oracleSockets = 'error ' + String(e.message).slice(0, 80); }
            fs.appendFileSync(path.join(out, 'sockets.jsonl'), JSON.stringify({ at: kst(Date.now()), oracle: oracleSockets, local: localLsDetail() }) + '\n');
        }
        // Back to the normal local setting (market alert off, no trace).
        await run(['dev/local-rest-vi-test.cjs', '--day', '2026-11-06', '--restart-after-only']);
        await wait(15000);
        log('local LS :9443 connections after restore', localLsCount());
    },
    async 'expiry-20261112'() {
        const out = path.join(root, 'outputs', 'stock-futures-investor-20261112');
        fs.mkdirSync(out, { recursive: true });
        // Record today's month list (is the expiring month 202611 still listed?) before the live recorder starts.
        const t = await (await fetch('https://openapi.ls-sec.co.kr:8080/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
            body: new URLSearchParams({ grant_type: 'client_credentials', appkey: process.env.LS_APPKEY || '', appsecretkey: process.env.LS_SECRETKEY || '', scope: 'oob' }) })).json();
        const r = await (await fetch('https://openapi.ls-sec.co.kr:8080/futureoption/market-data', { method: 'POST', signal: AbortSignal.timeout(30000),
            headers: { authorization: 'Bearer ' + t.access_token, 'Content-Type': 'application/json; charset=utf-8', tr_cd: 't8401', tr_cont: 'N', tr_cont_key: '' },
            body: JSON.stringify({ t8401InBlock: { dummy: '' } }) })).json();
        const codes = ['005930', '000660', '005380', '035420'];
        const months = Object.fromEntries(codes.map(c => [c, (r.t8401OutBlock || []).filter(x => String(x.basecode).trim() === 'A' + c && /^A[0-9A-Z]{7}$/.test(x.shcode))
            .map(x => ({ shcode: x.shcode, name: String(x.hname).trim() }))]));
        fs.writeFileSync(path.join(out, 'months-t8401.json'), JSON.stringify({ at: kst(Date.now()), months }, null, 2));
        log('t8401 months saved', Object.fromEntries(Object.entries(months).map(([c, m]) => [c, m.length])));
        await wait(2000);
        await run(['dev/stock-futures-investor-live.cjs', '--codes', codes.join(','), '--until', '16:30', '--out', 'outputs/stock-futures-investor-20261112'], 'expiry-20261112.out.log');
    },
};

if (!jobs[job]) { console.error('unknown job: ' + job); process.exit(2); }
log('job start');
jobs[job]().then(() => log('job done'), e => { log('job failed', String(e && e.message || e).slice(0, 300)); process.exitCode = 1; });
