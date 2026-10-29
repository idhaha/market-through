const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');

test('history overlaps independent lanes, serializes peers and commits one shared period after completion',async()=>{
 const f=fixture();f.add('concentration',22,[18]);
 const ids=['supply','marketSupply','kisConcentration','kisSupply','lsSupply','sentiment'];
 let active=0,maxActive=0;const busy=new Set(),started=[],release=[];
 for(const id of ids){
  f.add(id,22,[18]);const state=f.states[id];
  const lane=id.startsWith('kis')?'kis':id.startsWith('ls')?'ls':id==='sentiment'?'external':'kiwoom';
  f.api.registerHistoryLoader(id,async()=>{
   assert.ok(!busy.has(lane));busy.add(lane);active++;maxActive=Math.max(maxActive,active);started.push(id);
   await new Promise(resolve=>release.push(resolve));
   state.first=18;state.cursor++;state.pages=[];state.draw();active--;busy.delete(lane);
  },()=>false,()=>({hasMore:state.pages.length>0,cursor:state.cursor}));
 }
 f.flush();const old=f.domain().first;let done=false;
 const pending=f.api.requestHistory('day').then(result=>{done=true;return result;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(active,3);assert.equal(started.length,3);assert.equal(f.domain().first,old);
 for(let rounds=0;!done;rounds++){
  assert.ok(rounds<30,'history must finish after all loaders are released');
  release.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));
 }
 const result=await pending;f.flush();
 assert.equal(maxActive,3);assert.equal(started.length,ids.length);assert.equal(result.failures.length,0);
 assert.equal(f.domain().first,f.date(18));assert.equal(result.target,f.date(18));
 assert.equal(result.metrics.cards.supply.pages,1);assert.equal(result.metrics.cards.concentration.pages,1);
 assert.equal(f.window.rankHistoryMetrics,result.metrics);assert.ok(result.metrics.totalMs>=0);
});
function fixture(mode='day',clock=null){
 const jobs=[],ctx={window:{},queueMicrotask:f=>jobs.push(f)};if(clock)ctx.Date=class extends Date{static now(){return Date.parse(clock);}};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),ctx);
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
 return {window:ctx.window,api,states,calls,add,flush,date,domain:()=>mode==='day'?api.dailyDomain():api.minuteDomain()};
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


test('stable session cursor with advancing index coverage is progress, not a stalled stock page',async()=>{
 const f=fixture();f.add('concentration',22,[18]);f.add('supply',22,[18]);f.flush();
 let n=0;const stock=f.states.concentration;
 f.api.registerHistoryLoader('concentration',async()=>{
  n++;if(n===3){stock.first=18;stock.draw();}
 },()=>false,()=>({hasMore:n<3,cursor:'stable-session',progress:String(n)}));
 const r=await f.api.requestHistory('day');f.flush();assert.equal(r.failures.length,0);assert.equal(n,3);assert.equal(f.domain().first,f.date(18));
});


test('empty today view can show available past data when another chart fails',async()=>{
 const f=fixture('minute');f.add('concentration',22,[18]);f.add('kisConcentration',22,[18]);f.states.kisConcentration.fail=true;f.flush();
 const result=await f.api.requestHistory('minute');f.flush();
 assert.equal(result.partial,true);assert.ok(result.failures.includes('kisConcentration'));assert.equal(f.domain().first,f.date(18));
});
test('switching period while history is in flight cancels its later viewport commit',async()=>{
 const f=fixture();f.add('concentration',22,[18]);f.flush();let release;
 f.api.registerHistoryLoader('concentration',async()=>{await new Promise(r=>release=r);f.states.concentration.first=18;f.states.concentration.draw();},()=>false,()=>({hasMore:true,cursor:1}));
 const pending=f.api.requestHistory('day');await new Promise(r=>setImmediate(r));
 f.states.concentration.kind='minute';f.states.concentration.draw();f.api.showToday();f.flush();
 const today=f.api.minuteDomain().first;release();const result=await pending;f.flush();
 assert.equal(result.cancelled,true);assert.equal(f.api.minuteDomain().first,today);assert.equal(result.failures.length,0);
});


test('selection restoration catches one source up without requesting older history from peers',async()=>{
 const f=fixture();f.add('concentration',22,[21,20,18]);f.add('supply',18,[15]);f.flush();
 const first=f.domain().first;
 await f.api.restoreHistoryRange('concentration',{first:f.date(18),last:f.date(23)});f.flush();
 assert.equal(f.states.concentration.first,18);assert.equal(f.calls.filter(id=>id==='concentration').length,3);assert.ok(!f.calls.includes('supply'));assert.equal(f.domain().first,first);
});
test('selection restoration stops when original source ends and still ensures price coverage',async()=>{
 const f=fixture();f.add('adr',22,[]);f.flush();let target;
 f.api.registerHistoryLoader('adr',async()=>assert.fail('no indicator history'),()=>false,()=>({identity:'kosdaq',hasMore:false,ensureRange:async first=>target=first}));
 await f.api.restoreHistoryRange('adr',{first:f.date(18),last:f.date(23)});
 assert.equal(target,f.date(18));
});

test('minute history shows loaded older records even when a peer fails and today already has data',async()=>{
 const f=fixture('minute','2026-10-23T12:00:00+09:00');f.add('concentration',23,[22,21]);f.add('marketSupply',23,[22]);f.states.marketSupply.fail=true;f.flush();
 assert.equal(f.domain().first,'2026-10-23 08:00');
 const result=await f.api.requestHistory('minute');f.flush();
 assert.equal(result.partial,true);assert.equal(result.advanced,true);assert.equal(f.domain().first,f.date(22));assert.ok(result.failures.includes('marketSupply'));
 f.states.marketSupply.fail=false;const retry=await f.api.requestHistory('minute');f.flush();
 assert.equal(retry.failures.length,0);assert.equal(f.calls.filter(id=>id==='concentration').length,1);assert.equal(f.domain().first,f.date(22));
});

test('minute refresh excludes daily-only risk cards while unfiltered refresh still updates them',async()=>{
 const f=fixture('minute');f.add('concentration',23,[],'minute');f.add('supply',23,[],'minute');f.add('sentiment',23,[],'day');f.add('volatility',23,[],'day');f.flush();
 const calls=[];
 // The VM's window is the receiver used by refreshCharts.
 f.window.refreshConcentrationChart=()=>calls.push('concentration');f.window.refreshRankSupplyChart=()=>calls.push('supply');f.window.refreshRankSentimentChart=()=>calls.push('sentiment');f.window.refreshRankVolatilityChart=()=>calls.push('volatility');
 await f.api.refreshCharts({mode:'minute'});assert.deepEqual(calls,['concentration','supply']);
 calls.length=0;await f.api.refreshCharts();assert.deepEqual(calls,['concentration','supply','sentiment','volatility']);
});

test('minute: a failing leading source must not prevent stock supply history from loading',async()=>{
 const f=fixture('minute');f.add('concentration',23,[22]);f.add('combinedSupply',23,[22,21]);f.states.concentration.fail=true;f.flush();
 const result=await f.api.requestHistory('minute');f.flush();
 assert.ok(f.calls.includes('combinedSupply'));assert.equal(result.advanced,true);assert.equal(f.domain().first,f.date(22));
});
