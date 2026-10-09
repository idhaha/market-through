const crypto = require('crypto');

const MINUTE_SCOPES = [1, 3, 5, 10, 15, 30, 45, 60];
const INDEX_SCOPES = [1, 3, 5, 10, 30];
const TTL = 30 * 60 * 1000;

function integer(value) {
    const text = String(value ?? '').replace(/,/g, '').trim();
    return /^[+-]?\d+$/.test(text) ? Number(text) : NaN;
}

function barKey(row, mode, interval) {
    const time = String(mode === 'day' ? row.dt : row.cntr_tm || '');
    if (mode === 'day') return /^\d{8}$/.test(time) ? time : null;
    if (!/^\d{14}$/.test(time)) return null;
    const minutes = Number(time.slice(8, 10)) * 60 + Number(time.slice(10, 12));
    if (minutes < 540 || minutes >= 1440 || Number(time.slice(10, 12)) > 59) return null;
    // Align both sources to the same KRX session, excluding NXT bars before 09:00.
    const bucket = 540 + Math.floor((minutes - 540) / interval) * interval;
    return time.slice(0, 8) + String(Math.floor(bucket / 60)).padStart(2, '0') + String(bucket % 60).padStart(2, '0') + '00';
}

function previousClose(row, price) {
    const difference = integer(row.pred_pre);
    if (!Number.isFinite(price) || !Number.isFinite(difference)) return null;
    const sign = String(row.pred_pre_sig ?? '');
    const raw = String(row.pred_pre ?? '').trim();
    let signed;
    if (['1','2'].includes(sign)) signed = Math.abs(difference);
    else if (['4','5'].includes(sign)) signed = -Math.abs(difference);
    else if (sign === '3' || difference === 0) signed = 0;
    else if (/^[+-]/.test(raw)) signed = difference;
    else return null;
    const close = price - signed;
    return close > 0 ? close : null;
}

function aggregateBars(rows, mode, interval) {
    const groups = new Map();
    for (const row of [...rows.values()].sort((a, b) => String(a.cntr_tm || a.dt).localeCompare(String(b.cntr_tm || b.dt)))) {
        const key = barKey(row, mode, interval);
        if (!key) continue;
        const price = Math.abs(integer(row.cur_prc));
        const volume = integer(row.trde_qty);
        const previousCandle = groups.get(key);
        const open = Math.abs(integer(row.open_pric));
        const high = Math.abs(integer(row.high_pric));
        const low = Math.abs(integer(row.low_pric));
        const candle = {
            previousClose: previousClose(row, price),
            open: mode === 'day' ? open : previousCandle?.open ?? open,
            high: previousCandle && mode !== 'day' ? Math.max(previousCandle.high, high) : high,
            low: previousCandle && mode !== 'day' ? Math.min(previousCandle.low, low) : low
        };
        if (mode === 'day') {
            const turnoverMillion = integer(row.trde_prica);
            groups.set(key, { ...candle, price, volume, turnoverMillion, turnover: turnoverMillion * 1000000,
                valid: Number.isFinite(turnoverMillion) && turnoverMillion >= 0 });
            continue;
        }
        const previous = groups.get(key);
        groups.set(key, {
            ...candle, price,
            volume: (previous?.volume || 0) + volume,
            valid: Number.isFinite(price) && Number.isFinite(volume) && volume >= 0 && previous?.valid !== false
        });
    }
    return groups;
}

