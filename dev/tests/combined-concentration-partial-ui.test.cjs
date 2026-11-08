const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
// The combined concentration card (Kiwoom day / LS minute) keeps price candles when the amount side fails,
// shows the server notice, and returns to real ratios on the next refresh.
test('combined concentration keeps candles when LS amount requests fail and recovers actual ratios', {timeout:60000}, async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../public/index.html'),'utf8');
 const start=source.indexOf('<section class="panel concentration-chart-panel"');
 const panel=source.slice(start,source.indexOf('</section>',start)+10);
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:2100,height:1400}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',request=>request.fulfill({contentType:'text/html',body:`<div id="tab_rank"><div class="rank-chart-row">${panel}</div></div>`}));
  await page.goto('http://combined.test/');
  await page.addStyleTag({path:path.resolve(__dirname,'../../public/style.css')});
  await page.evaluate(()=>{
   window.requests=[];window.failLs=false;window.saveAppData=()=>{};Date.now=()=>Date.parse('2026-10-23T07:00:00Z');
   window.fetch=async(url,options)=>{const input=JSON.parse(options.body);window.requests.push({url,input});
    const ls=url.includes('ls-');
    const points=Array.from({length:60},(_,i)=>({time:input.mode==='day'?new Date(Date.UTC(2026,6,1)+i*86400000).toISOString().slice(0,10).replaceAll('-',''):`2026102314${String(i).padStart(2,'0')}00`,value:ls?12+i/100:20+i/100,stock_open:200,stock_high:210,stock_low:190,stock_price:205,stock_change_rate:2.5}));
    const failed=window.failLs&&ls;
    return{ok:true,json:async()=>({success:true,market:'K',mode:input.mode,interval:1,points:failed?points.map(p=>({...p,value:null})):points,partial:failed,notice:failed?'LS 모의 오류 · 가격 캔들은 표시합니다.':'',cursor:'cursor',has_more:false})};
   };
  });
  for(const file of ['rank-connection-status.js','rank-chart-axis.js','concentration-chart.js'])await page.addScriptTag({path:path.resolve(__dirname,'../../public',file)});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  assert.equal(await page.$eval('#combinedConcentrationChartPanel h2',e=>e.textContent),'쏠림율');
  await page.evaluate(()=>window.selectRankChartStock({code:'005930',name:'삼성전자',market:'K'}));
  await page.waitForFunction(()=>window.getCombinedRankChartState?.().points.length===60&&!window.getCombinedRankChartState().busy);
  assert.equal(await page.$eval('#combinedConcentrationCurrentRate',e=>e.textContent),'20.6%');
  assert.ok((await page.evaluate(()=>window.requests.map(r=>r.url))).every(url=>url==='/api/concentration-chart'),'Day mode reads Kiwoom');
  await page.click('#combinedConcentrationChartPanel [data-chart-mode="minute"]');
  await page.waitForFunction(()=>window.getCombinedRankChartState().mode==='minute'&&!window.getCombinedRankChartState().busy&&window.getCombinedRankChartState().points.length===60);
  assert.equal(await page.$eval('#combinedConcentrationCurrentRate',e=>e.textContent),'12.6%');
  await page.click('#combinedConcentrationCandleToggle');
  assert.equal(await page.$eval('#combinedConcentrationCandleArea',e=>e.hidden),false);
  await page.evaluate(async()=>{window.failLs=true;await window.RankChartAxis.refreshCharts();});
  await page.waitForFunction(()=>!window.getCombinedRankChartState().busy&&window.getCombinedRankChartState().points.every(p=>p.value===null));
  assert.ok(await page.evaluate(()=>window.getCombinedRankChartState().points.every(p=>p.value===null && p.stock_price===205)));
  assert.ok(await page.$eval('#combinedConcentrationCandleCanvas',c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<p.length;i+=4)if(p[i]===225&&p[i+1]===29&&p[i+2]===72)return true;return false;}),'Rising candles are still drawn');
  assert.match(await page.$eval('#combinedConcentrationStatus',e=>e.textContent),/LS 모의 오류/);
  await page.evaluate(async()=>{window.failLs=false;await window.RankChartAxis.refreshCharts();});
  await page.waitForFunction(()=>!window.getCombinedRankChartState().busy&&window.getCombinedRankChartState().points.every(p=>p.value!==null));
  assert.equal(await page.$eval('#combinedConcentrationCurrentRate',e=>e.textContent),'12.6%');
  assert.doesNotMatch(await page.$eval('#combinedConcentrationStatus',e=>e.textContent),/LS 모의 오류/);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
