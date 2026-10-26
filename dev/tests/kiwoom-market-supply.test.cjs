const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createKiwoomMarketSupply,investors}=require('../../kiwoom-market-supply');
const {createMarketSupplyService}=require('../../market-supply-service');
const {timestamp}=require('../../supply-service');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kw-market-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let at=timestamp('20261026','100520'),confirmed=true,failInvestor=false;const calls=[];
 const provider=createKiwoomMarketSupply({directory,now:()=>at,pause:async()=>{},getToken:async()=>'private',
  supply:{confirmMarket:async()=>confirmed},reference:{query:async()=>({points:[{t:timestamp('20261023'),close:100},{t:timestamp('20261026'),close:101}],has_more:false})},
  http:{post:async(url,body,options)=>{
   const tr=options.headers['api-id'];calls.push({tr,body,next:options.headers['next-key']});
   if(tr==='ka10051'){
    if(failInvestor)throw Error('secret upstream config');
    return{data:{return_code:0,inds_netprps:[{inds_cd:body.mrkt_tp==='0'?'001_AL':'101_AL',ind_netprps:'0',frgnr_netprps:'-123',orgn_netprps:'+122'},
      {inds_cd:'002_AL',ind_netprps:'999',frgnr_netprps:'999',orgn_netprps:'999'}]}};
   }
   const minute=tr==='ka90005',older=options.headers['next-key']==='more';
   return{data:{return_code:0,prm_trde_trnsn:minute
    ?[{cntr_tm:'100500',all_netprps:'999'},{cntr_tm:'100459',all_netprps:'--681513'},{cntr_tm:'100401',all_netprps:'12'},{cntr_tm:'100300',all_netprps:'0'},{cntr_tm:'100600',all_netprps:'9999'}]
    :[{cntr_tm:(older?'20261023':'20261026')+'000000',all_netprps:older?'0':'-90'}]},headers:{'cont-yn':!minute&&!older?'Y':'N','next-key':!minute&&!older?'more':''}};
  }}});
 const reference={query:async({mode})=>({points:mode==='minute'?[{t:timestamp('20261026','100400'),close:100}]:[],has_more:false})};
 const service=createMarketSupplyService({directory,now:()=>at,minuteProvider:provider,dailyProvider:provider,reference});
 return{provider,service,calls,setTime:n=>at=n,setConfirmed:n=>confirmed=n,fail:()=>failInvestor=true};
}
test('investor billions become million KRW; missing and real zero remain different',()=>{
 assert.deepEqual(investors({ind_netprps:'0',frgnr_netprps:'-123',orgn_netprps:''}),{individual:0,foreign:-12300,institution:null});
});
test('collects unified market totals and program source minutes without inventing investor history',async t=>{
 const f=fixture(t);await f.provider.collect();
 let rows=f.provider.store.points('KOSPI0','2026-10-26');
 assert.equal(rows.find(r=>r.t===timestamp('20261026','100400')).program,-681513);
 assert.equal(rows.find(r=>r.t===timestamp('20261026','100300')).program,0);
 assert.equal(rows.some(r=>r.t===timestamp('20261026','100500')),false);
 assert.equal(rows.some(r=>r.foreign!==undefined),false);
 f.setTime(timestamp('20261026','100600'));f.provider.flush();rows=f.provider.store.points('KOSPI0','2026-10-26');
 const p=rows.find(r=>r.t===timestamp('20261026','100500'));assert.equal(p.foreign,-12300);assert.equal(p.individual,0);assert.equal(p.program,undefined);
 assert.ok(f.calls.every(c=>c.body.stex_tp==='3'));
 assert.deepEqual(f.calls.filter(c=>c.tr==='ka90005').map(c=>c.body.mrkt_tp),['P001_AL01','P101_AL02']);
});
test('failure of investor REST preserves program and never exposes upstream credentials',async t=>{
 const f=fixture(t);f.fail();await f.provider.collect();const d=await f.service.query({code:'kospi',mode:'minute'});
 assert.equal(d.points.find(p=>p.t===timestamp('20261026','100400')).program,-681513);
 assert.match(d.status.error,/ka10051 조회 실패/);assert.doesNotMatch(JSON.stringify(d),/secret|private/);
});
test('unconfirmed market cannot collect; daily uses own sources, source pagination and cached history',async t=>{
 const f=fixture(t);f.setConfirmed(false);await f.provider.collect();assert.equal(f.calls.length,0);
 const d=await f.service.query({code:'kosdaq',mode:'day'});
 assert.deepEqual(d.points.map(p=>p.foreign),[-12300,-12300]);assert.deepEqual(d.points.map(p=>p.program),[0,-90]);
 assert.ok(f.calls.some(c=>c.tr==='ka90010'&&c.next==='more'));
 const n=f.calls.length;await f.service.query({code:'kosdaq',mode:'day'});assert.equal(f.calls.length,n);
});


test('cold daily investor history publishes the newest trading date first',async t=>{
 const f=fixture(t), snapshots=[];
 await f.provider.daily('kospi','',v=>snapshots.push(v));
 assert.deepEqual(f.calls.filter(c=>c.tr==='ka10051').map(c=>c.body.base_dt),['20261026','20261023']);
 const first=snapshots.find(v=>v.points.some(p=>Number.isFinite(p.foreign)));
 assert.equal(first.points.at(-1).foreign,-12300);
 assert.equal(first.points[0].foreign,undefined);
});
