// 2026-11-22 오라클 측정(3번: 과거 구간 처음): 시장 거래대금 · 시장 수급 카드의 응답 처리가 각각 2.1초 · 1.3초였다.
// 과거 구간에서 하루씩 받을 때마다 받아 둔 모든 쪽을 다시 합치고 정렬했고, 쪽마다 카드를 바로 2~3번씩 그렸다.
// 고친 뒤: 더 과거 쪽은 앞에 붙이고(겹치면 예전처럼 합침), 조회 중 그리기는 다음 화면 프레임에 묶는다.
// 받은 자료가 빠짐없이 시각순으로 들어가는지와, 한 작업 안에서 카드를 몇 번 그리는지 센다.
const { test } = require('node:test');
const fs = require('node:fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const iso = t => new Date(t + 9 * 3600000).toISOString();
const weekdays = (from, to) => { const r = []; for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) { const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) r.push(d.toISOString().slice(0, 10)); } return r; };
const DAYS = weekdays('2026-08-03', '2026-10-23'), TODAY = '2026-10-23', STORED_FROM = '2026-10-01';
const compact = d => d.replaceAll('-', ''), dashed = c => c.slice(0, 4) + '-' + c.slice(4, 6) + '-' + c.slice(6, 8);
const minutes = day => Array.from({ length: 692 }, (_, i) => Date.parse(day + 'T08:00:00+09:00') + i * 60000);
const bar = (t, i = 0) => ({ t, date: iso(t).slice(0, 16).replace('T', ' '), open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, market_turnover: 1e12 });
const TURNOVER_MAX = 8, MARKET_MAX = 10; // 캔버스 지우기 횟수: 고치기 전 12번 · 14번, 고친 뒤 4번 · 7번
const before = day => DAYS.filter(d => d <= day).at(-1);

