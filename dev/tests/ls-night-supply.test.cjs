const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {createSupplyStore}=require('../../supply-store'),{timestamp}=require('../../supply-service');
const {createLsNightSupply,active}=require('../../ls-night-supply');
function setup(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ls-night-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const now=()=>timestamp('20261031','090000');return {directory,now,store:createSupplyStore({directory,now})};}
test('night collector appends both markets by source date to the existing daytime store',async t=>{
    const {store,now}=setup(t);store.merge('FUTURE',{t:timestamp('20261030','150000'),individual:123,foreign:-123});store.archiveCompleted();
    const collector=createLsNightSupply({store,now,rest:async(tr,endpoint,p)=>{
        assert.equal(tr,'t8463');assert.equal(p.tm_rng,'N');
        return {t8463OutBlock1:[{date:'20261030',time:'235930',indmsamt:'2',formsamt:'-2',sysmsamt:'0'},
            {date:'20261031',time:'000030',indmsamt:'3',formsamt:'-3',sysmsamt:'0'},
            {date:'20261030',time:'150000',indmsamt:'999'},
            {date:'20261031',time:'100000',indmsamt:'999'}]};
    }});
    await collector.collect();
    const day=store.points('FUTURE','2026-10-30');assert.equal(day[0].individual,123);assert.equal(day.length,2);
    assert.equal(day[1].t,timestamp('20261030','235900'));assert.equal(day[1].individual,200);assert.equal(day[1].institution,0);
    const night=store.points('FUTURE','2026-10-31');assert.equal(night.length,1);assert.equal(night[0].individual,300);
    assert.equal(night[0].individual_at,timestamp('20261031','000030'));assert.equal(night[0].source,'LS');assert.equal(night[0].session,'N');
    assert.equal(store.points('FUTKQ0','2026-10-31')[0].individual,300);
});
test('repeated or older observations do not overwrite a newer saved minute',t=>{
    const {store,now}=setup(t),collector=createLsNightSupply({store,now});
    const at=timestamp('20261031','060030');
    assert.equal(collector.ingest('futures',[{t:at,observed_at:at,individual:100,foreign:0}]),1);
    assert.equal(collector.ingest('futures',[{t:at,observed_at:at,individual:100,foreign:0}]),0);
    assert.equal(collector.ingest('futures',[{t:at-30000,observed_at:at-30000,individual:999,foreign:null}]),0);
    assert.equal(store.points('FUTURE','2026-10-31')[0].individual,100);
});
test('stored minute queries and history make no investor TR calls',async t=>{
    const {store,now}=setup(t),calls=[];
    const collector=createLsNightSupply({store,now});
    store.merge('FUTURE',{t:timestamp('20261030','150000'),individual:123,foreign:-123});
    collector.ingest('futures',[{t:timestamp('20261030','060030'),individual:100},{t:timestamp('20261031','060030'),individual:200}]);
    const service=require('../../ls-futures-test').createLsFuturesTest({daytimeStore:store,now,pause:async()=>{},getToken:async()=>'hidden',http:{post:async(url,body,{headers})=>{
        calls.push(headers.tr_cd);throw Error('price unavailable');
    }}});
    const r=await service.query({code:'futures',session:'N',mode:'minute'});assert.equal(r.points.at(-1).individual,200);assert.equal(r.has_more,false);
    assert.deepEqual(r.points.map(p=>p.individual),[100,200],'Initial response includes both saved nights');
    const past=await service.query({code:'futures',session:'N',mode:'minute',cursor:'20261029'});assert.equal(past.points.at(-1).individual,100);
    const combined=await service.query({code:'futures',mode:'minute'});
    assert.equal(combined.points.find(p=>p.t===timestamp('20261030','150000')).individual,123,'A night-only next-day file must not hide the preceding daytime session');
    assert.ok(!calls.includes('t8463'));assert.ok(!calls.includes('t8462'));
});
for(const [code,storeCode] of [['futures','FUTURE'],['futuresKosdaq','FUTKQ0']])test(`${code} preserves an interior saved night and pages only outside the loaded window`,async t=>{
    const {store,now}=setup(t),calls=[];
    const collector=createLsNightSupply({store,now});
    store.merge(storeCode,{t:timestamp('20261029','150000'),foreign:31,individual:-31,institution:0});
    const saved=['20261027','20261029','20261030','20261031'].map((date,i)=>({t:timestamp(date,date==='20261031'?'010030':'230030'),foreign:(i+1)*100,individual:-(i+1)*100,institution:0}));
    collector.ingest(code,saved);
    const service=require('../../ls-futures-test').createLsFuturesTest({daytimeStore:store,now,pause:async()=>{},getToken:async()=>'',http:{post:async(url,body,{headers})=>{calls.push(headers.tr_cd);throw Error('price unavailable');}}});
    const result=await service.query({code,mode:'minute'}),byTime=new Map(result.points.map(p=>[p.t,p]));
    for(const row of saved.slice(1)){
        const p=byTime.get(Math.floor(row.t/60000)*60000);
        assert.ok(p,'Every saved night inside the window is returned, including the middle night');
        for(const field of ['individual','foreign','institution'])assert.equal(p[field],row[field]);
    }
    assert.equal(byTime.get(timestamp('20261029','150000')).foreign,31);
    const initial=await service.query({code,session:'N',mode:'minute'});
    assert.equal(initial.cursor,'20261027');assert.equal(initial.has_more,true);
    const older=await service.query({code,session:'N',mode:'minute',cursor:initial.cursor});
    assert.ok(older.points.some(p=>p.t===Math.floor(saved[0].t/60000)*60000));
    assert.equal(older.cursor,null);assert.equal(older.has_more,false);
    assert.ok(!calls.includes('t8462')&&!calls.includes('t8463'),'Saved flow never re-fetches investor TRs');
});
test('recovery fetches the previous session once and scheduled collection covers overnight only',async t=>{
    const {store,now}=setup(t),calls=[];
    const collector=createLsNightSupply({store,now,rest:async(tr,endpoint,p)=>{calls.push(p.bgubun);return {t8463OutBlock1:[]};}});
    await collector.collect({recover:true});await collector.collect({recover:true});
    assert.equal(calls.filter(v=>v==='1').length,2);assert.equal(calls.filter(v=>v==='0').length,4);
    assert.equal(active(timestamp('20261030','230000')),true);assert.equal(active(timestamp('20261031','060200')),true);
    assert.equal(active(timestamp('20261031','180000')),false);assert.equal(active(timestamp('20261030','120000')),false);
});
test('daytime-only KIS collection cannot overwrite LS night records',async t=>{
    const {directory}=setup(t);let clock=timestamp('20261030','180000');const calls=[];
    const service=require('../../market-supply-service').createMarketSupplyService({directory,now:()=>clock,futuresDaytimeOnly:true,
        supply:{confirmMarket:async()=>false,futuresAllowed:()=>true},credentials:()=>({domain:'https://example.test',appKey:'hidden',secretKey:'hidden'}),getToken:async()=>'hidden',pause:async()=>{},
        http:{get:async(url,options)=>{calls.push(options.params.FID_INPUT_ISCD);return {data:{rt_cd:'0',output:[{prsn_ntby_tr_pbmn:'1',frgn_ntby_tr_pbmn:'2',orgn_ntby_tr_pbmn:'-3'}]}};}}
    });
    service.store.merge('FUTURE',{t:clock,foreign:700,source:'LS',session:'N'});
    await service.collect();assert.deepEqual(calls,[]);assert.equal(service.store.points('FUTURE','2026-10-30')[0].foreign,700);
    clock=timestamp('20261031','010000');await service.collect();assert.deepEqual(calls,[]);
    clock=timestamp('20261102','150000');await service.collect();assert.deepEqual(calls,['K2I','KQI']);
});
