// 분봉 캔들의 일봉 기준 이평(2026-11-24, docs/MINUTE_DAILY_MA.md)을 실제 화면(public/index.html)의 모든 카드에서 확인한다.
//  - 분봉에서는 캔들 아래 캔버스에 5 · 10 · 20 · 60일선 색(자홍 · 남색 · 주황 · 녹색)이 1px로 그려진다.
//  - 일봉에서는 그리지 않는다. 대상마다 /api/day-ma를 한 번씩만 묻는다(새로 그릴 때마다 다시 묻지 않음).
// 실행: node dev/tests/day-ma-browser.test.cjs
const fs = require('fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const COLORS = ['#ff00ff', '#000080', '#ff6600', '#00a000'];
(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } }), errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: new Date('2026-10-23T12:00:00+09:00') });
        // 캔들 캔버스(카드별)에 마지막으로 지운 뒤 그은 선의 색 · 굵기를 남긴다.
        await page.addInitScript(() => {
            window.maStrokes = {};
            const proto = CanvasRenderingContext2D.prototype, clear = proto.clearRect, stroke = proto.stroke;
            const id = canvas => canvas.closest('.rank-adr-candle-area,.concentration-candle-area') && canvas.closest('section')?.id;
            proto.clearRect = function (...a) { const key = id(this.canvas); if (key) window.maStrokes[key] = []; return clear.apply(this, a); };
            proto.stroke = function (...a) { const key = id(this.canvas); if (key) (window.maStrokes[key] ||= []).push([this.strokeStyle, this.lineWidth]); return stroke.apply(this, a); };
        });
        const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        const times = ['2026-10-22', '2026-10-23'].flatMap(day => Array.from({ length: 20 }, (_, i) => Date.parse(day + 'T09:00:00+09:00') + i * 60000));
        const prices = market => times.map((t, i) => ({ t, date: new Date(t + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' '), open: (market === 'kosdaq' ? 900 : 2500) + i, high: (market === 'kosdaq' ? 910 : 2510) + i, low: (market === 'kosdaq' ? 890 : 2490) + i, close: (market === 'kosdaq' ? 905 : 2505) + i, market_turnover: 1e12 }));
        const flow = times.map((t, i) => ({ t, foreign: i + 1, institution: -i - 1, individual: i * 2, program: -i * 2 }));
        // 일봉: 10/22까지 70거래일, 종가는 캔들 가격대(그래야 선이 그래프 안에 보인다).
        const dailyRows = level => { const rows = []; for (let t = Date.parse('2026-10-22T00:00:00Z'); rows.length < 70; t -= 86400000) { const d = new Date(t); if (d.getUTCDay() % 6) rows.unshift([d.toISOString().slice(0, 10).replaceAll('-', ''), level, level + 5]); } return rows; };
        await page.route('http://minute.test/**', route => {
            const u = new URL(route.request().url()); requests.push(u.pathname + u.search);
            const market = u.searchParams.get('market') || u.searchParams.get('code') || 'kospi'; let data;
            if (u.pathname === '/api/day-ma') data = { success: true, through: '20261022', rows: dailyRows(u.searchParams.get('target').endsWith('kosdaq') ? 900 : 2500) };
            else if (u.pathname.endsWith('market-supply/chart')) data = { success: true, points: flow, candles: prices(market === 'futuresKosdaq' ? 'kosdaq' : market).slice(-5), warnings: [], has_more: false };
            else if (u.pathname === '/api/ls-futures-test/chart') data = { success: true, points: flow, candles: [], warnings: [], has_more: false };
            else if (u.pathname === '/api/ls-futures-test/candles') data = { success: true, points: prices(market === 'futuresKosdaq' ? 'kosdaq' : 'kospi'), has_more: false };
            else if (u.pathname === '/api/chart-reference' || u.pathname === '/api/adr/candles') data = { success: true, points: prices(market), has_more: false };
            else if (u.pathname === '/api/concentration-chart') data = { success: true, market: 'K', points: prices('stock').map(p => ({ time: new Date(p.t + 9 * 3600000).toISOString().slice(0, 19).replace(/[-:T ]/g, ''), stock_open: p.open, stock_high: p.high, stock_low: p.low, stock_price: p.close, value: 10 })), has_more: false };
            else if (u.pathname === '/api/supply/watchlist') data = { success: true, stocks: [{ code: '005930', name: '삼성전자' }], archive: [{ code: '005930', name: '삼성전자' }], revision: 1 };
            else if (u.pathname === '/api/ls-stock-futures/chart') data = { success: true, points: flow, has_more: false };
            else if (u.pathname === '/api/ls-stock-futures/candles') data = { success: true, points: prices('stock'), has_more: false };
            else if (u.pathname === '/api/supply/chart') data = { success: true, points: flow, has_more: false };
            else if (u.pathname === '/api/supply/candles') data = { success: true, points: prices('stock'), date: '2026-10-23', has_more: false };
            else if (u.pathname === '/api/turnover/chart') data = { success: true, markets: { kospi: prices('kospi'), kosdaq: prices('kosdaq') }, warnings: [], has_more: false };
            else if (u.pathname === '/api/risk/breadth') data = { dates: prices(market).map(p => p.date), series: Object.fromEntries(['highs', 'lows'].map(id => [id, { points: prices(market).map(p => ({ date: p.date, value: id === 'highs' ? 5 : -3 })) }])), has_more: false };
            else if (u.pathname.startsWith('/api/')) data = { success: true, series: [], points: [], has_more: false };
            if (data) return route.fulfill({ json: data });
            return route.fulfill({ contentType: 'text/html', body: html });
        });
        await page.goto('http://minute.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}' });
        for (const f of ['rank-chart-axis.js', 'day-ma.js', 'concentration-chart.js', 'rank-turnover-chart.js', 'rank-volatility-chart.js', 'rank-supply-chart.js', 'rank-market-supply-chart.js']) await page.addScriptTag({ path: 'public/' + f });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.locator('#rankTestMarketSupplyChartPanel .rank-market-choice input[value="kospi"]').check();
        await page.evaluate(() => window.selectRankChartStock({ code: '005930', name: '삼성전자' }));
        await page.locator('#rankTestMarketSupplyChartPanel [data-mode="minute"]').click();
        await page.locator('#rankTestMarketSupplyChartPanel .concentration-candle-toggle').click();
        await page.waitForTimeout(800);
        const ids = ['combinedConcentrationChartPanel', 'rankTestMarketSupplyChartPanel', 'rankCombinedSupplyChartPanel', 'rankCombinedTurnoverChartPanel', 'rankBreadthChartPanel', 'rankFuturesSupplyChartPanel'];
        const strokes = () => page.evaluate(() => window.maStrokes);
        // 마지막 그리기가 끝난 뒤 다시 한 번 그리게 해(창 크기 변경) 자료가 온 뒤의 상태를 본다.
        await page.setViewportSize({ width: 1880, height: 1100 }); await page.waitForTimeout(600);
        let drawn = await strokes();
        for (const id of ids) {
            const lines = (drawn[id] || []).filter(([color]) => COLORS.includes(color));
            assert.deepEqual([...new Set(lines.map(([c]) => c))].sort(), [...COLORS].sort(), `${id}: 분봉에 5 · 10 · 20 · 60일선`);
            assert.ok(lines.every(([, w]) => w === 1), `${id}: 1px`);
        }
        const asked = requests.filter(u => u.startsWith('/api/day-ma')).map(u => new URL('http://x' + u).searchParams.get('target'));
        assert.deepEqual([...new Set(asked)].sort(), ['index:kospi', 'stock:005930', 'stockFutures:005930']);
        assert.equal(asked.length, new Set(asked).size, `대상마다 한 번만 묻는다: ${asked.join(', ')}`);
        // 코스닥으로 바꾸면 코스닥 일봉으로 그린다.
        await page.locator('#rankCombinedTurnoverChartPanel input[value="kosdaq"]').check(); await page.waitForTimeout(600);
        assert.ok(requests.some(u => u.includes('target=index%3Akosdaq')));
        drawn = await strokes();
        assert.ok((drawn.rankCombinedTurnoverChartPanel || []).some(([c]) => c === '#000080'), '코스닥 선택 뒤에도 이평');
        // 시장 수급 카드에서 KOSPI200 선물을 고르면 주간 연결선물 일봉으로 그린다.
        await page.locator('#rankTestMarketSupplyChartPanel .rank-market-choice input[value="futures"]').check(); await page.waitForTimeout(600);
        await page.setViewportSize({ width: 1890, height: 1100 }); await page.waitForTimeout(600);
        assert.ok(requests.some(u => u.includes('target=indexFutures%3Afutures')));
        drawn = await strokes();
        assert.ok((drawn.rankTestMarketSupplyChartPanel || []).some(([c]) => c === '#00a000'), '지수 선물 분봉에도 이평');
        // 일봉에서는 그리지 않는다.
        await page.locator('#rankTestMarketSupplyChartPanel [data-mode="day"]').click(); await page.waitForTimeout(800);
        await page.setViewportSize({ width: 1900, height: 1100 }); await page.waitForTimeout(600);
        drawn = await strokes();
        for (const id of ids) assert.ok(!(drawn[id] || []).some(([c]) => COLORS.includes(c)), `${id}: 일봉에는 그리지 않음`);
        assert.deepEqual(errors, []);
        console.log('일봉 기준 이평: 여섯 카드 분봉에 네 선(1px), 대상마다 한 번 조회, 시장 변경, 일봉에서는 안 그림 확인.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
