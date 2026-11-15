'use strict';
// VI 창 선물 괴리율 "—" (2026-11-13):
//  - 같은 종목의 두 번째 행(다른 거래소 · 다시 발동)이 앞 행의 선물 확인 결과를 넘겨받지 못해 '미지원' 대신 "—"였다(브이엠 KRX 행).
//  - 가격이 발동 · 해제 순간에 들어왔는지만 보지 않고 LS t8402 거래량으로 오늘 체결을 확인한다: 거래량 0이면 '체결 없음'
//    (전일 종가로 괴리율을 만들지 않음), 체결이 있었는데 가격이 없으면 t8402 현재가(마지막 체결가)를 쓴다.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createViMonitor}=require('../../vi-monitor-service');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const at=hhmmss=>Date.parse('2026-11-13T'+hhmmss.slice(0,2)+':'+hhmmss.slice(2,4)+':'+hhmmss.slice(4,6)+'+09:00');
const real=(item,time,release='000000')=>({trnm:'REAL',data:[{type:'1h',item,values:{'1223':time,'1224':release,'9068':'1','9069':'1','9008':'101'}}]});
// LS mock: 089970 has no stock futures; 005930 has A116C000 (12월, traded today) and A1171000 (1월, no trade today:
// 거래량 0 and 현재가 = 전일 종가 99,000, like NC 202703 on 2026-11-13).
function lsHttp(state) {
    return {post:async(url,body,{headers})=>{
        const data={rsp_cd:'00000'},tr=headers.tr_cd;state.calls.push(tr+':'+(body[tr+'InBlock']?.focode||''));
        if(tr==='t8436')data.t8436OutBlock=[{shcode:'089970',hname:'브이엠',gubun:'2'},{shcode:'005930',hname:'삼성전자',gubun:'1'}];
        if(tr==='t8401')data.t8401OutBlock=[{basecode:'A005930',shcode:'A116C000',hname:'삼성전자 F 202612'},{basecode:'A005930',shcode:'A1171000',hname:'삼성전자 F 202701'}];
        if(tr==='t8402') {
            const code=body.t8402InBlock.focode;
            if(state.fail)throw Error('LS 시간 초과');
            data.t8402OutBlock=code==='A116C000'?{lastmonth:'20261210',recprice:'100000',mulcnt:'10',volume:1461871,price:state.recentPrice}
                :{lastmonth:'20270114',recprice:'99000',mulcnt:'10',volume:state.nextVolume,price:state.nextPrice};
        }
        return {data};
    }};
}
const feed=()=>({start(){},stop(){},watch(){},unwatch(){},state:()=>({wanted:0}),nxtSupported:()=>true,snapshot(){}});
async function until(check,label) {
    for(let i=0;i<300;i++){if(check())return;await pause(10);}
    assert.fail('timed out: '+label);
}

test('a later row of the same stock takes over the futures check (no stock futures stays 미지원, not "—")',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-fut-'));
    let clock=at('111830');const state={calls:[],recentPrice:100500,nextVolume:0,nextPrice:99000};
    const m=createViMonitor({now:()=>clock,policy:()=>null,directory,getToken:async()=>'ls',http:lsHttp(state),quoteFeed:feed(),releaseWaitMs:5});
    try {
        m.start();
        const row=exchange=>m.snapshot().rows.find(r=>r.code==='089970'&&r.exchange===exchange);
        m.receive(real('089970_NX','111830'));
        await until(()=>row('NXT')?.futuresSupported===false,'NXT row futures check');
        assert.equal(row('NXT').gap.FUT,'미지원');
        // 4 minutes later the KRX VI of the same stock makes a new row (the enrichment is already done).
        clock=at('112227');m.receive(real('089970','112227'));
        assert.equal(row('KRX').gap.FUT,'미지원','the KRX row must show 미지원 like the NXT row');
        clock=at('112439');m.receive(real('089970','112227','112439'));
        await until(()=>row('KRX').atRelease,'KRX release values');
        assert.equal(row('KRX').atRelease.gap.FUT,'미지원','the value frozen at the release is 미지원 too');
        // The same KRX row activated again keeps it.
        clock=at('113000');m.receive(real('089970','113000'));
        assert.equal(row('KRX').gap.FUT,'미지원');
    } finally { m.stop?.(); }
});

