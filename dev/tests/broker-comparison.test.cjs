const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createBrokerTurnoverData,million,lsMinuteTime}=require('../../broker-turnover-data');
const {createBrokerComparisonService}=require('../../broker-comparison-service');
const {timestamp}=require('../../supply-service');
const at=clock=>timestamp('20261026',clock);
function fixture(t,broker='ls',bars=[]){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'broker-amount-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let current=at('100550');const calls=[],streams=[];
 const data=createBrokerTurnoverData({broker,directory,now:()=>current,pause:async()=>{},
  transport:{setStreams:(owner,items)=>{streams.splice(0,streams.length,...items);},streamStatus:()=>({subscribed:true})},
  getToken:async()=>'private',http:{post:async(url,body)=>{calls.push({url,body});const tr=Object.keys(body)[0].replace('InBlock','');return {data:{rsp_cd:'00000',[tr+'OutBlock1']:bars,[tr+'OutBlock']:{cts_date:'',cts_time:''}}};}},
  kisMarketAmounts:async()=>bars});
 t.after(()=>data.stop());return {data,calls,streams,setTime:x=>current=x};
}
test('money conversion and LS closing timestamps preserve zero, missing and auction semantics',()=>{
 assert.equal(million(0),0);assert.equal(million(' '),null);assert.equal(million('123.5'),123500000);assert.equal(million('-1'),null);
 assert.equal(lsMinuteTime('20261026','090100'),at('090000'));assert.equal(lsMinuteTime('20261026','153000'),at('153000'));assert.equal(lsMinuteTime('20261026','200000'),at('195900'));
});
test('LS websocket cumulative values finalize per minute and never spread a missing interval',async t=>{
 const f=fixture(t);f.data.watchStock('005930','owner');
 const frame=(time,value)=>JSON.stringify({header:{tr_cd:'US3',tr_key:'U005930   '},body:{chetime:time,ex_shcode:'U005930',value}});
 assert.equal(f.data.receive(frame('100549','100')),true);assert.equal(f.data.receive(frame('100548','999')),false);assert.equal(f.data.receive(frame('100600','999')),false);
 assert.equal(f.data.store.points('005930','2026-10-26').length,0);
 f.setTime(at('100750'));f.data.receive(frame('100749','140'));f.setTime(at('100850'));f.data.receive(frame('100849','150'));f.setTime(at('100900'));f.data.flush();
 const intervals=await f.data.amounts('005930','minute',['20261026']);assert.equal(intervals.values.has(at('100500')),false);assert.equal(intervals.values.has(at('100700')),false);assert.equal(intervals.values.get(at('100800')),10000000);
 const totals=await f.data.amounts('005930','minute',['20261026'],true);assert.equal(totals.values.get(at('100500')),100000000);
});
test('KIS market websocket parses exact 30-column records and separates the two markets',t=>{
 const f=fixture(t,'kis');f.data.start();assert.equal(f.streams.length,2);assert.ok(f.streams.every(s=>s.tr==='H0UPCNT0'));
 const fields=new Array(30).fill('0');fields[0]='0001';fields[1]='100549';fields[6]='123';
 assert.equal(f.streams[1].onData('0|H0UPCNT0|1|'+fields.join('^')),false);
 assert.equal(f.streams[0].onData('0|H0UPCNT0|1|'+fields.join('^')),true);
 f.setTime(at('100600'));f.data.flush();assert.equal(f.data.store.points('KOSPI0','2026-10-26')[0].amount,123000000);assert.equal(f.data.store.points('KOSDAQ','2026-10-26').length,0);
});
test('new websocket minutes appear even while the REST history cache remains valid',async t=>{
 const f=fixture(t);f.data.watchStock('005930','owner');
 await f.data.amounts('005930','minute',['20261026'],true);
 const calls=f.calls.length;
 f.data.receive(JSON.stringify({header:{tr_cd:'US3'},body:{chetime:'100549',ex_shcode:'U005930',value:123}}));
 f.setTime(at('100600'));
 const result=await f.data.amounts('005930','minute',['20261026'],true);
 assert.equal(result.values.get(at('100500')),123000000);assert.equal(f.calls.length,calls);
});
test('LS REST amounts use source interval money and end times, with no price-times-volume substitute',async t=>{
 const f=fixture(t,'ls',[{date:'20261026',time:'090100',value:10},{date:'20261026',time:'090200',value:20}]);
 const totals=await f.data.amounts('kospi','minute',['20261026'],true);assert.equal(totals.values.get(at('090000')),10000000);assert.equal(totals.values.get(at('090100')),30000000);
 const intervals=await f.data.amounts('kospi','minute',['20261026']);assert.equal(intervals.values.get(at('090100')),20000000);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.t8409InBlock.qrycnt,500);
});
test('comparison service retains shared candles but replaces only the broker amounts',async()=>{
 const seen=[];const service=createBrokerComparisonService({broker:'ls',data:{watchStock:(...args)=>seen.push(args),amounts:async(instrument,mode,dates,cumulative)=>({values:new Map([[at('090000'),cumulative?(instrument==='005930'?5000:10000):(instrument==='005930'?500:2000)]]),warnings:[]})},
  concentrationReference:{query:async()=>({success:true,mode:'minute',market:'K',points:[{time:'20261026090000',stock_price:100,value:999,stock_turnover:999}]})},
  turnoverReference:{query:async()=>({markets:{kospi:[{t:at('090000'),close:100,market_turnover:999}],kosdaq:[{t:at('090000'),close:100,market_turnover:999}]}})}});
 const ratio=await service.concentration({code:'005930'},'owner');assert.equal(ratio.points[0].value,25);assert.equal(ratio.points[0].cumulative_value,50);assert.equal(ratio.points[0].stock_price,100);assert.deepEqual(seen,[['005930','owner']]);
 const amounts=await service.turnover({mode:'minute'});assert.equal(amounts.markets.kospi[0].market_turnover,10000);assert.equal(amounts.markets.kospi[0].close,100);
});


