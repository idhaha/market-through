'use strict';
// 키움 REST API 대주(대주매도 보유) 지원 확인 시험. 대주 스탑로스 기능을 만들기 전에 API로 가능한지 확인한다.
//   --query   : 잔고·주문 조회만 한다 (주문 없음). 대주 잔고가 REST 응답에 어떤 구분 코드·대출일로 나오는지 기록.
//   --order   : 장중 신용 매수주문(kt10006)에 문서에 없는 crd_deal_tp=77(대주상환)·crd_loan_dt를 넣어 1주를
//               하한가 지정가로 보낸 뒤 접수 내용(미체결·체결현황·실시간 00/04)을 기록하고 곧바로 취소한다.
//   --reserve : 신용/대출 예약 매수주문(kt03315, crd_deal_tp=77 대주상환)을 1주 하한가로 등록하고 조회한 뒤 취소한다.
// 결과: outputs/kiwoom-short-cover-<날짜>/ (query.json, order.json, reserve.json, log.txt). 토큰은 기록하지 않는다.
// 안전장치: 주문은 실행당 1건, 수량 1주, 가격은 그날 하한가(체결되면 대주 1주가 하한가에 상환되는 것뿐),
//           대주 잔고(대출일)를 찾지 못하면 주문하지 않는다. 취소 실패 시 log에 "취소 실패"를 크게 남긴다.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const mode = ['--query', '--order', '--reserve'].find(a => args.includes(a)) || '--query';
// 주문 시험은 사용자가 시험용으로 1주 대주매도한 종목(--code)만 대상으로 한다.
const onlyCode = (args[args.indexOf('--code') + 1] || '').replace(/^A/, '');
if (mode !== '--query' && !/^[0-9A-Z]{6}$/.test(onlyCode)) { console.error('주문 시험은 --code <종목코드> 가 필요합니다'); process.exit(2); }
const kst = new Date(Date.now() + 9 * 3600000);
const day = kst.toISOString().slice(0, 10).replace(/-/g, '');
const outDir = path.join(root, 'outputs', `kiwoom-short-cover-${day}`);
fs.mkdirSync(outDir, { recursive: true });
const tokenFile = path.join(root, 'data', 'kiwoom-token', 'token.json');
const wait = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(11, 23);
const logFile = path.join(outDir, 'log.txt');
function log(msg, data) {
    const line = `[${stamp()}] ${mode} ${msg}${data === undefined ? '' : ' ' + JSON.stringify(data)}`;
    console.log(line); fs.appendFileSync(logFile, line + '\n');
}

