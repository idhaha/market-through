const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {EventEmitter} = require('node:events');
const {createNhQuoteFeed} = require('../../nh-quote-feed');

function fixture(t, options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-feed-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const sockets = [], fetches = [], quotes = [], events = [];
    class Socket extends EventEmitter {
        constructor() { super(); this.sent = []; this.readyState = 0; sockets.push(this); setImmediate(() => { this.readyState = 1; this.emit('open'); }); }
        send(text) { this.sent.push(JSON.parse(text)); }
        close() { this.readyState = 3; this.emit('close', 1000, ''); }
        ack(code = '00000') { const last = this.sent.at(-1).body; this.emit('message', JSON.stringify({header: {tr_cd: last.tr_cd, tr_key: last.tr_key, rsp_cd: code, rsp_msg: 'ok'}})); }
    }
    const fetch = async (url, init) => {
        fetches.push(String(url));
        if (String(url).includes('/oauth2/token')) return {status: 200, ok: true, json: async () => ({access_token: 'tok-' + fetches.length, expires_in: 86400})};
        return options.rest ? options.rest(String(url), JSON.parse(init.body)) : {status: 200, ok: true, json: async () => ({rsp_cd: '00000', Output_0: {stck_prpr: '1000', prpr: '1010'}})};
    };
    const feed = createNhQuoteFeed({credentials: () => ({appKey: 'k', secretKey: 's'}), tokenFile: path.join(dir, 'token.json'),
        fetch, WebSocket: Socket, maxSubscriptions: options.max ?? 30, restIntervalMs: 60000, sendGapMs: options.gap ?? 0,
        onQuote: q => quotes.push(q), onEvent: e => events.push(e)});
    t.after(() => feed.stop());
    return {feed, sockets, fetches, quotes, events, dir};
}
const tick = () => new Promise(r => setImmediate(r));

test('subscribes KRX, NXT and futures one at a time and parses pushes', async t => {
    const f = fixture(t);
    f.feed.start(); f.feed.watch('005930', {future: 'A116B000'});
    await tick(); await tick(); await tick();
    const ws = f.sockets[0];
    assert.deepEqual(ws.sent.map(m => m.body), [{tr_cd: 'oc', tr_key: '005930'}]);
    ws.ack(); ws.ack(); ws.ack();
    assert.deepEqual(ws.sent.map(m => m.body.tr_cd), ['oc', 'nc', 'vC']);
    assert.equal(ws.sent[2].body.tr_key, 'A116B000');
    ws.emit('message', JSON.stringify({header: {tr_cd: 'oc', tr_key: '005930'}, body: {code: '005930', time: '10:00:01', price: '100500'}}));
    ws.emit('message', JSON.stringify({header: {tr_cd: 'vC', tr_key: 'A116B000'}, body: {fuitem: 'A116B000', futime: '10:00:01', fucurr: '101000'}}));
    assert.deepEqual(f.quotes.map(q => [q.exchange, q.key, q.price, q.via]), [['KRX', '005930', 100500, 'WS'], ['FUT', 'A116B000', 101000, 'WS']]);
    f.feed.unwatch('005930');
    // With nothing left to watch the connection closes, which also drops every NH registration.
    assert.equal(ws.readyState, 3);
    assert.ok(f.events.some(e => e.type === 'idle_close'));
});

test('keys beyond the subscription limit use REST, and the token is reused from file', async t => {
    const f = fixture(t, {max: 1});
    f.feed.start(); f.feed.watch('005930');
    await tick(); await tick(); await tick();
    f.sockets[0].ack();
    assert.deepEqual(f.feed.state(), {connected: true, wanted: 2, subscribed: 1, rest: 1});
    assert.equal(f.fetches.filter(u => u.includes('/oauth2/token')).length, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(f.dir, 'token.json'), 'utf8'));
    assert.ok(saved.token && saved.expiresAt > Date.now());
    // A second feed (e.g. after a restart) must not issue another token.
    const g = createNhQuoteFeed({credentials: () => ({appKey: 'k', secretKey: 's'}), tokenFile: path.join(f.dir, 'token.json'),
        fetch: async () => { throw Error('must not request a token'); }});
    assert.equal(await g.accessToken(), saved.token);
});

test('429 keeps the token while 401 drops it', async t => {
    let status = 429;
    const f = fixture(t, {rest: async () => ({status, ok: false, json: async () => ({})})});
    await assert.rejects(f.feed.rest('/krstock/quote/v1/currentPrice', {}), /한도/);
    assert.ok(fs.existsSync(path.join(f.dir, 'token.json')));
    status = 401;
    await assert.rejects(f.feed.rest('/krstock/quote/v1/currentPrice', {}), /인증/);
    assert.ok(!fs.existsSync(path.join(f.dir, 'token.json')));
});

test('a stock NXT does not list is neither subscribed nor polled on NXT (00500)', async t => {
    // 2026-11-04 live: NH answered 00500 "NXT 거래불가종목" every 5 s for such keys.
    const restCalls = [];
    const f = fixture(t, {max: 1, rest: (url, body) => {
        restCalls.push(body.Input_0);
        if (body.Input_0.market_cd === 'NXT' && body.Input_0.iem_cd === '239610') return {status: 200, ok: true, json: async () => ({rsp_cd: '00500', rsp_msg: 'NXT 거래불가종목 입니다.'})};
        return {status: 200, ok: true, json: async () => ({rsp_cd: '00000', Output_0: {stck_prpr: '5830'}})};
    }});
    f.feed.start(); f.feed.watch('239610');
    for (let i = 0; i < 6; i++) await tick();
    await new Promise(r => setTimeout(r, 300));
    const ws = f.sockets[0];
    assert.deepEqual(ws.sent.map(m => m.body), [{tr_cd: 'oc', tr_key: '239610'}]);
    assert.equal(f.feed.state().wanted, 1);
    assert.ok(f.events.some(e => e.type === 'nxt_unavailable' && e.key === 'NXT:239610'));
    assert.equal(f.events.filter(e => e.type === 'rest_error').length, 0);
    // A later watch reuses the answer without asking again.
    const before = restCalls.length;
    f.feed.unwatch('239610'); f.feed.watch('239610');
    await tick();
    assert.equal(restCalls.filter(c => c.market_cd === 'NXT').length, 1);
    assert.equal(restCalls.length, before);
});

