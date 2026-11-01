const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('test futures daily history cannot expand the initial peer range, regardless of response order',()=>{
 for(const testFirst of [true,false]){
  const jobs=[],ctx={window:{},queueMicrotask:fn=>jobs.push(fn)};
  vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),ctx);
  const api=ctx.window.RankChartAxis;
  const peer=()=>api.sharedRange('volatility',['2024-05-13','2026-10-30'],v=>v,'day',0,null,peer);
  const connected=()=>api.sharedRange('testMarketSupply',['2024-04-08','2024-05-13','2026-10-30'],v=>v,'day',0,null,connected);
  if(testFirst){connected();peer();}else{peer();connected();}
  const result=connected();
  assert.equal(api.dailyDomain().first,'2024-05-13');
  assert.equal(result.start,1);assert.equal(result.count,2);
  api.registerHistoryLoader('volatility',async()=>{},()=>false,()=>({hasMore:false}));
 }
});
const {chromium}=require('playwright');
test('full topic archives cannot define the shared daily range before their price reference arrives',()=>{
 const ctx={window:{},queueMicrotask(){}};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),ctx);
 const api=ctx.window.RankChartAxis;
 api.sharedRange('volatility',['2019-07-01','2026-10-30'],v=>v,'day',0,null,()=>{},false);
 assert.equal(api.dailyDomain(),null);
 api.sharedRange('concentration',['2024-05-13','2026-10-30'],v=>v,'day',0,null,()=>{});
 assert.equal(api.dailyDomain().first,'2024-05-13');
 api.sharedRange('volatility',['2024-05-13','2026-10-30'],v=>v,'day',0,null,()=>{},true);
 assert.equal(api.dailyDomain().first,'2024-05-13');
});
for(const testFirst of [true,false])test(`actual test card follows daily peer bounds (${testFirst?'test':'peer'} responds first) and preserves older history for more`,async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});let release;
 const gate=new Promise(resolve=>{release=resolve;});
 try{
  const page=await browser.newPage({viewport:{width:1800,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-01T12:00:00+09:00')});
  const at=d=>Date.parse(d+'T00:00:00+09:00');
  const candle=d=>({t:at(d),open:100,high:110,low:90,close:105});
  await page.route('http://test-domain.test/**',async route=>{
   const url=new URL(route.request().url()),isTest=url.pathname.startsWith('/api/ls-futures-test/');
   if(url.pathname.startsWith('/api/')){
    if(url.pathname.endsWith('/chart') && isTest!==testFirst)await gate;
    const old=!!url.searchParams.get('cursor');
    let dates=old?['2023-01-02']:isTest?['2024-04-08','2024-05-13','2026-10-30']:['2024-05-13','2026-10-30'];
    if(url.pathname.endsWith('/candles')){
     dates=['2023-01-02','2024-04-08','2024-05-13','2026-10-30'].filter(d=>d.replaceAll('-','')>=(url.searchParams.get('from')||'20240513')&&d.replaceAll('-','')<=(url.searchParams.get('to')||'20261030'));
     return route.fulfill({json:{success:true,points:dates.map(candle)}});
    }
    return route.fulfill({json:{success:true,points:dates.map(d=>({t:at(d),foreign:1,institution:-1,individual:0})),candles:dates.map(candle),has_more:!old,cursor:old?null:'20240407',warnings:[]}});
   }
   return route.fulfill({contentType:'text/html',body:'<main id="tab_rank"><div class="rank-chart-row"><section class="panel" id="concentrationChartPanel" style="height:450px"></section><section class="panel" id="rankBreadthChartPanel" style="height:450px"></section></div></main>'});
  });
  await page.goto('http://test-domain.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')});
  for(const file of ['rank-chart-axis.js','rank-market-supply-chart.js'])await page.addScriptTag({path:'public/'+file});
  await page.waitForFunction(testFirst=>testFirst?getTestMarketSupplyCandleDiagnostics().points>0:getCombinedMarketSupplyCandleDiagnostics().points>0,testFirst);
  const card=page.locator('#rankTestMarketSupplyChartPanel');
  await card.locator('.concentration-candle-toggle').click();
  if(!testFirst){
   await page.waitForFunction(()=>getTestMarketSupplyCandleDiagnostics().validCandles>0);
   assert.equal(await page.evaluate(()=>getTestMarketSupplyCandleDiagnostics().flowPoints),0,'Price candles render before the held topic response');
  }
  release();
  await page.waitForFunction(()=>getCombinedMarketSupplyCandleDiagnostics().points>0&&getTestMarketSupplyCandleDiagnostics().flowPoints===3);
  await page.waitForFunction(()=>getTestMarketSupplyCandleDiagnostics().visibleFirst===Date.parse('2024-05-13T00:00:00+09:00')).catch(async e=>{console.log(await page.evaluate(()=>({domain:RankChartAxis.dailyDomain(),test:getTestMarketSupplyCandleDiagnostics(),peer:getCombinedMarketSupplyCandleDiagnostics()})));throw e;});
  assert.equal(await page.evaluate(()=>RankChartAxis.dailyDomain().first),'2024-05-13');
  assert.equal(await page.evaluate(()=>getTestMarketSupplyCandleDiagnostics().visibleCandles),2);
  await page.evaluate(()=>RankChartAxis.requestHistory('day'));
  await page.waitForFunction(()=>RankChartAxis.dailyDomain().first==='2023-01-02'&&getTestMarketSupplyCandleDiagnostics().visibleCandles===4);
  assert.deepEqual(errors,[]);
 }finally{release();await browser.close();}
});
