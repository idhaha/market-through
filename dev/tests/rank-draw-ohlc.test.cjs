// 2026-11-23 오라클 측정: 과거 분봉 구간(1만 5천 봉)에서 공용 축 다시 그리기가 2~3초였다. 카드마다 봉을 하나씩 stroke 했고,
// 쏠림율 카드는 봉 위치를 잡을 때마다 글자 시각을 날짜 글자로 바꾸고 다시 분으로 바꿨다.
// 고친 뒤: 같은 색 봉의 꼬리는 색마다 한 번에 긋고(drawOhlc), 글자 시각의 분 값은 한 번만 계산한다.
const vm = require('node:vm'), fs = require('node:fs'), test = require('node:test'), assert = require('node:assert/strict');

function setup() {
    const sandbox = { window: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, MutationObserver: class { observe() {} }, queueMicrotask,
        Date: class extends Date { static now() { return Date.parse('2026-10-23T10:00:00+09:00'); } } };
    vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js', 'utf8'), sandbox);
    return sandbox.window.RankChartAxis;
}
function fakeContext() {
    const log = { stroke: 0, fill: [], lines: [] };
    let color = '';
    return { log, ctx: {
        set strokeStyle(v) { color = v; }, get strokeStyle() { return color; }, set fillStyle(v) { color = v; }, get fillStyle() { return color; }, lineWidth: 1,
        beginPath() {}, moveTo(x, y) { log.lines.push([color, x, y]); }, lineTo() {}, stroke() { log.stroke++; },
        fillRect(x, y, w, h) { log.fill.push([color, x, y, w, h]); }
    } };
}

test('봉 1만 개를 그려도 꼬리 긋기(stroke)는 색마다 한 번이고, 봉마다 몸통과 꼬리를 그린다', () => {
    const api = setup(), { ctx, log } = fakeContext();
    const rows = Array.from({ length: 10000 }, (_, i) => ({ t: i, open: 100, close: i % 3 ? 101 : 99, high: 102, low: 98 }));
    api.drawOhlc(ctx, rows, p => p.t, v => 200 - v, 3);
    assert.equal(log.stroke, 2, '오르는 봉 · 내리는 봉 색마다 한 번');
    assert.equal(log.fill.length, rows.length, '봉마다 몸통');
    assert.equal(log.lines.length, rows.length, '봉마다 꼬리');
    const up = rows.filter(p => p.close >= p.open).length;
    assert.equal(log.fill.filter(f => f[0] === '#e11d48').length, up, '오른 봉은 빨강');
    const down = log.fill.find(f => f[0] === '#2563eb');
    assert.deepEqual(down.slice(1), [-1.5, 100, 3, 1], '내린 봉 몸통 위치와 크기');
});

test('공용 축은 글자 시각과 숫자 시각을 같은 위치에 놓는다', () => {
    const api = setup();
    const pad = n => String(n).padStart(2, '0');
    const days = ['2026-10-21', '2026-10-22', '2026-10-23'];
    const stamps = days.flatMap(d => Array.from({ length: 60 }, (_, i) => Date.parse(`${d}T09:00:00+09:00`) + i * 60000));
    const text = t => { const k = new Date(t + 9 * 3600000); return `${k.getUTCFullYear()}${pad(k.getUTCMonth() + 1)}${pad(k.getUTCDate())}${pad(k.getUTCHours())}${pad(k.getUTCMinutes())}00`; };
    api.sharedRange('a', stamps, t => t, 'minute', 0, null, () => {});
    api.sharedRange('b', stamps.map(text), v => v, 'minute', 0, null, () => {});
    const domain = api.minuteDomain(stamps, t => t);
    for (const t of [stamps[0], stamps[30], stamps.at(-1)]) assert.equal(domain.position(text(t)), domain.position(t), text(t));
    assert.equal(domain.position(text(stamps[5])), domain.position(text(stamps[5])), '두 번째 계산도 같다');
});
