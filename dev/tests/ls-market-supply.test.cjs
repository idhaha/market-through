const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {EventEmitter} = require('node:events');
const {createLsMarketSupply, subscriptions, sourceTime} = require('../../ls-market-supply');
const {timestamp} = require('../../supply-service');
function fixture(t, validated = true, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-supply-'));
    let time = timestamp('20261023', '101000');
    const checks = Object.fromEntries(subscriptions.map(s => [`${s.tr}:${s.key}`, {
        market:s.market, cumulative:true, timeFormat:s.tr==='UPM'?'HHmmss':'HHmmsscc', toMillionWon:s.tr === 'UPM' ? 1 : 100, evidence:'test fixture only'
    }]));
    if (validated) fs.writeFileSync(path.join(directory,'validation.json'),JSON.stringify(checks));
    const sockets = [], calls = [];
    class Socket extends EventEmitter {
        constructor(url) {super();this.sent=[];sockets.push(this);}
        send(text) {this.sent.push(JSON.parse(text));}
        close() {this.emit('close');}
    }
    const provider = createLsMarketSupply({directory,now:()=>time,WebSocket:Socket,...options,
        supply:options.supply || {confirmMarket:async()=>true,futuresAllowed:()=>true},credentials:()=>({appKey:'private-key',secretKey:'private-secret'}),
        http:{post:async(url)=>{calls.push(url);if(url.endsWith('/token'))return {data:{access_token:'private-token',expires_in:3600}};return {data:{rsp_cd:'00000',t1602OutBlock1:[]}};}}});
    t.after(()=>{provider.stop();fs.rmSync(directory,{recursive:true,force:true});});
    return {provider,sockets,calls,setTime:t=>{time=t;},directory};
}
function message(tr,key,time,body) {return JSON.stringify({header:{tr_cd:tr,tr_key:key},body:{...(tr==='UPM'?{time}:{tjjtime:time}),...body}});}
test('closed sessions do not authenticate or connect and ignore futures frames', async t => {
    const f = fixture(t,true,{supply:{confirmMarket:async()=>false,futuresAllowed:()=>false}});
    f.setTime(timestamp('20261024','220000'));
    f.provider.start(); await f.provider.collect();
    assert.equal(f.calls.length,0); assert.equal(f.sockets.length,0);
    f.provider.receive(message('BMT','900','22000000',{msval2:'9'}));
    f.setTime(timestamp('20261024','220100')); f.provider.flush();
    assert.equal(f.provider.store.points('FUTURE','2026-10-24').length,0);
});

