// 금리/환율 tab: opening the tab uses the server's stored series; only 조회/전체조회 ask the server to refetch.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../public/app.js'), 'utf8');
const fn = name => { const start = source.indexOf(`async function ${name}(`); const end = source.indexOf('\n}\n', start); return source.slice(start, end + 3); };

function run(force) {
    const requested = [];
    const series = [
        { url: "fred('DGS10','10년')", label: '미국채 10년물' },
        { url: "ecos('010210000','10년')", label: '한국채 10년물' },
        { url: 'https://tradingeconomics.com/south-korea/currency', label: 'USD/KRW', duration: '10년' }
    ];
    const el = () => ({ style: {}, textContent: '' });
    const canvas = { nextElementSibling: el(), closest: () => box };
    const box = { dataset: { series: encodeURIComponent(JSON.stringify(series)) }, querySelector: () => ({ textContent: '금리' }) };
    const content = { querySelectorAll: selector => selector === '.multi-chart-canvas' ? [canvas] : [] };
    const context = {
        isCapturing: false, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, AbortController, Date, JSON, Map,
        encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, Promise, Array,
        document: { getElementById: id => id === 'tab_x' ? content : el() },
        formatTime: () => '00:00', drawMultiSeriesLineChart() {},
        queueTeRequest: task => task(),
        fetch: async url => {
            requested.push(url);
            const data = url.startsWith('/api/fred') ? [{ date: '2026-11-05', value: 4.8 }]
                : url.startsWith('/api/ecos') ? [{ TIME: '20261106', DATA_VALUE: '3.8' }] : [{ DateTime: '2026-11-06T00:00:00Z', Value: 1400 }];
            return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true, data }) };
        }
    };
    vm.createContext(context);
    vm.runInContext(fn('loadMultiSeriesChart') + fn('refreshExchangeRateCharts'), context);
    return vm.runInContext(force === undefined ? 'refreshExchangeRateCharts("tab_x")' : `refreshExchangeRateCharts("tab_x", ${force})`, context).then(() => requested);
}

test('opening the tab does not force a refetch of any source', async () => {
    const urls = await run();
    assert.equal(urls.length, 3);
    assert.ok(urls.every(url => !url.includes('force_refresh')), urls.join('\n'));
});

test('the 조회 button asks FRED, ECOS and Trading Economics to refetch', async () => {
    const urls = await run(true);
    assert.equal(urls.length, 3);
    assert.ok(urls.every(url => url.includes('force_refresh=true')), urls.join('\n'));
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
