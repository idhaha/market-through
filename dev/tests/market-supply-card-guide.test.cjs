const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
// Both 시장 (선물) 수급 cards on the trading tab have the i guide with their spot and futures sources.
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:2400,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 await page.route('http://market-guide.test/**',route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:[],series:{},dates:[],markets:{kospi:[],kosdaq:[]},stocks:[],archive:[],candles:[],warnings:[]}});return route.fulfill({contentType:'text/html',body:html});});
 await page.goto('http://market-guide.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
 await page.evaluate(()=>{window.saveAppData=()=>{};});
 for(const f of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+f});
 await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 for(const id of ['rankTestMarketSupplyChartPanel','rankTestMarketSupplySecondaryChartPanel']){
  await page.waitForSelector('#'+id);
  const panel=page.locator('#'+id),button=panel.locator('.supply-info-button');
  assert.equal(await button.count(),1,id+' has an i button');
  await button.click();
  const guide=page.locator('#'+id+'Guide');assert.equal(await guide.isVisible(),true);
  await guide.getByRole('tab',{name:'일봉'}).click();
  const day=await guide.locator('[role=tabpanel]:not([hidden])').textContent();
  assert.match(day,/LS t1665/);assert.match(day,/LS t8462/);assert.match(day,/억원/);
  await guide.getByRole('tab',{name:'1분봉'}).click();
  const minute=await guide.locator('[role=tabpanel]:not([hidden])').textContent();
  assert.match(minute,/키움 ka10051/);assert.match(minute,/LS t8463\(야간\)/);assert.match(minute,/FHPTJ04030000/);
  await page.keyboard.press('Escape');await button.click();await page.mouse.click(5,5);
 }
 // The guide editor (double-click i) opens in the middle of the window; the global * { margin:0 } reset used to pin it top-left.
 const editorButton=page.locator('#rankTestMarketSupplyChartPanel .supply-info-button');await editorButton.dblclick();
 const editor=page.locator('dialog.chart-guide-editor');await editor.waitFor();
 const box=await editor.evaluate(el=>{const r=el.getBoundingClientRect();return{center:Math.round(r.left+r.width/2-innerWidth/2),middle:Math.abs(r.top+r.height/2-innerHeight/2)<2};});
 assert.deepEqual(box,{center:0,middle:true},JSON.stringify(box));await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);console.log('PASS market supply cards: i guide with spot and futures day/minute sources');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
