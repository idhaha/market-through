const { createSupplyStore, dayKey, validCode, failure } = require('./supply-store');
const { quantity, timestamp, collectingAt } = require('./supply-service');
const compact = day => day.replaceAll('-', '');
const marketCodes = { kospi: 'KOSPI0', kosdaq: 'KOSDAQ' };
const lsIndices = { kospi: '001', kosdaq: '301' }, kisIndices = { kospi: '0001', kosdaq: '1001' };
const million = raw => { const text=String(raw ?? '').replaceAll(',', '').trim(),value=Number(text);return /^\d+(\.\d+)?$/.test(text)&&Number.isSafeInteger(value*1000000)?value*1000000:null; };
// LS minute charts label the end of an interval (09:01 -> 09:00).
// The 15:30 closing auction is a distinct execution, not a 15:29 bar.
const lsMinuteTime = (date, clock) => timestamp(date,clock) - (clock === '153000' ? 0 : 60000);
function createBrokerTurnoverData({ broker, directory, transport, http, getToken, kisMarketAmounts, supply, now = Date.now,
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const store = createSupplyStore({ directory, now, fields: ['amount'] });
    const pending = new Map(), owners = new Map(), cache = new Map(), latest = new Map();
    let queue = Promise.resolve(), timer, archiveMinute = -1;
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
        if (broker === 'kis') {
            const parts = String(raw).split('|');
            if (parts[0] !== '0' || parts[1] !== 'H0UPCNT0') return false;
            const count = Number(parts[2]), values = (parts[3] || '').split('^');
            if (!Number.isInteger(count) || count < 1 || count > 100 || values.length !== count * 30) return false;
            let accepted = false;
            for (let i=0;i<count;i++) {
                const market = Object.keys(kisIndices).find(key => kisIndices[key] === values[i*30]);
                if (market && (!expectedKey || values[i*30]===expectedKey) && /^(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(values[i*30+1])) accepted = record(marketCodes[market],timestamp(today,values[i*30+1]),million(values[i*30+6])) || accepted;
            }
            return accepted;
        }
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
        return [...new Set([...owners.values()].sort((a,b)=>b.at-a.at).map(v=>v.code))].slice(0,10);
    }
    function syncStreams() {
        const streams = Object.entries(broker==='ls'?lsIndices:kisIndices).map(([,key])=>({tr:broker==='ls'?'IJ_':'H0UPCNT0',key,onData:raw=>receive(raw,key)}));
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
            finally { await pause(1100); }
        }); queue=task.catch(()=>{}); return task;
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
                if(broker==='ls')rows=await lsBars(instrument,mode,dates[0],dates.at(-1));
                else rows=(await kisMarketAmounts({market:instrument,mode,dates})).flatMap(row=>{
                    const t=timestamp(String(row.stck_bsop_date || ''),mode==='day'?'000000':String(row.stck_cntg_hour || ''));
                    const amount=million(row.acml_tr_pbmn);
                    return Number.isFinite(t)&&amount!==null&&dates.includes(compact(dayKey(t)))?[{t,amount}]:[];
                });
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
    async function amounts(instrument,mode,dates,cumulative=false) {
        const data=await series(instrument,mode,dates), result=new Map();
        flush();
        // REST history can remain cached while new completed websocket minutes arrive.
        const code=marketCodes[instrument] || instrument;
        const ws=mode==='minute'?dates.flatMap(date=>store.points(code,`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`)).filter(p=>p.t<Math.floor(now()/60000)*60000):[];
        const stock=!Object.hasOwn(marketCodes,instrument),opening=stock?'080000':'090000';
        if(mode==='day')for(const p of data.rows)result.set(p.t,p.amount);
        else if(broker==='ls') {
            let total=0,lastDay,complete=false;
            for(const p of data.rows){
                const date=dayKey(p.t);if(date!==lastDay){lastDay=date;total=0;complete=new Date(p.t+9*3600000).toISOString().slice(11,19).replaceAll(':','')===opening;}
                total+=p.amount;result.set(p.t,cumulative?(complete?total:null):p.amount);
            }
        } else {
            let previous;
            for(const p of data.rows.sort((a,b)=>a.t-b.t)){
                const contiguous=previous&&p.t-previous.t===60000;
                result.set(p.t,cumulative?p.amount:contiguous&&p.amount>=previous.amount?p.amount-previous.amount:null);previous=p;
            }
        }
        let previous;
        for(const p of ws) {
            const contiguous=previous&&p.t-previous.t===60000;
            const value=cumulative?p.amount:contiguous&&p.amount>=previous.amount?p.amount-previous.amount:null;
            if(value!==null)result.set(p.t,value);previous=p;
        }
        return {values:result,warnings:data.warnings};
    }
    function start(){if(timer)return;syncStreams();const run=()=>{try{flush();syncStreams();const m=Math.floor(now()/60000);if(m!==archiveMinute){store.archiveCompleted();archiveMinute=m;}}catch{}};timer=setInterval(run,1000);timer.unref?.();}
    return {store,receive,flush,watchStock,amounts,start,stop:()=>{clearInterval(timer);timer=null;transport.setStreams('turnover',[]);},streamStatus:transport.streamStatus};
}
module.exports={createBrokerTurnoverData,million,marketCodes,lsMinuteTime};
