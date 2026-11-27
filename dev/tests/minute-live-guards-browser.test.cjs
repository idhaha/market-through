// 2026-11-27 오라클 장중 측정(09:57)에서 본 다섯 가지를 고친 것을 확인한다.
// 1) 과거 구간 보기인데 종목 선물 · 종목 수급 카드가 오늘 분봉 캔들을 받았다(증권사 1~3.3초).
// 2) 과거 구간에서 더 불러오기를 하면 종목 선물 수급이 오늘(11/26)부터 하루씩 40쪽을 거슬러 갔다.
//    원인: 장중엔 캐시가 뒤에서 다시 받은 오늘 자료가 늘 바뀌어 카드에 알리고, 카드가 구간으로 가던 조회를 끊고 오늘부터 다시 받았다.
// 3) 10거래일 실시간 구간에서 1분마다 갱신할 때 지난 10일 수급을 다시 받았다.
// 4) 당일 분봉에서 ADR · 지수 선물 캔들을 오늘만 물었다가 취소하고 전날부터 다시 물었다.
// 5) 쏠림율이 아직 모으는 중인 최근 1~2분을 "시점 누락"으로 띄웠다.
// 실행: node --test dev/tests/minute-live-guards-browser.test.cjs
const { test } = require('node:test');
const fs = require('node:fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const iso = t => new Date(t + 9 * 3600000).toISOString();
const weekdays = (from, to) => { const r = []; for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) { const d = new Date(t); if (![0, 6].includes(d.getUTCDay())) r.push(d.toISOString().slice(0, 10)); } return r; };
const DAYS = weekdays('2026-08-03', '2026-10-23'), TODAY = '2026-10-23';
// 종목 선물 수급은 10/05부터 저장돼 있다(오라클도 과거 구간보다 최근부터만 있다).
const FLOW_FROM = '2026-10-05';
const compact = d => d.replaceAll('-', ''), dashed = c => c.slice(0, 4) + '-' + c.slice(4, 6) + '-' + c.slice(6, 8);
const minutes = (day, n = 692, from = '08:00') => Array.from({ length: n }, (_, i) => Date.parse(`${day}T${from}:00+09:00`) + i * 60000);
const bar = (t, i = 0) => ({ t, date: iso(t).slice(0, 16).replace('T', ' '), open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, market_turnover: 1e12 });
const before = day => DAYS.filter(d => d <= day).at(-1);
let dropArchive = false;

