const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
test('VI window i sits at the top right and opens the VI source, plan, caveat and test guide',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1300,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Real page markup without its live data script; the guide scripts and styles are added the same way the page loads them.
  const html=fs.readFileSync('public/vi-monitor.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  await page.route('http://vi-page.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('http://vi-page.test/vi-monitor.html');
  const links=[...fs.readFileSync('public/vi-monitor.html','utf8').matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(m=>m[1]);
  assert.ok(links.includes('data-collection-info.css'),String(links));
  await page.addStyleTag({content:links.map(f=>fs.readFileSync('public/'+f,'utf8')).join('\n')});
  for(const f of ['data-collection-info.js','vi-monitor-info.js'])await page.addScriptTag({content:fs.readFileSync('public/'+f,'utf8')});
  await page.waitForSelector('.vi-controls .vi-info-button');
  const box=await page.evaluate(()=>{const b=document.querySelector('.vi-info-button').getBoundingClientRect(),p=document.querySelector('.vi-panel .panel-header').getBoundingClientRect(),c=document.getElementById('viTopmost').getBoundingClientRect();
   return {right:p.right-b.right,top:b.top-p.top,afterTopmost:b.left>c.right,count:document.querySelectorAll('.vi-info-button').length,trading:!!document.querySelector('.data-collection-info')};});
  assert.ok(box.right<30&&box.top<20&&box.afterTopmost&&box.count===1&&!box.trading,JSON.stringify(box));
  await page.click('.vi-info-button');
  const view=await page.evaluate(()=>{const d=document.getElementById('viMonitorGuide'),r=d.getBoundingClientRect(),text=d.textContent;
   return {open:d.open,width:r.width,titles:[...d.querySelectorAll('.data-collection-category > h3')].map(h=>h.textContent),
    tables:[...d.querySelectorAll('table')].map(t=>t.parentElement.scrollWidth-t.parentElement.clientWidth),
    has:['releaseTime','SOR(_AL)','연결당 30건','보안 알림','KA116B000','masters.json','VI_REALTIME','3,110건','73/73','JIF','[실시간-키움VI]'].filter(s=>!text.includes(s)),plan:text.includes('변경 예정')||text.includes('적용 전')};});
  assert.equal(view.open,true);
  assert.ok(view.width>=1200,String(view.width));
  assert.deepEqual(view.titles,['받는 데이터','이렇게 받는 이유','주의할 점','시험 결과']);
  assert.ok(view.tables.every(s=>s<=1),JSON.stringify(view.tables));
  assert.deepEqual(view.has,[]);assert.equal(view.plan,false,'The guide describes the applied layout');
  const dir=path.join(os.tmpdir(),'market-through-tests','vi-monitor-info');fs.mkdirSync(dir,{recursive:true});
  await page.locator('#viMonitorGuide').screenshot({path:path.join(dir,'dialog.png')});
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.getElementById('viMonitorGuide').open),false);
  await page.screenshot({path:path.join(dir,'window.png')});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
