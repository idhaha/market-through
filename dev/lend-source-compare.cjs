'use strict';
// 대주 목록 원천 비교 (local only, scheduled 2026-11-09 09:10). Same moment, three sources:
//  - Kiwoom ka10030 crd_tp 8 (신용대주 대상 종목, no quantity; includes price and change rate), by continuation.
//  - NH shortSellableQuantity (유통대주 사용가능수량), by continuation (150 rows per call). Returned nothing on a
//    Sunday (13578 "조회할 내역이 없습니다"), so it is checked on a trading day.
//  - KIS: master lendable flag + CTSC2702R per code (the current table's source).
// Tokens: Kiwoom data/kiwoom-token (issued and written back only when missing/expired), KIS data/kis-token and
// NH data/nh-plug are used only when still valid (a new NH token sends an NH security notice; KIS is shared
// with the server), otherwise that source is skipped and recorded.
// Usage: node dev/lend-source-compare.cjs --out outputs/lend-compare-20261109
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path');
const axios = require('axios');
const { loadStockCodes } = require('../lendable-stocks');
const { isCommonStock } = require('../breadth-universe');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const out = path.resolve(root, arg('out', 'outputs/lend-compare-' + kst(Date.now()).slice(0, 10).replaceAll('-', '')));
fs.mkdirSync(out, { recursive: true });
const log = (msg, extra) => fs.appendFileSync(path.join(out, 'run.log'), `[${kst(Date.now())}] ${msg}${extra === undefined ? '' : ' ' + JSON.stringify(extra)}\n`);
const wait = ms => new Promise(r => setTimeout(r, ms));
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

