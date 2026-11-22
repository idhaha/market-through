// 2026-11-22 오라클 측정: 과거 분봉 구간(1만 5천 봉)에서 공용 축 다시 그리기(rank-chart-axis.js의 run)가 4초 가까이 걸렸다.
// 카드는 그릴 때마다 sharedRange를 거치는데, 자료가 그대로여도 봉마다 날짜 글자를 두 번씩 새로 만들었다.
// 자료가 그대로면 날짜 목록을 다시 쓰고, 자료가 바뀌면(봉이 늘거나 시각이 바뀌면) 새로 만든다.
const vm = require('node:vm'), fs = require('node:fs'), test = require('node:test'), assert = require('node:assert/strict');

function setup() {
    const micro = [];
    const sandbox = {
        window: { addEventListener() {} },
        localStorage: { getItem: () => null, setItem() {} }, MutationObserver: class { observe() {} },
        queueMicrotask: fn => micro.push(fn),
        Date: class extends Date { static now() { return Date.parse('2026-10-23T10:00:00+09:00'); } }
    };
    vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js', 'utf8'), sandbox);
    return { api: sandbox.window.RankChartAxis, flush: () => { while (micro.length) micro.shift()(); } };
}
const bars = (days, perDay) => days.flatMap(day => Array.from({ length: perDay }, (_, i) => Date.parse(`${day}T08:00:00+09:00`) + i * 60000));

test('자료가 그대로인 카드를 다시 그릴 때는 봉마다 날짜를 새로 만들지 않는다', () => {
    const { api, flush } = setup();
    const values = bars(['2026-10-21', '2026-10-22', '2026-10-23'], 692);
    let calls = 0;
    const getDate = t => { calls++; return t; };
    api.sharedRange('a', values, getDate, 'minute', 0, null, () => {}); flush();
    assert.ok(calls >= values.length, `처음에는 모든 봉을 본다: ${calls}`);
    calls = 0;
    api.sharedRange('a', values.slice(), getDate, 'minute', 0, null, () => {}); flush();
    // 고치기 전: 봉 수의 두 배(4,152번) 넘게 불렀다.
    assert.ok(calls < 50, `같은 자료로 다시 그릴 때 날짜를 ${calls}번 만들었다`);
});

const dayBars = days => days.map(day => Date.parse(`${day}T00:00:00+09:00`));

test('봉이 늘면 날짜 목록과 날짜 범위를 새로 만든다', () => {
    const { api, flush } = setup();
    let draws = 0;
    api.sharedRange('a', dayBars(['2026-10-21', '2026-10-22', '2026-10-23']), t => t, 'day', 0, null, () => { draws++; }); flush();
    draws = 0;
    api.sharedRange('a', dayBars(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']), t => t, 'day', 0, null, () => { draws++; }); flush();
    assert.ok(draws >= 1, '날이 늘면 카드를 다시 그린다');
    assert.deepEqual([...api.dailyDomain().days], ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
});

test('봉 수가 같아도 시각이 바뀌면 새로 만든다', () => {
    const { api, flush } = setup();
    api.sharedRange('a', dayBars(['2026-10-21', '2026-10-22', '2026-10-23']), t => t, 'day', 0, null, () => {}); flush();
    api.sharedRange('a', dayBars(['2026-10-20', '2026-10-21', '2026-10-22']), t => t, 'day', 0, null, () => {}); flush();
    assert.deepEqual([...api.dailyDomain().days], ['2026-10-20', '2026-10-21', '2026-10-22']);
});
