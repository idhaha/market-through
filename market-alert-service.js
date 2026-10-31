'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dayKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
// LS official JIF jstatus descriptions, retrieved 2026-10-30. Only markets 1/2.
const codes = {
    '61': ['circuit', 1, 'start'], '62': ['circuit', 1, 'release'], '63': ['circuit', 1, 'resume'],
    '68': ['circuit', 2, 'start'], '70': ['circuit', 2, 'release'], '71': ['circuit', 2, 'resume'],
    '69': ['circuit', 3, 'start'], '64': ['sidecar', 'sell', 'start'], '65': ['sidecar', 'sell', 'release'],
    '66': ['sidecar', 'buy', 'start'], '67': ['sidecar', 'buy', 'release']
};

function createMarketAlerts({ directory, now = Date.now, getToken, WebSocket = require('ws'), log = console.warn } = {}) {
    const file = directory && path.join(directory, 'state.json');
    let state = { day: dayKey(now()), version: 0, events: [], acknowledged: {}, closed: [], diagnostics: [] };
    const epoch = crypto.randomUUID();
    let storageError = '', connection = '대기 중', socket, retryTimer, heartbeat, ackTimer, rotateTimer, stopped = true, connecting = false, failures = 0;
    const startedAt = now();
    let lastReceivedAt = null, disconnectedAt = null;
    try {
        if (file && fs.existsSync(file)) {
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (saved.day === state.day && Array.isArray(saved.events) && saved.events.length <= 64
                && saved.events.every(e => e && typeof e.id === 'string' && ['1', '2'].includes(e.market) && ['circuit', 'sidecar'].includes(e.kind)
                    && (e.kind === 'circuit' ? [1, 2, 3].includes(e.stage) : ['buy', 'sell'].includes(e.stage)) && typeof e.active === 'boolean')
                && Array.isArray(saved.closed) && saved.closed.every(m => ['1', '2'].includes(m))
                && saved.acknowledged && typeof saved.acknowledged === 'object'
                && Object.values(saved.acknowledged).every(ids => Array.isArray(ids) && ids.length <= 64 && ids.every(id => typeof id === 'string'))
                && Array.isArray(saved.diagnostics) && saved.diagnostics.length <= 200) {
                state = saved; state.version = Number.isSafeInteger(saved.version) ? saved.version : 0;
            } else if (saved.day === state.day) storageError = '저장된 경보 형식 오류 · 수신 이전 이력 미확인';
        }
    } catch { storageError = '저장된 경보 복구 실패'; }
    function persist() {
        state.version++;
        if (!file) return;
        try {
            fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(file + '.tmp', JSON.stringify(state)); fs.renameSync(file + '.tmp', file);
            storageError = '';
        } catch { storageError = '경보 저장 실패 · 서버 재시작 시 복구되지 않을 수 있음'; }
    }
    function rollover() {
        if (state.day !== dayKey(now())) {
            state = { day: dayKey(now()), version: state.version, events: [], acknowledged: {}, closed: [], diagnostics: [] }; persist();
        }
    }
    const userKey = user => crypto.createHash('sha256').update(String(user)).digest('hex');
    function snapshot(user) {
        rollover();
        const acknowledged = state.acknowledged[userKey(user)] || [];
        return { day: state.day, epoch, version: state.version, startedAt, lastReceivedAt, disconnectedAt, connection, storageError,
            historyWarning: '수신 이전·연결 중단 중 경보 이력 미확인 · JIF 과거 이력 조회 미지원',
            events: state.events.map(event => ({ ...event, visible: !state.closed.includes(event.market), acknowledged: acknowledged.includes(event.id) })) };
    }
    function acknowledge(user, ids) {
        rollover();
        if (!Array.isArray(ids) || ids.length > 64 || ids.some(id => typeof id !== 'string')) {
            const error = new Error('잘못된 경보 확인 요청'); error.status = 400; throw error;
        }
        if (!ids.length) return snapshot(user);
        const key = userKey(user), known = new Set(state.events.map(event => event.id));
        const previous = state.acknowledged[key] || [];
        const next = [...new Set([...previous, ...ids.filter(id => known.has(id))])].slice(-64);
        if (next.length === previous.length && next.every((id, index) => id === previous[index])) return snapshot(user);
        state.acknowledged[key] = next;
        persist(); return snapshot(user);
    }
    function receive(input) {
        let message;
        try { message = JSON.parse(String(input)); } catch { return; }
        if (message?.header?.tr_cd !== 'JIF') return;
        rollover();
        const header = message.header, body = message.body || {};
        if (header.rsp_cd != null && !['00000', '000000', '0'].includes(String(header.rsp_cd))) {
            connection = 'JIF 구독 거부'; socket?.terminate(); return;
        }
        clearTimeout(ackTimer); ackTimer = null;
        connection = 'JIF 구독 중'; failures = 0;
        const market = String(body.jangubun || ''), status = String(body.jstatus || '');
        if (!/^[0-9A-F]$/.test(market) || !/^[0-9A-Z]{2}$/.test(status)) return;
        lastReceivedAt = now();
        // Whitelist fields only. Never store upstream tokens or arbitrary messages.
        state.diagnostics.push({ receivedAt: now(), market, status });
        state.diagnostics = state.diagnostics.slice(-200);
        if (!['1', '2'].includes(market)) { persist(); return; }
        if (status === '00' || status === '41') {
            if (!state.closed.includes(market)) state.closed.push(market);
            for (const event of state.events.filter(e => e.market === market && e.active)) {
                event.active = false; event.endedAt = now(); event.endReason = '장 종료/초기화';
            }
            persist(); return;
        }
        if (status === '21') state.closed = state.closed.filter(m => m !== market);
        const code = codes[status];
        if (!code) { persist(); return; }
        const [kind, stage, operation] = code;
        let event = [...state.events].reverse().find(e => e.market === market && e.kind === kind && e.stage === stage);
        if (operation === 'start') {
            state.closed = state.closed.filter(m => m !== market);
            if (!event?.active) {
                if (kind === 'circuit') for (const previous of state.events.filter(e => e.market === market && e.kind === kind && e.active)) {
                    previous.active = false; previous.endedAt = now(); previous.endReason = '상위 단계 발동';
                }
                event = { id: crypto.randomUUID(), market, kind, stage, active: true, occurredAt: now(), releasedAt: null, resumedAt: null, timeBasis: 'received', code: status };
                state.events.push(event); state.events = state.events.slice(-64);
            }
        } else {
            if (!event) {
                event = { id: crypto.randomUUID(), market, kind, stage, active: false, occurredAt: null, releasedAt: null, resumedAt: null, timeBasis: 'received', code: status };
                state.events.push(event); state.events = state.events.slice(-64);
            }
            event.active = false;
            if (operation === 'release' && !event.releasedAt) event.releasedAt = now();
            if (operation === 'resume' && !event.resumedAt) event.resumedAt = now();
        }
        persist();
    }
    function diagnostics() { rollover(); return { ...snapshot('diagnostic'), samples: state.diagnostics.slice() }; }
    function cleanup() { clearInterval(heartbeat); clearTimeout(ackTimer); clearTimeout(rotateTimer); heartbeat = ackTimer = rotateTimer = null; }
    function retry() {
        if (stopped || retryTimer) return;
        retryTimer = setTimeout(() => { retryTimer = null; void connect(); }, Math.min(300000, 5000 * 2 ** Math.min(failures++, 6)));
        retryTimer.unref?.();
    }
    async function connect() {
        if (stopped || socket || connecting) return;
        connecting = true; connection = 'JIF 연결 중';
        try {
            const token = await getToken();
            if (stopped) return;
            const ws = new WebSocket('wss://openapi.ls-sec.co.kr:9443/websocket', { handshakeTimeout: 10000, maxPayload: 65536 });
            socket = ws;
            let alive = true;
            ws.on('open', () => {
                if (socket !== ws || stopped) return;
                connection = 'JIF 구독 확인 중';
                ws.send(JSON.stringify({ header: { token, tr_type: '3' }, body: { tr_cd: 'JIF', tr_key: '0' } }));
                ackTimer = setTimeout(() => { connection = 'JIF 구독 응답 지연'; ws.terminate(); }, 15000); ackTimer.unref?.();
                heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; ws.ping(); }, 30000); heartbeat.unref?.();
                rotateTimer = setTimeout(() => ws.close(), 55 * 60000); rotateTimer.unref?.();
            });
            ws.on('pong', () => { alive = true; });
            ws.on('message', input => { if (socket === ws) receive(input); });
            ws.on('error', () => { if (socket !== ws) return; connection = 'JIF 연결 오류 · 재연결 중'; ws.terminate(); });
            ws.on('close', () => {
                if (socket !== ws) return;
                cleanup(); socket = null; disconnectedAt = now();
                if (!stopped) { if (connection === 'JIF 구독 중') connection = 'JIF 연결 끊김 · 재연결 중'; retry(); }
            });
        } catch { connection = 'LS 인증/연결 실패 · 설정 확인 필요'; log('[MarketAlerts] LS 인증/연결 실패'); retry(); }
        finally { connecting = false; }
    }
    function start() { if (!stopped) return; stopped = false; void connect(); }
    function stop() { stopped = true; clearTimeout(retryTimer); retryTimer = null; cleanup(); const old = socket; socket = null; old?.terminate(); connection = '수신 중지'; persist(); }
    return { start, stop, receive, snapshot, acknowledge, diagnostics };
}
module.exports = { createMarketAlerts, codes, dayKey };
