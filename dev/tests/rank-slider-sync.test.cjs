const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1800,height:1500}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://drag.test/**',route=>{
 const url=new URL(route.request().url()),points=Array.from({length:100},(_,i)=>{const d=new Date(Date.parse('2026-10-23T08:00:00+09:00')+i*60000),time=new Date(d.getTime()+9*3600000).toISOString().slice(0,19).replace(/[-:T]/g,'');return {time,t:d.getTime(),date:'2026-10-23',value:50,adr:90,individual:i,foreign:-i,institution:i*2,program:-i*2,stock_open:100,stock_high:110,stock_low:90,stock_price:105,open:100,high:110,low:90,close:105};});
 if(url.pathname==='/api/supply/watchlist')return route.fulfill({json:{revision:1,stocks:[{code:'000660',name:'SK하이닉스'}],archive:[{code:'000660',name:'SK하이닉스'}]}});
 if(url.pathname.startsWith('/api/supply/'))return route.fulfill({json:{success:true,points:points.filter((_,i)=>i>=60 && i%3===0),candles:points,has_more:false}});
 if(url.pathname==='/api/concentration-chart')return route.fulfill({json:{success:true,points,has_more:false}});
 if(url.pathname==='/api/chart-reference')return route.fulfill({json:{points,cursor:null}});
 if(url.pathname==='/api/adr/today')return route.fulfill({json:{intraday:points}});
 if(url.pathname==='/api/adr/history')return route.fulfill({json:{series:[]}});
 return route.fulfill({contentType:'text/html',body:fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'')});});
 await page.goto('http://drag.test/');await page.addStyleTag({path:'public/style.css'});
 await page.evaluate(INDEPENDENT=>{Date.now=()=>Date.parse('2026-10-23T10:00:00+09:00');document.querySelector('#tabContents').style.display='block';document.querySelector('#loginOverlay').style.display='none';window.rankIndependentClient=INDEPENDENT;if(!INDEPENDENT){const panel=document.createElement('section');panel.id='rankBreadthChartPanel';document.querySelector('.rank-chart-row').append(panel);}
 const p=CanvasRenderingContext2D.prototype,clear=p.clearRect,line=p.lineTo,fill=p.fillRect;
 p.clearRect=function(...a){this.canvas.dragRect=null;this.canvas.maxLineX=0;return clear.apply(this,a)};
 p.lineTo=function(x,y){this.canvas.maxLineX=Math.max(this.canvas.maxLineX,x);return line.call(this,x,y)};
 p.fillRect=function(x,y,w,h){if(this.fillStyle.startsWith('rgba(15, 23, 42,'))this.canvas.dragRect={left:x,right:x+w};return fill.call(this,x,y,w,h)};},!process.argv.includes('--main'));
 for(const name of ['rank-chart-axis','concentration-chart','rank-adr-chart','rank-supply-chart'])await page.addScriptTag({path:`public/${name}.js`});
 await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 await page.evaluate(()=>{applyConcentrationDisplaySettings({candleOpen:true,mode:'minute'});selectRankChartStock({code:'000660',name:'SK하이닉스',market:'K'});applyRankAdrCandleOpen(true);});
 await page.locator('#rankAdrChartPanel [data-adr-mode=minute]').click();
 await page.evaluate(()=>refreshRankSupplyChart());
 await page.waitForFunction(()=>getRankChartState().points.length===100 && !document.querySelector('#rankAdrChartPanel .rank-adr-zoom button:last-child').disabled);
 await page.locator('#concentrationZoomIn').click();
 await page.waitForFunction(()=>!document.querySelector('#rankSupplyChartPanel input[type=range]').disabled);
 const sliders=['#concentrationRange','#rankSupplyChartPanel input[type=range]','#rankAdrChartPanel input[type=range]'];
 const positions=()=>page.evaluate(selectors=>selectors.map(s=>document.querySelector(s).value),sliders);
 let values=await positions();assert.ok(values.every(v=>v===values[0]),JSON.stringify(values));
 await page.locator(sliders[1]).fill('10000');
 await page.waitForFunction(()=>RankChartAxis.minuteDomain().last==='2026-10-23 09:39');
 values=await positions();assert.deepEqual(values,['10000','10000','10000']);
 await page.locator(sliders[2]).fill('0');
 await page.waitForFunction(()=>RankChartAxis.minuteDomain().first==='2026-10-23 08:00');
 values=await positions();assert.deepEqual(values,['0','0','0']);
 assert.deepEqual(errors,[]);console.log('PASS '+(process.argv.includes('--main')?'main':'independent')+' minute sliders share positions and scroll through empty and sparse data');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
