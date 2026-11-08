const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
// ADR keeps its saved day/minute interval after a reload, and still follows (and drives) the shared interval of other charts.
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 const open=async()=>{
  const page=await browser.newPage({viewport:{width:2000,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://adr-mode.test/**',route=>{const url=new URL(route.request().url());
   if(url.pathname==='/api/concentration-chart'||url.pathname==='/api/ls-concentration-chart')return route.fulfill({json:{success:true,market:'K',points:[],has_more:false}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{points:[],series:[],intraday:[],markets:{kospi:[],kosdaq:[]},cursor:null}});
   return route.fulfill({contentType:'text/html',body:html});});
  await page.goto('http://adr-mode.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
  await page.evaluate(()=>{window.saves=0;window.saveAppData=()=>window.saves++;});
  for(const file of ['rank-chart-axis.js','concentration-chart.js','rank-adr-chart.js'])await page.addScriptTag({path:'public/'+file});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  return {page,errors};
 };
 const active=(page,selector)=>page.locator(selector+'.active').count();
 // Saved minute (as app.js restores rankChartDisplay after a reload).
 let {page,errors}=await open();
 assert.equal(await active(page,'#rankAdrChartPanel [data-adr-mode="day"]'),1,'A fresh page opens ADR in day mode');
 await page.evaluate(()=>applyConcentrationDisplaySettings({mode:'minute',adrMode:'minute',candleOpen:false}));
 assert.equal(await active(page,'#rankAdrChartPanel [data-adr-mode="minute"]'),1,'Saved minute interval is restored');
 assert.equal(await page.evaluate(()=>getConcentrationDisplaySettings().adrMode),'minute','The interval is part of the saved display settings');
 // Restoring must not click other charts' buttons (no sync round trip during startup).
 assert.equal(await page.evaluate(()=>window.saves),0);
 // Shared sync still works in both directions after the restore.
 await page.locator('#combinedConcentrationChartPanel [data-chart-mode="day"]').click();
 await page.waitForFunction(()=>document.querySelector('#rankAdrChartPanel [data-adr-mode="day"]').classList.contains('active'));
 await page.locator('#rankAdrChartPanel [data-adr-mode="minute"]').click();
 await page.waitForFunction(()=>getConcentrationDisplaySettings().mode==='minute');
 assert.equal(await page.evaluate(()=>getConcentrationDisplaySettings().adrMode),'minute');
 assert.deepEqual(errors,[]);await page.close();
 // Saved day stays day.
 ({page,errors}=await open());
 await page.evaluate(()=>applyConcentrationDisplaySettings({mode:'day',adrMode:'day'}));
 assert.equal(await active(page,'#rankAdrChartPanel [data-adr-mode="day"]'),1);
 assert.deepEqual(errors,[]);await page.close();
 // A save from before adrMode existed follows the shared chart interval.
 ({page,errors}=await open());
 await page.evaluate(()=>applyConcentrationDisplaySettings({mode:'minute'}));
 assert.equal(await active(page,'#rankAdrChartPanel [data-adr-mode="minute"]'),1,'Old saves follow the shared interval');
 assert.deepEqual(errors,[]);await page.close();
 console.log('PASS ADR restores its saved day/minute interval, old saves follow the shared interval, and mode sync works both ways');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
