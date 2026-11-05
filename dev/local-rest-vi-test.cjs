'use strict';
// Local-only integrated test for one trading day (default 2026-11-04). Never touches the Oracle server.
//  - Restarts the local server with LS supply/program on REST, KIS realtime off and the VI window's
//    LS websocket off, so the only local LS websockets are the market alert (JIF) and the VI comparison.
//  - Runs dev/vi-compare-live.cjs (Kiwoom 1h vs LS VI_/NVI, NH prices) until 20:00.
//  - At the end restores the normal local server (no overrides).
//  - --with-ls: the VI comparison also opens its LS VI_/NVI websocket (needs a free LS session).
//  - After the window the local server restarts with LS websockets limited to the market alert,
//    so it does not take LS sessions from Oracle on the next morning.
// Usage: node dev/local-rest-vi-test.cjs [--day 2026-11-04] [--with-ls]
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const day = arg('day', new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10));
const at = clock => Date.parse(day + 'T' + clock + ':00+09:00');
const out = path.join(root, 'outputs', 'local-rest-vi-' + day.replaceAll('-', ''));
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const wait = ms => new Promise(r => setTimeout(r, ms));
const log = (state, detail = {}) => fs.appendFileSync(path.join(out, 'runner.jsonl'), JSON.stringify({ at: kst(Date.now()), state, ...detail }) + '\n');
const overrides = { LS_MARKET_SUPPLY_MODE: 'rest', LS_STOCK_PROGRAM_MODE: 'rest', LS_STOCK_PROGRAM_REST_CODES: '005930',
    KIS_STOCK_REALTIME_ENABLED: 'false', VI_MONITOR_REALTIME: 'false',
    // 2026-11-05: user allowed market alerts off on both servers for this test.
    MARKET_ALERT_REALTIME: 'false' };
// Local server after the test: no VI window or stock program LS websocket (Oracle keeps those sessions).
const afterTest = { LS_STOCK_PROGRAM_MODE: 'rest', LS_STOCK_PROGRAM_REST_CODES: '005930', VI_MONITOR_REALTIME: 'false',
    // 2026-11-05: until the 11/6 NVI key probe ends, Oracle keeps JIF + program and the probe needs the third LS session.
    MARKET_ALERT_REALTIME: 'false' };

function serverUp() {
    return new Promise(resolve => {
        const req = http.get('http://localhost:3000/robots.txt', { timeout: 5000 }, res => { res.resume(); resolve(res.statusCode < 500); });
        req.on('error', () => resolve(false)); req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}
function serverPids() {
    // Only this project's server.js (started from the project folder), not previews or other tools.
    const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match '(^|[\\s"])server\\.js("|\\s|$)' -and $_.CommandLine -notmatch 'ollama-coder' } | ForEach-Object { $_.ProcessId }`;
    try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 30000 }).split(/\s+/).filter(Boolean).map(Number); }
    catch { return []; }
}
async function stopServer() {
    for (const pid of serverPids()) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); log('server_stopped', { pid }); } catch {} }
    for (let i = 0; i < 30 && await serverUp(); i++) await wait(1000);
}
async function startServer(env, label) {
    // Inherited environment wins over .env (dotenv does not override existing variables).
    spawn('cmd.exe', ['/c', `start "MarketThrough server${label ? ' ' + label : ''}" /min "${process.execPath}" server.js`],
        { cwd: root, detached: true, stdio: 'ignore', windowsVerbatimArguments: true, env: { ...process.env, ...env } }).unref();
    for (let i = 0; i < 90; i++) { await wait(1000); if (await serverUp()) { log('server_started', { mode: label || 'normal', pids: serverPids() }); return true; } }
    log('server_start_failed', { mode: label || 'normal' }); return false;
}
async function main() {
    fs.mkdirSync(out, { recursive: true });
    // --restart-after-only: just restart the local server with the after-test settings.
    // --restart-trace <file>: after-test settings but market alert ON and LS sockets traced (dev/trace-ls-sockets.cjs).
    if (process.argv.includes('--restart-trace')) {
        const traceEnv = { ...afterTest, MARKET_ALERT_REALTIME: 'true', NODE_OPTIONS: '--require ' + path.join(root, 'dev', 'trace-ls-sockets.cjs'), LS_SOCKET_TRACE_OUT: arg('restart-trace', 'outputs/ls-socket-trace/trace.jsonl') };
        await stopServer(); await startServer(traceEnv, 'LS trace'); log('restarted_trace', { traceEnv }); return;
    }
    if (process.argv.includes('--restart-after-only')) { await stopServer(); await startServer(afterTest, 'LS shared'); log('restarted_after_only', { afterTest }); return; }
    if (Date.now() >= at('20:00')) throw Error('Test window already ended');
    log('started', { overrides });
    await stopServer();
    await startServer(overrides, 'REST test');
    const child = spawn(process.execPath, ['dev/vi-compare-live.cjs', '--until', '20:00', '--out', 'outputs/vi-compare-' + day.replaceAll('-', ''), ...(process.argv.includes('--with-ls') ? [] : ['--no-ls'])],
        { cwd: root, stdio: ['ignore', fs.openSync(path.join(out, 'vi-compare.out.log'), 'a'), fs.openSync(path.join(out, 'vi-compare.err.log'), 'a')] });
    log('vi_compare_started', { pid: child.pid });
    child.on('exit', code => log('vi_compare_exited', { code }));
    // Keep the test server alive through the window; restart it with the same overrides if it stops.
    while (Date.now() < at('20:06')) {
        await wait(Math.min(300000, Math.max(1000, at('20:06') - Date.now())));
        if (Date.now() < at('20:06') && !await serverUp()) { log('server_down'); await startServer(overrides, 'REST test'); }
    }
    await stopServer();
    await startServer(afterTest, 'LS shared');
    log('completed');
}
main().catch(e => { try { fs.mkdirSync(out, { recursive: true }); log('failed', { error: String(e.message) }); } catch {} process.exitCode = 1; });
