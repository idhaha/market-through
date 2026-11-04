'use strict';
// Local-only check of per-stock futures investor data during one trading day. REST only, no websocket.
//  - LS t8463 (tm_rng D, fot_clsf_cd F) with bsc_asts_id 'S' + product code (A116B000 -> S11). This code
//    form is not in the LS spec list; it answered for 4 stocks on 2026-11-04 night (previous-day rows).
// Records when each 30 s row first appears (delay), whether published rows change later (revision), and
// the amount unit (implied price = amount x 1e8 / (contracts x 10) should be near the futures price).
// Usage: node dev/stock-futures-investor-live.cjs --codes 005930,000660 --until 16:20 --out outputs/stock-futures-investor-20261104
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const kstDay = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const day = kstDay(Date.now()), ymd = day.replaceAll('-', '');
const until = Date.parse(day + 'T' + arg('until', '16:20') + ':00+09:00');
const out = path.resolve(root, arg('out', 'outputs/stock-futures-investor-' + ymd));
const codes = arg('codes', '005930,000660').split(',').map(s => s.trim()).filter(Boolean);
// --previous: connectivity check outside market hours using the previous session's rows.
const previous = process.argv.includes('--previous');
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
const write = (file, v) => fs.appendFileSync(path.join(out, file), JSON.stringify({ at: kst(Date.now()), ...v }) + '\n');

let token = '', queue = Promise.resolve();
async function auth() {
    if (token) return token;
    const r = await fetch('https://openapi.ls-sec.co.kr:8080/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
        body: new URLSearchParams({ grant_type: 'client_credentials', appkey: process.env.LS_APPKEY || '', appsecretkey: process.env.LS_SECRETKEY || '', scope: 'oob' }) });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw Error('LS 토큰 발급 실패');
    return token = j.access_token;
}
function ls(tr, endpoint, input) {
    const task = queue.then(async () => {
        let last = 'LS ' + tr + ' 실패';
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt) await wait(1500 * attempt + Math.random() * 500);
            try {
                const r = await fetch('https://openapi.ls-sec.co.kr:8080/' + endpoint, { method: 'POST', signal: AbortSignal.timeout(20000),
                    headers: { authorization: 'Bearer ' + await auth(), 'Content-Type': 'application/json; charset=utf-8', tr_cd: tr, tr_cont: 'N', tr_cont_key: '' },
                    body: JSON.stringify({ [tr + 'InBlock']: input }) });
                const j = await r.json().catch(() => ({}));
                if (j.rsp_cd === '00000') return j;
                last = 'LS ' + tr + ' ' + (j.rsp_cd || r.status);
                if (r.status === 401) token = '';
            } catch (e) { last = 'LS ' + tr + ' ' + (e.name === 'TimeoutError' ? '시간 초과' : '오류'); }
        }
        throw Error(last);
    });
    queue = task.catch(() => {}).then(() => wait(1100));
    return task;
}

