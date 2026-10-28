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
await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));await page.waitForFunction(()=>document.querySelector('#rankMarketSupplyChartPanel .rank-adr-status').textContent.includes('일별 순매수대금'));
const measure=()=>page.evaluate(()=>[...document.querySelectorAll('.rank-chart-row>.panel')].map(panel=>{const c=panel.querySelector('canvas'),r=panel.getBoundingClientRect(),b=c.getBoundingClientRect();return {id:panel.id,x:r.x,y:r.y,offset:b.y-r.y,height:b.height,bottom:r.bottom,footer:panel.querySelector('.rank-card-footer')?.getBoundingClientRect().bottom};}));
await page.waitForTimeout(150);const layout=await measure();assert.equal(layout.length,18);const market=layout.find(p=>p.id==='rankMarketSupplyChartPanel'),supply=layout.find(p=>p.id==='rankSupplyChartPanel');assert.equal(market.height,supply.height);assert.ok(Math.abs(market.offset-supply.offset)<2,JSON.stringify(layout));assert.ok(market.footer<=market.bottom+2,JSON.stringify(market));
await page.locator('#rankMarketSupplyChartPanel .concentration-candle-toggle').click();await page.waitForTimeout(100);assert.equal(await page.locator('#rankMarketSupplyChartPanel .rank-adr-candle-area').isVisible(),true);assert.equal(await page.locator('#rankSupplyChartPanel .rank-adr-candle-area').isVisible(),true);
await page.locator('#rankMarketSupplyChartPanel .concentration-candle-toggle').click();await page.waitForTimeout(100);
const ls=page.locator('#rankLsMarketSupplyChartPanel');
assert.equal(await ls.locator('h2').innerText(),'시장 수급(LS)');

assert.ok(await page.evaluate(()=>typeof window.refreshRankLsMarketSupplyChart==='function'));
await page.evaluate(()=>window.applyRankLsMarketSupplyDisplaySettings({selected:'kosdaq',mode:'minute',visibleSeries:['foreign']}));
assert.equal(await page.evaluate(()=>window.getRankMarketSupplyDisplaySettings().selected),'kospi');
assert.equal(await page.evaluate(()=>window.getRankLsMarketSupplyDisplaySettings().selected),'kosdaq');
assert.ok(await page.evaluate(()=>window.getRankLsMarketSupplyDisplaySettings().visibleSeries.length===1));
await page.waitForFunction(()=>window.getRankKisSupplyState?.().points.length && window.getRankLsSupplyState?.().points.length);
assert.equal(await page.locator('#rankKisSupplyChartPanel h2').innerText(),'종목 수급(한투)');
assert.equal(await page.locator('#rankLsSupplyChartPanel h2').innerText(),'종목 수급(LS)');
assert.equal(await page.evaluate(()=>window.getRankKisSupplyState().points[0].program),200);
assert.equal(await page.evaluate(()=>window.getRankLsSupplyState().points[0].program),300);
await page.evaluate(()=>window.applyRankKisSupplySettings({selected:'005930',mode:'minute',visibleSeries:['program']}));
assert.equal(await page.evaluate(()=>window.getRankLsSupplyState().mode),'day');
assert.equal(await page.evaluate(()=>window.getRankSupplyState().mode),'day');
assert.equal(await page.evaluate(()=>window.getRankLsSupplyState().visibleSeries.length),4);
const groups=await page.evaluate(()=>{
 const ids=['rankSupplyChartPanel','rankKisSupplyChartPanel','rankLsSupplyChartPanel','rankKiwoomMarketSupplyChartPanel','rankMarketSupplyChartPanel','rankLsMarketSupplyChartPanel'];
 return ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return{id,x:r.x,y:r.y,bottom:r.bottom,title:e.querySelector('h2').textContent};});
});
assert.deepEqual(groups.map(p=>p.title),['종목 수급(키움)','종목 수급(한투)','종목 수급(LS)','시장 수급(키움)','시장 수급(한투)','시장 수급(LS)']);
assert.equal(groups[0].y,groups[1].y);assert.equal(groups[1].y,groups[2].y);
assert.equal(groups[3].y,groups[4].y);assert.equal(groups[4].y,groups[5].y);
assert.ok(groups[0].x<groups[1].x&&groups[1].x<groups[2].x);
assert.ok(groups[3].x<groups[4].x&&groups[4].x<groups[5].x);
assert.ok(Math.max(...groups.slice(0,3).map(p=>p.bottom))<=groups[3].y);

