const fs = require('node:fs');
const path = require('node:path');
const { createSupplyStore, dayKey } = require('./supply-store');
const { quantity, timestamp, collectingAt } = require('./supply-service');

const subscriptions = [
    { tr: 'UBT', key: 'U001', market: 'kospi' }, { tr: 'UBT', key: 'U301', market: 'kosdaq' },
    { tr: 'UPM', key: 'U0', market: 'kospi' }, { tr: 'UPM', key: 'U1', market: 'kosdaq' },
    { tr: 'BMT', key: '900', market: 'futures' }, { tr: 'BMT', key: '901', market: 'futuresKosdaq' }
];
const codes = { kospi: 'KOSPI0', kosdaq: 'KOSDAQ', futures: 'FUTURE', futuresKosdaq: 'FUTKQ0' };
const minute = t => Math.floor(t / 60000) * 60000;
function sourceTime(value, received) {
    const text = String(value ?? '');
    if (!/^\d{6}(\d{2})?$/.test(text)) return NaN;
    const clock = text.slice(0, 6);
    if (+clock.slice(0, 2) > 23 || +clock.slice(2, 4) > 59 || +clock.slice(4, 6) > 59) return NaN;
    return timestamp(dayKey(received).replaceAll('-', ''), clock);
}

function createLsMarketSupply({ directory, http, credentials, supply, now = Date.now,
    WebSocket = require('ws'), log = console.warn, validationDefaults = {} }) {
    // Raw source amounts are retained separately. Only verified conversions reach the chart.
    const raw = createSupplyStore({ directory: path.join(directory, 'raw'), now });
    const pending = new Map(), states = new Map();
    let socket, token, expires = 0, tokenTask, connecting, timer, stopped = true, retryAt = 0, failures = 0;
    let connectionError = '', confirmedDay = '', lastFlush = 0, lastArchive = 0;
    let recoveryTask;
    function validation() {
        try { return { ...validationDefaults, ...JSON.parse(fs.readFileSync(path.join(directory, 'validation.json'), 'utf8')) }; }
        catch { return { ...validationDefaults }; }
    }
    function verified(entry, checks = validation()) {
        const item = checks[`${entry.tr}:${entry.key}`];
        return item?.cumulative === true && item?.timeFormat === (entry.tr === 'UPM' ? 'HHmmss' : 'HHmmsscc') && item?.market === entry.market
            && typeof item.evidence === 'string' && item.evidence.trim()
            && Number.isFinite(item.toMillionWon) && item.toMillionWon > 0 ? item : null;
    }
    async function accessToken() {
        if (token && expires > now() + 60000) return token;
        if (tokenTask) return tokenTask;
        tokenTask = (async () => {
            const { appKey, secretKey } = credentials();
            if (!appKey || !secretKey) throw new Error('LS API 설정이 필요합니다.');
            try {
                const response = await http.post('https://openapi.ls-sec.co.kr:8080/oauth2/token',
                    new URLSearchParams({ grant_type: 'client_credentials', appkey: appKey, appsecretkey: secretKey, scope: 'oob' }).toString(),
                    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 });
                if (!response.data.access_token) throw new Error('token');
                token = response.data.access_token;
                expires = now() + Math.max(60, Number(response.data.expires_in || response.data.expire_in) || 3600) * 1000;
                return token;
            } catch (error) {
                throw new Error(error.response?.data?.error_code === 'IGW00105'
                    ? 'LS 인증 실패: LS_SECRETKEY가 유효하지 않습니다 (IGW00105)'
                    : 'LS 접근토큰 발급 실패');
            }
        })().finally(() => { tokenTask = null; });
        return tokenTask;
    }
    async function recover() {
        if (recoveryTask) return recoveryTask;
        // t1602 explicitly supports U (unified). Never use KRX history for unified subscriptions.
        recoveryTask = (async () => {
            const date = dayKey(now());
            if (confirmedDay !== date || !collectingAt(now())) return;
            for (const [market, upcode] of [['1', '001'], ['3', '301']]) {
                let cursor = ' ';
                for (let page = 0; page < 30; page++) {
                    const response = await http.post('https://openapi.ls-sec.co.kr:8080/stock/investor', {
                        t1602InBlock: { market, upcode, gubun1: '2', gubun2: '0', cts_time: cursor,
                            cts_idx: 0, cnt: 100, gubun3: '', exchgubun: 'U' }
                    }, { headers: { authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json; charset=utf-8',
                        tr_cd: 't1602', tr_cont: 'N', tr_cont_key: '' }, timeout: 10000 });
                    if (dayKey(now()) !== date || confirmedDay !== date || !collectingAt(now())) return;
                    const data = response.data;
                    if (String(data.rsp_cd) !== '00000') break;
                    const entry = subscriptions.find(s => s.tr === 'UBT' && s.key === `U${upcode}`);
                    const check = verified(entry);
                    // REST's own unit/cumulative semantics must be independently verified.
                    const restCheck = validation()[`t1602:U${upcode}`];
                    if (!check || !restCheck?.evidence || restCheck.cumulative !== true
                        || restCheck.timeFormat !== 'HHmmsscc' || restCheck.market !== entry.market
                        || !Number.isFinite(restCheck.toMillionWon) || restCheck.toMillionWon <= 0) break;
                    for (const row of Array.isArray(data.t1602OutBlock1) ? data.t1602OutBlock1 : []) {
                        const t = sourceTime(row.time, now());
                        if (!Number.isFinite(t) || t > now() || !collectingAt(t)) continue;
                        const existing = raw.points(codes[entry.market], date).find(p => p.t === minute(t));
                        const point = { t };
                        for (const [field, source] of [['individual', 'sv_08'], ['foreign', 'sv_17'], ['institution', 'sv_18']]) {
                            if (existing?.[`${field}_at`] >= t) continue;
                            const value = quantity(row[source]);
                            const converted = value == null ? NaN : value * restCheck.toMillionWon / check.toMillionWon;
                            if (Number.isSafeInteger(converted)) { point[field] = converted; point[`${field}_at`] = t; }
                        }
                        raw.merge(codes[entry.market], point);
                    }
                    const next = data.t1602OutBlock?.cts_time;
                    if (!next || !String(next).trim() || next === cursor) break;
                    cursor = next;
                    await new Promise(resolve => setTimeout(resolve, 1100));
                }
            }
        })().catch(() => { connectionError = 'LS 과거 투자자 조회 실패 · 누락 구간 유지'; })
            .finally(() => { recoveryTask = null; });
        return recoveryTask;
    }
    function receive(input) {
        let message;
        try { message = JSON.parse(String(input)); } catch { return; }
        const h = message.header || {}, b = message.body || {};
        const entry = subscriptions.find(s => s.tr === h.tr_cd && s.key === h.tr_key);
        if (!entry) return;
        const id = `${entry.tr}:${entry.key}`, previous = states.get(id) || {};
        if (h.rsp_cd && !['00000', '000000', '0'].includes(String(h.rsp_cd))) {
            // Do not echo arbitrary upstream text (it may contain credentials).
            states.set(id, { ...previous, error: 'LS 구독 거부', checked_at: now() }); return;
        }
        if (!Object.keys(b).length) { states.set(id, { ...previous, subscribed: true }); return; }
        const received = now();
        if (entry.tr === 'BMT' && !supply.futuresAllowed()) return;
        let t = sourceTime(entry.tr === 'UPM' ? b.time : b.tjjtime, received);
        // A fresh futures tick may arrive just after midnight for the prior calendar day.
        if (entry.tr === 'BMT' && t > received && t - received >= 86400000 - 120000) t -= 86400000;
        if (!Number.isFinite(t) || t > received || received - t > 120000) return;
        if (entry.tr !== 'BMT' && (!collectingAt(received) || confirmedDay !== dayKey(received) || !collectingAt(t))) return;
        // Check the echoed market as well as the subscription, never remap unknown keys.
        if (entry.tr !== 'UPM' && b.upcode != null && String(b.upcode) !== entry.key.replace(/^U/, '')) return;
        if (previous.source_at != null && t < previous.source_at) return;
        const values = entry.tr === 'UPM' ? { program: quantity(b.tval) } : {
            individual: quantity(b.msval1), foreign: quantity(b.msval2), institution: quantity(b.msval3)
        };
        if (Object.values(values).every(v => v == null)) return;
        const bucket = `${id}:${minute(t)}`;
        // Each field keeps its last valid observation; zero is a valid observation.
        const point = pending.get(bucket) || { entry, t, values: {} };
        for (const [field, value] of Object.entries(values)) if (value != null) {
            point.values[field] = value; point.values[`${field}_at`] = t;
        }
        point.t = t; pending.set(bucket, point);
        states.set(id, { subscribed: true, checked_at: received, source_at: t, error: '' });
    }
    function flush(all = false) {
        let wrote = false;
        for (const [key, point] of pending) {
            if (!all && minute(point.t) >= minute(now())) continue;
            raw.merge(codes[point.entry.market], { t: point.t, ...point.values });
            pending.delete(key); wrote = true;
        }
        if (wrote) lastFlush = now();
    }
    async function connect() {
        if (connecting) return connecting;
        connecting = (async () => {
            const auth = await accessToken();
            if (stopped) return;
            const ws = new WebSocket('wss://openapi.ls-sec.co.kr:9443/websocket', { handshakeTimeout: 10000, maxPayload: 1024 * 1024 });
            socket = ws;
            // LS ACKs omit tr_key. Keep only one subscription request outstanding
            // so a successful/failed ACK can be attributed without guessing its key.
            let subscriptionIndex = 0, awaiting, ackTimer;
            const subscribeNext = () => {
                clearTimeout(ackTimer);
                awaiting = subscriptions[subscriptionIndex++];
                if (!awaiting || socket !== ws || stopped) return;
                ws.send(JSON.stringify({ header: { token: auth, tr_type: '3' }, body: { tr_cd: awaiting.tr, tr_key: awaiting.key } }));
                ackTimer = setTimeout(() => { if (socket === ws) ws.close(); }, 10000);
                ackTimer.unref?.();
            };
            ws.on('open', () => {
                if (socket !== ws || stopped) return ws.close();
                connectionError = '';
                subscribeNext();
                void recover();
            });
            ws.on('message', data => {
                if (socket !== ws) return;
                let message;
                try { message = JSON.parse(String(data)); } catch { return; }
                const h = message.header || {};
                if (awaiting && h.rsp_cd != null && h.tr_cd === awaiting.tr
                    && (!h.tr_key || h.tr_key === awaiting.key) && !Object.keys(message.body || {}).length) {
                    receive(JSON.stringify({ ...message, header: { ...h, tr_key: awaiting.key } }));
                    subscribeNext();
                } else receive(data);
                failures = 0;
            });
            ws.on('error', () => { if(socket === ws) connectionError = 'LS 웹소켓 통신 오류'; });
            ws.on('close', () => {
                clearTimeout(ackTimer);
                if (socket !== ws) return;
                socket = null; expires = 0; token = null;
                retryAt = now() + Math.min(300000, 5000 * 2 ** Math.min(failures++, 6));
                connectionError = 'LS 연결 종료 · 재연결 대기';
                for (const state of states.values()) state.subscribed = false;
            });
        })().catch(error => {
            connectionError = error.message;
            retryAt = now() + Math.min(300000, 5000 * 2 ** Math.min(failures++, 6));
        }).finally(() => { connecting = null; });
        return connecting;
    }
    let collecting;
    function collect() {
        if (collecting) return collecting;
        collecting = (async () => {
            flush();
            if (now() - lastArchive >= 60000) { raw.archiveCompleted(); lastArchive = now(); }
            if (!collectingAt(now())) confirmedDay = '';
            else if (confirmedDay !== dayKey(now()) && await supply.confirmMarket()) confirmedDay = dayKey(now());
            if (!supply.futuresAllowed() && (!collectingAt(now()) || confirmedDay !== dayKey(now()))) {
                if (socket) { const old = socket; socket = null; old.close(); }
                return;
            }
            if (socket && expires <= now() + 60000) { const old = socket; socket = null; old.close(); }
            if (!stopped && !socket && now() >= retryAt) await connect();
        })().finally(() => { collecting = null; });
        return collecting;
    }
    const store = {
        dates: raw.dates,
        points(code, date) {
            const market = Object.keys(codes).find(m => codes[m] === code);
            const entries = subscriptions.filter(s => s.market === market);
            const checks = validation();
            return raw.points(code, date).map(row => {
                const point = { t: row.t };
                for (const entry of entries) {
                    const check = verified(entry, checks); if (!check) continue;
                    for (const field of entry.tr === 'UPM' ? ['program'] : ['individual', 'foreign', 'institution']) {
                        const converted = row[field] * check.toMillionWon;
                        if (Number.isSafeInteger(converted)) { point[field] = converted; point[`${field}_at`] = row[`${field}_at`]; }
                    }
                }
                return point;
            });
        }
    };
    function warnings(market) {
        const entries = subscriptions.filter(s => s.market === market);
        return ['LS 웹소켓 · 1분 마지막 수신값 · 미수집 구간 제외 · 금액: 백만원',
            ...entries.filter(s => !verified(s)).map(s => `${s.tr} ${s.key}: 단위·누적·시장 검증 대기, 미제공`),
            ...entries.filter(s => verified(s)?.provisional).map(s => `${s.tr} ${s.key}: 잠정 표시 · 투자자 원본 억원 가정 · 단위·시장 검증 중`),
            ...(market.startsWith('futures') ? ['선물 프로그램 미제공', `캔들: ${market === 'futures' ? '코스피' : '코스닥'} 현물지수`] : [])];
    }
    function status(market, date) {
        const entries = subscriptions.filter(s => s.market === market);
        const records = entries.map(s => states.get(`${s.tr}:${s.key}`));
        const latest = Math.max(0, ...records.map(s => s?.checked_at || 0));
        const active = (market.startsWith('futures') ? supply.futuresAllowed() : collectingAt(now())) && date === dayKey(now());
        const error = entries.some(s => !verified(s)) ? [connectionError, 'LS 데이터 검증 대기'].filter(Boolean).join(' · ') : active && (connectionError || records.some(s => !s?.subscribed || s?.error || !s?.checked_at || now() - s.checked_at > 120000))
            ? connectionError || '일부 LS 수급 수신 지연·미제공' : '';
        return { partial: Boolean(error), status: { checked_at: latest || null, last_flush: lastFlush || null, error } };
    }
    function start() {
        if (timer) return; stopped = false;
        const run = () => { void collect().catch(() => log('[LS supply] 수집·저장 실패')); };
        run(); timer = setInterval(run, 1000); timer.unref?.();
    }
    function stop() {
        stopped = true; clearInterval(timer); timer = null;
        const old = socket; socket = null; old?.close(); flush(true);
    }
    return { store, collect, start, stop, receive, flush, warnings, status, accessToken, recover };
}
module.exports = { createLsMarketSupply, subscriptions, sourceTime };
