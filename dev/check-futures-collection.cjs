'use strict';
// Scheduled check of the 종목 선물 수급 card collection (files only, no broker calls or tokens).
//  - every registered stock: stored minute flow (t8463) for the day and missing minutes
//    (price bars are not stored since 2026-11-07: KIS FHKIF03020200 is asked when shown)
//  - each collection run (data/ls-stock-futures/collect-<day>.jsonl): time taken, failures, gaps between runs
//  - LS failures in logs/server_debug.<day>.log (call limits etc.), and the nearest contract (rollover on expiry)
// Usage: node dev/check-futures-collection.cjs --day 2026-11-09 --out outputs/scheduled/futures-collection-20261109-1105.json
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const day = arg('day', kst(Date.now()).slice(0, 10));
const out = path.resolve(root, arg('out', `outputs/scheduled/futures-collection-${day.replaceAll('-', '')}.json`));
const dir = path.join(root, 'data', 'ls-stock-futures');
const hm = t => kst(t).slice(11, 16);
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const serverUp = () => new Promise(resolve => { const r = http.get('http://localhost:3000/', res => { res.resume(); resolve(res.statusCode); }); r.on('error', () => resolve(null)); r.setTimeout(10000, () => { r.destroy(); resolve(null); }); });
// Minutes the day session should have by now: 08:45 up to 15:44 (last bar), not past the last finished minute.
function expectedMinutes(checkedAt) {
    const start = Date.parse(`${day}T08:45:00+09:00`), end = Math.min(Date.parse(`${day}T15:44:00+09:00`), Math.floor(checkedAt / 60000) * 60000 - 60000);
    const list = []; for (let t = start; t <= end; t += 60000) list.push(t); return list;
}
const missing = (have, expected) => { const set = new Set(have); return expected.filter(t => !set.has(t)).map(hm); };
(async () => {
    const checkedAt = Date.now(), result = { checkedAt: kst(checkedAt), day, localServerHttp: await serverUp(), stocks: {} };
    const watch = read(path.join(root, 'data', 'supply', 'watchlist.json'))?.stocks || [], master = read(path.join(dir, 'master.json'));
    result.master = master ? { day: master.day, watched: Object.fromEntries(watch.map(s => [s.code, (master.rows || []).find(([code]) => code === s.code)?.[1] || null])) } : null;
    const expected = expectedMinutes(checkedAt);
    for (const stock of watch) {
        const item = (master?.rows || []).find(([code]) => code === stock.code)?.[1] || null;
        const saved = read(path.join(dir, stock.code, `${day}.json`));
        if (!saved) { result.stocks[stock.code] = { name: stock.name, file: false, master: item }; continue; }
        const pts = (saved.points || []).map(p => p.t), bars = (saved.candles || []).map(c => c.t), barSet = new Set(bars), ptSet = new Set(pts);
        const last = saved.points?.at(-1);
        result.stocks[stock.code] = { name: stock.name, file: true, contract: saved.contract || null, updatedAt: saved.updatedAt ? kst(saved.updatedAt) : null,
            flow: { count: pts.length, first: pts.length ? hm(pts[0]) : null, last: pts.length ? hm(pts.at(-1)) : null, lastSourceTime: last?.source_time ?? null,
                missing: missing(pts, expected), lastValues: last ? { individual: last.individual, foreign: last.foreign, institution: last.institution } : null },
            candles: { count: bars.length, first: bars.length ? hm(bars[0]) : null, last: bars.length ? hm(bars.at(-1)) : null, missing: missing(bars, expected),
                afterLastFinishedMinute: bars.filter(t => t > Math.floor(checkedAt / 60000) * 60000 - 60000).map(hm) },
            alignment: { flowWithoutCandle: pts.filter(t => !barSet.has(t)).map(hm).slice(0, 40), candleWithoutFlow: bars.filter(t => !ptSet.has(t)).map(hm).slice(0, 40) } };
    }
    // Collection runs
    const runs = (() => { try { return fs.readFileSync(path.join(dir, `collect-${day}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } })();
    const errors = {}, gaps = [];
    for (let i = 0; i < runs.length; i++) {
        for (const r of runs[i].results || []) if (r.error) errors[r.error] = (errors[r.error] || 0) + 1;
        if (i && runs[i].t - runs[i - 1].t > 90000) gaps.push(`${hm(runs[i - 1].t)}→${hm(runs[i].t)}`);
    }
    const ms = runs.map(r => r.ms).sort((a, b) => a - b);
    result.runs = { count: runs.length, first: runs[0] ? kst(runs[0].t) : null, last: runs.at(-1) ? kst(runs.at(-1).t) : null,
        msMedian: ms[Math.floor(ms.length / 2)] ?? null, msMax: ms.at(-1) ?? null, failedRuns: runs.filter(r => (r.results || []).some(x => x.error)).length,
        errors, gaps, contracts: [...new Set(runs.flatMap(r => (r.results || []).map(x => `${x.code}:${x.contract || ''}`)))] };
    // LS failures in the server log of the day (any LS service, since they share the app key and its call limits)
    const lines = (() => { try { return fs.readFileSync(path.join(root, 'logs', `server_debug.${day}.log`), 'utf8').split('\n'); } catch { return null; } })();
    if (lines) {
        const hits = lines.filter(l => /\bLS\b|t8\d{3}|t1\d{3}|t2522|IGW/i.test(l) && /실패|초과|IGW|거절|429|limit|timeout|시간 초과/i.test(l));
        const kinds = {}; for (const l of hits) { const k = l.replace(/^\[[^\]]+\]\s*/, '').replace(/\d+/g, '#').slice(0, 120); kinds[k] = (kinds[k] || 0) + 1; }
        result.serverLog = { lsFailureLines: hits.length, kinds, samples: hits.slice(0, 10).map(l => l.slice(0, 200)) };
    } else result.serverLog = { missing: true };
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ stocks: Object.keys(result.stocks).length, runs: result.runs.count, failedRuns: result.runs.failedRuns }));
})();
