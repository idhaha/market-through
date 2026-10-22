const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 1800 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('http://resize.test/**', route => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { version: 1, replies: [], snapshot: {
                rows: Array.from({ length: 20 }, (_, i) => `<tr data-chart-code="${String(i + 1).padStart(6, '0')}"><td>${i + 1}</td><td>K</td><td>종목${i + 1}</td><td>1%</td><td>100</td><td>10%</td></tr>`).join(''), conditions: {}
            } } });
            const file = 'public' + url.pathname;
            return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file) });
        });
        await page.goto('http://resize.test/rank-independent.html#id=' + 'a'.repeat(32) + '&token=' + 'b'.repeat(64));
        await page.waitForFunction(() => document.querySelectorAll('.independent-collapse').length === 3 && document.querySelectorAll('#transactionBody tr').length === 20);
        let nativeQueue = Promise.resolve();
        const resizeMessages = [];
        let maximumHeight = 2200;
        await page.exposeFunction('resizeNative', message => {
            if (!message.startsWith('resize-window:')) return;
            resizeMessages.push(message);
            nativeQueue = nativeQueue.then(async () => {
                const [dw, dh] = message.slice(14).split(',').map(Number);
                assert.equal(dw, 0);
                await new Promise(resolve => setTimeout(resolve, 40));
                const size = page.viewportSize();
                await page.setViewportSize({ width: size.width, height: Math.max(160, Math.min(maximumHeight, size.height + dh)) });
                await page.evaluate(() => window.dispatchEvent(new Event('rank-native-resize-complete')));
            });
        });
        await page.evaluate(() => { window.chrome ||= {}; window.chrome.webview = { postMessage: message => window.resizeNative(message) }; });
        const settle = async () => {
            for (let attempt = 0; attempt < 100; attempt++) {
                const pending = nativeQueue;
                await pending;
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                await page.waitForTimeout(100);
                if (pending === nativeQueue) return;
            }
            throw new Error('Native resize queue did not settle');
        };
        const geometry = () => page.locator('#tab_rank > .panel').evaluateAll(panels => panels.map(panel => {
            const r = panel.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height };
        }));
        const compact = async () => {
            const cards = await geometry();
            for (let i = 1; i < cards.length; i++) assert.ok(Math.abs(cards[i].top - cards[i - 1].bottom - 14) < 2, `Cards must have no stale grid track: ${JSON.stringify(cards)}`);
        };
        const original = await geometry();
        const beforeRowsWindow = page.viewportSize().height;
        await page.locator('.independent-row-limit').click(); await settle();
        const fiveRows = await geometry();
        assert.ok(Math.abs(page.viewportSize().height - beforeRowsWindow - (fiveRows[0].height - original[0].height)) < 2, 'Changing row count resizes the actual window by the table height difference');
        await page.locator('.independent-row-limit').click(); await settle();
        await page.locator('.independent-row-limit').click(); await settle();
        // Change the row count while other cards are folded, then resize and unfold.
        for (const width of [1000, 320, 500, 1300]) {
            await page.setViewportSize({ width, height: 1800 }); await settle();
            await page.locator('.independent-collapse').nth(1).click(); await settle();
            await page.locator('.independent-row-limit').click(); await settle();
            await page.locator('.independent-collapse').nth(1).click(); await settle();
            await compact();
            assert.ok(await page.evaluate(() => document.body.scrollWidth <= innerWidth + 2), 'Narrow windows keep toolbar controls inside the page');
            await page.setViewportSize({ width: width - 20, height: 950 }); await settle();
            await compact();
        }
        while (await page.locator('#transactionBody').getAttribute('data-row-limit')) {
            await page.locator('.independent-row-limit').click(); await settle();
        }
        // Rapid transitions used to let an old unfold timeout clear a new fold.
        for (let round = 0; round < 5; round++) {
            await page.evaluate(() => {
                const buttons = [...document.querySelectorAll('.independent-collapse')];
                for (const i of [0, 1, 2, 2, 1, 0, 1]) buttons[i].click();
            });
            await settle();
            await compact();
            await page.locator('.independent-collapse').nth(1).click(); await settle();
            await compact();
        }
        maximumHeight = 800;
        for (let round = 0; round < 3; round++) {
            await page.evaluate(() => document.querySelectorAll('.independent-collapse').forEach(button => button.click()));
            await settle(); await compact();
            assert.ok(await page.locator('.independent-collapse').evaluateAll(buttons => buttons.every(button => { const r = button.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })), 'Every expand button remains reachable when all cards are folded');
            await page.evaluate(() => document.querySelectorAll('.independent-collapse').forEach(button => button.click()));
            await settle(); await compact();
        }
        assert.deepEqual((await geometry()).map(card => card.height), original.map(card => card.height), 'Repeated folds restore every original card height');
        maximumHeight = 1900;
        await page.setViewportSize({ width: 1000, height: 1800 }); await settle();
        for (let round = 0; round < 5; round++) {
            await page.evaluate(() => {
                const settings = getConcentrationDisplaySettings();
                applyConcentrationDisplaySettings({ ...settings, candleOpen: true });
                applyConcentrationDisplaySettings({ ...settings, candleOpen: false });
            });
            await settle();
            assert.equal(page.viewportSize().height, 1800, 'Rapid candle open/close restores actual growth at the monitor limit: ' + JSON.stringify(resizeMessages.slice(-4)));
            await compact();
        }
        assert.deepEqual(errors, []);
        console.log('PASS independent resize: row limits, narrow/wide resize, rapid folds, monitor limits, all-folded controls and stable card geometry');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
