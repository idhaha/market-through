const test=require('node:test'),assert=require('node:assert/strict');
const { createLendableViewCache }=require('../../lendable-stocks');
// 2026-11-08 Oracle: the 대주 auto refresh (/api/stock?kiwoom=0) waited for ~270 KIS quotes (0.55 s queue each, 2.5 min+)
// and nginx answered 504 after 60 s (9 of 13 requests). The view must answer quickly and refresh prices in the background.
const row=(pdno,extra={})=>({pdno,prdt_name:'종목'+pdno,bfdy_clpr:'1000',trad_psbl_qty2:'10',...extra});
const later=()=>{let release;const promise=new Promise(r=>release=r);return{promise,release};};
test('a slow price refresh never holds the request: last prices now, refresh in the background, first load capped',async()=>{
    let time=1000,calls=0,gate=later(),fail=false;
    const logs=[],getView=createLendableViewCache({now:()=>time,wait:50,log:m=>logs.push(m)});
    const options={key:'k',stocks:[row('000001'),row('000002')],scan:{running:false,completedAt:1},
        enrich:async rows=>{calls++;await gate.promise;if(fail)throw Error('KIS timeout');rows.forEach((r,i)=>{r.stck_prpr=String(time+i);r.prdy_ctrt='1.00';});}};
    // First load: no enriched copy yet, waits at most `wait`, then answers without prices.
    let started=Date.now(),view=await getView(options);
    assert.ok(Date.now()-started<500,'first answer is capped');assert.equal(view[0].stck_prpr,undefined);assert.equal(calls,1);
    // A second request while that refresh runs does not start another one.
    await getView(options);assert.equal(calls,1);
    gate.release();await new Promise(r=>setImmediate(r));
    view=await getView(options);assert.deepEqual(view.map(r=>r.stck_prpr),['1000','1001'],'fresh copy within ttl');assert.equal(calls,1);
    // After ttl the request answers at once with the last prices while the next refresh is still running.
    time+=30001;gate=later();started=Date.now();
    view=await getView(options);
    assert.ok(Date.now()-started<20,'stale-while-revalidate answers immediately');assert.deepEqual(view.map(r=>r.stck_prpr),['1000','1001']);assert.equal(calls,2);
    // A new scan adds a stock: the list follows the scan, known prices stay, the new stock has none yet.
    options.stocks=[row('000001'),row('000003',{no_quantity:true})];options.scan={running:false,completedAt:2};
    view=await getView(options);assert.deepEqual(view.map(r=>[r.pdno,r.stck_prpr]),[['000001','1000'],['000003',undefined]]);assert.equal(calls,2,'still the same background refresh');
    gate.release();await new Promise(r=>setImmediate(r));
    // A failed refresh keeps the last prices and is logged.
    time+=30001;fail=true;gate=later();view=await getView(options);gate.release();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
    assert.match(logs.join('\n'),/현재가 보강 실패: KIS timeout/);
    view=await getView(options);assert.equal(view[0].stck_prpr,String(1000+30001));
});
