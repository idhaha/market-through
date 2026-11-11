const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { dayKey, failure } = require('./supply-store');
const { collectingAt, timestamp, quantity } = require('./supply-service');
const { isCommonStock } = require('./breadth-universe');

// ADR (2026-11-09): 20-trading-day sum of advancing ÷ declining stocks × 100, per market, from the exchange's
// official counts (common and preferred stocks, SPACs, REITs; no ETF/ETN), counted against the official base price.
//  - Past and each day's final counts: LS t1514 (KOSPI 001 · KOSDAQ 301, from 1996), saved in daily.json as
//    point[market].rise/fall/flat (rise includes limit-up, fall includes limit-down). Synced after 20:02 (and
//    before 08:00) with the last 40 days; the first run fetches the whole history.
//  - Intraday: Kiwoom ka20001 each collected minute, saved in the minute file next to highs/lows.
// Our own daily-candle count stopped matching the official one from 2026-09-14: from that day the exchange's next
// base price differs from the daily candle close, so close-vs-close flips dozens of stocks a day.
const ADR_DAYS = 20;
const LS_MARKETS = [['kospi', '001'], ['kosdaq', '301']];
const KIWOOM_MARKETS = [['kospi', '0', '001'], ['kosdaq', '1', '101']];
const hasCounts = value => Number.isFinite(value?.rise) && Number.isFinite(value?.fall);
const hasBreadth = point => ['kospi', 'kosdaq', 'all'].some(market => Number.isFinite(point?.[market]?.highs));
const ADR_MARKETS = ['kospi', 'kosdaq', 'all'];
// Fixed ADR axis per market (2026-11-10): the stored daily ADR's min/max with a 10% margin (never below 0).
// It only widens: a later value past an edge moves that edge to the value with 10% margin.
function widenScale(scale, values) {
    const finite = values.filter(Number.isFinite);
    if (!finite.length) return scale || null;
    const low = Math.min(...finite), high = Math.max(...finite);
    const next = { min: scale?.min ?? Infinity, max: scale?.max ?? -Infinity };
    if (low < next.min) next.min = Math.max(0, Math.floor(low * 0.9));
    if (high > next.max) next.max = Math.ceil(high * 1.1);
    return next.min === scale?.min && next.max === scale?.max ? scale : next;
}

