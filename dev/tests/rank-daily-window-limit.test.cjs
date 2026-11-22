// 2026-11-23 사용자 결정: 일봉을 과거로 확대한 채 분봉을 누르면 화면에 보이는 모든 거래일의 분봉을 보여 주되(예전엔 가운데 봉 좌우 10거래일),
// 화면의 일봉이 60거래일보다 많으면 가운데 봉을 중심으로 60거래일만 받는다.
const vm = require('node:vm'), fs = require('node:fs'), test = require('node:test'), assert = require('node:assert/strict');

function setup() {
    const micro = [];
    const sandbox = { window: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, MutationObserver: class { observe() {} },
        queueMicrotask: fn => micro.push(fn), Date: class extends Date { static now() { return Date.parse('2026-11-20T10:00:00+09:00'); } } };
    vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js', 'utf8'), sandbox);
    return { api: sandbox.window.RankChartAxis, flush: () => { while (micro.length) micro.shift()(); } };
}
const weekdays = n => { const r = []; for (let t = Date.parse('2025-12-01T00:00:00Z'); r.length < n; t += 86400000) { const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) r.push(d.toISOString().slice(0, 10)); } return r; };

function windowFor(visible) {
    const { api, flush } = setup(), days = weekdays(200);
    api.sharedRange('a', days.map(d => Date.parse(d + 'T00:00:00+09:00')), t => t, 'day', 0, null, () => {}); flush();
    const n = days.length - 1, from = 20, to = from + visible - 1;
    api.selectViewport('a', from / n, to / n); flush();
    return { window: api.dailyWindow(), days, from, to };
}

test('일봉 30개를 보고 있으면 30거래일 모두', () => {
    const { window: w, days, from, to } = windowFor(30);
    assert.equal(w.from, days[from]); assert.equal(w.to, days[to]);
});

test('일봉 100개를 보고 있으면 가운데 봉 중심 60거래일', () => {
    const { window: w, days, from } = windowFor(100);
    const i = days.indexOf(w.from), j = days.indexOf(w.to);
    assert.equal(j - i + 1, 60, `${w.from} ~ ${w.to}`);
    assert.ok(i >= from && days.indexOf(w.center) >= i && days.indexOf(w.center) <= j, '화면 안 · 가운데 봉 포함');
});
