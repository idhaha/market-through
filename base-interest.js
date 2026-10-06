const { chromium } = require('playwright');
const { SOURCE_URL, dayKey, resolveBrowserPath, dismissPopups } = require('./central-banks');

const BANKS = [
    ['FED', '연방준비제도'], ['ECB', '유럽중앙은행'], ['BOE', '영국은행'], ['BOJ', '일본은행'],
    ['BOK', '한국은행'], ['RBA', '호주 연방준비은행'], ['BOC', '캐나다 은행'], ['SNB', '스위스 국립은행'],
    ['RBI', '인도 연방준비은행'], ['BCB', '브라질 중앙은행'], ['CBR', '러시아 중앙은행'], ['PBOC', '중국인민은행']
].map(([code, name]) => ({ code, name }));

const AD_HOSTS = ['doubleclick.net', 'googlesyndication.com', 'googletagservices.com', 'googleadservices.com', 'googletagmanager.com', 'google-analytics.com', 'amazon-adsystem.com', 'taboola.com', 'outbrain.com'];
function shouldBlockResource(url, type) {
    if (['media', 'font'].includes(type)) return true;
    let host;
    try { host = new URL(url).hostname; } catch { return false; }
    // Keep Investing.com chart assets and security-check resources intact.
    return AD_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

async function pageDiagnostic(page, httpStatus) {
    return page.evaluate(status => ({
        httpStatus: status, title: document.title, url: location.origin + location.pathname,
        sectionFound: !!document.querySelector('section#leftColumn'),
        securityCheck: /just a moment|verify you are human|checking your browser|확인 중|보안 확인/i.test(document.title + ' ' + document.body?.innerText.slice(0, 1500))
    }), httpStatus).catch(() => ({ httpStatus, title: '(페이지 정보를 읽지 못함)' }));
}

async function chartState(page) {
    return page.evaluate(() => {
        const section = document.querySelector('section#leftColumn');
        const selected = section?.querySelector('ul.tabsForBox li.selected a')?.textContent.trim() || '';
        const charts = (window.Highcharts?.charts || []).filter(chart => chart && section?.contains(chart.renderTo));
        const data = charts.map(chart => chart.series.map(series => (series.points || []).map(p => [p.x, p.y])));
        const loading = charts.some(chart => chart.loadingShown);
        const ready = !loading && data.some(series => series.some(points => points.some(p => Number.isFinite(p[1]))));
        return { selected, ready, loading, fingerprint: JSON.stringify(data) };
    });
}

async function captureInterestCharts(onChart, onStage = () => {}) {
    let browser;
    const started = Date.now();
    const progress = (stage, bank = null) => {
        onStage(stage, bank);
        console.log(`[Base Interest] stage=${stage}${bank ? ` bank=${bank}` : ''} elapsed=${Date.now() - started}ms`);
    };
    try {
        progress('browser');
        const options = { headless: true, args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox'] };
        if (process.env.CENTRAL_BANKS_CHROMIUM_PATH) browser = await chromium.launch({ ...options, executablePath: resolveBrowserPath() });
        else {
            try { browser = await chromium.launch({ ...options, channel: 'chrome' }); }
            catch (error) {
                if (!/not found|doesn't exist|not installed|executable/i.test(error.message)) throw error;
                browser = await chromium.launch({ ...options, executablePath: resolveBrowserPath() });
            }
        }
        const context = await browser.newContext({ colorScheme: 'light', serviceWorkers: 'block', viewport: { width: 1400, height: 1200 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' });
        const page = await context.newPage();
        await context.route('**/*', route => shouldBlockResource(route.request().url(), route.request().resourceType()) ? route.abort() : route.continue());
        page.setDefaultTimeout(10000);
        page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
        page.on('response', response => {
            if (['xhr', 'fetch'].includes(response.request().resourceType()) && response.status() >= 400) {
                const url = new URL(response.url());
                console.error(`[Base Interest] data HTTP ${response.status()} ${url.origin}${url.pathname}`);
            }
        });
        await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
        progress('navigation');
        const response = await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (!response || response.status() >= 400) {
            console.error('[Base Interest] page diagnostic:', JSON.stringify(await pageDiagnostic(page, response?.status())));
            const error = new Error(`중앙은행 페이지 접속 실패 (HTTP ${response?.status() || '응답 없음'})`);
            error.userMessage = `Investing.com 페이지 접속에 실패했습니다. (HTTP ${response?.status() || '응답 없음'})`;
            throw error;
        }
        await page.waitForTimeout(5000);
        await dismissPopups(page);
        const section = page.locator('section#leftColumn').first();
        progress('section');
        try { await section.waitFor({ state: 'visible', timeout: 30000 }); }
        catch (cause) {
            const diagnostic = await pageDiagnostic(page, response.status());
            console.error('[Base Interest] page diagnostic:', JSON.stringify(diagnostic));
            const error = new Error('중앙은행 차트 영역을 30초 안에 찾지 못했습니다.', { cause });
            error.userMessage = diagnostic.securityCheck ? 'Investing.com에서 서버 접속에 보안 확인을 요구하여 차트를 읽지 못했습니다.' : 'Investing.com에서 금리 차트 영역을 찾지 못했습니다. 서버 로그의 page diagnostic을 확인해 주세요.';
            throw error;
        }
        for (const bank of BANKS) {
            progress('chart', bank.code);
            try {
                await dismissPopups(page);
                const before = await chartState(page);
                const tab = section.locator('ul.tabsForBox a').filter({ hasText: new RegExp(`^${bank.code}$`) }).first();
                await tab.scrollIntoViewIfNeeded();
                // Normal click verifies that a popup is not intercepting the bank tab.
                await tab.click({ timeout: 10000 });
                const deadline = Date.now() + 25000;
                let ready = false;
                let lastState;
                while (Date.now() < deadline) {
                    const state = await chartState(page);
                    lastState = state;
                    if (state.selected === bank.code && state.ready && (before.selected === bank.code || state.fingerprint !== before.fingerprint)) {
                        ready = true; break;
                    }
                    await page.waitForTimeout(300);
                }
                if (!ready) throw new Error(`차트 데이터 전환 시간 초과: selected=${lastState?.selected}, ready=${lastState?.ready}, loading=${lastState?.loading}, changed=${lastState?.fingerprint !== before.fingerprint}`);
                await dismissPopups(page);
                await page.waitForTimeout(500);
                await page.evaluate(() => {
                    const section = document.querySelector('section#leftColumn');
                    for (const chart of window.Highcharts?.charts || []) {
                        if (chart && section?.contains(chart.renderTo)) {
                            chart.chartBackground?.attr({ fill: '#ffffff' });
                            chart.renderTo.style.backgroundColor = '#ffffff';
                        }
                    }
                });
                const chart = section.locator('svg').first();
                await chart.waitFor({ state: 'visible', timeout: 5000 });
                await chart.scrollIntoViewIfNeeded();
                const box = await chart.boundingBox();
                if (!box || box.width <= 0 || box.height <= 0) throw new Error('차트 영역을 찾지 못했습니다.');
                const covered = await chart.evaluate(svg => {
                    const box = svg.getBoundingClientRect();
                    return [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]].some(([x, y]) => {
                        const hit = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y);
                        return hit && hit !== svg && !svg.contains(hit);
                    });
                });
                if (covered) throw new Error('차트 위에 팝업 또는 로딩 레이어가 남아 있어 캡처하지 않았습니다.');
                const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
                const session = await context.newCDPSession(page);
                try {
                    const { data } = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
                        clip: { x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height, scale: 1 } });
                    onChart({ ...bank, image: `data:image/png;base64,${data}`, error: null });
                    console.log(`[Base Interest] captured=${bank.code} elapsed=${Date.now() - started}ms`);
                } finally { await session.detach(); }
            } catch (error) {
                onChart({ ...bank, image: null, error: `${bank.code} 차트를 불러오지 못했습니다.` });
                console.error(`[Base Interest] ${bank.code}: ${error.message}`);
            }
        }
    } finally {
        progress('closing');
        if (browser) await browser.close();
    }
}

// Polling returns immediately; a capture run can safely exceed proxy request timeouts.
function createInterestStore(capture = captureInterestCharts, today = dayKey) {
    let state = null;
    let pending = false;
    let lastSuccess = null;
    let serial = 0;
    return function getCharts(force = false) {
        if (pending || (!force && state?.date === today())) return state;
        const previous = lastSuccess;
        state = { id: ++serial, date: today(), capturedAt: null, status: 'loading', stage: 'waiting', bank: null, error: null, charts: BANKS.map(bank => ({ ...bank, image: null, error: null })) };
        const run = state;
        pending = true;
        Promise.resolve().then(() => capture(chart => {
            const index = run.charts.findIndex(bank => bank.code === chart.code);
            if (index >= 0) run.charts[index] = chart;
        }, (stage, bank) => { run.stage = stage; run.bank = bank || null; })).then(() => {
            const succeeded = run.charts.filter(chart => chart.image).length;
            run.status = succeeded === BANKS.length ? 'ready' : succeeded ? 'partial' : 'error';
            run.capturedAt = new Date().toISOString();
            if (!succeeded) run.error = '기준금리 차트를 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.';
            if (succeeded) lastSuccess = run;
        }).catch(error => {
            run.status = 'error'; run.error = error.userMessage || '기준금리 차트 조회에 실패했습니다. 새로고침으로 다시 시도해 주세요.';
            console.error('[Base Interest]', error.message);
        }).finally(() => {
            pending = false;
            if (run.status === 'error' && previous?.date === today()) state = { ...previous, refreshError: run.error };
        });
        return run;
    };
}

module.exports = { BANKS, chartState, captureInterestCharts, createInterestStore, shouldBlockResource, pageDiagnostic };