const fields = ['indmsvol', 'indmsamt', 'formsvol', 'formsamt', 'sysmsvol', 'sysmsamt'];
const rowKey = r => fields.map(f => r[f]).join('/');
const state = new Map(); // id -> { rows: Map(time -> {firstSeenAt, values, revisions}) }
const summary = { day, codes, ids: {}, polls: 0, errors: {}, price: {} };
async function pollStock(id) {
    const d = await ls('t8463', 'futureoption/investor', { tm_rng: 'D', fot_clsf_cd: 'F', bsc_asts_id: id, cnt: 40, bgubun: previous ? '1' : '0' });
    const rows = (d.t8463OutBlock1 || []).filter(r => previous || String(r.date) === ymd);
    const s = state.get(id), received = Date.now();
    for (const r of rows) {
        const prev = s.rows.get(r.time), values = rowKey(r);
        if (!prev) {
            const sourceAt = Date.parse(day + 'T' + r.time.slice(0, 2) + ':' + r.time.slice(2, 4) + ':' + r.time.slice(4, 6) + '+09:00');
            s.rows.set(r.time, { firstSeenAt: received, delayMs: received - sourceAt, values, revisions: 0 });
            write('t8463-rows.jsonl', { id, time: r.time, delayMs: received - sourceAt, ...Object.fromEntries(fields.map(f => [f, r[f]])) });
        } else if (prev.values !== values) {
            prev.revisions++; prev.values = values;
            write('t8463-revisions.jsonl', { id, time: r.time, ...Object.fromEntries(fields.map(f => [f, r[f]])) });
        }
    }
    s.latest = rows[0]?.time || s.latest;
}
async function futuresPrice(code) {
    // Nearest-month price from LS for the unit check (implied price vs actual).
    const f = summary.ids[code];
    if (!f?.shcode) return;
    const d = (await ls('t8402', 'futureoption/market-data', { focode: f.shcode })).t8402OutBlock;
    if (d?.price) summary.price[code] = Number(d.price);
}
function finalize(final) {
    for (const [code, info] of Object.entries(summary.ids)) {
        const s = state.get(info.id); if (!s) continue;
        const rows = [...s.rows.entries()].sort();
        const delays = rows.map(([, v]) => v.delayMs).sort((a, b) => a - b);
        const last = rows.at(-1)?.[1].values.split('/').map(Number);
        const implied = last && last[0] ? Math.abs(last[1]) * 1e8 / (Math.abs(last[0]) * 10) : null;
        Object.assign(info, { rows: rows.length, firstTime: rows[0]?.[0] || null, lastTime: rows.at(-1)?.[0] || null,
            delayMedianMs: delays[Math.floor(delays.length / 2)] ?? null, delayP95Ms: delays[Math.floor(delays.length * 0.95)] ?? null,
            revisedRows: rows.filter(([, v]) => v.revisions).length, impliedPriceFromIndividual: implied, futuresPrice: summary.price[code] ?? null });
    }
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ ...summary, writtenAt: kst(Date.now()), final }, null, 2));
}
async function main() {
    const master = (await ls('t8401', 'futureoption/market-data', { dummy: '' })).t8401OutBlock || [];
    for (const code of codes) {
        const f = master.filter(x => String(x.basecode).trim() === 'A' + code && /^A[0-9A-Z]{7}$/.test(x.shcode) && !/SP|스프레드/.test(x.hname || ''))
            .sort((a, b) => String(a.hname).localeCompare(String(b.hname)))[0];
        if (!f) { write('status.jsonl', { type: 'no_future', code }); continue; }
        const id = 'S' + f.shcode.slice(1, 3);
        summary.ids[code] = { id, shcode: f.shcode, name: String(f.hname).trim() };
        state.set(id, { rows: new Map() });
    }
    write('status.jsonl', { type: 'started', ids: summary.ids });
    let lastPrice = 0;
    while (Date.now() < until) {
        // Poll at second :20 of each minute (other LS polls use :00, :15 and :45).
        const next = Math.ceil((Date.now() - 20000) / 60000) * 60000 + 20000;
        await wait(Math.max(0, next - Date.now()));
        const clock = kst(Date.now()).slice(11, 16);
        if (!previous && (clock < '08:44' || clock > '16:15')) continue;
        summary.polls++;
        for (const { id } of Object.values(summary.ids)) {
            try { await pollStock(id); } catch (e) { summary.errors[e.message] = (summary.errors[e.message] || 0) + 1; write('status.jsonl', { type: 'error', id, message: e.message }); }
        }
        if (Date.now() - lastPrice > 600000) { lastPrice = Date.now(); for (const code of Object.keys(summary.ids)) await futuresPrice(code).catch(() => {}); }
        if (summary.polls % 10 === 0) finalize(false);
    }
    // After the close: the full day once more, to detect rows revised after publication.
    for (const { id } of Object.values(summary.ids)) {
        try {
            const d = await ls('t8463', 'futureoption/investor', { tm_rng: 'D', fot_clsf_cd: 'F', bsc_asts_id: id, cnt: 900, bgubun: previous ? '1' : '0' });
            const rows = (d.t8463OutBlock1 || []).filter(r => previous || String(r.date) === ymd);
            fs.writeFileSync(path.join(out, 'final-' + id + '.json'), JSON.stringify(rows));
            const s = state.get(id); let changed = 0, missing = 0;
            for (const r of rows) { const seen = s.rows.get(r.time); if (!seen) missing++; else if (seen.values !== rowKey(r)) changed++; }
            write('status.jsonl', { type: 'final', id, rows: rows.length, changedAfterSeen: changed, notSeenIntraday: missing });
        } catch (e) { write('status.jsonl', { type: 'final_failed', id, message: e.message }); }
    }
    finalize(true);
    write('status.jsonl', { type: 'completed' });
}
main().catch(e => { write('status.jsonl', { type: 'failed', message: String(e.message) }); process.exitCode = 1; });
