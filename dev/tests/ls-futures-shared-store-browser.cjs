const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const {createSupplyStore}=require('../../supply-store'),{timestamp}=require('../../supply-service');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'shared-night-browser-'));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const now=()=>timestamp('20261031','090000'),store=createSupplyStore({directory,now});
  store.merge('FUTURE',{t:timestamp('20261029','090000'),foreign:30,individual:-30,institution:0});
  const night=require('../../ls-night-supply').createLsNightSupply({store,now});
  night.ingest('futures',['20261029230030','20261030010030','20261030230030','20261031010030'].map((s,i)=>({t:timestamp(s.slice(0,8),s.slice(8)),foreign:100+i,individual:-100-i,institution:0})));
  const testService=require('../../ls-futures-test').createLsFuturesTest({daytimeStore:store,now,pause:async()=>{},getToken:async()=>'',http:{post:async()=>{throw Error('Prices unavailable');}}});
  const normal=require('../../market-supply-service').createMarketSupplyService({directory,now,reference:{query:async()=>{throw Error('Not used');}}});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date(now()));
  await page.route('http://saved-night.test/**',async route=>{
   const url=new URL(route.request().url()),input=Object.fromEntries(url.searchParams);
   if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:'<div id="tab_rank"><div class="rank-chart-row"><section id="concentrationChartPanel"></section><section id="rankBreadthChartPanel"></section></div></div>'});
   let data={success:true,points:[],candles:[],warnings:[],has_more:false};
   if(input.mode==='minute' && url.pathname==='/api/ls-futures-test/chart')data=await testService.query(input);
   if(input.mode==='minute' && url.pathname==='/api/market-supply/chart')data=await normal.query(input);
   return route.fulfill({json:data});
  });
  await page.goto('http://saved-night.test/');
  await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')});
  for(const f of ['rank-chart-axis.js','rank-market-supply-chart.js'])await page.addScriptTag({path:'public/'+f});
  // Initial settings restore only: no history, refresh or range buttons.
  await page.evaluate(()=>{
   applyRankCombinedMarketSupplyDisplaySettings({selected:'futures',mode:'minute'});
   applyRankCombinedMarketSupplySecondaryDisplaySettings({selected:'futures',mode:'minute'});
   applyRankTestMarketSupplyDisplaySettings({selected:'futures',mode:'minute'});
  });
  await page.waitForFunction(()=>getTestMarketSupplyCandleDiagnostics().flowPoints===5&&getCombinedMarketSupplyCandleDiagnostics().flowPoints===5&&getCombinedMarketSupplySecondaryCandleDiagnostics().flowPoints===5);
  assert.deepEqual(errors,[]);
  console.log('Initial settings restore: both regular cards and test card show all five shared day/night observations, including the interior night.');
 }finally{await browser.close();fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
