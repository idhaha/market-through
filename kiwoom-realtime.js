'use strict';
// 키움 웹소켓 하나(앱키 하나)를 대주 StopLoss용으로 여는 작은 연결(2026-11-21).
// 추가 계좌(KIWOOM_APPKEY_28)는 그 계좌 앱키로 자기 웹소켓을 열어 감시 종목 체결(0B)과 그 계좌의 주문체결 · 잔고(00 · 04)를 받는다.
// 키움은 앱키당 웹소켓 하나만 허용하므로(새 연결이 기존 연결을 끊음, R10001) active()가 참인 서버(SHORT_STOPLOSS=on)에서만 연다.
// 바깥 모양은 VI 모니터의 sharedRealtime과 같다: set(그룹, 종목, 유형) · onReal(fn) · connected() · state() · status().
const KIWOOM_SOCKET = 'wss://api.kiwoom.com:10000/api/dostk/websocket';

function createKiwoomRealtime({ getToken, rejectToken = () => {}, WebSocket = require('ws'), active = () => true, now = Date.now, log = () => {}, label = '키움 실시간', checkMs = 5000,
    hours = t => { const d = new Date(t + 9 * 3600000), w = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes(); return w > 0 && w < 6 && m >= 475 && m < 1205; } }) {
    const groups = new Map(), listeners = new Set(), stats = { acks: 0, errors: [] };
    let socket = null, connecting = false, loggedIn = false, state = '대기 중', reconnects = 0, retryAt = 0, ackTimer = null, timer = null;
    const wanted = () => active() && hours(now()) && [...groups.values()].some(g => g.items.length);
    function send(grp) {
        const g = groups.get(grp); if (!g || !socket || !loggedIn || socket.readyState !== WebSocket.OPEN) return;
        if (g.sent && g.sent.length) socket.send(JSON.stringify({ trnm: 'REMOVE', grp_no: grp, refresh: '1', data: [{ item: g.sent, type: g.types }] }));
        g.sent = null;
        if (g.items.length) { socket.send(JSON.stringify({ trnm: 'REG', grp_no: grp, refresh: '1', data: [{ item: g.items, type: g.types }] })); g.sent = g.items.slice(); }
    }
    function receive(raw) {
        let m; try { m = JSON.parse(String(raw)); } catch { return; }
        if (m.trnm === 'PING') { socket?.send(String(raw)); return; }
        if (m.trnm === 'LOGIN') {
            clearTimeout(ackTimer);
            if (String(m.return_code) !== '0') { state = '키움 로그인 거부'; log(`${label}: 로그인 거부 ${m.return_code} ${m.return_msg || ''}`); rejectToken(); socket?.close(); return; }
            loggedIn = true; reconnects = 0; state = '실시간 수신 중';
            for (const g of groups.values()) g.sent = null;
            for (const grp of groups.keys()) send(grp);
            return;
        }
        if (m.trnm === 'REG') { stats.acks++; if (String(m.return_code) !== '0') { stats.errors.push({ at: now(), code: m.return_code, msg: m.return_msg }); if (stats.errors.length > 20) stats.errors.shift(); log(`${label}: 등록 거부 ${m.return_code} ${m.return_msg || ''}`); } return; }
        if (m.trnm !== 'REAL' || !Array.isArray(m.data)) return;
        for (const d of m.data) for (const fn of listeners) try { fn(d); } catch {}
    }
    async function connect() {
        if (socket || connecting || now() < retryAt) return;
        connecting = true; state = '연결 중';
        try {
            const token = await getToken();
            if (!wanted()) return;
            const ws = new WebSocket(KIWOOM_SOCKET, { handshakeTimeout: 10000, maxPayload: 1048576 }); socket = ws; loggedIn = false;
            ws.on('open', () => {
                if (socket !== ws) return;
                ws.send(JSON.stringify({ trnm: 'LOGIN', token })); state = '로그인 확인 중';
                ackTimer = setTimeout(() => { if (socket === ws && !loggedIn) { state = '로그인 응답 지연'; ws.terminate(); } }, 15000); ackTimer.unref?.();
            });
            ws.on('message', raw => { if (socket === ws) receive(raw); });
            ws.on('error', () => { if (socket === ws) { state = '연결 오류'; ws.terminate(); } });
            ws.on('close', () => {
                if (socket !== ws) return;
                clearTimeout(ackTimer); socket = null; loggedIn = false; for (const g of groups.values()) g.sent = null;
                if (wanted()) { state = '연결 끊김 · 재연결 대기'; retryAt = now() + Math.min(60000, 2000 * 2 ** Math.min(reconnects++, 5)); }
                else state = '대기 중';
            });
        } catch (error) { state = '키움 인증 · 연결 실패'; retryAt = now() + 30000; log(`${label}: ${error.message || error}`); }
        finally { connecting = false; }
    }
    function check() {
        if (wanted()) void connect();
        else if (socket) { const ws = socket; socket = null; loggedIn = false; clearTimeout(ackTimer); for (const g of groups.values()) g.sent = null; state = '대기 중'; try { ws.close(); } catch {} }
    }
    function start() { if (timer) return; timer = setInterval(check, checkMs); timer.unref?.(); check(); }
    function stop() { clearInterval(timer); timer = null; if (socket) { const ws = socket; socket = null; try { ws.close(); } catch {} } }
    return {
        set(grp, items, types) { grp = String(grp); const g = groups.get(grp) || { sent: null }; g.items = [...new Set(items)]; g.types = types; groups.set(grp, g); if (loggedIn) send(grp); else check(); },
        onReal(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        connected: () => !!socket && loggedIn,
        state: () => state,
        status: () => ({ acks: stats.acks, errors: stats.errors.slice(), groups: Object.fromEntries([...groups].map(([k, g]) => [k, { items: g.items.length, sent: !!g.sent, types: g.types }])) }),
        start, stop, check, _receive: receive
    };
}

module.exports = { createKiwoomRealtime, KIWOOM_SOCKET };
