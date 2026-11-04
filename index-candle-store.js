'use strict';
// Shared spot-index candles (KOSPI 001 / KOSDAQ 101) from Kiwoom, kept per market and mode.
// All index consumers (candle API, chart reference pages, turnover service) read one contiguous
// series, so every card shows the same candles. Card selection and pins stay on the client.
// Futures candles use a different source and are not handled here.
const { dailyTurnover } = require('./concentration-chart');

const PAGE_LIMIT = 80;
const FRESH_MS = { minute: 20000, day: 60000 };
// Kiwoom page sizes; chart reference pages keep the same size so chart viewports do not change.
const PAGE_SIZE = { minute: 900, day: 600 };
const CODES = { kospi: '001', kosdaq: '101' };

function createIndexCandleStore({ http, getToken, now = Date.now, pause = ms => new Promise(r => setTimeout(r, ms)), log = console.warn }) {
    const series = new Map();
    const dayKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
    const stamp = (t, daily) => { const s = new Date(t + 9 * 3600000).toISOString(); return daily ? s.slice(0, 10).replaceAll('-', '') : s.slice(0, 19).replace(/[-T:]/g, ''); };
    const price = v => Math.abs(Number(String(v ?? '').replace(/,/g, ''))) / 100;
    const toTime = (raw, daily) => Date.parse(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${daily ? '09:00:00' : `${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}`}+09:00`);

    function parse(row, daily) {
        const raw = String(daily ? row.dt : row.cntr_tm || '');
        if (!(daily ? /^\d{8}$/ : /^\d{14}$/).test(raw)) return null;
        const t = toTime(raw, daily);
        const point = { t, open: price(row.open_pric), high: price(row.high_pric), low: price(row.low_pric), close: price(row.cur_prc) };
        if (daily) point.market_turnover = dailyTurnover(row).value;
        else {
            const quantity = Number(String(row.trde_qty ?? '').replace(/,/g, ''));
            point.market_turnover_estimate = Number.isFinite(quantity) && quantity >= 0 ? point.close * quantity * 10000 : null;
        }
        const valid = [point.t, point.open, point.high, point.low, point.close].every(Number.isFinite) && point.low > 0 && point.t <= now();
        return { t, day: raw.slice(0, 8), point: valid ? point : null };
    }

    function state(market, mode) {
        const id = `${market}:${mode}`;
        // points: all loaded rows. oldestT: everything newer than this is loaded without gaps.
        // nextKey: Kiwoom continuation key after oldestT. exhausted: no older data exists.
        if (!series.has(id)) series.set(id, { points: new Map(), oldestT: null, nextKey: null, exhausted: false, fetchedAt: 0, job: Promise.resolve() });
        return series.get(id);
    }
    function serialize(s, task) { const run = s.job.then(task, task); s.job = run.catch(() => {}); return run; }

    async function page(market, mode, next) {
        const daily = mode === 'day';
        const response = await http.post('https://api.kiwoom.com/api/dostk/chart', {
            inds_cd: CODES[market], ...(daily ? { base_dt: dayKey(now()) } : { tic_scope: '1' })
        }, { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getToken()}`, 'api-id': daily ? 'ka20006' : 'ka20005',
            'cont-yn': next ? 'Y' : 'N', 'next-key': next || '' }, timeout: 10000 });
        if (Number(response.data?.return_code || 0) !== 0) throw new Error('시장 지수 조회 실패');
        const rows = response.data?.[daily ? 'inds_dt_pole_qry' : 'inds_min_pole_qry'];
        if (!Array.isArray(rows)) throw new Error('시장 지수 응답 형식 오류');
        const key = response.headers?.['cont-yn'] === 'Y' ? String(response.headers['next-key'] || '') : '';
        return { rows: rows.map(row => parse(row, daily)).filter(Boolean), key };
    }

    // Newest data: page from the top until rows overlap the loaded range (or build the range on first use).
    async function refreshTop(s, market, mode) {
        const known = s.oldestT != null ? Math.max(...s.points.keys()) : null;
        let next = '', pages = 0;
        while (pages++ < PAGE_LIMIT) {
            const { rows, key } = await page(market, mode, next);
            for (const r of rows) if (r.point) s.points.set(r.t, r.point);
            const overlapped = known != null && rows.some(r => r.t <= known);
            if (known == null) {
                // First load: this page starts the contiguous range.
                const oldest = Math.min(...rows.map(r => r.t));
                s.oldestT = Number.isFinite(oldest) ? oldest : null; s.nextKey = key || null; s.exhausted = !key;
            }
            if (known == null || overlapped || !key || !rows.length) { s.fetchedAt = now(); return true; }
            if (key === next) throw new Error('시장 지수 연속조회 키 오류');
            next = key; await pause(350);
        }
        // The top never reached loaded data: drop the range so the next request rebuilds it without gaps.
        s.points.clear(); s.oldestT = null; s.nextKey = null; s.exhausted = false;
        return false;
    }

    // Older data: continue from the remembered key until `enough()` or the source ends.
    async function extend(s, market, mode, enough) {
        let pages = 0;
        while (!enough() && !s.exhausted && s.nextKey) {
            if (pages++ >= PAGE_LIMIT) return false;
            const current = s.nextKey;
            const { rows, key } = await page(market, mode, current);
            for (const r of rows) if (r.point) s.points.set(r.t, r.point);
            const oldest = Math.min(...rows.map(r => r.t));
            if (Number.isFinite(oldest) && (s.oldestT == null || oldest < s.oldestT)) s.oldestT = oldest;
            if (key === current) throw new Error('시장 지수 연속조회 키 오류');
            s.nextKey = key || null; s.exhausted = !key || !rows.length;
            if (!enough() && !s.exhausted) await pause(350);
        }
        return true;
    }

    async function prepare(s, market, mode, needsTop) {
        if (s.oldestT == null) return refreshTop(s, market, mode);
        if (needsTop && now() - s.fetchedAt >= FRESH_MS[mode]) return refreshTop(s, market, mode);
        return true;
    }

    const copy = p => ({ ...p });
    const sorted = s => [...s.points.values()].sort((a, b) => a.t - b.t);

    // Candles whose trading day is within [from, to]; the oldest day is complete (paged past it).
    async function range({ market, mode, from, to }) {
        const s = state(market, mode);
        return run(market, mode, () => serialize(s, async () => {
            let ok = await prepare(s, market, mode, s.fetchedAt === 0 || to >= dayKey(s.fetchedAt));
            if (ok) ok = await extend(s, market, mode, () => s.oldestT != null && dayKey(s.oldestT) < from);
            const points = sorted(s).filter(p => { const d = dayKey(p.t); return d >= from && d <= to; }).map(copy);
            const previous = sorted(s).filter(p => dayKey(p.t) < from).at(-1);
            return { points, partial: !ok, previousDay: previous ? dayKey(previous.t) : null };
        }));
    }

    // Kiwoom-compatible pages for chart reference: same size and cursor format (`code + timestamp`,
    // the first row of the requested page, inclusive). Empty cursor means the newest page.
    async function referencePage({ market, mode, cursor = '' }) {
        const s = state(market, mode), daily = mode === 'day', size = PAGE_SIZE[mode], code = CODES[market];
        const boundary = cursor ? toTime(cursor.slice(code.length), daily) : Infinity;
        if (cursor && (!cursor.startsWith(code) || !Number.isFinite(boundary))) throw Object.assign(new Error('잘못된 기준 캔들 조건'), { status: 400 });
        return run(market, mode, () => serialize(s, async () => {
            let ok = await prepare(s, market, mode, !cursor);
            const older = () => sorted(s).filter(p => p.t <= boundary);
            if (ok) ok = await extend(s, market, mode, () => older().length > size);
            const available = older();
            // Same point shape as the former Kiwoom pass-through (`date` is used for labels).
            const points = available.slice(-size).map(p => { const s = new Date(p.t + 9 * 3600000).toISOString(); return { t: p.t, open: p.open, high: p.high, low: p.low, close: p.close, date: daily ? s.slice(0, 10) : `${s.slice(0, 10)} ${s.slice(11, 16)}` }; });
            const nextPoint = available.length > size ? available[available.length - size - 1] : null;
            const next = nextPoint ? code + stamp(nextPoint.t, daily) : null;
            return { points, count: points.length, cursor: next, has_more: Boolean(next), partial: !ok };
        }));
    }

    async function run(market, mode, task) {
        try { return await task(); }
        catch (error) {
            log('[IndexCandleStore] 조회 실패', { market, mode, httpStatus: error.response?.status || null, code: error.code || null, message: error.message });
            throw error;
        }
    }
    return { range, referencePage };
}
module.exports = { createIndexCandleStore, FRESH_MS, PAGE_LIMIT, PAGE_SIZE };
