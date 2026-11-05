const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
// A screen left open from the session: automatic refresh stops at the close, so each closed card must
// be read once more after the server's two-minute write grace, and again after the next close (futures night).
test('automatic refresh reads a closed card once per close after the write grace',async()=>{
 let now=Date.parse('2026-11-05T20:00:00+09:00');const closed={spot:Date.parse('2026-11-05T20:00:00+09:00')},calls=[];
 const ctx={window:{},queueMicrotask:f=>f(),Date:class extends Date{static now(){return now;}}};
 vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),ctx);
 const w=ctx.window;w.refreshRankBreadthChart=()=>calls.push('breadth');w.refreshRankSentimentChart=()=>calls.push('sentiment');
 w.TradingRefresh={allows:id=>id==='sentiment',closedAt:id=>id==='breadth'?closed.spot:null};
 const tick=async()=>{calls.length=0;await w.RankChartAxis.refreshCharts({automatic:true});return calls.filter(id=>id==='breadth').length;};
 now+=30000;assert.equal(await tick(),0,'within the grace the server may still be writing');
 now+=100000;assert.equal(await tick(),1,'one read after the grace');assert.ok(calls.includes('sentiment'));
 now+=30000;assert.equal(await tick(),0,'not repeated for the same close');
 closed.spot=Date.parse('2026-11-06T20:00:00+09:00');now=closed.spot+180000;
 assert.equal(await tick(),1,'next close reads again');
 w.TradingRefresh.allows=()=>true;now+=30000;assert.equal(await tick(),1,'open market keeps the normal refresh');
});
