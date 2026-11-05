// Market-supply minute charts share one y range across the four markets while 'y축 동기화' is checked,
// and the range follows the zoomed window. Daily lanes always use the selected market only.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:2400,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.clock.setFixedTime(new Date('2026-10-23T10:00:00+09:00'));
const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
const minute=Date.parse('2026-10-23T09:00:00+09:00'),p={t:minute,open:2500,high:2510,low:2490,close:2505},N=40;
// Largest amount is KOSPI futures foreign, lowest is KOSDAQ futures foreign; both grow over the session.
const scale={kospi:1,kosdaq:.5,futures:10,futuresKosdaq:-7},markets=Object.keys(scale);
const times=mode=>mode==='minute'?Array.from({length:N},(_,i)=>minute+i*60000):['2026-10-21','2026-10-22','2026-10-23'].map(d=>Date.parse(d+'T00:00:00+09:00'));
const flow=(code,mode)=>{const k=scale[code],ts=times(mode);return ts.map((t,i)=>({t,foreign:k*100*(i+1)/ts.length,institution:k*20,individual:-k*30,...(code.startsWith('futures')?{}:{program:k*10})}));};
const expectRange=(codes,first,last)=>{let min=0,max=0;for(const code of codes)for(const point of flow(code,'minute'))if(point.t>=first&&point.t<=last)for(const s of ['program','foreign','institution','individual'])if(Number.isFinite(point[s])){min=Math.min(min,point[s]);max=Math.max(max,point[s]);}
 const pad=Math.max(1,max-min)*.08;return [Math.round(min-pad),Math.round(max+pad)];};
await page.route('http://market-page.test/**',route=>{const url=new URL(route.request().url());
if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'chart-test@example.test'}}});
if(['/api/market-supply/chart','/api/ls-market-supply/chart','/api/kiwoom-market-supply/chart','/api/ls-futures-test/chart'].includes(url.pathname))
 return route.fulfill({json:{success:true,points:flow(url.searchParams.get('code'),url.searchParams.get('mode')),candles:[p],warnings:[],has_more:false,date:'2026-10-23'}});
if(url.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[],archive:[],revision:1}});
if(url.pathname==='/api/chart-reference')return route.fulfill({json:{points:[p],has_more:false}});
if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:[p],markets:{kospi:[p],kosdaq:[p]},dates:['2026-10-23'],series:{highs:{points:[]},lows:{points:[]},vix:{points:[]},vkospi:{points:[]},'fear-greed':{points:[]},'high-yield-spread':{points:[]}},warnings:[],has_more:false}});
return route.fulfill({contentType:'text/html',body:html});});
await page.goto('http://market-page.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
for(const file of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+file});
await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
const card=page.locator('#rankTestMarketSupplyChartPanel'),sync=card.locator('.market-supply-y-sync'),box=sync.locator('input');
const diag=()=>page.evaluate(()=>getTestMarketSupplyCandleDiagnostics());
const waitRange=async(market,expected)=>{try{await page.waitForFunction(([m,e])=>{const d=getTestMarketSupplyCandleDiagnostics();return d.market===m&&d.mode==='minute'&&Math.round(d.yMin)===e[0]&&Math.round(d.yMax)===e[1];},[market,expected],{timeout:10000});}catch(e){console.error('diag',JSON.stringify(await diag()),'expected',expected);throw e;}};
// Daily mode: no checkbox.
// The test card's daily window follows its peer cards (one mocked day here), so count loaded days.
await page.waitForFunction(()=>getTestMarketSupplyCandleDiagnostics().flowPoints===3);
assert.equal(await sync.isVisible(),false,'checkbox hidden in daily mode');
// Minute mode: checkbox visible, checked by default, left of the pin.
await card.locator('[data-mode=minute]').click();
assert.equal(await sync.isVisible(),true);assert.equal(await box.isChecked(),true);
assert.equal(await sync.innerText(),'y축 동기화');
const place=await card.evaluate(panel=>{const a=panel.querySelector('.market-supply-y-sync').getBoundingClientRect(),b=panel.querySelector('.rank-market-pin').getBoundingClientRect(),h=panel.querySelector('.rank-market-choice').getBoundingClientRect();return{left:a.right<=b.left,top:Math.abs(a.top+a.height/2-(b.top+b.height/2))<3,clear:h.right<=a.left};});
assert.deepEqual(place,{left:true,top:true,clear:true},'checkbox sits left of the pin without covering the market picker');
const full=expectRange(markets,minute,minute+(N-1)*60000);
for(const market of markets){await card.locator('input[value='+market+']').check();await waitRange(market,full);}
// Zoom in: the shared range follows the visible window only.
await card.locator('input[value=kospi]').check();await waitRange('kospi',full);
await card.locator('[aria-label="시장 수급 차트 확대"]').click();
let d=await diag();assert.ok(d.visiblePoints<N,'zoomed in');
const zoomed=expectRange(markets,d.visibleFirst,d.visibleLast);assert.ok(zoomed[1]<full[1],'zoom window excludes the session high');
await waitRange('kospi',zoomed);
// Zoom back out restores the full-window range.
await card.locator('[aria-label="시장 수급 차트 축소"]').click();await waitRange('kospi',full);
// Unchecked: KOSPI's own range only (also within the zoom window).
await box.uncheck();await waitRange('kospi',expectRange(['kospi'],minute,minute+(N-1)*60000));
await card.locator('[aria-label="시장 수급 차트 확대"]').click();d=await diag();
await waitRange('kospi',expectRange(['kospi'],d.visibleFirst,d.visibleLast));
assert.equal((await page.evaluate(()=>getRankTestMarketSupplyDisplaySettings())).ySync,false);
assert.equal(await page.evaluate(()=>localStorage.getItem('rankTestMarketSupplySelectedV1:ySync')),'0');
// Other cards keep their own default.
assert.equal(await page.locator('#rankTestMarketSupplySecondaryChartPanel .market-supply-y-sync input').isChecked(),true);
// Restoring saved settings re-enables the sync.
await page.evaluate(()=>applyRankTestMarketSupplyDisplaySettings({...getRankTestMarketSupplyDisplaySettings(),ySync:true}));
assert.equal(await box.isChecked(),true);d=await diag();await waitRange('kospi',expectRange(markets,d.visibleFirst,d.visibleLast));
// Daily lanes: selected market only, even with sync checked.
await card.locator('[data-mode=day]').click();assert.equal(await sync.isVisible(),false);
await page.waitForFunction(()=>{const d=getTestMarketSupplyCandleDiagnostics();return d.mode==='day'&&d.flowPoints===3&&d.laneExtents.foreign===100;});
assert.deepEqual((await diag()).laneExtents,{program:10,foreign:100,institution:20,individual:30});
assert.deepEqual(errors,[]);
await card.locator('[data-mode=minute]').click();await card.screenshot({path:'dev/output/market-supply-y-sync.png'});
console.log('Market supply y sync:',JSON.stringify({full,zoomed}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
