// 2026-11-12: 종목을 바꿔 지난 구간을 다시 채울 때 휴장일(주말)은 조회하지 않는다.
// 11/11 오라클에서 한 브라우저가 주말 11/7 · 11/8 수급을 각각 4,775번 조회했다(빈 응답은 캐시에 남지 않아 매번 다시 조회).
// 기간이 주말을 끼도록(10/15~10/21) 만들고, 주야간 선물(새벽 구간이 토요일로 넘어감)을 켠 뒤 종목을 바꾼다.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'});try{
 const page=await browser.newPage({viewport:{width:1900,height:1100}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-10-21T12:00:00+09:00')});
 await page.addInitScript(()=>{window.candleRects={};const old=CanvasRenderingContext2D.prototype.fillRect,clear=CanvasRenderingContext2D.prototype.clearRect;CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.closest('.rank-adr-candle-area,.concentration-candle-area'))window.candleRects[this.canvas.closest('section')?.id]=[];return clear.apply(this,a);};CanvasRenderingContext2D.prototype.fillRect=function(...a){if(this.canvas.closest('.rank-adr-candle-area,.concentration-candle-area'))(window.candleRects[this.canvas.closest('section')?.id]||=[]).push(a);return old.apply(this,a);};});
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 const times=['2026-10-15','2026-10-16','2026-10-19','2026-10-20','2026-10-21'].flatMap(day=>Array.from({length:20},(_,i)=>Date.parse(day+'T09:00:00+09:00')+i*60000));
 const prices=market=>times.map((t,i)=>({t,date:new Date(t+9*3600000).toISOString().slice(0,16).replace('T',' '),open:(market==='kosdaq'?900:2500)+i,high:(market==='kosdaq'?910:2510)+i,low:(market==='kosdaq'?890:2490)+i,close:(market==='kosdaq'?905:2505)+i,market_turnover:1e12})).map((p,i)=>i===7?{...p,low:null}:p);
 const flow=times.map((t,i)=>({t,foreign:i+1,institution:-i-1,individual:i*2,program:-i*2}));
 await page.route('http://minute.test/**',route=>{const u=new URL(route.request().url());requests.push(u.pathname+u.search);const market=u.searchParams.get('market')||u.searchParams.get('code')||'kospi';let data;
 if(u.pathname.endsWith('market-supply/chart'))data={success:true,points:flow,candles:prices(market==='futuresKosdaq'?'kosdaq':market).slice(-5),warnings:[],has_more:false};
 else if(u.pathname==='/api/ls-futures-test/chart')data={success:true,points:flow,candles:[],warnings:[],has_more:false};
 else if(u.pathname==='/api/ls-futures-test/candles')data={success:true,points:prices(market==='futuresKosdaq'?'kosdaq':'kospi'),has_more:false};
 else if(u.pathname==='/api/chart-reference'||u.pathname==='/api/adr/candles')data={success:true,points:u.pathname==='/api/chart-reference'?prices(market).slice(-5):prices(market),has_more:false};
 else if(u.pathname==='/api/concentration-chart')data={success:true,market:'K',points:prices('stock').map(p=>({time:new Date(p.t+9*3600000).toISOString().slice(0,19).replace(/[-:T ]/g,''),stock_open:p.open,stock_high:p.high,stock_low:p.low,stock_price:p.close,value:10})),has_more:false};
 else if(u.pathname==='/api/supply/watchlist')data={success:true,stocks:[{code:'005930',name:'삼성전자'},{code:'000660',name:'SK하이닉스'}],archive:[{code:'005930',name:'삼성전자'},{code:'000660',name:'SK하이닉스'}],revision:1};
 // Stock supply minute history is read from KIS per date; daily stays on /api/supply/chart.
 else if(u.pathname==='/api/supply/chart'||u.pathname==='/api/kis-supply/chart'){
 const days=['2026-10-15','2026-10-16','2026-10-19','2026-10-20','2026-10-21'];
 const date=u.searchParams.get('date') || (u.searchParams.get('cursor')?u.searchParams.get('cursor').replace(/^(....)(..)(..)$/,'$1-$2-$3'):'2026-10-21');
 const index=days.indexOf(date);
 data={success:true,date,available_dates:days,points:flow.filter(p=>new Date(p.t+9*3600000).toISOString().slice(0,10)===date),has_more:index>0,cursor:index>0?days[index-1].replaceAll('-',''):null};
 }
 else if(u.pathname==='/api/supply/candles'){
 const date=u.searchParams.get('date') || '2026-10-21';
 data={success:true,points:prices('stock').filter(p=>p.date.startsWith(date)),date,has_more:false};
 }
 else if(u.pathname==='/api/turnover/chart')data={success:true,markets:{kospi:prices('kospi'),kosdaq:prices('kosdaq')},warnings:[],has_more:!u.searchParams.get('cursor'),cursor:u.searchParams.get('cursor')?null:'20261018'};
 else if(u.pathname==='/api/adr/today')data={intraday:[],lastClosed:{date:'20261023',adr:75.5}};
 else if(u.pathname==='/api/risk/breadth')data={dates:prices(market).slice(-5).map(p=>p.date),series:Object.fromEntries(['highs','lows'].map(id=>[id,{points:prices(market).slice(-5).map(p=>({date:p.date,value:null}))}])),has_more:false};
 else if(u.pathname.startsWith('/api/'))data={success:true,series:[],points:[],has_more:false};
 if(data)return route.fulfill({json:data});return route.fulfill({contentType:'text/html',body:html});});
 await page.goto('http://minute.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
 for(const f of ['rank-chart-axis.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js',process.env.SUPPLY_SCRIPT||'rank-supply-chart.js','rank-market-supply-chart.js'])await page.addScriptTag({path:f.includes('/')?f:'public/'+f});
 await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 // The market supply card opens on KOSPI200 futures; these checks start from spot KOSPI.
 await page.locator('#rankTestMarketSupplyChartPanel .rank-market-choice input[value="kospi"]').check();
 await page.evaluate(()=>window.selectRankChartStock({code:'005930',name:'삼성전자'}));await page.locator('#rankTestMarketSupplyChartPanel [data-mode="minute"]').click();
 await page.locator('#rankTestMarketSupplyChartPanel .concentration-candle-toggle').click();await page.waitForTimeout(500);

 await page.locator('#rankTestMarketSupplyChartPanel .rank-market-choice input[value="futures"]').check();await page.waitForTimeout(300);
 await page.evaluate(()=>window.RankChartAxis.requestHistory('minute'));await page.waitForTimeout(800);
 const domainDays=await page.evaluate(()=>window.RankChartAxis.minuteDomain().days);
 assert.ok(domainDays.some(d=>['2026-10-17','2026-10-18'].includes(d)),'the shared window includes a weekend day: '+domainDays.join(','));
 for(const code of ['000660','005930']){
  const mark=requests.length;
  await page.locator('#rankCombinedSupplyChartPanel .supply-stock-select').selectOption(code);
  await page.waitForFunction(()=>!document.querySelector('#rankCombinedSupplyChartPanel .supply-stock-select').disabled);
  await page.waitForTimeout(600);
  const asked=requests.slice(mark).filter(u=>u.includes('/api/kis-supply/chart?')&&u.includes('code='+code));
  for(const day of ['2026-10-15','2026-10-16','2026-10-19','2026-10-20'])assert.ok(asked.some(u=>u.includes('date='+day)),code+' '+day+' still refilled');
  assert.deepEqual(asked.filter(u=>/date=2026-10-1[78]/.test(u)),[],code+': no weekend date asked');
 }
 assert.deepEqual(errors,[]);
 console.log('PASS symbol change refills open days only (no weekend dates)');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
