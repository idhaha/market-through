// 2026-11-23 오라클 측정(3번: 과거 구간 처음): 종목 선물 수급 카드가 지난날 가격 캔들(한투, 하루 약 4초)을 하루씩 차례로 받아
// 31일 구간에 약 125초 걸렸다. 사용자 결정: 2~3일씩 함께 받는다. 캔들 응답을 0.4초 늦게 주고, 동시에 처리 중인 캔들 요청 수와
// 구간을 다 채우는 데 걸린 시간을 본다.
const { test } = require('node:test');
const fs = require('node:fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const iso = t => new Date(t + 9 * 3600000).toISOString();
const weekdays = (from, to) => { const r = []; for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) { const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) r.push(d.toISOString().slice(0, 10)); } return r; };
const DAYS = weekdays('2026-08-03', '2026-10-23'), TODAY = '2026-10-23', FLOW_FROM = '2026-08-03';
const compact = d => d.replaceAll('-', ''), dashed = c => c.slice(0, 4) + '-' + c.slice(4, 6) + '-' + c.slice(6, 8);
const minutes = (day, n = 692, from = '08:00') => Array.from({ length: n }, (_, i) => Date.parse(`${day}T${from}:00+09:00`) + i * 60000);
const bar = (t, i = 0) => ({ t, date: iso(t).slice(0, 16).replace('T', ' '), open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, market_turnover: 1e12 });
const before = day => DAYS.filter(d => d <= day).at(-1);

test('과거 구간에서 종목 선물 가격 캔들을 3일씩 함께 받는다', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } }), errors = [], candleDays = [];
        let active = 0, peak = 0;
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: new Date(TODAY + 'T12:00:00+09:00') });
        await page.clock.resume?.();
        const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        await page.route('http://futures-candles.test/**', async route => {
            const u = new URL(route.request().url()), p = u.pathname, q = Object.fromEntries(u.searchParams), minute = q.mode === 'minute';
            if (!p.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: html });
            const dated = () => { const day = before(q.date || (q.cursor ? dashed(q.cursor) : TODAY)), prev = DAYS[DAYS.indexOf(day) - 1]; return { day, cursor: prev ? compact(prev) : null, has_more: !!prev }; };
            let data;
            if (p === '/api/supply/watchlist') data = { success: true, stocks: [{ code: '005930', name: '삼성전자' }], archive: [{ code: '005930', name: '삼성전자' }], revision: 1 };
            else if (minute && p === '/api/ls-stock-futures/candles') {
                candleDays.push(q.date || 'latest'); active++; peak = Math.max(peak, active);
                await new Promise(resolve => setTimeout(resolve, 400));
                active--;
                const day = q.date || TODAY;
                data = { success: true, mode: 'minute', date: day, points: minutes(day, 420, '08:45').map(bar), has_more: false };
            } else if (minute && p === '/api/ls-stock-futures/chart') {
                // 선물 수급은 10/15부터 저장돼 있다. 그 전 날은 available_dates에 없어 화면이 묻지 않고 건너뛴다.
                const d = dated(), stored = d.day >= FLOW_FROM;
                data = { success: true, mode: 'minute', date: d.day, multiplier: 10, points: stored ? minutes(d.day, 420, '08:45').map((t, i) => ({ t, individual: i, foreign: -i, institution: 1 })) : [], cursor: d.cursor, has_more: d.has_more, available_dates: DAYS.filter(x => x >= FLOW_FROM), warnings: [], status: { error: '' } };
            } else if (minute && p === '/api/kis-supply/chart') { const d = dated(); data = { success: true, date: d.day, points: [], cursor: d.cursor, has_more: d.has_more, available_dates: DAYS.filter(x => x >= FLOW_FROM), warnings: [] }; }
            else if (minute && p === '/api/supply/candles') { const d = dated(); data = { success: true, points: minutes(d.day).map(bar), date: d.day, cursor: d.cursor, has_more: d.has_more }; }
            else if (minute) data = { success: true, market: 'K', points: [], series: [], markets: {}, has_more: false, warnings: [] };
            else if (p === '/api/chart-reference' || p === '/api/adr/candles' || p === '/api/supply/candles' || p === '/api/ls-stock-futures/candles') data = { success: true, points: DAYS.map(d => bar(Date.parse(d + 'T00:00:00+09:00'))), has_more: false };
            else if (p.endsWith('/chart') && p.includes('supply') || p === '/api/ls-stock-futures/chart') data = { success: true, points: DAYS.map(d => ({ t: Date.parse(d + 'T00:00:00+09:00'), foreign: 1, institution: -1, individual: 0, program: 0 })), candles: [], has_more: false, warnings: [] };
            else data = { success: true, series: [], points: [], markets: {}, has_more: false, warnings: [] };
            return route.fulfill({ json: data }).catch(() => {});
        });
        await page.goto('http://futures-candles.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}' });
        for (const f of ['rank-chart-axis.js', 'concentration-chart.js', 'rank-turnover-chart.js', 'rank-volatility-chart.js', 'rank-supply-chart.js', 'rank-market-supply-chart.js']) await page.addScriptTag({ path: 'public/' + f });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.evaluate(() => window.selectRankChartStock({ code: '005930', name: '삼성전자' }));
        await page.waitForTimeout(1500);
        // 일봉을 과거(8/17~9/25)로 확대한 채 분봉으로: 구간 보기.
        await page.evaluate(() => { const d = window.RankChartAxis.dailyDomain(), n = d.days.length - 1; window.RankChartAxis.selectViewport('futuresSupply', d.days.indexOf('2026-08-17') / n, d.days.indexOf('2026-09-25') / n); });
        candleDays.length = 0; peak = 0;
        const started = Date.now();
        await page.locator('#rankFuturesSupplyChartPanel [data-mode="minute"]').click();
        const window_ = await page.evaluate(() => window.RankChartAxis.minuteWindow());
        const want = DAYS.filter(d => d >= window_.from && d <= window_.to);
        // 구간의 모든 날 캔들이 다 들어올 때까지 기다린다(하루씩이면 0.4초 × 날 수).
        for (let i = 0; i < 120; i++) { if (want.every(d => candleDays.includes(d)) && !(await page.evaluate(() => window.getRankFuturesSupplyState().minuteDays.length < 1))) break; await page.waitForTimeout(250); }
        const took = Date.now() - started; if (process.env.DEBUG) console.log(JSON.stringify({ window_, candleDays, peak, took, days: await page.evaluate(() => window.getRankFuturesSupplyState().minuteDays) }));
        assert.ok(want.every(d => candleDays.includes(d)), `구간의 날을 모두 받는다: ${want.filter(d => !candleDays.includes(d)).join(',')}`);
        assert.ok(peak >= 2 && peak <= 3, `캔들은 2~3일씩 함께 묻는다(동시 ${peak})`);
        assert.ok(took < want.length * 400 * 0.75, `하루씩보다 빨리 채운다: ${took}ms · ${want.length}일`);
        assert.equal(new Set(candleDays.filter(d => d !== 'latest')).size, candleDays.filter(d => d !== 'latest').length, `같은 날을 두 번 묻지 않는다: ${candleDays.join(',')}`);
        assert.deepEqual(candleDays.filter(d => d !== 'latest' && [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())), [], '주말은 묻지 않는다');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
