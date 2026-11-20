'use strict';
// 키움 웹소켓 동시 연결 시험(2026-11-20): 대주 StopLoss가 웹소켓을 따로 열면 VI 모니터(같은 앱키 · 같은 토큰)의 연결이 끊기는지 본다.
//  - 시험 전후로 로컬 서버(node server.js)의 키움 :10000 연결(로컬 포트)을 기록한다. 포트가 바뀌거나 사라지면 VI 연결이 끊겼다 다시 붙은 것이다.
//  - 시험 연결 A(0B 체결: 삼성전자 KRX · NXT)와 B(00 주문체결 · 04 잔고)를 차례로 열어, 서로 끊기는지와 받은 건수를 기록한다.
// 주문은 내지 않는다. 결과: outputs/kiwoom-ws-coexist-<날짜>.json
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path'), WebSocket = require('ws');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const seconds = Number(process.argv[process.argv.indexOf('--seconds') + 1]) || 90;
const onlyB = process.argv.includes('--only-b'); // 0B 시세 연결 없이 00·04 연결만 시험(VI 끊김을 줄이기 위해)
const kst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(11, 23);
const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
const out = { startedAt: kst(), events: [], sockets: {} };
const note = (who, what, data) => { const e = { at: kst(), who, what, ...(data ? { data } : {}) }; out.events.push(e); console.log(JSON.stringify(e)); };
const token = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kiwoom-token', 'token.json'), 'utf8')).token;

function serverKiwoomPorts() {
    const ps = "$p=(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server\\.js' }).ProcessId; " +
        "Get-NetTCPConnection -State Established -RemotePort 10000 -ErrorAction SilentlyContinue | Where-Object { $p -contains $_.OwningProcess } | ForEach-Object { \"$($_.LocalPort)>$($_.RemoteAddress)\" }";
    try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).split(/\s+/).filter(Boolean); } catch (e) { return ['조회 실패: ' + e.message]; }
}
function open(name, types, items) {
    const s = { name, open: false, closed: null, login: null, reg: null, real: 0, lastReal: null, errors: [] };
    out.sockets[name] = s;
    const ws = new WebSocket('wss://api.kiwoom.com:10000/api/dostk/websocket', { handshakeTimeout: 10000 });
    ws.on('open', () => { s.open = kst(); note(name, '연결'); ws.send(JSON.stringify({ trnm: 'LOGIN', token })); });
    ws.on('message', raw => {
        let m; try { m = JSON.parse(String(raw)); } catch { return; }
        if (m.trnm === 'PING') return ws.send(String(raw));
        if (m.trnm === 'LOGIN') { s.login = { code: m.return_code, msg: m.return_msg }; note(name, '로그인', s.login); if (String(m.return_code) === '0') ws.send(JSON.stringify({ trnm: 'REG', grp_no: '1', refresh: '1', data: [{ item: items, type: types }] })); return; }
        if (m.trnm === 'REG') { s.reg = { code: m.return_code, msg: m.return_msg }; note(name, '등록', s.reg); return; }
        if (m.trnm === 'REAL') { s.real += (m.data || []).length; s.lastReal = kst(); return; }
        note(name, '기타 메시지', m);
    });
    ws.on('close', (code, reason) => { s.closed = { at: kst(), code, reason: String(reason) }; note(name, '끊김', s.closed); });
    ws.on('error', e => { s.errors.push(String(e.message)); note(name, '오류', String(e.message)); });
    return ws;
}
(async () => {
    out.serverBefore = serverKiwoomPorts(); note('서버', '시험 전 키움 :10000 연결', out.serverBefore);
    const a = onlyB ? { close() {} } : open('A(0B 체결)', ['0B'], ['005930', '005930_NX']);
    if (onlyB) out.sockets['A(0B 체결)'] = { real: 0, closed: null, skipped: true };
    await new Promise(r => setTimeout(r, onlyB ? 1000 : 15000));
    out.serverAfterA = serverKiwoomPorts(); note('서버', 'A 연결 뒤', out.serverAfterA);
    const b = open('B(00·04 주문 · 잔고)', ['00', '04'], ['']);
    await new Promise(r => setTimeout(r, Math.max(15000, (seconds - 15) * 1000)));
    out.serverAfterB = serverKiwoomPorts(); note('서버', 'B 연결 뒤', out.serverAfterB);
    a.close(); b.close();
    await new Promise(r => setTimeout(r, 3000));
    out.serverEnd = serverKiwoomPorts(); note('서버', '시험 연결 닫은 뒤', out.serverEnd);
    out.vi = { 유지: out.serverBefore.length > 0 && out.serverBefore.every(p => out.serverAfterA.includes(p) && out.serverAfterB.includes(p) && out.serverEnd.includes(p)) };
    out.endedAt = kst();
    const file = path.join(root, 'outputs', `kiwoom-ws-coexist-${day}${onlyB ? '-onlyB' : ''}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log('결과:', JSON.stringify({ vi: out.vi, A: { real: out.sockets['A(0B 체결)'].real, closed: out.sockets['A(0B 체결)'].closed }, B: { real: out.sockets['B(00·04 주문 · 잔고)'].real, closed: out.sockets['B(00·04 주문 · 잔고)'].closed } }), file);
})();
