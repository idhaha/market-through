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
    createRankIndependentRelay({ now: () => clock, request:async command=>{
        const response=await fetch(origin+command.path,{method:command.method||'GET',headers:{'Content-Type':'application/json'},...(command.body?{body:JSON.stringify(command.body)}:{})});
        return response.json();
    } }).mount(app);
    const points = Array.from({ length: 40 }, (_, index) => ({ time: '202608' + String(index + 1).padStart(2, '0'), value: index + 10, stock_price: 1000 }));
    app.post(['/api/concentration-chart','/api/ls-concentration-chart'], async (req, res) => {
        const sourceSeq=queries.length+1;queries.push({...req.body,sourceSeq}); await new Promise(resolve => setTimeout(resolve, 60));
        res.json({ success: true, points: points.map(point => ({ ...point, sourceSeq, value: point.value + transactionQueries })), market: 'K', cursor: 'cursor', has_more: true, debug_five_bars: { stock: [], market: [], fetched_at: new Date().toISOString() } });
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
        // A repeat read inside the cache's one-second coalescing window is
        // intentionally reused. Exercise refresh after that window instead.
        await child.waitForTimeout(1100);
        const chartQueriesBeforeRefresh = queries.length;
        const childBeforeRefresh = await child.evaluate(() => ({...getRankChartState(),points:undefined}));
        await child.locator('#rankIndependentRefresh').click();
        await child.waitForFunction(() => document.getElementById('independentStatusText').textContent === '로딩 중');
        await child.waitForFunction(() => document.getElementById('transactionBody').textContent.includes('123456'));
        await child.waitForFunction(revision => getRankChartState().revision > revision && !getRankChartState().busy, childBeforeRefresh.revision);
        assert.equal(transactionQueries, 1, 'Independent refresh must query the transaction table');
        assert.ok(queries.length > chartQueriesBeforeRefresh, 'Independent refresh must query the concentration chart');
        let freshChild;
        for(let attempt=0;attempt<100;attempt++){
            freshChild=queries.slice(chartQueriesBeforeRefresh).find(query=>query.code===childBeforeRefresh.selection.code&&query.mode===childBeforeRefresh.mode&&!query.prices_only);
            if(freshChild)break;await new Promise(resolve=>setTimeout(resolve,50));
        }
        assert.ok(freshChild,'Independent refresh uses its own selected stock and mode: '+JSON.stringify({selection:childBeforeRefresh.selection,mode:childBeforeRefresh.mode,requests:queries.slice(chartQueriesBeforeRefresh)}));
        await child.waitForFunction(seq=>getRankChartState().points.some(p=>p.sourceSeq===seq)&&!getRankChartState().busy,freshChild.sourceSeq);
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
        // The 2026-10-23 policy makes chart queries local to each window.
        // The independent window needs its own first page, but exactly once.
        assert.equal(queries.length, before+1, 'Opening independent window must make exactly one local initial chart query');
        assert.equal(queries.at(-1).code,'000001');
        assert.equal(await main.evaluate(()=>getRankChartState().revision),1,'Opening the peer must not refresh the main chart');
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
        await child.setViewportSize({ width: 1350, height: 1750 });
        const beforeResize = await heights();
        await child.setViewportSize({ width: 1350, height: 1950 });
        await child.evaluate(() => new Promise(requestAnimationFrame));
        const afterResize = await heights();
        assert.equal(afterResize.table, beforeResize.table, 'Table body retains its capped height when the window grows');
        assert.equal(afterResize.chart, 260, 'Chart retains the main-window plot height');
        assert.equal(afterResize.row, beforeResize.row, 'Table rows must not grow beyond the Rank default');
        assert.equal(afterResize.font, beforeResize.font, 'Table text size must remain fixed');
        assert.equal(afterResize.padding, beforeResize.padding, 'Cell padding must not grow beyond the Rank default');
        await child.setViewportSize({ width: 1350, height: 1650 });
        await child.evaluate(() => new Promise(requestAnimationFrame));
        const afterShrink = await heights();
        assert.ok(afterShrink.row <= afterResize.row && afterShrink.padding <= afterResize.padding, 'Minimum-height cards keep table rows at or below the default size');
        await child.setViewportSize({ width: 1350, height: 1750 });
        assert.ok((await heights()).row <= afterResize.row, 'Returning to the minimum-height layout does not enlarge table rows beyond the default');
        const collapseQueries = queries.length;
        await child.evaluate(() => { window.foldMessages = []; window.chrome.webview = { postMessage: message => {
            window.foldMessages.push(message);
            if (message.startsWith('resize-window:')) requestAnimationFrame(() => window.dispatchEvent(new Event('rank-native-resize-complete')));
        } }; });
        const chartSizeBeforeFold = await child.locator('#concentrationChartPanel').boundingBox();
        await child.getByRole('button', { name: '거래대금 상위 [키움] 접기', exact: true }).click();
        const chartSizeAfterFold = await child.locator('#concentrationChartPanel').boundingBox();
        assert.ok(Math.abs(chartSizeAfterFold.width - chartSizeBeforeFold.width) < 1, 'Remaining chart must not stretch when table folds');
        assert.ok(Math.abs(chartSizeAfterFold.height - chartSizeBeforeFold.height) < 1, 'Remaining chart height must be preserved');
        assert.match(await child.evaluate(() => window.foldMessages[0]), /^resize-window:0,-\d+,/);
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
        const mainRangeBefore = await main.evaluate(()=>RankChartAxis.dailyDomain());
        const childRangeBefore = await child.evaluate(()=>RankChartAxis.dailyDomain().days.length);
        await child.locator('#concentrationZoomIn').click();
        assert.ok(await child.evaluate(()=>RankChartAxis.dailyDomain().days.length)<childRangeBefore,'Zoom must reduce the independent chart date range');
        assert.deepEqual(await main.evaluate(()=>RankChartAxis.dailyDomain()), mainRangeBefore);
        await child.waitForFunction(() => !document.querySelector('#tab_rank .independent-collapsed'));
        await child.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        let testWindowMaxHeight = Infinity;
        await child.exposeFunction('resizeTestWindow', async message => {
            const match = /^resize-window:(-?\d+),(-?\d+),/.exec(message);
            if (!match) return;
            const viewport = child.viewportSize();
            await child.setViewportSize({ width: viewport.width + Number(match[1]), height: Math.min(testWindowMaxHeight, viewport.height + Number(match[2])) });
            await child.evaluate(() => window.dispatchEvent(new Event('rank-native-resize-complete')));
        });
        await child.evaluate(() => { window.chrome.webview.postMessage = message => { window.foldMessages.push(message); window.resizeTestWindow(message); }; });
        const beforeCandleHeight = await child.locator('.concentration-chart-area').evaluate(el => el.clientHeight);
        const beforeCandleGrowth = await child.locator('.concentration-chart-area, #rankSupplyChartPanel .rank-adr-area').evaluateAll(elements => elements.reduce((sum, element) => sum + element.clientHeight, 0));
        const beforeCandleWindow = child.viewportSize().height;
        await child.locator('#concentrationCandleToggle').click();
        assert.equal(await main.evaluate(() => getConcentrationDisplaySettings().candleOpen), false, 'Independent candles do not open the main candle');
        await child.waitForFunction(() => !document.getElementById('concentrationCandleArea').hidden);
        await child.waitForFunction(({ windowHeight, chartHeight }) => innerHeight === windowHeight + chartHeight, { windowHeight: beforeCandleWindow, chartHeight: beforeCandleGrowth });
        assert.equal(await child.locator('#concentrationCandleArea').evaluate(el => el.clientHeight), await child.locator('.concentration-chart-area').evaluate(el => el.clientHeight), 'Candles match concentration height in the three-panel layout');
        const staleDisplaySnapshot = await main.evaluate(() => ({ rows: document.getElementById('transactionBody').innerHTML, chart: getRankChartState(), display: getConcentrationDisplaySettings() }));
        await main.route('**/api/rank-independent/*/owner', async route => { await new Promise(resolve => setTimeout(resolve, 700)); await route.continue(); });
        await child.evaluate(() => { window.candleReopens = 0; new MutationObserver(() => { if (!document.getElementById('concentrationCandleArea').hidden) window.candleReopens++; }).observe(document.getElementById('concentrationCandleArea'), { attributes: true, attributeFilter: ['hidden'] }); });
        await child.locator('#concentrationCandleToggle').click();
        await json(`/api/rank-independent/${ticket.id}/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rank-Owner': ticket.ownerKey }, body: JSON.stringify({ snapshot: staleDisplaySnapshot }) });
        await main.waitForFunction(() => !getConcentrationDisplaySettings().candleOpen);
        await child.waitForFunction(height => innerHeight === height, beforeCandleWindow);
        await main.unrouteAll({behavior:'wait'});
        assert.equal(await child.evaluate(() => window.candleReopens), 0, 'An outdated open snapshot must not reopen candles while close confirmation is pending');
        assert.equal(await child.locator('.concentration-chart-area').evaluate(el => el.clientHeight), beforeCandleHeight, 'Closing candles must restore window without changing concentration chart height');
        await child.setViewportSize({ width: 900, height: 1100 });
        const stackedBefore = await child.locator('.concentration-chart-area, #rankSupplyChartPanel .rank-adr-area').evaluateAll(elements => elements.reduce((sum, element) => sum + element.clientHeight, 0));
        await child.locator('#concentrationCandleToggle').click();
        await child.waitForFunction(height => !document.getElementById('concentrationCandleArea').hidden && innerHeight === 1100 + height, stackedBefore);
        assert.equal(await child.locator('#concentrationCandleArea').evaluate(el => el.clientHeight), await child.locator('.concentration-chart-area').evaluate(el => el.clientHeight), 'Resized vertical layout keeps main and candle plots equal');
        await child.locator('#concentrationCandleToggle').click();
        await main.waitForFunction(() => !getConcentrationDisplaySettings().candleOpen);
        await child.waitForFunction(() => innerHeight === 1100);
        // Reproduce a monitor-constrained candle window, then fold both panels.
        testWindowMaxHeight = 1100;
        await child.locator('#concentrationCandleToggle').click();
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
        await child.waitForFunction(() => !document.querySelector('#tab_rank .independent-collapsed'));
        testWindowMaxHeight = Infinity;
        await child.locator('#concentrationCandleToggle').click();
        await main.waitForFunction(() => !getConcentrationDisplaySettings().candleOpen);
        await child.setViewportSize({ width: 1350, height: 850 });
        await child.locator('#transactionBody tr').nth(1).click();
        await child.waitForFunction(() => getRankChartState().selection.code === '000002' && !getRankChartState().busy);
        assert.equal(await main.evaluate(()=>getRankChartState().selection.code),'000001','Peer stock selection must leave the main chart unchanged');
        assert.equal(queries.filter(query => query.code === '000002' && !query.debug_five).length, 1, 'Local selection must issue exactly one chart query');
        assert.equal(await child.locator('#rankStockPinned, #rankSupplyPinned').count(), 0);
        await main.locator('#transactionBody tr').first().click();
        await main.waitForFunction(() => getRankChartState().selection.code === '000001' && !getRankChartState().busy);
        assert.equal(await child.evaluate(()=>getRankChartState().selection.code),'000002','Main table selection must leave the peer chart unchanged');
        await child.locator('#concentrationStockName').fill('000003'); await child.locator('#concentrationStockName').press('Enter');
        await child.waitForFunction(() => getRankChartState().selection.code === '000003' && !getRankChartState().busy);
        assert.equal(await main.evaluate(()=>getRankChartState().selection.code),'000001');
        await child.locator('#mrktTp').selectOption('101');
        await main.waitForFunction(() => document.getElementById('mrktTp').value === '101');
        await child.locator('[data-chart-mode="minute"]').click();
        await child.waitForFunction(() => getRankChartState().mode === 'minute' && getRankChartState().interval === 1);
        assert.equal(await main.evaluate(() => getRankChartState().mode), 'day', 'Peer mode changes must leave the main timeframe unchanged');
        await child.waitForFunction(() => !getRankChartState().busy);
        await main.locator('#transactionBody tr').first().click();
        assert.equal(await child.evaluate(()=>getRankChartState().selection.code),'000003');
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
        await reopened.waitForFunction(() => window.rankIndependentLastFailure?.status===401);
        assert.equal(reopened.isClosed(),false,'An expired connection must leave the independent window open for recovery');
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
            assert.equal(queries.length, beforeNative+1, 'Native WebView2 also makes exactly one local initial chart query');
            console.log(result.stdout.trim());
        }
        missingApp.once('dialog', dialog => { assert.match(dialog.message(), /설치되지 않았거나 실행이 취소/); dialog.accept(); });
        const downloadPromise = missingApp.waitForEvent('download').catch(async error => {
            console.error('Installer fallback state:', await missingApp.locator('#rankIndependentControls').textContent());
            throw error;
        });
        await missingApp.getByRole('button', { name: '독립창', exact: true }).click();
        await missingApp.waitForFunction(() => window.testLaunchUrl);
        await missingApp.evaluate(() => { const original = Date.now.bind(Date); Date.now = () => original() + 21000; });
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), 'MarketThroughSetup.exe');
        assert.equal(await missingApp.getByRole('button', { name: '독립창', exact: true }).isDisabled(), false);
        assert.match(await missingApp.locator('#rankIndependentControls [role="status"]').textContent(), /다운로드한 MarketThroughSetup.exe/);
        await missingApp.waitForTimeout(1200);
        assert.equal(await missingApp.getByRole('link', { name: /설치/ }).count(), 0);
        console.log('PASS Rank relay security, one local initial query, isolated selection/mode, shared table conditions, independent zoom, close/reopen and owner shutdown');
        console.log('PASS missing-app notice and automatic installer download without separate install link');
        console.log('PASS independent panel collapse/expand preserves main view and reuses data');
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

