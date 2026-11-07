'use strict';
// VI layout of 2026-11-07: LS masters saved once a day, NH price fields, LS token rejection and the off switch of market alerts.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createViMonitor}=require('../../vi-monitor-service');
const {createNhQuoteFeed}=require('../../nh-quote-feed');
const {createLsMarketSupply,lsTokenRejected}=require('../../ls-market-supply');
const {createMarketAlerts}=require('../../market-alert-service');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const clock=Date.parse('2026-11-09T09:05:00+09:00');
const real=(item,time)=>JSON.stringify({trnm:'REAL',data:[{type:'1h',item,values:{'1223':time,'1224':'000000','9068':'1','9069':'1','9008':'001'}}]});
function lsHttp(calls){
    return {post:async(url,body,{headers})=>{
        calls.push(headers.tr_cd);const data={rsp_cd:'00000'};
        if(headers.tr_cd==='t8436')data.t8436OutBlock=[{shcode:'005930',hname:'삼성전자',gubun:'1'}];
        if(headers.tr_cd==='t8401')data.t8401OutBlock=[{basecode:'A005930',shcode:'A116B000',hname:'삼성전자 F 202611'},{basecode:'A005930',shcode:'A116C000',hname:'삼성전자 F 202612'}];
        if(headers.tr_cd==='t8402')data.t8402OutBlock={price:100,lastmonth:body.t8402InBlock.focode==='A116B000'?'20261112':'20261210'};
        return {data};
    }};
}
test('LS masters and futures expiry are fetched once a day and reused after a restart',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-masters-'));
    try{
        // Outside the session the monitor does not connect, but events and enrichment still run.
        const options={now:()=>clock,policy:()=>({spotAt:()=>false}),directory,getToken:async()=>'ls',kiwoomToken:async()=>'k',releaseGraceMs:10};
        const first=[],a=createViMonitor({...options,http:lsHttp(first)});a.start();a.receive(real('005930','090000'));
        for(let i=0;i<200&&!a.snapshot().rows[0]?.contracts?.length;i++)await pause(20);
        assert.deepEqual(first,['t8436','t8401','t8402','t8402']);
        assert.equal(a.snapshot().rows[0].name,'삼성전자');assert.deepEqual(a.snapshot().rows[0].contracts.map(c=>c.code),['A116B000','A116C000']);
        a.stop();await pause(200);
        const saved=JSON.parse(fs.readFileSync(path.join(directory,'masters.json'),'utf8'));
        assert.equal(saved.day,'2026-11-09');assert.deepEqual(saved.expiries,{A116B000:'20261112',A116C000:'20261210'});
        const second=[],b=createViMonitor({...options,http:lsHttp(second)});b.start();b.receive(real('005930','090100'));
        for(let i=0;i<100&&!b.snapshot().rows[0]?.contracts?.length;i++)await pause(20);
        assert.deepEqual(second,[],'A restart on the same day must not query LS again');
        assert.equal(b.snapshot().rows[0].name,'삼성전자');b.stop();
        // A new day fetches the masters again.
        const third=[],c=createViMonitor({...options,now:()=>clock+86400000,http:lsHttp(third)});c.start();c.receive(real('005930','090100'));
        for(let i=0;i<200&&!c.snapshot().rows[0]?.contracts?.length;i++)await pause(20);
        assert.deepEqual(third.slice(0,2),['t8436','t8401']);c.stop();
    }finally{await pause(200);fs.rmSync(directory,{recursive:true,force:true});}
});
test('NH ticks give the VI table its rate (signed by the sign code) and trade value, and two futures months are watched',async()=>{
    class Socket extends EventEmitter{constructor(){super();this.readyState=0;}send(){}close(){}}
    const quotes=[],feed=createNhQuoteFeed({credentials:()=>({appKey:'a',secretKey:'b'}),WebSocket:Socket,onQuote:q=>quotes.push(q),
        fetch:async url=>({ok:true,status:200,json:async()=>String(url).includes('oauth2')?{access_token:'t',expires_in:86400}:{rsp_cd:'00000',Output_0:{stck_prpr:'100'}}})});
    feed.receive(JSON.stringify({header:{tr_cd:'oc',tr_key:'005930'},body:{code:'005930',time:'090501',sign:'5',price:'99000',chrate:'1.50',value:'20867'}}));
    feed.receive(JSON.stringify({header:{tr_cd:'nc',tr_key:'005930'},body:{code:'005930',time:'090501',sign:'2',price:'99500',chrate:'0.50',value:'5420'}}));
    assert.deepEqual(quotes.map(q=>[q.exchange,q.price,q.rate,q.amount]),[['KRX',99000,-1.5,20867],['NXT',99500,0.5,5420]]);
    feed.start();feed.watch('005930',{futures:['A116B000','A116C000']});
    for(let i=0;i<100&&feed.state().wanted<4;i++)await pause(20);
    assert.equal(feed.state().wanted,4,'KRX, NXT and two futures months');feed.stop();
});
test('an LS token rejection clears the cached token once, and market alerts can be switched off',async()=>{
    assert.equal(lsTokenRejected(401,{}),true);
    assert.equal(lsTokenRejected(200,{rsp_cd:'IGW00121',rsp_msg:'유효하지 않은 토큰입니다.'}),true);
    assert.equal(lsTokenRejected(200,{rsp_cd:'00000',rsp_msg:'정상 token'}),false);
    assert.equal(lsTokenRejected(200,{rsp_cd:'IGW00201',rsp_msg:'호출 거래건수를 초과하였습니다.'}),false,'A rate limit is not a token problem');
    let t=clock,issued=0;
    const provider=createLsMarketSupply({directory:fs.mkdtempSync(path.join(os.tmpdir(),'ls-token-')),now:()=>t,credentials:()=>({appKey:'a',secretKey:'b'}),supply:{},
        http:{post:async url=>{if(url.includes('oauth2')){issued++;return {data:{access_token:'token-'+issued,expires_in:86400}};}return {data:{}};}}});
    assert.equal(await provider.accessToken(),'token-1');
    assert.equal(provider.invalidateToken(),false,'A token issued within a minute is kept');
    t+=120000;assert.equal(provider.invalidateToken(),true);assert.equal(await provider.accessToken(),'token-2');
    let rejected=0;
    const alerts=createMarketAlerts({now:()=>clock,getToken:async()=>'x',rejectToken:()=>rejected++,log:()=>{}});
    alerts.receive(JSON.stringify({header:{tr_cd:'JIF',rsp_cd:'IGW00121',rsp_msg:'유효하지 않은 토큰입니다.'},body:{}}));
    alerts.receive(JSON.stringify({header:{tr_cd:'JIF',rsp_cd:'IGW00201',rsp_msg:'호출 거래건수를 초과하였습니다.'},body:{}}));
    assert.equal(rejected,1);
    const off=createMarketAlerts({now:()=>clock,getToken:async()=>{throw Error('must not connect');},enabled:()=>false,log:()=>{}});
    off.start();assert.match(off.snapshot('u').connection,/꺼 두었습니다/);off.stop();
});
