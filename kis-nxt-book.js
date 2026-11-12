'use strict';
// NXT 매수 10호가 평균 for the VI window's NXT rows (2026-11-12).
// NH ob is the KRX book only, so NXT rows (and the NXT-only 08:00~08:50 session) had no 호가 평균.
// KIS FHKST01010200 (inquire-asking-price-exp-ccn) with FID_COND_MRKT_DIV_CODE=NX returns the NXT book alone
// (checked 11/12 10:01: 1호가 잔량 KRX 24,809 · NXT 8,055 · UN 32,925). LS t1101 exchgubun=N returned the KRX book.
// Only the codes in set() are polled, one call at a time, every intervalMs.
const URL_PATH = '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn';
const num = v => v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);
// Same formula as the NH KRX book: mean of price × quantity over the levels that have a price.
function nxtBidAverage(o) {
    const amounts = Array.from({ length: 10 }, (_, i) => [num(o?.['bidp' + (i + 1)]), num(o?.['bidp_rsqn' + (i + 1)])])
        .filter(([p, q]) => p > 0 && q != null && q >= 0).map(([p, q]) => p * q);
    return amounts.length ? amounts.reduce((s, v) => s + v, 0) / amounts.length : null;
}
function createKisNxtBook({ credentials, getToken, http = require('axios'), now = Date.now, intervalMs = 5000, gapMs = 250,
    onQuote = () => {}, log = () => {} } = {}) {
    const wanted = new Set();
    let timer = null, running = false, lastError = '';
    async function poll(code) {
        const { domain, appKey, secretKey } = credentials();
        if (!domain || !appKey || !secretKey) throw Error('한투 키 없음');
        const r = await http.get(domain + URL_PATH, {
            params: { FID_COND_MRKT_DIV_CODE: 'NX', FID_INPUT_ISCD: code },
            headers: { authorization: 'Bearer ' + await getToken(), appkey: appKey, appsecret: secretKey, tr_id: 'FHKST01010200', custtype: 'P' }, timeout: 8000
        });
        const j = r.data || {};
        if (String(j.rt_cd) !== '0') throw Error(String(j.msg1 || j.msg_cd || '응답 오류').slice(0, 80));
        const value = nxtBidAverage(j.output1);
        // No priced level: no NXT book for this stock right now. Nothing is sent, so the cell keeps its last value.
        if (value != null) onQuote({ exchange: 'NXT', key: code, bidAverage: value, via: 'KIS', receivedAt: now() });
    }
    async function round() {
        if (running) return;
        running = true;
        try {
            for (const code of [...wanted]) {
                try { await poll(code); if (lastError) { log(`[VI NXT 호가] 한투 조회 다시 됨`); lastError = ''; } }
                catch (e) { const text = String(e?.response?.status || '') + ' ' + String(e?.message || e); if (text !== lastError) log(`[VI NXT 호가] 한투 NX 호가 조회 실패: ${text.trim()}`); lastError = text; }
                await new Promise(r => setTimeout(r, gapMs));
            }
        } finally { running = false; }
    }
    function set(codes) {
        const next = new Set(codes);
        const added = [...next].some(c => !wanted.has(c));
        wanted.clear(); for (const c of next) wanted.add(c);
        if (!wanted.size) { clearInterval(timer); timer = null; return; }
        if (!timer) { timer = setInterval(round, intervalMs); timer.unref?.(); }
        if (added) void round();
    }
    const stop = () => set([]);
    return { set, stop, watched: () => [...wanted] };
}
module.exports = { createKisNxtBook, nxtBidAverage };
