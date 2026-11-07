'use strict';
// VI monitor (2026-11-07 layout):
//  - VI 발동·해제 (KRX · NXT): Kiwoom realtime 1h, one websocket.
//  - Current prices of VI stocks (KRX · NXT · stock futures): NH realtime oc/nc/vC through quoteFeed.
//  - Stock names, futures mapping and expiry: LS t8436 · t8401 · t8402, fetched once a day and saved.
// LS VI_ matched Kiwoom on all 3,110 KRX VIs (2026-11-05); LS NVI has no whole-market key (2026-11-06),
// so the LS websocket is no longer used here and LS keeps only the market alert (JIF) session.
const fs = require('node:fs');
const path = require('node:path');
const dayKey = t => new Date(t+9*3600000).toISOString().slice(0,10);
const num = v => v == null || String(v).trim()==='' || !Number.isFinite(Number(v)) ? null : Number(v);
const price = v => { const n = num(v); return n == null ? null : Math.abs(n); };
const KIWOOM_SOCKET = 'wss://api.kiwoom.com:10000/api/dostk/websocket';
function eventTime(clock, now) {
    if(!/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(String(clock))) return null;
    return Date.parse(dayKey(now)+'T'+clock.slice(0,2)+':'+clock.slice(2,4)+':'+clock.slice(4,6)+'+09:00');
}
// Direction from the trigger price against the static/dynamic reference prices of the activated kind.
function priceDirection(trigger, staticRef, dynamicRef, kind) {
    const references=(kind==='1'?[staticRef]:kind==='2'?[dynamicRef]:[staticRef,dynamicRef]).map(price);
    if(!(price(trigger)>0)||references.some(p=>!(p>0)))return null;
    const directions=references.map(p=>Math.sign(price(trigger)-p));
    return directions.every(d=>d===1)?'up':directions.every(d=>d===-1)?'down':null;
}
// Kiwoom realtime 1h, observed 2026-11-04~05:
//  item 005930 = KRX, 005930_NX = NXT, 005930_AL = SOR (the same VI once more, so it is skipped).
//  1223 발동 시각. 1224 해제 시각: 000000 while active; a release repeats 1223 and 9068, so its time is 1224.
//  9068 1 정적, 2 동적, 3 동적+정적 (4 VI 연장 is not a new activation). 9069 1 상승, 2 하락.
//  9008 001 KOSPI, 101 KOSDAQ. 1221 발동가, 1236 정적 기준가, 1237 동적 기준가.
function parseKiwoomVi(d) {
    if(d?.type!=='1h')return null;
    const v=d.values||{},item=String(d.item||v['9001']||'').trim();
    const match=/^A?([0-9A-Z]{6})(?:_(NX|AL))?$/.exec(item);
    if(!match||match[2]==='AL')return null;
    const releaseClock=String(v['1224']||'').trim(),released=/^\d{6}$/.test(releaseClock)&&releaseClock!=='000000';
    const kind=released?'0':String(v['9068']||'').trim();
    if(!['0','1','2','3'].includes(kind))return null;
    const raw=String(v['9068']||'').trim(),sign=String(v['9069']||'').trim();
    return {code:match[1],exchange:match[2]==='NX'?'NXT':'KRX',kind,clock:released?releaseClock:String(v['1223']||'').trim(),
        direction:sign==='1'?'up':sign==='2'?'down':priceDirection(v['1221'],v['1236'],v['1237'],raw),
        market:{'001':'K','101':'Q'}[String(v['9008']||'').trim()]||null};
}
function createViMonitor({getToken,http=require('axios'),WebSocket=require('ws'),directory,now=Date.now,policy=()=>require('./trading-session').current(),
    enabled=()=>true,kiwoomToken,rejectKiwoomToken=()=>{},quoteFeed=null,releaseGraceMs=180000}={}) {
    let day=dayKey(now()), rows=new Map(), quotes=new Map(), masterDay='', stockMaster=new Map(), futuresMaster=[], expiries={}, masterTask;
    let socket, stopped=true, connecting=false, retry, ackTimer, regTimer, schedule, saveTimer, masterTimer, emitTimer, registered=0, reconnects=0;
    let state='대기 중', storageError='', lastReceivedAt=null;
    const listeners=new Set(), enrichments=new Map(), releaseTimers=new Map(), file=directory&&path.join(directory,'state.json'),masterFile=directory&&path.join(directory,'masters.json');
    const initialWarning='수신 이전·연결 중단 중 VI 이력은 미확인입니다.';
    const disabledState='이 서버에서는 VI 수신을 꺼 두었습니다 (로컬 서버에서 수신)';
    try {
        if(file && fs.existsSync(file)) {
            const saved=JSON.parse(fs.readFileSync(file,'utf8'));
            if(saved.day===day && Array.isArray(saved.rows)) for(const r of saved.rows.slice(-10000)) {
                if(r && /^[0-9A-Z]{6}$/.test(r.code) && ['KRX','NXT'].includes(r.exchange) && (Number.isFinite(r.startedAt)||r.startedAt===null) && Number.isFinite(r.lastEventAt) && typeof r.active==='boolean') rows.set(r.code+':'+r.exchange,r);
            }
        }
    } catch { storageError='VI 저장 자료 복구 실패'; }
    // The LS masters are fetched once a day and kept on disk, so a restart does not query them again.
    try {
        const saved=masterFile&&fs.existsSync(masterFile)&&JSON.parse(fs.readFileSync(masterFile,'utf8'));
        if(saved&&saved.day===day&&Array.isArray(saved.stocks)&&Array.isArray(saved.futures)) {
            stockMaster=new Map(saved.stocks.filter(s=>Array.isArray(s)&&/^[0-9A-Z]{6}$/.test(s[0])).map(([code,name,market])=>[code,{name,market}]));
            futuresMaster=saved.futures;expiries=saved.expiries&&typeof saved.expiries==='object'?saved.expiries:{};masterDay=day;
        }
    } catch {}
    function persist() {
        clearTimeout(saveTimer);
        if(!file)return;
        saveTimer=setTimeout(()=>{try{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify({day,rows:[...rows.values()]}));fs.renameSync(file+'.tmp',file);storageError='';}catch{storageError='VI 저장 실패';}},100);
        saveTimer.unref?.();
    }
    function persistMasters() {
        clearTimeout(masterTimer);
        if(!masterFile||masterDay!==day)return;
        masterTimer=setTimeout(()=>{try{fs.mkdirSync(directory,{recursive:true});
            fs.writeFileSync(masterFile+'.tmp',JSON.stringify({day,stocks:[...stockMaster].map(([code,s])=>[code,s.name,s.market]),futures:futuresMaster,expiries}));
            fs.renameSync(masterFile+'.tmp',masterFile);}catch{storageError='LS 종목 정보 저장 실패';}},100);
        masterTimer.unref?.();
    }
    function rollover() {
        if(day===dayKey(now()))return;
        day=dayKey(now());rows.clear();quotes.clear();masterDay='';expiries={};enrichments.clear();
        for(const [code,timer] of releaseTimers){clearTimeout(timer);quoteFeed?.unwatch(code);}releaseTimers.clear();
        persist();
    }
    const comparison=(p,base)=>p>0 && base>0?(p/base-1)*100:null;
    function quoteState() {
        if(!quoteFeed)return 'NH 현재가 미설정';
        const s=quoteFeed.state();
        return s.wanted?`NH 현재가 실시간 ${s.subscribed}건 · 조회 ${s.rest}건`:'NH 현재가 대기';
    }
    function snapshot() {
        rollover();
        return {day,connection:state,quoteConnection:quoteState(),lastReceivedAt,storageError,historyWarning:initialWarning,
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
    let queue=Promise.resolve();
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
            const futures=await rest('t8401','futureoption/market-data',{dummy:''});
            if(!Array.isArray(futures.t8401OutBlock))throw Error('LS 선물 마스터 형식 오류');
            stockMaster=new Map(stocks.t8436OutBlock.map(r=>[r.shcode,{name:r.hname,market:r.gubun==='1'?'K':r.gubun==='2'?'Q':'-'}]));
            futuresMaster=futures.t8401OutBlock.map(f=>({basecode:f.basecode,shcode:f.shcode,hname:f.hname}));expiries={};masterDay=day;persistMasters();
        })().finally(()=>{masterTask=null;});return masterTask;
    }
    // Expiry per futures code (t8402) is part of the saved daily masters; its price only seeds the first quote.
    async function expiryOf(code) {
        if(expiries[code]!==undefined)return {expiry:expiries[code],price:null};
        const d=(await rest('t8402','futureoption/market-data',{focode:code})).t8402OutBlock;
        const expiry=String(d?.lastmonth||'').replaceAll('-','');
        expiries[code]=/^\d{8}$/.test(expiry)?expiry:'';persistMasters();
        return {expiry:expiries[code],price:num(d?.price)};
    }
    const activeCode=code=>[...rows.values()].some(r=>r.code===code&&r.active);
    function watchQuotes(code,futures) {
        clearTimeout(releaseTimers.get(code));releaseTimers.delete(code);
        quoteFeed?.watch(code,{futures});
    }
    // NH slots are limited (30 per connection): stop a stock's prices a while after its last VI ends.
    function scheduleUnwatch(code) {
        if(!quoteFeed||activeCode(code)||releaseTimers.has(code))return;
        const timer=setTimeout(()=>{releaseTimers.delete(code);if(!activeCode(code))quoteFeed.unwatch(code);},releaseGraceMs);timer.unref?.();
        releaseTimers.set(code,timer);
    }
    async function enrich(code) {
        if(enrichments.has(code))return enrichments.get(code);
        const requestDay=day;
        const task=(async()=>{
            await masters();if(day!==requestDay)return;
            for(const r of rows.values())if(r.code===code){const m=stockMaster.get(code);if(m){r.name=m.name;if(!r.market||r.market==='-')r.market=m.market;}}
            emit();
            const contracts=[];
            const candidates=futuresMaster.filter(f=>String(f.basecode).trim().replace(/^A(?=[0-9A-Z]{6}$)/,'')===code && /^[A-Z0-9]{8}$/.test(f.shcode) && !/스프레드|\bSP\b|SPREAD/i.test(f.hname||''));
            // The LS master uses A005930 and names carry a YYYYMM contract month; check the nearest months first.
            candidates.sort((a,b)=>String(a.hname?.match(/20\d{4}/)?.[0]||'999999').localeCompare(String(b.hname?.match(/20\d{4}/)?.[0]||'999999')));
            for(const f of candidates) {
                const {expiry,price:first}=await expiryOf(f.shcode);
                if(day!==requestDay)return;
                if(!expiry || expiry<day.replaceAll('-',''))continue;
                contracts.push({code:f.shcode,name:f.hname,expiry});
                if(first>0 && !quotes.has('FUT:'+f.shcode))quotes.set('FUT:'+f.shcode,{price:first,receivedAt:now(),source:'LS'});
                if(contracts.length===2)break;
            }
            contracts.sort((a,b)=>a.expiry.localeCompare(b.expiry)||a.code.localeCompare(b.code));
            const selected=contracts.slice(0,2);
            for(const r of rows.values())if(r.code===code){r.contracts=selected;r.detailError='';}
            if(activeCode(code)||releaseTimers.has(code))quoteFeed?.watch(code,{futures:selected.map(c=>c.code)});
            persist();emit();
        })().catch(()=>{for(const r of rows.values())if(r.code===code)r.detailError='종목·월물 조회 실패';enrichments.delete(code);emit();});
        enrichments.set(code,task);return task;
    }
    function applyVi(e) {
        rollover();
        const at=eventTime(e.clock,now());
        if(at===null || at>now()+60000)return;
        const key=e.code+':'+e.exchange,old=rows.get(key),master=stockMaster.get(e.code);
        if(old && at<old.lastEventAt)return;
        lastReceivedAt=now();
        if(e.kind==='0') {
            if(old && old.active){old.active=false;old.releasedAt=at;old.lastEventAt=at;}
            // A release without a start cannot provide a real activation timestamp.
            else if(!old)rows.set(key,{code:e.code,exchange:e.exchange,name:master?.name||e.code,market:e.market||master?.market||'-',kind:null,startedAt:null,lastEventAt:at,releasedAt:at,active:false,detailError:'발동 이벤트 미수신'});
        } else if(!old || !old.active || old.kind!==e.kind || old.startedAt!==at) {
            rows.set(key,{code:e.code,exchange:e.exchange,name:master?.name||old?.name||e.code,market:e.market||master?.market||'-',kind:e.kind,direction:e.direction,startedAt:at,lastEventAt:at,releasedAt:null,active:true,contracts:old?.contracts||[],count:(old?.count||0)+1});
        }
        if(!stopped){
            if(activeCode(e.code))watchQuotes(e.code,(rows.get(key)?.contracts||[]).map(c=>c.code));else scheduleUnwatch(e.code);
            void enrich(e.code);
        }
        persist();emit();
    }
    function onQuote(q) {
        if(!['KRX','NXT','FUT'].includes(q.exchange)||!(q.price>0))return;
        const id=q.exchange+':'+q.key,old=quotes.get(id);
        quotes.set(id,{price:q.price,rate:q.rate??old?.rate??null,amount:q.amount??old?.amount??null,amountVia:q.amount!=null?q.via:old?.amountVia,
            amountAt:q.amount!=null?q.receivedAt??now():old?.amountAt,receivedAt:q.receivedAt??now(),source:'NH '+(q.via==='WS'?'실시간':'조회')});
        emit();
    }
    // Unit check of NH trade value (million KRW, like the trading tab tables): when the Kiwoom table
    // (ka10032 · ka00198, million KRW) lists a VI stock, record both values. Kiwoom _AL is KRX+NXT and NH oc
    // is KRX only, so a ratio near 1 (not 1,000 or 0.001) confirms the unit. One line per stock per 10 minutes.
    const amountChecked=new Map();
    function compareAmounts(source,items) {
        if(!directory||!Array.isArray(items))return 0;
        let written=0;
        for(const item of items) {
            const code=String(item?.code||'').replace(/^A/,'').replace(/_(AL|NX)$/,''),kiwoom=num(String(item?.amount??'').replace(/[+,]/g,''));
            const quote=quotes.get('KRX:'+code);
            if(!quote||!(quote.amount>0)||!(kiwoom>0)||now()-(quote.amountAt||0)>120000||now()-(amountChecked.get(code)||0)<600000)continue;
            amountChecked.set(code,now());
            try{fs.mkdirSync(directory,{recursive:true});fs.appendFileSync(path.join(directory,'amount-check-'+day+'.jsonl'),JSON.stringify({at:new Date(now()).toISOString(),code,source,
                kiwoomMillion:kiwoom,nhMillion:quote.amount,nhVia:quote.amountVia,nhAgeMs:now()-quote.amountAt,ratio:Math.round(quote.amount/kiwoom*1000)/1000})+'\n');written++;}catch{}
        }
        return written;
    }
    function receive(raw) {
        let m;try{m=typeof raw==='object'&&!Buffer.isBuffer(raw)?raw:JSON.parse(String(raw));}catch{return;}
        if(m.trnm==='PING'){socket?.send(typeof raw==='string'||Buffer.isBuffer(raw)?String(raw):JSON.stringify(m));return;}
        if(m.trnm==='LOGIN') {
            if(String(m.return_code)!=='0'){state='키움 로그인 거부';rejectKiwoomToken();emit();socket?.close();return;}
            registered=0;state='VI 등록 확인 중';emit();
            // Group 1: the whole market (KRX, plus SOR copies). Group 2: NXT (_NX).
            socket?.send(JSON.stringify({trnm:'REG',grp_no:'1',refresh:'1',data:[{item:[''],type:['1h']}]}));
            const ws=socket;regTimer=setTimeout(()=>{if(socket===ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({trnm:'REG',grp_no:'2',refresh:'1',data:[{item:['_NX'],type:['1h']}]}));},1000);regTimer.unref?.();
            return;
        }
        if(m.trnm==='REG') {
            if(String(m.return_code)!=='0'){state='키움 VI 등록 거부';emit();socket?.close();return;}
            if(++registered>=2){clearTimeout(ackTimer);state='VI 실시간 수신 중';reconnects=0;}
            emit();return;
        }
        if(m.trnm!=='REAL'||!Array.isArray(m.data))return;
        for(const d of m.data){const e=parseKiwoomVi(d);if(e)applyVi(e);}
    }
    function cleanup(){clearTimeout(ackTimer);clearTimeout(regTimer);}
    async function connect() {
        if(stopped||socket||connecting)return;
        if(policy()&&!policy().spotAt(now())){state='장외 · 당일 수신 이력';emit();return;}
        connecting=true;state='키움 VI 연결 중';emit();
        try {
            const token=await kiwoomToken();if(stopped)return;
            const ws=new WebSocket(KIWOOM_SOCKET,{handshakeTimeout:10000,maxPayload:1048576});socket=ws;
            ws.on('open',()=>{
                if(stopped||socket!==ws)return;
                ws.send(JSON.stringify({trnm:'LOGIN',token}));state='키움 로그인 확인 중';emit();
                ackTimer=setTimeout(()=>{state='키움 VI 등록 응답 지연';emit();ws.terminate();},15000);ackTimer.unref?.();
            });
            ws.on('message',raw=>{if(socket===ws)receive(raw);});
            ws.on('error',()=>{if(socket===ws){state='키움 연결 오류';emit();ws.terminate();}});
            ws.on('close',()=>{
                if(socket!==ws)return;cleanup();socket=null;if(state==='VI 실시간 수신 중')state='연결 중단 · 재연결 중';emit();
                if(!stopped){retry=setTimeout(()=>void connect(),Math.min(60000,2000*2**Math.min(reconnects++,5)));retry.unref?.();}
            });
        } catch {state='키움 인증·연결 실패';emit();if(!stopped){retry=setTimeout(()=>void connect(),30000);retry.unref?.();}}
        finally{connecting=false;}
    }
    function start(){
        if(!enabled()){state=disabledState;emit();return;}
        if(!stopped)return;stopped=false;quoteFeed?.start();
        // Prices for VIs still active after a restart.
        for(const r of rows.values())if(r.active){watchQuotes(r.code,(r.contracts||[]).map(c=>c.code));void enrich(r.code);}
        void connect();
        schedule=setInterval(()=>{rollover();if(policy()&&!policy().spotAt(now())&&socket)socket.close();else if(!socket)void connect();},30000);schedule.unref?.();
    }
    function stop(){stopped=true;clearTimeout(retry);clearTimeout(emitTimer);clearInterval(schedule);cleanup();for(const t of releaseTimers.values())clearTimeout(t);releaseTimers.clear();quoteFeed?.stop();socket?.terminate();socket=null;}
    // Stop the new-VI blink for one activation; a later activation creates a fresh row and blinks again.
    function dismissFlash(code,exchange,startedAt) {
        rollover();
        const row=rows.get(code+':'+exchange);
        if(!row||!row.active||row.startedAt!==startedAt)return false;
        if(!row.flashDismissed){row.flashDismissed=true;persist();emit();}
        return true;
    }
    if(!enabled())state=disabledState;
    return {start,stop,receive,onQuote,compareAmounts,snapshot,dismissFlash,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);}};
}
module.exports={createViMonitor,eventTime,parseKiwoomVi};
