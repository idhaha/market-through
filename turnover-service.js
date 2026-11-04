// Index candles are read from the shared index candle store (index-candle-store.js).
function createTurnoverService({ http, getToken, indexCandles, now = Date.now, pause = ms => new Promise(r=>setTimeout(r,ms)) }) {
    const cache = new Map();
    const dayKey = t => new Date(t+9*3600000).toISOString().slice(0,10).replaceAll('-','');
    const time = (raw, daily) => Date.parse(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${daily?'09:00:00':`${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}`}+09:00`);
    async function post(api, body, next='') {
        for (let attempt=0; ;attempt++) {
            try {
                const response = await http.post('https://api.kiwoom.com/api/dostk/chart',body,{headers:{Authorization:`Bearer ${await getToken()}`,'api-id':api,'cont-yn':next?'Y':'N','next-key':next},timeout:10000});
                if (Number(response.data.return_code || 0)) throw new Error(response.data.return_msg || '키움 조회 실패');
                return response;
            } catch(error) { if(attempt)throw error; await pause(350); }
        }
    }
    async function query({mode='day',cursor=''}={}) {
        if(!['day','minute'].includes(mode) || typeof cursor!=='string' || cursor && !/^\d{8}$/.test(cursor)) throw Object.assign(new Error('잘못된 거래대금 조회 조건'),{status:400});
        const key=`${mode}:${cursor}`, old=cache.get(key);
        if(old && old.until>now())return old.promise;
        const promise=load(mode,cursor).catch(error=>{cache.delete(key);throw error;});
        cache.set(key,{until:now()+60000,promise});return promise;
    }
    async function load(mode,cursor) {
        const daily=mode==='day', today=dayKey(now());
        // Match the supply chart's default daily page; never impose a calendar range or fixed bar count.
        const reference=await post('ka10081',{stk_cd:'005930_AL',upd_stkpc_tp:'0',base_dt:cursor || today});
        const referenceDays=(reference.data.stk_dt_pole_chart_qry || []).map(r=>String(r.dt)).filter(d=>/^\d{8}$/.test(d)&&d<=(cursor||today)).sort();
        if(!referenceDays.length)throw new Error('거래대금 기준 봉 없음');
        let from=daily?referenceDays[0]:referenceDays.at(-1), to=daily?referenceDays.at(-1):from;
        const markets={}, warnings=[]; let prior=null;
        for(const market of ['kospi','kosdaq']) {
            // Index candles come from the shared store, the same series every other card uses.
            const result=await indexCandles.range({market,mode,from,to});
            const points=new Map(result.points.map(p=>[p.t,p])),previousDay=result.previousDay;
            if(result.partial)warnings.push(`${market} 일부 구간만 제공`);
            const values=[...points.values()].sort((a,b)=>a.t-b.t);
            // Minute turnover accumulates the per-minute estimate (close × volume) within the day.
            if(!daily){let total=0;for(const p of values){const estimate=p.market_turnover_estimate;if(Number.isFinite(estimate))total+=estimate;p.market_turnover=Number.isFinite(estimate)?total:null;delete p.market_turnover_estimate;}}
            markets[market]=daily ? [...new Set(referenceDays)].map(day=>{const t=time(day,true);return points.get(t) || {t,market_turnover:null};}) : values;
            if(previousDay && (!prior || previousDay>prior))prior=previousDay;
        }
        const earlier=new Date(`${from.slice(0,4)}-${from.slice(4,6)}-${from.slice(6,8)}T00:00:00Z`);earlier.setUTCDate(earlier.getUTCDate()-1);
        const nextCursor=daily ? reference.headers?.['cont-yn']==='Y'?earlier.toISOString().slice(0,10).replaceAll('-',''):null : prior;
        return {markets,cursor:warnings.length?null:nextCursor,has_more:!warnings.length&&Boolean(nextCursor),warnings};
    }
    return {query};
}
module.exports={createTurnoverService};
