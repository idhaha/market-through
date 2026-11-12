'use strict';
// VI 창 2026-11-09: 괴리율 1% 이상 감지(발동부터 해제 전까지 한 번이라도 |괴리율| ≥ 1%), 발동부터 4분간 각 시장 현재가 기록,
// 미지원(NXT 미상장은 NXT 괴리율에만, 주식선물 없음은 선물 괴리율에만), 발동 때 KRX 현재가 한 번 조회.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createViMonitor}=require('../../vi-monitor-service');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const at=hhmmss=>Date.parse('2026-11-09T'+hhmmss.slice(0,2)+':'+hhmmss.slice(2,4)+':'+hhmmss.slice(4,6)+'+09:00');
const real=(item,time,release='000000')=>({trnm:'REAL',data:[{type:'1h',item,values:{'1223':time,'1224':release,'9068':'1','9069':'1','9008':'001'}}]});
function lsHttp(){
    return {post:async(url,body,{headers})=>{
        const data={rsp_cd:'00000'};
        if(headers.tr_cd==='t8436')data.t8436OutBlock=[{shcode:'005930',hname:'삼성전자',gubun:'1'},{shcode:'000001',hname:'선물없음',gubun:'2'}];
        if(headers.tr_cd==='t8401')data.t8401OutBlock=[{basecode:'A005930',shcode:'A116B000',hname:'삼성전자 F 202611'},{basecode:'A005930',shcode:'A116C000',hname:'삼성전자 F 202612'}];
        if(headers.tr_cd==='t8402')data.t8402OutBlock={lastmonth:body.t8402InBlock.focode==='A116B000'?'20261112':'20261210',recprice:body.t8402InBlock.focode==='A116B000'?'100000':''};
        return {data};
    }};
}
test('a VI whose 괴리율 reaches 1% before the release is flagged and its first 4 minutes of prices are recorded',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-gap-'));
    let clock=at('090500');const snapshots=[],timers=[];
    const quoteFeed={start(){},stop(){},watch(){},unwatch(){},state:()=>({wanted:0}),nxtSupported:code=>code!=='000001',snapshotKrx:code=>snapshots.push(code)};
    const m=createViMonitor({now:()=>clock,policy:()=>({spotAt:()=>false}),directory,getToken:async()=>'ls',kiwoomToken:async()=>'k',http:lsHttp(),quoteFeed,
        recordTimer:(fn,ms)=>{timers.push({fn,ms});return 0;}});
    try{
        m.start();
        m.receive(real('005930','090500'));m.receive(real('000001','090500'));
        assert.deepEqual(snapshots,['005930','000001'],'the KRX current price is asked once when a VI starts');
        for(let i=0;i<200&&!(m.snapshot().rows.find(r=>r.code==='005930')?.contracts?.length&&m.snapshot().rows.find(r=>r.code==='000001')?.futuresSupported===false);i++)await pause(20);
        const row=code=>m.snapshot().rows.find(r=>r.code===code);
        // 미지원 flags, each for its own column only.
        assert.deepEqual([row('000001').nxtSupported,row('000001').futuresSupported],[false,false]);
        assert.deepEqual([row('005930').nxtSupported,row('005930').futuresSupported],[true,true]);
        const quote=(exchange,key,price,extra={})=>m.onQuote({exchange,key,price,via:'WS',receivedAt:clock,...extra});
        // The REST answer at the activation gives the rate even though KRX has no trades during the VI.
        quote('KRX','005930',100000,{rate:2.5,via:'REST'});
        assert.equal(row('005930').rate,2.5);
        clock+=1000;quote('NXT','005930',100500);quote('FUT','A116B000',100900);
        assert.equal(row('005930').gapHit,undefined,'0.5% and 0.9% stay below 1%');
        clock+=30000;quote('NXT','005930',101200);
        assert.deepEqual(row('005930').gapHit,{at:clock,kind:'NXT',value:1.2});
        assert.equal(timers.length,1,'one record per flagged VI');assert.equal(timers[0].ms,240000-31000,'the record ends 4 minutes after the activation');
        clock+=10000;quote('FUT','A116B000',102000);
        assert.deepEqual(row('005930').gapMax,{at:clock,kind:'최근월',value:2,contract:'A116B000'});
        // After the release the gap no longer counts, but prices are still recorded until 4 minutes after the activation.
        assert.deepEqual(row('005930').atStart,{at:at('090500'),rate:2.5,price:100000,via:'REST'},'the change rate at the activation is kept');
        clock=at('090700');m.receive(real('005930','090500','090700'));
        // The release waits for the first KRX trade after it (the single-price match that ends the VI).
        assert.equal(row('005930').releasePending,true);assert.equal(row('005930').atRelease,null);
        clock+=1000;quote('KRX','005930',101000,{rate:3.5});
        const released=row('005930').atRelease;
        assert.deepEqual([released.rate,released.basis,Math.round(released.nxtRate*100)/100,Math.round(released.futures.recent*100)/100],[3.5,'해제 뒤 첫 KRX 체결',0.2,0.99],
            'the release keeps its own change rate and 괴리율 (not the activation values)');
        clock+=5000;quote('NXT','005930',103000);
        assert.equal(row('005930').gapMax.value,2,'a gap after the release does not count');
        clock=at('090900')+1000;quote('NXT','005930',104000);
        timers[0].fn();
        const lines=fs.readFileSync(path.join(directory,'gap-records','2026-11-09.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
        assert.equal(lines.length,1,'000001 never reached 1% and is not recorded');
        const rec=lines[0];
        assert.deepEqual([rec.code,rec.exchange,rec.name,rec.startedAt,rec.releasedAt,rec.recordTo-rec.recordFrom,rec.partial],['005930','KRX','삼성전자',at('090500'),at('090700'),240000,false]);
        // 2026-11-11: no prices; every second for 4 minutes from the activation: [초, Base 등락률, KRX, NXT, 선물 최근월, 선물 차기월].
        assert.equal(rec.prices,undefined,'current prices are not stored');
        assert.deepEqual(rec.secondsFields,['초','Base 등락률','KRX 괴리율','NXT 괴리율','선물 괴리율(최근월)','선물 괴리율(차기월)']);
        assert.equal(rec.seconds.length,241,'0 to 240 seconds');
        assert.deepEqual(rec.seconds[0],[0,2.5,'Base',null,null,null],'KRX is the Base; nothing else known yet');
        assert.deepEqual(rec.seconds[1],[1,2.5,'Base',0.5,0.9,null]);
        assert.deepEqual(rec.seconds[31],[31,2.5,'Base',1.2,0.9,null]);
        assert.deepEqual(rec.seconds[41],[41,2.5,'Base',1.2,2,null]);
        assert.deepEqual(rec.seconds[121],[121,3.5,'Base',0.2,0.99,null],'after the release the single-price match moves the Base');
        assert.deepEqual(rec.seconds[240],[240,3.5,'Base',1.98,0.99,null],'the price after 4 minutes is not used');
        // The VI window columns are saved as shown: at 1%, at the release and at the end of the 4 minutes.
        const hitColumns=rec.columns['1% 도달 때'];
        assert.deepEqual([hitColumns.시장,hitColumns.종목명,hitColumns.등락률,hitColumns['발동 거래소'],hitColumns.구분,hitColumns['발동 시각'],hitColumns['KRX 괴리율'],hitColumns['NXT 괴리율'],hitColumns['KRX 현재가']],['K','삼성전자',2.5,'KRX','정적','09:05:00','Base',1.2,undefined]);
        assert.deepEqual([rec.columns['해제 때'].등락률,rec.columns['해제 때']['해제 시각'],rec.columns['해제 때']['NXT 괴리율']],[3.5,'09:07:00',0.2]);
        assert.equal(rec.columns['4분 끝'].등락률,3.5,'after the release the window shows the release values');
        assert.equal(rec.columns['4분 끝']['해제 시각'],'09:07:00');assert.deepEqual(rec.gapHit.kind,'NXT');
        // The flag is kept on the row (saved in state.json) so every window and a restart see it.
        await pause(200);const saved=JSON.parse(fs.readFileSync(path.join(directory,'state.json'),'utf8'));
        assert.equal(saved.rows.find(r=>r.code==='005930').gapHit.kind,'NXT');
    }finally{m.stop();fs.rmSync(directory,{recursive:true,force:true});}
});
test('without a KRX trade after the release the values at the release event are kept; a restart while waiting stops waiting',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-release-'));
    let clock=at('090500');
    const quoteFeed={start(){},stop(){},watch(){},unwatch(){},state:()=>({wanted:0}),nxtSupported:()=>true,snapshotKrx(){}};
    const options={now:()=>clock,policy:()=>({spotAt:()=>false}),directory,getToken:async()=>'ls',kiwoomToken:async()=>'k',http:lsHttp(),quoteFeed,releaseWaitMs:40};
    const m=createViMonitor(options);
    try{
        m.start();m.receive(real('005930','090500'));
        m.onQuote({exchange:'KRX',key:'005930',price:100000,rate:2.5,via:'REST',receivedAt:clock});m.onQuote({exchange:'NXT',key:'005930',price:100700,via:'WS',receivedAt:clock});
        clock=at('090700');m.receive(real('005930','090500','090700'));
        await pause(120);
        const r=m.snapshot().rows.find(x=>x.code==='005930');
        assert.deepEqual([r.releasePending,r.atRelease.basis,r.atRelease.rate,Math.round(r.atRelease.nxtRate*100)/100],[false,'해제 이벤트 시점(해제 뒤 KRX 체결 미수신)',2.5,0.7]);
        // A second VI waits; the server stops before a trade comes: after the restart the row no longer waits.
        clock=at('091000');m.receive(real('005930','091000'));clock=at('091200');m.receive(real('005930','091000','091200'));
        assert.equal(m.snapshot().rows.find(x=>x.code==='005930').releasePending,true);
        m.stop();await pause(200);
        const restarted=createViMonitor({...options,quoteFeed:null});
        const after=restarted.snapshot().rows.find(x=>x.code==='005930');
        assert.deepEqual([after.releasePending,after.atRelease],[false,null]);restarted.stop();
    }finally{m.stop();fs.rmSync(directory,{recursive:true,force:true});}
});
test('filters: listed shares (ka10099, once a day) and the previous-day trade value (ka10081 _AL, once per stock) give 전일 거래대금 and 시가총액',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-filter-'));
    let clock=at('090500');const kiwoomCalls=[];
    const ls=lsHttp();
    const http={post:async(url,body,options)=>{
        const api=options.headers['api-id'];
        if(!api)return ls.post(url,body,options);
        kiwoomCalls.push(api+':'+(body.stk_cd||body.mrkt_tp));
        if(api==='ka10099')return {data:{return_code:0,list:body.mrkt_tp==='0'?[{code:'005930',listCount:'0000005846278608',lastPrice:'00198900'}]:[]},headers:{'cont-yn':'N'}};
        if(api==='ka10081')return {data:{return_code:0,stk_dt_pole_chart_qry:[{dt:'20261109',trde_prica:'5131040'},{dt:'20261106',trde_prica:'4962835'}]},headers:{}};
        return {data:{return_code:1}};
    }};
    const quoteFeed={start(){},stop(){},watch(){},unwatch(){},state:()=>({wanted:0}),nxtSupported:()=>true,snapshotKrx(){}};
    const options={now:()=>clock,policy:()=>({spotAt:()=>false}),directory,getToken:async()=>'ls',kiwoomToken:async()=>'k',http,quoteFeed};
    const m=createViMonitor(options);
    try{
        m.start();m.receive(real('005930','090500'));
        for(let i=0;i<100&&(m.snapshot().rows[0].prevAmount==null||m.snapshot().rows[0].marketCap==null);i++)await pause(20);
        let r=m.snapshot().rows[0];
        assert.deepEqual([r.prevAmount,r.prevAmountDate,r.prevAmountState],[4962835e6,'20261106','ok'],'the last day before today, KRX+NXT (_AL), million KRW → KRW');
        assert.deepEqual([r.marketCap,r.marketCapBasis],[5846278608*198900,'전일 종가'],'no current price yet: the previous close');
        m.onQuote({exchange:'KRX',key:'005930',price:200000,rate:0.55,via:'WS',receivedAt:clock});
        r=m.snapshot().rows[0];assert.deepEqual([r.marketCap,r.marketCapBasis],[5846278608*200000,'KRX 현재가'],'시가총액 at the current price');
        // A second VI of the same stock asks nothing again; a restart on the same day reads the saved values.
        clock=at('091000');m.receive(real('005930','091000'));await pause(100);
        assert.deepEqual(kiwoomCalls.sort(),['ka10081:005930_AL','ka10099:0','ka10099:10']);
        m.stop();await pause(200);
        const again=createViMonitor({...options,quoteFeed:null});
        assert.equal(again.snapshot().rows[0].prevAmount,4962835e6);again.stop();
    }finally{m.stop();fs.rmSync(directory,{recursive:true,force:true});}
});
test('Base follows the triggering exchange: an NXT VI compares KRX with NXT; a futures JX0 step above 1 makes its own row for 5 minutes; JD0 makes none',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-base-'));
    let clock=at('090500');const snaps=[];
    const quoteFeed={start(){},stop(){},watch(){},unwatch(){},state:()=>({wanted:0}),nxtSupported:()=>true,snapshot:(exchange,code)=>snaps.push(exchange+':'+code)};
    const m=createViMonitor({now:()=>clock,policy:()=>({spotAt:()=>false}),directory,getToken:async()=>'ls',kiwoomToken:async()=>'k',http:lsHttp(),quoteFeed,futuresEventMs:60});
    try{
        m.start();
        // NXT VI: the NXT price is the Base, the activation asks the NXT price once.
        m.receive(real('005930_NX','090500'));assert.deepEqual(snaps,['NXT:005930']);
        for(let i=0;i<200&&!m.snapshot().rows[0]?.contracts?.length;i++)await pause(20);
        const q=(exchange,key,price,extra={})=>m.onQuote({exchange,key,price,via:'WS',receivedAt:clock,...extra});
        q('NXT','005930',100000,{rate:4,amount:5000,via:'REST'});q('KRX','005930',99000,{rate:3,amount:9000});q('FUT','A116B000',101000);
        let r=m.snapshot().rows.find(x=>x.exchange==='NXT');
        assert.equal(r.gap.NXT,'Base');assert.equal(Math.round(r.gap.KRX*100)/100,-1);assert.equal(Math.round(r.gap.FUT.recent*100)/100,1);
        assert.deepEqual([r.rate,r.amount,r.bidAverage],[4,5000,null],'등락률 · 거래대금 from NXT; the KRX book is not shown for an NXT row');
        assert.equal(r.gapHit.kind,'KRX','|KRX ÷ NXT − 1| = 1% counts');
        // Futures event: a JX0 step above 1 (the normal ±10% band) makes a row; its contract is the Base.
        // Message shapes as received on 2026-11-12: the side that did not expand still carries '01'.
        clock=at('091000');
        await m.onFuturesEvent({tr:'JX0',futcode:'A116B000',body:{futcode:'A116B000',upstep:'02',dnstep:'01',uplmtprice:'1200',dnlmtprice:'900'},receivedAt:clock});
        let fut=m.snapshot().rows.find(x=>x.exchange==='FUT');
        assert.deepEqual([fut.code,fut.name,fut.contract.code,fut.contract.month,fut.kindText,fut.direction,fut.durationMs],['005930','삼성전자','A116B000','202611','상한 2단계 확대 (±20%)','up',60]);
        // 선물 등락률 = 선물 현재가 ÷ t8402 기준가(recprice 100,000) − 1; no futures 거래대금.
        assert.deepEqual([Math.round(fut.rate*100)/100,fut.amount],[1,null]);
        assert.equal(fut.gap.FUT,'Base');assert.equal(Math.round(fut.gap.KRX*100)/100,-1.98);assert.equal(Math.round(fut.gap.NXT*100)/100,-0.99);
        // The same step again is not a new event; JD0 (no longer registered) never makes a row, even 2 → 1 at the open.
        await m.onFuturesEvent({tr:'JX0',futcode:'A116B000',body:{futcode:'A116B000',upstep:'02',dnstep:'01'},receivedAt:clock});
        await m.onFuturesEvent({tr:'JD0',futcode:'A116B000',body:{futcode:'A116B000',dy_gubun:'2',dy_uplmtprice:'1100',dy_dnlmtprice:'900',gubun:''},receivedAt:clock});
        await m.onFuturesEvent({tr:'JD0',futcode:'A116B000',body:{futcode:'A116B000',dy_gubun:'1',dy_uplmtprice:'1030',dy_dnlmtprice:'970',gubun:''},receivedAt:clock});
        assert.equal(m.snapshot().rows.filter(x=>x.exchange==='FUT').length,1);
        // After 5 minutes (here 60 ms) the futures row is released with the values at that moment.
        await pause(150);fut=m.snapshot().rows.find(x=>x.exchange==='FUT');
        assert.deepEqual([fut.active,fut.atRelease.basis,fut.atRelease.gap.FUT],[false,'5분 경과','Base']);
        // A first message at step 1 on both sides is the normal band: no row (other contract).
        await m.onFuturesEvent({tr:'JX0',futcode:'A116C000',body:{futcode:'A116C000',upstep:'01',dnstep:'01'},receivedAt:clock});
        assert.equal(m.snapshot().rows.filter(x=>x.exchange==='FUT').length,1);
        // The down step rising makes a new row (DB하이텍 2026-11-12: upstep 01, dnstep 02 was shown as '확대 1단계' before).
        await m.onFuturesEvent({tr:'JX0',futcode:'A116B000',body:{futcode:'A116B000',upstep:'02',dnstep:'02'},receivedAt:clock+1000});
        fut=m.snapshot().rows.find(x=>x.exchange==='FUT'&&x.active);
        assert.deepEqual([fut.kindText,fut.direction],['하한 2단계 확대 (±20%)','down']);
        // A step back down ends the row before its countdown.
        await m.onFuturesEvent({tr:'JX0',futcode:'A116B000',body:{futcode:'A116B000',upstep:'02',dnstep:'01'},receivedAt:clock+2000});
        fut=m.snapshot().rows.find(x=>x.exchange==='FUT'&&x.kindText.startsWith('하한'));
        assert.deepEqual([fut.active,fut.releasedAt,fut.atRelease.basis],[false,clock+2000,'제한폭 축소 이벤트']);
    }finally{m.stop();fs.rmSync(directory,{recursive:true,force:true});}
});
test('NXT row 호가 평균 comes from the KIS NX book while the NXT VI is on (08:00~08:50 has no KRX book, 2026-11-12)',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-nxt-book-'));
    let clock=at('081000');const sets=[];
    const quoteFeed={start(){},stop(){},watch(){},unwatch(){},state:()=>({wanted:0}),nxtSupported:()=>true,snapshot(){}};
    const nxtBook={set:codes=>sets.push([...codes].join(',')),stop(){sets.push('stop');}};
    const m=createViMonitor({now:()=>clock,policy:()=>({spotAt:()=>false}),directory,getToken:async()=>'ls',kiwoomToken:async()=>'k',http:lsHttp(),quoteFeed,nxtBook,releaseWaitMs:50});
    try{
        m.start();
        m.receive(real('005930_NX','081000'));
        assert.equal(sets.at(-1),'005930','the NXT VI starts the NXT book polling for that stock only');
        // A KRX book (NH ob) must not fill the NXT row; the NXT book does.
        m.onQuote({exchange:'KRX',key:'005930',bidAverage:9e9,via:'WS',receivedAt:clock});
        let r=m.snapshot().rows.find(x=>x.exchange==='NXT');assert.equal(r.bidAverage,null);
        m.onQuote({exchange:'NXT',key:'005930',bidAverage:2.5e9,via:'KIS',receivedAt:clock});
        r=m.snapshot().rows.find(x=>x.exchange==='NXT');
        assert.deepEqual([r.bidAverage,r.bidAverageVia],[2.5e9,'KIS']);
        // Release: polling continues until the first NXT trade settles the release, then stops; the value stays.
        clock=at('081200');m.receive(real('005930_NX','081000','081200'));
        assert.equal(sets.at(-1),'005930','still polled while the release waits for the first NXT trade');
        m.onQuote({exchange:'NXT',key:'005930',price:200000,rate:1,via:'WS',receivedAt:clock+1000});
        assert.equal(sets.at(-1),'','no NXT row is on: no polling');
        m.onQuote({exchange:'NXT',key:'005930',bidAverage:1e9,via:'KIS',receivedAt:clock+2000});
        r=m.snapshot().rows.find(x=>x.exchange==='NXT');
        assert.equal(r.atRelease.bidAverage,2.5e9,'the released row keeps the value at the release');
        // A KRX VI does not poll the NXT book.
        clock=at('091000');m.receive(real('000660','091000'));
        assert.equal(sets.at(-1),'');
    }finally{m.stop();assert.equal(sets.at(-1),'stop');fs.rmSync(directory,{recursive:true,force:true});}
});
