const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
// Minute turnover compares each day's cumulative amount with the average of the 5 trading days before that day (today excluded).
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 const at=(day,time)=>Date.parse(`${day}T${time}:00+09:00`),T=1e12;
 const run=async({dailyDays})=>{
  const page=await browser.newPage({viewport:{width:2000,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const daily={kospi:[['2026-10-27',10],['2026-10-28',12],['2026-10-29',14],['2026-10-30',16],['2026-11-02',18],['2026-11-03',20],['2026-11-04',5]],
   kosdaq:[['2026-10-27',9],['2026-10-28',5],['2026-10-29',5],['2026-10-30',5],['2026-11-02',5],['2026-11-03',5],['2026-11-04',1]]};
  const minute={kospi:[['2026-11-03','09:00',7],['2026-11-04','09:00',2],['2026-11-04','09:01',4],['2026-11-04','09:02',8]],
   kosdaq:[['2026-11-03','09:00',2],['2026-11-04','09:00',1],['2026-11-04','09:01',2],['2026-11-04','09:02',3]]};
  await page.route('http://turnover-average.test/**',route=>{const url=new URL(route.request().url());
   if(url.pathname==='/api/turnover/chart')return route.fulfill({json:{success:true,markets:Object.fromEntries(Object.entries(daily).map(([m,rows])=>[m,rows.slice(-dailyDays).map(([d,v])=>({t:at(d,'09:00'),market_turnover:v*T}))])),warnings:[],cursor:null,has_more:false}});
   if(url.pathname==='/api/ls-turnover/chart')return route.fulfill({json:{success:true,markets:Object.fromEntries(Object.entries(minute).map(([m,rows])=>[m,rows.map(([d,time,v])=>({t:at(d,time),market_turnover:v*T}))])),warnings:[],cursor:null,has_more:false}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{points:[],series:[],markets:{kospi:[],kosdaq:[]},cursor:null}});
   return route.fulfill({contentType:'text/html',body:html});});
  await page.goto('http://turnover-average.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
  await page.evaluate(()=>{const now=Date.parse('2026-11-04T09:03:00+09:00');Date.now=()=>now;window.saveAppData=()=>{};window.guideLabels=[];
   const text=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(label,...args){if(this.canvas.closest('#rankCombinedTurnoverChartPanel .rank-adr-area')&&/평균|전일/.test(String(label)))window.guideLabels.push(String(label));return text.call(this,label,...args);};});
  for(const file of ['rank-chart-axis.js','rank-turnover-chart.js'])await page.addScriptTag({path:'public/'+file});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  const panel=page.locator('#rankCombinedTurnoverChartPanel');
  await panel.locator('[data-mode="minute"]').click();
  await page.waitForFunction(()=>getRankCombinedTurnoverState().mode==='minute'&&getRankCombinedTurnoverState().markets.kospi.length===4&&!getRankCombinedTurnoverState().loading);
  await page.waitForTimeout(200);
  // Show both sessions so the previous day can be hovered too.
  await page.evaluate(()=>window.RankChartAxis.showHistory());await page.evaluate(()=>refreshRankCombinedTurnoverChart());await page.waitForTimeout(200);
  const hover=async fraction=>{const canvas=panel.locator('.rank-adr-area canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();
   const left=16,right=box.width-58;await page.mouse.move(box.x+left+(right-left)*fraction,box.y+80);return panel.locator('.turnover-hover-info').textContent();};
  return {page,errors,hover,panel};
 };
 let {page,errors,hover,panel}=await run({dailyDays:7});
 const latest=await hover(1);
 assert.match(latest,/2026-11-04 09:02/,latest);
 // KOSPI 8조 ÷ avg(12,14,16,18,20)=16조; KOSDAQ 3조 ÷ 5조. Today's partial daily value is not in the average.
 assert.match(latest,/KOSPI 8\.0조원\(5일평균대비 50\.0%\)/,latest);
 assert.match(latest,/KOSDAQ 3\.0조원\(5일평균대비 60\.0%\)/,latest);
 assert.ok(await page.evaluate(()=>window.guideLabels.includes('5일평균 16.0조')),JSON.stringify(await page.evaluate(()=>window.guideLabels.slice(-3))));
 const earlier=await hover(0);
 // 11/03 compares with the 5 days before 11/03: avg(10,12,14,16,18)=14조 and avg(9,5,5,5,5)=5.8조.
 assert.match(earlier,/2026-11-03 09:00/,earlier);
 assert.match(earlier,/KOSPI 7\.0조원\(5일평균대비 50\.0%\)/,earlier);
 assert.match(earlier,/KOSDAQ 2\.0조원\(5일평균대비 34\.5%\)/,earlier);
 await panel.locator('[data-mode="day"]').click();
 await page.waitForFunction(()=>getRankCombinedTurnoverState().mode==='day'&&!getRankCombinedTurnoverState().loading);
 assert.doesNotMatch(await hover(1),/5일평균/,'Daily view has no average comparison');
 assert.deepEqual(errors,[]);await page.close();
 // With fewer than 5 earlier trading days there is no average line or ratio.
 ({page,errors,hover,panel}=await run({dailyDays:4}));
 const short=await hover(1);
 assert.match(short,/KOSPI 8\.0조원/);assert.doesNotMatch(short,/5일평균/);
 assert.equal(await page.evaluate(()=>window.guideLabels.length),0);
 assert.deepEqual(errors,[]);await page.close();
 console.log('PASS minute turnover 5-day average line and hover ratio per session day, today excluded, hidden in day view and with too few days');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