await page.evaluate(()=>window.selectRankChartStock({code:'005930',name:'삼성전자',market:'K'}));
await page.waitForFunction(()=>window.getLsRankChartState?.().points.length===1&&!window.getLsRankChartState().busy);
assert.equal(await page.locator('#lsConcentrationCurrentRate').textContent(),'30.0%');
assert.equal(await page.locator('#rankKisTurnoverChartPanel [data-latest=kospi]').textContent(),'2.0조원');
assert.equal(await page.locator('#rankLsTurnoverChartPanel [data-latest=kospi]').textContent(),'3.0조원');
await page.locator('#lsConcentrationChartPanel').screenshot({path:'dev/output/ls-concentration-card.png'});
await page.locator('#rankLsTurnoverChartPanel').screenshot({path:'dev/output/ls-turnover-card.png'});
const comparisonIds=['concentrationChartPanel','kisConcentrationChartPanel','lsConcentrationChartPanel','rankTurnoverChartPanel','rankKisTurnoverChartPanel','rankLsTurnoverChartPanel','rankSupplyChartPanel','rankKisSupplyChartPanel','rankLsSupplyChartPanel','rankKiwoomMarketSupplyChartPanel','rankMarketSupplyChartPanel','rankLsMarketSupplyChartPanel'];
const comparison=await page.evaluate(ids=>ids.map(id=>{const p=document.getElementById(id),r=p.getBoundingClientRect();return {id,x:r.x,y:r.y,bottom:r.bottom,title:p.querySelector('h2').textContent};}),comparisonIds);
assert.deepEqual(comparison.map(p=>p.title),['쏠림율(키움)','쏠림율(한투)','쏠림율(LS)','시장 거래대금(키움)','시장 거래대금(한투)','시장 거래대금(LS)','종목 수급(키움)','종목 수급(한투)','종목 수급(LS)','시장 수급(키움)','시장 수급(한투)','시장 수급(LS)']);
for(let i=0;i<12;i+=3){assert.equal(comparison[i].y,comparison[i+1].y);assert.equal(comparison[i+1].y,comparison[i+2].y);assert.ok(comparison[i].x<comparison[i+1].x&&comparison[i+1].x<comparison[i+2].x);if(i)assert.ok(comparison[i].y>=Math.max(...comparison.slice(i-3,i).map(p=>p.bottom)));}
assert.ok((await measure()).filter(p=>!comparisonIds.includes(p.id)).every(p=>p.y>=comparison[9].bottom));
await page.evaluate(()=>window.applyRankKiwoomMarketSupplyDisplaySettings({selected:'kosdaq',mode:'minute',visibleSeries:['program']}));
assert.equal(await page.evaluate(()=>window.getRankMarketSupplyDisplaySettings().selected),'kospi');
assert.equal(await page.locator('#rankKiwoomMarketSupplyChartPanel input[type=radio]').count(),4);
await page.waitForFunction(()=>document.querySelector('#rankKiwoomMarketSupplyChartPanel [data-series=program] output')?.textContent==='-1억원');
assert.equal(await page.locator('#rankKiwoomMarketSupplyChartPanel [data-series=program] output').textContent(),'-1억원');
await page.locator('#rankSupplyChartPanel').screenshot({path:'dev/output/comparison-stock-card.png'});
await page.locator('#rankKiwoomMarketSupplyChartPanel').screenshot({path:'dev/output/comparison-market-card.png'});

assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.length===new Set(ids).size;}),true);
await page.waitForTimeout(100);
await ls.screenshot({path:'dev/output/ls-market-supply-card.png'});
await page.evaluate(()=>document.querySelectorAll('*').forEach(e=>{if(e.scrollLeft)e.scrollLeft=0;}));
await page.screenshot({path:'dev/output/market-supply-full-page.png',fullPage:true});assert.equal(await page.locator('.supply-info-button').count(),15);
await page.evaluate(t=>{RankChartAxis.registerHover('test-shared-hover',()=> 'day',()=>t,()=>{});RankChartAxis.synchronizeHover('test-shared-hover');},t);
assert.equal(await page.locator('#lsConcentrationTooltip').isVisible(),true);
assert.match(await page.locator('#lsConcentrationTooltip').innerText(),/30.0%/);
assert.equal(await page.locator('#rankLsTurnoverChartPanel .turnover-hover-info').isVisible(),true);
assert.match(await page.locator('#rankLsTurnoverChartPanel .turnover-hover-info').innerText(),/3.0조원/);
await page.evaluate(()=>RankChartAxis.synchronizeHover('test-shared-hover',true));
assert.equal(await page.locator('#lsConcentrationTooltip').isVisible(),false);
const cumulativeValues=await page.evaluate(()=>[...RankChartAxis.concentrationCumulative([
 {time:'20261026080000',stock_turnover:10,market_turnover:null},
 {time:'20261026080100',stock_turnover:20,market_turnover:null},
 {time:'20261026090000',stock_turnover:30,market_turnover:100},
 {time:'20261026090100',stock_turnover:40,market_turnover:100},
 {time:'20261027090000',stock_turnover:100,market_turnover:100},
 {time:'20261027090100',stock_turnover:1,market_turnover:1,cumulative_value:80}
 ]).values()]);