// Fake NH socket: keeps the server-side registration count, answers every request (subscribe and
// unsubscribe) asynchronously, and enforces 10 sends per second (WSS10010) and the limit (WSS10009).
function fakeNh(limit) {
    const sockets = [];
    class Socket extends EventEmitter {
        constructor() { super(); this.sent = []; this.registered = new Set(); this.window = []; this.readyState = 0; sockets.push(this);
            setImmediate(() => { this.readyState = 1; this.emit('open'); }); }
        send(text) {
            const m = JSON.parse(text), key = m.body.tr_cd + ':' + m.body.tr_key, t = Date.now();
            this.sent.push(m); this.window = this.window.filter(x => t - x < 1000); this.window.push(t);
            let code = '00000';
            if (this.window.length > 10) code = 'WSS10010';
            else if (m.header.tr_type === '1') { if (this.registered.has(key)) code = 'WSS10014'; else if (this.registered.size >= limit) code = 'WSS10009'; else this.registered.add(key); }
            else this.registered.delete(key);
            // NH acks carry no tr_key, so the client must match them by order.
            setTimeout(() => this.emit('message', JSON.stringify({header: {tr_cd: m.body.tr_cd, rsp_cd: code, rsp_msg: code}})), 5);
        }
        close() { this.readyState = 3; this.emit('close', 1000, ''); }
    }
    return {Socket, sockets};
}

test('replacing watched stocks near the limit causes no resubscribe storm (2026-11-04 16:10)', async t => {
    // 2026-11-04 live: 44k subscribes and WSS10009/10010 in 90 minutes while VI stocks rotated.
    const {Socket, sockets} = fakeNh(10), events = [];
    const feed = createNhQuoteFeed({credentials: () => ({appKey: 'k', secretKey: 's'}), WebSocket: Socket, maxSubscriptions: 10,
        restIntervalMs: 60000, sendGapMs: 120, fetch: async url => String(url).includes('oauth2')
            ? {status: 200, ok: true, json: async () => ({access_token: 'tok', expires_in: 86400})}
            : {status: 200, ok: true, json: async () => ({rsp_cd: '00000', Output_0: {stck_prpr: '1000'}})},
        onEvent: e => events.push(e)});
    t.after(() => feed.stop());
    feed.start();
    const codes = Array.from({length: 16}, (_, i) => String(100000 + i));
    for (const code of codes.slice(0, 8)) feed.watch(code);
    await new Promise(r => setTimeout(r, 1500));
    // Rotate: drop four stocks and add four new ones, as VI triggers and releases do.
    for (const code of codes.slice(0, 4)) feed.unwatch(code);
    for (const code of codes.slice(8, 12)) feed.watch(code);
    await new Promise(r => setTimeout(r, 3000));
    const ws = sockets[0], subscribes = ws.sent.filter(m => m.header.tr_type === '1').length;
    const codesSeen = events.filter(e => e.type === 'ack').map(e => e.code);
    assert.ok(!codesSeen.includes('WSS10010'), 'never exceeds 10 sends per second: ' + JSON.stringify(codesSeen));
    assert.ok(subscribes <= 24, 'bounded subscribes: ' + subscribes);
    // Client view matches the server: no key believed subscribed that NH did not register, and the limit is used.
    const state = feed.state();
    assert.equal(state.subscribed, ws.registered.size);
    assert.equal(ws.registered.size, 10);
    assert.equal(state.subscribed + state.rest, state.wanted);
});

test('WSS10009 while the client still sees free slots pauses subscribes instead of retrying', async t => {
    // NH registered fewer keys than our limit allows (e.g. registrations left from an earlier connection).
    const {Socket, sockets} = fakeNh(6), events = [];
    const feed = createNhQuoteFeed({credentials: () => ({appKey: 'k', secretKey: 's'}), WebSocket: Socket, maxSubscriptions: 10,
        restIntervalMs: 60000, sendGapMs: 120, fetch: async url => String(url).includes('oauth2')
            ? {status: 200, ok: true, json: async () => ({access_token: 'tok', expires_in: 86400})}
            : {status: 200, ok: true, json: async () => ({rsp_cd: '00000', Output_0: {stck_prpr: '1000'}})},
        onEvent: e => events.push(e)});
    t.after(() => feed.stop());
    feed.start();
    for (let i = 0; i < 6; i++) feed.watch(String(200000 + i));
    await new Promise(r => setTimeout(r, 3000));
    const ws = sockets[0], rejected = events.filter(e => e.type === 'ack' && e.code === 'WSS10009').length;
    assert.equal(ws.registered.size, 6);
    assert.equal(rejected, 1, 'one rejection, then a 30 s pause');
    assert.equal(ws.sent.filter(m => m.header.tr_type === '1').length, 7);
    assert.deepEqual(feed.state(), {connected: true, wanted: 12, subscribed: 6, rest: 6});
});