test('LS daily stock and market history sends continuation headers beyond the first page',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ls-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const calls=[];const data=createBrokerTurnoverData({broker:'ls',directory:dir,now:()=>at('210000'),pause:async()=>{},transport:{setStreams(){}},getToken:async()=>'hidden',http:{post:async(url,body,{headers})=>{
  const tr=Object.keys(body)[0].replace('InBlock',''),p=body[tr+'InBlock'];calls.push({tr,p,headers});
  if(!p.cts_date){assert.equal(headers.tr_cont,'N');return {headers:{tr_cont:'Y',tr_cont_key:'0'},data:{rsp_cd:'00000',[tr+'OutBlock']:{cts_date:'20241002'},[tr+'OutBlock1']:[{date:'20261026',value:20}]}};}
  assert.equal(headers.tr_cont,'Y');assert.equal(headers.tr_cont_key,'0');assert.equal(p.cts_date,'20241002');
  return {headers:{tr_cont:'N',tr_cont_key:'0'},data:{rsp_cd:'00000',[tr+'OutBlock']:{cts_date:''},[tr+'OutBlock1']:[{date:'20240507',value:10}]}};
 }}});
 for(const instrument of ['kospi','000660']){const r=await data.amounts(instrument,'day',['20240507','20261026']);assert.equal(r.values.get(timestamp('20240507')),10000000);assert.equal(r.values.get(timestamp('20261026')),20000000);}
 assert.equal(calls.length,4);assert.deepEqual(calls.map(c=>c.tr),['t8429','t8429','t8451','t8451']);
});


test('expanding LS minute history fetches only new dates and reuses already requested dates',async t=>{
 const f=fixture(t,'ls',[{date:'20261026',time:'090100',value:10}]);
 await f.data.amounts('kospi','minute',['20261026']);assert.equal(f.calls.length,1);
 await f.data.amounts('kospi','minute',['20261023','20261026']);assert.equal(f.calls.length,2);
 assert.deepEqual(f.calls.map(c=>c.body.t8409InBlock.sdate),['20261026','20261023']);
 await f.data.amounts('kospi','minute',['20261023','20261026']);assert.equal(f.calls.length,2);
});
