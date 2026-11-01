const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express'),path=require('node:path');
const {chromium}=require('playwright'),{createRankIndependentRelay}=require('../../rank-independent');
test('independent day/minute topics and prices render independently and both retain older pages',{timeout:120000},async t=>{
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.authUser={email:'fixture@test'};next();});
 let hold=false,blocked='',releases=[];const calls=[];
 const config={success:true,stocks:[{code:'005930',name:'A'},{code:'000660',name:'B'}],archive:[{code:'005930',name:'A'},{code:'000660',name:'B'}],revision:1};
 createRankIndependentRelay({session:()=>({spot:true,futures:true,days:{'2026-10-30':true,'2026-11-02':true}}),request:async command=>{
  const url=new URL(command.path,'http://test'),body=command.body||{},code=body.code||url.searchParams.get('code'),mode=body.mode||url.searchParams.get('mode')||'day';
  if(url.pathname==='/api/supply/watchlist')return config;
  const price=body.prices_only||url.pathname.endsWith('/candles');calls.push({code,mode,price:!!price,cursor:body.cursor||url.searchParams.get('cursor')});
  if(hold&&code==='000660'&&(price?'price':'topic')===blocked)await new Promise(resolve=>releases.push(resolve));
  const old=!!(body.cursor||url.searchParams.get('cursor')||url.searchParams.get('date')==='2026-10-30'),date=old?'2026-10-30':'2026-11-02',time=date.replaceAll('-','')+(mode==='minute'?'090000':''),at=Date.parse(date+'T'+(mode==='minute'?'09':'00')+':00:00+09:00'),value=code==='000660'?222:111;
  if(url.pathname.includes('concentration-chart'))return {success:true,points:[{time,...(price?{stock_price:value,stock_open:value-1,stock_high:value+1,stock_low:value-2}:{value})}],cursor:old?null:'20261030',has_more:!old};
  const points=price?[{t:at,date,open:value-1,high:value+1,low:value-2,close:value}]:[{t:at,date,foreign:value,individual:-value,institution:0,program:0}];
  return {success:true,points,candles:!price&&mode==='day'&&old?[{t:at,date,open:value-1,high:value+1,low:value-2,close:value}]:[],cursor:old?null:'20261030',has_more:!old,date,available_dates:['2026-10-30','2026-11-02']};
 }}).mount(app);
 app.get('/api/trading-session/calendar',(req,res)=>res.json({days:{'2026-10-30':true,'2026-11-02':true}}));app.use(express.static(path.resolve('public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 t.after(async()=>{hold=false;releases.forEach(r=>r());await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 for(const mode of ['day','minute'])for(blocked of ['topic','price']){
  console.log(`Checking independent ${mode}: ${blocked} delayed`);
  hold=false;releases=[];const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());await page.clock.install({time:new Date('2026-11-02T10:00:00+09:00')});
  const wait=async(fn,arg)=>page.waitForFunction(fn,arg,{timeout:15000}).catch(async error=>{console.log('Loading diagnostics',mode,blocked,JSON.stringify(await page.evaluate(()=>({chart:window.getRankChartState?.(),supply:window.getRankSupplyState?.(),failure:window.rankIndependentLastFailure}))),JSON.stringify(calls.slice(-15)));throw error;});
  await page.addInitScript(()=>{window.candlePaint={};const fill=CanvasRenderingContext2D.prototype.fillRect;CanvasRenderingContext2D.prototype.fillRect=function(...args){if(this.canvas.closest('.concentration-candle-area,.rank-adr-candle-area'))window.candlePaint[this.canvas.closest('section')?.id]=(window.candlePaint[this.canvas.closest('section')?.id]||0)+1;return fill.apply(this,args);};});
  const created=await context.request.post(base+'/api/rank-independent',{data:{}});assert.equal(created.status(),200);const ticket=await created.json();await context.request.post(base+`/api/rank-independent/${ticket.id}/owner`,{headers:{'X-Rank-Owner':ticket.ownerKey},data:{snapshot:{rows:'',chart:{selection:{code:'005930',name:'A'}},conditions:{}}}});
  await page.goto(base+`/rank-independent.html#id=${ticket.id}&token=${ticket.token}`);await wait(()=>window.getRankSupplyState?.().points.length>0&&window.getRankChartState?.().points.length>0);
  await page.evaluate(()=>{applyConcentrationDisplaySettings({...getConcentrationDisplaySettings(),candleOpen:true});applyRankSupplyCandleOpen(true);});
  if(mode==='minute')await page.locator('#concentrationChartPanel [data-chart-mode="minute"]').click();
  await wait(mode=>getRankChartState().mode===mode&&getRankSupplyState().mode===mode&&!getRankChartState().busy&&getRankSupplyState().candles.length>0,mode);
  hold=true;await page.evaluate(()=>{window.candlePaint={};selectRankChartStock({code:'000660',name:'B',market:'K'});});
  if(blocked==='topic'){
   await wait(()=>getRankChartState().points.some(p=>p.stock_price===222)&&getRankSupplyState().candles.some(p=>p.close===222));
   assert.equal(await page.evaluate(()=>getRankChartState().points.some(p=>p.value===222)||getRankSupplyState().points.some(p=>p.foreign===222)),false);
   assert.ok(await page.evaluate(()=>candlePaint.concentrationChartPanel>0&&candlePaint.rankSupplyChartPanel>0),'Both price candles actually painted while topics were blocked');
  }else{
   await wait(()=>getRankChartState().points.some(p=>p.value===222)&&getRankSupplyState().points.some(p=>p.foreign===222));
   assert.equal(await page.evaluate(()=>getRankChartState().points.some(p=>p.stock_price===222)||getRankSupplyState().candles.some(p=>p.close===222)),false);
  }
  hold=false;releases.forEach(r=>r());await wait(()=>getRankChartState().points.some(p=>p.value===222&&p.stock_price===222)&&getRankSupplyState().points.some(p=>p.foreign===222)&&getRankSupplyState().candles.some(p=>p.close===222));
  await page.locator('#concentrationMore').click();
  await wait(()=>getRankChartState().points.some(p=>p.time.startsWith('20261030'))&&getRankSupplyState().points.some(p=>p.date==='2026-10-30'));
  await wait(()=>getRankSupplyState().candles.some(p=>p.date==='2026-10-30')&&getRankChartState().points.some(p=>p.time.startsWith('20261030')&&p.stock_price===222));
  assert.ok(await page.evaluate(()=>getRankChartState().points.some(p=>p.time.startsWith('20261102'))&&getRankSupplyState().points.some(p=>p.date==='2026-11-02')),'History appends without replacing the latest page');assert.deepEqual(errors,[]);await context.request.delete(base+`/api/rank-independent/${ticket.id}/owner`,{headers:{'X-Rank-Owner':ticket.ownerKey}});await context.close();console.log(`Passed independent ${mode}: ${blocked} delayed, older topic and candle pages retained`);
 }
});
