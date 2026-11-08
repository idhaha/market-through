// 금리/환율 tab: every load first draws from the server's stored series; only 조회/전체조회 then ask for the
// latest values, one chart at a time, and a failed latest check keeps the chart that is already drawn.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../public/app.js'), 'utf8').replace(/\r\n/g, '\n');
const fn = name => { const start = source.indexOf(`async function ${name}(`); const end = source.indexOf('\n}\n', start); return source.slice(start, end + 3); };
const refreshBlock = () => {
    const start = source.indexOf('const exchangeRateRuns = new Map();');
    const end = source.indexOf('\n}\n', source.indexOf('async function runExchangeRateRefresh('));
    return source.slice(start, end + 3);
};

const series = [
    { url: "fred('DGS10','10년')", label: '미국채 10년물' },
    { url: "ecos('010210000','10년')", label: '한국채 10년물' },
    { url: 'https://tradingeconomics.com/south-korea/currency', label: 'USD/KRW', duration: '10년' }
];

function setup({ failForce = false, withTeBox = false, pendingFirst = 0 } = {}) {
    const requested = [], draws = [];
    const el = () => ({ style: {}, textContent: '' });
    const status = el(), multiOverlay = el(), teOverlay = el();
    const box = { dataset: { series: encodeURIComponent(JSON.stringify(series)) }, querySelector: () => ({ textContent: '금리' }) };
    const canvas = { nextElementSibling: multiOverlay, closest: () => box };
    const teCanvas = { dataset: {}, closest: () => ({ querySelector: () => teOverlay }) };
    const teBox = { dataset: { teUrl: 'https://tradingeconomics.com/japan/currency', teDuration: '10년' }, querySelector: s => s === '.te-chart-canvas' ? teCanvas : { textContent: 'JPY' } };
    const content = { querySelectorAll: selector => selector === '.multi-chart-canvas' ? [canvas] : selector === '.te-chart-box' && withTeBox ? [teBox] : [] };
    const context = {
        // The 15 s pause between "still fetching" answers runs at once here.
        isCapturing: false, console: { log() {}, warn() {}, error() {} }, setTimeout: (fn, ms) => setTimeout(fn, ms >= 15000 ? 0 : ms), clearTimeout, AbortController, Date, JSON, Map,
        encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, Promise, Array, Error,
        document: { getElementById: id => id === 'tab_x' ? content : id.endsWith('StatusText') ? status : el() },
        formatTime: () => '00:00',
        drawMultiSeriesLineChart: () => draws.push('multi'), drawTradingEconomicsLineChart: () => draws.push('te'),
        queueTeRequest: task => task(),
        fetch: async url => {
            requested.push(url);
            if (pendingFirst > 0 && url.includes('japan')) { pendingFirst--; return { ok: true, status: 202, headers: { get: () => 'application/json' }, json: async () => ({ success: false, pending: true, error: '원천에서 자료를 받는 중입니다.' }) }; }
            if (failForce && url.includes('force_refresh=true')) return { ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({}) };
            const data = url.startsWith('/api/fred') ? [{ date: '2026-11-05', value: 4.8 }]
                : url.startsWith('/api/ecos') ? [{ TIME: '20261106', DATA_VALUE: '3.8' }] : [{ DateTime: '2026-11-06T00:00:00Z', Value: 1400 }];
            return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, data }) };
        }
    };
    vm.createContext(context);
    vm.runInContext(fn('loadMultiSeriesChart') + fn('loadTradingEconomicsChart') + refreshBlock(), context);
    return { context, requested, draws, status, multiOverlay, teOverlay, call: expr => vm.runInContext(expr, context) };
}

test('opening the tab draws from stored copies and never forces a refetch', async () => {
    const t = setup();
    await t.call('refreshExchangeRateCharts("tab_x")');
    assert.equal(t.requested.length, 3);
    assert.ok(t.requested.every(url => !url.includes('force_refresh')), t.requested.join('\n'));
    assert.equal(t.status.textContent, '완료');
});

test('the 조회 button draws stored copies first, then asks every source for the latest values', async () => {
    const t = setup();
    await t.call('refreshExchangeRateCharts("tab_x", true)');
    assert.equal(t.requested.length, 6);
    assert.ok(t.requested.slice(0, 3).every(url => !url.includes('force_refresh')), t.requested.join('\n'));
    assert.ok(t.requested.slice(3).every(url => url.includes('force_refresh=true')), t.requested.join('\n'));
    assert.deepEqual(t.draws, ['multi', 'multi']);
    assert.equal(t.status.textContent, '완료');
});

test('a failed latest check keeps the stored chart and shows no error over it', async () => {
    const t = setup({ failForce: true, withTeBox: true });
    await t.call('refreshExchangeRateCharts("tab_x", true)');
    assert.deepEqual(t.draws.sort(), ['multi', 'te'], 'only the stored-copy pass drew');
    assert.equal(t.multiOverlay.style.display, 'none');
    assert.equal(t.teOverlay.style.display, 'none');
    assert.doesNotMatch(t.teOverlay.textContent + t.multiOverlay.textContent, /실패|오류/);
    assert.match(t.status.textContent, /최신 확인 실패 2개는 저장값 표시/);
});

test('overlapping refreshes of one tab join instead of sending every request twice', async () => {
    const t = setup();
    await Promise.all([t.call('refreshExchangeRateCharts("tab_x", true)'), t.call('refreshExchangeRateCharts("tab_x", true)')]);
    assert.equal(t.requested.length, 6, t.requested.join('\n'));
    // A force call during a plain run runs once more, with force, after it.
    const u = setup();
    await Promise.all([u.call('refreshExchangeRateCharts("tab_x")'), u.call('refreshExchangeRateCharts("tab_x", true)')]);
    assert.equal(u.requested.filter(url => url.includes('force_refresh=true')).length, 3, u.requested.join('\n'));
});

test('button, 전체조회 and tab open pass the intended force flag', () => {
    assert.match(source, /refreshBtn\.addEventListener\('click', \(\) => refreshExchangeRateCharts\(tabId, true\)\)/);
    assert.match(source, /refreshBtn\.addEventListener\('click', \(\) => refreshOverseasCustomCharts\(tabId, true\)\)/);
    const refreshAll = source.slice(source.indexOf('async function refreshAllTabs('), source.indexOf('function splitByCommaIgnoringQuotes('));
    assert.match(refreshAll, /refreshExchangeRateCharts\(tabId, true\)/);
    const initial = source.slice(source.indexOf('    // 3. Trigger initial load if it was empty'), source.indexOf('    // 3. Trigger initial load if it was empty') + 600);
    assert.match(initial, /refreshExchangeRateCharts\(tabId\);/);
    assert.match(initial, /refreshOverseasCustomCharts\(tabId\);/);
});

test('a first fetch still running on the server (202 pending) is asked again and then drawn, not shown as failed', async () => {
    const t = setup({ withTeBox: true, pendingFirst: 2 });
    await t.call('refreshExchangeRateCharts("tab_x")');
    assert.ok(t.draws.includes('te'), 'the TE chart was drawn after the pending answers');
    assert.equal(t.teOverlay.style.display, 'none');
    assert.doesNotMatch(t.teOverlay.textContent, /실패|오류/);
    assert.equal(t.requested.filter(url => url.includes('japan')).length, 3, t.requested.join(' | '));
    assert.equal(t.status.textContent, '완료');
});
