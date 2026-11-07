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

// REST equivalents of the websocket feeds. On 2026-11-03 their values matched the stored
// websocket data in the same raw units (UBT/BMT exactly or within 1, UPM within 1), so REST
// rows are stored as the websocket raw value and converted by the same validation entry.
const restSources = [
    { entry: 'UBT:U001', tr: 't1602', endpoint: 'stock/investor', rows: 't1602OutBlock1', investor: true,
        input: full => ({ market: '1', upcode: '001', gubun1: '2', gubun2: '0', cts_time: '', cts_idx: 0, cnt: full ? 900 : 40, gubun3: '', exchgubun: 'U' }) },
    { entry: 'UBT:U301', tr: 't1602', endpoint: 'stock/investor', rows: 't1602OutBlock1', investor: true,
        input: full => ({ market: '3', upcode: '301', gubun1: '2', gubun2: '0', cts_time: '', cts_idx: 0, cnt: full ? 900 : 40, gubun3: '', exchgubun: 'U' }) },
    { entry: 'UPM:U0', tr: 't1662', endpoint: 'stock/program', rows: 't1662OutBlock',
        input: () => ({ gubun: '0', gubun1: '0', gubun3: '0', exchgubun: 'U' }) },
    { entry: 'UPM:U1', tr: 't1662', endpoint: 'stock/program', rows: 't1662OutBlock',
        input: () => ({ gubun: '1', gubun1: '0', gubun3: '0', exchgubun: 'U' }) },
    { entry: 'BMT:900', tr: 't1602', endpoint: 'stock/investor', rows: 't1602OutBlock1', investor: true,
        input: full => ({ market: '1', upcode: '900', gubun1: '2', gubun2: '0', cts_time: '', cts_idx: 0, cnt: full ? 900 : 40, gubun3: '', exchgubun: 'U' }) }
];
const futuresClock = t => { const clock = new Date(t + 9 * 3600000).toISOString().slice(11, 16); return clock >= '08:45' && clock < '15:45'; };

