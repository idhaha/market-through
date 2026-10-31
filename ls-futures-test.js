const fs = require('fs');
const path = require('path');
const { timestamp, quantity } = require('./supply-service');
const { dayKey, failure } = require('./supply-store');
const assets = { futures: { asset: 'K2I', night: 'NFU', day: '', name: 'KOSPI200' }, futuresKosdaq: { asset: 'KQI', night: 'NQF', day: 'Q', name: 'KOSDAQ150' } };
const compact = t => dayKey(t).replaceAll('-', '');
const previous = d => compact(timestamp(d) - 86400000);
function validDate(d) { return /^\d{8}$/.test(d) && Number.isFinite(timestamp(d)) && compact(timestamp(d)) === d; }
function money(v) { const n = quantity(v); return n !== null && Number.isSafeInteger(n * 100) ? n * 100 : null; }
function candle(row, t) {
    const values = [row.open, row.high, row.low, row.close ?? row.price].map(v => v === '' || v == null ? NaN : Number(v));
    const [open, high, low, close] = values;
    return Number.isFinite(t) && values.every(v => Number.isFinite(v) && v > 0) && high >= Math.max(open, close) && low <= Math.min(open, close)
        ? { t, open, high, low, close } : null;
}
function investorTime(row) {
    const date = String(row.date || ''), time = String(row.time || '');
    if (!validDate(date) || !/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(time)) return NaN;
    return timestamp(date, time);
}
// t8461 has a clock but no date. Only a dated investor response from the same
// night session can anchor it; never stamp old prices with the wall-clock date.
function nightPriceTime(time, anchor) {
    if (!Number.isFinite(anchor) || !/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(String(time))) return NaN;
    const clock = Number(time), anchorClock = Number(new Date(anchor + 9 * 3600000).toISOString().slice(11, 19).replaceAll(':', ''));
    if (clock > 60100 && clock < 180000) return NaN;
    const date = compact(anchor - (clock > anchorClock ? 86400000 : 0));
    return timestamp(date, time);
}
function createLsFuturesTest({ http, getToken, directory, daytimeStore, dailyProvider, now = Date.now, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
    const queues = new Map(), combinedJobs = new Map(), previousInvestor = new Map(), restSnapshots=new Map();
    const cache = new Map(), pending = new Map(), masters = new Map(), listeners = new Map();
    const dailyBaselines = new Map();
    function dailyBaseline(code, cursor) {
        const key = `${code}:${cursor || ''}`, old = dailyBaselines.get(key);
        if (old && now() - old.at < 30000) return old.promise;
        const entry = {at:now(),promise:dailyProvider.daily(code,cursor)};
        dailyBaselines.set(key,entry);
        entry.promise.catch(()=>{if(dailyBaselines.get(key)===entry)dailyBaselines.delete(key);});
        if(dailyBaselines.size>32)dailyBaselines.delete(dailyBaselines.keys().next().value);
        return entry.promise;
    }
    async function rest(tr, endpoint, params, continuation) {
        const policy=require('./trading-session').current(),key=tr+':'+JSON.stringify([params,continuation]);
        if(policy){
            const clock=new Date(now()+9*3600000).toISOString().slice(11,16);
            const night=['t8455','t8459','t8461'].includes(tr) || params.tm_rng==='N';
            const open=night?policy.nightAt(now()):policy.openDate(dayKey(now()))===true && clock>='08:45'&&clock<'15:45';
            if(!open && restSnapshots.has(key))return structuredClone(restSnapshots.get(key));
        }
        const task = (queues.get(tr) || Promise.resolve()).then(async () => {
            try {
                const response = await http.post(`https://openapi.ls-sec.co.kr:8080/futureoption/${endpoint}`, { [tr + 'InBlock']: params }, {
                    headers: { authorization: 'Bearer ' + await getToken(), 'Content-Type': 'application/json; charset=UTF-8', tr_cd: tr, tr_cont: continuation?'Y':'N', tr_cont_key: continuation?.key || '' }, timeout: 10000
                });
                if (String(response.data?.rsp_cd) !== '00000') throw Error();
                if(response.headers)response.data._continuation={more:response.headers.tr_cont==='Y',key:response.headers.tr_cont_key || ''};
                if(restSnapshots.size>=128)restSnapshots.delete(restSnapshots.keys().next().value);
                restSnapshots.set(key,structuredClone(response.data));
                return response.data;
            } catch { throw failure(`LS ${tr} 조회 실패`, 502); }
        });
        // Limit each TR independently. Return its result immediately; the next
        // request for this TR waits through the cooldown, not the renderer.
        queues.set(tr, task.catch(() => {}).then(() => pause(1100)));
        return task;
    }
    const nightCollector=daytimeStore?.mergeMany ? require('./ls-night-supply').createLsNightSupply({store:daytimeStore,rest,now,log:message=>console.warn(message),onUpdate:()=>{
        cache.clear();for(const entry of combinedJobs.values())if(!entry.running)entry.at=-Infinity;
    }}) : null;
    async function master(code, session) {
        const key = `${code}:${session}`, old = masters.get(key);
        if (old && old.day === compact(now())) return old.row;
        const cfg = assets[code], tr = session === 'N' ? 't8455' : 't8467';
        const d = await rest(tr, 'market-data', { gubun: session === 'N' ? cfg.night : cfg.day });
        const rows = d[tr + 'OutBlock'];
        if (!Array.isArray(rows)) throw failure(`LS ${tr} 마스터 응답 오류`, 502);
        const row = rows.filter(r => /^[A-Z0-9]{8}$/.test(r.shcode) && !/SP|스프레드/.test(r.hname || '') && /\d{4}/.test(r.hname || ''))
            .sort((a, b) => Number(a.hname.match(/\d{4}/)[0]) - Number(b.hname.match(/\d{4}/)[0]))[0];
        if (!row) throw failure('LS 선물 최근월물 없음', 502);
        masters.set(key, { day: compact(now()), row });
        return row;
    }
    function readHistory(code, session) {
        if (!directory) return [];
        try { const rows = JSON.parse(fs.readFileSync(path.join(directory, `${code}-${session}.json`), 'utf8')); return Array.isArray(rows) ? rows : []; }
        catch (e) { if (e.code === 'ENOENT') return []; throw failure('테스트 수급 저장 자료 읽기 실패', 500); }
    }
    function saveHistory(code, session, rows) {
        if (!directory) return;
        fs.mkdirSync(directory, { recursive: true });
        const file = path.join(directory, `${code}-${session}.json`), temp = file + '.tmp';
        fs.writeFileSync(temp, JSON.stringify(rows)); fs.renameSync(temp, file);
    }
    async function load({ code, mode, session, cursor,pricesOnly,flowOnly }, onProgress = () => {}) {
        const cfg = assets[code], warnings = ['선물 프로그램 수급 미제공', '수급 금액 배율: 기존 LS 일봉과 동일(원본 ×100 백만원), HTS 대조 필요'];
        const tr = mode === 'day' ? 't8462' : 't8463';
        const end = cursor || compact(now());
        let stored = mode==='minute' && !(session==='N'&&nightCollector) ? readHistory(code,session) : [];
        let sharedOlder=null;
        if(mode==='minute' && session==='N' && nightCollector){
            const storeCode=assets[code].asset==='K2I'?'FUTURE':'FUTKQ0';
            const endDate=cursor?compact(timestamp(cursor)+86400000):compact(now());
            const dates=daytimeStore.dates(storeCode).filter(date=>date.replaceAll('-','')<=endDate).sort();
            const window=dates.slice(-3);sharedOlder=dates.filter(d=>d<window[0]).at(-1)?.replaceAll('-','') || null;
            stored=window.flatMap(date=>daytimeStore.points(storeCode,date)).filter(p=>p.source==='LS'&&p.session==='N')
                .map(p=>({...p,observed_at:Math.max(...['individual','foreign','institution'].map(f=>p[f+'_at']||p.t))}));
        }
        const sessionKey = t => session === 'N' ? compact(t - (new Date(t + 9 * 3600000).getUTCHours() < 18 ? 86400000 : 0)) : compact(t);
        let dayFallback=[],dayFallbackDate='',dayFallbackCursor=null;
        if(mode==='minute' && session==='D' && daytimeStore){
            const storeCode=code==='futures'?'FUTURE':'FUTKQ0';
            const dates=daytimeStore.dates(storeCode).filter(date=>date.replaceAll('-','')<=end).sort();
            for(const date of dates.slice().reverse()){
                dayFallback=daytimeStore.points(storeCode,date).filter(p=>{
                    const time=new Date(p.t+9*3600000).toISOString().slice(11,16);
                    return p.t<Math.floor(now()/60000)*60000 && time>='08:00' && time<='15:46' && ['individual','foreign','institution'].some(f=>Number.isFinite(p[f]));
                }).map(p=>({t:p.t,source:'KIS',...Object.fromEntries(['individual','foreign','institution'].filter(f=>Number.isFinite(p[f])).map(f=>[f,p[f]]))}));
                if(dayFallback.length){dayFallbackDate=date.replaceAll('-','');dayFallbackCursor=dates.filter(d=>d<date).at(-1)?.replaceAll('-','') || null;break;}
            }
            if(dayFallback.length)onProgress({success:true,source:'KIS',session,points:dayFallback,candles:[],warnings:['주간 수급: 기존 시장수급 카드의 한투 저장값 보완 · 야간 수급: LS'],partial:false,
                has_more:true,cursor:dayFallbackCursor || previous(dayFallbackDate),date:dayKey(dayFallback.at(-1).t)});
        }
        let d, flowFailed = false, dailyBase = null;
        try {
            if(mode==='day' && !pricesOnly && dailyProvider){
                dailyBase = await dailyBaseline(code,cursor);
                if(session==='D')d={t8462OutBlock1:[]};
                else {
                    const from = dailyBase.points.length ? compact(Math.min(...dailyBase.points.map(p=>p.t))) : end;
                    const rows = new Map(); let last=end;
                    for(let page=0;page<80 && last>=from;page++){
                        const result=await rest(tr,'investor',{tm_rng:session,fot_clsf_cd:'F',bsc_asts_id:cfg.asset,gubun2:'1',gubun3:'1',from_date:from,to_date:last});
                        if(!Array.isArray(result.t8462OutBlock1))throw failure('LS t8462 수급 응답 오류',502);
                        const valid=result.t8462OutBlock1.filter(r=>validDate(String(r.date)) && r.date>=from && r.date<=last);
                        for(const row of valid)rows.set(row.date,row);
                        const oldest=valid.map(r=>r.date).sort()[0];
                        if(!oldest || oldest<=from)break;
                        last=previous(oldest);
                        if(page===79){flowFailed=true;warnings.push('야간 일봉 수급 과거 조회 한도 도달');}
                    }
                    d={t8462OutBlock1:[...rows.values()]};
                }
            }
            else if(pricesOnly || mode==='minute' && daytimeStore && (session==='D'||nightCollector))d={[tr+'OutBlock1']:[]};
            else if(mode==='minute' && cursor){
                // The API supports a previous-session flag, not arbitrary dates.
                // Reuse stored sessions first and fetch that one prior snapshot
                // only once per short cache window, even for multiple cursors.
                if(stored.some(r=>sessionKey(r.t)<=cursor)) d={[tr+'OutBlock1']:[]};
                else {
                    const key=`${code}:${session}:${compact(now())}`,old=previousInvestor.get(key);
                    if(!old || now()-old.at>=600000){
                        const promise=rest(tr,'investor',{tm_rng:session,fot_clsf_cd:'F',bsc_asts_id:cfg.asset,cnt:999,bgubun:'1'});
                        previousInvestor.set(key,{at:now(),promise});promise.catch(()=>previousInvestor.delete(key));
                        if(previousInvestor.size>16)previousInvestor.delete(previousInvestor.keys().next().value);
                    }
                    d=await previousInvestor.get(key).promise;
                }
            } else d = await rest(tr, 'investor', mode === 'day'
            ? { tm_rng: session, fot_clsf_cd: 'F', bsc_asts_id: cfg.asset, gubun2: '1', gubun3: '1', from_date: compact(timestamp(end) - 180 * 86400000), to_date: end }
            : { tm_rng: session, fot_clsf_cd: 'F', bsc_asts_id: cfg.asset, cnt: session === 'D' ? 500 : 999, bgubun: '0' }); }
        catch (error) { flowFailed = true; warnings.push(error.message); d = { [tr + 'OutBlock1']: [] }; }
        const incoming = d[tr + 'OutBlock1'];
        if (!Array.isArray(incoming)) throw failure(`LS ${tr} 수급 응답 오류`, 502);
        let points, anchor, minuteCursor = null;
        if (mode === 'day') {
            points = dailyBase && session==='D' ? dailyBase.points.map(p=>({t:p.t,...Object.fromEntries(['individual','foreign','institution'].filter(f=>Number.isFinite(p[f])).map(f=>[f,p[f]]))}))
                : incoming.filter(r => validDate(String(r.date)) && r.date <= end).map(r => ({ t: timestamp(r.date), individual: money(r.sa_08), foreign: money(r.sa_17), institution: money(r.sa_18) }));
            if(dailyBase && session==='D'){warnings.push(...(dailyBase.warnings || []).filter(w=>!w.startsWith('캔들:')));flowFailed ||= !!dailyBase.partial;}
        } else {
            const byMinute = new Map();
            for (const r of incoming.slice().sort((a, b) => investorTime(a) - investorTime(b))) {
                const at = investorTime(r); if (!Number.isFinite(at) || at > now() || at < now() - 10 * 86400000) continue;
                const hhmm = Number(r.time.slice(0, 4));
                if (session === 'N' ? hhmm > 601 && hhmm < 1800 : hhmm < 800 || hhmm > 1546) continue;
                anchor = Math.max(anchor || 0, at);
                // Keep only completed minutes, with the last 30-second observation.
                const t = Math.floor(at / 60000) * 60000; if (t >= Math.floor(now() / 60000) * 60000) continue;
                byMinute.set(t, { t, observed_at: at, individual: money(r.indmsamt), foreign: money(r.formsamt), institution: money(r.sysmsamt) });
            }
            const history = new Map(stored.map(r => [r.t, r]));
            for (const [t, row] of byMinute) if (!history.has(t) || (history.get(t).observed_at || 0) <= row.observed_at) history.set(t, row);
            const retained = [...history.values()].filter(r => (session==='N'&&nightCollector || r.t >= now() - 35 * 86400000) && r.t <= now()).sort((a, b) => a.t - b.t);
            if(!(session==='N' && nightCollector))saveHistory(code, session, retained);
            // Day/private history selects a session; shared night storage below keeps its whole window.
            const keys=[...new Set([...retained.map(r=>sessionKey(r.t)),...(dayFallback.length?[dayFallbackDate]:[])])].sort();
            const selectedSession = cursor ? keys.filter(k=>k<=cursor).at(-1) : keys.at(-1);
            // The shared chart can already show an older day session. Include
            // every saved night in this calendar window, not just the latest
            // session, or an interior night disappears despite covered edges.
            points = session==='N' && nightCollector
                ? retained.filter(r=>!cursor || sessionKey(r.t)<=cursor)
                : retained.filter(r => sessionKey(r.t) === selectedSession);
            if(session==='N'&&nightCollector && points.length)anchor=Math.max(...points.map(p=>p.observed_at || p.t));
            if(dayFallback.length && dayFallbackDate===selectedSession){
                const merged=new Map(dayFallback.map(p=>[p.t,p]));
                for(const p of points)merged.set(p.t,{...merged.get(p.t),...p,source:'LS'});
                points=[...merged.values()].sort((a,b)=>a.t-b.t);
                warnings.push('주간 수급: LS 결측 분은 기존 시장수급 카드의 한투 저장값으로 보완');
            }
            const older=keys.filter(k=>k<selectedSession).at(-1);
            minuteCursor=[older,dayFallbackCursor,sharedOlder,...(!cursor && !(session==='N'&&nightCollector)?[previous(selectedSession || end)]:[])].filter(Boolean).sort().at(-1) || null;
            if(session==='N' && nightCollector)minuteCursor=sharedOlder;
            warnings.push('분봉 수급: 최근·전일 세션 및 저장 이력 · 임의 과거 날짜 API 조회 미지원');
        }
        points.sort((a, b) => a.t - b.t);
        // Investor history must never advance past a gap just because its
        // independent price page includes older trading dates.
        const flowCursor = mode==='day' ? dailyBase ? dailyBase.cursor : points.length ? previous(compact(points[0].t)) : null : minuteCursor;
        const flowHasMore = mode==='day' ? dailyBase ? dailyBase.has_more===true : incoming.length>0 : !!minuteCursor;
        if (!points.length) warnings.push('선택 세션의 수급 자료 없음');
        onProgress({success:true,source:'LS',session,points:[...points],candles:[],warnings:[...warnings],partial:flowFailed,
            has_more:flowHasMore,cursor:flowCursor,
            date:points.length?dayKey(points.at(-1).t):dayKey(now())});
        if(flowOnly)return {success:true,source:'LS',session,points,candles:[],warnings,partial:flowFailed,
            has_more:flowHasMore,cursor:flowCursor,date:points.length?dayKey(points.at(-1).t):dayKey(now())};
        let candles = [], contract = null, partial = flowFailed, priceCursor = null;
        try {
            if(mode==='minute' && cursor && session==='N')throw failure('과거 야간 가격은 날짜를 지정할 수 없어 저장 자료만 표시합니다',502);
            contract = await master(code, session);
            let priceTr, params;
            if (mode === 'day') {
                priceTr = session === 'N' ? 't8459' : 't8466';
                params = session === 'N' ? { shcode: contract.shcode, futcheck: '', date: cursor || '', cts_code: '', lastdate: '', cnt: 180 }
                    : { shcode: contract.shcode, gubun: '2', qrycnt: 180, sdate: '', edate: end, cts_date: '', comp_yn: 'N' };
            } else {
                priceTr = session === 'N' ? 't8461' : 't8465';
                params = session === 'N' ? { focode: contract.shcode, cgubun: 'B', bgubun: 1, cnt: 999 }
                    : { shcode: contract.shcode, ncnt: 1, qrycnt: 500, nday: '0', sdate: '', stime: '', edate: cursor || compact(anchor || now()), etime: '', cts_date: '', cts_time: '', comp_yn: 'N' };
            }
            if (mode === 'minute' && session === 'N' && !Number.isFinite(anchor)) throw failure('야간 가격 날짜를 확인할 수급 시각 없음', 502);
            const prices = await rest(priceTr, mode === 'day' && session === 'N' ? 'market-data' : 'chart', params);
            const rows = prices[priceTr + 'OutBlock1']; if (!Array.isArray(rows)) throw failure('LS 선물 가격 응답 오류', 502);
            candles = rows.map(r => candle(r, mode === 'day' ? validDate(String(r.date)) ? timestamp(r.date) : NaN
                : session === 'N' ? nightPriceTime(String(r.chetime || ''), anchor) : investorTime(r))).filter(Boolean)
                .filter(r => r.t <= now() && (mode !== 'day' || compact(r.t) <= end));
            if (mode === 'minute') candles = candles.filter(r => r.t < Math.floor(now() / 60000) * 60000 && (!points.length && session === 'D' || points.length && r.t >= points[0].t && r.t <= points.at(-1).t));
            if (!candles.length) { partial = true; warnings.push('선택 세션의 선물 가격 없음'); }
            if (mode === 'day' && candles.length) priceCursor = previous(compact(Math.min(...candles.map(r => r.t))));
            warnings.push(`가격: LS ${priceTr} · ${cfg.name} ${contract.hname} (${contract.shcode}) · 현재 최근월물, 연속선물 아님`);
        } catch (e) { partial = true; warnings.push(e.status ? e.message : 'LS 선물 가격 조회 실패'); }
        const timeline = new Map(candles.map(r => [r.t, { t: r.t }]));
        for (const row of points) timeline.set(row.t, row);
        points = [...timeline.values()].sort((a, b) => a.t - b.t);
        const cursorOut = flowCursor;
        return { success: true, source: 'LS', session, contract: contract && { code: contract.shcode, name: contract.hname }, points, candles: candles.sort((a,b) => a.t-b.t), warnings, partial,
            has_more: flowHasMore, cursor: cursorOut, price_cursor: priceCursor,
            date: points.length ? dayKey(points.at(-1).t) : dayKey(now()) };
    }
    function mergeCombined(input, parts, failed = []) {
        parts.sort((a,b)=>a.session.localeCompare(b.session));
        const warnings = [...new Set(parts.flatMap(p => p.warnings))];
        for (const session of failed) warnings.push(`LS ${session==='N' ? '야간' : '주간'} 자료 조회 실패`);
        const pointMap = new Map(), candleMap = new Map();
        const daily = (input.mode || 'day') === 'day';
        for (const part of parts) {
            // Each source remains a separate cumulative series at its session
            // boundary. Do not add an invented offset to the next session.
            for (const p of part.points) {
                const old = pointMap.get(p.t);
                if (!daily) { pointMap.set(p.t, { ...old, ...p, session:part.session }); continue; }
                const row = { ...old, t:p.t };
                for (const field of ['individual','foreign','institution']) {
                    if (Number.isFinite(p[field])) row[field] = (row[field] || 0) + p[field];
                }
                pointMap.set(p.t, row);
            }
            let prices = part.candles;
            for (const p of prices) {
                const old = candleMap.get(p.t);
                // LS daily dates are trading dates: night precedes day. The
                // combined candle opens at night and closes in the day session.
                candleMap.set(p.t, daily && old ? { t:p.t, open:part.session==='N'?p.open:old.open,
                    high:Math.max(old.high,p.high), low:Math.min(old.low,p.low), close:part.session==='D'?p.close:old.close } : p);
            }
        }
        if (daily) {
            for (const [t,row] of pointMap) for (const field of ['individual','foreign','institution']) {
                const hasDay = parts.some(part=>part.session==='D' && part.points.some(p=>p.t===t && Number.isFinite(p[field])));
                if (!hasDay) delete row[field];
            }
            warnings.push('일봉 수급: 같은 LS 거래일의 주간값 표시 · 야간값이 있으면 합산');
        } else warnings.push('주간→야간 시간순 표시 · 세션별 누적값 유지 · 공통 시간축의 미거래 구간은 결측');
        for (const p of candleMap.values()) if (!pointMap.has(p.t)) pointMap.set(p.t, { t:p.t });
        const points = [...pointMap.values()].sort((a,b)=>a.t-b.t), candles = [...candleMap.values()].sort((a,b)=>a.t-b.t);
        const cursors = parts.map(p=>p.cursor).filter(Boolean).sort();
        return { success:true,source:'LS',session:'U',points,candles,warnings,
            partial:parts.length<2 || parts.some(p=>p.partial), has_more:parts.some(p=>p.has_more),
            cursor:cursors.at(-1) || null, date:points.length?dayKey(points.at(-1).t):dayKey(now()),
            contracts:parts.map(p=>({session:p.session,...p.contract})) };
    }
    async function combined(input, onProgress) {
        const parts=new Map(),sessions=input.mode==='minute'?['N','D']:['D','N'];
        const results=await Promise.allSettled(sessions.map(async session=>{
            const value=await query({...input,session},snapshot=>{parts.set(session,snapshot);onProgress(mergeCombined(input,[...parts.values()]));});
            parts.set(session,value);onProgress(mergeCombined(input,[...parts.values()]));return value;
        }));
        if(!parts.size)throw failure('LS 주야간 선물 조회 실패',502);
        return mergeCombined(input,[...parts.values()],sessions.filter((_,i)=>results[i].status==='rejected'));
    }
    async function interactiveCombined(input, progressive) {
        const key=`${input.code}:${input.mode}:${input.cursor}:${input.prices_only || ''}:${input.prices || ''}`;
        let entry=combinedJobs.get(key);
        if(!entry || !entry.running && now()-entry.at>=60000){
            if(combinedJobs.size>=24)for(const [k,v] of combinedJobs)if(!v.running){combinedJobs.delete(k);break;}
            entry={value:entry?.value,running:true,at:now()};combinedJobs.set(key,entry);
            entry.ready=new Promise(resolve=>{entry.resolve=resolve;});
            entry.promise=combined(input,value=>{entry.value=value;entry.resolve();}).then(value=>{
                entry.value=value;entry.at=now();return value;
            }).catch(error=>{entry.error=error;if(!entry.value){combinedJobs.delete(key);throw error;}return entry.value;})
                .finally(()=>{entry.running=false;entry.resolve();});
            entry.promise.catch(()=>{});
        }
        if(!progressive)return entry.running?entry.promise:entry.value;
        if(!entry.value)await entry.ready;
        if(!entry.value)throw entry.error;
        return {...entry.value,pending:entry.running};
    }
    function query(input = {}, onProgress = () => {}) {
        const code = input.code || 'futures', mode = input.mode || 'day', session = input.session || 'U', cursor = input.cursor || '';
        if (typeof code !== 'string' || !Object.hasOwn(assets, code) || !['day', 'minute'].includes(mode) || !['D', 'N', 'U'].includes(session) || typeof cursor !== 'string' || (cursor && !validDate(cursor))) throw failure('잘못된 테스트 선물 조회 조건');
        const pricesOnly=input.prices_only==='1',flowOnly=mode==='minute' && input.prices==='0' && !pricesOnly;
        if (session==='U') return interactiveCombined({code,mode,cursor,prices_only:input.prices_only,prices:input.prices},input.progressive==='1');
        const key = `${code}:${mode}:${session}:${cursor}:${pricesOnly}:${flowOnly}`, old = cache.get(key);
        if (old && now() - old.at < 60000) {onProgress(old.data);return Promise.resolve(old.data);}
        if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(onProgress);
        if (pending.has(key)) return pending.get(key);
        const task = load({ code, mode, session, cursor,pricesOnly,flowOnly },value=>{for(const listener of listeners.get(key) || [])listener(value);}).then(data => {
            if (cache.size >= 80) cache.delete(cache.keys().next().value);
            cache.set(key, { at: now(), data }); return data;
        }).finally(() => {pending.delete(key);listeners.delete(key);});
        pending.set(key, task); return task;
    }
    const priceRanges=new Map();
    async function priceRange({code='futures',from,to}={}) {
        if(!Object.hasOwn(assets,code)||!validDate(from)||!validDate(to)||from>to||timestamp(to)-timestamp(from)>366*86400000)throw failure('잘못된 선물 가격 조회 범위');
        const key=`${code}:${from}:${to}`,old=priceRanges.get(key);
        if(old && (to<compact(now()) || now()-old.at<60000))return old.promise;
        const promise=(async()=>{
            const contract=await master(code,'D'), rows=new Map(),seen=new Set();
            let cts_date='',cts_time='',partial=false,continuation;
            for(let page=0;page<400;page++){
                const response=await rest('t8465','chart',{shcode:contract.shcode,ncnt:1,qrycnt:500,nday:'0',sdate:from,stime:'',edate:to,etime:'',cts_date,cts_time,comp_yn:'N'},continuation);
                const batch=response.t8465OutBlock1;
                if(!Array.isArray(batch))throw failure('LS 선물 가격 응답 오류',502);
                for(const row of batch){const p=candle(row,investorTime(row));if(p && compact(p.t)>=from && compact(p.t)<=to && p.t<Math.floor(now()/60000)*60000)rows.set(p.t,p);}
                const header=response.t8465OutBlock||{},nextDate=String(header.cts_date||'').trim(),nextTime=String(header.cts_time||'').trim();
                if(!batch.length || response._continuation?.more===false || !nextDate || nextDate==='00000000' || nextDate<from)break;
                const next=nextDate+':'+nextTime;
                if(seen.has(next)){partial=true;break;}
                seen.add(next);cts_date=nextDate;cts_time=nextTime;continuation={key:response._continuation?.key || ''};
                if(page===399)partial=true;
            }
            return {success:true,points:[...rows.values()].sort((a,b)=>a.t-b.t),partial,source:'LS t8465'};
        })();
        priceRanges.set(key,{at:now(),promise});
        promise.catch(()=>priceRanges.delete(key));
        if(priceRanges.size>40)priceRanges.delete(priceRanges.keys().next().value);
        return promise;
    }
    return { query,priceRange,collect:options=>nightCollector?.collect(options),start(){
        if(!nightCollector)return;
        for(const code of Object.keys(assets))try{nightCollector.ingest(code,readHistory(code,'N'));}catch{console.warn('[LS night] saved history import failed');}
        nightCollector.start();
    },stop(){nightCollector?.stop();} };
}
module.exports = { createLsFuturesTest, candle, investorTime, nightPriceTime };
