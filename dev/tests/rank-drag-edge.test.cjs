const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1800,height:1500}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://drag.test/**',route=>{
 const url=new URL(route.request().url()),points=Array.from({length:100},(_,i)=>{const d=new Date(Date.parse('2026-10-23T08:00:00+09:00')+i*60000),time=new Date(d.getTime()+9*3600000).toISOString().slice(0,19).replace(/[-:T]/g,'');return {time,t:d.getTime(),date:'2026-10-23',value:50,adr:90,stock_open:100,stock_high:110,stock_low:90,stock_price:105,open:100,high:110,low:90,close:105};});
 if(url.pathname==='/api/concentration-chart')return route.fulfill({json:{success:true,points,has_more:false}});
 if(url.pathname==='/api/chart-reference')return route.fulfill({json:{points,cursor:null}});
 if(url.pathname==='/api/adr/today')return route.fulfill({json:{intraday:points}});
 if(url.pathname==='/api/adr/history')return route.fulfill({json:{series:[]}});
 return route.fulfill({contentType:'text/html',body:fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'')});});
 await page.goto('http://drag.test/');await page.addStyleTag({path:'public/style.css'});
 await page.evaluate(()=>{document.querySelector('#tabContents').style.display='block';document.querySelector('#loginOverlay').style.display='none';window.rankIndependentClient=true;
 const p=CanvasRenderingContext2D.prototype,clear=p.clearRect,line=p.lineTo,fill=p.fillRect;
 p.clearRect=function(...a){this.canvas.dragRect=null;this.canvas.maxLineX=0;return clear.apply(this,a)};
 p.lineTo=function(x,y){this.canvas.maxLineX=Math.max(this.canvas.maxLineX,x);return line.call(this,x,y)};
 p.fillRect=function(x,y,w,h){if(this.fillStyle.startsWith('rgba(15, 23, 42,'))this.canvas.dragRect={left:x,right:x+w};return fill.call(this,x,y,w,h)};});
 for(const name of ['rank-chart-axis','concentration-chart','rank-adr-chart'])await page.addScriptTag({path:`public/${name}.js`});
 await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 await page.evaluate(()=>{applyConcentrationDisplaySettings({candleOpen:true,mode:'minute'});selectRankChartStock({code:'000660',name:'SK하이닉스',market:'K'});applyRankAdrCandleOpen(true);});
 await page.locator('#rankAdrChartPanel [data-adr-mode=minute]').click();
 await page.waitForFunction(()=>getRankChartState().points.length===100 && !document.querySelector('#rankAdrChartPanel .rank-adr-zoom button:last-child').disabled);
 for(const selector of ['#concentrationCanvas','#concentrationCandleCanvas','#rankAdrChartPanel .rank-adr-area canvas','#rankAdrChartPanel .rank-adr-candle-area canvas']){
 const canvas=page.locator(selector);await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
 await page.mouse.move(box.x+box.width*.25,box.y+50);await page.mouse.down();await page.mouse.move(box.x+box.width+30,box.y+50,{steps:8});
 const state=await canvas.evaluate(c=>({rect:c.dragRect,right:c.maxLineX}));assert.ok(state.rect,JSON.stringify({selector,state,box}));assert.ok(Math.abs(state.rect.right-state.right)<1,JSON.stringify({selector,state}));
 await page.mouse.up();await page.waitForTimeout(50);
 assert.equal(await page.evaluate(()=>RankChartAxis.minuteDomain().last),'2026-10-23 09:39');
 }
 assert.deepEqual(errors,[]);console.log('PASS concentration/ADR main and candle drag rectangle reaches plot edge and zoom includes latest minute');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
