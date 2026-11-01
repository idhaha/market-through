const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const {chromium}=require('playwright'),{createRankIndependentRelay}=require('../../rank-independent'),{createBrokerTurnoverData}=require('../../broker-turnover-data'),{createBrokerComparisonService}=require('../../broker-comparison-service');
test('09:00-start LS stock cumulative reaches the real independent chart label and orange line',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-cumulative-'));
 const data=createBrokerTurnoverData({broker:'ls',directory,now:()=>Date.parse('2026-11-01T12:00:00+09:00'),pause:async()=>{},getToken:async()=>'',transport:{setStreams(){},streamStatus(){}},http:{post:async(url,body)=>{
  const tr=Object.keys(body)[0].replace('InBlock',''),market=tr==='t8409';return {data:{rsp_cd:'00000',[tr+'OutBlock']:{cts_date:'',cts_time:''},[tr+'OutBlock1']:[{date:'20261030',time:'090100',value:market?100:10},{date:'20261030',time:'090200',value:market?200:20}]}};
 }}});
 const reference={query:async input=>({success:true,mode:input.mode,market:'K',has_more:false,points:['090000','090100'].map(clock=>({time:'20261030'+(input.mode==='minute'?clock:''),stock_price:100,stock_open:99,stock_high:101,stock_low:98,...(!input.prices_only?{value:10}:{})}))})};
 const comparison=createBrokerComparisonService({broker:'ls',data,concentrationReference:reference});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.authUser={email:'fixture@test'};next();});
 createRankIndependentRelay({request:async command=>{
  if(command.path==='/api/ls-concentration-chart')return comparison.concentration(command.body,'fixture');
  if(command.path==='/api/concentration-chart')return reference.query(command.body);
  return {success:true,stocks:[],archive:[],revision:1};
 }}).mount(app);app.use(express.static(path.resolve('public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 t.after(async()=>{data.stop();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
 await page.clock.install({time:new Date('2026-10-30T10:00:00+09:00')});
 await page.addInitScript(()=>{window.orangeLines=0;const prototype=CanvasRenderingContext2D.prototype,begin=prototype.beginPath,line=prototype.lineTo,stroke=prototype.stroke;prototype.beginPath=function(...a){this.lineCount=0;return begin.apply(this,a);};prototype.lineTo=function(...a){this.lineCount++;return line.apply(this,a);};prototype.stroke=function(...a){if(this.canvas.id==='concentrationCanvas'&&this.strokeStyle==='#ea580c'&&this.lineCount>0)window.orangeLines++;return stroke.apply(this,a);};});
 const ticket=await(await context.request.post(base+'/api/rank-independent',{data:{}})).json();await context.request.post(base+`/api/rank-independent/${ticket.id}/owner`,{headers:{'X-Rank-Owner':ticket.ownerKey},data:{snapshot:{rows:'',chart:{selection:{code:'353200',name:'대덕전자'},market:'코스피'},conditions:{}}}});
 await page.goto(base+`/rank-independent.html#id=${ticket.id}&token=${ticket.token}`);await page.waitForFunction(()=>window.getRankChartState?.().points.length>0);
 await page.locator('[data-chart-mode="minute"]').click();await page.waitForFunction(()=>getRankChartState().points.some(p=>p.cumulative_value===10)&&orangeLines>0);
 assert.match(await page.locator('.concentration-current-cumulative').innerText(),/누적 10.0%/);assert.deepEqual(errors,[]);
});
