const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1900,height:1300}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 await page.setContent(html);await page.addStyleTag({path:'public/style.css'});
 await page.evaluate(()=>{document.querySelector('#tabContents').style.display='block';document.querySelector('#loginOverlay').style.display='none';window.fetch=async()=>new Response(JSON.stringify({points:[{date:'2026-10-22',t:Date.parse('2026-10-22T09:00:00+09:00'),open:100,high:110,low:90,close:103}],series:[{date:'2026-10-22',adr:90}]}));});
 await page.addScriptTag({path:'public/rank-chart-axis.js'});await page.addScriptTag({path:'public/rank-connection-status.js'});
 await page.waitForFunction(()=>document.querySelector('#rankAdrChartPanel .rank-card-messages .rank-adr-status'));
 await page.addScriptTag({path:'public/rank-adr-chart.js'});await page.evaluate(()=>window.applyRankAdrCandleOpen(true));
 await page.waitForFunction(()=>document.querySelector('#rankAdrChartPanel .rank-adr-area canvas').width>0);
 const state=await page.locator('#rankAdrChartPanel').evaluate(panel=>{const q=s=>panel.querySelector(s),box=s=>q(s).getBoundingClientRect();return {candleParent:q('.rank-adr-candle-area').parentElement.id,zoomParent:q('.rank-adr-zoom').parentElement.id,nested:panel.querySelectorAll('.rank-card-messages canvas,.rank-card-messages input').length,mainBottom:box('.rank-adr-area').bottom,candleTop:box('.rank-adr-candle-area').top,candleBottom:box('.rank-adr-candle-area').bottom,zoomTop:box('.rank-adr-zoom').top,zoomBottom:box('.rank-adr-zoom').bottom,footerTop:box('.rank-card-footer').top,width:box('.rank-adr-candle-area').width,mainWidth:box('.rank-adr-area').width};});
 assert.equal(state.candleParent,'rankAdrChartPanel');assert.equal(state.zoomParent,'rankAdrChartPanel');assert.equal(state.nested,0);assert.ok(state.candleTop>=state.mainBottom);assert.ok(state.zoomTop>=state.candleBottom);assert.ok(state.footerTop>=state.zoomBottom);assert.equal(state.width,state.mainWidth);assert.deepEqual(errors,[]);
 console.log('PASS ADR initialized after footer migration keeps full-width candle, zoom and footer in separate rows');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
