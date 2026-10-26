const { createSupplyStore, dayKey, validCode, failure } = require('./supply-store');
const { quantity, timestamp, collectingAt, investorObservationAt } = require('./supply-service');
const WebSocket = require('ws');
const { createDailyQueryCache, createHistoryCache } = require('./daily-query-cache');

// Both transports publish cumulative *shares*. Amount fields must never enter this store.
function programRecords(broker, raw) {
    if (broker === 'kis') {
        const parts = String(raw).split('|');
        if (parts[0] !== '0' || parts[1] !== 'H0UNPGM0') return [];
        const count = Number(parts[2]), fields = (parts[3] || '').split('^');
        if (!Number.isInteger(count) || count < 1 || count > 100 || fields.length !== count * 11) return [];
        return Array.from({ length: count }, (_, i) => ({ code: fields[i * 11], time: fields[i * 11 + 1], value: quantity(fields[i * 11 + 6]) }));
    }
    let message;
    try { message = JSON.parse(String(raw)); } catch { return []; }
    if (message.header?.tr_cd !== 'UPH') return [];
    const body = message.body || {}, key = String(body.ex_shcode || message.header.tr_key || '');
    const match = /^U([A-Za-z0-9]{6})\s*$/.exec(key);
    return match ? [{ code: match[1], time: String(body.time || ''), value: quantity(body.tvol) }] : [];
}

function lsInvestors(row) {
    return { individual: quantity(row.tjj0008_vol), foreign: quantity(row.tjj0016_vol), institution: quantity(row.tjj0018_vol) };
}

