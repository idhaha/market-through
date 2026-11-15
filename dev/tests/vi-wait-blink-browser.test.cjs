'use strict';
// 2026-11-14: a futures row blinks in the 30 seconds before its 5 minutes; once it is "해제 대기" it stops blinking
// (color and the red text stay). A VI row past its expected release keeps blinking until the release arrives.
const assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
(async()=>{
    const now=Date.now(),base={market:'K',direction:'up',active:true,gapHit:{at:now,kind:'KRX',value:1.5},gap:{KRX:-1.5,NXT:'미지원',FUT:'Base'},cpower:null};
    const rows=[
        {...base,code:'000001',name:'대기',exchange:'FUT',contract:{code:'A116C000',month:'202612'},kind:'LIMIT',kindText:'+10% 도달',limit:{side:'up',stage:1,price:110000},startedAt:now-360000,durationMs:300000,waiting:true},
        {...base,code:'000002',name:'곧확대',exchange:'FUT',contract:{code:'A126C000',month:'202612'},kind:'LIMIT',kindText:'+10% 도달',limit:{side:'up',stage:1,price:110000},startedAt:now-285000,durationMs:300000},
        {...base,code:'000003',name:'VI지남',exchange:'KRX',kind:'1',startedAt:now-130000,durationMs:120000,gap:{KRX:'Base',NXT:1.5,FUT:'미지원'}}
    ];
    const app=express();app.get('/api/vi-monitor/stream',(req,res)=>{res.set({'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({rows,connection:'ok'})+'\n\n');});
    app.use(express.static('public'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const browser=await chromium.launch({headless:true,channel:'msedge'});
    try{
        const page=await browser.newPage({viewport:{width:1700,height:500}});
        await page.goto('http://127.0.0.1:'+server.address().port+'/vi-monitor.html');await page.waitForSelector('#viBody td.name');await page.waitForTimeout(200);
        const state=code=>page.locator(`#viBody tr[data-code="${code}"]`).evaluate(el=>({blink:el.classList.contains('vi-blink'),flash:el.classList.contains('vi-flash-up'),text:el.cells[11].textContent}));
        assert.deepEqual(await state('000001'),{blink:false,flash:true,text:'해제 대기'},'해제 대기: no blink, the color stays');
        assert.equal((await state('000002')).blink,true,'the last 30 seconds before the 5 minutes blink');
        assert.deepEqual(await state('000003'),{blink:true,flash:true,text:'00:00:00'},'a VI row keeps blinking while it waits for the release');
        assert.equal(await page.locator('#viBody tr[data-code="000001"] td').nth(11).getAttribute('class'),'countdown soon','red 해제 대기 text');
        console.log('PASS 해제 대기 rows stop blinking; VI rows still blink until the release');
    }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
