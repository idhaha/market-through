const {test}=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
test('closed-market reload preserves pagination across concentration variants and other card families',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage(),counts=new Map();
  const gets=['/api/supply/chart','/api/kis-supply/chart','/api/market-supply/chart','/api/kiwoom-market-supply/chart','/api/ls-market-supply/chart','/api/turnover/chart','/api/ls-turnover/chart','/api/chart-reference','/api/adr/candles','/api/risk/breadth','/api/risk/sentiment','/api/risk/volatility'];
  const specs=[];
  for(const mode of ['day','minute']){
   for(const url of gets)specs.push({url:url+'?mode='+mode,method:'GET',cursor:'20261022'});
   for(const url of ['/api/concentration-chart','/api/ls-concentration-chart'])for(const prices of [false,true])specs.push({url,method:'POST',body:JSON.stringify({code:'000660',mode,interval:1,...(prices?{prices_only:true}:{})})});
  }
  await page.route('https://card-history.test/**',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html></html>'});
   if(url.pathname==='/api/chart-revisions')return route.fulfill({json:{success:true,revisions:{}}});if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'cards@example.test'}}});
   const key=url.pathname+url.search+'|'+(request.postData() || ''),n=(counts.get(key)||0)+1;counts.set(key,n);
   return route.fulfill({json:{success:true,points:[{t:1793059200000,value:10}],cursor:request.method()==='POST'?'session-'+n:'20261022',has_more:true}});
  });
  const start=async()=>{await page.goto('https://card-history.test/');await page.evaluate(()=>window.TradingRefresh={allowsUrl:()=>false});await page.addScriptTag({path:'public/rank-chart-cache.js'});};
  const read=()=>page.evaluate(async specs=>Promise.all(specs.map(async s=>{const response=await RankChartCache.fetch(s.url,{method:s.method,...(s.body?{body:s.body,headers:{'Content-Type':'application/json'}}:{})});return response.json();})),specs);
  await start();await read();await start();const restored=await read();
  for(let i=0;i<specs.length;i++){
   const s=specs[i];assert.equal(restored[i].has_more,true,s.url);
   assert.equal(restored[i].cursor,s.method==='POST'?'session-2':'20261022',s.url+' '+(s.body||''));
  }
  // 비교 경로(ls-supply · kis-turnover · kis-concentration-chart)는 2026-11-22에 없앴다.
  assert.equal(specs.length,32);
  assert.equal([...counts.values()].filter(n=>n===2).length,8,'All session-bound source and candle variants restore sessions');
  assert.equal([...counts.values()].filter(n=>n===1).length,24,'Date-based cards retain stored pagination without unnecessary closed-market requests');
 }finally{await browser.close();}
});
test('closed-market reload obtains a fresh concentration cursor instead of disabling saved history',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage();let calls=0;
  await page.route('https://closed-history.test/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html></html>'});
   if(url.pathname==='/api/chart-revisions')return route.fulfill({json:{success:true,revisions:{}}});if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'closed@example.test'}}});
   calls++;return route.fulfill({json:{success:true,points:[{time:'20261030100000',value:10,stock_price:100}],cursor:'fresh-'+calls,has_more:true}});
  });
  const start=async()=>{await page.goto('https://closed-history.test/');await page.evaluate(()=>window.TradingRefresh={allowsUrl:()=>false});await page.addScriptTag({path:'public/rank-chart-cache.js'});};
  const read=()=>page.evaluate(async()=>{const r=await RankChartCache.fetch('/api/ls-concentration-chart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'000660',mode:'minute',interval:1})});return r.json();});
  await start();assert.equal((await read()).cursor,'fresh-1');
  await start();const restored=await read();
  assert.equal(restored.has_more,true,'A closed market must not turn persisted history into exhausted history');
  assert.equal(restored.cursor,'fresh-2');assert.equal(calls,2);
 }finally{await browser.close();}
});
test('duplicate market cards isolate cancellation and consume one shared response',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage();let calls=0;const releases=[];
  await page.route('https://shared-chart.test/**',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html></html>'});
   if(u.pathname==='/api/chart-revisions')return route.fulfill({json:{success:true,revisions:{}}});if(u.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'shared@example.test'}}});
   calls++;await new Promise(resolve=>releases.push(resolve));
   await route.fulfill({json:{success:true,points:[{t:1793059200000,foreign:123}],warnings:[]}}).catch(()=>{});
  });
  await page.goto('https://shared-chart.test/');await page.addScriptTag({path:'public/rank-chart-cache.js'});
  await page.evaluate(()=>{
   window.firstController=new AbortController();
   window.first=RankChartCache.fetch('/api/market-supply/chart?code=futures&mode=minute&prices=0',{signal:firstController.signal}).then(r=>r.json()).then(()=> 'completed',e=>e.name);
  });
  while(!calls)await new Promise(resolve=>setTimeout(resolve,10));
  await page.evaluate(()=>{window.second=RankChartCache.fetch('/api/market-supply/chart?code=futures&mode=minute&prices=0').then(r=>r.json());});
  await page.waitForTimeout(100);
  await page.evaluate(()=>firstController.abort());await page.waitForTimeout(100);
  releases.forEach(resolve=>resolve());
  const result=await page.evaluate(async()=>({first:await first,second:await second}));
  assert.equal(result.first,'AbortError');assert.equal(result.second.points[0].foreign,123);assert.equal(calls,1,'Cancelling one card must not restart the other card request');
 }finally{await browser.close();}
});
test('browser chart cache keeps past pages 7 days, revalidates live data, excludes errors and isolates accounts',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage();let calls=[],value=10,user='one@example.test',failure=false,missing=false,pendingOnce=false,session=0;
 await page.route('https://chart-cache.test/**',async route=>{
  const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html><body></body></html>'});
  if(u.pathname==='/api/chart-revisions')return route.fulfill({json:{success:true,revisions:{}}});if(u.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:user}}});
  calls.push({url:u.pathname+u.search,body:route.request().postData()});
  if(failure)return route.fulfill({status:502,json:{error:'failed'}});
  const payload={success:true,points:[{t:Date.parse('2026-10-26T09:00:00+09:00'),value}],warnings:missing?['자료 미제공']:[]};
  if(pendingOnce){payload.pending=true;pendingOnce=false;}
  if(route.request().method()==='POST'){payload.cursor='session-'+(++session);payload.has_more=true;}
  return route.fulfill({json:payload});
 });
 let clock=Date.parse('2026-10-27T10:00:00+09:00');
 async function start(){if(page.url().startsWith('https://chart-cache.test/'))clock=await page.evaluate(()=>window.testNow);await page.goto('https://chart-cache.test/');await page.evaluate(at=>{window.testNow=at;Date.now=()=>window.testNow;window.updates=0;document.addEventListener('rank-chart-cache-updated',()=>window.updates++);},clock);await page.addScriptTag({path:'public/rank-chart-cache.js'});}
 const read=(url,options)=>page.evaluate(async([u,o])=>{const r=await RankChartCache.fetch(u,o);return {status:r.status,body:await r.json()};},[url,options]);
 const history='/api/ls-turnover/chart?mode=minute&cursor=20261023';
 await start();assert.equal((await read(history)).body.points[0].value,10);await read(history);assert.equal(calls.length,1);
 await start();await read(history);assert.equal(calls.length,1,'Reload reuses IndexedDB history');
 await page.evaluate(()=>window.testNow+=15*3600000);await read(history);assert.equal(calls.length,1);
 await page.evaluate(()=>window.testNow+=3600000+1);await read(history);assert.equal(calls.length,1,'Past pages outlive the 16 hour live-response expiry');
 await page.evaluate(()=>window.testNow+=7*24*3600000-16*3600000);await read(history);assert.equal(calls.length,2,'7 day past-page expiry requires an upstream read');
 const live='/api/ls-turnover/chart?mode=minute';await read(live);value=20;
 await page.evaluate(()=>window.testNow+=61000);const stale=await read(live);assert.equal(stale.body.points[0].value,10);
 await page.waitForFunction(()=>window.updates>0);assert.equal((await read(live)).body.points[0].value,20);
 value=21;const updateCount=await page.evaluate(()=>window.updates);await page.evaluate(()=>window.testNow+=5000);assert.equal((await read(live)).body.points[0].value,20);await page.waitForFunction(n=>window.updates>n,updateCount);assert.equal((await read(live)).body.points[0].value,21,'A five-second refresh cadence is not changed into a one-minute freeze');
 {const quiet=await page.evaluate(()=>window.updates),c=calls.length;await page.evaluate(()=>window.testNow+=5000);await read(live);
  for(let i=0;i<100&&calls.length===c;i++)await new Promise(r=>setTimeout(r,20));assert.equal(calls.length,c+1,'Live data is still revalidated in the background');
  await new Promise(r=>setTimeout(r,200));assert.equal(await page.evaluate(()=>window.updates),quiet,'An unchanged background read does not notify cards (2026-11-25: notify → refresh → revalidate looped every 0.5s)');}
 const n=calls.length;await read('/api/ls-turnover/chart?cursor=20261023&mode=minute');assert.equal(calls.length,n,'Query order is canonical');
 failure=true;const bad='/api/kis-turnover/chart?mode=minute&cursor=20261022';await read(bad);await read(bad);assert.equal(calls.length,n+2);failure=false;
 missing=true;const empty='/api/kis-turnover/chart?mode=minute&cursor=20261021';await read(empty);await read(empty);assert.equal(calls.length,n+4);missing=false;
 user='two@example.test';value=30;await page.evaluate(()=>RankChartCache.invalidateIdentity());assert.equal((await read(history)).body.points[0].value,30);assert.equal(calls.length,n+5,'A different account never gets the prior account cache');
 const post='/api/ls-concentration-chart',options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'000660',mode:'minute'})};
 const first=await read(post,options);assert.ok(first.body.cursor);await start();
 const cached=await read(post,options);assert.ok(cached.body.cursor);assert.equal(cached.body.has_more,true,'Reload restores pagination with a new server cursor');
 assert.notEqual(cached.body.cursor,first.body.cursor);
 const before=calls.length;await read(post,{...options,body:JSON.stringify({code:'000660',mode:'minute',cursor:'opaque'})});await read(post,{...options,body:JSON.stringify({code:'000660',mode:'minute',cursor:'opaque'})});assert.equal(calls.length,before+2,'Session-bound history requests are not persisted');
 // A pending server job must resume polling rather than repeatedly showing a stale complete snapshot.
 await page.evaluate(()=>{window.done=false;window.refreshRankLsTurnoverChart=async()=>{for(let i=0;i<5;i++){const r=await RankChartCache.fetch('/api/ls-turnover/chart?mode=minute');const d=await r.json();if(!d.pending){window.done=true;window.lastValue=d.points[0].value;return;}}};});
 await read(live);await page.evaluate(()=>window.testNow+=61000);pendingOnce=true;value=40;await read(live);await page.waitForFunction(()=>window.done);assert.equal(await page.evaluate(()=>window.lastValue),40);
 assert.equal(await page.evaluate(()=>RankChartCache.ttl),16*3600000);
 }finally{await browser.close();}
});