test('rows saved with the old empty value are repaired on restart',()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-fut-'));
    const base={code:'089970',name:'브이엠',market:'Q',kind:'1',direction:'up',active:false,count:1};
    fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({day:'2026-11-13',rows:[
        {...base,exchange:'NXT',startedAt:at('111830'),lastEventAt:at('112030'),releasedAt:at('112030'),contracts:[],futuresChecked:true,atRelease:{gap:{KRX:0,NXT:'Base',FUT:'미지원'}}},
        {...base,exchange:'KRX',startedAt:at('112227'),lastEventAt:at('112439'),releasedAt:at('112439'),contracts:[],atRelease:{gap:{KRX:'Base',NXT:0.34,FUT:{recent:null,next:null}},futures:{recent:null,next:null}}}]}));
    const m=createViMonitor({now:()=>at('150000'),policy:()=>null,directory,getToken:async()=>'ls',http:lsHttp({calls:[]}),quoteFeed:feed()});
    const krx=m.snapshot().rows.find(r=>r.exchange==='KRX');
    assert.equal(krx.atRelease.gap.FUT,'미지원');assert.equal(krx.futuresSupported,false);
});

// 2026-11-14: the futures cell is one month (the watched month: more volume the day before; the nearest until it is known).
test('the watched month without trades today shows 체결 없음; a traded one without a realtime price uses the LS last price',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-fut-'));
    let clock=at('100000');const state={calls:[],recentPrice:100500,nextVolume:0,nextPrice:99000};
    const make=()=>createViMonitor({now:()=>clock,policy:()=>null,directory,getToken:async()=>'ls',http:lsHttp(state),quoteFeed:feed(),releaseWaitMs:5,restGapMs:1});
    let m=make();
    const row=()=>m.snapshot().rows.find(r=>r.code==='005930'&&r.exchange==='KRX');
    try {
        m.start();m.receive(real('005930','100000'));
        await until(()=>row()?.contracts?.length===2,'futures months');
        m.onQuote({exchange:'KRX',key:'005930',price:100000,rate:1,via:'REST',receivedAt:clock});
        await until(()=>typeof row().gap.FUT==='number','watched month gap');
        assert.equal(row().futuresBase.code,'A116C000','the nearest month until the watched month is known');
        assert.equal(Math.round(row().gap.FUT*100)/100,0.5,'traded month: t8402 last price 100,500 against KRX 100,000');
    } finally { m.stop?.(); }
    // The watched month is the next month (it had more volume the day before) and has not traded today: 체결 없음, not the previous close.
    await pause(100);
    fs.writeFileSync(path.join(directory,'futures-base.json'),JSON.stringify({day:'2026-11-13',base:{'005930':{futcode:'A1171000',name:'삼성전자 F 202701',month:'202701'}},volumes:{}}));
    clock=at('101000');state.calls.length=0;state.recentPrice=100700;
    m=make();
    try {
        m.start();m.receive(real('005930','101000'));
        await until(()=>row()?.gap?.FUT==='체결 없음','idle watched month');
        assert.equal(row().futuresBase.code,'A1171000');assert.equal(row().futuresBase.volume,0);
        // Before 2026-11-13 the previous close 99,000 was used here (−1.00%, a stale gap). A realtime trade replaces 체결 없음.
        m.onQuote({exchange:'KRX',key:'005930',price:100000,rate:1,via:'REST',receivedAt:clock});
        clock+=1000;m.onQuote({exchange:'FUT',key:'A1171000',price:101000,via:'WS',receivedAt:clock});
        assert.equal(Math.round(row().gap.FUT*100)/100,1);
    } finally { m.stop?.(); }
});

test('a futures gap empty at the release is filled from t8402 right after it',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-fut-'));
    let clock=at('100000');const state={calls:[],recentPrice:100800,nextVolume:3,nextPrice:98000,fail:true};
    // Months already known from today's saved masters (as after a restart), and t8402 failing: no futures price, no trade check.
    fs.writeFileSync(path.join(directory,'masters.json'),JSON.stringify({day:'2026-11-13',stocks:[['005930','삼성전자','K']],
        futures:[{basecode:'A005930',shcode:'A116C000',hname:'삼성전자 F 202612'},{basecode:'A005930',shcode:'A1171000',hname:'삼성전자 F 202701'}],
        expiries:{A116C000:'20261210',A1171000:'20270114'},futuresRefs:{A116C000:100000,A1171000:99000},futuresMul:{A116C000:10,A1171000:10}}));
    const m=createViMonitor({now:()=>clock,policy:()=>null,directory,getToken:async()=>'ls',http:lsHttp(state),quoteFeed:feed(),releaseWaitMs:5,restGapMs:1});
    const row=()=>m.snapshot().rows.find(r=>r.code==='005930'&&r.exchange==='KRX');
    try {
        m.start();m.receive(real('005930','100000'));
        await until(()=>row()?.contracts?.length===2&&state.calls.filter(c=>c.startsWith('t8402')).length>=2,'futures months');
        await pause(30);
        m.onQuote({exchange:'KRX',key:'005930',price:100000,rate:1,via:'REST',receivedAt:clock});
        assert.equal(row().gap.FUT,null,'nothing known about the futures yet ("—")');
        // LS answers again; the release finds no futures price and asks t8402 right away.
        state.fail=false;clock=at('100200');m.receive(real('005930','100000','100200'));
        await until(()=>row().atRelease?.gap?.FUT!=null,'release futures filled');
        assert.equal(Math.round(row().atRelease.gap.FUT*100)/100,0.8);
        assert.equal(row().atRelease.futuresBase.code,'A116C000','the release values name their month');
    } finally { m.stop?.(); }
});

