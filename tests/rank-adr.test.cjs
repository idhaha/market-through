const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1.5 });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        await page.route('http://adr.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto('http://adr.test/');
        await page.evaluate(() => { window.resizeErrors = []; window.addEventListener('error', event => window.resizeErrors.push(event.message)); });
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') });
        await page.evaluate(() => {
            window.requests = [];
            const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
            const t = Date.parse(`${day}T09:01:10+09:00`);
            window.fetch = async url => {
                window.requests.push(url);
                return new Response(JSON.stringify({ marketStatus: 'open', adr: url.includes('kosdaq') ? 105 : 95, asOf: t + 10000,
                    intraday: [{ t, adr: 90 }, { t: t + 2000, adr: 92 }, { t: t - 86400000, adr: 200 }] }), { status: 200 });
            };
        });
        await page.addScriptTag({ content: fs.readFileSync('public/concentration-chart.js', 'utf8') });
        await page.addScriptTag({ content: fs.readFileSync('public/rank-adr-chart.js', 'utf8') });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.waitForTimeout(100);
        await page.evaluate(() => { document.getElementById('tabContents').style.display = 'block'; });
        await page.waitForFunction(() => document.querySelector('.rank-adr-panel output').textContent === '95.00%');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage)[0])).length), 1, 'One sample per minute; previous day excluded');
        await page.selectOption('.rank-adr-panel select', 'kosdaq');
        await page.waitForFunction(() => document.querySelector('.rank-adr-panel output').textContent === '105.00%');
        assert.ok(await page.evaluate(() => window.requests.at(-1).endsWith('market=kosdaq')));
        await page.waitForTimeout(100);
        const sizes = await page.evaluate(() => ['#concentrationChartPanel', '.rank-adr-panel'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.width, r.height]; }));
        assert.deepEqual(sizes[0], sizes[1], 'Chart panels have identical dimensions');
        await page.evaluate(() => window.applyConcentrationDisplaySettings({ candleOpen: true }));
        await page.waitForTimeout(100);
        const expanded = await page.evaluate(() => ['#concentrationChartPanel', '.rank-adr-panel'].map(s => document.querySelector(s).getBoundingClientRect().height));
        assert.ok(expanded[0] > sizes[0][1], 'Candle chart expands concentration panel');
        assert.equal(expanded[1], sizes[1][1], 'ADR height stays unchanged when candle chart opens');
        await page.evaluate(() => window.applyConcentrationDisplaySettings({ candleOpen: false }));
        await page.waitForTimeout(100);
        assert.equal(await page.locator('.rank-adr-panel').evaluate(p => p.getBoundingClientRect().height), sizes[1][1]);
        assert.ok(await page.locator('.rank-adr-area canvas').evaluate(canvas => canvas.width > 0 && canvas.height >= 280), 'Canvas is visible with actual Rank markup');
        await page.setViewportSize({ width: 900, height: 700 });
        await page.waitForTimeout(200);
        await page.evaluate(() => { document.getElementById('tabContents').style.display = 'none'; });
        await page.waitForTimeout(100);
        await page.evaluate(() => { document.getElementById('tabContents').style.display = 'block'; });
        await page.waitForTimeout(200);
        assert.deepEqual(await page.evaluate(() => window.resizeErrors), [], 'Resize and hidden tab transitions do not produce observer loop errors');
        assert.deepEqual(errors, []);
        await page.evaluate(async () => {
            localStorage.clear();
            const nextDay = Date.now() + 86400000;
            Date.now = () => nextDay;
            const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
            const t = Date.parse(`${day}T09:01:00+09:00`) - 86400000;
            window.previousDay = new Date(t + 9 * 3600000).toISOString().slice(0, 10);
            window.fetch = async () => new Response(JSON.stringify({ marketStatus: 'closed', adr: null, asOf: null,
                intraday: [{ t, adr: 85 }, { t: t + 60000, adr: 86 }] }));
            await window.refreshRankAdrChart();
        });
        assert.equal(await page.locator('.rank-adr-panel output').textContent(), '86.00%');
        assert.ok((await page.locator('.rank-adr-status').textContent()).includes('직전 거래일'));
        assert.equal(await page.evaluate(() => localStorage.length), 0, 'Previous day history is fetched rather than persisted');
        await page.evaluate(async () => {
            window.fetch = async () => new Response(JSON.stringify({ marketStatus: 'closed', adr: null, intraday: [],
                lastClosed: { date: window.previousDay.replaceAll('-', ''), adr: 74.55 } }));
            await window.refreshRankAdrChart();
        });
        assert.equal(await page.locator('.rank-adr-panel output').textContent(), '86.00%');
        assert.ok((await page.locator('.rank-adr-status').textContent()).includes('직전 거래일'), 'Empty response preserves last received session');
        await page.evaluate(async () => {
            const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
            window.fetch = async () => new Response(JSON.stringify({ marketStatus: 'open', adr: 98, asOf: Date.parse(`${day}T09:00:10+09:00`), intraday: [] }));
            await window.refreshRankAdrChart();
        });
        assert.equal(await page.locator('.rank-adr-panel output').textContent(), '98.00%');
        assert.equal(await page.locator('.rank-adr-panel h2').textContent(), 'ADR · 당일 1분');
        await page.evaluate(async () => {
            const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
            window.sessionDay = day;
            const beforeMidnight = Date.parse(`${day}T23:59:00+09:00`);
            Date.now = () => beforeMidnight;
            const t = Date.parse(`${day}T15:28:00+09:00`);
            window.fetch = async () => new Response(JSON.stringify({ marketStatus: 'closed', adr: 74.55,
                asOf: Date.parse(`${day}T20:05:40+09:00`), intraday: [{ t, adr: 75 }, { t: t + 60000, adr: 74.55 }],
                lastClosed: { date: day.replaceAll('-', ''), adr: 74.55 } }));
            await window.refreshRankAdrChart();
        });
        assert.equal(await page.locator('.rank-adr-panel output').textContent(), '74.55%');
        assert.ok((await page.locator('.rank-adr-area canvas').getAttribute('aria-label')).includes('분봉 차트'), 'After close, intraday takes priority over lastClosed');
        assert.ok(!(await page.locator('.rank-adr-status').textContent()).includes('분봉 기록 없음'));
        await page.evaluate(async () => {
            const afterMidnight = Date.parse(`${window.sessionDay}T23:59:00+09:00`) + 120000;
            Date.now = () => afterMidnight;
            await window.refreshRankAdrChart();
        });
        assert.ok((await page.locator('.rank-adr-area canvas').getAttribute('aria-label')).includes('분봉 차트'), 'Available API history still displays after midnight');
        assert.ok((await page.locator('.rank-adr-status').textContent()).includes('직전 거래일'));
        console.log('PASS ADR minute merge, day filtering, market selection and equal panel sizes');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
