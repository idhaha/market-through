const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const stocks=[{code:'005930',name:'Stock A'},{code:'000660',name:'Stock B'}],retired={code:'051910',name:'Retired stock'},outside={code:'035420',name:'Outside stock'};
  const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  const t=Date.parse('2026-10-30T09:00:00+09:00'),p={t,date:'2026-10-30',open:100,high:110,low:90,close:105};
  await page.route('http://sync.test/**',route=>{
   const u=new URL(route.request().url());
   if(!u.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks,archive:[...stocks,retired],revision:1}});
   if(u.pathname==='/api/concentration-stock')return route.fulfill({json:{success:true,stock:[...stocks,retired,outside].find(s=>s.code===u.searchParams.get('q'))}});
   if(u.pathname==='/api/concentration-stocks')return route.fulfill({json:{success:true,stocks:[]}});
   if(u.pathname.startsWith('/api/risk/'))return route.fulfill({json:{success:true,dates:['2026-10-30'],series:Object.fromEntries(['highs','lows','vix','vkospi','fear-greed','high-yield-spread'].map(id=>[id,{points:[{date:'2026-10-30',value:20}]}])),has_more:false}});
   if(u.pathname.includes('concentration-chart')){
    const input=route.request().postDataJSON();return route.fulfill({json:{success:true,market:'K',points:[{time:input.mode==='day'?'20261030':'20261030090000',value:25,stock_price:105,stock_open:100,stock_high:110,stock_low:90}],has_more:false}});
   }
   return route.fulfill({json:{success:true,points:[{...p,foreign:100,individual:-100,institution:0}],candles:[p],warnings:[],has_more:false,date:'2026-10-30'}});
  });
  await page.goto('http://sync.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
  for(const f of ['rank-chart-axis.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js'])await page.addScriptTag({path:'public/'+f});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.waitForFunction(()=>getRankCombinedSupplyState().config.stocks.length===2);
  await page.evaluate(()=>{window.selectionEvents=0;for(const name of ['rank-stock-supply-selection','rank-concentration-selection'])document.addEventListener(name,()=>window.selectionEvents++);});
  const selected=()=>page.evaluate(()=>({concentration:getCombinedRankChartState().selection?.code,supply:getRankCombinedSupplyState().selected}));
  await page.locator('#rankCombinedSupplyChartPanel .supply-stock-select').selectOption('000660');
  await page.waitForFunction(()=>getCombinedRankChartState().selection?.code==='000660');
  assert.deepEqual(await selected(),{concentration:'000660',supply:'000660'});
  async function enter(code){await page.locator('#combinedConcentrationStockName').fill(code);await page.locator('#combinedConcentrationStockName').press('Enter');await page.waitForFunction(code=>getCombinedRankChartState().selection?.code===code,code);}
  await enter('005930');assert.deepEqual(await selected(),{concentration:'005930',supply:'005930'});
  await enter('051910');assert.deepEqual(await selected(),{concentration:'051910',supply:'005930'},'Archived-only stock must not change the current supply selection');
  await enter('035420');assert.deepEqual(await selected(),{concentration:'035420',supply:'005930'});
  await page.evaluate(()=>{document.getElementById('transactionBody').innerHTML=[{stk_cd:'000660',stk_nm:'Stock B'},{stk_cd:'035420',stk_nm:'Outside stock'},{stk_cd:'005930',stk_nm:'Stock A'}].map(s=>`<tr ${rankChartRowAttributes(s)}><td>${s.stk_nm}</td></tr>`).join('');});
  await page.locator('#transactionBody [data-chart-code="000660"]').click();assert.deepEqual(await selected(),{concentration:'000660',supply:'000660'});
  await page.locator('#transactionBody [data-chart-code="035420"]').click();assert.deepEqual(await selected(),{concentration:'035420',supply:'000660'});
  await page.locator('#transactionBody [data-chart-code="005930"]').press('Enter');assert.deepEqual(await selected(),{concentration:'005930',supply:'005930'});
  assert.equal(await page.evaluate(()=>window.selectionEvents),8,'Selection events must not echo in a loop');
  assert.deepEqual(errors,[]);console.log('Supply -> concentration; concentration/table -> active supply list only; archived/unlisted stocks, keyboard and event loop checks passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
