const fs=require('fs'),assert=require('node:assert/strict'),{test}=require('node:test'),{chromium}=require('playwright');
test('independent views use their authenticated capability scope, never cookie-session probes',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage();let authCalls=0,chartCalls=0;
 await page.route('https://native-cache.test/**',route=>{const p=new URL(route.request().url()).pathname;if(p==='/')return route.fulfill({body:'<html><body></body></html>',contentType:'text/html'});if(p==='/api/auth/session'){authCalls++;return route.fulfill({status:401,json:{authenticated:false}});}chartCalls++;return route.fulfill({json:{success:true,points:[{t:1,value:10}]}});});
 await page.goto('https://native-cache.test/');await page.evaluate(()=>{window.rankIndependentClient=true;window.rankIndependentCacheScope='a'.repeat(64);});await page.addScriptTag({path:'public/rank-chart-cache.js'});
 const read=()=>page.evaluate(async()=>{const r=await RankChartCache.fetch('/api/supply/chart?code=005930&mode=minute&cursor=20261023');return r.json();});await read();await read();assert.equal(authCalls,0);assert.equal(chartCalls,1);
 await page.evaluate(()=>window.rankIndependentCacheScope='b'.repeat(64));await read();assert.equal(chartCalls,2);assert.equal(authCalls,0);
 }finally{await browser.close();}
});
test('a snapshot render exception is not reported as a server connection failure, and the same snapshot is retried',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));let offline=false;
 const html=fs.readFileSync('public/rank-independent.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 const snapshot={rows:'<tr><td>recovered-data</td></tr>',chart:{selection:{code:'005930',name:'test'},market:'코스피',points:[]},conditions:{},refreshStatus:{time:'now',text:'완료'}};
 await page.route('https://native-errors.test/**',async route=>{if(route.request().method()==='POST'){const p=route.request().postDataJSON();requests.push(p);if(offline)return route.fulfill({status:typeof offline==='number'?offline:503,json:{error:'test outage'}});return route.fulfill({json:{version:1,snapshot,epoch:'test',replies:[],cacheScope:'a'.repeat(64)}});}return route.fulfill({contentType:'text/html',body:html});});
 await page.goto('https://native-errors.test/rank-independent.html#id='+'a'.repeat(32)+'&token='+'b'.repeat(64));await page.evaluate(()=>{window.selectRankChartStock=()=>{throw Error('render fixture');};});await page.addScriptTag({path:'public/rank-independent-client.js'});await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 await page.waitForFunction(()=>window.rankIndependentLastFailure?.stage==='render');assert.match(await page.locator('#rankConnectionStatus').innerText(),/화면 갱신 오류/);assert.equal(requests[0].compact,true);
 await page.waitForTimeout(600);assert.ok(requests.every(r=>r.version===-1));await page.evaluate(()=>window.selectRankChartStock=()=>{});await page.waitForFunction(()=>!window.rankIndependentLastFailure&&document.querySelector('#transactionBody').textContent.includes('recovered-data'));
 offline=true;await page.waitForFunction(()=>window.rankIndependentLastFailure?.status===503);assert.match(await page.locator('#rankConnectionStatus').innerText(),/HTTP 503/);offline=false;await page.waitForFunction(()=>!window.rankIndependentLastFailure);offline=401;await page.waitForFunction(()=>window.rankIndependentLastFailure?.status===401);assert.match(await page.locator('#rankConnectionStatus').innerText(),/메인 페이지 새로고침/);offline=false;await page.waitForFunction(()=>!window.rankIndependentLastFailure);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
