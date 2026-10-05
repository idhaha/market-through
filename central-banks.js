const { chromium } = require('playwright');
const fs = require('fs');
const puppeteer = require('puppeteer');

const SOURCE_URL = 'https://kr.investing.com/central-banks/';
const dayKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date);
const headers = ['중앙 은행', '현재 금리', '다음 회의', '마지막 변경'];
const banks = ['한국 은행', '연방준비은행', '유럽중앙은행', '영국은행', '스위스 국제은행', '호주 연방준비은행', '캐나다 은행', '일본 은행', '러시아 연방중앙은행', '인도 연방준비은행', '중국인민은행', '브라질 중앙은행'];
const normalize = text => text.replace(/\s+/g, '');
function matchesTable(text) {
    const value = normalize(text);
    return headers.every(header => value.includes(normalize(header))) && banks.filter(bank => value.includes(normalize(bank))).length >= 4;
}

async function captureCentralBanks() {
    // Reuse the Chromium already installed for this application's Puppeteer routes.
    const installedChrome = process.env.CENTRAL_BANKS_CHROMIUM_PATH || puppeteer.executablePath();
    const browser = await chromium.launch({
        headless: true,
        ...(fs.existsSync(installedChrome) ? { executablePath: installedChrome } : {}),
        args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox']
    });
    try {
        const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'ko-KR',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' });
        const page = await context.newPage();
        page.setDefaultTimeout(2000);
        page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
        await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
        await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(1000);
        for (const frame of page.frames()) {
            for (const selector of ['#onetrust-accept-btn-handler', 'button[aria-label="Close"]', '[aria-label="닫기"]', '[data-test*="close"]', '[class*="popup"] [class*="close"]']) {
                try {
                    const button = frame.locator(selector).first();
                    if (await button.isVisible()) await button.click({ timeout: 500 });
                } catch { /* Popups may disappear while closing. */ }
            }
        }
        await page.keyboard.press('Escape');
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            const tables = page.locator('table');
            for (let i = 0, count = await tables.count(); i < count; i++) {
                const table = tables.nth(i);
                if (await table.isVisible() && matchesTable(await table.innerText({ timeout: 500 }))) {
                    await table.scrollIntoViewIfNeeded();
                    const box = await table.boundingBox();
                    if (!box || !box.width || !box.height) continue;
                    const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
                    // Chromium capture avoids Playwright's unbounded external-font wait.
                    // No path: PNG stays in memory, including on failure.
                    const session = await context.newCDPSession(page);
                    try {
                        const { data } = await session.send('Page.captureScreenshot', {
                            format: 'png', captureBeyondViewport: true,
                            clip: { x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height, scale: 1 }
                        });
                        return Buffer.from(data, 'base64');
                    } finally {
                        await session.detach();
                    }
                }
            }
            await page.waitForTimeout(Math.min(500, Math.max(0, deadline - Date.now())));
        }
        throw new Error('중앙은행 금리 테이블을 찾지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
        await browser.close();
    }
}

function createDailyCapture(capture = captureCentralBanks, today = dayKey) {
    let cached = null;
    let pending = null;
    return async function getCapture(forceRefresh = false) {
        if (pending) return pending;
        if (!forceRefresh && cached?.date === today()) return cached;
        if (!pending) {
            pending = (async () => {
                const png = await capture();
                cached = { date: today(), capturedAt: new Date().toISOString(), png };
                return cached;
            })().finally(() => { pending = null; });
        }
        return pending;
    };
}

module.exports = { SOURCE_URL, dayKey, matchesTable, captureCentralBanks, createDailyCapture };
