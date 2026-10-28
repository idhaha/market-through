const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:2400,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
const t=Date.parse('2026-10-23T09:00:00+09:00'),p={t,open:2500,high:2510,low:2490,close:2505};
await page.route('http://market-page.test/**',route=>{const url=new URL(route.request().url());
if(url.pathname==='/api/turnover/chart')return route.fulfill({json:{success:true,markets:{kospi:[{...p,market_turnover:1e12}],kosdaq:[{...p,market_turnover:0.5e12}]},warnings:[],has_more:false}});
if(url.pathname==='/api/supply/chart')return route.fulfill({json:{success:true,mode:url.searchParams.get('mode'),points:[{t,foreign:111,institution:222,individual:333,program:444}],candles:[p],warnings:[],has_more:false,date:'2026-10-23',available_dates:['2026-10-23']}});
if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'chart-test@example.test'}}});
if(['/api/concentration-chart','/api/kis-concentration-chart','/api/ls-concentration-chart'].includes(url.pathname)){
 const input=route.request().postDataJSON(),ratio=url.pathname.includes('ls-')?30:url.pathname.includes('kis-')?20:10;
 return route.fulfill({json:{success:true,mode:input.mode,market:'K',points:[{time:input.mode==='minute'?'20261023090000':'20261023',value:ratio,stock_price:100,stock_open:99,stock_high:101,stock_low:98}],warnings:[],has_more:false}});
}
if(['/api/kis-turnover/chart','/api/ls-turnover/chart'].includes(url.pathname))return route.fulfill({json:{success:true,markets:{kospi:[{...p,market_turnover:url.pathname.includes('ls-')?3e12:2e12}],kosdaq:[{...p,market_turnover:1e12}]},warnings:[],has_more:false}});
if(['/api/market-supply/chart','/api/ls-market-supply/chart','/api/kiwoom-market-supply/chart'].includes(url.pathname))return route.fulfill({json:{success:true,points:[{t,foreign:url.pathname.includes('ls-')?300:url.pathname.includes('kiwoom-')?100:200,program:-50,institution:40,individual:-90}],candles:[p],warnings:[],has_more:false}});if(['/api/kis-supply/chart','/api/ls-supply/chart'].includes(url.pathname))return route.fulfill({json:{success:true,points:[{t,foreign:100,institution:-30,program:url.pathname.includes('kis')?200:300,...(url.pathname.includes('ls')?{individual:-70}:{})}],candles:[p],warnings:[],has_more:false,date:'2026-10-23',available_dates:['2026-10-23']}});if(url.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'삼성전자'}],archive:[{code:'005930',name:'삼성전자'}],revision:1}});if(url.pathname==='/api/chart-reference')return route.fulfill({json:{points:[p],has_more:false}});if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:[p],markets:{kospi:[p],kosdaq:[p]},dates:['2026-10-23'],series:{highs:{points:[]},lows:{points:[]},vix:{points:[]},vkospi:{points:[]},'fear-greed':{points:[]},'high-yield-spread':{points:[]}},warnings:[],has_more:false}});return route.fulfill({contentType:'text/html',body:html});});
await page.goto('http://market-page.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
for(const file of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+file});
await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));await page.waitForFunction(()=>document.querySelector('#rankCombinedMarketSupplyChartPanel .rank-adr-status').textContent.includes('일별 순매수대금'));



const card=page.locator('#rankCombinedMarketSupplyChartPanel');assert.equal(await card.locator('h2').innerText(),'시장 수급');
const value=()=>card.locator('[data-series=foreign] output').innerText();
await page.waitForFunction(()=>document.querySelector('#rankCombinedMarketSupplyChartPanel [data-series=foreign] output').textContent==='+3억원');
for(const market of ['futures','futuresKosdaq']){await card.locator('input[value='+market+']').check();await page.waitForFunction(()=>document.querySelector('#rankCombinedMarketSupplyChartPanel .rank-card-source').textContent.includes('LS'));assert.equal(await card.locator('[data-series=program]').isDisabled(),true);}
await card.locator('[data-mode=minute]').click();
await page.waitForFunction(()=>document.querySelector('#rankCombinedMarketSupplyChartPanel [data-series=foreign] output').textContent==='+2억원');assert.match(await card.locator('.rank-card-source').innerText(),/한투/);
for(const market of ['kospi','kosdaq']){await card.locator('input[value='+market+']').check();await page.waitForFunction(()=>document.querySelector('#rankCombinedMarketSupplyChartPanel [data-series=foreign] output').textContent==='+1억원');assert.match(await card.locator('.rank-card-source').innerText(),/키움/);}
await card.locator('input[value=futures]').check();await page.waitForFunction(()=>document.querySelector('#rankCombinedMarketSupplyChartPanel [data-series=foreign] output').textContent==='+2억원');
await card.locator('[data-mode=day]').click();await page.waitForFunction(()=>document.querySelector('#rankCombinedMarketSupplyChartPanel [data-series=foreign] output').textContent==='+3억원');
const guide=await card.locator('.supply-data-guide').innerText();for(const tr of ['t1665','t8462','ka10051','FHPTJ04030000'])assert.ok(guide.includes(tr),tr);
const settings=await page.evaluate(()=>getConcentrationDisplaySettings());assert.equal(settings.combinedMarketSupply.mode,'day');assert.equal(settings.combinedMarketSupply.selected,'futures');
const layout=await page.evaluate(()=>{const a=document.getElementById('rankCombinedSupplyChartPanel').getBoundingClientRect(),b=document.getElementById('rankCombinedMarketSupplyChartPanel').getBoundingClientRect();return{topA:a.top,topB:b.top,rightA:a.right,leftB:b.left,count:document.querySelectorAll('.rank-chart-row>.panel').length};});assert.equal(layout.topA,layout.topB);assert.ok(layout.leftB>layout.rightA);assert.equal(layout.count,8);assert.deepEqual(errors,[]);
await card.screenshot({path:'dev/output/combined-market-supply.png'});console.log('Combined market supply: LS daily, Kiwoom cash minute, KIS futures minute, guide, settings and right-side layout passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
