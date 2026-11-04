'use strict';
// Records market-wide VI_ (KRX) and NVI (NXT) events for a fixed time and writes a summary.
// Usage: node dev/ls-vi-live-check.cjs --seconds 1800 --out outputs/vi-live-check-20261103
require('dotenv').config({ quiet:true });
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const arg = (name,fallback) => { const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1]; };
const seconds = Number(arg('seconds','1800'));
const out = path.resolve(arg('out','dev/output/vi-live-check'));
const kinds = {'0':'해제','1':'정적','2':'동적','3':'동적,정적'};
async function main() {
    if(!Number.isFinite(seconds)||seconds<1||seconds>14400) throw Error('--seconds는 1~14400');
    if(!process.env.LS_APPKEY||!process.env.LS_SECRETKEY) throw Error('프로젝트 .env의 LS_APPKEY / LS_SECRETKEY가 필요합니다.');
    fs.mkdirSync(out,{recursive:true});
    const log = fs.createWriteStream(path.join(out,'vi-events.jsonl'),{flags:'a'});
    const summary = {startedAt:new Date().toISOString(),seconds,acks:{},errors:[],closes:[],events:{VI_:0,NVI:0},byKind:{},stocks:{VI_:new Set(),NVI:new Set()},releasesWithStart:0,firstEventAt:null,lastEventAt:null};
    const response = await fetch('https://openapi.ls-sec.co.kr:8080/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',appkey:process.env.LS_APPKEY,appsecretkey:process.env.LS_SECRETKEY,scope:'oob'}),signal:AbortSignal.timeout(15000)});
    const auth = await response.json();
    if(!auth.access_token) throw Error('LS 토큰 발급 실패 (인증값은 출력하지 않음)');
    const started = new Map();
    const deadline = Date.now()+seconds*1000;
    // Reconnect on drops so a single disconnect does not end the whole check.
    while(Date.now()<deadline) {
        await new Promise(resolve=>{
            const ws = new WebSocket('wss://openapi.ls-sec.co.kr:9443/websocket',{handshakeTimeout:10000});
            const timer = setTimeout(()=>ws.close(),Math.max(0,deadline-Date.now()));
            ws.on('open',()=>{for(const [i,tr] of ['VI_','NVI'].entries())setTimeout(()=>ws.send(JSON.stringify({header:{token:auth.access_token,tr_type:'3'},body:{tr_cd:tr,tr_key:tr==='VI_'?'000000':'N000000   '}})),i*500);});
            ws.on('message',raw=>{
                let m;try{m=JSON.parse(String(raw));}catch{return;}
                const tr=m.header?.tr_cd;
                if(m.header?.rsp_cd){summary.acks[tr]={code:m.header.rsp_cd,message:m.header.rsp_msg};return;}
                if(!['VI_','NVI'].includes(tr)||!m.body)return;
                const b=m.body,code=String(b.ref_shcode||b.shcode||'').trim().replace(/^N/,''),kind=String(b.vi_gubun);
                const at=new Date().toISOString();
                summary.events[tr]++;summary.byKind[tr+':'+(kinds[kind]||kind)]=(summary.byKind[tr+':'+(kinds[kind]||kind)]||0)+1;
                summary.stocks[tr].add(code);summary.firstEventAt??=at;summary.lastEventAt=at;
                if(kind==='0'){if(started.has(tr+code))summary.releasesWithStart++;}else started.set(tr+code,true);
                log.write(JSON.stringify({receivedAt:at,tr,code,kind:kinds[kind]||kind,time:b.time,trigger:b.vi_trgprice,svi:b.svi_recprice,dvi:b.dvi_recprice})+'\n');
            });
            ws.on('error',e=>summary.errors.push(new Date().toISOString()+' '+e.message));
            ws.on('close',code=>{clearTimeout(timer);summary.closes.push(new Date().toISOString()+' '+code);setTimeout(resolve,Date.now()<deadline?3000:0);});
        });
    }
    log.end();
    const result={...summary,finishedAt:new Date().toISOString(),stocks:{VI_:summary.stocks.VI_.size,NVI:summary.stocks.NVI.size}};
    fs.writeFileSync(path.join(out,'vi-summary.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
