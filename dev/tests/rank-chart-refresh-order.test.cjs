const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
test('normal refresh starts all eight in requested order and allows completion in any order',async()=>{
 const window={},sandbox={window};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),sandbox);
 const methods=['refreshConcentrationChart','refreshRankSupplyChart','refreshRankMarketSupplyChart','refreshRankBreadthChart','refreshRankTurnoverChart','refreshRankAdrChart','refreshRankSentimentChart','refreshRankVolatilityChart'];
 const starts=[],finished=[],resolvers=[];
 for(const method of [...methods].reverse())window[method]=()=>{starts.push(method);return new Promise(resolve=>{resolvers[methods.indexOf(method)]=()=>{finished.push(method);resolve();};});};
 let done=false;const refresh=window.RankChartAxis.refreshCharts().then(()=>done=true);
 assert.deepEqual(starts,methods);assert.equal(finished.length,0);assert.equal(window.rankChartRefreshStarted,true);
 resolvers[1]();await Promise.resolve();assert.deepEqual(finished,[methods[1]]);assert.equal(done,false);
 for(const i of [7,6,5,4,3,2,0])resolvers[i]();await refresh;assert.equal(done,true);
});
