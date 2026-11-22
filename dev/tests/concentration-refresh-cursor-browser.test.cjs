// 2026-11-23 오라클 측정(4번: 과거 구간에서 더 불러오기): 쏠림율(LS)이 한 날(7/29)만 더 받으면 되는데 구간 11쪽(8/27~7/29)을 다시 받았다.
// 과거 구간을 다 채운 뒤 자동 갱신이 첫 쪽만 다시 받으면서, 다음 쪽 커서를 첫 쪽의 커서(구간 끝 날짜)로 되돌렸다.
// 고친 뒤: 이미 더 과거 쪽까지 받아 두었으면 갱신이 커서를 되돌리지 않는다.
const { test } = require('node:test');
const fs = require('node:fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const iso = t => new Date(t + 9 * 3600000).toISOString();
const weekdays = (from, to) => { const r = []; for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) { const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) r.push(d.toISOString().slice(0, 10)); } return r; };
const DAYS = weekdays('2026-08-03', '2026-10-23'), TODAY = '2026-10-23', STORED_FROM = '2026-10-01';
const compact = d => d.replaceAll('-', ''), dashed = c => c.slice(0, 4) + '-' + c.slice(4, 6) + '-' + c.slice(6, 8);
const minutes = day => Array.from({ length: 692 }, (_, i) => Date.parse(day + 'T08:00:00+09:00') + i * 60000);
const bar = (t, i = 0) => ({ t, date: iso(t).slice(0, 16).replace('T', ' '), open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, market_turnover: 1e12 });
const before = day => DAYS.filter(d => d <= day).at(-1);

test('과거 구간을 채운 뒤 쏠림율 자동 갱신이 더 불러오기 커서를 구간 끝으로 되돌리지 않는다', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } }), errors = [], conc = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: new Date(TODAY + 'T12:00:00+09:00') });
        const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        await page.route('http://conc.test/**', route => {
            const u = new URL(route.request().url()), p = u.pathname, body = route.request().method() === 'POST' ? route.request().postDataJSON() || {} : {}, q = { ...Object.fromEntries(u.searchParams), ...body }, minute = q.mode === 'minute';
            if (!p.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: html });
            const dayBar = d => bar(Date.parse(d + 'T00:00:00+09:00'));
            let data;
            if (p === '/api/supply/watchlist') data = { success: true, stocks: [{ code: '005930', name: '삼성전자' }], archive: [{ code: '005930', name: '삼성전자' }], revision: 1 };
            else if (minute && (p === '/api/concentration-chart' || p === '/api/ls-concentration-chart')) {
                // 날짜 커서(day:YYYYMMDD, 그날 포함) · base_dt(그날). 다음 쪽 커서는 그 전 거래일.
                const asked = typeof q.cursor === 'string' && q.cursor.startsWith('day:') ? dashed(q.cursor.slice(4)) : q.base_dt ? dashed(q.base_dt) : TODAY;
                const day = before(asked), prev = DAYS[DAYS.indexOf(day) - 1];
                if (p === '/api/ls-concentration-chart') conc.push(q.cursor || (q.base_dt ? 'base:' + q.base_dt : 'first'));
                data = { success: true, market: 'K', mode: 'minute', points: minutes(day).map((t, i) => ({ time: iso(t).slice(0, 19).replace(/[-:T]/g, ''), value: 10 + i / 100, stock_open: 100, stock_high: 110, stock_low: 90, stock_price: 105 })), cursor: prev ? 'day:' + compact(prev) : null, has_more: !!prev };
            }
            else if (minute) { const day = before(q.date || (q.cursor ? dashed(q.cursor) : TODAY)), prev = DAYS[DAYS.indexOf(day) - 1]; data = { success: true, date: day, points: [], candles: [], markets: { kospi: [], kosdaq: [] }, cursor: prev ? compact(prev) : null, has_more: !!prev, available_dates: DAYS, warnings: [] }; }
            else if (p === '/api/chart-reference' || p === '/api/adr/candles' || p === '/api/supply/candles') data = { success: true, points: DAYS.map(dayBar), has_more: false };
            else if (p.endsWith('/chart') && p.includes('supply')) data = { success: true, points: DAYS.map(d => ({ t: Date.parse(d + 'T00:00:00+09:00'), foreign: 1, institution: -1, individual: 0, program: 0 })), candles: [], has_more: false, warnings: [] };
            else if (p === '/api/concentration-chart' || p === '/api/ls-concentration-chart') data = { success: true, market: 'K', points: DAYS.map(d => ({ time: compact(d), stock_open: 100, stock_high: 110, stock_low: 90, stock_price: 105, value: 10 })), has_more: false };
            else if (p.endsWith('turnover/chart')) data = { success: true, markets: { kospi: DAYS.map(dayBar), kosdaq: DAYS.map(dayBar) }, has_more: false, warnings: [] };
            else data = { success: true, series: [], points: [], markets: {}, has_more: false, warnings: [] };
            return route.fulfill({ json: data });
        });
        await page.goto('http://conc.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}' });
        for (const f of ['rank-chart-axis.js', 'concentration-chart.js', 'rank-turnover-chart.js', 'rank-volatility-chart.js', 'rank-supply-chart.js', 'rank-market-supply-chart.js']) await page.addScriptTag({ path: 'public/' + f });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.evaluate(() => window.selectRankChartStock({ code: '005930', name: '삼성전자' }));
        await page.waitForTimeout(800);
        const zoom = { first: '2026-08-17', last: '2026-09-25' };
        await page.evaluate(({ first, last }) => { const d = window.RankChartAxis.dailyDomain(), n = d.days.length - 1; window.RankChartAxis.selectViewport('combinedSupply', d.days.indexOf(first) / n, d.days.indexOf(last) / n); }, zoom);
        await page.locator('#rankCombinedSupplyChartPanel [data-mode="minute"]').click();
        await page.waitForTimeout(8000);
        const filled = await page.evaluate(() => ({ cursor: window.getRankChartState().cursor, first: window.getRankChartState().points[0]?.time, window: window.RankChartAxis.minuteWindow() }));
        assert.ok(filled.first && filled.first.slice(0, 8) <= compact(filled.window.from), `구간 첫날까지 받았다: ${JSON.stringify(filled)}`);
        await page.evaluate(() => window.refreshConcentrationChart());
        await page.waitForTimeout(1500);
        const after = await page.evaluate(() => window.getRankChartState().cursor);
        assert.equal(after, filled.cursor, `갱신 뒤에도 다음 쪽 커서가 구간 첫날 앞이어야 한다(갱신 전 ${filled.cursor}, 받은 쪽 ${conc.join(',')})`);
        conc.length = 0;
        await page.evaluate(() => window.RankChartAxis.requestHistory('minute'));
        await page.waitForTimeout(3000);
        assert.ok(conc.length <= 2, `더 불러오기는 한두 쪽만 받는다: ${conc.join(',')}`);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
