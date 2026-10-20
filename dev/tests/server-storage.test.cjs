const assert = require('node:assert/strict');
const fs = require('node:fs');
const { diskSpace } = require('../../server-storage');
const { chromium } = require('playwright');

(async () => {
    const result = await diskSpace('.', async () => ({ bsize: 1024n, blocks: 100n, bavail: 35n, bfree: 40n }));
    assert.equal(result.available_bytes, 35840, 'Use space available to the server user, excluding reserved blocks');
    assert.equal(result.total_bytes, 102400);
    assert.equal(result.used_percent, 65);
    assert.ok((await diskSpace('.')).total_bytes > 0);
    await assert.rejects(diskSpace('.', async () => ({ bsize: 0n, blocks: 0n, bavail: 0n })));
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage();
        let fail = false;
        await page.route('http://storage.test/**', route => {
            if (new URL(route.request().url()).pathname === '/api/server/storage') {
                return route.fulfill({ status: fail ? 503 : 200, json: fail ? { success: false } : {
                    success: true, total_bytes: 45 * 1024 ** 3, available_bytes: 35 * 1024 ** 3,
                    used_percent: 22, checked_at: '2026-10-20T13:00:00Z'
                } });
            }
            return route.fulfill({ contentType: 'text/html', body: '<span id="serverStorage"></span><button id="bulkUpload">서버</button>' });
        });
        await page.goto('http://storage.test/');
        await page.addScriptTag({ content: fs.readFileSync('public/server-storage.js', 'utf8') });
        await page.waitForFunction(() => document.querySelector('#serverStorage').textContent.includes('35 / 45 GB'));
        assert.match(await page.locator('#serverStorage').getAttribute('title'), /사용률 22%/);
        fail = true;
        await page.evaluate(() => window.refreshServerStorage());
        assert.equal(await page.locator('#serverStorage').textContent(), '서버 용량 확인 불가');
        fail = false;
        await page.evaluate(() => window.refreshServerStorage());
        assert.equal(await page.locator('#serverStorage').textContent(), '서버 여유 35 / 45 GB');
    } finally { await browser.close(); }
    console.log('Server storage API calculation and header display checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
