'use strict';
require('dotenv').config({ quiet:true });
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const WebSocket = require('ws');
const { createQuoteCadence } = require('../quote-cadence');
const arg = (name,fallback) => { const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1]; };
async function main() {
    const stock=arg('stock','005930'), market=arg('market','KOSPI'), seconds=Number(arg('seconds','300'));
    let future=arg('future','');
    if(!/^\d{6}$/.test(stock) || !['KOSPI','KOSDAQ'].includes(market) || (future && future!=='auto' && !/^[A-Z0-9]{8}$/.test(future)) || !Number.isFinite(seconds) || seconds<1 || seconds>3600) throw Error('인수를 확인하세요: --stock 6자리 --market KOSPI|KOSDAQ --future auto|8자리 --seconds 1~3600');
    if(!process.env.LS_APPKEY || !process.env.LS_SECRETKEY) throw Error('프로젝트 .env의 LS_APPKEY / LS_SECRETKEY가 필요합니다.');
    const response=await fetch('https://openapi.ls-sec.co.kr:8080/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',appkey:process.env.LS_APPKEY,appsecretkey:process.env.LS_SECRETKEY,scope:'oob'}),signal:AbortSignal.timeout(15000)});
    const auth=await response.json();
    if(!response.ok || !auth.access_token) throw Error('LS 토큰 발급 실패 (인증값은 출력하지 않음)');
    if(future==='auto') {
        const rest=async(tr,params)=>{
            const r=await fetch('https://openapi.ls-sec.co.kr:8080/futureoption/market-data',{method:'POST',headers:{authorization:'Bearer '+auth.access_token,'Content-Type':'application/json',tr_cd:tr,tr_cont:'N',tr_cont_key:''},body:JSON.stringify({[tr+'InBlock']:params}),signal:AbortSignal.timeout(15000)});
            const d=await r.json();if(d.rsp_cd!=='00000')throw Error(tr+' 조회 실패');return d;
        };
        const master=await rest('t8401',{dummy:''});
        const candidates=(master.t8401OutBlock||[]).filter(r=>String(r.basecode).trim().replace(/^A/,'')===stock&&!/\bSP\b|스프레드/i.test(r.hname||''));
        candidates.sort((a,b)=>String(a.hname.match(/20\d{4}/)?.[0]||'999999').localeCompare(String(b.hname.match(/20\d{4}/)?.[0]||'999999')));
        future='';const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10).replaceAll('-','');
        for(const candidate of candidates){await new Promise(r=>setTimeout(r,1100));const q=(await rest('t8402',{focode:candidate.shcode})).t8402OutBlock;if(/^\d{8}$/.test(q?.lastmonth)&&q.lastmonth>=today){future=candidate.shcode;break;}}
        if(!future)throw Error('해당 현물의 만기 전 주식선물을 찾지 못했습니다.');
        console.log('자동 매핑한 최근월 선물: '+future);
    }
    const cadence=createQuoteCadence(), acknowledgements=[], errors=[];
    const subscriptions=[{tr:market==='KOSPI'?'S3_':'K3_',key:stock},{tr:'NS3',key:'N'+stock+'   '},...(future?[{tr:'JC0',key:future}]:[])];
    const startedAt=new Date().toISOString(), start=performance.now();
    // One socket avoids clock differences between parallel processes. All channels share the same session.
    const ws=new WebSocket('wss://openapi.ls-sec.co.kr:9443/websocket',{handshakeTimeout:10000});
    await new Promise(resolve=>{
        let finished=false, opened=false;
        const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);ws.terminate();resolve();};
        let timer=setTimeout(finish,(seconds+15)*1000);
        ws.on('open',()=>{
            opened=true;clearTimeout(timer);timer=setTimeout(finish,seconds*1000);
            for(const sub of subscriptions) ws.send(JSON.stringify({header:{token:auth.access_token,tr_type:'3'},body:{tr_cd:sub.tr,tr_key:sub.key}}));
            console.log(`측정 시작: ${stock}, ${seconds}초 · KRX/NXT${future?'/선물':''}`);
        });
        ws.on('message',raw=>{
            let m;try{m=JSON.parse(String(raw));}catch{return;}
            const tr=m.header?.tr_cd;
            if(!cadence.receive(tr,m.body,performance.now()-start)) {
                // Store only whitelisted acknowledgement fields; never raw frames or tokens.
                if(m.header?.rsp_cd!=null || m.header?.rsp_msg!=null) acknowledgements.push({tr,code:String(m.header.rsp_cd||''),message:String(m.header.rsp_msg||'').slice(0,160)});
            }
        });
        ws.on('error',()=>{errors.push('WebSocket 연결 오류');finish();});
        ws.on('close',()=>{if(!finished) errors.push(opened?'측정 중 연결 종료':'연결 실패');finish();});
        process.once('SIGINT',finish);
    });
    const channels=cadence.snapshot();
    const result={startedAt,finishedAt:new Date().toISOString(),requestedSeconds:seconds,elapsedSeconds:(performance.now()-start)/1000,stock,market,future:future||null,subscriptions,acknowledgements,errors,channels,
        note:'체결 메시지만 집계. 수신 간격은 단조 시계 기준이며 네트워크 지연 포함. 무수신은 발행 주기 0을 뜻하지 않음. 가격 변경 횟수는 첫 관측 이후 기준.'};
    const directory=path.join(__dirname,'output','ls-quote-cadence');fs.mkdirSync(directory,{recursive:true});
    const output=path.join(directory,startedAt.replace(/[:.]/g,'-')+'.json');fs.writeFileSync(output,JSON.stringify(result,null,2));
    for(const s of subscriptions) {
        const found=channels.filter(c=>c.tr===s.tr);
        if(!found.length)console.log(`${s.tr}: 체결 데이터 미수신 (장 운영·구독 응답·대상 종목 확인 필요)`);
        for(const c of found)console.log(`${c.tr} ${c.code}: ${c.messages}건, 가격변경 ${c.priceChanges}회, 평균 ${c.meanMs?.toFixed(2)??'—'}ms, 중앙값 ${c.medianMs?.toFixed(2)??'—'}ms, p95 ${c.p95Ms?.toFixed(2)??'—'}ms, 최대 ${c.maxMs?.toFixed(2)??'—'}ms`);
    }
    console.log('결과: '+output);
    if(errors.length) process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
