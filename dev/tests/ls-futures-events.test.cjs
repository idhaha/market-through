const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createLsFuturesEvents}=require('../../ls-futures-events');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
class FakeSocket extends EventEmitter{constructor(url){super();this.url=url;this.readyState=1;this.sent=[];FakeSocket.all.push(this);setImmediate(()=>this.emit('open'));}send(raw){this.sent.push(JSON.parse(raw));}close(){this.readyState=3;}terminate(){this.readyState=3;}}
FakeSocket.all=[];
// 2026-11-14: one LS connection; the wanted registrations (JIF, JX0 · JD0 per watched month, JC0 near the limit) are added (tr_type 3)
// and removed (tr_type 4) by difference; raw messages kept only for JX0 · JIF; off unless VI_FUTURES_EVENTS=on.
test('registers the wanted list, adds and removes by difference on sync, keeps only JX0 · JIF raw, passes every event on; off by default',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lsf-events-'));const events=[],logs=[],conn=[];FakeSocket.all.length=0;
    const clock=Date.parse('2026-11-16T10:00:00+09:00');
    let wanted=[['JIF','0'],['JX0','A116C000'],['JD0','A116C000']];
    const base={getToken:async()=>'ls-token',WebSocket:FakeSocket,directory,now:()=>clock,registrations:async()=>wanted,onEvent:e=>events.push(e),onConnection:up=>conn.push(up),log:m=>logs.push(m),sendGapMs:1};
    try{
        const off=createLsFuturesEvents({...base,enabled:()=>false});off.start();await pause(20);
        assert.equal(FakeSocket.all.length,0);assert.match(off.state().state,/꺼짐/);
        const on=createLsFuturesEvents({...base,enabled:()=>true});on.start();await pause(60);
        const ws=FakeSocket.all[0];assert.equal(ws.url,'wss://openapi.ls-sec.co.kr:9443/websocket');assert.deepEqual(conn,[true]);
        const sent=()=>ws.sent.map(m=>m.header.tr_type+':'+m.body.tr_cd+':'+m.body.tr_key);
        assert.deepEqual(sent(),['3:JIF:0','3:JX0:A116C000','3:JD0:A116C000']);
        // A month near the limit: JC0 added; later removed. Nothing else is sent again.
        wanted=[...wanted,['JC0','A116C000']];await on.sync();await pause(20);
        assert.deepEqual(sent().slice(3),['3:JC0:A116C000']);
        wanted=wanted.filter(([tr])=>tr!=='JC0');await on.sync();await pause(20);
        assert.deepEqual(sent().slice(4),['4:JC0:A116C000']);
        ws.emit('message',JSON.stringify({header:{tr_cd:'JX0',rsp_cd:'00000'},body:null}));
        ws.emit('message',JSON.stringify({header:{tr_cd:'JD0',rsp_cd:'IGW00121',rsp_msg:'등록 한도 초과'},body:null}));
        for(const [tr,body] of [['JX0',{futcode:'A116C000',upstep:'02',dnstep:'01',uplmtprice:'120000',dnlmtprice:'90000'}],['JD0',{futcode:'A116C000',dy_gubun:'1',dy_uplmtprice:'101000',dy_dnlmtprice:'99000'}],
            ['JC0',{futcode:'A116C000',price:'100500',chetime:'100000'}],['JIF',{jangubun:'1',jstatus:'61'}]])
            ws.emit('message',JSON.stringify({header:{tr_cd:tr,tr_key:tr==='JIF'?'0':'A116C000'},body}));
        assert.deepEqual(events.map(e=>[e.tr,e.futcode]),[['JX0','A116C000'],['JD0','A116C000'],['JC0','A116C000'],['JIF','']]);
        const raw=fs.readFileSync(path.join(directory,'futures-events','2026-11-16.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
        assert.deepEqual(raw.map(r=>r.tr),['JX0','JIF'],'JD0 (about 110,000 a day) and JC0 are not kept');
        assert.deepEqual([on.state().registered,on.state().rejected,on.state().received],[1,1,4]);
        await pause(10);ws.emit('close',1006,'');assert.deepEqual(conn,[true,false]);
        on.stop();
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('older callers: contracts() alone registers JX0 per month',async()=>{
    FakeSocket.all.length=0;
    const on=createLsFuturesEvents({getToken:async()=>'t',WebSocket:FakeSocket,now:()=>Date.parse('2026-11-16T10:00:00+09:00'),contracts:async()=>['A116C000','A506C000'],enabled:()=>true,sendGapMs:1});
    on.start();await pause(40);
    assert.deepEqual(FakeSocket.all[0].sent.map(m=>m.body.tr_cd+':'+m.body.tr_key),['JX0:A116C000','JX0:A506C000']);on.stop();
});
