'use strict';
// One-off backfill of the 52주 신고/신저 daily counts for KOSPI and KOSDAQ (local only).
//  1) Kiwoom ka10099 lists KOSPI (0), KOSDAQ (10) and ETF (8) codes.
//  2) Kiwoom ka10081 daily candles (KRX+NXT 통합 _AL, 수정주가) for every code, following cont-yn/next-key to
//     the oldest day Kiwoom serves. Raw rows are kept per code so a rerun resumes.
//  3) For every day, a code counts as a 52-week high (low) when its high (low) beats the prior window. The exact
//     Kiwoom ka10016 rule is not documented, so several variants are computed and compared with the counts the
//     server already holds: Kiwoom ka10016 (2026-10-26~) and the older jusikbot KOSPI values (~2026-10-20).
//  4) Writes results only under --out. data/breadth is never changed here; merging is decided after review.
// Token: the local server's Kiwoom token (data/kiwoom-token/token.json). Only when it is missing or expired is a
// token issued, and it is written back to that file so the server reuses it.
// Usage: node dev/breadth-backfill.cjs --out outputs/breadth-backfill-20261108 [--interval 300] [--limit 20]
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const out = path.resolve(root, arg('out', 'outputs/breadth-backfill-' + kst(Date.now()).slice(0, 10).replaceAll('-', '')));
const interval = Number(arg('interval', '300')), limit = Number(arg('limit', '0'));
const rawDir = path.join(out, 'raw'), tokenFile = path.join(root, 'data', 'kiwoom-token', 'token.json');
fs.mkdirSync(rawDir, { recursive: true });
const log = (msg, extra) => fs.appendFileSync(path.join(out, 'run.log'), `[${kst(Date.now())}] ${msg}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}\n`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const writeJson = (file, value) => { fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 1)); fs.renameSync(file + '.tmp', file); };

