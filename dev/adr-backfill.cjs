'use strict';
// One-off ADR history from Kiwoom daily candles (local only, 2026-11-09 01:00 scheduled run).
// Goal: draw ADR on the 52주 신고/신저 chart (left Y axis) and retire the jusikbot ADR card. The universe is
// decided after this comparison; the candidate is common stocks only.
//  1) Kiwoom ka10099 lists KOSPI (0) and KOSDAQ (10) products.
//  2) Kiwoom ka10081 daily candles (수정주가) for every code to the oldest day Kiwoom serves, twice: KRX (code,
//     raw/) first, then KRX+NXT integrated (code_AL, raw-al/; its close is the NXT 20:00 price after 2025-03).
//     A code without _AL falls back to the KRX code (key recorded). Rows kept per code as
//     [dt, open, high, low, close, volume] so a rerun resumes and later work (52주, ADR) can reuse them.
//     Collection stops at --until (default 08:30 KST, before the market) and computes with what it has.
//  3) Per day and market: advancing / declining / unchanged counts by group (common, preferred, SPAC, ETF, ETN,
//     REIT·fund). A stock is up (down) when its close is above (below) its previous candle's close.
//  4) ADR(%) = 20-trading-day sum of advancers / sum of decliners x 100, for several universes.
//  5) KRX and KRX+NXT ADR are compared with each other and with jusikbot adr/history (5y) on the common days: mean/median/max difference, bias, correlation,
//     and a one-day shift check.
// Writes only under --out; data/ is never changed. Token: the local server's Kiwoom token file, issued only when
// missing or expired (written back so the server reuses it).
// Usage: node dev/adr-backfill.cjs --out outputs/adr-backfill-20261109 [--interval 300] [--limit 20] [--until 08:30] [--compute-only]
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { isCommonStock } = require('../breadth-universe');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const out = path.resolve(root, arg('out', 'outputs/adr-backfill-' + kst(Date.now()).slice(0, 10).replaceAll('-', '')));
const interval = Number(arg('interval', '300')), limit = Number(arg('limit', '0')), computeOnly = process.argv.includes('--compute-only');
const until = arg('until', '08:30'), SOURCES = { krx: { dir: path.join(out, 'raw'), suffix: '' }, al: { dir: path.join(out, 'raw-al'), suffix: '_AL' } };
const pastUntil = () => { const now = kst(Date.now()).slice(11, 16); return now >= until && now < '20:00'; };
const tokenFile = path.join(root, 'data', 'kiwoom-token', 'token.json');
for (const s of Object.values(SOURCES)) fs.mkdirSync(s.dir, { recursive: true });
const log = (msg, extra) => fs.appendFileSync(path.join(out, 'run.log'), `[${kst(Date.now())}] ${msg}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}\n`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const writeJson = (file, value) => { fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 1)); fs.renameSync(file + '.tmp', file); };
const WINDOW = 20;

