'use strict';
// One-off import (2026-11-07): full-day LS t8463 answers saved by earlier tests → 종목 선물 수급 card day files.
// Flow only; price bars are never stored (the card asks KIS when shown).
// An existing day file is never overwritten.
// Usage: node dev/import-stock-futures-days.cjs [--dir data/ls-stock-futures]
const fs = require('node:fs'), path = require('node:path');
const { createLsStockFutures } = require('../ls-stock-futures');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const directory = path.resolve(root, arg('dir', 'data/ls-stock-futures'));
const { minutePoints } = createLsStockFutures({ http: null, getToken: null, directory, supply: { summary: () => ({ stocks: [] }) } });
// Nearest contract at the time (November 2026 contracts, expiry 11/12).
const sources = [
    { file: 'outputs/stock-futures-investor-smoke/final-S11.json', code: '005930', contract: 'A116B000' },
    { file: 'outputs/stock-futures-investor-smoke/final-S50.json', code: '000660', contract: 'A506B000' },
    { file: 'outputs/stock-futures-investor-20261104-r2/final-S11.json', code: '005930', contract: 'A116B000' },
    { file: 'outputs/stock-futures-investor-20261104-r2/final-S50.json', code: '000660', contract: 'A506B000' }
];
for (const source of sources) {
    const rows = JSON.parse(fs.readFileSync(path.join(root, source.file), 'utf8'));
    const date = String(rows[0]?.date || '');
    if (!/^\d{8}$/.test(date) || rows.some(r => String(r.date) !== date)) throw Error('unexpected rows in ' + source.file);
    const day = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, target = path.join(directory, source.code, day + '.json');
    if (fs.existsSync(target)) { console.log('skip (exists)', path.relative(root, target)); continue; }
    const points = minutePoints(rows);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ day, points, contract: source.contract, updatedAt: fs.statSync(path.join(root, source.file)).mtimeMs, importedFrom: source.file }));
    console.log('wrote', path.relative(root, target), points.length, 'minutes', points[0] && new Date(points[0].t + 9 * 3600000).toISOString().slice(11, 16), '~', points.at(-1)?.source_time);
}
