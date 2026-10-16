const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const { chromium } = require('playwright');
const { createRankIndependentRelay } = require('../../rank-independent');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

(async () => {
    const app = express(); app.use(express.json({ limit: '5mb' }));
    let clock = Date.now(), ticket, queries = [], transactionQueries = 0;
    app.use((req, res, next) => {
        req.authUser = { email: req.get('X-Test-User') || 'owner@test' };
        if (req.path === '/api/rank-independent' && req.method === 'POST') {
            const send = res.json.bind(res); res.json = value => { ticket = value; return send(value); };
        }
        next();
    });
    createRankIndependentRelay({ now: () => clock }).mount(app);
    const points = Array.from({ length: 40 }, (_, index) => ({ time: '202608' + String(index + 1).padStart(2, '0'), value: index + 10, stock_price: 1000 }));
    app.post('/api/concentration-chart', async (req, res) => {
        queries.push(req.body); await new Promise(resolve => setTimeout(resolve, 60));
        res.json({ success: true, points: points.map(point => ({ ...point, value: point.value + transactionQueries })), market: 'K', cursor: 'cursor', has_more: true, debug_five_bars: { stock: [], market: [], fetched_at: new Date().toISOString() } });
    });
    app.get('/api/transaction_rank', async (req, res) => {
        transactionQueries++;
        await new Promise(resolve => setTimeout(resolve, 800));
        res.json({ success: true, items: [
            { stk_cd: '000001', stk_nm: '첫번째', mkt_type: 'K', trde_amt: '123456', concentration_rate: 42 },
            { stk_cd: '000002', stk_nm: '두번째', mkt_type: 'K', trde_amt: '654321', concentration_rate: 21 }
        ] });
    });
    app.get('/api/concentration-stock', (req, res) => res.json({ success: true, stock: { code: '000003', name: '세번째', market: 'K' } }));
    app.get('/main', (req, res) => res.type('html').send(fs.readFileSync('public/rank-independent.html', 'utf8')
        .replace('<main id="tab_rank">', '<span id="lastUpdate">-</span><span id="statusText">대기 중</span><main id="tab_rank">')
        .replace(/<link rel="stylesheet" href="rank-independent.css[^\"]*">/, '<style>#tab_rank { display:grid; grid-template-columns:1fr 1.45fr; gap:14px; }</style>')
        .replace('<main id="tab_rank">', '<div class="header-single-line"><div class="rank-title-group"><h1>Rank</h1><div id="rankIndependentControls"></div></div></div><main id="tab_rank">')
        .replace(/<script src="rank-independent-client.js[^\"]*" defer><\/script>/, '<script src="rank-independent-main.js?v=20261011_v1" defer></script>')));
    // Capture protocol launches; a real external-app prompt blocks headless input.
    app.get('/rank-independent-main.js', (req, res) => res.type('js').send(fs.readFileSync('public/rank-independent-main.js', 'utf8')
        .replace("location.href = 'marketthrough://open?url=' + encodeURIComponent(url);", "window.testLaunchUrl = 'marketthrough://open?url=' + encodeURIComponent(url);")));
    async function verifyIndependentRefresh(main, child) {
        // Exercise the production table loader through the real peer refresh command.
        const appSource = fs.readFileSync('public/app.js', 'utf8');
        const loader = appSource.slice(appSource.indexOf('let transactionRankRequest = 0;'), appSource.indexOf('/**', appSource.indexOf('let transactionRankRequest = 0;')));
        await main.addScriptTag({ content: `
            const isCapturing = false, PERM_TAB_ID = 'tab_rank';
            const mrktTpSelect = document.getElementById('mrktTp'), stexTpSelect = document.getElementById('stexTp');
            const statusText = document.getElementById('statusText');
            const transactionBody = document.getElementById('transactionBody'), lastUpdate = document.getElementById('lastUpdate');
            const formatTime = date => date.toISOString(), formatNumber = value => String(value);
            const getPriceClass = () => '', formatChangeRate = value => String(value);
            ${appSource.slice(appSource.indexOf('function updateStatus('), appSource.indexOf('/**', appSource.indexOf('function updateStatus(')))}
            window.marketRefreshes = 0;
            window.refreshRankAdrChart = window.refreshRankTurnoverChart = () => window.marketRefreshes++;
            ${loader}
        ` });
        const chartQueriesBeforeRefresh = queries.length;
        await child.locator('#rankIndependentRefresh').click();
        await child.waitForFunction(() => document.getElementById('independentStatusText').textContent === '로딩 중');
        await child.waitForFunction(() => document.getElementById('transactionBody').textContent.includes('123456'));
        await child.waitForFunction(() => getRankChartState().points.at(-1)?.value === 50 && !getRankChartState().busy);
        assert.equal(transactionQueries, 1, 'Independent refresh must query the transaction table');
        assert.ok(queries.length > chartQueriesBeforeRefresh, 'Independent refresh must query the concentration chart');
        assert.equal(await main.evaluate(() => window.marketRefreshes), 0, 'Independent refresh must skip ADR and turnover charts');
        assert.equal(await child.locator('#independentStatusText').textContent(), '완료');
        assert.notEqual(await child.locator('#independentLastUpdate').textContent(), '2026/10/12 11:54:53');
        await main.evaluate(() => loadTransactionRank());
        assert.equal(await main.evaluate(() => window.marketRefreshes), 2, 'Main refresh must keep ADR and turnover chart refreshes');
        await main.waitForFunction(() => !getRankChartState().busy);
    }
    app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const json = async (path, options = {}) => {
        const result = await fetch(origin + path, options); return { status: result.status, body: await result.json() };
    };
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        // Capability validation, owner isolation, payload/queue limits and expiration.
        let channel = (await json('/api/rank-independent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).body;
        const headers = { 'Content-Type': 'application/json', 'X-Rank-Owner': channel.ownerKey };
        const own = `/api/rank-independent/${channel.id}/owner`, peerPath = `/api/rank-independent/peer/${channel.id}`;
        assert.equal((await json(own, { method: 'POST', headers: { ...headers, 'X-Test-User': 'other@test' }, body: '{}' })).status, 404);
        assert.equal((await json(own, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
        assert.equal((await json(peerPath, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' }, body: '{}' })).status, 401);
        assert.equal((await json(own, { method: 'POST', headers, body: JSON.stringify({ snapshot: { value: 'x'.repeat(2000001) } }) })).status, 413);
        const peerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${channel.token}` };
        const commandId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        const delivery = { command: { id: commandId, type: 'refresh' } };
        await json(peerPath, { method: 'POST', headers: peerHeaders, body: JSON.stringify(delivery) });
        await json(peerPath, { method: 'POST', headers: peerHeaders, body: JSON.stringify(delivery) });
        for (let attempt = 0; attempt < 2; attempt++) assert.equal((await json(own, { method: 'POST', headers, body: '{}' })).body.commands.length, 1);
        assert.equal((await json(own, { method: 'POST', headers, body: JSON.stringify({ acks: [commandId], replies: [{ id: commandId, body: '{}', status: 200 }] }) })).body.commands.length, 0);
        for (let attempt = 0; attempt < 2; attempt++) assert.equal((await json(peerPath, { method: 'POST', headers: peerHeaders, body: '{}' })).body.replies.length, 1);
        assert.equal((await json(peerPath, { method: 'POST', headers: peerHeaders, body: JSON.stringify({ acks: [commandId] }) })).body.replies.length, 0);
        clock += 120001;
        assert.equal((await json(peerPath, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${channel.token}` }, body: '{}' })).status, 401);
        clock = Date.now();
        const main = await browser.newPage({ viewport: { width: 1500, height: 900 } });
        const errors = []; main.on('pageerror', error => errors.push(error.message));
        await main.goto(origin + '/main');
        await main.evaluate(() => {
            document.getElementById('transactionBody').innerHTML = '<tr data-chart-code="000001" data-chart-name="첫번째" data-chart-market="K"><td>1</td><td>K</td><td>첫번째</td></tr><tr data-chart-code="000002" data-chart-name="두번째" data-chart-market="K"><td>2</td><td>K</td><td>두번째</td></tr>';
            window.selectRankChartStock({ code: '000001', name: '첫번째', market: 'K' });
        });
        await main.waitForFunction(() => !getRankChartState().busy && getRankChartState().points.length === 40);
        const before = queries.length;
        await main.getByRole('button', { name: '독립창', exact: true }).click();
        assert.equal(await main.getByRole('button', { name: '독립창', exact: true }).isDisabled(), true);
        const child = await browser.newPage({ viewport: { width: 1350, height: 850 } }); child.on('pageerror', error => errors.push(error.message));
        await child.goto(`${origin}/rank-independent.html#id=${ticket.id}&token=${ticket.token}`);
        await child.waitForFunction(() => window.getRankChartState?.()?.points.length === 40);
        assert.equal(queries.length, before, 'Opening independent window must reuse existing data');
        assert.equal(await main.locator('#transactionBody tr').count(), 2);
        assert.equal(await child.locator('#transactionBody tr').count(), 2);
        await main.evaluate(() => { document.getElementById('lastUpdate').textContent = '2026/10/12 11:54:53'; document.getElementById('statusText').textContent = '로딩 중'; });
        await child.waitForFunction(() => document.getElementById('independentStatusText').textContent === '로딩 중');
        assert.equal(await child.locator('#independentLastUpdate').textContent(), '2026/10/12 11:54:53');
        await main.evaluate(() => { document.getElementById('statusText').textContent = '완료'; });
        await child.waitForFunction(() => document.getElementById('independentStatusText').textContent === '완료');
        if (process.env.RANK_REFRESH_ONLY === '1') {
            await verifyIndependentRefresh(main, child);
            assert.deepEqual(errors, []);
            console.log('PASS independent refresh: table, concentration, status; no ADR/turnover; main refresh preserved');
            return;
        }
        const heights = async () => child.evaluate(() => ({ table: document.getElementById('transactionBody').clientHeight, chart: document.querySelector('.concentration-chart-area').clientHeight,
            row: document.querySelector('#transactionBody tr').getBoundingClientRect().height, font: parseFloat(getComputedStyle(document.querySelector('#transactionBody td')).fontSize), padding: parseFloat(getComputedStyle(document.querySelector('#transactionBody td')).paddingTop) }));
        const beforeResize = await heights();
        await child.setViewportSize({ width: 1350, height: 1050 });
        await child.waitForFunction(previous => document.querySelector('.concentration-chart-area').clientHeight > previous, beforeResize.chart);
        const afterResize = await heights();
        assert.ok(afterResize.table > beforeResize.table, 'Table body must grow with window height');
        assert.equal(afterResize.row, beforeResize.row, 'Table rows must not grow beyond the Rank default');
        assert.equal(afterResize.font, beforeResize.font, 'Table text size must remain fixed');
        assert.equal(afterResize.padding, beforeResize.padding, 'Cell padding must not grow beyond the Rank default');
        await child.setViewportSize({ width: 1350, height: 650 });
        await child.waitForFunction(previous => document.querySelector('.concentration-chart-area').clientHeight < previous, afterResize.chart);
        await child.waitForFunction(previous => document.querySelector('#transactionBody tr').getBoundingClientRect().height < previous, afterResize.row);
        const afterShrink = await heights();
        assert.ok(afterShrink.row < afterResize.row && afterShrink.padding < afterResize.padding, 'Table rows and spacing must shrink with window height');
        await child.setViewportSize({ width: 1350, height: 850 });
        await child.waitForFunction(previous => document.querySelector('#transactionBody tr').getBoundingClientRect().height === previous, beforeResize.row);
        const collapseQueries = queries.length;
        await child.evaluate(() => { window.foldMessages = []; window.chrome.webview = { postMessage: message => window.foldMessages.push(message) }; });
        const chartSizeBeforeFold = await child.locator('#concentrationChartPanel').boundingBox();
        await child.getByRole('button', { name: '거래대금 상위 [키움] 접기', exact: true }).click();
        const chartSizeAfterFold = await child.locator('#concentrationChartPanel').boundingBox();
        assert.ok(Math.abs(chartSizeAfterFold.width - chartSizeBeforeFold.width) < 1, 'Remaining chart must not stretch when table folds');
        assert.ok(Math.abs(chartSizeAfterFold.height - chartSizeBeforeFold.height) < 1, 'Remaining chart height must be preserved');
        assert.match(await child.evaluate(() => window.foldMessages[0]), /^resize-window:-\d+,0,/);
        assert.equal(await child.locator('#transactionTable').isVisible(), false);
        assert.equal(await main.locator('#transactionTable').isVisible(), true);
        await child.getByRole('button', { name: '쏠림율 접기', exact: true }).click();
        assert.equal(await child.locator('#concentrationCanvas').isVisible(), false);
        await child.getByRole('button', { name: '거래대금 상위 [키움] 펼치기', exact: true }).click();
        await child.getByRole('button', { name: '쏠림율 펼치기', exact: true }).click();
        assert.equal(await child.locator('#concentrationCanvas').isVisible(), true);
        assert.equal(queries.length, collapseQueries, 'Panel folding must not issue market queries');
        assert.equal(await child.evaluate(() => location.hash), '');
        const nativeSmoke = path.resolve('desktop/build/RankNativeSmoke.exe');
        const nativeSnapshot = await main.evaluate(() => ({ rows: document.getElementById('transactionBody').innerHTML, chart: getRankChartState(), conditions: { mrktTp: '000', stexTp: '3', refreshInterval: '2' } }));
        const mainRangeBefore = await main.locator('#concentrationRange').getAttribute('max');
        await child.locator('#concentrationZoomIn').click();
        assert.equal(await child.locator('#concentrationRange').getAttribute('max'), '20');
        assert.equal(await main.locator('#concentrationRange').getAttribute('max'), mainRangeBefore);
        await child.waitForFunction(() => !document.getElementById('tab_rank').style.height);
        let testWindowMaxHeight = Infinity;
        await child.exposeFunction('resizeTestWindow', async message => {
            const match = /^resize-window:(-?\d+),(-?\d+),/.exec(message);
            if (!match) return;
            const viewport = child.viewportSize();
            await child.setViewportSize({ width: viewport.width + Number(match[1]), height: Math.min(testWindowMaxHeight, viewport.height + Number(match[2])) });
        });
        await child.evaluate(() => { window.chrome.webview.postMessage = message => { window.foldMessages.push(message); window.resizeTestWindow(message); }; });
        const beforeCandleHeight = await child.locator('.concentration-chart-area').evaluate(el => el.clientHeight);
        const beforeCandleWindow = child.viewportSize().height;
        await main.locator('#concentrationCandleToggle').click();
        assert.equal(await main.evaluate(() => getConcentrationDisplaySettings().candleOpen), true, 'Main candle toggle must open before synchronization');
        await child.waitForFunction(() => !document.getElementById('concentrationCandleArea').hidden);
        await child.waitForFunction(({ windowHeight, chartHeight }) => innerHeight === windowHeight + chartHeight, { windowHeight: beforeCandleWindow, chartHeight: beforeCandleHeight });
        assert.equal(await child.locator('#concentrationCandleArea').evaluate(el => el.clientHeight), beforeCandleHeight, 'Candles must match concentration height at opening');
        assert.equal(await child.locator('.concentration-chart-area').evaluate(el => el.clientHeight), beforeCandleHeight, 'Opening candles must preserve concentration chart height');
        const staleDisplaySnapshot = await main.evaluate(() => ({ rows: document.getElementById('transactionBody').innerHTML, chart: getRankChartState(), display: getConcentrationDisplaySettings() }));
        await main.route('**/api/rank-independent/*/owner', async route => { await new Promise(resolve => setTimeout(resolve, 700)); await route.continue(); });
        await child.evaluate(() => { window.candleReopens = 0; new MutationObserver(() => { if (!document.getElementById('concentrationCandleArea').hidden) window.candleReopens++; }).observe(document.getElementById('concentrationCandleArea'), { attributes: true, attributeFilter: ['hidden'] }); });
        await child.locator('#concentrationCandleToggle').click();
        await json(`/api/rank-independent/${ticket.id}/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rank-Owner': ticket.ownerKey }, body: JSON.stringify({ snapshot: staleDisplaySnapshot }) });
        await main.waitForFunction(() => document.getElementById('concentrationCandleArea').hidden);
        await child.waitForFunction(height => innerHeight === height, beforeCandleWindow);
        await main.unroute('**/api/rank-independent/*/owner');
        assert.equal(await child.evaluate(() => window.candleReopens), 0, 'An outdated open snapshot must not reopen candles while close confirmation is pending');
        assert.equal(await child.locator('.concentration-chart-area').evaluate(el => el.clientHeight), beforeCandleHeight, 'Closing candles must restore window without changing concentration chart height');
        await child.setViewportSize({ width: 900, height: 1100 });
        const stackedBefore = await child.locator('.concentration-chart-area').evaluate(el => el.clientHeight);
        await main.locator('#concentrationCandleToggle').click();
        await child.waitForFunction(height => !document.getElementById('concentrationCandleArea').hidden && innerHeight === 1100 + height, stackedBefore);
        assert.equal(await child.locator('#concentrationCandleArea').evaluate(el => el.clientHeight), stackedBefore, 'After a window resize candles must use the new concentration height');
        assert.equal(await child.locator('.concentration-chart-area').evaluate(el => el.clientHeight), stackedBefore, 'Stacked layout must give extra space to candles without shrinking concentration chart');
        await child.locator('#concentrationCandleToggle').click();
        await main.waitForFunction(() => document.getElementById('concentrationCandleArea').hidden);
        await child.waitForFunction(() => innerHeight === 1100);
        // Reproduce a monitor-constrained candle window, then fold both panels.
        testWindowMaxHeight = 1100;
        await main.locator('#concentrationCandleToggle').click();
        await child.waitForFunction(() => !document.getElementById('concentrationCandleArea').hidden);
        await child.getByRole('button', { name: '쏠림율 접기', exact: true }).click();
        const chartExpand = child.getByRole('button', { name: '쏠림율 펼치기', exact: true });
        await child.waitForFunction(() => { const r = document.querySelector('#concentrationChartPanel .independent-collapse').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
        assert.ok(await chartExpand.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'Chart expand control must remain inside folded window');
        await child.getByRole('button', { name: '거래대금 상위 [키움] 접기', exact: true }).click();
        for (const name of ['거래대금 상위 [키움] 펼치기', '쏠림율 펼치기']) {
            const button = child.getByRole('button', { name, exact: true });
            await child.waitForFunction(() => [...document.querySelectorAll('.independent-collapse')].every(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
            assert.equal(await button.isVisible(), true);
        }
        await chartExpand.click();
        await child.getByRole('button', { name: '거래대금 상위 [키움] 펼치기', exact: true }).click();
        await child.waitForFunction(() => !document.getElementById('tab_rank').style.height);
        testWindowMaxHeight = Infinity;
        await child.locator('#concentrationCandleToggle').click();
        await main.waitForFunction(() => document.getElementById('concentrationCandleArea').hidden);
        await child.setViewportSize({ width: 1350, height: 850 });
        await child.locator('#transactionBody tr').nth(1).click();
        await main.waitForFunction(() => getRankChartState().selection.code === '000002' && !getRankChartState().busy);
        await child.waitForFunction(() => getRankChartState().selection.code === '000002' && !getRankChartState().busy);
        assert.equal(queries.filter(query => query.code === '000002' && !query.debug_five).length, 1, 'Shared selection must deduplicate chart query');
        await child.locator('#rankStockPinned').check();
        await main.locator('#transactionBody tr').first().click();
        await main.waitForFunction(() => getRankChartState().selection.code === '000001' && !getRankChartState().busy);
        await child.waitForTimeout(1200);
        assert.equal(await child.evaluate(() => getRankChartState().selection.code), '000002');
        assert.equal(await child.getByRole('checkbox', { name: 'Rank탭 종목동기화 해제', exact: true }).count(), 1);
        assert.equal(await child.locator('.independent-chart-heading #rankStockPinned').count(), 1, 'Synchronization checkbox must be beside the chart title');
        await child.locator('#concentrationStockName').fill('000003'); await child.locator('#concentrationStockName').press('Enter');
        await child.waitForFunction(() => getRankChartState().selection.code === '000003' && !getRankChartState().busy);
        assert.equal(await main.evaluate(() => getRankChartState().selection.code), '000001');
        await child.locator('#mrktTp').selectOption('101');
        await main.waitForFunction(() => document.getElementById('mrktTp').value === '101');
        await child.locator('[data-chart-mode="minute"]').click();
        await main.waitForFunction(() => getRankChartState().mode === 'minute');
        await child.waitForFunction(() => getRankChartState().interval === 5);
        assert.equal(await main.evaluate(() => getRankChartState().interval), 5, 'Minute chart must default to 5 minutes');
        await child.waitForFunction(() => !getRankChartState().busy);
        await child.locator('#rankStockPinned').uncheck();
        await child.waitForFunction(() => getRankChartState().selection.code === '000001');
        assert.equal(await child.locator('#concentrationStockName').getAttribute('readonly'), null);
        await verifyIndependentRefresh(main, child);
        // Native close notification enables the original button and leaves original content intact.
        await json(`/api/rank-independent/peer/${ticket.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ticket.token}` }, body: '{"close":true}' });
        await main.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '독립창' && !button.disabled));
        assert.equal(await main.locator('#transactionBody tr').count(), 2);
        await child.close();
        await main.getByRole('button', { name: '독립창', exact: true }).click();
        const reopened = await browser.newPage();
        await reopened.goto(`${origin}/rank-independent.html#id=${ticket.id}&token=${ticket.token}`);
        await reopened.waitForFunction(() => window.getRankChartState?.()?.selection?.code === '000001');
        assert.deepEqual(errors, []);
        // Main session deletion is visible to the independent view.
        await main.close();
        await reopened.waitForFunction(() => document.getElementById('rankConnectionStatus').textContent.includes('終了') || document.getElementById('rankConnectionStatus').textContent.includes('종료'));
        const missingApp = await browser.newPage();
        const queuedRefresh = await browser.newPage();
        await queuedRefresh.goto(origin + '/main');
        await queuedRefresh.evaluate(() => {
            selectRankChartStock({ code: '000004', name: '갱신 지연 테스트', market: 'K' });
            refreshConcentrationChart(); refreshConcentrationChart(); refreshConcentrationChart();
        });
        await queuedRefresh.waitForFunction(() => getRankChartState().revision >= 2 && !getRankChartState().busy);
        assert.equal(queries.filter(query => query.code === '000004' && !query.debug_five).length, 2, 'Refreshes during an active chart query must coalesce into one follow-up query');
        await queuedRefresh.close();
        await missingApp.goto(origin + '/main');
        assert.equal(await missingApp.getByRole('link', { name: /설치/ }).count(), 0);
        // Run native focus/TopMost checks after browser input tests.
        if (fs.existsSync(nativeSmoke)) {
            const nativeTicket = (await json('/api/rank-independent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).body;
            await json(`/api/rank-independent/${nativeTicket.id}/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rank-Owner': nativeTicket.ownerKey }, body: JSON.stringify({ snapshot: nativeSnapshot }) });
            const beforeNative = queries.length;
            const result = await promisify(execFile)(nativeSmoke, [`${origin}/rank-independent.html#id=${nativeTicket.id}&token=${nativeTicket.token}`], { cwd: path.dirname(nativeSmoke), windowsHide: true, timeout: 45000 });
            await json(`/api/rank-independent/${nativeTicket.id}/owner`, { method: 'DELETE', headers: { 'X-Rank-Owner': nativeTicket.ownerKey } });
            assert.match(result.stdout, /PASS real native WebView2 page/);
            assert.equal(queries.length, beforeNative, 'Native WebView2 opening must also reuse data');
            console.log(result.stdout.trim());
        }
        missingApp.once('dialog', dialog => { assert.match(dialog.message(), /설치되지 않았거나 실행이 취소/); dialog.accept(); });
        const downloadPromise = missingApp.waitForEvent('download');
        await missingApp.getByRole('button', { name: '독립창', exact: true }).click();
        await missingApp.evaluate(() => { const original = Date.now.bind(Date); Date.now = () => original() + 21000; });
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), 'MarketThroughSetup.exe');
        assert.equal(await missingApp.getByRole('button', { name: '독립창', exact: true }).isDisabled(), false);
        assert.match(await missingApp.locator('#rankIndependentControls [role="status"]').textContent(), /다운로드한 MarketThroughSetup.exe/);
        await missingApp.waitForTimeout(1200);
        assert.equal(await missingApp.getByRole('link', { name: /설치/ }).count(), 0);
        console.log('PASS Rank relay security, initial reuse, shared selection/conditions, pin, independent zoom, close/reopen and owner shutdown');
        console.log('PASS missing-app notice and automatic installer download without separate install link');
        console.log('PASS independent panel collapse/expand preserves main view and reuses data');
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

