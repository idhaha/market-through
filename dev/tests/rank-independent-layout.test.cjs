const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1350, height: 850 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const html = fs.readFileSync('public/rank-independent.html', 'utf8')
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<link\b[^>]*>/gi, '');
        await page.setContent(html);
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') });
        await page.addStyleTag({ content: fs.readFileSync('public/rank-independent.css', 'utf8') });
        await page.evaluate(() => {
            window.verticalDateLines = [];
            const prototype = CanvasRenderingContext2D.prototype;
            const begin = prototype.beginPath, move = prototype.moveTo, line = prototype.lineTo, stroke = prototype.stroke;
            prototype.beginPath = function (...args) { this.testPath = []; return begin.apply(this, args); };
            prototype.moveTo = function (...args) { (this.testPath ||= []).push(args); return move.apply(this, args); };
            prototype.lineTo = function (...args) { (this.testPath ||= []).push(args); return line.apply(this, args); };
            prototype.stroke = function (...args) {
                if (['concentrationCanvas', 'concentrationCandleCanvas'].includes(this.canvas.id)
                    && this.strokeStyle === '#d6dbe1' && this.getLineDash().join(',') === '3,5'
                    && this.testPath?.length === 2 && this.testPath[0][0] === this.testPath[1][0]) {
                    window.verticalDateLines.push(this.canvas.id);
                }
                return stroke.apply(this, args);
            };
            window.fetch = async (_url, options = {}) => new Response(JSON.stringify({
                success: true, market: 'K', cursor: null, has_more: false,
                points: Array.from({ length: 20 }, (_, index) => ({
                    time: JSON.parse(options.body || '{}').mode === 'minute'
                        ? `${index < 10 ? '20260930' : '20261001'}${String(90000 + index * 100).padStart(6, '0')}`
                        : `2026${index < 10 ? '09' : '10'}${String(index % 10 + 1).padStart(2, '0')}`,
                    value: 20 + index, stock_open: 990, stock_high: 1010, stock_low: 980, stock_price: 1000
                }))
            }));
        });
        await page.addScriptTag({ content: fs.readFileSync('public/concentration-chart.js', 'utf8') });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.evaluate(() => selectRankChartStock({ code: '005930', name: '삼성전자', market: 'K' }));
        await page.waitForFunction(() => getRankChartState().points.length === 20 && !getRankChartState().busy);
        await page.evaluate(() => applyConcentrationDisplaySettings({ ...getConcentrationDisplaySettings(), candleOpen: true }));
        assert.deepEqual(await page.evaluate(() => window.verticalDateLines), [], 'Daily main and candle charts have no vertical date lines');
        await page.evaluate(() => applyConcentrationDisplaySettings({ ...getConcentrationDisplaySettings(), mode: 'minute' }));
        await page.waitForFunction(() => getRankChartState().mode === 'minute' && !getRankChartState().busy);
        await page.evaluate(() => { window.verticalDateLines = []; applyRankChartState(getRankChartState()); });
        assert.deepEqual(await page.evaluate(() => [...new Set(window.verticalDateLines)].sort()),
            ['concentrationCandleCanvas', 'concentrationCanvas'], 'Minute charts retain date boundaries');
        const positions = () => page.evaluate(() => {
            const canvas = document.getElementById('concentrationCanvas').getBoundingClientRect();
            const value = document.getElementById('concentrationCurrentRate').getBoundingClientRect();
            const info = document.getElementById('concentrationTooltip').getBoundingClientRect();
            return { chartTop: canvas.top, valueRight: value.right, axisRight: canvas.right - 36, infoHeight: info.height };
        });
        const before = await positions();
        assert.ok(Math.abs(before.valueRight - before.axisRight) < 1, 'Latest value aligns with the right edge of Y-axis labels');
        assert.equal(before.infoHeight, 24, 'Hidden hover row reserves its height');
        const canvas = page.locator('#concentrationCanvas');
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        assert.equal(await page.locator('#concentrationTooltip').isVisible(), true);
        const hovered = await positions();
        assert.equal(hovered.chartTop, before.chartTop, 'Hover does not move chart down');
        await page.mouse.move(2, 2);
        const after = await positions();
        assert.equal(after.chartTop, before.chartTop, 'Leaving chart does not move chart up');
        assert.equal(after.infoHeight, 24);
        assert.deepEqual(errors, []);
        const independent = await browser.newPage({ viewport: { width: 850, height: 1320 } });
        await independent.addInitScript(() => {
            window.resizeMessages = [];
            window.chrome.webview = { postMessage: message => window.resizeMessages.push(message) };
        });
        const points = Array.from({ length: 20 }, (_, index) => ({
            time: `202609${String(index + 1).padStart(2, '0')}`, value: 20 + index, stock_price: 1000
        }));
        const snapshot = {
            rows: '<tr data-chart-code="005930" data-chart-name="삼성전자" data-chart-market="K"><td>1</td><td>K</td><td>삼성전자</td></tr>',
            chart: { selection: { code: '005930', name: '삼성전자' }, mode: 'day', interval: 5,
                points, cursor: null, hasMore: false, busy: false, market: '코스피', status: '', revision: 1 },
            display: { candleOpen: true }, conditions: {}, refreshStatus: { time: '-', text: '완료' }
        };
        await independent.route('http://layout.test/**', route => {
            const pathname = new URL(route.request().url()).pathname;
            if (pathname.startsWith('/api/rank-independent/peer/')) {
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 1, snapshot, replies: [] }) });
            }
            const path = pathname === '/rank-independent.html' ? 'public/rank-independent.html' : `public${pathname}`;
            const contentType = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html';
            return route.fulfill({ contentType, body: fs.readFileSync(path) });
        });
        await independent.goto('http://layout.test/rank-independent.html#id=' + 'a'.repeat(32) + '&token=' + 'b'.repeat(64));
        await independent.waitForFunction(() => window.getRankChartState?.().points.length === 20 && !document.getElementById('concentrationCandleArea').hidden);
        const topmostPlacement = await independent.evaluate(() => {
            const top = document.getElementById('independentAlwaysOnTop').closest('label').getBoundingClientRect();
            const refresh = document.getElementById('refreshInterval').closest('label').getBoundingClientRect();
            return { top: { right: top.right, center: top.top + top.height / 2 }, refresh: { left: refresh.left, center: refresh.top + refresh.height / 2 } };
        });
        assert.ok(topmostPlacement.refresh.left - topmostPlacement.top.right >= 18
            && Math.abs(topmostPlacement.top.center - topmostPlacement.refresh.center) < 3,
            `Always-on-top control sits beside the refresh interval: ${JSON.stringify(topmostPlacement)}`);
        await independent.locator('#independentAlwaysOnTop').check();
        assert.ok(await independent.evaluate(() => window.resizeMessages.includes('topmost:true')), 'Always-on-top selection reaches the native window');
        await independent.locator('#independentAlwaysOnTop').uncheck();
        assert.ok(await independent.evaluate(() => window.resizeMessages.includes('topmost:false')), 'Always-on-top can be cleared');
        assert.equal(await independent.evaluate(() => window.resizeMessages.filter(message => message.startsWith('resize-window:')).length), 0,
            'Restoring the initially open candle must not resize the native window');
        const rowHeights = () => independent.evaluate(() => [...document.querySelectorAll('#tab_rank > .panel')].map(panel => panel.getBoundingClientRect().height));
        const geometry = () => independent.evaluate(() => {
            const table = document.querySelector('#tab_rank > .panel');
            const panel = document.getElementById('concentrationChartPanel');
            const main = document.querySelector('.concentration-chart-area');
            const candle = document.getElementById('concentrationCandleArea');
            return { viewport: innerHeight, table: table.offsetHeight, panel: panel.offsetHeight,
                main: main.offsetHeight, candle: candle.offsetHeight, content: document.getElementById('independentChartContent').scrollHeight,
                panelBottom: panel.getBoundingClientRect().bottom, candleBottom: candle.getBoundingClientRect().bottom,
                footerBottom: panel.querySelector('.concentration-chart-footer').getBoundingClientRect().bottom,
                bodyScroll: document.body.scrollHeight - innerHeight, panelOverflow: panel.scrollHeight - panel.clientHeight,
                layoutOverflow: document.getElementById('tab_rank').scrollHeight - document.getElementById('tab_rank').clientHeight };
        });
        const initial = await rowHeights();
        assert.ok(Math.abs(initial[0] - initial[1]) < 2, 'At the reference window height, ranking and chart rows share space evenly');
        const initialGeometry = await geometry();
        assert.ok(initialGeometry.main >= 150 && initialGeometry.main <= 260, `Initial main chart has a balanced height: ${initialGeometry.main}`);
        assert.ok(Math.abs(initialGeometry.main - initialGeometry.candle) < 2, 'Main and candle plots start at equal heights');
        assert.ok(initialGeometry.footerBottom <= initialGeometry.panelBottom, 'Initial chart content stays inside its panel');
        assert.equal(initialGeometry.bodyScroll, 0);
        await independent.setViewportSize({ width: 850, height: 960 });
        const compact = await rowHeights();
        assert.equal((await geometry()).panelOverflow, 0, 'Compact window still contains the whole chart');
        await independent.setViewportSize({ width: 850, height: 1160 });
        const enlarged = await rowHeights();
        assert.ok(enlarged[0] > compact[0] + 40, 'Manual window growth also expands the ranking table');
        assert.ok(enlarged[1] > compact[1], 'Manual window growth expands the chart');
        await independent.locator('#concentrationCandleToggle').click();
        const closedResize = await independent.evaluate(() => Number(window.resizeMessages.at(-1).split(':')[1].split(',')[1]));
        await independent.setViewportSize({ width: 850, height: 1160 + closedResize });
        await independent.locator('#concentrationCandleToggle').click();
        const openResize = await independent.evaluate(() => Number(window.resizeMessages.at(-1).split(':')[1].split(',')[1]));
        await independent.setViewportSize({ width: 850, height: 1160 + closedResize + openResize });
        assert.equal(await independent.locator('#concentrationCandleToggle').getAttribute('aria-expanded'), 'true');
        const toggled = await rowHeights();
        const toggledGeometry = await geometry();
        assert.ok(toggledGeometry.candleBottom <= toggledGeometry.panelBottom, 'Reopened candle stays inside the chart panel');
        assert.ok(toggledGeometry.footerBottom <= toggledGeometry.panelBottom, 'Reopened chart footer stays inside the panel');
        assert.equal(toggledGeometry.panelOverflow, 0, 'Reopened chart panel does not overflow');
        assert.equal(toggledGeometry.layoutOverflow, 0, 'Reopening candles does not add an inner grid scrollbar');
        assert.equal(toggledGeometry.bodyScroll, 0, 'Reopening candles does not add a vertical page scrollbar');
        assert.ok(Math.abs(toggledGeometry.main - toggledGeometry.candle) < 2, 'Reopened main and candle plots remain equal');
        await independent.setViewportSize({ width: 850, height: 1160 + closedResize + openResize + 300 });
        const afterToggleGrowth = await rowHeights();
        assert.ok(afterToggleGrowth[0] > toggled[0] + 40, `After toggling candles, window growth still expands the ranking table: ${JSON.stringify({ toggled, afterToggleGrowth })}`);
        assert.ok(afterToggleGrowth[1] > toggled[1] + 40, `After toggling candles, window growth expands the chart: ${JSON.stringify({ toggled, afterToggleGrowth })}`);
        await independent.setViewportSize({ width: 440, height: 1100 });
        assert.ok(await independent.evaluate(() => {
            const row = document.querySelector('.concentration-timeframe-row');
            const rate = document.getElementById('concentrationCurrentRate');
            const before = row.scrollLeft;
            row.scrollLeft = row.scrollWidth;
            return row.scrollWidth > row.clientWidth + 20 && row.scrollLeft > before
                && rate.getBoundingClientRect().height < 30 && getComputedStyle(rate).whiteSpace === 'nowrap';
        }), 'Narrow window scrolls the control row while keeping the latest rate on one line');
        const narrowOverflow = await independent.evaluate(() => ({
            bodyWidth: document.body.scrollWidth, viewportWidth: innerWidth,
            bodyLeft: document.scrollingElement.scrollLeft,
            toolbarWidth: document.querySelector('.independent-toolbar').scrollWidth
        }));
        assert.ok(narrowOverflow.bodyWidth <= narrowOverflow.viewportWidth + 2 && narrowOverflow.bodyLeft === 0,
            `Narrow window does not push the entire page sideways: ${JSON.stringify(narrowOverflow)}`);
        fs.mkdirSync('dev/output', { recursive: true });
        await independent.screenshot({ path: 'dev/output/rank-independent-narrow-preview.png', fullPage: true });
        console.log('PASS independent chart sizing, candle reopen without overflow, and daily/minute date-line behavior');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
