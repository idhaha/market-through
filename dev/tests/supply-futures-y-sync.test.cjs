// 종목 수급 ↔ 종목 선물 수급: futures contracts are shown as shares (× multiplier: 10 stocks, 100 ETF), and in the minute
// chart both cards share one y range while each card's 'y축 동기화' box is checked (default), following zoom.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:2400,height:1600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.clock.setFixedTime(new Date('2026-11-06T10:00:00+09:00'));
const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
const day=Date.parse('2026-11-06T00:00:00+09:00'),m0=Date.parse('2026-11-06T09:00:00+09:00'),N=40,p={t:day,open:2500,high:2510,low:2490,close:2505};
const times=Array.from({length:N},(_,i)=>m0+i*60000);
// Stock flow peaks at +50,000 shares; futures foreign at +20,000 contracts (= +200,000 shares ×10), both growing.
const stock=times.map((t,i)=>({t,individual:-20000*(i+1)/N,foreign:50000*(i+1)/N,institution:-30000,program:10000}));
const futures=code=>times.map((t,i)=>({t,individual:-3000,foreign:20000*(i+1)/N,institution:-1000*(i+1)/N}));
const multiplier=code=>code==='069500'?100:10;
await page.route('http://market-page.test/**',route=>{const url=new URL(route.request().url()),q=url.searchParams,code=q.get('code');
if(url.pathname==='/api/ls-stock-futures/chart'){const mode=q.get('mode');
 return route.fulfill({json:mode==='minute'?{success:true,mode,multiplier:multiplier(code),date:'2026-11-06',available_dates:['2026-11-06'],points:futures(code),has_more:false,cursor:null,warnings:[],status:{error:''}}
  :{success:true,mode,multiplier:multiplier(code),points:[{t:day,individual:-6,foreign:5,institution:1}],has_more:false,cursor:null,warnings:[]}});}
if(url.pathname==='/api/ls-stock-futures/candles')return route.fulfill({json:{success:true,mode:q.get('mode'),date:'2026-11-06',points:[],has_more:false,cursor:null}});
if(['/api/supply/chart','/api/kis-supply/chart'].includes(url.pathname))return route.fulfill({json:{success:true,mode:q.get('mode'),points:q.get('mode')==='minute'?stock:[{t:day,foreign:1,institution:2,individual:3,program:4}],candles:[p],warnings:[],has_more:false,date:'2026-11-06',available_dates:['2026-11-06']}});
if(url.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'삼성전자'},{code:'069500',name:'KODEX 200'}],archive:[{code:'005930',name:'삼성전자'},{code:'069500',name:'KODEX 200'}],revision:1}});
if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'chart-test@example.test'}}});
if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:[],markets:{kospi:[p],kosdaq:[p]},dates:[],series:{highs:{points:[]},lows:{points:[]},vix:{points:[]},vkospi:{points:[]},'fear-greed':{points:[]},'high-yield-spread':{points:[]}},warnings:[],has_more:false}});
return route.fulfill({contentType:'text/html',body:html});});
await page.goto('http://market-page.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
for(const file of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+file});
await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
const stockCard=page.locator('#rankCombinedSupplyChartPanel'),futCard=page.locator('#rankFuturesSupplyChartPanel');
const box=card=>card.locator('.supply-y-sync input'),label=card=>card.locator('.supply-y-sync');
const ranges=()=>page.evaluate(()=>[getRankCombinedSupplyYRange(),getRankFuturesSupplyYRange()]);
const expect=(sets,first,last)=>{let min=0,max=0;for(const [rows,scale,fields] of sets)for(const r of rows)if(r.t>=first&&r.t<=last)for(const f of fields)if(Number.isFinite(r[f])){min=Math.min(min,r[f]*scale);max=Math.max(max,r[f]*scale);}
 const pad=Math.max(1,max-min)*.08;return [Math.round(min-pad),Math.round(max+pad)];};
