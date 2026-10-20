const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
        await page.setContent('<div class="concentration-timeframe-row"><div class="concentration-header-actions"><button>과거</button><button class="concentration-candle-toggle">캔들차트</button></div></div>'
            + ['adr','turnover','breadth','volatility','sentiment','supply'].map(type => `<section class="rank-${type}-panel"><div class="rank-adr-controls"><button>일봉</button><span class="rank-adr-ranges" hidden>기간</span><button class="concentration-candle-toggle">캔들차트</button></div></section>`).join(''));
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') });
        const gaps = await page.locator('.concentration-candle-toggle').evaluateAll(buttons => buttons.map(button => {
            const visible = [...button.parentElement.children].filter(el => el.getClientRects().length);
            const previous = visible[visible.indexOf(button) - 1];
            return button.getBoundingClientRect().left - previous.getBoundingClientRect().right;
        }));
        assert.equal(gaps.length, 7); assert.ok(gaps.every(gap => Math.abs(gap - 10) < .1), JSON.stringify(gaps));
        console.log('PASS all seven chart candle buttons use the same 10px gap.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
