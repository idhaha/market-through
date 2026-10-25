const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createKisConcentrationChartService,differences}=require('../../kis-concentration-chart');
const row=(hour,total,day='20261023')=>({stck_bsop_date:day,stck_cntg_hour:hour,acml_tr_pbmn:String(total)});
test('cumulative differences exclude missing predecessors, gaps, day resets and special sessions',()=>{
 const rows=[row('135300',100),row('135400',110),row('135600',150),row('152000',200),row('153000',250),row('888888',260),row('999999',300),row('090000',20,'20261024')];
 const values=differences(new Map(rows.map(r=>[r.stck_bsop_date+r.stck_cntg_hour,r])),'090000',1000000);
 assert.equal(values.get('20261023135300'),null);assert.equal(values.get('20261023135400'),10000000);
 assert.equal(values.get('20261023135600'),null);assert.equal(values.get('20261023153000'),50000000);
 assert.equal(values.has('20261023999999'),false);assert.equal(values.get('20261024090000'),20000000);
 const auction=differences(new Map([row('151900',100),row('153000',125)].map(r=>[r.stck_bsop_date+r.stck_cntg_hour,r])),'080000');
 assert.equal(auction.get('20261023153000'),25);
});
function fixture(directory,overrides={}){
 let indexRows=[row('135300',100),row('135400',120),row('135500',160),row('999999',500)];
 const calls=[];
 const http={get:async(url,config)=>{calls.push({url,config});const p=config.params;
  let rows;if(url.endsWith('inquire-time-indexchartprice'))rows=indexRows;
  else if(url.endsWith('inquire-time-dailychartprice'))rows=[row('135300',1000000),row('135400',3000000),row('135500',7000000)];
  else rows=[{stck_bsop_date:'20261023',acml_tr_pbmn:url.endsWith('inquire-daily-indexchartprice')?'100':'20000000'}];
  return{data:{rt_cd:'0',output2:rows}};
 }};
 const reference={query:async(input,owner)=>{assert.equal(owner,'user');return{success:true,market:'K',mode:input.mode,interval:1,cursor:'bound-cursor',has_more:true,points:(input.mode==='day'?['20261023']:['20261023135300','20261023135400','20261023135500']).map(time=>({time,value:50,stock_price:200,stock_open:190,stock_high:210,stock_low:180}))};}};
 const options={directory,http,reference,credentials:()=>({domain:'https://test.invalid',appKey:'secret',secretKey:'secret'}),getToken:async()=> 'token',pause:async()=>{},...overrides};
 return{service:createKisConcentrationChartService(options),options,calls,setIndex:rows=>{indexRows=rows;}};
}
test('minute amounts use UN stock won and index million-won deltas; candles/grid/history are unchanged',async()=>{
 const f=fixture();const r=await f.service.query({code:'005930',mode:'minute',interval:1},'user');
 assert.equal(r.points[0].value,null);assert.equal(r.points[1].value,10);assert.equal(r.points[2].value,10);
 assert.equal(r.points[1].stock_turnover,2000000);assert.equal(r.points[1].market_turnover,20000000);
 assert.equal(r.points[1].stock_price,200);assert.equal(r.cursor,'bound-cursor');assert.equal(r.has_more,true);
 assert.equal(f.calls.find(c=>c.url.endsWith('inquire-time-dailychartprice')).config.params.FID_COND_MRKT_DIV_CODE,'UN');
});
test('saved index predecessor survives service restart and overlapping updates replace the current bar',async()=>{
 const testRoot=path.resolve(__dirname,'../output');fs.mkdirSync(testRoot,{recursive:true});
 const directory=fs.mkdtempSync(path.join(testRoot,'kis-concentration-'));
 try{
 const f=fixture(directory);await f.service.query({code:'005930',mode:'minute'},'user');
 f.setIndex([row('135400',125),row('135500',165)]);
 const restarted=createKisConcentrationChartService(f.options);
 const r=await restarted.query({code:'005930',mode:'minute'},'user');
 assert.equal(r.points[1].market_turnover,25000000);assert.equal(r.points[1].value,8);
 const saved=JSON.parse(fs.readFileSync(path.join(directory,'0001','20261023.json'),'utf8'));
 assert.equal(saved.filter(x=>x.stck_cntg_hour==='135400').length,1);
 }finally{assert.ok(path.resolve(directory).startsWith(testRoot+path.sep));fs.rmSync(directory,{recursive:true,force:true});}
});
test('daily uses actual amounts and never falls back to a price-times-volume estimate',async()=>{
 const f=fixture();const r=await f.service.query({code:'005930',mode:'day'},'user');
 assert.equal(r.points[0].value,20);assert.equal(r.points[0].stock_turnover,20000000);assert.equal(r.points[0].market_turnover,100000000);
});
test('API failures do not expose axios configuration or credentials',async()=>{
 const f=fixture();f.options.http.get=async()=>{throw{isAxiosError:true,config:{appkey:'SECRET'},code:'ECONNRESET'};};
 await assert.rejects(f.service.query({code:'005930',mode:'minute'},'user'),e=>!/SECRET|appkey/.test(e.message)&&/통신 오류/.test(e.message));
});
function temporaryDirectory(){
 const root=path.resolve(__dirname,'../output');fs.mkdirSync(root,{recursive:true});
 const directory=fs.mkdtempSync(path.join(root,'kis-collector-'));
 return{directory,cleanup(){assert.ok(path.resolve(directory).startsWith(root+path.sep));fs.rmSync(directory,{recursive:true,force:true});}};
}
test('background collector persists both industries without a browser or reference chart',async()=>{
 const temp=temporaryDirectory();
 try{
 const f=fixture(temp.directory,{now:()=>Date.parse('2026-10-23T14:00:00+09:00'),reference:{query:()=>assert.fail('collector must not query Kiwoom')}});
 await f.service.collect();
 assert.deepEqual(f.calls.map(c=>c.config.params.FID_INPUT_ISCD),['0001','1001']);
 for(const code of ['0001','1001']){
  const saved=JSON.parse(fs.readFileSync(path.join(temp.directory,code,'20261023.json'),'utf8'));
  assert.equal(saved.length,4);assert.equal(saved[0].stck_cntg_hour,'135300');
 }
 }finally{temp.cleanup();}
});
test('collector runs once per minute, starts immediately, is idempotent and stops cleanly',async()=>{
 let time=Date.parse('2026-10-23T14:00:00+09:00'),scheduled=0,cancelled=0,tick;
 const timer={unref(){}};
 const f=fixture(undefined,{now:()=>time,schedule:(fn,ms)=>{assert.equal(ms,60000);scheduled++;tick=fn;return timer;},cancel:value=>{assert.equal(value,timer);cancelled++;}});
 f.service.start();f.service.start();await f.service.collect();
 assert.equal(scheduled,1);assert.equal(f.calls.length,2);
 time+=60000;tick();await f.service.collect();assert.equal(f.calls.length,4);
 f.service.stop();f.service.stop();assert.equal(cancelled,1);
});
test('collector skips weekends/off-hours and does not save stale holiday or future rows',async()=>{
 const temp=temporaryDirectory();let time=Date.parse('2026-10-25T14:00:00+09:00');
 try{
 const f=fixture(temp.directory,{now:()=>time});
 await f.service.collect();assert.equal(f.calls.length,0);
 time=Date.parse('2026-10-23T07:59:00+09:00');await f.service.collect();assert.equal(f.calls.length,0);
 time=Date.parse('2026-10-26T14:00:00+09:00');await f.service.collect();assert.equal(f.calls.length,2);
 assert.equal(fs.existsSync(path.join(temp.directory,'0001')),false);
 time=Date.parse('2026-10-23T13:00:00+09:00');
 const future=fixture(temp.directory,{now:()=>time});future.setIndex([row('135300',100)]);await future.service.collect();
 assert.equal(fs.existsSync(path.join(temp.directory,'0001')),false);
 time=Date.parse('2026-10-23T20:03:00+09:00');const count=f.calls.length;await f.service.collect();assert.equal(f.calls.length,count);
 }finally{temp.cleanup();}
});
test('overlapping collection shares one run, and failure in one industry does not stop the other or the next tick',async()=>{
 let release,first=true,time=Date.parse('2026-10-23T14:00:00+09:00');const logs=[];
 const f=fixture(undefined,{now:()=>time,log:message=>logs.push(message)});
 const original=f.options.http.get;
 f.options.http.get=async(url,config)=>{if(config.params.FID_INPUT_ISCD==='0001'&&first){first=false;await new Promise(resolve=>{release=resolve;});throw{isAxiosError:true,config:{appkey:'SECRET'}};}return original(url,config);};
 const a=f.service.collect(),b=f.service.collect();assert.equal(a,b);
 await new Promise(resolve=>setImmediate(resolve));release();await a;
 assert.equal(f.calls.length,1);assert.equal(logs.length,1);assert.doesNotMatch(logs[0],/SECRET|appkey/);
 time+=60000;await f.service.collect();assert.equal(f.calls.length,3);
});
