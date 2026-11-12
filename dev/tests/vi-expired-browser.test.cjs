const assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
// VI window (2026-11-12): the window token lives in the server's memory, so after a server restart the stream answers
// 401. The table must say so instead of staying on "VI 수신 연결 중…".
(async()=>{
 const app=express();app.get('/api/vi-monitor/stream',(req,res)=>res.status(401).json({error:'VI 독립창 연결 만료'}));
 app.use(express.static('public'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/vi-monitor.html#token=old');
  await page.waitForFunction(()=>document.getElementById('viBody').textContent.includes('만료'));
  assert.match(await page.locator('#viBody').innerText(),/연결이 만료됐습니다.*VI 독립창을 다시 열어주세요/);
  assert.match(await page.locator('#viStatus').innerText(),/연결 만료/);
  assert.deepEqual(errors,[]);console.log('vi expired ok');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);process.exit(1);});