// ---- Kiwoom access (same as dev/breadth-backfill.cjs)
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
        if (r.status === 429 || /초과|limit/i.test(msg)) { await wait(3000 * (attempt + 1)); continue; }
        throw Object.assign(Error(`${api} ${r.status} ${code} ${msg.slice(0, 80)}`), { code });
    }
    throw Error(api + ' 재시도 한도 초과');
}
async function list(marketType) {
    const items = []; let next = '';
    for (let page = 0; page < 100; page++) {
        const r = await post('stkinfo', 'ka10099', { mrkt_tp: marketType }, next);
        items.push(...(r.data.list || []));
        if (!r.cont || !r.next) break; next = r.next;
    }
    return items.map(x => ({ code: String(x.code || '').trim(), name: String(x.name || '').trim(), marketCode: x.marketCode, marketName: x.marketName, regDay: x.regDay, state: x.state })).filter(x => /^[0-9A-Z]{6}$/.test(x.code));
}
const num = v => Math.abs(Number(String(v ?? '').replace(/,/g, '')));
async function candles(code, source) {
    const file = path.join(SOURCES[source].dir, code + '.json.gz');
    if (fs.existsSync(file)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
    const today = kst(Date.now()).slice(0, 10).replaceAll('-', '');
    const rows = new Map(); let next = '', pages = 0, key = code + SOURCES[source].suffix;
    for (;;) {
        let r;
        try { r = await post('chart', 'ka10081', { stk_cd: key, base_dt: today, upd_stkpc_tp: '1' }, next); }
        catch (e) { if (key !== code && !next) { key = code; continue; } throw e; }
        pages++;
        for (const x of r.data.stk_dt_pole_chart_qry || []) {
            const dt = String(x.dt || ''), c = num(x.cur_prc);
            if (/^\d{8}$/.test(dt) && c > 0) rows.set(dt, [dt, num(x.open_pric), num(x.high_pric), num(x.low_pric), c, num(x.trde_qty)]);
        }
        if (!r.cont || !r.next || pages > 80) break; next = r.next;
    }
    const saved = { code, key, pages, rows: [...rows.values()].sort((a, b) => a[0].localeCompare(b[0])) };
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(saved)));
    return saved;
}

// ---- groups and universes
function groupOf(market, item) {
    if (isCommonStock(item, market)) return 'common';
    const mc = String(item.marketCode);
    if (market === 'kosdaq' || mc === '0') return /스팩/.test(item.name) ? 'spac' : /^[0-9A-Z]{5}0$/.test(item.code) ? 'otherStock' : 'preferred';
    if (mc === '8') return 'etf';
    if (['60', '70', '90'].includes(mc)) return 'etn';
    return 'reitFund';
}
const GROUPS = ['common', 'preferred', 'spac', 'otherStock', 'etf', 'etn', 'reitFund'];
const UNIVERSES = {
    common: ['common'],
    commonPreferred: ['common', 'preferred'],
    allStocks: ['common', 'preferred', 'spac', 'otherStock'],
    allStocksEtf: ['common', 'preferred', 'spac', 'otherStock', 'etf'],
    everything: GROUPS
};
const iso = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

function compute(lists, source) {
    const dir = SOURCES[source].dir;
    // counts[market][date][group] = [up, down, flat]
    const counts = { kospi: new Map(), kosdaq: new Map() }, missing = [], groupSizes = {};
    for (const market of ['kospi', 'kosdaq']) {
        groupSizes[market] = {};
        for (const item of lists[market]) {
            const group = groupOf(market, item);
            groupSizes[market][group] = (groupSizes[market][group] || 0) + 1;
            const file = path.join(dir, item.code + '.json.gz');
            if (!fs.existsSync(file)) { missing.push(item.code); continue; }
            const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(file))).rows;
            for (let i = 1; i < rows.length; i++) {
                const date = iso(rows[i][0]), diff = rows[i][4] - rows[i - 1][4];
                let day = counts[market].get(date); if (!day) counts[market].set(date, day = {});
                const slot = day[group] ||= [0, 0, 0];
                slot[diff > 0 ? 0 : diff < 0 ? 1 : 2]++;
            }
        }
    }
    const adr = {};
    for (const market of ['kospi', 'kosdaq']) {
        adr[market] = {};
        const dates = [...counts[market].keys()].sort();
        for (const [name, groups] of Object.entries(UNIVERSES)) {
            const daily = dates.map(date => { const day = counts[market].get(date); let up = 0, down = 0, flat = 0; for (const g of groups) if (day[g]) { up += day[g][0]; down += day[g][1]; flat += day[g][2]; } return { date, up, down, flat }; })
                .filter(d => d.up + d.down + d.flat > 0);
            const series = [];
            for (let i = WINDOW - 1; i < daily.length; i++) {
                let up = 0, down = 0; for (let k = i - WINDOW + 1; k <= i; k++) { up += daily[k].up; down += daily[k].down; }
                if (down > 0) series.push({ date: daily[i].date, adr: Math.round(up / down * 10000) / 100, up: daily[i].up, down: daily[i].down, flat: daily[i].flat });
            }
            adr[market][name] = series;
        }
    }
    return { counts, adr, missing, groupSizes };
}

