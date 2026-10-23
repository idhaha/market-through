const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
        await page.addInitScript(() => {
            window.supplyTimers = []; const original = window.setInterval;
            window.setInterval = (callback, delay, ...args) => { window.supplyTimers.push(delay); return original(callback, delay, ...args); };
            window.priceCandles = 0; const fillRect = CanvasRenderingContext2D.prototype.fillRect;
            CanvasRenderingContext2D.prototype.fillRect = function(...args) {
                if (this.canvas.closest('.rank-adr-candle-area') && ['#e11d48','#2563eb'].includes(this.fillStyle)) window.priceCandles++;
                return fillRect.apply(this, args);
            };
        });
        const errors = [], calls = [];
        page.on('pageerror', error => errors.push(error.message));
        const names = { '005930': '삼성전자', '000660': 'SK하이닉스', '035420': 'NAVER테스트종목', '035720': '카카오', '005380': '현대차', '051910': 'LG화학' };
        let config = { success: true, revision: 1, collecting: true, stocks: ['005930', '000660'].map(code => ({ code, name: names[code], added_at: 1 })),
            archive: ['005930', '000660', '051910'].map(code => ({ code, name: names[code] })), statuses: {} };
        let fail = false, slow = false, release, emptyFlow = false, partialDaily = false;
        const daily = Array.from({ length: 80 }, (_, i) => ({ t: Date.UTC(2026, 8, 1 + i) - 9 * 3600000,
            individual: i * 100 - 4000, foreign: 8000 - i * 100, institution: -2000 + i * 10, program: i % 3 ? i * 50 : null }));
        const minute = Array.from({ length: 30 }, (_, i) => ({ t: Date.UTC(2026, 9, 20, 0, i), individual: i, foreign: -i, institution: 10, program: i === 29 ? null : i * 2 }));
        const candlePoints = rows => rows.map(p => ({ t: p.t, open: 200000, high: 230000, low: 190000, close: 210000 }));
        await page.route('http://supply.test/**', async route => {
            const url = new URL(route.request().url()); calls.push({ path: url.pathname, params: url.searchParams, method: route.request().method() });
            if (url.pathname === '/style.css') return route.fulfill({ contentType: 'text/css', body: fs.readFileSync('public/style.css', 'utf8') });
            if (url.pathname === '/api/supply/watchlist') {
                if (route.request().method() === 'PUT') {
                    const data = route.request().postDataJSON(); assert.equal(data.revision, config.revision); assert.ok(data.codes.length <= 5);
                    config = { ...config, revision: config.revision + 1, stocks: data.codes.map(code => ({ code, name: names[code], added_at: 1 })) };
                    config.archive = [...new Map([...config.archive, ...config.stocks].map(s => [s.code, s])).values()];
                }
                return route.fulfill({ json: config });
            }
            if (url.pathname === '/api/concentration-stock') {
                const code = url.searchParams.get('q');
                return route.fulfill({ json: { success: true, stock: { code, name: names[code] } } });
            }
            if (url.pathname === '/api/concentration-stocks') {
                const code = url.searchParams.get('q');
                return route.fulfill({ json: { success: true, stocks: code === '검색' ? ['005930','000660','035420'].map(code => ({ code, name: names[code] })) : names[code] ? [{ code, name: names[code] }] : [] } });
            }
            if (url.pathname === '/api/supply/chart') {
                if (slow && url.searchParams.get('code') === '005930') await new Promise(resolve => { release = resolve; });
                if (fail) return route.fulfill({ status: 502, json: { success: false, error: '테스트 수급 조회 실패' } });
                const minutes = url.searchParams.get('mode') === 'minute', older = url.searchParams.has('cursor');
                const rows = minutes ? older ? minute.map(p => ({ ...p, t: p.t - 86400000 })) : minute : older ? daily.map(p => ({ ...p, t: p.t - 80 * 86400000 })) : daily;
                return route.fulfill({ json: { success: true, points: emptyFlow ? minutes ? [] : rows.map(p => ({ t: p.t })) : partialDaily && !minutes ? rows.map(({ program, ...point }) => point) : rows,
                    candles: minutes ? [] : candlePoints(rows), has_more: !older && !emptyFlow, cursor: older || emptyFlow ? null : minutes ? '20261019' : '20260831',
                    date: url.searchParams.get('date') || '2026-10-20', available_dates: ['2026-10-19','2026-10-20'], warnings: [] } });
            }
            if (url.pathname === '/api/supply/candles') {
                const rows = url.searchParams.get('mode') === 'minute' ? url.searchParams.get('date') === '2026-10-19' ? minute.map(p => ({...p,t:p.t-86400000})) : minute : daily;
                const day = url.searchParams.get('date') || '2026-10-20';
                return route.fulfill({ json: { success: true, points: candlePoints([...rows, { t: rows.at(-1).t + 60000 }]), date: day, has_more: day === '2026-10-20', cursor: day === '2026-10-20' ? '20261019' : null } });
            }
            return route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><link rel="stylesheet" href="/style.css"><style>body{margin:20px}.panel{padding:14px}.rank-chart-row>section:not(#rankSupplyChartPanel){height:450px}</style><div class="rank-chart-row"><section id="concentrationChartPanel"></section><section></section><section></section><section class="rank-volatility-panel"></section><section id="rankBreadthChartPanel" class="rank-breadth-panel"><h2>신고가-신저가</h2></section><section class="rank-sentiment-panel"></section></div>` });
        });
        await page.goto('http://supply.test/');
        await page.addScriptTag({path:'public/rank-chart-axis.js'});
        await page.addScriptTag({ content: fs.readFileSync('public/rank-supply-chart.js', 'utf8') });
        const panel = page.locator('#rankSupplyChartPanel');
        await page.waitForFunction(() => document.querySelector('#rankSupplyChartPanel .rank-adr-status').textContent.includes('일별 순매수'));
        const programValue = await panel.locator('[data-series="program"] output').textContent();
        assert.ok(programValue.includes('주'));
        partialDaily = true; await page.evaluate(() => window.refreshRankSupplyChart());
        assert.equal(await panel.locator('[data-series="program"] output').textContent(), programValue, 'A refresh missing program fields preserves previously observed daily program values');
        partialDaily = false;
        assert.equal(await panel.evaluate(el => getComputedStyle(el).gridColumnStart), '2');
        assert.equal(await panel.evaluate(el => getComputedStyle(el).gridRowStart), '1', 'Supply panel occupies the former ADR position');
        assert.equal(await panel.getByLabel('수급 종목 선택').inputValue(), '005930');
        assert.ok(await panel.evaluate(el => {
            const reference = document.getElementById('concentrationChartPanel').getBoundingClientRect(), box = el.getBoundingClientRect();
            const extra = Math.max(0, el.querySelector('.rank-adr-controls').getBoundingClientRect().height - 40);
            return Math.abs(reference.height + extra - box.height) < 1 && Math.abs(reference.width - box.width) < 1;
        }), 'Card keeps reference dimensions with room for wrapped controls');
        assert.equal(await panel.locator('.supply-stock-select option:checked').textContent(), '삼성전자');
        assert.equal(await panel.locator('[data-range]').count(), 0);
        assert.equal(await panel.getByRole('button', { name: '+ 종목 추가', exact: true }).count(), 1);
        assert.equal(await panel.getByRole('button', { name: '종목 관리', exact: true }).count(), 0);
        assert.equal(await panel.getByLabel('수급 종목 선택', { exact: true }).count(), 1);
        assert.equal(await panel.getByRole('button', { name: '조회', exact: true }).count(), 0);
        assert.deepEqual(await page.evaluate(() => window.supplyTimers), [], 'Supply display uses the page refresh cycle without its own fixed timer');
        assert.deepEqual(await panel.locator('.supply-legend button > span').allTextContents(), ['개','외','기','프']);
        assert.equal(await panel.locator('.supply-legend').evaluate(el => el.parentElement.className), 'rank-adr-controls');
        assert.equal(await panel.locator('.rank-adr-area canvas').evaluate(node => node.getBoundingClientRect().height), 260, 'Supply keeps the concentration plot height');
        assert.equal((await panel.locator('.supply-legend').textContent()).includes('●'), false);
        assert.equal(await panel.getByRole('button', { name: /수집 제외/ }).count(), 0);
        assert.equal(await panel.locator('[data-series="individual"]').evaluate(el => getComputedStyle(el).color), 'rgb(51, 154, 240)');
        assert.equal(await panel.locator('[data-series="foreign"]').evaluate(el => getComputedStyle(el).color), 'rgb(225, 29, 72)');
        assert.equal(await panel.locator('[data-action="add-stock"]').evaluate(el => el.previousElementSibling.tagName), 'H2');
        assert.ok(await panel.locator('.supply-stock-select').evaluate(el => Math.abs(el.getBoundingClientRect().top - el.nextElementSibling.getBoundingClientRect().top) < 6));
        assert.match(await panel.locator('.rank-adr-status').textContent(), /80봉/);
        assert.equal(await panel.getByRole('button', { name: '과거 데이터 더 불러오기', exact: true }).isVisible(), true);
        assert.equal(await panel.locator('[data-action="more"]').evaluate(el => el.parentElement.className), 'rank-adr-controls');
        assert.equal(await panel.locator('[data-action="more"]').evaluate(el => el.previousElementSibling.className), 'chart-today-button');
        assert.equal(await panel.locator('[data-action="more"] svg').getAttribute('viewBox'), '0 0 34 34');
        assert.equal(await panel.locator('[data-action="more"] svg path').count(), 3);
        await panel.getByRole('button', { name: '과거 데이터 더 불러오기', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankSupplyChartPanel .rank-adr-status').textContent.includes('160봉'));
        assert.equal(await panel.getByRole('button', { name: '과거 데이터 더 불러오기', exact: true }).isDisabled(), true);
        await page.evaluate(() => window.refreshRankSupplyChart());
        assert.match(await panel.locator('.rank-adr-status').textContent(), /160봉/);
        assert.equal(await panel.getByRole('button', { name: '과거 데이터 더 불러오기', exact: true }).isDisabled(), true);
        const initialWrites = calls.filter(c => c.method === 'PUT').length;
        await panel.getByLabel('수급 종목 선택').selectOption('000660');
        assert.equal(await panel.getByLabel('수급 종목 선택').inputValue(), '000660');
        assert.equal(calls.filter(c => c.method === 'PUT').length, initialWrites, 'Chart switching never changes collection targets');
        await panel.getByRole('button', { name: '1분봉(누적)', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankSupplyChartPanel .rank-adr-status').textContent.includes('1분 누적'));
        await page.waitForFunction(() => !document.querySelector('#rankSupplyChartPanel .rank-adr-status').textContent.includes('조회 중'));
        assert.equal(await panel.locator('[data-series="foreign"] output').textContent(), '-29주', 'Price-only trailing candle does not hide the last foreign observation');
        assert.equal(await panel.locator('[data-series="program"] output').textContent(), '+56주', 'Each source uses its own most recent valid observation');
        assert.match(await panel.locator('[data-series="program"] output').getAttribute('title'), /09:28/);
        assert.equal(await panel.getByLabel('수급 분봉 날짜').count(), 0);
        await panel.getByRole('button', { name: '과거 데이터 더 불러오기', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankSupplyChartPanel .rank-adr-status').textContent.includes('2026-10-19'));
        assert.match(await panel.locator('.rank-adr-status').textContent(), /2026-10-19 ~ 2026-10-20/);
        await page.evaluate(() => window.refreshRankSupplyChart());
        assert.match(await panel.locator('.rank-adr-status').textContent(), /2026-10-19 ~ 2026-10-20/, 'Refresh retains loaded minute days');
        await panel.getByRole('button', { name: '캔들차트', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('#rankSupplyChartPanel .rank-adr-candle-area').hidden);
        assert.equal(await panel.evaluate(el => el.getBoundingClientRect().height), 730, 'Candle expansion adds exactly 280px');
        await page.waitForTimeout(30);
        assert.ok(calls.some(c => c.path === '/api/supply/candles' && c.params.get('date') === '2026-10-19'));
        await panel.getByRole('button', { name: '수급 차트 확대', exact: true }).click();
        assert.equal(await panel.locator('input[type="range"]').isDisabled(), false);
        await panel.locator('canvas').first().hover({ position: { x: 100, y: 100 } });
        assert.match(await panel.locator('.chart-hover-info').textContent(), /개인.*외국인.*기관.*프로그램/);
        fail = true; await page.evaluate(() => window.refreshRankSupplyChart());
        assert.match(await panel.locator('.rank-adr-status').textContent(), /조회 실패.*이전 데이터/);
        fail = false;
        await panel.getByRole('button', { name: '+ 종목 추가', exact: true }).click();
        const picker = page.locator('dialog.supply-stock-dialog');
        assert.equal(await picker.evaluate(el => el.open && el.matches(':modal')), true);
        const add = async code => { await picker.locator('input').fill(code); await picker.locator('form').getByRole('button', { name: '추가', exact: true }).click(); };
        await add('005930'); await page.waitForFunction(() => document.querySelector('.supply-stock-dialog [role="status"]').textContent.includes('이미 지정'));
        const search = picker.getByRole('combobox'); await search.fill('검색');
        await picker.getByRole('option').last().waitFor();
        assert.equal(await picker.getByRole('option').count(), 3);
        await search.press('ArrowDown'); assert.equal(await picker.getByRole('option').first().getAttribute('aria-selected'), 'true');
        const beforeIme = calls.filter(c => c.path === '/api/concentration-stocks').length;
        await search.evaluate(el => {
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '색', isComposing: true }));
            el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '색' }));
        });
        assert.equal(await picker.getByRole('option').first().getAttribute('aria-selected'), 'true', 'Duplicate IME input preserves the highlighted option');
        assert.equal(calls.filter(c => c.path === '/api/concentration-stocks').length, beforeIme);
        await search.press('ArrowDown'); assert.equal(await picker.getByRole('option').nth(1).getAttribute('aria-selected'), 'true', 'A single arrow advances after IME commit');
        await search.press('ArrowUp');
        await search.press('ArrowUp'); assert.equal(await picker.getByRole('option').last().getAttribute('aria-selected'), 'true');
        await search.press('ArrowDown'); await search.press('ArrowDown');
        assert.equal(await picker.getByRole('option').nth(1).getAttribute('aria-selected'), 'true');
        await search.press('ArrowDown'); await search.press('Enter');
        await page.waitForFunction(() => document.querySelector('.supply-stock-dialog').hidden);
        assert.equal(config.stocks.at(-1).code, '035420', 'Enter adds the highlighted suggestion');
        assert.equal(calls.filter(c => c.path === '/api/concentration-stock' && c.params.get('q') === '검색').length, 0);
        for (const [i, code] of ['035720','005380'].entries()) {
            await panel.getByRole('button', { name: '+ 종목 추가', exact: true }).click();
            await add(code); await page.waitForFunction(() => document.querySelector('.supply-stock-dialog').hidden);
            assert.equal(config.stocks.length, i + 4, 'Each add saves immediately without a separate save step');
        }
        assert.equal(config.stocks.length, 5);
        const longButton = panel.locator('.supply-stock-select option[value="035420"]');
        assert.equal(await longButton.textContent(), Array.from(names['035420']).slice(0,6).join(''));
        assert.ok((await longButton.getAttribute('title')).includes(names['035420']));
        assert.equal(await panel.locator('.supply-stock-select option[value]:not([value=""])').count(), 5);
        await panel.getByRole('button', { name: '+ 종목 추가', exact: true }).click();
        assert.equal(await picker.locator('button[type="submit"]').isDisabled(), true);
        await picker.getByRole('button', { name: '닫기', exact: true }).click();
        await panel.getByRole('button', { name: '+ 종목 추가', exact: true }).click();
        await picker.getByRole('button', { name: '삼성전자 수집 제외', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.supply-stock-select option[value]:not([value=""])').length === 4);
        await panel.getByRole('button', { name: '+ 종목 추가', exact: true }).click();
        await picker.locator('summary').click();
        await picker.locator('.supply-archive-menu').getByRole('button', { name: '삼성전자', exact: true }).click();
        assert.equal(await panel.getByLabel('수급 종목 선택').inputValue(), '005930');
        assert.equal(config.stocks.length, 4, 'Archived chart selection does not restart collection');
        await panel.getByRole('button', { name: '일봉', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankSupplyChartPanel .rank-adr-status').textContent.includes('일별 순매수'));
        assert.ok(await panel.evaluate(el => el.querySelector('.rank-adr-status').getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom), 'Footer stays inside the panel');
        const output = path.resolve('dev/output'); fs.mkdirSync(output, { recursive: true });
        await panel.screenshot({ path: path.join(output, 'rank-supply-panel.png') });
        await page.screenshot({ path: path.join(output, 'rank-supply-layout.png'), fullPage: true });
        await panel.getByRole('button', { name: '+ 종목 추가', exact: true }).click();
        await picker.screenshot({ path: path.join(output, 'rank-supply-popup.png') });
        await picker.press('Escape');
        assert.equal(await picker.evaluate(el => el.open), false);
        emptyFlow = true;
        await panel.getByRole('button', { name: '캔들차트', exact: true }).click(); // Preserve this folded state even without flow records.
        await page.evaluate(() => { window.priceCandles = 0; });
        await panel.getByRole('button', { name: '1분봉(누적)', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankSupplyChartPanel .rank-adr-status').textContent.includes('수급 기록 없음'));
        assert.equal(await panel.locator('.rank-adr-candle-area').isVisible(), false);
        assert.match(await panel.locator('.rank-adr-status').textContent(), /수급 기록 없음/);
        assert.ok((await panel.locator('[data-series="foreign"] output').textContent()).includes('미제공'));
        const morePrices = panel.getByRole('button', { name: '과거 데이터 더 불러오기', exact: true });
        await page.waitForFunction(() => !document.querySelector('#rankSupplyChartPanel [data-action="more"]').disabled);
        await morePrices.click();
        await page.waitForFunction(() => document.querySelector('#rankSupplyChartPanel [data-action="more"]').disabled
            && !document.querySelector('#rankSupplyChartPanel .rank-adr-status').textContent.includes('조회 중'));
        assert.ok(calls.some(c => c.path === '/api/supply/chart' && c.params.get('mode') === 'minute' && c.params.get('cursor') === '20261019'));
        assert.ok(calls.some(c => c.path === '/api/supply/candles' && c.params.get('date') === '2026-10-19'));
        assert.ok((await panel.locator('[data-series="foreign"] output').textContent()).includes('미제공'), 'Price-only history does not invent flow values');
        assert.equal(await panel.locator('.rank-adr-candle-area').isVisible(), false, 'Loading older prices keeps candles folded');
        await panel.getByRole('button', { name: '캔들차트', exact: true }).click();
        await page.waitForFunction(() => window.priceCandles > 0);
        assert.equal(await panel.locator('.rank-adr-candle-area').isVisible(), true, 'Price-only candles remain available when opened explicitly');
        await panel.getByRole('button', { name: '일봉', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#rankSupplyChartPanel .rank-adr-status').textContent.includes('수급 기록 없음'));
        assert.equal(await panel.locator('.rank-adr-candle-area').isVisible(), true);
        assert.deepEqual(errors, []);
        await page.evaluate(()=>{window.rankMainCandleOpen=true;window.applyRankSupplySettings({...window.getRankSupplyState(),showCandles:false},false);});
        assert.equal(await panel.locator('.concentration-candle-toggle').getAttribute('aria-expanded'),'true','Main restore overrides stale supply-only closed state');
        await page.evaluate(()=>window.applyRankSupplyCandleOpen(false));
        assert.equal(await panel.locator('.concentration-candle-toggle').getAttribute('aria-expanded'),'false');
        await page.evaluate(()=>{window.rankIndependentClient={};window.applyRankSupplySettings({...window.getRankSupplyState(),showCandles:false},false);});
        assert.equal(await panel.locator('.concentration-candle-toggle').getAttribute('aria-expanded'),'false','Independent window keeps its own candle state');
        console.log('Supply chart: stock management, five-stock limit, archive, candles, dates, zoom, failure recovery and layout passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
