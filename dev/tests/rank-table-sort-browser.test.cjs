const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
// Trading tab tables sort like the VI window (desc → asc → original), keep the sort when the app re-renders,
// and the watchlist card sits visible at the bottom of the trading tab.
test('trading tables sort every column but 순위, keep the sort across refreshes, and the watchlist card is at the bottom',async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1800,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  await page.route('http://market-page.test/**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('http://market-page.test/');
  await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
  // Rows as app.js renders them: 순위, 시장, 종목명, 등락률, 거래대금(백만), 쏠림율.
  const render=rows=>page.evaluate(rows=>{document.getElementById('transactionTable').tBodies[0].innerHTML=rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('');},rows);
  const data=[['1','K','삼성전자','+1.20%','10,439,757','38%'],['2','K','SK하이닉스','-6.96%','13,585,997','49%'],['3','Q','에코프로','+12.50%','820,000','-'],['4','K','두산에너빌리티','0.00%','1,200,500','4%']];
  await render(data);
  await page.addScriptTag({content:fs.readFileSync('public/rank-table-sort.js','utf8')});
  const names=()=>page.locator('#transactionTable tbody tr td:nth-child(3)').allTextContents();
  const icons=()=>page.evaluate(()=>[...document.querySelectorAll('#transactionTable thead th')].map(th=>th.querySelector('.rank-sort-button')?(th.querySelector('circle')?'dot':'arrows')+':'+th.getAttribute('aria-sort'):'none'));
  assert.deepEqual(await icons(),['none','arrows:none','arrows:none','arrows:none','arrows:none','arrows:none'],'순위 has no sort; all others show arrows');
  const click=name=>page.locator('#transactionTable thead').getByRole('button',{name,exact:true}).click();
  await click('등락률');
  assert.deepEqual(await names(),['에코프로','삼성전자','두산에너빌리티','SK하이닉스'],'descending change rate, signed');
  assert.deepEqual(await icons(),['none','dot:none','dot:none','arrows:descending','dot:none','dot:none']);
  await click('등락률');assert.deepEqual(await names(),['SK하이닉스','두산에너빌리티','삼성전자','에코프로'],'ascending');
  await click('등락률');assert.deepEqual(await names(),['삼성전자','SK하이닉스','에코프로','두산에너빌리티'],'third click: original order');
  assert.deepEqual(await icons(),['none','arrows:none','arrows:none','arrows:none','arrows:none','arrows:none']);
  await click('거래대금(백만)');assert.deepEqual(await names(),['SK하이닉스','삼성전자','두산에너빌리티','에코프로'],'thousands separators sort as numbers');
  // An automatic refresh rewrites the rows; the chosen sort is applied again.
  await render([...data].reverse().map(r=>r[2]==='에코프로'?[...r.slice(0,4),'99,000,000',r[5]]:r));
  await page.waitForFunction(()=>document.querySelector('#transactionTable tbody td:nth-child(3)').textContent==='에코프로');
  assert.deepEqual(await names(),['에코프로','SK하이닉스','삼성전자','두산에너빌리티']);
  await click('거래대금(백만)');await click('쏠림율');assert.equal((await names()).at(-1),'에코프로','A "-" cell goes last');
  await click('종목명');await click('종목명');assert.deepEqual(await names(),['두산에너빌리티','삼성전자','에코프로','SK하이닉스'],'Korean collation ascending');
  // A message row (colspan) is left alone.
  await page.evaluate(()=>{document.getElementById('transactionTable').tBodies[0].innerHTML='<tr><td colspan="6">데이터가 없습니다.</td></tr>';});
  assert.equal(await page.locator('#transactionTable tbody tr').count(),1);
  for(const id of ['stockTable','efriendStockTable'])assert.ok(await page.locator(`#${id} thead .rank-sort-button`).count()>=4,id);
  assert.equal(await page.locator('#watchlistTable thead .rank-sort-button').count(),0,'Only the three tables');
  // Watchlist card: visible, after the chart row, inside the trading tab.
  const card=await page.evaluate(()=>{const p=document.getElementById('watchlistRankPanel'),charts=document.querySelector('#tab_rank .rank-chart-row');
   return {visible:getComputedStyle(p).display!=='none'&&p.getBoundingClientRect().height>0,after:!!(charts.compareDocumentPosition(p)&Node.DOCUMENT_POSITION_FOLLOWING),inTab:!!p.closest('#tab_rank'),below:p.getBoundingClientRect().top>=charts.getBoundingClientRect().bottom};});
  assert.deepEqual(card,{visible:true,after:true,inTab:true,below:true});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
