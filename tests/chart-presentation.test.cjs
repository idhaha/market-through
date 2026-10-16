const fs=require('node:fs'), assert=require('node:assert/strict'), express=require('express'), {chromium}=require('playwright');
(async()=>{
 const app=express(), source=fs.readFileSync('public/index.html','utf8');
 const sections=['concentrationChartPanel','rankAdrChartPanel'].map(id=>source.match(new RegExp('<section[^>]*id="'+id+'"[\\s\\S]*?</section>'))[0]).join('');
 const start=Date.parse('2026-10-01T09:00:00+09:00');
 const prices=Array.from({length:10},(_,i)=>({t:start+i*86400000,open:3000.21+i*10,high:3100.83+i*10,low:2900.11+i*10,close:3050.52+i*10,market_turnover:(20+i)*1e12}));
 app.get('/fixture',(req,res)=>res.send('<link rel="stylesheet" href="/style.css"><style>body{padding:10px}.rank-chart-row{display:flex!important;align-items:start!important;gap:10px}.rank-chart-row>.panel{width:520px!important;flex:0 0 520px!important}#tab_rank{display:block}</style><main id="tab_rank"><div class="rank-chart-row">'+sections+'</div></main><script src="/concentration-chart.js"></script><script src="/rank-adr-chart.js"></script><script src="/rank-turnover-chart.js"></script>'));
 app.get('/api/adr/history',(req,res)=>res.json({series:prices.map(p=>({date:new Date(p.t+9*3600000).toISOString().slice(0,10),adr:90}))}));
 app.get('/api/adr/today',(req,res)=>res.json({intraday:[]}));
 app.get('/api/adr/candles',(req,res)=>res.json({points:prices}));
 app.use(express.static('public'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {const page=await browser.newPage({viewport:{width:1650,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.markers=[];const arc=CanvasRenderingContext2D.prototype.arc,fill=CanvasRenderingContext2D.prototype.fill;CanvasRenderingContext2D.prototype.arc=function(...args){this.lastMarker=args;return arc.apply(this,args);};CanvasRenderingContext2D.prototype.fill=function(...args){if(this.lastMarker){window.markers.push({canvas:this.canvas.id||this.canvas.getAttribute('aria-label'),color:this.fillStyle});this.lastMarker=null;}return fill.apply(this,args);};window.axisLabels=[];const orig=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){if(this.textAlign==='right')window.axisLabels.push({canvas:this.canvas.id||this.canvas.getAttribute('aria-label'),text:String(text),x,width:this.canvas.clientWidth});return orig.call(this,text,x,y,...args);};});
 await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');
 await page.locator('#rankAdrChartPanel [data-adr-mode="day"]').click();
 await page.locator('#rankAdrChartPanel .concentration-candle-toggle').click();
 await page.locator('#rankTurnoverChartPanel .concentration-candle-toggle').click();
 await page.evaluate(()=>{applyRankChartState({selection:{code:'005930',name:'삼성전자'},mode:'day',interval:5,points:Array.from({length:10},(_,i)=>({time:'202610'+String(i+1).padStart(2,'0'),value:42.85,stock_open:100000,stock_high:120000,stock_low:90000,stock_price:110000.52})),busy:false});applyConcentrationDisplaySettings({mode:'day',interval:5,candleOpen:true});});
 await page.waitForFunction(()=>axisLabels.filter(p=>p.canvas?.includes('캔들')&&p.x===p.width-4).length>=10);
 assert.equal(await page.locator('#concentrationDebugToggle, #concentrationFiveDebug').count(),0);
 const orange=await page.evaluate(()=>markers.filter(marker=>marker.color==='#f97316').map(marker=>marker.canvas));
 assert.ok(orange.includes('concentrationCanvas'),JSON.stringify(orange));
 assert.ok(orange.some(label=>label.includes('ADR')),JSON.stringify(orange));
 assert.ok(orange.filter(label=>label.includes('거래대금')).length>=2,JSON.stringify(orange));
 await page.evaluate(()=>{document.getElementById('concentrationMarket').textContent='코스피';});
 const baselines=await page.evaluate(()=>{
   const groups=[['#concentrationChartTitle','.concentration-stock-picker','#concentrationMarket'],['#rankAdrChartPanel h2','#rankAdrChartPanel .rank-market-choice label'],['#rankTurnoverChartPanel h2','#rankTurnoverChartPanel .rank-market-choice label']];
   return groups.map(selectors=>selectors.map(selector=>{const node=document.querySelector(selector), probe=document.createElement('span');probe.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';const previousWhiteSpace=node.style.whiteSpace;node.style.whiteSpace='nowrap';node.append(probe);const baseline=probe.getBoundingClientRect().top;probe.remove();node.style.whiteSpace=previousWhiteSpace;return baseline;}));
 });
 assert.ok(baselines.every(group=>Math.max(...group)-Math.min(...group)<1),JSON.stringify(baselines));
 assert.equal(await page.locator('#rankAdrChartPanel select, #rankTurnoverChartPanel select').count(),0);
 await page.locator('#rankAdrChartPanel input[value="kosdaq"]').check();
 assert.equal(await page.locator('#rankTurnoverChartPanel input[value="kospi"]').isChecked(),true);
 await page.waitForFunction(()=>document.querySelector('#rankAdrChartPanel canvas').getAttribute('aria-label').includes('KOSDAQ'));
 await page.locator('#rankTurnoverChartPanel input[value="kosdaq"]').check();
 await page.locator('#rankAdrChartPanel input[value="kospi"]').check();
 assert.equal(await page.locator('#rankTurnoverChartPanel input[value="kosdaq"]').isChecked(),true);

 const labels=await page.evaluate(()=>axisLabels.filter(p=>(p.canvas==='concentrationCandleCanvas'||p.canvas?.includes('캔들'))&&p.x===p.width-4));
 assert.ok(labels.length>=15);assert.ok(labels.every(p=>!p.text.includes('.')),JSON.stringify(labels));
 const bounds=await page.evaluate(()=>[...document.querySelectorAll('.rank-chart-row>.panel')].map(panel=>{const canvas=panel.querySelector('canvas'),plus=panel.querySelector('#concentrationZoomIn, .rank-adr-zoom .concentration-controls button:last-child');return {id:panel.id,canvas:canvas.getBoundingClientRect().right,plus:plus.getBoundingClientRect().right};}));
 assert.ok(bounds.every(p=>Math.abs(p.canvas-p.plus)<2),JSON.stringify(bounds));assert.deepEqual(errors,[]);
 const minuteMarkers=await page.evaluate(()=>{
   markers.length=0;
   const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10).replaceAll('-','');
   applyRankChartState({selection:{code:'005930',name:'삼성전자'},mode:'minute',interval:1,points:Array.from({length:30},(_,i)=>({time:day+'09'+String(i).padStart(2,'0')+'00',value:10+i})),busy:false});
   return markers.filter(marker=>marker.canvas==='concentrationCanvas'&&marker.color==='#f97316').length;
 });
 assert.equal(minuteMarkers,1,'Minute concentration chart must have exactly one orange latest-value dot');
 console.log('PASS integer candle axes, no debug panel, chart edges aligned with zoom +:',JSON.stringify(bounds));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});


