const test=require('node:test');
const assert=require('node:assert/strict');
const {createTurnoverService}=require('../../turnover-service');
function fixture() {
 const calls=[];
 const row=(dt,minute=false)=>({[minute?'cntr_tm':'dt']:dt,open_pric:'10000',high_pric:'10200',low_pric:'9900',cur_prc:'10100',trde_qty:'2',trde_prica:'300'});
 const service=createTurnoverService({now:()=>Date.parse('2026-10-23T18:00:00+09:00'),getToken:async()=>'token',pause:async()=>{},http:{post:async(url,body,options)=>{
  const api=options.headers['api-id'];calls.push({api,body});
  if(api==='ka10081')return {data:{stk_dt_pole_chart_qry:[row('20261020'),row('20261021'),row('20261022'),row('20261023')].filter(r=>r.dt>= (body.base_dt==='20261021'?'20261020':'20261022')&&r.dt<=body.base_dt)},headers:{'cont-yn':'Y'}};
  if(api==='ka20006')return {data:{inds_dt_pole_qry:[row('20261021'),row('20261022'),row('20261023')]},headers:{}};
  return {data:{inds_min_pole_qry:[row('20261023090200',true),row('20261023090100',true),row('20261022153000',true)]},headers:{}};
 }}});
 return {service,calls};
}
test('daily uses the reference first page without a fixed count or range and caches it',async()=>{
 const {service,calls}=fixture();const result=await service.query();
 assert.equal(result.markets.kospi.length,2);assert.equal(result.markets.kosdaq.length,2);
 assert.equal(result.cursor,'20261021');assert.equal(calls.length,3);
 await service.query();assert.equal(calls.length,3);
 await service.query({cursor:'20261021'});assert.equal(calls[3].body.base_dt,'20261021');
});
test('minute returns a full latest trading day in chronological order with previous-day cursor',async()=>{
 const {service}=fixture();const result=await service.query({mode:'minute'});
 assert.equal(result.cursor,'20261022');const points=result.markets.kospi;
 assert.equal(points.length,2);assert.equal(points[0].market_turnover,2020000);assert.equal(points[1].market_turnover,4040000);
});
test('rejects unsupported modes and malformed cursors',async()=>{
 const {service}=fixture();await assert.rejects(service.query({mode:'week'}));await assert.rejects(service.query({cursor:'bad'}));
});
