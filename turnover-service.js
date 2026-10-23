const { dailyTurnover } = require('./concentration-chart');
function createTurnoverService({ http, getToken, now = Date.now, pause = ms => new Promise(r=>setTimeout(r,ms)) }) {
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
            const points=new Map();let next='',complete=false,previousDay=null;
            for(let page=0;page<80;page++) {
                let response;
                try { response=await post(daily?'ka20006':'ka20005',{inds_cd:market==='kospi'?'001':'101',...(daily?{base_dt:to}:{tic_scope:'1'})},next); }
                catch(error) { if(!points.size)throw error; warnings.push(`${market} 일부 구간 조회 실패`); break; }
                const rows=response.data[daily?'inds_dt_pole_qry':'inds_min_pole_qry'];
                if(!Array.isArray(rows))throw new Error('시장 지수 응답 형식 오류');
                for(const row of rows) {
                    const raw=String(daily?row.dt:row.cntr_tm || ''), day=raw.slice(0,8);
                    if(!(daily?/^\d{8}$/:/^\d{14}$/).test(raw))continue;
                    if(day<from){complete=true;if(!previousDay || day>previousDay)previousDay=day;continue;}
                    if(day>to)continue;
                    const price=v=>Math.abs(Number(String(v??'').replaceAll(',','')))/100;
                    const point={t:time(raw,daily),open:price(row.open_pric),high:price(row.high_pric),low:price(row.low_pric),close:price(row.cur_prc)};
                    if(daily)point.market_turnover=dailyTurnover(row).value;
                    else { const volume=Number(String(row.trde_qty??'').replaceAll(',',''));point.estimate=Number.isFinite(volume)&&volume>=0?point.close*volume*10000:null; }
                    if(Number.isFinite(point.t)&&point.t<=now())points.set(point.t,point);
                }
                const key=response.headers?.['cont-yn']==='Y'?String(response.headers['next-key']||''):'';
                if(complete || !key || !rows.length){complete=true;break;}
                if(key===next)throw new Error('시장 지수 연속조회 키 오류');
                next=key;await pause(350);
            }
            if(!complete)warnings.push(`${market} 일부 구간만 제공`);
            const values=[...points.values()].sort((a,b)=>a.t-b.t);
            if(!daily){let total=0;for(const p of values){if(Number.isFinite(p.estimate))total+=p.estimate;p.market_turnover=Number.isFinite(p.estimate)?total:null;delete p.estimate;}}
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
