const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createBrokerTurnoverData,million,lsMinuteTime}=require('../../broker-turnover-data');
const {createBrokerComparisonService}=require('../../broker-comparison-service');
const {timestamp}=require('../../supply-service');
const at=clock=>timestamp('20261026',clock);
test('past stored concentration amounts bypass REST and preserve sparse minute gaps',async t=>{
 const f=fixture(t);f.setTime(timestamp('20261028','100000'));
 // The saved day covers the regular session (09:00..15:30), so its missing 09:02 stays missing.
 const later=Array.from({length:387},(_,i)=>({t:at('090400')+i*60000,amount:6000000+i*1000000}));
 f.data.store.mergeMany('005930',[
  {t:at('090000'),amount:1000000},{t:at('090100'),amount:3000000},{t:at('090300'),amount:5000000},...later
 ]);
 const [bars,total]=await Promise.all([f.data.amounts('005930','minute',['20261026']),f.data.amounts('005930','minute',['20261026'],true)]);
 assert.equal(f.calls.length,0);
 assert.equal(bars.values.get(at('090100')),2000000);
 assert.equal(bars.values.has(at('090300')),false);
 assert.equal(total.values.get(at('090300')),5000000);
});
test('a past day saved only in part is read from LS REST, so an interrupted collection does not blank the day',async t=>{
 // 2026-11-02 on Oracle: LS session limit left 000660 with 20 minutes (08:16..16:07) and no index file.
 const f=fixture(t,'ls',[{date:'20261026',time:'090100',value:10},{date:'20261026',time:'090200',value:20},{date:'20261026',time:'153000',value:30}]);
 f.setTime(timestamp('20261028','100000'));
 f.data.store.mergeMany('000660',[{t:at('101500'),amount:7000000},{t:at('160600'),amount:9000000}]);
 const bars=await f.data.amounts('000660','minute',['20261026']);
 assert.equal(f.calls.length,1,'partial saved day is requested from REST');
 assert.equal(bars.values.get(at('090000')),10000000);assert.equal(bars.values.get(at('090100')),20000000);assert.equal(bars.values.get(at('153000')),30000000);
 const late=fixture(t,'ls',[]);late.setTime(timestamp('20261028','100000'));
 late.data.store.mergeMany('000660',[{t:at('093000'),amount:1000000},{t:at('195900'),amount:9000000}]);
 await late.data.amounts('000660','minute',['20261026']);
 assert.equal(late.calls.length,1,'a day starting 09:30 misses the opening and is also requested');
 // Both ends present but only a few minutes between them, as 000660 had on 2026-11-02.
 const sparse=fixture(t,'ls',[]);sparse.setTime(timestamp('20261028','100000'));
 sparse.data.store.mergeMany('000660',[{t:at('081600'),amount:1000000},{t:at('120000'),amount:5000000},{t:at('160700'),amount:9000000}]);
 await sparse.data.amounts('000660','minute',['20261026']);
 assert.equal(sparse.calls.length,1,'a sparse day spanning the session is also requested');
});
test('background turnover watch survives browser owner expiry and releases its own subscription when disabled',t=>{
 const f=fixture(t);f.data.setBackgroundStocks(['000660']);assert.ok(f.streams.some(s=>s.tr==='US3'&&s.key==='U000660   '));
 f.setTime(at('102550'));f.data.watchStock('005930','browser');f.setTime(at('104550'));f.data.watchStock('222800','another-browser');
 assert.ok(f.streams.some(s=>s.key==='U000660   '));assert.ok(!f.streams.some(s=>s.key==='U005930   '));
 f.data.setBackgroundStocks([]);assert.ok(!f.streams.some(s=>s.key==='U000660   '));assert.ok(f.streams.some(s=>s.key==='U222800   '));
});
test('LS minute concentration skips the unused Kiwoom index denominator',async()=>{
 let received;
 const svc=createBrokerComparisonService({broker:'ls',data:{watchStock(){},amounts:async()=>({values:new Map(),warnings:[]})},concentrationReference:{query:async input=>{received=input;return {success:true,points:[]};}}});
 await svc.concentration({code:'000660',mode:'minute',cursor:'session'},'owner');
 assert.equal(received.prices_only,true);assert.equal(received.cursor,'session');
});
function fixture(t,broker='ls',bars=[]){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'broker-amount-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let current=at('100550');const calls=[],streams=[];
 const data=createBrokerTurnoverData({broker,directory,now:()=>current,pause:async()=>{},
  transport:{setStreams:(owner,items)=>{streams.splice(0,streams.length,...items);},streamStatus:()=>({subscribed:true})},
  getToken:async()=>'private',http:{post:async(url,body)=>{calls.push({url,body});const tr=Object.keys(body)[0].replace('InBlock','');return {data:{rsp_cd:'00000',[tr+'OutBlock1']:bars,[tr+'OutBlock']:{cts_date:'',cts_time:''}}};}},
  kisMarketAmounts:async()=>bars});
 t.after(()=>data.stop());return {data,calls,streams,directory,setTime:x=>current=x};
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
test('LS stock cumulative accepts a complete 09:00 start as well as 08:00, but leaves late partial starts unavailable',async t=>{
 for(const [opening,available]of [['080100',true],['090100',true],['090200',false]]){
  const f=fixture(t,'ls',[{date:'20261026',time:opening,value:10},{date:'20261026',time:'090300',value:20}]);
  const result=await f.data.amounts('353200','minute',['20261026'],true);
  assert.equal(result.values.get(at('090200')),available?30000000:null,opening);
 }
});
test('LS market cumulative starts at the delayed open on 2026-11-19 (수능) but a 10:00 start stays partial on a normal day',async t=>{
 // 2026-11-19 오라클: 업종지수 첫 행이 10:00이라 시장 누적이 모두 비어 쏠림율 누적 · LS 거래대금 분봉이 안 그려졌다.
 const exam=clock=>timestamp('20261119',clock);
 // 그날은 마감 단일가도 16:30이다(평소 15:30처럼 그 시각 그대로).
 assert.equal(lsMinuteTime('20261119','163000'),exam('163000'));assert.equal(lsMinuteTime('20261119','153000'),exam('152900'));
 for(const [date,instrument,available]of [['20261119','kospi',true],['20261119','353200',true],['20261026','kospi',false]]){
  const f=fixture(t,'ls',[{date,time:'100100',value:10},{date,time:'100200',value:20}]);f.setTime(timestamp(date,'110000'));
  const result=await f.data.amounts(instrument,'minute',[date],true),stamp=date==='20261119'?exam:at;
  assert.equal(result.values.get(stamp('100100')),available?30000000:null,date+' '+instrument);
 }
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
test('지난날 LS 1분 거래대금은 REST로 받은 뒤 그날 누적으로 저장해 다음부터 LS를 부르지 않는다(2026-11-22)',async t=>{
 // 09:00~15:19 매분 1(백만원, 10:00은 거래 없음), 15:20~15:29 동시호가로 봉 없음, 15:30 종가 10.
 const bars=[];for(let m=9*60+1;m<=15*60+20;m++)bars.push({date:'20261026',time:String(Math.floor(m/60)).padStart(2,'0')+String(m%60).padStart(2,'0')+'00',value:1});
 bars.splice(bars.findIndex(b=>b.time==='100100'),1);// 10:00 봉 없음(거래 없던 분)
 bars.push({date:'20261026',time:'153000',value:10});
 const f=fixture(t,'ls',bars);f.setTime(timestamp('20261028','100000'));
 const first=await f.data.amounts('kospi','minute',['20261026']),firstTotal=await f.data.amounts('kospi','minute',['20261026'],true);
 assert.equal(f.calls.length,1);
 const saved=f.data.store.points('KOSPI0','2026-10-26');
 assert.equal(saved[0].t,at('090000'));assert.equal(saved.at(-1).t,at('153000'));assert.equal(saved.at(-1).amount,(379+10)*1000000);
 // 같은 폴더를 읽는 새 서버(재시작): LS를 부르지 않고 같은 값.
 const calls=[];const again=createBrokerTurnoverData({broker:'ls',directory:f.directory,now:()=>timestamp('20261028','100000'),pause:async()=>{},
  transport:{setStreams(){},streamStatus:()=>({})},getToken:async()=>'x',http:{post:async()=>{calls.push(1);throw new Error('호출하면 안 됨');}}});
 t.after(()=>again.stop());
 const bars2=await again.amounts('kospi','minute',['20261026']),total2=await again.amounts('kospi','minute',['20261026'],true);
 assert.equal(calls.length,0);
 assert.equal(total2.values.get(at('153000')),firstTotal.values.get(at('153000')));
 assert.equal(bars2.values.get(at('153000')),10000000,'종가 봉');assert.equal(bars2.values.get(at('103000')),first.values.get(at('103000')));
 assert.equal(bars2.values.get(at('100000')),0,'공식 무거래가 아닌 분에 거래가 없으면 0');
 assert.equal(bars2.values.has(at('152500')),false,'장 마감 동시호가(15:20~15:29)는 0이 아니라 빈칸');
 assert.ok(!saved.some(p=>p.t>=at('152000')&&p.t<at('153000')),'동시호가 분은 저장하지 않는다');
 // 장 마감까지 받지 못한 날(15:00에 끝남)은 저장하지 않는다.
 const cut=fixture(t,'ls',bars.filter(b=>b.time<='150000'));cut.setTime(timestamp('20261028','100000'));
 await cut.data.amounts('kospi','minute',['20261026']);assert.deepEqual(cut.data.store.points('KOSPI0','2026-10-26'),[]);
});
test('실시간 저장일도 장 마감 동시호가(15:20~15:29) 빈칸을 건너 15:30 종가 봉을 계산한다(2026-11-22)',async t=>{
 const f=fixture(t);f.setTime(timestamp('20261028','100000'));
 const pts=[];for(let m=9*60;m<=15*60+19;m++)pts.push({t:at(String(Math.floor(m/60)).padStart(2,'0')+String(m%60).padStart(2,'0')+'00'),amount:(m-539)*1000000});
 pts.push({t:at('153000'),amount:(15*60+19-539+50)*1000000});
 f.data.store.mergeMany('KOSPI0',pts);
 const bars=await f.data.amounts('kospi','minute',['20261026']);
 assert.equal(f.calls.length,0);
 assert.equal(bars.values.get(at('153000')),50000000,'15:19 → 15:30 종가 50');
 assert.equal(bars.values.has(at('152500')),false);
});
