const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
for(const id of ['concentration','supply','marketSupply','adr','turnover','breadth','volatility','sentiment'])for(const mode of ['day','minute'])test(`${id} ${mode}: common-axis drag, repeated zoom and reset`,()=>{
 const jobs=[],context={window:{},queueMicrotask:f=>jobs.push(f)};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),context);
 const api=context.window.RankChartAxis,base=Date.parse(mode==='day'?'2026-01-01T09:00:00+09:00':'2026-10-24T08:00:00+09:00');
 const all=Array.from({length:120},(_,i)=>base+i*(mode==='day'?86400000:60000)),short=all.slice(-40);
 let a={start:0,count:null},b={start:0,count:null};
 const drawA=()=>{a=api.sharedRange(id,all,v=>v,mode,a.start,a.count,drawA);};
 const peer=id==='adr'?'concentration':'adr';
 const drawB=()=>{b=api.sharedRange(peer,short,v=>v,mode,b.start,b.count,drawB);};
 const flush=()=>{let n=0;while(jobs.length){assert.ok(n++<100);jobs.shift()();}};
 drawA();drawB();flush();
 const domain=()=>mode==='day'?api.dailyDomain():api.minuteDomain();
 const old=domain();api.selectViewport(id,.55,.9);flush();
 assert.ok(domain().first>old.first);assert.ok(domain().last<old.last);
 const once=domain();api.selectViewport(id,.2,.8);flush();assert.ok(domain().first>once.first);assert.ok(domain().last<once.last);
 api.selectViewport(id,.9,.1);flush();assert.equal(domain().first,old.first);assert.equal(domain().last,old.last);
});
