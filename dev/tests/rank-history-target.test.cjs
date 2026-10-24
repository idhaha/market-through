const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(mode='day'){
 const jobs=[],ctx={window:{},queueMicrotask:f=>jobs.push(f)};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),ctx);
 const api=ctx.window.RankChartAxis,states={},calls=[];
 const date=n=>`2026-10-${String(n).padStart(2,'0')}`+(mode==='minute'?' 09:00':'');
 function add(id,first,pages,kind=mode){
  const state=states[id]={first,pages:[...pages],cursor:0,fail:false,kind};
  const draw=()=>api.sharedRange(id,[date(state.first),date(23)],v=>v,state.kind,0,null,draw);
  state.draw=draw;draw();
  api.registerHistoryLoader(id,async()=>{
   calls.push(id);if(state.fail)throw new Error('offline');
   if(state.pages.length){state.first=state.pages.shift();state.cursor++;draw();}
  },()=>false,()=>({hasMore:state.pages.length>0,cursor:state.cursor}));
 }
 const flush=()=>{let n=0;while(jobs.length){assert.ok(n++<1000);jobs.shift()();}};
 return {api,states,calls,add,flush,date,domain:()=>mode==='day'?api.dailyDomain():api.minuteDomain()};
}
for(const mode of ['day','minute'])test(`${mode}: peers use multiple pages to reach a fixed target; exhausted source stays a gap`,async()=>{
 const f=fixture(mode);f.add('concentration',22,[18,14]);f.add('supply',22,[21,20,19,18,17]);f.add('marketSupply',22,[]);f.add('volatility',22,[10],mode==='minute'?'day':'minute');f.flush();
 const r=await f.api.requestHistory(mode);f.flush();
 assert.equal(r.target,f.date(18));assert.equal(r.failures.length,0);assert.ok(r.exhausted.includes('marketSupply'));
 assert.equal(f.calls.filter(id=>id==='concentration').length,1);assert.equal(f.calls.filter(id=>id==='supply').length,4);
 assert.ok(!f.calls.includes('volatility'));assert.equal(f.domain().first,f.date(18));
});
test('failed peer preserves view and retries the same target without advancing leader again',async()=>{
 const f=fixture();f.add('concentration',22,[18,14]);f.add('supply',22,[20,18,16]);f.flush();
 const old=f.domain().first;f.states.supply.fail=true;
 const failed=await f.api.requestHistory('day');f.flush();assert.equal(failed.advanced,false);assert.equal(f.domain().first,old);
 f.states.supply.fail=false;const done=await f.api.requestHistory('day');f.flush();
 assert.equal(done.target,f.date(18));assert.equal(done.failures.length,0);assert.equal(f.calls.filter(id=>id==='concentration').length,1);assert.equal(f.domain().first,f.date(18));
});
test('caught request failure with unchanged cursor cannot be mistaken for successful history',async()=>{
 const f=fixture();f.add('concentration',22,[18]);f.add('supply',22,[18]);f.flush();
 const state=f.states.supply;f.api.registerHistoryLoader('supply',async()=>{},()=>false,()=>({hasMore:true,cursor:state.cursor}));
 const r=await f.api.requestHistory('day');f.flush();assert.ok(r.failures.includes('supply'));assert.equal(r.advanced,false);
});
