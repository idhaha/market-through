const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://restore.test/**',route=>{const path=new URL(route.request().url()).pathname;
 if(path==='/api/concentration-chart')return route.fulfill({json:{success:true,market:'K',points:[{time:'20261023080000',value:null,stock_open:1200000,stock_high:1210000,stock_low:1190000,stock_price:1205000},{time:'20261023090000',value:50,stock_open:1205000,stock_high:1210000,stock_low:1200000,stock_price:1206000}],has_more:false,cursor:null}});
 if(path.startsWith('/api/'))return route.fulfill({json:{stocks:[],archive:[],revision:0,points:[],series:{},markets:{kospi:[],kosdaq:[]}}});
 return route.fulfill({contentType:'text/html',body:fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'')});});
 await page.goto('http://restore.test/');await page.addStyleTag({path:'public/style.css'});
 for(const name of ['rank-chart-axis','concentration-chart','rank-adr-chart','rank-turnover-chart','rank-volatility-chart','rank-supply-chart'])await page.addScriptTag({path:`public/${name}.js`});
 await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 const selector='.rank-chart-row .concentration-candle-toggle';assert.equal(await page.locator(selector).count(),7);
 for(const open of [true,false,true]){
 await page.evaluate(open=>window.applyConcentrationDisplaySettings({candleOpen:open,adrCandleOpen:!open,turnoverCandleOpen:!open,volatility:{candleOpen:!open},breadth:{candleOpen:!open},sentiment:{candleOpen:!open}}),open);
 assert.ok((await page.locator(selector).evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-expanded')))).every(value=>value===String(open)));
 }
 await page.evaluate(()=>{window.applyConcentrationDisplaySettings({candleOpen:true,mode:'minute',interval:1});window.selectRankChartStock({code:'000660',name:'SK하이닉스'});});
 await page.waitForFunction(()=>window.getRankChartState().points.length===2);
 const points=await page.evaluate(()=>window.getRankChartState().points);assert.equal(points[0].value,null);assert.equal(points[0].stock_price,1205000);assert.equal(points[0].time,'20261023080000');
 const modes=[['concentrationChartPanel','data-chart-mode'],['rankSupplyChartPanel','data-mode'],['rankBreadthChartPanel','data-breadth-mode'],['rankTurnoverChartPanel','data-mode'],['rankAdrChartPanel','data-adr-mode']];
 for(const [source,attr,mode] of [['rankSupplyChartPanel','data-mode','minute'],['rankSentimentChartPanel','data-rank-mode','day'],['rankAdrChartPanel','data-adr-mode','minute'],['concentrationChartPanel','data-chart-mode','day']]) {
  await page.locator(`#${source} [${attr}="${mode}"]`).evaluate(button=>button.click());
  await page.waitForFunction(({modes,mode})=>modes.every(([id,attr])=>document.querySelector(`#${id} [${attr}="${mode}"]`).classList.contains('active')),{modes,mode});
  assert.equal(await page.locator('#rankVolatilityChartPanel [data-breadth-mode="minute"],#rankSentimentChartPanel [data-breadth-mode="minute"]').count(),0);
  assert.equal(await page.locator('#rankVolatilityChartPanel [data-rank-mode="day"].active,#rankSentimentChartPanel [data-rank-mode="day"].active').count(),2);
 }
 assert.deepEqual(errors,[]);console.log('PASS all seven main charts restore a single candle state despite conflicting old settings');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
