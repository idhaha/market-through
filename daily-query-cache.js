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

// History is kept in memory only. Coverage includes genuine missing dates, but a
// failed/partial request never declares a range complete. Recent dates are mutable.
function createHistoryCache({ now = Date.now, ttl = 6*3600000, recentTtl = 60000, limit = 32 } = {}) {
    const entries = new Map();
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
            if (entry.lastUsed && now()-entry.lastUsed >= ttl) { entry.rows.clear();entry.ranges=[];entry.recent.clear(); }
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
            for (const range of mergeRanges(ranges)) {
                try {
                    const result=await load(range.from,range.to,merge);
                    merge(result.rows);
                    if (result.partial) partial=true;
                    if (result.error) warnings.push(result.error);
                    if (!result.partial && !result.error) {
                        entry.ranges.push({...range,until:now()+ttl});
                        if (range.from<=recentFrom && range.to>=to) entry.recent.set(recentKey,now());
                    }
                } catch(error) { partial=true;warnings.push(error.message); }
            }
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
