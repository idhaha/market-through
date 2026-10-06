const { chromium } = require('playwright');
const { SOURCE_URL, dayKey, resolveBrowserPath, dismissPopups } = require('./central-banks');

const BANKS = [
    ['FED', '연방준비제도'], ['ECB', '유럽중앙은행'], ['BOE', '영국은행'], ['BOJ', '일본은행'],
    ['BOK', '한국은행'], ['RBA', '호주 연방준비은행'], ['BOC', '캐나다 은행'], ['SNB', '스위스 국립은행'],
    ['RBI', '인도 연방준비은행'], ['BCB', '브라질 중앙은행'], ['CBR', '러시아 중앙은행'], ['PBOC', '중국인민은행']
].map(([code, name]) => ({ code, name }));

async function chartState(page) {
    return page.evaluate(() => {
        const section = document.querySelector('section#leftColumn');
        const selected = section?.querySelector('ul.tabsForBox li.selected a')?.textContent.trim() || '';
        const charts = (window.Highcharts?.charts || []).filter(chart => chart && section?.contains(chart.renderTo));
        const data = charts.map(chart => chart.series.map(series => (series.points || []).map(p => [p.x, p.y])));
        const ready = data.some(series => series.some(points => points.some(p => Number.isFinite(p[1]))));
        return { selected, ready, fingerprint: JSON.stringify(data) };
    });
}

async function captureInterestCharts(onChart) {
    let browser;
    try {
        const options = { headless: true, args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox'] };
        if (process.env.CENTRAL_BANKS_CHROMIUM_PATH) browser = await chromium.launch({ ...options, executablePath: resolveBrowserPath() });
        else {
            try { browser = await chromium.launch({ ...options, channel: 'chrome' }); }
            catch (error) {
                if (!/not found|doesn't exist|not installed|executable/i.test(error.message)) throw error;
                browser = await chromium.launch({ ...options, executablePath: resolveBrowserPath() });
            }
        }
        const context = await browser.newContext({ viewport: { width: 1400, height: 1200 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
        await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
        const response = await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (!response || response.status() >= 400) throw new Error(`중앙은행 페이지 접속 실패 (HTTP ${response?.status() || '응답 없음'})`);
        await page.waitForTimeout(5000);
        await dismissPopups(page);
        const section = page.locator('section#leftColumn').first();
        await section.waitFor({ state: 'visible' });
        for (const bank of BANKS) {
            try {
                const before = await chartState(page);
                const tab = section.locator('ul.tabsForBox a').filter({ hasText: new RegExp(`^${bank.code}$`) }).first();
                await tab.scrollIntoViewIfNeeded();
                await tab.click({ force: true });
                const deadline = Date.now() + 15000;
                let ready = false;
                while (Date.now() < deadline) {
                    const state = await chartState(page);
                    if (state.selected === bank.code && state.ready && (before.selected === bank.code || state.fingerprint !== before.fingerprint)) {
                        ready = true; break;
                    }
                    await page.waitForTimeout(300);
                }
                if (!ready) throw new Error('선택한 은행의 차트 데이터 변경을 확인하지 못했습니다.');
                await dismissPopups(page);
                await page.waitForTimeout(500);
                const chart = section.locator('svg').first();
                await chart.waitFor({ state: 'visible', timeout: 5000 });
                await chart.scrollIntoViewIfNeeded();
                const box = await chart.boundingBox();
                if (!box || box.width <= 0 || box.height <= 0) throw new Error('차트 영역을 찾지 못했습니다.');
                const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
                const session = await context.newCDPSession(page);
                try {
                    const { data } = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
                        clip: { x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height, scale: 1 } });
                    onChart({ ...bank, image: `data:image/png;base64,${data}`, error: null });
                } finally { await session.detach(); }
            } catch (error) {
                onChart({ ...bank, image: null, error: `${bank.code} 차트를 불러오지 못했습니다.` });
                console.error(`[Base Interest] ${bank.code}: ${error.message}`);
            }
        }
    } finally { if (browser) await browser.close(); }
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
        state = { id: ++serial, date: today(), capturedAt: null, status: 'loading', error: null, charts: BANKS.map(bank => ({ ...bank, image: null, error: null })) };
        const run = state;
        pending = true;
        Promise.resolve().then(() => capture(chart => {
            const index = run.charts.findIndex(bank => bank.code === chart.code);
            if (index >= 0) run.charts[index] = chart;
        })).then(() => {
            const succeeded = run.charts.filter(chart => chart.image).length;
            run.status = succeeded === BANKS.length ? 'ready' : succeeded ? 'partial' : 'error';
            run.capturedAt = new Date().toISOString();
            if (!succeeded) run.error = '기준금리 차트를 불러오지 못했습니다. 새로고침으로 다시 시도해 주세요.';
            if (succeeded) lastSuccess = run;
        }).catch(error => {
            run.status = 'error'; run.error = '기준금리 차트 조회에 실패했습니다. 새로고침으로 다시 시도해 주세요.';
            console.error('[Base Interest]', error.message);
        }).finally(() => {
            pending = false;
            if (run.status === 'error' && previous?.date === today()) state = { ...previous, refreshError: run.error };
        });
        return run;
    };
}

module.exports = { BANKS, chartState, captureInterestCharts, createInterestStore };