function calculatePoints(stockRows, marketRows, mode, interval) {
    const stocks = aggregateBars(stockRows, mode, interval);
    const markets = aggregateBars(marketRows, mode, interval);
    const ordered = [...stocks.entries()].sort(([a], [b]) => a.localeCompare(b));
    return ordered.map(([time, stock], index) => {
        const priorClose = stock.previousClose ?? (mode === 'day' && index > 0 ? ordered[index - 1][1].price : null);
        const market = markets.get(time);
        const numerator = mode === 'day' ? stock.turnover : stock.price * stock.volume;
        // User-specified minute estimate: index / 100 and volume * 10,000.
        // Daily bars continue to use the API's actual reported turnover.
        const denominator = mode === 'day' ? market?.turnover : (market?.price / 100) * (market?.volume * 10000);
        return {
            time,
            stock_turnover: stock.valid && Number.isFinite(numerator) ? numerator : null,
            market_turnover: market?.valid && Number.isFinite(denominator) ? denominator : null,
            stock_turnover_million: mode === 'day' && stock.valid ? stock.turnoverMillion : null,
            market_turnover_million: mode === 'day' && market?.valid ? market.turnoverMillion : null,
            stock_previous_close: Number.isFinite(priorClose) && priorClose > 0 ? priorClose : null,
            stock_change_rate: Number.isFinite(priorClose) && priorClose > 0 && Number.isFinite(stock.price)
                ? (stock.price / priorClose - 1) * 100 : null,
            stock_open: Number.isFinite(stock.open) ? stock.open : null,
            stock_high: Number.isFinite(stock.high) ? stock.high : null,
            stock_low: Number.isFinite(stock.low) ? stock.low : null,
            stock_price: Number.isFinite(stock.price) ? stock.price : null,
            stock_volume: Number.isFinite(stock.volume) ? stock.volume : null,
            market_price: Number.isFinite(market?.price) ? market.price : null,
            market_volume: Number.isFinite(market?.volume) ? market.volume : null,
            value: stock.valid && market?.valid && denominator > 0 && Number.isFinite(numerator / denominator)
                ? numerator / denominator * 100 : null
        };
    });
}

function recentCompletedFiveBars(rows, now) {
    const current = now.getTime();
    return [...rows.values()].filter(row => {
        const time = String(row.cntr_tm || '');
        if (!/^\d{14}$/.test(time)) return false;
        const start = Date.parse(`${time.slice(0,4)}-${time.slice(4,6)}-${time.slice(6,8)}T${time.slice(8,10)}:${time.slice(10,12)}:${time.slice(12,14)}+09:00`);
        return Number.isFinite(start) && start + 5 * 60000 <= current;
    }).sort((a,b) => String(b.cntr_tm).localeCompare(String(a.cntr_tm))).slice(0,5)
        .map(row => ({ cntr_tm: String(row.cntr_tm), cur_prc: row.cur_prc ?? null, trde_qty: row.trde_qty ?? null }));
}

function alignedFiveBarDebug(stockRows, marketRows, now) {
    const market = recentCompletedFiveBars(marketRows, now);
    return {
        fetched_at: now.toISOString(),
        stock: market.map(bar => {
            const row = stockRows.get(bar.cntr_tm);
            return { cntr_tm: bar.cntr_tm, cur_prc: row?.cur_prc ?? null, trde_qty: row?.trde_qty ?? null };
        }),
        market
    };
}

