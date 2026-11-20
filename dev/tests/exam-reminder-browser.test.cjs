// 수능일 미등록 알림(2026-11-20): 실제 index.html · style.css로 맨 위 바에 띄워, 알림이 있어도 바 높이 · 제목 · 오른쪽 버튼 · 트레이딩 표가
// 움직이지 않고 서로 겹치지 않는지, "오늘 숨기기"가 그날만 숨기는지 본다.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const MESSAGE='2027년 수능일이 개장 지연 표(market-open-delay.js)에 없습니다.';
async function open(browser,width,message){
 const page=await browser.newPage({viewport:{width,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 await page.route('http://market-page.test/**',route=>new URL(route.request().url()).pathname==='/'?route.fulfill({contentType:'text/html',body:html}):route.fulfill({json:{success:true}}));
 await page.goto('http://market-page.test/');
 await page.addStyleTag({content:['style.css','market-alerts.css','exam-reminder.css'].map(f=>fs.readFileSync('public/'+f,'utf8')).join('\n')+'#loginOverlay{display:none!important}#tabContainer{display:flex!important}#tabContents,#tab_rank{display:block!important}'});
 await page.evaluate(([message])=>{window.__calls=0;window.TradingRefresh={update:async()=>{window.__calls++;return {spot:true,futures:true,date:'2027-10-20',examReminder:message};}};},[message]);
 await page.addScriptTag({content:fs.readFileSync('public/exam-reminder.js','utf8')});
 await page.waitForFunction(()=>window.__calls>0);await page.waitForTimeout(50);
 const layout=await page.evaluate(()=>{const r=s=>{const e=document.querySelector(s).getBoundingClientRect();return {left:Math.round(e.left),right:Math.round(e.right),top:Math.round(e.top),bottom:Math.round(e.bottom)};};
  const box=document.getElementById('examReminder');
  return {bar:r('#tabContainer'),title:r('.service-title'),controls:r('.right-controls'),refresh:r('#globalRefreshBtn'),trade:r('#tab_rank header'),
   shown:!box.hidden,box:box.hidden?null:r('#examReminder'),button:box.hidden||getComputedStyle(box.querySelector('button')).display==='none'?null:r('#examReminder button'),mark:box.hidden?null:r('#examReminder .exam-reminder-mark'),boxScroll:box.scrollWidth-box.clientWidth};});
 return {page,layout,errors};
}
test('수능일 미등록 알림은 제목과 오른쪽 버튼 사이 빈 칸에만 뜨고 기존 구성을 밀지 않는다',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 const dir=path.join(os.tmpdir(),'market-through-tests','exam-reminder');fs.mkdirSync(dir,{recursive:true});
 try{
  for(const width of [1600,1100,860]){
   const on=await open(browser,width,MESSAGE),off=await open(browser,width,null);
   assert.equal(on.layout.shown,true,String(width));assert.equal(off.layout.shown,false);
   for(const k of ['bar','title','controls','refresh','trade'])assert.deepEqual(on.layout[k],off.layout[k],`${width} ${k}`);
   const {box,title,controls,button}=on.layout;
   assert.ok(box.left>=title.right&&box.right<=controls.left,JSON.stringify(on.layout));
   // 닫기 버튼은 보이면 알림 안에 있어야 하고, 빈 칸이 아주 좁으면(860px) ⚠만 남는다.
   if(button)assert.ok(button.right<=box.right&&button.left>=box.left,`${width} 닫기 버튼이 알림 안에 있어야 한다 `+JSON.stringify(on.layout));
   else assert.equal(width,860);
   const {mark}=on.layout;assert.ok(mark.left>=box.left&&mark.right<=box.right,`${width} ⚠가 알림 안에 보여야 한다 `+JSON.stringify(on.layout));
   assert.ok(box.top>=on.layout.bar.top&&box.bottom<=on.layout.bar.bottom);
   await on.page.locator('#tabContainer').screenshot({path:path.join(dir,`bar-${width}.png`)});
   assert.deepEqual([...on.errors,...off.errors],[]);
   if(width===1600){
    assert.equal(await on.page.getAttribute('#examReminder','title'),MESSAGE);
    await on.page.click('#examReminder button');
    assert.equal(await on.page.evaluate(()=>[document.getElementById('examReminder').hidden,localStorage.getItem('examReminderHiddenDay')].join()),'true,2027-10-20');
   }
   await on.page.close();await off.page.close();
  }
 }finally{await browser.close();}
});
