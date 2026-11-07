// Every trading chart card draws its price candles even when its own data (ratio, flow, turnover, breadth, ADR)
// is missing for the period (2026-11-07 request: "주제 데이터가 없다고 해서 캔들이 안 보이는 데가 있는지").
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const page=await browser.newPage({viewport:{width:1900,height:1400}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-10-23T12:00:00+09:00')});
 await page.addInitScript(()=>{window.candleRects={};const old=CanvasRenderingContext2D.prototype.fillRect,clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.closest('.rank-adr-candle-area,.concentration-candle-area'))window.candleRects[this.canvas.closest('section')?.id]=[];return clear.apply(this,a);};CanvasRenderingContext2D.prototype.fillRect=function(...a){if(this.canvas.closest('.rank-adr-candle-area,.concentration-candle-area'))(window.candleRects[this.canvas.closest('section')?.id]||=[]).push(a);return old.apply(this,a);};});
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 const days5=['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23'],day='2026-10-23',times=Array.from({length:30},(_,i)=>Date.parse(day+'T09:00:00+09:00')+i*60000);
 const prices=base=>times.map((t,i)=>({t,date:new Date(t+9*3600000).toISOString().slice(0,16).replace('T',' '),open:base+i,high:base+i+10,low:base+i-10,close:base+i+5}));
 await page.route('http://empty.test/**',route=>{const u=new URL(route.request().url()),q=u.searchParams,market=q.get('market')||q.get('code')||'kospi';let data;
  // Main data: none at all. Candles: present.
  if(u.pathname.endsWith('market-supply/chart'))data={success:true,points:[],candles:prices(2500),warnings:[],has_more:false};
  else if(u.pathname==='/api/ls-futures-test/chart')data={success:true,points:[],candles:[],warnings:[],has_more:false};
  else if(u.pathname==='/api/ls-futures-test/candles')data={success:true,points:prices(2500),has_more:false};
  else if(u.pathname==='/api/chart-reference'||u.pathname==='/api/adr/candles')data={success:true,points:prices(market==='kosdaq'?900:2500),has_more:false};
  else if(u.pathname==='/api/concentration-chart')data={success:true,market:'K',points:prices(70000).map(p=>({time:new Date(p.t+9*3600000).toISOString().slice(0,19).replace(/[-:T ]/g,''),stock_open:p.open,stock_high:p.high,stock_low:p.low,stock_price:p.close,value:null})),has_more:false};
  else if(u.pathname==='/api/supply/watchlist')data={success:true,stocks:[{code:'005930',name:'삼성전자'}],archive:[{code:'005930',name:'삼성전자'}],revision:1};
  else if(u.pathname==='/api/supply/chart'&&q.get('mode')==='day')data={success:true,mode:'day',points:[{t:Date.parse(day+'T00:00:00+09:00'),foreign:1,institution:1,individual:1,program:1}],candles:[],has_more:false};
  else if(u.pathname==='/api/supply/candles'&&q.get('mode')==='day')data={success:true,mode:'day',points:days5.map(d=>({t:Date.parse(d+'T00:00:00+09:00'),open:1,high:3,low:1,close:2})),partial:false};
  else if(u.pathname==='/api/ls-stock-futures/chart'&&q.get('mode')==='day')data={success:true,mode:'day',points:[{t:Date.parse(day+'T00:00:00+09:00'),foreign:1,institution:1,individual:1}],has_more:false};
  else if(u.pathname==='/api/ls-stock-futures/candles'&&q.get('mode')==='day')data={success:true,mode:'day',points:days5.map(d=>({t:Date.parse(d+'T00:00:00+09:00'),open:1,high:3,low:1,close:2})),partial:false,exhausted:true};
  else if(u.pathname==='/api/supply/chart'||u.pathname==='/api/kis-supply/chart')data={success:true,date:day,available_dates:[day],points:[],has_more:false,cursor:null};
  else if(u.pathname==='/api/supply/candles')data={success:true,points:prices(70000),date:day,has_more:false};
  else if(u.pathname==='/api/ls-stock-futures/chart')data={success:true,mode:'minute',date:day,available_dates:[],points:[],has_more:false,cursor:null,warnings:[],status:{error:''}};
  else if(u.pathname==='/api/ls-stock-futures/candles')data={success:true,mode:'minute',date:day,points:prices(70000),has_more:false,cursor:null};
  else if(u.pathname==='/api/turnover/chart')data={success:true,markets:{kospi:prices(2500),kosdaq:prices(900)},warnings:[],has_more:false};
  else if(u.pathname==='/api/adr/today')data={intraday:[],lastClosed:null};
  else if(u.pathname==='/api/risk/breadth')data={dates:[],series:{highs:{points:[]},lows:{points:[]}},has_more:false};
  else if(u.pathname==='/api/auth/session')data={authenticated:true,user:{email:'chart-test@example.test'}};
  else if(u.pathname.startsWith('/api/'))data={success:true,series:[],points:[],has_more:false};
  if(data)return route.fulfill({json:data});return route.fulfill({contentType:'text/html',body:html});});
 await page.goto('http://empty.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
 for(const f of ['rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js'])await page.addScriptTag({path:'public/'+f});
 await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 await page.locator('#rankTestMarketSupplyChartPanel .rank-market-choice input[value="kospi"]').check();
 await page.evaluate(()=>window.selectRankChartStock({code:'005930',name:'삼성전자'}));
 await page.locator('#rankTestMarketSupplyChartPanel [data-mode="minute"]').click();
 for(const id of ['rankTestMarketSupplyChartPanel','rankFuturesSupplyChartPanel'])await page.locator('#'+id+' .concentration-candle-toggle').click().catch(()=>{});
 await page.locator('#rankFuturesSupplyChartPanel [data-mode="minute"]').click();
 await page.waitForTimeout(1500);
 const ids=['combinedConcentrationChartPanel','rankTestMarketSupplyChartPanel','rankAdrChartPanel','rankCombinedSupplyChartPanel','rankFuturesSupplyChartPanel','rankCombinedTurnoverChartPanel','rankBreadthChartPanel'];
 const drawn=await page.evaluate(ids=>Object.fromEntries(ids.map(id=>[id,(window.candleRects[id]||[]).length])),ids);
 console.log(JSON.stringify(drawn));
 for(const id of ids)assert.ok(drawn[id]>=30,`${id}: candles must draw without its main data (${drawn[id]} rects)`);
 // Day charts: flow on one day only, candles on five days → all five candles drawn.
 for(const id of ['rankCombinedSupplyChartPanel','rankFuturesSupplyChartPanel']){await page.locator('#'+id+' [data-mode="day"]').click();await page.waitForTimeout(800);if(await page.locator('#'+id+' .rank-adr-candle-area').isHidden())await page.locator('#'+id+' .concentration-candle-toggle').click();}
 await page.waitForTimeout(1500);
 for(const id of ['rankCombinedSupplyChartPanel','rankFuturesSupplyChartPanel'])assert.equal(await page.evaluate(id=>(window.candleRects[id]||[]).length,id),5,id+' day candles on days without flow');
 assert.deepEqual(errors,[]);
 console.log('PASS every minute candle card draws its candles with no main data; day supply cards draw candles on days without flow');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
