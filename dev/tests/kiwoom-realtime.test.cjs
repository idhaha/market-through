'use strict';
// 대주 StopLoss 추가 계좌용 키움 웹소켓(kiwoom-realtime.js, 2026-11-21): 가짜 웹소켓으로 확인한다.
//  - 자동 주문이 꺼진 서버(active false)와 장외 시간에는 열지 않는다(같은 앱키의 다른 서버 연결을 끊지 않게).
//  - LOGIN 성공 뒤에만 그룹을 등록하고, 재연결하면 다시 등록한다. PING은 그대로 돌려준다. REAL은 듣는 쪽에 넘긴다.
//  - 꺼지면(active false) 연결을 닫는다. 로그인 거부면 토큰을 버린다.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createKiwoomRealtime } = require('../../kiwoom-realtime');

const sockets = [];
class FakeWs extends EventEmitter {
    static OPEN = 1;
    constructor(url) { super(); this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(m) { this.sent.push(JSON.parse(m)); }
    close() { this.readyState = 3; this.emit('close'); }
    terminate() { this.close(); }
    open() { this.readyState = 1; this.emit('open'); }
    msg(o) { this.emit('message', Buffer.from(JSON.stringify(o))); }
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
    let on = false, t = Date.parse('2026-11-23T10:00:00+09:00'), rejected = 0;
    const rt = createKiwoomRealtime({ getToken: async () => 'T28', rejectToken: () => rejected++, WebSocket: FakeWs, active: () => on, now: () => t, checkMs: 60000 });
    const got = []; rt.onReal(d => got.push(d));
    rt.set('2', [''], ['00', '04']);
    await tick(); assert.equal(sockets.length, 0, '자동 주문 꺼진 서버는 열지 않음');
    on = true; t = Date.parse('2026-11-23T21:00:00+09:00'); rt.check(); await tick();
    assert.equal(sockets.length, 0, '장외(21:00)에는 열지 않음');
    t = Date.parse('2026-11-23T07:56:00+09:00'); rt.check(); await tick();
    assert.equal(sockets.length, 1); const ws = sockets[0];
    assert.equal(ws.url, 'wss://api.kiwoom.com:10000/api/dostk/websocket');
    rt.set('1', ['004980', '004980_NX'], ['0B']);
    ws.open(); assert.deepEqual(ws.sent, [{ trnm: 'LOGIN', token: 'T28' }], '로그인 전에는 등록하지 않음');
    ws.msg({ trnm: 'LOGIN', return_code: 0 });
    assert.deepEqual(ws.sent.slice(1).map(m => [m.trnm, m.grp_no, m.data[0].type.join()]), [['REG', '2', '00,04'], ['REG', '1', '0B']]);
    assert.equal(rt.connected(), true);
    ws.msg({ trnm: 'PING' }); assert.deepEqual(ws.sent.at(-1), { trnm: 'PING' });
    ws.msg({ trnm: 'REAL', data: [{ type: '00', item: '004980', values: { 9203: '0000501' } }] });
    assert.equal(got.length, 1); assert.equal(got[0].values['9203'], '0000501');
    // 종목이 바뀌면 이전 등록을 지우고 새로 등록
    rt.set('1', ['005930'], ['0B']);
    assert.deepEqual(ws.sent.slice(-2).map(m => [m.trnm, m.data[0].item.join()]), [['REMOVE', '004980,004980_NX'], ['REG', '005930']]);
    // 끊기면 재연결 뒤 다시 등록
    ws.close(); assert.equal(rt.connected(), false);
    t += 3000; rt.check(); await tick(); assert.equal(sockets.length, 2);
    const ws2 = sockets[1]; ws2.open(); ws2.msg({ trnm: 'LOGIN', return_code: 0 });
    assert.deepEqual(ws2.sent.slice(1).map(m => [m.trnm, m.grp_no]), [['REG', '2'], ['REG', '1']]);
    // 서버에서 자동 주문을 끄면 닫는다
    on = false; rt.check(); assert.equal(ws2.readyState, 3); assert.equal(rt.connected(), false);
    // 로그인 거부 → 토큰을 버리고 닫음
    on = true; t += 120000; rt.check(); await tick(); const ws3 = sockets[2]; ws3.open(); ws3.msg({ trnm: 'LOGIN', return_code: 1, return_msg: '토큰 오류' });
    assert.equal(rejected, 1); assert.equal(ws3.readyState, 3);
    rt.stop();
    console.log('kiwoom-realtime: 모든 확인 통과');
})().catch(error => { console.error(error); process.exit(1); });
