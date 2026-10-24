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
            // Keep the minute-chart "today" viewport aligned with the fixture dates.
            Date.now = () => Date.parse('2026-10-01T06:00:00.000Z');
            window.verticalDateLines = [];
            const prototype = CanvasRenderingContext2D.prototype;
            const begin = prototype.beginPath, move = prototype.moveTo, line = prototype.lineTo, stroke = prototype.stroke;
            prototype.beginPath = function (...args) { this.testPath = []; return begin.apply(this, args); };
            prototype.moveTo = function (...args) { (this.testPath ||= []).push(args); return move.apply(this, args); };
            prototype.lineTo = function (...args) { (this.testPath ||= []).push(args); return line.apply(this, args); };
            prototype.stroke = function (...args) {
                if (['concentrationCanvas', 'concentrationCandleCanvas'].includes(this.canvas.id)
                    && this.strokeStyle === '#b8c1cc' && this.getLineDash().join(',') === '3,5'
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
        await page.addScriptTag({ content: fs.readFileSync('public/rank-chart-axis.js', 'utf8') });
        await page.addScriptTag({ content: fs.readFileSync('public/concentration-chart.js', 'utf8') });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.evaluate(() => selectRankChartStock({ code: '005930', name: '삼성전자', market: 'K' }));
        await page.waitForFunction(() => getRankChartState().points.length === 20 && !getRankChartState().busy);
        await page.evaluate(() => applyConcentrationDisplaySettings({ ...getConcentrationDisplaySettings(), candleOpen: true }));
        assert.deepEqual(await page.evaluate(() => [...new Set(window.verticalDateLines)].sort()),
            ['concentrationCandleCanvas', 'concentrationCanvas'], 'Daily main and candle charts mark month boundaries');
        await page.evaluate(() => applyConcentrationDisplaySettings({ ...getConcentrationDisplaySettings(), mode: 'minute' }));
        await page.waitForFunction(() => getRankChartState().mode === 'minute' && !getRankChartState().busy);
        await page.evaluate(() => {
            window.verticalDateLines = [];
            window.RankChartAxis.showHistory();
            applyRankChartState(getRankChartState());
        });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.deepEqual(await page.evaluate(() => [...new Set(window.verticalDateLines)].sort()),
            ['concentrationCandleCanvas', 'concentrationCanvas'], 'Minute charts retain date boundaries');
        const positions = () => page.evaluate(() => {
            const canvas = document.getElementById('concentrationCanvas').getBoundingClientRect();
            const value = document.getElementById('concentrationCurrentRate').getBoundingClientRect();
            const info = document.getElementById('concentrationTooltip').getBoundingClientRect();
            return { chartTop: canvas.top, valueRight: value.right, axisRight: canvas.right - 36, infoHeight: info.height };
        });
        const canvas = page.locator('#concentrationCanvas');
        await canvas.scrollIntoViewIfNeeded();
        const before = await positions();
        assert.ok(Math.abs(before.valueRight - before.axisRight) < 1, 'Latest value aligns with the right edge of Y-axis labels');
        assert.equal(before.infoHeight, 20, 'Hidden hover row reserves its compact height');
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        assert.equal(await page.locator('#concentrationTooltip').isVisible(), true);
        const hovered = await positions();
        assert.equal(hovered.chartTop, before.chartTop, 'Hover does not move chart down');
        await page.mouse.move(2, 2);
        const after = await positions();
        assert.equal(after.chartTop, before.chartTop, 'Leaving chart does not move chart up');
        assert.equal(after.infoHeight, 20);
        assert.deepEqual(errors, []);
        const independent = await browser.newPage({ viewport: { width: 850, height: 1320 } });
        independent.setDefaultTimeout(10000);
        await independent.addInitScript(() => {
            window.resizeMessages = [];
            window.chrome.webview = { postMessage: message => window.resizeMessages.push(message) };
            if (!crypto.randomUUID) {
                let sequence = 0;
                crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
            }
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
                const command = route.request().postDataJSON()?.command;
                if (command?.type === 'display') { snapshot.display.candleOpen = command.candleOpen; snapshot.displayCommandId = command.id; }
                const replies = command?.type === 'request' && command.path === '/api/concentration-chart'
                    ? [{ id: command.id, status: 200, body: JSON.stringify({ success: true, market: 'K', cursor: null, has_more: false, points }) }]
                    : [];
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 1, snapshot, replies }) });
            }
            const path = pathname === '/rank-independent.html' ? 'public/rank-independent.html' : `public${pathname}`;
            const contentType = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html';
            return route.fulfill({ contentType, body: fs.readFileSync(path) });
        });
        await independent.goto('http://layout.test/rank-independent.html#id=' + 'a'.repeat(32) + '&token=' + 'b'.repeat(64));
        await independent.waitForFunction(() => window.getRankChartState?.().points.length === 20);
        const stockInput = independent.locator('#concentrationStockName');
        await stockInput.fill('');
        await independent.waitForTimeout(1100);
        assert.equal(await stockInput.inputValue(), '', 'Polling must not restore the old stock name while the user clears it');
        await stockInput.fill('에스');
        await independent.waitForTimeout(1100);
        assert.equal(await stockInput.inputValue(), '에스', 'Polling preserves a partially typed Korean stock name');
        await stockInput.blur();
        assert.equal(await stockInput.inputValue(), '삼성전자', 'Leaving an unsubmitted draft restores this window\'s selected stock');
        assert.equal(await independent.locator('#concentrationCandleArea').isVisible(), false, 'Initial main-window candle state is not imported');
        await independent.locator('#concentrationCandleToggle').click();
        await independent.evaluate(() => new Promise(resolve => { window.resizeMessages = []; window.dispatchEvent(new Event('rank-native-resize-complete')); requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
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
        assert.ok(initial[1] > initial[0], 'Opening local candles adds space only to the chart row');
        const initialGeometry = await geometry();
        assert.ok(initialGeometry.main >= 150 && initialGeometry.main <= 500, `Initial main chart has a balanced height: ${initialGeometry.main}`);
        assert.ok(Math.abs(initialGeometry.main - initialGeometry.candle) < 2, 'Main and candle plots start at equal heights');
        assert.ok(initialGeometry.footerBottom <= initialGeometry.panelBottom, 'Initial chart content stays inside its panel');
        assert.equal(initialGeometry.bodyScroll, 0);
        await independent.setViewportSize({ width: 850, height: 1760 });
        const compact = await rowHeights();
        assert.equal((await geometry()).panelOverflow, 0, 'Compact window still contains the whole chart');
        await independent.setViewportSize({ width: 850, height: 2060 });
        await independent.evaluate(() => new Promise(requestAnimationFrame));
        const enlarged = await rowHeights();
        assert.deepEqual(enlarged, compact, 'Manual window growth retains the capped table and chart heights');
        await independent.locator('#concentrationCandleToggle').click();
        const closedResize = await independent.evaluate(() => Number(window.resizeMessages.at(-1).split(':')[1].split(',')[1]));
        await independent.setViewportSize({ width: 850, height: 2060 + closedResize });
        await independent.evaluate(() => new Promise(resolve => { window.dispatchEvent(new Event('rank-native-resize-complete')); requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
        await independent.locator('#concentrationCandleToggle').click();
        const openResize = await independent.evaluate(() => Number(window.resizeMessages.at(-1).split(':')[1].split(',')[1]));
        await independent.setViewportSize({ width: 850, height: 2060 + closedResize + openResize });
        await independent.evaluate(() => new Promise(resolve => { window.dispatchEvent(new Event('rank-native-resize-complete')); requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
        assert.equal(await independent.locator('#concentrationCandleToggle').getAttribute('aria-expanded'), 'true');
        const toggled = await rowHeights();
        const toggledGeometry = await geometry();
        assert.ok(toggledGeometry.candleBottom <= toggledGeometry.panelBottom, 'Reopened candle stays inside the chart panel');
        assert.ok(toggledGeometry.footerBottom <= toggledGeometry.panelBottom, 'Reopened chart footer stays inside the panel');
        assert.equal(toggledGeometry.panelOverflow, 0, 'Reopened chart panel does not overflow');
        assert.equal(toggledGeometry.layoutOverflow, 0, 'Reopening candles does not add an inner grid scrollbar');
        assert.equal(toggledGeometry.bodyScroll, 0, 'Reopening candles does not add a vertical page scrollbar');
        assert.ok(Math.abs(toggledGeometry.main - toggledGeometry.candle) < 2, 'Reopened main and candle plots remain equal');
        await independent.setViewportSize({ width: 850, height: 2060 + closedResize + openResize + 300 });
        await independent.evaluate(() => new Promise(requestAnimationFrame));
        const afterToggleGrowth = await rowHeights();
        assert.deepEqual(afterToggleGrowth, toggled, 'After toggling candles, manual growth still retains capped card heights');
        await independent.setViewportSize({ width: 440, height: 1100 });
        const narrowControl = await independent.evaluate(() => {
            const row = document.querySelector('.concentration-timeframe-row');
            const rate = document.getElementById('concentrationCurrentRate');
            const before = row.scrollLeft;
            row.scrollLeft = row.scrollWidth;
            return { scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, before, after: row.scrollLeft,
                rateHeight: rate.getBoundingClientRect().height, rateWhiteSpace: getComputedStyle(rate).whiteSpace };
        });
        const needsInnerScroll = narrowControl.scrollWidth > narrowControl.clientWidth + 20;
        assert.ok((!needsInnerScroll || narrowControl.after > narrowControl.before)
            && narrowControl.rateHeight < 30 && narrowControl.rateWhiteSpace === 'nowrap',
        `Narrow window keeps the latest rate on one line and scrolls controls only when needed: ${JSON.stringify(narrowControl)}`);
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
