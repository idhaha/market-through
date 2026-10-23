function createChartReferenceService({http,getToken,now=Date.now}) {
 const cache=new Map();
 async function query({mode='day',market='kospi',cursor=''}={}) {
  if(!['day','minute'].includes(mode)||!['kospi','kosdaq'].includes(market)||typeof cursor!=='string'||cursor.length>2048)throw Object.assign(new Error('잘못된 기준 캔들 조건'),{status:400});
  const key=`${mode}:${market}:${cursor}`,saved=cache.get(key);if(saved&&saved.until>now())return saved.promise;
  const promise=(async()=>{
   const daily=mode==='day';
   const response=await http.post('https://api.kiwoom.com/api/dostk/chart',{inds_cd:market==='kospi'?'001':'101',...(daily?{base_dt:new Date(now()+9*3600000).toISOString().slice(0,10).replaceAll('-','')}:{tic_scope:'1'})},{headers:{Authorization:`Bearer ${await getToken()}`,'api-id':daily?'ka20006':'ka20005','cont-yn':cursor?'Y':'N','next-key':cursor},timeout:10000});
   if(Number(response.data.return_code||0))throw new Error(response.data.return_msg||'기준 캔들 조회 실패');
   const rows=response.data[daily?'inds_dt_pole_qry':'inds_min_pole_qry'];if(!Array.isArray(rows))throw new Error('기준 캔들 형식 오류');
   const points=[...new Map(rows.map(row=>{
    const raw=String(daily?row.dt:row.cntr_tm||'');if(!(daily?/^\d{8}$/:/^\d{14}$/).test(raw))return null;
    const date=`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
    const t=Date.parse(`${date}T${daily?'09:00:00':`${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}`}+09:00`);
    const price=v=>Math.abs(Number(String(v??'').replaceAll(',','')))/100;
    return [t,{t,date:daily?date:`${date} ${raw.slice(8,10)}:${raw.slice(10,12)}`,open:price(row.open_pric),high:price(row.high_pric),low:price(row.low_pric),close:price(row.cur_prc)}];
   }).filter(p=>p&&Number.isFinite(p[0])&&p[0]<=now())).values()].sort((a,b)=>a.t-b.t);
   const next=response.headers?.['cont-yn']==='Y'?String(response.headers['next-key']||''):'';
   return {points,count:points.length,cursor:next||null,has_more:Boolean(next)};
  })().catch(e=>{cache.delete(key);throw e;});cache.set(key,{until:now()+60000,promise});return promise;
 }
 return {query};
}
module.exports={createChartReferenceService};
