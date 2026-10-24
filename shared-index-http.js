const INDEX_APIS = new Set(['ka20005', 'ka20006']);
// One server-wide transport for public KOSPI/KOSDAQ price pages. Other TRs pass through.
function createSharedIndexHttp({ http, now = Date.now, ttl = 60000, limit = 256 }) {
    const cache = new Map();
    const canonical = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
    return {
        ...http,
        post(url, body, options = {}) {
            const headers = options.headers || {}, api = headers['api-id'];
            if (url !== 'https://api.kiwoom.com/api/dostk/chart' || !INDEX_APIS.has(api) || !['001', '101'].includes(String(body?.inds_cd))) return http.post(url, body, options);
            const today = new Date(now() + 9 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
            const nextMidnight = (Math.floor((now() + 9 * 3600000) / 86400000) + 1) * 86400000 - 9 * 3600000;
            const normalized = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value)]));
            const next = String(headers['cont-yn']).toUpperCase() === 'Y' ? String(headers['next-key'] || '') : '';
            const key = `${today}:${api}:${canonical(normalized)}:${next}`;
            const old = cache.get(key);
            if (old && (old.pending || old.until > now())) return old.promise.then(structuredClone);
            if (old) cache.delete(key);
            for (const [key, entry] of cache) if (!entry.pending && entry.until <= now()) cache.delete(key);
            while (cache.size >= limit) {
                const victim = [...cache].find(([, entry]) => !entry.pending);
                if (!victim) break;
                cache.delete(victim[0]);
            }
            const entry = { pending: true, until: 0 };
            const promise = Promise.resolve().then(() => http.post(url, body, options)).then(response => {
                if (Number(response.data?.return_code || 0)) throw new Error(response.data.return_msg || '시장 지수 조회 실패');
                const field = api === 'ka20006' ? 'inds_dt_pole_qry' : 'inds_min_pole_qry';
                if (!Array.isArray(response.data?.[field])) throw new Error('시장 지수 응답 형식 오류');
                entry.pending = false;
                entry.until = api === 'ka20006' && /^\d{8}$/.test(normalized.base_dt || '') && normalized.base_dt < today
                    ? nextMidnight : Math.min(now() + ttl, nextMidnight);
                return { data: response.data, headers: { 'cont-yn': response.headers?.['cont-yn'], 'next-key': response.headers?.['next-key'] } };
            }).catch(error => { cache.delete(key); throw error; });
            entry.promise = promise; cache.set(key, entry);
            return promise.then(structuredClone);
        }
    };
}
module.exports = { createSharedIndexHttp };