function createConcentrationChartService({ axios, getAccessToken, marketCache, now = () => new Date(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const sessions = new Map();
    let stockDirectory = null;
    let directoryPromise = null;
    async function refreshStockDirectory() {
            if (!directoryPromise) directoryPromise = (async () => {
                const token = await getAccessToken(process.env.KIWOOM_APPKEY, process.env.KIWOOM_SECRETKEY);
                const stocks = new Map();
                for (const market of ['0','10']) {
                    let nextKey = '';
                    for (let page = 0; page < 20; page++) {
                        const response = await axios.post('https://api.kiwoom.com/api/dostk/stkinfo', { mrkt_tp: market }, {
                            headers: { Authorization: `Bearer ${token}`, 'api-id': 'ka10099', 'Content-Type': 'application/json',
                                'cont-yn': nextKey ? 'Y' : 'N', 'next-key': nextKey }, timeout: 10000 });
                        if ((response.data?.return_code != null && Number(response.data.return_code) !== 0) || !Array.isArray(response.data?.list))
                            throw new Error('종목 목록 조회에 실패했습니다.');
                        for (const row of response.data.list) {
                            const code = String(row.stk_cd || row.code || '').replace(/_(AL|NX)$/i,'');
                            const actualMarket = String(row.marketCode ?? market);
                            if (/^[0-9A-Za-z]{6}$/.test(code) && (row.stk_nm || row.name) && ['0','10'].includes(actualMarket))
                                stocks.set(code, { code, name: row.stk_nm || row.name, market: actualMarket === '0' ? 'K' : 'Q' });
                        }
                        await pause(220);
                        if (String(response.headers?.['cont-yn']).toUpperCase() !== 'Y') break;
                        const next = String(response.headers?.['next-key'] || '');
                        if (!next || next === nextKey || page === 19) throw new Error('종목 목록 연속조회에 실패했습니다.');
                        nextKey = next;
                    }
                }
                if (!stocks.size) throw new Error('종목 마스터가 비어 있습니다.');
                stockDirectory = [...stocks.values()];
                for (const row of stockDirectory) marketCache[row.code] = { name: row.name, code: row.market === 'K' ? '0' : '10', type: row.market };
            })().finally(() => { directoryPromise = null; });
            await directoryPromise;
        return stockDirectory.length;
    }
    const normalizeName = value => String(value).replace(/\s/g, '').toLocaleLowerCase();
    function searchStocks(input) {
        const query = normalizeName(input || '');
        if (!query || query.length > 80) return [];
        if (!stockDirectory) throw Object.assign(new Error('종목 목록을 준비 중입니다. 잠시 후 다시 입력하세요.'), { status: 503 });
        return stockDirectory.filter(row => normalizeName(row.name).includes(query) || row.code.toLowerCase().includes(query))
            .sort((a,b) => Number(!normalizeName(a.name).startsWith(query)) - Number(!normalizeName(b.name).startsWith(query)) || a.name.localeCompare(b.name, 'ko'))
            .slice(0, 30);
    }
    async function resolveStock(input) {
        const text = String(input || '').trim();
        if (!text || text.length > 80) throw Object.assign(new Error('종목명 또는 종목코드를 입력하세요.'), { status: 400 });
        if (!stockDirectory) await refreshStockDirectory();
        const matches = stockDirectory.filter(row => row.code.toLowerCase() === text.toLowerCase() || normalizeName(row.name) === normalizeName(text));
        if (matches.length !== 1) throw Object.assign(new Error(matches.length ? '종목코드를 선택하세요.' : '종목을 찾을 수 없습니다.'), { status: 404 });
        return matches[0];
    }
    function startStockDirectorySchedule() {
        const run = () => refreshStockDirectory().then(count => console.log(`[StockMaster] ${count}종목 갱신`)).catch(error => console.warn('[StockMaster]', error.message));
        run();
        function schedule() {
            const current = now().getTime();
            const korean = new Date(current + 9 * 3600000);
            let target = Date.UTC(korean.getUTCFullYear(), korean.getUTCMonth(), korean.getUTCDate(), 8, 42) - 9 * 3600000;
            if (target <= current) target += 24 * 3600000;
            const timer = setTimeout(() => { run(); schedule(); }, target - current);
            timer.unref?.();
        }
        schedule();
    }

    function cleanSessions() {
        for (const [id, session] of sessions) if (session.expires < Date.now() && !session.busy) sessions.delete(id);
        while (sessions.size > 64) {
            const oldest = [...sessions].find(([, session]) => !session.busy);
            if (!oldest) throw new Error('차트 조회가 많습니다. 잠시 후 다시 시도해 주세요.');
            sessions.delete(oldest[0]);
        }
    }
    async function post(apiId, body, token, nextKey = '') {
        const response = await axios.post('https://api.kiwoom.com/api/dostk/chart', body, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'api-id': apiId,
                'cont-yn': nextKey ? 'Y' : 'N', 'next-key': nextKey },
            timeout: 10000
        });
        if (response.data?.return_code != null && Number(response.data.return_code) !== 0) {
            throw new Error(response.data.return_msg || `${apiId} 조회 실패`);
        }
        return response;
    }
    async function marketFor(code, token) {
        const cached = marketCache[code] || marketCache[`${code}_AL`];
        const marketCode = String(cached?.code ?? '');
        if (['0', '10'].includes(marketCode)) return marketCode === '0' ? 'K' : 'Q';
        const response = await axios.post('https://api.kiwoom.com/api/dostk/stkinfo', { stk_cd: code }, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'api-id': 'ka10100' }, timeout: 5000
        });
        const actualCode = String(response.data?.marketCode ?? response.data?.mkt_cd ?? '');
        if (!['0', '10'].includes(actualCode) || (response.data?.return_code != null && Number(response.data.return_code) !== 0)) {
            throw Object.assign(new Error('시장구분을 확인할 수 없어 쏠림율을 계산할 수 없습니다.'), { status: 422 });
        }
        const type = actualCode === '0' ? 'K' : 'Q';
        marketCache[code] = { type, code: actualCode };
        return type;
    }
    function stream(apiId, body, field) {
        return { apiId, body, field, rows: new Map(), loaded: false, nextKey: '' };
    }
    async function loadPage(target, token) {
        const response = await post(target.apiId, target.body, token, target.nextKey);
        const rows = response.data?.[target.field];
        if (!Array.isArray(rows)) throw new Error(`${target.apiId} 차트 응답에 ${target.field}가 없습니다.`);
        for (const row of rows) {
            const key = String(row.cntr_tm || row.dt || '');
            if (key) target.rows.set(key, row);
        }
        const headers = response.headers || {};
        const next = String(headers['cont-yn'] || '').toUpperCase() === 'Y' ? String(headers['next-key'] || '') : '';
        if (next && next === target.nextKey) throw new Error('연속조회 키가 반복되어 추가 조회를 중단했습니다.');
        target.loaded = true;
        target.nextKey = next;
        if (target.rows.size > 50000) throw new Error('한 차트의 조회 한도에 도달했습니다. 봉 간격을 늘려 주세요.');
        await pause(220);
    }
    function earliest(target, mode, interval) {
        const keys = [...target.rows.values()].map(row => barKey(row, mode, interval)).filter(Boolean);
        return keys.length ? keys.reduce((a, b) => a < b ? a : b) : null;
    }
    async function query(input, owner) {
        cleanSessions();
        const code = String(input.code || '').replace(/_(AL|NX)$/i, '');
        const mode = input.mode || 'minute';
        const interval = Number(input.interval ?? 1);
        if (!/^[0-9A-Za-z]{6}$/.test(code) || !['minute', 'day'].includes(mode) || !MINUTE_SCOPES.includes(interval)) {
            throw Object.assign(new Error('종목코드 또는 봉 간격이 올바르지 않습니다.'), { status: 400 });
        }
        const appKey = (process.env.KIWOOM_APPKEY || '').trim();
        const secretKey = (process.env.KIWOOM_SECRETKEY || '').trim();
        if (!appKey || !secretKey) throw new Error('키움 API 키가 설정되지 않았습니다.');
        const token = await getAccessToken(appKey, secretKey);
        if (input.debug_five === true) {
            if (mode !== 'minute' || interval !== 5) throw Object.assign(new Error('디버깅은 5분봉만 지원합니다.'), { status: 400 });
            const market = await marketFor(code, token);
            // Only the latest raw pages are needed; avoid chart history coverage and sessions.
            const stock = await post('ka10080', { stk_cd: `${code}_AL`, tic_scope: '5', upd_stkpc_tp: '0' }, token);
            await pause(220);
            const index = await post('ka20005', { inds_cd: market === 'K' ? '001' : '101', tic_scope: '5' }, token);
            const stocks = stock.data?.stk_min_pole_chart_qry;
            const markets = index.data?.inds_min_pole_qry;
            if (!Array.isArray(stocks) || !Array.isArray(markets)) throw new Error('5분봉 원본 응답 필드를 확인할 수 없습니다.');
            const fetched = now();
            return { success: true, market, debug_five_bars: alignedFiveBarDebug(
                new Map(stocks.map(row => [String(row.cntr_tm), row])),
                new Map(markets.map(row => [String(row.cntr_tm), row])), fetched) };
        }
        let session;
        let cursor = input.cursor;
        if (cursor) {
            session = sessions.get(cursor);
            if (!session || session.owner !== owner || session.code !== code || session.mode !== mode || session.interval !== interval) {
                throw Object.assign(new Error('과거 조회가 만료되었습니다. 일/분 버튼을 눌러 다시 조회해 주세요.'), { status: 410 });
            }
            if (session.busy) throw Object.assign(new Error('이 차트의 이전 조회가 진행 중입니다.'), { status: 409 });
        } else {
            const market = await marketFor(code, token);
            const baseDate = now().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '');
            const indexInterval = INDEX_SCOPES.filter(value => interval % value === 0).at(-1);
            const daily = mode === 'day';
            session = {
                owner, code, mode, interval, market, expires: Date.now() + TTL,
                stock: stream(daily ? 'ka10081' : 'ka10080', {
                    stk_cd: `${code}_AL`, upd_stkpc_tp: '0',
                    ...(daily ? { base_dt: baseDate } : { tic_scope: String(interval) })
                }, daily ? 'stk_dt_pole_chart_qry' : 'stk_min_pole_chart_qry'),
                index: stream(daily ? 'ka20006' : 'ka20005', {
                    inds_cd: market === 'K' ? '001' : '101',
                    ...(daily ? { base_dt: baseDate } : { tic_scope: String(indexInterval) })
                }, daily ? 'inds_dt_pole_qry' : 'inds_min_pole_qry')
            };
            cursor = crypto.randomUUID();
            sessions.set(cursor, session);
        }
        session.busy = true;
        // Work on copies so a failed page can be retried without losing its continuation key.
        const stock = { ...session.stock, rows: new Map(session.stock.rows) };
        const index = { ...session.index, rows: new Map(session.index.rows) };
        try {
            // Fill market history first if the previous request reached its bounded page budget.
            const previousStart = earliest(stock, mode, interval);
            const indexStart = earliest(index, mode, 1);
            const pendingMarket = previousStart && index.nextKey && (!indexStart || indexStart > previousStart);
            if (!pendingMarket && (!stock.loaded || stock.nextKey)) await loadPage(stock, token);
            const oldest = earliest(stock, mode, interval);
            let pages = 0;
            while ((!index.loaded || (oldest && index.nextKey && (!earliest(index, mode, 1) || earliest(index, mode, 1) > oldest))) && pages < 12) {
                await loadPage(index, token);
                pages++;
            }
            session.stock = stock;
            session.index = index;
            session.expires = Date.now() + TTL;
            const pending = Boolean(oldest && index.nextKey && (!earliest(index, mode, 1) || earliest(index, mode, 1) > oldest));
            return {
                success: true, market: session.market, mode, interval, cursor,
                points: calculatePoints(stock.rows, index.rows, mode, interval),
                debug_five_bars: mode === 'minute' && interval === 5 ? alignedFiveBarDebug(stock.rows, index.rows, now()) : null,
                has_more: Boolean(stock.nextKey || pending),
                history_pending: pending,
                calculation: mode === 'day' ? 'trde_prica * 1000000'
                    : 'stock: abs(int(cur_prc)) * int(trde_qty); market: (abs(int(cur_prc)) / 100) * (int(trde_qty) * 10000)',
                index_interval: mode === 'minute' ? Number(index.body.tic_scope) : null
            };
        } finally { session.busy = false; }
    }
    return { query, resolveStock, searchStocks, refreshStockDirectory, startStockDirectorySchedule };
}

module.exports = { createConcentrationChartService, calculatePoints, barKey, MINUTE_SCOPES, recentCompletedFiveBars, alignedFiveBarDebug };
