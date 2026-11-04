'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dayKey = t => new Date(t+9*3600000).toISOString().slice(0,10);
const num = v => v == null || String(v).trim()==='' || !Number.isFinite(Number(v)) ? null : Number(v);
function viDirection(body, kind) {
    const trigger=num(body.vi_trgprice);
    const references=(kind==='1'?[body.svi_recprice]:kind==='2'?[body.dvi_recprice]:[body.svi_recprice,body.dvi_recprice]).map(num);
    if(!(trigger>0)||references.some(price=>!(price>0)))return null;
    const directions=references.map(price=>Math.sign(trigger-price));
    return directions.every(d=>d===1)?'up':directions.every(d=>d===-1)?'down':null;
}
const codeOf = b => [b.ex_shcode,b.ref_shcode,b.shcode].map(v=>String(v||'').trim()).map(v=>/^N([0-9A-Z]{6})$/.exec(v)?.[1] || v).find(v=>/^[0-9A-Z]{6}$/.test(v));
function eventTime(clock, now) {
    if(!/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(String(clock))) return null;
    return Date.parse(dayKey(now)+'T'+clock.slice(0,2)+':'+clock.slice(2,4)+':'+clock.slice(4,6)+'+09:00');
}
function createViMonitor({getToken,http=require('axios'),WebSocket=require('ws'),directory,now=Date.now,policy=()=>require('./trading-session').current()}={}) {
    let day=dayKey(now()), rows=new Map(), quotes=new Map(), stockMaster=new Map(), futuresMaster=[], masterDay='', masterTask;
    let socket, stopped=true, connecting=false, token='', retry, heartbeat, ackTimer, rotation, schedule, saveTimer, state='대기 중', storageError='', lastReceivedAt=null;
    let queue=Promise.resolve(), subscriptions=new Map(), pending=new Map(), enrichments=new Map(), reconnects=0, emitTimer;
    const listeners=new Set(), acknowledged=new Set(), file=directory&&path.join(directory,'state.json');
    const initialWarning='수신 이전·연결 중단 중 VI 이력은 미확인입니다.';
    try {
        if(file && fs.existsSync(file)) {
            const saved=JSON.parse(fs.readFileSync(file,'utf8'));
            if(saved.day===day && Array.isArray(saved.rows)) for(const r of saved.rows.slice(-10000)) {
                if(r && /^[0-9A-Z]{6}$/.test(r.code) && ['KRX','NXT'].includes(r.exchange) && (Number.isFinite(r.startedAt)||r.startedAt===null) && Number.isFinite(r.lastEventAt) && typeof r.active==='boolean') rows.set(r.code+':'+r.exchange,r);
            }
        }
    } catch { storageError='VI 저장 자료 복구 실패'; }
    function persist() {
        clearTimeout(saveTimer);
        if(!file)return;
        saveTimer=setTimeout(()=>{try{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify({day,rows:[...rows.values()]}));fs.renameSync(file+'.tmp',file);storageError='';}catch{storageError='VI 저장 실패';}},100);
        saveTimer.unref?.();
    }
    function rollover() {
        if(day===dayKey(now()))return;
        day=dayKey(now());rows.clear();quotes.clear();masterDay='';enrichments.clear();persist();
        // Reconnect to drop subscriptions to the previous day's symbols.
        if(socket)socket.close();
    }
    const comparison=(price,base)=>price>0 && base>0?(price/base-1)*100:null;
    function snapshot() {
        rollover();
        return {day,connection:state,lastReceivedAt,storageError,historyWarning:initialWarning,acknowledged:[...acknowledged],
            rows:[...rows.values()].map(r=>{
                const krx=quotes.get('KRX:'+r.code),nxt=quotes.get('NXT:'+r.code);
                const contracts={};
                for(const [i,key] of ['recent','next'].entries()) {
                    const contract=r.contracts?.[i];const quote=contract&&quotes.get('FUT:'+contract.code);
                    contracts[key]=contract?{...contract,price:quote?.price??null,receivedAt:quote?.receivedAt??null,rate:comparison(quote?.price,krx?.price)}:null;
                }
                return {...r,rate:krx?.rate??null,amount:krx?.amount??null,krxPrice:krx?.price??null,nxtRate:comparison(nxt?.price,krx?.price),krxReceivedAt:krx?.receivedAt??null,nxtReceivedAt:nxt?.receivedAt??null,futures:contracts};
            }).sort((a,b)=>b.startedAt-a.startedAt||a.code.localeCompare(b.code))};
    }
    function emit(){
        if(emitTimer||!listeners.size)return;
        emitTimer=setTimeout(()=>{emitTimer=null;const data=snapshot();for(const listener of listeners)listener(data);},50);emitTimer.unref?.();
    }
    async function rest(tr,endpoint,params) {
        const task=queue.then(async()=>{
            const response=await http.post('https://openapi.ls-sec.co.kr:8080/'+endpoint,{[tr+'InBlock']:params},{headers:{authorization:'Bearer '+await getToken(),'Content-Type':'application/json; charset=UTF-8',tr_cd:tr,tr_cont:'N',tr_cont_key:''},timeout:15000});
            if(String(response.data?.rsp_cd)!=='00000')throw Error('LS '+tr+' 조회 실패');
            return response.data;
        });
        queue=task.catch(()=>{}).then(()=>new Promise(resolve=>{const timer=setTimeout(resolve,1050);timer.unref?.();}));
        return task;
    }
    async function masters() {
        if(masterDay===day)return;
        if(masterTask)return masterTask;
        masterTask=(async()=>{
            const stocks=await rest('t8436','stock/etc',{gubun:'0'});
            if(!Array.isArray(stocks.t8436OutBlock))throw Error('LS 종목 마스터 형식 오류');
            stockMaster=new Map(stocks.t8436OutBlock.map(r=>[r.shcode,{name:r.hname,market:r.gubun==='1'?'K':r.gubun==='2'?'Q':'-'}]));
            const futures=await rest('t8401','futureoption/market-data',{dummy:''});
            if(!Array.isArray(futures.t8401OutBlock))throw Error('LS 선물 마스터 형식 오류');
            futuresMaster=futures.t8401OutBlock;masterDay=day;
        })().finally(()=>{masterTask=null;});return masterTask;
    }
    function send(tr,key) {
        const id=tr+':'+key;
        if(subscriptions.has(id))return;
        // A bounded queue avoids flooding registration requests when multiple VIs arrive together.
        subscriptions.set(id,{tr,key});pending.set(id,{tr,key});drain();
    }
    function drain() {
        if(!socket || socket.readyState!==WebSocket.OPEN || !pending.size)return;
        const [id,sub]=pending.entries().next().value;pending.delete(id);
        socket.send(JSON.stringify({header:{token,tr_type:'3'},body:{tr_cd:sub.tr,tr_key:sub.key}}));
        if(pending.size){const timer=setTimeout(drain,100);timer.unref?.();}
    }
    function watchStock(code) {
        const master=stockMaster.get(code);
        if(master?.market)send(master.market==='Q'?'K3_':'S3_',code);
        send('NS3','N'+code+'   ');
    }
    async function enrich(code) {
        if(enrichments.has(code))return enrichments.get(code);
        const requestDay=day;
        const task=(async()=>{
            await masters();if(day!==requestDay)return;watchStock(code);
            for(const r of rows.values())if(r.code===code)Object.assign(r,stockMaster.get(code));
            const spot=await rest('t1102','stock/market-data',{shcode:code});
            const p=spot.t1102OutBlock;
            if(day!==requestDay)return;
            // Do not overwrite a newer streaming quote with an older REST response.
            if(p && !quotes.has('KRX:'+code))quotes.set('KRX:'+code,{price:num(p.price),rate:num(p.diff),amount:num(p.value),receivedAt:now(),source:'REST'});
            const contracts=[];
            const candidates=futuresMaster.filter(f=>String(f.basecode).trim().replace(/^A(?=[0-9A-Z]{6}$)/,'')===code && /^[A-Z0-9]{8}$/.test(f.shcode) && !/스프레드|\bSP\b|SPREAD/i.test(f.hname||''));
            // The actual LS master uses A005930, and names include a YYYYMM contract month.
            // Verify expiry via t8402, visiting the nearest named months first.
            candidates.sort((a,b)=>String(a.hname?.match(/20\d{4}/)?.[0]||'999999').localeCompare(String(b.hname?.match(/20\d{4}/)?.[0]||'999999')));
            for(const f of candidates) {
                const d=(await rest('t8402','futureoption/market-data',{focode:f.shcode})).t8402OutBlock;
                if(day!==requestDay)return;
                const expiry=String(d?.lastmonth||'').replaceAll('-','');
                if(!/^\d{8}$/.test(expiry) || expiry<day.replaceAll('-',''))continue;
                contracts.push({code:f.shcode,name:f.hname,expiry});
                if(!quotes.has('FUT:'+f.shcode))quotes.set('FUT:'+f.shcode,{price:num(d.price),receivedAt:now(),source:'REST'});
                if(contracts.length===2)break;
            }
            contracts.sort((a,b)=>a.expiry.localeCompare(b.expiry)||a.code.localeCompare(b.code));
            const selected=contracts.slice(0,2);
            for(const r of rows.values())if(r.code===code){r.contracts=selected;r.detailError='';}
            for(const f of selected)send('JC0',f.code);
            persist();emit();
        })().catch(()=>{for(const r of rows.values())if(r.code===code)r.detailError='종목·가격·월물 조회 실패';enrichments.delete(code);emit();});
        enrichments.set(code,task);return task;
    }
    function receive(raw) {
        let m;try{m=typeof raw==='object'&&!Buffer.isBuffer(raw)?raw:JSON.parse(String(raw));}catch{return;}
        const tr=m.header?.tr_cd,b=m.body||{};
        if(!['VI_','NVI','S3_','K3_','NS3','JC0'].includes(tr))return;
        rollover();
        const responseCode=m.header?.rsp_cd;
        if(responseCode!=null) {
            if(!['00000','000000','0'].includes(String(responseCode))) {state=tr+' 구독 거부';emit();return;}
            acknowledged.add(tr);
            if(acknowledged.has('VI_')&&acknowledged.has('NVI')){clearTimeout(ackTimer);state='VI 실시간 구독 중';reconnects=0;}
            emit();
        }
        const code=tr==='JC0'?String(b.futcode||''):codeOf(b);
        if(!code)return;
        if(tr==='VI_' || tr==='NVI') {
            const kind=String(b.vi_gubun),at=eventTime(String(b.time||''),now()),exchange=tr==='VI_'?'KRX':'NXT';
            if(!['0','1','2','3'].includes(kind) || at===null || at>now()+60000)return;
            const key=code+':'+exchange,old=rows.get(key);
            if(old && at<old.lastEventAt)return;
            lastReceivedAt=now();
            if(kind==='0') {
                if(old && old.active){old.active=false;old.releasedAt=at;old.lastEventAt=at;}
                // A release without a start cannot provide a real activation timestamp.
                else if(!old)rows.set(key,{code,exchange,name:stockMaster.get(code)?.name||code,market:stockMaster.get(code)?.market||'-',kind:null,startedAt:null,lastEventAt:at,releasedAt:at,active:false,detailError:'발동 이벤트 미수신'});
            } else if(!old || !old.active || old.kind!==kind || old.startedAt!==at) {
                rows.set(key,{code,exchange,...(stockMaster.get(code)||{name:code,market:'-'}),kind,direction:viDirection(b,kind),startedAt:at,lastEventAt:at,releasedAt:null,active:true,contracts:old?.contracts||[],count:(old?.count||0)+1});
            }
            if(!stopped)void enrich(code);persist();emit();return;
        }
        if(!(num(b.price)>0)||!/^\d{6}$/.test(String(b.chetime||'')))return;
        const exchange=tr==='JC0'?'FUT':tr==='NS3'?'NXT':'KRX';
        const sourceAt=eventTime(String(b.chetime),now());
        const old=quotes.get(exchange+':'+code);
        if(sourceAt===null || (old?.sourceAt && sourceAt<old.sourceAt))return;
        // LS stock tick value is million KRW; preserve that unit for the table.
        quotes.set(exchange+':'+code,{price:num(b.price),rate:num(b.drate),amount:num(b.value),receivedAt:now(),sourceAt,source:'WS'});
        lastReceivedAt=now();emit();
    }
    function cleanup(){clearInterval(heartbeat);clearTimeout(ackTimer);clearTimeout(rotation);}
    async function connect() {
        if(stopped||socket||connecting)return;
        if(policy()&&!policy().spotAt(now())){state='장외 · 당일 수신 이력';emit();return;}
        connecting=true;state='LS VI 연결 중';emit();
        try {
            token=await getToken();if(stopped)return;
            const ws=new WebSocket('wss://openapi.ls-sec.co.kr:9443/websocket',{handshakeTimeout:10000,maxPayload:262144});socket=ws;
            ws.on('open',()=>{
                if(stopped||socket!==ws)return;
                acknowledged.clear();subscriptions.clear();pending.clear();
                // These keys were accepted by LS in the subscription probe. Whole-market event delivery still requires a live-session check.
                send('VI_','000000');send('NVI','N000000   ');
                state='VI 구독 확인 중';emit();
                ackTimer=setTimeout(()=>{state='VI 구독 응답 지연';emit();ws.terminate();},15000);ackTimer.unref?.();
                let alive=true;ws.on('pong',()=>{alive=true;});
                heartbeat=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},30000);heartbeat.unref?.();
                rotation=setTimeout(()=>ws.close(),55*60000);rotation.unref?.();
                for(const r of rows.values()){watchStock(r.code);for(const f of r.contracts||[])send('JC0',f.code);void enrich(r.code);}
            });
            ws.on('message',raw=>{if(socket===ws)receive(raw);});
            ws.on('error',()=>{if(socket===ws){state='LS 연결 오류';emit();ws.terminate();}});
            ws.on('close',()=>{
                if(socket!==ws)return;cleanup();socket=null;state='연결 중단 · 재연결 중';emit();
                if(!stopped){retry=setTimeout(()=>void connect(),Math.min(60000,2000*2**Math.min(reconnects++,5)));retry.unref?.();}
            });
        } catch {state='LS 인증·연결 실패';emit();if(!stopped){retry=setTimeout(()=>void connect(),30000);retry.unref?.();}}
        finally{connecting=false;}
    }
    function start(){if(!stopped)return;stopped=false;void connect();schedule=setInterval(()=>{rollover();if(policy()&&!policy().spotAt(now())&&socket)socket.close();else if(!socket)void connect();},30000);schedule.unref?.();}
    function stop(){stopped=true;clearTimeout(retry);clearTimeout(emitTimer);clearInterval(schedule);cleanup();socket?.terminate();socket=null;}
    // Stop the new-VI blink for one activation; a later activation creates a fresh row and blinks again.
    function dismissFlash(code,exchange,startedAt) {
        rollover();
        const row=rows.get(code+':'+exchange);
        if(!row||!row.active||row.startedAt!==startedAt)return false;
        if(!row.flashDismissed){row.flashDismissed=true;persist();emit();}
        return true;
    }
    return {start,stop,receive,snapshot,dismissFlash,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);}};
}
module.exports={createViMonitor,eventTime,codeOf};