// ---- Kiwoom access
let token = '', issued = 0, lastCall = 0, calls = 0;
async function getToken(force = false) {
    if (token && !force) return token;
    if (!force) try { const s = JSON.parse(fs.readFileSync(tokenFile, 'utf8')); if (s.token && s.expires > Date.now() + 600000) { log('server token reused'); return token = s.token; } } catch {}
    const r = await fetch('https://api.kiwoom.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: (process.env.KIWOOM_APPKEY || '').trim(), secretkey: (process.env.KIWOOM_SECRETKEY || '').trim() }) });
    const j = await r.json().catch(() => ({}));
    if (!j.token) throw Error('키움 토큰 발급 실패');
    issued++; token = j.token; log('token issued (no valid server token)', { issued });
    try { fs.mkdirSync(path.dirname(tokenFile), { recursive: true }); fs.writeFileSync(tokenFile + '.tmp', JSON.stringify({ token, expires: Date.now() + 23 * 3600000, issuedAt: Date.now() }), { mode: 0o600 }); fs.renameSync(tokenFile + '.tmp', tokenFile); } catch {}
    return token;
}
async function post(endpoint, api, body, next = '') {
    let retriedToken = false;
    for (let attempt = 0; attempt < 8; attempt++) {
        await wait(Math.max(0, lastCall + interval - Date.now())); lastCall = Date.now(); calls++;
        let r, j;
        try {
            r = await fetch('https://api.kiwoom.com/api/dostk/' + endpoint, { method: 'POST', signal: AbortSignal.timeout(20000),
                headers: { 'Content-Type': 'application/json;charset=UTF-8', authorization: 'Bearer ' + await getToken(), 'api-id': api, 'cont-yn': next ? 'Y' : 'N', 'next-key': next }, body: JSON.stringify(body) });
            j = await r.json().catch(() => ({}));
        } catch (e) { await wait(2000 * (attempt + 1)); continue; }
        const code = j.return_code, msg = String(j.return_msg || '');
        if (r.ok && (code === undefined || Number(code) === 0)) return { data: j, cont: r.headers.get('cont-yn') === 'Y', next: r.headers.get('next-key') || '' };
        if ((Number(code) === 3 || /token|토큰/i.test(msg) || r.status === 401) && !retriedToken) { retriedToken = true; token = ''; await getToken(true); continue; }
        // Rate limit (HTTP 429 or the "허용된 요청 개수 초과" message): back off and retry.
        if (r.status === 429 || /초과|limit/i.test(msg)) { await wait(3000 * (attempt + 1)); continue; }
        throw Object.assign(Error(`${api} ${r.status} ${code} ${msg.slice(0, 80)}`), { code });
    }
    throw Error(api + ' 재시도 한도 초과');
}

// ---- 1) code lists
async function list(marketType) {
    const items = []; let next = '';
    for (let page = 0; page < 100; page++) {
        const r = await post('stkinfo', 'ka10099', { mrkt_tp: marketType }, next);
        items.push(...(r.data.list || []));
        if (!r.cont || !r.next) break; next = r.next;
    }
    return items.map(x => ({ code: String(x.code || '').trim(), name: String(x.name || '').trim(), marketCode: x.marketCode, marketName: x.marketName, regDay: x.regDay, state: x.state })).filter(x => /^[0-9A-Z]{6}$/.test(x.code));
}
// ---- 2) daily candles to the oldest day, newest first from Kiwoom
async function candles(code) {
    const file = path.join(rawDir, code + '.json.gz');
    if (fs.existsSync(file)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
    const today = kst(Date.now()).slice(0, 10).replaceAll('-', '');
    const rows = new Map(); let next = '', pages = 0, key = code + '_AL';
    for (;;) {
        let r;
        try { r = await post('chart', 'ka10081', { stk_cd: key, base_dt: today, upd_stkpc_tp: '1' }, next); }
        catch (e) { if (key.endsWith('_AL') && !next) { key = code; continue; } throw e; }
        pages++;
        for (const x of r.data.stk_dt_pole_chart_qry || []) {
            const dt = String(x.dt || ''), h = Math.abs(Number(x.high_pric)), l = Math.abs(Number(x.low_pric));
            if (/^\d{8}$/.test(dt) && h > 0 && l > 0) rows.set(dt, [dt, h, l]);
        }
        if (!r.cont || !r.next || pages > 80) break; next = r.next;
    }
    const sorted = [...rows.values()].sort((a, b) => a[0].localeCompare(b[0]));
    const saved = { code, key, pages, rows: sorted };
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(saved)));
    return saved;
}

