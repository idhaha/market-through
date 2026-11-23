const { createSupplyStore, dayKey, validCode, failure } = require('./supply-store');
const { quantity, timestamp, collectingAt } = require('./supply-service');
const { openDelay, closeDelay, shiftClock } = require('./market-open-delay');
const compact = day => day.replaceAll('-', '');
const marketCodes = { kospi: 'KOSPI0', kosdaq: 'KOSDAQ' };
const lsIndices = { kospi: '001', kosdaq: '301' };
const million = raw => { const text=String(raw ?? '').replaceAll(',', '').trim(),value=Number(text);return /^\d+(\.\d+)?$/.test(text)&&Number.isSafeInteger(value*1000000)?value*1000000:null; };
// LS minute charts label the end of an interval (09:01 -> 09:00).
// The 15:30 closing auction is a distinct execution, not a 15:29 bar.
// On a delayed-open day the close moves too (2026-11-19 수능: 16:30 closing auction).
const lsMinuteTime = (date, clock) => timestamp(date,clock) - (clock === shiftClock('153000', closeDelay(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`)) ? 0 : 60000);
// 공식적으로 거래가 없는 분(2026-11-22): 장 마감 동시호가 15:20~15:29(마감 지연일은 늦춤), 종목은 NXT 프리마켓 뒤 08:50~08:59
// (개장 지연일은 늦춤). 이 분들은 0으로 채우지 않고 빈칸으로 두며, 그 앞뒤 분은 이어진 것으로 본다(15:30 종가 봉이 빠지지 않게).
function noTradeMinute(t, stock) {
    const date = dayKey(t), clock = new Date(t + 9 * 3600000).toISOString().slice(11, 19).replaceAll(':', '');
    const close = closeDelay(date), open = openDelay(date);
    if (clock >= shiftClock('152000', close) && clock < shiftClock('153000', close)) return true;
    return Boolean(stock) && clock >= shiftClock('085000', open) && clock < shiftClock('090000', open);
}
const bridged = (from, to, stock) => { for (let t = from + 60000; t < to; t += 60000) if (!noTradeMinute(t, stock)) return false; return to > from; };
function createBrokerTurnoverData({ broker, directory, transport, http, getToken, supply, now = Date.now, log = message => console.warn(message),
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const store = createSupplyStore({ directory, now, fields: ['amount'] });
    const pending = new Map(), owners = new Map(), cache = new Map(), latest = new Map();
    let backgroundStocks=[];
    let queue = Promise.resolve(), timer, archiveMinute = -1, warnedLate = '';
    function flush() {
        const minute = Math.floor(now()/60000)*60000;
        for (const [key, value] of pending) if (value.t < minute) { store.merge(value.code, value); pending.delete(key); }
    }
    function record(code, at, amount) {
        if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isFinite(at) || at > now() || now()-at>120000 || !collectingAt(at) || dayKey(at)!==dayKey(now())) return false;
        if (at < (latest.get(code) || 0)) return false;
        const t = Math.floor(at/60000)*60000;
        pending.set(`${code}:${t}`, { code, t, amount, amount_at: at }); latest.set(code, at); flush(); return true;
    }
    function receive(raw, expectedKey) {
        const today = compact(dayKey(now()));
        let message; try { message=JSON.parse(String(raw)); } catch { return false; }
        const body=message.body || {}, tr=message.header?.tr_cd;
        if (tr === 'IJ_') {
            const market=Object.keys(lsIndices).find(key=>lsIndices[key]===String(body.upcode));
            if (market && (!expectedKey || String(body.upcode)===expectedKey) && /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(String(body.time))) return record(marketCodes[market],timestamp(today,String(body.time)),million(body.value));
        } else if (tr === 'US3') {
            const match=/^U([A-Za-z0-9]{6})\s*$/.exec(String(body.ex_shcode || message.header.tr_key || ''));
            if (match && (!expectedKey || expectedKey.trim()===`U${match[1]}`) && watchedCodes().includes(match[1]) && /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(String(body.chetime))) return record(match[1],timestamp(today,String(body.chetime)),million(body.value));
        }
        return false;
    }
    function watchedCodes() {
        for (const [owner, value] of owners) if (now()-value.at>15*60000) owners.delete(owner);
        return [...new Set([...backgroundStocks,...[...owners.values()].sort((a,b)=>b.at-a.at).map(v=>v.code)])].slice(0,10);
    }
    function syncStreams() {
        const streams = Object.entries(lsIndices).map(([,key])=>({tr:'IJ_',key,onData:raw=>receive(raw,key)}));
        if (broker==='ls') for (const code of watchedCodes()) streams.push({tr:'US3',key:`U${code}   `,onData:raw=>receive(raw,`U${code}`)});
        transport.setStreams('turnover', streams);
    }
    function watchStock(code, owner) {
        if (broker!=='ls' || !validCode(code)) return;
        owners.delete(owner); owners.set(owner,{code,at:now()});
        while (owners.size>100) owners.delete(owners.keys().next().value);
        syncStreams();
    }
    async function post(tr, endpoint, params, continuation = {}) {
        const task=queue.then(async()=>{
            try {
                const response=await http.post(`https://openapi.ls-sec.co.kr:8080/${endpoint}`,{[`${tr}InBlock`]:params},
                    {headers:{authorization:`Bearer ${await getToken()}`,'Content-Type':'application/json; charset=UTF-8',tr_cd:tr,tr_cont:continuation.tr_cont || 'N',tr_cont_key:continuation.tr_cont_key || ''},timeout:10000});
                if (String(response.data?.rsp_cd)!=='00000') throw new Error();
                return {data:response.data,headers:response.headers || {}};
            } catch { throw failure(`LS ${tr} 거래대금 조회 실패`,502); }
        });
        // Return received data immediately; only the next request waits for
        // the existing cooldown, including after failed requests.
        queue=task.catch(()=>{}).then(()=>pause(1100));
        return task;
    }
    async function lsBars(instrument, mode, from, to) {
        const stock=!Object.hasOwn(marketCodes,instrument), daily=mode==='day';
        const tr=stock ? daily?'t8451':'t8452' : daily?'t8429':'t8409';
        const rows=new Map(); let cts_date='',cts_time='',continuationKey=''; const seen=new Set();
        for(let page=0;page<40;page++) {
            const params={shcode:stock?instrument:lsIndices[instrument],qrycnt:500,sdate:from,edate:to,cts_date,comp_yn:'N',
                ...(daily?{gubun:'2'}:{ncnt:1,nday:'0',stime:'',etime:'',cts_time}),
                ...(stock?{exchgubun:'U',...(daily?{sujung:'Y'}:{krx_mmk_gubun:''})}:{})};
            const response=await post(tr,stock?'stock/chart':'indtp/chart',params,{tr_cont:page?'Y':'N',tr_cont_key:continuationKey});
            const data=response.data;continuationKey=String(response.headers.tr_cont_key || '');
            const values=data[`${tr}OutBlock1`];
            if(!Array.isArray(values))throw failure(`LS ${tr} 거래대금 응답 형식 오류`,502);
            let earliest=to;
            for(const row of values){
                const date=String(row.date || ''), clock=daily?'000000':String(row.time || '').slice(0,6);
                if(!/^\d{8}$/.test(date) || !/^\d{6}$/.test(clock))continue;
                if(date<earliest)earliest=date;
                const t=daily?timestamp(date,clock):lsMinuteTime(date,clock),amount=million(row.value);
                if(date>=from&&date<=to&&Number.isFinite(t)&&t<=now()&&amount!==null)rows.set(t,{t,amount});
            }
            const out=data[`${tr}OutBlock`] || {}, nextDate=String(out.cts_date || '').trim(),nextTime=String(out.cts_time || '').trim();
            if(!values.length||earliest<from||!nextDate||!daily&&nextDate===from&&nextTime<='080000')break;
            const key=`${nextDate}:${nextTime}`;if(seen.has(key))break;seen.add(key);cts_date=nextDate;cts_time=nextTime;
            if(page===39)throw failure('LS 거래대금 과거 조회 한도 도달',502);
        }
        return [...rows.values()].sort((a,b)=>a.t-b.t);
    }
    async function seriesRange(instrument,mode,dates) {
        if(!dates.length)return {rows:[],warnings:[]};
        const key=`${instrument}:${mode}:${dates.join(',')}`,old=cache.get(key);
        const mutable=dates.includes(compact(dayKey(now())));
        if(old&&(old.pending||old.until>now()))return old.promise;
        const entry={pending:true};entry.promise=(async()=>{
            const warnings=[]; let rows=[];
            try {
                rows=await lsBars(instrument,mode,dates[0],dates.at(-1));
            } catch(e){warnings.push(e.message);}
            if (mode === 'minute') rows = rows.filter(p=>p.t<Math.floor(now()/60000)*60000);
            entry.failed = warnings.length > 0;
            return {rows,warnings};
        })().finally(()=>{entry.pending=false;entry.until=now()+(entry.failed?5000:mutable?60000:6*3600000);});
        cache.set(key,entry);if(cache.size>80)for(const [key,item]of cache)if(!item.pending&&cache.size>80)cache.delete(key);
        return entry.promise;
    }
    async function series(instrument,mode,dates) {
        if(mode!=='minute')return seriesRange(instrument,mode,dates);
        const parts=await Promise.all([...new Set(dates)].sort().map(date=>seriesRange(instrument,mode,[date])));
        return {rows:parts.flatMap(p=>p.rows).sort((a,b)=>a.t-b.t),warnings:[...new Set(parts.flatMap(p=>p.warnings))]};
    }
    // 지난날 LS 1분 거래대금을 REST로 받았으면 실시간 저장과 같은 모양(그날 누적 거래대금)으로 저장한다(2026-11-22, 소스는 한 곳:
    // ls-turnover). 다음부터는 저장한 날로 읽어 LS를 다시 부르지 않는다. 그날 첫 봉이 개장 시각이고 마감까지 다 받은 날만 저장한다.
    // 거래가 없던 분은 직전 누적을 그대로 채운다(그 분의 거래대금 0). 공식적으로 거래가 없는 분(noTradeMinute)은 채우지 않고 빈칸으로 둔다.
    function saveFinishedDays(code,instrument,dates,rows){
        const stock=!Object.hasOwn(marketCodes,instrument),opening=stock?'080000':'090000';
        const clock=t=>new Date(t+9*3600000).toISOString().slice(11,19).replaceAll(':','');
        for(const date of dates){
            const day=rows.filter(p=>compact(dayKey(p.t))===date).sort((a,b)=>a.t-b.t);
            if(!day.length)continue;
            const dashed=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
            const first=clock(day[0].t),last=clock(day.at(-1).t);
            const opened=first===opening||stock&&first==='090000'||first===shiftClock('090000',openDelay(dashed));
            if(!opened||last<shiftClock('153000',closeDelay(dashed)))continue;
            const byTime=new Map(day.map(p=>[p.t,p.amount])),points=[];let total=0;
            for(let t=day[0].t;t<=day.at(-1).t;t+=60000){total+=byTime.get(t)||0;if(byTime.has(t)||!noTradeMinute(t,stock))points.push({t,amount:total,amount_at:t});}
            try{store.mergeMany(code,points);}catch(error){log(`[LS 거래대금] ${code} ${date} 저장 안 함: ${error.message}`);}
        }
    }
    async function amounts(instrument,mode,dates,cumulative=false) {
        flush();
        const code=marketCodes[instrument] || instrument;
        const savedDays=mode==='minute'?new Set(store.dates(code).map(compact)):new Set();
        const today=compact(dayKey(now()));
        // A past saved day that covers the regular session is authoritative, including genuine
        // missing minutes, so REST history is not traversed again. A day saved only in part
        // (realtime collection interrupted, e.g. LS session limit on 2026-11-02) is read from REST.
        // Covered = spans 09:00..15:30 and holds at least 80% of its 391 minutes; REST is only slower.
        const covered=date=>{
            const times=store.points(code,`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`).map(p=>p.t);
            if(!times.length)return false;
            const clock=t=>new Date(t+9*3600000).toISOString().slice(11,19).replaceAll(':','');
            // 개장이 늦은 날(수능일 10:00 등, market-open-delay.js)은 늦은 개장 시각부터 센다. 2026-11-23: 11/19(수능일)를 09:00 기준으로
            // 보아 늘 "덜 받은 날"이 되어, 볼 때마다 LS에서 다시 받아 파일을 덮어쓰고 차트 변경 번호가 하루 380번 올랐다.
            const day=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`,open=shiftClock('090000',openDelay(day)),close=shiftClock('153000',closeDelay(day));
            const span=(Date.parse(`${day}T${close.slice(0,2)}:${close.slice(2,4)}:00+09:00`)-Date.parse(`${day}T${open.slice(0,2)}:${open.slice(2,4)}:00+09:00`))/60000+1;
            const regular=times.filter(t=>clock(t)>=open&&clock(t)<=close).length;
            return clock(Math.min(...times))<=open && clock(Math.max(...times))>=close && regular>=Math.ceil(span*0.8);
        };
        const restDates=mode==='minute'?dates.filter(date=>date>=today || !savedDays.has(date) || !covered(date)):dates;
        const data=await series(instrument,mode,restDates), result=new Map();
        if(mode==='minute'&&!data.warnings.length)saveFinishedDays(code,instrument,restDates.filter(date=>date<today),data.rows);
        // REST history can remain cached while new completed websocket minutes arrive.
        const ws=mode==='minute'?dates.flatMap(date=>store.points(code,`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`)).filter(p=>p.t<Math.floor(now()/60000)*60000):[];
        const stock=!Object.hasOwn(marketCodes,instrument),opening=stock?'080000':'090000';
        if(mode==='day')for(const p of data.rows)result.set(p.t,p.amount);
        else {
            let total=0,lastDay,complete=false;
            for(const p of data.rows){
                // A fully requested LS day may start at the regular 09:00
                // session for a stock with no 08:00 premarket bars.
                // On a delayed-open day (market-open-delay.js, e.g. 수능 10:00) the index day starts at the delayed open.
                const date=dayKey(p.t);if(date!==lastDay){lastDay=date;total=0;const first=new Date(p.t+9*3600000).toISOString().slice(11,19).replaceAll(':',''),delayed=shiftClock('090000',openDelay(date));
                    complete=first===opening || stock&&first==='090000' || first===delayed;
                    // A late index start on a day the table does not know: likely an unlisted delayed open (warn once a day).
                    if(!stock&&first>delayed&&date===dayKey(now())&&warnedLate!==date){warnedLate=date;log(`[개장 지연] 오늘 ${instrument} 업종지수 첫 분봉이 ${first.slice(0,2)}:${first.slice(2,4)}입니다. 수능일이면 설정(⚙)의 올해 수능일 칸에 오늘을 입력하고, 다른 이유의 지연이면 market-open-delay.js 표에 더하고 배포해야 시장 누적 거래대금(쏠림율 누적 · LS 거래대금 분봉)이 그려집니다.`);}}
                total+=p.amount;result.set(p.t,cumulative?(complete?total:null):p.amount);
            }
        }
        let previous;
        // 그날 첫 분이 개장 시각이면 그 분 거래대금은 누적값 그대로다(2026-11-24). 저장 자료는 누적이라 직전 분과의 차이로 1분 값을 만드는데,
        // 첫 분은 직전 분이 없어 비었다: 지난날 시장 지수 09:00 거래대금이 늘 빈칸이라 그날 쏠림율이 381봉 중 380봉만 나왔다
        // (장중에는 REST 1분 값을 써서 381봉, 장이 끝나 저장 자료로 읽으면 380봉). 개장 시각은 수능일 등 늦게 연 날을 따른다.
        const openingClocks=t=>{const day=dayKey(t),open=shiftClock('090000',openDelay(day));return stock?['080000',open]:[open];};
        const clockOf=t=>new Date(t+9*3600000).toISOString().slice(11,19).replaceAll(':','');
        for(const p of ws) {
            const contiguous=previous&&(p.t-previous.t===60000||bridged(previous.t,p.t,stock));
            const firstOfDay=!previous||dayKey(previous.t)!==dayKey(p.t);
            const value=cumulative?p.amount:contiguous&&p.amount>=previous.amount?p.amount-previous.amount
                :firstOfDay&&openingClocks(p.t).includes(clockOf(p.t))?p.amount:null;
            if(value!==null)result.set(p.t,value);previous=p;
        }
        return {values:result,warnings:data.warnings};
    }
    function start(){if(timer)return;syncStreams();const run=()=>{try{flush();syncStreams();const m=Math.floor(now()/60000);if(m!==archiveMinute){store.archiveCompleted();archiveMinute=m;}}catch{}};timer=setInterval(run,1000);timer.unref?.();}
    function setBackgroundStocks(codes){const next=[...new Set(codes.filter(validCode))];if(JSON.stringify(next)!==JSON.stringify(backgroundStocks)){backgroundStocks=next;syncStreams();}}
    return {store,receive,flush,watchStock,setBackgroundStocks,amounts,start,stop:()=>{clearInterval(timer);timer=null;transport.setStreams('turnover',[]);},streamStatus:transport.streamStatus};
}
module.exports={createBrokerTurnoverData,million,marketCodes,lsMinuteTime};
