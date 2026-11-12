const assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),{chromium}=require('playwright');
// VI window (2026-11-12): after a refresh the sort arrows must be there before the first data arrives (they used to
// appear only after data or a click). VI_SCRIPT=<file> serves another vi-monitor.js (to check the old one fails).
(async()=>{
 const app=express();
 // The stream answers but sends no data yet (slow server / reconnecting window).
 app.get('/api/vi-monitor/stream',(req,res)=>{res.set({'Content-Type':'text/event-stream'});res.flushHeaders();});
 if(process.env.VI_SCRIPT)app.get('/vi-monitor.js',(req,res)=>res.type('js').send(fs.readFileSync(process.env.VI_SCRIPT,'utf8')));
 app.use(express.static('public'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/vi-monitor.html');await page.waitForTimeout(800);
  const icons=await page.evaluate(()=>[...document.querySelectorAll('[data-sort]')].map(b=>[b.dataset.sort,!!b.querySelector('.sort-icon svg')]));
  assert.ok(icons.length>=14);
  assert.deepEqual(icons.filter(([,on])=>!on).map(([k])=>k),[],'every sortable column shows its arrows before any data');
  assert.equal(await page.locator('th[aria-sort="descending"] [data-sort="startedAt"]').count(),1,'default sort is 발동 시각, newest first');
  assert.deepEqual(errors,[]);console.log('vi sort icons ok');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);process.exit(1);});
