'use strict';
// Scheduled check (files only, no broker calls or tokens): did the collectors stopped on 2026-11-07 write anything
// on a trading day, while the collectors the screen uses kept writing?
// Usage: node dev/check-alt-collection.cjs --day 2026-11-09 --out outputs/scheduled/alt-collection-20261109.json
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const day = arg('day', new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10));
const out = path.resolve(root, arg('out', 'outputs/scheduled/alt-collection-' + day.replaceAll('-', '') + '.json'));
const stopped = { 'ls-market-supply': 'LS t1602·t1662', 'ls-supply': 'LS t1717·t1637', supply: '키움 ka10060·ka90008', 'kis-concentration': '한투 FHKUP03500200', 'kis-turnover': '한투 H0UPCNT0' };
const running = { 'kiwoom-market-supply': '키움 ka10051·ka90005', 'kis-supply': '한투 HHPTJ04160200·H0UNPGM0', 'market-supply': '한투 FHPTJ04030000·LS t8463', breadth: '키움 ka10016' };
function filesOf(dir) {
    const found = [], walk = d => { let entries = []; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.includes(day) || e.name.includes(day.replaceAll('-', ''))) { const s = fs.statSync(p); found.push({ file: path.relative(root, p).replaceAll('\\', '/'), bytes: s.size, modified: new Date(s.mtimeMs + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ') }); } } };
    walk(path.join(root, 'data', dir)); return found;
}
const serverUp = () => new Promise(resolve => { const r = http.get('http://localhost:3000/', res => { res.resume(); resolve(res.statusCode); }); r.on('error', () => resolve(null)); r.setTimeout(10000, () => { r.destroy(); resolve(null); }); });
(async () => {
    const result = { checkedAt: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' '), day, localServerHttp: await serverUp(), stopped: {}, running: {} };
    for (const [dir, source] of Object.entries(stopped)) { const files = filesOf(dir); result.stopped[dir] = { source, files, ok: files.length === 0 }; }
    for (const [dir, source] of Object.entries(running)) { const files = filesOf(dir); result.running[dir] = { source, files, ok: files.length > 0 }; }
    result.summary = { stoppedOk: Object.values(result.stopped).every(v => v.ok), runningOk: Object.values(result.running).every(v => v.ok) };
    // Oracle, read only: the same folders, judged only when Oracle runs this change (local never stored kis-turnover).
    try {
        const ymd = day.replaceAll('-', ''), dirs = [...Object.keys(stopped), ...Object.keys(running)];
        const script = `cd ~/market-through && (grep -q altCollection server.js && echo DEPLOYED $(git describe --tags) || echo OLD $(git describe --tags)); for d in ${dirs.join(' ')}; do echo "DIR $d $(find data/$d -type f \\( -name '*${day}*' -o -name '*${ymd}*' \\) 2>/dev/null | wc -l)"; done`;
        const text = require('node:child_process').execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', 'ubuntu@134.185.111.202', script], { encoding: 'utf8', timeout: 60000 });
        const oracle = { version: (text.match(/^(DEPLOYED|OLD) (\S+)/m) || [])[2] || null, deployed: /^DEPLOYED/m.test(text), counts: {} };
        for (const [, dir, n] of text.matchAll(/^DIR (\S+) (\d+)/gm)) oracle.counts[dir] = Number(n);
        if (oracle.deployed) oracle.ok = { stopped: Object.keys(stopped).every(d => oracle.counts[d] === 0), running: Object.keys(running).every(d => oracle.counts[d] > 0) };
        result.oracle = oracle;
    } catch (error) { result.oracle = { error: String(error.message || error).slice(0, 160) }; }
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result.summary));
})();
