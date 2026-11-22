const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const DAY = 86400000;
function shift(date, days) {
    const t = Date.parse(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T00:00:00Z`);
    return new Date(t + days * DAY).toISOString().slice(0,10).replaceAll('-', '');
}
function mergeRanges(ranges) {
    const merged = [];
    for (const range of [...ranges].sort((a,b)=>a.from.localeCompare(b.from))) {
        const previous = merged.at(-1);
        if (previous && range.from <= shift(previous.to,1)) previous.to = previous.to > range.to ? previous.to : range.to;
        else merged.push({ ...range });
    }
    return merged;
}
function missingRanges(from, to, ranges) {
    const missing = []; let next = from;
    for (const range of mergeRanges(ranges)) {
        if (range.to < next) continue;
        if (range.from > to) break;
        if (range.from > next) missing.push({from:next,to:shift(range.from,-1)});
        if (range.to >= to) { next = shift(to,1); break; }
        next = shift(range.to,1);
    }
    if (next <= to) missing.push({from:next,to});
    return missing;
}

// Coverage includes genuine missing dates, but a failed/partial request never declares a range complete. Recent dates are mutable.
// directory(2026-11-22, 지난날 일봉 저장): 주면 끝난 날(오늘보다 3일 이상 전, 투자자 확정치가 나온 뒤)의 행과 다 받은 범위를
// <directory>/<key>.json.gz에 두고, 서버를 다시 켜도 그 범위는 증권사에 다시 묻지 않는다. 최근 이틀은 예전처럼 다시 받는다.
// 없으면 예전처럼 메모리에만 둔다.
const today = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
function createHistoryCache({ now = Date.now, ttl = 6*3600000, recentTtl = 60000, limit = 32, directory = null, log = () => {} } = {}) {
    const entries = new Map();
    const fileOf = key => path.join(directory, `${String(key).replace(/[^0-9A-Za-z_-]/g, '_')}.json.gz`);
    const finalBefore = () => shift(today(now()), -2); // 이 날짜보다 이른 날은 바뀌지 않는다
    function restore(key, entry) {
        if (!directory || entry.restored) return;
        entry.restored = true;
        try {
            const saved = JSON.parse(zlib.gunzipSync(fs.readFileSync(fileOf(key))));
            for (const row of saved.rows || []) if (/^\d{8}$/.test(String(row.dt)) && !entry.rows.has(row.dt)) entry.rows.set(row.dt, row);
            for (const range of saved.ranges || []) entry.ranges.push({ from: range.from, to: range.to, until: Infinity });
        } catch (error) { if (error.code !== 'ENOENT') log(`[일봉 저장] ${key} 읽기 실패: ${error.message}`); }
    }
    function persist(key, entry) {
        if (!directory) return;
        const cut = finalBefore();
        const rows = [...entry.rows.values()].filter(row => row.dt < cut).sort((a, b) => a.dt.localeCompare(b.dt));
        const ranges = mergeRanges(entry.ranges.filter(range => range.from < cut).map(range => ({ from: range.from, to: range.to < cut ? range.to : shift(cut, -1) })));
        if (!ranges.length) return;
        try {
            const json = JSON.stringify({ v: 1, key, rows, ranges }), packed = zlib.gzipSync(json);
            if (zlib.gunzipSync(packed).toString() !== json) return;
            fs.mkdirSync(directory, { recursive: true });
            const file = fileOf(key), temp = `${file}.${process.pid}.tmp`;
            fs.writeFileSync(temp, packed); fs.renameSync(temp, file);
        } catch (error) { log(`[일봉 저장] ${key} 저장 실패: ${error.message}`); }
    }
    function entryFor(key) {
        let entry = entries.get(key);
        if (!entry) entry = {rows:new Map(),ranges:[],recent:new Map(),queue:Promise.resolve()};
        entries.delete(key); entries.set(key,entry);
        while (entries.size > limit) entries.delete(entries.keys().next().value);
        return entry;
    }
    function read(key, { from, to, recent = false, load, onProgress = () => {} }) {
        const entry = entryFor(key);
        const task = entry.queue.then(async()=>{
            if (entry.lastUsed && now()-entry.lastUsed >= ttl) { entry.rows.clear();entry.ranges=[];entry.recent.clear();entry.restored=false; }
            restore(key, entry);
            entry.lastUsed=now();
            entry.ranges=entry.ranges.filter(range=>range.until>now());
            const ranges=missingRanges(from,to,entry.ranges);
            const recentFrom=typeof recent==='string'?recent:to, recentKey=`${recentFrom}:${to}`;
            if (recent && (entry.recent.get(recentKey) || 0) + recentTtl <= now()) ranges.push({from:recentFrom,to});
            const warnings=[];let partial=false;
            const snapshot=()=>({rows:[...entry.rows.values()].filter(row=>row.dt>=from&&row.dt<=to).sort((a,b)=>a.dt.localeCompare(b.dt)),partial,error:warnings.join(' · ')});
            function merge(rows) {
                for (const row of rows || []) {
                    if (!/^\d{8}$/.test(String(row.dt)) || row.dt<from || row.dt>to) continue;
                    const old=entry.rows.get(row.dt), next={...old,...row};
                    for (const field of Object.keys(old || {})) if ((row[field]==null || row[field]==='') && old[field]!=null) next[field]=old[field];
                    entry.rows.set(row.dt,next);
                }
                onProgress(snapshot());
            }
            if (entry.rows.size) onProgress(snapshot());
            let loaded=false;
            for (const range of mergeRanges(ranges)) {
                try {
                    const result=await load(range.from,range.to,merge);
                    merge(result.rows);
                    if (result.partial) partial=true;
                    if (result.error) warnings.push(result.error);
                    if (!result.partial && !result.error) {
                        entry.ranges.push({...range,until:now()+ttl});loaded=true;
                        if (range.from<=recentFrom && range.to>=to) entry.recent.set(recentKey,now());
                    }
                } catch(error) { partial=true;warnings.push(error.message); }
            }
            if (loaded) persist(key, entry);
            return snapshot();
        });
        entry.queue=task.catch(()=>{});return task;
    }
    return {read};
}

// A normal caller waits for completion; an interactive caller receives the first
// available snapshot and polls the same in-flight job without duplicating TRs.
function createDailyQueryCache({ now = Date.now, limit = 24 } = {}) {
    const entries=new Map();
    async function read(key,{ttl=60000,progressive=false,load}) {
        let entry=entries.get(key);
        if (!entry) { entry={value:null,until:0,pending:false};entries.set(key,entry); }
        entries.delete(key);entries.set(key,entry);
        if (!entry.pending && entry.until<=now()) {
            entry.pending=true;
            entry.ready=new Promise(resolve=>{entry.resolveReady=resolve;});
            function publish(value) { entry.value=value;entry.resolveReady(); }
            entry.promise=Promise.resolve().then(()=>load(publish,entry.value)).then(value=>{
                entry.value=value;entry.until=now()+(value.warnings?.some(w=>/실패|오류|한도|미제공/.test(w))?5000:ttl);return value;
            }).catch(error=>{
                if (!entry.value) { entry.error=error;entries.delete(key);throw error; }
                entry.value={...entry.value,warnings:[...(entry.value.warnings || []),`${error.message} · 이전 데이터 표시`]};
                entry.until=now()+5000;return entry.value;
            }).finally(()=>{entry.pending=false;entry.resolveReady();});
            // Interactive callers may only await ready, not the completion promise.
            entry.promise.catch(()=>{});
        }
        for (const [oldKey,old] of entries) if (entries.size>limit && !old.pending && oldKey!==key) entries.delete(oldKey);
        if (!progressive) return entry.pending ? entry.promise : entry.value;
        if (!entry.value) await entry.ready;
        if (entry.error && !entry.value) throw entry.error;
        return {...entry.value,pending:entry.pending};
    }
    return {read,clear:()=>entries.clear()};
}
module.exports={createHistoryCache,createDailyQueryCache,missingRanges};
