const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{for(const mode of ['day','minute'])for(const blocked of ['topic','price']){
  const page=await browser.newPage({viewport:{width:2200,height:1200}}),errors=[],release=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-23T12:00:00+09:00'));
  await page.addInitScript(()=>{
   window.rankManagedChartRefresh=true;window.rankChartRefreshStarted=false;window.candleRects={};
   const clear=CanvasRenderingContext2D.prototype.clearRect,fill=CanvasRenderingContext2D.prototype.fillRect;
   CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.closest('.rank-adr-candle-area,.concentration-candle-area'))window.candleRects[this.canvas.closest('section')?.id]=[];return clear.apply(this,a);};
   CanvasRenderingContext2D.prototype.fillRect=function(...a){if(this.canvas.closest('.rank-adr-candle-area,.concentration-candle-area'))(window.candleRects[this.canvas.closest('section')?.id]||=[]).push(a);return fill.apply(this,a);};
  });
  const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  const t=Date.parse('2026-10-23T'+(mode==='day'?'00:00':'09:00')+':00+09:00'),date='2026-10-23'+(mode==='minute'?' 09:00':'');
  const p={t,date,open:100,high:110,low:90,close:105},flow={t,foreign:100,individual:-50,institution:-50};
  let hold=true;
  await page.route('http://independent.test/**',async route=>{
   const u=new URL(route.request().url()),path=u.pathname,body=route.request().method()==='POST'?route.request().postDataJSON():{};
   if(!path.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:html});
   if(path==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'Stock'}],archive:[{code:'005930',name:'Stock'}],revision:1}});
   const price=path.endsWith('/candles')||path==='/api/chart-reference'||body.prices_only||u.searchParams.get('prices_only')==='1';
   if(hold && (price?'price':'topic')===blocked)await new Promise(resolve=>release.push(resolve));
   let data={success:true,points:[flow],candles:[],warnings:[],has_more:false,date:'2026-10-23'};
   if(path.includes('concentration-chart'))data={success:true,mode,market:'K',points:[{time:mode==='day'?'20261023':'20261023090000',value:body.prices_only?null:25,stock_price:105,stock_open:100,stock_high:110,stock_low:90}],has_more:false};
   else if(price)data={success:true,points:[p],candles:[p],has_more:false,date:'2026-10-23'};
   else if(path.includes('turnover/chart'))data={success:true,markets:{kospi:[{...p,market_turnover:1e12}],kosdaq:[{...p,market_turnover:2e12}]},warnings:[],has_more:false};
   else if(path==='/api/adr/today')data={intraday:[{t:t/1000,adr:100}],adr:100,asOf:t};
   else if(path==='/api/adr/history')data={series:[{date:'2026-10-23',adr:100}]};
   else if(path.startsWith('/api/risk/'))data={dates:[date],series:Object.fromEntries(['highs','lows','vix','vkospi','fear-greed','high-yield-spread'].map(id=>[id,{points:[{date:path.includes('breadth')?date:'2026-10-23',value:20}]}])),has_more:false};
   return route.fulfill({json:data});
  });
  await page.goto('http://independent.test/');
  await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
  for(const file of ['rank-chart-axis.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js'])await page.addScriptTag({path:'public/'+file});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.evaluate(mode=>{
   window.rankMainCandleOpen=true;
   applyRankCombinedSupplyState({config:{stocks:[{code:'005930',name:'Stock'}],archive:[{code:'005930',name:'Stock'}],revision:1},points:[],candles:[],selected:'005930',mode,showCandles:true});
   applyConcentrationDisplaySettings({...getConcentrationDisplaySettings(),mode,candleOpen:true});
   selectRankChartStock({code:'005930',name:'Stock',market:'K'});
   applyRankCombinedSupplySettings({selected:'005930',mode,showCandles:true});
   applyRankCombinedMarketSupplyDisplaySettings({selected:'futures',mode});applyRankCombinedMarketSupplyCandleOpen(true);
   applyRankCombinedMarketSupplySecondaryDisplaySettings({selected:'futures',mode});applyRankCombinedMarketSupplySecondaryCandleOpen(true);
   applyRankTestMarketSupplyDisplaySettings({selected:'futures',mode});applyRankTestMarketSupplyCandleOpen(true);
   applyRankBreadthDisplaySettings({mode,candleOpen:true});
   applyRankSentimentDisplaySettings({candleOpen:true});applyRankVolatilityDisplaySettings({candleOpen:true});
   document.querySelector(`#rankAdrChartPanel [data-adr-mode="${mode}"]`).click();
   document.querySelector(`#rankCombinedTurnoverChartPanel [data-mode="${mode}"]`).click();applyRankCombinedTurnoverCandleOpen(true);
   window.rankChartRefreshStarted=true;void RankChartAxis.refreshCharts();
  },mode);
  if(blocked==='topic'){
   for(const id of ['combinedConcentrationChartPanel','rankCombinedSupplyChartPanel','rankCombinedMarketSupplyChartPanel','rankCombinedMarketSupplySecondaryChartPanel','rankTestMarketSupplyChartPanel','rankCombinedTurnoverChartPanel','rankAdrChartPanel','rankBreadthChartPanel','rankSentimentChartPanel','rankVolatilityChartPanel']){
    await page.waitForFunction(id=>window.candleRects[id]?.length>0,id,{timeout:10000}).catch(error=>{throw Error(`${mode}: price must draw while topic is blocked: ${id}: ${error.message}`);});
   }
  }else{
   await page.waitForFunction(()=>getCombinedRankChartState().points.some(p=>p.value===25)&&getRankCombinedSupplyState().points.some(p=>p.foreign===100)&&getCombinedMarketSupplyCandleDiagnostics().flowPoints>0&&getCombinedMarketSupplySecondaryCandleDiagnostics().flowPoints>0&&getTestMarketSupplyCandleDiagnostics().flowPoints>0&&getRankCombinedTurnoverState().markets.kospi.some(p=>p.market_turnover>0)&&getAdrCandleDiagnostics().points>0&&getRankBreadthDataState().data.highs.length>0&&getRankSentimentDataState().data['fear-greed'].length>0&&getRankVolatilityDataState().data.vix.length>0,null,{timeout:10000}).catch(async error=>{console.log(await page.evaluate(()=>({concentration:getCombinedRankChartState(),supply:getRankCombinedSupplyState().points,market:getCombinedMarketSupplyCandleDiagnostics(),secondary:getCombinedMarketSupplySecondaryCandleDiagnostics(),test:getTestMarketSupplyCandleDiagnostics(),turnover:getRankCombinedTurnoverState(),adr:getAdrCandleDiagnostics(),breadth:getRankBreadthDataState(),sentiment:getRankSentimentDataState(),volatility:getRankVolatilityDataState()})));console.log(errors);throw error;});
  }
  hold=false;release.forEach(resolve=>resolve());
  await page.waitForFunction(()=>!getCombinedRankChartState().busy);
  assert.deepEqual(errors,[]);await page.close();console.log(`${mode}: ${blocked} blocked; independent data drew before release`);
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