function createLsMarketSupply({ directory, http, credentials, supply, now = Date.now, tokenFile = null,
    WebSocket = require('ws'), log = console.warn, validationDefaults = {},
    // 'rest' polls the REST equivalents instead of opening a websocket session.
    mode = () => 'websocket', restIntervalMs = 30000, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const restMode = () => mode() === 'rest';
    // Raw source amounts are retained separately. Only verified conversions reach the chart.
    const raw = createSupplyStore({ directory: path.join(directory, 'raw'), now });
    const pending = new Map(), states = new Map();
    let socket, token, expires = 0, tokenTask, connecting, timer, stopped = true, retryAt = 0, failures = 0, subscribedSession='';
    function activeSubscriptions(){
        if(!require('./trading-session').current())return subscriptions;
        const clock=new Date(now()+9*3600000).toISOString().slice(11,16);
        return subscriptions.filter(s=>s.tr==='BMT'?clock>='08:45'&&clock<'15:45'&&supply.futuresAllowed():collectingAt(now()));
    }
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
    // LS rejected the cached token (replaced or expired early): drop it so the next call issues a new one.
    // A token issued within the last minute is kept, so two servers sharing the app key cannot loop.
    let issuedAt = 0;
    function invalidateToken() {
        if (!token || now() - issuedAt < 60000) return false;
        if (tokenFile) try { if (JSON.parse(fs.readFileSync(tokenFile, 'utf8')).token === token) fs.rmSync(tokenFile, { force: true }); } catch {}
        token = ''; expires = 0; return true;
    }
    // tokenFile: the issued token is kept on disk so a restart reuses it and local scheduled scripts can use the
    // server's token instead of issuing their own (a second issue may replace the token the servers use).
    function loadToken() {
        try {
            const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
            if (typeof saved.token === 'string' && saved.token && saved.expires > now() + 60000) { token = saved.token; expires = saved.expires; issuedAt = Number(saved.issuedAt) || 0; }
        } catch {}
    }
    function saveToken() {
        try {
            fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
            fs.writeFileSync(tokenFile + '.tmp', JSON.stringify({ token, expires, issuedAt }), { mode: 0o600 });
            fs.renameSync(tokenFile + '.tmp', tokenFile);
        } catch {}
    }
    async function accessToken() {
        if (token && expires > now() + 60000) return token;
        if (tokenFile && !tokenTask) { loadToken(); if (token && expires > now() + 60000) return token; }
        if (tokenTask) return tokenTask;
        tokenTask = (async () => {
            const { appKey, secretKey } = credentials();
            if (!appKey || !secretKey) throw new Error('LS API 설정이 필요합니다.');
            try {
                const response = await http.post('https://openapi.ls-sec.co.kr:8080/oauth2/token',
                    new URLSearchParams({ grant_type: 'client_credentials', appkey: appKey, appsecretkey: secretKey, scope: 'oob' }).toString(),
                    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 });
                if (!response.data.access_token) throw new Error('token');
                token = response.data.access_token; issuedAt = now();
                expires = now() + Math.max(60, Number(response.data.expires_in || response.data.expire_in) || 3600) * 1000;
                if (tokenFile) saveToken();
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
            if(require('./trading-session').current() && !activeSubscriptions().length)return;
            const ws = new WebSocket('wss://openapi.ls-sec.co.kr:9443/websocket', { handshakeTimeout: 10000, maxPayload: 1024 * 1024 });
            socket = ws;
            // LS ACKs omit tr_key. Keep only one subscription request outstanding
            // so a successful/failed ACK can be attributed without guessing its key.
            let subscriptionIndex = 0, awaiting, ackTimer;
            const selected=activeSubscriptions();subscribedSession=selected.map(s=>s.tr+':'+s.key).join(',');
            const subscribeNext = () => {
                clearTimeout(ackTimer);
                awaiting = selected[subscriptionIndex++];
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
    let restTask = null, restDueAt = 0, restDay = '', restGeneration = 0;
    const restSeen = new Map();
    async function restCall(tr, endpoint, input) {
        let lastError = 'LS ' + tr + ' 조회 실패';
        // LS allows one call per second per TR and appkey, shared with other servers using the key.
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt) await pause(1500 * attempt + Math.floor(Math.random() * 500));
            try {
                const response = await http.post(`https://openapi.ls-sec.co.kr:8080/${endpoint}`, { [`${tr}InBlock`]: input }, {
                    headers: { authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json; charset=utf-8', tr_cd: tr, tr_cont: 'N', tr_cont_key: '' }, timeout: 10000 });
                if (String(response.data?.rsp_cd) === '00000') return response.data;
                lastError = `LS ${tr} 응답 ${String(response.data?.rsp_cd || '없음').slice(0, 12)}`;
            } catch (error) {
                if (error.response?.status === 401) { token = null; expires = 0; }
                lastError = `LS ${tr} 조회 실패${error.response?.status ? ' (' + error.response.status + ')' : ''}`;
            }
        }
        throw new Error(lastError);
    }
    async function pollRest() {
        const date = dayKey(now());
        if (restDay !== date) { restDay = date; restSeen.clear(); }
        const spot = collectingAt(now()) && confirmedDay === date;
        const futures = futuresClock(now()) && supply.futuresAllowed();
        let first = true;
        const generation = restGeneration;
        for (const source of restSources) {
            const entry = subscriptions.find(s => `${s.tr}:${s.key}` === source.entry);
            if (entry.market === 'futures' ? !futures : !spot) continue;
            if (!first) await pause(1100);
            first = false;
            if (generation !== restGeneration || !restMode()) return;
            const previous = states.get(source.entry) || {};
            try {
                const seen = restSeen.get(source.entry) || 0;
                const data = await restCall(source.tr, source.endpoint, source.input(!seen));
                const received = now();
                if (dayKey(received) !== date) return;
                const code = codes[entry.market], latest = new Map(), rows = Array.isArray(data[source.rows]) ? data[source.rows] : [];
                // Rows carry no date. Before today's first data LS may still answer with the previous
                // session (times up to ~20:10), so a row later than now marks the whole response stale.
                if (rows.some(row => sourceTime(row.time, received) > received + 120000)) throw new Error(`LS ${source.tr} 이전 거래일 응답`);
                for (const row of rows) {
                    const t = sourceTime(row.time, received);
                    if (!Number.isFinite(t) || t > received || seen && t < seen - 60000) continue;
                    if (entry.market === 'futures' ? !futuresClock(t) : !collectingAt(t)) continue;
                    const values = source.investor
                        ? { individual: quantity(row.sv_08), foreign: quantity(row.sv_17), institution: quantity(row.sv_18) }
                        : { program: quantity(row.tot3) };
                    if (Object.values(values).every(v => v == null)) continue;
                    // Several rows per minute (t1602 every 30 s): keep the latest, like the websocket bucket.
                    if ((latest.get(minute(t))?.t ?? -1) < t) latest.set(minute(t), { t, values });
                }
                const saved = new Map(raw.points(code, date).map(p => [p.t, p]));
                const points = [];
                let newest = seen;
                for (const [bucket, { t, values }] of latest) {
                    const point = { t };
                    for (const [field, value] of Object.entries(values)) {
                        if (value == null || saved.get(bucket)?.[`${field}_at`] > t) continue;
                        point[field] = value; point[`${field}_at`] = t;
                    }
                    if (Object.keys(point).length > 1) points.push(point);
                    newest = Math.max(newest, t);
                }
                if (points.length) { raw.mergeMany(code, points); lastFlush = now(); }
                restSeen.set(source.entry, newest);
                states.set(source.entry, { subscribed: true, checked_at: received, source_at: newest || null, error: '' });
            } catch (error) {
                states.set(source.entry, { ...previous, error: error.message });
                connectionError = error.message;
            }
        }
        if (restSources.every(source => !states.get(source.entry)?.error)) connectionError = '';
    }
    function scheduleRest() {
        // Poll at :15 and :45 so requests stay away from minute boundaries.
        const t = now(), slot = Math.floor((t - 15000) / restIntervalMs) * restIntervalMs + 15000;
        restDueAt = slot + restIntervalMs;
    }
    let collecting;
    function collect() {
        if (collecting) return collecting;
        collecting = (async () => {
            flush();
            if (now() - lastArchive >= 60000) { raw.archiveCompleted(); lastArchive = now(); }
            if (!collectingAt(now())) confirmedDay = '';
            else if (confirmedDay !== dayKey(now()) && await supply.confirmMarket()) confirmedDay = dayKey(now());
            if (restMode()) {
                if (socket) { const old = socket; socket = null; old.close(); }
                const due = collectingAt(now()) && confirmedDay === dayKey(now()) || futuresClock(now()) && supply.futuresAllowed();
                if (!stopped && due && !restTask && now() >= restDueAt) {
                    scheduleRest();
                    restTask = pollRest().catch(() => { connectionError = 'LS 수급 조회 실패'; }).finally(() => { restTask = null; });
                }
                return;
            }
            if(socket && subscribedSession!==activeSubscriptions().map(s=>s.tr+':'+s.key).join(',')){const old=socket;socket=null;old.close();}
            if (require('./trading-session').current() && !activeSubscriptions().length || !supply.futuresAllowed() && (!collectingAt(now()) || confirmedDay !== dayKey(now()))) {
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
        return [restMode() ? `LS 조회(REST) · ${restIntervalMs / 1000}초 주기 · 1분 마지막 조회값 · 금액: 백만원` : 'LS 웹소켓 · 1분 마지막 수신값 · 미수집 구간 제외 · 금액: 백만원',
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
        stopped = true; restGeneration++; clearInterval(timer); timer = null;
        const old = socket; socket = null; old?.close(); flush(true);
    }
    return { store, collect, start, stop, receive, flush, warnings, status, accessToken, invalidateToken, recover, pollRest };
}
// LS answers a stale token with HTTP 401 or an error message about the token. The exact code was
// not captured during the 2026-11-06 outage, so the message is matched as well.
function lsTokenRejected(status, data) {
    if (status === 401) return true;
    const code = String(data?.rsp_cd ?? '');
    return !!code && !/^0+$/.test(code) && /토큰|token/i.test(String(data?.rsp_msg || ''));
}
module.exports = { createLsMarketSupply, subscriptions, sourceTime, restSources, lsTokenRejected };
