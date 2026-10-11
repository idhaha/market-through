const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const { chromium } = require('playwright');
const { createRankIndependentRelay } = require('../rank-independent');
const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

(async () => {
    const app = express(); app.use(express.json({ limit: '5mb' }));
    let clock = Date.now(), ticket, queries = [];
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
        res.json({ success: true, points, market: 'K', cursor: 'cursor', has_more: true, debug_five_bars: { stock: [], market: [], fetched_at: new Date().toISOString() } });
    });
    app.get('/api/concentration-stock', (req, res) => res.json({ success: true, stock: { code: '000003', name: '세번째', market: 'K' } }));
    app.get('/main', (req, res) => res.type('html').send(fs.readFileSync('public/rank-independent.html', 'utf8')
        .replace(/<link rel="stylesheet" href="rank-independent.css[^\"]*">/, '<style>#tab_rank { display:grid; grid-template-columns:1fr 1.45fr; gap:14px; }</style>')
        .replace('<main id="tab_rank">', '<div class="header-single-line"><div class="rank-title-group"><h1>Rank</h1><div id="rankIndependentControls"></div></div></div><main id="tab_rank">')
        .replace(/<script src="rank-independent-client.js[^\"]*" defer><\/script>/, '<script src="rank-independent-main.js?v=20261011_v1" defer></script>')));
    // Capture protocol launches; a real external-app prompt blocks headless input.
    app.get('/rank-independent-main.js', (req, res) => res.type('js').send(fs.readFileSync('public/rank-independent-main.js', 'utf8')
        .replace("location.href = 'marketthrough://open?url=' + encodeURIComponent(url);", "window.testLaunchUrl = 'marketthrough://open?url=' + encodeURIComponent(url);")));
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
        const heights = async () => child.evaluate(() => ({ table: document.getElementById('transactionBody').clientHeight, chart: document.querySelector('.concentration-chart-area').clientHeight,
            row: document.querySelector('#transactionBody tr').getBoundingClientRect().height, font: parseFloat(getComputedStyle(document.querySelector('#transactionBody td')).fontSize) }));
        const beforeResize = await heights();
        await child.setViewportSize({ width: 1350, height: 1050 });
        await child.waitForFunction(previous => document.querySelector('.concentration-chart-area').clientHeight > previous, beforeResize.chart);
        const afterResize = await heights();
        assert.ok(afterResize.table > beforeResize.table, 'Table body must grow with window height');
        assert.ok(afterResize.row > beforeResize.row, 'Table rows must grow with window height');
        assert.ok(afterResize.font > beforeResize.font, 'Table text must grow with window height');
        await child.setViewportSize({ width: 1350, height: 850 });
        await child.waitForFunction(previous => document.querySelector('.concentration-chart-area').clientHeight < previous, afterResize.chart);
        const afterShrink = await heights();
        assert.ok(afterShrink.row < afterResize.row && afterShrink.font < afterResize.font, 'Table contents must shrink with window height');
        const collapseQueries = queries.length;
        await child.getByRole('button', { name: '거래대금 상위 [키움] 접기', exact: true }).click();
        assert.equal(await child.locator('#transactionTable').isVisible(), false);
        assert.equal(await main.locator('#transactionTable').isVisible(), true);
        await child.getByRole('button', { name: '쏠림율차트 접기', exact: true }).click();
        assert.equal(await child.locator('#concentrationCanvas').isVisible(), false);
        await child.getByRole('button', { name: '거래대금 상위 [키움] 펼치기', exact: true }).click();
        await child.getByRole('button', { name: '쏠림율차트 펼치기', exact: true }).click();
        assert.equal(await child.locator('#concentrationCanvas').isVisible(), true);
        assert.equal(queries.length, collapseQueries, 'Panel folding must not issue market queries');
        assert.equal(await child.evaluate(() => location.hash), '');
        const nativeSmoke = path.resolve('desktop/build/RankNativeSmoke.exe');
        const nativeSnapshot = await main.evaluate(() => ({ rows: document.getElementById('transactionBody').innerHTML, chart: getRankChartState(), conditions: { mrktTp: '000', stexTp: '3', refreshInterval: '2' } }));
        const mainRangeBefore = await main.locator('#concentrationRange').getAttribute('max');
        await child.locator('#concentrationZoomIn').click();
        assert.equal(await child.locator('#concentrationRange').getAttribute('max'), '20');
        assert.equal(await main.locator('#concentrationRange').getAttribute('max'), mainRangeBefore);
        await main.locator('#concentrationCandleToggle').click();
        assert.equal(await main.evaluate(() => getConcentrationDisplaySettings().candleOpen), true, 'Main candle toggle must open before synchronization');
        await child.waitForFunction(() => !document.getElementById('concentrationCandleArea').hidden);
        await child.locator('#concentrationCandleToggle').click();
        await main.waitForFunction(() => document.getElementById('concentrationCandleArea').hidden);
        await child.locator('#transactionBody tr').nth(1).click();
        await main.waitForFunction(() => getRankChartState().selection.code === '000002' && !getRankChartState().busy);
        await child.waitForFunction(() => getRankChartState().selection.code === '000002' && !getRankChartState().busy);
        assert.equal(queries.filter(query => query.code === '000002' && !query.debug_five).length, 1, 'Shared selection must deduplicate chart query');
        await child.locator('#rankStockPinned').check();
        await main.locator('#transactionBody tr').first().click();
        await main.waitForFunction(() => getRankChartState().selection.code === '000001' && !getRankChartState().busy);
        await child.waitForTimeout(1200);
        assert.equal(await child.evaluate(() => getRankChartState().selection.code), '000002');
        assert.equal(await child.getByRole('checkbox', { name: '쏠림율 차트 종목 동기화 해제', exact: true }).count(), 1);
        assert.equal(await child.locator('.independent-chart-heading #rankStockPinned').count(), 1, 'Synchronization checkbox must be beside the chart title');
        await child.locator('#concentrationStockName').fill('000003'); await child.locator('#concentrationStockName').press('Enter');
        await child.waitForFunction(() => getRankChartState().selection.code === '000003' && !getRankChartState().busy);
        assert.equal(await main.evaluate(() => getRankChartState().selection.code), '000001');
        await child.locator('#mrktTp').selectOption('101');
        await main.waitForFunction(() => document.getElementById('mrktTp').value === '101');
        await child.locator('[data-chart-mode="minute"]').click();
        await main.waitForFunction(() => getRankChartState().mode === 'minute');
        await child.waitForFunction(() => !getRankChartState().busy);
        await child.locator('#rankStockPinned').uncheck();
        await child.waitForFunction(() => getRankChartState().selection.code === '000001');
        assert.equal(await child.locator('#concentrationStockName').getAttribute('readonly'), null);
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

