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
    const clock = new Date(t + 9 * 3600000), minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
    return ![0, 6].includes(clock.getUTCDay()) && minute >= 480 && minute <= 1201;
}

function createSupplyService({ directory, http, getToken, resolveStock, now = Date.now,
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.warn }) {
    const store = createSupplyStore({ directory, now });
    const statuses = new Map(), verifiedDay = new Map(), cache = new Map();
    let queue = Promise.resolve(), running = null, timer;
    let market = store.marketDay(), lastMarketAttempt = null;
    function marketConfirmed() { return market?.day === dayKey(now()); }
    async function confirmMarket() {
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
        return { success: true, ...config, collecting: collectingAt(now()) && marketConfirmed(), market_confirmed: marketConfirmed(),
            statuses: Object.fromEntries(config.stocks.map(stock => [stock.code, statuses.get(stock.code) || null])) };
    }
    async function configure(codes, revision) {
        if (!Array.isArray(codes) || codes.length > 5 || codes.some(code => typeof code !== 'string' || !validCode(code))
            || new Set(codes).size !== codes.length) throw failure('중복 없이 최대 5종목까지 지정할 수 있습니다.');
        const stocks = [];
        for (const code of codes) stocks.push(await resolveStock(code));
        store.configure(stocks, revision);
        cache.clear();
        // Schedule independently: a closed browser does not stop collection.
        void collect().catch(error => log(`[Supply] ${error.message}`));
        return summary();
    }
    function active(stock) {
        return store.config().stocks.some(item => item.code === stock.code && item.added_at === stock.added_at);
    }
    function collect() {
        if (running) return running;
        if (!collectingAt(now())) return Promise.resolve();
        running = (async () => {
            const stocks = store.config().stocks;
            if (!stocks.length || !await confirmMarket() || !collectingAt(now())) return;
            for (const stock of stocks) {
                if (!active(stock)) continue;
                const startDay = dayKey(now()), date = startDay.replaceAll('-', ''), errors = [];
                const state = { ...statuses.get(stock.code), checked_at: now(), investor_ok: false, program_ok: false };
                try {
                    const response = await post('ka10060', { dt: date, stk_cd: `${stock.code}_AL`, amt_qty_tp: '2', trde_tp: '0', unit_tp: '1' });
                    const rows = response.data.stk_invsr_orgn_chart;
                    if (!Array.isArray(rows)) throw new Error('투자자 수급 응답 형식 오류');
                    const row = rows.find(row => row.dt === date), observed = now();
                    if (!row) throw new Error('당일 투자자 수급 미제공');
                    const point = { t: observed, individual: quantity(row.ind_invsr), foreign: quantity(row.frgnr_invsr), institution: quantity(row.orgn) };
                    if (dayKey(observed) === startDay && active(stock)) {
                        verifiedDay.set(stock.code, startDay);
                        if (['individual', 'foreign', 'institution'].some(field => point[field] != null)) {
                            store.merge(stock.code, point); state.investor_at = observed;
                        }
                        if (['individual', 'foreign', 'institution'].some(field => point[field] == null)) throw new Error('일부 투자자 수급 미제공');
                        state.investor_ok = true;
                    }
                } catch (error) { errors.push(error.message); }
                try {
                    // ka90008 has only HHmmss, so confirm today's session via dated ka10060 data.
                    if (verifiedDay.get(stock.code) !== startDay) throw new Error('당일 거래일 미확인 · 프로그램 수집 대기');
                    const response = await post('ka90008', { stk_cd: `${stock.code}_AL`, amt_qty_tp: '2', date });
                    const rows = response.data.stk_tm_prm_trde_trnsn;
                    if (!Array.isArray(rows)) throw new Error('프로그램 수급 응답 형식 오류');
                    const observed = now();
                    const latest = rows.map(row => ({ row, t: timestamp(date, String(row.tm || '')) }))
                        .filter(item => Number.isFinite(item.t) && item.t <= observed && quantity(item.row.prm_netprps_qty) != null)
                        .sort((a, b) => b.t - a.t)[0];
                    if (!latest) throw new Error('당일 프로그램 수급 미제공');
                    if (dayKey(observed) === startDay && active(stock)) {
                        store.merge(stock.code, { t: observed, program: quantity(latest.row.prm_netprps_qty), program_at: latest.t });
                        state.program_at = latest.t; state.program_ok = true;
                    }
                } catch (error) { errors.push(error.message); }
                if (active(stock)) statuses.set(stock.code, { ...state, checked_at: now(), error: errors.join(' · ') });
            }
        })().finally(() => { running = null; });
        return running;
    }
    async function history(api, body, field, from, to) {
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
    async function daily(code, cursor) {
        const date = cursor || dayKey(now()).replaceAll('-', '');
        // Match concentration's initial stock page instead of choosing a calendar range.
        const anchor = await post('ka10081', { stk_cd: `${code}_AL`, upd_stkpc_tp: '0', base_dt: date });
        const bars = anchor.data.stk_dt_pole_chart_qry;
        if (!Array.isArray(bars)) throw new Error('일봉 기준 데이터 응답 형식 오류');
        const byDate = new Map(bars.filter(row => /^\d{8}$/.test(String(row.dt)) && row.dt <= date).map(row => [row.dt, row]));
        const dates = [...byDate.keys()].sort(), from = dates[0];
        if (!from) return { success: true, mode: 'day', points: [], candles: [], warnings: [], has_more: false, cursor: null };
        const results = await Promise.allSettled([
            history('ka10060', { dt: date, stk_cd: `${code}_AL`, amt_qty_tp: '2', trde_tp: '0', unit_tp: '1' }, 'stk_invsr_orgn_chart', from, date),
            history('ka90013', { date, stk_cd: `${code}_AL`, amt_qty_tp: '2' }, 'stk_daly_prm_trde_trnsn', from, date)
        ]);
        const points = new Map(dates.map(day => [timestamp(day), { t: timestamp(day) }])), warnings = [];
        results.forEach((result, i) => {
            if (result.status === 'rejected') { warnings.push(result.reason.message); return; }
            if (result.value.error) warnings.push(result.value.error);
            else if (result.value.partial) warnings.push('일부 과거 구간 조회 한도 도달');
            for (const row of result.value.rows) {
                const t = timestamp(row.dt); if (!Number.isFinite(t)) continue;
                const point = points.get(t); if (!point) continue;
                if (i === 0) Object.assign(point, { individual: quantity(row.ind_invsr), foreign: quantity(row.frgnr_invsr), institution: quantity(row.orgn) });
                else point.program = quantity(row.prm_netprps_qty);
                points.set(t, point);
            }
        });
        // Daily results live only in a short-lived memory cache; never write them to disk.
        const candles = dates.map(day => {
            const row = byDate.get(day);
            return { t: timestamp(day), open: Math.abs(quantity(row.open_pric) ?? NaN), high: Math.abs(quantity(row.high_pric) ?? NaN),
                low: Math.abs(quantity(row.low_pric) ?? NaN), close: Math.abs(quantity(row.cur_prc) ?? NaN) };
        }).filter(point => [point.open, point.high, point.low, point.close].every(value => Number.isFinite(value) && value > 0));
        const next = dayKey(timestamp(from) - 86400000).replaceAll('-', '');
        const hasMore = anchor.headers?.['cont-yn'] === 'Y';
        return { success: true, mode: 'day', points: [...points.values()], candles, warnings,
            has_more: hasMore, cursor: hasMore ? next : null };
    }
    async function query(input = {}) {
        const { code, mode = 'day', cursor = '' } = input;
        if (!validCode(code) || !['day', 'minute'].includes(mode)
            || cursor && (!/^\d{8}$/.test(cursor) || !Number.isFinite(timestamp(cursor)) || dayKey(timestamp(cursor)).replaceAll('-', '') !== cursor))
            throw failure('잘못된 수급 조회 조건입니다.');
        const config = store.config();
        if (!config.archive.some(stock => stock.code === code)) throw failure('등록 또는 보관된 종목을 선택하세요.', 404);
        if (mode === 'minute') {
            const dates = store.dates(code);
            const date = input.date || (cursor ? dates.filter(day => day.replaceAll('-', '') <= cursor).at(-1) : dates.at(-1))
                || (cursor ? `${cursor.slice(0,4)}-${cursor.slice(4,6)}-${cursor.slice(6,8)}` : dayKey(now()));
            const index = dates.indexOf(date), hasMore = index > 0;
            return { success: true, mode, date, available_dates: dates, points: store.points(code, date),
                has_more: hasMore, cursor: hasMore ? dates[index - 1].replaceAll('-', '') : null,
                status: statuses.get(code) || null, collecting: collectingAt(now()),
                investor_api: 'ka10060', individual_supported: true,
                warnings: ['1분마다 관측한 당일 누적 순매수수량 · 수집 이전/누락 구간은 제공되지 않습니다.'] };
        }
        const key = `${code}:${cursor}`, previous = cache.get(key);
        if (previous && previous.expires > now()) return previous.promise;
        const entry = { expires: now() + 60000 };
        entry.promise = daily(code, cursor).catch(error => { if (cache.get(key) === entry) cache.delete(key); throw error; });
        cache.set(key, entry);
        if (cache.size > 12) cache.delete(cache.keys().next().value);
        return entry.promise;
    }
    async function candles(input = {}) {
        if (!input.mode || input.mode === 'day') {
            const result = await query({ ...input, mode: 'day' });
            return { success: true, points: result.candles, partial: result.warnings.length > 0, cursor: result.cursor, has_more: result.has_more };
        }
        const { code, mode = 'day', range = '1y', date = dayKey(now()) } = input;
        if (!validCode(code) || !['day', 'minute'].includes(mode) || !['6m', '1y', '3y', '5y'].includes(range)
            || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw failure('잘못된 캔들 조회 조건입니다.');
        if (!store.config().archive.some(stock => stock.code === code)) throw failure('등록 또는 보관된 종목을 선택하세요.', 404);
        let to = (mode === 'day' ? dayKey(now()) : date).replaceAll('-', '');
        const start = new Date(`${dayKey(now())}T00:00:00Z`);
        start.setUTCMonth(start.getUTCMonth() - ({ '6m': 6, '1y': 12, '3y': 36, '5y': 60 }[range]));
        let from = mode === 'day' ? start.toISOString().slice(0, 10).replaceAll('-', '') : to;
        const points = new Map(); let next = '', partial = false, previousDay = null;
        for (let page = 0; page < 80; page++) {
            const response = await post(mode === 'day' ? 'ka10081' : 'ka10080', {
                stk_cd: `${code}_AL`, upd_stkpc_tp: '0', ...(mode === 'day' ? { base_dt: to } : { tic_scope: '1' })
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
                const t = timestamp(day, mode === 'day' ? '000000' : key.slice(8));
                const point = { t, open: Math.abs(quantity(row.open_pric) ?? NaN), high: Math.abs(quantity(row.high_pric) ?? NaN),
                    low: Math.abs(quantity(row.low_pric) ?? NaN), close: Math.abs(quantity(row.cur_prc) ?? NaN) };
                if (Number.isFinite(t) && [point.open, point.high, point.low, point.close].every(value => Number.isFinite(value) && value > 0)) points.set(t, point);
            }
            if (reached || response.headers?.['cont-yn'] !== 'Y') break;
            const key = String(response.headers?.['next-key'] || '');
            if (!key || key === next) throw new Error('캔들 연속조회 키 오류');
            next = key; if (page === 79) partial = true;
        }
        return { success: true, points: [...points.values()].sort((a, b) => a.t - b.t), partial,
            has_more: Boolean(previousDay), cursor: previousDay,
            date: `${to.slice(0,4)}-${to.slice(4,6)}-${to.slice(6,8)}` };
    }
    function start() {
        if (timer) return;
        const run = () => {
            try { store.archiveCompleted(); } catch (error) { log(`[Supply archive] ${error.message}`); }
            void collect().catch(error => log(`[Supply] ${error.message}`));
        };
        run(); timer = setInterval(run, 60000); timer.unref?.();
    }
    function stop() { clearInterval(timer); timer = null; }
    return { summary, configure, query, candles, collect, start, stop, store };
}
module.exports = { createSupplyService, quantity, timestamp, collectingAt };
