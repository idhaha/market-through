const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:2400,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
const t=Date.parse('2026-10-23T09:00:00+09:00'),p={t,open:2500,high:2510,low:2490,close:2505};
await page.route('http://market-page.test/**',route=>{const url=new URL(route.request().url());
if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'chart-test@example.test'}}});
if(['/api/concentration-chart','/api/kis-concentration-chart','/api/ls-concentration-chart'].includes(url.pathname)){
 const input=route.request().postDataJSON(),ratio=url.pathname.includes('ls-')?30:url.pathname.includes('kis-')?20:10;
 return route.fulfill({json:{success:true,mode:input.mode,market:'K',points:[{time:input.mode==='minute'?'20261023090000':'20261023',value:ratio,stock_price:100,stock_open:99,stock_high:101,stock_low:98}],warnings:[],has_more:false}});
}
if(['/api/kis-turnover/chart','/api/ls-turnover/chart'].includes(url.pathname))return route.fulfill({json:{success:true,markets:{kospi:[{...p,market_turnover:url.pathname.includes('ls-')?3e12:2e12}],kosdaq:[{...p,market_turnover:1e12}]},warnings:[],has_more:false}});
if(['/api/market-supply/chart','/api/ls-market-supply/chart','/api/kiwoom-market-supply/chart'].includes(url.pathname))return route.fulfill({json:{success:true,points:[{t,foreign:100,program:-50,institution:40,individual:-90}],candles:[p],warnings:[],has_more:false}});if(['/api/kis-supply/chart','/api/ls-supply/chart'].includes(url.pathname))return route.fulfill({json:{success:true,points:[{t,foreign:100,institution:-30,program:url.pathname.includes('kis')?200:300,...(url.pathname.includes('ls')?{individual:-70}:{})}],candles:[p],warnings:[],has_more:false,date:'2026-10-23',available_dates:['2026-10-23']}});if(url.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'삼성전자'}],archive:[{code:'005930',name:'삼성전자'}],revision:1}});if(url.pathname==='/api/chart-reference')return route.fulfill({json:{points:[p],has_more:false}});if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:[p],markets:{kospi:[p],kosdaq:[p]},dates:['2026-10-23'],series:{highs:{points:[]},lows:{points:[]},vix:{points:[]},vkospi:{points:[]},'fear-greed':{points:[]},'high-yield-spread':{points:[]}},warnings:[],has_more:false}});return route.fulfill({contentType:'text/html',body:html});});
await page.goto('http://market-page.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
for(const file of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+file});
await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));await page.waitForFunction(()=>document.querySelector('#rankCombinedMarketSupplyChartPanel .rank-adr-status').textContent.includes('일별 순매수대금'));

assert.equal(await page.locator('#combinedConcentrationChartPanel h2').innerText(),'쏠림율');
await page.evaluate(()=>selectRankChartStock({code:'000660',name:'SK하이닉스',market:'K'}));
await page.waitForFunction(()=>window.getCombinedRankChartState?.().points[0]?.value===10&&!getCombinedRankChartState().busy);
await page.locator('#combinedConcentrationChartPanel [data-chart-mode="minute"]').click();
await page.waitForFunction(()=>getCombinedRankChartState().mode==='minute'&&getCombinedRankChartState().points[0]?.value===30&&!getCombinedRankChartState().busy);
assert.equal(await page.locator('#combinedConcentrationCurrentRate').innerText(),'30.0%');
assert.match(await page.locator('#combinedConcentrationChartPanel .rank-card-source').innerText(),/LS/);
await page.locator('#combinedConcentrationChartPanel [data-chart-mode="day"]').click();
await page.waitForFunction(()=>getCombinedRankChartState().mode==='day'&&getCombinedRankChartState().points[0]?.value===10&&!getCombinedRankChartState().busy);
assert.match(await page.locator('#combinedConcentrationChartPanel .rank-card-source').innerText(),/키움/);
const settings=await page.evaluate(()=>getConcentrationDisplaySettings());assert.equal(settings.mode,'day');
const layout=await page.evaluate(()=>{const p=document.getElementById('combinedConcentrationChartPanel'),r=p.getBoundingClientRect(),others=[...document.querySelectorAll('.rank-chart-row>.panel')].filter(e=>e!==p);return{count:others.length+1,top:r.top,previousBottom:Math.max(...others.filter(e=>!['rankCombinedTurnoverChartPanel','rankCombinedSupplyChartPanel','rankCombinedMarketSupplyChartPanel'].includes(e.id)).map(e=>e.getBoundingClientRect().bottom)),height:p.querySelector('canvas').getBoundingClientRect().height,ids:[...document.querySelectorAll('[id]')].map(e=>e.id)};});
assert.equal(layout.count,10);assert.deepEqual(await page.locator('#combinedConcentrationChartPanel').evaluate(p=>[getComputedStyle(p).gridRowStart,getComputedStyle(p).gridColumnStart]),['1','1']);assert.ok(layout.height>200);assert.equal(new Set(layout.ids).size,layout.ids.length);assert.deepEqual(errors,[]);
await page.locator('#combinedConcentrationChartPanel').screenshot({path:'dev/output/combined-concentration-card.png'});console.log('Combined concentration: Kiwoom day / LS minute, separate state, original cards and current grid layout passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
