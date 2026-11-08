const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
// 52주 신고/신저 card: the server's basis note used to sit in the header and pushed the market radio buttons onto
// separate lines and cut the title. It now lives in the i guide ("원천 자료 참고"), and the header keeps one row.
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1920,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const notice='KOSPI+KOSDAQ · 보통주 · KRX+NXT 통합 · 2026-11-06까지 일봉 계산, 이후 키움 집계';
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 await page.route('http://breadth-note.test/**',route=>{const u=new URL(route.request().url());
  if(u.pathname==='/api/risk/breadth')return route.fulfill({json:{mode:'day',market:'all',dates:['2026-11-05','2026-11-06'],candles:[],series:{highs:{points:[{date:'2026-11-05',value:3},{date:'2026-11-06',value:6}]},lows:{points:[{date:'2026-11-05',value:-500},{date:'2026-11-06',value:-559}]}},cursor:null,has_more:false,notice}});
  if(u.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:[],series:{},dates:[],markets:{kospi:[],kosdaq:[]},stocks:[],archive:[],candles:[],warnings:[]}});
  return route.fulfill({contentType:'text/html',body:html});});
 await page.goto('http://breadth-note.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
 await page.evaluate(()=>{window.saveAppData=()=>{};});
 for(const f of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-adr-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+f});
 await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 const panel=page.locator('#rankBreadthChartPanel');await panel.waitFor();
 await page.waitForFunction(()=>/현재 조회 기준/.test(document.querySelector('#rankBreadthChartPanelGuide [data-loading-notes="day"]')?.textContent||''));
 assert.equal(await panel.locator('.breadth-notice').count(),0,'No note in the header');
 assert.equal((await panel.locator('.concentration-chart-header').innerText()).includes('보통주'),false);
 const radios=await panel.locator('.concentration-chart-header input[type=radio]').evaluateAll(list=>list.map(r=>Math.round(r.getBoundingClientRect().top)));
 assert.ok(radios.length>=3,'market radios '+radios);assert.equal(new Set(radios).size,1,'Market radios stay on one row: '+radios);
 assert.equal(await panel.locator('h2').evaluate(h=>h.scrollWidth<=h.clientWidth),true,'Title is not cut');
 // Market radios on every card show KSP/KDQ to save space; tooltip, screen reader name and callers keep the full name.
 const labels=await page.locator('#tab_rank .rank-market-choice label').evaluateAll(list=>list.map(l=>({text:l.textContent.trim(),title:l.title,aria:l.querySelector('input').getAttribute('aria-label')})));
 assert.ok(labels.length>=7,'radio labels '+labels.length);
 assert.deepEqual(labels.filter(l=>/KOSPI|KOSDAQ/.test(l.text)),[],'No long market names on the radios');
 for(const l of labels.filter(l=>/KSP|KDQ/.test(l.text)))assert.equal(l.title,l.text.replace(/KSP/g,'KOSPI').replace(/KDQ/g,'KOSDAQ'),JSON.stringify(l));
 assert.deepEqual(await panel.locator('.rank-market-choice label').allTextContents(),['KSP','KDQ','KSP+KDQ']);
 assert.equal(await panel.locator('.rank-market-choice').evaluate(g=>g.selectedOptions[0].textContent),'KOSPI','Callers still read the full name');
 await panel.locator('.supply-info-button').click();
 const day=await page.locator('#rankBreadthChartPanelGuide [role=tabpanel]:not([hidden])').textContent();
 assert.ok(day.includes('현재 조회 기준: '+notice),'The note is in the guide');
 assert.match(day,/~2026-11-06: 키움 ka10081 종목별 일봉으로 계산/);assert.match(day,/2026-11-09~: 키움 ka10016 마감 목록 중 보통주/);assert.match(day,/시장 범위: 보통주 · KRX\+NXT 통합/);
 assert.deepEqual(errors,[]);console.log('PASS breadth card: basis note moved into the i guide, header radios on one row, title not cut');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
