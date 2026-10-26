const {quantity,timestamp}=require('./supply-service');
const {dayKey,failure}=require('./supply-store');
const {createHistoryCache}=require('./daily-query-cache');
const compact=t=>dayKey(t).replaceAll('-','');
const before=d=>compact(timestamp(d)-86400000);
const configs={kospi:{market:'1',upcode:'001',program:'0'},kosdaq:{market:'3',upcode:'301',program:'1'}};
function investorValues(row){const money=v=>{const n=quantity(v);return n===null||!Number.isSafeInteger(n*100)?null:n*100;};return {individual:money(row.sa_08),foreign:money(row.sa_17),institution:money(row.sa_18)};}
function createLsMarketDaily({http,getToken,reference,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
 const history=createHistoryCache({now});let queue=Promise.resolve();
 async function rest(tr,endpoint,params,continuation={}){
  const task=queue.then(async()=>{try{
   const response=await http.post('https://openapi.ls-sec.co.kr:8080/stock/'+endpoint,{[tr+'InBlock']:params},{headers:{authorization:'Bearer '+await getToken(),'Content-Type':'application/json; charset=UTF-8',tr_cd:tr,tr_cont:continuation.tr_cont||'N',tr_cont_key:continuation.tr_cont_key||''},timeout:10000});
   const d=response.data;if(String(d?.rsp_cd)!=='00000'||!Array.isArray(d[tr+'OutBlock1']))throw Error();
   Object.defineProperty(d,'continuation',{value:{tr_cont:response.headers?.tr_cont,tr_cont_key:response.headers?.tr_cont_key||''}});return d;
  }catch{throw failure(`LS ${tr} 일봉 조회 실패`,502);}finally{await pause(1100);}});queue=task.catch(()=>{});return task;
 }

 async function daily(code,cursor,onProgress=()=>{}){
  const cfg=configs[code];if(!cfg)throw failure('LS 선물 일봉 수급 미제공');
  const base=await reference.query({mode:'day',market:code,cursor});
  const dates=base.points.map(p=>compact(p.t)).sort(),from=dates[0],to=dates.at(-1),points=new Map(dates.map(dt=>[dt,{t:timestamp(dt)}]));
  const warnings=['LS REST · KRX+NXT 통합 · 표시 단위: 억원'];
  const snapshot=()=>({success:true,source:'LS',points:[...points.values()].map(p=>({...p})),candles:base.points.map(p=>({...p,t:timestamp(compact(p.t))})),warnings:[...warnings],has_more:base.has_more,cursor:base.cursor});
  onProgress(snapshot());if(!from)return snapshot();
  await Promise.all(['investor','program'].map(async kind=>{
   const accept=result=>{for(const row of result.rows)if(points.has(row.dt))Object.assign(points.get(row.dt),kind==='investor'?investorValues(row):{program:quantity(row.tot3)});onProgress(snapshot());};
   const result=await history.read(`${code}:${kind}`,{from,to,recent:cursor?false:dates.at(-2)||to,onProgress:accept,load:async(start,end,onPage)=>{
    const rows=new Map();let last=end,cts='',error='',continuation={};
    try{for(let page=0;page<80&&last>=start;page++){
     const tr=kind==='investor'?'t1665':'t1633';
     const d=await rest(tr,kind==='investor'?'chart':'program',kind==='investor'?{market:cfg.market,upcode:cfg.upcode,gubun2:'1',gubun3:'1',from_date:start,to_date:last,exchgubun:'U'}:{gubun:cfg.program,gubun1:'0',gubun2:'0',gubun3:'1',fdate:start,tdate:end,gubun4:'0',date:cts,exchgubun:'U'},kind==='program'?continuation:{});
     const incoming=d[tr+'OutBlock1'],valid=incoming.filter(r=>/^\d{8}$/.test(String(r.date))&&r.date>=start&&r.date<=last),oldest=valid.map(r=>r.date).sort()[0];
     for(const row of valid)rows.set(row.date,{...row,dt:row.date});onPage([...rows.values()]);
     if(!oldest||oldest<=start)break;
     if(kind==='program'){const next=String(d.t1633OutBlock?.date||'');if(!/^\d{8}$/.test(next)||next===cts)break;cts=next;continuation={tr_cont:'Y',tr_cont_key:d.continuation.tr_cont_key};}
     last=before(oldest);
     if(page===79)error='LS 일봉 과거 조회 한도 도달';
    }}catch(e){error=e.message;}
    return {rows:[...rows.values()],partial:!!error,error};
   }});accept(result);if(result.error)warnings.push(result.error);
  }));
  if([...points.values()].some(p=>['individual','foreign','institution','program'].some(f=>!Number.isFinite(p[f]))))warnings.push('LS 일부 일별 수급 미제공');
  return snapshot();
 }
 return {daily};
}
module.exports={createLsMarketDaily,investorValues};
