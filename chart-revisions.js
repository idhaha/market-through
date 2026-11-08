// Chart data revisions (2026-11-08).
// The browser keeps chart responses (rank-chart-cache.js). Past pages are reused without asking the server, so
// when the server changes stored past data (backfill, import, rewrite such as the 52-week common-stock basis)
// the browser must learn it. Each chart route maps to the data folders it reads; a folder's revision goes up
// only when its past changes:
//  - per-day files (name ends in a date): a file of a finished day is changed, added before the newest known
//    day (backfill) or removed. Today's files, and the previous day until 06:00 (night futures), are live and
//    never counted, so ordinary collection does not change the revision.
//  - single JSON files with points (daily.json, volatility): an entry dated before the live day changed.
//    Appending a new latest day does not.
// The state lives in <directory>/state.json. A new state (first start, lost file) gets a new id, so every
// browser drops its saved responses once.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');

const ROUTES = {
    '/api/risk/breadth': ['breadth/markets'],
    '/api/kis-supply/chart': ['kis-supply'],
    '/api/ls-supply/chart': ['ls-supply'],
    '/api/supply/chart': ['supply'],
    '/api/ls-stock-futures/chart': ['ls-stock-futures'],
    '/api/market-supply/chart': ['market-supply'],
    '/api/kiwoom-market-supply/chart': ['kiwoom-market-supply'],
    '/api/ls-market-supply/chart': ['ls-market-supply'],
    '/api/ls-turnover/chart': ['ls-turnover'],
    '/api/kis-turnover/chart': ['kis-turnover'],
    '/api/ls-concentration-chart': ['ls-turnover'],
    '/api/kis-concentration-chart': ['kis-concentration'],
    '/api/risk/volatility': ['volatility'],
    '/api/risk/sentiment': ['volatility']
    // /api/adr/today keeps only the latest day (no past pages); broker-only routes have no stored past.
};
// Files in those folders that are not chart data.
const IGNORED = /^(?:state|master|watchlist|market-day|validation|universe|jusikbot-backup|token)\.json$|^daily\.before|\.tmp$|\.bak$/;
const DAY_FILE = /(\d{4})-?(\d{2})-?(\d{2})\.json(?:\.gz)?$/;
const kstDay = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const sha = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

function createChartRevisions({ dataDirectory, directory, now = Date.now, routes = ROUTES, minInterval = 30000, log = () => {} }) {
    const stateFile = path.join(directory, 'state.json');
    let state, checkedAt = 0, current = null;
    function load() {
        if (state) return state;
        try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { state = null; }
        if (!state?.id || typeof state.folders !== 'object') state = { id: crypto.randomBytes(6).toString('hex'), folders: {}, fresh: true };
        return state;
    }
    function save() {
        fs.mkdirSync(directory, { recursive: true });
        const { fresh, ...value } = state, temp = `${stateFile}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, stateFile);
    }
    function walk(root, relative = '', out = []) {
        let entries; try { entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true }); } catch { return out; }
        for (const entry of entries) {
            const rel = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(root, rel, out);
            else if (entry.isFile() && !IGNORED.test(entry.name)) out.push(rel);
        }
        return out;
    }
    const entryDay = entry => {
        if (typeof entry?.date === 'string') { const m = entry.date.match(/^(\d{4})-?(\d{2})-?(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; }
        return Number.isFinite(entry?.t) ? kstDay(entry.t) : null;
    };
    const pastHash = (entries, through) => sha(JSON.stringify(entries.filter(e => { const d = entryDay(e); return d && d <= through; })));
    // Returns true when the folder's past changed since the last check.
    function scan(folder, record, liveFrom) {
        const root = path.join(dataDirectory, folder), files = walk(root), seen = new Set();
        let changed = false;
        record.days ||= {}; record.singles ||= {};
        const newest = record.newest || '';
        let latest = newest;
        for (const rel of files) {
            const full = path.join(root, rel); let stat; try { stat = fs.statSync(full); } catch { continue; }
            const match = path.basename(rel).match(DAY_FILE);
            if (match) {
                const day = `${match[1]}-${match[2]}-${match[3]}`;
                if (day >= liveFrom) continue;
                seen.add(rel);
                const sig = `${stat.size}:${Math.round(stat.mtimeMs)}`, before = record.days[rel];
                if (before !== undefined ? before !== sig : newest && day < newest) changed = true;
                record.days[rel] = sig; if (day > latest) latest = day;
                continue;
            }
            if (!rel.endsWith('.json')) continue;
            seen.add(rel);
            const sig = `${stat.size}:${Math.round(stat.mtimeMs)}`, before = record.singles[rel];
            if (before?.sig === sig) continue;
            let value; try { value = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
            const entries = Array.isArray(value) ? value : Array.isArray(value?.points) ? value.points : null;
            if (!entries) { record.singles[rel] = { sig }; continue; }
            if (before?.through && pastHash(entries, before.through) !== before.hash) changed = true;
            const through = entries.map(entryDay).filter(d => d && d < liveFrom).sort().at(-1) || '';
            record.singles[rel] = { sig, through, hash: through ? pastHash(entries, through) : '' };
        }
        for (const rel of Object.keys(record.days)) if (!seen.has(rel)) { delete record.days[rel]; changed = true; }
        for (const rel of Object.keys(record.singles)) if (!seen.has(rel)) { delete record.singles[rel]; changed = true; }
        record.newest = latest;
        return changed;
    }
    function check(force = false) {
        const time = now();
        if (!force && current && time - checkedAt < minInterval) return current;
        load(); checkedAt = time;
        // The previous day stays live until 06:00 KST (night futures end at 05:00).
        const liveFrom = kstDay(time - 6 * 3600000);
        const folders = [...new Set(Object.values(routes).flat())];
        for (const folder of folders) {
            const record = state.folders[folder] ||= { n: 0 };
            const known = Object.keys(record.days || {}).length + Object.keys(record.singles || {}).length > 0 || record.scanned;
            try {
                if (scan(folder, record, liveFrom) && known) { record.n++; log(`[ChartRevisions] ${folder} past data changed (${record.n})`); }
                record.scanned = true;
            } catch (error) { log(`[ChartRevisions] ${folder}: ${error.message}`); }
        }
        try { save(); } catch (error) { log(`[ChartRevisions] save: ${error.message}`); }
        current = Object.fromEntries(Object.entries(routes).map(([route, list]) => [route, sha(state.id + '|' + list.map(f => `${f}:${state.folders[f]?.n || 0}`).join('|'))]));
        return current;
    }
    return {
        check,
        routeOf: pathname => Object.hasOwn(routes, pathname) ? pathname : null,
        revisionOf: pathname => Object.hasOwn(routes, pathname) ? check()[pathname] : null
    };
}
module.exports = { createChartRevisions, ROUTES };
