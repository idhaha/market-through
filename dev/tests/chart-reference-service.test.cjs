const test=require('node:test');const assert=require('node:assert/strict');
const {createChartReferenceService}=require('../../chart-reference-service');
test('uses actual initial candle count and opaque continuation key, cached across callers',async()=>{
 const calls=[];const service=createChartReferenceService({now:()=>Date.parse('2026-10-23T18:00:00+09:00'),getToken:async()=>'token',http:{post:async(url,body,options)=>{
 calls.push({body,headers:options.headers});const daily=options.headers['api-id']==='ka20006';
 return {data:{[daily?'inds_dt_pole_qry':'inds_min_pole_qry']:['20261022','20261023'].map(dt=>({[daily?'dt':'cntr_tm']:dt+(daily?'':'090000'),open_pric:'10000',high_pric:'11000',low_pric:'9000',cur_prc:'10500'}))},headers:{'cont-yn':'Y','next-key':'opaque/key+next'}};
 }}});
 const [first,same]=await Promise.all([service.query(),service.query()]);assert.equal(calls.length,1);assert.equal(first.count,2);assert.deepEqual(first,same);assert.equal(first.cursor,'opaque/key+next');
 await service.query({cursor:first.cursor});assert.equal(calls[1].headers['next-key'],first.cursor);assert.equal(calls[1].headers['cont-yn'],'Y');
 const minute=await service.query({mode:'minute',market:'kosdaq'});assert.equal(calls[2].headers['api-id'],'ka20005');assert.equal(calls[2].body.inds_cd,'101');assert.equal(minute.count,2);
 await assert.rejects(service.query({mode:'week'}));
});
