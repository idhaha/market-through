const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage(),calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const row=date=>({t:Date.parse(date+'T09:00:00+09:00'),individual:100,foreign:-100,institution:0});
  const early=row('2026-10-29'),latest=row('2026-10-31');
  await page.route('http://history.test/**',route=>{
   const url=new URL(route.request().url());calls.push(url.pathname+url.search);
   if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:'<div id="tab_rank"><div class="rank-chart-row"><section id="concentrationChartPanel"></section><section id="rankBreadthChartPanel"></section></div></div>'});
   const cursor=url.searchParams.get('cursor'),isTest=url.pathname.includes('ls-futures-test');
   const points=isTest?[early,latest]:cursor==='20261029'?[early]:cursor==='20261030'?[]:[latest];
   return route.fulfill({json:{success:true,points,candles:[],warnings:[],date:cursor==='20261029'?'2026-10-29':cursor==='20261030'?'2026-10-30':'2026-10-31',has_more:!isTest&&cursor!=='20261029',cursor:cursor==='20261030'?'20261029':'20261030'}});
  });
  await page.goto('http://history.test/');
  await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')});
  for(const file of ['rank-chart-axis.js','rank-market-supply-chart.js'])await page.addScriptTag({path:'public/'+file});
  await page.evaluate(()=>applyRankCombinedMarketSupplyDisplaySettings({selected:'futures',mode:'minute'}));
  await page.evaluate(()=>applyRankCombinedMarketSupplySecondaryDisplaySettings({selected:'futures',mode:'minute'}));
  await page.waitForFunction(()=>getCombinedMarketSupplyCandleDiagnostics().flowPoints===1);
  await page.evaluate(()=>applyRankTestMarketSupplyDisplaySettings({selected:'futures',mode:'minute'}));
  await page.waitForFunction(()=>getTestMarketSupplyCandleDiagnostics().flowPoints===2&&getCombinedMarketSupplyCandleDiagnostics().flowPoints===2&&getCombinedMarketSupplySecondaryCandleDiagnostics().flowPoints===2);
  assert.ok(calls.filter(url=>url.startsWith('/api/market-supply/chart?')&&url.includes('mode=minute')).every(url=>url.includes('prices=0')),'Both cards request stored flow without waiting for prices');
  assert.ok(calls.some(url=>url.startsWith('/api/market-supply/chart?')&&url.includes('cursor=20261029')));
  await page.evaluate(()=>refreshRankCombinedMarketSupplyChart());
  assert.equal(await page.evaluate(()=>getCombinedMarketSupplyCandleDiagnostics().flowPoints),2);
  assert.deepEqual(errors,[]);
  console.log('Reload: normal market supply catches up to test chart through an empty stored date; refresh preserves both days.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
