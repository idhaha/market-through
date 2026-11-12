'use strict';
// NXT 매수 10호가 평균: KIS FHKST01010200 with NX, polled only for the codes set (2026-11-12).
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createKisNxtBook,nxtBidAverage}=require('../../kis-nxt-book');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const book=(levels)=>Object.fromEntries(levels.flatMap(([p,q],i)=>[['bidp'+(i+1),String(p)],['bidp_rsqn'+(i+1),String(q)]]));
test('the average is the mean of price × quantity over priced levels, like the NH KRX book',()=>{
    assert.equal(nxtBidAverage(book([[100,10],[99,20],[0,0]])),(1000+1980)/2);
    assert.equal(nxtBidAverage(book([[0,0]])),null,'no priced level: no value');
});
test('only the set codes are asked with NX; a failure is logged once and nothing is sent',async()=>{
    const calls=[],quotes=[],logs=[];let fail=false;
    const http={get:async(url,{params,headers})=>{calls.push([params.FID_COND_MRKT_DIV_CODE,params.FID_INPUT_ISCD,headers.tr_id]);
        if(fail)throw Object.assign(Error('timeout'),{response:{status:500}});
        return {data:{rt_cd:'0',output1:book([[200000,10],[199500,4]])}};}};
    const b=createKisNxtBook({credentials:()=>({domain:'https://kis',appKey:'a',secretKey:'s'}),getToken:async()=>'t',http,now:()=>7,intervalMs:30,gapMs:1,
        onQuote:q=>quotes.push(q),log:t=>logs.push(t)});
    b.set(['005930']);await pause(10);
    assert.deepEqual(calls[0],['NX','005930','FHKST01010200']);
    assert.deepEqual(quotes[0],{exchange:'NXT',key:'005930',bidAverage:(2000000+798000)/2,via:'KIS',receivedAt:7});
    fail=true;await pause(80);
    assert.equal(logs.filter(l=>l.includes('실패')).length,1,'the same failure is logged once');
    const sent=quotes.length;fail=false;await pause(50);
    assert.ok(quotes.length>sent);assert.ok(logs.at(-1).includes('다시 됨'));
    b.set([]);const n=calls.length;await pause(80);
    assert.equal(calls.length,n,'nothing is polled once no NXT row is on');
    b.stop();
});
