'use strict';
// 2026-11-16: the VI socket connected only from 08:00 (spot session), checked every 30 seconds, so NXT opening VIs at
// 08:00:00~08:00:20 were missed and only their releases arrived (12 rows '발동 이벤트 미수신'). It now connects 2 minutes early.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createViMonitor}=require('../../vi-monitor-service');
const at=s=>Date.parse('2026-11-16T'+s+'+09:00');
// Same window as trading-session spotAt: 08:00 <= KST < 20:00 on an open day.
const spotAt=t=>{const d=new Date(t+9*3600000),m=d.getUTCHours()*60+d.getUTCMinutes();return m>=480&&m<1200;};
async function sockets(time){
    const clock={t:at(time)},made=[];
    class WS{constructor(){made.push(this);}on(){}send(){}close(){}terminate(){}}
    const m=createViMonitor({directory:fs.mkdtempSync(path.join(os.tmpdir(),'vi-lead-')),now:()=>clock.t,policy:()=>({openDate:()=>true,spotAt}),enabled:()=>true,
        WebSocket:WS,http:{post:async()=>({data:{rsp_cd:'00000'}})},getToken:async()=>'x',kiwoomToken:async()=>'x'});
    m.start();await new Promise(r=>setTimeout(r,30));m.stop();return made.length;
}
test('VI socket connects from 07:58 so the 08:00:00 NXT opening VIs are received',async()=>{
    assert.equal(await sockets('07:58:10'),1,'07:58 connects (2 minutes before the 08:00 NXT open)');
    assert.equal(await sockets('07:57:30'),0,'not earlier than 2 minutes before');
    assert.equal(await sockets('19:59:00'),1,'still connected in the session');
    assert.equal(await sockets('20:00:30'),0,'no connection after 20:00');
});
