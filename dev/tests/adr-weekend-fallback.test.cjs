const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
    const source = fs.readFileSync('server.js', 'utf8');
    const routes = new Map();
    const now = Date.parse('2026-10-18T12:00:00+09:00');
    class TestDate extends Date { static now() { return now; } }
    let historyCalls = 0, live = false;
    const context = { app: { get: (path, handler) => routes.set(path, handler) }, Date: TestDate, console,
        adrMinuteStore: { merge: () => ({ points: [], day: null }), read: () => ({ points: [], day: null }) },
        axios: { get: async url => {
            if (url.endsWith('/today')) return { data: live ? { adr: 80, asOf: now, intraday: [{ t: now, adr: 80 }], lastClosed: null } : { adr: null, asOf: null, intraday: [], lastClosed: null, marketStatus: 'closed' } };
            historyCalls++;
            return { data: { series: [{ date: '2026-10-16', adr: 74.83 }, { date: '2026-10-15', adr: 67.42 }, { date: '2026-10-19', adr: 99 }] } };
        } }
    };
    vm.runInNewContext(source.slice(source.indexOf('const adrClosedFallbackCache'), source.indexOf('function readAuthorizedEmails()')), context);
    const request = async market => {
        const res = { status(n) { this.code = n; return this; }, set() { return this; }, json(data) { this.data = data; return this; } };
        await routes.get('/api/adr/today')({ query: { market } }, res);
        return res;
    };
    const recovered = (await request('kospi')).data;
    assert.equal(recovered.lastClosed.date, '20261016');
    assert.equal(recovered.lastClosed.adr, 74.83);
    assert.equal(recovered.intraday.length, 0, 'Daily close must never become fabricated minute data');
    await request('kospi'); assert.equal(historyCalls, 1, 'History fallback is cached');
    live = true;
    assert.equal((await request('kospi')).data.adr, 80);
    assert.equal(historyCalls, 1, 'Live data bypasses daily fallback');
    assert.equal((await request('bad')).code, 400);

    const markup = fs.readFileSync('public/index.html', 'utf8');
    const html = ['concentrationChartPanel', 'rankAdrChartPanel'].map(id => markup.match(new RegExp('<section[^>]*id="' + id + '"[\\s\\S]*?</section>'))[0]).join('');
    const browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER_PATH ? { executablePath: process.env.TEST_BROWSER_PATH } : { channel: 'msedge' }) });
    try {
        for (const seedOldSession of [false, true]) {
            const page = await browser.newPage();
            await page.route('http://adr.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
            await page.goto('http://adr.test/');
            await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') });
            await page.evaluate(({ now, recovered, seedOldSession }) => {
                Date.now = () => now;
                if (seedOldSession) localStorage.setItem('rank-adr-session:kospi', JSON.stringify({ points: [{ t: Date.parse('2026-10-15T15:30:00+09:00'), adr: 67.42 }] }));
                window.fetch = async () => new Response(JSON.stringify(recovered), { status: 200 });
            }, { now, recovered, seedOldSession });
            await page.addScriptTag({ content: fs.readFileSync('public/rank-adr-chart.js', 'utf8') });
            await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
            await page.waitForFunction(() => document.querySelector('.rank-adr-status').textContent.includes('2026-10-16'));
            assert.equal(await page.locator('#rankAdrChartPanel output').textContent(), '74.8%');
            assert.match(await page.locator('.rank-adr-status').textContent(), /분봉 기록 없음/);
            await page.close();
        }
    } finally { await browser.close(); }
    console.log('PASS ADR weekend fallback: fresh browser, stale prior session, dated close, live bypass and cache');
})().catch(error => { console.error(error); process.exitCode = 1; });
