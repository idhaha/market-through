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

function resolveBrowserPath() {
    const configured = process.env.CENTRAL_BANKS_CHROMIUM_PATH;
    if (configured) {
        if (!fs.existsSync(configured)) throw new Error('CENTRAL_BANKS_CHROMIUM_PATH의 브라우저 실행 파일이 없습니다.');
        return configured;
    }
    // Match the user's working script when Playwright's browser is installed.
    if (fs.existsSync(chromium.executablePath())) return chromium.executablePath();
    const existingChrome = puppeteer.executablePath();
    if (fs.existsSync(existingChrome)) return existingChrome;
    throw new Error('Chromium 실행 파일이 없습니다. npx playwright install chromium으로 설치해 주세요.');
}

async function dismissPopups(page) {
    const selectors = ['#onetrust-accept-btn-handler', 'button[aria-label="Close"]', 'button[aria-label="닫기"]',
        '[aria-label="Close"]', '[aria-label="닫기"]', 'button:has-text("×")', 'button:has-text("✕")',
        '[class*="close"]', '[class*="Close"]', '[data-test*="close"]', '[data-test*="Close"]'];
    const deadline = Date.now() + 2000;
    for (const frame of page.frames()) {
        for (const selector of selectors) {
            const elements = frame.locator(selector);
            const count = await elements.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
                if (Date.now() >= deadline) return;
                try {
                    const element = elements.nth(i);
                    if (await element.isVisible()) {
                        await element.click({ timeout: Math.min(500, Math.max(1, deadline - Date.now())) });
                        return;
                    }
                } catch { /* Try the next visible close control. */ }
            }
        }
    }
    await page.keyboard.press('Escape');
}

async function captureCentralBanks() {
    let stage = 'browser';
    let browser;
    try {
        browser = await chromium.launch({
            headless: true, executablePath: resolveBrowserPath(),
            args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox']
        });
        const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'ko-KR',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36' });
        const page = await context.newPage();
        page.setDefaultTimeout(2000);
        page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
        await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
        stage = 'navigation';
        const response = await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
        if (response && response.status() >= 400) throw new Error(`Investing.com HTTP ${response.status()}`);
        await page.waitForTimeout(1000);
        await dismissPopups(page);
        stage = 'table';
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            const tables = page.locator('table');
            for (let i = 0, count = await tables.count(); i < count; i++) {
                const table = tables.nth(i);
                let matches = false;
                try {
                    matches = await table.isVisible() && matchesTable(await table.innerText({ timeout: Math.max(1, Math.min(500, deadline - Date.now())) }));
                } catch {
                    // A rerender may detach an individual table; continue polling.
                    continue;
                }
                if (matches) {
                    stage = 'screenshot';
                    await table.scrollIntoViewIfNeeded();
                    const box = await table.boundingBox();
                    if (!box || !box.width || !box.height) { stage = 'table'; continue; }
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
    } catch (error) {
        error.captureStage = stage;
        throw error;
    } finally {
        if (browser) await browser.close();
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

module.exports = { SOURCE_URL, dayKey, matchesTable, captureCentralBanks, createDailyCapture, resolveBrowserPath, dismissPopups };
