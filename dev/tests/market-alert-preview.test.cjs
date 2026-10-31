const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
    const origin = process.argv[2];
    assert.match(origin || '', /^http:\/\/127\.0\.0\.1:\d+$/);
    const browser = await chromium.launch({ headless:true, channel:'msedge' });
    try {
        const page = await browser.newPage({ viewport:{width:1900,height:1000} });
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(origin);
        await page.getByRole('button',{name:'1단계 다시 수신'}).click();
        await page.waitForFunction(()=>document.querySelector('#tab_rank').classList.contains('market-alert-unread'));
        const geometry=()=>page.locator('#tab_rank .panel').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
        const before=await geometry();
        await page.screenshot({path:'dev/output/market-alert-tab-stage1-unread.png'});
        const clickBackground=async()=>{const r=await page.locator('#tab_rank .grid-container').boundingBox();await page.mouse.click(r.x+r.width/2,r.y-4);};
        await page.locator('#tab_rank header h1').click();
        await page.waitForFunction(()=>!document.querySelector('#tab_rank').classList.contains('market-alert-unread'));
        assert.deepEqual(await geometry(),before);
        assert.equal(await page.locator('#tab_rank').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 153, 153)');
        await page.screenshot({path:'dev/output/market-alert-tab-stage1-acknowledged.png'});
        const peer=await browser.newPage({viewport:{width:1100,height:1000}});
        peer.on('pageerror',error=>errors.push(error.message));await peer.goto(origin+'/independent');
        await peer.waitForFunction(()=>document.querySelector('.market-alert-banner')?.textContent==='코스피 서킷브레이커 1단계');
        assert.equal(await peer.locator('.market-alert-status').count(),0);
        await page.getByRole('button',{name:'1단계 다시 수신'}).click();
        await peer.waitForFunction(()=>document.querySelector('#tab_rank').classList.contains('market-alert-unread'));
        await peer.locator('.market-alert-banner').click();
        assert.equal(await page.locator('#tab_rank.market-alert-unread').count(),1,'Independent click must not acknowledge');
        await clickBackground();
        await page.waitForFunction(()=>!document.querySelector('#tab_rank').classList.contains('market-alert-unread'));
        await peer.waitForFunction(()=>!document.querySelector('#tab_rank').classList.contains('market-alert-unread'));
        await peer.waitForFunction(()=>getComputedStyle(document.querySelector('#tab_rank')).backgroundColor==='rgb(255, 153, 153)');
        assert.equal(await peer.locator('#tab_rank').evaluate(n=>getComputedStyle(n).animationName),'none');
        assert.equal(await peer.locator('.market-alert-header').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 153, 153)');
        await peer.screenshot({path:'dev/output/market-alert-tab-independent-stage1.png'});
        await page.getByRole('button',{name:'1단계 해제 수신'}).click();
        await page.waitForFunction(()=>document.querySelector('.market-alert-banner')?.textContent.includes('해제(10:20:00)'));
        assert.equal(await page.locator('#tab_rank').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 153, 153)');
        await page.screenshot({path:'dev/output/market-alert-tab-stage1-released.png'});
        await page.getByRole('button',{name:'장 종료 수신'}).click();
        await page.waitForFunction(()=>!document.querySelector('#tab_rank').dataset.alertColor);
        // Leave the manual preview waiting for the user's own confirmation click.
        await page.getByRole('button',{name:'1단계 다시 수신'}).click();
        await page.waitForFunction(()=>document.querySelector('#tab_rank').classList.contains('market-alert-unread'));
        assert.deepEqual(errors,[]);
        console.log('PASS preview: title-row stage 1, main-background-only acknowledgement, unchanged card geometry/borders, shared light color, release time and session close; left unread for manual review');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