async function kiwoomToken() {
    const file = path.join(root, 'data', 'kiwoom-token', 'token.json'), saved = readJson(file);
    if (saved?.token && saved.expires > Date.now() + 600000) return saved.token;
    const r = await fetch('https://api.kiwoom.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: (process.env.KIWOOM_APPKEY || '').trim(), secretkey: (process.env.KIWOOM_SECRETKEY || '').trim() }) });
    const j = await r.json().catch(() => ({}));
    if (!j.token) throw Error('키움 토큰 발급 실패');
    log('kiwoom token issued');
    fs.writeFileSync(file + '.tmp', JSON.stringify({ token: j.token, expires: Date.now() + 23 * 3600000, issuedAt: Date.now() }), { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
    return j.token;
}
async function kiwoomLend(stex) {
    const token = await kiwoomToken(), rows = []; let next = '', pages = 0;
    const body = { mrkt_tp: '000', sort_tp: '1', mang_stk_incls: '0', crd_tp: '8', trde_qty_tp: '0', pric_tp: '0', trde_prica_tp: '0', mrkt_open_tp: '0', stex_tp: stex };
    for (; pages < 60;) {
        const r = await fetch('https://api.kiwoom.com/api/dostk/rkinfo', { method: 'POST', signal: AbortSignal.timeout(20000),
            headers: { 'Content-Type': 'application/json;charset=UTF-8', authorization: 'Bearer ' + token, 'api-id': 'ka10030', 'cont-yn': next ? 'Y' : 'N', 'next-key': next }, body: JSON.stringify(body) });
        const j = await r.json(); pages++;
        if (Number(j.return_code) !== 0) throw Error('ka10030 ' + j.return_code + ' ' + j.return_msg);
        rows.push(...(j.tdy_trde_qty_upper || []));
        if (r.headers.get('cont-yn') !== 'Y' || !r.headers.get('next-key')) break;
        next = r.headers.get('next-key'); await wait(400);
    }
    return { pages, rows: rows.map(x => ({ code: String(x.stk_cd).replace(/_AL|_NX/, ''), name: x.stk_nm, price: Math.abs(Number(x.cur_prc)), rate: Number(x.flu_rt), volume: Number(x.trde_qty) })) };
}
async function nhLend() {
    const saved = readJson(path.join(root, 'data', 'nh-plug', 'token.json'));
    if (!(saved?.token && saved.expiresAt > Date.now() + 600000)) return { skipped: 'NH 토큰 파일이 없거나 만료 (새 발급은 NH 보안 알림이 가므로 하지 않음)' };
    const appKey = (process.env.NAMU_APPKEY || '').trim(), secretKey = (process.env.NAMU_SECRETKEY || '').trim();
    const rows = [], pages = []; let cts = '';
    for (let page = 0; page < 40; page++) {
        const headers = { 'content-type': 'application/json; charset=utf-8', authorization: 'Bearer ' + saved.token, 'x-client-id': appKey, 'x-client-secret': secretKey };
        if (cts) { headers.cts = cts; headers.cts_flag = 'Y'; }
        const r = await fetch('https://api.nhplug.com:8443/krstock/inquiry/v1/shortSellableQuantity', { method: 'POST', signal: AbortSignal.timeout(15000), headers, body: JSON.stringify({ Input_0: { iem_cd: '' } }) });
        const d = await r.json().catch(() => ({}));
        const list = Array.isArray(d.Output_0) ? d.Output_0 : [];
        pages.push({ status: r.status, rsp: d.rsp_cd, msg: d.rsp_msg, rows: list.length, flag: r.headers.get('cts_flag'), first: list[0]?.iem_cd, last: list.at(-1)?.iem_cd });
        rows.push(...list);
        if (r.headers.get('cts_flag') !== 'Y' || !r.headers.get('cts') || !list.length) break;
        cts = r.headers.get('cts'); await wait(300);
    }
    return { pages, rows: rows.map(x => ({ code: String(x.iem_cd).trim(), name: String(x.iem_nm || '').trim(), qty: Number(x.cln_slo_use_pbl_qty) || 0 })) };
}
async function kisLend() {
    const saved = readJson(path.join(root, 'data', 'kis-token', 'token.json'));
    if (!(saved?.token && saved.expires > Date.now() + 600000)) return { skipped: '한투 토큰 파일이 없거나 만료 (서버와 같이 쓰므로 새로 발급하지 않음)' };
    const domain = process.env.EFRIEND_DOMAIN.trim(), appkey = process.env.EFRIEND_APPKEY.trim(), appsecret = process.env.EFRIEND_SECRETKEY.trim();
    const master = await loadStockCodes(axios), rows = [], failed = [];
    for (const code of master) {
        await wait(200);
        try {
            const r = await axios.get(`${domain}/uapi/domestic-stock/v1/quotations/lendable-by-company`, { timeout: 10000,
                headers: { 'content-type': 'application/json; charset=utf-8', authorization: 'Bearer ' + saved.token, appkey, appsecret, tr_id: 'CTSC2702R', custtype: 'P', tr_cont: '' },
                params: { EXCG_DVSN_CD: '00', PDNO: code, THCO_STLN_PSBL_YN: 'Y', INQR_DVSN_1: '0', CTX_AREA_FK200: '', CTX_AREA_NK100: '' } });
            const d = r.data || {};
            if (d.rt_cd != null && String(d.rt_cd) !== '0') throw Error(d.msg_cd + ' ' + d.msg1);
            for (const x of d.output1 || d.output || []) if (String(x.pdno || '').trim() === code) rows.push({ code, name: String(x.prdt_name || '').trim(), qty: Number(x.trad_psbl_qty2) || 0 });
        } catch (e) { failed.push(code + ' ' + String(e.message).slice(0, 60)); }
    }
    return { masterFlagged: master.length, failed, rows };
}

(async () => {
    log('started');
    const result = { at: kst(Date.now()) };
    for (const [name, task] of [['kiwoom', () => kiwoomLend('3')], ['nh', nhLend], ['kis', kisLend]]) {
        try { result[name] = await task(); log(name + ' done', { rows: result[name].rows?.length, skipped: result[name].skipped }); }
        catch (e) { result[name] = { error: e.message }; log(name + ' failed', e.message); }
    }
    fs.writeFileSync(path.join(out, 'raw.json'), JSON.stringify(result, null, 1));
    // Overlap on positive quantities (Kiwoom has no quantity: every listed code counts).
    const lists = readJson(path.join(root, 'outputs', 'breadth-backfill-20261108', 'lists.json')) || { kospi: [], kosdaq: [] };
    const kind = new Map();
    for (const m of ['kospi', 'kosdaq']) for (const it of lists[m]) kind.set(it.code, m + ' ' + (isCommonStock(it, m) ? '보통주' : String(it.marketCode) === '8' ? 'ETF' : ['60', '70', '90'].includes(String(it.marketCode)) ? 'ETN' : /스팩/.test(it.name) ? '스팩' : it.code.endsWith('0') ? '기타' : '우선주'));
    const set = (rows, positive) => new Set((rows || []).filter(r => !positive || r.qty > 0).map(r => r.code));
    const kw = set(result.kiwoom.rows), nh = set(result.nh.rows, true), kis = set(result.kis.rows, true);
    const both = (a, b) => [...a].filter(x => b.has(x)), only = (a, b) => [...a].filter(x => !b.has(x));
    const byKind = s => [...s].reduce((o, c) => { const k = kind.get(c) || '?'; o[k] = (o[k] || 0) + 1; return o; }, {});
    const nameOf = c => (result.nh.rows || []).concat(result.kis.rows || [], result.kiwoom.rows || []).find(r => r.code === c)?.name || '';
    const qty = (rows, c) => (rows || []).find(r => r.code === c)?.qty;
    const summary = {
        at: result.at, kiwoom: { count: kw.size, pages: result.kiwoom.pages, byKind: byKind(kw), error: result.kiwoom.error },
        nh: { count: nh.size, rows: result.nh.rows?.length, pages: result.nh.pages, byKind: byKind(nh), skipped: result.nh.skipped, error: result.nh.error },
        kis: { count: kis.size, masterFlagged: result.kis.masterFlagged, failed: result.kis.failed?.length, byKind: byKind(kis), skipped: result.kis.skipped, error: result.kis.error },
        overlap: { nh_kiwoom: both(nh, kw).length, nh_kis: both(nh, kis).length, kis_kiwoom: both(kis, kw).length, all3: both(both(nh, kis), kw).length,
            nhNotInKiwoom: only(nh, kw).map(c => c + ' ' + nameOf(c)), kisNotInKiwoom: only(kis, kw).map(c => c + ' ' + nameOf(c)),
            nhOnlyVsKis: only(nh, kis).length, kisOnlyVsNh: only(kis, nh).length, kiwoomCoveredByNhOrKis: kw.size ? [...kw].filter(c => nh.has(c) || kis.has(c)).length : 0 },
        quantitySample: both(nh, kis).slice(0, 30).map(c => ({ code: c, name: nameOf(c), nh: qty(result.nh.rows, c), kis: qty(result.kis.rows, c) }))
    };
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
    log('completed', { kiwoom: kw.size, nh: nh.size, kis: kis.size });
})().catch(e => { log('failed', String(e && e.stack || e).slice(0, 400)); process.exitCode = 1; });