async function openPage(log, delay = 0) {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } }), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date(TODAY + 'T12:00:00+09:00') });
    await page.clock.resume?.();
    const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
    await page.route('http://live-guards.test/**', async route => {
        const u = new URL(route.request().url()), p = u.pathname, q = Object.fromEntries(u.searchParams), minute = q.mode === 'minute';
        if (!p.startsWith('/api/')) return route.fulfill({ contentType: 'text/html', body: html });
        log.push(p + u.search);
        const dated = () => { const day = before(q.date || (q.cursor ? dashed(q.cursor) : TODAY)), prev = DAYS[DAYS.indexOf(day) - 1]; return { day, cursor: prev ? compact(prev) : null, has_more: !!prev }; };
        if (delay && minute) await new Promise(resolve => setTimeout(resolve, delay));
        let data;
        if (p === '/api/supply/watchlist') data = { success: true, stocks: [{ code: '005930', name: '삼성전자' }], archive: dropArchive ? [] : [{ code: '005930', name: '삼성전자' }], revision: 1 };
        else if (minute && p === '/api/ls-stock-futures/candles') { const day = q.date || TODAY; data = { success: true, mode: 'minute', date: day, points: minutes(day, 420, '08:45').map(bar), has_more: false }; }
        else if (minute && p === '/api/ls-stock-futures/chart') {
            const d = dated(), stored = d.day >= FLOW_FROM;
            data = { success: true, mode: 'minute', date: d.day, multiplier: 10, points: stored ? minutes(d.day, 420, '08:45').map((t, i) => ({ t, individual: i, foreign: -i, institution: 1 })) : [], cursor: d.cursor, has_more: d.has_more, available_dates: DAYS.filter(x => x >= FLOW_FROM), warnings: [], status: { error: '' } };
        } else if (minute && p === '/api/kis-supply/chart') { const d = dated(); data = { success: true, date: d.day, points: minutes(d.day, 60, '09:00').map(t => ({ t, individual: 1, foreign: 1, institution: 1 })), cursor: d.cursor, has_more: d.has_more, available_dates: DAYS, warnings: [] }; }
        else if (minute && p === '/api/supply/candles') { const d = dated(); data = { success: true, points: minutes(d.day).map(bar), date: d.day, cursor: d.cursor, has_more: d.has_more }; }
        else if (minute && (p === '/api/adr/candles' || p === '/api/ls-futures-test/candles')) { const from = dashed(q.from || compact(TODAY)), to = dashed(q.to || compact(TODAY)); data = { success: true, points: DAYS.filter(d => d >= from && d <= to).flatMap(d => minutes(d, 30, '09:00').map(bar)), has_more: false }; }
        else if (minute) data = { success: true, market: 'K', points: [], series: [], markets: {}, has_more: false, warnings: [] };
        else if (p === '/api/chart-reference' || p === '/api/adr/candles' || p === '/api/supply/candles' || p === '/api/ls-stock-futures/candles') data = { success: true, points: DAYS.map(d => bar(Date.parse(d + 'T00:00:00+09:00'))), has_more: false };
        else if (p.endsWith('/chart') && p.includes('supply') || p === '/api/ls-stock-futures/chart') data = { success: true, points: DAYS.map(d => ({ t: Date.parse(d + 'T00:00:00+09:00'), foreign: 1, institution: -1, individual: 0, program: 0 })), candles: [], has_more: false, warnings: [] };
        else data = { success: true, series: [], points: [], markets: {}, has_more: false, warnings: [] };
        return route.fulfill({ json: data }).catch(() => {});
    });
    await page.goto('http://live-guards.test/');
    await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}' });
    for (const f of ['rank-chart-axis.js', 'concentration-chart.js', 'rank-turnover-chart.js', 'rank-volatility-chart.js', 'rank-supply-chart.js', 'rank-market-supply-chart.js']) await page.addScriptTag({ path: 'public/' + f });
    await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
    await page.evaluate(() => window.selectRankChartStock({ code: '005930', name: '삼성전자' }));
    await page.waitForTimeout(1500);
    return { browser, page, errors };
}
const idle = async page => { for (let i = 0; i < 80; i++) { await page.waitForTimeout(150); if (await page.evaluate(() => { const s = window.getRankFuturesSupplyState(); return !document.querySelector('#rankFuturesSupplyChartPanel [role="status"]')?.textContent.includes('조회 중') && s; })) { await page.waitForTimeout(300); return; } } };

