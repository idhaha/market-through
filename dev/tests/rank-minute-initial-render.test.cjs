const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:2100,height:1300}});const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 const points=[0,1,2].map((i)=>({t:Date.parse('2026-10-23T09:00:00+09:00')+i*60000,date:`2026-10-23 09:0${i}`,open:100,high:110,low:90,close:103,individual:10+i,foreign:20+i,institution:30+i,program:40+i,adr:90+i}));
 await page.route('http://minute.test/**',async route=>{const url=new URL(route.request().url());
 if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'')});
 requests.push(url.pathname);await new Promise(r=>setTimeout(r,40));
 let result={points:[],series:{}};
 if(url.pathname==='/api/chart-reference')result={points,cursor:null};
 if(url.pathname==='/api/adr/today')result={intraday:points,marketStatus:'open'};
 if(url.pathname==='/api/supply/watchlist')result={success:true,stocks:[{code:'000660',name:'SK하이닉스'}],archive:[{code:'000660',name:'SK하이닉스'}],revision:0,statuses:{}};
 if(url.pathname==='/api/supply/chart')result={success:true,points,candles:points,warnings:[],date:'2026-10-23',cursor:null};
 if(url.pathname==='/api/supply/candles')result={success:true,points,cursor:null};
 if(url.pathname==='/api/risk/breadth')result={dates:points.map(p=>p.date),series:{highs:{points:points.map((p,i)=>({date:p.date,value:10+i}))},lows:{points:points.map((p,i)=>({date:p.date,value:-10-i}))}}};
 await route.fulfill({json:result});});
 await page.goto('http://minute.test/');await page.addStyleTag({path:'public/style.css'});
 await page.evaluate(()=>{window.rankManagedChartRefresh=true;Date.now=()=>Date.parse('2026-10-23T09:22:00+09:00');document.querySelector('#tabContents').style.display='block';document.querySelector('#loginOverlay').style.display='none';
 const proto=CanvasRenderingContext2D.prototype,clear=proto.clearRect,line=proto.lineTo,rect=proto.fillRect;const colors=['#339af0','#e11d48','#2563eb','#8b5cf6','#16a34a'];
 proto.clearRect=function(...args){this.canvas.dataMarks=0;return clear.apply(this,args)};
 proto.lineTo=function(...args){if(colors.includes(this.strokeStyle))this.canvas.dataMarks=(this.canvas.dataMarks||0)+1;return line.apply(this,args)};
 proto.fillRect=function(...args){if(colors.includes(this.fillStyle))this.canvas.dataMarks=(this.canvas.dataMarks||0)+1;return rect.apply(this,args)};});
 for(const script of ['rank-chart-axis','rank-adr-chart','rank-volatility-chart','rank-supply-chart'])await page.addScriptTag({path:`public/${script}.js`});
 assert.equal(requests.length,0,'Managed initial mount must not start independent chart requests');
 await page.evaluate(()=>window.RankChartAxis.refreshCharts());
 for(const [id,selector] of [['rankSupplyChartPanel','[data-mode="minute"]'],['rankBreadthChartPanel','[data-breadth-mode="minute"]'],['rankAdrChartPanel','[data-adr-mode="minute"]']]){
 await page.locator(`#${id} ${selector}`).click();
 try { await page.waitForFunction(id=>document.querySelector(`#${id} .rank-adr-area canvas`).dataMarks>0,id,{timeout:8000}); } catch(error) { console.log(id,await page.locator('#'+id+' .rank-adr-status').textContent(),errors);throw error; }
 }
 assert.deepEqual(errors,[]);console.log('PASS supply/breadth/ADR draw actual data after empty first minute view and delayed API responses');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
