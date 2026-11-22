// 2026-11-22 오라클 측정: 과거 분봉 구간에서 쪽이 들어올 때마다 공유 축이 카드 8개를 모두 다시 그려(30초에 251번)
// 브라우저가 95% 넘게 멈춰 있었다. 자료가 들어와 다시 그릴 때는 0.2초에 한 번으로 묶고, 사용자가 방금 조작했으면 바로 그린다.
const vm = require('node:vm'), fs = require('node:fs'), test = require('node:test'), assert = require('node:assert/strict');

function setup() {
    let now = Date.parse('2026-10-23T10:00:00+09:00');
    const timers = [], micro = [], windowListeners = {};
    const sandbox = {
        window: { addEventListener: (type, fn) => { (windowListeners[type] ??= []).push(fn); } },
        localStorage: { getItem: () => null, setItem() {} }, MutationObserver: class { observe() {} },
        queueMicrotask: fn => micro.push(fn), setTimeout: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; },
        Date: class extends Date { static now() { return now; } },
        document: { querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, getElementById: () => null }
    };
    vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js', 'utf8'), sandbox);
    const api = sandbox.window.RankChartAxis;
    const flush = () => { while (micro.length) micro.shift()(); };
    const advance = ms => { now += ms; for (const t of timers.splice(0)) { if (t.at <= now) t.fn(); else timers.push(t); } flush(); };
    return { api, flush, advance, input: type => { for (const fn of windowListeners[type] || []) fn(); } };
}

test('자료가 이어 들어오면 모든 카드 다시 그리기를 0.2초에 한 번으로 묶는다', () => {
    const { api, flush, advance } = setup();
    let draws = 0;
    const dates = ['2026-10-23 09:00', '2026-10-23 09:01'];
    api.sharedRange('a', dates, v => v, 'minute', 0, null, () => { draws++; });
    flush(); advance(1000); draws = 0;
    api.showToday(); flush();
    assert.equal(draws, 1, '한동안 그리지 않았으면 바로');
    for (let i = 0; i < 5; i++) { api.showToday(); flush(); }
    assert.equal(draws, 1, '0.2초 안의 다음 요청들은 모아 둔다');
    advance(250);
    assert.equal(draws, 2, '0.2초 뒤 한 번에 그린다');
});

test('사용자가 방금 조작했으면 기다리지 않고 바로 그린다', () => {
    const { api, flush, advance, input } = setup();
    let draws = 0;
    api.sharedRange('a', ['2026-10-23 09:00'], v => v, 'minute', 0, null, () => { draws++; });
    flush(); advance(1000); api.showToday(); flush(); draws = 0; // 방금 그렸으니 다음 자료 요청은 기다릴 차례
    input('wheel');
    api.showToday(); flush();
    assert.equal(draws, 1);
});
