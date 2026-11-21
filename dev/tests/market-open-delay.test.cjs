// 개장이 늦은 날 표(market-open-delay.js): 수능일 표, 새해 첫 거래일 자동 판정, 표에 없는 지연일 경고, 수능일 등록 알림.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../../market-open-delay');
const {createBrokerTurnoverData,lsMinuteTime}=require('../../broker-turnover-data');
const {timestamp}=require('../../supply-service');
// 2027-01-01(금) 휴장, 2027-01-04(월) 첫 거래일, 01-05 평일.
const calendar=days=>day=>Object.hasOwn(days,day)?days[day]:null;
test('수능일은 표대로 개장 · 마감을 60분 늦춘다',()=>{
 assert.equal(D.openDelay('2026-11-19',()=>true),60);assert.equal(D.closeDelay('2026-11-19',()=>true),60);
 assert.equal(D.openDelay('2026-11-18',()=>true),0);
 assert.equal(D.shiftClock('090000',60),'100000');assert.equal(D.shiftClock('153000',60),'163000');
});
test('새해 첫 거래일은 휴장일 달력으로 찾아 개장만 60분 늦춘다',()=>{
 const open=calendar({'2027-01-01':false,'2027-01-04':true,'2027-01-05':true});
 assert.equal(D.openDelay('2027-01-04',open),60);assert.equal(D.closeDelay('2027-01-04',open),0);
 assert.equal(D.openDelay('2027-01-05',open),0);
 // 1월 1일이 달력에 없으면(조회 전) 판단하지 않는다.
 assert.equal(D.openDelay('2027-01-04',calendar({'2027-01-04':true})),0);
 // 새해 첫 날이 휴장으로 바뀌면(임시공휴일) 다음 거래일이 첫 거래일이 된다.
 assert.equal(D.openDelay('2027-01-05',calendar({'2027-01-01':false,'2027-01-04':false,'2027-01-05':true})),60);
 // 달력이 없으면(서버 밖) 0.
 assert.equal(D.openDelay('2027-01-04',null),0);
});
test('새해 첫 거래일 LS 시장 누적은 10:00부터, 15:30 마감 단일가는 그대로',async t=>{
 const ts=require('../../trading-session');const before=ts.current();
 ts.install({openDate:calendar({'2027-01-01':false,'2027-01-04':true})});t.after(()=>ts.install(before));
 assert.equal(lsMinuteTime('20270104','153000'),timestamp('20270104','153000'));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'open-delay-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const logs=[],bars=[{date:'20270104',time:'100100',value:10},{date:'20270104',time:'100200',value:20}];
 const data=createBrokerTurnoverData({broker:'ls',directory,now:()=>timestamp('20270104','110000'),pause:async()=>{},log:m=>logs.push(m),transport:{setStreams(){}},getToken:async()=>'x',
  http:{post:async(url,body)=>{const tr=Object.keys(body)[0].replace('InBlock','');return {data:{rsp_cd:'00000',[tr+'OutBlock1']:bars,[tr+'OutBlock']:{cts_date:'',cts_time:''}}};}}});
 t.after(()=>data.stop());
 const r=await data.amounts('kospi','minute',['20270104'],true);
 assert.equal(r.values.get(timestamp('20270104','100100')),30000000);assert.deepEqual(logs,[]);
});
test('표에 없는 날 업종지수가 늦게 시작하면 하루 한 번 경고하고 누적은 비운다',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'open-delay-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const logs=[],bars=[{date:'20261120',time:'100100',value:10}];
 const data=createBrokerTurnoverData({broker:'ls',directory,now:()=>timestamp('20261120','110000'),pause:async()=>{},log:m=>logs.push(m),transport:{setStreams(){}},getToken:async()=>'x',
  http:{post:async(url,body)=>{const tr=Object.keys(body)[0].replace('InBlock','');return {data:{rsp_cd:'00000',[tr+'OutBlock1']:bars,[tr+'OutBlock']:{cts_date:'',cts_time:''}}};}}});
 t.after(()=>data.stop());
 const r=await data.amounts('kospi','minute',['20261120'],true);await data.amounts('kospi','minute',['20261120'],true);
 assert.equal(r.values.get(timestamp('20261120','100000')),null);
 assert.equal(logs.length,1);assert.match(logs[0],/\[개장 지연\] 오늘 kospi 업종지수 첫 분봉이 10:00입니다/);
});
test('수능일 미등록 알림은 10/20부터 그해 reason 수능 줄이 생길 때까지(최대 12/31)',()=>{
 assert.equal(D.examReminder('2026-11-01'),null); // 2026-11-19가 '수능'으로 표에 있다
 assert.match(D.examReminder('2027-10-20',D.OPEN_DELAY),/2027년 수능일이 등록되지 않았습니다.*설정\(⚙\)의 올해 수능일 칸/);
 assert.equal(D.examReminder('2027-10-19'),null);
 assert.ok(D.examReminder('2027-12-31')); // 12월까지 이어진다
 // 수능이 12월인 해(2020-12-03)도 등록하면 꺼진다.
 assert.equal(D.examReminder('2020-11-10',{'2020-12-03':{open:60,close:60,reason:'수능'}}),null);
 // 11월의 다른 지연일은 수능 등록으로 보지 않는다.
 assert.ok(D.examReminder('2027-11-01',{'2027-11-05':{open:30,close:0,reason:'전산 장애'}}));
});
test('설정 창에서 입력한 수능일은 calendar.json openDelays에 저장되고 지연표 · 미등록 알림 · LS 누적에 바로 쓰인다',async t=>{
 const {createTradingSession,install,current}=require('../../trading-session');const before=current();t.after(()=>install(before));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'exam-day-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const file=path.join(directory,'calendar.json');
 fs.writeFileSync(file,JSON.stringify({days:{'2027-11-18':true,'2027-11-23':false},checkedDay:'',validatedDay:''}));
 const session=createTradingSession({directory,loadCalendar:async()=>[],now:()=>Date.parse('2027-10-25T09:00:00+09:00')});install(session);
 assert.ok(D.examReminder('2027-10-25'));
 session.setExamDay('2027-11-18');
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).openDelays,{'2027-11-18':{open:60,close:60,reason:'수능'}});
 assert.match(fs.readFileSync(file,'utf8'),/\n {4}"2027-11-18": true,\n/); // 세로 형식 유지
 assert.equal(D.openDelay('2027-11-18'),60);assert.equal(D.closeDelay('2027-11-18'),60);assert.equal(D.examReminder('2027-10-25'),null);
 // 같은 해를 다시 입력하면 바꾼다(한 해에 수능 하나).
 session.setExamDay('2027-11-19');
 assert.deepEqual(Object.keys(session.openDelays()),['2027-11-19']);assert.equal(D.openDelay('2027-11-18'),0);assert.equal(D.openDelay('2027-11-19'),60);assert.equal(D.closeDelay('2027-11-19'),60);
 // 잘못된 입력
 for(const [date,re] of [['2027-11-23',/휴장일/],['2027-11-21',/휴장일/],['2027-13-01',/날짜 형식/],['',/날짜 형식/],['2028-11-16',/올해\(2027년\) 날짜만/]])
  assert.throws(()=>session.setExamDay(date),re);
 // 서버를 다시 띄워도(파일에서 읽기) 남아 있다.
 const reloaded=createTradingSession({directory,loadCalendar:async()=>[],now:()=>Date.parse('2027-10-25T09:00:00+09:00')});install(reloaded);
 assert.equal(D.openDelay('2027-11-19'),60);
 // LS 시장 누적도 입력한 날은 10:00 시작을 완전한 날로 본다.
 const data=createBrokerTurnoverData({broker:'ls',directory:fs.mkdtempSync(path.join(directory,'ls-')),now:()=>timestamp('20271119','110000'),pause:async()=>{},log:()=>{},transport:{setStreams(){}},getToken:async()=>'x',
  http:{post:async(url,body)=>{const tr=Object.keys(body)[0].replace('InBlock','');return {data:{rsp_cd:'00000',[tr+'OutBlock1']:[{date:'20271119',time:'100100',value:10}],[tr+'OutBlock']:{cts_date:'',cts_time:''}}};}}});
 t.after(()=>data.stop());
 assert.equal((await data.amounts('kospi','minute',['20271119'],true)).values.get(timestamp('20271119','100000')),10000000);
 reloaded.removeExamDay('2027-11-19');assert.equal(D.openDelay('2027-11-19'),0);assert.throws(()=>reloaded.removeExamDay('2026-11-19'),/등록된 수능일이 아닙니다/);
});
test('화면용 openDelayMap은 표의 수능일과 달력으로 찾은 새해 첫 거래일을 늦춘 분으로 준다',()=>{
 const open=calendar({'2027-01-01':false,'2027-01-04':true,'2027-01-05':true,'2026-11-19':true});
 assert.deepEqual(D.openDelayMap(['2027-01-01','2027-01-04','2027-01-05'],open),{'2026-11-19':60,'2027-01-04':60});
});