function stats(ours, ref, shift = 0) {
    const refDates = ref.map(r => r.date), refBy = new Map(ref.map(r => [r.date, r.adr]));
    const oursBy = new Map(ours.map(r => [r.date, r.adr]));
    const pairs = [];
    for (let i = 0; i < refDates.length; i++) {
        const j = i + shift; if (j < 0 || j >= refDates.length) continue;
        const a = oursBy.get(refDates[j]), b = refBy.get(refDates[i]);
        if (Number.isFinite(a) && Number.isFinite(b)) pairs.push({ date: refDates[i], ours: a, jusikbot: b, diff: Math.round((a - b) * 100) / 100 });
    }
    if (!pairs.length) return { days: 0 };
    const abs = pairs.map(p => Math.abs(p.diff)).sort((x, y) => x - y), n = pairs.length;
    const mean = v => v.reduce((s, x) => s + x, 0) / v.length;
    const ma = mean(pairs.map(p => p.ours)), mb = mean(pairs.map(p => p.jusikbot));
    const cov = mean(pairs.map(p => (p.ours - ma) * (p.jusikbot - mb))), sa = Math.sqrt(mean(pairs.map(p => (p.ours - ma) ** 2))), sb = Math.sqrt(mean(pairs.map(p => (p.jusikbot - mb) ** 2)));
    const r2 = x => Math.round(x * 100) / 100;
    const byYear = {};
    for (const p of pairs) { const y = p.date.slice(0, 4); (byYear[y] ||= []).push(p); }
    return { days: n, from: pairs[0].date, to: pairs.at(-1).date, meanAbs: r2(mean(abs)), medianAbs: r2(abs[Math.floor(n / 2)]), p95Abs: r2(abs[Math.floor(n * 0.95)]),
        bias: r2(mean(pairs.map(p => p.diff))), correlation: Math.round(cov / (sa * sb) * 10000) / 10000, within1: r2(abs.filter(x => x <= 1).length / n * 100), within3: r2(abs.filter(x => x <= 3).length / n * 100),
        byYear: Object.fromEntries(Object.entries(byYear).map(([y, v]) => [y, { days: v.length, meanAbs: r2(mean(v.map(p => Math.abs(p.diff)))), bias: r2(mean(v.map(p => p.diff))) }])),
        largest: [...pairs].sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)).slice(0, 15), recent: pairs.slice(-10) };
}

