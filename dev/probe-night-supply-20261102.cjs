// One-off, read-only LS/DB/NH evidence collection. No production data writes.
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const WebSocket = require('ws');
const root = path.resolve(__dirname, '..');
require('dotenv').config({path:path.join(root,'.env'),quiet:true});
const start = Date.parse('2026-11-02T18:00:00+09:00');
const end = Date.parse('2026-11-02T21:43:00+09:00');
const output = path.join(root,'outputs','night-supply-probe-20261102');
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
const kst = t => new Date(t+9*3600000).toISOString().slice(0,19).replace('T',' ');
const brokers={LS:{prefix:'LS',domain:'https://openapi.ls-sec.co.kr:8080'},DB:{prefix:'DB',domain:'https://openapi.dbsec.co.kr:8443'},NH:{prefix:'NAMU',domain:'https://api.nhplug.com:8443'}};
const tokens=new Map();
const configured=broker=>['APPKEY','SECRETKEY'].every(s=>process.env[brokers[broker].prefix+'_'+s]?.trim());
async function accessToken(broker='LS'){
    const old=tokens.get(broker);if(old?.expires>Date.now()+60000)return old.token;
    const cfg=brokers[broker];if(!configured(broker))throw Error('Credentials missing');
    const response=await axios.post(cfg.domain+'/oauth2/token',new URLSearchParams({grant_type:'client_credentials',appkey:process.env[cfg.prefix+'_APPKEY'].trim(),appsecretkey:process.env[cfg.prefix+'_SECRETKEY'].trim(),scope:'oob'}).toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:15000});
    if(!response.data?.access_token)throw Error('Token unavailable');
    tokens.set(broker,{token:response.data.access_token,expires:Date.now()+Number(response.data.expires_in || 3600)*1000});return response.data.access_token;
}
function record(value){fs.appendFileSync(path.join(output,'observations.jsonl'),JSON.stringify(value)+'\n');}
let dbSocket,dbConnecting=false,stopping=false;
async function ensureDb(){
    if(stopping || dbConnecting || dbSocket && [WebSocket.OPEN,WebSocket.CONNECTING].includes(dbSocket.readyState))return;
    dbConnecting=true;
    try{
        const token=await accessToken('DB');
        const socket=dbSocket=new WebSocket('wss://openapi.dbsec.co.kr:7070/websocket',{handshakeTimeout:15000});
        socket.on('open',()=>{
            record({broker:'DB',at:kst(Date.now()),event:'connected'});
            for(const key of ['F001K2I','F002KQI'])socket.send(JSON.stringify({header:{token,tr_type:'1'},body:{tr_cd:'U05',tr_key:key}}));
        });
        socket.on('message',bytes=>{
            try{const message=JSON.parse(bytes.toString());
                // Never persist authentication headers. Only public market body.
                record({broker:'DB',at:kst(Date.now()),tr:message.header?.tr_cd,ack:message.header?.rsp_cd,body:message.body});
            }catch{record({broker:'DB',at:kst(Date.now()),event:'non_json_message'});}
        });
        socket.on('error',()=>record({broker:'DB',at:kst(Date.now()),event:'socket_error'}));
        socket.on('close',()=>record({broker:'DB',at:kst(Date.now()),event:'disconnected'}));
    }catch{record({broker:'DB',at:kst(Date.now()),event:'connection_failed'});}
    finally{dbConnecting=false;}
}
async function probeNh(){
    for(const market of ['3','6']){
        const entry={broker:'NH',at:kst(Date.now()),tr:'IVOUUJTUD04',market};
        try{
            const response=await axios.post(brokers.NH.domain+'/krfuture/quote/v1/tradingStatus',{Input_0:{market_cd:'KRX',mrkt_cls_code:market,cycle_cls_code:'4',opt_cls_code:'1',cnt:'999'}},{headers:{authorization:'Bearer '+await accessToken('NH'),'Content-Type':'application/json; charset=UTF-8',tr_cd:'IVOUUJTUD04'},timeout:15000});
            entry.rsp_cd=response.data?.rsp_cd;
            entry.rows=response.data?.Output_0;
            entry.continuation={flag:response.headers.cts_flag,key:response.headers.cts};
            if(String(entry.rsp_cd)!=='00000' || !Array.isArray(entry.rows))entry.error='upstream_error_or_invalid_response';
        }catch(error){entry.error='request_failed';entry.httpStatus=error.response?.status || null;}
        record(entry);await wait(300);
    }
}
function summarize(rows){
    const valid=rows.filter(row=>/^20261102$/.test(String(row.date)) && /^\d{6}$/.test(String(row.time)) && row.time>='180000' && row.time<='214259');
    const fields=['indmsamt','formsamt','sysmsamt'];
    const values=valid.filter(row=>fields.some(f=>row[f]!=null && String(row[f]).trim()!=='' && Number.isFinite(Number(row[f]))));
    return {returned:rows.length,inWindow:valid.length,withInvestorValues:values.length,first:values.map(r=>r.time).sort()[0] || null,last:values.map(r=>r.time).sort().at(-1) || null,program:'not_verified_no_documented_night_program_TR'};
}
async function main(){
    if(process.argv.includes('--dry-run')){
        console.log(JSON.stringify({startKst:kst(start),endExclusiveKst:kst(end),configured:Object.fromEntries(Object.keys(brokers).map(b=>[b,configured(b)])),output,program:'unverified_no_documented_night_program_TR'}));return;
    }
    if(Date.now()>=end)throw Error('Observation window already ended');
    fs.mkdirSync(output,{recursive:true});
    while(Date.now()<start)await wait(Math.min(30000,start-Date.now()));
    fs.appendFileSync(path.join(output,'status.jsonl'),JSON.stringify({at:kst(Date.now()),state:'started',brokers:Object.keys(brokers),program:'unverified_no_documented_night_program_TR',NH:'night_support_under_test',DB:'night_support_under_test'})+'\n');
    while(Date.now()<end){
        const tick=Date.now();
        await ensureDb();
        const nhTask=probeNh();
        for(const asset of ['K2I','KQI']){
            const record={at:kst(Date.now()),broker:'LS',tr:'t8463',asset};
            try{
                const response=await axios.post('https://openapi.ls-sec.co.kr:8080/futureoption/investor',{t8463InBlock:{tm_rng:'N',fot_clsf_cd:'F',bsc_asts_id:asset,cnt:999,bgubun:'0'}},{headers:{authorization:'Bearer '+await accessToken(),'Content-Type':'application/json; charset=UTF-8',tr_cd:'t8463',tr_cont:'N',tr_cont_key:''},timeout:15000});
                const data=response.data;
                record.rsp_cd=data?.rsp_cd;
                if(String(data?.rsp_cd)!=='00000' || !Array.isArray(data.t8463OutBlock1))record.error='upstream_error_or_invalid_response';
                else {record.rows=data.t8463OutBlock1;record.summary=summarize(record.rows);}
            }catch(error){record.error='request_failed';record.httpStatus=error.response?.status || null;}
            fs.appendFileSync(path.join(output,'observations.jsonl'),JSON.stringify(record)+'\n');
            await wait(1200);
        }
        await nhTask;
        await wait(Math.max(0,Math.min(end-Date.now(),tick+60000-Date.now())));
    }
    stopping=true;dbSocket?.terminate();
    fs.appendFileSync(path.join(output,'status.jsonl'),JSON.stringify({at:kst(Date.now()),state:'completed'})+'\n');
}
if(require.main===module)main().catch(()=>{console.error('Night supply probe failed; no credentials logged.');process.exitCode=1;});
module.exports={summarize,accessToken,probeNh,ensureDb};
