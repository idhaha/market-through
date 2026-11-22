// 2026-11-22 오라클 측정(5번: 같은 과거 구간 다시): 종목 수급 · 종목 선물 수급 카드가 과거 구간의 첫 수급 응답을 받은 뒤
// 1.2초 · 1.8초 화면을 멈췄다(long-animation-frame: rank-supply-chart.js의 응답 처리). 가격 캔들은 이미 받아 두었고
// 수급 저장 시작 전 날은 건너뛰므로, 하루씩 거슬러 가는 조회가 서버를 거치지 않고 한 작업 안에서 이어지며 단계마다 바로 그렸다.
// 고친 뒤: 그리기는 다음 화면 프레임에 묶고, 건너뛴 날마다 다른 일에 차례를 넘긴다. 한 작업 안의 카드 그리기 횟수로 확인한다.
const { test } = require('node:test');
const fs = require('node:fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const iso = t => new Date(t + 9 * 3600000).toISOString();
const weekdays = (from, to) => { const r = []; for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) { const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) r.push(d.toISOString().slice(0, 10)); } return r; };
const DAYS = weekdays('2026-08-03', '2026-10-23'), TODAY = '2026-10-23', STORED_FROM = '2026-10-01';
const compact = d => d.replaceAll('-', ''), dashed = c => c.slice(0, 4) + '-' + c.slice(4, 6) + '-' + c.slice(6, 8);
const minutes = day => Array.from({ length: 692 }, (_, i) => Date.parse(day + 'T08:00:00+09:00') + i * 60000);
const bar = (t, i = 0) => ({ t, date: iso(t).slice(0, 16).replace('T', ' '), open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, market_turnover: 1e12 });
const before = day => DAYS.filter(d => d <= day).at(-1);

