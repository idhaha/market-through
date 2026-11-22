// 2026-11-22 오라클 측정: 과거 구간(7~8월)에서 한투 종목수급 · 종목 선물 수급 카드가 수급 저장 시작 전 날까지 하루씩
// 1~3초씩 22번 물었다. 응답의 available_dates 첫 날보다 이른 날은 묻지 않고 빈 날로 넘긴다(가격 캔들은 그대로 받는다).
const { test } = require('node:test');
const fs = require('node:fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const pad = n => String(n).padStart(2, '0');
const bars = day => { const out = []; for (let m = 9 * 60; m < 15 * 60 + 30; m += 30) out.push(`${day}${pad(Math.floor(m / 60))}${pad(m % 60)}00`); return out; };
const ALL = ['20261113', '20261116', '20261117', '20261118', '20261119', '20261120'], STORED = ['20261118', '20261119', '20261120'];
const kst = s => Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00+09:00`);
const dashed = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;

test('종목 수급 1분봉 더 불러오기: 저장 시작 전 날은 한투 수급을 묻지 않고, 가격 캔들은 계속 받는다', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } }), errors = [], flow = [], candles = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: new Date('2026-11-22T20:00:00+09:00') });
        const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        await page.route('http://minute.test/**', route => {
            const u = new URL(route.request().url()); let data;
            if (u.pathname === '/api/kis-supply/chart' && u.searchParams.get('mode') === 'minute') {
                const c = u.searchParams.get('cursor') || u.searchParams.get('date')?.replaceAll('-', '') || '';
                flow.push(c || 'latest');
                const day = c ? (STORED.includes(c) ? c : STORED.filter(d => d <= c).at(-1) || c) : STORED.at(-1), prev = STORED.filter(d => d < day).at(-1);
                data = { success: true, mode: 'minute', date: dashed(day), available_dates: STORED.map(dashed), points: STORED.includes(day) ? bars(day).map((t, i) => ({ t: kst(t), foreign: i, institution: -i, program: i })) : [],
                    has_more: !!prev, cursor: prev || null, warnings: [] };
            } else if (u.pathname === '/api/supply/candles') {
                const date = (u.searchParams.get('date') || '').replaceAll('-', ''), day = date || ALL.at(-1), prev = ALL.filter(d => d < day).at(-1);
                candles.push(day);
                data = { success: true, date: dashed(day), points: (ALL.includes(day) ? bars(day) : []).map(t => ({ t: kst(t), open: 100, high: 103, low: 98, close: 101 })), has_more: !!prev, cursor: prev || null };
            } else if (u.pathname === '/api/supply/watchlist') data = { success: true, stocks: [{ code: '005930', name: '삼성전자' }], archive: [{ code: '005930', name: '삼성전자' }], revision: 1 };
            else if (u.pathname.startsWith('/api/')) data = { success: true, series: [], points: [], markets: {}, has_more: false, warnings: [] };
            if (data) return route.fulfill({ json: data });
            return route.fulfill({ contentType: 'text/html', body: html });
        });
        await page.goto('http://minute.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}' });
        for (const f of ['rank-chart-axis.js', 'concentration-chart.js', 'rank-turnover-chart.js', 'rank-volatility-chart.js', 'rank-supply-chart.js', 'rank-market-supply-chart.js']) await page.addScriptTag({ path: 'public/' + f });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.evaluate(() => window.selectRankChartStock({ code: '005930', name: '삼성전자' }));
        await page.locator('#rankCombinedSupplyChartPanel [data-mode="minute"]').click();
        await page.waitForTimeout(800);
        for (let i = 0; i < 4; i++) { await page.evaluate(() => window.RankChartAxis.requestHistory('minute')); await page.waitForTimeout(600); }
        const early = flow.filter(c => c !== 'latest' && c < STORED[0]);
        assert.deepEqual(early, [], `저장 시작(${STORED[0]}) 전 날을 물었다: ${flow.join(',')}`);
        assert.ok(candles.includes('20261117'), `가격 캔들은 저장 시작 전 날도 받는다: ${candles.join(',')}`);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
