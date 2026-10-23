const assert = require('node:assert/strict');
const fs = require('node:fs');
const express = require('express');
const { chromium } = require('playwright');
const { createRankIndependentRelay } = require('../../rank-independent');

(async () => {
    const app = express(); app.use(express.json({ limit: '5mb' }));
    app.use((req, res, next) => { req.authUser = { email: 'test@example.test' }; next(); });
    let ticket, requestCount = 0, pump;
    app.use((req, res, next) => { if (req.path === '/api/rank-independent' && req.method === 'POST') { const send = res.json.bind(res); res.json = value => { ticket = value; return send(value); }; } next(); });
    const config = { success: true, revision: 1, stocks: [{ code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }], archive: [{ code: '005930', name: '삼성전자' }, { code: '000660', name: 'SK하이닉스' }] };
    const query = url => {
        if (url.pathname === '/api/supply/watchlist') return config;
        if (url.pathname === '/api/concentration-chart')return {success:true,points:Array.from({length:20},(_,i)=>({time:'202610'+String(i+1).padStart(2,'0')+'090000',value:30+i,open:100,high:110,low:90,close:105})),has_more:false};
        const points = Array.from({ length: 20 }, (_, i) => ({ t: Date.UTC(2026, 9, 1 + i), individual: i, foreign: -i, institution: i * 2, program: i * 3, open: 100, high: 110, low: 90, close: 105 }));
        return { success: true, points: url.pathname === '/api/supply/chart' && url.searchParams.get('mode') === 'minute' ? [] : points, candles: points, cursor: url.searchParams.has('cursor') ? null : '20260930', has_more: !url.searchParams.has('cursor') };
    };
    createRankIndependentRelay({
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
        .replace('<main id="tab_rank">', '<div id="rankIndependentControls"></div><span id="lastUpdate">-</span><span id="statusText">대기 중</span><main id="tab_rank" class="rank-chart-row">')
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
        await main.waitForFunction(()=>window.getRankSupplyState?.().points.length===20);
        await main.evaluate(()=>selectRankChartStock({code:'005930',name:'삼성전자',market:'K'}));
        await main.locator('#rankIndependentControls button').click();await main.waitForFunction(()=>window.testLaunchUrl);
        await child.goto(origin+'/rank-independent.html#'+new URLSearchParams({id:ticket.id,token:ticket.token}));
        await child.waitForFunction(()=>window.getRankSupplyState?.().points.length===20);
        await child.evaluate(()=>selectRankChartStock({code:'000660',name:'SK하이닉스',market:'K'}));
        await child.locator('.supply-stock-select').selectOption('000660');
        await child.waitForFunction(()=>getRankSupplyState().selected==='000660' && getRankSupplyState().points.length===20);
        await child.locator('#rankSupplyChartPanel [data-mode="minute"]').click();
        await child.waitForFunction(()=>getRankSupplyState().mode==='minute' && getRankChartState().mode==='minute');
        await new Promise(resolve=>setTimeout(resolve,1000));
        assert.equal(await main.evaluate(()=>getRankSupplyState().selected),'005930');
        assert.equal(await main.evaluate(()=>getRankSupplyState().mode),'day');
        assert.equal(await main.evaluate(()=>localStorage.getItem('rankSupplySelectedV1')),'005930');
        assert.equal(await child.evaluate(()=>sessionStorage.getItem('rankSupplySelectedV1')),'000660');
        assert.equal(await main.evaluate(()=>getRankChartState().mode),'day');
        assert.equal(await main.evaluate(()=>getRankChartState().selection.code),'005930');
        await main.evaluate(()=>selectRankChartStock({code:'005930',name:'삼성전자',market:'K'}));
        await main.locator('.supply-stock-select').selectOption('000660');
        await main.waitForFunction(()=>getRankSupplyState().selected==='000660');
        await main.locator('.supply-stock-select').selectOption('005930');
        await main.waitForFunction(()=>getRankSupplyState().selected==='005930');
        await new Promise(resolve=>setTimeout(resolve,1000));
        assert.equal(await child.evaluate(()=>getRankSupplyState().selected),'000660');
        assert.equal(await child.evaluate(()=>getRankChartState().selection.code),'000660');
        assert.equal(await child.evaluate(()=>getRankSupplyState().mode),'minute');
        await child.locator('[data-chart-mode="day"]').click();
        await child.waitForFunction(()=>getRankSupplyState().mode==='day' && getRankChartState().mode==='day');
        await child.locator('#rankSupplyChartPanel .concentration-controls button:last-child').click();
        await child.waitForFunction(()=>window.RankChartAxis.dailyDomain()?.days.length===10);
        const childDomain=await child.evaluate(()=>window.RankChartAxis.dailyDomain());
        assert.ok(childDomain);assert.equal(await main.evaluate(()=>window.RankChartAxis.dailyDomain()),null);
        await child.locator('#rankIndependentRefresh').click();
        await new Promise(resolve=>setTimeout(resolve,1200));
        assert.equal(await child.evaluate(()=>getRankSupplyState().selected),'000660');
        assert.equal(await main.evaluate(()=>getRankSupplyState().selected),'005930');
        assert.deepEqual(errors,[]);console.log('PASS main/independent isolation in both directions, relay queries, local mode and zoom synchronization, refresh retention');
    } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(e=>{console.error(e);process.exitCode=1});
