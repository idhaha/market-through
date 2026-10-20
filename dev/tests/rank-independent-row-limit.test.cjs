const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        let version = 1;
        await page.addInitScript(() => { window.resizeMessages = []; window.chrome ||= {}; window.chrome.webview = { postMessage: message => window.resizeMessages.push(message) }; });
        await page.route('http://rows.test/**', route => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith('/api/rank-independent/peer/')) return route.fulfill({ json: { version, replies: [], snapshot: {
                rows: Array.from({ length: 20 }, (_, i) => `<tr data-chart-code="${String(i + 1).padStart(6, '0')}"><td>${i + 1}</td><td>K</td><td>종목${i + 1} 갱신${version}</td><td>1%</td><td>100</td><td>10%</td></tr>`).join(''),
                conditions: {}, display: { candleOpen: false }
            } } });
            const file = 'public' + url.pathname;
            return route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', body: fs.readFileSync(file) });
        });
        await page.goto('http://rows.test/rank-independent.html#id=' + 'a'.repeat(32) + '&token=' + 'b'.repeat(64));
        await page.waitForFunction(() => document.querySelectorAll('#transactionBody tr').length === 20);
        const table = page.locator('#transactionTable').locator('xpath=ancestor::*[contains(@class,"panel")][1]');
        const heights = () => page.locator('#tab_rank > .panel').evaluateAll(es => es.map(el => el.getBoundingClientRect().height));
        const button = page.locator('.independent-row-limit'), initial = await heights();
        assert.equal(await page.locator('#transactionBody > tr:visible').count(), 20);
        await button.click();
        assert.equal(await page.locator('#transactionBody > tr:visible').count(), 5);
        const five = await heights();
        assert.ok(five[0] < initial[0]); assert.deepEqual(five.slice(1), initial.slice(1));
        assert.match(await button.getAttribute('title'), /5개.*10개/);
        version++;
        await page.waitForFunction(() => document.getElementById('transactionBody').textContent.includes('갱신2'));
        assert.equal(await page.locator('#transactionBody > tr:visible').count(), 5, 'Refresh preserves the limit');
        await page.locator('#tab_rank > .panel:first-child .independent-collapse').click();
        assert.equal(await button.isDisabled(), true);
        await page.locator('#tab_rank > .panel:first-child .independent-collapse').click();
        await button.click();
        assert.equal(await page.locator('#transactionBody > tr:visible').count(), 10);
        const ten = await heights(); assert.ok(ten[0] > five[0] && ten[0] < initial[0]); assert.deepEqual(ten.slice(1), initial.slice(1));
        await button.click();
        assert.equal(await page.locator('#transactionBody > tr:visible').count(), 20);
        assert.ok(Math.abs((await heights())[0] - initial[0]) < 1, 'Default restores the previous table height');
        assert.ok(await page.evaluate(() => window.resizeMessages.every(message => !message.startsWith('resize-window:') || message.startsWith('resize-window:0,'))), 'Only vertical window resizing is requested');
        assert.deepEqual(errors, []);
        console.log('PASS independent row limit: 5 → 10 → default, card fitting, other charts unchanged, refresh and fold preserved.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
