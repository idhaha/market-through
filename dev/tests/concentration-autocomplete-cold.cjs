const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  let release,calls=0;const gate=new Promise(resolve=>release=resolve);
  const service=require('../../concentration-chart').createConcentrationChartService({marketCache:{},getAccessToken:async()=>'',pause:async()=>{},axios:{post:async(url,body)=>{
   calls++;await gate;return {data:{list:body.mrkt_tp==='0'?[{stk_cd:'005930',stk_nm:'삼성전자',marketCode:'0'}]:[{stk_cd:'000660',stk_nm:'다른종목',marketCode:'10'}]},headers:{}};
  }}});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  await page.route('http://autocomplete.test/**',async route=>{
   const u=new URL(route.request().url());
   if(!u.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/api/concentration-stocks')return route.fulfill({json:{success:true,stocks:await service.searchStocksReady(u.searchParams.get('q'))}});
   return route.fulfill({json:{success:true,market:'K',points:[{time:'20261030',value:25,stock_price:105,stock_open:100,stock_high:110,stock_low:90}],has_more:false}});
  });
  await page.goto('http://autocomplete.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
  for(const f of ['rank-chart-axis.js','concentration-chart.js'])await page.addScriptTag({path:'public/'+f});await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  const input=page.locator('#combinedConcentrationStockName');await input.fill('삼');
  while(!calls)await new Promise(resolve=>setTimeout(resolve,10));
  await input.fill('삼성');release();
  const option=page.locator('#combinedConcentrationStockSuggestions [role=option]');
  await option.waitFor({state:'visible'});assert.match(await option.innerText(),/삼성전자.*005930/);
  await input.press('ArrowDown');await input.press('Enter');
  await page.waitForFunction(()=>getCombinedRankChartState().selection?.code==='005930');
  assert.equal(calls,2);assert.deepEqual(errors,[]);console.log('Cold Korean autocomplete waits for one shared master load, displays suggestions and supports keyboard selection without retyping.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
