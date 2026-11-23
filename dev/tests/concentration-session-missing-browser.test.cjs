// 2026-11-24 오라클 측정: 쏠림율 1분봉 상태 문구가 늘 "시장 거래대금 N개 시점 누락 · 쏠림율 계산 불가"였다. 시장(업종지수) 거래대금은
// 정규장에만 있어 NXT 시간대(08:00~08:49, 15:31~19:59) 봉은 원래 쏠림율이 없는데 그것까지 누락으로 셌다. 서버가 그 봉에
// regular_session:false를 붙이고, 화면은 정규장 안에서 빈 분만 센다.
// 실행: node dev/tests/concentration-session-missing-browser.test.cjs
const fs = require('fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } }), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: new Date('2026-11-24T12:00:00+09:00') });
        const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        let regularGap = false;
        const bars = () => {
            const out = [];
            for (let m = 8 * 60; m < 20 * 60; m++) {
                if (m >= 8 * 60 + 50 && m < 9 * 60 || m >= 15 * 60 + 20 && m < 15 * 60 + 30) continue;
                const clock = String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0') + '00';
                const regular = m >= 9 * 60 && m <= 15 * 60 + 30;
                const value = regular && !(regularGap && m === 10 * 60) ? 1.5 : null;
                out.push({ time: '20261124' + clock, stock_open: 100, stock_high: 101, stock_low: 99, stock_price: 100, value, regular_session: regular });
            }
            return out;
        };
        await page.route('http://conc.test/**', route => {
            const u = new URL(route.request().url());
            if (u.pathname === '/api/ls-concentration-chart' || u.pathname === '/api/concentration-chart') return route.fulfill({ json: { success: true, market: 'K', mode: 'minute', points: bars(), has_more: false } });
            if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, series: [], points: [], has_more: false } });
            return route.fulfill({ contentType: 'text/html', body: html });
        });
        await page.goto('http://conc.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}' });
        for (const f of ['rank-chart-axis.js', 'concentration-chart.js']) await page.addScriptTag({ path: 'public/' + f });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.evaluate(() => window.selectRankChartStock({ code: '005930', name: '삼성전자' }));
        await page.locator('#combinedConcentrationChartPanel [data-chart-mode="minute"]').first().click();
        await page.waitForTimeout(800);
        const status = () => page.$eval('#combinedConcentrationStatus', el => el.textContent);
        assert.equal(await status(), '', `NXT 시간대 빈 봉은 누락이 아니다: "${await status()}"`);
        regularGap = true;
        await page.evaluate(() => window.refreshConcentrationChart?.());
        await page.waitForTimeout(800);
        assert.equal(await status(), '시장 거래대금 1개 시점 누락 · 쏠림율 계산 불가', '정규장 안에서 빈 분만 센다');
        assert.deepEqual(errors, []);
        console.log('쏠림율 누락 문구: NXT 시간대는 세지 않고 정규장 빈 분만 센다.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
