'use strict';
// 주식선물 가격제한 도달 행 (2026-11-14 정책): futures-limit-watch.js + vi-monitor-service.js.
// 감시 월물(전일 거래량) · JD0 근처 → JC0 등록(해지 30초 지연) · 체결가 = 한도 → "+10% 도달" · 5분 카운트다운 · 해제 대기 ·
// JX0 확대 = 해제(해제 뒤 첫 체결 1분, 없으면 체결 없음) · 확대 뒤 다음 단계 도달 · 3단계 마지막 단계 · 15:45 해제 신호 없음 ·
// CB 뒤 늦은 확대 = 가격제한폭 先확대(CB 없으면 원인 미확인) · 놓친 도달 역산(≈) · 1% 판정은 1분 안 체결만 · 체결강도.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createFuturesLimitWatch}=require('../../futures-limit-watch');
const {createViMonitor}=require('../../vi-monitor-service');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const at=s=>Date.parse(s+'+09:00');
test('watch: JD0 near → JC0 wanted, 30 s delayed removal cancelled by a return, hit at the limit, next stage after JX0',async()=>{
    let clock=at('2026-11-16T10:00:00');const subs=[],hits=[],expands=[],timers=[];
    const w=createFuturesLimitWatch({now:()=>clock,onSubscriptions:s=>subs.push(s.join(',')),onHit:h=>hits.push(h),onExpand:e=>expands.push(e),
        timer:(fn,ms)=>{const t={fn,due:clock+ms,done:false};timers.push(t);return t;},clear:t=>{t.done=true;}});
    const run=()=>{for(const t of timers)if(!t.done&&t.due<=clock){t.done=true;t.fn();}};
    w.receive('JD0',{futcode:'A116C000',dy_gubun:'2',dy_uplmtprice:'110000',dy_dnlmtprice:'90000'});
    w.receive('JD0',{futcode:'A116C000',dy_gubun:'1',dy_uplmtprice:'101000',dy_dnlmtprice:'99000'});
    assert.deepEqual(w.subscriptions(),[],'far from the limit');
    w.receive('JD0',{futcode:'A116C000',dy_gubun:'1',dy_uplmtprice:'110000',dy_dnlmtprice:'107000'});
    assert.deepEqual(w.subscriptions(),['A116C000'],'(실)상한가 = 그날 상한가 → JC0');
    w.receive('JD0',{futcode:'A116C000',dy_gubun:'1',dy_uplmtprice:'108000',dy_dnlmtprice:'104000'});
    clock+=20000;run();assert.deepEqual(w.subscriptions(),['A116C000'],'removal waits 30 s');
    w.receive('JD0',{futcode:'A116C000',dy_gubun:'1',dy_uplmtprice:'110000',dy_dnlmtprice:'107500'});
    clock+=20000;run();assert.deepEqual(w.subscriptions(),['A116C000'],'came back within 30 s: the removal is cancelled');
    w.receive('JD0',{futcode:'A116C000',dy_gubun:'1',dy_uplmtprice:'108000',dy_dnlmtprice:'104000'});
    clock+=31000;run();assert.deepEqual(w.subscriptions(),[],'removed 30 s after it left');
    assert.deepEqual(subs,['A116C000','']);
    // Near again; trades below and at the limit.
    w.receive('JD0',{futcode:'A116C000',dy_gubun:'1',dy_uplmtprice:'110000',dy_dnlmtprice:'108000'});
    w.receive('JC0',{futcode:'A116C000',price:'109500',cpower:'120.5'});assert.equal(hits.length,0);
    w.receive('JC0',{futcode:'A116C000',price:'110000',cpower:'131.2'});w.receive('JC0',{futcode:'A116C000',price:'110000'});
    assert.deepEqual(hits.map(h=>[h.side,h.stage,h.limit,h.cpower]),[['up',1,110000,131.2]],'one hit per stage');
    // Expansion: stage 2 limit 120000; kept subscribed although JD0 stops; the next hit is +20%.
    w.receive('JX0',{futcode:'A116C000',upstep:'02',dnstep:'01',uplmtprice:'120000',dnlmtprice:'90000'});
    assert.deepEqual(expands.map(e=>[e.side,e.step,e.limit]),[['up',2,120000]]);
    clock+=60000;run();assert.deepEqual(w.subscriptions(),['A116C000'],'expanded months stay registered');
    w.receive('JC0',{futcode:'A116C000',price:'120000'});assert.deepEqual(hits.at(-1)&&[hits.at(-1).stage,hits.at(-1).limit],[2,120000]);
    // Before the first trade (dy_gubun 2) is not a near signal; a JD0 without known limits asks for them.
    const asked=[];const w2=createFuturesLimitWatch({now:()=>clock,needLimits:c=>asked.push(c)});
    w2.receive('JD0',{futcode:'A1F6C000',dy_gubun:'1',dy_uplmtprice:'5000',dy_dnlmtprice:'4900'});assert.deepEqual(asked,['A1F6C000']);
});
// LS REST stub: masters, t8402 (기준가 100,000 · 한도 110,000/90,000), t8404 체결, t8405 일별 거래량.
function lsStub(calls,{volumes={},trades={}}={}){
    return {post:async(url,body,{headers})=>{
        const tr=headers.tr_cd,i=body[tr+'InBlock']||{};calls.push(tr+':'+(i.focode||i.shcode||i.gubun||''));
        const ok=data=>({data:{rsp_cd:'00000',...data}});
        if(tr==='t8436')return ok({t8436OutBlock:[{shcode:'005930',hname:'삼성전자',gubun:'1'},{shcode:'000660',hname:'SK하이닉스',gubun:'1'}]});
        if(tr==='t8401')return ok({t8401OutBlock:[
            {basecode:'A005930',shcode:'A116C000',hname:'삼성전자 F 202612'},{basecode:'A005930',shcode:'A1171000',hname:'삼성전자 F 202701'},{basecode:'A005930',shcode:'A1172000',hname:'삼성전자 F 202702'},
            {basecode:'A000660',shcode:'A126C000',hname:'SK하이닉스 F 202612'},{basecode:'A000660',shcode:'A1271000',hname:'SK하이닉스 F 202701'}]});
        if(tr==='t8402')return ok({t8402OutBlock:{price:'100000',recprice:'100000',volume:'100',mulcnt:'10',lastmonth:i.focode.endsWith('6C000')?'20261210':'20270114',uplmtprice:'110000',dnlmtprice:'90000'}});
        if(tr==='t8404')return ok({t8404OutBlock1:trades[i.focode]||[{chetime:'100000',price:100000,chdegree:'95.5'}]});
        if(tr==='t8405')return ok({t8405OutBlock1:[{date:'20261113',volume:volumes[i.shcode]??0},{date:'20261112',volume:1}]});
        return ok({});
    }};
}
function monitor(clock,extra={}){
    const calls=[],directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-fut-limit-'));
    const m=createViMonitor({directory,now:()=>clock.t,policy:()=>({openDate:()=>true,spotAt:()=>true}),enabled:()=>false,http:lsStub(calls,extra.ls),getToken:async()=>'x',kiwoomToken:async()=>'x',
        futuresEventMs:300,futuresWaitMs:150,lateMs:100,unsubscribeDelayMs:50,releaseWaitMs:50,restGapMs:1,...extra.options});
    return {m,calls,directory};
}
const ev=(m,tr,body,t)=>m.onFuturesEvent({tr,futcode:body.futcode,body,receivedAt:t});
test('service: +10% 도달 row from the trade at the limit, countdown, 해제 대기, JX0 release with the first trade, 체결강도, rows by stage',async()=>{
    const clock={t:at('2026-11-16T10:00:00')};const {m}=monitor(clock);
    await ev(m,'JD0',{futcode:'A116C000',dy_gubun:'2',dy_uplmtprice:'110000',dy_dnlmtprice:'90000'},clock.t);
    await ev(m,'JD0',{futcode:'A116C000',dy_gubun:'1',dy_uplmtprice:'110000',dy_dnlmtprice:'107000'},clock.t);
    await pause(30);
    assert.ok((await m.futuresRegistrations()).some(([tr,k])=>tr==='JC0'&&k==='A116C000'),'JC0 registered while near');
    await ev(m,'JC0',{futcode:'A116C000',price:'110000',cpower:'131.2'},clock.t);await pause(40);
    let row=m.snapshot().rows.find(r=>r.exchange==='FUT');
    assert.equal(row.kindText,'+10% 도달');assert.equal(row.active,true);assert.equal(row.startedAt,clock.t);assert.equal(row.cpower.value,131.2);assert.equal(row.contract.code,'A116C000');
    assert.equal(Math.round(row.rate*100)/100,10,'futures 등락률 against the t8402 기준가');
    // 5 minutes (300 ms here) without JX0: 해제 대기.
    await pause(320);row=m.snapshot().rows.find(r=>r.exchange==='FUT');assert.equal(row.active,true);assert.equal(row.waiting,true);
    // JX0 (late: more than lateMs after the 5 minutes, no CB) → released, cause unknown; the first trade after it fixes the values.
    clock.t+=1000;await ev(m,'JX0',{futcode:'A116C000',upstep:'02',dnstep:'01',uplmtprice:'120000',dnlmtprice:'90000'},clock.t);await pause(20);
    row=m.snapshot().rows.find(r=>r.exchange==='FUT');assert.equal(row.active,false);assert.equal(row.releasedAt,clock.t);assert.equal(row.kindText,'+10% 도달');assert.match(row.lateNote,/원인 미확인/);
    assert.equal(row.releasePending,true);
    await ev(m,'JC0',{futcode:'A116C000',price:'111000'},clock.t+10);await pause(20);
    row=m.snapshot().rows.find(r=>r.exchange==='FUT');assert.equal(row.releasePending,false);assert.match(row.atRelease.basis,/JX0 상한 2단계 확대 수신 · 해제 뒤 첫 선물 체결/);assert.equal(Math.round(row.atRelease.rate*100)/100,11);
    // +20% 도달: a separate row; stage 3 is the last.
    await ev(m,'JC0',{futcode:'A116C000',price:'120000'},clock.t+20);await pause(30);
    assert.deepEqual(m.snapshot().rows.filter(r=>r.exchange==='FUT').map(r=>r.kindText).sort(),['+10% 도달','+20% 도달']);
    await ev(m,'JX0',{futcode:'A116C000',upstep:'03',dnstep:'01',uplmtprice:'130000',dnlmtprice:'90000'},clock.t+400);await pause(10);
    await ev(m,'JC0',{futcode:'A116C000',price:'130000'},clock.t+500);await pause(30);
    await pause(850);row=m.snapshot().rows.find(r=>r.kindText==='+30% 도달');assert.equal(row.active,false);assert.match(row.releaseBasis,/마지막 단계/);
    m.stop();
});
test('service: no trade within a minute after the release = 체결 없음; CB inside the 5 minutes = 가격제한폭 先확대; backfill ≈; 15:45 해제 신호 없음',async()=>{
    const clock={t:at('2026-11-16T13:05:00')};const {m}=monitor(clock);
    for(const c of ['A116C000','A126C000'])await ev(m,'JD0',{futcode:c,dy_gubun:'2',dy_uplmtprice:'110000',dy_dnlmtprice:'90000'},clock.t);
    await ev(m,'JD0',{futcode:'A116C000',dy_gubun:'1',dy_uplmtprice:'110000',dy_dnlmtprice:'107000'},clock.t);
    await ev(m,'JC0',{futcode:'A116C000',price:'110000'},clock.t);await pause(40);
    // KOSPI CB at 13:09 (within 5 minutes), resumption 13:29, expansion right after.
    await ev(m,'JIF',{jangubun:'1',jstatus:'61'},clock.t+100);await ev(m,'JIF',{jangubun:'1',jstatus:'62'},clock.t+400);
    await pause(320);
    await ev(m,'JX0',{futcode:'A116C000',upstep:'02',dnstep:'01',uplmtprice:'120000',dnlmtprice:'90000'},clock.t+500);await pause(200);
    let row=m.snapshot().rows.find(r=>r.contract?.code==='A116C000');
    assert.equal(row.kindText,'가격제한폭 先확대');assert.equal(row.reachText,'+10% 도달');assert.ok(row.preExpand.cbAt&&row.preExpand.resumeAt);
    assert.equal(row.atRelease.noTrade,true,'no futures trade within the wait');assert.equal(row.atRelease.gap.FUT,'Base');assert.match(row.atRelease.basis,/1분 선물 체결 없음/);
    // Missed hit: JX0 only → a row from JX0 − 5분 (backfilled), released at once.
    clock.t=at('2026-11-16T14:00:00');
    await ev(m,'JX0',{futcode:'A126C000',upstep:'01',dnstep:'02',uplmtprice:'110000',dnlmtprice:'80000'},clock.t);await pause(60);
    row=m.snapshot().rows.find(r=>r.contract?.code==='A126C000');
    assert.equal(row.backfilled,true);assert.equal(row.kindText,'-10% 도달');assert.equal(row.startedAt,clock.t-300);assert.equal(row.active,false);
    // 15:45: a row waiting for its expansion closes with 해제 신호 없음; a closing-auction row says so.
    clock.t=at('2026-11-16T15:40:00');
    await ev(m,'JD0',{futcode:'A126C000',dy_gubun:'1',dy_uplmtprice:'84000',dy_dnlmtprice:'80000'},clock.t);
    await ev(m,'JC0',{futcode:'A126C000',price:'80000'},clock.t);await pause(40);
    row=m.snapshot().rows.find(r=>r.kindText==='-20% 도달');assert.equal(row.window,'closing');
    clock.t=at('2026-11-16T15:45:00');m.tick();await pause(10);
    row=m.snapshot().rows.find(r=>r.kindText==='-20% 도달');assert.equal(row.active,false);assert.equal(row.releaseBasis,'해제 신호 없음');assert.match(row.closeNote,/동시호가/);
    m.stop();
});
test('service: watched month = more volume the day before (최근월 · 차월); registrations; 선물 칸 uses it; 1% only with trades within a minute',async()=>{
    const clock={t:at('2026-11-16T08:20:00')};
    const {m,calls}=monitor(clock,{ls:{volumes:{A116C000:500,A1171000:9000,A126C000:800,A1271000:10}}});
    const base=await m.baseContracts();
    assert.deepEqual(Object.fromEntries(Object.entries(base).map(([k,v])=>[k,v.futcode])),{'005930':'A1171000','000660':'A126C000'});
    assert.equal(calls.filter(c=>c.startsWith('t8405')).length,4,'two months per stock');
    const regs=await m.futuresRegistrations();
    assert.deepEqual(regs.slice(0,5).map(x=>x.join(':')),['JIF:0','JX0:A1171000','JD0:A1171000','JX0:A126C000','JD0:A126C000']);
    // Expiry day (2026-12-10, second Thursday): the expiring month is not a candidate.
    const c2={t:at('2026-12-10T08:20:00')};const {m:m2,calls:k2}=monitor(c2);const b2=await m2.baseContracts();
    assert.equal(b2['005930'].futcode,'A1171000');assert.deepEqual(b2['005930'].candidates,['A1171000','A1172000']);m2.stop();
    // KRX VI: 선물 칸 = watched month (A1171000); a stale NXT price is shown but not used for the 1% check.
    clock.t=at('2026-11-16T10:00:00');
    m.onQuote({exchange:'NXT',key:'005930',price:102000,via:'WS',receivedAt:clock.t-120000});
    m.onQuote({exchange:'FUT',key:'A1171000',price:100500,via:'WS',receivedAt:clock.t});
    m.receive(JSON.stringify({trnm:'REAL',data:[{type:'1h',item:'005930',values:{'1223':'095959','1224':'000000','9068':'1','9069':'1','9008':'001'}}]}));
    m.onQuote({exchange:'KRX',key:'005930',price:100000,via:'WS',receivedAt:clock.t});
    await pause(60);
    const row=m.snapshot().rows.find(r=>r.exchange==='KRX');
    assert.equal(row.futuresBase.code,'A1171000');assert.equal(Math.round(row.gap.FUT*100)/100,0.5);assert.equal(Math.round(row.gap.NXT),2);
    assert.equal(row.gapHit,undefined,'NXT +2% is two minutes old: not a 1% hit');
    m.onQuote({exchange:'NXT',key:'005930',price:102000,via:'WS',receivedAt:clock.t});await pause(20);
    assert.equal(m.snapshot().rows.find(r=>r.exchange==='KRX').gapHit.kind,'NXT','a fresh trade counts');
    m.stop();
});
