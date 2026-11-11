const test=require('node:test');
const assert=require('node:assert/strict');
const {createTurnoverService}=require('../../turnover-service');
const {createIndexCandleStore}=require('../../index-candle-store');
function fixture() {
 const calls=[];
 const row=(dt,minute=false)=>({[minute?'cntr_tm':'dt']:dt,open_pric:'10000',high_pric:'10200',low_pric:'9900',cur_prc:'10100',trde_qty:'2',trde_prica:'300'});
 const now=()=>Date.parse('2026-10-23T18:00:00+09:00');
 const http={post:async(url,body,options)=>{
  const api=options.headers['api-id'];calls.push({api,body});
  if(api==='ka10081')return {data:{stk_dt_pole_chart_qry:[row('20261020'),row('20261021'),row('20261022'),row('20261023')].filter(r=>r.dt>= (body.base_dt==='20261021'?'20261020':'20261022')&&r.dt<=body.base_dt)},headers:{'cont-yn':'Y'}};
  if(api==='ka20006')return {data:{inds_dt_pole_qry:[row('20261021'),row('20261022'),row('20261023')]},headers:{}};
  return {data:{inds_min_pole_qry:[row('20261023090200',true),row('20261023090100',true),row('20261022153000',true)]},headers:{}};
 }};
 // Index candles come from the shared store built on the same Kiwoom transport.
 const service=createTurnoverService({now,getToken:async()=>'token',pause:async()=>{},http,indexCandles:createIndexCandleStore({http,getToken:async()=>'token',now,pause:async()=>{},log:()=>{}})});
 return {service,calls};
}
// 2026-11-11: trading days come from the shared KOSPI index daily page, not a Samsung (ka10081) call.
test('daily takes its trading days from the shared index daily page: no Samsung call, one call per market, cached',async()=>{
 const {service,calls}=fixture();const result=await service.query();
 assert.deepEqual(result.markets.kospi.map(p=>new Date(p.t+9*3600000).toISOString().slice(0,10)),['2026-10-21','2026-10-22','2026-10-23']);
 assert.equal(result.markets.kosdaq.length,3);
 assert.equal(result.cursor,null,'the index page has no older page here');
 assert.ok(!calls.some(c=>c.api==='ka10081'),'no Samsung daily call');
 assert.deepEqual(calls.map(c=>c.api+':'+c.body.inds_cd),['ka20006:001','ka20006:101']);
 await service.query();assert.equal(calls.length,2,'second load reuses the cache');
});
test('minute returns a full latest trading day in chronological order with previous-day cursor',async()=>{
 const {service}=fixture();const result=await service.query({mode:'minute'});
 assert.equal(result.cursor,'20261022');const points=result.markets.kospi;
 assert.equal(points.length,2);assert.equal(points[0].market_turnover,2020000);assert.equal(points[1].market_turnover,4040000);
});
test('rejects unsupported modes and malformed cursors',async()=>{
 const {service}=fixture();await assert.rejects(service.query({mode:'week'}));await assert.rejects(service.query({cursor:'bad'}));
});
