const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
test('drag selects rendered common dates despite different source lengths and repeated zoom',()=>{
 const pending=[];const context={window:{},queueMicrotask:fn=>pending.push(fn)};
 vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),context);
 const api=context.window.RankChartAxis;
 const all=Array.from({length:600},(_,i)=>Date.UTC(2024,4,3+i));const recent=all.slice(-197);
 let market={start:0,count:null},stock={start:0,count:null};
 function m(){market=api.sharedRange('marketSupply',all,v=>v,'day',market.start,market.count,m);}
 function s(){stock=api.sharedRange('concentration',recent,v=>v,'day',stock.start,stock.count,s);}
 function flush(){let n=0;while(pending.length){assert.ok(n++<100);pending.shift()();}}
 m();s();flush();
 const before=api.dailyDomain().days;
 api.selectViewport('marketSupply',.7,.9);flush();
 const selected=api.dailyDomain().days;
 assert.equal(selected[0],before[Math.floor(.7*(before.length-1))]);assert.equal(selected.at(-1),before[Math.ceil(.9*(before.length-1))]);
 assert.ok(selected.length<before.length);
 api.selectViewport('marketSupply',.25,.75);flush();assert.ok(api.dailyDomain().days.length<selected.length);
 market={start:0,count:null};api.selectViewport('marketSupply',.9,.1);flush();assert.equal(api.dailyDomain().days.length,before.length);
});
