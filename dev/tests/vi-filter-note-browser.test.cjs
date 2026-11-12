const assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
// VI window (2026-11-12): "값 확인 전이라 빠진 행 n건" sits right of the clock in the title line. When the window is narrow it is
// cut with … before it reaches the filters · checkboxes (which stay on the same line), and the full text is the hover title.
(async()=>{
 const now=Date.now(),rows=Array.from({length:12},(_,i)=>({code:String(100000+i),exchange:'KRX',name:'종목'+i,market:'K',kind:'2',active:true,startedAt:now-1000*i,rate:1,amount:100,futures:{},prevAmount:null,prevAmountState:'pending',gapHit:{kind:'NXT'}}));
 const app=express();
 app.get('/api/vi-monitor/stream',(req,res)=>{res.set({'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({rows,connection:'ok'})+'\n\n');});
 app.use(express.static('public'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/vi-monitor.html');await page.waitForSelector('#viBody tr');
  await page.selectOption('#viPrevAmount','2e10');
  await page.waitForFunction(()=>document.getElementById('viFilterNote').textContent.includes('12건'));
  const box=sel=>page.locator(sel).boundingBox();
  const layout=async()=>{const [clock,note,controls,gap]=await Promise.all(['#viClock','#viFilterNote','.vi-controls','#viGapOnly'].map(box));
   const cut=await page.evaluate(()=>{const n=document.getElementById('viFilterNote');return {cut:n.scrollWidth>n.clientWidth,title:n.title,ellipsis:getComputedStyle(n).textOverflow};});return {clock,note,controls,gap,...cut};};
  let l=await layout();
  assert.ok(l.note.x>=l.clock.x+l.clock.width,'right of the clock');assert.ok(Math.abs(l.note.y-l.clock.y)<8,'on the title line');
  assert.ok(l.note.x+l.note.width<=l.controls.x+1,'left of the filters');assert.equal(l.cut,false,'wide window: the whole text');
  assert.equal(l.title,'값 확인 전이라 빠진 행 12건');
  // Narrow (1100px: title, clock and controls still fit on one line): cut with …, left of the controls. Below about 950px the controls wrap as before.
  await page.setViewportSize({width:1100,height:600});await page.waitForTimeout(100);l=await layout();
  assert.equal(l.ellipsis,'ellipsis');assert.equal(l.cut,true,'narrow window: cut');
  assert.ok(l.note.x+l.note.width<=l.controls.x+1,'does not run into the filters · checkboxes');
  assert.ok(Math.abs(l.gap.y-l.clock.y)<12,'the checkbox stays on the title line');
  assert.equal(l.title,'값 확인 전이라 빠진 행 12건','hover shows the whole text');
  assert.deepEqual(errors,[]);console.log('vi filter note ok');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
