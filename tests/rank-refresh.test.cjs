const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

(async () => {
    const source = fs.readFileSync('public/app.js', 'utf8');
    const start = source.indexOf('let transactionRankRequest = 0;');
    const code = source.slice(start, source.indexOf('/**', start));
    const requests = [], refreshed = [], body = { innerHTML: '' };
    const context = vm.createContext({
        isCapturing: false, mrktTpSelect: { value: '000' }, stexTpSelect: { value: '3' }, transactionBody: body,
        console: { log() {}, warn() {}, error() {} },
        fetch: () => new Promise(resolve => requests.push(resolve)),
        window: { rankChartRowAttributes: () => '', refreshConcentrationChart: () => refreshed.push(body.innerHTML) },
        getPriceClass: () => '', formatChangeRate: String, formatNumber: String
    });
    vm.runInContext(code, context);
    const old = context.loadTransactionRank();
    const latest = context.loadTransactionRank();
    const result = name => ({ json: async () => ({ success: true, items: [{ stk_nm: name, concentration_rate: 43 }] }) });
    requests[1](result('latest')); await latest;
    assert.ok(body.innerHTML.includes('latest'));
    assert.equal(refreshed.length, 1);
    assert.ok(refreshed[0].includes('latest'), 'Refresh chart only after new table data is rendered');
    requests[0](result('outdated')); await old;
    assert.ok(body.innerHTML.includes('latest') && !body.innerHTML.includes('outdated'));
    assert.equal(refreshed.length, 1, 'Outdated table response must not trigger a chart refresh');
    const empty = context.loadTransactionRank();
    requests[2]({ json: async () => ({ success: true, items: [] }) }); await empty;
    assert.equal(refreshed.length, 2, 'An empty fresh ranking must still refresh the selected chart');
    console.log('PASS latest table response wins and successful table refresh updates selected chart');
    const listeners = {}, timers = new Map(), calls = []; let timerId = 0;
    const interval = { selectedIndex: 0, options: [{ value: '5', dataset: { interval: '30000' } }, { value: '2', dataset: { interval: '600000' } }] };
    const timerContext = vm.createContext({ console: { log() {} }, isCapturing: false, refreshIntervalSelect: interval,
        window: { addEventListener: (name, fn) => listeners[name] = fn },
        setInterval: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearInterval: id => timers.delete(id),
        loadData: () => calls.push('data'), loadTransactionRank: () => calls.push('table'), loadWatchlistRank: () => calls.push('watch') });
    const timerStart = source.indexOf('function startAutoRefresh()');
    vm.runInContext('let autoRefreshInterval = null;\n' + source.slice(timerStart, source.indexOf("refreshIntervalSelect.addEventListener('change'", timerStart)), timerContext);
    const cleanupStart = source.indexOf('// 페이지 언로드 시 정리');
    vm.runInContext(source.slice(cleanupStart, source.indexOf('// ==========================================================', cleanupStart)), timerContext);
    timerContext.startAutoRefresh(); assert.equal(timers.get(timerId).ms, 30000);
    listeners.beforeunload?.({}); assert.equal(timers.size, 1, 'External protocol beforeunload must not stop Rank refresh');
    timers.get(timerId).fn(); assert.deepEqual(calls, ['data', 'table', 'watch']);
    listeners.pagehide({}); assert.equal(timers.size, 0);
    interval.selectedIndex = 1; listeners.pageshow({ persisted: true }); assert.equal(timers.get(timerId).ms, 600000);
    console.log('PASS protocol launch preserves Rank timer, page exit stops it and restored page uses selected interval');
})().catch(error => { console.error(error); process.exitCode = 1; });
