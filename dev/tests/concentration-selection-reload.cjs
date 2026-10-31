const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage(),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
  const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  await page.route('http://selection.test/**',route=>{
   const url=new URL(route.request().url());
   if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:html});
   const input=route.request().postDataJSON();calls.push({...input,path:url.pathname});
   return route.fulfill({json:{success:true,market:'K',mode:input.mode,points:[{time:input.mode==='day'?'20261030':'20261030090000',value:input.prices_only?null:25,stock_price:105,stock_open:100,stock_high:110,stock_low:90}],has_more:false}});
  });
  async function boot(ready=true){
   await page.goto('http://selection.test/');
   await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
   await page.evaluate(ready=>{window.supplyReady=ready;window.getRankCombinedSupplyState=()=>({selected:'005930',config:{archive:window.supplyReady?[{code:'005930',name:'Supply stock'}]:[]}});},ready);
   for(const file of ['rank-chart-axis.js','concentration-chart.js'])await page.addScriptTag({path:'public/'+file});
   await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  }
  await boot();
  await page.evaluate(()=>{selectRankChartStock({code:'000660',name:'Chosen stock',market:'K'});applyConcentrationDisplaySettings({mode:'day',candleOpen:true});});
  await page.waitForFunction(()=>getCombinedRankChartState().points.some(p=>p.value===25)&&!getCombinedRankChartState().busy);
  const saved=await page.evaluate(()=>getConcentrationDisplaySettings());assert.equal(saved.selection.code,'000660');
  await boot();await page.evaluate(settings=>applyConcentrationDisplaySettings(settings),saved);
  await page.locator('#combinedConcentrationChartPanel [data-chart-mode="minute"]').click();
  await page.waitForFunction(()=>getCombinedRankChartState().mode==='minute'&&getCombinedRankChartState().points.some(p=>p.value===25)&&!getCombinedRankChartState().busy);
  assert.equal(await page.evaluate(()=>getCombinedRankChartState().selection.code),'000660');
  assert.ok(calls.some(c=>c.code==='000660'&&c.mode==='minute'&&c.path==='/api/ls-concentration-chart'));
  await page.evaluate(()=>localStorage.removeItem('combinedConcentrationSelectedStockV1'));
  await boot();await page.evaluate(()=>applyConcentrationDisplaySettings({mode:'day',candleOpen:true}));
  await page.locator('#combinedConcentrationChartPanel [data-chart-mode="minute"]').click();
  assert.equal(await page.evaluate(()=>getCombinedRankChartState().selection),null,'Supply card selection must not preempt the first transaction-rank stock');
  // loadTransactionRank calls this after its first item arrives.
  await page.evaluate(()=>selectRankChartStock({code:'000660',name:'First rank stock',market:'K'}));
  await page.waitForFunction(()=>getCombinedRankChartState().mode==='minute'&&getCombinedRankChartState().points.some(p=>p.value===25)&&!getCombinedRankChartState().busy);
  assert.equal(await page.evaluate(()=>getCombinedRankChartState().selection.code),'000660');
  await page.evaluate(()=>localStorage.removeItem('combinedConcentrationSelectedStockV1'));
  await boot(false);await page.evaluate(()=>applyConcentrationDisplaySettings({mode:'day',candleOpen:true}));
  await page.locator('#combinedConcentrationChartPanel [data-chart-mode="minute"]').click();
  assert.equal(await page.evaluate(()=>getCombinedRankChartState().selection),null);
  await page.evaluate(()=>{window.supplyReady=true;document.dispatchEvent(new CustomEvent('rank-combined-supply-state'));});
  assert.equal(await page.evaluate(()=>getCombinedRankChartState().selection),null,'Late supply loading cannot change concentration selection');
  await page.evaluate(()=>selectRankChartStock({code:'000660',name:'First rank stock',market:'K'}));
  await page.waitForFunction(()=>getCombinedRankChartState().selection?.code==='000660'&&getCombinedRankChartState().points.some(p=>p.value===25)&&!getCombinedRankChartState().busy);
  assert.deepEqual(errors,[]);console.log('Daily reload -> minute: saved selection restores; without saved selection, transaction-rank selection remains authoritative.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
