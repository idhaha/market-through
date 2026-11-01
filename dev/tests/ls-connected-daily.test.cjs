const {test}=require('node:test'),assert=require('node:assert/strict');
const {createLsFuturesTest}=require('../../ls-futures-test');
const {timestamp}=require('../../supply-service');
for(const code of ['futures','futuresKosdaq'])test(`${code}: connected daily range follows rollover keys and merges night before day`,async()=>{
 const calls=[];
 const service=createLsFuturesTest({now:()=>timestamp('20261101','120000'),pause:async()=>{},getToken:async()=>'',http:{post:async(url,body,{headers})=>{
  const tr=headers.tr_cd,p=body[tr+'InBlock'];calls.push({tr,p,headers,url});
  if(tr==='t8467'||tr==='t8455')return {data:{rsp_cd:'00000',[tr+'OutBlock']:[{shcode:'A016C000',hname:'F 2612'}]}};
  assert.ok(['t2214','t8459'].includes(tr));assert.equal(p.futcheck,'1');assert.equal(p.cnt,100);assert.match(url,/market-data$/);
  const next=headers.tr_cont==='Y';
  if(next){assert.equal(headers.tr_cont_key,'roll-'+tr);assert.equal(p.cts_code,'OLDMONTH');assert.equal(p.lastdate,'20260910');assert.equal(p.date,'20260909');}
  const night=tr==='t8459';
  const rows=[{date:next?'20260909':'20261030',open:night?90:100,high:night?115:110,low:night?80:95,close:night?98:105}];
  return {headers:{tr_cont:next?'N':'Y',tr_cont_key:'roll-'+tr},data:{rsp_cd:'00000',[tr+'OutBlock']:next?{}:{date:'20260909',cts_code:'OLDMONTH',lastdate:'20260910'},[tr+'OutBlock1']:rows}};
 }}});
 const input={code,mode:'day',from:'20260909',to:'20261030'};
 const result=await service.priceRange(input);
 assert.equal(result.partial,false);
 assert.deepEqual(result.points,[timestamp('20260909'),timestamp('20261030')].map(t=>({t,open:90,high:115,low:80,close:105})));
 assert.equal(calls.filter(c=>c.tr==='t2214').length,2);assert.equal(calls.filter(c=>c.tr==='t8459').length,2);
 const count=calls.length;await service.priceRange(input);assert.equal(calls.length,count,'Repeated past range reuses completed result');
});
test('connected daily preserves available day prices when night fails and allows retry',async()=>{
 let fail=true;
 const service=createLsFuturesTest({now:()=>timestamp('20261101'),pause:async()=>{},getToken:async()=>'',http:{post:async(url,body,{headers})=>{
  const tr=headers.tr_cd;if(tr==='t8467'||tr==='t8455')return {data:{rsp_cd:'00000',[tr+'OutBlock']:[{shcode:'A016C000',hname:'F 2612'}]}};
  if(tr==='t8459'&&fail)throw Error('private-secret');
  return {data:{rsp_cd:'00000',[tr+'OutBlock1']:[{date:'20261030',open:100,high:110,low:90,close:105}]}};
 }}});
 const r=await service.priceRange({mode:'day',from:'20261030',to:'20261030'});
 assert.equal(r.partial,true);assert.equal(r.points.length,1);assert.doesNotMatch(JSON.stringify(r),/private-secret/);
 fail=false;
 assert.equal((await service.priceRange({mode:'day',from:'20261030',to:'20261030'})).partial,false);
});
