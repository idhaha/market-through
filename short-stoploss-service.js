'use strict';
// 키움 대주 StopLoss (2026-11-19, 정책 docs/KIWOOM_SHORT_STOPLOSS.md)
//  - 대주(대주매도 보유분)가 감시가 이상으로 오르면 대주상환(kt10006, crd_deal_tp "77", 공식 명세에 없는 값)을 자동으로 낸다.
//  - 감시 단위: 잔고의 한 행(종목 + 대출일). 시세는 키움 ka10001을 감시 종목마다 1초 간격으로 조회한다
//    (VI 모니터가 같은 앱키로 키움 웹소켓을 쓰므로 두 번째 웹소켓을 열지 않는다).
//  - 주문은 SHORT_STOPLOSS=on인 서버에서만 낸다(enabled()). 꺼져 있으면 잔고 · 감시 조건만 다룬다.
//  - 발동은 한 번만: 주문 전에 "발동"을 파일에 먼저 쓰고, 재시작 뒤에는 같은 건을 다시 발동하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ACTIVE = new Set(['발동', '주문접수', '정정중', '미체결']);
const ENDED = new Set(['체결완료', '부분체결', '실패', '만료', '잔고없음', '확인 필요']);
const kstParts = t => { const d = new Date(t + 9 * 3600000); return { day: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), weekday: d.getUTCDay(), time: d.toISOString().slice(11, 19) }; };
const num = v => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const abs = v => Math.abs(num(v));
const code6 = v => String(v || '').replace(/^A/, '').replace(/_(NX|AL)$/, '').trim();
const ymd = s => String(s || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');

// KRX 주식 호가단위(2023-01 개편). ETF · ETN은 다르므로 1차 범위에서 제외(화면에서 막지 않지만 문서에 적음).
function tick(p) { return p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000; }
function addTicks(price, n) { let p = price; for (let i = 0; i < n; i++) p += tick(p); return p; }
function floorTick(p) { const t = tick(p); return Math.floor(p / t) * t; }
// 호가단위로 올림(가격대 경계를 넘으면 위 가격대의 단위로 다시 올림)
function ceilTick(p) { const t = tick(p), c = Math.ceil(p / t) * t; return tick(c) === t ? c : Math.ceil(p / tick(c)) * tick(c); }
// 청산 조건(2026-11-28 사용자 결정, docs/KIWOOM_SHORT_STOPLOSS.md): 손절(현재가 ≥ 감시가) · 익절 목표가(현재가 ≤ 목표가) · 익절 트레일링(N분봉 종가 ≥ M이평).
// 켠 것 중 먼저 맞는 쪽으로 같은 주문 방식(체결가 +틱 지정가 · 추격 정정)으로 상환한다. 각자 자기 조건만 본다(손절을 끄면 오르는 쪽은 아무도 안 봄).
// 예전 건(2026-11-28 이전)은 stopOn이 없어 손절 · 원만 켠 건으로 본다.
const stopActive = w => w.stopOn !== false && w.trigger > 0;
const targetActive = w => !!(w.profitOn && w.targetOn && w.target > 0);
const trailActive = w => !!(w.profitOn && w.trailOn && w.trailMin > 0 && w.trailMa > 0);
const TRAIL_MINUTES = [1, 3, 5, 10, 15, 30, 60];
const won = n => Number(n || 0).toLocaleString('ko-KR');
// 판정 문구: 손절만 켠 건은 예전과 같은 "KRX 7,290 < 7,300"
function condText(w, hi, lo = hi) {
    const parts = [];
    if (stopActive(w)) parts.push(`${hi >= w.trigger ? '≥' : '<'} ${won(w.trigger)}`);
    if (targetActive(w)) parts.push(`목표 ${lo <= w.target ? '≤' : '>'} ${won(w.target)}`);
    return parts.join(' · ');
}
// 키움 ka10080 분봉 행 → [{ t(봉 시작 ms), close }] 오래된 것부터. cntr_tm은 봉 시작 시각(docs/CONCENTRATION_CHART.md)
function minuteBars(rows) {
    return (Array.isArray(rows) ? rows : []).map(r => {
        const c = String(r.cntr_tm || '');
        return { t: /^\d{14}$/.test(c) ? Date.parse(`${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}T${c.slice(8, 10)}:${c.slice(10, 12)}:${c.slice(12, 14)}+09:00`) : NaN, close: Math.abs(Number(String(r.cur_prc || '').replace(/[^0-9.-]/g, '')) || 0) };
    }).filter(b => Number.isFinite(b.t) && b.close > 0).sort((a, b) => a.t - b.t);
}
// 추격 한도 가격: 발동가 × (1 + %)를 호가단위로 내림, 상한가 이하.
function chaseCap(firePrice, pct, upper) { const cap = floorTick(firePrice * (1 + pct / 100)); return upper ? Math.min(upper, cap) : cap; }
// 정정 차례별 가격(1회: 매도1호가 + N틱, 2회: + 2N틱, 3회: 한도). 항상 한도 이하.
function repriceFor(attempt, ask, ticks, cap) {
    if (attempt >= 3 || !ask) return cap;
    return Math.min(cap, addTicks(ask, attempt === 1 ? ticks : ticks * 2));
}
// 시간대별 주문 거래소(평일, 특수일 시간표는 아직 반영하지 않음).
function segmentAt(t, openDate) {
    const { day, minutes: m, weekday } = kstParts(t);
    if (weekday === 0 || weekday === 6) return null;
    if (openDate && openDate(day) === false) return null;
    if (m >= 480 && m < 530) return { id: 'NXT_PRE', ex: 'NXT', label: 'NXT 프리마켓' };
    if (m >= 530 && m < 540) return { id: 'HOLD', ex: null, label: '보류(08:50~09:00)' };
    // dual: KRX · NXT 체결을 모두 판정하고 NXT 거래 종목은 SOR로 낸다. auction: 단일가(체결 없음) → 예상체결가로 판정, 1초 조회, 정정 안 함
    if (m >= 540 && m < 920) return { id: 'KRX', ex: 'KRX', dual: true, label: 'KRX 정규장' };
    if (m >= 920 && m < 930) return { id: 'KRX_CLOSE', ex: 'KRX', auction: true, label: 'KRX 종가 단일가' };
    // 2026-09-14 개편 뒤 장 마감 이후(2026-11-24 실계좌 접수 시험, outputs/kiwoom-short-cover-20261124):
    // 15:30~15:40 NXT 애프터 단일가 — NXT 대주상환 접수됨(15:40 체결), 사용자 결정으로 미리 접수
    // 15:40~16:00 KRX는 "장종료되었습니다" 거부 → NXT만
    // 16:00~20:00 KRX · NXT 애프터마켓 — KRX · SOR 모두 접수됨 → NXT 거래 종목은 SOR, 비대상은 KRX
    if (m >= 930 && m < 940) return { id: 'NXT_SINGLE', ex: 'NXT', auction: true, label: 'NXT 애프터 단일가(15:40 체결)' };
    if (m >= 940 && m < 960) return { id: 'NXT_AFTER', ex: 'NXT', label: 'NXT 애프터마켓' };
    if (m >= 960 && m < 1200) return { id: 'AFTER', ex: 'KRX', dual: true, label: 'KRX · NXT 애프터마켓' };
    return null;
}
// 유효기간 자동 조정: 만기일 이후 → 만기일, 오늘 이전 → 오늘, 휴장일 → 직전 거래일.
function adjustUntil(value, { today, maturity, openDate }) {
    const notes = [];
    let s = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
    if (maturity && s > maturity) { s = maturity; notes.push(`대주 만기일(${maturity}) 이후라 만기일로 맞췄습니다`); }
    if (s < today) { s = today; notes.push('오늘 이전이라 오늘로 맞췄습니다'); }
    const isOpen = d => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w !== 0 && w !== 6 && (!openDate || openDate(d) !== false); };
    if (!isOpen(s)) {
        const original = s; let d = new Date(s + 'T00:00:00Z'), guard = 0;
        do { d.setUTCDate(d.getUTCDate() - 1); } while (!isOpen(d.toISOString().slice(0, 10)) && ++guard < 30);
        s = d.toISOString().slice(0, 10); notes.push(`휴장일(${original})이라 직전 거래일 ${s}로 맞췄습니다`);
    }
    return { value: s, note: notes.join(' · ') };
}
function addMonth(day) { const d = new Date(day + 'T00:00:00Z'); const m = d.getUTCMonth(); d.setUTCMonth(m + 1); if (d.getUTCMonth() !== (m + 1) % 12) d.setUTCDate(0); return d.toISOString().slice(0, 10); }