assert.deepEqual(cumulativeValues,[null,null,60,50,null,80]);
const guideCases=[['rankSupplyChartPanel','ka90008'],['rankKisSupplyChartPanel','H0UNPGM0'],['rankLsSupplyChartPanel','UPH'],['rankKiwoomMarketSupplyChartPanel','ka90005'],['rankMarketSupplyChartPanel','FHPTJ04030000'],['rankLsMarketSupplyChartPanel','UPM'],['concentrationChartPanel','추정치'],['kisConcentrationChartPanel','차감'],['rankTurnoverChartPanel','추정'],['rankBreadthChartPanel','ka10016']];
for(const [id,expected]of guideCases){
 const card=page.locator('#'+id),button=card.locator('.supply-info-button'),guide=card.locator('.supply-data-guide');
 await button.click();assert.equal(await button.getAttribute('aria-expanded'),'true');assert.equal(await guide.isVisible(),true);
 await guide.getByRole('tab',{name:'1분봉',exact:true}).click();
 const content=await guide.locator('[role=tabpanel]:visible').innerText();assert.ok(content.includes(expected),id+': '+content);assert.ok(content.includes('캔들 출처')&&content.includes('키움증권'),id);
 const css=await button.evaluate(e=>({radius:getComputedStyle(e).borderRadius,width:e.getBoundingClientRect().width}));assert.equal(css.radius,'50%');assert.equal(css.width,20);
 await page.keyboard.press('Escape');assert.equal(await guide.isVisible(),false);assert.equal(await button.getAttribute('aria-expanded'),'false');
}
const kisInfo=page.locator('#rankKisSupplyChartPanel .supply-info-button');await kisInfo.focus();
assert.equal(await page.locator('#rankKisSupplyChartPanel .supply-data-guide').isVisible(),true);
await page.locator('#rankLsSupplyChartPanel .supply-info-button').click();assert.equal(await page.locator('#rankKisSupplyChartPanel .supply-data-guide').isVisible(),false);
await page.locator('#rankLsSupplyChartPanel .supply-data-guide [role=tab]').first().focus();await page.keyboard.press('ArrowRight');
assert.equal(await page.locator('#rankLsSupplyChartPanel .supply-data-guide [data-guide-mode=minute]').getAttribute('aria-selected'),'true');
await page.keyboard.press('Escape');
await page.locator('#rankLsMarketSupplyChartPanel .supply-info-button').click();
await page.locator('#rankLsMarketSupplyChartPanel .supply-data-guide [data-guide-mode=day]').click();
assert.ok((await page.locator('#rankLsMarketSupplyChartPanel .supply-data-guide [role=tabpanel]:visible').innerText()).includes('LS t1665'));
await page.locator('#rankLsMarketSupplyChartPanel').screenshot({path:'dev/output/market-data-guide.png'});
await page.keyboard.press('Escape');
const editCard=page.locator('#rankKiwoomMarketSupplyChartPanel'),editButton=editCard.locator('.supply-info-button'),editGuide=editCard.locator('.supply-data-guide');
await page.evaluate(()=>{window.guideSaveCount=0;window.saveAppData=()=>{window.guideSavedDisplay=window.getConcentrationDisplaySettings();window.guideSaveCount++;return Promise.resolve(true);};});
await editButton.click();await editGuide.getByRole('tab',{name:'일봉',exact:true}).click();
const originalDay=await editGuide.locator('[role=tabpanel]:visible').innerText();
await editButton.dblclick();const editDialog=page.locator('dialog.chart-guide-editor'),editText=editDialog.locator('textarea');
assert.equal(await editDialog.isVisible(),true);assert.ok((await editDialog.locator('.chart-guide-editor-context').innerText()).includes('일봉'));
await editText.fill('취소할 설명');await editDialog.getByRole('button',{name:'취소',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('#rankKiwoomMarketSupplyChartPanelGuide [data-guide-mode=day]').getAttribute('aria-selected')==='true');
assert.equal(await editGuide.locator('[role=tabpanel]:visible').innerText(),originalDay);
await editButton.dblclick();
const custom='직접 수정한 시장 수급 설명\n캔들: 키움\n<img src=x onerror="window.guideInjected=true">';
await editText.fill(custom);await editDialog.getByRole('button',{name:'저장',exact:true}).click();
assert.equal(await editGuide.locator('[role=tabpanel]:visible').innerText(),custom);
assert.equal(await editGuide.locator('.chart-guide-custom-text img').count(),0);assert.equal(await page.evaluate(()=>window.guideInjected),undefined);
assert.equal(await page.evaluate(()=>window.guideSaveCount),1);
const editKey='rankKiwoomMarketSupplyChartPanelGuideday';
assert.equal(await page.evaluate(k=>window.guideSavedDisplay.chartGuideEdits[k],editKey),custom);
await editGuide.getByRole('tab',{name:'1분봉',exact:true}).click();assert.ok((await editGuide.locator('[role=tabpanel]:visible').innerText()).includes('ka90005'));
await editGuide.getByRole('tab',{name:'일봉',exact:true}).click();
await editButton.focus();await page.keyboard.press('F2');assert.equal(await editDialog.isVisible(),true);
await editDialog.screenshot({path:'dev/output/chart-guide-editor.png'});await page.keyboard.press('Escape');assert.equal(await editDialog.isVisible(),false);
const cnn=page.locator('#rankSentimentChartPanel .chart-info-button');await cnn.dblclick();assert.equal(await editDialog.isVisible(),true);assert.ok((await editDialog.locator('.chart-guide-editor-context').innerText()).includes('CNN'));await editDialog.getByRole('button',{name:'취소',exact:true}).click();
await page.reload();
for(const file of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+file});
await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
assert.equal(await page.evaluate(k=>window.RankSupplyGuide.getEdits()[k],editKey),custom);
await editButton.click();await editGuide.getByRole('tab',{name:'일봉',exact:true}).click();assert.equal(await editGuide.locator('[role=tabpanel]:visible').innerText(),custom);
await editButton.dblclick();await editDialog.getByRole('button',{name:'기본 설명 불러오기',exact:true}).click();await editDialog.getByRole('button',{name:'저장',exact:true}).click();
assert.equal(await page.evaluate(k=>window.RankSupplyGuide.getEdits()[k],editKey),undefined);
assert.ok((await editGuide.locator('[role=tabpanel]:visible').innerText()).includes('ka90010'));
await page.keyboard.press('Escape');
await page.setViewportSize({width:600,height:1000});await page.waitForTimeout(100);
const narrow=await page.evaluate(()=>['rankSupplyChartPanel','rankKisSupplyChartPanel','rankLsSupplyChartPanel','rankKiwoomMarketSupplyChartPanel','rankMarketSupplyChartPanel','rankLsMarketSupplyChartPanel'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {y:r.y,bottom:r.bottom,column:getComputedStyle(e).gridColumnStart};}));
assert.ok(narrow.every(p=>p.column==='1'));
assert.ok(narrow.every((p,i)=>!i||p.y>=narrow[i-1].bottom));
await page.locator('#rankBreadthChartPanel .supply-info-button').click();
const helpWidth=await page.locator('#rankBreadthChartPanel .supply-data-guide').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,overflow:getComputedStyle(e).overflowY}));
assert.ok(helpWidth.scroll<=helpWidth.width+1,JSON.stringify(helpWidth));assert.equal(helpWidth.overflow,'auto');
await page.keyboard.press('Escape');
// Regression: source labels follow late observations, and flow/candle requests have distinct indicators.
await page.setViewportSize({width:2400,height:1100});
// The following checks deliberately hold network requests, independently of cache replay.
await page.evaluate(()=>{window.RankChartCache=undefined;});
let releaseFlow,releaseCandle;
const flowGate=new Promise(resolve=>releaseFlow=resolve),candleGate=new Promise(resolve=>releaseCandle=resolve);
await page.route('**/api/ls-market-supply/chart?**',async route=>{
 await flowGate;
 await route.fulfill({json:{success:true,points:[{t:Date.parse('2026-10-26T15:30:00+09:00'),individual:10},{t:Date.parse('2026-10-26T19:59:00+09:00'),individual:20,program:30}],candles:[],warnings:[],has_more:false}});
});
await page.route('**/api/adr/candles?**',async route=>{await candleGate;await route.fulfill({json:{points:[],has_more:false}});});
await page.evaluate(()=>{window.applyRankLsMarketSupplyDisplaySettings({selected:'kospi',mode:'minute'});});
const flowBar=page.locator('#rankLsMarketSupplyChartPanel .rank-adr-area .rank-chart-loading');
await flowBar.waitFor({state:'visible'});
const spinner=await flowBar.locator('.efriend-loading-spinner').evaluate(e=>({width:getComputedStyle(e).width,height:getComputedStyle(e).height,animation:getComputedStyle(e).animationName}));
assert.deepEqual(spinner,{width:'36px',height:'36px',animation:'efriend-spin'});
await page.evaluate(()=>window.applyRankLsMarketSupplyCandleOpen?.(true));
releaseFlow();
await page.waitForFunction(()=>document.querySelector('#rankLsMarketSupplyChartPanel [data-series=individual] .supply-observed-time')?.textContent==='19:59');
assert.equal(await page.locator('#rankLsMarketSupplyChartPanel [data-series=individual] output').textContent(),'+0억원');
await flowBar.waitFor({state:'hidden'});
await page.locator('#rankLsMarketSupplyChartPanel .rank-adr-candle-area .rank-chart-loading').waitFor({state:'visible'});
// The helper does not bridge overnight or post-close intervals.
assert.deepEqual(await page.evaluate(()=>{const t=s=>Date.parse(s+'+09:00');return [
 RankChartAxis.intradayGap(t('2026-10-26T15:19:00'),t('2026-10-26T15:30:00'),930),
 RankChartAxis.intradayGap(t('2026-10-26T15:30:00'),t('2026-10-26T16:00:00'),930),
 RankChartAxis.intradayGap(t('2026-10-26T19:59:00'),t('2026-10-27T08:01:00'))];}),[true,false,false]);
