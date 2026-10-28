const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:2400,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
const t=Date.parse('2026-10-23T09:00:00+09:00'),p={t,open:2500,high:2510,low:2490,close:2505};
await page.route('http://market-page.test/**',route=>{const url=new URL(route.request().url());
if(url.pathname==='/api/turnover/chart')return route.fulfill({json:{success:true,markets:{kospi:[{...p,market_turnover:1e12}],kosdaq:[{...p,market_turnover:0.5e12}]},warnings:[],has_more:false}});
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


const rows=[['combinedConcentrationChartPanel','rankCombinedSupplyChartPanel','rankCombinedMarketSupplyChartPanel'],['rankBreadthChartPanel','rankAdrChartPanel','rankCombinedTurnoverChartPanel'],['rankVolatilityChartPanel','rankSentimentChartPanel']];
let bottom=0;
for(const ids of rows){const rects=await page.evaluate(ids=>ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{top:r.top,left:r.left,bottom:r.bottom};}),ids);assert.ok(rects[0].top>=bottom);for(let i=1;i<rects.length;i++){assert.equal(rects[i].top,rects[0].top);assert.ok(rects[i].left>rects[i-1].left);}bottom=Math.max(...rects.map(r=>r.bottom));}
assert.equal(await page.locator('.rank-chart-row>.panel').count(),8);
await page.setViewportSize({width:600,height:1000});
const mobile=await page.evaluate(ids=>ids.flat().map(id=>{const r=document.getElementById(id).getBoundingClientRect();return{top:r.top,left:r.left,bottom:r.bottom};}),rows);
for(let i=1;i<mobile.length;i++){assert.equal(mobile[i].left,mobile[0].left);assert.ok(mobile[i].top>=mobile[i-1].bottom);}
const split=await page.evaluate(()=>{const panel=document.getElementById('rankCombinedMarketSupplyChartPanel');const messages=RankSupplyGuide.loadingWarnings(panel,'minute',['키움 KRX+NXT 통합 · 표시 단위: 억원','투자자는 1분마다 관측한 누적값','과거 조회 실패: 요청 시간 초과','일부 구간 미제공']);return{messages,notes:document.querySelector('#'+panel.id+'Guide [data-loading-notes="minute"]').textContent};});
assert.deepEqual(split.messages,['과거 조회 실패: 요청 시간 초과','일부 구간 미제공']);assert.match(split.notes,/표시 단위: 억원/);assert.match(split.notes,/관측한 누적값/);
const concentrationNotes=await page.evaluate(()=>{const panel=document.getElementById('combinedConcentrationChartPanel');return {messages:RankSupplyGuide.loadingWarnings(panel,'minute',['LS 거래대금 미제공 구간은 결측 · 가격 캔들은 키움 자료','한투 거래대금 조회 실패: 시간 초과']),notes:document.querySelector('#'+panel.id+'Guide [data-loading-notes="minute"]').textContent};});
assert.deepEqual(concentrationNotes.messages,['한투 거래대금 조회 실패: 시간 초과']);assert.match(concentrationNotes.notes,/미제공 구간은 결측/);assert.match(concentrationNotes.notes,/가격 캔들은 키움 자료/);
assert.deepEqual(errors,[]);console.log('PASS trading chart desktop rows and mobile order; eight retained cards');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
