const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
test('trading tab 데이터 수집 i sits just left of the note and opens a readable three-part guide',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  await page.route('http://market-page.test/**',route=>{const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   return route.fulfill({json:{success:true}});});
  await page.goto('http://market-page.test/');
  await page.addStyleTag({content:['style.css','market-alerts.css','quick-note.css','data-collection-info.css'].map(f=>fs.readFileSync('public/'+f,'utf8')).join('\n')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
  for(const f of ['quick-note.js','data-collection-info.js'])await page.addScriptTag({content:fs.readFileSync('public/'+f,'utf8')});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.waitForSelector('#tab_rank .data-collection-info');
  const order=await page.evaluate(()=>{const info=document.querySelector('#tab_rank .data-collection-info');return {next:info.nextElementSibling?.id,count:document.querySelectorAll('.data-collection-info').length};});
  assert.deepEqual(order,{next:'quickNoteButton',count:1});
  const box=await page.evaluate(()=>{const a=document.querySelector('.data-collection-info').getBoundingClientRect(),b=document.getElementById('quickNoteButton').getBoundingClientRect();return {gap:b.left-a.right,sameRow:Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)<12};});
  assert.ok(box.sameRow&&box.gap>=0&&box.gap<20,JSON.stringify(box));
  await page.click('.data-collection-info .market-alert-info-icon');
  const view=await page.evaluate(()=>{const d=document.getElementById('dataCollectionGuide'),r=d.getBoundingClientRect();
   const titles=[...d.querySelectorAll('.data-collection-category > h3')].map(h=>({text:h.textContent,size:parseFloat(getComputedStyle(h).fontSize)}));
   const body=parseFloat(getComputedStyle(d.querySelector('td')).fontSize);
   const tables=[...d.querySelectorAll('table')].map(t=>({width:t.getBoundingClientRect().width,scroll:t.parentElement.scrollWidth-t.parentElement.clientWidth}));
   const text=d.textContent;
   return {open:d.open,width:r.width,titles,body,tables,gap:d.querySelectorAll('.data-collection-category')[1].getBoundingClientRect().top-d.querySelectorAll('.data-collection-category')[0].getBoundingClientRect().bottom,
    has:['※ 키움 ka10060 · ka90008 [정기-키움종목]로도 수집 가능','※ LS t1717(투자자) · t1637(프로그램) [정기-LS종목]로도 수집 가능','kiwoom-market-supply','저장 안 함','t1717은 투자자, t1637은 프로그램','트레이딩 탭의 표 4개는 저장하지 않고','[조회]','실시간-키움VI','VI 모니터 (별도 창)','로컬 서버에서만'].map(s=>text.includes(s)),noRequest:!text.includes('요청')&&!text.includes('오늘 추가')&&text.includes('EGW00121')&&!text.includes('대체 원천으로 수집만')&&text.includes('ALT_SUPPLY_COLLECTION=on')&&!text.includes('LS2')&&!text.includes('변경 예정')};});
  assert.equal(view.open,true);
  assert.ok(view.width>=1400,JSON.stringify(view.width));
  assert.deepEqual(view.titles.map(t=>t.text),['받는 방식 묶음','표 5개','차트 10개','토큰']);
  for(const t of view.titles)assert.ok(t.size>view.body+2,JSON.stringify(view));
  assert.ok(view.gap>=24,String(view.gap));
  for(const t of view.tables)assert.ok(t.scroll<=1&&t.width<=view.width,JSON.stringify(view.tables));
  assert.deepEqual(view.has,[true,true,true,true,true,true,true,true,true,true]);assert.equal(view.noRequest,true);
  const dir=path.join(os.tmpdir(),'market-through-tests','data-collection-info');fs.mkdirSync(dir,{recursive:true});
  await page.locator('#dataCollectionGuide').screenshot({path:path.join(dir,'dialog.png')});
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.getElementById('dataCollectionGuide').open),false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
