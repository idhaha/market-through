require('dotenv').config({quiet:true});
const WebSocket=require('ws');
async function main(){
 const response=await fetch('https://openapi.ls-sec.co.kr:8080/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',appkey:process.env.LS_APPKEY||'',appsecretkey:process.env.LS_SECRETKEY||'',scope:'oob'}),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!data.access_token)throw Error('LS 인증 실패');
 if(process.argv.includes('--masters')) {
  const rest=async(tr,params)=>{
   const r=await fetch('https://openapi.ls-sec.co.kr:8080/futureoption/market-data',{method:'POST',headers:{authorization:'Bearer '+data.access_token,'Content-Type':'application/json',tr_cd:tr,tr_cont:'N',tr_cont_key:''},body:JSON.stringify({[tr+'InBlock']:params}),signal:AbortSignal.timeout(15000)});
   const d=await r.json();if(d.rsp_cd!=='00000')throw Error(tr+' 조회 실패: '+d.rsp_cd);return d;
  };
  const master=await rest('t8401',{dummy:''});
  const rows=master.t8401OutBlock.filter(r=>String(r.hname).includes('삼성전자'));console.log('t8401 삼성전자:',JSON.stringify(rows));console.log('master count',master.t8401OutBlock.length);
  if(rows[0]){await new Promise(r=>setTimeout(r,1100));const q=(await rest('t8402',{focode:rows[0].shcode})).t8402OutBlock;console.log('t8402:',JSON.stringify({code:rows[0].shcode,lastmonth:q.lastmonth,shcode:q.shcode,price:q.price,baseprice:q.baseprice}));}
  return;
 }
 const ws=new WebSocket('wss://openapi.ls-sec.co.kr:9443/websocket',{handshakeTimeout:10000});
 await new Promise(resolve=>{
  const timer=setTimeout(()=>{ws.terminate();resolve();},12000);
  ws.on('open',()=>{for(const [i,tr] of ['VI_','NVI'].entries())setTimeout(()=>ws.send(JSON.stringify({header:{token:data.access_token,tr_type:'3'},body:{tr_cd:tr,tr_key:tr==='VI_'?'000000':'N000000   '}})),i*500);});
  ws.on('message',raw=>{try{const m=JSON.parse(String(raw));console.log(JSON.stringify({tr:m.header?.tr_cd,code:m.header?.rsp_cd,message:m.header?.rsp_msg,key:m.header?.tr_key,bodyFields:Object.keys(m.body||{})}));}catch{}});
  ws.on('error',()=>{console.log('WS connection error');});
  ws.on('close',()=>{clearTimeout(timer);resolve();});
 });
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
