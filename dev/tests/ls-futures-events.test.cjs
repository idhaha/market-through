const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {createLsFuturesEvents}=require('../../ls-futures-events');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
// 2026-11-11: LS JD0 · JX0 per near-month contract, off unless VI_FUTURES_EVENTS=on; raw messages kept; registration result logged.
test('registers JD0 and JX0 per contract, keeps raw messages and passes events on; off by default',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lsf-events-'));const sockets=[],events=[],logs=[];
    class FakeSocket extends EventEmitter{constructor(url){super();this.url=url;this.readyState=1;this.sent=[];sockets.push(this);setImmediate(()=>this.emit('open'));}send(raw){this.sent.push(JSON.parse(raw));}close(){this.readyState=3;}terminate(){this.readyState=3;}}
    const clock=Date.parse('2026-11-11T10:00:00+09:00');
    const base={getToken:async()=>'ls-token',WebSocket:FakeSocket,directory,now:()=>clock,contracts:async()=>['A116C000','A506C000'],onEvent:e=>events.push(e),log:m=>logs.push(m),sendGapMs:1};
    try{
        const off=createLsFuturesEvents({...base,enabled:()=>false});off.start();await pause(20);
        assert.equal(sockets.length,0);assert.match(off.state().state,/꺼짐/);
        const on=createLsFuturesEvents({...base,enabled:()=>true});on.start();await pause(60);
        const ws=sockets[0];assert.equal(ws.url,'wss://openapi.ls-sec.co.kr:9443/websocket');
        assert.deepEqual(ws.sent.map(m=>m.body.tr_cd+':'+m.body.tr_key),['JD0:A116C000','JX0:A116C000','JD0:A506C000','JX0:A506C000']);
        assert.equal(ws.sent[0].header.tr_type,'3');
        for(let i=0;i<3;i++)ws.emit('message',JSON.stringify({header:{tr_cd:'JD0',rsp_cd:'00000'},body:null}));
        ws.emit('message',JSON.stringify({header:{tr_cd:'JX0',rsp_cd:'IGW00121',rsp_msg:'등록 한도 초과'},body:null}));
        await pause(20);
        ws.emit('message',JSON.stringify({header:{tr_cd:'JX0',tr_key:'A116C000'},body:{futcode:'A116C000',upstep:'1',dnstep:'0',uplmtprice:'1100',dnlmtprice:'900'}}));
        assert.deepEqual(events.map(e=>[e.tr,e.futcode,e.body.upstep]),[['JX0','A116C000','1']]);
        const raw=fs.readFileSync(path.join(directory,'futures-events','2026-11-11.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
        assert.deepEqual([raw[0].tr,raw[0].key,raw[0].body.uplmtprice],['JX0','A116C000','1100']);
        assert.deepEqual([on.state().registered,on.state().rejected,on.state().received],[3,1,1]);
        assert.match(logs.join('\n'),/JD0 · JX0 등록 3건 · 거부 1건 \(첫 거부: 등록 한도 초과\)/);
        on.stop();
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