test('과거 구간: 오늘 자료 갱신이 끼어도 오늘 캔들을 받지 않고, 더 불러오기는 구간 안에서 잇는다', async () => {
    const log = [], { browser, page, errors } = await openPage(log);
    try {
        await page.evaluate(() => { const d = window.RankChartAxis.dailyDomain(), n = d.days.length - 1; window.RankChartAxis.selectViewport('futuresSupply', d.days.indexOf('2026-08-17') / n, d.days.indexOf('2026-09-25') / n); });
        log.length = 0;
        await page.locator('#rankFuturesSupplyChartPanel [data-mode="minute"]').click();
        const win = await page.evaluate(() => window.RankChartAxis.minuteWindow());
        assert.deepEqual(win, { from: '2026-08-17', to: '2026-09-25' });
        // 장중 오늘 자료가 바뀌어 카드가 다시 받는 경우(구간으로 가는 조회가 도는 중).
        await page.waitForTimeout(300);
        await page.evaluate(() => window.refreshRankFuturesSupplyChart());
        await page.waitForTimeout(4000);
        const futuresCandles = () => log.filter(u => u.startsWith('/api/ls-stock-futures/candles') && u.includes('mode=minute'));
        assert.deepEqual(futuresCandles().filter(u => !/date=2026-0[89]/.test(u)), [], `구간 밖(오늘 포함) 캔들을 받지 않는다: ${futuresCandles().join(' ')}`);
        // 어떤 경로로든 커서가 오늘 쪽에 남은 경우(오라클 측정 4): 구간 보기 중 당일 기준으로 다시 받은 상태를 만든다.
        // 카드가 화면을 비우고(clearView) 구간 없이 오늘부터 다시 받은 상태: 수집 목록 갱신에서 보관 목록이 바뀐 경우로 만든다.
        dropArchive = true;
        await page.evaluate(async () => { const original = window.RankChartAxis.minuteDomain; window.RankChartAxis.minuteDomain = () => null; try { await window.refreshRankFuturesSupplyChart(); } finally { window.RankChartAxis.minuteDomain = original; } });
        dropArchive = false;
        await page.waitForTimeout(1500);
        const state = await page.evaluate(() => window.getRankFuturesSupplyState());
        assert.ok(state.hasMore && state.cursor > '20260925', `오늘 쪽 커서가 남은 상태를 재현한다: ${state.cursor}`);
        log.length = 0;
        await page.evaluate(() => window.RankChartAxis.requestHistory('minute'));
        const charts = log.filter(u => u.startsWith('/api/ls-stock-futures/chart') && u.includes('mode=minute')), cursors = charts.map(u => new URL('http://x' + u).searchParams.get('cursor')).filter(Boolean);
        assert.deepEqual(cursors.filter(c => c > '20260925'), [], `더 불러오기는 구간 끝 날 뒤로 가지 않는다: ${cursors.join(',')}`);
        assert.ok(charts.length <= 3, `오늘부터 하루씩 거슬러 가지 않는다(수급 요청 ${charts.length}건)`);
        assert.deepEqual(log.filter(u => u.startsWith('/api/ls-stock-futures/candles') && u.includes('date=2026-10')), [], '구간 밖 캔들을 받지 않는다');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('10거래일 실시간 구간: 갱신 때 지난날 수급을 다시 받지 않는다', async () => {
    const log = [], { browser, page, errors } = await openPage(log);
    try {
        await page.evaluate(() => { const d = window.RankChartAxis.dailyDomain(), n = d.days.length - 1; window.RankChartAxis.selectViewport('futuresSupply', d.days.indexOf('2026-10-12') / n, 1); });
        await page.locator('#rankFuturesSupplyChartPanel [data-mode="minute"]').click();
        await page.waitForTimeout(5000);
        assert.equal(await page.evaluate(() => window.RankChartAxis.minuteWindow()), null, '오늘 포함 구간(live)');
        const pastDated = () => log.filter(u => /\/api\/(ls-stock-futures|kis-supply)\/chart/.test(u) && /date=2026-10-(1|0|2[0-2])/.test(u));
        await page.evaluate(() => Promise.all([window.refreshRankFuturesSupplyChart(), window.refreshRankCombinedSupplyChart?.()]));
        await page.waitForTimeout(1500);
        const first = pastDated().length;
        log.length = 0;
        await page.evaluate(() => Promise.all([window.refreshRankFuturesSupplyChart(), window.refreshRankCombinedSupplyChart?.()]));
        await page.waitForTimeout(1500);
        assert.ok(log.some(u => u.startsWith('/api/ls-stock-futures/chart?code=005930&mode=minute') && !u.includes('date=') && !u.includes('cursor=')), '오늘 수급은 다시 받는다');
        assert.deepEqual(pastDated(), [], `지난날 수급을 다시 받지 않는다(앞선 갱신 ${first}건)`);
        const days = await page.evaluate(() => window.getRankFuturesSupplyState().minuteDays);
        assert.ok(days.includes('2026-10-12') && days.includes(TODAY), '구간 전체가 그대로 남는다');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('당일 분봉: 구간 캔들(ADR · 지수 선물)을 처음부터 전날부터 묻는다', async () => {
    const log = [], { browser, page, errors } = await openPage(log);
    try {
        // 캔들을 펼친 카드(ADR · 시장 수급 두 장)에서 일봉 → 분봉(당일).
        for (const id of ['rankBreadthChartPanel', 'rankTestMarketSupplyChartPanel', 'rankTestMarketSupplySecondaryChartPanel']) {
            const toggle = page.locator(`#${id} .concentration-candle-toggle[aria-expanded="false"]`).first();
            if (await toggle.count()) await toggle.click();
        }
        await page.waitForTimeout(1000);
        log.length = 0;
        await page.locator('#rankFuturesSupplyChartPanel [data-mode="minute"]').click();
        await page.waitForTimeout(3000);
        const ranged = log.filter(u => /\/api\/(adr|ls-futures-test)\/candles\?.*mode=minute/.test(u));
        assert.ok(ranged.length, '구간 캔들 요청이 있다');
        assert.deepEqual(ranged.filter(u => u.includes('from=' + compact(TODAY))), [], `오늘만 묻지 않는다: ${ranged.join(' ')}`);
        assert.ok(ranged.every(u => u.includes('from=20261022')), `전날(10/22)부터 묻는다: ${ranged.join(' ')}`);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});

test('오늘 자료 알림은 과거 구간 보기 중 분봉 카드를 다시 받게 하지 않는다', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage();
        await page.route('https://cache-guard.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>t</title>' }));
        await page.goto('https://cache-guard.test/');
        await page.evaluate(() => { window.calls = []; window.windowOn = true; window.RankChartAxis = { minuteWindow: () => window.windowOn ? { from: '2026-08-17', to: '2026-09-25' } : null, refreshCharts: o => window.calls.push('all:' + o.mode) }; window.refreshRankFuturesSupplyChart = () => window.calls.push('futures'); window.refreshConcentrationChart = () => window.calls.push('concentration'); });
        await page.addScriptTag({ path: 'public/rank-chart-cache.js' });
        const fire = detail => page.evaluate(async d => { document.dispatchEvent(new CustomEvent('rank-chart-cache-updated', { detail: d })); await new Promise(r => setTimeout(r, 250)); const c = [...window.calls]; window.calls.length = 0; return c; }, detail);
        assert.deepEqual(await fire({ path: '/api/ls-stock-futures/chart', mode: 'minute', live: true }), [], '오늘 분봉 알림은 건너뛴다');
        assert.deepEqual(await fire({ path: '/api/kis-supply/chart', mode: 'minute', live: true }), [], '종목 수급 알림도 건너뛴다');
        assert.deepEqual(await fire({ path: '/api/ls-concentration-chart', mode: 'minute', live: true }), ['concentration'], '쏠림율은 그대로 알린다(독립창 새로고침)');
        assert.deepEqual(await fire({ path: '/api/ls-stock-futures/chart', mode: 'minute', live: false }), ['futures'], '서버 과거 자료 수정(revision) 알림은 받는다');
        assert.deepEqual(await fire({ path: '/api/ls-stock-futures/chart', mode: 'day', live: true }), ['futures'], '일봉 알림은 받는다');
        await page.evaluate(() => { window.windowOn = false; });
        assert.deepEqual(await fire({ path: '/api/ls-stock-futures/chart', mode: 'minute', live: true }), ['futures'], '구간 보기가 아니면 받는다');
    } finally { await browser.close(); }
});

test('쏠림율: 최근 3분 안의 빈 분은 누락으로 세지 않고, 둘 다 빈 분은 종목 · 시장으로 적는다', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 1900, height: 1100 } }), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: new Date('2026-11-27T09:57:30+09:00') });
        const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        let olderGap = false;
        const bars = () => {
            const out = [];
            for (let m = 9 * 60; m <= 9 * 60 + 57; m++) {
                const clock = String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0') + '00';
                const gap = m >= 9 * 60 + 55 || olderGap && m === 9 * 60 + 30;
                out.push({ time: '20261127' + clock, stock_open: 100, stock_high: 101, stock_low: 99, stock_price: 100, value: gap ? null : 1.5, stock_turnover: gap ? null : 1e9, market_turnover: gap ? null : 1e12, regular_session: true });
            }
            return out;
        };
        await page.route('http://conc-recent.test/**', route => {
            const u = new URL(route.request().url());
            if (u.pathname === '/api/ls-concentration-chart' || u.pathname === '/api/concentration-chart') return route.fulfill({ json: { success: true, market: 'K', mode: 'minute', points: bars(), has_more: false } });
            if (u.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true, series: [], points: [], has_more: false } });
            return route.fulfill({ contentType: 'text/html', body: html });
        });
        await page.goto('http://conc-recent.test/');
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') + '#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}' });
        for (const f of ['rank-chart-axis.js', 'concentration-chart.js']) await page.addScriptTag({ path: 'public/' + f });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.evaluate(() => window.selectRankChartStock({ code: '005930', name: '삼성전자' }));
        await page.locator('#combinedConcentrationChartPanel [data-chart-mode="minute"]').first().click();
        await page.waitForTimeout(800);
        const status = () => page.$eval('#combinedConcentrationStatus', el => el.textContent);
        assert.equal(await status(), '', `09:55 · 09:56 · 09:57은 아직 모으는 중이다: "${await status()}"`);
        olderGap = true;
        await page.evaluate(() => window.refreshConcentrationChart?.());
        await page.waitForTimeout(800);
        assert.equal(await status(), '종목 · 시장 거래대금 1개 시점 누락 · 쏠림율 계산 불가');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
