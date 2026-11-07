const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
// 종목 선물 수급 card: LS futures investor contracts with 연결선물 candles, same selection policy as 종목 수급,
// placed in column 2 row 2 with 시장 거래대금 and 변동성 one row lower.
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:2400,height:1600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
const requests=[];page.on('request',r=>{const u=new URL(r.url());requests.push(u.pathname+u.search);});
const t=Date.parse('2026-11-06T00:00:00+09:00'),m=Date.parse('2026-11-06T09:00:00+09:00'),p={t,open:2500,high:2510,low:2490,close:2505};
await page.route('http://market-page.test/**',route=>{const url=new URL(route.request().url()),q=url.searchParams;
if(url.pathname==='/api/ls-stock-futures/chart'){
 if(q.get('code')==='035720')return route.fulfill({status:404,json:{success:false,error:'주식선물이 없는 종목입니다.'}});
 if(q.get('mode')==='minute'){const date=q.get('cursor')?q.get('cursor').replace(/(d{4})(d{2})(d{2})/,'$1-$2-$3'):q.get('date')||'2026-11-06',flow={'2026-11-06':-60046,'2026-11-04':-4909};
  return route.fulfill({json:{success:true,mode:'minute',date,available_dates:['2026-11-04','2026-11-06'],points:flow[date]!=null?[{t:Date.parse(date+'T09:00:00+09:00'),individual:flow[date],foreign:-758,institution:61394}]:[],has_more:date>'2026-11-04',cursor:date>'2026-11-04'?'20261104':null,warnings:[],status:{error:''}}});}
 return route.fulfill({json:false?null
  :{success:true,mode:'day',points:[{t,individual:-60046,foreign:5432,institution:61394}],has_more:false,cursor:null,warnings:[]}});}
if(url.pathname==='/api/ls-stock-futures/candles'&&q.get('mode')==='minute'){const date=q.get('date')||'2026-11-06',previous={'2026-11-06':'20261105','2026-11-05':'20261104','2026-11-04':'20261103'}[date];
 return route.fulfill({json:{success:true,mode:'minute',date,points:[{t:Date.parse(date+'T09:00:00+09:00'),open:188000,high:189000,low:187000,close:date==='2026-11-05'?185500:188500}],has_more:!!previous,cursor:previous||null,source:'KIS FHKIF03020200 A11611'}});}
if(url.pathname==='/api/ls-stock-futures/candles')return route.fulfill({json:false?null:{success:true,mode:'day',points:[{t,open:182300,high:196500,low:182300,close:188500}]}});
if(url.pathname==='/api/supply/chart')return route.fulfill({json:{success:true,mode:q.get('mode'),points:[{t,foreign:111,institution:222,individual:333,program:444}],candles:[p],warnings:[],has_more:false,date:'2026-11-06',available_dates:['2026-11-06']}});
if(url.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'삼성전자'},{code:'000660',name:'SK하이닉스'},{code:'035720',name:'카카오'}],archive:[{code:'005930',name:'삼성전자'},{code:'000660',name:'SK하이닉스'},{code:'035720',name:'카카오'}],revision:1}});
if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'chart-test@example.test'}}});
if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:[],markets:{kospi:[p],kosdaq:[p]},dates:[],series:{highs:{points:[]},lows:{points:[]},vix:{points:[]},vkospi:{points:[]},'fear-greed':{points:[]},'high-yield-spread':{points:[]}},warnings:[],has_more:false}});
return route.fulfill({contentType:'text/html',body:html});});
await page.goto('http://market-page.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
for(const file of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+file});
await page.evaluate(()=>{window.__texts=[];const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...rest){window.__texts.push(String(text));return fill.call(this,text,...rest);};document.dispatchEvent(new Event('DOMContentLoaded'));});
await page.waitForFunction(()=>window.getRankFuturesSupplyState?.().points[0]?.foreign===5432);
const card=page.locator('#rankFuturesSupplyChartPanel');
assert.equal(await card.locator('h2').innerText(),'종목 선물 수급');
assert.deepEqual(await card.locator('.supply-legend [data-series]').evaluateAll(b=>b.map(x=>x.dataset.series)),['individual','foreign','institution','program'],'program kept for the same layout as 종목 수급');
// LS has no stock futures program trading: the legend says 미제공 and the day chart keeps an empty 프로그램 lane.
assert.equal((await card.locator('[data-series="program"] output').innerText()).trim(),'미제공');
await page.waitForFunction(()=>window.__texts.includes('프로그램')&&window.__texts.includes('미제공'));
assert.match(await card.locator('[data-series="foreign"] output').innerText(),/\+5,432\s*계약/);
assert.match(await card.locator('[data-series="individual"] output').innerText(),/-60\s*천계약/);
// Day candles: 연결선물 from the futures endpoint.
await card.locator('.concentration-candle-toggle').click();
await page.waitForFunction(()=>getRankFuturesSupplyState().candles?.length>0);
assert.ok(requests.some(u=>u.startsWith('/api/ls-stock-futures/candles?code=005930&mode=day')),requests.filter(u=>u.includes('futures')).join('\n'));
await card.locator('[data-mode=minute]').click();
await page.waitForFunction(()=>getRankFuturesSupplyState().mode==='minute'&&getRankFuturesSupplyState().points[0]?.institution===61394);
assert.ok(requests.some(u=>u.startsWith('/api/ls-stock-futures/chart?code=005930&mode=minute')));
await page.waitForFunction(()=>getRankFuturesSupplyState().candles.some(c=>c.close===188500));
// 더 불러오기 steps open days by the candle cursor: 11/5 has bars but no flow and is still shown.
await page.waitForFunction(()=>getRankFuturesSupplyState().priceCursor==='20261105');
await card.locator('[data-action="more"]').click();
await page.waitForFunction(()=>getRankFuturesSupplyState().candles.some(c=>c.close===185500));
assert.ok(requests.some(u=>u.startsWith('/api/ls-stock-futures/chart?code=005930&mode=minute&cursor=20261105')),requests.filter(u=>u.includes('futures')).join(' | '));
assert.ok(await page.evaluate(()=>getRankFuturesSupplyState().points.some(p=>p.t===Date.parse('2026-11-05T09:00:00+09:00'))),'11/5 is on the time axis');
assert.equal((await card.locator('[data-series="program"] output').innerText()).trim(),'미제공','minute chart too');
// Guide lists the LS sources.
const guide=await card.locator('.supply-data-guide').innerText();
for(const tr of ['t8463','t8462','t8405','FHKIF03020200'])assert.match(guide,new RegExp(tr));
// Selection follows the stock supply card both ways.
await page.locator('#rankCombinedSupplyChartPanel .supply-stock-select').selectOption('000660');
await page.waitForFunction(()=>getRankFuturesSupplyState().selected==='000660');
await card.locator('.supply-stock-select').selectOption('005930');
await page.waitForFunction(()=>getRankCombinedSupplyState().selected==='005930');
// A stock without stock futures says so.
await card.locator('.supply-stock-select').selectOption('035720');
await page.waitForFunction(()=>/주식선물이 없는 종목/.test(document.querySelector('#rankFuturesSupplyChartPanel [role="status"]').textContent));
// Layout: column 2 = 종목 수급, 종목 선물 수급, 시장 거래대금, 변동성 from the top.
const box=id=>page.evaluate(id=>{const r=document.getElementById(id).getBoundingClientRect(),s=getComputedStyle(document.getElementById(id));return {left:Math.round(r.left),top:r.top,bottom:r.bottom,row:s.gridRowStart,col:s.gridColumnStart};},id);
const supply=await box('rankCombinedSupplyChartPanel'),fut=await box('rankFuturesSupplyChartPanel'),turn=await box('rankCombinedTurnoverChartPanel'),vol=await box('rankVolatilityChartPanel');
assert.deepEqual([supply.col,fut.col,turn.col,vol.col],['2','2','2','2']);assert.deepEqual([supply.row,fut.row,turn.row,vol.row],['1','2','3','4']);
assert.ok(fut.top>=supply.bottom&&turn.top>=fut.bottom&&vol.top>=turn.bottom,JSON.stringify({supply,fut,turn,vol}));
assert.equal(await page.locator('.rank-chart-row>.panel').count(),10);
assert.deepEqual(errors,[]);await card.screenshot({path:require('node:path').join(require('node:os').tmpdir(),'futures-supply-card.png')});
console.log('Futures supply card: contracts with program as 미제공 (empty day lane), 연결선물 day and minute candles, guide, two-way selection, no-futures notice and column-2 layout passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
