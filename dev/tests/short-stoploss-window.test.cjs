'use strict';
// 대주 StopLoss 독립창 토큰(2026-11-20, short-stoploss-window.js):
// 메인 화면(로그인) → 여는 토큰 발급 → 앱 안 대주창이 5분 안에 한 번 창 토큰으로 바꿔 받음 → X-SS-Token으로 대주 API 사용.
const assert = require('node:assert/strict'), express = require('express');
const { createShortStopLossWindowAccess } = require('../../short-stoploss-window');

(async () => {
    const sessions = { 'sid=admin': { email: 'admin@x' }, 'sid=user': { email: 'user@x' } };
    const session = req => sessions[req.headers.cookie] || null;
    const clock = { t: Date.parse('2026-11-20T10:00:00+09:00') };
    const access = createShortStopLossWindowAccess({ session, allowed: req => req.authUser?.email === 'admin@x', now: () => clock.t });
    const app = express(); app.use(express.json());
    // server.js와 같은 순서: 토큰 요청이면 토큰으로, 아니면 쿠키로 로그인 확인
    app.use('/api', (req, res, next) => {
        if (access.handles(req)) return access.authorize(req, res, next);
        const user = session(req); if (!user) return res.status(401).json({ error: '로그인 필요' });
        req.authUser = user; next();
    });
    access.mount(app);
    app.get('/api/short-stoploss/state', (req, res) => res.json({ who: req.authUser.email }));
    app.get('/api/trading-session/calendar', (req, res) => res.json({ who: req.authUser.email }));
    const server = app.listen(0), base = `http://127.0.0.1:${server.address().port}`;
    const call = (path, { cookie, token, launch, body, method } = {}) => fetch(base + path, { method: method || (body || launch ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...(token ? { 'X-SS-Token': token } : {}), ...(launch ? { 'X-SS-Launch': launch } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const issue = async () => (await (await call('/api/short-stoploss/window', { cookie: 'sid=admin', body: { scale: 1.5 } })).json()).token;
    try {
        // 관리자가 아니면 발급하지 않는다
        assert.equal((await call('/api/short-stoploss/window', { cookie: 'sid=user', body: { scale: 1.5 } })).status, 403);
        const launch = await issue(); assert.match(launch, /^[a-f0-9]{64}$/);
        assert.deepEqual(await (await call('/api/short-stoploss/window-status', { cookie: 'sid=admin', body: { token: launch } })).json(), { connected: false });
        // 여는 토큰은 대주 API에 바로 쓸 수 없다(창 토큰으로 바꿔야 함)
        assert.equal((await call('/api/short-stoploss/state', { token: launch })).status, 401);
        const ex = await call('/api/short-stoploss/window-exchange', { launch }); assert.equal(ex.status, 200);
        const { token } = await ex.json(); assert.match(token, /^[a-f0-9]{64}$/); assert.notEqual(token, launch);
        // 한 번 바꾼 여는 토큰은 다시 쓸 수 없다(앱 실행 인자에 남은 값을 다른 프로그램이 읽어도 소용없음)
        const again = await call('/api/short-stoploss/window-exchange', { launch }); assert.equal(again.status, 401); assert.match((await again.json()).error, /이미 쓴 연결/);
        // 창 토큰으로 쿠키 없이 대주 API · 휴장일 달력을 쓴다
        assert.deepEqual(await (await call('/api/short-stoploss/state', { token })).json(), { who: 'admin@x' });
        assert.deepEqual(await (await call('/api/trading-session/calendar', { token })).json(), { who: 'admin@x' });
        assert.deepEqual(await (await call('/api/short-stoploss/window-status', { cookie: 'sid=admin', body: { token: launch } })).json(), { connected: true });
        // 메인 화면 배율(여는 토큰으로 보고)을 대주창(창 토큰)이 받아 간다
        assert.deepEqual(await (await call('/api/short-stoploss/window-info', { token })).json(), { scale: 1.5 });
        assert.equal((await call('/api/short-stoploss/window-scale', { cookie: 'sid=admin', body: { token: launch, scale: 1.25 } })).status, 200);
        assert.deepEqual(await (await call('/api/short-stoploss/window-info', { token })).json(), { scale: 1.25 });
        assert.equal((await call('/api/short-stoploss/window-scale', { cookie: 'sid=user', body: { token: launch, scale: 1 } })).status, 404, '다른 사람 토큰은 못 바꿈');
        // 5분이 지나서 창이 열리면(늦게 앱 열기 허용) 바꿔 주지 않고 다시 누르라고 안내한다. 4분 59초는 된다
        const late = await issue(); clock.t += 5 * 60000;
        const lateEx = await call('/api/short-stoploss/window-exchange', { launch: late }); assert.equal(lateEx.status, 401); assert.match((await lateEx.json()).error, /5분/);
        const ok = await issue(); clock.t += 5 * 60000 - 1000; assert.equal((await call('/api/short-stoploss/window-exchange', { launch: ok })).status, 200);
        // 모르는 토큰 · 로그아웃(쿠키 세션 만료)이면 401과 다시 여는 방법 안내
        const bad = await call('/api/short-stoploss/state', { token: 'f'.repeat(64) }); assert.equal(bad.status, 401); assert.match((await bad.json()).error, /대주StopLoss 버튼을 다시/);
        assert.equal((await call('/api/short-stoploss/window-exchange', { launch: 'f'.repeat(64) })).status, 401);
        delete sessions['sid=admin'];
        assert.equal((await call('/api/short-stoploss/state', { token })).status, 401);
        // 다른 API에는 토큰을 쓸 수 없다(쿠키 확인으로 감)
        assert.equal((await call('/api/market-alerts', { token })).status, 401);
        console.log('short-stoploss-window: 모든 확인 통과');
    } finally { server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
