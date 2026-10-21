// Manual integration check: node dev/tests/toss-calendar-browser.cjs
// Uses live Toss assets and an isolated, loopback-only proxy (no app data).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const axios = require('axios');
const { chromium } = require('playwright');

(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        const send = res.send.bind(res);
        res.send = body => {
            if (/\/pages\/calendar-.*\.js/.test(req.path) && typeof body === 'string') {
                body = body.replace('onClickCapture:event=>{const button=', 'onClickCapture:event=>{window.__countryCaptureCount=(window.__countryCaptureCount||0)+1;const button=');
                // The injected handler must work when the original country
                // onValueChange path does nothing, through every React render.
                body = body.replace(/onValueChange:e=>\{\w+\(e\),requestAnimationFrame\(\(\)=>\{\w+\(\w+\)\}\)\},children:Object\.entries\(Q\.TP\)/, 'onValueChange:()=>{},children:Object.entries(Q.TP)');
            }
            return send(body);
        };
        next();
    });
    const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
    vm.runInNewContext(source.slice(source.indexOf("app.get(['/api/toss_calendar'"), source.indexOf("app.get('/api/risk/volatility'")), {
        app: {
            get: (route, handler) => app.get(Object.prototype.toString.call(route) === '[object RegExp]' ? new RegExp(route.source, route.flags) : route, handler),
            all: (route, handler) => app.all(route, handler)
        },
        axios, URL, Buffer, getSessionFromRequest: () => true,
        console: { log() {}, info() {}, warn: console.warn, error: console.error }
    });
    app.get('/embed', (_req, res) => res.send('<iframe src="/calendar" style="width:1158px;height:798px;border:0"></iframe>'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        for (let round = 0; round < 3; round++) {
            const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
            await page.goto(`http://127.0.0.1:${server.address().port}/embed`);
            const frame = page.frameLocator('iframe');
            const group = frame.getByRole('radiogroup').filter({ has: frame.getByRole('radio', { name: '국내', exact: true }) });
            await group.waitFor();
            for (const name of ['국내', '전체', '해외', '국내', '해외', '전체']) {
                const connected = await group.evaluate(element => {
                    const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps'));
                    const props = element[propsKey];
                    if (typeof props?.onClickCapture !== 'function') return false;
                    window.__countryCaptureCount = 0;
                    return true;
                });
                assert.equal(connected, true, 'country capture handler must reach the real DOM');
                const radio = group.getByRole('radio', { name, exact: true });
                await radio.locator('span').last().click();
                await radio.and(frame.locator('[aria-checked="true"]')).waitFor({ timeout: 3000 });
                assert.equal(await group.evaluate(() => window.__countryCaptureCount), 1);
                console.log(`One label click selected ${name}, using the added DOM handler`);
            }
            assert.equal(await group.locator('[aria-checked="true"]').count(), 1);
            await page.close();
        }
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
