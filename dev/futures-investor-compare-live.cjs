'use strict';
// 별도 발견: 한투 분봉 값과 LS 일별 값의 차이
// Records, for one futures day session, the raw KOSPI200/KOSDAQ150 futures investor flow from
//  - KIS FHPTJ04030000 (current snapshot, no source time) every minute, with contracts and amounts,
//  - LS t8463 (30 s cumulative rows) every 10 minutes and after the close,
//  - LS t8462 (daily) after the close,
// so the gap between the stored KIS minute values and the LS daily values can be explained.
// Tokens: reuses the running local server's KIS/LS tokens and never issues one.
//  - LS t8463 night rows (tm_rng N) after the night close,
// and keeps polling KIS through the evening and night to see what its snapshot covers after the day close.
// Usage: node dev/futures-investor-compare-live.cjs [--hours 21.5] [--out outputs/futures-investor-compare-YYYYMMDD]
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const kstDate = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const kstClock = t => new Date(t + 9 * 3600000).toISOString().slice(11, 19);
const today = kstDate(Date.now()).replaceAll('-', '');
const started = Date.now(), endAt = started + Number(arg('hours', '21.5')) * 3600000;
const out = path.resolve(root, arg('out', 'outputs/futures-investor-compare-' + today));
fs.mkdirSync(out, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const log = text => fs.appendFileSync(path.join(out, 'log.txt'), `${kstClock(Date.now())} ${text}\n`);
const append = (file, row) => fs.appendFileSync(path.join(out, file), JSON.stringify(row) + '\n');
const markets = [
    { name: 'KOSPI200', kis: { FID_INPUT_ISCD: 'K2I', FID_INPUT_ISCD_2: 'F001' }, ls: 'K2I' },
    { name: 'KOSDAQ150', kis: { FID_INPUT_ISCD: 'KQI', FID_INPUT_ISCD_2: 'F002' }, ls: 'KQI' }
];

function savedToken(file) {
    try { const t = JSON.parse(fs.readFileSync(path.join(root, 'data', file, 'token.json'), 'utf8')); return t.token && t.expires > Date.now() + 60000 ? t.token : ''; }
    catch { return ''; }
}
async function kis(params) {
    const token = savedToken('kis-token');
    if (!token) throw Error('로컬 서버의 한투 토큰 없음 (직접 발급하지 않음)');
    const url = new URL((process.env.EFRIEND_DOMAIN || '').trim() + '/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market');
    url.search = new URLSearchParams(params);
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { authorization: 'Bearer ' + token,
        appkey: (process.env.EFRIEND_APPKEY || '').trim(), appsecret: (process.env.EFRIEND_SECRETKEY || '').trim(),
        tr_id: 'FHPTJ04030000', custtype: 'P', 'Content-Type': 'application/json; charset=utf-8' } });
    const j = await r.json();
    if (String(j.rt_cd) !== '0') throw Error('FHPTJ04030000: ' + (j.msg1 || r.status));
    return (Array.isArray(j.output) ? j.output : [j.output])[0] || {};
}
let lsLast = 0;
async function ls(tr, endpoint, input) {
    const token = savedToken('ls-token');
    if (!token) throw Error('로컬 서버의 LS 토큰 없음 (직접 발급하지 않음)');
    for (let attempt = 0; attempt < 3; attempt++) {
        // LS allows one call per second per TR; the local server shares that budget.
        await wait(Math.max(0, lsLast + 1500 - Date.now())); lsLast = Date.now();
        const r = await fetch('https://openapi.ls-sec.co.kr:8080/futureoption/' + endpoint, { method: 'POST', signal: AbortSignal.timeout(40000),
            headers: { authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8', tr_cd: tr, tr_cont: 'N', tr_cont_key: '' },
            body: JSON.stringify({ [tr + 'InBlock']: input }) });
        const j = await r.json().catch(() => ({}));
        if (String(j.rsp_cd) === '00000') return j;
        if (attempt === 2) throw Error(`${tr}: ${j.rsp_cd || r.status} ${j.rsp_msg || ''}`);
        await wait(3000);
    }
}
const investorFields = row => Object.fromEntries(Object.entries(row).filter(([k]) => /^(prsn|frgn|orgn)_/.test(k)));

async function kisRound() {
    for (const m of markets) {
        const at = Date.now();
        try { append('kis.jsonl', { at, clock: kstClock(at), market: m.name, ...investorFields(await kis(m.kis)) }); }
        catch (e) { log(`KIS ${m.name} 실패: ${e.message}`); }
    }
}
async function lsIntraday(label) {
    for (const m of markets) {
        try {
            const j = await ls('t8463', 'investor', { tm_rng: 'D', fot_clsf_cd: 'F', bsc_asts_id: m.ls, cnt: 999, bgubun: '0' });
            fs.writeFileSync(path.join(out, `ls-t8463-${m.ls}-${label}.json`), JSON.stringify({ at: Date.now(), rows: j.t8463OutBlock1 || [] }));
        } catch (e) { log(`LS t8463 ${m.name} ${label} 실패: ${e.message}`); }
    }
}
async function lsDaily(label) {
    for (const m of markets) {
        try {
            const j = await ls('t8462', 'investor', { tm_rng: 'D', fot_clsf_cd: 'F', bsc_asts_id: m.ls, gubun2: '1', gubun3: '1', from_date: today, to_date: today });
            fs.writeFileSync(path.join(out, `ls-t8462-${m.ls}-${label}.json`), JSON.stringify({ at: Date.now(), rows: j.t8462OutBlock1 || [] }));
        } catch (e) { log(`LS t8462 ${m.name} ${label} 실패: ${e.message}`); }
    }
}

(async () => {
    log(`시작 · 종료 예정 ${kstDate(endAt)} ${kstClock(endAt)} · 결과 ${out}`);
    const afterClose = ['15:50', '16:30', '18:20'], done = new Set();
    let lastLs = '';
    for (;;) {
        const clock = kstClock(Date.now()).slice(0, 5), sameDay = kstDate(Date.now()) === kstDate(started);
        if (Date.now() >= endAt) break;
        await kisRound();
        // Intraday LS series every 10 minutes during the day session.
        if (sameDay && clock >= '08:45' && clock < '15:50' && clock.endsWith('0') && clock !== lastLs) { lastLs = clock; await lsIntraday(clock.replace(':', '')); }
        for (const mark of afterClose) if (sameDay && clock >= mark && !done.has(mark)) { done.add(mark); await lsIntraday(mark.replace(':', '')); await lsDaily(mark.replace(':', '')); }
        await wait(Math.max(1000, 60000 - Date.now() % 60000));
    }
    // Night session rows (18:00~06:00) for the same trading date.
    for (const m of markets) {
        try {
            const j = await ls('t8463', 'investor', { tm_rng: 'N', fot_clsf_cd: 'F', bsc_asts_id: m.ls, cnt: 999, bgubun: '0' });
            fs.writeFileSync(path.join(out, `ls-t8463N-${m.ls}-end.json`), JSON.stringify({ at: Date.now(), rows: j.t8463OutBlock1 || [] }));
        } catch (e) { log(`LS t8463 야간 ${m.name} 실패: ${e.message}`); }
    }
    log('종료');
})().catch(e => { log('중단: ' + e.stack); process.exitCode = 1; });