// realtime: VI 모니터의 공용 키움 웹소켓(vi-monitor-service sharedRealtime). 있으면 0B(체결)로 바로 판정하고 조회는 5초 간격 보조로 줄인다.
function createShortStopLoss({ directory, http, getToken, rejectToken = () => {}, enabled = () => false, openDate = () => null, now = Date.now, log = () => {}, wait = ms => new Promise(r => setTimeout(r, ms)), tickMs = 1000, balanceMs = 30000, realtime = null, testCodes = () => [], realtimeLogMs = 30000, rtGroups = { quote: '3', account: '4' } }) {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'state.json');
    let state = { watches: [], halted: false, haltedReason: '', haltedAt: 0 };
    try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(saved.watches)) state = { ...state, ...saved }; } catch {}
    let account = null, lots = [], lotsAt = 0, lotsError = '', viewedAt = 0, timer = null, ticking = false;
    const nxtCache = new Map(), running = new Set();
    // ---- 공용 실시간(0B 체결 · 00 주문체결 · 04 잔고) ----
    let rtItems = null, rtAccount = false, rtCounts = {}, rtOrders = [], rtLogAt = 0, lastPollAt = 0;
    function syncRealtime() {
        if (!realtime) return;
        const items = [];
        for (const w of state.watches) if (w.status === '감시중' && w.enabled) { items.push(w.code); if (w.nxt) items.push(w.code + '_NX'); }
        for (const c of testCodes()) if (/^[0-9A-Z]{6}$/.test(c)) items.push(c, c + '_NX');
        const key = [...new Set(items)].sort().join(',');
        if (key !== rtItems) { rtItems = key; try { realtime.set(rtGroups.quote, key ? key.split(',') : [], ['0B']); } catch (e) { log('대주 StopLoss 실시간 등록 오류: ' + e.message); } }
        if (!rtAccount && rtGroups.account && enabled()) { rtAccount = true; try { realtime.set(rtGroups.account, [''], ['00', '04']); } catch (e) { log('대주 StopLoss 실시간 등록 오류: ' + e.message); } }
    }
    function onReal(d) {
        const type = String(d.type || ''), item = String(d.item || ''), v = d.values || {};
        // 공용 웹소켓은 VI 모니터 앱키(첫 계좌)의 연결이라 00 · 04는 그 계좌 것만 온다. 다른 계좌(rtGroups.account 없음)는 무시하고 조회로 확인한다.
        if ((type === '00' || type === '04') && !rtGroups.account) return;
        (rtCounts[type] = rtCounts[type] || {})[item || '-'] = (rtCounts[type][item || '-'] || 0) + 1;
        if (type === '00') {
            rtOrders.push({ at: now(), 주문번호: v['9203'], 종목: v['9001'], 상태: v['913'], 구분: v['905'], 신용: v['922'], 대출일: v['923'], 수량: v['900'], 가격: v['901'], 미체결: v['902'], 체결가: v['910'], 체결량: v['911'], 거래소: v['2135'] }); if (rtOrders.length > 200) rtOrders.shift();
            noteOrderEvent(v);
            return;
        }
        if (type !== '0B') return;
        const price = abs(v['10']); if (!price) return;
        const ex = /_NX$/.test(item) ? 'NXT' : 'KRX', code = code6(item), seg = segmentAt(now(), openDate);
        // KRX 정규장(09:00~15:20) · 애프터마켓(16:00~20:00)에는 KRX와 NXT 체결을 모두 본다. 그 밖에는 주문 거래소의 체결만. 단일가에는 0B로 판정하지 않는다.
        if (!seg || seg.auction || !enabled() || state.halted) return;
        if (seg.ex !== ex && !(seg.dual && ex === 'NXT')) return;
        for (const w of state.watches) {
            if (w.code !== code || w.status !== '감시중' || !w.enabled || running.has(w.id) || (ex === 'NXT' && !w.nxt)) continue;
            if (!stopActive(w) && !targetActive(w)) continue; // 트레일링만 켠 건은 봉이 끝날 때 판정
            w.lastCheck = { at: now(), ex, price, live: true, text: `${ex} ${price.toLocaleString('ko-KR')} ${condText(w, price)} · 실시간` };
            const reason = stopActive(w) && price >= w.trigger ? '손절' : targetActive(w) && price <= w.target ? '목표가' : '';
            if (reason) void fire(w, price, seg, ex, '실시간', false, reason);
        }
    }
    // 00 이벤트(내 주문 접수 · 체결 · 정정 · 취소)를 주문번호별로 모아 둔다. 체결량은 '체결' 이벤트의 단위체결량(915, 없으면 911)을 더한다.
    const ordEvents = new Map(), wakers = new Map();
    function noteOrderEvent(v) {
        const ordNo = String(v['9203'] || '').trim(); if (!ordNo) return;
        const e = ordEvents.get(ordNo) || { io: '', crd: '', qty: 0, unfilled: 0, filled: 0, prices: [], status: '', at: 0 };
        e.io = String(v['905'] || e.io).trim(); e.crd = String(v['922'] || e.crd).trim(); e.qty = abs(v['900']) || e.qty; e.unfilled = abs(v['902']); e.status = String(v['913'] || '').trim(); e.at = now();
        if (e.status === '체결') { const q = abs(v['915']) || abs(v['911']); const p = abs(v['914']) || abs(v['910']); if (q) { e.filled += q; if (p) e.prices.push(p); } }
        ordEvents.set(ordNo, e);
        if (ordEvents.size > 500) ordEvents.delete(ordEvents.keys().next().value);
        for (const w of state.watches) if ((w.orders || []).some(o => (o.ordNos || []).includes(ordNo))) { const wake = wakers.get(w.id); if (wake) { wakers.delete(w.id); wake(); } }
    }
    // 정해진 시간을 기다리되, 그 감시 건의 00 이벤트가 오면 바로 깬다.
    function waitFor(w, ms) { return Promise.race([wait(ms), new Promise(resolve => wakers.set(w.id, resolve))]).finally(() => wakers.delete(w.id)); }
    if (realtime) realtime.onReal(onReal);
    // 30초 점검 기록(realtime-날짜.jsonl): 2026-11-20 사용자 결정 — 끝나지 않은 감시 건이 있을 때만 남기고, 파일은 당일 것만 둔다(지난 날짜는 지움).
    let rtLogDay = '';
    function pruneRealtimeLogs(day) {
        try { for (const name of fs.readdirSync(directory)) if (/^realtime-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name !== 'realtime-' + day + '.jsonl') fs.rmSync(path.join(directory, name), { force: true }); } catch {}
    }
    function realtimeLog() {
        if (!realtime || now() - rtLogAt < realtimeLogMs) return;
        const day = kstParts(now()).day;
        if (day !== rtLogDay) { rtLogDay = day; pruneRealtimeLogs(day); }
        if (!state.watches.some(w => !ENDED.has(w.status))) { rtCounts = {}; rtOrders.splice(0); return; }
        rtLogAt = now();
        const line = { at: new Date(now()).toISOString(), connected: !!realtime.connected(), viState: realtime.state?.(), status: realtime.status?.(), items: rtItems ? rtItems.split(',') : [], counts: rtCounts, orders00: rtOrders.splice(0),
            // 감시 건별 상태 · 마지막 판정(파일에는 사건 때만 저장되므로 여기서 1분마다 남겨 감시가 실제로 도는지 확인한다)
            watches: state.watches.filter(w => !ENDED.has(w.status)).map(w => ({ id: w.id, name: w.name, status: w.status, enabled: w.enabled, trigger: stopActive(w) ? w.trigger : 0, target: targetActive(w) ? w.target : 0, trail: trailActive(w) ? `${w.trailMin}분 ${w.trailMa}이평` : '', lastCheck: w.lastCheck ? { at: new Date(w.lastCheck.at).toISOString(), text: w.lastCheck.text, live: !!w.lastCheck.live } : null })) };
        rtCounts = {};
        try { fs.appendFileSync(path.join(directory, 'realtime-' + kstParts(now()).day + '.jsonl'), JSON.stringify(line) + '\n'); } catch {}
    }
    const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 1)); fs.renameSync(tmp, file); };
    const event = (w, kind, text, data) => { w.log = w.log || []; w.log.push({ at: now(), kind, text, ...(data ? { data } : {}) }); if (w.log.length > 300) w.log.splice(0, w.log.length - 300); };

    // 재시작: 주문이 걸려 있던 건은 추적만 이어 가고, 주문 전 "발동"에서 멈춘 건은 다시 발동하지 않는다.
    for (const w of state.watches) {
        if (w.status === '발동' && !(w.orders || []).some(o => o.ordNos?.length)) { w.status = '확인 필요'; w.enabled = false; event(w, '재시작', '주문 전에 서버가 멈췄습니다. 영웅문에서 주문 여부를 확인하세요.'); }
    }
    // 예전 건(2026-11-28 이전): 손절 · 원만 켠 건
    for (const w of state.watches) if (w.stopOn === undefined) Object.assign(w, { stopOn: w.trigger > 0, stopMode: 'price', profitOn: false, targetOn: false, trailOn: false });
    save();

    // 키움 REST: 조회는 한도 오류 때 다시 시도, 주문(order=true)은 절대 다시 보내지 않는다.
    const lastByApi = new Map(); let lastAny = 0;
    const slow = new Set(['kt00018', 'kt00009', 'kt00005']);
    async function call(endpoint, api, body, { order = false } = {}) {
        for (let attempt = 0; attempt < (order ? 1 : 4); attempt++) {
            const gap = Math.max(lastAny + 220, (lastByApi.get(api) || 0) + (slow.has(api) ? 1100 : 220)) - now();
            if (gap > 0) await wait(gap);
            lastAny = now(); lastByApi.set(api, lastAny);
            let data;
            try {
                const r = await http.post('https://api.kiwoom.com/api/dostk/' + endpoint, body, { headers: { 'Content-Type': 'application/json;charset=UTF-8', authorization: 'Bearer ' + await getToken(), 'api-id': api }, timeout: 10000, validateStatus: () => true });
                data = r.data || {};
                if (r.status === 401 || /token|토큰/i.test(String(data.return_msg || ''))) { rejectToken(); if (!order) continue; }
            } catch (error) { data = { networkError: String(error.message || error) }; if (order) return data; await wait(500); continue; }
            if (!order && /허용된 요청|초과|1700/.test(String(data.return_msg || ''))) { await wait(1000 * (attempt + 1)); continue; }
            return data;
        }
        return { error: '키움 응답 없음' };
    }

    async function loadAccount() {
        if (account) return account;
        const r = await call('acnt', 'ka00001', {});
        // 계좌 표시: 앞 8자리 + 상품코드 2자리(3699-5772-11). 같은 계좌번호의 다른 상품(…-28)을 구분한다(2026-11-21)
        if (r.acctNo) { const a = String(r.acctNo).trim(); account = a.slice(0, 4) + '-' + a.slice(4, 8) + (a.length > 8 ? '-' + a.slice(8) : ''); }
        return account;
    }
    async function nxtEligible(code) {
        const day = kstParts(now()).day, hit = nxtCache.get(code);
        if (hit && hit.day === day) return hit.value;
        const r = await call('stkinfo', 'ka10001', { stk_cd: code + '_NX' });
        const value = !!abs(r.base_pric) || !!abs(r.cur_prc);
        nxtCache.set(code, { day, value });
        return value;
    }
    // 그날 상한가 · 하한가(2026-11-23): 대주창 감시가 화살표가 이 범위를 넘지 않게 잔고 행에 붙인다. 하루 동안 바뀌지 않아 종목당 하루 한 번만 조회한다(ka10001 KRX).
    const limitCache = new Map();
    async function priceLimits(code) {
        const day = kstParts(now()).day, hit = limitCache.get(code);
        if (hit && hit.day === day) return hit.value;
        try {
            const r = await call('stkinfo', 'ka10001', { stk_cd: code });
            const value = { upper: abs(r.upl_pric), lower: abs(r.lst_pric) };
            if (value.upper) limitCache.set(code, { day, value });
            return value;
        } catch { return { upper: 0, lower: 0 }; }
    }
    // 대주 잔고: kt00018 개별(대출일별, crd_tp_nm "대주") + ka10085 만기일.
    async function loadLots() {
        const [b, p] = [await call('acnt', 'kt00018', { qry_tp: '2', dmst_stex_tp: 'KRX' }), await call('acnt', 'ka10085', { stex_tp: '0' })];
        if (!Array.isArray(b.acnt_evlt_remn_indv_tot)) { lotsError = b.return_msg || b.error || '잔고 조회 실패'; return lots; }
        const maturity = new Map(), interest = new Map();
        for (const r of p.acnt_prft_rt || []) if (/^\d{8}$/.test(r.loan_dt) && r.loan_dt !== '00000000') { maturity.set(code6(r.stk_cd) + ':' + r.loan_dt, r.expr_dt); interest.set(code6(r.stk_cd) + ':' + r.loan_dt, abs(r.crd_int)); }
        const next = [];
        for (const r of b.acnt_evlt_remn_indv_tot) {
            if (!/대주/.test(r.crd_tp_nm || '') || !/^\d{8}$/.test(r.crd_loan_dt || '')) continue;
            const code = code6(r.stk_cd);
            next.push({ key: code + ':' + r.crd_loan_dt, code, name: String(r.stk_nm || '').replace(/^\//, ''), loanDt: ymd(r.crd_loan_dt), loanRaw: r.crd_loan_dt,
                maturity: ymd(maturity.get(code + ':' + r.crd_loan_dt) || ''), qty: abs(r.rmnd_qty), able: abs(r.trde_able_qty), sellPrice: abs(r.pur_pric), price: abs(r.cur_prc), pl: num(r.evltv_prft), rate: num(r.prft_rt), purAmt: abs(r.pur_amt) });
        }
        for (const lot of next) { lot.nxt = await nxtEligible(lot.code); Object.assign(lot, await priceLimits(lot.code)); lot.priceEx = 'KRX'; }
        // 현재가 · 평가손익 · 수익률은 영웅문 0345(실시간잔고 통합)처럼 마지막 체결 시장 기준(2026-11-26 사용자 요청: 삼성E&A 대주창 1.50% · 0345 1.48%).
        // kt00018은 시장구분이 KRX · NXT뿐이고(통합 없음, 2026-11-26 확인) 평가손익에 수수료 · 세금이 이미 빠져 있다(28 계좌 삼성SDI: 500 - 840 - 840 - 1,684 = -2,864).
        // KRX 정규장(09:00~15:30) 밖은 NXT 체결이 마지막이라 NXT 대상 종목은 NXT 기준 행으로 바꾼다(밤 21시 삼성SDI KRX 421,000 · NXT 421,500).
        const seg = segmentAt(now(), openDate), regular = seg && (seg.id === 'KRX' || seg.id === 'KRX_CLOSE');
        if (!regular && next.some(l => l.nxt)) {
            const n = await call('acnt', 'kt00018', { qry_tp: '2', dmst_stex_tp: 'NXT' }), byKey = new Map();
            for (const r of Array.isArray(n.acnt_evlt_remn_indv_tot) ? n.acnt_evlt_remn_indv_tot : []) if (/대주/.test(r.crd_tp_nm || '')) byKey.set(code6(r.stk_cd) + ':' + r.crd_loan_dt, r);
            for (const lot of next) { const r = lot.nxt && byKey.get(lot.key); if (r && abs(r.cur_prc)) Object.assign(lot, { price: abs(r.cur_prc), pl: num(r.evltv_prft), rate: num(r.prft_rt), priceEx: 'NXT' }); }
        }
        // 신용이자(대주 이용료)도 뺀다(2026-11-26 사용자 확인: 0345 삼성E&A 1.48% = (149,498 - 신용이자 2,049) / 신용금액 9,976,000).
        // kt00018 평가손익은 수수료 · 세금만 뺀 값이고, 이자는 ka10085 crd_int에 따로 있다. 수익률은 0345처럼 매입(신용)금액 대비로 다시 계산한다.
        for (const lot of next) { lot.interest = interest.get(lot.key) || 0; lot.pl -= lot.interest; if (lot.purAmt) lot.rate = Math.round(lot.pl / lot.purAmt * 10000) / 100; }
        lots = next; lotsAt = now(); lotsError = '';
        return lots;
    }

    const today = () => kstParts(now()).day;
    function publicWatch(w) { const { log: _log, ...rest } = w; return rest; }
    function snapshot() {
        viewedAt = now();
        const seg = segmentAt(now(), openDate);
        return { enabled: !!enabled(), realtime: realtime ? { connected: !!realtime.connected(), state: realtime.state?.() || '' } : null, account, segment: seg, halted: state.halted, haltedReason: state.haltedReason, haltedAt: state.haltedAt,
            lots, lotsAt, lotsError, watches: state.watches.map(publicWatch), now: now() };
    }

    // 할당(2026-11-24): 같은 대출일 묶음에 감시 건을 여러 개 둘 수 있다. 주문 전(감시중 · 중지) 건의 수량은 그 묶음에 할당된 것으로 보고
    // 새 건은 남은 가능수량 안에서만 정한다. %는 등록할 때 남은 수량 기준 주 수(w.shares)로 정하고, 그때 보유수량(w.baseQty)을 남긴다.
    // 주문이 나간 건은 그 수량이 가능수량에서 이미 빠지므로 할당으로 세지 않는다.
    const ALLOC = new Set(['감시중', '중지']);
    // 수량 %: qtyValue −1은 "100%-1주"(2026-11-27 사용자 요청, 가능수량에서 1주를 남김). 그 밖에는 10~100%를 내림, 최소 1주
    const pctShares = (base, v) => v === -1 ? Math.max(0, base - 1) : base >= 1 ? Math.max(1, Math.floor(base * v / 100)) : 0;
    const pctLabel = v => v === -1 ? '100%-1주' : v + '%';
    function watchShares(w, lot) {
        if (w.shares > 0) return w.shares;
        return w.qtyMode === 'pct' ? pctShares(lot.able, w.qtyValue) : Math.min(w.qtyValue, lot.able);
    }
    function remainingFor(lot, exceptId) {
        const used = state.watches.filter(w => w.lotKey === lot.key && w.id !== exceptId && ALLOC.has(w.status)).reduce((a, w) => a + watchShares(w, lot), 0);
        return Math.max(0, lot.able - used);
    }
    // 청산 조건 읽기. prev는 고치는 건(등록 시 현재가 · 매입단가를 그대로 쓴다)
    function exitConditions(input, lot, prev = {}) {
        const bad = m => { throw Object.assign(Error(m), { status: 400 }); };
        const legacy = input.stopOn === undefined && input.profitOn === undefined;
        const avgPrice = abs(lot?.sellPrice) || abs(prev.avgPrice), regPrice = abs(prev.regPrice) || abs(lot?.price);
        const basisOf = b => b === 'reg' ? regPrice : avgPrice;
        const pct = v => Math.round(Math.abs(num(String(v ?? '').normalize('NFKC'))) * 10) / 10;
        const stopOn = legacy ? true : !!input.stopOn, stopMode = input.stopMode === 'pct' ? 'pct' : 'price', stopBasis = input.stopBasis === 'reg' ? 'reg' : 'avg';
        let trigger = Math.round(num(input.trigger)); const stopPct = pct(input.stopPct);
        if (stopOn && stopMode === 'pct') {
            if (!(stopPct >= 0.1 && stopPct <= 50)) bad('손절 %는 0.1~50%입니다');
            if (!basisOf(stopBasis)) bad('손절 % 기준가(매입단가 · 등록 시 현재가)를 알 수 없습니다');
            trigger = ceilTick(basisOf(stopBasis) * (1 + stopPct / 100));
        }
        if (stopOn && !(trigger > 0)) bad('감시가를 입력하세요');
        const profitOn = !legacy && !!input.profitOn, targetOn = !!input.targetOn, trailOn = !!input.trailOn;
        const targetMode = input.targetMode === 'price' ? 'price' : 'pct', targetBasis = input.targetBasis === 'reg' ? 'reg' : 'avg';
        let target = Math.round(num(input.target)); const targetPct = pct(input.targetPct);
        if (profitOn && targetOn && targetMode === 'pct') {
            if (!(targetPct >= 0.1 && targetPct <= 50)) bad('목표가 %는 0.1~50%입니다');
            if (!basisOf(targetBasis)) bad('목표가 % 기준가(매입단가 · 등록 시 현재가)를 알 수 없습니다');
            target = floorTick(basisOf(targetBasis) * (1 - targetPct / 100));
        }
        if (profitOn && targetOn && !(target > 0)) bad('목표가를 입력하세요');
        const trailMin = Math.round(num(input.trailMin)) || 15, trailMa = Math.round(num(input.trailMa)) || 10;
        if (profitOn && trailOn && !TRAIL_MINUTES.includes(trailMin)) bad('트레일링 분봉은 ' + TRAIL_MINUTES.join(' · ') + '분입니다');
        if (profitOn && trailOn && !(trailMa >= 2 && trailMa <= 120)) bad('트레일링 이평은 2~120입니다');
        const out = { stopOn, stopMode, stopPct, stopBasis, trigger: Math.max(0, trigger || 0), profitOn, targetOn, targetMode, targetPct, targetBasis, target: Math.max(0, target || 0), trailOn, trailMin, trailMa, avgPrice, regPrice };
        if (!stopActive(out) && !targetActive(out) && !trailActive(out)) bad('손절 · 익절(목표가 · 트레일링) 중 하나 이상 켜세요');
        return out;
    }
    function validate(input, lot, remaining = null, prev = {}) {
        const exit = exitConditions(input, lot, prev);
        const ticks = Math.round(num(input.ticks)), chasePct = Math.round(num(input.chasePct));
        const qtyMode = input.qtyMode === 'shares' ? 'shares' : 'pct', qtyValue = Math.round(num(input.qtyValue));
        if (!(ticks >= 1 && ticks <= 10)) throw Object.assign(Error('틱은 1~10입니다'), { status: 400 });
        if (!(chasePct >= 1 && chasePct <= 10)) throw Object.assign(Error('추격 한도는 1~10%입니다'), { status: 400 });
        if (qtyMode === 'pct' && !(qtyValue === -1 || qtyValue >= 10 && qtyValue <= 100 && qtyValue % 10 === 0)) throw Object.assign(Error('수량 %는 10~100%(10% 단위)나 100%-1주입니다'), { status: 400 });
        if (qtyMode === 'shares' && !(qtyValue >= 1)) throw Object.assign(Error('주 수를 입력하세요'), { status: 400 });
        // 남은 가능수량까지만(2026-11-24). 잔고에서 행이 사라진 감시 건을 고칠 때(remaining null)는 검사하지 않는다
        let alloc = {};
        if (remaining != null) {
            if (remaining < 1) throw Object.assign(Error('남은 가능수량이 없습니다(다른 감시 건에 모두 할당)'), { status: 400 });
            if (qtyMode === 'shares' && qtyValue > remaining) throw Object.assign(Error(`남은 가능수량(${remaining}주)보다 많이 설정할 수 없습니다`), { status: 400 });
            if (qtyMode === 'pct' && qtyValue === -1 && remaining < 2) throw Object.assign(Error('100%-1주는 남은 가능수량이 2주 이상일 때만 쓸 수 있습니다'), { status: 400 });
            alloc = { shares: qtyMode === 'shares' ? qtyValue : pctShares(remaining, qtyValue), baseQty: lot.qty };
        } else if (qtyMode === 'shares') alloc = { shares: qtyValue };
        const until = adjustUntil(String(input.until || addMonth(today())), { today: today(), maturity: lot.maturity, openDate });
        return { ...exit, ticks, upperLimit: !!input.upperLimit, fix: input.fix !== false, chasePct, qtyMode, qtyValue,
            allLots: !!input.allLots, cancelPending: input.cancelPending !== false, until: until.value, untilNote: until.note, ...alloc };
    }
    async function create(input) {
        if (!lotsAt) await loadLots();
        const lot = lots.find(l => l.key === input.lotKey);
        if (!lot) throw Object.assign(Error('대주 잔고에서 그 행을 찾지 못했습니다'), { status: 404 });
        const w = { id: crypto.randomBytes(6).toString('hex'), lotKey: lot.key, code: lot.code, name: lot.name, loanDt: lot.loanDt, loanRaw: lot.loanRaw, maturity: lot.maturity, nxt: lot.nxt,
            ...validate(input, lot, remainingFor(lot)), enabled: input.enabled !== false, status: '감시중', createdAt: now(), trailFrom: now(), trailLast: 0, lastCheck: null, note: '', orders: [], log: [] };
        if (!w.enabled) w.status = '중지';
        event(w, '등록', `${exitLabel(w)} · +${w.ticks}틱${w.upperLimit ? ' · 상한가' : ''} · 정정 ${w.fix ? '켜짐(한도 ' + w.chasePct + '%)' : '꺼짐'} · ${w.qtyMode === 'pct' ? pctLabel(w.qtyValue) : w.qtyValue + '주'} · ~${w.until}`);
        state.watches.push(w); save();
        return publicWatch(w);
    }
    // 기록용 조건 문구: "손절 ≥ 7,300 · 목표 ≤ 6,700(매입단가 -5%) · 트레일링 15분 10이평"
    function exitLabel(w) {
        const basis = b => b === 'reg' ? '등록 시 현재가' : '매입단가';
        return [stopActive(w) && `손절 ≥ ${won(w.trigger)}${w.stopMode === 'pct' ? `(${basis(w.stopBasis)} +${w.stopPct}%)` : ''}`,
            targetActive(w) && `목표 ≤ ${won(w.target)}${w.targetMode === 'pct' ? `(${basis(w.targetBasis)} -${w.targetPct}%)` : ''}`,
            trailActive(w) && `트레일링 ${w.trailMin}분 ${w.trailMa}이평`].filter(Boolean).join(' · ');
    }
    function find(id) { const w = state.watches.find(x => x.id === id); if (!w) throw Object.assign(Error('감시 건을 찾지 못했습니다'), { status: 404 }); return w; }
    function update(id, input) {
        const w = find(id);
        if (ACTIVE.has(w.status) || running.has(w.id)) throw Object.assign(Error('주문 처리 중에는 고칠 수 없습니다'), { status: 409 });
        if (['체결완료', '부분체결', '잔고없음'].includes(w.status)) throw Object.assign(Error('끝난 건은 고칠 수 없습니다'), { status: 409 });
        const lot = lots.find(l => l.key === w.lotKey);
        Object.assign(w, validate(input, lot ? { ...lot, maturity: w.maturity } : { maturity: w.maturity }, lot ? remainingFor(lot, w.id) : null, w), { trailFrom: now(), trailLast: 0, trail: null });
        if (w.status === '만료' || w.status === '실패' || w.status === '확인 필요') { w.status = w.enabled ? '감시중' : '중지'; }
        event(w, '수정', `${exitLabel(w)} · +${w.ticks}틱 · ~${w.until}`);
        save(); return publicWatch(w);
    }
    function setEnabled(id, on) {
        const w = find(id);
        if (ACTIVE.has(w.status) || ENDED.has(w.status) && w.status !== '만료') throw Object.assign(Error('이 건은 감시를 켜고 끌 수 없습니다'), { status: 409 });
        if (w.status === '만료') throw Object.assign(Error('만료된 건은 유효기간을 연장한 뒤 켜세요'), { status: 409 });
        w.enabled = !!on; w.status = on ? '감시중' : '중지'; if (on) { w.trailFrom = now(); w.trailLast = 0; } event(w, on ? '감시' : '중지', on ? '감시를 켰습니다' : '감시를 껐습니다'); save();
        return publicWatch(w);
    }
    function setAll(on) { for (const w of state.watches) if (['감시중', '중지'].includes(w.status)) { if (on && w.status === '중지') { w.trailFrom = now(); w.trailLast = 0; } w.enabled = !!on; w.status = on ? '감시중' : '중지'; } save(); return snapshot(); }
    function remove(id) { const w = find(id); if (ACTIVE.has(w.status) || running.has(w.id)) throw Object.assign(Error('주문 처리 중에는 지울 수 없습니다'), { status: 409 }); state.watches = state.watches.filter(x => x !== w); save(); }
    function history(id) { const w = find(id); return { watch: publicWatch(w), log: w.log || [] }; }
    function resume() { state.halted = false; state.haltedReason = ''; save(); return snapshot(); }
    function halt(reason) { state.halted = true; state.haltedReason = reason; state.haltedAt = now(); for (const w of state.watches) if (w.status === '감시중') { w.status = '중지'; w.enabled = false; } save(); log('대주 StopLoss 전체 중지: ' + reason); }

    // ---- 시세 · 주문 ----
    async function quote(code, ex) {
        const r = await call('stkinfo', 'ka10001', { stk_cd: ex === 'NXT' ? code + '_NX' : code });
        return { cur: abs(r.cur_prc), exp: abs(r.exp_cntr_pric), volume: abs(r.trde_qty), upper: abs(r.upl_pric), base: abs(r.base_pric), ok: r.return_code === 0 };
    }
    async function bestAsk(code, ex) { const r = await call('mrkcond', 'ka10004', { stk_cd: ex === 'NXT' ? code + '_NX' : code }); return abs(r.sel_fpr_bid); }
    // 정규장 주문 거래소(2026-11-20 사용자 결정): NXT 거래 종목은 SOR(키움이 KRX · NXT 중 유리한 곳으로 보냄), NXT 비대상은 KRX.
    // SOR 대주상환은 11/20 실계좌로 접수 · 취소 · 체결을 확인했다(outputs/kiwoom-short-cover-20261120). 단일가 · NXT 시간대는 그대로.
    // 16:00~20:00 애프터마켓도 같은 규칙(2026-11-24 SOR 접수 확인, 실제로 간 거래소는 체결 전이라 미확인)
    const orderExFor = (seg, w) => seg.dual && w.nxt ? 'SOR' : seg.ex;
    async function orderState(code, ex, ordNos) {
        // 미체결 조회 거래소: KRX 1 · NXT 2 · 전체 0(SOR 주문은 전체로 봐야 보인다, 11/20 시험)
        const oso = await call('acnt', 'ka10075', { all_stk_tp: '1', trde_tp: '2', stk_cd: code, stex_tp: ex === 'NXT' ? '2' : ex === 'SOR' ? '0' : '1' });
        const prst = await call('acnt', 'kt00009', { ord_dt: '', stk_bond_tp: '0', mrkt_tp: '0', sell_tp: '2', qry_tp: '0', stk_cd: code, fr_ord_no: '', dmst_stex_tp: '%' });
        const set = new Set(ordNos), open = (oso.oso || []).filter(r => set.has(r.ord_no));
        const rows = (prst.acnt_ord_cntr_prst_array || []).filter(r => set.has(r.ord_no));
        return { open: open.reduce((s, r) => s + abs(r.oso_qty), 0), filled: rows.reduce((s, r) => s + abs(r.cntr_qty), 0),
            io: [...open.map(r => r.io_tp_nm), ...rows.map(r => (r.io_tp_nm || '') + '/' + (r.crd_deal_tp || ''))], prices: rows.map(r => abs(r.cntr_uv)).filter(Boolean), ok: !!oso.oso || !!prst.acnt_ord_cntr_prst_array };
    }
    async function cancelOrder(code, ex, ordNo) { return call('crdordr', 'kt10009', { dmst_stex_tp: ex, orig_ord_no: ordNo, stk_cd: code, cncl_qty: '0' }, { order: true }); }
    // 대주상환 확인 장치: 접수 후 3초 안에 미체결 "+상환대주" 또는 체결현황 "대주매수상환"이 보여야 한다.
    async function verify(code, ex, ordNo, w) {
        for (let i = 0; i < 3; i++) {
            const seen = ordEvents.get(ordNo);
            if (seen && seen.io) return /상환대주/.test(seen.io) && seen.crd === '77' ? { ok: true, via: '실시간', state: { io: [seen.io] } } : { ok: false, via: '실시간', state: { io: [seen.io + '/' + seen.crd] } };
            await (w ? waitFor(w, 1000) : wait(1000));
            const again = ordEvents.get(ordNo);
            if (again && again.io) return /상환대주/.test(again.io) && again.crd === '77' ? { ok: true, via: '실시간', state: { io: [again.io] } } : { ok: false, via: '실시간', state: { io: [again.io + '/' + again.crd] } };
            const s = await orderState(code, ex, [ordNo]);
            if (s.io.some(x => /상환대주|대주매수상환/.test(x))) return { ok: true, state: s };
            if (s.io.length) return { ok: false, state: s };
        }
        return { ok: false, state: null };
    }
    async function cancelPendingCovers(w, ex) {
        const oso = await call('acnt', 'ka10075', { all_stk_tp: '1', trde_tp: '2', stk_cd: w.code, stex_tp: '0' });
        const mine = new Set((w.orders || []).flatMap(o => o.ordNos || []));
        for (const r of oso.oso || []) {
            if (!/상환대주/.test(r.io_tp_nm || '') || mine.has(r.ord_no) || !(abs(r.oso_qty) > 0)) continue;
            const exOf = /SOR/i.test(r.stex_tp_txt || '') ? 'SOR' : r.stex_tp_txt === 'NXT' || r.stex_tp === '2' ? 'NXT' : 'KRX';
            let c = await cancelOrder(w.code, exOf, r.ord_no).catch(e => ({ error: String(e.message || e) }));
            // SOR로 낸 주문은 미체결 조회에 어느 거래소로 나오는지 확인하지 못했다: 실패하면 SOR로 한 번 더 취소한다
            if ((c.error || (c.return_code != null && Number(c.return_code) !== 0)) && exOf !== 'SOR') c = await cancelOrder(w.code, 'SOR', r.ord_no).catch(e => ({ error: String(e.message || e) }));
            event(w, '미체결 취소', `기존 대주상환 주문 ${r.ord_no}(${exOf}, ${abs(r.oso_qty)}주) 취소: ${c.return_msg || c.error || ''}`);
        }
        await wait(1500);
    }

    async function sendCover(w, o, price) {
        const body = { dmst_stex_tp: o.ex, stk_cd: w.code, ord_qty: String(o.qty), ord_uv: String(price), trde_tp: '0', cond_uv: '', crd_deal_tp: '77', crd_loan_dt: o.loanRaw };
        const r = await call('crdordr', 'kt10006', body, { order: true });
        event(w, '주문', `${o.ex} 대주상환 ${o.qty}주 · ${price.toLocaleString('ko-KR')} 지정가 (대출일 ${ymd(o.loanRaw)}) → ${r.ord_no ? '주문번호 ' + r.ord_no : '거부'} ${r.return_msg || r.error || ''}`.trim());
        if (!r.ord_no) return null;
        o.ordNos.push(r.ord_no); o.price = price; save();
        const v = await verify(w.code, o.ex, r.ord_no, w);
        if (!v.ok) {
            const c = await cancelOrder(w.code, o.ex, r.ord_no);
            event(w, '확인 장치', `대주상환 접수를 확인하지 못했습니다(${v.state ? v.state.io.join(', ') : '응답 없음'}). 즉시 취소: ${c.return_msg || c.error || ''}`);
            o.state = '실패'; halt(`${w.name} 주문이 대주상환으로 확인되지 않았습니다. 영웅문에서 주문을 확인하세요.`);
            return null;
        }
        event(w, '확인 장치', `"+상환대주" 접수 확인${v.via ? ' · ' + v.via : ' · 조회'}`);
        return r.ord_no;
    }

    async function fire(w, firePrice, seg, srcEx = seg.ex, via = '조회', expected = !!seg.auction, reason = '손절', why = '') {
        running.add(w.id);
        try {
            const orderEx = orderExFor(seg, w);
            w.status = '발동'; w.firedAt = now(); w.firePrice = firePrice; w.fireEx = orderEx; w.enabled = false;
            w.fireSrc = srcEx; w.fireVia = via; w.fireReason = reason;
            const seen = `${srcEx} ${expected ? '예상체결가' : '체결가'} ${firePrice.toLocaleString('ko-KR')}`;
            event(w, '발동', reason === '목표가' ? `익절 목표가: ${seen} ≤ 목표가 ${won(w.target)} · ${via} 판정 · 주문 거래소 ${orderEx}`
                : reason === '트레일링' ? `익절 트레일링: ${why} · 주문 거래소 ${orderEx}`
                : `${seen} ≥ 감시가 ${w.trigger.toLocaleString('ko-KR')} · ${via} 판정 · 주문 거래소 ${orderEx}`);
            save();
            await loadLots();
            let targets = lots.filter(l => l.code === w.code && (w.allLots || l.key === w.lotKey)).sort((a, b) => String(a.maturity).localeCompare(String(b.maturity)));
            if (w.cancelPending && targets.some(l => l.able < l.qty)) { await cancelPendingCovers(w, seg.ex); await loadLots(); targets = lots.filter(l => targets.some(t => t.key === l.key)); }
            const q = await quote(w.code, seg.ex);
            const upper = q.upper || 0, cap = w.fix ? chaseCap(firePrice, w.chasePct, upper) : (upper || Infinity);
            w.orders = [];
            for (const lot of targets) {
                // 이 건의 대출일 묶음은 등록 때 정한 주 수(그때 가능수량까지), 함께 상환하는 다른 묶음은 예전처럼 % · 주로 계산
                const qty = w.shares > 0 && lot.key === w.lotKey ? Math.min(w.shares, lot.able) : w.qtyMode === 'pct' ? pctShares(lot.able, w.qtyValue) : Math.min(w.qtyValue, lot.able);
                if (!(lot.able >= 1) || !(qty >= 1)) { event(w, '잔고 확인', `대출일 ${lot.loanDt} 가능수량 0 · 주문하지 않음`); continue; }
                event(w, '잔고 확인', `대출일 ${lot.loanDt} 가능수량 ${lot.able}주 → ${qty}주 상환`);
                const o = { loanRaw: lot.loanRaw, qty, able: lot.able, ex: orderEx, seg: seg.id, ordNos: [], price: 0, filled: 0, attempts: 0, state: '주문', cap, upper };
                w.orders.push(o);
                let price = w.upperLimit && upper ? upper : addTicks(firePrice, w.ticks);
                price = Math.min(price, upper || price, w.fix ? cap : Infinity);
                const ordNo = await sendCover(w, o, price);
                if (state.halted) break;
                if (!ordNo) o.state = '실패';
            }
            if (!w.orders.length) { w.status = '잔고없음'; event(w, '결과', '상환할 대주 잔고가 없습니다'); save(); return; }
            if (w.orders.every(o => o.state === '실패')) { w.status = '실패'; save(); return; }
            w.status = '주문접수'; save();
            await track(w);
        } catch (error) {
            w.status = '확인 필요'; event(w, '오류', String(error.message || error)); save(); log('대주 StopLoss 오류: ' + (error.stack || error));
        } finally { running.delete(w.id); }
    }

    // 체결 추적과 미체결 정정(3초 간격 최대 3회), KRX 종가 뒤 남은 수량은 NXT로 다시 낸다.
    async function track(w) {
        const deadline = now() + 6 * 3600000;
        while (now() < deadline) {
            await waitFor(w, 3000);
            let pending = false;
            for (const o of w.orders) {
                if (['체결', '실패', '끝'].includes(o.state) || !o.ordNos.length) continue;
                // 00 이벤트로 다 체결된 것을 알았으면 조회 없이 바로 끝낸다(조회는 이벤트를 놓쳤을 때의 보조).
                const ev = o.ordNos.map(n => ordEvents.get(n)).filter(Boolean), evFilled = ev.reduce((a, e) => a + e.filled, 0);
                if (evFilled > o.filled) { const prices = ev.flatMap(e => e.prices); event(w, '체결', `${o.ex} ${evFilled}/${o.qty}주 체결${prices.length ? ' · ' + prices.map(p => p.toLocaleString('ko-KR')).join(', ') : ''} · 실시간`); o.filled = evFilled; o.fillPrices = prices; }
                if (o.filled >= o.qty) { o.state = '체결'; continue; }
                const s = await orderState(w.code, o.ex, o.ordNos);
                if (!s.ok) { pending = true; continue; }
                if (s.filled > o.filled) { event(w, '체결', `${o.ex} ${s.filled}/${o.qty}주 체결${s.prices.length ? ' · ' + s.prices.map(p => p.toLocaleString('ko-KR')).join(', ') : ''} · 조회`); o.filled = s.filled; o.fillPrices = s.prices; }
                if (o.filled >= o.qty) { o.state = '체결'; continue; }
                const seg = segmentAt(now(), openDate);
                if (s.open === 0) {
                    // 정규장 · 종가 단일가 주문이 15:30 마감으로 없어지면: NXT 종목은 15:30부터 NXT로(15:30~15:40은 미리 접수),
                    // NXT 비대상은 KRX 애프터마켓이 열리는 16:00까지 기다렸다가 KRX로 다시 낸다(2026-11-24)
                    const afterClose = seg && ['NXT_SINGLE', 'NXT_AFTER', 'AFTER'].includes(seg.id);
                    if ((o.ex === 'KRX' || o.ex === 'SOR') && afterClose && !o.rerouted && (!o.seg || o.seg === 'KRX' || o.seg === 'KRX_CLOSE')) {
                        const target = w.nxt ? 'NXT' : seg.id === 'AFTER' ? 'KRX' : '';
                        if (!target) {
                            if (!o.waitAfter) { o.waitAfter = true; event(w, '알림', `KRX 마감 뒤 남은 ${o.qty - o.filled}주 · NXT 비대상이라 16:00 KRX 애프터마켓에 다시 냅니다`); }
                            pending = true; continue;
                        }
                        const was = o.ex; o.rerouted = true; o.ex = target; o.qty -= o.filled; o.filled = 0; o.ordNos = []; o.attempts = 0;
                        const ask = await bestAsk(w.code, target); const price = Math.min(o.cap, addTicks(ask || w.firePrice, w.ticks));
                        event(w, '재주문', `${was === 'SOR' ? 'SOR 주문이 정규장 마감 뒤 남아' : 'KRX 마감 뒤'} 남은 ${o.qty}주를 ${target}로 다시 냅니다`);
                        if (!await sendCover(w, o, price)) o.state = '실패';
                        pending = true; continue;
                    }
                    o.state = '끝'; event(w, '결과', `${o.ex} 미체결 수량이 없어졌습니다(체결 ${o.filled}/${o.qty}주). 거부 · 직접 취소 여부를 확인하세요.`);
                    continue;
                }
                pending = true;
                // NXT 애프터 단일가(15:30~15:40)에는 체결이 없으므로 정정 횟수를 쓰지 않고 15:40을 기다린다
                if (w.fix && !w.upperLimit && o.attempts < 3 && seg && seg.id !== 'HOLD' && seg.id !== 'NXT_SINGLE') {
                    o.attempts++;
                    const ask = await bestAsk(w.code, o.ex);
                    const price = repriceFor(o.attempts, ask, w.ticks, o.cap);
                    if (price > o.price) {
                        w.status = '정정중';
                        const last = o.ordNos[o.ordNos.length - 1];
                        const m = await call('crdordr', 'kt10008', { dmst_stex_tp: o.ex, orig_ord_no: last, stk_cd: w.code, mdfy_qty: '0', mdfy_uv: String(price), mdfy_cond_uv: '' }, { order: true });
                        event(w, '정정', `${o.attempts}회 · 매도1호가 ${ask ? ask.toLocaleString('ko-KR') : '없음'} → ${price.toLocaleString('ko-KR')}${price === o.cap ? '(한도)' : ''} · ${m.ord_no ? '주문번호 ' + m.ord_no : '실패'} ${m.return_msg || m.error || ''}`.trim());
                        if (m.ord_no) { o.ordNos.push(m.ord_no); o.price = price; }
                    } else event(w, '정정', `${o.attempts}회 · 주문가가 이미 ${o.price.toLocaleString('ko-KR')}라 그대로 둡니다`);
                    if (o.attempts === 3) event(w, '알림', `정정 3회 뒤에도 ${o.qty - o.filled}주 미체결 · 추격 한도 ${o.cap.toLocaleString('ko-KR')}에 주문을 둡니다`);
                } else if (w.status !== '미체결' && (!w.fix || o.attempts >= 3)) { w.status = '미체결'; event(w, '알림', `${o.qty - o.filled}주 미체결`); }
            }
            save();
            if (!pending) break;
        }
        const total = w.orders.reduce((s, o) => s + o.qty, 0), filled = w.orders.reduce((s, o) => s + o.filled, 0);
        w.status = filled >= total && total > 0 ? '체결완료' : filled > 0 ? '부분체결' : '실패';
        const prices = w.orders.flatMap(o => o.fillPrices || []);
        w.note = filled ? `${w.fireReason && w.fireReason !== '손절' ? '익절(' + w.fireReason + ') ' : ''}${w.firePrice.toLocaleString('ko-KR')} 발동 → ${filled}/${total}주 체결${prices.length ? ' · ' + [...new Set(prices)].map(p => p.toLocaleString('ko-KR')).join(', ') : ''}` : '체결 없음';
        event(w, '결과', w.note); save();
        void loadLots().catch(() => {});
    }

    async function step() {
        if (ticking) return; ticking = true;
        try {
            const t = now(), { day, minutes } = kstParts(t);
            let dirty = false;
            for (const w of state.watches) {
                if (['감시중', '중지'].includes(w.status) && (day > w.until || day === w.until && minutes >= 1200)) { w.status = '만료'; w.enabled = false; event(w, '만료', `유효기간(${w.until}) 종료`); dirty = true; }
            }
            if (dirty) save();
            if ((now() - lotsAt > balanceMs) && (now() - viewedAt < 60000 || state.watches.some(w => w.status === '감시중'))) await loadLots().catch(e => { lotsError = String(e.message || e); });
            syncRealtime(); realtimeLog();
            if (!enabled() || state.halted) return;
            const seg = segmentAt(t, openDate);
            const watching = state.watches.filter(w => w.status === '감시중' && w.enabled && !running.has(w.id));
            await trailStep(t, seg, watching);
            if (!seg || !seg.ex) { for (const w of watching) if (stopActive(w) || targetActive(w)) w.lastCheck = { at: t, text: seg ? seg.label + ' · 판정 안 함' : '장 시작 전' }; return; }
            // 공용 실시간이 붙어 있으면 0B가 바로 판정하므로 조회는 5초 간격 보조(종가 단일가 15:20~15:30은 0B가 없어 1초 조회).
            if (realtime?.connected() && !seg.auction && now() - lastPollAt < 5000) return;
            lastPollAt = now();
            const priced = watching.filter(w => stopActive(w) || targetActive(w));
            const codes = [...new Set(priced.filter(w => seg.ex === 'KRX' || w.nxt).map(w => w.code))];
            for (const w of priced) if (seg.ex === 'NXT' && !w.nxt) w.lastCheck = { at: t, text: `NXT 비대상 · ${seg.id === 'NXT_PRE' ? '09:00' : '16:00'} KRX 대기` };
            for (const code of codes) {
                const group = priced.filter(x => x.code === code);
                // KRX 정규장 · 애프터마켓에는 NXT 체결도 본다(실시간이 끊겨 조회로 감시할 때). 오늘 체결이 있는 쪽만 쓴다.
                const sources = [seg.ex];
                if (seg.dual && group.some(w => w.nxt)) sources.push('NXT');
                const seen = [];
                for (const ex of sources) {
                    const q = await quote(code, ex);
                    // KRX 종가 단일가는 예상체결가. NXT 애프터 단일가(15:30~15:40)는 예상체결가, 없으면 오늘 마지막 NXT 체결가
                    if (seg.id === 'KRX_CLOSE') { if (q.ok && q.exp) seen.push({ ex, price: q.exp, expected: true }); continue; }
                    if (seg.id === 'NXT_SINGLE' && q.ok && q.exp) { seen.push({ ex, price: q.exp, expected: true }); continue; }
                    if (q.ok && q.cur && q.volume) seen.push({ ex, price: q.cur });
                }
                for (const w of group) {
                    const usable = seen.filter(s => s.ex === seg.ex || w.nxt);
                    if (!usable.length) { w.lastCheck = { at: now(), ex: seg.ex, text: `${seg.ex} 오늘 체결 없음` }; continue; }
                    // 손절은 가장 높은 체결, 목표가는 가장 낮은 체결로 판정(어느 거래소든 조건에 닿으면 발동)
                    const best = usable.reduce((a, b) => (b.price > a.price ? b : a)), low = usable.reduce((a, b) => (b.price < a.price ? b : a));
                    w.lastCheck = { at: now(), ex: best.ex, price: best.price, text: usable.map(s => `${s.ex} ${s.price.toLocaleString('ko-KR')}`).join(' · ') + ` ${condText(w, best.price, low.price)}` };
                    if (state.halted) continue;
                    if (stopActive(w) && best.price >= w.trigger) void fire(w, best.price, seg, best.ex, '조회', !!best.expected, '손절');
                    else if (targetActive(w) && low.price <= w.target) void fire(w, low.price, seg, low.ex, '조회', !!low.expected, '목표가');
                }
            }
        } catch (error) { log('대주 StopLoss 감시 오류: ' + (error.stack || error)); }
        finally { ticking = false; }
    }
    // 트레일링(2026-11-28 사용자 결정): KRX+NXT 통합 분봉(ka10080 _AL)이 끝날 때마다 한 번 판정. 등록(또는 다시 켠) 뒤 처음 끝나는 봉부터.
    // 봉이 끝나고 3초 뒤부터 5초 간격으로 그 봉을 찾고, 90초 안에 없으면(거래 없음) 그 봉은 넘어간다.
    // 종가 ≥ 이평이고 종가 < 매입단가일 때만 상환한다(매입단가 이상은 손절 조건에 맡김). 주문은 그때 현재가 기준으로 손절과 같은 방식.
    const trailTry = new Map();
    const hm = t => new Date(t + 9 * 3600000).toISOString().slice(11, 16);
    async function trailStep(t, seg, watching) {
        const fetched = new Map();
        for (const w of watching) {
            if (!trailActive(w) || running.has(w.id)) continue;
            const N = w.trailMin * 60000, end = Math.floor(t / N) * N, bar = end - N;
            if (t - end < 3000 || end <= (w.trailFrom || w.createdAt || 0) || (w.trailLast || 0) >= bar) continue;
            if (now() - (trailTry.get(w.id) || 0) < 5000) continue;
            trailTry.set(w.id, now());
            const giveUp = t - end > 90000, judged = (text, extra = {}) => { w.trailLast = bar; w.trail = { bar, at: now(), text, ...extra }; save(); };
            const key = w.code + ':' + w.trailMin;
            if (!fetched.has(key)) { const r = await call('chart', 'ka10080', { stk_cd: w.code + '_AL', tic_scope: String(w.trailMin), upd_stkpc_tp: '0' }); fetched.set(key, Array.isArray(r.stk_min_pole_chart_qry) ? minuteBars(r.stk_min_pole_chart_qry) : { error: r.return_msg || r.error || r.networkError || '응답 없음' }); }
            const bars = fetched.get(key);
            if (bars.error) { if (giveUp) { judged(`${hm(bar)}봉 분봉 조회 실패: ${bars.error}`); event(w, '트레일링', `${hm(bar)}봉 분봉 조회 실패(${bars.error}) · 이 봉은 판정하지 못했습니다`); } continue; }
            const i = bars.findIndex(b => b.t === bar);
            if (i < 0) { if (giveUp) judged(`${hm(bar)}봉 없음(거래 없음)`); continue; }
            if (i + 1 < w.trailMa) { judged(`이평 ${w.trailMa}개 봉이 모자람`); continue; }
            const close = bars[i].close, ma = Math.round(bars.slice(i + 1 - w.trailMa, i + 1).reduce((a, b) => a + b.close, 0) / w.trailMa * 100) / 100;
            const info = { close, ma }, maText = `${w.trailMin}분봉 ${hm(bar)} 종가 ${won(close)} ${close >= ma ? '≥' : '<'} ${w.trailMa}이평 ${won(ma)}`;
            if (close < ma) { judged(maText, info); continue; }
            if (w.avgPrice && close >= w.avgPrice) { judged(maText + ` · 매입단가 ${won(w.avgPrice)} 이상이라 상환 안 함`, info); event(w, '트레일링', maText + ` · 매입단가 ${won(w.avgPrice)} 이상이라 상환하지 않습니다(손절 조건에 맡김)`); continue; }
            if (!seg || !seg.ex || seg.id === 'HOLD' || seg.ex === 'NXT' && !w.nxt) { const why = seg ? seg.label : '장 마감'; judged(maText + ` · ${why}이라 주문 안 함`, info); event(w, '트레일링', maText + ` · ${why}이라 주문하지 않았습니다`); continue; }
            judged(maText, info);
            const q = await quote(w.code, seg.ex), expected = !!seg.auction && !!q.exp;
            const price = expected ? q.exp : q.ok && q.cur && q.volume ? q.cur : close;
            if (!state.halted && !running.has(w.id) && w.status === '감시중') void fire(w, price, seg, seg.ex, '분봉', expected, '트레일링', `${maText} · 매입단가 ${won(w.avgPrice)} 미만 → ${seg.ex} ${expected ? '예상체결가' : '현재가'} ${won(price)} 기준`);
        }
    }
    function resumeTracking() { for (const w of state.watches) if (ACTIVE.has(w.status) && w.status !== '발동' && !running.has(w.id)) { running.add(w.id); event(w, '재시작', '서버 재시작 뒤 체결 추적을 이어 갑니다'); track(w).catch(e => log('대주 StopLoss 추적 오류: ' + e)).finally(() => running.delete(w.id)); } }
    function start() { if (timer) return; resumeTracking(); loadAccount().catch(() => {}); timer = setInterval(() => void step(), tickMs); timer.unref?.(); }
    function stop() { clearInterval(timer); timer = null; }

    function mount(app, { allowed }) {
        const guard = (req, res, next) => allowed(req) ? next() : res.status(403).json({ error: '대주 StopLoss는 관리자 계정만 쓸 수 있습니다' });
        const send = (res, fn) => Promise.resolve().then(fn).then(v => res.set('Cache-Control', 'no-store').json(v ?? { ok: true }))
            .catch(error => res.status(error.status || 502).set('Cache-Control', 'no-store').json({ error: error.status ? error.message : '키움 조회에 실패했습니다: ' + (error.message || error) }));
        const base = '/api/short-stoploss';
        app.get(base + '/state', guard, (req, res) => send(res, async () => { await loadAccount().catch(() => {}); if (!lotsAt) await loadLots(); return snapshot(); }));
        app.post(base + '/refresh', guard, (req, res) => send(res, async () => { await loadLots(); return snapshot(); }));
        app.post(base + '/watches', guard, (req, res) => send(res, () => create(req.body || {})));
        app.put(base + '/watches/:id', guard, (req, res) => send(res, () => update(req.params.id, req.body || {})));
        app.post(base + '/watches/:id/enabled', guard, (req, res) => send(res, () => setEnabled(req.params.id, !!req.body?.enabled)));
        app.delete(base + '/watches/:id', guard, (req, res) => send(res, () => { remove(req.params.id); return { ok: true }; }));
        app.get(base + '/watches/:id/log', guard, (req, res) => send(res, () => history(req.params.id)));
        app.post(base + '/watch-all', guard, (req, res) => send(res, () => setAll(!!req.body?.enabled)));
        app.post(base + '/resume', guard, (req, res) => send(res, () => resume()));
        app.post(base + '/adjust-until', guard, (req, res) => send(res, () => adjustUntil(String(req.body?.until || ''), { today: today(), maturity: String(req.body?.maturity || ''), openDate })));
    }
    async function ensure() { await loadAccount().catch(() => {}); if (!lotsAt) await loadLots(); }
    return { start, stop, step, mount, ensure, snapshot, create, update, setEnabled, setAll, remove, history, resume, loadLots, _state: () => state };
}

module.exports = { createShortStopLoss, tick, addTicks, floorTick, ceilTick, minuteBars, chaseCap, repriceFor, segmentAt, adjustUntil, addMonth };
