const vm=require('node:vm'),fs=require('node:fs'),test=require('node:test'),assert=require('node:assert/strict');
const context={window:{},Date:class extends Date {static now(){return Date.parse('2026-10-23T09:22:00+09:00')}}};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),context);const api=context.window.RankChartAxis;
test('today viewport excludes previous sessions for every supported date encoding',()=>{
 for(const values of [['20261022190000','20261023080000','20261023092200'],['2026-10-22 19:00','2026-10-23 08:00','2026-10-23 09:22'],['2026-10-22T19:00:00+09:00','2026-10-23T08:00:00+09:00','2026-10-23T09:22:00+09:00'].map(Date.parse)]){
  const view=api.todayRange(values,v=>v);assert.equal(view.start,1);assert.equal(view.count,2);
  const limited=api.limitToday(values,v=>v,0,null);assert.equal(limited.start,1);assert.equal(limited.count,2);
 }
});
test('no today data produces empty view instead of previous trading session',()=>{const view=api.todayRange(['20261022190000'],v=>v);assert.equal(view.count,0);assert.equal(view.start,1)});
test('today minute axis starts at 08:00 and leaves missing 08–09 data blank',()=>{
 const values=['20261023090000','20261023100000'];const x=api.sessionX(values,v=>v,0,600,true);
 assert.equal(x('20261023080000'),0);assert.equal(x(values[0]),300);assert.equal(x(values[1]),600);
 const context={measureText:s=>({width:s.length*7})};const labels=api.eightTick(context,[],0,600,true);assert.equal(labels[0].label,'08:00');
 assert.equal(api.sessionX(values,v=>v,0,600,false),null);
});
test('one minute-history click shows only the previous session despite different API page sizes',()=>{
 const stock=['20261020142600','20261021080000','20261022080000','20261022200000','20261023080000','20261023094900'];
 const index=['20261016114900','20261019090000','20261020090000','20261021090000','20261022090000','20261022153000','20261023090000','20261023094900'];
 for(const values of [stock,index]){
  const first=api.sessionRange(values,v=>v,1);assert.equal(values[first.start].slice(0,8),'20261022');
  const second=api.sessionRange(values,v=>v,2);assert.equal(values[second.start].slice(0,8),'20261021');
  const shown=values.slice(first.start,first.start+first.count),x=api.sessionX(shown,v=>v,0,600,true);
  assert.equal(x('20261022080000'),0);assert.equal(api.sessionStartLabel(shown,v=>v),'10-22 08:00');
 }
});

test('shared minute start uses the latest earliest timestamp and recomputes as history expands',()=>{
 const sandbox={window:{},Date:context.Date,queueMicrotask:()=>{}};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),sandbox);const shared=sandbox.window.RankChartAxis;
 const a=['20261020080000','20261021080000','20261022080000','20261022090000','20261023090000'];
 let b=['20261022090000','20261023090000'];
 shared.sharedRange('stock',a,v=>v,'minute',0,null,()=>{});shared.sharedRange('index',b,v=>v,'minute',0,null,()=>{});shared.showHistory();
 let view=shared.sharedRange('stock',a,v=>v,'minute',0,null,()=>{});assert.equal(a[view.start],'20261022090000');
 b=['20261021080000',...b];shared.sharedRange('index',b,v=>v,'minute',0,null,()=>{});
 view=shared.sharedRange('stock',a,v=>v,'minute',0,null,()=>{});assert.equal(a[view.start],'20261021080000');
 shared.sharedRange('empty',[],v=>v,'minute',0,null,()=>{});shared.sharedRange('daily',['20261023'],v=>v,'day',0,null,()=>{});
 view=shared.sharedRange('stock',a,v=>v,'minute',0,null,()=>{});assert.equal(a[view.start],'20261021080000');
 shared.showToday();view=shared.sharedRange('stock',a,v=>v,'minute',0,null,()=>{});assert.equal(a[view.start],'20261023090000');
});

test('initial empty minute response does not pin the later populated viewport to zero bars',()=>{
 const sandbox={window:{},Date:context.Date,queueMicrotask:()=>{}};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),sandbox);const shared=sandbox.window.RankChartAxis;
 for(const id of ['supply','breadth','adr']){
  const empty=shared.sharedRange(id,[],v=>v,'minute',0,null,()=>{});assert.equal(empty.count,0);
  shared.sharedRange(id,[],v=>v,'minute',0,empty.count,()=>{});
  const values=['20261023080000','20261023090000','20261023092200'];
  const loaded=shared.sharedRange(id,values,v=>v,'minute',empty.start,empty.count,()=>{});assert.equal(loaded.count,3);
  const zoomed=shared.sharedRange(id,values,v=>v,'minute',1,1,()=>{});assert.equal(zoomed.count,1);
  shared.showToday();const reset=shared.sharedRange(id,values,v=>v,'minute',1,1,()=>{});assert.equal(reset.count,3);
 }
});

