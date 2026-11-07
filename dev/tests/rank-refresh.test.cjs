const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

(async () => {
    const source = fs.readFileSync('public/app.js', 'utf8');
    const start = source.indexOf('let transactionRankRequest = 0;');
    const code = source.slice(start, source.indexOf('/**', start));
    const requests = [], refreshed = [], selected = [], body = { innerHTML: '' };
    let selection = null;
    const context = vm.createContext({
        isCapturing: false, mrktTpSelect: { value: '000' }, stexTpSelect: { value: '3' }, transactionBody: body,
        console: { log() {}, warn() {}, error() {} },
        fetch: () => new Promise(resolve => requests.push(resolve)),
        window: {
            rankChartRowAttributes: () => '',
            RankChartAxis: { refreshCharts: ({skipConcentration}={}) => { if(!skipConcentration)refreshed.push(body.innerHTML); } },
            refreshConcentrationChart: () => refreshed.push(body.innerHTML),
            getRankChartState: () => ({ selection }),
            selectRankChartStock: stock => { selection = stock; selected.push(stock); }
        },
        getPriceClass: () => '', formatChangeRate: String, formatNumber: String
    });
    vm.runInContext(code, context);
    const old = context.loadTransactionRank();
    const latest = context.loadTransactionRank();
    const result = (name, code = '005930') => ({ json: async () => ({ success: true, items: [{ stk_cd: code, stk_nm: name, mkt_type: 'K', concentration_rate: 43 }] }) });
    requests[1](result('latest')); await latest;
    assert.ok(body.innerHTML.includes('latest'));
    assert.equal(selected.length, 1);
    assert.equal(selected[0].code, '005930');
    assert.equal(selected[0].name, 'latest');
    assert.equal(refreshed.length, 0, 'Initial selection loads the chart without a duplicate refresh');
    requests[0](result('outdated')); await old;
    assert.ok(body.innerHTML.includes('latest') && !body.innerHTML.includes('outdated'));
    assert.equal(selected.length, 1, 'Outdated table response must not change the selected stock');
    const next = context.loadTransactionRank();
    requests[2](result('new leader', '000660')); await next;
    assert.equal(selected.length, 1, 'Refreshing the ranking must preserve the selected stock');
    assert.equal(refreshed.length, 1);
    assert.ok(refreshed[0].includes('latest'), 'Selected chart refresh starts before the ranking response instead of waiting for new table data');
    selection = { code: '035420', name: 'direct input' };
    const afterDirectInput = context.loadTransactionRank();
    requests[3](result('another leader', '373220')); await afterDirectInput;
    assert.equal(selection.code, '035420', 'A stock chosen by direct input must survive ranking refresh');
    assert.equal(selected.length, 1, 'Ranking refresh must not reselect the leader after direct input');
    const empty = context.loadTransactionRank();
    requests[4]({ json: async () => ({ success: true, items: [] }) }); await empty;
    assert.equal(refreshed.length, 3, 'An empty fresh ranking must still refresh the selected chart');
    console.log('PASS latest table response wins and successful table refresh updates selected chart');
    const listeners = {}, timers = new Map(), calls = []; let timerId = 0;
    const interval = { selectedIndex: 0, options: [{ value: '5', dataset: { interval: '30000' } }, { value: '2', dataset: { interval: '600000' } }] };
    let rankQuery = '3';
    const timerContext = vm.createContext({ console: { log() {} }, isCapturing: false, refreshIntervalSelect: interval,
        RANK_QUERY_PERIODS: { '4': 30000, '5': 30000, '1': 60000, '2': 600000, '3': 3600000 }, rankQueryValue: () => rankQuery,
        window: { addEventListener: (name, fn) => listeners[name] = fn },
        setInterval: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearInterval: id => timers.delete(id),
        loadData: (options = {}) => calls.push(options.ranking === false ? 'data:efriend' : 'data:ranking'), loadTransactionRank: () => calls.push('table'), loadWatchlistRank: () => calls.push('watch') });
    const timerStart = source.indexOf('function startAutoRefresh()');
    vm.runInContext('let autoRefreshInterval = null;\n' + source.slice(timerStart, source.indexOf("refreshIntervalSelect.addEventListener('change'", timerStart)), timerContext);
    const cleanupStart = source.indexOf('// 페이지 언로드 시 정리');
    vm.runInContext(source.slice(cleanupStart, source.indexOf('// ==========================================================', cleanupStart)), timerContext);
    timerContext.startAutoRefresh(); assert.equal(timers.get(timerId).ms, 30000);
    // 실시간 조회 순위 runs on its own choice (1시간 here), not the 30초 tab interval.
    const rankingTimer = [...timers.entries()].find(([id]) => id !== timerId);
    assert.equal(rankingTimer[1].ms, 3600000);
    listeners.beforeunload?.({}); assert.equal(timers.size, 2, 'External protocol beforeunload must not stop Rank refresh');
    timers.get(timerId).fn(); assert.deepEqual(calls, ['data:efriend', 'table', 'watch'], 'tab refresh leaves the ranking table alone');
    calls.length = 0; rankingTimer[1].fn(); assert.deepEqual(calls, ['data:ranking']);
    // A tab interval change keeps the ranking schedule.
    timerContext.startAutoRefresh(); assert.ok(timers.has(rankingTimer[0]), 'ranking timer kept');
    listeners.pagehide({}); assert.equal(timers.size, 0);
    interval.selectedIndex = 1; rankQuery = '4'; listeners.pageshow({ persisted: true }); assert.equal(timers.get(timerId).ms, 600000);
    assert.deepEqual([...timers.values()].map(t => t.ms).sort((a, b) => a - b), [30000, 600000], '당일누적 ranking refreshes every 30 s');
    console.log('PASS protocol launch preserves Rank timer, page exit stops it, restored page uses selected interval, ranking table keeps its own cycle');
})().catch(error => { console.error(error); process.exitCode = 1; });
