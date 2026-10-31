const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {EventEmitter}=require('node:events');
function fixture(){
    const records=[],calls=[],sockets=[];
    class Socket extends EventEmitter{
        static OPEN=1;static CONNECTING=0;
        constructor(url){super();this.url=url;this.readyState=0;this.sent=[];sockets.push(this);}
        send(value){this.sent.push(JSON.parse(value));}
    }
    const mod={exports:{}};
    const env=Object.fromEntries(['DB','NAMU','LS'].flatMap(p=>['APPKEY','SECRETKEY'].map(s=>[p+'_'+s,'fake-secret'])));
    const localRequire=name=>{
        if(name==='axios')return {post:async(url,body,options)=>{
            calls.push({url,body,options});
            return url.endsWith('/oauth2/token')?{data:{access_token:'fake-token',expires_in:86400}}:{data:{rsp_cd:'00000',Output_0:[{timez12:'261102180100',prsn_val:0,frgn_val:1,orgn_val:-1}]},headers:{cts_flag:'N'}};
        }};
        if(name==='node:fs')return {appendFileSync:(_,line)=>records.push(JSON.parse(line))};
        if(name==='ws')return Socket;
        if(name==='dotenv')return {config:()=>{}};
        return require(name);
    };
    vm.runInNewContext(fs.readFileSync('dev/probe-night-supply-20261102.cjs','utf8'),{require:localRequire,module:mod,__dirname:path.resolve('dev'),process:{env},URLSearchParams,console,setTimeout:fn=>{fn();}});
    return {api:mod.exports,calls,records,sockets};
}
test('NH probes both futures markets at one-minute frequency and reuses token without logging it',async()=>{
    const f=fixture();await f.api.probeNh();
    const queries=f.calls.filter(c=>!c.url.endsWith('/oauth2/token'));
    assert.deepEqual(queries.map(c=>c.body.Input_0.mrkt_cls_code),['3','6']);
    assert.ok(queries.every(c=>c.body.Input_0.cycle_cls_code==='4'&&c.body.Input_0.opt_cls_code==='1'));
    assert.equal(f.calls.length,3);assert.equal(f.records.length,2);
    assert.equal(f.records[0].rows[0].prsn_val,0);
    assert.doesNotMatch(JSON.stringify(f.records),/fake-token|fake-secret/);
});
test('DB subscribes both investor markets, preserves source times, strips token headers and avoids duplicate sockets',async()=>{
    const f=fixture();await f.api.ensureDb();await f.api.ensureDb();assert.equal(f.sockets.length,1);
    const socket=f.sockets[0];socket.readyState=1;socket.emit('open');
    assert.deepEqual(socket.sent.map(s=>s.body.tr_key),['F001K2I','F002KQI']);
    socket.emit('message',Buffer.from(JSON.stringify({header:{token:'fake-token',tr_cd:'U05'},body:{BstpInvrcode:'F001K2I',BsopHour:'180100',PrsnNtbytrpb:0}})));
    assert.equal(f.records.at(-1).body.BsopHour,'180100');
    assert.doesNotMatch(JSON.stringify(f.records),/fake-token|fake-secret/);
});
