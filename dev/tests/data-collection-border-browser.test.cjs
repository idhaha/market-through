const assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
// "i" tables (VI window): a table whose height ends on a fraction of a pixel lost its bottom border to the
// overflow-x scroll box (2026-11-12). Every table must fit inside its box at common zoom levels.
(async()=>{
 const app=express();app.get('/api/vi-monitor/stream',(req,res)=>{res.set({'Content-Type':'text/event-stream'});res.flushHeaders();});
 app.use(express.static('public'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  for(const deviceScaleFactor of [1,1.25,1.5]){
   const page=await browser.newPage({viewport:{width:1500,height:900},deviceScaleFactor});
   await page.goto('http://127.0.0.1:'+server.address().port+'/vi-monitor.html');await page.locator('.vi-info-button').click();await page.waitForSelector('.data-collection-scroll table');
   const over=await page.evaluate(()=>[...document.querySelectorAll('.data-collection-scroll')].map(d=>d.querySelector('table').getBoundingClientRect().height-d.clientHeight));
   assert.ok(over.length>=2);assert.ok(over.every(v=>v<=0),`배율 ${deviceScaleFactor}: 표가 상자보다 큼 ${over.map(v=>v.toFixed(2))}`);
   await page.close();
  }
  console.log('info table borders ok');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);process.exit(1);});
