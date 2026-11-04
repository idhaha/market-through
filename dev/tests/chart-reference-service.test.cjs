const test=require('node:test');const assert=require('node:assert/strict');
const {createChartReferenceService}=require('../../chart-reference-service');
const {createIndexCandleStore,PAGE_SIZE}=require('../../index-candle-store');

// Fake Kiwoom with real page sizes (minute 900, day 600) and real continuation keys:
// `inds_cd + timestamp of the first row of the next page` (seen in live responses, e.g. 00120261029130800).
function kiwoom(now){
 const calls=[],minutes=[],days=[];
 for(let d=0;d<6;d++){const day=new Date(Date.UTC(2026,9,26+d)).toISOString().slice(0,10).replaceAll('-','');for(let m=0;m<390;m++){const t=9*60+m;minutes.unshift(day+String(Math.floor(t/60)).padStart(2,'0')+String(t%60).padStart(2,'0')+'00');}}
 for(let d=0;d<1500;d++)days.push(new Date(Date.UTC(2026,9,31)-d*86400000).toISOString().slice(0,10).replaceAll('-',''));
 const row=(k,daily)=>({[daily?'dt':'cntr_tm']:k,open_pric:'10000',high_pric:'11000',low_pric:'9000',cur_prc:'10500',trde_qty:'1',trde_prica:'1'});
 const http={post:async(url,body,options)=>{
  const daily=options.headers['api-id']==='ka20006',list=daily?days:minutes,code=body.inds_cd,next=options.headers['next-key'];calls.push({body,headers:options.headers});
  const start=next?list.indexOf(next.slice(code.length)):0,size=daily?600:900,rows=list.slice(start,start+size);
  const more=start+size<list.length;
  return {data:{[daily?'inds_dt_pole_qry':'inds_min_pole_qry']:rows.map(k=>row(k,daily))},headers:more?{'cont-yn':'Y','next-key':code+list[start+size]}:{}};
 }};
 return {http,calls,raw:async(mode,code,next)=>http.post('',{inds_cd:code,...(mode==='day'?{base_dt:'20261031'}:{tic_scope:'1'})},{headers:{'api-id':mode==='day'?'ka20006':'ka20005','next-key':next||''}})};
}
const now=()=>Date.parse('2026-10-31T18:00:00+09:00');

test('reference pages match Kiwoom page boundaries and cursor format, shared across callers',async()=>{
 const k=kiwoom(now);const service=createChartReferenceService({store:createIndexCandleStore({http:k.http,getToken:async()=>'token',now,pause:async()=>{},log:()=>{}})});
 for(const [mode,market,code] of [['minute','kosdaq','101'],['day','kospi','001']]){
  let cursor='',rawNext='';
  for(let page=0;page<3;page++){
   const ours=await service.query({mode,market,cursor});
   const raw=await k.raw(mode,code,rawNext);
   const rawTimes=raw.data[mode==='day'?'inds_dt_pole_qry':'inds_min_pole_qry'].map(r=>r.dt||r.cntr_tm).sort();
   const ourTimes=ours.points.map(p=>new Date(p.t+9*3600000).toISOString().slice(0,mode==='day'?10:19).replace(/[-T:]/g,''));
   assert.equal(ours.count,rawTimes.length);assert.ok(ours.count<=PAGE_SIZE[mode]);assert.deepEqual(ourTimes,rawTimes,`${mode} page ${page} matches Kiwoom`);
   assert.equal(ours.cursor,raw.headers['next-key']??null,`${mode} page ${page} cursor matches Kiwoom`);
   assert.equal(ours.points[0].date.length,mode==='day'?10:16);
   cursor=ours.cursor;rawNext=raw.headers['next-key'];
  }
 }
});

test('concurrent first pages share one load; invalid conditions are rejected',async()=>{
 const k=kiwoom(now);const service=createChartReferenceService({store:createIndexCandleStore({http:k.http,getToken:async()=>'token',now,pause:async()=>{},log:()=>{}})});
 const [a,b]=await Promise.all([service.query({mode:'minute',market:'kospi'}),service.query({mode:'minute',market:'kospi'})]);
 assert.deepEqual(a,b);
 const minuteCalls=k.calls.filter(c=>c.headers['api-id']==='ka20005');
 assert.ok(minuteCalls.every(c=>c.body.inds_cd==='001'));assert.equal(minuteCalls.filter(c=>!c.headers['next-key']).length,1,'one top page for both callers');
 await assert.rejects(service.query({mode:'week'}));
 await assert.rejects(service.query({mode:'minute',market:'kospi',cursor:'10120261029130800'}),/잘못된/);
});
