const {chromium}=require('playwright');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:2000,height:1400}});const errors=[],requests=[];let missingReference=false;page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://chart.test/**',async route=>{
 const url=new URL(route.request().url());requests.push(url.pathname+url.search);
 const point=(date)=>({date,t:Date.parse(`${date}T09:00:00+09:00`),open:3000,high:3100,low:2900,close:3050});
 if(url.pathname==='/api/chart-reference'){
 if(missingReference)return route.fulfill({contentType:'text/html',body:'<!DOCTYPE html><html></html>'});
 const days=url.searchParams.get('cursor')?['2026-10-16','2026-10-19']:['2026-10-20','2026-10-21','2026-10-22'];
 return route.fulfill({json:{points:days.map(point),cursor:url.searchParams.get('cursor')?null:'older'}});
 }
 if(url.pathname==='/api/adr/history')return route.fulfill({json:{series:[{date:'2026-10-21',adr:98}]}});
 if(url.pathname==='/api/adr/today')return route.fulfill({json:{intraday:[{t:Date.parse('2026-10-22T09:00:00+09:00'),adr:98}]}});
 if(url.pathname.startsWith('/api/risk/')){const series={};for(const id of ['vkospi','vix','fear-greed','high-yield-spread'])series[id]={points:[{date:'2026-10-21',value:20}]};return route.fulfill({json:{series,dates:[]}});}
 return route.fulfill({contentType:'text/html',body:'<div class="rank-chart-row"><section class="panel" id="concentrationChartPanel" style="height:450px"><button id="concentrationMore"><svg></svg></button></section><section class="panel rank-adr-panel" id="rankAdrChartPanel"><div class="concentration-chart-header"><h2>ADR</h2><div class="rank-market-choice"><input type="radio" value="kospi" checked></div><output></output></div><div class="rank-adr-area"><canvas></canvas><div class="concentration-tooltip"></div></div><p role="status" class="rank-adr-status"></p></section></div>'});
 });
 await page.goto('http://chart.test/');await page.addStyleTag({path:'public/style.css'});
 await page.evaluate(()=>{const proto=CanvasRenderingContext2D.prototype,clear=proto.clearRect,text=proto.fillText;
 proto.clearRect=function(...args){this.canvas.axisLabels=[];return clear.apply(this,args);};
 proto.fillText=function(label,...args){if(/^\d{2}-\d{2}-\d{2}$/.test(String(label)))(this.canvas.axisLabels ||= []).push(String(label));return text.call(this,label,...args);};});

 await page.addScriptTag({path:'public/rank-chart-axis.js'});await page.addScriptTag({path:'public/rank-adr-chart.js'});await page.addScriptTag({path:'public/rank-volatility-chart.js'});
 for(const id of ['rankAdrChartPanel','rankVolatilityChartPanel','rankSentimentChartPanel']){
  const panel=page.locator('#'+id);await panel.locator('.rank-adr-status').filter({hasText:id==='rankAdrChartPanel'?'3봉':'5봉'}).waitFor();
  assert.equal(await panel.locator('[data-adr-range],[data-volatility-range]').count(),0);
  assert.equal(await panel.getByRole('button',{name:'일',exact:true}).count(),1);
  assert.equal(await panel.getByRole('button',{name:'1분봉',exact:true}).count(),id==='rankAdrChartPanel'?1:0);
  if(id==='rankAdrChartPanel')await panel.locator('[data-adr-more],[data-risk-more]').click();await panel.locator('.rank-adr-status').filter({hasText:'5봉'}).waitFor();
  await panel.locator('.concentration-candle-toggle').click();assert.equal(await panel.locator('.concentration-candle-toggle').getAttribute('aria-expanded'),'true');
 }
 const noAdvance=await page.evaluate(()=>window.RankChartAxis.requestHistory('day'));assert.equal(noAdvance.advanced,false);
 await page.waitForFunction(()=>['rankAdrChartPanel','rankVolatilityChartPanel','rankSentimentChartPanel'].every(id=>document.querySelector('#'+id+' .rank-adr-area canvas').axisLabels?.length));
 const labels=await page.evaluate(()=>['rankAdrChartPanel','rankVolatilityChartPanel','rankSentimentChartPanel'].map(id=>document.querySelector('#'+id+' .rank-adr-area canvas').axisLabels));
 assert.deepEqual(labels[0],labels[1]);assert.deepEqual(labels[1],labels[2]);
 await page.locator('#rankAdrChartPanel [data-adr-mode="minute"]').click();
 await page.waitForFunction(()=>document.querySelector('#rankAdrChartPanel [data-adr-more]').disabled===false);
 assert.ok(requests.some(url=>url.startsWith('/api/chart-reference?mode=minute')));
 assert.ok(requests.some(url=>url.startsWith('/api/adr/today')));
 assert.equal(await page.locator('#rankAdrChartPanel .chart-today-button').isVisible(),true);
 assert.equal(await page.locator('#rankAdrChartPanel [data-adr-mode="minute"]').evaluate(n=>n.nextElementSibling.textContent),'당일');
 await page.locator('#rankAdrChartPanel .chart-today-button').click();
 await page.locator('#rankAdrChartPanel [data-adr-mode="day"]').click();
 await page.waitForFunction(()=>document.querySelector('#rankAdrChartPanel .chart-today-button').hidden);
 assert.equal(await page.locator('#rankAdrChartPanel .concentration-candle-toggle').getAttribute('aria-expanded'),'true');
 missingReference=true;await page.reload();await page.addStyleTag({path:'public/style.css'});
 await page.addScriptTag({path:'public/rank-chart-axis.js'});await page.addScriptTag({path:'public/rank-adr-chart.js'});await page.addScriptTag({path:'public/rank-volatility-chart.js'});
 for(const id of ['rankAdrChartPanel','rankVolatilityChartPanel','rankSentimentChartPanel']) {
  const panel=page.locator('#'+id);await panel.locator('.rank-adr-status').filter({hasText:'서버 업데이트·재시작 필요'}).waitFor();
  const values=await panel.locator('output').allTextContents();assert.ok(values.some(v=>/98|20/.test(v)),id+' still loads actual indicator values when the reference route returns HTML');
 }
 assert.deepEqual(errors,[]);console.log('PASS ADR/volatility/CNN candle-page count, sparse indicator data, controls and history append');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
