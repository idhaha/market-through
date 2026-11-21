// 증권사 호출 스위치(2026-11-21): 로컬 PC는 기본으로 증권사 호출을 막고, BROKER_CALLS로 필요한 것만 켠다.
const { test } = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { createBrokerCalls, parse, brokerOf } = require('../../broker-calls');

test('기본값: 로컬(Windows)은 모두 막고 정기 수집 안 함, 오라클(Linux)은 모두 허용', () => {
    assert.deepEqual(parse({}, 'win32'), { mode: 'off', rules: [] });
    assert.deepEqual(parse({}, 'linux'), { mode: 'on', rules: [] });
    assert.equal(createBrokerCalls({ env: {}, platform: 'win32' }).collects(), false);
    assert.equal(createBrokerCalls({ env: {}, platform: 'linux' }).collects(), true);
    assert.equal(createBrokerCalls({ env: { BROKER_CALLS: 'on' }, platform: 'win32' }).collects(), true);
    assert.equal(createBrokerCalls({ env: { BROKER_CALLS: 'off' }, platform: 'linux' }).collects(), false);
    assert.match(createBrokerCalls({ env: {}, platform: 'win32' }).startupLine(), /모두 막음 · 정기 수집 안 함 \(기본값: 로컬 PC는 끔\)/);
});
test('증권사 판별과 일부 허용(증권사 전체 · 증권사:API · 토큰 · 웹소켓)', () => {
    assert.equal(brokerOf('api.kiwoom.com'), 'kiwoom'); assert.equal(brokerOf('openapi.ls-sec.co.kr'), 'ls');
    assert.equal(brokerOf('openapi.koreainvestment.com'), 'kis'); assert.equal(brokerOf('ops.koreainvestment.com'), 'kis');
    assert.equal(brokerOf('api.nhplug.com'), 'nh'); assert.equal(brokerOf('jusikbot.com'), null); assert.equal(brokerOf('evilkoreainvestment.com'), null);
    const calls = createBrokerCalls({ env: { BROKER_CALLS: 'kiwoom:ka10001, ls' }, platform: 'win32' });
    assert.equal(calls.collects(), false, '일부 허용일 때는 정기 수집을 시작하지 않는다');
    assert.equal(calls.allows({ broker: 'kiwoom', api: 'ka10001' }), true);
    assert.equal(calls.allows({ broker: 'kiwoom', api: 'KA10001' }), true);
    assert.equal(calls.allows({ broker: 'kiwoom', api: 'ka10080' }), false);
    assert.equal(calls.allows({ broker: 'kiwoom', path: '/oauth2/token' }), true, '허용 API가 있으면 토큰 발급은 된다');
    assert.equal(calls.allows({ broker: 'kiwoom', websocket: true }), false);
    assert.equal(calls.allows({ broker: 'ls', api: 't8463' }), true); assert.equal(calls.allows({ broker: 'ls', websocket: true }), true);
    assert.equal(calls.allows({ broker: 'kis', api: 'FHKST01010100' }), false); assert.equal(calls.allows({ broker: 'kis', path: '/oauth2/tokenP' }), false);
    assert.equal(calls.allows({ broker: null }), true, '증권사가 아닌 곳은 그대로');
});
test('막힌 증권사 호출은 밖으로 나가지 않고 바로 오류 · 증권사가 아닌 곳은 그대로 (axios · ws · fetch)', async t => {
    const logs = [], calls = createBrokerCalls({ env: { BROKER_CALLS: 'off' }, platform: 'linux', log: m => logs.push(m) }).install();
    const axios = require('axios');
    const started = Date.now();
    await assert.rejects(axios.post('https://api.kiwoom.com/api/dostk/stkinfo', { stk_cd: '005930' }, { headers: { 'api-id': 'ka10001' }, timeout: 5000 }), e => e.code === 'BROKER_CALLS_OFF' || e.cause?.code === 'BROKER_CALLS_OFF' || /증권사 호출이 꺼져/.test(e.message));
    await assert.rejects(axios.post('https://api.kiwoom.com/api/dostk/stkinfo', {}, { headers: { 'api-id': 'ka10001' } }));
    await assert.rejects(axios.get('https://openapi.ls-sec.co.kr:8080/stock/market-data', { headers: { tr_cd: 't8463' } }), /증권사 호출이 꺼져/);
    assert.ok(Date.now() - started < 2000, '네트워크를 기다리지 않는다');
    const WebSocket = require('ws');
    const wsError = await new Promise(resolve => { const ws = new WebSocket('wss://api.kiwoom.com:10000/api/dostk/websocket'); ws.on('error', resolve); });
    assert.match(wsError.message, /증권사 호출이 꺼져/);
    await assert.rejects(fetch('https://api.nhplug.com:8443/oauth2/token', { method: 'POST' }), /증권사 호출이 꺼져/);
    assert.deepEqual(calls.blocked(), { 'kiwoom:ka10001': 2, 'ls:t8463': 1, 'kiwoom:websocket': 1, 'nh:-': 1 });
    assert.equal(logs.filter(m => m.includes('kiwoom ka10001')).length, 1, '같은 호출은 한 번만 적는다');
    // 증권사가 아닌 주소는 막지 않는다.
    const server = http.createServer((req, res) => res.end('ok')); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
    assert.equal((await axios.get(`http://127.0.0.1:${server.address().port}/`)).data, 'ok');
    assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text(), 'ok');
});