const stockFields=['individual','foreign','institution','program'],futFields=['individual','foreign','institution','program'];
const waitRanges=async(expected,label)=>{try{await page.waitForFunction(e=>{const r=[getRankCombinedSupplyYRange(),getRankFuturesSupplyYRange()];return r.every((x,i)=>x.mode==='minute'&&Math.round(x.min)===e[i][0]&&Math.round(x.max)===e[i][1]);},expected,{timeout:10000});}
 catch(e){console.error(label,'got',JSON.stringify(await ranges()),'expected',JSON.stringify(expected));throw e;}};
await page.waitForFunction(()=>getRankFuturesSupplyState().points.length>0&&getRankCombinedSupplyState().points.length>0);
// Daily: contracts × 10 in the legend, no checkbox.
await page.waitForFunction(()=>document.querySelector('#rankFuturesSupplyChartPanel [data-series=foreign] output').textContent==='+50주');
assert.equal(await label(stockCard).isVisible(),false);assert.equal(await label(futCard).isVisible(),false);
// Minute: both boxes visible, checked, with their texts; left of the i button.
await stockCard.locator('[data-mode=minute]').click();await futCard.locator('[data-mode=minute]').click();
await page.waitForFunction(()=>getRankFuturesSupplyState().points.length===40&&getRankCombinedSupplyState().points.length===40);
assert.equal(await label(stockCard).innerText(),'종목선물수급과 y축 동기화');assert.equal(await label(futCard).innerText(),'종목수급과 y축 동기화');
for(const card of [stockCard,futCard]){assert.equal(await box(card).isChecked(),true);
 const place=await card.evaluate(panel=>{const a=panel.querySelector('.supply-y-sync').getBoundingClientRect(),i=panel.querySelector('.chart-info-button').getBoundingClientRect(),h=panel.querySelector('[data-action="add-stock"]').getBoundingClientRect();return{left:a.right<=i.left,clear:h.right<=a.left||h.bottom<=a.top};});
 assert.deepEqual(place,{left:true,clear:true});}
assert.equal(await futCard.locator('[data-series=foreign] output').innerText().then(s=>s.replace(/\s/g,'')),'+200천주','20,000 contracts × 10');
const first=m0,last=m0+(N-1)*60000,both=expect([[stock,1,stockFields],[futures(),10,futFields]],first,last);
await waitRanges([both,both],'full');assert.equal(both[1],Math.round(200000+(200000+30000)*.08));
// Zoom in on the stock card: the shared axis moves both views; ranges follow the visible window.
await stockCard.locator('[aria-label="수급 차트 확대"]').click();
let r=await ranges();assert.ok(r[0].last-r[0].first<last-first,'zoomed');
const zoomed=expect([[stock,1,stockFields],[futures(),10,futFields]],r[0].first,r[0].last);
assert.ok(zoomed[1]<both[1]);await waitRanges([zoomed,zoomed],'zoomed');
await stockCard.locator('[aria-label="수급 차트 축소"]').click();await waitRanges([both,both],'zoom out');
// Unchecking one card only frees that card; the other still includes both.
await box(stockCard).uncheck();await waitRanges([expect([[stock,1,stockFields]],first,last),both],'stock unchecked');
assert.equal(await page.evaluate(()=>localStorage.getItem('rankCombinedSupplyChartPanelYSync')),'0');
assert.equal((await page.evaluate(()=>getRankCombinedSupplyDisplaySettings())).ySync,false);
await box(futCard).uncheck();await waitRanges([expect([[stock,1,stockFields]],first,last),expect([[futures(),10,futFields]],first,last)],'both unchecked');
await box(stockCard).check();await box(futCard).check();await waitRanges([both,both],'rechecked');
// ETF futures: × 100.
await stockCard.locator('.supply-stock-select').selectOption('069500');
await page.waitForFunction(()=>getRankFuturesSupplyState().selected==='069500'&&getRankFuturesSupplyYRange().multiplier===100&&getRankFuturesSupplyState().points.length===40);
const etf=expect([[stock,1,stockFields],[futures(),100,futFields]],first,last);await waitRanges([etf,etf],'etf');
assert.deepEqual(errors,[]);
await page.locator('.rank-chart-row').first().screenshot({path:require('node:path').join(require('node:os').tmpdir(),'supply-futures-y-sync.png')});
console.log('Supply/futures y sync:',JSON.stringify({both,zoomed,etf}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
