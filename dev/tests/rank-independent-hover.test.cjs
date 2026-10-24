const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
const page=await browser.newPage({viewport:{width:900,height:1400}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{window.rankIndependentClient=true;const p=CanvasRenderingContext2D.prototype,clear=p.clearRect,begin=p.beginPath,move=p.moveTo,line=p.lineTo,stroke=p.stroke,text=p.fillText;
p.clearRect=function(...a){this.canvas.hoverX=null;this.canvas.dateLabels=[];return clear.apply(this,a)};
p.beginPath=function(...a){this.testPath=[];return begin.apply(this,a)};p.moveTo=function(x,y){this.testPath.push([x,y]);return move.call(this,x,y)};p.lineTo=function(x,y){this.testPath.push([x,y]);return line.call(this,x,y)};
p.stroke=function(){if(this.strokeStyle==='#000000'&&this.getLineDash().length&&this.testPath.length===2&&this.testPath[0][0]===this.testPath[1][0])this.canvas.hoverX=this.testPath[0][0];return stroke.call(this)};
p.fillText=function(t,...a){if(/^\d{2}-\d{2}-\d{2}$/.test(t))this.canvas.dateLabels.push(t);return text.call(this,t,...a)};});
const rows=Array.from({length:80},(_,i)=>{const t=Date.parse('2026-07-01T09:00:00+09:00')+i*86400000;return {t,time:new Date(t+9*3600000).toISOString().slice(0,10).replaceAll('-',''),value:20+i/5,individual:i,foreign:-i,program:i*2,institution:-i*2,stock_open:100,stock_high:110,stock_low:90,stock_price:105};});
const html=fs.readFileSync('public/rank-independent.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
await page.route('http://ind-hover.test/**',route=>{const u=new URL(route.request().url());if(u.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'test'}],archive:[{code:'005930',name:'test'}]}});if(u.pathname==='/api/concentration-chart')return route.fulfill({json:{success:true,points:rows.filter((_,i)=>i!==20),has_more:false}});if(u.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:rows.filter((_,i)=>i!==30),candles:[],has_more:false}});return route.fulfill({contentType:'text/html',body:html});});
await page.goto('http://ind-hover.test/');await page.addStyleTag({path:'public/style.css'});await page.addStyleTag({path:'public/rank-independent.css'});
for(const f of ['rank-chart-axis.js','concentration-chart.js','rank-supply-chart.js'])await page.addScriptTag({path:'public/'+f});
await page.evaluate(()=>{document.dispatchEvent(new Event('DOMContentLoaded'));selectRankChartStock({code:'005930',name:'test',market:'K'});refreshRankSupplyChart();});
await page.waitForFunction(()=>getRankChartState().points.length===79&&document.querySelector('#rankSupplyChartPanel [role="status"]')?.textContent.includes('79'));
await page.waitForTimeout(150);
const measure=()=>page.evaluate(()=>['#concentrationCanvas','#rankSupplyChartPanel .rank-adr-area canvas'].map(s=>{const c=document.querySelector(s);return {x:c.hoverX==null?null:c.getBoundingClientRect().left+c.hoverX,labels:c.dateLabels};}));
let result=await measure();assert.deepEqual(result[0].labels,result[1].labels);assert.ok(result[0].labels.length>1);
for(const selector of ['#concentrationCanvas','#rankSupplyChartPanel .rank-adr-area canvas']){const c=page.locator(selector);await c.scrollIntoViewIfNeeded();const b=await c.boundingBox();await page.mouse.move(b.x+b.width*.6,b.y+b.height/2);await page.waitForTimeout(40);result=await measure();assert.ok(result.every(p=>p.x!=null),JSON.stringify(result));assert.ok(Math.abs(result[0].x-result[1].x)<1,JSON.stringify(result));}
assert.deepEqual(errors,[]);console.log('Independent daily: unequal date records share date labels and screen crosshair X in both directions.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
