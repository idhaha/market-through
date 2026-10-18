const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page = await browser.newPage({viewport:{width:1400,height:850}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<div class="tab-container">Toolbar</div><div id="tabContents" class="tab-contents"><div class="tab-content active" id="tab_rank"><div class="container"><header><h1>Trading</h1><div class="status-info">Loading</div></header><div class="grid-container" style="height:2000px">Content</div></div></div></div>');
  await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')});
  await page.addScriptTag({content:fs.readFileSync('public/tab-scroll-layout.js','utf8')});
  const header=page.locator('header'), before=await header.boundingBox();
  await page.locator('.tab-scroll-body').evaluate(el=>el.scrollTop=500);
  assert.equal((await header.boundingBox()).y,before.y);
  assert.equal(await page.locator('.tab-scroll-body').evaluate(el=>el.scrollTop),500);
  assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),0);
  await page.evaluate(()=>{document.querySelector('.container').innerHTML='<header><h1>Reloaded</h1></header><div class="status-info">Loading again</div><div style="height:1800px;flex-shrink:0">Rows</div>';});
  await page.waitForFunction(()=>document.querySelector('header .status-info') && document.querySelectorAll('.tab-scroll-body').length===1);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS fixed title/status, content-only scroll and dynamic tab reload');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