test('reference cache revalidation retains minute mode and does not become an all-period refresh',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage();let value=1;
 await page.route('https://cache-mode.test/**',route=>{const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html><body></body></html>'});if(u.pathname==='/api/chart-revisions')return route.fulfill({json:{success:true,revisions:{}}});if(u.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'mode@example.test'}}});return route.fulfill({json:{success:true,points:[{t:1793059200000,close:value}]}});});
 await page.goto('https://cache-mode.test/');await page.evaluate(()=>{window.now=Date.parse('2026-10-27T12:00:00+09:00');Date.now=()=>window.now;window.refreshModes=[];window.RankChartAxis={refreshCharts:options=>window.refreshModes.push(options.mode)};});await page.addScriptTag({path:'public/rank-chart-cache.js'});
 const read=()=>page.evaluate(async()=>{const r=await RankChartCache.fetch('/api/chart-reference?mode=minute&market=kospi');return r.json();});await read();value=2;await page.evaluate(()=>window.now+=2000);await read();await page.waitForFunction(()=>window.refreshModes.length===1);assert.deepEqual(await page.evaluate(()=>window.refreshModes),['minute']);
 }finally{await browser.close();}
});
test('closed market replaces a response saved during the session once, so today is not cut off',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  // A 52-week high/low KOSDAQ minute response read at 10:00 stops at 10:00; after the close the server has the whole day.
  const page=await browser.newPage();let calls=0,full=false;
  await page.route('https://closed-today.test/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html></html>'});
   if(url.pathname==='/api/chart-revisions')return route.fulfill({json:{success:true,revisions:{}}});if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'today@example.test'}}});
   calls++;const dates=full?['2026-11-05 09:59','2026-11-05 19:59']:['2026-11-05 09:59'];
   return route.fulfill({json:{mode:'minute',market:'kosdaq',dates,series:{highs:{points:dates.map(date=>({date,value:3}))},lows:{points:dates.map(date=>({date,value:-9}))}},has_more:false}});
  });
  const start=async open=>{await page.goto('https://closed-today.test/');await page.evaluate(open=>{window.TradingRefresh={allowsUrl:()=>open};},open);await page.addScriptTag({path:'public/rank-chart-cache.js'});};
  const read=()=>page.evaluate(async()=>(await (await RankChartCache.fetch('/api/risk/breadth?market=kosdaq&mode=minute&cursor=')).json()).dates.at(-1));
  await start(true);assert.equal(await read(),'2026-11-05 09:59');assert.equal(calls,1);
  full=true;
  await start(false);assert.equal(await read(),'2026-11-05 09:59','cached response is shown first');
  await page.waitForFunction(()=>true);for(let i=0;i<50&&calls<2;i++)await page.waitForTimeout(100);
  assert.equal(calls,2,'a response saved while the market was open is refetched once after the close');
  await page.waitForTimeout(300);assert.equal(await read(),'2026-11-05 19:59');
  await start(false);assert.equal(await read(),'2026-11-05 19:59');await page.waitForTimeout(500);
  assert.equal(calls,2,'a response saved after the close is not requested again');
 }finally{await browser.close();}
});
test('futures response saved after the day close is refetched once after the night close, not during the write grace',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  // Read at 16:00 (day session closed) it has no night rows; after the 06:00 night close the server has them.
  const page=await browser.newPage();let calls=0,night=false;
  await page.route('https://night-close.test/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html></html>'});
   if(url.pathname==='/api/chart-revisions')return route.fulfill({json:{success:true,revisions:{}}});if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'night@example.test'}}});
   calls++;const dates=night?['2026-11-05 15:45','2026-11-06 05:59']:['2026-11-05 15:45'];
   return route.fulfill({json:{mode:'minute',market:'futures',dates,series:{foreign:{points:dates.map(date=>({date,value:1}))}},has_more:false}});
  });
  // closedAt is set relative to the moment of each read, as the server reports it.
  const start=async()=>{await page.goto('https://night-close.test/');await page.evaluate(()=>{window.closedAt=null;window.TradingRefresh={allowsUrl:()=>false,closedAtUrl:url=>url.searchParams.get('code')==='futures'?window.closedAt:null};});await page.addScriptTag({path:'public/rank-chart-cache.js'});};
  const read=closedAgo=>page.evaluate(async ago=>{window.closedAt=ago==null?null:Date.now()-ago;return (await (await RankChartCache.fetch('/api/market-supply/chart?code=futures&mode=minute')).json()).dates.at(-1);},closedAgo);
  const settle=async n=>{for(let i=0;i<30&&calls<n;i++)await page.waitForTimeout(100);await page.waitForTimeout(200);};
  await start();assert.equal(await read(3600000),'2026-11-05 15:45');assert.equal(calls,1);
  night=true;
  await start();assert.equal(await read(3600000),'2026-11-05 15:45');await settle(2);
  assert.equal(calls,1,'saved after the same close: complete, not requested again');
  await start();assert.equal(await read(30000),'2026-11-05 15:45');await settle(2);
  assert.equal(calls,1,'within two minutes of a new close the server may still be writing, so wait');
  await start();assert.equal(await read(0),'2026-11-05 15:45');await settle(2);
  assert.equal(calls,1,'right at the close, still waiting');
  // Two minutes past the night close: the 16:00 copy predates it.
  await page.evaluate(()=>{const base=Date.now;Date.now=()=>base()+180000;});
  assert.equal(await page.evaluate(async()=>{window.closedAt=Date.now()-180000;return (await (await RankChartCache.fetch('/api/market-supply/chart?code=futures&mode=minute')).json()).dates.at(-1);}),'2026-11-05 15:45');
  await settle(2);assert.equal(calls,2,'refetched once after the night close');
  assert.equal(await page.evaluate(async()=>(await (await RankChartCache.fetch('/api/market-supply/chart?code=futures&mode=minute')).json()).dates.at(-1)),'2026-11-06 05:59');
  await page.waitForTimeout(300);assert.equal(calls,2,'not requested again for the same close');
 }finally{await browser.close();}
});
test('responses saved before data revisions existed (v3.0.112 breadth) are dropped once after a reload with the new script',async()=>{
 const {execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 const oldScript=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'cache-old-')),'rank-chart-cache.js');
 fs.writeFileSync(oldScript,execFileSync('git',['show','v3.0.112:public/rank-chart-cache.js']));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage();let first='2026-10-26',calls=0;
  await page.route('https://breadth-rewrite.test/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html></html>'});
   if(url.pathname==='/api/chart-revisions')return route.fulfill({json:{success:true,revisions:{}}});if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'breadth@example.test'}}});
   calls++;return route.fulfill({json:{mode:'day',market:'kosdaq',dates:[first,'2026-11-06'],series:{highs:{points:[{date:first,value:3},{date:'2026-11-06',value:4}]}},cursor:null,has_more:false}});
  });
  const start=async script=>{await page.goto('https://breadth-rewrite.test/');await page.evaluate(()=>window.TradingRefresh={allowsUrl:()=>false});await page.addScriptTag({path:script});};
  const read=()=>page.evaluate(async()=>(await (await RankChartCache.fetch('/api/risk/breadth?market=kosdaq&mode=day&cursor=')).json()).dates[0]);
  await start(oldScript);assert.equal(await read(),'2026-10-26');
  first='2024-05-21';
  await start(oldScript);assert.equal(await read(),'2026-10-26','old script: saved response hides the rewritten history (the reported symptom)');
  await start('public/rank-chart-cache.js');assert.equal(await read(),'2024-05-21');assert.equal(calls,2);
  await start('public/rank-chart-cache.js');assert.equal(await read(),'2024-05-21');assert.equal(calls,2,'the new response is cached again');
 }finally{await browser.close();}
});
test('a changed server revision drops every saved page of that route together; other routes and an unchanged revision keep theirs',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage(),calls=[];let revisions={'/api/risk/breadth':'b1','/api/kis-supply/chart':'k1'},version='old',revisionsOk=true;
  await page.route('https://revisions.test/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html></html>'});
   if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'revisions@example.test'}}});
   if(url.pathname==='/api/chart-revisions')return revisionsOk?route.fulfill({json:{success:true,revisions}}):route.fulfill({status:500,json:{success:false}});
   calls.push(url.pathname+url.search);
   const cursor=url.searchParams.get('cursor')||'';
   return route.fulfill({headers:{'X-Chart-Revision':revisions[url.pathname]||''},json:{dates:['2026-11-06'],series:{highs:{points:[{date:cursor||'latest',value:1}]}},version,cursor:cursor?null:'20240520',has_more:!cursor}});
  });
  const start=async()=>{await page.goto('https://revisions.test/');await page.evaluate(()=>{window.TradingRefresh={allowsUrl:()=>false};window.updates=[];document.addEventListener('rank-chart-cache-updated',e=>window.updates.push(e.detail.path));});await page.addScriptTag({path:'public/rank-chart-cache.js'});};
  const urls=['/api/risk/breadth?market=kospi&mode=day&cursor=','/api/risk/breadth?market=kospi&mode=day&cursor=20240520','/api/risk/breadth?market=kosdaq&mode=day&cursor=20240520','/api/kis-supply/chart?code=005930&mode=minute&cursor=20261105'];
  const readAll=()=>page.evaluate(async urls=>Promise.all(urls.map(async u=>(await (await RankChartCache.fetch(u)).json()).version)),urls);
  await start();assert.deepEqual(await readAll(),['old','old','old','old']);assert.equal(calls.length,4);
  version='new';
  await start();assert.deepEqual(await readAll(),['old','old','old','old'],'same revisions: saved pages are used');assert.equal(calls.length,4);
  revisions={...revisions,'/api/risk/breadth':'b2'};
  await start();assert.deepEqual(await readAll(),['new','new','new','old'],'breadth pages are all replaced, supply kept');assert.equal(calls.length,7);
  await start();assert.deepEqual(await readAll(),['new','new','new','old']);assert.equal(calls.length,7,'the new pages are saved again');
  // Revisions unavailable: saved pages are used as before.
  revisionsOk=false;version='newer';
  await start();assert.deepEqual(await readAll(),['new','new','new','old']);assert.equal(calls.length,7);
  // During a session a response with a newer revision drops the route's saved pages and asks the chart to reload.
  revisionsOk=true;await start();await readAll();
  revisions={...revisions,'/api/kis-supply/chart':'k2'};
  await page.evaluate(()=>window.TradingRefresh={allowsUrl:()=>true});
  await page.evaluate(async()=>{await (await RankChartCache.fetch('/api/kis-supply/chart?code=005930&mode=minute')).json();});
  await page.waitForFunction(()=>window.updates.includes('/api/kis-supply/chart'));
  const before=calls.length;
  assert.equal(await page.evaluate(async()=>(await (await RankChartCache.fetch('/api/kis-supply/chart?code=005930&mode=minute&cursor=20261105')).json()).version),'newer');
  assert.equal(calls.length,before+1,'the saved past page of the revised route is fetched again');
 }finally{await browser.close();}
});
test('과거 구간을 다시 열 때 먼저 받아 두고 다시 꺼내 쓴 지난 쪽이 한도에 밀려 버려지지 않는다(2026-11-23 오라클 측정 5번)',async()=>{
 // 60거래일 구간 하나가 저장 응답 약 107건 · 21MB였다. 예전 한도(24MB · 180건)에서는 다른 카드의 쪽을 더 받으면 먼저 받은
 // 시장 수급 쪽이 밀려나, 같은 구간을 다시 열 때 36건 중 18~29건을 서버에서 다시 받았다.
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage(),counts=new Map(),big='x'.repeat(100*1024);
  await page.route('https://window-reuse.test/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html></html>'});
   if(url.pathname==='/api/chart-revisions')return route.fulfill({json:{success:true,revisions:{}}});if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'window@example.test'}}});
   const key=url.pathname+url.search;counts.set(key,(counts.get(key)||0)+1);
   return route.fulfill({json:{success:true,points:[{t:1793059200000,foreign:1,pad:big}],has_more:true,cursor:'20260701'}});
  });
  const start=async()=>{await page.goto('https://window-reuse.test/');await page.evaluate(()=>window.TradingRefresh={allowsUrl:()=>false});await page.addScriptTag({path:'public/rank-chart-cache.js'});};
  const days=Array.from({length:60},(_,i)=>new Date(Date.UTC(2026,6,1)+i*86400000).toISOString().slice(0,10).replaceAll('-',''));
  const read=urls=>page.evaluate(async urls=>{for(const u of urls){const r=await RankChartCache.fetch(u);await r.json();}},urls);
  const market=days.map(d=>'/api/kiwoom-market-supply/chart?code=kospi&mode=minute&cursor='+d),turnover=days.map(d=>'/api/ls-turnover/chart?mode=minute&cursor='+d),breadth=days.map(d=>'/api/risk/breadth?market=kospi&mode=minute&cursor='+d);
  await start();
  await read(market);          // 처음 연 구간: 시장 수급 60쪽
  await start();await read(market); // 다시 열기: 저장분에서 꺼내 쓴다
  await read(turnover);await read(breadth); // 다른 카드 120쪽을 더 받는다(예전 한도 180건을 넘김)
  await page.waitForTimeout(500);
  await start();await read(market);
  const again=market.filter(u=>counts.get(u)>1);
  assert.deepEqual(again,[],'같은 구간의 시장 수급 쪽은 서버에 다시 묻지 않는다');
 }finally{await browser.close();}
});
test('쏠림율 1분봉 지난 날짜 커서(day:YYYYMMDD)와 과거 구간 첫 쪽은 저장해 다시 쓰고, 오늘 · 세션 커서는 저장하지 않는다(2026-11-24)',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage();const calls=[];
 await page.route('https://day-cursor.test/**',async route=>{
  const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html><body></body></html>'});
  if(u.pathname==='/api/chart-revisions')return route.fulfill({json:{success:true,revisions:{}}});if(u.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'one@example.test'}}});
  const body=JSON.parse(route.request().postData()||'{}');calls.push(body.cursor||'first:'+(body.base_dt||''));
  const from=String(body.cursor||'').replace('day:','')||body.base_dt||'20261124';
  return route.fulfill({json:{success:true,points:[{t:Date.parse('2026-11-20T09:00:00+09:00'),value:1}],cursor:body.cursor==='opaque'?'session-x':'day:'+String(Number(from)-1),has_more:true}});
 });
 const clock=Date.parse('2026-11-24T22:00:00+09:00');
 async function start(){await page.goto('https://day-cursor.test/');await page.evaluate(at=>{Date.now=()=>at;},clock);await page.addScriptTag({path:'public/rank-chart-cache.js'});}
 const read=body=>page.evaluate(async b=>{const r=await RankChartCache.fetch('/api/ls-concentration-chart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return r.json();},body);
 const past={code:'005930',mode:'minute',interval:1,cursor:'day:20261120'},base={code:'005930',mode:'minute',interval:1,cursor:null,base_dt:'20260909'};
 await start();await read(past);await read(base);assert.equal(calls.length,2);
 await start();
 const again=await read(past),baseAgain=await read(base);
 assert.equal(calls.length,2,'새로고침 뒤에도 지난 날짜 커서 쪽과 과거 구간 첫 쪽을 서버에 다시 묻지 않는다');
 assert.equal(again.cursor,'day:20261119','저장한 쪽의 다음 날짜 커서를 그대로 준다');assert.equal(baseAgain.cursor,'day:20260908');
 await read({...past,cursor:'day:20261124'});await read({...past,cursor:'day:20261124'});assert.equal(calls.length,4,'오늘 날짜 커서는 저장하지 않는다');
 await read({...past,cursor:'opaque'});await read({...past,cursor:'opaque'});assert.equal(calls.length,6,'세션 커서는 저장하지 않는다');
 }finally{await browser.close();}
});
