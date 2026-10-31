const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMarketSupplyService } = require('../../market-supply-service');
const { timestamp } = require('../../supply-service');
const day = '20261023';
test('non-trading day query returns the latest stored futures session with an explicit source date',async t=>{
    const {service,setTime}=fixture(t,async()=>[],false,'160000');
    const time=timestamp(day,'154500');
    service.store.merge('FUTURE',{t:time,foreign:7,individual:-4,institution:-3});
    setTime(timestamp('20261024','120000'));
    const result=await service.query({code:'futures',mode:'minute'});
    assert.equal(result.date,'2026-10-23');
    assert.equal(result.points.find(p=>p.t===time)?.foreign,7);
});
test('confirmed futures sessions continue at night and after midnight',async t=>{
    let foreign = '7';
    const {service,calls,setTime}=fixture(t,async()=>[{frgn_ntby_tr_pbmn:foreign}],true,'220000');
    await service.collect();
    assert.deepEqual(calls.map(c=>c.params.FID_INPUT_ISCD),['K2I','KQI']);
    assert.equal(service.store.points('FUTURE','2026-10-23')[0].foreign,7);
    setTime(timestamp('20261024','010000')); await service.collect();
    assert.equal(service.store.points('FUTURE','2026-10-24').length,0,'Midnight must not refresh an unchanged value');
    foreign = '8'; setTime(timestamp('20261024','010100')); await service.collect();
    assert.equal(service.store.points('FUTURE','2026-10-24')[0].foreign,8);
    assert.equal(service.store.points('KOSPI0','2026-10-24').length,0);
});
test('persisted futures baseline ignores repeats and missing fields, retaining per-field change times',async t=>{
    let row = {prsn_ntby_tr_pbmn:'1',frgn_ntby_tr_pbmn:'2',orgn_ntby_tr_pbmn:'3'};
    const {service,setTime}=fixture(t,async()=>[row],true,'220000');
    const baseline = timestamp(day,'154500');
    service.store.merge('FUTURE',{t:baseline,individual:1,foreign:2,institution:3});
    await service.collect();
    assert.equal(service.store.points('FUTURE','2026-10-23').length,1);
    setTime(timestamp(day,'220100')); row = {frgn_ntby_tr_pbmn:'2'}; await service.collect();
    assert.equal(service.store.points('FUTURE','2026-10-23').length,1,'Missing fields are not changes');
    setTime(timestamp(day,'220200')); row = {prsn_ntby_tr_pbmn:'1',frgn_ntby_tr_pbmn:'0',orgn_ntby_tr_pbmn:'3'}; await service.collect();
    const points = service.store.points('FUTURE','2026-10-23');
    assert.equal(points.length,2); assert.equal(points[1].foreign,0);
    assert.equal(points[1].foreign_at,timestamp(day,'220200'));
    assert.equal(points[1].individual_at,baseline); assert.equal(points[1].institution_at,baseline);
    setTime(timestamp(day,'220300')); await service.collect();
    assert.equal(service.store.points('FUTURE','2026-10-23').length,2);
});
function fixture(t, handler, confirmed = true, at = '101500', referenceRows) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'market-supply-'));
    t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const calls=[], references=[];let currentTime=timestamp(day,at);
    const service=createMarketSupplyService({directory, now:()=>currentTime, pause:async()=>{},
        credentials:()=>({domain:'https://kis.test',appKey:'test',secretKey:'test'}),getToken:async()=>'test',
        supply:{confirmMarket:async()=>confirmed,futuresAllowed:()=>confirmed},
        reference:{query:async input=>{references.push(input);return {points:referenceRows || [{t:timestamp(day,input.mode==='minute'?'101400':'090000'),open:100,high:110,low:90,close:105}],has_more:false};}},
        http:{get:async(url,options)=>{calls.push(options);return {data:{rt_cd:'0',output:await handler(options.headers.tr_id,options.params)}};}}});
    return {service,calls,references,setTime:value=>{currentTime=value;}};
}
test('daily retains signed investor amounts and sums arbitrage plus non-arbitrage; both markets use unified program',async t=>{
    const {service,calls}=fixture(t,async(id)=>id==='FHPTJ04040000'
        ?[{stck_bsop_date:day,frgn_ntby_tr_pbmn:'-600',prsn_ntby_tr_pbmn:'200',orgn_ntby_tr_pbmn:'400'}]
        :[{stck_bsop_date:day,arbt_smtn_ntby_tr_pbmn:'-50',nabt_smtn_ntby_tr_pbmn:'10'}]);
    for(const code of ['kospi','kosdaq']) {
        const result=await service.query({code});assert.equal(result.points[0].foreign,-600);assert.equal(result.points[0].program,-40);
        assert.equal(result.points[0].t,result.candles[0].t);
    }
    assert.ok(calls.filter(c=>c.headers.tr_id==='FHPPG04600001').every(c=>c.params.FID_COND_MRKT_DIV_CODE==='UN'));
    assert.deepEqual(calls.filter(c=>c.headers.tr_id==='FHPTJ04040000').map(c=>c.params.FID_INPUT_ISCD_1),['KSP','KSQ']);
    await assert.rejects(service.query({code:'futures',mode:'day'}),/지원하지/);
});
test('collection backfills valid source program times, rejects stale/future/after-close rows and never requests futures program',async t=>{
    const {service,calls}=fixture(t,async(id)=>id==='FHPTJ04030000'
        ?[{frgn_ntby_tr_pbmn:'5',prsn_ntby_tr_pbmn:'-3',orgn_ntby_tr_pbmn:'-2'}]
        :[{bsop_hour:'101400',whol_smtn_ntby_tr_pbmn:'-9'}, {bsop_hour:'101600',whol_smtn_ntby_tr_pbmn:'90'},
            {bsop_hour:'160000',whol_smtn_ntby_tr_pbmn:'900'}, {bsop_hour:'101300',stck_bsop_date:'20261022',whol_smtn_ntby_tr_pbmn:'9000'}]);
    await service.collect();await service.collect();
    const result=await service.query({code:'kospi',mode:'minute'});
    assert.equal(result.points.find(p=>p.t===timestamp(day,'101400')).program,-9,JSON.stringify(result));
    assert.equal(result.points.find(p=>p.t===timestamp(day,'101500')).foreign,5);
    assert.equal(result.points.length,2);
    const futures=await service.query({code:'futures',mode:'minute'});
    assert.ok(futures.points.every(p=>p.program===undefined));
    assert.equal(calls.filter(c=>c.headers.tr_id==='FHPPG04600101').length,4);
    assert.ok(calls.filter(c=>c.headers.tr_id==='FHPPG04600101').every(c=>['K','Q'].includes(c.params.FID_MRKT_CLS_CODE)));
});
test('unconfirmed market makes no supply requests; errors do not fabricate zero',async t=>{
    const closed=fixture(t,async()=>{throw Error('must not call');},false);await closed.service.collect();assert.equal(closed.calls.length,0); 
    const {service}=fixture(t,async(id)=>{if(id==='FHPTJ04040000')throw Error('investor unavailable');return [{stck_bsop_date:day,arbt_smtn_ntby_tr_pbmn:'0',nabt_smtn_ntby_tr_pbmn:'0'}];});
    const result=await service.query({code:'kospi'});assert.equal(result.points[0].program,0);assert.equal(result.points[0].foreign,undefined);
    assert.ok(result.warnings.some(w=>w.includes('investor unavailable')));
    await assert.rejects(service.query({code:'../invalid',mode:'minute'}));
});

