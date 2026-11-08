// Stored macro series for the 금리/환율 and custom chart tabs (FRED, ECOS, Trading Economics), 2026-11-08.
// Each series is kept in data/macro-series/<source>/<hash>.json and answered from disk:
//  - the first request of a series fetches its whole history once and waits for it, at most `maxWait`;
//  - later requests return the stored copy. When it is older than `fresh`, only the recent part is fetched
//    again (FRED/ECOS from `overlapDays` before the newest stored day; TE has no partial fetch, so a full
//    scrape). The request waits at most `wait` for that, otherwise it gets the stored copy and the refresh
//    finishes in the background;
//  - force (the 조회 button) refetches when the copy is older than `forceFresh` and waits up to `forceWait`;
//  - no request waits longer than `maxWait` (45 s, under the Oracle nginx proxy's 60 s read timeout, which
//    otherwise answers 504). A first fetch still running then rejects with error.pending = true (the route
//    answers 202 and the screen asks again shortly); the fetch keeps going in the background and is saved.
//  - every day in the morning (default 07:20 KST) the whole history of every series used in the last 30 days is
//    fetched again, because sources revise past values (FRED revisions, ECOS corrections). A missed run
//    (server down at dawn) runs a few minutes after the next start.
// A fetch replaces stored rows from the start of the range it covered; older stored rows are kept, so a
// partial fetch never drops history. Failed or empty fetches keep the stored rows.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

