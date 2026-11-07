'use strict';
// Follow-up checks for per-stock futures investor data (LS), outside market hours, REST only.
//  1. Other stocks: does bsc_asts_id 'S' + product code (t8401 shcode[1..2]) answer t8463 rows?
//  2. t8462 (daily): response time, and whether its latest day equals the t8463 after-close row.
//  3. Expiry: daily rows around the last expiry (second Thursday) stay continuous.
// Usage: node dev/stock-futures-investor-extra.cjs --codes 005930,000660,005380 --from 20260901 --out outputs/x
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
const codes = arg('codes', '005930,000660,005380,035420,051910,035720,068270,012330').split(',').map(s => s.trim()).filter(Boolean);
const from = arg('from', '20260901');
const out = path.resolve(root, arg('out', 'outputs/stock-futures-investor-extra-' + today));
fs.mkdirSync(out, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
let token = '', last = 0;
async function ls(tr, endpoint, input, timeoutMs = 30000) {
    // The running local server's LS token (data/ls-token/token.json); this script never issues one.
    if (!token) token = await require('./server-ls-token.cjs').serverLsToken({ waitMs: 60000 });
    // One call per 1.1 s overall keeps every TR under the LS 1 call/s limit.
    await wait(Math.max(0, last + 1100 - Date.now())); last = Date.now();
    const started = Date.now();
    const r = await fetch('https://openapi.ls-sec.co.kr:8080/' + endpoint, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8', tr_cd: tr, tr_cont: 'N', tr_cont_key: '' },
        body: JSON.stringify({ [tr + 'InBlock']: input }) });
    const j = await r.json().catch(() => ({}));
    return { ms: Date.now() - started, code: String(j.rsp_cd ?? r.status), msg: String(j.rsp_msg ?? '').slice(0, 60), data: j };
}
const fields = ['ind', 'for', 'sys', 'sto', 'inv', 'mon'];
const pick = row => Object.fromEntries(fields.flatMap(f => [[f + 'vol', Number(row[f + 'msvol'])], [f + 'amt', Number(row[f + 'msamt'])]]));
// t8462 uses numbered fields: sv_ (contracts) and sa_ (amount, 억원) per investor.
const dailyField = { ind: '08', for: '17', sys: '18', sto: '01', inv: '03', mon: '06' };
const pickDaily = row => Object.fromEntries(fields.flatMap(f => [[f + 'vol', Number(row['sv_' + dailyField[f]])], [f + 'amt', Number(row['sa_' + dailyField[f]])]]));
(async () => {
    const master = (await ls('t8401', 'futureoption/market-data', { dummy: '' })).data.t8401OutBlock || [];
    const result = { at: kst(Date.now()), stocks: [] };
    for (const code of codes) {
        const months = master.filter(x => String(x.basecode).trim() === 'A' + code && /^A[0-9A-Z]{7}$/.test(x.shcode) && !/SP|스프레드/.test(x.hname || ''));
        if (!months.length) { result.stocks.push({ code, error: 'no future in t8401' }); continue; }
        const ids = [...new Set(months.map(m => 'S' + m.shcode.slice(1, 3)))], id = ids[0];
        const entry = { code, name: String(months[0].hname).trim(), id, idsAcrossMonths: ids, months: months.map(m => m.shcode) };
        // bgubun 0 (today) is empty before the session starts; then use bgubun 1 (previous session).
        let intraday = await ls('t8463', 'futureoption/investor', { tm_rng: 'D', fot_clsf_cd: 'F', bsc_asts_id: id, cnt: 900, bgubun: '0' });
        if (!(intraday.data.t8463OutBlock1 || []).length) intraday = await ls('t8463', 'futureoption/investor', { tm_rng: 'D', fot_clsf_cd: 'F', bsc_asts_id: id, cnt: 900, bgubun: '1' });
        const rows = intraday.data.t8463OutBlock1 || [];
        const lastRow = rows.reduce((a, r) => (!a || String(r.date) + r.time > String(a.date) + a.time) ? r : a, null);
        entry.t8463 = { code: intraday.code, msg: intraday.msg, ms: intraday.ms, rows: rows.length, lastDate: lastRow?.date ?? null, lastTime: lastRow?.time ?? null };
        const daily = await ls('t8462', 'futureoption/investor', { tm_rng: 'D', fot_clsf_cd: 'F', bsc_asts_id: id, gubun2: '1', gubun3: '1', from_date: from, to_date: today }, 60000)
            .catch(e => ({ code: 'ERR', msg: e.message.slice(0, 60), ms: null, data: {} }));
        const days = (daily.data.t8462OutBlock1 || []).map(r => ({ date: String(r.date), ...pickDaily(r) })).sort((a, b) => a.date.localeCompare(b.date));
        entry.t8462 = { code: daily.code, msg: daily.msg, ms: daily.ms, days: days.length, first: days[0]?.date ?? null, last: days.at(-1)?.date ?? null };
        if (lastRow && days.length) {
            const same = days.find(d => d.date === String(lastRow.date)), after = pick(lastRow);
            entry.dailyVsAfterClose = same ? Object.fromEntries(Object.keys(after).map(k => [k, [same[k], after[k]]]).filter(([, [a, b]]) => a !== b)) : 'no daily row for ' + lastRow.date;
        }
        fs.writeFileSync(path.join(out, `daily-${id}.json`), JSON.stringify({ daily: days, intradayLast: lastRow }, null, 2));
        result.stocks.push(entry);
        console.log(JSON.stringify(entry));
    }
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result, null, 2));
})().catch(e => { console.error(e.message); process.exit(1); });
