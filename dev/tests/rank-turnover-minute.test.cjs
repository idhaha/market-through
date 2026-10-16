const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<section id="rankAdrChartPanel" style="width:600px;--rank-adr-base-height:450px"></section>');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') });
        await page.evaluate(() => {
            Date.now = () => Date.parse('2026-10-14T03:00:00Z');
            window.requests = []; window.benchmarkLines = []; window.orangeMarkers = []; window.benchmarkLabels = [];
            const moveTo = CanvasRenderingContext2D.prototype.moveTo, fillText = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.moveTo = function (x, y) {
                if (this.canvas.closest('#rankTurnoverChartPanel .rank-adr-area') && this.strokeStyle === '#f97316') this.benchmarkY = y;
                return moveTo.call(this, x, y);
            };
            CanvasRenderingContext2D.prototype.fillText = function (label, x, y, ...args) {
                if (String(label).startsWith('전일 ')) window.benchmarkLabels.push({ label, lineY: this.benchmarkY, textY: y });
                return fillText.call(this, label, x, y, ...args);
            };
            const clear = CanvasRenderingContext2D.prototype.clearRect;
            CanvasRenderingContext2D.prototype.clearRect = function (...args) {
                if (this.canvas.closest('#rankTurnoverChartPanel .rank-adr-area')) window.orangeMarkers = [];
                return clear.apply(this, args);
            };
            const arc = CanvasRenderingContext2D.prototype.arc, fill = CanvasRenderingContext2D.prototype.fill;
            CanvasRenderingContext2D.prototype.arc = function (...args) { this.lastArc = args; return arc.apply(this, args); };
            CanvasRenderingContext2D.prototype.fill = function (...args) {
                if (this.canvas.closest('#rankTurnoverChartPanel .rank-adr-area') && this.fillStyle === '#f97316' && this.lastArc) window.orangeMarkers.push(this.lastArc);
                this.lastArc = null; return fill.apply(this, args);
            };
            const stroke = CanvasRenderingContext2D.prototype.stroke;
            CanvasRenderingContext2D.prototype.stroke = function (...args) {
                if (this.canvas.closest('#rankTurnoverChartPanel .rank-adr-area') && this.strokeStyle === '#f97316') window.benchmarkLines.push(true);
                return stroke.apply(this, args);
            };
            window.fetch = async url => {
                window.requests.push(url);
                const kosdaq = url.includes('kosdaq'), minute = url.includes('mode=minute');
                return new Response(JSON.stringify({ points: minute
                    ? [0, 1].map(i => ({ t: Date.parse(`2026-10-14T00:0${i}:00Z`), market_turnover_estimate: (kosdaq ? 1 : 2) * 1e12, open: 100, high: 101, low: 99, close: 100 }))
                    : [{ t: Date.parse('2026-10-13T00:00:00Z'), market_turnover: (kosdaq ? 5 : 10) * 1e12, open: 100, high: 101, low: 99, close: 100 }] }));
            };
        });
        await page.addScriptTag({ content: fs.readFileSync('public/rank-turnover-chart.js', 'utf8') });
        await page.waitForFunction(() => document.querySelector('#rankTurnoverChartPanel [role="status"]').textContent.includes('누적값'));
        const panel = page.locator('#rankTurnoverChartPanel');
        await panel.locator('[data-mode="minute"]').click();
        await page.waitForFunction(() => document.querySelector('#rankTurnoverChartPanel [role="status"]').textContent.includes('추정값'));
        assert.equal(await panel.locator('[data-latest="kospi"]').textContent(), '4.00조원');
        assert.equal(await panel.locator('[data-latest="kosdaq"]').textContent(), '2.00조원');
        assert.ok((await panel.locator('[role="status"]').textContent()).includes('KOSPI 전일 대비 40.0%'));
        assert.ok(await page.evaluate(() => window.benchmarkLines.length > 0));
        assert.ok(await page.evaluate(() => window.benchmarkLabels.every(item => Math.abs(item.textY-item.lineY) >= 10)), 'Previous-day label clears the red guide line');
        assert.equal(await page.evaluate(() => window.orangeMarkers.length), 2, 'Only the last minute of each market has an orange marker');
        assert.equal(await panel.locator('.rank-adr-ranges').isVisible(), false);
        assert.ok(await page.evaluate(() => window.requests.filter(url => url.includes('mode=minute')).every(url => url.includes('from=20261014&to=20261014'))));
        const chart = await panel.locator('.rank-adr-area canvas').boundingBox();
        await page.mouse.move(chart.x + chart.width - 100, chart.y + 80);
        const hoverText = await panel.locator('.turnover-hover-info').textContent();
        assert.match(hoverText, /KOSPI 4\.00조원\(전일대비 40\.0%\)/);
        assert.match(hoverText, /KOSDAQ 2\.00조원\(전일대비 40\.0%\)/);
        await panel.locator('[data-mode="day"]').click();
        await page.waitForFunction(() => document.querySelector('#rankTurnoverChartPanel [role="status"]').textContent.includes('누적값'));
        assert.equal(await panel.locator('.rank-adr-ranges').isVisible(), true);
        assert.deepEqual(errors, []);
        console.log('PASS turnover minute cumulative estimate, previous-day line, comparison and mode switch');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
