// 설정 창 수능일 칸(2026-11-20): 실제 index.html로 열어, 관리자는 저장 · 삭제가 되고 상단 미등록 알림이 바로 사라지며,
// 관리자가 아니면 입력 칸이 잠기는지 본다. 서버 API는 가짜로 응답한다(서버 쪽 저장은 market-open-delay.test.cjs).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
async function open(browser,admin){
 const page=await browser.newPage({viewport:{width:1400,height:900}}),errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 let days=[{date:'2026-11-19',open:60,close:60,source:'code'}];
 await page.route('http://market-page.test/**',async route=>{const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
  if(url.pathname==='/api/trading-session/exam-days'&&req.method()==='GET')return route.fulfill({json:{success:true,days,canEdit:admin}});
  if(url.pathname==='/api/trading-session/exam-days'&&req.method()==='POST'){const body=JSON.parse(req.postData());posts.push(body);
   days=[{...body,open:60,close:60,source:'settings'},...days];return route.fulfill({json:{success:true,days,canEdit:true}});}
  if(url.pathname.startsWith('/api/trading-session/exam-days/')&&req.method()==='DELETE'){const d=decodeURIComponent(url.pathname.split('/').pop());days=days.filter(x=>x.date!==d);return route.fulfill({json:{success:true,days,canEdit:true}});}
  return route.fulfill({json:{success:true}});});
 await page.clock.setFixedTime(new Date('2027-10-20T10:00:00+09:00')); // 올해 = 2027년
 await page.goto('http://market-page.test/');
 await page.addStyleTag({content:['style.css','exam-reminder.css'].map(f=>fs.readFileSync('public/'+f,'utf8')).join('\n')+'#loginOverlay{display:none!important}#tabContainer{display:flex!important}'});
 await page.evaluate(()=>{window.TradingRefresh={update:async()=>({spot:true,futures:true,date:'2027-10-20',examReminder:'2027년 수능일이 등록되지 않았습니다.'})};});
 for(const f of ['exam-reminder.js','exam-day-settings.js'])await page.addScriptTag({content:fs.readFileSync('public/'+f,'utf8')});
 // 설정 창 열기(app.js 대신 같은 동작만)
 await page.click('#profileBtn');
 await page.evaluate(()=>{document.getElementById('profileModal').style.display='flex';});
 await page.waitForFunction(()=>document.querySelectorAll('#examDayList li').length>0);
 return {page,errors,posts};
}
test('설정 창 수능일 칸: 관리자는 저장 · 삭제하고 상단 알림이 바로 사라지며, 관리자가 아니면 잠긴다',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const a=await open(browser,true);
  assert.equal(await a.page.isVisible('#examReminder'),true);
  assert.match(await a.page.textContent('#examDayList'),/2026-11-19 · 정규장 10:00~16:30코드 기본값/);
  assert.equal(await a.page.locator('#examDayList button').count(),0); // 코드 기본값은 삭제 버튼 없음
  await a.page.fill('#examDayDate','2027-11-18');await a.page.click('#examDayForm button[type="submit"]');
  await a.page.waitForFunction(()=>document.getElementById('examDayMessage').textContent.includes('저장했습니다'));
  assert.deepEqual(a.posts,[{date:'2027-11-18'}]);
  assert.equal(await a.page.isVisible('#examReminder'),false);
  assert.match(await a.page.textContent('#examDayList'),/2027-11-18 · 정규장 10:00~16:30설정에서 입력삭제/);
  await a.page.click('#examDayList button');
  await a.page.waitForFunction(()=>document.getElementById('examDayMessage').textContent.includes('삭제했습니다'));
  assert.doesNotMatch(await a.page.textContent('#examDayList'),/2027-11-18/);
  // 올해 달력만: 날짜 칸이 올해(2027년)로 묶이고, 다른 해를 쳐 넣으면 저장하지 않고 한국어로 막는다.
  assert.deepEqual(await a.page.evaluate(()=>{const i=document.getElementById('examDayDate');return [i.min,i.max];}),['2027-01-01','2027-12-31']);
  await a.page.fill('#examDayDate','2028-11-16');await a.page.click('#examDayForm button[type="submit"]');await a.page.waitForTimeout(200);
  assert.equal(a.posts.length,1);
  assert.equal(await a.page.evaluate(()=>document.getElementById('examDayDate').validationMessage),'올해(2027년) 날짜만 고를 수 있습니다.');
  await a.page.locator('#profileModal .modal-content').screenshot({path:require('node:path').join(require('node:os').tmpdir(),'exam-day-profile-admin.png')});
  assert.deepEqual(a.errors,[]);
  const u=await open(browser,false);
  assert.equal(await u.page.isDisabled('#examDayDate'),true);assert.equal(await u.page.isDisabled('#examDayForm button[type="submit"]'),true);
  assert.match(await u.page.textContent('#examDayMessage'),/관리자만/);
  await u.page.locator('#examDaySection').screenshot({path:require('node:path').join(require('node:os').tmpdir(),'exam-day-section.png')});
  assert.deepEqual(u.errors,[]);
 }finally{await browser.close();}
});
