const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER_PATH ? { executablePath: process.env.TEST_BROWSER_PATH } : { channel: 'msedge' }) });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1250 } });
        const errors = [], requests = [];
        page.on('pageerror', error => errors.push(error.message));
        const dates = Array.from({ length: 300 }, (_, index) => new Date(Date.UTC(2025, 8, 1 + index)).toISOString().slice(0, 10)).filter(date => ![0, 6].includes(new Date(date).getUTCDay()));
        const source = fs.readFileSync('public/index.html', 'utf8');
        const concentration = source.match(/<section[^>]*id="concentrationChartPanel"[\s\S]*?<\/section>/)[0];
        const html = `<meta charset="utf-8"><div class="rank-chart-row">${concentration}<section class="panel">ADR</section><section class="panel">Turnover</section></div>`;
        await page.route('http://volatility.test/**', route => {
            const url = new URL(route.request().url()); requests.push(url.pathname + url.search);
            if (url.pathname === '/api/risk/sentiment') return route.fulfill({ json: { series: { 'fear-greed': { points: dates.slice(-120).map((date, i) => ({ date, value: 20 + i % 60 })) }, 'high-yield-spread': { points: dates.map((date, i) => ({ date, value: 2 + (i % 5) / 10 })) } } } });
            if (url.pathname === '/api/risk/breadth') return route.fulfill({ json: { series: { highs: { points: dates.map((date, i) => ({ date, value: 10 + i % 30 })) }, lows: { points: dates.map((date, i) => ({ date, value: -(i % 15) })) } } } });
            if (url.pathname === '/api/risk/volatility') {
                const range = url.searchParams.get('range'), selected = dates.slice(-({ '6m': 60, '1y': 120, '3y': 200, all: dates.length }[range]));
                return route.fulfill({ json: { series: { vix: { points: selected.filter((_, i) => i % 7 !== 0).map((date, i) => ({ date, value: 15 + i % 10 })) }, vkospi: { points: selected.map((date, i) => ({ date, value: 30 + i % 15 })) } } } });
            }
            if (url.pathname === '/api/adr/candles') return route.fulfill({ json: { points: dates.map((date, i) => ({ t: Date.parse(`${date}T09:00:00+09:00`), open: 3000 + i, high: 3020 + i, low: 2990 + i, close: 3010 + i })) } });
            return route.fulfill({ contentType: 'text/html', body: html });
        });
        await page.goto('http://volatility.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#concentrationChartPanel{height:450px}' });
        await page.evaluate(() => { window.saves = 0; window.saveAppData = () => { window.saves++; }; window.lineColors = []; const stroke = CanvasRenderingContext2D.prototype.stroke; CanvasRenderingContext2D.prototype.stroke = function (...args) { if (this.canvas.closest('#rankVolatilityChartPanel')) window.lineColors.push(this.strokeStyle); return stroke.apply(this, args); }; });
        await page.addScriptTag({ content: fs.readFileSync('public/rank-volatility-chart.js', 'utf8') });
        const panel = page.locator('#rankVolatilityChartPanel');
        const breadth = page.locator('#rankBreadthChartPanel');
        const sentiment = page.locator('#rankSentimentChartPanel');
        await page.waitForFunction(() => document.querySelector('#rankSentimentChartPanel .rank-adr-status').textContent.includes('Jusikbot'));
        await sentiment.locator('h2').hover();
        assert.equal(await page.locator('#sentimentGuide').isVisible(), false);
        await sentiment.locator('.chart-info-button').hover();
        assert.equal(await page.locator('#cnnGuide').isVisible(), true);
        assert.equal(await page.locator('#cnnGuide table').count(), 2);
        assert.equal(await page.locator('#cnnGuide table').nth(1).locator('tbody tr').count(), 7);
        assert.ok(await page.locator('#sentimentGuide').evaluate(node => node.scrollHeight > node.clientHeight), 'Long explanations scroll inside the guide');
        await sentiment.locator('#highYieldGuideTab').click();
        assert.equal(await page.locator('#highYieldGuide').isVisible(), true);
        assert.equal(await page.locator('#cnnGuide').isVisible(), false);
        assert.equal(await page.locator('#highYieldGuide table').first().locator('tbody tr').count(), 6);
        await sentiment.locator('#highYieldGuideTab').focus();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#highYieldGuide').isVisible(), false);
        await page.mouse.move(0, 0);
        await page.evaluate(() => {
            window.sentimentAxis = [];
            const original = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function (label, x, y, ...rest) { if (this.canvas.closest('#rankSentimentChartPanel') && this.canvas.closest('.rank-adr-area')) window.sentimentAxis.push({ label: String(label), color: this.fillStyle, x }); return original.call(this, label, x, y, ...rest); };
        });
        await page.evaluate(() => refreshRankSentimentChart());
        assert.ok(await page.evaluate(() => sentimentAxis.some(point => point.label === '100' && point.color === '#d97706' && point.x < 60)), 'CNN has its own orange left 0-100 axis');
        assert.ok(await page.evaluate(() => sentimentAxis.some(point => point.label === '2.50' && point.color === '#8b5cf6' && point.x > 300)), 'HY has its own purple right axis');
        assert.ok((await sentiment.boundingBox()).x > (await breadth.boundingBox()).x, 'Combined chart is right of breadth');
        await sentiment.getByRole('button', { name: '캔들차트', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#sentimentCandleArea [role="status"]').textContent === '');
        const sentimentBox = await sentiment.locator('.rank-adr-area canvas').boundingBox();
        await page.mouse.move(sentimentBox.x + sentimentBox.width / 2, sentimentBox.y + 60);
        assert.match(await sentiment.locator('.chart-hover-info').textContent(), /CNN F&G.*HY OAS.*%p.*등락율/);
        assert.equal(await page.evaluate(() => getRankSentimentDisplaySettings().candleOpen), true);
        await page.evaluate(() => {
            window.candleHorizontalLines = [];
            const move = CanvasRenderingContext2D.prototype.moveTo, line = CanvasRenderingContext2D.prototype.lineTo, stroke = CanvasRenderingContext2D.prototype.stroke;
            CanvasRenderingContext2D.prototype.moveTo = function (x, y) { this.testMove = { x, y }; return move.call(this, x, y); };
            CanvasRenderingContext2D.prototype.lineTo = function (x, y) { this.testLine = { x, y }; return line.call(this, x, y); };
            CanvasRenderingContext2D.prototype.stroke = function (...args) {
                if (this.canvas.closest('.rank-adr-candle-area') && this.strokeStyle === '#000000' && this.testMove?.y === this.testLine?.y && this.testMove.x !== this.testLine.x) window.candleHorizontalLines.push({ panel: this.canvas.closest('.panel').id, y: this.testMove.y });
                return stroke.apply(this, args);
            };
        });
        for (const id of ['rankSentimentChartPanel', 'rankBreadthChartPanel', 'rankVolatilityChartPanel']) {
            const target = page.locator(`#${id}`);
            if (await target.locator('.rank-adr-candle-area').isHidden()) await target.getByRole('button', { name: '캔들차트', exact: true }).click();
            await page.waitForFunction(id => document.querySelector(`#${id} .rank-adr-candle-status`).textContent === '', id);
            const box = await target.locator('.rank-adr-candle-area canvas').boundingBox();
            const heights = [];
            for (const y of [70, 150]) {
                await page.evaluate(() => { candleHorizontalLines.length = 0; });
                await page.mouse.move(box.x + box.width / 2, box.y + y);
                const height = await page.evaluate(id => candleHorizontalLines.filter(line => line.panel === id).at(-1)?.y, id);
                assert.ok(Number.isFinite(height), 'Black candle value line is drawn');
                heights.push(height);
            }
            assert.equal(heights[0], heights[1], 'Same candle close is selected regardless of pointer height');
            for (const selector of ['.rank-adr-area canvas', '.rank-adr-candle-area canvas']) {
                const chartBox = await target.locator(selector).boundingBox();
                const slider = target.locator('input[type="range"]');
                const before = await slider.evaluate(el => ({ start: +el.value, max: +el.max }));
                const left = id === 'rankSentimentChartPanel' ? 54 : 16;
                const right = chartBox.width - (id === 'rankSentimentChartPanel' ? 64 : 58);
                await page.mouse.move(chartBox.x + left + (right - left) * .25, chartBox.y + 60);
                await page.mouse.wheel(0, -100);
                await page.waitForTimeout(80);
                const after = await slider.evaluate(el => ({ start: +el.value, max: +el.max }));
                assert.ok(after.max > before.max, 'Wheel zooms into the chart');
                assert.ok(Math.abs(after.start - before.start - .25 * (after.max - before.max)) <= 1, 'Wheel preserves the date under the cursor');
                await page.mouse.wheel(0, 100);
                await page.waitForTimeout(80);
            }
        }
        await panel.getByRole('button', { name: '캔들차트', exact: true }).click();
        await breadth.getByRole('button', { name: '캔들차트', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankVolatilityChartPanel .rank-adr-status').textContent.includes('Jusikbot'));
        await page.waitForFunction(() => document.querySelector('#rankBreadthChartPanel .rank-adr-status').textContent.includes('Jusikbot'));
        assert.match(await breadth.locator('h2').textContent(), /신고가-신저가/);
        assert.equal(await breadth.locator('[data-volatility-range]').count(), 4);
        assert.equal(await breadth.locator('.volatility-guide').count(), 0, 'Volatility-specific guide must not appear on breadth');
        await breadth.getByRole('button', { name: '6M', exact: true }).click();
        await breadth.getByRole('button', { name: '캔들차트', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#breadthCandleArea [role="status"]').textContent === '');
        const breadthBox = await breadth.locator('.rank-adr-area canvas').boundingBox();
        await page.mouse.move(breadthBox.x + breadthBox.width / 2, breadthBox.y + 50);
        assert.match(await breadth.locator('.chart-hover-info').textContent(), /신고가 .*개.*신저가 .*개.*등락율/);
        assert.equal(await page.evaluate(() => getRankBreadthDisplaySettings().range), '6m');
        assert.equal(await breadth.locator('#breadthCandleArea').isVisible(), true);
        assert.equal(await panel.locator('[data-volatility-range]').count(), 4);
        assert.ok(await page.evaluate(() => lineColors.includes('#339af0') && lineColors.includes('#e11d48')));
        assert.ok(await panel.evaluate(panel => panel.getBoundingClientRect().top >= document.getElementById('concentrationChartPanel').getBoundingClientRect().bottom));
        await panel.getByRole('button', { name: '6M', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankVolatilityChartPanel .rank-adr-status').textContent.includes('Jusikbot'));
        await panel.getByRole('button', { name: '3Y', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankVolatilityChartPanel .rank-adr-status').textContent.includes('Jusikbot'));
        assert.ok(requests.some(url => url.endsWith('range=6m')) && requests.some(url => url.endsWith('range=3y')));
        await panel.getByRole('button', { name: '전체', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankVolatilityChartPanel .rank-adr-status').textContent.includes('Jusikbot'));
        assert.ok(requests.some(url => url.endsWith('range=all')));
        await panel.getByRole('button', { name: '캔들차트', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#volatilityCandleArea [role="status"]').textContent === '');
        assert.ok(await panel.locator('#volatilityCandleArea').isVisible());
        assert.ok(requests.some(url => url.includes('market=kospi&mode=day')));
        await panel.getByRole('button', { name: '변동성 차트 확대', exact: true }).click();
        assert.equal(await panel.locator('input[type=range]').isDisabled(), false);
        const canvas = panel.locator('.rank-adr-area canvas'), box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        assert.match(await panel.locator('.chart-hover-info').textContent(), /VKOSPI.*VIX/);
        assert.match(await panel.locator('.chart-hover-info').textContent(), /등락율 \+\d+\.\d{2}%/);
        assert.doesNotMatch(await panel.locator('.chart-hover-info').textContent(), /KOSPI 시| 고 | 저 | 종 /);
        fs.mkdirSync('dev/output', { recursive: true });
        await page.screenshot({ path: 'dev/output/volatility-candles-preview.png', fullPage: true });
        await page.mouse.move(box.x + 30, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 180, box.y + 80, { steps: 5 }); await page.mouse.up();
        await page.evaluate(() => applyRankVolatilityDisplaySettings({ range: '1y', candleOpen: false }));
        assert.equal(await panel.locator('#volatilityCandleArea').isVisible(), false);
        assert.equal(await page.evaluate(() => getRankVolatilityDisplaySettings().range), '1y');
        await page.waitForTimeout(200);
        assert.deepEqual(errors, []);
        fs.mkdirSync('dev/output', { recursive: true });
        await page.screenshot({ path: 'dev/output/volatility-chart-preview.png', fullPage: true });
        console.log('PASS volatility overlay, placement, 6M/1Y/3Y, KOSPI candle toggle, zoom, hover, drag and settings restore');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
