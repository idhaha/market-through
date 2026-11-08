const assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
// VI window: last column shows the KRX 10-level bid average with a size-based unit, sorts by amount, and the table follows the window width.
(async()=>{
 const now=Date.now(),row=(code,bidAverage,extra={})=>({code,exchange:'KRX',name:'종목'+code,market:'K',kind:'2',active:true,startedAt:now-1000*Number(code.slice(-1)),rate:1,amount:100,nxtRate:0,futures:{},bidAverage,bidAverageAt:now,...extra});
 const rows=[row('000001',2345678901),row('000002',45678900),row('000003',812345),row('000004',null),row('000005',3.2e13),row('000006',5000)];
 const app=express();
 app.get('/api/vi-monitor/stream',(req,res)=>{res.set({'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({rows,connection:'ok'})+'\n\n');});
 app.use(express.static('public'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/vi-monitor.html');await page.waitForSelector('#viBody td.name');
  const header=page.locator('thead th').filter({has:page.locator('[data-sort="bidAverage"]')});
  assert.equal(await header.locator('.th-lines').innerText(),'KRX 매수10호가\n평균','The title breaks after 매수10호가');
  assert.equal(await page.locator('#viBody tr:first-child td').count(),13);
  const shown=async()=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#viBody tr')].map(tr=>[tr.dataset.code,tr.lastElementChild.textContent])));
  assert.deepEqual(await shown(),{'000001':'2.3십억','000002':'4.6천만','000003':'81.2만','000004':'—','000005':'3.2십조','000006':'5,000원'});
  assert.match(await page.locator('#viBody tr[data-code="000001"] td:last-child').getAttribute('title'),/2,345,678,901원/);
  await page.locator('[data-sort="bidAverage"]').click();
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('#viBody tr')].map(tr=>tr.dataset.code)),['000005','000001','000002','000003','000006','000004'],'Descending by amount, missing last');
  // Like the trading independent window, the table follows the window: it fills a wide window without blank space
  // and, at the default 1250px native window, shrinks (titles wrap) without a horizontal scroll bar.
  const fit=()=>page.evaluate(()=>{const table=document.querySelector('.vi-panel table'),wrapper=document.querySelector('.table-wrapper');return{table:table.getBoundingClientRect().width,panel:wrapper.clientWidth,scroll:wrapper.scrollWidth};});
  let size=await fit();assert.ok(Math.abs(size.table-size.panel)<=1,JSON.stringify(size));
  await page.setViewportSize({width:1250,height:600});await page.waitForTimeout(100);
  size=await fit();assert.ok(Math.abs(size.table-size.panel)<=1&&size.scroll<=size.panel,JSON.stringify(size));
  assert.equal(await header.locator('.th-lines').innerText(),'KRX 매수10호가\n평균','The two-line title keeps its own break');
  assert.deepEqual(errors,[]);
  console.log('PASS VI bid average column: two-line title, unit formatting, exact title, sorting and window-following width');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
