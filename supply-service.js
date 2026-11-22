const { createSupplyStore, dayKey, validCode, failure } = require('./supply-store');

function quantity(value) {
    const text = String(value ?? '').replaceAll(',', '').trim();
    // Kiwoom can prefix negative values with both a display sign and a numeric sign.
    if (!/^[+-]*\d+$/.test(text)) return null;
    const number = Number(text.replace(/^[+-]+/, text.startsWith('-') ? '-' : ''));
    return Number.isSafeInteger(number) ? number : null;
}
function timestamp(date, time = '000000') {
    if (!/^\d{8}$/.test(String(date)) || !/^\d{6}$/.test(String(time))) return NaN;
    return Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`);
}
function collectingAt(t) {
    const policy=require('./trading-session').current();if(policy)return policy.spotAt(t);
    const clock = new Date(t + 9 * 3600000), minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
    return ![0, 6].includes(clock.getUTCDay()) && minute >= 480 && minute <= 1201;
}
function investorObservationAt(t) {
    return collectingAt(t);
}
function futuresObservationAt(t, confirmedDay) {
    const policy=require('./trading-session').current();if(policy)return policy.futuresAt(t);
    const clock = new Date(t + 9 * 3600000), minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
    if (minute >= 360 && minute < 480) return false;
    // After midnight, the session belongs to the date on which night trading started.
    const session = new Date(t + 9 * 3600000 - (minute < 360 ? 86400000 : 0));
    return ![0, 6].includes(session.getUTCDay()) && session.toISOString().slice(0,10) === confirmedDay;
}

// minuteStore: kiwoom-minute-store(지난날 1분봉 저장 파일, 쏠림율과 함께 씀). 없으면 예전처럼 매번 키움에서 받는다.
function createSupplyService({ directory, http, getToken, resolveStock, now = Date.now, minuteStore = null,
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.warn }) {
    const store = createSupplyStore({ directory, now });
    const { createHistoryCache, createDailyQueryCache } = require('./daily-query-cache');
    const cache = createDailyQueryCache({ now }), historyCache = createHistoryCache({ now });
    let queue = Promise.resolve();
    let market = store.marketDay(), lastMarketAttempt = null, marketRequest = null;
    function marketConfirmed() { return market?.day === dayKey(now()); }
    async function checkMarket() {
        if (marketConfirmed()) return true;
        const at = now(), minute = Math.floor(at / 60000);
        const clock = new Date(at + 9 * 3600000);
        if (clock.getUTCHours() * 60 + clock.getUTCMinutes() > 630 || lastMarketAttempt === minute) return false;
        lastMarketAttempt = minute;
        try {
            const response = await post('ka10080', { stk_cd: '005930_AL', tic_scope: '1', upd_stkpc_tp: '0' });
            const rows = response.data.stk_min_pole_chart_qry;
            if (!Array.isArray(rows)) throw new Error('개장 확인 분봉 응답 형식 오류');
            const day = dayKey(at), date = day.replaceAll('-', '');
            const traded = rows.some(row => {
                const time = String(row.cntr_tm || '');
                const t = timestamp(time.slice(0, 8), time.slice(8));
                return time.length === 14 && time.startsWith(date) && Number.isFinite(t) && t <= now() && quantity(row.trde_qty) > 0;
            });
            if (!traded || dayKey(now()) !== day) return false;
            store.confirmMarketDay(day, now());
            market = { day, confirmed_at: now() };
            return true;
        } catch (error) { log('[Supply market] ' + error.message); return false; }
    }
    function confirmMarket() {
        if (!collectingAt(now())) return Promise.resolve(false);
        if (!marketRequest) marketRequest = checkMarket().finally(() => { marketRequest = null; });
        return marketRequest;
    }
    function post(api, body, next = '') {
        const task = queue.then(async () => {
            try {
                const token = await getToken();
                const response = await http.post(`https://api.kiwoom.com/api/dostk/${['ka10060', 'ka10080', 'ka10081'].includes(api) ? 'chart' : 'mrkcond'}`, body, {
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json;charset=UTF-8',
                        'api-id': api, 'cont-yn': next ? 'Y' : 'N', 'next-key': next }, timeout: 10000
                });
                if (response.data?.return_code != null && Number(response.data.return_code) !== 0)
                    throw new Error(`${api}: ${response.data.return_msg || '조회 실패'}`);
                return response;
            } finally { await pause(300); }
        });
        queue = task.catch(() => {});
        return task;
    }
    function summary() {
        const config = store.config();
        return { success: true, ...config, market_confirmed: marketConfirmed() };
    }
    async function configure(codes, revision) {
        if (!Array.isArray(codes) || codes.length > 5 || codes.some(code => typeof code !== 'string' || !validCode(code))
            || new Set(codes).size !== codes.length) throw failure('중복 없이 최대 5종목까지 지정할 수 있습니다.');
        const stocks = [];
        for (const code of codes) stocks.push(await resolveStock(code));
        store.configure(stocks, revision);
        cache.clear();
        return summary();
    }
    // 종목 분봉 수급은 한투 자료(data/kis-supply, broker-stock-supply.js) 한 곳에만 둔다(2026-11-22, 소스는 한 곳).
    // 예전 키움 1분 수집(ka10060 · ka90008 → data/supply/<종목>)은 화면에서 쓰지 않아 없앴다. 이 서비스는
    // 종목수급 등록 목록 · 장 열린 날 확인 · 일봉 수급 · 가격 캔들만 맡는다.
    async function history(api, body, field, from, to, onPage = () => {}) {
        const rows = new Map(); let next = '', partial = false, error = '';
        for (let page = 0; page < 80; page++) {
            try {
                let response;
                for (let attempt = 0; attempt < 2; attempt++) {
                    try { response = await post(api, body, next); break; }
                    catch (cause) { if (attempt) throw cause; await pause(600); }
                }
                const list = response.data[field];
                if (!Array.isArray(list)) throw new Error(`${api} 수급 응답 형식 오류`);
                for (const row of list) if (/^\d{8}$/.test(String(row.dt)) && row.dt >= from && row.dt <= to) rows.set(row.dt, row);
                onPage([...rows.values()]);
                const dates = list.map(row => String(row.dt || '')).filter(date => /^\d{8}$/.test(date));
                if (response.headers?.['cont-yn'] !== 'Y' || dates.some(date => date <= from)) break;
                const key = String(response.headers?.['next-key'] || '');
                if (!key || key === next) throw new Error(`${api} 연속조회 키 오류`);
                next = key;
                if (page === 79) partial = true;
            } catch (cause) {
                if (!rows.size) throw new Error(`${api} 수급 조회 실패: ${cause.message}`);
                partial = true; error = `${api} 과거 조회 실패 · 수신한 구간 표시: ${cause.message}`; break;
            }
        }
        return { rows: [...rows.values()], partial, error };
    }
    async function daily(code, cursor, onProgress = () => {}) {
        const date = cursor || dayKey(now()).replaceAll('-', '');
        // Match concentration's initial stock page instead of choosing a calendar range.
        // 일봉 가격은 수정주가(upd_stkpc_tp 1)로 받는다(2026-11-21 사용자 결정). 액면분할 · 병합 전 봉도 지금 가격 기준으로 이어진다.
        const anchor = await post('ka10081', { stk_cd: `${code}_AL`, upd_stkpc_tp: '1', base_dt: date });
        const bars = anchor.data.stk_dt_pole_chart_qry;
        if (!Array.isArray(bars)) throw new Error('일봉 기준 데이터 응답 형식 오류');
        const byDate = new Map(bars.filter(row => /^\d{8}$/.test(String(row.dt)) && row.dt <= date).map(row => [row.dt, row]));
        const dates = [...byDate.keys()].sort(), from = dates[0];
        if (!from) return { success: true, mode: 'day', points: [], candles: [], warnings: [], has_more: false, cursor: null };
        const to=dates.at(-1), points = new Map(dates.map(day => [timestamp(day), { t: timestamp(day) }])), warnings = [];
        // Daily source data and completed history remain in bounded memory caches only.
        const candles = dates.map(day => {
            const row = byDate.get(day);
            return { t: timestamp(day), open: Math.abs(quantity(row.open_pric) ?? NaN), high: Math.abs(quantity(row.high_pric) ?? NaN),
                low: Math.abs(quantity(row.low_pric) ?? NaN), close: Math.abs(quantity(row.cur_prc) ?? NaN) };
        }).filter(point => [point.open, point.high, point.low, point.close].every(value => Number.isFinite(value) && value > 0));
        const next = dayKey(timestamp(from) - 86400000).replaceAll('-', '');
        const hasMore = anchor.headers?.['cont-yn'] === 'Y';
        const snapshot = () => ({ success: true, mode: 'day', points: [...points.values()].map(point=>({...point})), candles, warnings: [...warnings],
            has_more: hasMore, cursor: hasMore ? next : null });
        function accept(result, i) {
            for (const row of result.rows) {
                const point=points.get(timestamp(row.dt)); if (!point) continue;
                if (i===0) Object.assign(point,{individual:quantity(row.ind_invsr),foreign:quantity(row.frgnr_invsr),institution:quantity(row.orgn)});
                else point.program=quantity(row.prm_netprps_qty);
            }
            onProgress(snapshot());
        }
        onProgress(snapshot());
        const sources = [ ['ka10060','stk_invsr_orgn_chart'], ['ka90013','stk_daly_prm_trde_trnsn'] ];
        await Promise.all(sources.map(async([api,field],i)=>{
            const result=await historyCache.read(`${code}:${api}`,{from,to,recent:cursor?false:dates.at(-2)||to,
                load:(start,end,onPage)=>history(api,{ ...(i===0 ? {dt:end,trde_tp:'0',unit_tp:'1'} : {date:end}),stk_cd:`${code}_AL`,amt_qty_tp:'2'},field,start,end,onPage),
                onProgress:result=>accept(result,i) });
            if (result.error) warnings.push(result.error);
            else if (result.partial) warnings.push('일부 과거 구간 조회 한도 도달');
            accept(result,i);
        }));
        return snapshot();
    }
    async function query(input = {}) {
        const { code, mode = 'day', cursor = '' } = input;
        if (!validCode(code) || !['day', 'minute'].includes(mode)
            || cursor && (!/^\d{8}$/.test(cursor) || !Number.isFinite(timestamp(cursor)) || dayKey(timestamp(cursor)).replaceAll('-', '') !== cursor))
            throw failure('잘못된 수급 조회 조건입니다.');
        const config = store.config();
        if (!config.archive.some(stock => stock.code === code)) throw failure('등록 또는 보관된 종목을 선택하세요.', 404);
        if (mode === 'minute') throw failure('종목 분봉 수급은 한투 자료(/api/kis-supply/chart)에서 봅니다.');
        return cache.read(`${code}:${cursor}`, { ttl: cursor ? 6*3600000 : 60000, progressive: input.progressive === '1',
            load: onProgress => daily(code,cursor,onProgress) });
    }
    async function candles(input = {}) {
        const { code, mode = 'day', range = '1y', date = dayKey(now()) } = input;
        if (!validCode(code) || !['day', 'minute'].includes(mode) || !['6m', '1y', '3y', '5y'].includes(range)
            || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw failure('잘못된 캔들 조회 조건입니다.');
        if (!store.config().archive.some(stock => stock.code === code)) throw failure('등록 또는 보관된 종목을 선택하세요.', 404);
        const validDay = value => typeof value === 'string' && /^\d{8}$/.test(value) && Number.isFinite(timestamp(value)) && dayKey(timestamp(value)).replaceAll('-', '') === value;
        const initialCount = mode === 'day' && input.count != null && input.from == null ? Number(input.count) : null;
        if (initialCount !== null && (!Number.isInteger(initialCount) || initialCount < 1 || initialCount > 600)) throw failure('잘못된 캔들 조회 건수입니다.');
        if (mode === 'day' && ((input.from != null && !validDay(input.from)) || (input.to != null && !validDay(input.to)))) throw failure('잘못된 캔들 조회 기간입니다.');
        let to = (mode === 'day' ? input.to || dayKey(now()) : date).replaceAll('-', '');
        const start = new Date(`${dayKey(now())}T00:00:00Z`);
        start.setUTCMonth(start.getUTCMonth() - ({ '6m': 6, '1y': 12, '3y': 36, '5y': 60 }[range]));
        let from = mode === 'day' ? input.from || (initialCount ? '19000101' : start.toISOString().slice(0, 10).replaceAll('-', '')) : to;
        if (from > to) throw failure('잘못된 캔들 조회 기간입니다.');
        const points = new Map(); let next = '', partial = false, previousDay = null;
        const toPoint = (row, day, key) => {
            const t = timestamp(day, mode === 'day' ? '000000' : key.slice(8));
            const point = { t, open: Math.abs(quantity(row.open_pric) ?? NaN), high: Math.abs(quantity(row.high_pric) ?? NaN),
                low: Math.abs(quantity(row.low_pric) ?? NaN), close: Math.abs(quantity(row.cur_prc) ?? NaN) };
            if (Number.isFinite(t) && [point.open, point.high, point.low, point.close].every(value => Number.isFinite(value) && value > 0)) points.set(t, point);
        };
        // 지난날 1분봉은 쏠림율과 같은 저장 파일(kiwoom-minute-store)을 먼저 본다(2026-11-21). 한 (종목, 날짜)는 파일 하나.
        const today = dayKey(now()).replaceAll('-', '');
        const stored = mode === 'minute' && input.date && to < today && minuteStore ? minuteStore.read(`${code}_AL`, to) : null;
        if (stored) {
            for (const row of stored.rows) toPoint(row, to, String(row.cntr_tm));
            return { success: true, points: [...points.values()].sort((a, b) => a.t - b.t), partial: false,
                has_more: Boolean(stored.prev), cursor: stored.prev, date: `${to.slice(0,4)}-${to.slice(4,6)}-${to.slice(6,8)}` };
        }
        const dayRows = []; let more = false;
        for (let page = 0; page < 80; page++) {
            const response = await post(mode === 'day' ? 'ka10081' : 'ka10080', {
                // 분봉도 날짜를 주면 base_dt로 그날 끝부터 받는다(2026-11-21). 예전에는 오늘부터 그날까지 거슬러 와서, 먼 날일수록 쪽이 늘었다.
                // 일봉은 수정주가(1), 분봉은 실제 체결값(0, 2026-11-21). 키움 분봉은 1을 줘도 수정하지 않는 것을 확인했고
                // (아스트 067390 2026-08-28 병합: 일봉만 ×10), 쏠림율과 같은 요청이어야 저장 파일 하나를 함께 쓴다.
                stk_cd: `${code}_AL`, upd_stkpc_tp: mode === 'day' ? '1' : '0', ...(mode === 'day' ? { base_dt: to } : { tic_scope: '1', ...(input.date ? { base_dt: to } : {}) })
            }, next);
            const rows = response.data[mode === 'day' ? 'stk_dt_pole_chart_qry' : 'stk_min_pole_chart_qry'];
            if (!Array.isArray(rows)) throw new Error('캔들 응답 형식 오류');
            if (page === 0 && mode === 'minute' && !input.date) {
                const latest = rows.map(row => String(row.cntr_tm || '').slice(0, 8)).filter(day => /^\d{8}$/.test(day) && day <= to).sort().at(-1);
                if (latest) from = to = latest;
            }
            let reached = false;
            for (const row of rows) {
                const key = String(mode === 'day' ? row.dt : row.cntr_tm), day = key.slice(0, 8);
                if (!/^\d{8}(\d{6})?$/.test(key)) continue;
                if (day < from) { reached = true; if (!previousDay || day > previousDay) previousDay = day; }
                if (day < from || day > to) continue;
                if (mode === 'minute') dayRows.push(row);
                toPoint(row, day, key);
            }
            more = response.headers?.['cont-yn'] === 'Y';
            if (reached || initialCount && points.size >= initialCount || response.headers?.['cont-yn'] !== 'Y') break;
            const key = String(response.headers?.['next-key'] || '');
            if (!key || key === next) throw new Error('캔들 연속조회 키 오류');
            next = key; if (page === 79) partial = true;
        }
        // 끝난 날을 다 받았으면(더 이전 날 행이 왔거나 연속조회 끝) 저장한다. 수급 캔들은 등록 · 보관 종목만 조회하므로 모두 저장 대상이다.
        if (mode === 'minute' && input.date && minuteStore && to < today && dayRows.length && (previousDay || !more)) {
            const unique = [...new Map(dayRows.map(row => [String(row.cntr_tm), row])).values()];
            try { minuteStore.save(`${code}_AL`, to, unique, previousDay); } catch (error) { log(`[KiwoomMinute] ${code} ${to} 저장 안 함: ${error.message}`); }
        }
        const ordered = [...points.values()].sort((a, b) => a.t - b.t);
        return { success: true, points: initialCount ? ordered.slice(-initialCount) : ordered, partial,
            has_more: Boolean(previousDay), cursor: previousDay,
            date: `${to.slice(0,4)}-${to.slice(4,6)}-${to.slice(6,8)}` };
    }
    return { summary, configure, query, candles, store, confirmMarket,
        futuresAllowed: () => futuresObservationAt(now(), market?.day) };
}
module.exports = { createSupplyService, quantity, timestamp, collectingAt, investorObservationAt, futuresObservationAt };