test('같은 과거 분봉 구간을 다시 열 때 종목 수급 카드가 한 작업 안에서 여러 번 그리지 않는다', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } }), errors = [], flow = [], candleDays = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: new Date(TODAY + 'T12:00:00+09:00') });
        const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        await page.route('http://repeat.test/**', route => {
            const u = new URL(route.request().url()), p = u.pathname, q = Object.fromEntries(u.searchParams), minute = q.mode === 'minute';
            if (!p.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: html });
            const dated = () => { const day = before(q.date || (q.cursor ? dashed(q.cursor) : TODAY)), prev = DAYS[DAYS.indexOf(day) - 1]; return { day, cursor: prev ? compact(prev) : null, has_more: !!prev }; };
            let data;
            if (p === '/api/supply/watchlist') data = { success: true, stocks: [{ code: '005930', name: '삼성전자' }], archive: [{ code: '005930', name: '삼성전자' }], revision: 1 };
            else if (minute && p === '/api/kis-supply/chart') {
                // 수급은 10/1부터 저장돼 있다(그 전 날은 available_dates에 없다).
                const d = dated(), stored = d.day >= STORED_FROM; flow.push(q.cursor || q.date || 'latest');
                data = { success: true, date: d.day, points: stored ? minutes(d.day).map((t, i) => ({ t, foreign: i, institution: -i, individual: i, program: i })) : [], cursor: d.cursor, has_more: d.has_more, available_dates: DAYS.filter(x => x >= STORED_FROM), warnings: [] };
            } else if (minute && p === '/api/supply/candles') { if (q.date) candleDays.push(q.date); const d = dated(); data = { success: true, points: minutes(d.day).map(bar), date: d.day, cursor: d.cursor, has_more: d.has_more }; }
            else if (minute && p.endsWith('market-supply/chart') || minute && p === '/api/ls-futures-test/chart') { const d = dated(); data = { success: true, date: d.day, points: [], candles: minutes(d.day).map(bar), cursor: d.cursor, has_more: d.has_more, available_dates: DAYS, warnings: [] }; }
            else if (minute && (p === '/api/ls-turnover/chart' || p === '/api/turnover/chart')) { const d = dated(); data = { success: true, markets: { kospi: minutes(d.day).map(bar), kosdaq: minutes(d.day).map(bar) }, cursor: d.cursor, has_more: d.has_more, warnings: [] }; }
            else if (minute && (p === '/api/concentration-chart' || p === '/api/ls-concentration-chart')) {
                const body = route.request().method() === 'POST' ? route.request().postDataJSON() || {} : {};
                const asked = typeof body.cursor === 'string' && body.cursor.startsWith('day:') ? dashed(body.cursor.slice(4)) : body.base_dt ? dashed(body.base_dt) : TODAY;
                const day = before(asked), prev = DAYS[DAYS.indexOf(day) - 1];
                data = { success: true, market: 'K', mode: 'minute', points: minutes(day).map((t, i) => ({ time: iso(t).slice(0, 19).replace(/[-:T]/g, ''), value: 10, stock_open: 100, stock_high: 110, stock_low: 90, stock_price: 105 })), cursor: prev ? 'day:' + compact(prev) : null, has_more: !!prev };
            }
            else if (minute) data = { success: true, market: 'K', points: [], series: [], has_more: false };
            else if (p === '/api/chart-reference' || p === '/api/adr/candles' || p === '/api/supply/candles') data = { success: true, points: DAYS.map(d => bar(Date.parse(d + 'T00:00:00+09:00'))), has_more: false };
            else if (p.endsWith('/chart') && p.includes('supply')) data = { success: true, points: DAYS.map(d => ({ t: Date.parse(d + 'T00:00:00+09:00'), foreign: 1, institution: -1, individual: 0, program: 0 })), candles: [], has_more: false, warnings: [] };
            else if (p === '/api/concentration-chart' || p === '/api/ls-concentration-chart') data = { success: true, market: 'K', points: DAYS.map(d => ({ time: compact(d), stock_open: 100, stock_high: 110, stock_low: 90, stock_price: 105, value: 10 })), has_more: false };
            else data = { success: true, series: [], points: [], markets: {}, has_more: false, warnings: [] };
            return route.fulfill({ json: data });
        });
        await page.goto('http://repeat.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}' });
        for (const f of ['rank-chart-axis.js', 'concentration-chart.js', 'rank-turnover-chart.js', 'rank-volatility-chart.js', 'rank-supply-chart.js', 'rank-market-supply-chart.js']) await page.addScriptTag({ path: 'public/' + f });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.evaluate(() => window.selectRankChartStock({ code: '005930', name: '삼성전자' }));
        await page.waitForTimeout(800);
        await page.locator('#rankTestMarketSupplyChartPanel .rank-market-choice input[value="kospi"]').check();
        // 캔들 영역을 연다(오라클 화면처럼). 구간을 채울 때 가격 캔들을 날마다 받는다.
        await page.locator('#rankCombinedSupplyChartPanel .concentration-candle-toggle').click();
        await page.waitForTimeout(800);
        // 일봉을 과거(8/17~9/25)로 확대한 채 분봉으로: 구간 보기. 처음에는 가격 캔들을 하루씩 받는다.
        const zoom = { first: '2026-08-17', last: '2026-09-25' };
        const zoomIn = () => page.evaluate(({ first, last }) => { const d = window.RankChartAxis.dailyDomain(), n = d.days.length - 1; window.RankChartAxis.selectViewport('combinedSupply', d.days.indexOf(first) / n, d.days.indexOf(last) / n); }, zoom);
        await zoomIn();
        const minuteButton = page.locator('#rankCombinedSupplyChartPanel [data-mode="minute"]');
        await minuteButton.click();
        await page.waitForTimeout(12000);
        const firstPass = await page.evaluate(() => window.getRankCombinedSupplyState().minuteDays.length);
        assert.ok(firstPass >= 15, `처음 열 때 구간의 날들을 받았다: ${firstPass}일`);
        // 2026-11-23 오라클 측정: 구간을 채울 때 주말 · 휴장일 가격 캔들까지 하루씩 0.3~0.5초씩 물어 이 카드가 가장 늦게 끝났다.
        const weekend = candleDays.filter(d => [0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()));
        assert.deepEqual(weekend, [], `주말 가격 캔들을 묻지 않는다: ${candleDays.join(',')}`);
        await page.locator('#rankCombinedSupplyChartPanel [data-mode="day"]').click();
        await page.waitForTimeout(1500);
        await zoomIn();
        await page.waitForTimeout(500);
        // 작업(task)마다 번호를 매기는 MessageChannel 고리를 돌리고, 종목 수급 카드 캔버스를 지울 때(=그릴 때)의 작업 번호를 센다.
        await page.evaluate(() => {
            window.__tick = 0; window.__draws = new Map(); window.__run = true;
            const ch = new MessageChannel(); ch.port1.onmessage = () => { window.__tick++; if (window.__run) ch.port2.postMessage(0); }; ch.port2.postMessage(0);
            const panel = document.getElementById('rankCombinedSupplyChartPanel'), clear = CanvasRenderingContext2D.prototype.clearRect;
            CanvasRenderingContext2D.prototype.clearRect = function (...a) { if (panel.contains(this.canvas)) window.__draws.set(window.__tick, (window.__draws.get(window.__tick) || 0) + 1); return clear.apply(this, a); };
        });
        flow.length = 0;
        await minuteButton.click();
        await page.waitForTimeout(8000);
        const result = await page.evaluate(() => { window.__run = false; const counts = [...window.__draws.values()]; return { max: Math.max(0, ...counts), total: counts.reduce((a, b) => a + b, 0), days: window.getRankCombinedSupplyState().minuteDays.length }; });
        assert.ok(flow.some(c => c === '20260925'), // 구간 끝 = 일봉 화면 마지막 날(2026-11-23부터 화면의 모든 날)
             `다시 열 때 구간 끝 날의 수급을 한 번 물었다: ${flow.join(',')}`);
        assert.ok(result.days >= firstPass, `다시 열어도 구간의 날들이 그대로 채워진다: ${result.days} < ${firstPass}`);
        // 캔버스 지우기 횟수(그리기 한 번에 캔버스 여러 장). 고치기 전 한 작업 안에서 186번(오라클 1~2초 멈춤), 고친 뒤 14번.
        assert.ok(result.max <= 40, `한 작업 안에서 종목 수급 카드를 ${result.max}번 그렸다(전체 ${result.total}번)`);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
