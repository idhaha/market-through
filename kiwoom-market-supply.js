const { createSupplyStore, dayKey, failure } = require('./supply-store');
const { quantity, timestamp, collectingAt } = require('./supply-service');
const { markets } = require('./market-supply-service');
const { createHistoryCache } = require('./daily-query-cache');
const compact = day => day.replaceAll('-', '');
const shift = (date, days) => compact(dayKey(timestamp(date) + days * 86400000));
const configs = { kospi: { market: '0', industry: '001_AL', program: 'P001_AL01' },
    kosdaq: { market: '1', industry: '101_AL', program: 'P101_AL02' } };
function investors(row) {
    const amount = value => { const n = quantity(value); return n === null || !Number.isSafeInteger(n * 100) ? null : n * 100; };
    // ka10051 uses 100 million KRW; the common market renderer/store uses million KRW.
    return { individual: amount(row.ind_netprps), foreign: amount(row.frgnr_netprps), institution: amount(row.orgn_netprps) };
}
function createKiwoomMarketSupply({ directory, http, getToken, reference, supply, now = Date.now,
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const store = createSupplyStore({ directory, now }), history = createHistoryCache({ now });
    const states = new Map(), pending = new Map();
    let queue = Promise.resolve(), running, timer;
    async function post(tr, body, next = '') {
        const task = queue.then(async () => {
            try {
                const response = await http.post(`https://api.kiwoom.com/api/dostk/${tr === 'ka10051' ? 'sect' : 'mrkcond'}`, body, {
                    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json;charset=UTF-8',
                        'api-id': tr, 'cont-yn': next ? 'Y' : 'N', 'next-key': next }, timeout: 10000 });
                if (Number(response.data?.return_code) !== 0) throw new Error('upstream');
                return response;
            } catch { throw failure(`키움 ${tr} 조회 실패`, 502); }
            finally { await pause(350); }
        });
        queue = task.catch(() => {}); return task;
    }
    async function investorRows(code, date) {
        const config = configs[code];
        const response = await post('ka10051', { mrkt_tp: config.market, amt_qty_tp: '0', base_dt: date, stex_tp: '3' });
        const rows = response.data.inds_netprps;
        if (!Array.isArray(rows)) throw failure('키움 투자자 응답 형식 오류', 502);
        // Never add industry rows together: the market total is already present.
        const row = rows.find(row => row.inds_cd === config.industry);
        return row ? investors(row) : {};
    }
    async function programRows(code, date, daily, onPage = () => {}, from = date) {
        const rows = new Map(), seen = new Set(); let next = '';
        for (let page = 0; page < 80; page++) {
            const response = await post(daily ? 'ka90010' : 'ka90005', { date, amt_qty_tp: '1', mrkt_tp: configs[code].program, min_tic_tp: '1', stex_tp: '3' }, next);
            if (!Array.isArray(response.data.prm_trde_trnsn)) throw failure('키움 프로그램 응답 형식 오류', 502);
            let reached = false;
            for (const row of response.data.prm_trde_trnsn) {
                const raw = String(row.cntr_tm || '');
                if (!(daily ? /^\d{14}$/ : /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/).test(raw)) continue;
                const dt = daily ? raw.slice(0, 8) : date;
                if (dt < from) { reached = true; continue; }
                if (dt > date) continue;
                const t = timestamp(dt, daily ? '000000' : raw);
                if (!Number.isFinite(t) || compact(dayKey(t)) !== dt || t > now()) continue;
                const value = quantity(row.all_netprps);
                if (value !== null) rows.set(t, { t, dt, program: value });
            }
            onPage([...rows.values()]);
            if (reached || response.headers?.['cont-yn'] !== 'Y') return [...rows.values()];
            next = String(response.headers?.['next-key'] || '');
            if (!next || seen.has(next)) throw failure('키움 프로그램 연속조회 키 오류', 502);
            seen.add(next);
        }
        throw failure('키움 프로그램 과거 조회 한도 도달', 502);
    }
    function flush() {
        const minute = Math.floor(now() / 60000) * 60000;
        for (const [code, point] of pending) if (point.t < minute) { store.merge(markets[code].code, point); pending.delete(code); }
    }
    function collect() {
        if (running) return running;
        running = (async () => {
            flush();
            if (!collectingAt(now()) || !await supply.confirmMarket()) return;
            const date = compact(dayKey(now()));
            for (const code of Object.keys(configs)) {
                const state = { checked_at: now(), investor_ok: false, program_ok: false, error: '' }, errors = [];
                try {
                    const values = await investorRows(code, date), at = now();
                    if (compact(dayKey(at)) === date && collectingAt(at)) {
                        const t = Math.floor(at / 60000) * 60000;
                        if (Object.values(values).some(Number.isSafeInteger)) {
                            const previous = pending.get(code);
                            if (previous && previous.t !== t) { store.merge(markets[code].code, previous); pending.delete(code); }
                            pending.set(code, { t, ...values, individual_at: at, foreign_at: at, institution_at: at });
                            state.investor_ok = true;
                        }
                    }
                } catch (error) { errors.push(error.message); }
                try {
                    const rows = await programRows(code, date, false);
                    if (compact(dayKey(now())) === date && collectingAt(now())) {
                        const byMinute = new Map(), lastComplete = Math.floor(now()/60000)*60000;
                        const saved = new Map(store.points(markets[code].code, dayKey(now())).map(p=>[p.t,p]));
                        for (const row of rows.sort((a,b)=>a.t-b.t)) {
                            const t = Math.floor(row.t/60000)*60000;
                            if (t >= lastComplete || !collectingAt(row.t)) continue;
                            byMinute.set(t, { t, program: row.program, program_at: row.t });
                        }
                        for (const point of byMinute.values()) {
                            const old = saved.get(point.t);
                            if (old?.program_at > point.program_at || old?.program_at === point.program_at && old.program === point.program) continue;
                            store.merge(markets[code].code, point);
                        }
                        state.program_ok = byMinute.size > 0;
                    }
                } catch (error) { errors.push(error.message); }
                state.error = errors.join(' · '); states.set(code, state);
            }
            flush();
        })().finally(() => { running = null; });
        return running;
    }
    const warnings = code => configs[code]
        ? ['키움 KRX+NXT 통합 · 표시 단위: 억원', '투자자는 1분마다 관측한 누적값 · 프로그램은 원천 분 시각 기준']
        : ['키움 선물 수급 미제공 · 캔들은 현물지수'];
    function status(code, date) {
        flush();
        return { status: date === dayKey(now()) ? states.get(code) : undefined,
            partial: !configs[code] || Boolean(date === dayKey(now()) && states.get(code)?.error) };
    }
    async function daily(code, cursor, onProgress = () => {}) {
        if (!configs[code]) throw failure('키움 선물 수급 미제공');
        const anchor = await reference.query({ mode: 'day', market: code, cursor });
        const dates = anchor.points.map(p => compact(dayKey(p.t))).sort(), from = dates[0], to = dates.at(-1);
        const points = new Map(dates.map(dt => [dt, { t: timestamp(dt) }])), notices = ['키움 KRX+NXT 통합 · 표시 단위: 억원'];
        const snapshot = () => ({ success: true, points: [...points.values()].map(p=>({...p})),
            candles: anchor.points.map(p=>({...p,t:timestamp(compact(dayKey(p.t)))})), has_more: anchor.has_more, cursor: anchor.cursor, warnings: [...notices] });
        onProgress(snapshot());
        if (!from) return snapshot();
        function accept(result) { for (const row of result.rows) if (points.has(row.dt)) Object.assign(points.get(row.dt), row); onProgress(snapshot()); }
        await Promise.all(['investor','program'].map(async kind => {
            const result = await history.read(`${code}:${kind}`, { from, to, recent: cursor ? false : dates.at(-2) || to,
                onProgress: accept, load: async (start, end, onPage) => {
                    const rows = new Map(); let error = '';
                    try {
                        if (kind === 'program') await programRows(code, end, true, page => {
                            for (const row of page) rows.set(row.dt, row); onPage([...rows.values()]);
                        }, start);
                        else for (const dt of dates.filter(dt => dt >= start && dt <= end).reverse()) {
                            const values = await investorRows(code, dt);
                            rows.set(dt, { dt, ...values }); onPage([...rows.values()]);
                        }
                    } catch (e) { error = e.message; }
                    return { rows: [...rows.values()], partial: Boolean(error), error };
                } });
            if (result.error) notices.push(result.error);
            accept(result);
        }));
        if ([...points.values()].some(p=>['individual','foreign','institution','program'].some(field=>p[field]==null))) notices.push('일부 일별 수급 미제공');
        return snapshot();
    }
    function start() {
        if (timer) return;
        const run = () => { try { flush(); store.archiveCompleted(); } catch {} void collect().catch(()=>{}); };
        run(); timer = setInterval(run, 60000); timer.unref?.();
    }
    return { store, collect, daily, flush, warnings, status, start, stop: () => { clearInterval(timer); timer = null; } };
}
module.exports = { createKiwoomMarketSupply, investors, configs };
