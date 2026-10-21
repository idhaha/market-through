const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { dayKey, failure } = require('./supply-store');
const { collectingAt, timestamp, quantity } = require('./supply-service');

function createBreadthService({ directory, legacyFile, http, getToken, supply, now = Date.now,
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.warn }) {
    let running, timer, queue = Promise.resolve(), error = '', lastMinute;
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
        const points = saved.points.map(({ date, highs, lows }) => ({ date, highs, lows }));
        write('daily.json', { points, legacyThrough: points.map(p => p.date).sort().at(-1) || null, integratedFrom: null });
    }
    function post(api, body, next = '') {
        const task = queue.then(async () => {
            try {
                const response = await http.post(`https://api.kiwoom.com/api/dostk/${api === 'ka10016' ? 'stkinfo' : 'chart'}`, body, {
                    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json;charset=UTF-8',
                        'api-id': api, 'cont-yn': next ? 'Y' : 'N', 'next-key': next }, timeout: 10000
                });
                if (response.data?.return_code != null && Number(response.data.return_code) !== 0) throw new Error(response.data.return_msg || `${api} 조회 실패`);
                return response;
            } finally { await pause(300); }
        });
        queue = task.catch(() => {}); return task;
    }
    async function snapshot() {
        const counts = {};
        for (const [name, type] of [['highs', '1'], ['lows', '2']]) {
            const codes = new Set();
            for (const market of ['001', '101']) {
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
                        codes.add(code);
                    }
                    if (response.headers?.['cont-yn'] !== 'Y') break;
                    next = String(response.headers?.['next-key'] || '');
                    if (!next || seen.has(next)) throw new Error('신고저가 연속조회 키 오류');
                    seen.add(next);
                }
            }
            counts[name] = codes.size;
        }
        return counts;
    }
    function minuteRows(date) {
        const name = `${date}.json`;
        if (fs.existsSync(file(name))) return read(name, []);
        try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file(`${name}.gz`)))); }
        catch (cause) { if (cause.code === 'ENOENT') return []; throw cause; }
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
            migrate(); archive();
            const started = now(), today = dayKey(started), clock = new Date(started + 9 * 3600000);
            const minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
            if (collectingAt(started) && await supply.confirmMarket()) {
                const key = Math.floor(started / 60000);
                if (lastMinute === key) return;
                const values = await snapshot();
                if (dayKey(now()) !== today || !collectingAt(now())) return;
                const rows = new Map(minuteRows(today).map(p => [p.t, p]));
                rows.set(key * 60000, { t: key * 60000, ...values });
                write(`${today}.json`, [...rows.values()].sort((a, b) => a.t - b.t));
                const daily = read('daily.json');
                if (!daily.integratedFrom) { daily.integratedFrom = today; write('daily.json', daily); }
                lastMinute = key; error = ''; return;
            }
            if (minute >= 480 && minute < 1202) return;
            const target = minute < 480 ? dayKey(started - 86400000) : today;
            const daily = read('daily.json');
            if (daily.points.some(p => p.date === target) || supply.store.marketDay()?.day !== target) return;
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
            daily.points.push({ date: target, ...values }); daily.points.sort((a, b) => a.date.localeCompare(b.date));
            daily.integratedFrom ||= target;
            write('daily.json', daily); error = '';
        })().catch(cause => { error = cause.message; log('[Breadth] ' + error); }).finally(() => { running = null; });
        return running;
    }
    async function query({ mode = 'day', cursor = '' } = {}) {
        if (!['day', 'minute'].includes(mode) || typeof cursor !== 'string' || cursor.length > 2048 || mode === 'day' && cursor && !/^\d{8}$/.test(cursor)) throw failure('잘못된 신고저가 조회 조건입니다.');
        migrate();
        const key = `${mode}:${cursor}`, cached = cache.get(key);
        if (cached && cached.until > now()) return cached.promise;
        const promise = (async () => {
            const response = await post(mode === 'day' ? 'ka10081' : 'ka10080', { stk_cd: '005930_AL', upd_stkpc_tp: '0',
                ...(mode === 'day' ? { base_dt: cursor || dayKey(now()).replaceAll('-', '') } : { tic_scope: '1' }) }, mode === 'minute' && cursor ? cursor : '');
            const rows = response.data[mode === 'day' ? 'stk_dt_pole_chart_qry' : 'stk_min_pole_chart_qry'];
            if (!Array.isArray(rows)) throw new Error('신고저가 기준 봉 응답 형식 오류');
            const daily = read('daily.json'), byDay = new Map(daily.points.map(p => [p.date, p])), minutes = new Map();
            const points = new Map(), candles = [];
            for (const row of rows) {
                const raw = String(mode === 'day' ? row.dt : row.cntr_tm);
                if (!(mode === 'day' ? /^\d{8}$/ : /^\d{14}$/).test(raw)) continue;
                const t = timestamp(raw.slice(0, 8), mode === 'day' ? '000000' : raw.slice(8)), date = dayKey(t);
                if (!Number.isFinite(t) || t > now()) continue;
                if (!minutes.has(date) && mode === 'minute') minutes.set(date, new Map(minuteRows(date).map(p => [p.t, p])));
                const value = mode === 'day' ? byDay.get(date) : minutes.get(date).get(Math.floor(t / 60000) * 60000);
                const axis = mode === 'day' ? date : `${date} ${raw.slice(8, 10)}:${raw.slice(10, 12)}`;
                points.set(axis, { date: axis, highs: value?.highs ?? null, lows: value?.lows ?? null });
                const candle = { t, date: axis, open: Math.abs(quantity(row.open_pric) ?? NaN), high: Math.abs(quantity(row.high_pric) ?? NaN), low: Math.abs(quantity(row.low_pric) ?? NaN), close: Math.abs(quantity(row.cur_prc) ?? NaN) };
                if (['open', 'high', 'low', 'close'].every(k => Number.isFinite(candle[k]) && candle[k] > 0)) candles.push(candle);
            }
            const sorted = [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
            const hasMore = response.headers?.['cont-yn'] === 'Y';
            const next = mode === 'day' ? sorted.length ? dayKey(timestamp(sorted[0].date.replaceAll('-', '')) - 86400000).replaceAll('-', '') : null : response.headers?.['next-key'];
            return { mode, dates: sorted.map(p => p.date), candles: candles.sort((a, b) => a.t - b.t),
                series: Object.fromEntries(['highs', 'lows'].map(id => [id, { points: sorted.map(p => ({ date: p.date, value: p[id] == null ? null : id === 'lows' ? -p[id] : p[id] })) }])),
                cursor: hasMore ? next : null, has_more: Boolean(hasMore && next), warning: error,
                notice: `${daily.legacyThrough || '전환 전'}까지 KOSPI · ${daily.integratedFrom || '수집 시작일'}부터 KOSPI+KOSDAQ(KRX+NXT 통합)` };
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