test('released futures values are checked against KIS 1-minute bars once after a restart',async()=>{
    // 원익QnC 2026-11-13: the KRX row released 12:44:07 kept −12.41% for a month without a KIS bar that day (the previous close
    // seeded as a price), and its NXT row kept nothing.
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-fut-'));
    const contracts=[{code:'AHN6C000',name:'원익QnC F 202612',expiry:'20261210'},{code:'AHN71000',name:'원익QnC F 202701',expiry:'20270114'}];
    const base={code:'074600',name:'원익QnC',market:'Q',kind:'1',direction:'up',active:false,count:1,futuresChecked:true,contracts};
    const dec={code:'AHN6C000',name:'원익QnC F 202612',month:'202612'},jan={code:'AHN71000',name:'원익QnC F 202701',month:'202701'};
    fs.writeFileSync(path.join(directory,'state.json'),JSON.stringify({day:'2026-11-13',rows:[
        {...base,exchange:'KRX',startedAt:at('124152'),lastEventAt:at('124407'),releasedAt:at('124407'),atRelease:{basePrice:28200,futuresBase:jan,gap:{KRX:'Base',NXT:2.13,FUT:-12.41}}},
        {...base,exchange:'NXT',startedAt:at('133834'),lastEventAt:at('134034'),releasedAt:at('134034'),atRelease:{basePrice:29500,futuresBase:dec,gap:{KRX:0,NXT:'Base',FUT:null}}},
        {...base,code:'074601',exchange:'KRX',startedAt:at('124152'),lastEventAt:at('124407'),releasedAt:at('124407'),atRelease:{basePrice:28200,futuresBase:dec,gap:{KRX:'Base',NXT:1,FUT:0.18}}}]}));
    const asked=[];
    // KIS bars are labelled by their start minute and come newest first from the asked time back.
    const futuresMinute=async({code,date,hour})=>{asked.push(code+'@'+hour);
        if(code==='AHN701')return [];
        return [{stck_bsop_date:date,stck_cntg_hour:'134100',futs_prpr:'29600'},{stck_bsop_date:date,stck_cntg_hour:'134000',futs_prpr:'29750'},{stck_bsop_date:date,stck_cntg_hour:'124400',futs_prpr:'28250'},{stck_bsop_date:'20261112',stck_cntg_hour:'154500',futs_prpr:'1'}]
            .filter(b=>b.stck_bsop_date!==date||b.stck_cntg_hour<=hour);};
    const make=()=>createViMonitor({now:()=>at('150000'),policy:()=>null,directory,getToken:async()=>'ls',http:lsHttp({calls:[]}),quoteFeed:feed(),enabled:()=>true,
        WebSocket:class{constructor(){throw Error('no socket in this test');}},kiwoomToken:async()=>'k',futuresMinute});
    let m=make();
    const rel=(code,exchange)=>m.snapshot().rows.find(r=>r.code===code&&r.exchange===exchange).atRelease;
    try {
        m.start();
        await until(()=>rel('074600','NXT').futuresVerified&&rel('074600','KRX').futuresVerified&&rel('074601','KRX').futuresVerified,'checked');
        assert.deepEqual(asked.sort(),['AHN612@124407','AHN612@134034','AHN701@124407'],'LS AHN6C000 → KIS AHN612, AHN71000 → AHN701, asked at the release time');
        assert.equal(rel('074601','KRX').gap.FUT,0.18,'a value taken at the release stays while the bars show trades');
        assert.equal(rel('074600','KRX').gap.FUT,'체결 없음','no bar before the release: the −12.41% came from the previous close');
        assert.deepEqual(rel('074600','KRX').futuresCorrected,{before:-12.41,source:'한투 분봉 없음(해제까지 체결 없음)'});
        assert.equal(Math.round(rel('074600','NXT').gap.FUT*100)/100,Math.round((29750/29500-1)*10000)/100,'the 13:40 bar, not the later 13:41 bar');
        assert.equal(rel('074600','NXT').futuresCorrected.source,'한투 분봉 13:40 종가');
    } finally { m.stop(); }
    await pause(200);asked.length=0;m=make();
    try { m.start();await pause(100);assert.deepEqual(asked,[],'each released row is checked once'); } finally { m.stop(); }
});

