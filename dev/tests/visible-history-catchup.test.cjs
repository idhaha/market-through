const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('reload catches up source coverage for every minute card when a peer expands the axis',async()=>{
    const context={window:{},queueMicrotask,setTimeout};
    vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),context);
    const api=context.window.RankChartAxis,states=new Map();
    const cards=['combinedMarketSupply','combinedSupply','combinedConcentration','combinedTurnover','adr','breadth'];
    const early='2026-10-29 09:00',late='2026-10-31 06:00';
    const testDraw=()=>api.sharedRange('testMarketSupply',[early,late],v=>v,'minute',0,null,testDraw);
    testDraw();
    for(const id of cards){
        const state={identity:id,coverageFirst:'2026-10-31 00:00',cursor:'20261030',hasMore:true,calls:0,ensures:0};
        states.set(id,state);
        // Historical candles alone do not count as historical source coverage.
        const draw=()=>api.sharedRange(id,[early,late],v=>v,'minute',0,null,draw);
        api.registerHistoryLoader(id,async()=>{
            state.calls++;
            if(state.cursor==='20261030'){state.coverageFirst='2026-10-30 00:00';state.cursor='20261029';}
            else{state.coverageFirst='2026-10-29 00:00';state.cursor=null;state.hasMore=false;}
            draw();
        },()=>false,()=>({...state,ensureRange:async target=>{assert.equal(target,early);state.ensures++;}}));
        draw();
    }
    await new Promise(resolve=>setImmediate(resolve));
    for(const [id,state] of states){assert.equal(state.calls,2,id);assert.equal(state.ensures,1,id);}
    testDraw();await new Promise(resolve=>setImmediate(resolve));
    for(const [id,state] of states)assert.equal(state.calls,2,`no repeat history requests: ${id}`);
});
