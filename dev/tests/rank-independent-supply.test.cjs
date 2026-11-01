const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const { chromium } = require('playwright');
const { createRankIndependentRelay } = require('../../rank-independent');

(async () => {
    const app = express(); app.use(express.json({ limit: '5mb' }));
    app.use((req, res, next) => { req.authUser = { email: 'test@example.test' }; next(); });
    let ticket, requestCount = 0, pump, clock=Date.now();
    app.use((req, res, next) => { if (req.path === '/api/rank-independent' && req.method === 'POST') { const send = res.json.bind(res); res.json = value => { ticket = value; return send(value); }; } next(); });
    const config = { success: true, revision: 1, stocks: [{ code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }], archive: [{ code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }] };
    const query = url => {
        if (url.pathname === '/api/supply/watchlist') return config;
        if(url.pathname.includes('concentration-chart'))return {success:true,points:Array.from({length:20},(_,i)=>({time:'202610'+String(i+1).padStart(2,'0')+'090000',value:20+i,stock_price:100,stock_open:99,stock_high:101,stock_low:98})),has_more:false};
        const points = Array.from({ length: 20 }, (_, i) => ({ t: Date.UTC(2026, 9, 1 + i), individual: i, foreign: -i, institution: i * 2, program: i * 3, open: 100, high: 110, low: 90, close: 105 }));
        return { success: true, points: url.pathname === '/api/supply/chart' && url.searchParams.get('mode') === 'minute' ? [] : points, candles: points, cursor: url.searchParams.has('cursor') ? null : '20260930', has_more: !url.searchParams.has('cursor') };
    };
    createRankIndependentRelay({
        now:()=>clock,
        schedule: callback => { pump = callback; return { unref() {} }; },
        refresh: async snapshot => {
            const supply = { ...snapshot.supply, config, points: query(new URL('/api/supply/chart', 'http://test')).points.map(p => ({ ...p, foreign: 999 })) };
            return { items: [], chart: snapshot.chart, supply };
        },
        request: async command => {
            requestCount++;
            if (command.path === '/api/supply/watchlist' && command.method === 'PUT') {
                assert.equal(command.body.revision, config.revision);
                config.stocks = config.archive.filter(stock => command.body.codes.includes(stock.code)); config.revision++;
            }
            return query(new URL(command.path, 'http://test'));
        }
    }).mount(app);
    app.get('/api/supply/:type', (req, res) => res.json(query(new URL(req.originalUrl, 'http://test'))));
    app.post('/api/concentration-chart', (req, res) => res.json({ success: true, points: [], has_more: false }));
    app.get('/main', (req, res) => res.type('html').send(fs.readFileSync('public/rank-independent.html', 'utf8')
        .replace(/<script src="rank-independent-client.js[^" ]*" defer><\/script>/, '<script src="rank-independent-main.js" defer></script>')
        .replace('<body class="rank-independent">','<body>')
        .replace('<main id="tab_rank">', '<style>#tab_rank>.panel{grid-area:auto!important}#tab_rank{display:grid;grid-template-columns:1fr;gap:14px}</style><div id="rankIndependentControls"></div><span id="lastUpdate">-</span><span id="statusText">대기 중</span><main id="tab_rank" class="rank-chart-row">')
        .replace('</main>', '<section id="rankBreadthChartPanel"></section></main>')));
    app.get('/rank-independent-main.js', (req, res) => res.type('js').send(fs.readFileSync('public/rank-independent-main.js', 'utf8').replace("location.href = 'marketthrough://open?url=' + encodeURIComponent(url);", 'window.testLaunchUrl = url;')));
    app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1200, height: 1200 } });
        const main = await context.newPage(), child = await context.newPage(), errors = [];
        main.on('pageerror', e => errors.push(e.message)); child.on('pageerror', e => errors.push(e.message));
        await main.goto(origin + '/main');
        await main.waitForFunction(() => window.getRankCombinedSupplyState?.().points.length === 20);
        await main.getByRole('button',{name:'독립창',exact:true}).click();
        await main.waitForFunction(() => window.testLaunchUrl);
        await child.goto(origin + '/rank-independent.html#' + new URLSearchParams({ id: ticket.id, token: ticket.token }));
        await child.waitForFunction(() => window.getRankSupplyState?.().points.length === 20);
        const positions = await child.locator('#tab_rank > .panel').evaluateAll(es => es.map(e => ({ title: e.querySelector('h2').textContent, top: e.offsetTop, left: e.offsetLeft })));
        assert.equal(positions.length, 3); assert.deepEqual(positions.map(p => p.title), ['거래대금 상위 [키움]', '쏠림율', '종목 수급']);
        assert.ok(positions[0].top < positions[1].top && positions[1].top < positions[2].top); assert.ok(positions.every(p => p.left === positions[0].left));
        await child.setViewportSize({ width: 1100, height: 1800 });
        await child.exposeFunction('resizeNativeWindow', async message => {
            if (!message.startsWith('resize-window:')) return;
            const delta = Number(message.split(':')[1].split(',')[1]), size = child.viewportSize();
            await child.setViewportSize({ width: size.width, height: Math.min(2400, size.height + delta) });
            await child.evaluate(() => { window.dispatchEvent(new Event('rank-native-resize-complete')); window.nativeResizeFinished++; });
        });
        await child.evaluate(() => { window.nativeResizeFinished = 0; window.chrome ||= {}; window.chrome.webview = { postMessage: message => window.resizeNativeWindow(message) }; });
        const plotHeights = () => child.evaluate(() => ['concentrationChartPanel', 'rankSupplyChartPanel'].map(id => {
            const panel = document.getElementById(id); return { plot: panel.querySelector('.concentration-chart-area, .rank-adr-area').clientHeight, card: panel.offsetHeight };
        }));
        for (const id of ['rankSupplyChartPanel', 'concentrationChartPanel', 'rankSupplyChartPanel', 'concentrationChartPanel']) {
            const before = await plotHeights(), done = await child.evaluate(() => window.nativeResizeFinished);
            const expectedOpen = await child.locator('#'+id+' .concentration-candle-toggle').getAttribute('aria-expanded') !== 'true';
            await child.locator(`#${id} .concentration-candle-toggle`).click();
            await child.waitForFunction(count => window.nativeResizeFinished >= count + 2, done);
            const after = await plotHeights();
            assert.ok(after.every((value, i) => Math.abs(value.plot - before[i].plot) <= 1), 'Opening/closing either candle preserves both main plot heights');
            assert.deepEqual(await child.locator('#concentrationChartPanel .concentration-candle-toggle, #rankSupplyChartPanel .concentration-candle-toggle').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-expanded'))), [String(expectedOpen), String(expectedOpen)], 'Both independent candles follow either button');
            assert.equal(await main.evaluate(() => getConcentrationDisplaySettings().candleOpen || getRankCombinedSupplyState().showCandles), false, 'Independent candle toggles do not change the main window');
        }
        assert.equal(child.viewportSize().height, 1800, 'Closing both candles restores the manually resized window even if opening hits the monitor height limit');
        for (const id of ['concentrationChartPanel', 'rankSupplyChartPanel']) {
            const mainId=id==='concentrationChartPanel'?'combinedConcentrationChartPanel':'rankCombinedSupplyChartPanel';
            const before = await plotHeights();
            await main.locator(`#${mainId} .concentration-candle-toggle`).click();
            await new Promise(resolve => setTimeout(resolve, 700));
            assert.equal(await child.evaluate(() => getConcentrationDisplaySettings().candleOpen || getRankSupplyState().showCandles), false, 'Main candle toggles do not open independent candles');
            assert.deepEqual(await plotHeights(), before, 'Main candle toggles do not resize independent charts');
            let done = await child.evaluate(() => window.nativeResizeFinished);
            await child.locator(`#${id} .concentration-candle-toggle`).click();
            await child.waitForFunction(count => window.nativeResizeFinished >= count + 2, done);
            await main.locator(`#${mainId} .concentration-candle-toggle`).click();
            await new Promise(resolve => setTimeout(resolve, 700));
            assert.equal(await child.locator(`#${id} .concentration-candle-toggle`).getAttribute('aria-expanded'), 'true', 'Main closing its candle does not close the independent candle');
            done = await child.evaluate(() => window.nativeResizeFinished);
            await child.locator(`#${id} .concentration-candle-toggle`).click();
            await child.waitForFunction(count => window.nativeResizeFinished >= count + 2, done);
        }
        await child.locator('.supply-stock-select').selectOption('000660');
        await child.waitForFunction(()=>getRankSupplyState().selected==='000660');
        assert.equal(await main.evaluate(()=>getRankCombinedSupplyState().selected),'005930','Independent selection leaves main selection unchanged');
        assert.equal(await child.locator('#rankSupplyPinned, #rankStockPinned').count(), 0, 'Window isolation needs no synchronization toggle');
        await child.locator('.supply-stock-select').selectOption('005930');
        await child.waitForFunction(() => getRankSupplyState().selected === '005930' && getRankSupplyState().points.length === 20);
        assert.equal(await main.evaluate(()=>getRankCombinedSupplyState().selected),'005930');
        await child.locator('#rankSupplyChartPanel [data-mode="minute"]').click();
        await child.waitForFunction(()=>getRankSupplyState().mode==='minute');
        assert.equal(await main.evaluate(()=>getRankCombinedSupplyState().mode),'day');
        await child.waitForFunction(() => !document.querySelector('#rankSupplyChartPanel [data-action="more"]').disabled);
        assert.equal(await child.evaluate(() => getRankSupplyState().showCandles), false, 'Minute mode without flow keeps independent candles folded');
        assert.equal(await main.evaluate(() => getRankCombinedSupplyState().showCandles), false, 'Peer mode changes leave main candles folded');
        await child.locator('#rankSupplyChartPanel [data-action="more"]').click();
        await child.waitForFunction(() => !getRankSupplyState().hasMore);
        assert.ok(requestCount >= 3, 'Supply requests use the authenticated relay');
        const candle = child.locator('#rankSupplyChartPanel .concentration-candle-toggle');
        await candle.click();
        await child.waitForFunction(() => {
            const panel = document.getElementById('rankSupplyChartPanel');
            return !panel.querySelector('.rank-adr-candle-area').hidden && Math.abs(panel.querySelector('.rank-adr-area').clientHeight - panel.querySelector('.rank-adr-candle-area').clientHeight) <= 1;
        });
        await candle.click();
        const fold = child.locator('#rankSupplyChartPanel .independent-collapse');
        await fold.click(); assert.equal(await child.locator('#independentSupplyContent').isVisible(), false);
        await fold.click(); assert.equal(await child.locator('#independentSupplyContent').isVisible(), true);
        await child.evaluate(() => { window.foldSizes = []; window.chrome ||= {}; window.chrome.webview = { postMessage: message => window.foldSizes.push(message) }; });
        for (const width of [960, 1380]) {
            await child.setViewportSize({ width, height: 1200 });
            for (const id of ['concentrationChartPanel', 'rankSupplyChartPanel']) {
                const button = child.locator(`#${id} .independent-collapse`);
                await button.click();
                await child.setViewportSize({ width: width - 100, height: 1100 });
                await button.click();
                assert.equal(await child.evaluate(() => innerWidth), width - 100);
                assert.ok(await child.locator('#tab_rank').evaluate(el => Math.abs(el.getBoundingClientRect().width - el.parentElement.clientWidth + 16) < 2), 'Folded layout follows the current viewport width');
            }
        }
        assert.ok(await child.evaluate(() => window.foldSizes.filter(s => s.startsWith('resize-window:')).every(s => s.split(':')[1].split(',')[0] === '0')), 'Every fold/expand preserves native window width after manual resizing');
        await main.locator('#rankCombinedSupplyChartPanel .supply-stock-select').selectOption('000660');
        await main.waitForFunction(()=>getRankCombinedSupplyState().selected==='000660');
        assert.equal(await child.evaluate(()=>getRankSupplyState().selected),'005930','Main selection leaves peer selection unchanged');
        const saved = await child.evaluate(async () => (await fetch('/api/supply/watchlist', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes: ['005930'], revision: 1 }) })).json());
        assert.equal(saved.revision, 2);
        await main.waitForFunction(() => getRankCombinedSupplyState().config.revision === 2);
        await new Promise(resolve => setTimeout(resolve, 1200));
        await child.locator('#refreshInterval').selectOption('5');
        await main.waitForFunction(()=>document.getElementById('refreshInterval').value==='5');
        await main.route('**/api/rank-independent/*/owner', route => route.abort());
        pump();
        await new Promise(resolve=>setTimeout(resolve,1200));
        const beforeScheduled=requestCount;clock+=30001;pump();
        for(let attempt=0;attempt<100&&requestCount<=beforeScheduled;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
        assert.ok(requestCount>beforeScheduled,'Scheduled refresh queries the peer source while the main transport is suspended');
        assert.equal(await child.evaluate(()=>getRankSupplyState().points.some(p=>p.foreign===999)),false,'Server snapshot chart values must not replace local chart data');
        assert.deepEqual(errors, []);
        console.log('PASS independent supply: vertical order, isolated selection and mode, minute history, fold, shared watchlist, relay and refresh while owner is suspended.');
    } catch (error) { console.error(error); throw error; }
    finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