function createBrokerStockSupply({ broker, directory, http, credentials, getToken, supply,
    now = Date.now, Socket = WebSocket, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    if (!['kis', 'ls'].includes(broker)) throw new Error('Unknown stock supply broker');
    const store = createSupplyStore({ directory, now });
    const pending = new Map(), subscribed = new Set(), dailyCache = createDailyQueryCache({ now }), historyCache = createHistoryCache({ now });
    const streams = new Map(), streamSubscriptions = new Map();
    const streamId = entry => `${entry.tr}:${entry.key.trim()}`;
    function setStreams(owner, entries) {
        if (entries.length > 24) throw failure('실시간 추가 구독 한도 초과');
        const wanted = new Set(entries.map(streamId));
        for (const [id, entry] of streams) if (entry.owner === owner && !wanted.has(id)) streams.delete(id);
        for (const entry of entries) {
            const id = streamId(entry), previous = streams.get(id);
            streams.set(id, Object.assign(previous || {}, entry, { owner }));
        }
        sync();
    }
    const streamStatus = (tr, key) => {
        const entry = streams.get(`${tr}:${key.trim()}`);
        return { subscribed: streamSubscriptions.has(`${tr}:${key.trim()}`), error: entry?.error || '', last_data_at: entry?.lastDataAt || null };
    };
    let timer, stopped = true, socket, connecting = false, generation = 0, auth, outstanding;
    let nextConnect = 0, failures = 0, lastMessage = 0, lastRestMinute = -1, lastArchiveMinute = -1, running, confirmedDay;
    let queue = Promise.resolve();
    const status = { error: null, websocket: '대기', last_data_at: null };
    const warning = broker === 'kis'
        ? ['장중 개인 미제공 · 외국인/기관 가집계(비정기 갱신)', '투자자 KRX · 프로그램 KRX+NXT 통합', '분봉 투자자는 REST 관측 시각 기준']
        : ['투자자 REST 추정치(실시간 아님) · 프로그램 KRX+NXT 통합', '분봉 투자자는 REST 관측 시각 기준'];
    const stocks = () => supply.summary().stocks || [];
    function serial(work) {
        const result = queue.then(work);
        queue = result.catch(() => {}).then(() => pause(broker === 'ls' ? 1100 : 350));
        return result;
    }
    async function rest(tr, endpoint, params, continuation = {}) {
        return serial(async () => {
            try {
                const token = await getToken(), c = credentials();
                const response = broker === 'ls'
                    ? await http.post(`https://openapi.ls-sec.co.kr:8080/stock/${endpoint}`, { [`${tr}InBlock`]: params }, {
                        headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', tr_cd: tr, tr_cont: continuation.tr_cont || 'N', tr_cont_key: continuation.tr_cont_key || '' }, timeout: 10000 })
                    : await http.get(`${c.domain}/uapi/domestic-stock/v1/quotations/${endpoint}`, {
                        params, headers: { authorization: `Bearer ${token}`, appkey: c.appKey, appsecret: c.secretKey, tr_id: tr, custtype: 'P' }, timeout: 10000 });
                const data = response.data;
                if (!data || (broker === 'ls' ? String(data.rsp_cd) !== '00000' : String(data.rt_cd) !== '0')) throw new Error('upstream');
                Object.defineProperty(data, 'continuation', {value:{tr_cont:response.headers?.tr_cont,tr_cont_key:response.headers?.tr_cont_key || ''}});
                return data;
            } catch { throw failure(`${broker.toUpperCase()} ${tr} 조회 실패`, 502); }
        });
    }
    async function investors(code, end) {
        if (broker === 'ls') {
            const data = await rest('t1717', 'frgr-itt', { shcode: code, gubun: '0', fromdt: '', todt: end, exchgubun: 'U' });
            if (!Array.isArray(data.t1717OutBlock)) throw failure('LS 투자자 응답 형식 오류', 502);
            return data.t1717OutBlock.map(row => ({ date: String(row.date), ...lsInvestors(row) }));
        }
        const data = await rest('FHKST01010900', 'inquire-investor', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code });
        if (!Array.isArray(data.output)) throw failure('한투 투자자 응답 형식 오류', 502);
        return data.output.map(row => ({ date: String(row.stck_bsop_date), individual: quantity(row.prsn_ntby_qty), foreign: quantity(row.frgn_ntby_qty), institution: quantity(row.orgn_ntby_qty) }));
    }
    async function dailyHistory(code,kind,from,to,onPage) {
        const rows=new Map();let end=to,continuation={},error='';
        try{for(let page=0;page<80 && end>=from;page++){
            let data, incoming;
            if(kind==='investor'){
                if(broker==='ls'){
                    data=await rest('t1717','frgr-itt',{shcode:code,gubun:'0',fromdt:'',todt:end,exchgubun:'U'});
                    incoming=data.t1717OutBlock;
                }else{
                    data=await rest('FHPTJ04160001','investor-trade-by-stock-daily',{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code,FID_INPUT_DATE_1:end,FID_ORG_ADJ_PRC:'',FID_ETC_CLS_CODE:''});
                    incoming=data.output2;
                }
            }else{
                data=broker==='ls'
                    ?await rest('t1637','program',{gubun1:'0',gubun2:'1',shcode:code,date:end,time:'',cts_idx:0,exchgubun:'U'},continuation)
                    :await rest('FHPPG04650201','program-trade-by-stock-daily',{FID_COND_MRKT_DIV_CODE:'UN',FID_INPUT_ISCD:code,FID_INPUT_DATE_1:end});
                incoming=broker==='ls'?data.t1637OutBlock1:data.output;
            }
            if(!Array.isArray(incoming))throw failure('종목 수급 일봉 응답 형식 오류',502);
            let earliest=end,accepted=false;
            for(const row of incoming){
                const dt=String(broker==='ls'?row.date:row.stck_bsop_date);
                if(!/^\d{8}$/.test(dt)||dt>end)continue;
                if(dt<earliest)earliest=dt;
                if(dt<from)continue;
                const values=kind==='program'?{program:quantity(broker==='ls'?row.svolume:row.whol_smtn_ntby_qty)}:broker==='ls'?lsInvestors(row):{individual:quantity(row.prsn_ntby_qty),foreign:quantity(row.frgn_ntby_qty),institution:quantity(row.orgn_ntby_qty)};
                if(broker==='kis'&&kind==='investor'&&dt===dayKey(now()).replaceAll('-','')&&investorObservationAt(now()))continue;
                rows.set(dt,{dt,...values});accepted=true;
            }
            onPage([...rows.values()]);
            if(!incoming.length||earliest<=from)break;
            const next=broker==='ls'&&kind==='program'?earliest:dayKey(timestamp(earliest)-86400000).replaceAll('-','');
            if(next>=end && !(broker==='ls'&&kind==='program'&&page===0&&accepted))break;
            if(broker==='ls'&&kind==='program')continuation={tr_cont:'Y',tr_cont_key:data.continuation.tr_cont_key};
            end=next;
            if(page===79)error='종목 수급 과거 조회 한도 도달';
        }}catch(e){error=e.message;}
        return {rows:[...rows.values()],partial:!!error,error};
    }
    async function daily(code, input) {
        const end = input.cursor || dayKey(now()).replaceAll('-', '');
        const key = `${code}:${end}`;
        return dailyCache.read(key, { ttl: input.cursor ? 6 * 3600000 : 60000, progressive: input.progressive === '1', load: async (publish, previous) => {
            const prices = await supply.candles({ ...input, mode: 'day' });
            const points = new Map((prices.points || prices.candles || []).map(p => [dayKey(p.t).replaceAll('-', ''), { t: p.t }]));
            for (const point of previous?.points || []) {
                const old = points.get(dayKey(point.t).replaceAll('-', ''));
                if (old) Object.assign(old, point);
            }
            const warnings = [], dates = [...points.keys()].sort(), first = dates[0];
            const snapshot = () => ({ success: true, mode: 'day', points: [...points.values()].map(p=>({...p})).sort((a,b)=>a.t-b.t), candles: prices.points || prices.candles || [], has_more: prices.has_more === true, cursor: prices.cursor, warnings: [...warnings] });
            const add = (date, values) => { if (points.has(date)) { Object.assign(points.get(date), values); publish(snapshot()); } };
            publish(snapshot());
            const results = await Promise.allSettled(['investor','program'].map(async kind=>{
                if(!first)return;
                const accept=result=>result.rows.forEach(row=>add(row.dt,kind==='program'?{program:row.program}:{individual:row.individual,foreign:row.foreign,institution:row.institution}));
                const result=await historyCache.read(`${code}:${kind}`,{from:first,to:dates.at(-1),recent:input.cursor?false:dates.at(-2)||dates.at(-1),onProgress:accept,load:(from,to,onPage)=>dailyHistory(code,kind,from,to,onPage)});
                accept(result);if(result.error)warnings.push(result.error);
            }));
            for (const result of results) if (result.status === 'rejected') warnings.push(result.reason.message);
            if(broker==='kis'){
                const programRows=[...points.values()].filter(p=>Number.isFinite(p.program)).sort((a,b)=>a.t-b.t);
                const leadingZero=programRows.findIndex(p=>p.program!==0);
                const zeroCount=leadingZero<0?programRows.length:leadingZero;
                if(zeroCount>=20)warnings.push(`프로그램 과거 ${zeroCount}일 원천 0 응답 · 실제 0 여부 미확인`);
            }
            warnings.push(broker === 'kis' ? '투자자 KRX · 프로그램 통합 · 날짜별 과거 조회' : 'LS 통합 · 투자자 추정치');
            return snapshot();
        } });
    }
    function flush() {
        const minute = Math.floor(now() / 60000) * 60000;
        for (const [key, entry] of pending) if (entry.point.t < minute) {
            store.merge(entry.code, entry.point); pending.delete(key);
        }
    }
    function receive(raw) {
        if (confirmedDay !== dayKey(now()) || !collectingAt(now())) return;
        const active = new Set(stocks().map(stock => stock.code));
        for (const record of programRecords(broker, raw)) {
            if (!active.has(record.code) || !subscribed.has(record.code) || !/^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(record.time) || record.value === null) continue;
            const at = timestamp(confirmedDay.replaceAll('-', ''), record.time), t = Math.floor(at / 60000) * 60000;
            if (!Number.isFinite(at) || at > now() || now() - at > 120000 || !collectingAt(at)) continue;
            const key = `${record.code}:${t}`, old = pending.get(key)?.point;
            const saved = t < Math.floor(now()/60000)*60000 ? store.points(record.code, confirmedDay).find(p => p.t === t) : null;
            if (at < (old?.program_at ?? saved?.program_at ?? 0)) continue;
            const point = { t, program: record.value, program_at: at };
            pending.set(key, { code: record.code, point }); status.last_data_at = now();
        }
        flush();
    }
    function disconnect(error) {
        const old = socket; socket = null; generation++; connecting = false; outstanding = null; subscribed.clear(); streamSubscriptions.clear();
        old?.terminate();
        status.websocket = '재연결 대기'; status.error = error;
        nextConnect = now() + Math.min(60000, 2000 * 2 ** Math.min(failures++, 5));
    }
    function sync() {
        if (!socket || socket.readyState !== 1 || outstanding) return;
        const codes = stocks().map(s => s.code);
        const remove = [...subscribed].find(code => !codes.includes(code));
        const add = codes.find(code => !subscribed.has(code));
        const code = remove || add;
        const removedStream = !code && [...streamSubscriptions].find(([id]) => !streams.has(id));
        const addedStream = !code && !removedStream && [...streams].find(([id, entry]) => !streamSubscriptions.has(id) && !(entry.retryAt > now()));
        const extra = removedStream || addedStream;
        if (!code && !extra) { status.websocket = '구독 완료'; return; }
        const tr = extra ? extra[1].tr : broker === 'ls' ? 'UPH' : 'H0UNPGM0';
        const key = extra ? extra[1].key : broker === 'ls' ? `U${code}   ` : code;
        const removing = !!remove || !!removedStream;
        outstanding = { code, tr, key, extra: extra?.[0], entry: extra?.[1], remove: removing, at: now() };
        socket.send(JSON.stringify(broker === 'ls'
            ? { header: { token: auth, tr_type: removing ? '4' : '3' }, body: { tr_cd: tr, tr_key: key } }
            : { header: { approval_key: auth, custtype: 'P', tr_type: removing ? '2' : '1', 'content-type': 'utf-8' }, body: { input: { tr_id: tr, tr_key: key } } }));
    }
    async function connect() {
        if (stopped || connecting || socket || now() < nextConnect || !stocks().length && !streams.size) return;
        connecting = true; const revision = generation;
        try {
            if (broker === 'ls') auth = await getToken();
            else {
                const c = credentials();
                const response = await http.post(`${c.domain}/oauth2/Approval`, { grant_type: 'client_credentials', appkey: c.appKey, secretkey: c.secretKey }, { timeout: 10000 });
                auth = response.data?.approval_key;
            }
            if (stopped || revision !== generation) return;
            if (!auth) throw new Error('auth');
            const current = new Socket(broker === 'ls' ? 'wss://openapi.ls-sec.co.kr:9443/websocket' : 'ws://ops.koreainvestment.com:21000', { handshakeTimeout: 10000 });
            socket = current; lastMessage = now();
            current.on('open', () => { if (socket !== current) return; connecting = false; status.websocket = '구독 중'; sync(); });
            current.on('message', raw => {
                if (socket !== current) return;
                lastMessage = now();
                let message; try { message = JSON.parse(String(raw)); } catch {}
                if (broker === 'kis' && message?.header?.tr_id === 'PINGPONG') { current.send(String(raw)); return; }
                const ack = outstanding && (broker === 'ls' ? message?.header?.tr_cd === outstanding.tr && message?.header?.rsp_cd != null
                    : message?.header?.tr_id === outstanding.tr && message?.body?.rt_cd != null);
                if (ack && outstanding) {
                    const success = broker === 'ls' ? ['00000', '000000', '0000', '0'].includes(String(message.header.rsp_cd)) : String(message.body.rt_cd) === '0';
                    if (!success) {
                        if (outstanding.extra) { outstanding.entry.error = '웹소켓 구독 거부 · REST 보완'; outstanding.entry.retryAt = now() + 60000; outstanding = null; sync(); return; }
                        disconnect('프로그램 웹소켓 구독 실패'); return;
                    }
                    const responseCode = broker === 'kis' ? message.header.tr_key : null;
                    if (responseCode && responseCode.trim() !== outstanding.key.trim()) { disconnect('웹소켓 구독 응답 종목 불일치'); return; }
                    if (outstanding.extra) {
                        if (outstanding.remove) streamSubscriptions.delete(outstanding.extra);
                        else { streamSubscriptions.set(outstanding.extra, outstanding.entry); outstanding.entry.error = ''; }
                    } else outstanding.remove ? subscribed.delete(outstanding.code) : subscribed.add(outstanding.code);
                    outstanding = null; failures = 0; status.error = null; sync(); return;
                }
                try { receive(raw); } catch { status.error = '프로그램 분봉 저장 실패'; }
                if (confirmedDay === dayKey(now()) && collectingAt(now())) {
                    const tr = broker === 'ls' ? message?.header?.tr_cd : String(raw).split('|')[1];
                    for (const [id, entry] of streamSubscriptions) if (entry.tr === tr && streams.has(id)) {
                        try { if (streams.get(id).onData(raw) !== false) streams.get(id).lastDataAt = now(); } catch { streams.get(id).error = '실시간 거래대금 처리 오류'; }
                    }
                }
            });
            current.on('pong', () => { if (socket === current) lastMessage = now(); });
            current.on('error', () => { if (socket === current) disconnect('프로그램 웹소켓 연결 실패'); });
            current.on('close', () => { if (socket === current) disconnect('프로그램 웹소켓 연결 종료'); });
        } catch { if (revision === generation) disconnect('프로그램 웹소켓 인증/연결 실패'); }
        finally { if (revision === generation) connecting = false; }
    }
    async function collect() {
        if (running) return running;
        running = (async () => {
            if (!collectingAt(now())) return;
            if (!stocks().length && !streams.size) { sync(); return; }
            if (!await supply.confirmMarket()) return;
            confirmedDay = dayKey(now());
            await connect(); sync();
            const minute = Math.floor(now()/60000);
            if (minute === lastRestMinute || !investorObservationAt(now())) return;
            lastRestMinute = minute;
            for (const stock of stocks()) {
                try {
                    let values;
                    if (broker === 'ls') values = (await investors(stock.code, confirmedDay.replaceAll('-', ''))).find(row => row.date === confirmedDay.replaceAll('-', ''));
                    else {
                        // The estimate endpoint has no source date. Do not relabel the
                        // previous session's estimates during NXT pre-market trading.
                        const korean = new Date(now()+9*3600000);
                        if (korean.getUTCHours()*60+korean.getUTCMinutes()<570) continue;
                        const data = await rest('HHPTJ04160200', 'investor-trend-estimate', { MKSC_SHRN_ISCD: stock.code });
                        const rows = data.output2;
                        if (!Array.isArray(rows)) throw failure('한투 투자자 추정 응답 형식 오류', 502);
                        // Input group is the broker's sequence, not a source timestamp.
                        const row = rows.filter(r => quantity(r.bsop_hour_gb) !== null).sort((a,b) => quantity(b.bsop_hour_gb)-quantity(a.bsop_hour_gb))[0];
                        if (row) values = { foreign: quantity(row.frgn_fake_ntby_qty), institution:
                            korean.getUTCHours()*60+korean.getUTCMinutes() < 600 ? null : quantity(row.orgn_fake_ntby_qty) };
                    }
                    const at = now();
                    if (dayKey(at) !== confirmedDay || !investorObservationAt(at) || !stocks().some(s => s.code === stock.code)) continue;
                    if (values) store.merge(stock.code, { ...values, t: Math.floor(at/60000)*60000,
                        individual_at: at, foreign_at: at, institution_at: at });
                    if (status.websocket === '구독 완료') status.error = null;
                } catch { status.error = `${broker.toUpperCase()} 투자자 REST 조회 실패`; }
            }
        })().finally(() => { running = null; });
        return running;
    }
    async function query(input = {}) {
        const code = String(input.code || ''), mode = input.mode || 'day';
        if (!validCode(code) || !(supply.summary().archive || []).some(s => s.code === code)) throw failure('등록된 종목을 선택하세요.');
        if (!['day', 'minute'].includes(mode) || input.cursor && !/^\d{8}$/.test(input.cursor)
            || input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw failure('잘못된 수급 조회 조건입니다.');
        if (mode === 'day') return daily(code, input);
        flush();
        const dates = store.dates(code), cursor = input.cursor?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
        const date = input.date || (cursor ? dates.filter(day => day <= cursor).at(-1) : dates.at(-1)) || dayKey(now());
        const previous = dates.filter(day => day < date).at(-1);
        const currentMinute = Math.floor(now()/60000)*60000;
        return { success: true, mode, date, available_dates: dates, points: store.points(code, date).filter(p => p.t < currentMinute),
            has_more: !!previous, cursor: previous?.replaceAll('-', '') || null, warnings: warning,
            status: { ...status }, individual_supported: broker === 'ls', collecting: collectingAt(now()) };
    }
    function start() {
        if (timer) return;
        stopped = false;
        const run = () => {
            try {
                flush();
                const minute = Math.floor(now()/60000);
                if (lastArchiveMinute !== minute) { store.archiveCompleted(); lastArchiveMinute = minute; }
                if (!collectingAt(now())) { if (socket) { const old=socket;socket=null;generation++;subscribed.clear();streamSubscriptions.clear();outstanding=null;old.terminate(); } status.websocket='장외'; return; }
                if (outstanding && now()-outstanding.at>10000 || socket && now()-lastMessage>120000) disconnect('프로그램 웹소켓 응답 시간 초과');
                if (socket && now()-lastMessage>30000) socket.ping();
                void collect().catch(() => { status.error = '종목 수급 수집 실패'; });
            } catch { status.error = '종목 수급 저장 실패'; }
        };
        run(); timer = setInterval(run, 1000); timer.unref?.();
    }
    function stop() { stopped = true; clearInterval(timer); timer=null; generation++; const old=socket;socket=null;old?.terminate();subscribed.clear();streamSubscriptions.clear();outstanding=null; }
    return { query, collect, start, stop, store, status, receive, flush, setStreams, streamStatus };
}
module.exports = { createBrokerStockSupply, programRecords, lsInvestors };
