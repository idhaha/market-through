const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.lines={};const original=CanvasRenderingContext2D.prototype.stroke;CanvasRenderingContext2D.prototype.stroke=function(){if(this.strokeStyle==='#000000'&&this.getLineDash().length){const id=this.canvas.closest('section')?.id;window.lines[id]=(window.lines[id]||0)+1;}return original.call(this);};});
 const rows=Array.from({length:30},(_,i)=>({t:Date.parse('2026-10-01T09:00:00+09:00')+i*86400000,individual:i+1,foreign:-i-1,institution:i*2,program:-i*2}));
 const candles=rows.map(p=>({...p,open:100,high:110,low:90,close:105}));
 await page.route('http://hover.test/**',route=>{const url=new URL(route.request().url());if(url.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'test'}],archive:[{code:'005930',name:'test'}]}});if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:rows,candles,warnings:[],has_more:false}});return route.fulfill({contentType:'text/html',body:'<div id="tab_rank"><div class="rank-chart-row"><section class="panel" id="concentrationChartPanel" style="height:450px"></section><section class="panel" id="rankBreadthChartPanel" style="height:450px"></section></div></div>'});});
 await page.goto('http://hover.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')});
 for(const f of ['rank-chart-axis.js','rank-supply-chart.js','rank-market-supply-chart.js'])await page.addScriptTag({path:'public/'+f});
 await page.waitForFunction(()=>document.querySelector('#rankSupplyChartPanel [role="status"]')?.textContent.includes('30'));
 let target=page.locator('#rankMarketSupplyChartPanel .rank-adr-area canvas');await target.scrollIntoViewIfNeeded();
 const original=await page.evaluate(()=>window.RankChartAxis.dailyDomain());
 async function drag(from,to){const box=await target.boundingBox();await page.mouse.move(box.x+12+from*(box.width-94),box.y+100);await page.mouse.down();await page.mouse.move(box.x+12+to*(box.width-94),box.y+100,{steps:8});await page.mouse.up();await page.waitForTimeout(100);}
 await drag(.2,.8);
 const zoomed=await page.evaluate(()=>window.RankChartAxis.dailyDomain());
 assert.equal(zoomed.first,original.days[Math.floor(.2*(original.days.length-1))]);
 assert.equal(zoomed.last,original.days[Math.ceil(.8*(original.days.length-1))]);
 await drag(.2,.8);const twice=await page.evaluate(()=>window.RankChartAxis.dailyDomain());assert.ok(twice.days.length<zoomed.days.length);
 await drag(.8,.2);const restored=await page.evaluate(()=>window.RankChartAxis.dailyDomain());assert.equal(restored.first,original.first);assert.equal(restored.last,original.last);
 await page.locator('#rankMarketSupplyChartPanel .concentration-candle-toggle').click();
 target=page.locator('#rankMarketSupplyChartPanel .rank-adr-candle-area canvas');await target.scrollIntoViewIfNeeded();await page.waitForTimeout(100);
 await drag(.2,.8);const candleZoom=await page.evaluate(()=>window.RankChartAxis.dailyDomain());assert.ok(candleZoom.days.length<original.days.length);
 await drag(.8,.2);assert.equal((await page.evaluate(()=>window.RankChartAxis.dailyDomain())).first,original.first);
 assert.deepEqual(errors,[]);console.log('Real market-supply drag remains zoomed after native click, repeats, and resets.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
