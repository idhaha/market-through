'use strict';
// 주식선물 가격제한 감시용 LS 실시간 (2026-11-11, 2026-11-14 정책으로 다시 씀).
// - LS 연결은 이것 하나만 쓴다. 이 앱키의 LS 실시간 연결 한도는 오라클과 함께 3개로 보여(11/03 "최대 허용 세션 수를 초과") 새 연결을
//   열지 않고, 필요한 등록을 이 연결 안에서 늘리고 줄인다(11/12: 한 연결에 564건 등록, 거부 0).
// - 등록 목록은 registrations()가 준다: 감시 월물(전일 거래량이 많은 월물)마다 JX0(가격제한폭 확대) · JD0(실시간 상·하한가),
//   장운영정보 JIF(키 0), 한도 근처 · 확대된 · 행이 있는 월물의 JC0(주식선물 체결). 목록이 바뀌면 sync()로 차이만 등록(tr_type 3) ·
//   해지(tr_type 4)한다. 해지 30초 지연은 futures-limit-watch.js가 맡는다.
// - 받은 메시지는 모두 onEvent로 넘긴다. 원문은 JX0 · JIF만 data/vi-monitor/futures-events/날짜.jsonl에 남긴다
//   (JD0은 하루 약 11만 건 · 17.7MB라 남기지 않고, JC0도 체결마다 와서 남기지 않는다).
// - 기본은 꺼짐: VI_FUTURES_EVENTS=on일 때만 연결한다. 연결 시간: 평일 08:30~16:30(주식선물 정규장 08:45~15:45 앞뒤).
// - 연결이 끊기거나 다시 붙으면 onConnection(true/false)으로 알린다(끊긴 동안은 CB 판정을 할 수 없다).
const fs = require('node:fs'), path = require('node:path');
const SOCKET = 'wss://openapi.ls-sec.co.kr:9443/websocket';
const TRS = ['JX0', 'JD0', 'JC0', 'JIF'], KEEP_RAW = new Set(['JX0', 'JIF']);
const dayKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const redact = s => String(s || '').replace(/[A-Za-z0-9_+\/=.~-]{24,}/g, '[redacted]').slice(0, 120);
function createLsFuturesEvents({ getToken, WebSocket = require('ws'), directory, now = Date.now, registrations, contracts, onEvent = () => {}, onConnection = () => {}, log = () => {},
    enabled = () => (process.env.VI_FUTURES_EVENTS || '').trim() === 'on', sendGapMs = 60, sessionAt }) {
    // Older callers pass contracts() (JX0 only).
    registrations ||= async () => (await contracts()).map(code => ['JX0', code]);
    let socket = null, stopped = true, retry = null, schedule = null, connecting = false, reconnects = 0, state = '꺼짐', day = '';
    let registered = 0, rejected = 0, firstReject = '', pending = [], sendTimer = null, received = 0, reportTimer = null, syncing = false;
    const active = new Set(), counts = {};
    const open = sessionAt || (t => { const k = new Date(t + 9 * 3600000), m = k.getUTCHours() * 60 + k.getUTCMinutes(); return ![0, 6].includes(k.getUTCDay()) && m >= 510 && m <= 990; });
    const eventDir = directory && path.join(directory, 'futures-events');
    const id = (tr, key) => tr + ':' + key;
    function keep(line) { if (!eventDir) return; try { fs.mkdirSync(eventDir, { recursive: true }); fs.appendFileSync(path.join(eventDir, dayKey(now()) + '.jsonl'), JSON.stringify(line) + '\n'); } catch {} }
    function describe() {
        const by = {}; for (const k of active) { const tr = k.split(':')[0]; by[tr] = (by[tr] || 0) + 1; }
        return TRS.filter(tr => by[tr]).map(tr => `${tr} ${by[tr]}`).join(' · ') || '등록 없음';
    }
    function sendNext(ws) {
        sendTimer = null;
        if (socket !== ws || ws.readyState !== 1) return;
        if (!pending.length) { clearTimeout(reportTimer); reportTimer = setTimeout(report, 10000); reportTimer.unref?.(); return; }
        const [type, tr, key] = pending.shift();
        ws.send(JSON.stringify({ header: { token: ws.token, tr_type: type }, body: { tr_cd: tr, tr_key: key } }));
        sendTimer = setTimeout(() => sendNext(ws), sendGapMs); sendTimer.unref?.();
    }
    function report() {
        clearTimeout(reportTimer);
        state = `등록 ${describe()}${rejected ? ` · 거부 ${rejected}건` : ''}`;
        log(`[선물 이벤트] LS ${state}${firstReject ? ' (첫 거부: ' + firstReject + ')' : ''}`);
    }
    // Registers what is wanted and not registered, removes what is registered and no longer wanted.
    async function sync() {
        const ws = socket;
        if (!ws || ws.readyState !== 1 || syncing) return;
        syncing = true;
        try {
            const want = new Map((await registrations()).map(([tr, key]) => [id(tr, key), [tr, key]]));
            if (socket !== ws) return;
            const queued = new Set(pending.map(([, tr, key]) => id(tr, key)));
            for (const [k, [tr, key]] of want) if (!active.has(k) && !queued.has(k)) { active.add(k); pending.push(['3', tr, key]); }
            for (const k of [...active]) if (!want.has(k)) { active.delete(k); const [tr, ...rest] = k.split(':'); pending.push(['4', tr, rest.join(':')]); }
            if (pending.length && !sendTimer) sendNext(ws);
        } finally { syncing = false; }
    }
    async function connect() {
        if (stopped || socket || connecting) return;
        if (!open(now())) { state = '장외 · 연결 안 함'; return; }
        connecting = true; state = '연결 중';
        try {
            const token = await getToken(); if (stopped) return;
            const ws = new WebSocket(SOCKET, { handshakeTimeout: 10000 }); ws.token = token; socket = ws; day = dayKey(now());
            registered = 0; rejected = 0; firstReject = ''; active.clear(); pending = [];
            ws.on('open', () => { if (socket !== ws) return; state = '등록 중'; reconnects = 0; onConnection(true); void sync(); });
            ws.on('message', raw => {
                if (socket !== ws) return;
                let m; try { m = JSON.parse(String(raw)); } catch { return; }
                const tr = m.header?.tr_cd, body = m.body;
                // Registration answers carry rsp_cd and an empty body.
                if (m.header?.rsp_cd != null && (!body || !Object.keys(body).length)) {
                    if (['00000', '0000', '0'].includes(String(m.header.rsp_cd))) registered++;
                    else { rejected++; if (!firstReject) firstReject = redact(m.header.rsp_msg || m.header.rsp_cd); }
                    return;
                }
                if (!TRS.includes(tr) || !body) return;
                received++; counts[tr] = (counts[tr] || 0) + 1;
                const event = { tr, futcode: String(body.futcode || (tr === 'JIF' ? '' : m.header?.tr_key) || '').trim(), body, receivedAt: now() };
                if (KEEP_RAW.has(tr)) keep({ at: new Date(event.receivedAt + 9 * 3600000).toISOString().slice(11, 23), tr, key: m.header?.tr_key ?? null, body });
                try { void onEvent(event); } catch {}
            });
            ws.on('error', () => { if (socket === ws) ws.terminate(); });
            ws.on('close', (code, reason) => {
                if (socket !== ws) return; socket = null; clearTimeout(sendTimer); sendTimer = null; active.clear(); pending = [];
                state = '연결 끊김 · 재연결 대기'; log(`[선물 이벤트] LS 연결 끊김 (${code}) ${redact(reason)}`); onConnection(false);
                if (!stopped) { retry = setTimeout(() => void connect(), Math.min(60000, 2000 * 2 ** Math.min(reconnects++, 5))); retry.unref?.(); }
            });
        } catch (error) {
            state = '연결 실패'; log('[선물 이벤트] LS 연결 실패: ' + redact(error.message || error));
            if (!stopped) { retry = setTimeout(() => void connect(), 60000); retry.unref?.(); }
        } finally { connecting = false; }
    }
    function start() {
        if (!enabled()) { state = '꺼짐 (VI_FUTURES_EVENTS=on이면 켜짐)'; return; }
        if (!stopped) return; stopped = false; void connect();
        // Close outside the session and reconnect on a new day; re-check the wanted registrations every minute.
        schedule = setInterval(() => {
            if (socket && (!open(now()) || day !== dayKey(now()))) { const old = socket; socket = null; old.close(); active.clear(); state = '장외 · 연결 안 함'; onConnection(false); }
            if (!socket) void connect(); else void sync();
        }, 60000); schedule.unref?.();
    }
    function stop() { stopped = true; clearTimeout(retry); clearTimeout(sendTimer); clearTimeout(reportTimer); clearInterval(schedule); const old = socket; socket = null; old?.close(); }
    return { start, stop, sync, connected: () => !!socket && socket.readyState === 1, state: () => ({ state, registered, rejected, received, counts: { ...counts }, active: describe() }) };
}
module.exports = { createLsFuturesEvents, TRS };
