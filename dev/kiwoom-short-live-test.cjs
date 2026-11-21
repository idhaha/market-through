'use strict';
// 키움 REST 대주 실주문 시험 (사용자 요청, 1주만). dev/kiwoom-short-cover-probe.cjs의 후속.
//   --step nxt   : NXT로 대주상환(kt10006, crd_deal_tp 77) 1주 하한가 접수 → 곧바로 취소
//   --step cover : KRX로 대주상환 1주를 매도1호가+2틱 지정가로 실제 체결 → 체결 확인(30초 안에 안 되면 취소)
//   --step short : 대주매도 진입(kt10007, 문서에 없는 crd_deal_tp 후보 07→05) 1주를 현재가(업틱룰) 지정가 → 90초 안에 안 되면 취소
// 공통: --code <종목>. 결과 outputs/kiwoom-short-cover-<날짜>/live-<step>.json, 같은 폴더 log.txt. 토큰은 기록하지 않는다.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
//   --step accept --ex KRX|NXT|SOR : 하한가 대주상환 접수 → 곧바로 취소 (SOR 접수, 15:20~15:30 KRX 단일가 접수 시험에 사용)
//   --step modify                 : KRX 하한가 대주상환 접수 → kt10008로 하한가+1틱 정정 → 정정 주문 확인 → 취소
//   --step cover --ex KRX|NXT     : 그 거래소 매도1호가+2틱으로 실제 체결 (프리마켓·애프터마켓 체결 시험)
const step = args[args.indexOf('--step') + 1];
const code = (args[args.indexOf('--code') + 1] || '').replace(/^A/, '');
const exArg = args.includes('--ex') ? args[args.indexOf('--ex') + 1] : '';
if (!['nxt', 'cover', 'short', 'accept', 'modify'].includes(step) || !/^[0-9A-Z]{6}$/.test(code)) { console.error('--step nxt|accept|modify|cover|short --code <종목코드> 필요'); process.exit(2); }
const tag = step + (exArg ? '-' + exArg : '') + (args.includes('--tag') ? '-' + args[args.indexOf('--tag') + 1] : '');
const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
const outDir = path.join(root, 'outputs', `kiwoom-short-cover-${day}`);
fs.mkdirSync(outDir, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(11, 23);
const out = { step, code, at: new Date().toISOString(), steps: [], events: [] };
const save = () => fs.writeFileSync(path.join(outDir, `live-${tag}.json`), JSON.stringify(out, null, 2));
function log(msg, data) {
    const line = `[${stamp()}] live-${tag} ${msg}${data === undefined ? '' : ' ' + JSON.stringify(data)}`;
    console.log(line); fs.appendFileSync(path.join(outDir, 'log.txt'), line + '\n');
}
// 서버 토큰 파일을 쓰고, 없거나 만료가 가까우면 새로 발급해 같은 파일에 기록한다(서버도 재사용).
const tokenFile = path.join(root, 'data', 'kiwoom-token', 'token.json');
let token = '';
async function ensureToken() {
    try { const s = JSON.parse(fs.readFileSync(tokenFile, 'utf8')); if (s.token && s.expires > Date.now() + 600000) { token = s.token; return; } } catch {}
    const r = await fetch('https://api.kiwoom.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: (process.env.KIWOOM_APPKEY || '').trim(), secretkey: (process.env.KIWOOM_SECRETKEY || '').trim() }) });
    const j = await r.json().catch(() => ({}));
    if (!j.token) throw Error('키움 토큰 발급 실패: ' + (j.return_msg || r.status));
    token = j.token; log('토큰 새로 발급 (서버 토큰 파일에 기록)');
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    fs.writeFileSync(tokenFile + '.tmp', JSON.stringify({ token, expires: Date.now() + 23 * 3600000, issuedAt: Date.now() }), { mode: 0o600 }); fs.renameSync(tokenFile + '.tmp', tokenFile);
}
let lastCall = 0;
async function call(endpoint, api, body, name) {
    await wait(Math.max(0, lastCall + 1100 - Date.now())); lastCall = Date.now();
    let j;
    try {
        const r = await fetch('https://api.kiwoom.com/api/dostk/' + endpoint, { method: 'POST', signal: AbortSignal.timeout(20000),
            headers: { 'Content-Type': 'application/json;charset=UTF-8', authorization: 'Bearer ' + token, 'api-id': api }, body: JSON.stringify(body) });
        j = await r.json().catch(() => ({ parseError: r.status }));
    } catch (e) { j = { networkError: String(e.message || e) }; }
    if (name) out.steps.push({ step: name, api, request: body, response: j });
    return j;
}
const num = v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const abs = v => Math.abs(num(v));
const tick = p => p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;

async function shortLots(name) {
    const b = await call('acnt', 'kt00018', { qry_tp: '2', dmst_stex_tp: 'KRX' }, name);
    return (b.acnt_evlt_remn_indv_tot || []).filter(r => r.stk_cd.replace(/^A/, '') === code && /대주/.test(r.crd_tp_nm || ''))
        .map(r => ({ crd_tp: r.crd_tp, loan_dt: r.crd_loan_dt, qty: abs(r.rmnd_qty), able: abs(r.trde_able_qty), pur: abs(r.pur_pric), cur: abs(r.cur_prc), pl: num(r.evltv_prft) }));
}
async function quote(ex) {
    const q = await call('mrkcond', 'ka10004', { stk_cd: ex === 'NXT' ? code + '_NX' : code });
    const i = await call('stkinfo', 'ka10001', { stk_cd: ex === 'NXT' ? code + '_NX' : code });
    const base = abs(i.base_pric), lst = abs(i.lst_pric), upl = abs(i.upl_pric);
    const r = { ex, ask: abs(q.sel_fpr_bid), bid: abs(q.buy_fpr_bid), cur: abs(i.cur_prc), base,
        lower: base && lst >= base * 0.6 && lst <= base * 0.8 ? lst : Math.ceil(base * 0.7 / tick(base * 0.7)) * tick(base * 0.7),
        upper: base && upl >= base * 1.2 && upl <= base * 1.4 ? upl : Math.floor(base * 1.3 / tick(base * 1.3)) * tick(base * 1.3) };
    log('시세', r); out.quote = r; return r;
}
function realtime() {
    return new Promise(resolve => {
        let done = false; const finish = ws => { if (!done) { done = true; resolve(ws); } };
        const ws = new WebSocket('wss://api.kiwoom.com:10000/api/websocket');
        ws.on('open', () => ws.send(JSON.stringify({ trnm: 'LOGIN', token })));
        ws.on('message', raw => {
            let m; try { m = JSON.parse(String(raw)); } catch { return; }
            if (m.trnm === 'PING') return ws.send(String(raw));
            if (m.trnm === 'LOGIN') { if (m.return_code !== 0) return finish(null); return ws.send(JSON.stringify({ trnm: 'REG', grp_no: '1', refresh: '1', data: [{ item: [''], type: ['00', '04'] }] })); }
            if (m.trnm === 'REG') return finish(ws);
            if (m.trnm === 'REAL') for (const d of m.data || []) if (d.values && d.values['9001'] === code) {
                out.events.push({ at: stamp(), type: d.type, values: d.values });
                const v = d.values;
                log(`실시간 ${d.type}`, d.type === '00' ? { 상태: v['913'], 구분: v['905'], 신용: v['922'], 대출일: v['923'], 주문: v['9203'], 수량: v['900'], 가격: v['901'], 미체결: v['902'], 체결가: v['910'], 체결량: v['911'], 거부: v['919'] } : { 신용: v['917'], 대출일: v['916'], 보유: v['930'], 가능: v['933'], 매입가: v['931'] });
            }
        });
        ws.on('error', () => finish(null));
        setTimeout(() => finish(null), 15000);
    });
}
async function orderState(ordNo, ex) {
    const oso = await call('acnt', 'ka10075', { all_stk_tp: '1', trde_tp: '0', stk_cd: code, stex_tp: ex === 'NXT' ? '2' : ex === 'KRX' ? '1' : '0' });
    const prst = await call('acnt', 'kt00009', { ord_dt: '', stk_bond_tp: '0', mrkt_tp: '0', sell_tp: '0', qry_tp: '0', stk_cd: code, fr_ord_no: '', dmst_stex_tp: ex === 'SOR' ? '%' : ex });
    const o = (oso.oso || []).find(r => r.ord_no === ordNo);
    const p = (prst.acnt_ord_cntr_prst_array || []).filter(r => r.ord_no === ordNo);
    const filled = p.reduce((s, r) => s + abs(r.cntr_qty), 0);
    return { open: o ? abs(o.oso_qty) : 0, io: o ? o.io_tp_nm : p[0] && p[0].io_tp_nm, crd: p[0] && p[0].crd_deal_tp, filled, cntr_uv: p.map(r => abs(r.cntr_uv)).filter(Boolean) };
}
async function cancel(ordNo, ex, endpoint, api) {
    for (let i = 0; i < 3; i++) {
        const c = await call(endpoint, api, { dmst_stex_tp: ex, orig_ord_no: ordNo, stk_cd: code, cncl_qty: '0' }, `취소 ${i + 1}회`);
        log('취소 응답', c);
        if (c.return_code === 0) break;
        await wait(1500);
    }
    await wait(2500);
    const s = await orderState(ordNo, ex);
    out.cancelled = s.open === 0;
    log(out.cancelled ? '취소 확인: 미체결 없음' : '!!!!! 취소 실패 또는 미체결 남음 — 영웅문에서 직접 확인·취소 필요 !!!!!', s);
}

async function main() {
    // 2026-11-20 확인: 키움은 앱키당 웹소켓 하나만 허용(R10001, 새 연결이 기존 연결을 끊음) → VI 모니터를 끊지 않도록 --ws일 때만 연다.
    const ws = args.includes('--ws') ? await realtime() : null;
    log(ws ? '실시간 등록됨' : '실시간 연결 실패(조회로만 확인)');
    const before = await shortLots('잔고(시작)'); out.before = before; log('대주 잔고(시작)', before);
    if (['nxt', 'accept', 'modify', 'cover'].includes(step)) {
        const lot = before.find(l => l.able >= 1 && /^\d{8}$/.test(l.loan_dt || ''));
        if (!lot) { out.skipped = '상환 가능한 대주 잔고 없음'; log(out.skipped); return ws; }
        const ex = step === 'nxt' ? 'NXT' : step === 'modify' ? 'KRX' : (exArg || 'KRX');
        const q = await quote(ex === 'SOR' ? 'KRX' : ex);
        if (step === 'cover' && !q.ask) { out.skipped = `${ex} 매도호가 없음`; log(out.skipped); return ws; }
        let price = step === 'cover' ? Math.min(q.upper, q.ask + 2 * tick(q.ask)) : q.lower;
        if (!price) { out.skipped = '가격 계산 실패'; log(out.skipped); return ws; }
        const body = { dmst_stex_tp: ex, stk_cd: code, ord_qty: '1', ord_uv: String(price), trde_tp: '0', cond_uv: '', crd_deal_tp: '77', crd_loan_dt: lot.loan_dt };
        log('대주상환 주문 전송', body);
        const r = await call('crdordr', 'kt10006', body, '대주상환 주문');
        log('주문 응답', r); save();
        if (!r.ord_no) return ws;
        if (step === 'nxt' || step === 'accept') {
            await wait(3000);
            log('접수 상태', await orderState(r.ord_no, ex));
            await cancel(r.ord_no, ex, 'crdordr', 'kt10009');
        } else if (step === 'modify') {
            await wait(3000);
            log('원주문 상태', await orderState(r.ord_no, ex));
            const newPrice = price + tick(price);
            const m = await call('crdordr', 'kt10008', { dmst_stex_tp: ex, orig_ord_no: r.ord_no, stk_cd: code, mdfy_qty: '0', mdfy_uv: String(newPrice), mdfy_cond_uv: '' }, '대주상환 정정');
            log('정정 응답', m); save();
            const target = m.ord_no || r.ord_no;
            await wait(3000);
            const s = await orderState(target, ex); out.modified = { ord_no: m.ord_no, price: newPrice, state: s };
            log('정정 주문 상태', s);
            log('원주문 남은 수량', await orderState(r.ord_no, ex));
            await cancel(target, ex, 'crdordr', 'kt10009');
            if (!m.ord_no) await cancel(r.ord_no, ex, 'crdordr', 'kt10009');
        } else {
            let s;
            for (let i = 0; i < 10; i++) { await wait(3000); s = await orderState(r.ord_no, ex); if (s.filled >= 1) break; }
            log('체결 상태', s); out.fill = s;
            if (!(s.filled >= 1)) await cancel(r.ord_no, ex, 'crdordr', 'kt10009');
        }
    } else {
        const q = await quote('KRX');
        const price = q.cur; // 업틱룰: 직전가 이상
        for (const crd of ['07', '05']) {
            const body = { dmst_stex_tp: 'KRX', stk_cd: code, ord_qty: '1', ord_uv: String(price), trde_tp: '0', crd_deal_tp: crd, crd_loan_dt: '', cond_uv: '' };
            log(`대주매도 주문 전송 (crd_deal_tp ${crd})`, body);
            const r = await call('crdordr', 'kt10007', body, `대주매도 주문 crd_deal_tp ${crd}`);
            log('주문 응답', r); save();
            if (!r.ord_no) continue;
            await wait(2500);
            let s = await orderState(r.ord_no, 'KRX');
            log('접수 상태', s);
            if (s.filled < 1 && !/대주/.test((s.io || '') + (s.crd || ''))) { log('대주매도가 아닌 주문으로 접수됨 → 즉시 취소', s); await cancel(r.ord_no, 'KRX', 'crdordr', 'kt10009'); break; }
            for (let i = 0; i < 28 && s.filled < 1; i++) { await wait(3000); s = await orderState(r.ord_no, 'KRX'); }
            log('체결 상태', s); out.fill = s;
            if (s.filled < 1) await cancel(r.ord_no, 'KRX', 'crdordr', 'kt10009');
            break;
        }
    }
    return ws;
}

(async () => {
    log('시작');
    let ws;
    try { await ensureToken(); ws = await main(); } catch (e) { log('오류', String(e.stack || e)); process.exitCode = 1; }
    await wait(3000);
    try { out.after = await shortLots('잔고(끝)'); log('대주 잔고(끝)', out.after); } catch {}
    if (ws) ws.close();
    save(); log('끝');
})();
