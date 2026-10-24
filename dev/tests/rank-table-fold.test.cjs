const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
test('main table stages synchronize, survive replacement, and stay out of independent page',async()=>{
 const browser=await chromium.launch({headless:true, channel:'chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  let html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  await page.setContent(html);
  await page.addStyleTag({path:'public/style.css'});
  await page.evaluate(()=>{
   document.getElementById('loginOverlay').remove();
   document.getElementById('tabContents').style.display='block';
   document.getElementById('tab_rank').classList.add('active');
   for(const id of ['dataContainer','efriendDataContainer','watchlistRankPanel'])document.getElementById(id).style.display='block';
   for(const id of ['transactionBody','tableBody','efriendTableBody','watchlistBody'])document.getElementById(id).innerHTML=Array.from({length:20},(_,i)=>`<tr><td>${i+1}</td><td>K</td><td>종목</td><td>1%</td><td>100</td><td>2%</td></tr>`).join('');
  });
  await page.addScriptTag({path:'public/rank-table-fold.js'});
  assert.equal(await page.locator('.main-rank-row-limit').count(),4);
  const counts=()=>page.evaluate(()=>['transactionBody','tableBody','efriendTableBody','watchlistBody'].map(id=>[...document.getElementById(id).children].filter(row=>getComputedStyle(row).display!=='none').length));
  assert.deepEqual(await counts(),[20,20,20,20]);
  await page.locator('.main-rank-row-limit').nth(0).click();assert.deepEqual(await counts(),[10,10,10,10]);
  await page.locator('.main-rank-row-limit').nth(1).click();assert.deepEqual(await counts(),[5,5,5,5]);
  await page.evaluate(()=>{const body=document.getElementById('efriendTableBody');body.innerHTML=body.innerHTML;});assert.deepEqual(await counts(),[5,5,5,5]);
  await page.locator('.main-rank-row-limit').nth(2).click();assert.deepEqual(await counts(),[20,20,20,20]);
  await page.setContent('<body class="rank-independent"><div id="tab_rank"></div></body>');
  await page.addScriptTag({path:'public/rank-table-fold.js'});assert.equal(await page.locator('.main-rank-row-limit').count(),0);
 } finally {await browser.close();}
});
