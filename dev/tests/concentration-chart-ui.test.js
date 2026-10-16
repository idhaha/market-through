const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

test('Rank table selection, timeframe controls, history, zoom, retries and stale response handling', { timeout: 60000 }, async () => {
    const requests = [];
    const errors = [];
    const debugRequests = [];
    const savedSettings = [];
    let autocompleteRequests = 0;
    let fail = false;
    let delay = false;
    let highValues = false;
    let lastOverride = null;
    const root = path.join(__dirname, '../../public');
    const server = http.createServer(async (req, res) => {
        if (req.url.startsWith('/api/settings') && req.method === 'POST') {
            let body = ''; for await (const part of req) body += part;
            savedSettings.push(JSON.parse(body));
            res.setHeader('Content-Type', 'application/json'); res.end('{"success":true}'); return;
        }
        if (req.url.startsWith('/api/concentration-stocks?')) {
            autocompleteRequests++;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, stocks: [{ code: '000660', name: 'SK하이닉스', market: 'K' }] })); return;
        }
        if (req.url.startsWith('/api/concentration-stock')) {
            const query = new URL(req.url, 'http://localhost').searchParams.get('q');
            res.setHeader('Content-Type', 'application/json');
            if (query === '없는종목') { res.statusCode = 404; res.end(JSON.stringify({ success: false, error: '종목을 찾을 수 없습니다.' })); }
            else res.end(JSON.stringify({ success: true, stock: { code: '000660', name: 'SK하이닉스', market: 'K' } }));
            return;
        }
        if (req.url.startsWith('/api/concentration-chart')) {
            let body = ''; for await (const part of req) body += part;
            const input = JSON.parse(body);
            if (input.debug_five) {
                debugRequests.push(input);
                res.setHeader('Content-Type', 'application/json');
                const bars = Array.from({ length: 5 }, (_, i) => ({ cntr_tm: `2026100710${String(25-i*5).padStart(2,'0')}00`, cur_prc: '-276000', trde_qty: '00198028' }));
                res.end(JSON.stringify({ success: true, market: input.code === '123456' ? 'Q' : 'K', debug_five_bars: { fetched_at: '2026-10-07T01:30:02Z', stock: bars, market: bars } })); return;
            }
            requests.push(input);
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
                    stock_previous_close: 260000, stock_change_rate: (269000 / 260000 - 1) * 100, stock_open: i % 2 ? 268000 : 270000, stock_high: 271000, stock_low: 267000, stock_price: 269000, stock_volume: 24741933, market_price: 680390, market_volume: 269959 };
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
            window.testClock = Date.parse('2026-10-08T01:00:00Z');
            Date.now = () => window.testClock;
            window.chartDrawing = { strokes: [], texts: [] };
            window.candleDrawing = { wicks: [], bodies: [] };
            const prototype = CanvasRenderingContext2D.prototype;
            const originals = Object.fromEntries(['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillText', 'fillRect'].map(key => [key, prototype[key]]));
            for (const method of Object.keys(originals)) prototype[method] = function (...args) {
                if (this.canvas.id === 'concentrationCanvas') {
                    if (method === 'clearRect') window.chartDrawing = { strokes: [], texts: [], selections: [] };
                    if (method === 'beginPath') this.recordedPath = [];
                    if (method === 'moveTo' || method === 'lineTo') (this.recordedPath ||= []).push(args);
                    if (method === 'stroke') window.chartDrawing.strokes.push({ color: this.strokeStyle, path: [...(this.recordedPath || [])] });
                    if (method === 'fillText') window.chartDrawing.texts.push(args);
                    if (method === 'fillRect') window.chartDrawing.selections.push(args);
                }
                if (this.canvas.id === 'concentrationCandleCanvas') {
                    if (method === 'clearRect') window.candleDrawing = { wicks: [], bodies: [] };
                    if (method === 'beginPath') this.candlePath = [];
                    if (method === 'moveTo' || method === 'lineTo') (this.candlePath ||= []).push(args);
                    if (method === 'stroke' && ['#e11d48','#2563eb'].includes(this.strokeStyle)) window.candleDrawing.wicks.push([...this.candlePath]);
                    if (method === 'fillRect') window.candleDrawing.bodies.push({ color: this.fillStyle, rect: args });
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
        assert.deepEqual(await page.evaluate(() => window.getConcentrationDisplaySettings()), { debugOpen: false, candleOpen: false, mode: 'day', interval: 1 });
        assert.equal(await page.$eval('#concentrationFiveDebug', el => el.hidden), true);
        assert.equal(await page.$eval('#concentrationCandleArea', el => el.hidden), true);
        await page.evaluate(() => { isInitializing = false; });
        await page.click('#concentrationDebugToggle');
        await page.click('#concentrationCandleToggle');
        const savedDisplay = await page.evaluate(() => getSerializedState().rankChartDisplay);
        assert.deepEqual(savedDisplay, { debugOpen: true, candleOpen: true, mode: 'day', interval: 1 });
        assert(savedSettings.some(settings => settings.rankChartDisplay?.debugOpen === true));
        await page.evaluate(() => window.applyConcentrationDisplaySettings(undefined));
        assert.equal(await page.$eval('#concentrationFiveDebug', el => el.hidden), true);
        assert.equal(await page.$eval('#concentrationCandleArea', el => el.hidden), true);
        await page.evaluate(settings => window.applyConcentrationDisplaySettings(settings), savedDisplay);
        assert.equal(await page.$eval('#concentrationFiveDebug', el => el.hidden), false);
        assert.equal(await page.$eval('#concentrationCandleArea', el => el.hidden), false);
        async function idle() { await page.waitForFunction(() => document.getElementById('concentrationMore').getAttribute('aria-busy') === 'false'); }
        assert.equal(await page.$eval('[data-chart-mode="day"]', el => el.getAttribute('aria-pressed')), 'true');
        assert.equal(await page.$$eval('[data-chart-interval]', nodes => nodes.every(el => el.disabled)), true);
        await page.evaluate(() => window.applyConcentrationDisplaySettings({ debugOpen: true, candleOpen: true, mode: 'minute', interval: 5 }));
        assert.equal(await page.$eval('[data-chart-interval="5"]', el => el.getAttribute('aria-pressed')), 'true');
        assert.deepEqual(await page.evaluate(() => getSerializedState().rankChartDisplay), { debugOpen: true, candleOpen: true, mode: 'minute', interval: 5 });
        await page.evaluate(() => window.applyConcentrationDisplaySettings({ debugOpen: true, candleOpen: true, mode: 'day', interval: 1 }));
        await page.click('[data-chart-mode="minute"]');
        await page.click('#transactionBody tr'); await idle();
        assert.equal(await page.$eval('#concentrationStockName', el => el.value), '삼성전자');
        assert.equal(requests.at(-1).code, '005930');
        const candleDrawing = await page.evaluate(() => ({ candle: window.candleDrawing, line: window.chartDrawing.strokes.find(stroke => stroke.color === '#ea580c' && stroke.path.length > 2) }));
        assert.equal(candleDrawing.candle.wicks.length, 290);
        assert(candleDrawing.candle.bodies.some(body => body.color === '#e11d48'));
        assert(candleDrawing.candle.bodies.some(body => body.color === '#2563eb'));
        assert.deepEqual(candleDrawing.candle.wicks.map(wick => wick[0][0]), candleDrawing.line.path.map(point => point[0]));
        const hoverBounds = await page.$eval('#concentrationCandleCanvas', el => { const r = el.getBoundingClientRect(); return { x: r.left + 100, y: r.top + 60 }; });
        await page.mouse.move(hoverBounds.x, hoverBounds.y);
        assert((await page.$eval('#concentrationCandleTooltip', el => el.textContent)).includes('상승률 +3.46%'));
        assert.equal(await page.$eval('#concentrationTooltip', el => el.textContent), await page.$eval('#concentrationCandleTooltip', el => el.textContent));
        const hoverLayout = await page.evaluate(() => ({ info: document.getElementById('concentrationTooltip').getBoundingClientRect().top, chart: document.getElementById('concentrationCanvas').getBoundingClientRect().top, text: document.getElementById('concentrationTooltip').textContent }));
        assert(hoverLayout.info >= hoverLayout.chart);
        assert(!hoverLayout.text.includes('시가 대비'));
        assert(!hoverLayout.text.includes('현재'));

        await page.click('#concentrationCandleToggle');
        assert.equal(await page.$eval('#concentrationCandleArea', el => el.hidden), true);
        await page.click('#concentrationCandleToggle');
        assert.equal(await page.$eval('#concentrationCandleToggle', el => el.getAttribute('aria-expanded')), 'true');

        await page.$eval('#concentrationStockName', el => { el.value = 'SK하이닉스'; });
        await page.focus('#concentrationStockName');
        const manualChartResponse = page.waitForResponse(response => response.url().includes('/api/concentration-chart') && response.request().postData()?.includes('000660'));
        await page.keyboard.press('Enter'); await manualChartResponse; await idle();
        await page.waitForFunction(() => document.getElementById('concentrationStockName').value === 'SK하이닉스' && document.getElementById('concentrationMore').getAttribute('aria-busy') === 'false');
        assert.equal(requests.at(-1).code, '000660');
        await page.$eval('#concentrationStockName', el => { el.value = '하이'; el.dispatchEvent(new CompositionEvent('compositionupdate', { data: '이' })); });
        await page.waitForFunction(() => !document.getElementById('concentrationStockSuggestions').hidden);
        assert.equal(await page.$eval('#concentrationStockSuggestions', el => el.children.length), 1);
        const searchesBeforeNavigation = autocompleteRequests;
        await page.$eval('#concentrationStockName', el => {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true, bubbles: true, cancelable: true }));
            el.dispatchEvent(new CompositionEvent('compositionend', { data: '이' }));
            el.dispatchEvent(new InputEvent('input', { isComposing: false }));
        });
        await page.waitForFunction(() => document.getElementById('concentrationStockName').getAttribute('aria-activedescendant') === 'stock-suggestion-0');
        // Allow any mistakenly scheduled debounce request to finish before asserting.
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
        assert.equal(autocompleteRequests, searchesBeforeNavigation);
        assert.equal(await page.$eval('#stock-suggestion-0', el => el.getAttribute('aria-selected')), 'true');
        const autocompleteResponse = page.waitForResponse(response => response.url().includes('/api/concentration-chart') && response.request().postData()?.includes('000660'));
        await page.keyboard.press('Enter'); await autocompleteResponse; await idle();
        assert.equal(await page.$eval('#concentrationStockName', el => el.value), 'SK하이닉스');
        assert.equal(await page.$eval('#concentrationStockSuggestions', el => el.hidden), true);
        await page.$eval('#concentrationStockName', el => { el.value = '없는종목'; });
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('concentrationStatus').textContent.includes('종목을 찾을 수 없습니다.'));
        assert.equal(requests.at(-1).code, '000660');
        await page.click('#transactionBody tr'); await idle();
        const positions = await page.evaluate(() => ({ chart: document.getElementById('concentrationChartPanel').getBoundingClientRect().top,
            tables: ['transactionTable', 'stockTable', 'efriendStockTable'].map(id => document.getElementById(id).getBoundingClientRect().bottom) }));
        assert(positions.tables.every(bottom => bottom < positions.chart));
        const debugCountAtClose = debugRequests.length;
        const debugValuesAtClose = await page.$eval('#concentrationDebugStock', el => el.textContent);
        await page.evaluate(() => {
            window.testClock = Date.parse('2026-10-08T06:35:00Z');
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForFunction(() => document.getElementById('concentrationDebugStatus').textContent.includes('갱신 중지'));
        assert.equal(debugRequests.length, debugCountAtClose);
        assert.equal(await page.$eval('#concentrationDebugStock', el => el.textContent), debugValuesAtClose);
        await page.evaluate(() => {
            window.testClock = Date.parse('2026-10-09T01:00:00Z');
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForFunction(() => document.getElementById('concentrationDebugStatus').textContent.startsWith('조회'));
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
        assert.equal(await page.evaluate(() => getSerializedState().rankChartDisplay.interval), 15);
        const currentBeforeZoom = await page.$eval('#concentrationCurrentRate', el => el.textContent);
        const requestsBeforeZoom = requests.length;
        async function dragChart(from, to, selector = '#concentrationCanvas') {
            const bounds = await page.$eval(selector, el => {
                const rect = el.getBoundingClientRect();
                const graph = window.chartDrawing.strokes.find(stroke => stroke.color === '#ea580c' && stroke.path.length > 2);
                return { left: rect.left, top: rect.top, start: graph.path[0][0], end: graph.path.at(-1)[0] };
            });
            const start = bounds.left + bounds.start + (bounds.end - bounds.start) * from;
            const end = bounds.left + bounds.start + (bounds.end - bounds.start) * to;
            await page.mouse.move(start, bounds.top + 100);
            await page.mouse.down();
            await page.mouse.move(end, bounds.top + 100, { steps: 8 });
            const selections = await page.evaluate(() => ({
                upper: window.chartDrawing.selections?.at(-1),
                lower: window.candleDrawing.bodies.filter(body => body.color.startsWith('rgba')).at(-1)?.rect
            }));
            assert(selections.upper && selections.lower, 'both charts must display drag selection');
            assert.equal(selections.upper[0], selections.lower[0]);
            assert.equal(selections.upper[2], selections.lower[2]);

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
        await dragChart(0.25, 0.65, '#concentrationCandleCanvas');
        assert(!(await page.$eval('#concentrationPeriod', el => el.textContent)).includes('290 / 290봉'));
        await dragChart(0.8, 0.2, '#concentrationCandleCanvas');
        assert((await page.$eval('#concentrationPeriod', el => el.textContent)).includes('290 / 290봉'));
        assert.equal(requests.length, requestsBeforeZoom);


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
        assert.equal(await page.$eval('#concentrationStockName', el => el.value), '조회순위 종목');
        await page.waitForFunction(() => document.getElementById('concentrationDebugStock').textContent.includes('조회순위 종목') && document.getElementById('concentrationDebugMarket').textContent.includes('코스닥'));
        fail = true;
        await page.click('#concentrationMore'); await idle();
        assert((await page.$eval('#concentrationStatus', el => el.textContent)).includes('모의 조회 실패'));
        assert.equal(await page.$eval('#concentrationMore', el => el.disabled), false);
        fail = false;
        await page.click('#concentrationMore'); await idle();
        await page.focus('#efriendTableBody tr'); await page.keyboard.press('Enter'); await idle();
        assert.equal(requests.at(-1).code, '234567');
        assert.equal(await page.$eval('#concentrationStockName', el => el.value), '대주 종목');
        delay = true;
        await page.click('#transactionBody tr');
        await page.click('#tableBody tr'); await idle();
        assert.equal(await page.$eval('#concentrationStockName', el => el.value), '조회순위 종목');
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
        assert.equal(await page.$('.concentration-chart-title'), null);
        const controlLayout = await page.evaluate(() => {
            const rate = document.getElementById('concentrationCurrentRate').getBoundingClientRect();
            const candle = document.getElementById('concentrationCandleToggle').getBoundingClientRect();
            const debug = document.getElementById('concentrationDebugToggle').getBoundingClientRect();
            const canvas = document.getElementById('concentrationCanvas').getBoundingClientRect();
            return { sameRow: Math.abs((rate.top + rate.bottom) / 2 - (candle.top + candle.bottom) / 2),
                rightGap: canvas.right - debug.right, ordered: rate.left >= candle.right };
        });
        assert(controlLayout.sameRow < 2);
        assert(controlLayout.ordered);
        assert(Math.abs(controlLayout.rightGap) < 2);
        assert.equal(await page.$('.concentration-diagnostics'), null);
        const desktopWidth = await page.evaluate(() => {
            const panel = document.getElementById('concentrationChartPanel');
            return [panel.getBoundingClientRect().width, document.getElementById('transactionTable').closest('.panel').getBoundingClientRect().width];
        });
        assert(Math.abs(desktopWidth[0] - (desktopWidth[1] + 450)) < 2);
        const footerOpen = await page.$eval('.concentration-chart-footer', el => el.getBoundingClientRect().width);
        await page.click('#concentrationDebugToggle');
        assert.equal(await page.$eval('#concentrationFiveDebug', el => el.hidden), true);
        const matchingWidths = await page.evaluate(() => [document.getElementById('concentrationCanvas').getBoundingClientRect().width, document.getElementById('transactionTable').getBoundingClientRect().width]);
        assert(Math.abs(matchingWidths[0] - matchingWidths[1]) < 2);
        assert.equal(await page.$eval('#concentrationCandleToggle', el => el.textContent), '캔들차트');
        const controlTops = await page.$$eval('[data-chart-mode], [data-chart-interval], #concentrationMore, #concentrationCandleToggle', nodes => nodes.map(node => node.getBoundingClientRect().top));
        assert(Math.max(...controlTops) - Math.min(...controlTops) < 2);

        const footerClosed = await page.$eval('.concentration-chart-footer', el => el.getBoundingClientRect().width);
        assert(Math.abs(footerOpen - footerClosed) < 2, 'debug expansion must not extend zoom controls');
        assert.equal(await page.$eval('#concentrationDebugToggle', el => el.getAttribute('aria-expanded')), 'false');
        await page.click('#concentrationDebugToggle');
        assert.equal(await page.$eval('#concentrationFiveDebug', el => el.hidden), false);

        await page.waitForFunction(() => document.querySelectorAll('#concentrationDebugStock tbody tr').length === 5);
        assert.equal(await page.$$eval('#concentrationDebugMarket tbody tr', rows => rows.length), 5);
        assert.equal(await page.$eval('#concentrationDebugStock tbody tr td:nth-child(2)', el => el.textContent), '-276000');
        assert.equal(await page.$eval('#concentrationDebugStock tbody tr td:nth-child(3)', el => el.textContent), '00198028');
        assert.equal(await page.$eval('#concentrationDebugStock tbody tr td:nth-child(4)', el => el.textContent), (276000 * 198028).toLocaleString('ko-KR'));
        assert.equal(await page.$eval('#concentrationDebugMarket tbody tr td:nth-child(4)', el => el.textContent), ((276000 / 100) * (198028 * 10000)).toLocaleString('ko-KR'));

        if (process.env.CHART_SCREENSHOT) await page.screenshot({ path: process.env.CHART_SCREENSHOT, fullPage: true });
        await page.setViewport({ width: 390, height: 850 });
        await page.waitForFunction(() => document.getElementById('concentrationChartPanel').getBoundingClientRect().width < 390);
        const mobile = await page.evaluate(() => {
            const panel = document.getElementById('concentrationChartPanel').getBoundingClientRect();
            const canvas = document.getElementById('concentrationCanvas').getBoundingClientRect();
            const more = document.querySelector('.concentration-timeframe-row').getBoundingClientRect();
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
