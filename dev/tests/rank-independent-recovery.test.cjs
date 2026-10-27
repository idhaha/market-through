const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const { createRankIndependentRelay } = require('../../rank-independent');

(async () => {
    const app = express(); app.use(express.json({ limit: '5mb' }));
    let router, ticket, offline = false, recoveries = 0;
    function restart() {
        router = express.Router();
        createRankIndependentRelay({ request: async command => command.path.startsWith('/api/supply/watchlist')
            ? { success: true, revision: 0, stocks: [], archive: [] } : { success: true, points: [], has_more: false } }).mount(router);
    }
    restart();
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/rank-independent')) {
            if (offline) return res.status(503).json({ error: 'temporary outage' });
            req.authUser = req.get('X-Test-Anonymous') ? null : { email: req.get('X-Test-User') || 'owner@test' };
            if (req.path.endsWith('/recover')) recoveries++;
            const send = res.json.bind(res); res.json = value => {
                if (req.path === '/api/rank-independent' && req.method === 'POST') ticket = value;
                return send(value);
            };
            return router(req, res, next);
        }
        next();
    });
    app.get('/main', (req, res) => res.type('html').send(`<!doctype html><div id="rankIndependentControls"></div>
        <span id="lastUpdate">today</span><span id="statusText">완료</span><table><tbody id="transactionBody"><tr><td>before</td></tr></tbody></table>
        <select id="mrktTp"><option value="000">전체</option></select><select id="stexTp"><option value="3">통합</option></select><select id="refreshInterval"><option value="5">30초</option></select>
        <script>window.getRankChartState=()=>({selection:null,mode:'day',interval:1,points:[],revision:1});window.getConcentrationDisplaySettings=()=>({candleOpen:false});</script>
        <script src="/rank-independent-main.js" defer></script>`));
    app.get('/rank-independent-main.js', (req, res) => res.type('js').send(fs.readFileSync('public/rank-independent-main.js', 'utf8')
        .replace("location.href = 'marketthrough://open?url=' + encodeURIComponent(url);", 'window.testLaunchUrl = url;')));
    app.use(express.static(path.resolve('public')));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const main = await browser.newPage(), child = await browser.newPage(), errors = [];
        main.on('pageerror', e => errors.push(e.message)); child.on('pageerror', e => errors.push(e.message));
        await child.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)/,route=>route.abort());
        await main.goto(origin + '/main'); await main.getByRole('button', { name: '독립창', exact: true }).click();
        await child.goto(`${origin}/rank-independent.html#id=${ticket.id}&token=${ticket.token}`);
        await child.waitForFunction(() => document.getElementById('transactionBody').textContent.includes('before'));
        const peerCall = async body => (await fetch(`${origin}/api/rank-independent/peer/${ticket.id}`, { method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ticket.token}` }, body: JSON.stringify(body) })).json();
        const oldEpoch = (await peerCall({})).epoch;
        const retainedUrl = child.url();
        offline = true;
        await child.waitForFunction(() => document.getElementById('rankConnectionStatus').textContent.includes('재시도'));
        assert.match(await child.locator('#transactionBody').textContent(), /before/, 'Outage retains the previous display');
        await main.evaluate(() => { document.getElementById('transactionBody').innerHTML = '<tr><td>after-restart</td></tr>'; });
        restart(); offline = false;
        await child.waitForFunction(() => document.getElementById('transactionBody').textContent.includes('after-restart'), null, { timeout: 15000 });
        assert.ok(recoveries > 0); assert.equal(child.url(), retainedUrl, 'Existing independent window recovers without relaunch');
        const fresh = await peerCall({});
        assert.notEqual(fresh.epoch, oldEpoch);
        assert.ok((await peerCall({ version: fresh.version, epoch: oldEpoch })).snapshot, 'Equal version from a previous server generation still receives the new snapshot');
        await main.evaluate(() => { document.getElementById('transactionBody').innerHTML = '<tr><td>latest-update</td></tr>'; });
        await child.waitForFunction(() => document.getElementById('transactionBody').textContent.includes('latest-update'));
        const recoverPath = `${origin}/api/rank-independent/${ticket.id}/recover`;
        const body = JSON.stringify({ token: ticket.token, ownerKey: ticket.ownerKey });
        assert.equal((await fetch(recoverPath, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-User': 'other@test' }, body })).status, 403);
        assert.equal((await fetch(recoverPath, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Anonymous': '1' }, body })).status, 401);
        assert.equal((await fetch(recoverPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'bad', ownerKey: ticket.ownerKey }) })).status, 400);
        assert.deepEqual(errors, []);
        console.log('PASS outage retention, server relay restart recovery, main snapshot delivery, continued updates and recovery access checks');
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