test('unified evening program observations survive after KRX close; futures also collect after the day session',async t=>{
    const {service,calls}=fixture(t,async(id)=>id==='FHPTJ04030000'
        ?[{frgn_ntby_tr_pbmn:'5',prsn_ntby_tr_pbmn:'-3',orgn_ntby_tr_pbmn:'-2'}]
        :[{bsop_hour:'193600',whol_smtn_ntby_tr_pbmn:'-9'},{bsop_hour:'200500',whol_smtn_ntby_tr_pbmn:'-9'}],true,'193700');
    await service.collect();
    const result=await service.query({code:'kospi',mode:'minute'});
    assert.equal(result.points.find(p=>p.t===timestamp(day,'193600')).program,-9);
    assert.ok(calls.filter(c=>c.headers.tr_id==='FHPTJ04030000').some(c=>['K2I','KQI'].includes(c.params.FID_INPUT_ISCD)));
    assert.ok(result.points.every(p=>p.t<=timestamp(day,'193700')));
});

test('both futures collect distinct investor markets and use corresponding spot candles without program data',async t=>{
    const {service,calls,references}=fixture(t,async(id,params)=>id==='FHPTJ04030000'
        ?[{frgn_ntby_tr_pbmn:params.FID_INPUT_ISCD==='KQI'?'99':'5',prsn_ntby_tr_pbmn:'-3',orgn_ntby_tr_pbmn:'-2'}]
        :[{bsop_hour:'101400',whol_smtn_ntby_tr_pbmn:'-9'}]);
    await service.collect();
    const kospi=await service.query({code:'futures',mode:'minute'});
    const kosdaq=await service.query({code:'futuresKosdaq',mode:'minute'});
    assert.equal(kospi.points.find(p=>p.t===timestamp(day,'101500')).foreign,5);
    assert.equal(kosdaq.points.find(p=>p.t===timestamp(day,'101500')).foreign,99);
    assert.ok(kospi.points.every(p=>p.program===undefined));assert.ok(kosdaq.points.every(p=>p.program===undefined));
    assert.ok(kospi.candles.length>0 && kosdaq.candles.length>0);
    assert.deepEqual(references.map(r=>r.market),['kospi','kosdaq']);
    const q=calls.find(c=>c.params.FID_INPUT_ISCD==='KQI');assert.equal(q.params.FID_INPUT_ISCD_2,'F002');
    assert.ok(kosdaq.warnings.includes('캔들: 코스닥 현물지수'));
    await assert.rejects(service.query({code:'futuresKosdaq',mode:'day'}));
});


