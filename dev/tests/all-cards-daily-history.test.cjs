const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
const {createLsFuturesTest}=require('../../ls-futures-test');
const {timestamp}=require('../../supply-service');
test('all daily cards advance twice with the real futures provider and opaque reference cursors',async()=>{
 const dates=['20190701','20211201','20211202','20240405','20240408','20261030'];
 const stage=cursor=>!cursor?0:String(cursor).includes('20240407')?1:2;
 const pageDates=n=>n===0?['20240408','20261030']:n===1?['20211202','20240405']:['20190701','20211201'];
 const next=n=>n===0?'REF20240407':n===1?'REF20211201':null;
 const iso=d=>d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6);
 const bar=d=>({t:timestamp(d),date:iso(d),open:100,high:110,low:90,close:105});
 const sourcePages=[];
 const futures=createLsFuturesTest({now:()=>timestamp('20261101','120000'),pause:async()=>{},getToken:async()=>'',
  dailyProvider:{daily:async(code,cursor)=>{sourcePages.push(stage(cursor));const n=stage(cursor);return {points:pageDates(n).map(d=>({t:timestamp(d),...(n===0?{individual:100,foreign:-100,institution:0}:{})})),has_more:n<2,cursor:next(n),warnings:[]};}},
  http:{post:async(url,body,{headers})=>{
   const tr=headers.tr_cd,p=body[tr+'InBlock'];
   if(tr==='t8467'||tr==='t8455')return {data:{rsp_cd:'00000',[tr+'OutBlock']:[{shcode:'A016C000',hname:'F 2612'}]}};
   if(tr==='t8462')return {data:{rsp_cd:'00000',t8462OutBlock1:p.from_date<'20240408'?[]:[{date:p.from_date,sa_08:'1',sa_17:'-1',sa_18:'0'}]}};
   return {data:{rsp_cd:'00000',[tr+'OutBlock1']:dates.filter(d=>d<=p.date).map(d=>({date:d,open:100,high:110,low:90,close:105}))}};
  }}
 });
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:2200,height:1200}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-01T12:00:00+09:00')});
  await page.addInitScript(()=>{window.rankManagedChartRefresh=true;window.rankChartRefreshStarted=false;window.paintDates={};
   const clear=CanvasRenderingContext2D.prototype.clearRect,fill=CanvasRenderingContext2D.prototype.fillRect;
   CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.closest('.rank-adr-candle-area,.concentration-candle-area'))window.paintDates[this.canvas.closest('section')?.id]=0;return clear.apply(this,a);};
   CanvasRenderingContext2D.prototype.fillRect=function(...a){if(this.canvas.closest('.rank-adr-candle-area,.concentration-candle-area'))window.paintDates[this.canvas.closest('section')?.id]=(window.paintDates[this.canvas.closest('section')?.id]||0)+1;return fill.apply(this,a);};
  });
  const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  await page.route('http://all-history.test/**',async route=>{
   const u=new URL(route.request().url()),p=u.pathname,b=route.request().method()==='POST'?route.request().postDataJSON():{},input=Object.fromEntries(u.searchParams);
   if(!p.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:html});
   try{
    if(p==='/api/ls-futures-test/chart')return route.fulfill({json:await futures.query(input)});
    if(p==='/api/ls-futures-test/candles')return route.fulfill({json:await futures.priceRange(input)});
    if(p==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'Stock'}],archive:[{code:'005930',name:'Stock'}],revision:1}});
    const n=stage(b.cursor||input.cursor),ds=pageDates(n),bars=ds.map(bar);
    let data={success:true,points:ds.map(d=>({t:timestamp(d),foreign:100,institution:-50,individual:-50,program:1})),candles:[],has_more:n<2,cursor:next(n),warnings:[]};
    if(p.includes('concentration-chart'))data={success:true,mode:'day',market:'K',points:ds.map(d=>({time:d,value:b.prices_only?null:25,stock_price:105,stock_open:100,stock_high:110,stock_low:90})),has_more:n<2,cursor:next(n)};
    else if(p.endsWith('/candles'))data={success:true,points:dates.filter(d=>d>=(input.from||'20240408')&&d<=(input.to||'20261030')).map(bar),has_more:false};
    else if(p==='/api/chart-reference')data={success:true,points:bars,has_more:n<2,cursor:next(n)};
    else if(p.includes('turnover/chart'))data={success:true,markets:{kospi:bars.map(x=>({...x,market_turnover:1e12})),kosdaq:bars.map(x=>({...x,market_turnover:2e12}))},warnings:[],has_more:n<2,cursor:next(n)};
    else if(p==='/api/adr/history')data={series:dates.map(d=>({date:iso(d),adr:100}))};
    else if(p==='/api/adr/today')data={intraday:[],adr:100};
    else if(p.startsWith('/api/risk/'))data={dates:ds.map(iso),series:Object.fromEntries(['highs','lows','vix','vkospi','fear-greed','high-yield-spread'].map(id=>[id,{points:dates.map(d=>({date:iso(d),value:20}))}])),has_more:n<2,cursor:next(n)};
    return route.fulfill({json:data});
   }catch(error){return route.fulfill({status:error.status||500,json:{error:error.message}});}
  });
  await page.goto('http://all-history.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
  for(const file of ['rank-chart-axis.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js'])await page.addScriptTag({path:'public/'+file});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.evaluate(async()=>{
   window.rankMainCandleOpen=true;
   applyConcentrationDisplaySettings({...getConcentrationDisplaySettings(),mode:'day',candleOpen:true});selectRankChartStock({code:'005930',name:'Stock',market:'K'});
   applyRankCombinedSupplySettings({selected:'005930',mode:'day',showCandles:true});
   for(const name of ['TestMarketSupply','TestMarketSupplySecondary']){window['applyRank'+name+'DisplaySettings']({selected:'futures',mode:'day'});window['applyRank'+name+'CandleOpen'](true);}
   applyRankBreadthDisplaySettings({mode:'day',candleOpen:true});applyRankSentimentDisplaySettings({candleOpen:true});applyRankVolatilityDisplaySettings({candleOpen:true});applyRankCombinedTurnoverCandleOpen(true);
   applyRankAdrCandleOpen(true);
   window.rankChartRefreshStarted=true;await RankChartAxis.refreshCharts();
  });
  for(const first of ['2021-12-02','2019-07-01']){
   const result=await page.evaluate(()=>RankChartAxis.requestHistory('day'));
   assert.deepEqual(result.failures,[]);assert.equal(result.advanced,true);assert.equal(await page.evaluate(()=>RankChartAxis.dailyDomain().first),first);
   assert.equal(result.metrics.cards.combinedSupply.pages,1,'Stock flow also advances its own history page');
   await page.waitForFunction(()=>Object.values(window.paintDates).filter(n=>n>0).length>=9,null,{timeout:8000}).catch(async error=>{console.log('Daily paint diagnostics',await page.evaluate(()=>({paint:window.paintDates,errors:[...document.querySelectorAll('.rank-adr-status')].map(p=>p.textContent),candles:[...document.querySelectorAll('.concentration-candle-toggle')].map(p=>({panel:p.closest('.panel')?.id,open:p.getAttribute('aria-expanded')}))})));throw error;});
   assert.ok((await page.evaluate(()=>getRankCombinedSupplyState().candles)).some(p=>p.t===timestamp(first.replaceAll('-',''))));
   assert.ok((await page.evaluate(()=>getCombinedRankChartState().points)).some(p=>p.time===first.replaceAll('-','')&&p.stock_price===105));
   assert.equal(await page.evaluate(()=>getTestMarketSupplyCandleDiagnostics().visibleFirst),timestamp(first.replaceAll('-','')));
   assert.equal(sourcePages.at(-1),first==='2021-12-02'?1:2,'Unavailable old flow must not consume extra reference pages to chase a non-null value');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();futures.stop();}
});