test('sparse and empty minute charts share the full period, ticks and timestamp positions',()=>{
 const sandbox={window:{},Date:context.Date,queueMicrotask:()=>{}};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),sandbox);const shared=sandbox.window.RankChartAxis;
 const a=['20261023080100','20261023090000','20261023101700'],b=['20261023083200','20261023100800'];
 for(const [id,values] of [['stock',a],['supply',b],['empty',[]]])shared.sharedRange(id,values,v=>v,'minute',0,null,()=>{});
 const ctx={measureText:s=>({width:s.length*7})};
 const expected=shared.ticks(ctx,a,v=>v,()=>0,16,570,'minute');
 assert.deepEqual(shared.ticks(ctx,b,v=>v,()=>0,16,570,'minute'),expected);
 assert.deepEqual(shared.ticks(ctx,[],v=>v,()=>0,16,570,'minute'),expected);
 for(const values of [a,b,[]]){const domain=shared.minuteDomain(values,v=>v);assert.equal(domain.first,'2026-10-23 08:00');assert.equal(domain.last,'2026-10-23 10:17');const x=shared.sessionX(values,v=>v,16,570,true);assert.equal(x('20261023080000'),16);assert.equal(x('20261023101700'),570);}
});
test('history click waits for every minute chart and never advances the start into today',async()=>{
 const sandbox={window:{},Date:context.Date,queueMicrotask:()=>{},setTimeout};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),sandbox);const shared=sandbox.window.RankChartAxis;
 let a=['20261021080000','20261023090000'],b=['20261023090000'],round=0;const called=[];
 const register=()=>{shared.sharedRange('stock',a,v=>v,'minute',0,null,()=>{});shared.sharedRange('index',b,v=>v,'minute',0,null,()=>{});};register();
 shared.registerHistoryLoader('stock',async()=>{called.push('stock');const before=shared.minuteDomain().first;a=['20261020080000',...a];register();assert.equal(shared.minuteDomain().first,before);});
 shared.registerHistoryLoader('index',async()=>{called.push('index');await Promise.resolve();b=[round===0?'20261022090000':'20261021090000',...b];register();});
 const first=await shared.requestHistory();assert.equal(first.advanced,true);assert.equal(first.failures.length,0);assert.equal(shared.minuteDomain().first,'2026-10-22 09:00');
 round++;await shared.requestHistory();assert.equal(shared.minuteDomain().first,'2026-10-21 09:00');assert.deepEqual(called,['stock','index','stock','index']);
 const noMore=await shared.requestHistory();assert.equal(noMore.advanced,false);assert.equal(noMore.failures.length,0);assert.equal(shared.minuteDomain().first,'2026-10-21 09:00');
});

test('daily more loads every daily chart and aligns their start, end, ticks and price coordinates',async()=>{
 const sandbox={window:{},Date:context.Date,queueMicrotask:()=>{},setTimeout};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),sandbox);const shared=sandbox.window.RankChartAxis;
 const ids=['concentration','supply','breadth','turnover','adr','sentiment','volatility'],data=new Map(),called=[];
 for(const [i,id] of ids.entries()){
  const values=['2026-10-20','2026-10-21','2026-10-22','2026-10-23'];data.set(id,values);
  shared.sharedRange(id,values,v=>v,'day',0,null,()=>{});
  shared.registerHistoryLoader(id,async()=>{called.push(id);const old=i===6?'2026-10-19':'2026-10-16';const next=[old,...data.get(id)];data.set(id,next);shared.sharedRange(id,next,v=>v,'day',0,null,()=>{});});
 }
 await shared.requestHistory('day');assert.deepEqual(called,ids);
 assert.equal(shared.dailyDomain().first,'2026-10-19');assert.equal(shared.dailyDomain().last,'2026-10-23');
 const ctx={measureText:s=>({width:s.length*7})};let expected;
 for(const id of ids){const values=data.get(id);const view=shared.sharedRange(id,values,v=>v,'day',0,null,()=>{});const shown=values.slice(view.start,view.start+view.count);
  const x=shared.sessionX(shown,v=>v,16,570,false,true);assert.equal(x('2026-10-19'),16);assert.equal(x('2026-10-23'),570);
  const ticks=shared.ticks(ctx,shown,v=>v,x,16,570,'day');if(expected)assert.deepEqual(ticks,expected);else expected=ticks;
 }
});

test('unchanged history start still resets cropped daily viewports and notifies on interior date changes',async()=>{
 const queued=[],sandbox={window:{},Date:context.Date,queueMicrotask:fn=>queued.push(fn),setTimeout};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),sandbox);const shared=sandbox.window.RankChartAxis;
 const values={a:['2026-10-20','2026-10-22','2026-10-23'],b:['2026-10-20','2026-10-23']},view={},labels={},ctx={measureText:s=>({width:s.length*7})};
 function draw(id){view[id]=shared.sharedRange(id,values[id],v=>v,'day',view[id]?.start||0,view[id]?.count??null,()=>draw(id));labels[id]=shared.ticks(ctx,values[id],v=>v,()=>0,16,570,'day');}
 const flush=()=>{let iterations=0;while(queued.length){assert.ok(iterations++<100);queued.shift()();}};
 for(const id of ['a','b']){draw(id);shared.registerHistoryLoader(id,async()=>{});}flush();await shared.requestHistory('day');flush();
 view.a={start:1,count:1};draw('a');const result=await shared.requestHistory('day');flush();assert.equal(result.advanced,false);assert.equal(view.a.start,0);assert.equal(view.a.count,3);assert.deepEqual(labels.a,labels.b);
 values.b=['2026-10-20','2026-10-21','2026-10-23'];draw('b');assert.ok(queued.length);flush();assert.deepEqual(labels.a,labels.b);
});
