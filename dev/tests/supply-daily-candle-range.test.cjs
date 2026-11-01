const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
test('supply daily candles catch up to late peer history, extend repeatedly and refresh latest prices',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}}),calls=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-01T12:00:00+09:00')});
  let close=105,releaseTopic;
  const topicReady=new Promise(resolve=>{releaseTopic=resolve;});
  const at=date=>Date.parse(date+'T00:00:00+09:00');
  await page.route('http://daily-range.test/**',async route=>{
   const url=new URL(route.request().url());let result;
   if(url.pathname==='/api/supply/watchlist')result={success:true,stocks:[{code:'005930',name:'Samsung'}],archive:[{code:'005930',name:'Samsung'}],revision:1};
   else if(url.pathname==='/api/supply/chart'){await topicReady;result={success:true,points:[{t:at('2026-10-30'),foreign:100}],has_more:false};}
   else if(url.pathname==='/api/supply/candles'){
    calls.push(Object.fromEntries(url.searchParams));
    const from=url.searchParams.get('from')||'20251029';
    const dates=['20220103','20230102','20240514','20261030'].filter(date=>date>=from);
    result={success:true,points:dates.map(date=>({t:at(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)),open:100,high:120,low:90,close})),has_more:false};
   }
   if(result)return route.fulfill({json:result});
   return route.fulfill({contentType:'text/html',body:'<main id="tab_rank"><div class="rank-chart-row"><section class="panel" id="concentrationChartPanel" style="height:500px"></section><section class="panel" id="rankBreadthChartPanel" style="height:500px"></section></div></main>'});
  });
  await page.goto('http://daily-range.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')});
  for(const file of ['rank-chart-axis.js','rank-supply-chart.js'])await page.addScriptTag({path:'public/'+file});
  await page.waitForFunction(()=>window.getRankCombinedSupplyState?.().selected==='005930');
  await page.locator('#rankCombinedSupplyChartPanel .concentration-candle-toggle').click();
  await page.waitForFunction(()=>getRankCombinedSupplyState().candles.length>0);
  assert.equal(calls[0].count,'600','Before a common range exists, use the standard initial bar count');
  assert.equal(calls[0].from,undefined,'An arbitrary multi-year fallback must not expand the common axis');
  releaseTopic();
  for(const first of ['2024-05-14','2023-01-02']){
   await page.evaluate(first=>{const draw=()=>RankChartAxis.sharedRange('latePeer',[first,'2026-10-30'],v=>v,'day',0,null,draw);draw();},first);
   await page.waitForFunction(first=>getRankCombinedSupplyState().candles.some(p=>new Date(p.t+32400000).toISOString().slice(0,10)===first),first);
   assert.ok(calls.some(call=>call.from===first.replaceAll('-','')&&call.mode==='day'));
  }
  await page.evaluate(async()=>{
   let first='2023-01-02',more=true;
   const draw=()=>RankChartAxis.sharedRange('latePeer',[first,'2026-10-30'],v=>v,'day',0,null,draw);
   RankChartAxis.registerHistoryLoader('latePeer',async()=>{first='2022-01-03';more=false;draw();},()=>false,()=>({hasMore:more,cursor:first,coverageFirst:first}));
   await RankChartAxis.requestHistory('day');
  });
  await page.waitForFunction(()=>getRankCombinedSupplyState().candles.some(p=>new Date(p.t+32400000).toISOString().slice(0,10)==='2022-01-03'));
  close=106;await page.evaluate(()=>refreshRankCombinedSupplyChart());
  await page.waitForFunction(()=>getRankCombinedSupplyState().candles.some(p=>p.close===106));
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
