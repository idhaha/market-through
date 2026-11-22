// 2026-11-23 오라클 측정: 시장 거래대금 · 신고신저 · 시장 수급 카드가 같은 지수 1분봉(과거 구간 940KB)을 화면을 열 때마다
// 6~9번 따로 받아 해석했다. 오늘이 들지 않은 범위는 1분 동안 한 번 받은 것을 같이 쓴다(RankChartAxis.sharedFetch).
const vm = require('node:vm'), fs = require('node:fs'), test = require('node:test'), assert = require('node:assert/strict');

function setup(now = Date.parse('2026-11-23T10:00:00+09:00')) {
    const calls = [];
    const sandbox = {
        window: { addEventListener() {} }, location: { href: 'http://shared.test/' }, URL, DOMException, setTimeout, Promise,
        localStorage: { getItem: () => null, setItem() {} }, MutationObserver: class { observe() {} }, queueMicrotask,
        Date: class extends Date { static now() { return now; } },
        fetch: async (url, options) => { calls.push({ url, signal: !!options?.signal }); await new Promise(r => setTimeout(r, 5)); return { ok: true, status: 200, json: async () => ({ success: true, points: [{ t: 1, close: calls.length }] }) }; }
    };
    vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js', 'utf8'), sandbox);
    return { api: sandbox.window.RankChartAxis, calls };
}
const past = '/api/adr/candles?market=kospi&mode=minute&from=20260731&to=20260831';

test('지난 구간 같은 주소는 동시에 · 이어서 불러도 한 번만 받는다', async () => {
    const { api, calls } = setup();
    const [a, b, c] = await Promise.all([api.sharedFetch(past), api.sharedFetch(past), api.sharedFetch(past)]);
    const [da, db, dc] = await Promise.all([a.json(), b.json(), c.json()]);
    assert.equal(calls.length, 1, '동시에 부른 세 카드');
    assert.equal(da.points[0].close, db.points[0].close); assert.equal(db.points[0].close, dc.points[0].close);
    const later = await api.sharedFetch(past); await later.json();
    assert.equal(calls.length, 1, '이어서 부른 카드도 받은 것을 쓴다');
    assert.equal(a.ok, true);
});

test('오늘이 든 범위는 같이 쓰지 않고 카드마다 받는다', async () => {
    const { api, calls } = setup();
    const today = '/api/adr/candles?market=kospi&mode=minute&from=20261120&to=20261123';
    await api.sharedFetch(today); await api.sharedFetch(today);
    assert.equal(calls.length, 2);
});

test('한 카드가 그만 받아도(abort) 다른 카드는 받는다', async () => {
    const { api, calls } = setup();
    const controller = new AbortController();
    const first = api.sharedFetch(past, { signal: controller.signal }), second = api.sharedFetch(past);
    controller.abort();
    await assert.rejects(first, e => e.name === 'AbortError');
    const data = await (await second).json();
    assert.equal(data.success, true);
    assert.equal(calls.length, 1);
});
