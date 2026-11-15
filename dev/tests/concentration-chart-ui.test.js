const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

test('Rank table selection, timeframe controls, history, zoom, retries and stale response handling', { timeout: 60000 }, async () => {
    const requests = [];
    const errors = [];
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
        // The main-screen card asks 1분봉 from LS (/api/ls-concentration-chart) since 2026-10-28; the mock answers both alike.
        if (req.url.startsWith('/api/concentration-chart') || req.url.startsWith('/api/ls-concentration-chart')) {
            let body = ''; for await (const part of req) body += part;
            const input = JSON.parse(body);
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
        // Automatic chart refresh runs only while the market is open (trading-refresh.js); the mock market is open.
        if (req.url.startsWith('/api/trading-session')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ spot: true, futures: true, night: false, days: {} })); return; }
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
                if (this.canvas.id === 'combinedConcentrationCanvas') {
                    if (method === 'clearRect') window.chartDrawing = { strokes: [], texts: [], selections: [] };
                    if (method === 'beginPath') this.recordedPath = [];
                    if (method === 'moveTo' || method === 'lineTo') (this.recordedPath ||= []).push(args);
                    if (method === 'stroke') window.chartDrawing.strokes.push({ color: this.strokeStyle, path: [...(this.recordedPath || [])] });
                    if (method === 'fillText') window.chartDrawing.texts.push(args);
                    if (method === 'fillRect') window.chartDrawing.selections.push(args);
                }
                if (this.canvas.id === 'combinedConcentrationCandleCanvas') {
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
        // The 5분봉 디버깅 panel was removed on 2026-10-15 (70a66c1); the saved display now also carries the other cards' settings.
        const pick = s => ({ candleOpen: s.candleOpen, mode: s.mode, interval: s.interval });
        assert.deepEqual(pick(await page.evaluate(() => window.getConcentrationDisplaySettings())), { candleOpen: false, mode: 'day', interval: 1 });
        assert.equal(await page.$('#combinedConcentrationDebugToggle'), null);
        assert.equal(await page.$eval('#combinedConcentrationCandleArea', el => el.hidden), true);
        await page.evaluate(() => { isInitializing = false; });
        await page.click('#combinedConcentrationCandleToggle');
        const savedDisplay = pick(await page.evaluate(() => getSerializedState().rankChartDisplay));
        assert.deepEqual(savedDisplay, { candleOpen: true, mode: 'day', interval: 1 });
        assert(savedSettings.some(settings => settings.rankChartDisplay?.candleOpen === true));
        await page.evaluate(() => window.applyConcentrationDisplaySettings(undefined));
        assert.equal(await page.$eval('#combinedConcentrationCandleArea', el => el.hidden), true);
        await page.evaluate(settings => window.applyConcentrationDisplaySettings(settings), savedDisplay);
        assert.equal(await page.$eval('#combinedConcentrationCandleArea', el => el.hidden), false);
        async function idle() { await page.waitForFunction(() => document.getElementById('combinedConcentrationMore').getAttribute('aria-busy') === 'false'); }
        assert.equal(await page.$eval('#combinedConcentrationChartPanel [data-chart-mode="day"]', el => el.getAttribute('aria-pressed')), 'true');
        // The 5 · 15분 interval buttons were removed on 2026-10-23 (844ae72); only 1분봉 is left and an old saved interval falls back to 1.
        assert.equal((await page.$$('[data-chart-interval]')).length, 0);
        await page.evaluate(() => window.applyConcentrationDisplaySettings({ candleOpen: true, mode: 'minute', interval: 5 }));
        assert.equal(await page.$eval('#combinedConcentrationChartPanel [data-chart-mode="minute"]', el => el.getAttribute('aria-pressed')), 'true');
        assert.deepEqual(pick(await page.evaluate(() => getSerializedState().rankChartDisplay)), { candleOpen: true, mode: 'minute', interval: 1 });
        await page.evaluate(() => window.applyConcentrationDisplaySettings({ candleOpen: true, mode: 'day', interval: 1 }));
        await page.click('#combinedConcentrationChartPanel [data-chart-mode="minute"]');
        await page.click('#transactionBody tr'); await idle();
        assert.equal(await page.$eval('#combinedConcentrationStockName', el => el.value), '삼성전자');
        assert.equal(requests.at(-1).code, '005930');
        // The 쏠림율 line is blue (#339af0); orange is the 분봉 누적 line, which needs an 08:00 bar the mock does not have.
        // Bars without a ratio keep their x slot (candles still draw), and 1분봉 opens on the latest session (2026-10-23 shared axis).
        const candleDrawing = await page.evaluate(() => ({ candle: window.candleDrawing, line: window.chartDrawing.strokes.find(stroke => stroke.color === '#339af0' && stroke.path.length > 2) }));
        assert.match(await page.$eval('#combinedConcentrationPeriod', el => el.textContent), /^2026-10-07 09:00 — 2026-10-07 13:57 · 100 \/ 300봉$/);
        assert.equal(candleDrawing.candle.wicks.length, 100);
        assert(candleDrawing.candle.bodies.some(body => body.color === '#e11d48'));
        assert(candleDrawing.candle.bodies.some(body => body.color === '#2563eb'));
        const wickX = candleDrawing.candle.wicks.map(wick => wick[0][0]);
        assert.equal(candleDrawing.line.path.length, 100 - [217, 248, 279].length, 'bars without a ratio leave a gap in the line');
        assert(candleDrawing.line.path.every(([x]) => wickX.some(w => Math.abs(w - x) < 0.01)), 'line and candles share the time axis');
        // More Rank cards now sit above this one, so bring the chart into the viewport before using the mouse.
        await page.$eval('#combinedConcentrationChartPanel', el => el.scrollIntoView({ block: 'start' }));
        const hoverBounds = await page.$eval('#combinedConcentrationCandleCanvas', el => { const r = el.getBoundingClientRect(); return { x: r.left + 100, y: r.top + 60 }; });
        await page.mouse.move(hoverBounds.x, hoverBounds.y);
        // One shared info line above the charts (the candle tooltip stays hidden), rates to one decimal.
        assert.match(await page.$eval('#combinedConcentrationTooltip', el => el.textContent), /^2026-10-07 \d\d:\d\d · 쏠림율 \d+\.\d% · 당일 누적 미제공 · 상승률 3\.5%$/);
        assert.equal(await page.$eval('#combinedConcentrationCandleTooltip', el => el.hidden), true);
        // The info line now sits in the chart column above the graph instead of floating over it.
        const hoverLayout = await page.evaluate(() => ({ info: document.getElementById('combinedConcentrationTooltip').getBoundingClientRect().bottom, chart: document.getElementById('combinedConcentrationCanvas').getBoundingClientRect().top, text: document.getElementById('combinedConcentrationTooltip').textContent }));
        assert(hoverLayout.info <= hoverLayout.chart + 1, 'the info line must not cover the graph');
        assert(!hoverLayout.text.includes('시가 대비'));
        assert(!hoverLayout.text.includes('현재'));

        await page.click('#combinedConcentrationCandleToggle');
        assert.equal(await page.$eval('#combinedConcentrationCandleArea', el => el.hidden), true);
        await page.click('#combinedConcentrationCandleToggle');
        assert.equal(await page.$eval('#combinedConcentrationCandleToggle', el => el.getAttribute('aria-expanded')), 'true');

        await page.$eval('#combinedConcentrationStockName', el => { el.value = 'SK하이닉스'; });
        await page.focus('#combinedConcentrationStockName');
        const manualChartResponse = page.waitForResponse(response => response.url().includes('/api/concentration-chart') && response.request().postData()?.includes('000660'));
        await page.keyboard.press('Enter'); await manualChartResponse; await idle();
        await page.waitForFunction(() => document.getElementById('combinedConcentrationStockName').value === 'SK하이닉스' && document.getElementById('combinedConcentrationMore').getAttribute('aria-busy') === 'false');
        assert.equal(requests.at(-1).code, '000660');
        await page.$eval('#combinedConcentrationStockName', el => { el.value = '하이'; el.dispatchEvent(new CompositionEvent('compositionupdate', { data: '이' })); });
        await page.waitForFunction(() => !document.getElementById('combinedConcentrationStockSuggestions').hidden);
        assert.equal(await page.$eval('#combinedConcentrationStockSuggestions', el => el.children.length), 1);
        const searchesBeforeNavigation = autocompleteRequests;
        await page.$eval('#combinedConcentrationStockName', el => {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true, bubbles: true, cancelable: true }));
            el.dispatchEvent(new CompositionEvent('compositionend', { data: '이' }));
            el.dispatchEvent(new InputEvent('input', { isComposing: false }));
        });
        await page.waitForFunction(() => document.getElementById('combinedConcentrationStockName').getAttribute('aria-activedescendant') === 'combinedConcentration-stock-suggestion-0');
        // Allow any mistakenly scheduled debounce request to finish before asserting.
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
        assert.equal(autocompleteRequests, searchesBeforeNavigation);
        assert.equal(await page.$eval('#combinedConcentration-stock-suggestion-0', el => el.getAttribute('aria-selected')), 'true');
        const autocompleteResponse = page.waitForResponse(response => response.url().includes('/api/concentration-chart') && response.request().postData()?.includes('000660'));
        await page.keyboard.press('Enter'); await autocompleteResponse; await idle();
        assert.equal(await page.$eval('#combinedConcentrationStockName', el => el.value), 'SK하이닉스');
        assert.equal(await page.$eval('#combinedConcentrationStockSuggestions', el => el.hidden), true);
        await page.$eval('#combinedConcentrationStockName', el => { el.value = '없는종목'; });
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('combinedConcentrationStatus').textContent.includes('종목을 찾을 수 없습니다.'));
        assert.equal(requests.at(-1).code, '000660');
        await page.click('#transactionBody tr'); await idle();
        const positions = await page.evaluate(() => ({ chart: document.getElementById('combinedConcentrationChartPanel').getBoundingClientRect().top,
            tables: ['transactionTable', 'stockTable', 'efriendStockTable'].map(id => document.getElementById(id).getBoundingClientRect().bottom) }));
        assert(positions.tables.every(bottom => bottom < positions.chart));
        await page.evaluate(() => {
            window.testClock = Date.parse('2026-10-08T06:35:00Z');
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.evaluate(() => {
            window.testClock = Date.parse('2026-10-09T01:00:00Z');
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.click('#combinedConcentrationChartPanel [data-chart-mode="day"]'); await idle();
        assert.equal(requests.at(-1).mode, 'day');
        const dailyDrawing = await page.evaluate(() => window.chartDrawing);
        const horizontal = dailyDrawing.strokes.filter(stroke => stroke.path.length === 2 && stroke.path[0][1] === stroke.path[1][1]);
        const vertical = dailyDrawing.strokes.filter(stroke => stroke.path.length === 2 && stroke.path[0][0] === stroke.path[1][0]);
        // Fixed 0~100% axis with 10% ticks since 2026-11-07 (a0d8fbb): 11 grid lines.
        assert.equal(horizontal.length, 11);
        assert(vertical.length < 20);
        assert(dailyDrawing.texts.every(([text]) => !/\d{4}-\d{2}-\d{2}/.test(text)));
        await page.click('#combinedConcentrationChartPanel [data-chart-mode="minute"]'); await idle();
        assert.equal(await page.$('.concentration-diagnostics'), null);
        // The mock leaves 10 of 300 bars without a ratio (i % 31 === 0); they keep their slot and the status says so.
        assert.equal(await page.$eval('#combinedConcentrationStatus', el => el.textContent), '시장 거래대금 10개 시점 누락 · 쏠림율 계산 불가');
        assert.equal(requests.at(-1).interval, 1);
        assert.equal(await page.evaluate(() => getSerializedState().rankChartDisplay.interval), 1);
        const currentBeforeZoom = await page.$eval('#combinedConcentrationCurrentRate', el => el.textContent);
        const requestsBeforeZoom = requests.length;
        async function dragChart(from, to, selector = '#combinedConcentrationCanvas') {
            await page.$eval(selector, el => el.scrollIntoView({ block: 'center' }));
            const bounds = await page.$eval(selector, el => {
                const rect = el.getBoundingClientRect();
                const graph = window.chartDrawing.strokes.find(stroke => stroke.color === '#339af0' && stroke.path.length > 2);
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
        // 1분봉 opens on the latest session (100 of the 300 loaded bars); a right-to-left drag goes back to that view.
        const sessionPeriod = await page.$eval('#combinedConcentrationPeriod', el => el.textContent);
        assert.equal(sessionPeriod, '2026-10-07 09:00 — 2026-10-07 13:57 · 100 / 300봉');
        await dragChart(0.2, 0.55);
        const selectedPeriod = await page.$eval('#combinedConcentrationPeriod', el => el.textContent);
        const selectedCount = Number(selectedPeriod.match(/· (\d+) \/ 300봉/)[1]);
        assert(selectedCount >= 10 && selectedCount < 100, 'left-to-right drag must zoom to selected range');
        assert.equal(await page.$eval('#combinedConcentrationCurrentRate', el => el.textContent), currentBeforeZoom, 'header must always show the current value');
        await dragChart(0.8, 0.2);
        assert.equal(await page.$eval('#combinedConcentrationPeriod', el => el.textContent), sessionPeriod, 'right-to-left drag must restore the session view');
        assert.equal(requests.length, requestsBeforeZoom, 'drag zoom must not fetch data');
        await dragChart(0.25, 0.65, '#combinedConcentrationCandleCanvas');
        assert.notEqual(await page.$eval('#combinedConcentrationPeriod', el => el.textContent), sessionPeriod);
        await dragChart(0.8, 0.2, '#combinedConcentrationCandleCanvas');
        assert.equal(await page.$eval('#combinedConcentrationPeriod', el => el.textContent), sessionPeriod);
        assert.equal(requests.length, requestsBeforeZoom);


        await page.click('#combinedConcentrationZoomIn');
        await page.click('#combinedConcentrationZoomIn');
        // Each zoom-in halves the 100-bar session view.
        assert((await page.$eval('#combinedConcentrationPeriod', el => el.textContent)).includes('25 / 300봉'));
        await page.$eval('#combinedConcentrationRange', el => { el.value = '0'; el.dispatchEvent(new Event('input')); });
        await page.click('#combinedConcentrationZoomOut');
        await page.click('#combinedConcentrationMore'); await idle();
        assert.equal(requests.at(-1).cursor, 'mock-cursor');
        // The 600-bar older page overlaps the first one (10/2 ~ 10/7 → 600 distinct bars).
        // The footer is redrawn on the next frame after the shared axis takes the older page, so wait for it.
        await page.waitForFunction(() => document.getElementById('combinedConcentrationPeriod').textContent.includes('600 / 600봉'), { timeout: 5000 });
        assert.equal(await page.$eval('#combinedConcentrationMore', el => el.disabled), true);
        await page.click('#tableBody tr'); await idle();
        assert.equal(requests.at(-1).code, '123456');
        // The shared axis keeps the loaded history, so the new stock is fetched up to the same past page.
        assert.equal(requests.at(-1).cursor, 'mock-cursor');
        assert.equal(await page.$eval('#combinedConcentrationStockName', el => el.value), '조회순위 종목');
        // Nothing more to load here, so a failed fetch is checked through the 일/분 buttons, which the message names.
        fail = true;
        await page.click('#combinedConcentrationChartPanel [data-chart-mode="day"]'); await idle();
        assert.equal(await page.$eval('#combinedConcentrationStatus', el => el.textContent), '모의 조회 실패 · 일/분 버튼으로 다시 시도하세요.');
        fail = false;
        await page.click('#combinedConcentrationChartPanel [data-chart-mode="minute"]'); await idle();
        assert(!(await page.$eval('#combinedConcentrationStatus', el => el.textContent)).includes('모의 조회 실패'), 'retry after a failure recovers');
        await page.focus('#efriendTableBody tr'); await page.keyboard.press('Enter'); await idle();
        assert.equal(requests.at(-1).code, '234567');
        assert.equal(await page.$eval('#combinedConcentrationStockName', el => el.value), '대주 종목');
        delay = true;
        await page.click('#transactionBody tr');
        await page.click('#tableBody tr'); await idle();
        assert.equal(await page.$eval('#combinedConcentrationStockName', el => el.value), '조회순위 종목');
        assert.equal(await page.$eval('#combinedConcentrationMarket', el => el.textContent), '코스닥');
        await page.evaluate(() => renderTable([{ stk_cd: '123456', stk_nm: '조회순위 종목', mkt_type: 'Q' }]));
        await page.waitForSelector('#tableBody tr.concentration-selected');
        delay = true;
        // Choosing another stock keeps both previous graphs (ratio and candles) under the blur until its answer arrives.
        const images = () => page.evaluate(() => ['combinedConcentrationCanvas', 'combinedConcentrationCandleCanvas'].map(id => document.getElementById(id).toDataURL()));
        const beforeSwitch = await images();
        await page.click('#transactionBody tr');
        assert.equal(await page.$eval('.concentration-chart-area', el => el.getAttribute('aria-busy')), 'true');
        assert.deepEqual(await images(), beforeSwitch, 'retain the previous graphs while another stock loads');
        const loadingMarket = await page.$eval('#combinedConcentrationMarket', el => el.textContent);
        const loadingButtonX = await page.$eval('#combinedConcentrationChartPanel [data-chart-mode="day"]', el => el.getBoundingClientRect().left);
        assert.equal(loadingMarket, '코스피');
        await idle();
        assert.equal(await page.$eval('#combinedConcentrationChartPanel [data-chart-mode="day"]', el => el.getBoundingClientRect().left), loadingButtonX);
        highValues = true;
        const loading = await page.evaluate(() => {
            const canvas = document.getElementById('combinedConcentrationCanvas');
            const area = canvas.parentElement;
            const before = { top: area.getBoundingClientRect().top, height: area.getBoundingClientRect().height, image: canvas.toDataURL() };
            document.querySelector('#combinedConcentrationChartPanel [data-chart-mode="day"]').click();
            return { before, top: area.getBoundingClientRect().top, height: area.getBoundingClientRect().height,
                image: canvas.toDataURL(), filter: getComputedStyle(canvas).filter,
                message: document.getElementById('combinedConcentrationStatus').textContent,
                busy: area.getAttribute('aria-busy') };
        });
        assert.equal(loading.top, loading.before.top, 'loading must not move the chart');
        assert.equal(loading.height, loading.before.height);
        // A new stock or 일/분 load keeps the previous graph under the blur until the answer arrives, like the automatic refresh (2026-11-13).
        assert.equal(loading.image, loading.before.image, 'retain the previous graph while loading');
        assert.equal(loading.filter, 'blur(2px)');
        assert.equal(loading.message, '');
        assert.equal(loading.busy, 'true');
        assert.equal(await page.$eval('#combinedConcentrationMarket', el => el.textContent), '코스피');
        await idle();
        assert.equal(await page.$eval('#combinedConcentrationCanvas', el => getComputedStyle(el).filter), 'none');
        assert.equal(await page.$eval('.concentration-chart-area', el => el.getAttribute('aria-busy')), 'false');
        const highDrawing = await page.evaluate(() => window.chartDrawing);
        const graph = highDrawing.strokes.find(stroke => stroke.color === '#339af0' && stroke.path.length > 2);
        assert(graph, 'large actual-like ratios must have a visible graph');
        // Fixed 0~100% axis (2026-11-07): ratios above 100% (a data glitch) are drawn at the top edge, never outside the plot.
        const axisY = label => highDrawing.texts.find(([text]) => text === label)?.[2];
        const [top, bottom] = [axisY('100%'), axisY('0%')];
        assert(Number.isFinite(top) && Number.isFinite(bottom), '0% and 100% axis labels');
        assert(graph.path.every(([, y]) => y >= top - 0.5 && y <= bottom + 0.5), 'the graph stays inside the plot');
        assert(graph.path.some(([, y]) => Math.abs(y - top) < 0.5), 'ratios above 100% sit on the top edge');
        assert(!highDrawing.texts.some(([text]) => text === '12,000%'), 'no auto-scaled axis');
        // The header shows one decimal.
        assert.equal(await page.$eval('#combinedConcentrationCurrentRate', el => el.textContent), '32.8%');
        assert(!highDrawing.texts.some(([text]) => text === '32.8%'), 'current ratio belongs in header, not over the graph');
        assert.equal(await page.$('.concentration-chart-title'), null);
        // The current rate (with its date under it) sits at the right end of the button row.
        const controlLayout = await page.evaluate(() => {
            const rate = document.getElementById('combinedConcentrationCurrentRate').getBoundingClientRect();
            const candle = document.getElementById('combinedConcentrationCandleToggle').getBoundingClientRect();
            const canvas = document.getElementById('combinedConcentrationCanvas').getBoundingClientRect();
            return { sameRow: rate.top < candle.bottom && rate.bottom > candle.top, ordered: rate.left >= candle.right, rightGap: canvas.right - rate.right };
        });
        assert(controlLayout.sameRow, 'rate and buttons share the header row');
        assert(controlLayout.ordered);
        assert(controlLayout.rightGap >= 0 && controlLayout.rightGap < 8, 'rate ends at the chart right edge');
        assert.equal(await page.$('.concentration-diagnostics'), null);
        // Since 2026-10-15 the Rank cards sit in a 3-column grid (.rank-chart-row) instead of next to the tables.
        const desktopWidth = await page.evaluate(() => {
            const panel = document.getElementById('combinedConcentrationChartPanel'), row = panel.closest('.rank-chart-row');
            const gap = parseFloat(getComputedStyle(row).columnGap);
            return { panel: panel.getBoundingClientRect().width, column: (row.getBoundingClientRect().width - 2 * gap) / 3,
                canvas: (({ left, right }) => ({ left, right }))(document.getElementById('combinedConcentrationCanvas').getBoundingClientRect()), box: (({ left, right }) => ({ left, right }))(panel.getBoundingClientRect()) };
        });
        assert(Math.abs(desktopWidth.panel - desktopWidth.column) < 2, 'one grid column wide');
        assert(desktopWidth.canvas.left >= desktopWidth.box.left && desktopWidth.canvas.right <= desktopWidth.box.right, 'the chart fits in its card');
        assert.equal(await page.$eval('#combinedConcentrationCandleToggle', el => el.textContent), '캔들차트');
        const controlTops = await page.$$eval('#combinedConcentrationChartPanel [data-chart-mode], #combinedConcentrationMore, #combinedConcentrationCandleToggle', nodes => nodes.map(node => node.getBoundingClientRect().top));
        assert(Math.max(...controlTops) - Math.min(...controlTops) < 2);


        if (process.env.CHART_SCREENSHOT) await page.screenshot({ path: process.env.CHART_SCREENSHOT, fullPage: true });
        // Since 2026-10-18 (021b5bc) the Rank tab keeps a 1750px minimum width and scrolls sideways on a narrow window,
        // so the card keeps its desktop size instead of shrinking to the phone width.
        const desktopPanelWidth = desktopWidth.panel;
        await page.setViewport({ width: 390, height: 850 });
        // Let the layout settle after the resize (a timer, not requestAnimationFrame, which a resizing headless page may drop).
        await new Promise(resolve => setTimeout(resolve, 200));
        const mobile = await page.evaluate(() => {
            const panel = document.getElementById('combinedConcentrationChartPanel').getBoundingClientRect();
            const more = document.querySelector('#combinedConcentrationChartPanel .concentration-timeframe-row').getBoundingClientRect();
            return { width: panel.width, right: panel.right, moreRight: more.right, scroll: document.querySelector('#tab_rank .tab-scroll-body')?.scrollWidth };
        });
        assert(Math.abs(mobile.width - desktopPanelWidth) < 2, 'the card keeps its width on a narrow window');
        assert(mobile.moreRight <= mobile.right, 'controls stay inside the card');
        assert(mobile.scroll >= 1750, 'the Rank tab scrolls sideways');
        await page.setViewport({ width: 1900, height: 1200 });
        await page.$eval('#combinedConcentrationChartPanel', el => el.scrollIntoView({ block: 'start' }));
        await page.click('#combinedConcentrationChartPanel [data-chart-mode="minute"]'); await idle();
        highValues = false;
        await page.click('#combinedConcentrationChartPanel [data-chart-mode="minute"]'); await idle();
        assert.equal(await page.$eval('#combinedConcentrationPeriod', el => el.textContent), sessionPeriod);
        const minuteDrawing = await page.evaluate(() => window.chartDrawing);
        const minuteGraph = minuteDrawing.strokes.find(stroke => stroke.color === '#339af0' && stroke.path.length > 2);
        assert.equal(minuteGraph.path.length, 97, 'bars without a ratio keep their slot but draw no line point');
        assert.equal(await page.$eval('#combinedConcentrationStatus', el => el.textContent), '시장 거래대금 10개 시점 누락 · 쏠림율 계산 불가');
        if (process.env.CHART_SCREENSHOT) await page.screenshot({ path: process.env.CHART_SCREENSHOT.replace('.png', '-mobile.png'), fullPage: false });
        await page.click('#combinedConcentrationMore'); await idle();
        await page.click('#combinedConcentrationZoomIn');
        await page.$eval('#combinedConcentrationRange', el => { el.value = '0'; el.dispatchEvent(new Event('input')); });
        const periodBeforeRefresh = await page.$eval('#combinedConcentrationPeriod', el => el.textContent);
        assert.equal(periodBeforeRefresh, '2026-10-02 09:00 — 2026-10-04 13:57 · 300 / 600봉');
        lastOverride = 45.67;
        // The browser chart cache only re-asks the server once a saved answer is a second old; the page clock is frozen, so move it.
        const tick = () => page.evaluate(() => { window.testClock += 2000; });
        await tick();
        const refreshBefore = requests.length;
        // Wait for the card to go idle instead of the refresh promise: awaiting it sometimes ended with puppeteer's "Promise was collected".
        await page.evaluate(() => { void window.refreshConcentrationChart(); }); await idle();
        const perRefresh = requests.length - refreshBefore;
        assert(perRefresh >= 1);
        assert.equal(await page.$eval('#combinedConcentrationPeriod', el => el.textContent), periodBeforeRefresh, 'refresh must retain loaded history and zoomed historical range');
        assert.equal(await page.$eval('#combinedConcentrationCurrentRate', el => el.textContent), '45.7%');
        // Since 2026-10-12 a refresh asked while one is running is kept and run once after it, not dropped:
        // three overlapping calls make two refreshes.
        await tick();
        const concurrentBefore = requests.length;
        await page.evaluate(() => { void Promise.all([window.refreshConcentrationChart(), window.refreshConcentrationChart(), window.refreshConcentrationChart()]); });
        await idle(); await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300))); await idle();
        assert.equal(requests.length, concurrentBefore + 2 * perRefresh, 'overlapping refreshes are coalesced into one more');
        fail = true;
        await tick();
        await page.evaluate(() => { void window.refreshConcentrationChart(); }); await idle();
        assert.equal(await page.$eval('#combinedConcentrationPeriod', el => el.textContent), periodBeforeRefresh, 'failed refresh must retain graph');
        assert.equal(await page.$eval('#combinedConcentrationCurrentRate', el => el.textContent), '45.7%');
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
        await tick();
        const timerBefore = requests.length;
        lastOverride = 46.12;
        await page.evaluate(() => window.rankTimer.run()); await idle();
        assert.equal(requests.length, timerBefore + perRefresh);
        assert.equal(requests.at(-1).mode, 'minute');
        assert.equal(requests.at(-1).interval, 1);
        assert.equal(await page.$eval('#combinedConcentrationCurrentRate', el => el.textContent), '46.1%');
        await page.select('#refreshInterval', '5'); await idle();
        assert.equal(await page.evaluate(() => window.rankTimer.milliseconds), 30000, 'Rank interval changes must use the new timer period');
        await page.click('#combinedConcentrationChartPanel [data-chart-mode="day"]'); await idle();
        await tick();
        const dailyTimerBefore = requests.length;
        await page.evaluate(() => window.rankTimer.run()); await idle();
        assert.equal(requests.length, dailyTimerBefore + perRefresh, 'the timer refreshes the day chart too');
        assert.equal(requests.at(-1).mode, 'day');
        await tick();
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