(async () => {
    const started = Date.now();
    log('started', { interval, limit, computeOnly, pid: process.pid });
    try {
        const listFile = path.join(out, 'lists.json');
        const lists = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')) : { kospi: await list('0'), kosdaq: await list('10') };
        writeJson(listFile, lists);
        log('lists', { kospi: lists.kospi.length, kosdaq: lists.kosdaq.length });
        const failures = []; let stopped = null;
        if (!computeOnly) {
            collect: for (const pass of [1, 2]) {
                failures.length = 0;
                for (const source of ['krx', 'al']) for (const market of ['kospi', 'kosdaq']) {
                    const codes = limit ? lists[market].slice(0, limit) : lists[market];
                    for (let i = 0; i < codes.length; i++) {
                        if (pastUntil()) { stopped = { at: kst(Date.now()), pass, source, market, done: i, total: codes.length }; log('stopped at --until', stopped); break collect; }
                        try { await candles(codes[i].code, source); }
                        catch (e) { failures.push({ source, market, code: codes[i].code, error: String(e.message).slice(0, 120) }); }
                        if (i % 50 === 0) writeJson(path.join(out, 'progress.json'), { at: kst(Date.now()), pass, source, market, done: i, total: codes.length, calls, failures: failures.length, issued });
                    }
                }
                log('pass done', { pass, calls, failures: failures.length });
                if (!failures.length) break;
                await wait(30000);
            }
        }
        // jusikbot reference (5y is the longest range it serves).
        const jusikbot = {};
        for (const market of ['kospi', 'kosdaq']) {
            try {
                const r = await fetch(`https://jusikbot.com/api/adr/history?market=${market}&range=5y`, { signal: AbortSignal.timeout(20000) });
                jusikbot[market] = (await r.json()).series || [];
            } catch (e) { jusikbot[market] = []; log('jusikbot failed', { market, error: e.message }); }
        }
        writeJson(path.join(out, 'jusikbot-5y.json'), jusikbot);
        const computed = {}, comparison = {}, missing = {};
        for (const source of ['krx', 'al']) {
            const c = computed[source] = compute(lists, source);
            missing[source] = { count: c.missing.length, sample: c.missing.slice(0, 20) };
            writeJson(path.join(out, 'counts-' + source + '.json'), Object.fromEntries(Object.entries(c.counts).map(([m, map]) => [m, Object.fromEntries([...map].sort())])));
            writeJson(path.join(out, 'adr-' + source + '.json'), c.adr);
            comparison[source] = {};
            for (const market of ['kospi', 'kosdaq']) {
                comparison[source][market] = {};
                for (const name of Object.keys(UNIVERSES)) {
                    const ours = c.adr[market][name];
                    comparison[source][market][name] = { coverage: { from: ours[0]?.date, to: ours.at(-1)?.date, days: ours.length }, same: stats(ours, jusikbot[market]),
                        oursOneDayLater: stats(ours, jusikbot[market], 1).meanAbs, oursOneDayEarlier: stats(ours, jusikbot[market], -1).meanAbs };
                }
            }
        }
        // KRX+NXT against KRX for the same universe (KRX is the reference); NXT trading began 2025-03-04.
        const krxVsAl = {}, nxtFrom = '2025-03-04';
        for (const market of ['kospi', 'kosdaq']) {
            krxVsAl[market] = {};
            for (const name of Object.keys(UNIVERSES)) {
                const ref = computed.krx.adr[market][name], al = computed.al.adr[market][name];
                krxVsAl[market][name] = { fromNxt: stats(al.filter(r => r.date >= nxtFrom), ref.filter(r => r.date >= nxtFrom)), beforeNxt: stats(al.filter(r => r.date < nxtFrom), ref.filter(r => r.date < nxtFrom)) };
            }
        }
        const alFallback = fs.readdirSync(SOURCES.al.dir).filter(n => n.endsWith('.json.gz'))
            .filter(n => !String(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(SOURCES.al.dir, n)))).key || '').endsWith('_AL')).map(n => n.slice(0, 6));
        const result = { at: kst(Date.now()), minutes: Math.round((Date.now() - started) / 60000), calls, issued, stopped, failures, missing, groupSizes: computed.krx.groupSizes,
            alFallbackToKrx: { count: alFallback.length, sample: alFallback.slice(0, 20) },
            jusikbotDays: { kospi: jusikbot.kospi.length, kosdaq: jusikbot.kosdaq.length }, comparison, krxVsAl };
        writeJson(path.join(out, 'result.json'), result);
        writeJson(path.join(out, 'done.json'), { at: kst(Date.now()), ok: true });
        log('completed', { minutes: result.minutes, calls, failures: failures.length, missing: { krx: missing.krx.count, al: missing.al.count }, stopped: Boolean(stopped) });
    } catch (e) {
        log('failed', String(e && e.stack || e).slice(0, 500));
        writeJson(path.join(out, 'done.json'), { at: kst(Date.now()), ok: false, error: String(e.message) });
        process.exitCode = 1;
    }
})();