let token = '';
async function getToken(force = false) {
    if (token && !force) return token;
    if (!force) try { const s = JSON.parse(fs.readFileSync(tokenFile, 'utf8')); if (s.token && s.expires > Date.now() + 600000) { log('서버 토큰 재사용'); return token = s.token; } } catch {}
    const r = await fetch('https://api.kiwoom.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: (process.env.KIWOOM_APPKEY || '').trim(), secretkey: (process.env.KIWOOM_SECRETKEY || '').trim() }) });
    const j = await r.json().catch(() => ({}));
    if (!j.token) throw Error('키움 토큰 발급 실패: ' + (j.return_msg || r.status));
    token = j.token; log('토큰 새로 발급 (서버 토큰 파일에 기록)');
    try { fs.mkdirSync(path.dirname(tokenFile), { recursive: true }); fs.writeFileSync(tokenFile + '.tmp', JSON.stringify({ token, expires: Date.now() + 23 * 3600000, issuedAt: Date.now() }), { mode: 0o600 }); fs.renameSync(tokenFile + '.tmp', tokenFile); } catch {}
    return token;
}

// 조회용: 요청 한도 오류는 잠시 뒤 다시 시도. 주문용(retry=false)은 절대 다시 보내지 않는다.
let lastCall = 0;
async function call(endpoint, api, body, { retry = true, next = '' } = {}) {
    let tokenRetried = false;
    for (let attempt = 0; attempt < (retry ? 5 : 1); attempt++) {
        await wait(Math.max(0, lastCall + 1100 - Date.now())); lastCall = Date.now();
        let r, j;
        try {
            r = await fetch('https://api.kiwoom.com/api/dostk/' + endpoint, { method: 'POST', signal: AbortSignal.timeout(20000),
                headers: { 'Content-Type': 'application/json;charset=UTF-8', authorization: 'Bearer ' + await getToken(), 'api-id': api, 'cont-yn': next ? 'Y' : 'N', 'next-key': next },
                body: JSON.stringify(body) });
            j = await r.json().catch(() => ({ parseError: true, status: r.status }));
        } catch (e) { j = { networkError: String(e.message || e) }; }
        const msg = String(j.return_msg || '');
        if (retry && (j.return_code === 3 || /token|토큰/i.test(msg) || (r && r.status === 401)) && !tokenRetried) { tokenRetried = true; await getToken(true); attempt--; continue; }
        if (retry && (/허용된 요청|초과|1700/.test(msg) || j.networkError)) { await wait(1500 * (attempt + 1)); continue; }
        return { status: r && r.status, nextKey: r && r.headers.get('next-key'), contYn: r && r.headers.get('cont-yn'), body: j };
    }
    return { status: 0, body: { error: '재시도 한도' } };
}

const num = v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const abs = v => Math.abs(num(v));
const code6 = v => String(v || '').replace(/^A/, '').trim();
function tick(p) { // KRX 주식 호가단위 (2023.1 개편)
    return p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
}
const ceilTick = p => { const t = tick(p); return Math.ceil(p / t) * t; };

// 대주 행 판정: 문서상 crd_tp는 00(현금)·03(자기융자)만 있으므로 그 밖의 값이나 이름에 '대주'가 있으면 대주 후보.
const isShortRow = r => (r.crd_tp && !['00', '03', ''].includes(String(r.crd_tp).trim())) || /대주/.test(r.crd_tp_nm || '');

async function runQuery() {
    const out = { at: new Date().toISOString(), calls: {} };
    const keep = (name, res) => { out.calls[name] = res; log(`${name}: return_code=${res.body.return_code} ${res.body.return_msg || res.body.error || ''}`.trim()); return res.body; };
    const acct = keep('ka00001 계좌번호', await call('acnt', 'ka00001', {}));
    out.account = acct.acctNo ? String(acct.acctNo).slice(0, 4) + '****' + String(acct.acctNo).slice(-2) : null;
    for (const ex of ['KRX', 'NXT']) for (const q of ['1', '2']) keep(`kt00018 잔고 ${ex} 조회구분${q}`, await call('acnt', 'kt00018', { qry_tp: q, dmst_stex_tp: ex }));
    for (const ex of ['0', '1', '2']) keep(`ka10085 계좌수익률 거래소${ex}`, await call('acnt', 'ka10085', { stex_tp: ex }));
    for (const ex of ['KRX', 'NXT']) keep(`kt00005 체결잔고 ${ex}`, await call('acnt', 'kt00005', { dmst_stex_tp: ex }));
    keep('ka10075 미체결 통합', await call('acnt', 'ka10075', { all_stk_tp: '0', trde_tp: '0', stk_cd: '', stex_tp: '0' }));
    keep('kt00009 주문체결현황 전체', await call('acnt', 'kt00009', { ord_dt: '', stk_bond_tp: '0', mrkt_tp: '0', sell_tp: '0', qry_tp: '0', stk_cd: '', fr_ord_no: '', dmst_stex_tp: '%' }));
    for (const ex of ['KRX', 'NXT']) keep(`kt03318 예약내역 ${ex}`, await call('ordr', 'kt03318', { base_dt_tp: '0', qry_tp: '0', base_dt: '', rsrv_ord_tp: '0', dmst_stex_tp: ex }));

    // 요약: 잔고 응답에 나온 신용구분 값과 대주 후보 행
    const rows = [];
    for (const [name, res] of Object.entries(out.calls)) {
        const b = res.body || {};
        for (const list of [b.acnt_evlt_remn_indv_tot, b.acnt_prft_rt, b.stk_cntr_remn, b.result_list]) for (const r of list || []) {
            rows.push({ src: name, stk_cd: code6(r.stk_cd), stk_nm: r.stk_nm, crd_tp: r.crd_tp, crd_tp_nm: r.crd_tp_nm, loan_dt: r.crd_loan_dt || r.loan_dt, expr_dt: r.expr_dt,
                qty: r.rmnd_qty || r.cur_qty || r.setl_remn, able: r.trde_able_qty || r.clrn_alow_qty, pur: r.pur_pric || r.buy_uv, cur: r.cur_prc, pl: r.evltv_prft || r.evlt_pl, rt: r.prft_rt || r.pl_rt });
        }
    }
    const shortOrders = [];
    for (const [name, res] of Object.entries(out.calls)) for (const r of (res.body || {}).acnt_ord_cntr_prst_array || []) if (/대주/.test((r.io_tp_nm || '') + (r.crd_deal_tp || ''))) shortOrders.push({ src: name, ord_no: r.ord_no, stk_cd: code6(r.stk_cd), io_tp_nm: r.io_tp_nm, crd_deal_tp: r.crd_deal_tp, ord_qty: r.ord_qty, cntr_qty: r.cntr_qty, tm: r.cntr_tm, ex: r.dmst_stex_tp, comm: r.comm_ord_tp });
    out.summary = { shortOrders,
        crdTpValues: [...new Set(rows.map(r => `${r.crd_tp}|${r.crd_tp_nm || ''}`))],
        totShortAmt: Object.fromEntries(Object.entries(out.calls).filter(([, v]) => v.body && (v.body.tot_crd_ls_amt !== undefined || v.body.crd_loan_ls_tot !== undefined))
            .map(([k, v]) => [k, v.body.tot_crd_ls_amt ?? v.body.crd_loan_ls_tot])),
        rows, shortRows: rows.filter(isShortRow),
    };
    log('신용구분 값', out.summary.crdTpValues);
    log('총대주금액', out.summary.totShortAmt);
    log(`대주 주문 기록 ${shortOrders.length}건`, shortOrders.map(r => `${r.stk_cd}/${r.io_tp_nm}/${r.crd_deal_tp}/${r.tm}`));
    log(`대주 후보 행 ${out.summary.shortRows.length}건`, out.summary.shortRows.map(r => `${r.src}:${r.stk_cd}/${r.crd_tp}/${r.loan_dt}/${r.qty}/${r.able}`));
    fs.writeFileSync(path.join(outDir, `query-${stamp().replace(/[:.]/g, '')}.json`), JSON.stringify(out, null, 2));
    return out;
}

// 대주 후보 중 시험 대상 하나: 가능수량이 1 이상인 첫 행
function pickShort(q) {
    const c = q.summary.shortRows.filter(r => r.stk_cd === onlyCode && abs(r.able || r.qty) >= 1 && /^\d{8}$/.test(String(r.loan_dt || '')) && r.loan_dt !== '00000000');
    return c[0] || null;
}
async function lowerLimit(code) {
    const b = (await call('stkinfo', 'ka10001', { stk_cd: code })).body;
    const base = abs(b.base_pric), lst = abs(b.lst_pric), cur = abs(b.cur_prc);
    // 하한가 칸이 기준가의 60~80% 범위면 그대로, 아니면 기준가×0.7을 호가단위로 올림
    const price = base && lst >= base * 0.6 && lst <= base * 0.8 ? lst : base ? ceilTick(base * 0.7) : 0;
    log('시세', { code, base, lst, cur, price });
    return { price, base, cur };
}

function openRealtime(events) {
    return new Promise(resolve => {
        let done = false; const finish = ws => { if (!done) { done = true; resolve(ws); } };
        const ws = new WebSocket('wss://api.kiwoom.com:10000/api/websocket');
        ws.on('open', () => ws.send(JSON.stringify({ trnm: 'LOGIN', token })));
        ws.on('message', raw => {
            let m; try { m = JSON.parse(String(raw)); } catch { return; }
            if (m.trnm === 'PING') { ws.send(String(raw)); return; }
            if (m.trnm === 'LOGIN') {
                log('실시간 로그인', { code: m.return_code, msg: m.return_msg });
                if (m.return_code !== 0) return finish(null);
                ws.send(JSON.stringify({ trnm: 'REG', grp_no: '1', refresh: '1', data: [{ item: [''], type: ['00', '04'] }] }));
                return;
            }
            if (m.trnm === 'REG') { log('실시간 등록', { code: m.return_code, msg: m.return_msg }); return finish(ws); }
            if (m.trnm === 'REAL') for (const d of m.data || []) { events.push({ at: stamp(), type: d.type, values: d.values }); log(`실시간 ${d.type}`, d.values); }
        });
        ws.on('error', e => { log('실시간 오류', String(e.message || e)); finish(null); });
        setTimeout(() => finish(null), 15000);
    });
}

async function runOrder() {
    const q = await runQuery();
    const target = pickShort(q);
    const out = { at: new Date().toISOString(), target, steps: [] };
    const save = () => fs.writeFileSync(path.join(outDir, 'order.json'), JSON.stringify(out, null, 2));
    if (!target) { out.skipped = '대주 잔고(대출일·가능수량)를 REST 응답에서 찾지 못해 주문하지 않음'; log(out.skipped); save(); return; }
    const { price } = await lowerLimit(target.stk_cd);
    if (!price) { out.skipped = '하한가 계산 실패로 주문하지 않음'; log(out.skipped); save(); return; }
    out.events = [];
    const ws = await openRealtime(out.events);
    const body = { dmst_stex_tp: 'KRX', stk_cd: target.stk_cd, ord_qty: '1', ord_uv: String(price), trde_tp: '0', cond_uv: '', crd_deal_tp: '77', crd_loan_dt: target.loan_dt };
    log('주문 전송 kt10006', body);
    const res = await call('crdordr', 'kt10006', body, { retry: false });
    out.steps.push({ step: 'kt10006 대주상환(77) 1주 하한가', request: body, response: res });
    log('주문 응답', res.body); save();
    const ordNo = res.body && res.body.ord_no;
    if (ordNo) {
        await wait(3000);
        const oso = await call('acnt', 'ka10075', { all_stk_tp: '1', trde_tp: '0', stk_cd: target.stk_cd, stex_tp: '0' });
        out.steps.push({ step: 'ka10075 미체결(주문구분 io_tp_nm 확인)', response: oso });
        const mine = (oso.body.oso || []).filter(r => r.ord_no === ordNo);
        log('미체결의 이 주문', mine.map(r => ({ io_tp_nm: r.io_tp_nm, trde_tp: r.trde_tp, ord_stt: r.ord_stt, oso_qty: r.oso_qty })));
        const prst = await call('acnt', 'kt00009', { ord_dt: '', stk_bond_tp: '0', mrkt_tp: '0', sell_tp: '2', qry_tp: '0', stk_cd: target.stk_cd, fr_ord_no: '', dmst_stex_tp: '%' });
        out.steps.push({ step: 'kt00009 주문체결현황(crd_deal_tp 확인)', response: prst });
        log('체결현황의 이 주문', (prst.body.acnt_ord_cntr_prst_array || []).filter(r => r.ord_no === ordNo).map(r => ({ io_tp_nm: r.io_tp_nm, crd_deal_tp: r.crd_deal_tp, acpt_tp: r.acpt_tp, cntr_qty: r.cntr_qty })));
        save();
        // 취소: 남은 수량 전부. 실패하면 다시 시도(취소는 중복돼도 해가 없음).
        let cancelled = false;
        for (let i = 0; i < 3 && !cancelled; i++) {
            const c = await call('crdordr', 'kt10009', { dmst_stex_tp: 'KRX', orig_ord_no: ordNo, stk_cd: target.stk_cd, cncl_qty: '0' }, { retry: false });
            out.steps.push({ step: `kt10009 취소 ${i + 1}회`, response: c });
            log('취소 응답', c.body);
            cancelled = c.body.return_code === 0;
            if (!cancelled) await wait(2000);
        }
        await wait(3000);
        const after = await call('acnt', 'ka10075', { all_stk_tp: '1', trde_tp: '0', stk_cd: target.stk_cd, stex_tp: '0' });
        const left = (after.body.oso || []).filter(r => r.ord_no === ordNo || r.orig_ord_no === ordNo);
        out.steps.push({ step: 'ka10075 취소 뒤 미체결', response: after });
        out.cancelled = cancelled && !left.some(r => num(r.oso_qty) > 0);
        log(out.cancelled ? '취소 확인: 남은 미체결 없음' : '!!!!! 취소 실패 또는 미체결 남음 — 영웅문에서 직접 확인·취소 필요 !!!!!', left);
    }
    await wait(2000);
    if (ws) ws.close();
    save();
}

function nextBusinessDay(yyyymmdd) { // 주말만 건너뜀(공휴일은 응답의 rgst_dt를 우선 사용)
    const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6)));
    do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()));
    return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function runReserve() {
    const q = await runQuery();
    // 예약 등록은 잔고를 확인하지 않으므로, 잔고가 없을 때는 --loan-dt로 받은 대출일로 접수·취소만 확인한다(다음 날 실행돼도 잔고 없음으로 거부).
    const loanArg = args.includes('--loan-dt') ? args[args.indexOf('--loan-dt') + 1] : '';
    const target = pickShort(q) || (/^d{8}$/.test(loanArg) ? { stk_cd: onlyCode, loan_dt: loanArg, note: '잔고 없음, 지정 대출일 사용' } : null);
    const out = { at: new Date().toISOString(), target, steps: [] };
    const save = () => fs.writeFileSync(path.join(outDir, 'reserve.json'), JSON.stringify(out, null, 2));
    if (!target) { out.skipped = '대주 잔고(대출일·가능수량)를 REST 응답에서 찾지 못해 예약하지 않음'; log(out.skipped); save(); return; }
    const { price } = await lowerLimit(target.stk_cd);
    if (!price) { out.skipped = '하한가 계산 실패로 예약하지 않음'; log(out.skipped); save(); return; }
    const ordDt = nextBusinessDay(day);
    const body = { rsrv_ord_tp: '1', trde_tp: '00', crd_deal_tp: '77', crd_loan_dt: target.loan_dt, stk_cd: target.stk_cd, ord_qty: '1', ord_uv: String(price), strt_dt: ordDt, end_dt: ordDt, dmst_stex_tp: 'KRX' };
    log('예약 전송 kt03315', body);
    const res = await call('ordr', 'kt03315', body, { retry: false });
    out.steps.push({ step: 'kt03315 대주상환 예약 1주', request: body, response: res });
    log('예약 응답', res.body); save();
    if (res.body.return_code !== 0 || !res.body.rgst_seq) return;
    const list = await call('ordr', 'kt03318', { base_dt_tp: '1', qry_tp: '0', base_dt: res.body.rgst_dt || '', rsrv_ord_tp: '0', dmst_stex_tp: 'KRX' });
    out.steps.push({ step: 'kt03318 예약내역', response: list });
    const mine = (list.body.result_list || []).filter(r => String(r.rgst_seq).replace(/^0+/, '') === String(res.body.rgst_seq).replace(/^0+/, ''));
    log('예약내역의 이 주문', mine);
    let cancelled = false;
    for (const ordDate of [...new Set([ordDt, res.body.rgst_dt].filter(Boolean))]) {
        const c = await call('ordr', 'kt03313', { ord_dt: ordDate, rgst_dt: res.body.rgst_dt, rgst_seq: res.body.rgst_seq, rsrv_ord_tp: '1' }, { retry: false });
        out.steps.push({ step: `kt03313 예약 취소 (ord_dt ${ordDate})`, response: c });
        log('예약 취소 응답', c.body);
        if (c.body.return_code === 0) { cancelled = true; break; }
    }
    const after = await call('ordr', 'kt03318', { base_dt_tp: '1', qry_tp: '1', base_dt: res.body.rgst_dt || '', rsrv_ord_tp: '0', dmst_stex_tp: 'KRX' });
    out.steps.push({ step: 'kt03318 취소 뒤 미처리 예약', response: after });
    const left = (after.body.result_list || []).filter(r => String(r.rgst_seq).replace(/^0+/, '') === String(res.body.rgst_seq).replace(/^0+/, ''));
    out.cancelled = cancelled && !left.length;
    log(out.cancelled ? '예약 취소 확인' : '!!!!! 예약 취소 실패 — 영웅문 예약주문 화면에서 직접 취소 필요 !!!!!', left);
    save();
}

(async () => {
    log('시작');
    try {
        if (mode === '--order') await runOrder();
        else if (mode === '--reserve') await runReserve();
        else await runQuery();
        log('끝');
    } catch (e) { log('오류', String(e.stack || e)); process.exitCode = 1; }
})();
