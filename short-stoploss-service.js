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
    if (m >= 540 && m < 920) return { id: 'KRX', ex: 'KRX', label: 'KRX 정규장' };
    if (m >= 920 && m < 930) return { id: 'KRX_CLOSE', ex: 'KRX', label: 'KRX 종가 단일가' };
    if (m >= 930 && m < 1200) return { id: 'NXT_AFTER', ex: 'NXT', label: 'NXT 애프터마켓' };
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
function createShortStopLoss({ directory, http, getToken, rejectToken = () => {}, enabled = () => false, openDate = () => null, now = Date.now, log = () => {}, wait = ms => new Promise(r => setTimeout(r, ms)), tickMs = 1000, balanceMs = 30000, realtime = null, testCodes = () => [], realtimeLogMs = 30000 }) {
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
        if (key !== rtItems) { rtItems = key; try { realtime.set('3', key ? key.split(',') : [], ['0B']); } catch (e) { log('대주 StopLoss 실시간 등록 오류: ' + e.message); } }
        if (!rtAccount && enabled()) { rtAccount = true; try { realtime.set('4', [''], ['00', '04']); } catch (e) { log('대주 StopLoss 실시간 등록 오류: ' + e.message); } }
    }
    function onReal(d) {
        const type = String(d.type || ''), item = String(d.item || ''), v = d.values || {};
        (rtCounts[type] = rtCounts[type] || {})[item || '-'] = (rtCounts[type][item || '-'] || 0) + 1;
        if (type === '00') {
            rtOrders.push({ at: now(), 주문번호: v['9203'], 종목: v['9001'], 상태: v['913'], 구분: v['905'], 신용: v['922'], 대출일: v['923'], 수량: v['900'], 가격: v['901'], 미체결: v['902'], 체결가: v['910'], 체결량: v['911'], 거래소: v['2135'] }); if (rtOrders.length > 200) rtOrders.shift();
            noteOrderEvent(v);
            return;
        }
        if (type !== '0B') return;
        const price = abs(v['10']); if (!price) return;
        const ex = /_NX$/.test(item) ? 'NXT' : 'KRX', code = code6(item), seg = segmentAt(now(), openDate);
        // KRX 정규장(09:00~15:20)에는 KRX와 NXT 체결을 모두 본다(주문은 KRX). 그 밖에는 주문 거래소의 체결만.
        if (!seg || seg.id === 'KRX_CLOSE' || !enabled() || state.halted) return;
        if (seg.ex !== ex && !(seg.id === 'KRX' && ex === 'NXT')) return;
        for (const w of state.watches) {
            if (w.code !== code || w.status !== '감시중' || !w.enabled || running.has(w.id) || (ex === 'NXT' && !w.nxt)) continue;
            w.lastCheck = { at: now(), ex, price, live: true, text: `${ex} ${price.toLocaleString('ko-KR')} ${price >= w.trigger ? '≥' : '<'} ${w.trigger.toLocaleString('ko-KR')} · 실시간` };
            if (price >= w.trigger) void fire(w, price, seg, ex, '실시간');
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
            watches: state.watches.filter(w => !ENDED.has(w.status)).map(w => ({ id: w.id, name: w.name, status: w.status, enabled: w.enabled, trigger: w.trigger, lastCheck: w.lastCheck ? { at: new Date(w.lastCheck.at).toISOString(), text: w.lastCheck.text, live: !!w.lastCheck.live } : null })) };
        rtCounts = {};
        try { fs.appendFileSync(path.join(directory, 'realtime-' + kstParts(now()).day + '.jsonl'), JSON.stringify(line) + '\n'); } catch {}
    }
    const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 1)); fs.renameSync(tmp, file); };
    const event = (w, kind, text, data) => { w.log = w.log || []; w.log.push({ at: now(), kind, text, ...(data ? { data } : {}) }); if (w.log.length > 300) w.log.splice(0, w.log.length - 300); };

    // 재시작: 주문이 걸려 있던 건은 추적만 이어 가고, 주문 전 "발동"에서 멈춘 건은 다시 발동하지 않는다.
    for (const w of state.watches) {
        if (w.status === '발동' && !(w.orders || []).some(o => o.ordNos?.length)) { w.status = '확인 필요'; w.enabled = false; event(w, '재시작', '주문 전에 서버가 멈췄습니다. 영웅문에서 주문 여부를 확인하세요.'); }
    }
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
        if (r.acctNo) account = String(r.acctNo).slice(0, 4) + '-' + String(r.acctNo).slice(4, 8);
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
    // 대주 잔고: kt00018 개별(대출일별, crd_tp_nm "대주") + ka10085 만기일.
    async function loadLots() {
        const [b, p] = [await call('acnt', 'kt00018', { qry_tp: '2', dmst_stex_tp: 'KRX' }), await call('acnt', 'ka10085', { stex_tp: '0' })];
        if (!Array.isArray(b.acnt_evlt_remn_indv_tot)) { lotsError = b.return_msg || b.error || '잔고 조회 실패'; return lots; }
        const maturity = new Map();
        for (const r of p.acnt_prft_rt || []) if (/^\d{8}$/.test(r.loan_dt) && r.loan_dt !== '00000000') maturity.set(code6(r.stk_cd) + ':' + r.loan_dt, r.expr_dt);
        const next = [];
        for (const r of b.acnt_evlt_remn_indv_tot) {
            if (!/대주/.test(r.crd_tp_nm || '') || !/^\d{8}$/.test(r.crd_loan_dt || '')) continue;
            const code = code6(r.stk_cd);
            next.push({ key: code + ':' + r.crd_loan_dt, code, name: String(r.stk_nm || '').replace(/^\//, ''), loanDt: ymd(r.crd_loan_dt), loanRaw: r.crd_loan_dt,
                maturity: ymd(maturity.get(code + ':' + r.crd_loan_dt) || ''), qty: abs(r.rmnd_qty), able: abs(r.trde_able_qty), sellPrice: abs(r.pur_pric), price: abs(r.cur_prc), pl: num(r.evltv_prft), rate: num(r.prft_rt) });
        }
        for (const lot of next) lot.nxt = await nxtEligible(lot.code);
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

    function validate(input, lot) {
        const t = Math.round(num(input.trigger)), ticks = Math.round(num(input.ticks)), chasePct = Math.round(num(input.chasePct));
        const qtyMode = input.qtyMode === 'shares' ? 'shares' : 'pct', qtyValue = Math.round(num(input.qtyValue));
        if (!(t > 0)) throw Object.assign(Error('감시가를 입력하세요'), { status: 400 });
        if (!(ticks >= 1 && ticks <= 10)) throw Object.assign(Error('틱은 1~10입니다'), { status: 400 });
        if (!(chasePct >= 1 && chasePct <= 10)) throw Object.assign(Error('추격 한도는 1~10%입니다'), { status: 400 });
        if (qtyMode === 'pct' && !(qtyValue >= 10 && qtyValue <= 100 && qtyValue % 10 === 0)) throw Object.assign(Error('수량 %는 10~100%입니다'), { status: 400 });
        if (qtyMode === 'shares' && !(qtyValue >= 1)) throw Object.assign(Error('주 수를 입력하세요'), { status: 400 });
        const until = adjustUntil(String(input.until || addMonth(today())), { today: today(), maturity: lot.maturity, openDate });
        return { trigger: t, ticks, upperLimit: !!input.upperLimit, fix: input.fix !== false, chasePct, qtyMode, qtyValue,
            allLots: !!input.allLots, cancelPending: input.cancelPending !== false, until: until.value, untilNote: until.note };
    }
    async function create(input) {
        if (!lotsAt) await loadLots();
        const lot = lots.find(l => l.key === input.lotKey);
        if (!lot) throw Object.assign(Error('대주 잔고에서 그 행을 찾지 못했습니다'), { status: 404 });
        const w = { id: crypto.randomBytes(6).toString('hex'), lotKey: lot.key, code: lot.code, name: lot.name, loanDt: lot.loanDt, loanRaw: lot.loanRaw, maturity: lot.maturity, nxt: lot.nxt,
            ...validate(input, lot), enabled: input.enabled !== false, status: '감시중', createdAt: now(), lastCheck: null, note: '', orders: [], log: [] };
        if (!w.enabled) w.status = '중지';
        event(w, '등록', `감시가 ${w.trigger.toLocaleString('ko-KR')} · +${w.ticks}틱${w.upperLimit ? ' · 상한가' : ''} · 정정 ${w.fix ? '켜짐(한도 ' + w.chasePct + '%)' : '꺼짐'} · ${w.qtyMode === 'pct' ? w.qtyValue + '%' : w.qtyValue + '주'} · ~${w.until}`);
        state.watches.push(w); save();
        return publicWatch(w);
    }
    function find(id) { const w = state.watches.find(x => x.id === id); if (!w) throw Object.assign(Error('감시 건을 찾지 못했습니다'), { status: 404 }); return w; }
    function update(id, input) {
        const w = find(id);
        if (ACTIVE.has(w.status) || running.has(w.id)) throw Object.assign(Error('주문 처리 중에는 고칠 수 없습니다'), { status: 409 });
        if (['체결완료', '부분체결', '잔고없음'].includes(w.status)) throw Object.assign(Error('끝난 건은 고칠 수 없습니다'), { status: 409 });
        Object.assign(w, validate(input, { maturity: w.maturity }));
        if (w.status === '만료' || w.status === '실패' || w.status === '확인 필요') { w.status = w.enabled ? '감시중' : '중지'; }
        event(w, '수정', `감시가 ${w.trigger.toLocaleString('ko-KR')} · +${w.ticks}틱 · ~${w.until}`);
        save(); return publicWatch(w);
    }
    function setEnabled(id, on) {
        const w = find(id);
        if (ACTIVE.has(w.status) || ENDED.has(w.status) && w.status !== '만료') throw Object.assign(Error('이 건은 감시를 켜고 끌 수 없습니다'), { status: 409 });
        if (w.status === '만료') throw Object.assign(Error('만료된 건은 유효기간을 연장한 뒤 켜세요'), { status: 409 });
        w.enabled = !!on; w.status = on ? '감시중' : '중지'; event(w, on ? '감시' : '중지', on ? '감시를 켰습니다' : '감시를 껐습니다'); save();
        return publicWatch(w);
    }
    function setAll(on) { for (const w of state.watches) if (['감시중', '중지'].includes(w.status)) { w.enabled = !!on; w.status = on ? '감시중' : '중지'; } save(); return snapshot(); }
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
    async function orderState(code, ex, ordNos) {
        const oso = await call('acnt', 'ka10075', { all_stk_tp: '1', trde_tp: '2', stk_cd: code, stex_tp: ex === 'NXT' ? '2' : '1' });
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
            const exOf = r.stex_tp_txt === 'NXT' || r.stex_tp === '2' ? 'NXT' : 'KRX';
            const c = await cancelOrder(w.code, exOf, r.ord_no);
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

    async function fire(w, firePrice, seg, srcEx = seg.ex, via = '조회') {
        running.add(w.id);
        try {
            w.status = '발동'; w.firedAt = now(); w.firePrice = firePrice; w.fireEx = seg.ex; w.enabled = false;
            w.fireSrc = srcEx; w.fireVia = via;
            event(w, '발동', `${srcEx} ${seg.id === 'KRX_CLOSE' ? '예상체결가' : '체결가'} ${firePrice.toLocaleString('ko-KR')} ≥ 감시가 ${w.trigger.toLocaleString('ko-KR')} · ${via} 판정 · 주문 거래소 ${seg.ex}`);
            save();
            await loadLots();
            let targets = lots.filter(l => l.code === w.code && (w.allLots || l.key === w.lotKey)).sort((a, b) => String(a.maturity).localeCompare(String(b.maturity)));
            if (w.cancelPending && targets.some(l => l.able < l.qty)) { await cancelPendingCovers(w, seg.ex); await loadLots(); targets = lots.filter(l => targets.some(t => t.key === l.key)); }
            const q = await quote(w.code, seg.ex);
            const upper = q.upper || 0, cap = w.fix ? chaseCap(firePrice, w.chasePct, upper) : (upper || Infinity);
            w.orders = [];
            for (const lot of targets) {
                const qty = w.qtyMode === 'pct' ? Math.max(1, Math.floor(lot.able * w.qtyValue / 100)) : Math.min(w.qtyValue, lot.able);
                if (!(lot.able >= 1) || !(qty >= 1)) { event(w, '잔고 확인', `대출일 ${lot.loanDt} 가능수량 0 · 주문하지 않음`); continue; }
                event(w, '잔고 확인', `대출일 ${lot.loanDt} 가능수량 ${lot.able}주 → ${qty}주 상환`);
                const o = { loanRaw: lot.loanRaw, qty, ex: seg.ex, ordNos: [], price: 0, filled: 0, attempts: 0, state: '주문', cap, upper };
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
                    if (o.ex === 'KRX' && seg?.id === 'NXT_AFTER' && w.nxt && !o.rerouted) {
                        o.rerouted = true; o.ex = 'NXT'; o.qty -= o.filled; o.filled = 0; o.ordNos = []; o.attempts = 0;
                        const ask = await bestAsk(w.code, 'NXT'); const price = Math.min(o.cap, addTicks(ask || w.firePrice, w.ticks));
                        event(w, '재주문', `KRX 마감 뒤 남은 ${o.qty}주를 NXT로 다시 냅니다`);
                        if (!await sendCover(w, o, price)) o.state = '실패';
                        pending = true; continue;
                    }
                    o.state = '끝'; event(w, '결과', `${o.ex} 미체결 수량이 없어졌습니다(체결 ${o.filled}/${o.qty}주). 거부 · 직접 취소 여부를 확인하세요.`);
                    continue;
                }
                pending = true;
                if (w.fix && !w.upperLimit && o.attempts < 3 && seg && seg.id !== 'HOLD') {
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
        w.note = filled ? `${w.firePrice.toLocaleString('ko-KR')} 발동 → ${filled}/${total}주 체결${prices.length ? ' · ' + [...new Set(prices)].map(p => p.toLocaleString('ko-KR')).join(', ') : ''}` : '체결 없음';
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
            if (!seg || !seg.ex) { for (const w of watching) w.lastCheck = { at: t, text: seg ? seg.label + ' · 판정 안 함' : '장 시간 아님' }; return; }
            // 공용 실시간이 붙어 있으면 0B가 바로 판정하므로 조회는 5초 간격 보조(종가 단일가 15:20~15:30은 0B가 없어 1초 조회).
            if (realtime?.connected() && seg.id !== 'KRX_CLOSE' && now() - lastPollAt < 5000) return;
            lastPollAt = now();
            const codes = [...new Set(watching.filter(w => seg.ex === 'KRX' || w.nxt).map(w => w.code))];
            for (const w of watching) if (seg.ex === 'NXT' && !w.nxt) w.lastCheck = { at: t, text: 'NXT 비대상 · 09:00 KRX 대기' };
            for (const code of codes) {
                const group = watching.filter(x => x.code === code);
                // KRX 정규장에는 NXT 체결도 본다(실시간이 끊겨 조회로 감시할 때). 오늘 체결이 있는 쪽만 쓴다.
                const sources = [seg.ex];
                if (seg.id === 'KRX' && group.some(w => w.nxt)) sources.push('NXT');
                const seen = [];
                for (const ex of sources) {
                    const q = await quote(code, ex);
                    const price = seg.id === 'KRX_CLOSE' ? q.exp : q.cur;
                    if (q.ok && price && (seg.id === 'KRX_CLOSE' || q.volume)) seen.push({ ex, price });
                }
                for (const w of group) {
                    const usable = seen.filter(s => s.ex === seg.ex || w.nxt);
                    if (!usable.length) { w.lastCheck = { at: now(), ex: seg.ex, text: `${seg.ex} 오늘 체결 없음` }; continue; }
                    const best = usable.reduce((a, b) => (b.price > a.price ? b : a));
                    w.lastCheck = { at: now(), ex: best.ex, price: best.price, text: usable.map(s => `${s.ex} ${s.price.toLocaleString('ko-KR')}`).join(' · ') + ` ${best.price >= w.trigger ? '≥' : '<'} ${w.trigger.toLocaleString('ko-KR')}` };
                    if (best.price >= w.trigger && !state.halted) void fire(w, best.price, seg, best.ex, '조회');
                }
            }
        } catch (error) { log('대주 StopLoss 감시 오류: ' + (error.stack || error)); }
        finally { ticking = false; }
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
    return { start, stop, step, mount, snapshot, create, update, setEnabled, setAll, remove, history, resume, loadLots, _state: () => state };
}

module.exports = { createShortStopLoss, tick, addTicks, floorTick, chaseCap, repriceFor, segmentAt, adjustUntil, addMonth };
