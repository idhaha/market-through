'use strict';
// Restart the local server (this project's `node server.js` only) and record when it is back.
// Used by scheduled checks, e.g. whether a restart reuses the saved broker tokens instead of issuing new ones.
// Usage: node dev/restart-local-server.cjs --log outputs/scheduled/restart-20261109.log
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { execFileSync, spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const logFile = path.resolve(root, arg('log', 'outputs/scheduled/restart-' + kst(Date.now()).slice(0, 10).replaceAll('-', '') + '.log'));
const serverLog = path.join(root, 'outputs', 'local-server', 'server-' + kst(Date.now()).slice(0, 10).replaceAll('-', '') + '.log');
const log = (msg, extra) => { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, `[${kst(Date.now())}] ${msg}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}\n`); };
const up = () => new Promise(resolve => { const r = http.get('http://localhost:3000/', res => { res.resume(); resolve(res.statusCode === 200); }); r.on('error', () => resolve(false)); r.setTimeout(5000, () => { r.destroy(); resolve(false); }); });
function serverPids() {
    const text = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server\\.js' -and $_.CommandLine -notmatch 'codex' } | ForEach-Object { $_.ProcessId }"], { encoding: 'utf8' });
    return text.split(/\s+/).filter(Boolean).map(Number);
}
(async () => {
    const before = serverPids(); log('stopping', { pids: before });
    for (const pid of before) try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    fs.mkdirSync(path.dirname(serverLog), { recursive: true });
    const out = fs.openSync(serverLog, 'a');
    fs.appendFileSync(serverLog, `\n===== restart ${kst(Date.now())} (dev/restart-local-server.cjs) =====\n`);
    spawn(process.execPath, ['server.js'], { cwd: root, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 2000)); if (await up()) { log('started', { pids: serverPids(), serverLog: path.relative(root, serverLog) }); return; } }
    log('start_failed'); process.exitCode = 1;
})();
