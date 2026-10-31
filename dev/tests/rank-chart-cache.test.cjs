const {test}=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright');
test('duplicate market cards isolate cancellation and consume one shared response',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage();let calls=0;const releases=[];
  await page.route('https://shared-chart.test/**',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html></html>'});
   if(u.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'shared@example.test'}}});
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
test('browser chart cache retains history 16 hours, revalidates live data, excludes errors and isolates accounts',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage();let calls=[],value=10,user='one@example.test',failure=false,missing=false,pendingOnce=false,session=0;
 await page.route('https://chart-cache.test/**',async route=>{
  const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html><body></body></html>'});
  if(u.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:user}}});
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
 await page.evaluate(()=>window.testNow+=3600000+1);await read(history);assert.equal(calls.length,2,'16 hour expiry requires an upstream read');
 const live='/api/ls-turnover/chart?mode=minute';await read(live);value=20;
 await page.evaluate(()=>window.testNow+=61000);const stale=await read(live);assert.equal(stale.body.points[0].value,10);
 await page.waitForFunction(()=>window.updates>0);assert.equal((await read(live)).body.points[0].value,20);
 value=21;const updateCount=await page.evaluate(()=>window.updates);await page.evaluate(()=>window.testNow+=5000);assert.equal((await read(live)).body.points[0].value,20);await page.waitForFunction(n=>window.updates>n,updateCount);assert.equal((await read(live)).body.points[0].value,21,'A five-second refresh cadence is not changed into a one-minute freeze');
 const n=calls.length;await read('/api/ls-turnover/chart?cursor=20261023&mode=minute');assert.equal(calls.length,n,'Query order is canonical');
 failure=true;const bad='/api/kis-turnover/chart?mode=minute&cursor=20261022';await read(bad);await read(bad);assert.equal(calls.length,n+2);failure=false;
 missing=true;const empty='/api/kis-turnover/chart?mode=minute&cursor=20261021';await read(empty);await read(empty);assert.equal(calls.length,n+4);missing=false;
 user='two@example.test';value=30;await page.evaluate(()=>RankChartCache.invalidateIdentity());assert.equal((await read(history)).body.points[0].value,30);assert.equal(calls.length,n+5,'A different account never gets the prior account cache');
 const post='/api/ls-concentration-chart',options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'000660',mode:'minute'})};
 const first=await read(post,options);assert.ok(first.body.cursor);await start();
 const cached=await read(post,options);assert.equal(cached.body.cursor,null);assert.equal(cached.body.has_more,false,'Stored responses cannot expose expired server cursors');await page.waitForFunction(()=>window.updates>0);
 const fresh=await read(post,options);assert.ok(fresh.body.cursor);assert.notEqual(fresh.body.cursor,first.body.cursor);
 const before=calls.length;await read(post,{...options,body:JSON.stringify({code:'000660',mode:'minute',cursor:'opaque'})});await read(post,{...options,body:JSON.stringify({code:'000660',mode:'minute',cursor:'opaque'})});assert.equal(calls.length,before+2,'Session-bound history requests are not persisted');
 // A pending server job must resume polling rather than repeatedly showing a stale complete snapshot.
 await page.evaluate(()=>{window.done=false;window.refreshRankLsTurnoverChart=async()=>{for(let i=0;i<5;i++){const r=await RankChartCache.fetch('/api/ls-turnover/chart?mode=minute');const d=await r.json();if(!d.pending){window.done=true;window.lastValue=d.points[0].value;return;}}};});
 await read(live);await page.evaluate(()=>window.testNow+=61000);pendingOnce=true;value=40;await read(live);await page.waitForFunction(()=>window.done);assert.equal(await page.evaluate(()=>window.lastValue),40);
 assert.equal(await page.evaluate(()=>RankChartCache.ttl),16*3600000);
 }finally{await browser.close();}
});

test('reference cache revalidation retains minute mode and does not become an all-period refresh',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage();let value=1;
 await page.route('https://cache-mode.test/**',route=>{const u=new URL(route.request().url());if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<html><body></body></html>'});if(u.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'mode@example.test'}}});return route.fulfill({json:{success:true,points:[{t:1793059200000,close:value}]}});});
 await page.goto('https://cache-mode.test/');await page.evaluate(()=>{window.now=Date.parse('2026-10-27T12:00:00+09:00');Date.now=()=>window.now;window.refreshModes=[];window.RankChartAxis={refreshCharts:options=>window.refreshModes.push(options.mode)};});await page.addScriptTag({path:'public/rank-chart-cache.js'});
 const read=()=>page.evaluate(async()=>{const r=await RankChartCache.fetch('/api/chart-reference?mode=minute&market=kospi');return r.json();});await read();value=2;await page.evaluate(()=>window.now+=2000);await read();await page.waitForFunction(()=>window.refreshModes.length===1);assert.deepEqual(await page.evaluate(()=>window.refreshModes),['minute']);
 }finally{await browser.close();}
});
