// 키움 호출 관문(2026-11-21): 앱키마다 관문 하나, API별 칸 · 앱키 전체 한도, 주문 먼저, 한도 초과 때 그 칸만 쉼.
const { test } = require('node:test'), assert = require('node:assert/strict');
const { createKiwoomGate, createKiwoomGates } = require('../../kiwoom-gate');

// 가짜 시계와 타이머.
function clock() {
    let t = 0; const timers = [];
    return { now: () => t, setTimer: (fn, ms) => { timers.push({ at: t + ms, fn }); timers.sort((a, b) => a.at - b.at); return timers.length; },
        async run(until) { while (timers.length && timers[0].at <= until) { const x = timers.shift(); t = x.at; x.fn(); await Promise.resolve(); } t = until; await Promise.resolve(); } };
}
test('API별 칸: 1초에 4건, 다섯 번째부터는 1초 뒤 · 다른 API는 기다리지 않는다', async () => {
    const c = clock(), g = createKiwoomGate({ key: 'main', perApi: 4, total: 100, now: c.now, setTimer: c.setTimer }), done = [];
    for (let i = 0; i < 6; i++) g.acquire('ka10001').then(() => done.push(['ka10001', c.now()]));
    g.acquire('ka10080').then(() => done.push(['ka10080', c.now()]));
    await c.run(0);
    assert.deepEqual(done.filter(([api]) => api === 'ka10001').map(([, t]) => t), [0, 0, 0, 0]);
    assert.deepEqual(done.filter(([api]) => api === 'ka10080').map(([, t]) => t), [0], '다른 API 칸은 비어 있어 바로 나간다');
    await c.run(1000);
    assert.deepEqual(done.filter(([api]) => api === 'ka10001').map(([, t]) => t), [0, 0, 0, 0, 1000, 1000]);
    assert.equal(g.stats().waited, 2);
});
test('앱키 전체 한도 · 주문(kt)은 기다리는 조회보다 먼저', async () => {
    const c = clock(), g = createKiwoomGate({ key: '28', perApi: 10, total: 3, now: c.now, setTimer: c.setTimer }), order = [];
    for (const api of ['ka10001', 'ka10001', 'ka10085', 'ka10001', 'ka10085']) g.acquire(api).then(() => order.push(api));
    g.acquire('kt10006').then(() => order.push('kt10006'));
    await c.run(0); assert.deepEqual(order, ['ka10001', 'ka10001', 'ka10085'], '전체 3건까지');
    await c.run(1000); assert.deepEqual(order.slice(3), ['kt10006', 'ka10001', 'ka10085'], '다음 1초의 첫 자리는 주문');
});
test('한도 초과(429 · 1700)를 받으면 그 API 칸만 쉬고, 1701은 앱키 전체가 쉰다', async () => {
    const c = clock(), g = createKiwoomGate({ key: 'main', perApi: 10, total: 100, cooldownMs: 1000, now: c.now, setTimer: c.setTimer }), done = [];
    assert.equal(g.report('ka10100', { status: 429, code: '1700' }), true);
    assert.equal(g.report('ka10100', { status: 200, code: '' }), false);
    g.acquire('ka10100').then(() => done.push('ka10100@' + c.now())); g.acquire('ka10001').then(() => done.push('ka10001@' + c.now()));
    await c.run(0); assert.deepEqual(done, ['ka10001@0']);
    await c.run(1000); assert.deepEqual(done, ['ka10001@0', 'ka10100@1000']);
    g.report('ka10001', { status: 429, code: '1701' }); g.acquire('ka10080').then(() => done.push('ka10080@' + c.now()));
    await c.run(1500); assert.ok(!done.some(x => x.startsWith('ka10080')), '1701이면 다른 API도 쉰다');
    await c.run(2000); assert.ok(done.includes('ka10080@2000'));
    assert.equal(g.stats().limited, 2);
});
test('앱키마다 관문이 따로: 토큰으로 앱키를 알아 자기 관문만 센다 (axios 가로채기, 실제 호출 없음)', async () => {
    const axios = require('axios').create(), logs = [], seen = [];
    const gates = createKiwoomGates({ options: { perApi: 2, total: 100 }, log: m => logs.push(m) }).install(axios);
    gates.register('28', 'TOKEN28');
    // 실제로 나가지 않는 어댑터: 받은 순서와 시각을 적고, 첫 ka10100은 한도 초과로 답한다.
    let limited = false;
    axios.defaults.adapter = async config => {
        const api = config.headers.get?.('api-id') || config.headers['api-id'], key = gates.keyOf(config.headers.get?.('authorization'));
        seen.push([key, api, Date.now()]);
        if (api === 'ka10100' && !limited) { limited = true; const error = new Error('429'); error.config = config; error.response = { status: 429, data: { return_code: 5, return_msg: '허용된 요청 개수를 초과하였습니다[1700:허용된 API 요청 개수를 초과하였습니다. 유량=5, API ID=ka10100]' } }; throw error; }
        return { data: { return_code: 0 }, status: 200, statusText: 'OK', headers: {}, config };
    };
    const call = (token, api) => axios.post('https://api.kiwoom.com/api/dostk/stkinfo', {}, { headers: { authorization: 'Bearer ' + token, 'api-id': api } });
    const started = Date.now();
    await Promise.all([1, 2, 3].map(() => call('MAINTOKEN', 'ka10001')).concat([1, 2].map(() => call('TOKEN28', 'ka10001'))));
    const main = seen.filter(([k]) => k === 'main').map(([, , t]) => t - started), k28 = seen.filter(([k]) => k === '28').map(([, , t]) => t - started);
    assert.equal(main.length, 3); assert.equal(k28.length, 2);
    assert.ok(Math.max(...k28) < 500, '28 앱키는 기본 앱키 줄과 상관없이 바로 나간다 ' + k28);
    assert.ok(main.sort((a, b) => a - b)[2] >= 900, '기본 앱키 세 번째 ka10001은 1초 칸이 비길 기다린다 ' + main);
    await assert.rejects(call('MAINTOKEN', 'ka10100'));
    assert.match(logs.join('\n'), /\[키움 관문\] main 앱키 ka10100 한도 초과\(429 1700\)/);
    assert.equal(gates.stats().find(g => g.key === 'main').limited, 1);
    // 토큰 발급과 키움이 아닌 곳은 관문을 지나지 않는다.
    await axios.post('https://api.kiwoom.com/oauth2/token', {}); await axios.get('https://example.test/x');
    assert.equal(gates.stats().find(g => g.key === 'main').byApi['-'], undefined);
});
