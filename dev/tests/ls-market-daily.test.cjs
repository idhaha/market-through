const {test}=require('node:test'),assert=require('node:assert/strict');
const {createLsMarketDaily,investorValues}=require('../../ls-market-daily');
const {timestamp}=require('../../supply-service');
test('LS daily uses its own integrated amount TRs, pagination and correct separate scales',async()=>{
 const calls=[],dates=['20261022','20261023','20261026'];
 const provider=createLsMarketDaily({getToken:async()=>'hidden',pause:async()=>{},now:()=>timestamp('20261026','210000'),reference:{query:async()=>({points:dates.map(d=>({t:timestamp(d),close:100})),has_more:false})},http:{post:async(url,body,{headers})=>{
  const tr=headers.tr_cd,p=body[tr+'InBlock'];calls.push({tr,p,url});assert.equal(p.exchgubun,'U');
  if(tr==='t1665'){assert.equal(p.market,'3');assert.equal(p.upcode,'301');assert.equal(p.gubun2,'1');assert.equal(p.gubun3,'1');const d=p.to_date==='20261026'?'20261026':p.to_date;return {data:{rsp_cd:'00000',t1665OutBlock1:[{date:d,sa_08:'-285',sa_17:'0',sa_18:''}]}};}
  assert.equal(tr,'t1633');assert.equal(p.gubun,'1');assert.equal(p.gubun1,'0');assert.equal(p.gubun2,'0');const i=p.date?dates.indexOf(p.date)-1:2;const d=dates[i];return {data:{rsp_cd:'00000',t1633OutBlock:{date:d},t1633OutBlock1:[{date:d,tot3:i===0?'0':'-532455'}]}};
 }}});
 const r=await provider.daily('kosdaq','');assert.equal(r.source,'LS');assert.deepEqual(r.points.map(p=>p.program),[0,-532455,-532455]);assert.equal(r.points.at(-1).individual,-28500);assert.equal(r.points.at(-1).foreign,0);assert.equal(r.points.at(-1).institution,null);assert.ok(calls.every(c=>c.url.startsWith('https://openapi.ls-sec.co.kr:8080/')));
 const n=calls.length;await provider.daily('kosdaq','');assert.equal(calls.length,n);
});
test('LS failure keeps only price candles and never substitutes foreign-broker flow',async()=>{
 const p=createLsMarketDaily({getToken:async()=>'hidden',pause:async()=>{},reference:{query:async()=>({points:[{t:timestamp('20261026'),close:123,program:99999}],has_more:false})},http:{post:async()=>{throw Error('private');}}});
 const r=await p.daily('kospi','');assert.equal(r.points[0].program,undefined);assert.equal(r.points[0].individual,undefined);assert.equal(r.candles[0].close,123);assert.match(r.warnings.join(),/LS t1665 일봉 조회 실패/);assert.doesNotMatch(JSON.stringify(r),/private|hidden/);
 assert.deepEqual(investorValues({sa_08:'0',sa_17:'-1',sa_18:''}),{individual:0,foreign:-100,institution:null});
});


test('a broker-specific market service cannot silently fall back to KIS daily data',async()=>{
 const {createMarketSupplyService}=require('../../market-supply-service');
 const service=createMarketSupplyService({directory:require('node:path').join(require('node:os').tmpdir(),'ls-no-write-source-guard'),minuteProvider:{store:{},flush(){}},reference:{query:async()=>{throw Error('unexpected');}}});
 await assert.rejects(service.query({code:'kospi',mode:'day'}),/해당 증권사 일봉 수급 원천/);
});


test('the actual LS HTTP route dispatches both daily and minute modes only to LS',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const source=fs.readFileSync(require('node:path').join(__dirname,'../../server.js'),'utf8');
 const start=source.indexOf("app.get('/api/ls-market-supply/chart'");const end=source.indexOf("app.get('/api/market-supply/chart'",start);assert.ok(start>=0&&end>start);
 let route;const calls=[];vm.runInNewContext(source.slice(start,end),{app:{get:(path,handler)=>route=handler},lsMarketSupplyService:{query:async q=>{calls.push(q.mode);return{success:true,source:'LS'};}},marketSupplyService:{query:async()=>{throw Error('KIS flow must not enter LS route');}}});
 for(const mode of ['day','minute',undefined]){let result;const res={set(){return this;},status(){return this;},json(value){result=value;}};await route({query:{mode}},res);assert.equal(result.source,'LS');assert.equal(result.success,true);}
 assert.deepEqual(calls,['day','minute',undefined]);
});
