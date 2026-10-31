const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage(),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  let stockPartial=false,marketFailure=false;
  const t=Date.parse('2026-10-23T09:00:00+09:00');
  const price={t,open:100,high:110,low:90,close:105};
  await page.route('http://coverage.test/**',async route=>{
   const u=new URL(route.request().url());calls.push(u.pathname+u.search);
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'')});
   if(u.pathname==='/api/chart-reference')return route.fulfill({json:{success:true,points:[{...price,date:'2026-10-23'}],has_more:false}});
   if(u.pathname.startsWith('/api/risk/'))return route.fulfill({json:{success:true,dates:['2026-10-23 09:00'],series:{highs:{points:[]},lows:{points:[]},vix:{points:[]},vkospi:{points:[]},'fear-greed':{points:[]},'high-yield-spread':{points:[]}},has_more:false}});
   if(u.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'Test'}],archive:[{code:'005930',name:'Test'}]}});
   if(u.pathname==='/api/supply/candles')return route.fulfill({json:{success:true,date:u.searchParams.get('date')||'2026-10-23',points:[price],partial:stockPartial,has_more:false}});
   if(u.pathname==='/api/adr/candles')return route.fulfill(marketFailure?{status:503,json:{error:'Price unavailable'}}:{json:{success:true,points:[price],has_more:false}});
   return route.fulfill({json:{success:true,date:'2026-10-23',points:[{t,foreign:100,institution:50,individual:-150,program:10}],candles:[],has_more:false}});
  });
  await page.goto('http://coverage.test/');
  await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')});
  await page.addScriptTag({path:'public/rank-chart-axis.js'});
  await page.evaluate(()=>{window.loaders={};const register=RankChartAxis.registerHistoryLoader;RankChartAxis.registerHistoryLoader=(id,load,busy,state)=>{loaders[id]={load,busy,state};register(id,load,busy,state);};});
  for(const file of ['rank-adr-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js'])await page.addScriptTag({path:'public/'+file});
  await page.waitForFunction(()=>window.getRankCombinedSupplyState?.().selected==='005930');
  await page.evaluate(async()=>{
   applyRankCombinedSupplySettings({selected:'005930',mode:'minute',showCandles:true});
   applyRankCombinedMarketSupplyDisplaySettings({selected:'futures',mode:'minute'});
   applyRankCombinedMarketSupplyCandleOpen(true);
  });
  await page.waitForFunction(()=>Object.values(loaders).every(l=>!l.busy()));
  // A partially received candle day must not become a permanent cache hit.
  stockPartial=true;
  await page.evaluate(()=>loaders.combinedSupply.state().ensureRange('2026-10-21 09:00').catch(()=>{}));
  const partialCalls=calls.filter(u=>u.startsWith('/api/supply/candles')&&u.includes('2026-10-21')).length;
  stockPartial=false;
  await page.evaluate(()=>loaders.combinedSupply.state().ensureRange('2026-10-21 09:00'));
  assert.ok(calls.filter(u=>u.startsWith('/api/supply/candles')&&u.includes('2026-10-21')).length>partialCalls);
  // Price-only timeline expansion must not move the flow coverage marker.
  assert.equal(await page.evaluate(()=>loaders.combinedSupply.state().coverageFirst),'2026-10-23 00:00');
  // The same market price range must be retried after an HTTP failure.
  marketFailure=true;
  const failed=await page.evaluate(()=>loaders.combinedMarketSupply.state().ensureRange('2026-10-20 09:00').then(()=>false,()=>true));
  assert.equal(failed,true);
  const failedCalls=calls.filter(u=>u.startsWith('/api/adr/candles')&&u.includes('20261020')).length;
  marketFailure=false;
  await page.evaluate(()=>loaders.combinedMarketSupply.state().ensureRange('2026-10-20 09:00'));
  assert.ok(calls.filter(u=>u.startsWith('/api/adr/candles')&&u.includes('20261020')).length>failedCalls);
  // Explicit ADR/breadth price requests must survive automatic redraw requests.
  await page.evaluate(()=>document.querySelector('#rankAdrChartPanel [data-adr-mode=minute]').click());
  await page.waitForFunction(()=>Object.values(loaders).every(l=>!l.busy()));
  for(const id of ['adr','breadth']){
   await page.evaluate(id=>{if(id==='adr')applyRankAdrCandleOpen(true);else applyRankBreadthDisplaySettings({mode:'minute',market:'kospi',candleOpen:true});},id);
   await page.waitForFunction(id=>!loaders[id].busy(),id);
   marketFailure=true;
   assert.equal(await page.evaluate(id=>loaders[id].state().ensureRange('2026-10-19 09:00').then(()=>false,()=>true),id),true);
   marketFailure=false;
   await page.evaluate(id=>loaders[id].state().ensureRange('2026-10-19 09:00'),id);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: separate flow coverage, partial price retry, and failed market price retry');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
