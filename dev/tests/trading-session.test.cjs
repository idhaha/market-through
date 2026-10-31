const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const {createTradingSession,install}=require('../../trading-session');
const {timestamp}=require('../../supply-service');
function fixture(t,initial='20261030',time='120000',extra={}){
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'trading-session-'));t.after(()=>{install(null);fs.rmSync(directory,{recursive:true,force:true});});
    let clock=timestamp(initial,time),calls=0,rows=['20261029','20261030','20261102','20261103'].map(bass_dt=>({bass_dt,opnd_yn:'Y'}));
    const policy=createTradingSession({directory,now:()=>clock,loadCalendar:async()=>{calls++;return rows;},...extra});
    return {policy,directory,setTime:(d,h)=>{clock=timestamp(d,h);},setRows:r=>{rows=r;},calls:()=>calls};
}
test('spot and derivatives use distinct sessions, breaks and overnight calendar dates',async t=>{
    const f=fixture(t);await f.policy.refresh();
    for(const [h,spot,futures]of [['075900',false,false],['080000',true,false],['084500',true,true],['154500',true,false],['175900',true,false],['180000',true,true],['200000',false,true]]){
        f.setTime('20261030',h);assert.equal(f.policy.spotAt(),spot,h);assert.equal(f.policy.futuresAt(),futures,h);
    }
    f.setTime('20261031','010000');await f.policy.refresh();assert.equal(f.policy.spotAt(),false);assert.equal(f.policy.nightAt(),true,'Friday night continues on Saturday');
    f.setTime('20261031','060000');assert.equal(f.policy.futuresAt(),false);
    f.setTime('20261031','180000');assert.equal(f.policy.futuresAt(),false);
});
test('a newly announced holiday is taken from refreshed broker dates, not a fixed weekday calendar',async t=>{
    const f=fixture(t,'20261102');await f.policy.refresh();assert.equal(f.policy.spotAt(),true);
    f.setRows([{bass_dt:'20261102',opnd_yn:'Y'},{bass_dt:'20261103',opnd_yn:'N'},{bass_dt:'20261104',opnd_yn:'Y'}]);
    f.setTime('20261103','120000');assert.equal(f.policy.spotAt(),false,'stale previous-day validation is not sufficient');
    await f.policy.refresh();assert.equal(f.policy.spotAt(),false);assert.equal(f.policy.futuresAt(),false);
    await f.policy.refresh();await f.policy.refresh();assert.equal(f.calls(),2);
});
test('failed calendar refresh suspends automatic collection and backs off instead of retrying every tick',async t=>{
    let calls=0;const f=fixture(t,'20261102','120000',{loadCalendar:async()=>{calls++;throw Error('private');}});
    await f.policy.refresh();await f.policy.refresh();assert.equal(calls,1);assert.equal(f.policy.spotAt(),false);assert.equal(f.policy.snapshot().calendarKnown,false);
    f.setTime('20261102','121600');await f.policy.refresh();assert.equal(calls,2);
});
test('shared collector gates honor holiday policy without changing pure legacy behavior when uninstalled',async t=>{
    const f=fixture(t);await f.policy.refresh();install(f.policy);
    const {collectingAt,futuresObservationAt}=require('../../supply-service');
    assert.equal(collectingAt(timestamp('20261030','120000')),true);
    assert.equal(collectingAt(timestamp('20261030','210000')),false);
    assert.equal(futuresObservationAt(timestamp('20261030','163000'),'2026-10-30'),false);
    assert.equal(futuresObservationAt(timestamp('20261030','230000'),'2026-10-30'),true);
});
test('automatic chart refresh skips closed broker cards, keeps nonbroker cards and preserves manual refresh',()=>{
    const calls=[],window={TradingRefresh:{allows:id=>id==='sentiment'||id==='volatility'}};
    vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),{window});
    for(const method of ['refreshRankSupplyChart','refreshRankMarketSupplyChart','refreshRankSentimentChart','refreshRankVolatilityChart'])window[method]=()=>calls.push(method);
    window.RankChartAxis.refreshCharts({automatic:true});assert.deepEqual(calls,['refreshRankSentimentChart','refreshRankVolatilityChart']);
    calls.length=0;window.RankChartAxis.refreshCharts();assert.ok(calls.includes('refreshRankMarketSupplyChart'));
});
test('frontend session failure clears the previous open state and automatic futures remain independent from cash',async()=>{
    let at=1e6,fail=false;const window={};
    class Clock extends Date{static now(){return at;}}
    const document={getElementById:id=>id==='rankTestMarketSupplyChartPanel'?{querySelector:()=>({value:'futures'})}:null};
    vm.runInNewContext(fs.readFileSync('public/trading-refresh.js','utf8'),{window,document,Date:Clock,fetch:async()=>{
        if(fail)throw Error('offline');return {ok:true,json:async()=>({spot:false,futures:true,night:true})};
    }});
    await window.TradingRefresh.update();assert.equal(window.TradingRefresh.allows('testMarketSupply'),true);assert.equal(window.TradingRefresh.allows('supply'),false);
    at+=61000;fail=true;await window.TradingRefresh.update();assert.equal(window.TradingRefresh.allows('testMarketSupply'),false);
});
