const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const source = fs.readFileSync('public/index.html', 'utf8');
        const html = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        await page.route('http://dates.test/**', route => {
            const url = new URL(route.request().url());
            if (url.pathname === '/api/concentration-chart') return route.fulfill({ json: { success: true, market: 'K',
                points: [{ time: '20261020100000', value: 10 }, { time: '20261021100000', value: 12 }], has_more: false } });
            if (url.pathname === '/api/adr/today') return route.fulfill({ json: { marketStatus: 'closed', adr: 95,
                asOf: Date.parse('2026-10-21T15:30:00+09:00'), intraday: [{ t: Date.parse('2026-10-21T15:30:00+09:00'), adr: 95 }] } });
            if (url.pathname === '/api/adr/candles') return route.fulfill({ json: { points: [{ t: Date.parse('2026-10-21T09:00:00+09:00'), open: 100, high: 110, low: 90, close: 105, market_turnover: 18.4e12 }] } });
            if (url.pathname === '/api/risk/breadth') return route.fulfill({ json: { dates: ['2026-10-21'], notice: '2026-10-20까지 KOSPI · 2026-10-21부터 KOSPI+KOSDAQ(KRX+NXT 통합)', series: { highs: { points: [{ date: '2026-10-21', value: 46 }] }, lows: { points: [{ date: '2026-10-21', value: -131 }] } } } });
            if (url.pathname.startsWith('/api/risk/')) return route.fulfill({ json: { series: Object.fromEntries(['vix','vkospi','fear-greed','high-yield-spread'].map(id => [id, { points: [{ date: '2026-10-20', value: 27.2 }] }])) } });
            if (url.pathname === '/api/supply/watchlist') return route.fulfill({ json: { success: true, revision: 0, stocks: [], archive: [] } });
            return route.fulfill({ contentType: 'text/html', body: html });
        });
        await page.goto('http://dates.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}' });
        await page.evaluate(() => { Date.now = () => Date.parse('2026-10-21T22:00:00+09:00'); });
        await page.addScriptTag({ content: fs.readFileSync('public/concentration-chart.js', 'utf8') });
        await page.addScriptTag({ content: fs.readFileSync('public/rank-adr-chart.js', 'utf8') });
        for (const script of ['rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js']) await page.addScriptTag({ content: fs.readFileSync(`public/${script}`, 'utf8') });
        await page.evaluate(() => {
            document.dispatchEvent(new Event('DOMContentLoaded'));
            window.selectRankChartStock({ code: '005930', name: '삼성전자', market: 'K' });
        });
        await page.waitForFunction(() => document.querySelector('#concentrationCurrentRate').textContent === '12.0%'
            && document.querySelector('#rankAdrChartPanel output').textContent === '95.0%');
        await page.waitForFunction(() => [...document.querySelectorAll('.chart-value-date')].every(el => el.textContent === '2026-10-21'));
        assert.equal(await page.locator('.concentration-value-date').evaluate(el => el.closest('.concentration-timeframe-row')), null, 'Concentration date stays outside the clipping scroll container');
        const measurements = await page.evaluate(() => {
            return ['#concentrationChartPanel', '#rankAdrChartPanel'].map(selector => {
                const panel = document.querySelector(selector), date = panel.querySelector('.chart-value-date');
                const output = panel.querySelector('.chart-value-with-date output');
                const canvas = panel.querySelector(selector === '#concentrationChartPanel' ? '#concentrationCanvas' : '.rank-adr-area canvas');
                const measure = () => ({ canvasTop: canvas.getBoundingClientRect().top, height: canvas.getBoundingClientRect().height,
                    valueTop: output.getBoundingClientRect().top, valueRight: output.getBoundingClientRect().right });
                const shown = measure(); date.style.display = 'none'; const hidden = measure(); date.style.display = '';
                return { selector, shown, hidden, dateBottom: date.getBoundingClientRect().bottom };
            });
        });
        for (const item of measurements) {
            assert.equal(item.shown.height, 260, `${item.selector} actual canvas height`);
            assert.deepEqual(item.shown, item.hidden, 'Dates do not move the value or canvas');
            assert.ok(item.dateBottom <= item.shown.valueTop + 1, 'Date is above the current value');
        }
        assert.deepEqual(errors, []);
        await page.waitForFunction(() => document.querySelector('#rankBreadthChartPanel [data-volatility=highs] output').textContent === '46개');
        const layout = await page.locator('.rank-chart-row > .panel').evaluateAll(panels => panels.map(panel => {
            const canvas = panel.querySelector('#concentrationCanvas, .rank-adr-area canvas');
            return { id: panel.id, top: canvas.getBoundingClientRect().top - panel.getBoundingClientRect().top,
                height: canvas.getBoundingClientRect().height, controls: panel.querySelector('.rank-adr-controls, .concentration-timeframe-row').getBoundingClientRect().height };
        }));
        console.log(JSON.stringify({ layout }));
        const reference = layout.find(item => item.id === 'concentrationChartPanel');
        assert.equal(layout.length, 7);
        for (const item of layout) {
            assert.equal(item.height, reference.height, `${item.id}: same canvas height`);
            assert.ok(Math.abs(item.top - reference.top) <= 1, `${item.id}: same graph start (${item.top} vs ${reference.top})`);
        }
        for (const origin of ['#concentrationCandleToggle', '#rankSupplyChartPanel .concentration-candle-toggle', '#rankBreadthChartPanel .concentration-candle-toggle']) {
            await page.locator(origin).click();
            assert.equal(await page.locator('.rank-chart-row .concentration-candle-toggle[aria-expanded=true]').count(), 7, 'Any main candle toggle expands every chart');
            await page.locator(origin).click();
            assert.equal(await page.locator('.rank-chart-row .concentration-candle-toggle[aria-expanded=true]').count(), 0, 'Main candle toggle collapses every chart');
        }
        await page.evaluate(() => { window.rankIndependentClient = true; });
        await page.locator('#rankSupplyChartPanel .concentration-candle-toggle').click();
        assert.equal(await page.locator('.rank-chart-row .concentration-candle-toggle[aria-expanded=true]').count(), 1, 'Independent mode toggles only its own chart');
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ passed: true, measurements }));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
