'use strict';
// 주식선물 가격제한 도달 감시 (2026-11-14 정책). VI 창의 선물 행을 만드는 판단만 하고, 행 · 화면은 vi-monitor-service.js가 맡는다.
//
// 거래소 규정(장내파생상품 거래설명서, 2026.09): "주식 관련 선물 기준종목의 약정가격이 상·하한가에 도달한 후 5분이 경과하면
// 가격제한비율을 동일 방향의 다음 단계로 확대". 약정가격 = 체결이므로 호가는 보지 않는다.
//  - 감시 월물(기준종목): 종목마다 최근월 · 차월 중 전일 거래량이 많은 월물(vi-monitor-service.js가 정해 등록한다).
//  - 근처 신호: LS JD0(실시간 상·하한가). dy_gubun 2 = 첫 체결 전 그날 상·하한가, 1 = 체결마다 바뀌는 실시간 범위(직전 체결가 ± α,
//    그날 한도를 넘지 않음). 실시간 상한가가 그날 상한가와 같아지면(하한은 반대) 직전 체결가가 한도 α 안쪽이라는 뜻이다.
//  - 근처가 되면 그 월물의 실시간 체결(LS JC0)을 등록하고, 체결가가 한도와 같아지는 순간을 도달(발동)로 본다.
//    근처가 풀리면 판정상 바로 해지하지만 실제 해지 요청은 unsubscribeDelayMs(30초) 늦춘다. 그 사이 다시 근처가 되면 해지를 취소한다.
//    근처가 된 순간에는 마지막 체결을 한 번 조회해(checkLast, LS t8404) 등록 전에 이미 한도에서 체결된 것도 잡는다
//    (08:45 시가 · 15:45 종가 단일가가 한도에서 결정된 경우도 여기서 잡힌다).
//  - 확대(LS JX0) 뒤에는 실시간 가격제한이 풀려 JD0이 멈춘다(11/12: 확대된 13월물 중 11개는 확대 뒤 JD0 0건). 그래서 확대된 월물은
//    그날 체결 등록을 유지하고, 체결가가 JX0의 새 한도와 같아지면 다음 단계 도달로 본다.
//  - 행이 켜져 있는 월물(setPinned)은 해지하지 않는다(확대 뒤 첫 체결로 해제 때 값을 잡는다).
//  - LS JIF(장운영정보)는 그대로 넘긴다(CB 발동 · 재개로 '가격제한폭 先확대'를 판정).
const num = v => v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const abs = v => { const n = num(v); return n == null ? null : Math.abs(n); };
// HHMMSS(…) of today (KST) → ms; else the receive time.
function clockAt(raw, receivedAt) {
    const s = String(raw || '').trim();
    if (!/^([01]\d|2[0-3])[0-5]\d[0-5]\d/.test(s)) return receivedAt;
    const day = new Date(receivedAt + 9 * 3600000).toISOString().slice(0, 10);
    const t = Date.parse(`${day}T${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}+09:00`);
    return Number.isFinite(t) && t <= receivedAt + 60000 ? t : receivedAt;
}
function createFuturesLimitWatch({ now = Date.now, unsubscribeDelayMs = 30000, checkLastMs = 60000, onHit = () => {}, onExpand = () => {}, onTrade = () => {},
    onMarket = () => {}, onSubscriptions = () => {}, needLimits = () => {}, checkLast = null, timer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
    clear = t => clearTimeout(t) } = {}) {
    const contracts = new Map(), wanted = new Set(), removals = new Map();
    let pinned = new Set(), day = '';
    const dayKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
    function state(code) {
        if (day !== dayKey(now())) { day = dayKey(now()); contracts.clear(); }
        let s = contracts.get(code);
        if (!s) { s = { code, up: null, dn: null, upStep: 1, dnStep: 1, near: false, expanded: false, hit: { up: 0, down: 0 }, lastTrade: null, checkedAt: 0 }; contracts.set(code, s); }
        return s;
    }
    // The JC0 set: near-limit months, expanded months and months with a row on the window.
    function desired() { return new Set([...contracts.values()].filter(s => s.near || s.expanded).map(s => s.code).concat([...pinned])); }
    function sync() {
        const next = desired();
        let changed = false;
        for (const code of next) {
            if (removals.has(code)) { clear(removals.get(code)); removals.delete(code); }
            if (!wanted.has(code)) { wanted.add(code); changed = true; }
        }
        for (const code of [...wanted]) {
            if (next.has(code) || removals.has(code)) continue;
            removals.set(code, timer(() => { removals.delete(code); if (!desired().has(code)) { wanted.delete(code); onSubscriptions([...wanted]); } }, unsubscribeDelayMs));
        }
        if (changed) onSubscriptions([...wanted]);
    }
    function hitCheck(s, trade) {
        for (const side of ['up', 'down']) {
            const limit = side === 'up' ? s.up : s.dn, step = side === 'up' ? s.upStep : s.dnStep;
            if (!(limit > 0) || s.hit[side] >= step) continue;
            if (side === 'up' ? trade.price >= limit : trade.price <= limit) {
                s.hit[side] = step;
                onHit({ futcode: s.code, side, stage: step, limit, price: trade.price, at: trade.at, cpower: trade.cpower ?? null, via: trade.via });
            }
        }
    }
    async function lookBack(s) {
        if (!checkLast || now() - s.checkedAt < checkLastMs) return;
        s.checkedAt = now();
        try {
            const last = await checkLast(s.code, { up: s.up, dn: s.dn });
            if (last && last.price > 0) { s.lastTrade = { ...last, via: last.via || 'LS t8404' }; hitCheck(s, s.lastTrade); }
        } catch {}
    }
    function receive(tr, body = {}, receivedAt = now()) {
        if (tr === 'JIF') { onMarket({ market: String(body.jangubun ?? '').trim(), status: String(body.jstatus ?? '').trim(), at: receivedAt }); return; }
        const code = String(body.futcode || '').trim();
        if (!/^[A-Z0-9]{8}$/.test(code)) return;
        const s = state(code);
        if (tr === 'JD0') {
            const gubun = String(body.dy_gubun ?? '').trim(), up = abs(body.dy_uplmtprice), dn = abs(body.dy_dnlmtprice);
            if (gubun === '2') {
                // The day's limits (stage 1) before the first trade; after an expansion the message carries the wider limits.
                if (s.upStep === 1 && up > 0) s.up = up;
                if (s.dnStep === 1 && dn > 0) s.dn = dn;
                return;
            }
            if (gubun !== '1') return;
            if (!(s.up > 0) || !(s.dn > 0)) { needLimits(code); return; }
            const near = s.upStep === 1 && up >= s.up || s.dnStep === 1 && dn <= s.dn;
            if (near !== s.near) { s.near = near; sync(); if (near) void lookBack(s); }
            return;
        }
        if (tr === 'JX0') {
            const up = num(body.upstep) || 1, dn = num(body.dnstep) || 1, upLimit = abs(body.uplmtprice), dnLimit = abs(body.dnlmtprice);
            const events = [];
            if (up > s.upStep) events.push({ side: 'up', step: up, limit: upLimit, prevLimit: s.up });
            if (dn > s.dnStep) events.push({ side: 'down', step: dn, limit: dnLimit, prevLimit: s.dn });
            // A wider limit replaces the stage-1 limit of that side only.
            if (up > s.upStep) { s.upStep = up; if (upLimit > 0) s.up = upLimit; }
            if (dn > s.dnStep) { s.dnStep = dn; if (dnLimit > 0) s.dn = dnLimit; }
            if (events.length) { s.expanded = true; s.near = false; sync(); }
            for (const e of events) onExpand({ futcode: code, ...e, at: receivedAt, body });
            return;
        }
        if (tr === 'JC0') {
            const price = abs(body.price);
            if (!(price > 0)) return;
            const trade = { price, at: clockAt(body.chetime, receivedAt), cpower: num(body.cpower), via: 'LS JC0' };
            s.lastTrade = trade;
            onTrade({ futcode: code, ...trade, receivedAt });
            hitCheck(s, trade);
        }
    }
    function setLimits(code, { up, dn }) { const s = state(code); if (s.upStep === 1 && up > 0) s.up = up; if (s.dnStep === 1 && dn > 0) s.dn = dn; }
    function setPinned(codes) { pinned = new Set(codes); sync(); }
    function limits(code) { const s = contracts.get(code); return s ? { up: s.up, dn: s.dn, upStep: s.upStep, dnStep: s.dnStep, near: s.near, expanded: s.expanded } : null; }
    return { receive, setLimits, setPinned, limits, subscriptions: () => [...wanted], lastTrade: code => contracts.get(code)?.lastTrade || null,
        stop() { for (const t of removals.values()) clear(t); removals.clear(); } };
}
module.exports = { createFuturesLimitWatch, clockAt };