test('market daily refresh avoids repeating old program date windows',async t=>{
    const dates=Array.from({length:70},(_,i)=>new Date(timestamp(day)-(69-i)*86400000+9*3600000).toISOString().slice(0,10).replaceAll('-',''));
    const rows=dates.map(dt=>({t:timestamp(dt,'090000'),open:100,high:110,low:90,close:105}));
    const {service,calls,setTime}=fixture(t,async(id,params)=>id==='FHPTJ04040000'
        ?dates.map(stck_bsop_date=>({stck_bsop_date,frgn_ntby_tr_pbmn:'5',prsn_ntby_tr_pbmn:'-3',orgn_ntby_tr_pbmn:'-2'}))
        :dates.filter(dt=>dt>=params.FID_INPUT_DATE_1&&dt<=params.FID_INPUT_DATE_2).map(stck_bsop_date=>({stck_bsop_date,whol_smtn_ntby_tr_pbmn:'-9'})),true,'101500',rows);
    const first=await service.query({code:'kospi'});assert.equal(calls.length,4);
    setTime(timestamp(day,'101601'));const second=await service.query({code:'kospi'});
    assert.equal(calls.length,6,'Only latest investor + program window refreshed');assert.deepEqual(second.points,first.points);
    assert.equal(calls.at(-1).params.FID_INPUT_DATE_1,dates.at(-2));
});

test('market progressive responses render investors before slow program history and do not duplicate jobs',async t=>{
    let release,started;const gate=new Promise(r=>{release=r;}),programStarted=new Promise(r=>{started=r;});t.after(()=>release());
    const {service,calls}=fixture(t,async id=>{
        if(id==='FHPPG04600001'){started();await gate;return [{stck_bsop_date:day,whol_smtn_ntby_tr_pbmn:'-9'}];}
        return [{stck_bsop_date:day,frgn_ntby_tr_pbmn:'5',prsn_ntby_tr_pbmn:'-3',orgn_ntby_tr_pbmn:'-2'}];
    });
    const first=await service.query({code:'kospi',progressive:'1'});assert.equal(first.pending,true);
    await programStarted;const partial=await service.query({code:'kospi',progressive:'1'});
    assert.equal(partial.points[0].foreign,5);assert.equal(partial.points[0].program,undefined);assert.equal(partial.pending,true);
    release();const done=await service.query({code:'kospi'});assert.equal(done.points[0].program,-9);assert.equal(calls.length,2);
});

test('empty program date window does not hide available older history',async t=>{
    const dates=['20260720','20260820','20260920','20261023'];
    const rows=dates.map(dt=>({t:timestamp(dt),open:100,high:110,low:90,close:105}));
    const {service}=fixture(t,async(id,params)=>id==='FHPTJ04040000'
        ?dates.map(stck_bsop_date=>({stck_bsop_date,frgn_ntby_tr_pbmn:'5'}))
        :dates.filter(dt=>dt!=='20260920'&&dt>=params.FID_INPUT_DATE_1&&dt<=params.FID_INPUT_DATE_2)
            .map(stck_bsop_date=>({stck_bsop_date,whol_smtn_ntby_tr_pbmn:'-9'})),true,'101500',rows);
    const result=await service.query({code:'kospi'});
    assert.equal(result.points[0].program,-9);
    assert.equal(result.points[1].program,-9);
    assert.equal(result.points[2].program,undefined);
    assert.equal(result.points[3].program,-9);
    assert.ok(result.warnings.some(text=>text.includes('프로그램 일부 일별 자료 미제공')));
});


test('successful empty program history is cached and not traversed again on each refresh',async t=>{
 const dates=['20240507','20250507','20261023'],anchor=dates.map(dt=>({t:timestamp(dt),close:100}));
 const {service,calls,setTime}=fixture(t,async(id,params)=>id==='FHPTJ04040000'?dates.map(stck_bsop_date=>({stck_bsop_date,frgn_ntby_tr_pbmn:'1'})):[],true,'101500',anchor);
 await service.query({code:'kospi'});const n=calls.length;assert.ok(n>20);
 setTime(timestamp(day,'101510'));await service.query({code:'kospi'});assert.equal(calls.length,n,'Empty successful old ranges are cached');
 setTime(timestamp(day,'101610'));await service.query({code:'kospi'});
 const later=calls.slice(n).filter(c=>c.headers.tr_id==='FHPPG04600001');assert.ok(later.length>0);assert.ok(later.every(c=>c.params.FID_INPUT_DATE_1>=dates.at(-2)),'Only mutable recent window is revisited');
});
