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
    '/api/supply/chart': ['supply'],
    '/api/ls-stock-futures/chart': ['ls-stock-futures'],
    '/api/market-supply/chart': ['market-supply'],
    '/api/kiwoom-market-supply/chart': ['kiwoom-market-supply', 'kiwoom-minute'],
    '/api/ls-market-supply/chart': ['ls-market-supply'],
    // 시장 선물 수급 cards: LS night/day lookups saved in ls-futures-test, daytime KIS values from market-supply.
    '/api/ls-futures-test/chart': ['ls-futures-test', 'market-supply'],
    '/api/ls-turnover/chart': ['ls-turnover'],
    // 쏠림율 · LS 비교 카드의 기준 1분봉과 종목수급 캔들은 kiwoom-minute 한 벌을 함께 읽는다(2026-11-21).
    '/api/ls-concentration-chart': ['ls-turnover', 'kiwoom-minute', 'kiwoom-daily'],
    // kiwoom-daily: 지난날 키움 일봉 저장(2026-11-22). 평소엔 지난날 파일이 추가만 되고(.json.gz라 세지 않음), 수정주가로
    // 저장본을 버릴 때만 resets.json이 바뀌어 이 경로들의 브라우저 저장분이 한 번 버려진다.
    '/api/supply/candles': ['kiwoom-minute', 'kiwoom-daily'],
    '/api/risk/volatility': ['volatility'],
    '/api/risk/sentiment': ['volatility'],
    '/api/concentration-chart': ['kiwoom-minute', 'kiwoom-daily'],
    // 지난 구간 가격 분봉 파일(2026-11-22): 지수(kiwoom-minute 001/101), 종목 선물(ls-stock-futures/candles), 지수 선물(ls-futures-test/candles).
    '/api/adr/candles': ['kiwoom-minute', 'kiwoom-daily'],
    '/api/ls-stock-futures/candles': ['ls-stock-futures'],
    '/api/ls-futures-test/candles': ['ls-futures-test']
};
// Folders that only ever gain files equal to what the broker already returned (a finished day saved on first
// view). A new file there, even older than the newest day, is not a change; a rewritten or removed file is.
// ls-turnover · ls-stock-futures · ls-futures-test: 지난날을 처음 볼 때 받아 저장한다(2026-11-22). 고쳐지거나 지워진 파일만 바뀐 것으로 본다.
const APPEND_ONLY = new Set(['kiwoom-minute', 'ls-turnover', 'ls-stock-futures', 'ls-futures-test']);
// A route's basis changes when the server starts asking the broker for different values (not stored data),
// so browsers drop that route's saved pages once.
//  - adjusted-20261121: daily stock prices are 수정주가 (upd_stkpc_tp 1) from 2026-11-21.
const BASIS = {
    '/api/supply/chart': 'adjusted-20261121',
    '/api/concentration-chart': 'adjusted-20261121|day-cursor-20261122',
    // 1분봉 커서를 서버 세션 번호에서 날짜(day:YYYYMMDD)로 바꿨다(2026-11-22). 예전 세션 번호가 든 저장 응답을 한 번 버린다.
    // 지난날 시장 09:00 1분 거래대금을 채우고 정규장 여부(regular_session)를 붙였다(2026-11-24). 저장 응답을 한 번 버린다.
    '/api/ls-concentration-chart': 'day-cursor-20261122|open-minute-20261124'
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
        const appendOnly = APPEND_ONLY.has(folder);
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
                // 같은 날 파일을 압축본으로 바꾼 것(supply-store archiveCompleted: <날>.json → <날>.json.gz)은 바뀐 것이 아니다.
                const archived = before === undefined && rel.endsWith('.gz') && record.days[rel.slice(0, -3)] !== undefined;
                if (before !== undefined ? before !== sig : !archived && !appendOnly && newest && day < newest) changed = true;
                record.days[rel] = sig; if (day > latest) latest = day;
                continue;
            }
            if (!rel.endsWith('.json')) continue;
            seen.add(rel);
            const sig = `${stat.size}:${Math.round(stat.mtimeMs)}`, before = record.singles[rel];
            if (before?.sig === sig) continue;
            // resets.json: 저장소가 지난 자료를 버리고 새로 쌓았다는 기록(kiwoom-daily-store, 수정주가). 생기거나 바뀌면 바뀐 것으로 본다.
            if (path.basename(rel) === 'resets.json') { record.singles[rel] = { sig }; changed = true; continue; }
            let value; try { value = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
            const entries = Array.isArray(value) ? value : Array.isArray(value?.points) ? value.points : null;
            if (!entries) { record.singles[rel] = { sig }; continue; }
            if (before?.through && pastHash(entries, before.through) !== before.hash) changed = true;
            const through = entries.map(entryDay).filter(d => d && d < liveFrom).sort().at(-1) || '';
            record.singles[rel] = { sig, through, hash: through ? pastHash(entries, through) : '' };
        }
        // 2026-11-22: LS 거래대금 지난날 저장이 먼저 .json으로 쓰고 1분 뒤 .json.gz로 바꾸자, 지워진 .json을 바뀐 것으로 세어
        // 측정 중 버전이 5번 올라 시장 거래대금 · 쏠림율 브라우저 저장분이 버려졌다. 압축본이 있으면 삭제로 세지 않는다.
        for (const rel of Object.keys(record.days)) if (!seen.has(rel)) { delete record.days[rel]; if (!(rel.endsWith('.json') && seen.has(`${rel}.gz`))) changed = true; }
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
        current = Object.fromEntries(Object.entries(routes).map(([route, list]) => [route, sha(state.id + '|' + list.map(f => `${f}:${state.folders[f]?.n || 0}`).join('|') + (BASIS[route] ? `|${BASIS[route]}` : ''))]));
        return current;
    }
    return {
        check,
        routeOf: pathname => Object.hasOwn(routes, pathname) ? pathname : null,
        revisionOf: pathname => Object.hasOwn(routes, pathname) ? check()[pathname] : null
    };
}
module.exports = { createChartRevisions, ROUTES, BASIS, APPEND_ONLY };
