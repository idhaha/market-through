'use strict';
// NH PLUG (Namuh) current prices for VI stocks: KRX (oc), NXT (nc) and stock futures (vC).
// Limits from the NH spec: 2 websocket connections, 30 subscriptions each; REST 5 calls/s.
// A new token triggers an NH security notice, so one token is reused for its 24 h lifetime
// (kept in tokenFile across restarts) and reissued only after 401 / IGW40043.
const fs = require('node:fs');
const path = require('node:path');
const REST = 'https://api.nhplug.com:8443', SOCKET = 'wss://api.nhplug.com:7070/websocket';
const channels = { KRX: 'oc', NXT: 'nc', FUT: 'vC' };
const num = v => v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);
// NH stock ticks (oc/nc): chrate is unsigned in the spec sample, so the sign code decides the direction
// (4/5/8/9 = 하한/하락). value is the accumulated trade value in million KRW, the VI table's unit.
const falling = sign => ['4', '5', '8', '9'].includes(String(sign || '').trim());
const signedRate = (rate, sign) => { const n = num(rate); return n == null ? null : falling(sign) && n > 0 ? -n : n; };
const redact = text => String(text || '').replace(/[A-Za-z0-9_\-+\/=.]{24,}/g, '[redacted]').slice(0, 160);

function createNhQuoteFeed({ credentials, tokenFile, fetch = globalThis.fetch, WebSocket = require('ws'), now = Date.now,
    maxSubscriptions = 30, restPerSecond = 4, restIntervalMs = 5000, sendGapMs = 200, onQuote = () => {}, onEvent = () => {} } = {}) {
    let token = '', expiresAt = 0, tokenTask, socket, connecting = false, stopped = true, retry, failures = 0, restTimer;
    const wanted = new Map(), subscribed = new Map(), restKeys = new Map(), stats = new Map();
    // Websocket requests go one at a time: NH acks carry no key, so each ack belongs to the single
    // request in flight (subscribe or unsubscribe). Sends are spaced by sendGapMs (NH allows 10/s,
    // WSS10010), and a rejected key waits before it is tried again (2026-11-04 16:10 resubscribe storm).
    let inflight = null, nextSendAt = 0, holdUntil = 0, pumpTimer = null;
    const backoff = new Map();
    // NXT does not list every stock; NH answers 00500 "NXT 거래불가종목" for those. Such NXT keys are
    // never subscribed or polled, so they do not take websocket slots or REST calls.
    const nxtTradable = new Map(), probes = new Map(), requested = new Map();
    let restQueue = Promise.resolve();
    // Every REST call (probes and polling) shares one pace under the NH 5 calls/s limit.
    const paced = task => { const run = restQueue.then(task); restQueue = run.catch(() => {}).then(() => new Promise(r => setTimeout(r, Math.ceil(1000 / restPerSecond)))); return run; };
    const event = (type, detail = {}) => onEvent({ at: now(), type, ...detail });
    const id = (exchange, key) => exchange + ':' + key;
    function loadToken() {
        try {
            const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
            if (saved.token && saved.expiresAt > now() + 600000) { token = saved.token; expiresAt = saved.expiresAt; }
        } catch {}
    }
    async function accessToken() {
        if (token && expiresAt > now() + 600000) return token;
        if (!token && tokenFile) { loadToken(); if (token) return token; }
        if (tokenTask) return tokenTask;
        tokenTask = (async () => {
            const { appKey, secretKey } = credentials();
            if (!appKey || !secretKey) throw Error('NH API 설정이 필요합니다.');
            const url = new URL(REST + '/oauth2/token');
            for (const [k, v] of Object.entries({ appkey: appKey, appsecretkey: secretKey, grant_type: 'client_credentials', scope: 'oob' })) url.searchParams.set(k, v);
            const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000) });
            const data = await response.json().catch(() => ({}));
            if (!data.access_token) throw Error('NH 토큰 발급 실패 (' + response.status + ')');
            token = data.access_token; expiresAt = now() + Math.max(600, Number(data.expires_in) || 86400) * 1000;
            event('token_issued', { expiresAt });
            if (tokenFile) {
                fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
                fs.writeFileSync(tokenFile + '.tmp', JSON.stringify({ token, expiresAt }));
                fs.renameSync(tokenFile + '.tmp', tokenFile);
            }
            return token;
        })().finally(() => { tokenTask = null; });
        return tokenTask;
    }
    function invalidate() { token = ''; expiresAt = 0; if (tokenFile) try { fs.rmSync(tokenFile, { force: true }); } catch {} }
    async function rest(pathname, input) {
        const { appKey, secretKey } = credentials();
        const response = await fetch(REST + pathname, { method: 'POST', signal: AbortSignal.timeout(10000),
            headers: { 'content-type': 'application/json; charset=utf-8', authorization: 'Bearer ' + await accessToken(), 'x-client-id': appKey, 'x-client-secret': secretKey },
            body: JSON.stringify({ Input_0: input }) });
        const data = await response.json().catch(() => ({}));
        // 429 is a rate limit, not a token problem: never reissue the token for it.
        if (response.status === 401 || data.rsp_cd === 'IGW40043') { invalidate(); throw Error('NH 인증 만료'); }
        if (response.status === 429) throw Error('NH 호출 한도 초과');
        if (!response.ok || data.rsp_cd && data.rsp_cd !== '00000') throw Object.assign(Error('NH 조회 실패 ' + (data.rsp_cd || response.status)), { code: data.rsp_cd || String(response.status) });
        return data.Output_0 || {};
    }
    function stat(key) {
        if (!stats.has(key)) stats.set(key, { key, ticks: 0, rest: 0, priceChanges: 0, subscribedAt: null, firstTickAt: null, lastTickAt: null, gaps: [], lastPrice: null, errors: 0 });
        return stats.get(key);
    }
    function deliver(exchange, key, price, sourceTime, via, extra = {}) {
        const s = stat(id(exchange, key)), t = now();
        if (via === 'WS') {
            if (s.lastTickAt) { s.gaps.push(t - s.lastTickAt); if (s.gaps.length > 5000) s.gaps.splice(0, 2500); }
            s.ticks++; s.firstTickAt ??= t; s.lastTickAt = t;
        } else s.rest++;
        if (price !== s.lastPrice) s.priceChanges++;
        s.lastPrice = price;
        onQuote({ exchange, key, price, sourceTime, via, receivedAt: t, ...extra });
    }
    function receive(raw) {
        let message; try { message = JSON.parse(String(raw)); } catch { return; }
        const h = message.header || {}, b = message.body || {};
        const exchange = Object.keys(channels).find(k => channels[k] === h.tr_cd);
        if (!exchange) return;
        const key = String(h.tr_key || b.code || b.fuitem || '').trim();
        if (h.rsp_cd != null && !Object.keys(b).length || h.rsp_cd != null && !b.price && !b.fucurr) {
            const request = inflight, code = String(h.rsp_cd);
            if (!request || !request.key.startsWith(exchange + ':') || key && request.key !== id(exchange, key)) { event('ack_unmatched', { channel: h.tr_cd, code }); return; }
            clearTimeout(request.timer); inflight = null;
            if (request.op === '2') subscribed.delete(request.key);
            else if (code === '00000' || code === 'WSS10014') {
                // WSS10014: already registered on the server, so the key is subscribed.
                subscribed.set(request.key, request.entry); backoff.delete(request.key); restKeys.delete(request.key); stat(request.key).subscribedAt = now();
            } else {
                backoff.set(request.key, now() + (code === 'WSS10010' ? 6000 : 60000));
                fallback(request.key, request.entry);
                // WSS10009: NH counts more registrations than we do; pause new subscribes for a while.
                if (code === 'WSS10009') holdUntil = now() + 30000;
            }
            // WSS10010 blocks every send for 5 s.
            if (code === 'WSS10010') nextSendAt = Math.max(nextSendAt, now() + 6000);
            event('ack', { key: request.key, op: request.op, code, message: redact(h.rsp_msg) });
            pump();
            return;
        }
        const price = num(exchange === 'FUT' ? b.fucurr : b.price);
        if (!(price > 0)) return;
        deliver(exchange, key, price, String(exchange === 'FUT' ? b.futime : b.time || ''), 'WS',
            exchange === 'FUT' ? {} : { rate: signedRate(b.chrate, b.sign), amount: num(b.value) });
    }
    function send(trType, key, entry) {
        socket.send(JSON.stringify({ header: { token, tr_type: trType }, body: { tr_cd: channels[entry.exchange], tr_key: entry.key } }));
    }
    function fallback(key, entry) { if (!restKeys.has(key)) { restKeys.set(key, entry); event('rest_fallback', { key }); } }
    function sync() {
        for (const key of [...restKeys.keys()]) if (!wanted.has(key)) restKeys.delete(key);
        if (!socket || socket.readyState !== 1) { for (const [key, entry] of wanted) if (!subscribed.has(key)) fallback(key, entry); return; }
        pump();
    }
    function nextRequest() {
        // Unsubscribes first: a slot is free only after NH acknowledges the unsubscribe.
        for (const [key, entry] of subscribed) if (!wanted.has(key)) return { op: '2', key, entry };
        let wake = Infinity;
        for (const [key, entry] of wanted) {
            if (subscribed.has(key)) continue;
            const until = Math.max(backoff.get(key) || 0, holdUntil);
            // Subscriptions beyond the per-connection limit, or waiting after a rejection, use REST polling.
            if (subscribed.size >= maxSubscriptions) { fallback(key, entry); continue; }
            if (until > now()) { fallback(key, entry); wake = Math.min(wake, until); continue; }
            return { op: '1', key, entry };
        }
        return { wake };
    }
    function later(at) {
        if (pumpTimer || !Number.isFinite(at)) return;
        pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, Math.max(0, at - now())); pumpTimer.unref?.();
    }
    function pump() {
        if (!socket || socket.readyState !== 1 || inflight) return;
        if (nextSendAt > now()) return later(nextSendAt);
        const request = nextRequest();
        if (!request.op) return later(request.wake);
        send(request.op, request.key, request.entry); nextSendAt = now() + sendGapMs;
        event(request.op === '1' ? 'subscribe' : 'unsubscribe', { key: request.key });
        inflight = { ...request, timer: setTimeout(() => {
            if (inflight?.key !== request.key || inflight.op !== request.op) return;
            inflight = null; event('ack_timeout', { key: request.key, op: request.op });
            if (request.op === '2') subscribed.delete(request.key);
            else { backoff.set(request.key, now() + 30000); fallback(request.key, request.entry); }
            pump();
        }, 10000) };
        inflight.timer.unref?.();
    }
    function resetSocketState() { subscribed.clear(); if (inflight) clearTimeout(inflight.timer); inflight = null; backoff.clear(); holdUntil = 0; clearTimeout(pumpTimer); pumpTimer = null; }
    async function connect() {
        // NH closes an idle connection with no subscriptions ("Bye"), so connect only when needed.
        if (stopped || socket || connecting || !wanted.size) return;
        connecting = true;
        try {
            await accessToken(); if (stopped) return;
            const ws = new WebSocket(SOCKET, { handshakeTimeout: 10000 }); socket = ws;
            ws.on('open', () => { if (socket !== ws) return; failures = 0; resetSocketState(); event('open'); sync(); });
            ws.on('message', raw => { if (socket === ws) receive(raw); });
            ws.on('error', error => { if (socket === ws) event('error', { message: redact(error.message) }); });
            ws.on('close', (code, reason) => {
                if (socket !== ws) return;
                socket = null; resetSocketState(); sync();
                event('close', { code, reason: redact(reason) });
                if (!stopped && wanted.size) { retry = setTimeout(() => void connect(), Math.min(60000, 2000 * 2 ** Math.min(failures++, 5))); retry.unref?.(); }
            });
        } catch (error) {
            event('connect_failed', { message: redact(error.message) });
            if (!stopped) { retry = setTimeout(() => void connect(), 30000); retry.unref?.(); }
        } finally { connecting = false; }
    }
    async function pollRest() {
        for (const [key, entry] of restKeys) {
            if (stopped || !wanted.has(key)) continue;
            try {
                const output = await paced(() => entry.exchange === 'FUT'
                    ? rest('/krfuture/quote/v1/day', { iem_cd: 'K' + entry.key })
                    : rest('/krstock/quote/v1/currentPrice', { market_cd: entry.exchange, iem_cd: entry.key }));
                const price = num(entry.exchange === 'FUT' ? output.prpr : output.stck_prpr);
                // REST acml_tr_pbmn is in KRW (the websocket value is in million KRW).
                const amount = num(output.acml_tr_pbmn);
                if (price > 0) deliver(entry.exchange, entry.key, price, '', 'REST',
                    entry.exchange === 'FUT' ? {} : { rate: signedRate(output.prdy_ctrt, output.prdy_vrss_sign), amount: amount == null ? null : amount / 1e6 });
            } catch (error) {
                if (entry.exchange === 'NXT' && error.code === '00500') { markNxtUnavailable(entry.code); continue; }
                stat(key).errors++; event('rest_error', { key, message: redact(error.message) });
            }
        }
    }
    function scheduleRest() {
        restTimer = setTimeout(async () => { await pollRest().catch(() => {}); if (!stopped) scheduleRest(); }, restIntervalMs);
        restTimer.unref?.();
    }
    // code: 6-digit stock; futures: 8-character LS/NH futures codes (e.g. A116B000), nearest first.
    function markNxtUnavailable(code) {
        nxtTradable.set(code, false);
        if (wanted.delete(id('NXT', code))) { event('nxt_unavailable', { key: id('NXT', code) }); sync(); }
    }
    function addKeys(code, futures) {
        for (const [exchange, key] of [['KRX', code], ...(nxtTradable.get(code) === false ? [] : [['NXT', code]]), ...futures.map(f => ['FUT', f])])
            if (!wanted.has(id(exchange, key))) wanted.set(id(exchange, key), { exchange, key, code });
        sync(); void connect();
    }
    function watch(code, { future, futures = future ? [future] : [] } = {}) {
        futures = futures.filter(Boolean);
        // A later call (e.g. once the futures months are known) adds keys; keys already wanted stay.
        requested.set(code, futures);
        if (nxtTradable.has(code)) return addKeys(code, futures);
        // Ask once whether NXT lists the stock before giving it a subscription slot.
        if (!probes.has(code)) probes.set(code, paced(() => rest('/krstock/quote/v1/currentPrice', { market_cd: 'NXT', iem_cd: code }))
            .then(() => true, error => error.code !== '00500')
            .then(ok => { nxtTradable.set(code, ok); if (!ok) event('nxt_unavailable', { key: id('NXT', code) }); })
            .finally(() => probes.delete(code)));
        void probes.get(code).then(() => { if (requested.has(code)) addKeys(code, requested.get(code)); });
    }
    function unwatch(code) {
        requested.delete(code);
        for (const [key, entry] of wanted) if (entry.code === code) wanted.delete(key);
        sync();
        if (!wanted.size && socket) { const old = socket; socket = null; resetSocketState(); old.close(); event('idle_close'); }
    }
    function summary() {
        return [...stats.values()].map(s => {
            const gaps = [...s.gaps].sort((a, b) => a - b), q = p => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] : null;
            return { key: s.key, ticks: s.ticks, rest: s.rest, priceChanges: s.priceChanges, errors: s.errors,
                firstTickDelayMs: s.subscribedAt && s.firstTickAt ? s.firstTickAt - s.subscribedAt : null,
                gapMedianMs: q(0.5), gapP95Ms: q(0.95), gapMaxMs: gaps.at(-1) ?? null };
        });
    }
    function start() { if (!stopped) return; stopped = false; void connect(); scheduleRest(); }
    function stop() { stopped = true; clearTimeout(retry); clearTimeout(restTimer); resetSocketState(); const old = socket; socket = null; old?.close(); }
    return { start, stop, watch, unwatch, receive, summary, rest, accessToken,
        state: () => ({ connected: socket?.readyState === 1, wanted: wanted.size, subscribed: subscribed.size, rest: restKeys.size }) };
}
module.exports = { createNhQuoteFeed, channels };
