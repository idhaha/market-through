// 2026-11-22: 브라우저 캐시가 시장 수급 경로(현물 키움 · 선물 한투 · 일봉 LS)의 갱신을 알리면, 지금 화면의 시장 수급 카드 두 장을
// 다시 받게 한다. 예전엔 없어진 단독 · 통합 카드 함수로 연결돼 있어 서버 과거 자료가 바뀌어도 두 카드는 새로 받지 않았다.
const { test } = require('node:test');
const fs = require('node:fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');

test('시장 수급 경로가 갱신되면 시장 수급 카드 두 장을 다시 받는다', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.route('https://cache-refresh.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>t</title>' }));
        await page.goto('https://cache-refresh.test/');
        await page.addScriptTag({ content: fs.readFileSync('public/rank-chart-cache.js', 'utf8') });
        for (const path of ['/api/kiwoom-market-supply/chart', '/api/ls-market-supply/chart', '/api/market-supply/chart']) {
            const calls = await page.evaluate(async path => {
                const calls = [];
                window.refreshRankTestMarketSupplyChart = () => calls.push('위');
                window.refreshRankTestMarketSupplySecondaryChart = () => calls.push('아래');
                document.dispatchEvent(new CustomEvent('rank-chart-cache-updated', { detail: { path, mode: 'minute' } }));
                await new Promise(r => setTimeout(r, 250));
                return calls.sort();
            }, path);
            assert.deepEqual(calls, ['아래', '위'], path);
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
