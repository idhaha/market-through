require('dotenv').config();
const axios=require('axios'),fs=require('node:fs');
const destination='logs/samsung-concentration-20261021-20261023-raw.json';
const report=fs.existsSync(destination)?JSON.parse(fs.readFileSync(destination,'utf8')):JSON.parse(fs.readFileSync('logs/samsung-concentration-20261023-raw.json','utf8'));
report.dates=['20261021','20261022','20261023'];
const pause=()=>new Promise(r=>setTimeout(r,350));
async function main(){
 const a=await axios.post(`${process.env.EFRIEND_DOMAIN.trim()}/oauth2/tokenP`,{grant_type:'client_credentials',appkey:process.env.EFRIEND_APPKEY.trim(),appsecret:process.env.EFRIEND_SECRETKEY.trim()},{timeout:15000});
 if(!a.data.access_token)throw new Error(a.data.error_description||'KIS token unavailable');
 async function kis(tr,endpoint,params,cont=''){await pause();const r=await axios.get(`${process.env.EFRIEND_DOMAIN.trim()}/uapi/domestic-stock/v1/quotations/${endpoint}`,{params,headers:{authorization:`Bearer ${a.data.access_token}`,appkey:process.env.EFRIEND_APPKEY.trim(),appsecret:process.env.EFRIEND_SECRETKEY.trim(),tr_id:tr,custtype:'P',tr_cont:cont},timeout:15000});
 report.calls.push({provider:'KIS',tr,params,request_cont:cont,response_cont:r.headers.tr_cont,data:r.data});fs.writeFileSync(destination,JSON.stringify(report,null,2));
 if(r.data.rt_cd!=='0')throw new Error(r.data.msg1||tr);console.log(JSON.stringify({tr,params,count:r.data.output2?.length||r.data.output?.length}));return r.data;}
 await kis('FHPUP02110200','inquire-index-timeprice',{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:'0001',FID_INPUT_HOUR_1:'60'});
 if(process.argv.includes('--index-only')){
 await kis('FHPUP02110200','inquire-index-timeprice',{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:'0001',FID_INPUT_HOUR_1:'60'},'N');
 await kis('FHKUP03500200','inquire-time-indexchartprice',{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:'0001',FID_INPUT_HOUR_1:'60',FID_PW_DATA_INCU_YN:'Y',FID_ETC_CLS_CODE:'0'});
 await kis('FHKUP03500200','inquire-time-indexchartprice',{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:'0001',FID_INPUT_HOUR_1:'60',FID_PW_DATA_INCU_YN:'Y',FID_ETC_CLS_CODE:'0'},'N');
 return;}
 await kis('FHPUP02110200','inquire-index-timeprice',{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:'0001',FID_INPUT_HOUR_1:'60'},'N');
 for(const cont of ['','N'])await kis('FHKUP03500200','inquire-time-indexchartprice',{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:'0001',FID_INPUT_HOUR_1:'60',FID_PW_DATA_INCU_YN:'Y',FID_ETC_CLS_CODE:'0'},cont);
 for(const date of ['20261021','20261022'])for(const market of ['J','UN']){let clock='200000';const seen=new Set();for(let page=0;page<12;page++){
 const d=await kis('FHKST03010230','inquire-time-dailychartprice',{FID_COND_MRKT_DIV_CODE:market,FID_INPUT_ISCD:'005930',FID_INPUT_DATE_1:date,FID_INPUT_HOUR_1:clock,FID_PW_DATA_INCU_YN:'N',FID_FAKE_TICK_INCU_YN:'N'});
 const rows=(d.output2||[]).filter(x=>x.stck_bsop_date===date);if(!rows.length)break;const earliest=rows.map(x=>x.stck_cntg_hour).sort()[0];if(seen.has(earliest))break;seen.add(earliest);
 const mins=Number(earliest.slice(0,2))*60+Number(earliest.slice(2,4))-1;
 if(mins<(market==='J'?540:480))break;clock=String(Math.floor(mins/60)).padStart(2,'0')+String(mins%60).padStart(2,'0')+'00';
 }}
 const k=await axios.post('https://api.kiwoom.com/oauth2/token',{grant_type:'client_credentials',appkey:process.env.KIWOOM_APPKEY.trim(),secretkey:process.env.KIWOOM_SECRETKEY.trim()},{timeout:15000});
 if(!k.data.token)throw new Error(k.data.return_msg||'Kiwoom token unavailable');
 for(const [tr,body,field] of [['ka10080',{stk_cd:'005930',tic_scope:'1',upd_stkpc_tp:'0'},'stk_min_pole_chart_qry'],['ka10080',{stk_cd:'005930_AL',tic_scope:'1',upd_stkpc_tp:'0'},'stk_min_pole_chart_qry'],['ka20005',{inds_cd:'001',tic_scope:'1'},'inds_min_pole_qry']]){
 let next='';for(let page=0;page<5;page++){await pause();const r=await axios.post('https://api.kiwoom.com/api/dostk/chart',body,{headers:{Authorization:`Bearer ${k.data.token}`,'api-id':tr,'cont-yn':next?'Y':'N','next-key':next,'Content-Type':'application/json'},timeout:15000});
 report.calls.push({provider:'Kiwoom',tr,params:body,data:r.data});fs.writeFileSync(destination,JSON.stringify(report,null,2));if(Number(r.data.return_code||0)!==0)throw new Error(r.data.return_msg||tr);
 const rows=r.data[field]||[];console.log(JSON.stringify({tr,body,count:rows.length,first:rows[0]?.cntr_tm,last:rows.at(-1)?.cntr_tm}));
 if(!rows.length||rows.at(-1).cntr_tm<'20261021080000'||r.headers['cont-yn']!=='Y')break;const n=r.headers['next-key'];if(!n||n===next)break;next=n;
 }}
 console.log(`Saved ${destination}`);
}
main().catch(e=>{console.error(JSON.stringify({error:e.response?.data?.msg1||e.response?.data?.return_msg||e.code||(e.isAxiosError?'Request failed':e.message)}));process.exitCode=1;});
