const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
// Trading tab: i guides on the 거래대금 상위 / 실시간 조회 순위 / 대주가능 tables (i at the right end of each header)
// and the 대주 "매매수량 없는 종목도 보기" toggle (default on, remembered).
(async()=>{
 const source=fs.readFileSync('public/app.js','utf8').replace(/\r\n/g,'\n');
 const slice=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,from);return source.slice(a,b);};
 const efriend=slice('// "매매수량 없는 종목도 보기"','/**\n * Transaction Rank');
 const guides=slice('// i guides of the trading tables','rankQuerySelect?.addEventListener');
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:2000,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://tables.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('http://tables.test/');
  await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}#efriendDataContainer{display:block!important}'});
  const run=async()=>page.addScriptTag({content:`window.rankChartRowAttributes=()=>'';const formatNumber=n=>Number(n).toLocaleString('ko-KR');const formatChangeRate=r=>r+'%';const getPriceClass=()=>'';\n${efriend}\n${guides}\nwindow.renderEfriendTable=renderEfriendTable;`});
  await run();
  const stocks=[{pdno:'000001',prdt_name:'수량있음',prdy_ctrt:'1.0',stck_prpr:'1000',trad_psbl_qty2:'10'},{pdno:'000002',prdt_name:'수량없음',prdy_ctrt:'2.0',stck_prpr:'500',trad_psbl_qty2:'0',no_quantity:true}];
  await page.evaluate(stocks=>renderEfriendTable(stocks),stocks);
  const names=()=>page.locator('#efriendTableBody tr td:nth-child(3)').allTextContents();
  // Inter draws 211 narrower than 209, so right-aligned ranks looked uneven: every table cell uses fixed-width digits.
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('td,th')].filter(c=>!getComputedStyle(c).fontVariantNumeric.includes('tabular')).length),0,'All table cells use tabular digits');
  assert.equal(await page.locator('#efriendShowZero').isChecked(),true,'Default: show zero-quantity stocks');
  assert.deepEqual(await names(),['수량없음','수량있음']);assert.equal(await page.locator('#efriendStockCount').textContent(),'(2개)');
  await page.locator('#efriendShowZero').uncheck();
  assert.deepEqual(await names(),['수량있음'],'Unchecking hides stocks with no lendable quantity');assert.equal(await page.locator('#efriendStockCount').textContent(),'(1개)');
  // A new refresh keeps the choice, and a reload restores it.
  await page.evaluate(stocks=>renderEfriendTable(stocks),stocks);assert.deepEqual(await names(),['수량있음']);
  assert.equal(await page.evaluate(()=>localStorage.getItem('efriendShowZero')),'false');
  // i buttons: last control at the right end of each header, opening their own guide.
  for(const [table,guide,text] of [['transactionTable','transactionGuide','ka10032'],['stockTable','rankQueryGuide','ka00198'],['efriendStockTable','efriendGuide','CTSC2702R']]){
   const panel=page.locator('.panel').filter({has:page.locator('#'+table)});
   const button=panel.locator('.panel-header .chart-info-button');
   assert.equal(await button.count(),1,table);
   assert.ok(await button.evaluate(b=>!b.nextElementSibling&&b.parentElement.matches('.panel-controls')),table+': i is the last header control');
   const right=await button.evaluate(b=>[b.getBoundingClientRect().right,b.closest('.panel').getBoundingClientRect().right]);
   assert.ok(right[1]-right[0]<40,table+' i sits at the right edge '+right);
   await button.click();assert.equal(await page.locator('#'+guide).isVisible(),true);assert.match(await page.locator('#'+guide).textContent(),new RegExp(text));
   await page.keyboard.press('Escape');assert.equal(await page.locator('#'+guide).isVisible(),false);
  }
  assert.ok(await page.locator('#rankQueryTp').evaluate(select=>select.nextElementSibling.matches('.rank-query-info-button')),'The ranking i comes after its dropdown');
  assert.deepEqual(errors,[]);
  console.log('PASS trading table i guides at the header right, ranking i after its dropdown, lendable zero-quantity toggle (default on, remembered)');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
