const {test}=require('node:test'),assert=require('node:assert/strict');
const {createSharedIndexHttp}=require('../../shared-index-http');
const {createChartReferenceService}=require('../../chart-reference-service');
const url='https://api.kiwoom.com/api/dostk/chart';
const options=(api='ka20006',next='')=>({headers:{'api-id':api,'cont-yn':next?'Y':'N','next-key':next,Authorization:'Bearer test'}});
test('cross-card in-flight pages share one request and immutable snapshots',async()=>{
 let calls=0,at=Date.parse('2026-10-24T10:00:00+09:00'),resolve;
 const shared=createSharedIndexHttp({now:()=>at,http:{post:()=>{calls++;return new Promise(r=>resolve=r);}}});
 const ref=createChartReferenceService({http:shared,getToken:async()=> 'test',now:()=>at});
 const a=ref.query({mode:'day',market:'kospi'});
 const b=shared.post(url,{base_dt:'20261024',inds_cd:'001'},options());
 await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 resolve({data:{inds_dt_pole_qry:[{dt:'20261023',cur_prc:'250000',open_pric:'249000',high_pric:'251000',low_pric:'248000'}]},headers:{'cont-yn':'Y','next-key':'next'}});
 const [first,second]=await Promise.all([a,b]);assert.equal(first.points.length,1);assert.equal(second.headers['next-key'],'next');
 second.data.inds_dt_pole_qry.length=0;
 assert.equal((await shared.post(url,{inds_cd:'001',base_dt:'20261024'},options())).data.inds_dt_pole_qry.length,1);
});
test('scope, page and interval separation, expiration, failed response retry, unrelated TR passthrough',async()=>{
 let calls=0,at=Date.parse('2026-10-24T10:00:00+09:00'),fail=false;
 const http=createSharedIndexHttp({now:()=>at,http:{post:async(u,b,o)=>{calls++;if(fail)return {data:{return_code:1,return_msg:'failed'},headers:{}};return {data:{inds_dt_pole_qry:[],inds_min_pole_qry:[]},headers:{}};}}});
 const body={inds_cd:'001',tic_scope:'1'};
 await http.post(url,body,options('ka20005'));await http.post(url,body,options('ka20005'));assert.equal(calls,1);
 await http.post(url,{...body,inds_cd:'101'},options('ka20005'));
 await http.post(url,{...body,tic_scope:'5'},options('ka20005'));
 await http.post(url,body,options('ka20005','next'));assert.equal(calls,4);
 at+=60000;await http.post(url,body,options('ka20005'));assert.equal(calls,5);
 const old={inds_cd:'001',base_dt:'20261023'};await http.post(url,old,options());at+=60000;await http.post(url,old,options());assert.equal(calls,6);
 at+=6*3600000;await http.post(url,old,options());assert.equal(calls,6);
 at=Date.parse('2026-10-25T00:00:00+09:00');await http.post(url,old,options());assert.equal(calls,7);
 fail=true;await assert.rejects(http.post(url,{...body,tic_scope:'30'},options('ka20005')));fail=false;
 await http.post(url,{...body,tic_scope:'30'},options('ka20005'));assert.equal(calls,9);
 await http.post(url,{},options('ka10081'));await http.post(url,{},options('ka10081'));assert.equal(calls,11);
});


test('history expires exactly at Korean midnight, including in-flight response crossing the date boundary',async()=>{
 let at=Date.parse('2026-10-24T23:59:59+09:00'),calls=0,release;
 const http=createSharedIndexHttp({now:()=>at,http:{post:()=>{calls++;return new Promise(r=>release=r);}}});
 const body={inds_cd:'101',base_dt:'20261023'};
 const first=http.post(url,body,options());await new Promise(r=>setImmediate(r));
 at+=2000;release({data:{inds_dt_pole_qry:[]},headers:{}});await first;
 const next=http.post(url,body,options());await new Promise(r=>setImmediate(r));assert.equal(calls,2);
 release({data:{inds_dt_pole_qry:[]},headers:{}});await next;
 at=Date.parse('2026-10-25T23:59:59+09:00');await http.post(url,body,options());assert.equal(calls,2);
});
