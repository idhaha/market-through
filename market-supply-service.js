const { createSupplyStore, dayKey, failure } = require('./supply-store');
const { quantity, timestamp, collectingAt } = require('./supply-service');
const markets = { kospi: { code: 'KOSPI0', market: 'KSP', industry: '0001', program: 'K' },
    kosdaq: { code: 'KOSDAQ', market: 'KSQ', industry: '1001', program: 'Q' },
    futures: { code: 'FUTURE', market: 'K2I', industry: 'F001', priceMarket: 'kospi' },
    futuresKosdaq: { code: 'FUTKQ0', market: 'KQI', industry: 'F002', priceMarket: 'kosdaq' } };
const compact = day => day.replaceAll('-', '');
const before = date => compact(dayKey(timestamp(date) - 86400000));
const investorFields = { individual: 'prsn_ntby_tr_pbmn', foreign: 'frgn_ntby_tr_pbmn', institution: 'orgn_ntby_tr_pbmn' };
function investor(row) { return Object.fromEntries(Object.entries(investorFields).map(([key, field]) => [key, quantity(row[field])])); }
function program(row) {
    const direct = quantity(row.whol_smtn_ntby_tr_pbmn);
    if (direct != null) return direct;
    const arbitrage = quantity(row.arbt_smtn_ntby_tr_pbmn), nonArbitrage = quantity(row.nabt_smtn_ntby_tr_pbmn);
    return arbitrage == null || nonArbitrage == null ? null : arbitrage + nonArbitrage;
}
function createMarketSupplyService({ directory, http, credentials, getToken, reference, supply, now = Date.now,
    minuteProvider, dailyProvider,
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.warn }) {
    const store = createSupplyStore({ directory, now }), statuses = new Map();
    const { createHistoryCache, createDailyQueryCache } = require('./daily-query-cache');
    const cache = createDailyQueryCache({ now }), historyCache = createHistoryCache({ now });
    let queue = Promise.resolve(), running, timer;
    async function get(tr, endpoint, params) {
        const task = queue.then(async () => {
            const { domain, appKey, secretKey } = credentials();
            if (!domain || !appKey || !secretKey) throw new Error('한국투자증권 API 설정이 필요합니다.');
            try {
                const response = await http.get(`${domain}/uapi/domestic-stock/v1/quotations/${endpoint}`, {
                    params, headers: { authorization: `Bearer ${await getToken()}`, appkey: appKey, appsecret: secretKey,
                        tr_id: tr, custtype: 'P', 'Content-Type': 'application/json; charset=utf-8' }, timeout: 10000 });
                if (String(response.data.rt_cd) !== '0') throw new Error(`${tr}: ${response.data.msg1 || '조회 실패'}`);
                const output = response.data.output;
                if (!output || typeof output !== 'object') throw new Error(`${tr} 응답 형식 오류`);
                return Array.isArray(output) ? output : [output];
            } catch (error) {
                // Never propagate an axios error/config containing API credentials to clients or logs.
                throw new Error(error.response?.data?.msg1 || (error.isAxiosError ? `${tr} 통신 오류` : error.message));
            } finally { await pause(300); }
        });
        queue = task.catch(() => {}); return task;
    }
    const warnings = market => markets[market].priceMarket ? [
        '선물 프로그램 수급 미제공',
        `캔들: ${markets[market].priceMarket === 'kospi' ? '코스피' : '코스닥'} 현물지수`
    ] : ['투자자 수급: KRX+NXT 통합 집계 미확인'];
    async function daily(market, cursor, onProgress = () => {}) {
        const config = markets[market], anchor = await reference.query({ mode: 'day', market, cursor });
        const candles = anchor.points, dates = candles.map(p => compact(dayKey(p.t))).sort();
        if (!dates.length) return { success: true, points: [], candles: [], warnings: warnings(market), has_more: false, cursor: null };
        const from = dates[0], to = dates.at(-1), points = new Map(candles.map(p => [compact(dayKey(p.t)), { t: timestamp(compact(dayKey(p.t))) }]));
        const notices = warnings(market), baseWarnings=notices.length;
        const snapshot = () => ({ success:true, partial:notices.length>baseWarnings, points:[...points.values()].map(p=>({...p})).sort((a,b)=>a.t-b.t),
            candles:candles.map(p=>({...p,t:timestamp(compact(dayKey(p.t)))})), warnings:[...notices],has_more:anchor.has_more,cursor:anchor.cursor });
        function accept(result,kind) {
            for (const row of result.rows) {
                const point=points.get(row.dt);if(point)Object.assign(point,kind==='investor'?investor(row):{program:program(row)});
            }
            onProgress(snapshot());
        }
        async function loadSource(kind,startDate,endDate,onPage) {
            const receivedRows=new Map(), errors=[];let end=endDate, partial=false;
            for (let page=0;page<100 && end>=startDate;page++) {
                try {
                    const start=kind==='program'?compact(dayKey(Math.max(timestamp(startDate),timestamp(end)-27*86400000))):end;
                    const rows=kind==='investor'
                        ? await get('FHPTJ04040000','inquire-investor-daily-by-market',{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:config.industry,
                            FID_INPUT_DATE_1:end,FID_INPUT_DATE_2:end,FID_INPUT_ISCD_1:config.market,FID_INPUT_ISCD_2:config.industry})
                        : await get('FHPPG04600001','comp-program-trade-daily',{FID_COND_MRKT_DIV_CODE:'UN',FID_MRKT_CLS_CODE:config.program,
                            FID_INPUT_DATE_1:start,FID_INPUT_DATE_2:end});
                    const dates=rows.map(row=>String(row.stck_bsop_date||'')).filter(date=>/^\d{8}$/.test(date)&&date<=end).sort();
                    for(const row of rows){const dt=String(row.stck_bsop_date||'');if(dt>=startDate&&dt<=endDate)receivedRows.set(dt,{...row,dt});}
                    onPage([...receivedRows.values()]);
                    if(!dates.length){
                        // A successful empty window is genuine missing history, not a transport failure.
                        // Cache that coverage so every refresh does not repeat all empty windows.
                        // An empty program window does not prove that all older dates are unavailable.
                        if(kind==='program'){end=before(start);continue;}
                        break;
                    }
                    end=before(dates[0]);
                    if(page===99 && end>=startDate){partial=true;errors.push('일별 과거 조회 한도 도달');}
                } catch(error){partial=true;errors.push(error.message);break;}
            }
            return {rows:[...receivedRows.values()],partial,error:errors.join(' · ')};
        }
        onProgress(snapshot());
        await Promise.all(['investor','program'].map(async kind=>{
            const result=await historyCache.read(`${market}:${kind}`,{from,to,recent:cursor?false:dates.at(-2)||to,
                load:(start,end,onPage)=>loadSource(kind,start,end,onPage),onProgress:result=>accept(result,kind)});
            if(result.error)notices.push(result.error);
            accept(result,kind);
        }));
        if([...points.values()].some(p=>['individual','foreign','institution','program'].some(field=>p[field]==null)))notices.push('일부 일별 수급 미제공');
        if(config.program && [...points.values()].some(p=>p.program==null))notices.push('프로그램 일부 일별 자료 미제공');
        return snapshot();
    }
    function collect() {
        if (minuteProvider) return minuteProvider.collect();
        if (running) return running;
        if (!collectingAt(now())) return Promise.resolve();
        running = (async () => {
            if (!await supply.confirmMarket()) return;
            const date = compact(dayKey(now()));
            for (const [market, config] of Object.entries(markets)) {
                const clock = new Date(now() + 9 * 3600000), minute = clock.getUTCHours()*60 + clock.getUTCMinutes();
                if (config.priceMarket && minute > 946) continue;
                const state = { checked_at: now(), investor_ok: false, program_ok: false, error: '' };
                try {
                    const rows = await get('FHPTJ04030000', 'inquire-investor-time-by-market', { FID_INPUT_ISCD: config.market, FID_INPUT_ISCD_2: config.industry });
                    if (compact(dayKey(now())) !== date || !collectingAt(now())) continue;
                    // This TR is a current snapshot without a source timestamp. Store observation time only.
                    const row = rows[0]; if (!row) throw new Error('투자자 당일 자료 미제공');
                    const values = investor(row);
                    store.merge(config.code, { t: now(), ...values });
                    state.investor_ok = Object.values(values).every(v => v != null);
                    if (!state.investor_ok) state.error = '일부 투자자 수급 미제공';
                } catch (error) { state.error = error.message; }
                if (config.program) try {
                    const rows = await get('FHPPG04600101', 'comp-program-trade-today', { FID_COND_MRKT_DIV_CODE: 'UN', FID_MRKT_CLS_CODE: config.program,
                        FID_SCTN_CLS_CODE: '', FID_INPUT_ISCD: '', FID_COND_MRKT_DIV_CODE1: '', FID_INPUT_HOUR_1: '' });
                    if (compact(dayKey(now())) !== date) continue;
                    for (const row of rows) {
                        const hour = String(row.bsop_hour || '');
                        if (!/^\d{6}$/.test(hour) || hour < '080000' || hour > '200000') continue;
                        if (row.stck_bsop_date && row.stck_bsop_date !== date) continue;
                        const t = timestamp(date, hour), value = program(row);
                        if (!Number.isFinite(t) || t > now() || value == null) continue;
                        store.merge(config.code, { t, program: value, program_at: t }); state.program_ok = true;
                    }
                    if (!state.program_ok) state.error += ' · 프로그램 자료 미제공';
                } catch (error) { state.error += ` · ${error.message}`; }
                statuses.set(market, state);
            }
        })().finally(() => { running = null; }); return running;
    }
    async function query({ code = 'kospi', mode = 'day', cursor = '', progressive = '' } = {}) {
        if (!Object.hasOwn(markets, code) || !['day','minute'].includes(mode) || typeof cursor !== 'string' || cursor.length > 2048
            || (mode === 'day' && markets[code].priceMarket && !dailyProvider)) throw failure('지원하지 않는 시장 수급 조회 조건입니다.');
        if (mode === 'minute') {
            if (cursor && !/^\d{8}$/.test(cursor)) throw failure('잘못된 과거 날짜입니다.');
            if (cursor && (!Number.isFinite(timestamp(cursor)) || compact(dayKey(timestamp(cursor))) !== cursor)) throw failure('잘못된 과거 날짜입니다.');
            minuteProvider?.flush?.();
            const minuteStore = minuteProvider?.store || store;
            const config = markets[code], dates = minuteStore.dates(config.code);
            const date = cursor ? `${cursor.slice(0,4)}-${cursor.slice(4,6)}-${cursor.slice(6,8)}` : dayKey(now());
            const index = dates.indexOf(date), previous = index > 0 ? compact(dates[index-1]) : null;
            const price = { points: [], error: '', previous: null };
            if (date) try {
                let next = '';
                for (let page = 0; page < 80; page++) {
                    const result = await reference.query({ market: config.priceMarket || code, mode: 'minute', cursor: next });
                    price.points.push(...result.points.filter(p => dayKey(p.t) === date));
                    const earlier = result.points.filter(p => dayKey(p.t) < date).map(p => dayKey(p.t)).sort().at(-1);
                    if (earlier) { price.previous = compact(earlier); break; }
                    if (!result.has_more || !result.cursor || result.cursor === next) break;
                    next = result.cursor;
                    if (page === 79) price.error = '가격 과거 조회 한도 도달';
                }
            } catch (error) { price.error = error.message; }
            const points = date ? minuteStore.points(config.code, date) : [];
            const candles = price.points.filter(p => dayKey(p.t) === date);
            const byTime = new Map(candles.map(p => [p.t, { t: p.t }]));
            points.forEach(p => byTime.set(p.t, p));
            if (minuteProvider) return { success: true, points: [...byTime.values()].sort((a,b)=>a.t-b.t), candles, date,
                has_more: Boolean(previous || price.previous), cursor: [previous, price.previous].filter(Boolean).sort().at(-1) || null,
                ...minuteProvider.status(code, date), warnings: [...minuteProvider.warnings(code), ...(price.error ? [price.error] : [])] };
            return { success: true, points: [...byTime.values()].sort((a,b)=>a.t-b.t), candles, date,
                has_more: Boolean(previous || price.previous), cursor: [previous, price.previous].filter(Boolean).sort().at(-1) || null, status: statuses.get(code), partial: Boolean(statuses.get(code)?.error), warnings: [...warnings(code),
                    '당일 누적 순매수대금 · 미수집 구간 제외', ...(price.error ? [price.error] : [])] };
        }
        if (minuteProvider && !dailyProvider) throw failure('해당 증권사 일봉 수급 원천이 설정되지 않았습니다.',503);
        return cache.read(`${code}:${cursor}`,{ttl:cursor?6*3600000:60000,progressive:progressive==='1',
            load:onProgress=>dailyProvider ? dailyProvider.daily(code,cursor,onProgress) : daily(code,cursor,onProgress)});
    }
    function start() {
        if (minuteProvider) return minuteProvider.start();
        if (timer) return;
        const run = () => { try { store.archiveCompleted(); } catch(error) { log(`[Market supply] ${error.message}`); }
            void collect().catch(error => log(`[Market supply] ${error.message}`)); };
        run(); timer = setInterval(run,60000); timer.unref?.();
    }
    return { query, collect, start, stop: () => minuteProvider ? minuteProvider.stop() : clearInterval(timer), store: minuteProvider?.store || store };
}
module.exports = { createMarketSupplyService, investor, program, markets };
