'use strict';
// VI 독립창 여는 토큰(2026-11-20, vi-monitor-routes.js): 창 주소의 여는 토큰은 5분 안에 한 번만 창 토큰으로 바꿀 수 있고,
// VI 자료는 창 토큰으로만 읽는다. 메인 화면은 여는 토큰으로 연결 상태 · 배율을 보고한다.
const assert = require('node:assert/strict'), express = require('express');
const { createViWindowAccess } = require('../../vi-monitor-routes');

(async () => {
    const clock = { t: Date.parse('2026-11-20T10:00:00+09:00') };
    let valid = true;
    const access = createViWindowAccess({ session: req => valid && req.headers.cookie === 'login=valid' ? { email: 'a@x' } : null, now: () => clock.t });
    const service = { start() {}, subscribe() { return () => {}; }, archivedDays: () => [], archivedDay: () => null };
    const app = express(); app.use(express.json());
    app.use('/api', (req, res, next) => { // server.js와 같이 /api 아래에서 확인
        if (access.handles(req)) return access.authorize(req, res, next);
        if (req.headers.cookie !== 'login=valid') return res.status(401).json({ error: '로그인 필요' });
        req.authUser = { email: 'a@x' }; next();
    });
    access.mount(app, service);
    const server = app.listen(0), base = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
    const launch = async () => (await (await post('/api/vi-monitor/window', { scale: 1.5 }, { cookie: 'login=valid' })).json()).token;
    const exchange = l => post('/api/vi-monitor/window-exchange', {}, { 'X-VI-Launch': l });
    const history = token => fetch(base + '/api/vi-monitor/history', { headers: { 'X-VI-Token': token } });
    try {
        const l = await launch();
        assert.equal((await history(l)).status, 401, '여는 토큰으로는 VI 자료를 못 읽음');
        assert.deepEqual(await (await post('/api/vi-monitor/window-status', { token: l }, { cookie: 'login=valid' })).json(), { connected: false });
        const r = await exchange(l); assert.equal(r.status, 200); const { token } = await r.json(); assert.match(token, /^[a-f0-9]{64}$/);
        assert.equal((await history(token)).status, 200, '창 토큰으로 읽음');
        const again = await exchange(l); assert.equal(again.status, 401); assert.match((await again.json()).error, /이미 쓴 연결/);
        assert.deepEqual(await (await post('/api/vi-monitor/window-status', { token: l }, { cookie: 'login=valid' })).json(), { connected: true });
        assert.equal((await post('/api/vi-monitor/window-scale', { token: l, scale: 1.25 }, { cookie: 'login=valid' })).status, 200, '메인 화면은 여는 토큰으로 배율 보고');
        // 5분: 4분 59초는 되고 5분이 지나면 안내와 함께 거절
        const ok = await launch(), late = await launch(); clock.t += 5 * 60000 - 1000;
        assert.equal((await exchange(ok)).status, 200);
        clock.t += 1000; const lateRes = await exchange(late); assert.equal(lateRes.status, 401); assert.match((await lateRes.json()).error, /5분/);
        // 로그아웃하면 창 토큰도 끝
        valid = false; assert.equal((await history(token)).status, 401);
        console.log('vi-window-launch: 모든 확인 통과');
    } finally { server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