test('과거 분봉 구간에서 시장 거래대금 · 시장 수급 카드가 하루씩 받은 쪽을 빠짐없이 합치고 쪽마다 여러 번 그리지 않는다', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } }), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: new Date(TODAY + 'T12:00:00+09:00') });
        const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        await page.route('http://window2.test/**', route => {
            const u = new URL(route.request().url()), p = u.pathname, q = Object.fromEntries(u.searchParams), minute = q.mode === 'minute';
            if (!p.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: html });
            const dated = () => { const day = before(q.date || (q.cursor ? dashed(q.cursor) : TODAY)), prev = DAYS[DAYS.indexOf(day) - 1]; return { day, cursor: prev ? compact(prev) : null, has_more: !!prev }; };
            const dayBar = d => bar(Date.parse(d + 'T00:00:00+09:00'));
            let data;
            if (p === '/api/supply/watchlist') data = { success: true, stocks: [{ code: '005930', name: '삼성전자' }], archive: [{ code: '005930', name: '삼성전자' }], revision: 1 };
            else if (minute && (p.endsWith('market-supply/chart') || p === '/api/ls-futures-test/chart')) { const d = dated(); data = { success: true, date: d.day, points: minutes(d.day).map((t, i) => ({ t, foreign: i, institution: -i, individual: i, program: i })), candles: [], cursor: d.cursor, has_more: d.has_more, available_dates: DAYS, warnings: [] }; }
            else if (minute && (p === '/api/ls-turnover/chart' || p === '/api/turnover/chart')) { const d = dated(); data = { success: true, markets: { kospi: minutes(d.day).map(bar), kosdaq: minutes(d.day).map(bar) }, cursor: d.cursor, has_more: d.has_more, warnings: [] }; }
            else if (minute && (p === '/api/kis-supply/chart' || p === '/api/supply/candles')) { const d = dated(); data = { success: true, date: d.day, points: [], cursor: d.cursor, has_more: d.has_more, available_dates: DAYS, warnings: [] }; }
            else if (minute) data = { success: true, market: 'K', points: [], series: [], has_more: false };
            else if (p === '/api/chart-reference' || p === '/api/adr/candles' || p === '/api/supply/candles') data = { success: true, points: DAYS.map(dayBar), has_more: false };
            else if (p.endsWith('/chart') && p.includes('supply')) data = { success: true, points: DAYS.map(d => ({ t: Date.parse(d + 'T00:00:00+09:00'), foreign: 1, institution: -1, individual: 0, program: 0 })), candles: [], has_more: false, warnings: [] };
            else if (p === '/api/concentration-chart' || p === '/api/ls-concentration-chart') data = { success: true, market: 'K', points: DAYS.map(d => ({ time: compact(d), stock_open: 100, stock_high: 110, stock_low: 90, stock_price: 105, value: 10 })), has_more: false };
            else if (p.endsWith('turnover/chart')) data = { success: true, markets: { kospi: DAYS.map(dayBar), kosdaq: DAYS.map(dayBar) }, has_more: false, warnings: [] };
            else data = { success: true, series: [], points: [], markets: {}, has_more: false, warnings: [] };
            return route.fulfill({ json: data });
        });
        await page.goto('http://window2.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}' });
        for (const f of ['rank-chart-axis.js', 'concentration-chart.js', 'rank-turnover-chart.js', 'rank-volatility-chart.js', 'rank-supply-chart.js', 'rank-market-supply-chart.js']) await page.addScriptTag({ path: 'public/' + f });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.evaluate(() => window.selectRankChartStock({ code: '005930', name: '삼성전자' }));
        await page.locator('#rankTestMarketSupplyChartPanel .rank-market-choice input[value="kospi"]').check();
        await page.waitForTimeout(800);
        // 일봉을 과거(8/17~9/25)로 확대한 채 분봉으로: 과거 구간 보기. 카드는 구간의 날을 하루씩 받는다.
        const zoom = { first: '2026-08-17', last: '2026-09-25' };
        await page.evaluate(({ first, last }) => { const d = window.RankChartAxis.dailyDomain(), n = d.days.length - 1; window.RankChartAxis.selectViewport('combinedSupply', d.days.indexOf(first) / n, d.days.indexOf(last) / n); }, zoom);
        // 작업(task)마다 번호를 매기는 MessageChannel 고리를 돌리고, 두 카드의 캔버스를 지울 때(=그릴 때)의 작업 번호를 센다.
        await page.evaluate(() => {
            window.__tick = 0; window.__draws = { turnover: new Map(), market: new Map() }; window.__run = true;
            const ch = new MessageChannel(); ch.port1.onmessage = () => { window.__tick++; if (window.__run) ch.port2.postMessage(0); }; ch.port2.postMessage(0);
            const panels = { turnover: document.getElementById('rankCombinedTurnoverChartPanel'), market: document.getElementById('rankTestMarketSupplyChartPanel') }, clear = CanvasRenderingContext2D.prototype.clearRect;
            CanvasRenderingContext2D.prototype.clearRect = function (...a) { for (const [k, panel] of Object.entries(panels)) if (panel?.contains(this.canvas)) window.__draws[k].set(window.__tick, (window.__draws[k].get(window.__tick) || 0) + 1); return clear.apply(this, a); };
        });
        await page.locator('#rankCombinedSupplyChartPanel [data-mode="minute"]').click();
        await page.waitForTimeout(12000);
        const result = await page.evaluate(() => {
            window.__run = false;
            const s = window.getRankCombinedTurnoverState(), check = list => list.every((p, i) => !i || list[i - 1].t < p.t);
            const days = list => [...new Set(list.map(p => window.RankChartAxis.kstDay(p.t)))];
            const max = m => Math.max(0, ...m.values()), total = m => [...m.values()].reduce((a, b) => a + b, 0);
            return { kospi: s.markets.kospi.length, sortedKospi: check(s.markets.kospi), sortedKosdaq: check(s.markets.kosdaq), turnoverDays: days(s.markets.kospi),
                window: window.RankChartAxis.minuteWindow(), market: window.getTestMarketSupplyCandleDiagnostics?.(),
                draws: { turnover: [max(window.__draws.turnover), total(window.__draws.turnover)], market: [max(window.__draws.market), total(window.__draws.market)] } };
        });
        const expectedDays = DAYS.filter(d => d >= result.window.from && d <= result.window.to);
        assert.ok(expectedDays.length >= 15, `구간 보기: ${JSON.stringify(result.window)}`);
        assert.ok(result.sortedKospi && result.sortedKosdaq, '시장 거래대금이 시각순이고 겹치지 않는다');
        for (const day of expectedDays) assert.ok(result.turnoverDays.includes(day), `시장 거래대금에 ${day}가 있다: ${result.turnoverDays.join(',')}`);
        assert.equal(result.kospi % 692, 0, `하루 692봉씩 빠짐없이: ${result.kospi}`);
        assert.ok(result.market?.points >= expectedDays.length * 692, `시장 수급이 구간의 날들을 모두 담는다: ${JSON.stringify(result.market)}`);
        assert.ok(result.draws.turnover[0] <= TURNOVER_MAX, `한 작업 안에서 시장 거래대금 카드를 ${result.draws.turnover[0]}번 그렸다(전체 ${result.draws.turnover[1]}번)`);
        assert.ok(result.draws.market[0] <= MARKET_MAX, `한 작업 안에서 시장 수급 카드를 ${result.draws.market[0]}번 그렸다(전체 ${result.draws.market[1]}번)`);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
