// Regression: in minute mode with y sync, the 시장 수급 (test) card's y range must not depend on the selected market.
// Spot data covers 08:00-20:00 and futures also cover the previous night, where the largest amount is.
// Axis labels must be whole 억원.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:2400,height:1100}});
await page.addInitScript(()=>{window.axisLabels=[];const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...rest){if(this.canvas.closest?.('#rankTestMarketSupplyChartPanel .rank-adr-area')&&/억원$/.test(String(text)))window.axisLabels.push(String(text));return fill.call(this,text,...rest);};});
await page.clock.setFixedTime(new Date('2026-11-05T21:00:00+09:00'));
const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
const at=c=>Date.parse('2026-11-05T'+c+':00+09:00'),prev=c=>Date.parse('2026-11-04T'+c+':00+09:00');
const range=(a,b)=>{const out=[];for(let t=a;t<=b;t+=60000)out.push(t);return out;};
// Spot: day only. Futures: previous night (with the biggest values) plus day session.
const flow=code=>{const spot=!code.startsWith('futures');const ts=spot?range(at('08:00'),at('20:00')):[...range(prev('18:00'),prev('23:59')),...range(at('00:00'),at('05:00')),...range(at('08:45'),at('15:45'))];
 const k={kospi:3e6,kosdaq:1e6,futures:3.2e6,futuresKosdaq:5e5}[code];return ts.map((t,i)=>({t,foreign:Math.round(k*(1+i%97/97)*(spot?1:(t<at('06:00')?1.05:1))*100)/100,institution:-k/3,individual:-k/2,...(spot?{program:k/5}:{})}));};
await page.route('http://y.test/**',route=>{const u=new URL(route.request().url());
 if(u.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'t@example.test'}}});
 if(['/api/market-supply/chart','/api/ls-market-supply/chart','/api/kiwoom-market-supply/chart','/api/ls-futures-test/chart'].includes(u.pathname))return route.fulfill({json:{success:true,points:u.searchParams.get('mode')==='minute'?flow(u.searchParams.get('code')):[],candles:[],warnings:[],has_more:false,date:'2026-11-05'}});
 if(u.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:[],markets:{kospi:[],kosdaq:[]},dates:[],series:{highs:{points:[]},lows:{points:[]},vix:{points:[]},vkospi:{points:[]},'fear-greed':{points:[]},'high-yield-spread':{points:[]}},warnings:[],has_more:false}});
 return route.fulfill({contentType:'text/html',body:html});});
await page.goto('http://y.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
for(const f of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+f});
await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
const card=page.locator('#rankTestMarketSupplyChartPanel');await card.locator('[data-mode=minute]').click();await page.waitForTimeout(1500);
const ranges=[];
for(const m of ['kospi','kosdaq','futures','futuresKosdaq','kospi']){await card.locator('input[value='+m+']').check();
 await page.waitForFunction(m=>{const d=getTestMarketSupplyCandleDiagnostics();return d.market===m&&d.mode==='minute'&&d.flowPoints>0;},m);await page.waitForTimeout(1500);
 const d=await page.evaluate(()=>getTestMarketSupplyCandleDiagnostics());ranges.push([m,Math.round(d.yMin),Math.round(d.yMax)]);}
for(const r of ranges)assert.deepEqual(r.slice(1),ranges[2].slice(1),'same y range for '+r[0]+': '+JSON.stringify(ranges));
const labels=await page.evaluate(()=>window.axisLabels.filter(t=>!/^[+-]/.test(t)));assert.ok(labels.length>0);
for(const label of labels)assert.match(label,/^-?[0-9,]+억원$/,'whole 억원 axis label: '+label);
console.log('PASS same minute y range for all four markets with night futures; whole 억원 axis labels',JSON.stringify(ranges[0]));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
