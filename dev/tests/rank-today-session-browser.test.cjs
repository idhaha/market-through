const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
// 당일 after 더 불러오기 returns every minute card to one session: today once it opened, otherwise the last open day.
async function scenario(now,days,expected){const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const page=await browser.newPage({viewport:{width:1900,height:1100}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date(now)});
 await page.addInitScript(()=>{window.candleRects={};const old=CanvasRenderingContext2D.prototype.fillRect,clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.closest('.rank-adr-candle-area,.concentration-candle-area'))window.candleRects[this.canvas.closest('section')?.id]=[];return clear.apply(this,a);};CanvasRenderingContext2D.prototype.fillRect=function(...a){if(this.canvas.closest('.rank-adr-candle-area,.concentration-candle-area'))(window.candleRects[this.canvas.closest('section')?.id]||=[]).push(a);return old.apply(this,a);};});
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 const times=days.flatMap(day=>Array.from({length:20},(_,i)=>Date.parse(day+'T09:00:00+09:00')+i*60000));
 const prices=market=>times.map((t,i)=>({t,date:new Date(t+9*3600000).toISOString().slice(0,16).replace('T',' '),open:(market==='kosdaq'?900:2500)+i,high:(market==='kosdaq'?910:2510)+i,low:(market==='kosdaq'?890:2490)+i,close:(market==='kosdaq'?905:2505)+i,market_turnover:1e12})).map((p,i)=>i===7?{...p,low:null}:p);
 const flow=times.map((t,i)=>({t,foreign:i+1,institution:-i-1,individual:i*2,program:-i*2}));
 await page.route('http://minute.test/**',route=>{const u=new URL(route.request().url());requests.push(u.pathname+u.search);const market=u.searchParams.get('market')||u.searchParams.get('code')||'kospi';let data;
 if(u.pathname.endsWith('market-supply/chart'))data={success:true,points:flow,candles:prices(market==='futuresKosdaq'?'kosdaq':market).slice(-5),warnings:[],has_more:false};
 else if(u.pathname==='/api/ls-futures-test/chart')data={success:true,points:flow,candles:[],warnings:[],has_more:false};
 else if(u.pathname==='/api/ls-futures-test/candles')data={success:true,points:prices(market==='futuresKosdaq'?'kosdaq':'kospi'),has_more:false};
 else if(u.pathname==='/api/chart-reference'||u.pathname==='/api/adr/candles')data={success:true,points:prices(market),has_more:false};
 else if(u.pathname==='/api/concentration-chart')data={success:true,market:'K',points:prices('stock').map(p=>({time:new Date(p.t+9*3600000).toISOString().slice(0,19).replace(/[-:T ]/g,''),stock_open:p.open,stock_high:p.high,stock_low:p.low,stock_price:p.close,value:10})),has_more:false};
 else if(u.pathname==='/api/supply/watchlist')data={success:true,stocks:[{code:'005930',name:'삼성전자'}],archive:[{code:'005930',name:'삼성전자'}],revision:1};
 else if(u.pathname==='/api/supply/chart')data={success:true,points:flow,has_more:false};
 else if(u.pathname==='/api/supply/candles')data={success:true,points:prices('stock'),date:days.at(-1),has_more:false};
 else if(u.pathname==='/api/turnover/chart')data={success:true,markets:{kospi:prices('kospi'),kosdaq:prices('kosdaq')},warnings:[],has_more:false};
 else if(u.pathname==='/api/adr/today')data={intraday:times.map(t=>({t:t/1000,adr:100})),adr:100,asOf:times.at(-1)};
 else if(u.pathname==='/api/risk/breadth')data={dates:prices(market).map(p=>p.date),series:Object.fromEntries(['highs','lows'].map(id=>[id,{points:prices(market).map(p=>({date:p.date,value:id==='highs'?5:-3}))}])),has_more:false};
 else if(u.pathname.startsWith('/api/'))data={success:true,series:[],points:[],has_more:false};
 if(data)return route.fulfill({json:data});return route.fulfill({contentType:'text/html',body:html});});
 await page.addInitScript(()=>{
  window.turnoverPaths=[];
  const proto=CanvasRenderingContext2D.prototype,begin=proto.beginPath,move=proto.moveTo,stroke=proto.stroke;
  proto.beginPath=function(...args){this.turnoverMoves=0;return begin.apply(this,args);};
  proto.moveTo=function(...args){this.turnoverMoves=(this.turnoverMoves || 0)+1;return move.apply(this,args);};
  proto.stroke=function(...args){if(this.canvas.closest('#rankCombinedTurnoverChartPanel .rank-adr-area') && ['#339af0','#e11d48'].includes(this.strokeStyle) && this.lineWidth>=1.5)window.turnoverPaths.push(this.turnoverMoves);return stroke.apply(this,args);};
 });
 await page.goto('http://minute.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
 for(const f of ['rank-chart-axis.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js'])await page.addScriptTag({path:'public/'+f});
 await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 // The market supply card opens on KOSPI200 futures; these checks start from spot KOSPI.
 await page.locator('#rankTestMarketSupplyChartPanel .rank-market-choice input[value="kospi"]').check();
 await page.evaluate(()=>window.selectRankChartStock({code:'005930',name:'삼성전자'}));await page.locator('#rankTestMarketSupplyChartPanel [data-mode="minute"]').click();
 await page.locator('#rankTestMarketSupplyChartPanel .concentration-candle-toggle').click();await page.waitForTimeout(500);
 const ids=['combinedConcentrationChartPanel','rankTestMarketSupplyChartPanel','rankAdrChartPanel','rankCombinedSupplyChartPanel','rankCombinedTurnoverChartPanel','rankBreadthChartPanel'];
 const assertDrawn=async()=>{for(const id of ids)assert.ok(await page.evaluate(id=>window.candleRects[id]?.length>0 && window.candleRects[id].every(a=>a.every(Number.isFinite)),id),id);};
 await assertDrawn();
 await page.evaluate(()=>window.RankChartAxis.requestHistory('minute'));await page.waitForTimeout(500);
 const domain=()=>page.evaluate(()=>{const d=window.RankChartAxis.minuteDomain();return {first:d.first.slice(0,10),last:d.last.slice(0,10)};});
 assert.deepEqual(await domain(),{first:days[0],last:days.at(-1)},'more history shows both days');
 await page.locator('#rankCombinedSupplyChartPanel .chart-today-button').click();await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>window.RankChartAxis.sessionDay()),expected);
 assert.deepEqual(await domain(),{first:expected,last:expected},'당일 shows one session');
 assert.ok(await page.evaluate(()=>window.getTestMarketSupplyCandleDiagnostics().visibleCandles)>0,'the session still draws');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}}
(async()=>{
 await scenario('2026-11-06T12:00:00+09:00',['2026-11-05','2026-11-06'],'2026-11-06');
 await scenario('2026-11-07T12:00:00+09:00',['2026-11-05','2026-11-06'],'2026-11-06');
 await scenario('2026-11-09T07:30:00+09:00',['2026-11-05','2026-11-06'],'2026-11-06');
 console.log('당일 after more history: weekday today, Saturday and before 08:00 all show the last open session');
})().catch(e=>{console.error(e);process.exitCode=1;});