const HOUR = 3600000, DAY = 24 * HOUR, KST = 9 * HOUR;
const kstDay = t => new Date(t + KST).toISOString().slice(0, 10);
const shiftDay = (day, days) => new Date(Date.parse(day + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
const sha = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
const DEFAULT_POLICY = { fresh: HOUR, wait: 8000, forceFresh: 5 * 60000, forceWait: 60000 };

// sources: { name: { keyOf(params), fetch(params, from) -> rows, fullFrom?(params, now) -> 'YYYY-MM-DD',
//   dayOf?(row), idOf?(row), overlapDays?, widen?(stored, requested) -> params|null, policy? } }
// fetch gets from = null for a source without fullFrom (fetch everything it can).
function createMacroSeriesCache({ directory, sources, now = Date.now, log = () => {}, schedule = setTimeout,
    historyAt = { hour: 7, minute: 20 }, usedWithinDays = 30, unusedDays = 365, catchUpDelay = 3 * 60000, maxWait = 45000 }) {
    const entries = new Map(), inFlight = new Map(), stateFile = path.join(directory, 'state.json');
    let state = {}, timer = null, historyRun = null;
    const dayOf = (source, row) => (sources[source].dayOf || (r => String(r?.date ?? '').slice(0, 10)))(row);
    const idOf = (source, row) => (sources[source].idOf || (r => dayOf(source, r)))(row);
    const policyOf = source => ({ ...DEFAULT_POLICY, ...(sources[source].policy || {}) });
    const fileOf = entry => path.join(directory, entry.source, sha(entry.key) + '.json');

    function writeJson(file, value) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, file);
    }
    function save(entry) { try { writeJson(fileOf(entry), entry); } catch (error) { log(`[MacroSeries] save ${entry.key}: ${error.message}`); } }
    function load() {
        try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {}; } catch { state = {}; }
        for (const source of Object.keys(sources)) {
            let names = []; try { names = fs.readdirSync(path.join(directory, source)); } catch { continue; }
            for (const name of names.filter(n => n.endsWith('.json'))) {
                try {
                    const entry = JSON.parse(fs.readFileSync(path.join(directory, source, name), 'utf8'));
                    if (entry?.key && entry.source === source && Array.isArray(entry.rows)) entries.set(entry.key, entry);
                } catch (error) { log(`[MacroSeries] ${source}/${name} unreadable: ${error.message}`); }
            }
        }
    }
    load();

    // Replace rows from the covered start; keep older ones (and drop rows before fullFrom when trimming).
    function merge(source, oldRows, newRows, coveredFrom, keepFrom) {
        const byId = new Map();
        for (const row of oldRows) { const day = dayOf(source, row); if (day && day < coveredFrom && (!keepFrom || day >= keepFrom)) byId.set(idOf(source, row), row); }
        for (const row of newRows) { const day = dayOf(source, row); if (day && (!keepFrom || day >= keepFrom)) byId.set(idOf(source, row), row); }
        return [...byId.values()].sort((a, b) => String(idOf(source, a)).localeCompare(String(idOf(source, b))));
    }

    // mode: 'recent' (FRED/ECOS from overlap before the newest day) or 'history' (everything).
    function refresh(entry, mode) {
        const flightKey = entry.key + '|' + mode;
        if (inFlight.has(flightKey)) return inFlight.get(flightKey);
        if (mode === 'recent' && inFlight.has(entry.key + '|history')) return inFlight.get(entry.key + '|history');
        const job = (async () => {
            const spec = sources[entry.source], time = now();
            const fullFrom = spec.fullFrom ? spec.fullFrom(entry.params, time) : null;
            const newest = entry.rows.reduce((max, row) => { const d = dayOf(entry.source, row); return d > max ? d : max; }, '');
            let from = fullFrom;
            if (mode === 'recent' && fullFrom && newest) {
                const recent = shiftDay(newest, -(spec.overlapDays ?? 30));
                if (recent > from) from = recent;
            }
            const rows = (await spec.fetch(entry.params, from)).filter(row => dayOf(entry.source, row));
            if (!rows.length) throw new Error('원천이 빈 자료를 돌려줘 저장 자료를 유지합니다');
            const covered = from || rows.map(r => dayOf(entry.source, r)).sort()[0];
            entry.rows = merge(entry.source, entry.rows, rows, covered, fullFrom);
            entry.fetchedAt = time;
            if (mode === 'history') entry.historyAt = time;
            delete entry.error;
            save(entry);
            log(`[MacroSeries] ${mode} ${entry.key}: ${rows.length} fetched from ${covered}, ${entry.rows.length} stored`);
            return entry;
        })().catch(error => {
            entry.error = error.message;
            log(`[MacroSeries] ${mode} ${entry.key} failed: ${error.message}`);
            throw error;
        }).finally(() => inFlight.delete(flightKey));
        inFlight.set(flightKey, job);
        return job;
    }

    const answer = (entry, status) => ({ rows: entry.rows, status, fetchedAt: entry.fetchedAt, historyAt: entry.historyAt, ...(entry.error && status !== 'refreshed' ? { refreshError: entry.error } : {}) });

    async function get(source, params, { force = false } = {}) {
        const spec = sources[source];
        if (!spec) throw new Error('unknown source ' + source);
        const key = source + ':' + spec.keyOf(params), time = now();
        let entry = entries.get(key);
        if (!entry) { entry = { key, source, params, rows: [], fetchedAt: 0, historyAt: 0 }; entries.set(key, entry); }
        entry.lastUsedAt = time;
        const widened = entry.rows.length && spec.widen ? spec.widen(entry.params, params) : null;
        if (widened) entry.params = widened;
        if (!entry.rows.length || widened) {
            const job = refresh(entry, 'history');
            job.catch(() => {});
            let timeoutId;
            const outcome = await Promise.race([
                job.then(() => 'fetched', error => ({ error })),
                new Promise(resolve => { timeoutId = setTimeout(() => resolve('pending'), maxWait); })
            ]);
            clearTimeout(timeoutId);
            if (outcome === 'fetched') return answer(entry, 'fetched');
            if (entry.rows.length) return answer(entry, outcome === 'pending' ? 'refreshing' : 'stale');
            if (outcome === 'pending') throw Object.assign(new Error('원천에서 자료를 받는 중입니다. 잠시 후 다시 불러옵니다.'), { pending: true });
            throw outcome.error;
        }
        const policy = policyOf(source), age = time - (entry.fetchedAt || 0);
        if (age < (force ? policy.forceFresh : policy.fresh)) return answer(entry, 'cache');
        const job = refresh(entry, 'recent');
        job.catch(() => {});
        const wait = Math.min(force ? policy.forceWait : policy.wait, maxWait);
        if (wait <= 0) return answer(entry, 'refreshing');
        let timeoutId;
        const outcome = await Promise.race([
            job.then(() => 'refreshed', () => 'stale'),
            new Promise(resolve => { timeoutId = setTimeout(() => resolve('refreshing'), wait); })
        ]);
        clearTimeout(timeoutId);
        return answer(entry, outcome);
    }

    // Dawn job: refetch the whole history of every recently used series, one at a time.
    function refreshHistory() {
        if (historyRun) return historyRun;
        historyRun = (async () => {
            const time = now(), order = Object.keys(sources), summary = { refreshed: [], failed: [], removed: [] };
            for (const [key, entry] of entries) {
                if (time - (entry.lastUsedAt || entry.fetchedAt || 0) > unusedDays * DAY) {
                    entries.delete(key); summary.removed.push(key);
                    try { fs.rmSync(fileOf(entry), { force: true }); } catch {}
                }
            }
            const due = [...entries.values()]
                .filter(entry => time - (entry.lastUsedAt || 0) <= usedWithinDays * DAY)
                .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
            for (const entry of due) {
                try { await refresh(entry, 'history'); summary.refreshed.push(entry.key); }
                catch (error) { summary.failed.push(entry.key + ': ' + error.message); }
            }
            state = { ...state, historyDay: kstDay(time), historyRunAt: time, last: summary };
            try { writeJson(stateFile, state); } catch (error) { log(`[MacroSeries] state: ${error.message}`); }
            log(`[MacroSeries] history refresh: ${summary.refreshed.length} refreshed, ${summary.failed.length} failed, ${summary.removed.length} removed`);
            return summary;
        })().finally(() => { historyRun = null; });
        return historyRun;
    }

    // Milliseconds until the next dawn run (KST).
    function nextDelay(time = now()) {
        const today = kstDay(time), at = h => Date.parse(`${h}T${String(historyAt.hour).padStart(2, '0')}:${String(historyAt.minute).padStart(2, '0')}:00+09:00`);
        let next = at(today);
        if (next <= time) next = at(shiftDay(today, 1));
        return next - time;
    }
    function arm(delay) {
        timer = schedule(async () => {
            try { await refreshHistory(); } catch (error) { log(`[MacroSeries] history refresh: ${error.message}`); }
            arm(nextDelay());
        }, delay);
        timer?.unref?.();
    }
    function start() {
        const time = now(), today = kstDay(time);
        const missed = entries.size && state.historyDay !== today && time >= Date.parse(`${today}T${String(historyAt.hour).padStart(2, '0')}:${String(historyAt.minute).padStart(2, '0')}:00+09:00`);
        arm(missed ? catchUpDelay : nextDelay(time));
        return { missed: Boolean(missed) };
    }
    function stop() { if (timer) clearTimeout(timer); timer = null; }

    // One-time import of rows saved by an older cache (e.g. data/fred-cache/cache.json).
    function importEntry(source, params, rows, { fetchedAt = 0, lastUsedAt = 0 } = {}) {
        const key = source + ':' + sources[source].keyOf(params);
        if (entries.has(key) || !Array.isArray(rows) || !rows.length) return false;
        const entry = { key, source, params, rows: rows.filter(r => dayOf(source, r)), fetchedAt, historyAt: fetchedAt, lastUsedAt: lastUsedAt || fetchedAt };
        entries.set(key, entry); save(entry);
        return true;
    }

    return { get, refreshHistory, start, stop, nextDelay, importEntry, entries, state: () => state, hasSource: source => [...entries.values()].some(e => e.source === source) };
}

module.exports = { createMacroSeriesCache, kstDay, shiftDay };
