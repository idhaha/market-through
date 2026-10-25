const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
test('stock and market supply leave zero slots blank without connecting across them or changing original values', {timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:1800,height:1200}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const day='2026-10-23',base=Date.parse(day+'T09:00:00+09:00');
 const rows=[10,0,20,30,0].map((v,i)=>({t:base+i*60000,individual:v,foreign:v,institution:v,program:v}));
 await page.route('http://zero.test/**',route=>{
  const u=new URL(route.request().url());let data;
  if(u.pathname==='/api/supply/watchlist')data={success:true,stocks:[{code:'005930',name:'삼성전자'}],archive:[{code:'005930',name:'삼성전자'}],revision:1};
  else if(u.pathname==='/api/supply/chart'||u.pathname==='/api/market-supply/chart')data={success:true,points:rows,candles:[],has_more:false,warnings:[],date:day};
  else if(u.pathname.startsWith('/api/'))data={success:true,points:[],has_more:false};
  if(data)return route.fulfill({json:data});
  return route.fulfill({contentType:'text/html',body:'<div id="tab_rank"><div class="rank-chart-row"><section id="concentrationChartPanel" class="panel" style="height:450px"></section><section id="rankBreadthChartPanel" class="panel"></section></div></div>'});
 });
 await page.goto('http://zero.test/');await page.addStyleTag({path:'public/style.css'});
 await page.evaluate(()=>{
  Date.now=()=>Date.parse('2026-10-23T10:00:00+09:00');window.paths={};
  const proto=CanvasRenderingContext2D.prototype;
  for(const method of ['beginPath','moveTo','lineTo','stroke','arc']){
   const original=proto[method];proto[method]=function(...args){
    const panel=this.canvas.closest('section')?.id;
    if(this.canvas.closest('.rank-adr-area')){
     if(method==='beginPath')this.recorded=[];
     if(method==='moveTo'||method==='lineTo'||method==='arc')(this.recorded||=[]).push([method,...args]);
     if(method==='stroke'&&this.lineWidth===2){(window.paths[panel]||={})[this.strokeStyle]=[...(this.recorded||[])];}
    }
    return original.apply(this,args);
   };
  }
 });
 for(const name of ['rank-chart-axis','rank-supply-chart','rank-market-supply-chart'])await page.addScriptTag({path:`public/${name}.js`});
 for(const id of ['rankSupplyChartPanel','rankMarketSupplyChartPanel']){
  await page.locator(`#${id} [data-mode="minute"]`).click();
  await page.waitForFunction(id=>window.paths[id]?.['#339af0']?.length===3,id);
  const draws=await page.evaluate(id=>window.paths[id],id);
  for(const color of ['#339af0','#e11d48','#16a34a','#8b5cf6'])assert.deepEqual(draws[color].map(x=>x[0]),['moveTo','moveTo','lineTo']);
  const outputs=await page.locator(`#${id} [data-series] output`).allTextContents();
  assert.ok(outputs.every(text=>text.includes('0')),'Latest source zero remains in numeric labels');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(rows.map(r=>r.individual),[10,0,20,30,0]);
 }finally{await browser.close();}
});