function createBreadthService({ directory, legacyFile, legacyKospiDirectory, legacyCombinedDirectory, http, getToken, getLsToken, indexCandles, supply, now = Date.now,
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.warn }) {
    let running, timer, queue = Promise.resolve(), error = '', lastMinute, adrTask = null, syncError = '', liveError = '';
    const cache = new Map();
    const file = name => path.join(directory, name);
    function read(name, fallback) {
        try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
        catch (cause) { if (cause.code === 'ENOENT') return fallback; throw cause; }
    }
    function bytes(name, value) {
        fs.mkdirSync(directory, { recursive: true });
        const target = file(name), temp = `${target}.${process.pid}.tmp`;
        try { fs.writeFileSync(temp, value); fs.renameSync(temp, target); }
        finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    }
    const write = (name, value) => bytes(name, JSON.stringify(value));
    function migrate() {
        if (fs.existsSync(file('daily.json'))) return;
        let original = Buffer.from('{"points":[]}');
        try { original = fs.readFileSync(legacyFile); } catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
        const saved = JSON.parse(original);
        if (!Array.isArray(saved.points)) throw new Error('기존 신고가·신저가 자료 형식 오류');
        if (!fs.existsSync(file('jusikbot-backup.json'))) bytes('jusikbot-backup.json', original);
        const points = saved.points.map(({ date, highs, lows }) => ({ date, kospi: { highs, lows } }));
        write('daily.json', { points, legacyThrough: points.map(p => p.date).sort().at(-1) || null, integratedFrom: null });
    }
    function post(api, body, next = '') {
        const task = queue.then(async () => {
            try {
                const response = await http.post(`https://api.kiwoom.com/api/dostk/${['ka10016', 'ka10099'].includes(api) ? 'stkinfo' : api === 'ka20001' ? 'sect' : 'chart'}`, body, {
                    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json;charset=UTF-8',
                        'api-id': api, 'cont-yn': next ? 'Y' : 'N', 'next-key': next }, timeout: 10000
                });
                if (response.data?.return_code != null && Number(response.data.return_code) !== 0) throw new Error(response.data.return_msg || `${api} 조회 실패`);
                return response;
            } finally { await pause(300); }
        });
        queue = task.catch(() => {}); return task;
    }
    // Common stock codes per market from ka10099, refreshed once a day and kept in universe.json.
    // When the refresh fails the last saved list is used; with no list at all the snapshot fails (nothing saved).
    let universeMemo;
    async function universe() {
        const today = dayKey(now());
        if (universeMemo?.date === today) return universeMemo.sets;
        const saved = read('universe.json', null);
        let value = saved?.date === today ? saved : null;
        if (!value) {
            try {
                const lists = {};
                for (const [market, type] of [['kospi', '0'], ['kosdaq', '10']]) {
                    const items = []; let next = ''; const seen = new Set();
                    for (let page = 0; ; page++) {
                        if (page >= 50) throw new Error('종목 목록 연속조회 한도 초과');
                        const response = await post('ka10099', { mrkt_tp: type }, next);
                        if (!Array.isArray(response.data?.list)) throw new Error('종목 목록 응답 형식 오류');
                        items.push(...response.data.list);
                        if (response.headers?.['cont-yn'] !== 'Y') break;
                        next = String(response.headers?.['next-key'] || '');
                        if (!next || seen.has(next)) throw new Error('종목 목록 연속조회 키 오류');
                        seen.add(next);
                    }
                    lists[market] = items.filter(item => isCommonStock(item, market)).map(item => String(item.code).trim()).sort();
                    if (!lists[market].length) throw new Error('보통주 목록이 비어 있음');
                }
                value = { date: today, ...lists };
                write('universe.json', value);
            } catch (cause) {
                if (!saved?.kospi?.length || !saved?.kosdaq?.length) throw cause;
                log('[Breadth] 보통주 목록 갱신 실패, 저장된 목록 사용: ' + cause.message);
                value = saved;
            }
        }
        const sets = { kospi: new Set(value.kospi), kosdaq: new Set(value.kosdaq) };
        if (value.date === today) universeMemo = { date: today, sets };
        return sets;
    }
    async function snapshot() {
        const counts = { kospi: {}, kosdaq: {} }, common = await universe();
        for (const [name, type] of [['highs', '1'], ['lows', '2']]) {
            for (const [market, marketName] of [['001', 'kospi'], ['101', 'kosdaq']]) {
                const codes = new Set();
                let next = ''; const seen = new Set();
                for (let page = 0; ; page++) {
                    if (page >= 100) throw new Error('신고저가 연속조회 한도 초과');
                    const response = await post('ka10016', { mrkt_tp: market, ntl_tp: type, high_low_close_tp: '1',
                        stk_cnd: '0', trde_qty_tp: '00000', crd_cnd: '0', updown_incls: '1', dt: '250', stex_tp: '3' }, next);
                    const rows = response.data.ntl_pric;
                    if (!Array.isArray(rows)) throw new Error('신고저가 목록 응답 형식 오류');
                    for (const row of rows) {
                        const code = String(row.stk_cd || '').replace(/_(AL|NX)$/, '');
                        if (!/^[\dA-Za-z]{6}$/.test(code)) throw new Error('신고저가 종목코드 오류');
                        if (common[marketName].has(code)) codes.add(code);
                    }
                    if (response.headers?.['cont-yn'] !== 'Y') break;
                    next = String(response.headers?.['next-key'] || '');
                    if (!next || seen.has(next)) throw new Error('신고저가 연속조회 키 오류');
                    seen.add(next);
                }
                counts[marketName][name] = codes.size;
            }
        }
        return counts;
    }
    // Intraday advancing/declining counts (Kiwoom ka20001). A failure only leaves the minute without ADR.
    async function liveCounts() {
        const counts = {};
        for (const [market, type, code] of KIWOOM_MARKETS) {
            const data = (await post('ka20001', { mrkt_tp: type, inds_cd: code })).data || {};
            const value = id => Math.abs(quantity(data[id]));  // counts may come signed ("-100")
            const rise = value('rising') + value('upl'), fall = value('fall') + value('lst'), flat = value('stdns');
            if (![rise, fall, flat].every(Number.isFinite)) throw new Error('업종 등락 종목 수 응답 형식 오류');
            counts[market] = { rise, fall, flat };
        }
        return counts;
    }
    // Official daily counts from LS t1514, newest first, `limit` rows (0 = everything LS has).
    async function lsCounts(upcode, limit) {
        const rows = []; let cts = '';
        // LS allows about one t1514 call a second: pause before every call, retry a passing 5xx once.
        const call = async retry => {
            await pause(1100);
            try {
                return await http.post('https://openapi.ls-sec.co.kr:8080/indtp/market-data',
                    { t1514InBlock: { upcode, gubun1: '', gubun2: '1', cts_date: cts, cnt: limit ? Math.min(limit, 500) : 500, rate_gbn: '1' } },
                    { headers: { authorization: `Bearer ${await getLsToken()}`, 'Content-Type': 'application/json; charset=utf-8', tr_cd: 't1514', tr_cont: cts ? 'Y' : 'N', tr_cont_key: '' }, timeout: 15000 });
            } catch (cause) { if (retry && cause.response?.status >= 500) { await pause(2000); return call(false); } throw cause; }
        };
        for (let page = 0; page < 40; page++) {
            const response = await call(true);
            const block = response.data?.t1514OutBlock1;
            if (!Array.isArray(block)) throw new Error(`LS t1514 응답 형식 오류 ${response.data?.rsp_cd || ''} ${response.data?.rsp_msg || ''}`.trim());
            rows.push(...block);
            const next = String(response.data?.t1514OutBlock?.cts_date || '');
            if (!block.length || !next || next === cts || limit && rows.length >= limit) break;
            cts = next;
        }
        const counts = new Map();
        for (const row of rows) {
            const date = String(row.date || '');
            const rise = Number(row.high) + Number(row.up), fall = Number(row.low) + Number(row.down), flat = Number(row.unchg);
            // Some old LS days (KOSPI until 2007-11, KOSDAQ until 2004-05) carry zeros: no data, not a day without
            // movers. They are kept as gaps so no 20-day window silently spans a missing day.
            if (/^\d{8}$/.test(date) && [rise, fall, flat].every(Number.isFinite)) counts.set(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`, rise + fall > 0 ? { rise, fall, flat } : { gap: true });
        }
        return counts;
    }
    // Saves official counts into daily.json. `through` is the newest day whose counts are final.
    async function syncAdr(through) {
        const full = !read('daily.json', {}).adrThrough;
        const fetched = {};
        for (const [market, upcode] of LS_MARKETS) fetched[market] = await lsCounts(upcode, full ? 0 : 40);
        const daily = read('daily.json'), byDay = new Map(daily.points.map(p => [p.date, p]));
        let newest = daily.adrThrough || '';
        for (const [market, counts] of Object.entries(fetched)) for (const [date, value] of counts) {
            if (date > through) continue;
            let point = byDay.get(date);
            if (!point) { point = { date }; byDay.set(date, point); daily.points.push(point); }
            const { rise, fall, flat, gap, ...rest } = point[market] || {};
            point[market] = { ...rest, ...value };
            if (date > newest) newest = date;
        }
        daily.points.sort((a, b) => a.date.localeCompare(b.date));
        daily.adrThrough = newest || null;
        daily.adrFrom = daily.points.find(p => hasCounts(p.kospi) || hasCounts(p.kosdaq))?.date || null;
        daily.adrSyncedFor = through;
        storeAdr(daily);
        write('daily.json', daily); syncError = '';
    }
    // Daily ADR values written into daily.json (point.kospi.adr, point.kosdaq.adr, point.all.adr) and the axis scale.
    function storeAdr(daily) {
        daily.adrScale ||= {};
        for (const market of ADR_MARKETS) {
            const series = adrSeries(daily, market), values = [];
            for (const point of daily.points) {
                const value = series.final(point.date);
                const holder = point[market];
                if (value == null) { if (holder && 'adr' in holder) delete holder.adr; continue; }
                point[market] = { ...holder, adr: value }; values.push(value);
            }
            daily.adrScale[market] = widenScale(daily.adrScale[market], values);
        }
    }
    // Older files had counts without stored ADR: fill them once.
    function ensureAdrStored() {
        const daily = read('daily.json', null);
        if (!daily?.adrThrough || daily.adrScale) return;
        storeAdr(daily); write('daily.json', daily);
    }
    // A live minute ADR past the fixed axis widens it (saved at once).
    function widenLive(date, values) {
        const daily = read('daily.json');
        let changed = false;
        daily.adrScale ||= {};
        for (const market of ADR_MARKETS) {
            const series = adrSeries(daily, market), value = series.live(date, series.pick(values));
            const next = widenScale(daily.adrScale[market], [value]);
            if (next !== daily.adrScale[market]) { daily.adrScale[market] = next; changed = true; }
        }
        if (changed) write('daily.json', daily);
    }
    function adrDue(started) {
        if (!getLsToken || adrTask) return null;
        const daily = read('daily.json', {}), clock = new Date(started + 9 * 3600000), minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
        // Final counts after the evening close (20:02) or before 08:00 for the previous day; the very first sync runs at once.
        const through = minute >= 1202 ? dayKey(started) : dayKey(started - 86400000);
        if (daily.adrThrough && (minute >= 480 && minute < 1202 || daily.adrSyncedFor === through)) return null;
        return through;
    }
    // ADR per day from the official counts; `live` adds today's intraday counts as the last of the 20 days.
    function adrSeries(daily, market) {
        const markets = market === 'all' ? ['kospi', 'kosdaq'] : [market];
        const pick = point => markets.every(m => hasCounts(point?.[m])) ? { rise: markets.reduce((s, m) => s + point[m].rise, 0), fall: markets.reduce((s, m) => s + point[m].fall, 0) } : null;
        // Official trading days in order; a gap day (no data) breaks every 20-day window that holds it.
        const days = [], rise = [0], fall = [0], gaps = [0];
        for (const point of daily.points) {
            const value = pick(point), gap = !value && markets.some(m => point?.[m]?.gap);
            if (!value && !gap) continue;
            days.push(point.date); rise.push(rise.at(-1) + (value?.rise || 0)); fall.push(fall.at(-1) + (value?.fall || 0)); gaps.push(gaps.at(-1) + (gap ? 1 : 0));
        }
        const index = new Map(days.map((date, i) => [date, i]));
        const ratio = (r, f) => f > 0 ? Math.round(r / f * 10000) / 100 : null;
        // Window of `size` official days ending before position `end` (exclusive).
        const window = (end, size) => end < size || gaps[end] - gaps[end - size] ? null : { rise: rise[end] - rise[end - size], fall: fall[end] - fall[end - size] };
        const final = date => { const i = index.get(date); const w = i == null ? null : window(i + 1, ADR_DAYS); return w && ratio(w.rise, w.fall); };
        const live = (date, value) => {
            if (!value) return null;
            let i = days.length; while (i > 0 && days[i - 1] >= date) i--; // official days before `date`
            const w = window(i, ADR_DAYS - 1);
            return w && ratio(w.rise + value.rise, w.fall + value.fall);
        };
        return { final, live, pick };
    }
    function minuteRows(date) {
        const name = `${date}.json`;
        function loadFrom(folder) {
            if(!folder)return [];
            const filename=path.join(folder,name);
            try{return JSON.parse(fs.readFileSync(filename,'utf8'));}
            catch(error){if(error.code!=='ENOENT')throw error;}
            try{return JSON.parse(zlib.gunzipSync(fs.readFileSync(filename+'.gz')));}
            catch(error){if(error.code==='ENOENT')return [];throw error;}
        }
        // Minutes saved before the common-stock basis (minuteFrom) counted ETF·ETN too: kept on disk, not shown.
        const minuteFrom=read('daily.json',{}).minuteFrom;
        if(minuteFrom&&date<minuteFrom)return [];
        // Read older archives without moving or rewriting them. Never split a total.
        const rows=new Map();
        for(const p of loadFrom(legacyCombinedDirectory))rows.set(p.t,{t:p.t,all:{highs:p.highs,lows:p.lows}});
        for(const p of loadFrom(legacyKospiDirectory))rows.set(p.t,{...rows.get(p.t),t:p.t,kospi:{highs:p.highs,lows:p.lows}});
        for(const p of loadFrom(directory))rows.set(p.t,{...rows.get(p.t),...p});
        return [...rows.values()].sort((a,b)=>a.t-b.t);
    }
    function archive() {
        const today = dayKey(now()), clock = new Date(now() + 9 * 3600000), closed = clock.getUTCHours() * 60 + clock.getUTCMinutes() >= 1202;
        for (const name of fs.readdirSync(directory)) {
            if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name) || name.slice(0, 10) > today || name.startsWith(today) && !closed) continue;
            const original = fs.readFileSync(file(name));
            bytes(`${name}.gz`, zlib.gzipSync(original));
            if (!zlib.gunzipSync(fs.readFileSync(file(`${name}.gz`))).equals(original)) throw new Error('신고저가 압축 검증 실패');
            fs.unlinkSync(file(name));
        }
    }
    function tick() {
        if (running) return running;
        running = (async () => {
            migrate(); archive(); ensureAdrStored();
            const started = now(), today = dayKey(started), clock = new Date(started + 9 * 3600000);
            const minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
            // Official ADR counts run beside the minute collection, so a long first sync never delays it.
            const adrThrough = adrDue(started);
            if (adrThrough) adrTask = syncAdr(adrThrough).catch(cause => { syncError = 'ADR ' + cause.message; log('[Breadth] ' + syncError); }).finally(() => { adrTask = null; });
            if (collectingAt(started) && await supply.confirmMarket()) {
                const key = Math.floor(started / 60000);
                if (lastMinute === key) return;
                const values = await snapshot();
                try { for (const [market, counts] of Object.entries(await liveCounts())) values[market] = { ...values[market], ...counts }; liveError = ''; }
                catch (cause) { liveError = 'ADR 장중 ' + cause.message; log('[Breadth] ' + liveError); }
                if (dayKey(now()) !== today || !collectingAt(now())) return;
                const rows = new Map(minuteRows(today).map(p => [p.t, p]));
                rows.set(key * 60000, { t: key * 60000, ...values });
                write(`${today}.json`, [...rows.values()].sort((a, b) => a.t - b.t));
                if (getLsToken && !liveError) try { widenLive(today, values); } catch (cause) { log('[Breadth] ADR 축 갱신 실패: ' + cause.message); }
                const daily = read('daily.json');
                if (!daily.integratedFrom) { daily.integratedFrom = today; write('daily.json', daily); }
                lastMinute = key; error = ''; return;
            }
            if (minute >= 480 && minute < 1202) return;
            const target = minute < 480 ? dayKey(started - 86400000) : today;
            const daily = read('daily.json');
            // A day may already have a point holding only ADR counts: the final highs/lows are still due then.
            if (daily.points.some(p => p.date === target && hasBreadth(p)) || supply.store.marketDay()?.day !== target) return;
            // ka10016 has no historical-date parameter. Check the dated reference
            // session before and after the snapshot, especially during recovery.
            async function verify() {
                const response = await post('ka10080', { stk_cd: '005930_AL', tic_scope: '1', upd_stkpc_tp: '0' });
                const rows = response.data.stk_min_pole_chart_qry;
                if (!Array.isArray(rows)) throw new Error('최종 집계 거래일 확인 실패');
                const latest = rows.filter(r => quantity(r.trde_qty) > 0).map(r => String(r.cntr_tm || '').slice(0, 8)).sort().at(-1);
                if (latest !== target.replaceAll('-', '')) throw new Error('전일 최종 목록 확인 불가');
            }
            await verify(); const values = await snapshot(); await verify();
            const end = new Date(now() + 9 * 3600000), endMinute = end.getUTCHours() * 60 + end.getUTCMinutes();
            const endTarget = endMinute < 480 ? dayKey(now() - 86400000) : endMinute >= 1202 ? dayKey(now()) : null;
            if (endTarget !== target) return;
            // Re-read: the ADR sync may have written counts meanwhile. Highs/lows join the day's point.
            const saved = read('daily.json'), point = saved.points.find(p => p.date === target);
            if (point) for (const [market, value] of Object.entries(values)) point[market] = { ...point[market], ...value };
            else saved.points.push({ date: target, ...values });
            saved.points.sort((a, b) => a.date.localeCompare(b.date));
            saved.integratedFrom ||= target;
            write('daily.json', saved); error = '';
        })().catch(cause => { error = cause.message; log('[Breadth] ' + error); }).finally(() => { running = null; });
        return running;
    }
    async function query({ mode = 'day', cursor = '', market = 'kospi' } = {}) {
        if (!['kospi', 'kosdaq', 'all'].includes(market) || !['day', 'minute'].includes(mode) || typeof cursor !== 'string' || cursor.length > 2048 || mode === 'day' && cursor && !/^\d{8}$/.test(cursor)) throw failure('잘못된 신고저가 조회 조건입니다.');
        migrate();
        const key = `${market}:${mode}:${cursor}`, cached = cache.get(key);
        if (cached && cached.until > now()) return cached.promise;
        const promise = (async () => {
            const daily = read('daily.json'), byDay = new Map(daily.points.map(p => [p.date, p])), minutes = new Map();
            // The time axis comes from Kiwoom (Samsung 005930_AL candles). When Kiwoom fails, the stored dates
            // still draw the counts and ADR (no candles), so a Kiwoom outage does not blank the chart.
            let response, rows, referenceError = '';
            try {
                if (mode === 'day' && indexCandles) {
                    // Day axis (2026-11-11): the shared index daily page, the same series as the card's index candles
                    // and the other market cards, so no extra Kiwoom call; an index has a bar on every trading day,
                    // a single stock does not when halted. Minutes stay on Samsung 005930_AL, which covers NXT hours.
                    const index = market === 'kosdaq' ? 'kosdaq' : 'kospi';
                    const page = await indexCandles.referencePage({ market: index, mode: 'day', cursor: cursor ? (index === 'kosdaq' ? '101' : '001') + cursor : '' });
                    rows = (page.points || []).map(p => ({ dt: String(p.date).replaceAll('-', ''), open_pric: p.open, high_pric: p.high, low_pric: p.low, cur_prc: p.close }));
                    response = { headers: page.has_more ? { 'cont-yn': 'Y' } : {} };
                } else {
                    response = await post(mode === 'day' ? 'ka10081' : 'ka10080', { stk_cd: '005930_AL', upd_stkpc_tp: '0',
                        ...(mode === 'day' ? { base_dt: cursor || dayKey(now()).replaceAll('-', '') } : { tic_scope: '1' }) }, mode === 'minute' && cursor ? cursor : '');
                    rows = response.data[mode === 'day' ? 'stk_dt_pole_chart_qry' : 'stk_min_pole_chart_qry'];
                }
                if (!Array.isArray(rows)) throw new Error('신고저가 기준 봉 응답 형식 오류');
            } catch (cause) {
                if (mode === 'minute' && cursor) throw cause;
                referenceError = (mode === 'day' && indexCandles ? '지수 일봉' : '키움 기준 봉') + ' 조회 실패(' + cause.message + ') · 저장된 날짜로 표시';
                response = { headers: {} };
                if (mode === 'day') {
                    const limit = cursor ? `${cursor.slice(0, 4)}-${cursor.slice(4, 6)}-${cursor.slice(6)}` : dayKey(now());
                    const stored = daily.points.filter(p => p.date <= limit).slice(-600);
                    rows = stored.map(p => ({ dt: p.date.replaceAll('-', '') }));
                    if (stored.length && daily.points[0].date < stored[0].date) response.headers['cont-yn'] = 'Y';
                } else {
                    const latest = [dayKey(now()), ...[...daily.points].reverse().map(p => p.date)].find(date => minuteRows(date).length);
                    rows = latest ? minuteRows(latest).map(p => { const c = new Date(p.t + 9 * 3600000).toISOString(); return { cntr_tm: c.slice(0, 10).replaceAll('-', '') + c.slice(11, 19).replaceAll(':', '') }; }) : [];
                }
            }
            const points = new Map(), candles = [], adr = adrSeries(daily, market), today = dayKey(now());
            // Today on the day chart before the evening sync: the latest collected minute's counts.
            let todayLive;
            const todayAdr = () => todayLive ??= adr.live(today, adr.pick([...minuteRows(today)].reverse().find(p => adr.pick(p)) || {}));
            for (const row of rows) {
                const raw = String(mode === 'day' ? row.dt : row.cntr_tm);
                if (!(mode === 'day' ? /^\d{8}$/ : /^\d{14}$/).test(raw)) continue;
                const t = timestamp(raw.slice(0, 8), mode === 'day' ? '000000' : raw.slice(8)), date = dayKey(t);
                if (!Number.isFinite(t) || t > now()) continue;
                if (!minutes.has(date) && mode === 'minute') minutes.set(date, new Map(minuteRows(date).map(p => [p.t, p])));
                const value = mode === 'day' ? byDay.get(date) : minutes.get(date).get(Math.floor(t / 60000) * 60000);
                const axis = mode === 'day' ? date : `${date} ${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
                const selected = market === 'all' ? Object.fromEntries(['highs', 'lows'].map(id => [id,
                    Number.isFinite(value?.kospi?.[id]) && Number.isFinite(value?.kosdaq?.[id]) ? value.kospi[id] + value.kosdaq[id] : Number.isFinite(value?.all?.[id]) ? value.all[id] : null])) : value?.[market];
                const adrValue = mode === 'minute' ? adr.live(date, value && adr.pick(value))
                    : (market === 'all' ? value?.all?.adr : value?.[market]?.adr) ?? adr.final(date) ?? (date === today ? todayAdr() : null);
                points.set(axis, { date: axis, highs: selected?.highs ?? null, lows: selected?.lows ?? null, adr: adrValue ?? null });
                const candle = { t, date: axis, open: Math.abs(quantity(row.open_pric) ?? NaN), high: Math.abs(quantity(row.high_pric) ?? NaN), low: Math.abs(quantity(row.low_pric) ?? NaN), close: Math.abs(quantity(row.cur_prc) ?? NaN) };
                if (['open', 'high', 'low', 'close'].every(k => Number.isFinite(candle[k]) && candle[k] > 0)) candles.push(candle);
            }
            const sorted = [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
            const hasMore = response.headers?.['cont-yn'] === 'Y';
            const next = mode === 'day' ? sorted.length ? dayKey(timestamp(sorted[0].date.replaceAll('-', '')) - 86400000).replaceAll('-', '') : null : response.headers?.['next-key'];
            return { mode, market, dates: sorted.map(p => p.date), candles: candles.sort((a, b) => a.t - b.t),
                series: Object.fromEntries(['highs', 'lows', 'adr'].map(id => [id, { points: sorted.map(p => ({ date: p.date, value: p[id] == null ? null : id === 'lows' && p[id] !== 0 ? -p[id] : p[id] })) }])),
                cursor: hasMore ? next : null, has_more: Boolean(hasMore && next), warning: [referenceError, error, syncError, liveError].filter(Boolean).join(' · '),
                adr_scale: daily.adrScale?.[market] || null,
                notice: `${{kospi:'KOSPI',kosdaq:'KOSDAQ',all:'KOSPI+KOSDAQ'}[market]} · 신고/신저: 보통주 · KRX+NXT 통합 · ${daily.computedThrough ? `${daily.computedThrough}까지 일봉 계산, 이후 키움 집계` : `${daily.integratedFrom || '수집 시작일'}부터 키움 집계`}`
                    + ` · ADR: 거래소 공식 상승·하락 수 ${daily.adrFrom ? `${daily.adrFrom}~${daily.adrThrough} 확정(LS)` : '확정값 받는 중'}, 장중 키움` };
        })();
        cache.set(key, { until: now() + 60000, promise });
        promise.catch(() => cache.delete(key));
        if (cache.size > 30) cache.delete(cache.keys().next().value);
        return promise;
    }
    return { tick, query, snapshot, migrate, archive, minuteRows,
        start() { if (!timer) { void tick(); timer = setInterval(() => void tick(), 60000); timer.unref?.(); } },
        stop() { clearInterval(timer); timer = null; } };
}
module.exports = { createBreadthService };
