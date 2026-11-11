'use strict';
// 주식선물 가격제한 이벤트 수신 (2026-11-11): LS 실시간 JD0(주식선물 실시간 상·하한가) · JX0(주식선물 가격제한폭 확대).
// - 메시지에는 futcode(선물 종목코드)만 있다. 종목은 VI 모니터가 LS 선물 마스터(t8401 basecode)로 찾는다.
// - 받은 메시지는 원문 그대로 data/vi-monitor/futures-events/날짜.jsonl에 남긴다(칸 뜻 확인 · 거래소 공지 대조용).
// - 기본은 꺼짐: VI_FUTURES_EVENTS=on일 때만 연결한다. LS 앱키를 오라클과 함께 쓰고, 등록 건수(주식선물 약 250종목 × 2 TR)의
//   한도와 전체 종목 키 지원 여부를 아직 시험하지 않았기 때문이다. 등록 결과(성공 · 거부 건수와 첫 거부 사유)는 server_debug에 남긴다.
// - 연결 시간: 평일 08:30~16:30(주식선물 정규장 08:45~15:45 앞뒤).
// - 거래중단 · 재개 전용 TR은 LS 실시간 목록에서 찾지 못해 받지 않는다(UNKNOWN). 가격 움직임으로 추정하지 않는다.
const fs = require('node:fs'), path = require('node:path');
const SOCKET = 'wss://openapi.ls-sec.co.kr:9443/websocket';
const TRS = ['JD0', 'JX0'];
const dayKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
function createLsFuturesEvents({ getToken, WebSocket = require('ws'), directory, now = Date.now, contracts, onEvent = () => {}, log = () => {},
    enabled = () => (process.env.VI_FUTURES_EVENTS || '').trim() === 'on', sendGapMs = 60, sessionAt }) {
    let socket = null, stopped = true, retry = null, schedule = null, connecting = false, reconnects = 0, state = '꺼짐', day = '';
    let registered = 0, rejected = 0, firstReject = '', pending = [], sendTimer = null, received = 0, total = 0, reportTimer = null;
    const open = sessionAt || (t => { const k = new Date(t + 9 * 3600000), m = k.getUTCHours() * 60 + k.getUTCMinutes(); return ![0, 6].includes(k.getUTCDay()) && m >= 510 && m <= 990; });
    const eventDir = directory && path.join(directory, 'futures-events');
    function keep(line) { if (!eventDir) return; try { fs.mkdirSync(eventDir, { recursive: true }); fs.appendFileSync(path.join(eventDir, dayKey(now()) + '.jsonl'), JSON.stringify(line) + '\n'); } catch {} }
    function sendNext(ws) {
        sendTimer = null;
        // After the last send: report when every answer is in (see the message handler) or 10 seconds later.
        if (socket !== ws || ws.readyState !== 1 || !pending.length) { if (socket === ws && !pending.length) { clearTimeout(reportTimer); reportTimer = setTimeout(reportRegistration, 10000); reportTimer.unref?.(); } return; }
        const [tr, key] = pending.shift();
        ws.send(JSON.stringify({ header: { token: ws.token, tr_type: '3' }, body: { tr_cd: tr, tr_key: key } }));
        sendTimer = setTimeout(() => sendNext(ws), sendGapMs); sendTimer.unref?.();
    }
    let reported = false;
    function reportRegistration() {
        if (reported) return; reported = true; clearTimeout(reportTimer);
        state = `JD0 · JX0 등록 ${registered}건${rejected ? ` · 거부 ${rejected}건` : ''}`;
        log(`[선물 이벤트] LS ${state}${firstReject ? ' (첫 거부: ' + firstReject + ')' : ''}`);
    }
    async function connect() {
        if (stopped || socket || connecting) return;
        if (!open(now())) { state = '장외 · 연결 안 함'; return; }
        connecting = true; state = '연결 중';
        try {
            const list = await contracts(); if (stopped) return;
            const token = await getToken(); if (stopped) return;
            const ws = new WebSocket(SOCKET, { handshakeTimeout: 10000 }); ws.token = token; socket = ws; day = dayKey(now());
            registered = 0; rejected = 0; firstReject = ''; reported = false;
            pending = list.flatMap(code => TRS.map(tr => [tr, code])); total = pending.length;
            ws.on('open', () => { if (socket !== ws) return; state = `등록 중 (${pending.length}건)`; reconnects = 0; sendNext(ws); });
            ws.on('message', raw => {
                if (socket !== ws) return;
                let m; try { m = JSON.parse(String(raw)); } catch { return; }
                const tr = m.header?.tr_cd, body = m.body;
                // Registration answers carry rsp_cd; data messages carry the body fields.
                if (m.header?.rsp_cd != null && (!body || !Object.keys(body).length)) {
                    if (['00000', '0000', '0'].includes(String(m.header.rsp_cd))) registered++;
                    else { rejected++; if (!firstReject) firstReject = String(m.header.rsp_msg || m.header.rsp_cd).replace(/[A-Za-z0-9_+\/=.~-]{24,}/g, '[redacted]').slice(0, 120); }
                    if (registered + rejected >= total) reportRegistration();
                    return;
                }
                if (!TRS.includes(tr) || !body) return;
                received++;
                const event = { tr, futcode: String(body.futcode || m.header?.tr_key || '').trim(), body, receivedAt: now() };
                keep({ at: new Date(event.receivedAt + 9 * 3600000).toISOString().slice(11, 23), tr, key: m.header?.tr_key ?? null, body });
                try { void onEvent(event); } catch {}
            });
            ws.on('error', () => { if (socket === ws) ws.terminate(); });
            ws.on('close', (code, reason) => {
                if (socket !== ws) return; socket = null; clearTimeout(sendTimer);
                state = '연결 끊김 · 재연결 대기'; log(`[선물 이벤트] LS 연결 끊김 (${code}) ${String(reason || '').replace(/[A-Za-z0-9_+\/=.~-]{24,}/g, '[redacted]').slice(0, 120)}`);
                if (!stopped) { retry = setTimeout(() => void connect(), Math.min(60000, 2000 * 2 ** Math.min(reconnects++, 5))); retry.unref?.(); }
            });
        } catch (error) {
            state = '연결 실패'; log('[선물 이벤트] LS 연결 실패: ' + String(error.message || error).slice(0, 120));
            if (!stopped) { retry = setTimeout(() => void connect(), 60000); retry.unref?.(); }
        } finally { connecting = false; }
    }
    function start() {
        if (!enabled()) { state = '꺼짐 (VI_FUTURES_EVENTS=on이면 켜짐)'; return; }
        if (!stopped) return; stopped = false; void connect();
        // Close outside the session and reconnect (new contracts) on a new day.
        schedule = setInterval(() => {
            if (socket && (!open(now()) || day !== dayKey(now()))) { const old = socket; socket = null; old.close(); state = '장외 · 연결 안 함'; }
            if (!socket) void connect();
        }, 60000); schedule.unref?.();
    }
    function stop() { stopped = true; clearTimeout(retry); clearTimeout(sendTimer); clearTimeout(reportTimer); clearInterval(schedule); const old = socket; socket = null; old?.close(); }
    return { start, stop, state: () => ({ state, registered, rejected, received }) };
}
module.exports = { createLsFuturesEvents, TRS };