// ---- 3) variants. window: prior trading days compared; cmp: '>' or '>='; history: 'full' needs a full prior
// window, 'partial' compares with whatever prior days exist (at least one).
const variants = [];
for (const window of [250, 249]) for (const cmp of ['>', '>=']) for (const history of ['full', 'partial']) variants.push({ window, cmp, history });
// KOSPI (ka10099 mrkt_tp 0) mixes stocks (marketCode 0) with ETF (8), ETN (60/70/90) and REIT/infra/fund (6/2/4).
// Which of them Kiwoom ka10016 counts is not documented, so each group is counted apart and combined later.
const groupOf = (market, item) => market === 'kosdaq' ? 'kosdaq' : item.marketCode === '0' ? 'kospiStock' : item.marketCode === '8' ? 'kospiEtf' : ['60', '70', '90'].includes(String(item.marketCode)) ? 'kospiEtn' : 'kospiOther';
const counts = { kospiStock: new Map(), kospiOther: new Map(), kospiEtf: new Map(), kospiEtn: new Map(), kosdaq: new Map() };
const universes = [['kospiStock'], ['kospiStock', 'kospiOther'], ['kospiStock', 'kospiOther', 'kospiEtf'], ['kospiStock', 'kospiOther', 'kospiEtf', 'kospiEtn']];
// Extreme of the `window` days before each day (monotonic deque, linear time). null when no prior day.
function priorExtreme(values, window, larger) {
    const result = new Array(values.length).fill(null), deque = [];
    for (let i = 0; i < values.length; i++) {
        while (deque.length && deque[0] < i - window) deque.shift();
        if (deque.length) result[i] = values[deque[0]];
        while (deque.length && (larger ? values[deque.at(-1)] <= values[i] : values[deque.at(-1)] >= values[i])) deque.pop();
        deque.push(i);
    }
    return result;
}
function addCounts(bucket, saved) {
    const rows = saved.rows, highs = rows.map(r => r[1]), lows = rows.map(r => r[2]), prior = {};
    for (const w of [250, 249]) prior[w] = { hi: priorExtreme(highs, w, true), lo: priorExtreme(lows, w, false) };
    for (let i = 1; i < rows.length; i++) {
        let slot = bucket.get(rows[i][0]);
        if (!slot) { slot = new Int32Array(variants.length * 2); bucket.set(rows[i][0], slot); }
        for (let v = 0; v < variants.length; v++) {
            const { window, cmp, history } = variants[v];
            if (history === 'full' && i < window) continue;
            const hi = prior[window].hi[i], lo = prior[window].lo[i];
            if (hi == null) continue;
            if (cmp === '>' ? highs[i] > hi : highs[i] >= hi) slot[v * 2]++;
            if (cmp === '>' ? lows[i] < lo : lows[i] <= lo) slot[v * 2 + 1]++;
        }
    }
}
// ---- 4) comparison with the stored counts
function compare(series, reference, field) {
    let n = 0, abs = 0, exact = 0, max = 0, sumRef = 0, sumCalc = 0;
    for (const [date, ref] of reference) {
        const calc = series.get(date); if (!calc || !Number.isFinite(ref?.[field])) continue;
        const d = Math.abs(calc[field] - ref[field]); n++; abs += d; max = Math.max(max, d); if (d === 0) exact++; sumRef += ref[field]; sumCalc += calc[field];
    }
    return n ? { days: n, meanAbs: Math.round(abs / n * 10) / 10, maxAbs: max, exactDays: exact, ratio: sumRef ? Math.round(sumCalc / sumRef * 1000) / 1000 : null } : { days: 0 };
}
async function main() {
    const started = Date.now();
    log('started', { interval, limit, pid: process.pid });
    const lists = fs.existsSync(path.join(out, 'lists.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'lists.json'), 'utf8'))
        : { kospi: await list('0'), kosdaq: await list('10') };
    writeJson(path.join(out, 'lists.json'), lists);
    log('lists', { kospi: lists.kospi.length, kosdaq: lists.kosdaq.length });
    const failures = [];
    for (const market of ['kospi', 'kosdaq']) {
        const codes = limit ? lists[market].slice(0, limit) : lists[market];
        for (let i = 0; i < codes.length; i++) {
            try { addCounts(counts[groupOf(market, codes[i])], await candles(codes[i].code)); }
            catch (e) { failures.push({ market, code: codes[i].code, error: String(e.message).slice(0, 120) }); }
            if (i % 50 === 0) writeJson(path.join(out, 'progress.json'), { at: kst(Date.now()), market, done: i, total: codes.length, calls, failures: failures.length, issued });
        }
    }
    // Stored counts: Kiwoom ka10016 from integratedFrom, older KOSPI from jusikbot.
    const daily = JSON.parse(fs.readFileSync(path.join(root, 'data', 'breadth', 'markets', 'daily.json'), 'utf8'));
    const ymd = d => d.replaceAll('-', '');
    const kiwoomRef = { kospi: new Map(), kosdaq: new Map() }, jusikbotRef = new Map();
    for (const p of daily.points) {
        if (daily.integratedFrom && p.date >= daily.integratedFrom) { for (const m of ['kospi', 'kosdaq']) if (p[m]) kiwoomRef[m].set(ymd(p.date), p[m]); }
        else if (p.kospi) jusikbotRef.set(ymd(p.date), p.kospi);
    }
    const series = (groups, v) => {
        const result = new Map();
        for (const group of groups) for (const [date, slot] of counts[group]) { const s = result.get(date) || { highs: 0, lows: 0 }; s.highs += slot[v * 2]; s.lows += slot[v * 2 + 1]; result.set(date, s); }
        return result;
    };
    const evaluated = [];
    for (let v = 0; v < variants.length; v++) for (let u = 0; u < universes.length; u++) {
        const withEtf = universes[u];
        const kospi = series(withEtf, v), kosdaq = series(['kosdaq'], v);
        const kiwoom = { kospiHighs: compare(kospi, kiwoomRef.kospi, 'highs'), kospiLows: compare(kospi, kiwoomRef.kospi, 'lows'), kosdaqHighs: compare(kosdaq, kiwoomRef.kosdaq, 'highs'), kosdaqLows: compare(kosdaq, kiwoomRef.kosdaq, 'lows') };
        const score = Object.values(kiwoom).reduce((s, x) => s + (x.meanAbs ?? 999), 0);
        evaluated.push({ variant: { ...variants[v], kospiGroups: withEtf }, v, withEtf, kiwoom, jusikbot: { highs: compare(kospi, jusikbotRef, 'highs'), lows: compare(kospi, jusikbotRef, 'lows') }, score });
    }
    evaluated.sort((a, b) => a.score - b.score);
    const best = evaluated[0];
    const kospi = series(best.withEtf, best.v), kosdaq = series(['kosdaq'], best.v);
    const dates = [...new Set([...kospi.keys(), ...kosdaq.keys()])].sort();
    const computed = dates.map(d => ({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, ...(kospi.has(d) ? { kospi: kospi.get(d) } : {}), ...(kosdaq.has(d) ? { kosdaq: kosdaq.get(d) } : {}) }));
    // Per-day differences against jusikbot, largest first, to judge whether jusikbot can be replaced.
    const jusikbotDiff = [...jusikbotRef].map(([d, ref]) => ({ date: d, jusikbot: ref, computed: kospi.get(d) || null })).filter(x => x.computed)
        .map(x => ({ ...x, diff: Math.abs(x.computed.highs - x.jusikbot.highs) + Math.abs(x.computed.lows - x.jusikbot.lows) })).sort((a, b) => b.diff - a.diff).slice(0, 30);
    writeJson(path.join(out, 'computed-daily.json'), { variant: best.variant, from: computed[0]?.date, to: computed.at(-1)?.date, points: computed });
    writeJson(path.join(out, 'result.json'), { startedAt: kst(started), finishedAt: kst(Date.now()), minutes: Math.round((Date.now() - started) / 60000), calls, tokenIssued: issued,
        lists: { kospi: lists.kospi.length, kosdaq: lists.kosdaq.length, groups: Object.fromEntries(Object.keys(counts).map(g => [g, [...lists.kospi.map(x => groupOf('kospi', x)), ...lists.kosdaq.map(x => groupOf('kosdaq', x))].filter(x => x === g).length])) }, failures, best: { variant: best.variant, kiwoom: best.kiwoom, jusikbot: best.jusikbot },
        variants: evaluated.map(({ variant, kiwoom, jusikbot, score }) => ({ variant, score: Math.round(score * 10) / 10, kiwoom, jusikbot })), jusikbotLargestDiff: jusikbotDiff,
        coverage: { from: computed[0]?.date, to: computed.at(-1)?.date, days: computed.length } });
    writeJson(path.join(out, 'done.json'), { at: kst(Date.now()), ok: true });
    log('completed', { minutes: Math.round((Date.now() - started) / 60000), calls, failures: failures.length });
}
main().catch(e => { log('failed', { message: String(e.message).slice(0, 200) }); writeJson(path.join(out, 'done.json'), { at: kst(Date.now()), ok: false, error: String(e.message).slice(0, 200) }); process.exitCode = 1; });