test('night futures accept fresh ticks across midnight while spot remains closed and stale ticks are rejected', async t => {
    const f = fixture(t), p = f.provider;
    f.setTime(timestamp('20261023', '213000')); await p.collect();
    p.receive(message('BMT','900','21300000',{msval2:'7'}));
    p.receive(message('UBT','U001','21300000',{msval2:'99'}));
    f.setTime(timestamp('20261023','213100')); p.flush();
    assert.equal(p.store.points('FUTURE','2026-10-23')[0].foreign,700);
    assert.equal(p.store.points('KOSPI0','2026-10-23').length,0);
    f.setTime(timestamp('20261024','000010')); await p.collect();
    p.receive(message('BMT','900','23595000',{msval2:'8'}));
    p.receive(message('BMT','900','23000000',{msval2:'999'}));
    p.receive(message('BMT','901','00000500',{msval2:'9'}));
    f.setTime(timestamp('20261024','000100')); p.flush();
    assert.equal(p.store.points('FUTURE','2026-10-23').at(-1).foreign,800);
    assert.equal(p.store.points('FUTKQ0','2026-10-24')[0].foreign,900);
});
test('one shared socket subscribes six sources, coalesces a minute, retains zero and never carries a missing minute forward', async t=>{
    const f=fixture(t), p=f.provider;p.start();await p.collect();assert.equal(f.sockets.length,1);
    f.sockets[0].emit('open');assert.equal(f.sockets[0].sent.length,1);
    for(const s of subscriptions)f.sockets[0].emit('message',JSON.stringify({header:{tr_cd:s.tr,rsp_cd:'00000',rsp_msg:'정상처리되었습니다'}}));
    assert.equal(f.sockets[0].sent.length,6);await p.collect();assert.equal(f.sockets.length,1);
    p.receive(message('UBT','U001','10100000',{upcode:'001',msval1:'2',msval2:'-3',msval3:'1'}));
    f.setTime(timestamp('20261023','101040'));
    p.receive(message('UBT','U001','10103000',{msval1:'0',msval2:'-4',msval3:'4'}));
    p.receive(message('UPM','U0','101035',{tval:'-7'}));
    assert.equal(p.store.points('KOSPI0','2026-10-23').length,0);
    f.setTime(timestamp('20261023','101100'));p.flush();
    const rows=p.store.points('KOSPI0','2026-10-23');assert.equal(rows.length,1);assert.equal(rows[0].individual,0);assert.equal(rows[0].foreign,-400);assert.equal(rows[0].program,-7);
    f.setTime(timestamp('20261023','101300'));p.flush();assert.equal(p.store.points('KOSPI0','2026-10-23').length,1);
});
test('unknown markets, future/stale/invalid clocks and out-of-order messages cannot overwrite valid data',async t=>{
    const f=fixture(t),p=f.provider;await p.collect();
    for(const time of ['10110000','10000000','25600000'])p.receive(message('UBT','U001',time,{msval2:'999'}));
    p.receive(message('UBT','U001','10100000',{upcode:'301',msval2:'999'}));
    p.receive(message('BMT','902','10100000',{msval2:'999'}));
    p.receive(message('UBT','U001','10100000',{msval2:'-2'}));
    p.receive(message('UBT','U001','10095900',{msval2:'999'}));
    f.setTime(timestamp('20261023','101100'));p.flush();
    const rows=p.store.points('KOSPI0','2026-10-23');assert.equal(rows.length,1);assert.equal(rows[0].foreign,-200);
    assert.ok(Number.isNaN(sourceTime('999999',timestamp('20261023','101000'))));
});
test('unverified amounts persist raw but remain absent from chart, including unverified futures',async t=>{
    const f=fixture(t,false),p=f.provider;await p.collect();
    p.receive(message('BMT','901','10100000',{msval1:'1',msval2:'-2',msval3:'1'}));
    f.setTime(timestamp('20261023','101100'));p.flush();
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'raw','FUTKQ0','2026-10-23.json')))[0].foreign,-2);
    assert.deepEqual(p.store.points('FUTKQ0','2026-10-23'),[{t:timestamp('20261023','101000')}]);
    assert.equal(p.status('futuresKosdaq','2026-10-23').partial,true);
});
test('reconnection has backoff, stop prevents late authentication from opening a socket, and errors conceal credentials',async t=>{
    const f=fixture(t);f.provider.start();await f.provider.collect();f.sockets[0].emit('close');await f.provider.collect();assert.equal(f.sockets.length,1);
    f.setTime(timestamp('20261023','101010'));await f.provider.collect();assert.equal(f.sockets.length,2);
    f.provider.stop();assert.ok(!JSON.stringify(f.provider.status('kospi','2026-10-23')).includes('private'));
    const p=createLsMarketSupply({directory:f.directory,http:{post:async()=>{throw {config:{secret:'private-secret'}};}},credentials:()=>({appKey:'private-key',secretKey:'private-secret'}),supply:{}});
    await assert.rejects(p.accessToken(),{message:'LS 접근토큰 발급 실패'});
});


test('deployed cash market defaults work without private validation files, while futures stay unverified',async t=>{
 const f=fixture(t,false,{validationDefaults:require('../../ls-market-validation')}),p=f.provider;await p.collect();
 p.receive(message('UBT','U001','10100000',{upcode:'001',msval1:'2',msval2:'-3',msval3:'1'}));
 p.receive(message('UPM','U0','101000',{upcode:'001',tval:'-7'}));
 f.setTime(timestamp('20261023','101100'));p.flush();
 const point=p.store.points('KOSPI0','2026-10-23')[0];assert.equal(point.individual,200);assert.equal(point.foreign,-300);assert.equal(point.program,-7);
 assert.ok(p.warnings('futures').some(w=>w.includes('검증')));
 fs.writeFileSync(path.join(f.directory,'validation.json'),JSON.stringify({'UBT:U001':null}));assert.ok(p.warnings('kospi').some(w=>w.includes('UBT')));
});
