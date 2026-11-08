'use strict';
// Rebuilds data/breadth/markets/daily.json on the common-stock basis (decided 2026-11-08) from the daily candles
// saved by dev/breadth-backfill.cjs. No broker calls.
//  - Universe: breadth-universe.js isCommonStock (KOSPI/KOSDAQ common stocks; no ETF·ETN·REIT·preferred·SPAC).
//  - Rule: a stock is a 52-week high (low) when its high (low) is above (below) the extreme of the prior 250
//    trading days; it needs 250 prior days of its own (closest to Kiwoom ka10016 dt=250 in the comparison).
//  - Every stored day up to the last candle day is replaced (jusikbot and the ETF-including Kiwoom counts alike).
//    A market's day is written only when at least one stock had a full window.
//  - Delisted stocks are not in today's list, so older counts are lower than they were at the time.
//  - Minutes saved before the next collection day counted ETF·ETN; minuteFrom hides them (files are kept).
// The old daily.json is copied to <out>/daily.before-common.json first.
// Usage: node dev/breadth-common-rebuild.cjs --out outputs/breadth-backfill-20261108 [--minute-from 2026-11-09] [--dry]
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { isCommonStock } = require('../breadth-universe');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const out = path.resolve(root, arg('out', 'outputs/breadth-backfill-20261108')), dry = process.argv.includes('--dry');
const target = path.join(root, 'data', 'breadth', 'markets', 'daily.json');
const WINDOW = 250;

function priorExtreme(values, larger) {
    const result = new Array(values.length).fill(null), deque = [];
    for (let i = 0; i < values.length; i++) {
        while (deque.length && deque[0] < i - WINDOW) deque.shift();
        if (deque.length) result[i] = values[deque[0]];
        while (deque.length && (larger ? values[deque.at(-1)] <= values[i] : values[deque.at(-1)] >= values[i])) deque.pop();
        deque.push(i);
    }
    return result;
}
const lists = JSON.parse(fs.readFileSync(path.join(out, 'lists.json'), 'utf8'));
const counts = { kospi: new Map(), kosdaq: new Map() }, missing = [], universe = {};
for (const market of ['kospi', 'kosdaq']) {
    const stocks = lists[market].filter(item => isCommonStock(item, market));
    universe[market] = stocks.length;
    for (const item of stocks) {
        const file = path.join(out, 'raw', item.code + '.json.gz');
        if (!fs.existsSync(file)) { missing.push(item.code); continue; }
        const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(file))).rows;
        const highs = rows.map(r => r[1]), lows = rows.map(r => r[2]), hi = priorExtreme(highs, true), lo = priorExtreme(lows, false);
        for (let i = WINDOW; i < rows.length; i++) {
            const date = `${rows[i][0].slice(0, 4)}-${rows[i][0].slice(4, 6)}-${rows[i][0].slice(6, 8)}`;
            const slot = counts[market].get(date) || { highs: 0, lows: 0 };
            if (highs[i] > hi[i]) slot.highs++;
            if (lows[i] < lo[i]) slot.lows++;
            counts[market].set(date, slot);
        }
    }
}
if (missing.length) throw Error('일봉 없는 보통주 ' + missing.length + '개: ' + missing.slice(0, 10).join(','));
const dates = [...new Set([...counts.kospi.keys(), ...counts.kosdaq.keys()])].sort();
const points = dates.map(date => ({ date, ...(counts.kospi.has(date) ? { kospi: counts.kospi.get(date) } : {}), ...(counts.kosdaq.has(date) ? { kosdaq: counts.kosdaq.get(date) } : {}) }));
const before = JSON.parse(fs.readFileSync(target, 'utf8'));
const computedThrough = dates.at(-1);
// Days stored after the last candle day (collected on the new basis) are kept as they are.
const later = before.points.filter(p => p.date > computedThrough);
const next = { points: [...points, ...later], basis: 'common', computedThrough, legacyThrough: null,
    integratedFrom: later[0]?.date || null, minuteFrom: arg('minute-from', null) || before.minuteFrom || null };
const summary = { universe, days: points.length, kospiFrom: [...counts.kospi.keys()].sort()[0], kosdaqFrom: [...counts.kosdaq.keys()].sort()[0], computedThrough, keptLater: later.length,
    sample: points.filter(p => p.date >= '2026-10-14').map(p => `${p.date} K ${p.kospi?.highs}/${p.kospi?.lows} Q ${p.kosdaq?.highs}/${p.kosdaq?.lows}`) };
console.log(JSON.stringify(summary, null, 1));
if (!dry) {
    const backup = path.join(out, 'daily.before-common.json');
    if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
    fs.writeFileSync(target + '.tmp', JSON.stringify(next)); fs.renameSync(target + '.tmp', target);
    console.log('written', target, 'backup', backup);
}
