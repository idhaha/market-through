// REST polling modes that replace the LS market supply and UPH websockets (local verification).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createLsMarketSupply, subscriptions} = require('../../ls-market-supply');
const {timestamp} = require('../../supply-service');

function marketFixture(t, responses) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-rest-'));
    const checks = Object.fromEntries(subscriptions.map(s => [`${s.tr}:${s.key}`, {
        market:s.market, cumulative:true, timeFormat:s.tr==='UPM'?'HHmmss':'HHmmsscc', toMillionWon:s.tr==='UPM'?1:100, evidence:'test fixture only'}]));
    fs.writeFileSync(path.join(directory,'validation.json'),JSON.stringify(checks));
    let time = timestamp('20261104','100020');
    const calls = [];
    const provider = createLsMarketSupply({directory, now:()=>time, mode:()=> 'rest', pause:async()=>{},
        WebSocket: class { constructor(){ throw Error('websocket must not open in REST mode'); } },
        supply:{confirmMarket:async()=>true,futuresAllowed:()=>true}, credentials:()=>({appKey:'k',secretKey:'s'}),
        http:{post:async(url,body,options)=>{
            if(url.endsWith('/token'))return {data:{access_token:'token',expires_in:3600}};
            const input=Object.values(body)[0];calls.push({tr:options.headers.tr_cd,input});
            return responses(options.headers.tr_cd,input,calls.length);
        }}});
    t.after(()=>{provider.stop();fs.rmSync(directory,{recursive:true,force:true});});
    return {provider,calls,setTime:v=>{time=v;}};
}

test('REST mode stores the latest row per minute in websocket units, with no websocket', async t => {
    const investorRows = upcode => [
        {time:'10001000',sv_08:upcode==='900'?'7':'30',sv_17:'-20',sv_18:'-10'},
        {time:'09594000',sv_08:'21',sv_17:'-11',sv_18:'-9'},
        {time:'09591000',sv_08:'20',sv_17:'-10',sv_18:'-8'}];
    const f = marketFixture(t, tr => tr==='t1662'
        ? {data:{rsp_cd:'00000',t1662OutBlock:[{time:'100000',tot3:-1002288},{time:'095900',tot3:-1000000}]}}
        : {data:{rsp_cd:'00000',t1602OutBlock1:investorRows('001')}});
    await f.provider.collect(); await f.provider.pollRest();
    const kospi = f.provider.store.points('KOSPI0','2026-11-04');
    // t1602 raw is the UBT unit (x100 to million KRW); 09:59 keeps the 09:59:40 row, not 09:59:10.
    assert.deepEqual(kospi.map(p=>[p.t,p.individual,p.foreign,p.program]),[
        [timestamp('20261104','095900'),2100,-1100,-1000000],
        [timestamp('20261104','100000'),3000,-2000,-1002288]]);
    const futures = f.provider.store.points('FUTURE','2026-11-04');
    assert.equal(futures.at(-1).institution, -1000);
    // First poll asks for a full page, later polls a short page.
    const first = f.calls.find(c=>c.tr==='t1602').input.cnt;
    f.calls.length = 0; await f.provider.pollRest();
    assert.equal(first, 900); assert.equal(f.calls.find(c=>c.tr==='t1602').input.cnt, 40);
    assert.deepEqual([...new Set(f.calls.map(c=>c.tr+':'+(c.input.upcode||c.input.gubun)))].sort(),['t1602:001','t1602:301','t1602:900','t1662:0','t1662:1']);
    assert.equal(f.provider.status('kospi','2026-11-04').status.error,'');
    assert.match(f.provider.warnings('kospi')[0],/REST/);
});

test('REST mode retries a rate-limited call and keeps the earlier minute when a call fails', async t => {
    let fail = 0;
    const f = marketFixture(t, (tr,input) => {
        if(tr==='t1662' && input.gubun==='0' && fail++ < 1) return {data:{rsp_cd:'IGW00201'}};
        if(tr==='t1662') return {data:{rsp_cd:'00000',t1662OutBlock:[{time:'100000',tot3:5}]}};
        return {data:{rsp_cd:'00000',t1602OutBlock1:[]}};
    });
    await f.provider.collect(); await f.provider.pollRest();
    assert.equal(f.provider.store.points('KOSPI0','2026-11-04')[0].program, 5);
    assert.equal(f.calls.filter(c=>c.tr==='t1662'&&c.input.gubun==='0').length, 2);
    const g = marketFixture(t, () => { throw Object.assign(Error('down'),{response:{status:500}}); });
    await g.provider.collect(); await g.provider.pollRest();
    assert.match(g.provider.status('kospi','2026-11-04').status.error,/조회 실패/);
});

test('REST mode skips futures outside the day session and spot after the close', async t => {
    const f = marketFixture(t, () => ({data:{rsp_cd:'00000',t1602OutBlock1:[],t1662OutBlock:[]}}));
    f.setTime(timestamp('20261104','160010'));
    await f.provider.collect(); await f.provider.pollRest();
    assert.ok(!f.calls.some(c=>c.input.upcode==='900'));
    f.setTime(timestamp('20261104','202000'));
    f.calls.length = 0; await f.provider.collect(); await new Promise(r=>setImmediate(r));
    assert.equal(f.calls.length, 0);
});

test('a response still holding the previous session is not stored under today', async t => {
    const f = marketFixture(t, tr => tr==='t1662'
        ? {data:{rsp_cd:'00000',t1662OutBlock:[{time:'200500',tot3:9},{time:'080000',tot3:1}]}}
        : {data:{rsp_cd:'00000',t1602OutBlock1:[{time:'20103000',sv_08:'5',sv_17:'5',sv_18:'5'},{time:'08000000',sv_08:'1',sv_17:'1',sv_18:'1'}]}});
    f.setTime(timestamp('20261104','080130'));
    await f.provider.collect(); await f.provider.pollRest();
    assert.equal(f.provider.store.points('KOSPI0','2026-11-04').length, 0);
    assert.match(f.provider.status('kospi','2026-11-04').status.error, /이전 거래일/);
});
