const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { createMarketAlerts } = require('../../market-alert-service');
(async () => {
    const browser = await chromium.launch({headless:true,channel:'msedge'});
    try {
        const context=await browser.newContext();
        let clock=Date.parse('2026-10-30T10:00:00+09:00');
        const service=createMarketAlerts({now:()=>clock});
        const emit=(status,market='1')=>service.receive(JSON.stringify({header:{tr_cd:'JIF'},body:{jangubun:market,jstatus:status}}));
        const errors=[];
        const html=file=>fs.readFileSync(file,'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
        const mainHtml=html('public/index.html'),peerHtml=html('public/rank-independent.html');
        await context.route('http://market.test/**',async route=>{
            const url=new URL(route.request().url());
            if(url.pathname.startsWith('/api/market-alerts')) {
                const state=route.request().method()==='POST'?service.acknowledge('owner',route.request().postDataJSON().ids):service.snapshot('owner');
                return route.fulfill({json:state});
            }
            if(url.pathname==='/'||url.pathname==='/peer')return route.fulfill({contentType:'text/html',body:url.pathname==='/'?mainHtml:peerHtml});
            const file='public'+url.pathname;
            if(fs.existsSync(file))return route.fulfill({contentType:file.endsWith('.css')?'text/css':'application/javascript',body:fs.readFileSync(file,'utf8')});
            return route.fulfill({status:404,body:''});
        });
        async function open(independent=false) {
            const page=await context.newPage({viewport:{width:1450,height:1100}});
            page.on('pageerror',e=>errors.push(e.message));
            await page.goto('http://market.test'+(independent?'/peer':'/'));
            await page.addStyleTag({url:'/style.css'});await page.addStyleTag({url:'/market-alerts.css'});
            if(independent)await page.addStyleTag({url:'/rank-independent.css'});
            await page.evaluate(independent=>{
                window.rankIndependentClient=independent;
                document.querySelector('#tabContents')?.style.setProperty('display','block');
                document.querySelector('#loginOverlay')?.remove();
            },independent);
            await page.addScriptTag({url:'/market-alert-data.js'});await page.addScriptTag({url:'/market-alerts.js'});
            if (!independent) await page.addScriptTag({url:'/tab-scroll-layout.js'});
            await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
            await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
            return page;
        }
        const main=await open(),peer=await open(true);
        const push=page=>page.evaluate(detail=>window.dispatchEvent(new CustomEvent('market-alert-state',{detail})),service.snapshot('owner'));
        const layout=page=>page.locator('#tab_rank .panel').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
        const decorations=page=>page.locator('#tab_rank .panel').first().evaluate(n=>{const s=getComputedStyle(n);return [s.borderTopColor,s.boxShadow,s.backgroundColor,s.animationName];});
        const background=page=>page.locator('#tab_rank').evaluate(n=>getComputedStyle(n).backgroundColor);
        const clickBackground=async page=>{const r=await page.locator('#tab_rank .grid-container').boundingBox();await page.mouse.click(r.x+r.width/2,r.y-4);};
        assert.equal(await peer.locator('.market-alert-status').count(),0);
        assert.equal(await peer.locator('.market-alert-info-icon').count(),0,'Independent window has no market guide icon');
        assert.deepEqual(await peer.locator('.independent-toolbar').evaluate(n=>[n.firstElementChild.id,n.querySelector('#rankRefreshStatus').nextElementSibling.id]),['rankRefreshStatus','marketAlertArea']);
        await main.locator('.status-info').evaluate(row => {
            const separators = row.querySelectorAll('.status-separator');
            if (separators.length !== 2) throw new Error('JIF separator missing');
            const appearance = node => { const s = getComputedStyle(node); return [s.color, s.opacity, s.fontSize].join('|'); };
            if (appearance(separators[0]) !== appearance(separators[1])) throw new Error('Separator styles differ');
            const nodes = [...row.children];
            const gap = parseFloat(getComputedStyle(row).columnGap);
            for (let i = 1; i < nodes.length; i++) {
                const actual = nodes[i].getBoundingClientRect().left - nodes[i - 1].getBoundingClientRect().right;
                if (Math.abs(actual - gap) > 0.1) throw new Error('Unequal loading/JIF spacing');
            }
        });
        assert.equal(await main.locator('.market-alert-info').evaluate(n=>n.tagName),'SPAN');
        assert.deepEqual(await main.locator('.market-alert-info-icon').evaluate(n=>{const s=getComputedStyle(n);return [s.width,s.height,s.borderRadius,s.fontFamily];}),['20px','20px','50%','Georgia, serif']);
        await main.getByRole('button',{name:'시장경보'}).click();
        assert.match(await main.locator('dialog').innerText(),/코스닥150/);
        assert.ok(await main.locator('dialog').evaluate(n=>n.getBoundingClientRect().width>1200));
        assert.ok(await main.locator('dialog td').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).whiteSpace==='nowrap')));
        assert.equal(await main.locator('.market-alert-guide-note').count(),2);
        assert.ok(await main.locator('.market-alert-guide-footnote').evaluate(n=>parseFloat(getComputedStyle(n).marginTop)>=42));
        await main.keyboard.press('Escape');
        // The legacy flex/table layout can converge by fractional pixels over its
        // first paints. Capture the baseline only once consecutive frames agree.
        await peer.waitForFunction(()=>{
            const value=JSON.stringify([...document.querySelectorAll('#tab_rank .panel')].map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
            const old=window.__marketAlertLayoutBaseline;
            const stable=old?.value===value?(old.stable+1):0;
            window.__marketAlertLayoutBaseline={value,stable};return stable>=3;
        },null,{polling:'raf'});
        const originalMain=await layout(main),originalPeer=await layout(peer),originalDecorations=await decorations(main);
        const loading=await main.locator('.status-info').boundingBox();
        emit('61');await push(main);await push(peer);
        assert.deepEqual(await layout(main),originalMain,'Alert must not shift main cards');
        assert.deepEqual(await layout(peer),originalPeer,'Alert must not shift independent cards');
        assert.deepEqual(await main.locator('.status-info').boundingBox(),loading,'Loading row geometry must be unchanged');
        assert.equal(await main.locator('#marketAlertArea').evaluate(n=>!!n.closest('.header-single-line')),true);
        assert.equal(await main.locator('.market-alert-status').evaluate(n=>getComputedStyle(n).visibility),'visible');
        assert.match(await main.locator('.market-alert-banner').innerText(),/발동\(10:00:00\)/);
        assert.doesNotMatch(await main.locator('.market-alert-banner').innerText(),/미확인|클릭하여|확인됨/);
        assert.equal(await main.locator('.market-alert-banner button,.market-alert-ack').count(),0);
        assert.equal(await peer.locator('.market-alert-banner').innerText(),'코스피 서킷브레이커 1단계');
        assert.equal(await main.evaluate(()=>getComputedStyle(document.querySelector('.market-alert-header')).backgroundColor === getComputedStyle(document.querySelector('#tab_rank')).backgroundColor),true,'Main title must inherit the current tab color');
        assert.equal(await peer.locator('.market-alert-header').evaluate(n=>getComputedStyle(n).animationName),'market-alert-background');
        const phases=await peer.evaluate(()=>['.market-alert-header','#tab_rank'].map(selector=>document.querySelector(selector).getAnimations()[0].effect.getComputedTiming().progress));
        assert.equal(phases[0],phases[1],'Independent title and body animation phases must match');
        assert.deepEqual(await main.locator('.market-alert-detail').allTextContents(),['[조건] 지수가 전일 종가 대비 8% 이상 하락하여 1분간 지속','[조치] 20분간 매매 중단 → 이후 10분간 단일가 매매 후 재개']);
        assert.deepEqual(await decorations(main),originalDecorations,'Cards must keep original borders, background and animation');
        assert.equal(await main.locator('#tab_rank').evaluate(n=>getComputedStyle(n).animationName),'market-alert-background');
        assert.equal(await main.locator('#tab_rank').evaluate(n=>getComputedStyle(n).getPropertyValue('--alert-bright').trim()),'#ff9999');
        await main.locator('#manualRefresh').click();await main.locator('#tab_rank .panel h2').first().click();
        assert.equal(service.snapshot('owner').events[0].acknowledged,false,'Controls and card content must not confirm');
        await peer.locator('.market-alert-banner').click();
        await peer.locator('#tab_rank').click({position:{x:2,y:2}});
        assert.equal(service.snapshot('owner').events[0].acknowledged,false,'Independent window must remain read-only');
        await peer.locator('#rankConnectionStatus').evaluate(n=>{n.textContent='';});
        assert.equal(await peer.locator('.market-alert-banner').isVisible(),true);
        // Confirm from the darkest frame, rather than relying on click timing.
        await main.locator('#tab_rank').evaluate(async n => { const animation = n.getAnimations()[0]; animation.pause(); await animation.ready; animation.currentTime = animation.effect.getTiming().delay + 1500; });
        assert.equal(await background(main),'rgb(201, 0, 0)');
        await main.locator('#tab_rank header h1').click();
        await main.waitForFunction(()=>!document.querySelector('#tab_rank').classList.contains('market-alert-unread'));
        await push(peer);
        assert.equal(await background(main),'rgb(255, 153, 153)');assert.equal(await background(peer),await background(main));
        assert.equal(await main.locator('.market-alert-header').evaluate(n=>getComputedStyle(n).backgroundColor),await background(main),'Main title must use the brightest background after acknowledgement');
        assert.equal(await main.locator('.market-alert-header').evaluate(n=>getComputedStyle(n).animationName),'none');
        assert.equal(await peer.locator('.market-alert-header').evaluate(n=>getComputedStyle(n).backgroundColor),await background(main));
        assert.equal(await peer.locator('.market-alert-header').evaluate(n=>getComputedStyle(n).animationName),'none');
        assert.deepEqual(await layout(main),originalMain);
        assert.equal(await main.locator('#tab_rank').evaluate(n=>getComputedStyle(n).animationName),'none');
        assert.equal(await main.locator('#tab_rank').evaluate(n=>n.getAnimations().length),0,'Acknowledgement must remove the animation, including paused effects');
        clock+=20*60000;emit('62');await push(main);await push(peer);
        assert.match(await main.locator('.market-alert-banner').innerText(),/발동\(10:00:00\) 해제\(10:20:00\)/);
        assert.equal(await background(main),'rgb(255, 153, 153)','Release must retain acknowledged light background');
        clock+=10*60000;emit('63');await push(main);
        assert.match(await main.locator('.market-alert-banner').innerText(),/재개\(10:30:00\)/);
        assert.equal(await background(main),'rgb(255, 153, 153)');
        clock+=60000;emit('68');await push(main);await push(peer);
        assert.equal(await peer.locator('.market-alert-banner').innerText(),'코스피 서킷브레이커 2단계');
        assert.equal(await main.locator('#tab_rank.market-alert-unread').count(),1,'New stage must rearm blinking');
        const stale=service.snapshot('owner');await clickBackground(main);
        await main.waitForFunction(()=>!document.querySelector('#tab_rank').classList.contains('market-alert-unread'));
        await main.evaluate(detail=>window.dispatchEvent(new CustomEvent('market-alert-state',{detail})),stale);
        assert.equal(await main.locator('#tab_rank.market-alert-unread').count(),0,'Stale snapshot must not undo acknowledgement');
        emit('70');await push(main);emit('66','2');await push(main);await push(peer);
        assert.deepEqual(await peer.locator('.market-alert-banner').allTextContents(),['코스피 서킷브레이커 2단계','사이드카 코스닥']);
        assert.equal(await main.locator('#tab_rank').getAttribute('data-alert-color'),'orange');
        await main.emulateMedia({reducedMotion:'reduce'});
        assert.equal(await main.locator('#tab_rank').evaluate(n=>getComputedStyle(n).animationName),'none');
        assert.equal(await background(main),'rgb(255, 237, 213)');
        await main.setViewportSize({width:390,height:844});
        await main.getByRole('button',{name:'시장경보'}).click();
        assert.ok(await main.locator('dialog').evaluate(n=>n.getBoundingClientRect().width<=innerWidth));await main.keyboard.press('Escape');
        emit('41');emit('41','2');await push(main);await push(peer);
        assert.equal(await main.locator('.market-alert-banner').count(),0);
        assert.equal(await main.locator('#tab_rank').getAttribute('data-alert-color'),null,'Session close clears background');
        assert.equal(await peer.locator('#tab_rank').getAttribute('data-alert-color'),null);
        assert.deepEqual(errors,[]);
        console.log('PASS title-row timeline, intact loading/cards, whole-tab blinking, main-background-only acknowledgement, shared light color, release/resume persistence, stage rearm and session close');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
