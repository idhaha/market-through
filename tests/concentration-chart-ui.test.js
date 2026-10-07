const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

test('Rank table selection, timeframe controls, history, zoom, retries and stale response handling', { timeout: 60000 }, async () => {
    const requests = [];
    const errors = [];
    let fail = false;
    let delay = false;
    let highValues = false;
    let lastOverride = null;
    const root = path.join(__dirname, '../public');
    const server = http.createServer(async (req, res) => {
        if (req.url.startsWith('/api/concentration-chart')) {
            let body = ''; for await (const part of req) body += part;
            const input = JSON.parse(body); requests.push(input);
            if (delay && input.code === '005930') await new Promise(resolve => setTimeout(resolve, 150));
            res.setHeader('Content-Type', 'application/json');
            if (fail) { res.statusCode = 502; res.end(JSON.stringify({ success: false, error: '모의 조회 실패' })); return; }
            const points = Array.from({ length: input.cursor ? 600 : 300 }, (_, i) => {
                const date = new Date(Date.UTC(2026, 9, (input.cursor ? 2 : 5) + Math.floor(i / 100), 9, (i % 100) * 3));
                return { time: input.mode === 'day' ? `2025${String(1 + Math.floor(i / 28)).padStart(2, '0')}${String(i % 28 + 1).padStart(2, '0')}`
                    : date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14),
                    value: lastOverride != null && i === (input.cursor ? 599 : 299) ? lastOverride : highValues ? (i === (input.cursor ? 599 : 299) ? 32.78839404656069 : 369 + (i % 100) * 100)
                        : i % 31 === 0 ? null : 20 + 15 * Math.sin(i / 7),
                    stock_turnover: input.mode === 'day' ? 6746718000000 : 6655579977000, market_turnover: input.mode === 'day' ? 20576543000000 : 183677404010,
                    stock_turnover_million: 6746718, market_turnover_million: 20576543,
                    stock_price: 269000, stock_volume: 24741933, market_price: 680390, market_volume: 269959 };
            });
            res.end(JSON.stringify({ success: true, market: input.code === '005930' ? 'K' : 'Q',
                points, has_more: !input.cursor, cursor: 'mock-cursor' }));
            return;
        }
        if (req.url.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end('{"authenticated":false}'); return; }
        const url = req.url.split('?')[0];
        const file = path.join(root, url === '/' ? 'index.html' : url);
        if (!file.startsWith(root) || !fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
            window.chartDrawing = { strokes: [], texts: [] };
            const prototype = CanvasRenderingContext2D.prototype;
            const originals = Object.fromEntries(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText'].map(key => [key, prototype[key]]));
            for (const method of Object.keys(originals)) prototype[method] = function (...args) {
                if (this.canvas.id === 'concentrationCanvas') {
                    if (method === 'clearRect') window.chartDrawing = { strokes: [], texts: [] };
                    if (method === 'beginPath') this.recordedPath = [];
                    if (method === 'moveTo' || method === 'lineTo') (this.recordedPath ||= []).push(args);
                    if (method === 'stroke') window.chartDrawing.strokes.push({ color: this.strokeStyle, path: [...(this.recordedPath || [])] });
                    if (method === 'fillText') window.chartDrawing.texts.push(args);
                }
                return originals[method].apply(this, args);
            };
        });
        await page.setViewport({ width: 1900, height: 1200 });
        await page.setRequestInterception(true);
        page.on('request', req => req.url().startsWith(origin) ? req.continue() : req.abort());
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.dismiss());
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.evaluate(async () => {
            unlockApp();
            document.getElementById('dataContainer').style.display = 'block';
            document.getElementById('efriendDataContainer').style.display = 'block';
            renderTable([{ stk_cd: '123456', stk_nm: '조회순위 종목', mkt_type: 'Q', trde_amt: 100 }]);
            renderEfriendTable([{ pdno: '234567', prdt_name: '대주 종목', mkt_type: 'Q' }]);
            const originalFetch = window.fetch;
            window.fetch = async (url, ...args) => String(url).startsWith('/api/transaction_rank')
                ? new Response(JSON.stringify({ success: true, items: [{ stk_cd: '005930', stk_nm: '삼성전자', mkt_type: 'K', trde_amt: 100 }] }))
                : originalFetch(url, ...args);
            await loadTransactionRank();
        });
        async function idle() { await page.waitForFunction(() => document.getElementById('concentrationMore').getAttribute('aria-busy') === 'false'); }
        await page.click('#transactionBody tr'); await idle();
        assert.equal(await page.$eval('#concentrationStockName', el => el.textContent), '삼성전자');
        assert.equal(requests.at(-1).code, '005930');
        const positions = await page.evaluate(() => ({ chart: document.getElementById('concentrationChartPanel').getBoundingClientRect().top,
            tables: ['transactionTable', 'stockTable', 'efriendStockTable'].map(id => document.getElementById(id).getBoundingClientRect().bottom) }));
        assert(positions.tables.every(bottom => bottom < positions.chart));
        await page.click('[data-chart-mode="day"]'); await idle();
        assert.equal(requests.at(-1).mode, 'day');
        const dailyDrawing = await page.evaluate(() => window.chartDrawing);
        const horizontal = dailyDrawing.strokes.filter(stroke => stroke.path.length === 2 && stroke.path[0][1] === stroke.path[1][1]);
        const vertical = dailyDrawing.strokes.filter(stroke => stroke.path.length === 2 && stroke.path[0][0] === stroke.path[1][0]);
        assert.equal(horizontal.length, 8);
        assert(vertical.length < 20);
        assert(dailyDrawing.texts.every(([text]) => !/\d{4}-\d{2}-\d{2}/.test(text)));
        assert.equal(await page.$$eval('[data-chart-interval]', buttons => buttons.every(button => button.disabled)), true);
        await page.click('[data-chart-mode="minute"]'); await idle();
        assert.equal(await page.$$eval('[data-chart-interval]', buttons => buttons.every(button => !button.disabled)), true);
        assert.equal(await page.$('.concentration-diagnostics'), null);
        assert.equal(await page.$eval('#concentrationStatus', el => el.textContent), '');
        await page.click('[data-chart-interval="15"]'); await idle();
        assert.equal(requests.at(-1).interval, 15);
        const currentBeforeZoom = await page.$eval('#concentrationCurrentRate', el => el.textContent);
        const requestsBeforeZoom = requests.length;
        async function dragChart(from, to) {
            const bounds = await page.$eval('#concentrationCanvas', el => {
                const rect = el.getBoundingClientRect();
                const graph = window.chartDrawing.strokes.find(stroke => stroke.color === '#ea580c' && stroke.path.length > 2);
                return { left: rect.left, top: rect.top, start: graph.path[0][0], end: graph.path.at(-1)[0] };
            });
            const start = bounds.left + bounds.start + (bounds.end - bounds.start) * from;
            const end = bounds.left + bounds.start + (bounds.end - bounds.start) * to;
            await page.mouse.move(start, bounds.top + 100);
            await page.mouse.down();
            await page.mouse.move(end, bounds.top + 100, { steps: 8 });
            await page.mouse.up();
        }
        await dragChart(0.2, 0.55);
        const selectedPeriod = await page.$eval('#concentrationPeriod', el => el.textContent);
        const selectedCount = Number(selectedPeriod.match(/· (\d+) \/ 290봉/)[1]);
        assert(selectedCount >= 10 && selectedCount < 290, 'left-to-right drag must zoom to selected range');
        assert.equal(await page.$eval('#concentrationCurrentRate', el => el.textContent), currentBeforeZoom, 'header must always show the current value');
        await dragChart(0.8, 0.2);
        assert((await page.$eval('#concentrationPeriod', el => el.textContent)).includes('290 / 290봉'), 'right-to-left drag must restore full range');
        assert.equal(requests.length, requestsBeforeZoom, 'drag zoom must not fetch data');

        await page.click('#concentrationZoomIn');
        await page.click('#concentrationZoomIn');
        assert((await page.$eval('#concentrationPeriod', el => el.textContent)).includes('73 / 290봉'));
        await page.$eval('#concentrationRange', el => { el.value = '0'; el.dispatchEvent(new Event('input')); });
        await page.click('#concentrationZoomOut');
        await page.click('#concentrationMore'); await idle();
        assert.equal(requests.at(-1).cursor, 'mock-cursor');
        assert((await page.$eval('#concentrationPeriod', el => el.textContent)).includes('580 / 580봉'));
        assert.equal(await page.$eval('#concentrationMore', el => el.disabled), true);
        await page.click('#tableBody tr'); await idle();
        assert.equal(requests.at(-1).code, '123456');
        assert.equal(await page.$eval('#concentrationStockName', el => el.textContent), '조회순위 종목');
        fail = true;
        await page.click('#concentrationMore'); await idle();
        assert((await page.$eval('#concentrationStatus', el => el.textContent)).includes('모의 조회 실패'));
        assert.equal(await page.$eval('#concentrationMore', el => el.disabled), false);
        fail = false;
        await page.click('#concentrationMore'); await idle();
        await page.focus('#efriendTableBody tr'); await page.keyboard.press('Enter'); await idle();
        assert.equal(requests.at(-1).code, '234567');
        assert.equal(await page.$eval('#concentrationStockName', el => el.textContent), '대주 종목');
        delay = true;
        await page.click('#transactionBody tr');
        await page.click('#tableBody tr'); await idle();
        assert.equal(await page.$eval('#concentrationStockName', el => el.textContent), '조회순위 종목');
        assert.equal(await page.$eval('#concentrationMarket', el => el.textContent), '코스닥');
        await page.evaluate(() => renderTable([{ stk_cd: '123456', stk_nm: '조회순위 종목', mkt_type: 'Q' }]));
        await page.waitForSelector('#tableBody tr.concentration-selected');
        delay = true;
        await page.click('#transactionBody tr');
        const loadingMarket = await page.$eval('#concentrationMarket', el => el.textContent);
        const loadingButtonX = await page.$eval('[data-chart-mode="day"]', el => el.getBoundingClientRect().left);
        assert.equal(loadingMarket, '코스피');
        await idle();
        assert.equal(await page.$eval('[data-chart-mode="day"]', el => el.getBoundingClientRect().left), loadingButtonX);
        highValues = true;
        const loading = await page.evaluate(() => {
            const canvas = document.getElementById('concentrationCanvas');
            const area = canvas.parentElement;
            const before = { top: area.getBoundingClientRect().top, height: area.getBoundingClientRect().height, image: canvas.toDataURL() };
            document.querySelector('[data-chart-mode="day"]').click();
            return { before, top: area.getBoundingClientRect().top, height: area.getBoundingClientRect().height,
                image: canvas.toDataURL(), filter: getComputedStyle(canvas).filter,
                message: document.getElementById('concentrationStatus').textContent,
                busy: area.getAttribute('aria-busy') };
        });
        assert.equal(loading.top, loading.before.top, 'loading must not move the chart');
        assert.equal(loading.height, loading.before.height);
        assert.equal(loading.image, loading.before.image, 'retain the previous graph while loading');
        assert.equal(loading.filter, 'blur(2px)');
        assert.equal(loading.message, '');
        assert.equal(loading.busy, 'true');
        assert.equal(await page.$eval('#concentrationMarket', el => el.textContent), '코스피');
        await idle();
        assert.equal(await page.$eval('#concentrationCanvas', el => getComputedStyle(el).filter), 'none');
        assert.equal(await page.$eval('.concentration-chart-area', el => el.getAttribute('aria-busy')), 'false');
        const highDrawing = await page.evaluate(() => window.chartDrawing);
        const graph = highDrawing.strokes.find(stroke => stroke.color === '#ea580c' && stroke.path.length > 2);
        assert(graph, 'large actual-like ratios must have a visible graph');
        assert(graph.path.every(([, y]) => y >= 18 && y <= 306), 'auto axis must keep graph inside plot');
        assert(highDrawing.texts.some(([text]) => text === '12,000%'));
        assert.equal(await page.$eval('#concentrationCurrentRate', el => el.textContent), '32.79%');
        assert(!highDrawing.texts.some(([text]) => text === '32.79%'), 'current ratio belongs in header, not over the graph');
        const summary = await page.evaluate(() => ({ label: document.querySelector('.concentration-chart-title').getBoundingClientRect().right, value: document.getElementById('concentrationCurrentRate').getBoundingClientRect().left }));
        assert(summary.label < summary.value);
        assert.equal(await page.$('.concentration-diagnostics'), null);
        const desktopWidth = await page.evaluate(() => {
            const panel = document.getElementById('concentrationChartPanel');
            return [panel.getBoundingClientRect().width, panel.parentElement.getBoundingClientRect().width];
        });
        assert(Math.abs(desktopWidth[0] / desktopWidth[1] - 0.5) < 0.01);
        if (process.env.CHART_SCREENSHOT) await page.screenshot({ path: process.env.CHART_SCREENSHOT, fullPage: true });
        await page.setViewport({ width: 390, height: 850 });
        await page.waitForFunction(() => document.getElementById('concentrationChartPanel').getBoundingClientRect().width < 390);
        const mobile = await page.evaluate(() => {
            const panel = document.getElementById('concentrationChartPanel').getBoundingClientRect();
            const canvas = document.getElementById('concentrationCanvas').getBoundingClientRect();
            const more = document.getElementById('concentrationMore').getBoundingClientRect();
            return { left: panel.left, right: panel.right, canvas: canvas.width, moreRight: more.right };
        });
        assert(mobile.left >= 0 && mobile.right <= 390, 'mobile chart must fit viewport');
        assert(mobile.canvas > 200 && mobile.moreRight <= mobile.right, 'mobile plot and controls must fit');
        await page.click('[data-chart-mode="minute"]'); await idle();
        highValues = false;
        await page.click('[data-chart-mode="minute"]'); await idle();
        assert((await page.$eval('#concentrationPeriod', el => el.textContent)).includes('290 / 290봉'));
        const minuteDrawing = await page.evaluate(() => window.chartDrawing);
        const minuteGraph = minuteDrawing.strokes.find(stroke => stroke.color === '#ea580c' && stroke.path.length > 2);
        assert.equal(minuteGraph.path.length, 290, 'missing market bars must consume no x-axis space');
        assert.equal(await page.$eval('#concentrationStatus', el => el.textContent), '');
        if (process.env.CHART_SCREENSHOT) await page.screenshot({ path: process.env.CHART_SCREENSHOT.replace('.png', '-mobile.png'), fullPage: false });
        await page.click('#concentrationMore'); await idle();
        await page.click('#concentrationZoomIn');
        await page.$eval('#concentrationRange', el => { el.value = '0'; el.dispatchEvent(new Event('input')); });
        const periodBeforeRefresh = await page.$eval('#concentrationPeriod', el => el.textContent);
        assert(periodBeforeRefresh.includes('290 / 580봉'));
        lastOverride = 45.67;
        await page.evaluate(() => window.refreshConcentrationChart());
        assert.equal(await page.$eval('#concentrationPeriod', el => el.textContent), periodBeforeRefresh, 'refresh must retain loaded history and zoomed historical range');
        assert.equal(await page.$eval('#concentrationCurrentRate', el => el.textContent), '45.67%');
        const concurrentBefore = requests.length;
        await page.evaluate(() => Promise.all([window.refreshConcentrationChart(), window.refreshConcentrationChart()]));
        assert.equal(requests.length, concurrentBefore + 1, 'overlapping refresh must be skipped');
        fail = true;
        await page.evaluate(() => window.refreshConcentrationChart());
        assert.equal(await page.$eval('#concentrationPeriod', el => el.textContent), periodBeforeRefresh, 'failed refresh must retain graph');
        assert.equal(await page.$eval('#concentrationCurrentRate', el => el.textContent), '45.67%');
        fail = false;
        await page.evaluate(() => {
            loadData = async () => {};
            loadTransactionRank = async () => {};
            loadWatchlistRank = async () => {};
            saveAppData = () => {};
            window.setInterval = (run, milliseconds) => { window.rankTimer = { run, milliseconds }; return 123456; };
            startAutoRefresh();
        });
        assert.equal(await page.evaluate(() => window.rankTimer.milliseconds), 600000);
        const timerBefore = requests.length;
        lastOverride = 46.12;
        await page.evaluate(() => window.rankTimer.run()); await idle();
        assert.equal(requests.length, timerBefore + 1);
        assert.equal(requests.at(-1).mode, 'minute');
        assert.equal(requests.at(-1).interval, 15);
        assert.equal(await page.$eval('#concentrationCurrentRate', el => el.textContent), '46.12%');
        await page.select('#refreshInterval', '5'); await idle();
        assert.equal(await page.evaluate(() => window.rankTimer.milliseconds), 30000, 'Rank interval changes must use the new timer period');
        await page.click('[data-chart-mode="day"]'); await idle();
        const dailyTimerBefore = requests.length;
        await page.evaluate(() => window.rankTimer.run()); await idle();
        assert.equal(requests.length, dailyTimerBefore + 1);
        assert.equal(requests.at(-1).mode, 'day');
        const captureBefore = requests.length;
        await page.evaluate(() => { isCapturing = true; window.rankTimer.run(); window.refreshConcentrationChart(); isCapturing = false; });
        assert.equal(requests.length, captureBefore, 'capture must suppress chart refresh');
        await page.evaluate(() => stopAutoRefresh());
        assert.deepEqual(errors, []);
    } catch (error) {
        console.error('UI diagnostic:', { requests, errors });
        throw error;
    } finally {
        server.closeAllConnections();
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