const sliderStyle=await page.locator('#lsConcentrationRange').evaluate(e=>({flex:getComputedStyle(e).flexGrow,width:e.clientWidth,parent:e.parentElement.clientWidth}));
assert.equal(sliderStyle.flex,'1');assert.ok(sliderStyle.width>sliderStyle.parent/2,JSON.stringify(sliderStyle));
releaseCandle();
const lsSummary=await page.locator('#rankLsMarketSupplyChartPanel .supply-data-guide [role=tabpanel]').first().locator('.chart-transport-summary').innerText();
assert.match(lsSummary,/시장 범위:.*KRX\+NXT 통합/);assert.match(lsSummary,/일봉/);assert.match(lsSummary,/1분봉/);assert.match(lsSummary,/REST API.*LS t1665/);assert.match(lsSummary,/웹소켓.*LS.*UBT/);
const concentrationSummary=await page.locator('#lsConcentrationChartPanel .supply-data-guide [role=tabpanel]').first().locator('.chart-transport-summary').innerText();
assert.match(concentrationSummary,/통합 집계 여부 미확인/);assert.match(concentrationSummary,/REST API.*LS t8451/);assert.match(concentrationSummary,/웹소켓 우선.*LS US3/);
await page.evaluate(()=>{
 Date.now=()=>Date.parse('2026-10-26T22:00:00+09:00');
 window.cumulativeStrokes=0;const original=CanvasRenderingContext2D.prototype.stroke;
 CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.id==='lsConcentrationCanvas'&&this.strokeStyle==='#ea580c')window.cumulativeStrokes++;return original.apply(this,args);};
 const state=window.getLsRankChartState();window.applyLsRankChartState({...state,mode:'minute',interval:1,busy:false,points:[
 {time:'20261026090000',value:10,cumulative_value:40,stock_price:100},
 {time:'20261026090100',value:20,cumulative_value:50,stock_price:101}]});
 RankChartAxis.registerHover('test-cumulative-hover',()=> 'minute',()=> '20261026090000',()=>{});RankChartAxis.synchronizeHover('test-cumulative-hover');
});
assert.equal(await page.locator('.concentration-cumulative-legend').count(),0);
assert.match(await page.locator('#lsConcentrationTooltip').innerText(),/당일 누적 40.0%/);
assert.ok(await page.evaluate(()=>window.cumulativeStrokes>0));
assert.equal(await page.locator('#lsConcentrationChartPanel .concentration-current-cumulative').innerText(),'누적 50.0%');
const valueRows=await page.locator('#lsConcentrationChartPanel').evaluate(e=>{const a=e.querySelector('#lsConcentrationCurrentRate').getBoundingClientRect(),b=e.querySelector('.concentration-current-cumulative').getBoundingClientRect();return {firstBottom:a.bottom,secondTop:b.top,position:getComputedStyle(e.querySelector('.chart-value-with-date')).position,date:e.querySelector('.concentration-value-date').textContent};});
assert.ok(valueRows.secondTop>=valueRows.firstBottom);assert.equal(valueRows.position,'absolute');assert.ok(!valueRows.date.includes(':'));
await page.locator('#lsConcentrationChartPanel').screenshot({path:'dev/output/ls-concentration-cumulative.png'});
assert.deepEqual(errors,[]);console.log('Full page: 18 cards in 3 columns, aligned plot heights/start, footer containment, shared candle toggle passed.');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
