const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try {
  const page=await browser.newPage({viewport:{width:1000,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div class="rank-chart-row"><section class="panel concentration-chart-panel" id="concentrationChartPanel"></section><section class="panel rank-adr-panel" id="rankAdrChartPanel"><div class="concentration-chart-header"><h2>ADR</h2><div class="rank-market-choice"><label><input type="radio" name="rank-adr-market" value="kospi" checked>KOSPI</label></div><output>—</output></div><div class="rank-adr-area"><canvas></canvas><div class="concentration-tooltip" hidden></div></div><p role="status" class="rank-adr-status"></p></section></div>');
  await page.addStyleTag({path:'public/style.css'});
  await page.evaluate(()=>{
   Date.now=()=>Date.parse('2026-10-23T10:00:00+09:00');window.arcs=[];window.samples=1;
   const arc=CanvasRenderingContext2D.prototype.arc;
   CanvasRenderingContext2D.prototype.arc=function(x,y,r,...args){if(this.canvas.closest('#rankAdrChartPanel'))window.arcs.push({x,y,width:this.canvas.clientWidth});return arc.call(this,x,y,r,...args);};
   window.fetch=async()=>new Response(JSON.stringify({marketStatus:'open',intraday:Array.from({length:window.samples},(_,i)=>({t:Date.parse(`2026-10-23T09:0${i+1}:00+09:00`),adr:90+i}))}));
  });
  await page.addScriptTag({path:'public/rank-adr-chart.js'});
  await page.waitForFunction(()=>document.querySelector('#rankAdrChartPanel output').textContent==='90.0%');
  assert.ok(await page.evaluate(()=>window.arcs.length && window.arcs.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))));
  await page.evaluate(async()=>{window.samples=2;await window.refreshRankAdrChart();});
  assert.ok(await page.evaluate(()=>window.arcs.some(p=>Math.abs(p.x-(p.width-58))<1)),'Latest actual sample reaches the plot end without empty session padding');
  assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>window.arcs.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))));
  console.log('PASS ADR sparse actual-time extent and finite coordinates');
 } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
