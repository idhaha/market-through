const fs = require('fs');
const path = require('path');
const axios = require('axios');

function createVolatilityService({ kind = 'volatility', directory = path.join(__dirname, 'data', 'volatility'), get = params => axios.get('https://jusikbot.com/api/risk-history', { params, timeout: 15000 }), getLatest = () => axios.get('https://jusikbot.com/api/risk-indicators', { timeout: 15000 }), now = Date.now } = {}) {
    const states = new Map(), pending = new Map();
    let latestRequest = null, latestCache = null;
    const breadth = kind === 'breadth';
    const validPoints = points => [...new Map((Array.isArray(points) ? points : []).filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && point.value != null && Number.isFinite(Number(point.value)) && (breadth ? ['highs', 'lows', 'valid'].every(key => point[key] != null && Number.isFinite(Number(point[key])) && Number(point[key]) >= 0) : Number(point.value) >= 0)).map(point => [point.date, { date: point.date, value: Number(point.value), ...(breadth ? { highs: Number(point.highs), lows: Number(point.lows), valid: Number(point.valid) } : {}) }])).values()].sort((a, b) => a.date.localeCompare(b.date));
    function read(id) {
        if (!states.has(id)) {
            let state = { points: [], checkedAt: null, asOf: null };
            try {
                const saved = JSON.parse(fs.readFileSync(path.join(directory, `${id}.json`), 'utf8'));
                state = { points: validPoints(saved.points), checkedAt: saved.checkedAt, asOf: saved.asOf || null };
            } catch (error) { if (error.code !== 'ENOENT') console.warn('[Volatility] Archive read failed:', error.message); }
            states.set(id, state);
        }
        return states.get(id);
    }
    function write(id, state) {
        fs.mkdirSync(directory, { recursive: true });
        const file = path.join(directory, `${id}.json`), temporary = `${file}.${process.pid}.tmp`;
        try { fs.writeFileSync(temporary, JSON.stringify(state), 'utf8'); fs.renameSync(temporary, file); }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        states.set(id, state);
        return state;
    }
    async function latest() {
        if (latestCache && now() - latestCache.at < 300000) return latestCache.data;
        if (!latestRequest) latestRequest = (async () => {
            const response = await getLatest();
            if (!Array.isArray(response.data?.indicators)) throw new Error('Latest indicator response is invalid');
            latestCache = { at: now(), data: response.data.indicators };
            return latestCache.data;
        })().finally(() => { latestRequest = null; });
        return latestRequest;
    }
    async function series(id) {
        const saved = read(id);
        if (saved.points.length && Number.isFinite(saved.checkedAt) && now() - saved.checkedAt < 300000) return saved;
        if (pending.has(id)) return pending.get(id);
        const request = (async () => {
            try {
                const lastDate = saved.points.at(-1)?.date;
                if (lastDate) {
                    // The lightweight endpoint avoids repeatedly downloading history
                    // while the source has no newer trading date.
                    const current = (await latest()).find(item => item.id === id);
                    if (/^\d{4}-\d{2}-\d{2}$/.test(current?.asOfLabel || '') && current.asOfLabel <= lastDate) return write(id, { ...saved, checkedAt: now() });
                }
                const cutoff = new Date(now()); cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
                const span = !lastDate || lastDate < cutoff.toISOString().slice(0, 10) ? '3y' : '6m';
                const response = await get({ id, span });
                if (!Array.isArray(response.data?.points)) throw new Error(`${id.toUpperCase()} response is invalid`);
                const existing = new Map(saved.points.map(point => [point.date, point]));
                // Historical rows are append-only, including dates that disappear
                // from the source's rolling three-year window.
                validPoints(response.data.points).forEach(point => { if (!existing.has(point.date)) existing.set(point.date, point); });
                const points = [...existing.values()].sort((a, b) => a.date.localeCompare(b.date));
                if (!points.length) throw new Error(`${id.toUpperCase()} has no daily data`);
                return write(id, { points, checkedAt: now(), asOf: response.data.asOf || saved.asOf });
            } catch (error) {
                if (saved.points.length) return { ...saved, warning: `${id.toUpperCase()} 갱신 실패 · 서버 저장 자료 표시 중` };
                throw error;
            }
        })().finally(() => pending.delete(id));
        pending.set(id, request);
        return request;
    }
    async function query(range = '1y') {
        if (!['6m', '1y', '3y', 'all'].includes(range)) throw Object.assign(new Error('지원하지 않는 기간입니다.'), { status: 400 });
        const ids = breadth ? ['new-highs-lows'] : kind === 'sentiment' ? ['fear-greed', 'high-yield-spread'] : ['vix', 'vkospi'];
        const results = await Promise.allSettled(ids.map(series));
        if (results.every(result => result.status === 'rejected')) throw Object.assign(new Error(breadth ? '신고가·신저가 데이터를 불러오지 못했습니다.' : kind === 'sentiment' ? 'CNN·하이일드 데이터를 불러오지 못했습니다.' : 'VIX·VKOSPI 데이터를 불러오지 못했습니다.'), { status: 502 });
        const cutoff = new Date(now());
        if (range === '6m') cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
        else cutoff.setUTCFullYear(cutoff.getUTCFullYear() - (range === '3y' ? 3 : 1));
        const from = cutoff.toISOString().slice(0, 10);
        const result = { range, series: Object.fromEntries(ids.map((id, index) => {
            const result = results[index];
            if (result.status !== 'fulfilled') return [id, { points: [], error: `${id.toUpperCase()} 조회 실패` }];
            const state = result.value;
            return [id, { points: state.points.filter(point => range === 'all' || point.date >= from), asOf: state.asOf, archiveFrom: state.points[0]?.date, warning: state.warning }];
        })) };
        if (!breadth) return result;
        const source = result.series['new-highs-lows'];
        return { range, series: {
            highs: { ...source, points: source.points.map(point => ({ date: point.date, value: point.highs })) },
            lows: { ...source, points: source.points.map(point => ({ date: point.date, value: -point.lows })) },
            net: source
        } };
    }
    return { query };
}

module.exports = { createVolatilityService };
