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
            if (url.pathname === '/api/risk/breadth') {
                const minute = url.searchParams.get('mode') === 'minute';
                const selected = minute ? dates.slice(-10).map(date => `${date} 08:01`) : dates;
                return route.fulfill({ json: { dates: selected, notice: '2026-10-20까지 KOSPI · 2026-10-21부터 KOSPI+KOSDAQ(KRX+NXT 통합)',
                    cursor: url.searchParams.get('cursor') ? null : 'older-page', has_more: !url.searchParams.get('cursor'),
                    candles: selected.map((date, i) => ({ date, t: Date.parse(`${date.slice(0,10)}T08:01:00+09:00`), open: 100+i, high: 120+i, low: 90+i, close: 110+i })),
                    series: { highs: { points: selected.map((date, i) => ({ date, value: i === 0 ? null : 10 + i % 30 })) }, lows: { points: selected.map((date, i) => ({ date, value: i === 0 ? null : -(i % 15) })) } } } });
            }
            if (url.pathname === '/api/risk/volatility') {
                const range = url.searchParams.get('range'), selected = dates.slice(-({ '6m': 60, '1y': 120, '3y': 200, all: dates.length }[range]));
                return route.fulfill({ json: { series: { vix: { points: selected.filter((_, i) => i % 7 !== 0).map((date, i) => ({ date, value: 15 + i % 10 })) }, vkospi: { points: selected.map((date, i) => ({ date, value: 30 + i % 15 })) } } } });
            }
            // Minute candles cover the same last 10 sessions as the minute breadth data.
            if (url.pathname === '/api/adr/candles') return route.fulfill({ json: { points: (url.searchParams.get('mode') === 'minute' ? dates.slice(-10) : dates).map((date, i) => ({ t: Date.parse(`${date}T${url.searchParams.get('mode') === 'minute' ? '08:01:00' : '09:00:00'}+09:00`), open: 3000 + i, high: 3020 + i, low: 2990 + i, close: 3010 + i })) } });
            return route.fulfill({ contentType: 'text/html', body: html });
        });
        await page.goto('http://volatility.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#concentrationChartPanel{height:450px}' });
        await page.evaluate(() => { window.saves = 0; window.saveAppData = () => { window.saves++; }; window.lineColors = []; const stroke = CanvasRenderingContext2D.prototype.stroke; CanvasRenderingContext2D.prototype.stroke = function (...args) { if (this.canvas.closest('#rankVolatilityChartPanel')) window.lineColors.push(this.strokeStyle); return stroke.apply(this, args); }; });
        await page.addScriptTag({ path: 'public/rank-chart-axis.js' });
        await page.addScriptTag({ content: fs.readFileSync('public/rank-volatility-chart.js', 'utf8') });
        const panel = page.locator('#rankVolatilityChartPanel');
        const breadth = page.locator('#rankBreadthChartPanel');
        const sentiment = page.locator('#rankSentimentChartPanel');
        await page.waitForFunction(() => document.querySelector('#rankSentimentChartPanel .rank-adr-status').textContent.includes(' ~ '));
        const plotHeight = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.rank-chart-row')).getPropertyValue('--chart-plot-height')));
        const heights = await page.locator('#concentrationCanvas, .rank-volatility-panel .rank-adr-area canvas').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
        assert.ok(heights.length === 4 && heights.every(height => height === heights[0] && height === plotHeight), `Equal main canvas heights: ${heights}`);
        assert.deepEqual(await sentiment.locator('.risk-series-date').allTextContents(), [dates.slice(-120).at(-1), dates.at(-1)]);
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
        assert.ok(await page.evaluate(() => sentimentAxis.some(point => point.label === '2.5' && point.color === '#8b5cf6' && point.x > 300)), 'HY has its own purple right axis');
        assert.ok((await sentiment.boundingBox()).y > (await breadth.boundingBox()).y, 'Sentiment is below breadth in the right column');
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
            await target.locator('.rank-adr-candle-area canvas').scrollIntoViewIfNeeded();
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
                await target.locator(selector).scrollIntoViewIfNeeded();
                const chartBox = await target.locator(selector).boundingBox();
                const slider = target.locator('input[type="range"]');
                // The shared slider is 0~10000 = start / (hidden days); it is disabled while the whole range is shown.
                const before = await slider.evaluate(el => ({ start: +el.value, disabled: el.disabled }));
                const left = id === 'rankSentimentChartPanel' ? 54 : 16;
                const right = chartBox.width - (id === 'rankSentimentChartPanel' ? 64 : 58);
                await page.mouse.move(chartBox.x + left + (right - left) * .25, chartBox.y + 60);
                await page.mouse.wheel(0, -100);
                await page.waitForTimeout(80);
                const after = await slider.evaluate(el => ({ start: +el.value, disabled: el.disabled }));
                assert.ok(before.disabled && before.start === 0 && !after.disabled, 'Wheel zooms into the chart');
                // From the full view, keeping the cursor date fixed puts the start at the cursor's 25% of the hidden span.
                assert.ok(Math.abs(after.start - 2500) <= 150, `Wheel preserves the date under the cursor: ${after.start}`);
                await page.mouse.wheel(0, 100);
                await page.waitForTimeout(80);
            }
        }
        await panel.getByRole('button', { name: '캔들차트', exact: true }).click();
        await breadth.getByRole('button', { name: '캔들차트', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankVolatilityChartPanel .rank-adr-status').textContent.includes(' ~ '));
        await page.waitForFunction(() => document.querySelector('#rankBreadthChartPanel .rank-adr-status').textContent.includes('키움'));
        assert.match(await breadth.locator('h2').textContent(), /52주 신고[/]신저/);
        assert.equal(await breadth.locator('[data-volatility-range]').count(), 0);
        assert.equal(await breadth.locator('[data-breadth-mode]').count(), 2);
        assert.equal(await breadth.locator('.volatility-guide').count(), 0, 'Volatility-specific guide must not appear on breadth');
        await breadth.getByRole('button', { name: '1분봉', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankBreadthChartPanel .rank-adr-status').textContent.includes('키움'));
        await breadth.getByRole('button', { name: '신고가·신저가 과거 추가조회', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankBreadthChartPanel .rank-adr-status').textContent.includes('키움'));
        await breadth.getByRole('button', { name: '캔들차트', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#breadthCandleArea [role="status"]').textContent === '');
        await breadth.locator('.rank-adr-area canvas').scrollIntoViewIfNeeded();
        const breadthBox = await breadth.locator('.rank-adr-area canvas').boundingBox();
        await page.mouse.move(breadthBox.x + breadthBox.width / 2, breadthBox.y + 50);
        assert.match(await breadth.locator('.chart-hover-info').textContent(), /신고가 .*개.*신저가 .*개.*등락율/);
        assert.equal(await page.evaluate(() => getRankBreadthDisplaySettings().mode), 'minute');
        assert.equal(await breadth.locator('#breadthCandleArea').isVisible(), true);
        // Range buttons were replaced by the shared candle pages; the full series is read once with range=all.
        assert.equal(await panel.locator('[data-volatility-range]').count(), 0);
        assert.ok(await page.evaluate(() => lineColors.includes('#339af0') && lineColors.includes('#e11d48')));
        assert.ok(await panel.evaluate(panel => panel.getBoundingClientRect().top >= document.getElementById('concentrationChartPanel').getBoundingClientRect().bottom));
        assert.ok(requests.some(url => url.startsWith('/api/risk/volatility') && url.endsWith('range=all')));
        await panel.getByRole('button', { name: '캔들차트', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#volatilityCandleArea [role="status"]').textContent === '');
        assert.ok(await panel.locator('#volatilityCandleArea').isVisible());
        assert.ok(requests.some(url => url.startsWith('/api/chart-reference?mode=day&market=kospi')));
        await panel.getByRole('button', { name: '변동성 차트 확대', exact: true }).click();
        assert.equal(await panel.locator('input[type=range]').isDisabled(), false);
        const canvas = panel.locator('.rank-adr-area canvas'), box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        assert.match(await panel.locator('.chart-hover-info').textContent(), /VKOSPI.*VIX/);
        assert.match(await panel.locator('.chart-hover-info').textContent(), /등락율 [+-]?\d+\.\d%/);
        assert.doesNotMatch(await panel.locator('.chart-hover-info').textContent(), /KOSPI 시| 고 | 저 | 종 /);
        fs.mkdirSync('dev/output', { recursive: true });
        await page.screenshot({ path: 'dev/output/volatility-candles-preview.png', fullPage: true });
        await page.mouse.move(box.x + 30, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 180, box.y + 80, { steps: 5 }); await page.mouse.up();
        await page.evaluate(() => applyRankVolatilityDisplaySettings({ range: '1y', candleOpen: false }));
        assert.equal(await panel.locator('#volatilityCandleArea').isVisible(), false);
        // An old saved range (e.g. 1y) no longer narrows the chart; the full series stays selected.
        assert.equal(await page.evaluate(() => getRankVolatilityDisplaySettings().range), 'all');
        await page.waitForTimeout(200);
        assert.deepEqual(errors, []);
        fs.mkdirSync('dev/output', { recursive: true });
        await page.screenshot({ path: 'dev/output/volatility-chart-preview.png', fullPage: true });
        console.log('PASS volatility overlay, placement, full range, KOSPI candle toggle, zoom, hover, drag and settings restore');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
