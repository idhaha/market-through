const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:2400,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.clock.setFixedTime(new Date('2026-10-23T10:00:00+09:00'));
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
if(['/api/market-supply/chart','/api/ls-market-supply/chart','/api/kiwoom-market-supply/chart','/api/ls-futures-test/chart'].includes(url.pathname))return route.fulfill({json:{success:true,points:[{t,foreign:url.pathname.includes('ls-')?300:url.pathname.includes('kiwoom-')?100:200,program:-50,institution:40,individual:-90}],candles:[p],warnings:[],has_more:false}});if(['/api/kis-supply/chart','/api/ls-supply/chart'].includes(url.pathname))return route.fulfill({json:{success:true,points:[{t,foreign:100,institution:-30,program:url.pathname.includes('kis')?200:300,...(url.pathname.includes('ls')?{individual:-70}:{})}],candles:[p],warnings:[],has_more:false,date:'2026-10-23',available_dates:['2026-10-23']}});if(url.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'삼성전자'}],archive:[{code:'005930',name:'삼성전자'}],revision:1}});if(url.pathname==='/api/chart-reference')return route.fulfill({json:{points:[p],has_more:false}});if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:[p],markets:{kospi:[p],kosdaq:[p]},dates:['2026-10-23'],series:{highs:{points:[]},lows:{points:[]},vix:{points:[]},vkospi:{points:[]},'fear-greed':{points:[]},'high-yield-spread':{points:[]}},warnings:[],has_more:false}});return route.fulfill({contentType:'text/html',body:html});});
await page.goto('http://market-page.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
for(const file of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+file});
await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));await page.waitForFunction(()=>window.getRankTestMarketSupplySecondaryDisplaySettings&&window.getConcentrationDisplaySettings);



// Trading tab column 3: two test market supply cards (titled 시장 선물 수급 for futures, 시장 수급 for spot) replace the combined 시장 수급 cards (rows 1-2; row 3 empty).
const card=page.locator('#rankTestMarketSupplyChartPanel'),secondary=page.locator('#rankTestMarketSupplySecondaryChartPanel');
assert.equal(await page.locator('#rankCombinedMarketSupplyChartPanel,#rankCombinedMarketSupplySecondaryChartPanel').count(),0,'combined cards are gone');
const title=c=>c.locator('h2').innerText();
assert.deepEqual([await title(card),await title(secondary)],['시장 선물 수급','시장 선물 수급'],'futures defaults');
const positions=await page.evaluate(()=>['rankTestMarketSupplyChartPanel','rankTestMarketSupplySecondaryChartPanel'].map(id=>{const s=getComputedStyle(document.getElementById(id));return [s.gridColumnStart,s.gridRowStart]}));
assert.deepEqual(positions,[['3','1'],['3','2']]);
assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.rank-chart-row>.panel')].filter(p=>getComputedStyle(p).gridColumnStart==='3'&&getComputedStyle(p).gridRowStart==='3').length),0,'column 3 row 3 stays empty');
// Each card keeps its own market: defaults differ and are saved under separate keys.
assert.equal(await card.locator('input[value=futures]').isChecked(),true);
assert.equal(await secondary.locator('input[value=futuresKosdaq]').isChecked(),true);
let saved=await page.evaluate(()=>getConcentrationDisplaySettings());
assert.equal(saved.testMarketSupply.selected,'futures');assert.equal(saved.testMarketSupplySecondary.selected,'futuresKosdaq');
// Unpinned cards follow the shared market sync; a pinned card keeps its market.
await card.locator('input[value=kospi]').check();assert.equal(await secondary.locator('input[value=kospi]').isChecked(),true);
assert.deepEqual([await title(card),await title(secondary)],['시장 수급','시장 수급'],'spot → 시장 수급');
const pin=secondary.locator('.rank-market-pin');assert.equal(await pin.count(),1);await pin.click();assert.equal(await pin.getAttribute('aria-pressed'),'true');
await card.locator('input[value=kosdaq]').check();assert.equal(await secondary.locator('input[value=kospi]').isChecked(),true);
await card.locator('input[value=futuresKosdaq]').check();assert.equal(await title(card),'시장 선물 수급','KOSDAQ선물 → 시장 선물 수급');await card.locator('input[value=kosdaq]').check();assert.equal(await title(card),'시장 수급');
await page.waitForFunction(()=>getRankTestMarketSupplyDisplaySettings().selected==='kosdaq'&&getRankTestMarketSupplySecondaryDisplaySettings().selected==='kospi');
// Restoring saved settings applies each card's own value.
await page.evaluate(()=>applyConcentrationDisplaySettings({...getConcentrationDisplaySettings(),testMarketSupply:{selected:'futuresKosdaq',mode:'day'},testMarketSupplySecondary:{selected:'futures',mode:'day'}}));
await page.waitForFunction(()=>getRankTestMarketSupplyDisplaySettings().selected==='futuresKosdaq'&&getRankTestMarketSupplySecondaryDisplaySettings().selected==='futures');
saved=await page.evaluate(()=>getConcentrationDisplaySettings());
assert.equal(saved.testMarketSupply.selected,'futuresKosdaq');assert.equal(saved.testMarketSupplySecondary.selected,'futures');
assert.deepEqual([await title(card),await title(secondary)],['시장 선물 수급','시장 선물 수급'],'restored futures');
assert.ok(!('combinedMarketSupply' in saved)&&!('combinedMarketSupplySecondary' in saved));
assert.deepEqual(errors,[]);console.log('PASS two test market supply cards titled 시장 (선물) 수급 by selection: column 3 rows 1-2, separate markets and settings, pin blocks sync');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
