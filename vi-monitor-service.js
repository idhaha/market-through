'use strict';
// VI monitor (2026-11-07 layout; 2026-11-11: KRX · NXT · 선물 발동 거래소별 Base 괴리율, 선물 가격제한 이벤트 행):
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
    enabled=()=>true,kiwoomToken,rejectKiwoomToken=()=>{},quoteFeed=null,nxtBook=null,futuresBookMs=5000,log=()=>{},releaseGraceMs=180000,gapThreshold=1,recordMs=240000,releaseWaitMs=15000,futuresEventMs=300000,futuresEventsState=()=>'',recordTimer=(fn,ms)=>{const t=setTimeout(fn,ms);t.unref?.();return t;}}={}) {
    let day=dayKey(now()), rows=new Map(), quotes=new Map(), masterDay='', stockMaster=new Map(), futuresMaster=[], expiries={}, futuresRefs={}, futuresMul={}, masterTask;
    let socket, stopped=true, connecting=false, retry, ackTimer, regTimer, schedule, saveTimer, masterTimer, emitTimer, registered=0, reconnects=0;
    let state='대기 중', storageError='', lastReceivedAt=null;
    // 거래대금(전일기준) · 시가총액 필터(2026-11-10):
    //  - 상장주식수 · 전일 종가: 키움 ka10099(코스피 0 · 코스닥 10), 하루 1회.
    //  - 전일 거래대금: 키움 ka10081 일봉(종목코드_AL = KRX+NXT 통합, trde_prica 백만 원)의 오늘 전 마지막 날, VI가 난 종목만
    //    그날 처음 한 번 조회. 둘 다 filters.json에 따로 저장(LS 종목 정보 저장과 무관하게).
    //  - 시가총액(현 시점) = 상장주식수 × 지금 받은 현재가(KRX, 없으면 NXT, 없으면 전일 종가).
    let listInfo=new Map(), prevAmounts=new Map(), kiwoomListTask=null, kiwoomListDay='', kiwoomQueue=Promise.resolve();
    const prevTasks=new Map(), filterFile=directory&&path.join(directory,'filters.json');
    let filterTimer;
    try {
        const saved=filterFile&&fs.existsSync(filterFile)&&JSON.parse(fs.readFileSync(filterFile,'utf8'));
        if(saved&&saved.day===day) {
            if(Array.isArray(saved.kiwoomList)&&saved.kiwoomList.length){listInfo=new Map(saved.kiwoomList.map(([code,listCount,lastPrice])=>[code,{listCount,lastPrice}]));kiwoomListDay=day;}
            if(saved.prevAmounts&&typeof saved.prevAmounts==='object')prevAmounts=new Map(Object.entries(saved.prevAmounts));
        }
    } catch {}
    function persistFilters() {
        clearTimeout(filterTimer);if(!filterFile)return;
        filterTimer=setTimeout(()=>{try{fs.mkdirSync(directory,{recursive:true});
            fs.writeFileSync(filterFile+'.tmp',JSON.stringify({day,kiwoomList:kiwoomListDay===day?[...listInfo].map(([code,v])=>[code,v.listCount,v.lastPrice]):[],prevAmounts:Object.fromEntries(prevAmounts)}));
            fs.renameSync(filterFile+'.tmp',filterFile);}catch{storageError='필터 정보 저장 실패';}},100);
        filterTimer.unref?.();
    }
    const listeners=new Set(), enrichments=new Map(), releaseTimers=new Map(), file=directory&&path.join(directory,'state.json'),masterFile=directory&&path.join(directory,'masters.json');
    // 괴리율 1% 이상 기록(2026-11-09): VI 종목의 KRX · NXT · 선물 현재가를 받은 대로 모아 두었다가, 발동부터 해제 전까지
    // |괴리율|이 한 번이라도 gapThreshold(%) 이상이면 그 VI의 표 값과 발동부터 recordMs(4분) 동안의 각 시장 현재가를
    // gap-records/날짜.jsonl에 한 줄로 남긴다.
    const samples=new Map(), futureOwner=new Map(), records=new Map(), recordDirectory=directory&&path.join(directory,'gap-records');
    const initialWarning='수신 이전·연결 중단 중 VI 이력은 미확인입니다.';
    // Row key: one row per stock and triggering exchange; a futures event row also carries its contract.
    const rowKey=r=>r.code+':'+r.exchange+(r.exchange==='FUT'?':'+(r.contract?.code||''):'');
    const disabledState='이 서버에서는 VI 수신을 꺼 두었습니다 (로컬 PC 서버에서 수신)';
    try {
        if(file && fs.existsSync(file)) {
            const saved=JSON.parse(fs.readFileSync(file,'utf8'));
            if(saved.day===day && Array.isArray(saved.rows)) for(const r of saved.rows.slice(-10000)) {
                if(r && /^[0-9A-Z]{6}$/.test(r.code) && ['KRX','NXT','FUT'].includes(r.exchange) && (Number.isFinite(r.startedAt)||r.startedAt===null) && Number.isFinite(r.lastEventAt) && typeof r.active==='boolean') {
                    // A release still waiting for its first KRX trade when the server stopped: the prices are gone, so stop waiting.
                    if(r.releasePending){r.releasePending=false;r.atRelease=r.atRelease||null;}
                    rows.set(rowKey(r),r);
                }
            }
        }
    } catch { storageError='VI 저장 자료 복구 실패'; }
    // The LS masters are fetched once a day and kept on disk, so a restart does not query them again.
    try {
        const saved=masterFile&&fs.existsSync(masterFile)&&JSON.parse(fs.readFileSync(masterFile,'utf8'));
        if(saved&&saved.day===day&&Array.isArray(saved.stocks)&&Array.isArray(saved.futures)) {
            stockMaster=new Map(saved.stocks.filter(s=>Array.isArray(s)&&/^[0-9A-Z]{6}$/.test(s[0])).map(([code,name,market])=>[code,{name,market}]));
            futuresMaster=saved.futures;expiries=saved.expiries&&typeof saved.expiries==='object'?saved.expiries:{};futuresRefs=saved.futuresRefs&&typeof saved.futuresRefs==='object'?saved.futuresRefs:{};futuresMul=saved.futuresMul&&typeof saved.futuresMul==='object'?saved.futuresMul:{};masterDay=day;
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
            fs.writeFileSync(masterFile+'.tmp',JSON.stringify({day,stocks:[...stockMaster].map(([code,s])=>[code,s.name,s.market]),futures:futuresMaster,expiries,futuresRefs,futuresMul}));
            fs.renameSync(masterFile+'.tmp',masterFile);}catch{storageError='LS 종목 정보 저장 실패';}},100);
        masterTimer.unref?.();
    }
    function rollover() {
        if(day===dayKey(now()))return;
        for(const id of [...records.keys()])finishRecord(id,true);
        day=dayKey(now());rows.clear();quotes.clear();masterDay='';expiries={};futuresRefs={};futuresMul={};enrichments.clear();samples.clear();futureOwner.clear();prevAmounts.clear();kiwoomListDay='';
        for(const [code,timer] of releaseTimers){clearTimeout(timer);quoteFeed?.unwatch(code);}releaseTimers.clear();
        persist();
    }
    const comparison=(p,base)=>p>0 && base>0?(p/base-1)*100:null;
    function quoteState() {
        if(!quoteFeed)return 'NH 현재가 미설정';
        const s=quoteFeed.state();
        return s.wanted?`NH 현재가 실시간 ${s.subscribed}건 · 조회 ${s.rest}건`:'NH 현재가 대기';
    }
    // ---- 발동 거래소 기준(Base) 값 (2026-11-11)
    // The triggering exchange (KRX, NXT or a futures contract) is the Base. 괴리율 of the other markets =
    // (그 시장 현재가 ÷ Base 현재가 − 1) × 100; the Base column shows 'Base'. 등락률 · 거래대금 · 시가총액 · 호가 평균 come
    // from the triggering exchange too (호가 평균: KRX rows from NH ob, NXT rows from KIS NX, futures rows from LS t8403 × 승수 since 2026-11-12; futures have no 등락률 · 거래대금 here).
    // nxtSupported false → NXT 괴리율 '미지원'; no stock futures → 선물 괴리율 '미지원'.
    // 선물 등락률 = (선물 현재가 ÷ t8402 기준가 − 1) × 100. 선물 거래대금은 받지 않는다.
    const futuresRate=(code,price)=>code&&futuresRefs[code]>0?comparison(price,futuresRefs[code]):null;
    const baseQuote=r=>r.exchange==='FUT'?quotes.get('FUT:'+r.contract?.code):quotes.get(r.exchange+':'+r.code);
    function view(r) {
        const krx=quotes.get('KRX:'+r.code),nxt=quotes.get('NXT:'+r.code),base=baseQuote(r),basePrice=base?.price;
        const nxtSupported=quoteFeed?.nxtSupported?.(r.code),futuresSupported=r.futuresChecked?(r.contracts||[]).length>0:r.exchange==='FUT'?true:null;
        const futures={};
        for(const [i,key] of ['recent','next'].entries()) {
            const contract=r.contracts?.[i];const quote=contract&&quotes.get('FUT:'+contract.code);
            futures[key]=contract?{...contract,price:quote?.price??null,receivedAt:quote?.receivedAt??null,rate:r.exchange==='FUT'?null:comparison(quote?.price,basePrice)}:null;
        }
        const gap={
            KRX:r.exchange==='KRX'?'Base':comparison(krx?.price,basePrice),
            NXT:r.exchange==='NXT'?'Base':nxtSupported===false?'미지원':comparison(nxt?.price,basePrice),
            FUT:r.exchange==='FUT'?'Base':futuresSupported===false?'미지원':{recent:futures.recent?.rate??null,next:futures.next?.rate??null}
        };
        const book=r.exchange==='KRX'?quotes.get('BID:'+r.code):r.exchange==='NXT'?quotes.get('BID:NXT:'+r.code):r.exchange==='FUT'?quotes.get('BID:FUT:'+r.contract?.code):null;
        const listed=listInfo.get(r.code),spot=(r.exchange==='NXT'?nxt?.price:krx?.price)||krx?.price||nxt?.price||listed?.lastPrice||null,prev=prevAmounts.get(r.code);
        return {...r,bidAverage:book?.value??null,bidAverageAt:book?.receivedAt??null,bidAverageVia:book?.via??null,
            rate:r.exchange==='FUT'?futuresRate(r.contract?.code,basePrice):base?.rate??null,amount:r.exchange==='FUT'?null:base?.amount??null,basePrice:basePrice??null,baseReceivedAt:base?.receivedAt??null,
            krxPrice:krx?.price??null,nxtPrice:nxt?.price??null,krxReceivedAt:krx?.receivedAt??null,nxtReceivedAt:nxt?.receivedAt??null,futures,gap,
            // Kept for older windows: NXT 괴리율 against KRX on KRX rows.
            nxtRate:typeof gap.NXT==='number'?gap.NXT:null,
            nxtSupported:nxtSupported===false?false:nxtSupported===true?true:null,futuresSupported,
            prevAmount:prev?.amount??null,prevAmountDate:prev?.date??null,prevAmountState:prevAmounts.has(r.code)?(prev?'ok':'none'):'pending',
            marketCap:listed&&spot?listed.listCount*spot:null,marketCapBasis:listed?(spot===listed.lastPrice&&!krx?.price&&!nxt?.price?'전일 종가':(r.exchange==='NXT'&&nxt?.price?'NXT 현재가':krx?.price?'KRX 현재가':'NXT 현재가')):null,
            durationMs:r.exchange==='FUT'?futuresEventMs:120000};
    }
    function snapshot() {
        rollover();
        const futuresText=futuresEventsState();
        return {day,connection:state,quoteConnection:quoteState(),futuresConnection:futuresText?'선물 이벤트 '+futuresText:'',lastReceivedAt,storageError,historyWarning:initialWarning,gapThreshold,
            rows:[...rows.values()].map(view).sort((a,b)=>b.startedAt-a.startedAt||a.code.localeCompare(b.code))};
    }
    // The VI window columns (same labels and units), saved with the records so they can be read without the code.
    const KIND={'1':'정적','2':'동적','3':'동적,정적'};
    const clockText=t=>Number.isFinite(t)?new Date(t+9*3600000).toISOString().slice(11,19):null;
    const round2=v=>Number.isFinite(v)?Math.round(v*100)/100:null;
    const gapText=g=>g==='Base'||g==='미지원'?g:round2(g);
    function columns(v) {
        const rel=!v.active&&v.atRelease?v.atRelease:null,g=rel?rel.gap:v.gap,fut=g?.FUT;
        return {시장:v.market||null,종목명:v.name||v.code,종목코드:v.code,'발동 거래소':v.exchange==='FUT'?'선물 '+(v.contract?.code||''):v.exchange,구분:v.kindText||KIND[v.kind]||null,
            등락률:round2(rel?rel.rate:v.atStart?.rate??v.rate),'시가총액(원)':(rel?rel.marketCap:v.marketCap)!=null?Math.round(rel?rel.marketCap:v.marketCap):null,
            '거래대금(백만)':rel?rel.amount:v.amount,'발동 시각':clockText(v.startedAt),'해제 시각':v.active?null:clockText(v.releasedAt),
            'KRX 괴리율':gapText(g?.KRX),'NXT 괴리율':gapText(g?.NXT),
            '선물 괴리율(최근월)':typeof fut==='string'?fut:round2(fut?.recent),'선물 괴리율(차기월)':typeof fut==='string'?fut:round2(fut?.next),
            'KRX 매수10호가평균(원)':v.exchange==='KRX'&&Number.isFinite(rel?rel.bidAverage:v.bidAverage)?Math.round(rel?rel.bidAverage:v.bidAverage):null,
            '선물 매수10호가평균(원)':v.exchange==='FUT'&&Number.isFinite(rel?rel.bidAverage:v.bidAverage)?Math.round(rel?rel.bidAverage:v.bidAverage):null,
            'NXT 매수10호가평균(원)':v.exchange==='NXT'&&Number.isFinite(rel?rel.bidAverage:v.bidAverage)?Math.round(rel?rel.bidAverage:v.bidAverage):null,'전일 거래대금(원)':v.prevAmount};
    }
    // ---- 발동 때 · 해제 때 값 (2026-11-09)
    // atStart: the first KRX price after the activation (the NH current-price call at the start). During the VI the KRX
    // book has no trades, so this is the change rate at the activation.
    // atRelease: the change rate and 괴리율 when the first KRX trade after the release arrives (the single-price match
    // that ends the VI). If none comes within releaseWaitMs, the values at the release event. Kept on the row (state.json)
    // so released rows show them instead of "—" after the prices are gone.
    function releaseValues(r,basis) {
        const v=view(r);
        return {at:now(),basis,rate:v.rate,amount:v.amount,marketCap:v.marketCap,bidAverage:v.bidAverage,basePrice:v.basePrice,gap:v.gap,
            // Older fields (2026-11-09 windows).
            nxtRate:typeof v.gap.NXT==='number'?v.gap.NXT:null,futures:typeof v.gap.FUT==='object'&&v.gap.FUT?v.gap.FUT:{recent:null,next:null}};
    }
    const releaseTimers2=new Map();
    function settleRelease(r,basis) {
        const id=recordId(r);clearTimeout(releaseTimers2.get(id));releaseTimers2.delete(id);
        if(!r.releasePending)return;
        r.releasePending=false;r.atRelease=releaseValues(r,basis);
        const rec=records.get(id);if(rec)rec.atRelease=columns(view(r));
        persist();emit();
    }
    // ---- 괴리율 1% 이상 감지와 4분 기록
    const recording=code=>[...rows.values()].some(r=>r.code===code&&(r.active||Number.isFinite(r.startedAt)&&now()-r.startedAt<=recordMs));
    function sample(code,exchange,key,price,t,rate=null) {
        if(!recording(code))return;
        const list=samples.get(code)||[];samples.set(code,list);
        const last=[...list].reverse().find(x=>x.exchange===exchange&&x.key===key);
        if(last&&last.price===price&&t-last.t<1000)return;
        list.push({t,exchange,key,price,rate});
        // Keep 10 minutes: a record needs the window from the activation (and the price just before it).
        while(list.length&&t-list[0].t>600000)list.shift();
    }
    function gaps(r) {
        const v=view(r),out=[];
        if(typeof v.gap.KRX==='number')out.push({kind:'KRX',value:v.gap.KRX});
        if(typeof v.gap.NXT==='number')out.push({kind:'NXT',value:v.gap.NXT});
        if(typeof v.gap.FUT==='object'&&v.gap.FUT){
            if(Number.isFinite(v.gap.FUT.recent))out.push({kind:'최근월',value:v.gap.FUT.recent,contract:v.futures.recent?.code});
            if(Number.isFinite(v.gap.FUT.next))out.push({kind:'차기월',value:v.gap.FUT.next,contract:v.futures.next?.code});
        }
        return out;
    }
    function checkGap(code) {
        let changed=false;
        for(const r of rows.values()) {
            if(r.code!==code||!r.active||!Number.isFinite(r.startedAt))continue;
            for(const g of gaps(r)) {
                if(Math.abs(g.value)<gapThreshold)continue;
                const hit={at:now(),kind:g.kind,value:Math.round(g.value*100)/100,...(g.contract?{contract:g.contract}:{})};
                if(!r.gapHit){r.gapHit=hit;changed=true;startRecord(r);}
                if(!r.gapMax||Math.abs(hit.value)>Math.abs(r.gapMax.value)){r.gapMax=hit;changed=true;}
            }
        }
        if(changed)persist();
    }
    const recordId=r=>rowKey(r)+':'+r.startedAt;
    function startRecord(r) {
        const id=recordId(r);if(!recordDirectory||records.has(id))return;
        const timer=recordTimer(()=>finishRecord(id),Math.max(0,r.startedAt+recordMs-now()));
        records.set(id,{row:r,startedAt:r.startedAt,atHit:view(r),columnsAtHit:columns(view(r)),atRelease:r.atRelease?columns(view(r)):null,timer});
    }
    // 괴리율 기록(2026-11-11): 현재가는 남기지 않는다. 발동 시각부터 4분 동안 1초마다, 그 시각까지 받은 마지막 가격으로
    // Base 등락률과 Base 대비 각 시장 괴리율을 계산해 [초, Base 등락률, KRX, NXT, 선물 최근월, 선물 차기월]로 남긴다(Base 칸은 'Base').
    function perSecond(r,from,to) {
        const list=(samples.get(r.code)||[]).slice().sort((a,b)=>a.t-b.t),last=new Map(),out=[];
        const baseKey=r.exchange==='FUT'?'FUT:'+r.contract?.code:r.exchange;
        const keyOf=x=>x.exchange==='FUT'?'FUT:'+x.key:x.exchange;
        const recent=r.contracts?.[0]?.code,next=r.contracts?.[1]?.code;
        let i=0;
        for(let t=from;t<=to;t+=1000) {
            while(i<list.length&&list[i].t<=t){const x=list[i++];last.set(keyOf(x),{price:x.price,rate:x.rate??last.get(keyOf(x))?.rate??null});}
            const base=last.get(baseKey),gap=key=>key===baseKey?'Base':round2(comparison(last.get(key)?.price,base?.price));
            out.push([(t-from)/1000,round2(base?.rate),gap('KRX'),gap('NXT'),recent?gap('FUT:'+recent):null,next?gap('FUT:'+next):null]);
        }
        return out;
    }
    function finishRecord(id,partial=false) {
        const rec=records.get(id);if(!rec)return;records.delete(id);clearTimeout(rec.timer);
        const r=rec.row,from=rec.startedAt,to=rec.startedAt+recordMs;
        const line={code:r.code,exchange:r.exchange,contract:r.contract||null,name:r.name,market:r.market,kind:r.kind,kindText:r.kindText||KIND[r.kind]||null,direction:r.direction,
            startedAt:from,releasedAt:r.releasedAt??null,recordFrom:from,recordTo:to,partial,gapThreshold,gapHit:r.gapHit,gapMax:r.gapMax,contracts:r.contracts||[],
            // VI 창 칸 그대로(1% 도달 때 · 해제 때 · 4분 끝): 시장, 종목명, 발동 거래소, 구분, 등락률, 시가총액, 거래대금, 시각, KRX · NXT · 선물 괴리율, 호가 평균
            columns:{'1% 도달 때':rec.columnsAtHit,'해제 때':rec.atRelease,'4분 끝':columns(view(r))},
            atStart:r.atStart||null,atRelease:r.atRelease||null,
            secondsFields:['초','Base 등락률','KRX 괴리율','NXT 괴리율','선물 괴리율(최근월)','선물 괴리율(차기월)'],seconds:perSecond(r,from,to)};
        try{fs.mkdirSync(recordDirectory,{recursive:true});fs.appendFileSync(path.join(recordDirectory,dayKey(from)+'.jsonl'),JSON.stringify(line)+'\n');}
        catch{storageError='괴리율 기록 저장 실패';emit();}
    }
    // NXT 행의 매수 10호가: NH ob는 KRX뿐이라 NXT 발동 행이 켜져 있는(또는 해제 직후 체결을 기다리는) 동안만 한투 NX 호가를 조회한다.
    function syncNxtBook(){
        if(!nxtBook)return;
        nxtBook.set(stopped?[]:[...new Set([...rows.values()].filter(r=>r.exchange==='NXT'&&(r.active||r.releasePending)).map(r=>r.code))]);
    }
    // 선물 행의 매수 10호가 평균(원, 2026-11-12): LS t8403(주식선물 현재가호가, 10단계, 입력은 shcode)을 그 선물 행이 켜져 있는
    // 동안 futuresBookMs마다 조회한다. 금액 = 가격 × 잔량(계약) × 거래승수(t8402 mulcnt), 가격이 있는 단계의 평균.
    // 한투 FHMIF10010000은 5단계만 줘서 쓰지 않는다(11/12 확인: 1~5호가는 LS와 같음). LS 조회는 rest() 한 줄로 1.05초 간격.
    let futuresBookTimer=null,futuresBookRunning=false,futuresBookError='';
    const futuresBookWanted=()=>stopped?[]:[...new Set([...rows.values()].filter(r=>r.exchange==='FUT'&&r.active&&r.contract?.code).map(r=>r.contract.code))];
    async function pollFuturesBooks(){
        if(futuresBookRunning)return;futuresBookRunning=true;
        try{
            for(const code of futuresBookWanted()){
                try{
                    if(futuresMul[code]===undefined)await expiryOf(code);
                    const o=(await rest('t8403','futureoption/market-data',{shcode:code})).t8403OutBlock||{},mul=futuresMul[code];
                    const amounts=Array.from({length:10},(_,i)=>[num(o['bidho'+(i+1)]),num(o['bidrem'+(i+1)])]).filter(([p,q])=>p>0&&q!=null&&q>=0).map(([p,q])=>p*q*mul);
                    if(mul>0&&amounts.length){quotes.set('BID:FUT:'+code,{value:amounts.reduce((a,v)=>a+v,0)/amounts.length,receivedAt:now(),via:'LS',levels:amounts.length,multiplier:mul});emit();}
                    if(futuresBookError){log('[VI 선물 호가] LS t8403 조회 다시 됨');futuresBookError='';}
                }catch(e){const text=String(e?.message||e).slice(0,100);if(text!==futuresBookError)log('[VI 선물 호가] LS t8403 조회 실패 '+code+': '+text);futuresBookError=text;}
            }
        }finally{futuresBookRunning=false;}
    }
    function syncFuturesBook(){
        const wanted=futuresBookWanted();
        if(!wanted.length){clearInterval(futuresBookTimer);futuresBookTimer=null;return;}
        if(!futuresBookTimer){futuresBookTimer=setInterval(()=>void pollFuturesBooks(),futuresBookMs);futuresBookTimer.unref?.();
            if(wanted.some(c=>!quotes.has('BID:FUT:'+c)))void pollFuturesBooks();}
    }
    function emit(){
        syncNxtBook();syncFuturesBook();
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
    // Kiwoom REST, one call at a time with a short gap (shared app key with the rank tables and 52주 신고/신저).
    function kiwoom(api,endpoint,body,next='') {
        const task=kiwoomQueue.then(async()=>{
            const token=await kiwoomToken();
            const response=await http.post('https://api.kiwoom.com/api/dostk/'+endpoint,body,{headers:{authorization:'Bearer '+token,'api-id':api,'Content-Type':'application/json;charset=UTF-8',...(next?{'cont-yn':'Y','next-key':next}:{})},timeout:20000});
            if(String(response.data?.return_code)!=='0'){if(/토큰|token|8005/i.test(String(response.data?.return_msg)))rejectKiwoomToken();throw Error('키움 '+api+' 조회 실패');}
            return response;
        });
        kiwoomQueue=task.catch(()=>{}).then(()=>new Promise(resolve=>{const timer=setTimeout(resolve,350);timer.unref?.();}));
        return task;
    }
    async function kiwoomList() {
        if(kiwoomListDay===day||!kiwoomToken)return;
        if(kiwoomListTask)return kiwoomListTask;
        kiwoomListTask=(async()=>{
            const map=new Map();
            for(const market of ['0','10']) {
                let next='';
                for(let page=0;page<20;page++) {
                    const response=await kiwoom('ka10099','stkinfo',{mrkt_tp:market},next);
                    for(const item of response.data?.list||[]){const listCount=num(item.listCount),lastPrice=num(item.lastPrice);if(/^[0-9A-Z]{6}$/.test(item.code)&&listCount>0)map.set(item.code,{listCount,lastPrice});}
                    next=response.headers?.['cont-yn']==='Y'?response.headers?.['next-key']:'';if(!next)break;
                }
            }
            if(map.size){listInfo=map;kiwoomListDay=day;persistFilters();emit();}
        })().finally(()=>{kiwoomListTask=null;});
        return kiwoomListTask;
    }
    async function prevAmount(code) {
        if(prevAmounts.has(code)||!kiwoomToken)return;
        if(prevTasks.has(code))return prevTasks.get(code);
        const requestDay=day,today=day.replaceAll('-','');
        const task=kiwoom('ka10081','chart',{stk_cd:code+'_AL',base_dt:today,upd_stkpc_tp:'1'}).then(response=>{
            if(day!==requestDay)return;
            const row=(response.data?.stk_dt_pole_chart_qry||[]).find(r=>String(r.dt)<today);
            const million=num(row?.trde_prica);
            prevAmounts.set(code,million==null?null:{amount:million*1e6,date:String(row.dt)});persistFilters();emit();
        }).catch(()=>{}).finally(()=>prevTasks.delete(code));
        prevTasks.set(code,task);return task;
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
            futuresMaster=futures.t8401OutBlock.map(f=>({basecode:f.basecode,shcode:f.shcode,hname:f.hname}));expiries={};futuresRefs={};futuresMul={};masterDay=day;persistMasters();
        })().finally(()=>{masterTask=null;});return masterTask;
    }
    // Expiry per futures code (t8402) is part of the saved daily masters; its price only seeds the first quote.
    async function expiryOf(code) {
        if(expiries[code]!==undefined&&futuresRefs[code]!==undefined&&futuresMul[code]!==undefined)return {expiry:expiries[code],price:null};
        const d=(await rest('t8402','futureoption/market-data',{focode:code})).t8402OutBlock;
        const expiry=String(d?.lastmonth||'').replaceAll('-','');
        expiries[code]=/^\d{8}$/.test(expiry)?expiry:'';
        // 2026-11-12: 기준가 (recprice; else price − signed change), the base of the futures 등락률 (NH vC carries no rate).
        const change=num(d?.change),ref=num(d?.recprice)||(num(d?.price)>0&&change!=null?num(d.price)-(['4','5'].includes(String(d?.sign))?-Math.abs(change):Math.abs(change)):null);
        futuresRefs[code]=ref>0?ref:null;
        // 거래승수 (mulcnt: 주식선물 10, ETF 선물 100), for the futures 매수10호가 평균 in KRW (2026-11-12).
        futuresMul[code]=num(d?.mulcnt)>0?num(d.mulcnt):null;persistMasters();
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
        void kiwoomList().catch(()=>{});void prevAmount(code);
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
            for(const r of rows.values())if(r.code===code){r.contracts=selected;r.detailError='';r.futuresChecked=true;}
            for(const r of rows.values())if(r.code===code&&r.exchange==='FUT'&&r.contract)futureOwner.set(r.contract.code,code);
            for(const c of selected)futureOwner.set(c.code,code);
            const extra=[...rows.values()].filter(r=>r.code===code&&r.exchange==='FUT'&&r.active).map(r=>r.contract.code);
            if(activeCode(code)||releaseTimers.has(code))quoteFeed?.watch(code,{futures:[...new Set([...selected.map(c=>c.code),...extra])]});
            persist();emit();
        })().catch(()=>{for(const r of rows.values())if(r.code===code)r.detailError='종목·월물 조회 실패';enrichments.delete(code);emit();});
        enrichments.set(code,task);return task;
    }
    function applyVi(e) {
        rollover();
        const at=eventTime(e.clock,now());
        if(at===null || at>now()+60000)return;
        const key=rowKey(e),old=rows.get(key),master=stockMaster.get(e.code);
        if(old && at<old.lastEventAt)return;
        lastReceivedAt=now();
        if(e.kind==='0') {
            if(old && old.active){old.active=false;old.releasedAt=at;old.lastEventAt=at;
                old.releasePending=true;old.releaseAskedAt=now();
                const id=recordId(old),timer=setTimeout(()=>settleRelease(old,'해제 이벤트 시점(해제 뒤 '+old.exchange+' 체결 미수신)'),releaseWaitMs);timer.unref?.();releaseTimers2.set(id,timer);}
            // A release without a start cannot provide a real activation timestamp.
            else if(!old)rows.set(key,{code:e.code,exchange:e.exchange,name:master?.name||e.code,market:e.market||master?.market||'-',kind:null,startedAt:null,lastEventAt:at,releasedAt:at,active:false,detailError:'발동 이벤트 미수신'});
        } else if(!old || !old.active || old.kind!==e.kind || old.startedAt!==at) {
            rows.set(key,{code:e.code,exchange:e.exchange,name:master?.name||old?.name||e.code,market:e.market||master?.market||'-',kind:e.kind,direction:e.direction,startedAt:at,lastEventAt:at,releasedAt:null,active:true,contracts:old?.contracts||[],count:(old?.count||0)+1,activatedAt:now(),atStart:null,atRelease:null});
            // During a VI there are no KRX trades, so the realtime price (and its change rate) only comes after the release:
            // ask the KRX current price once now (2026-11-09).
            if(!stopped&&!old?.active)(quoteFeed?.snapshot?quoteFeed.snapshot(e.exchange,e.code):quoteFeed?.snapshotKrx?.(e.code));
        }
        if(!stopped){
            if(activeCode(e.code))watchQuotes(e.code,(rows.get(key)?.contracts||[]).map(c=>c.code));else scheduleUnwatch(e.code);
            void enrich(e.code);
        }
        if(e.kind!=='0'&&rows.get(key)?.active) {
            for(const [id,quote] of quotes) {
                const [exchange,qkey]=id.split(':');
                if(['KRX','NXT'].includes(exchange)&&qkey===e.code||exchange==='FUT'&&futureOwner.get(qkey)===e.code)sample(e.code,exchange,qkey,quote.price,quote.receivedAt??now());
            }
            checkGap(e.code);
        }
        persist();emit();
    }
    function onQuote(q) {
        // Order book: average amount of the 10 bid levels. KRX: NH ob (or the REST current price). NXT: KIS NX (kis-nxt-book.js).
        if(['KRX','NXT'].includes(q.exchange)&&q.bidAverage!==undefined){
            if(Number.isFinite(q.bidAverage)&&q.bidAverage>=0){quotes.set('BID:'+(q.exchange==='NXT'?'NXT:':'')+q.key,{value:q.bidAverage,receivedAt:q.receivedAt??now(),via:q.via});emit();}
            return;
        }
        if(!['KRX','NXT','FUT'].includes(q.exchange)||!(q.price>0))return;
        const id=q.exchange+':'+q.key,old=quotes.get(id);
        quotes.set(id,{price:q.price,rate:q.rate??old?.rate??null,amount:q.amount??old?.amount??null,amountVia:q.amount!=null?q.via:old?.amountVia,
            amountAt:q.amount!=null?q.receivedAt??now():old?.amountAt,receivedAt:q.receivedAt??now(),source:'NH '+(q.via==='WS'?'실시간':'조회')});
        const code=q.exchange==='FUT'?futureOwner.get(q.key):q.key;
        if(code){sample(code,q.exchange,q.key,q.price,q.receivedAt??now(),q.rate??old?.rate??null);checkGap(code);}
        // atStart / atRelease follow the triggering exchange (Base) of each row.
        if(code)for(const r of rows.values()) {
            const isBase=r.exchange==='FUT'?q.exchange==='FUT'&&q.key===r.contract?.code:q.exchange===r.exchange&&q.key===r.code;
            if(!isBase)continue;
            const t=q.receivedAt??now();
            if(r.active&&!r.atStart&&t>=(r.activatedAt??0)){r.atStart={at:t,rate:q.exchange==='FUT'?futuresRate(q.key,q.price):q.rate??old?.rate??null,price:q.price,via:q.via};persist();}
            if(!r.active&&r.releasePending&&t>=(r.releaseAskedAt??0))settleRelease(r,'해제 뒤 첫 '+(r.exchange==='FUT'?'선물':r.exchange)+' 체결');
        }
        emit();
    }
    // ---- 선물 가격제한 이벤트 (LS JX0 가격제한폭 확대), 2026-11-11
    // The message only carries futcode; the stock comes from the LS futures master (t8401 basecode). Raw messages are
    // stored by ls-futures-events.js. A row is made when the up or down step rises above the step last seen (1 = the
    // normal ±10% band; 2 = ±20%, 3 = ±30%). A futures event row counts down 5 minutes (futuresEventMs) and is then
    // released with the values at that moment; a step going back down ends it earlier.
    // 2026-11-12 intraday test (282 contracts): JX0 15 messages, steps 01~03 (the first message of a contract already
    // carries 01 on the side that did not expand). JD0 (실시간 상·하한가) is no longer used: dy_gubun is 2 before the
    // first trade (daily band) and 1 afterwards (a narrow band that follows the price, ~114,000 messages a day), and it
    // went 1 → 2 only twice, each a few seconds after a JX0 expansion. The old rule (first message = normal) made 243
    // false rows at the open.
    const futuresState=new Map(),futuresTimers=new Map();let futuresDay='';
    function futuresEventKind(e,body) {
        // A new day starts with new baselines.
        if(futuresDay!==day){futuresDay=day;futuresState.clear();}
        const prev=futuresState.get(e.tr+':'+e.futcode);futuresState.set(e.tr+':'+e.futcode,body);
        if(e.tr==='JX0') {
            const up=num(body.upstep)||1,dn=num(body.dnstep)||1,pu=num(prev?.upstep)||1,pd=num(prev?.dnstep)||1;
            if(up>pu)return {kind:'JX0',kindText:'상한 '+up+'단계 확대 (±'+up*10+'%)',direction:'up'};
            if(dn>pd)return {kind:'JX0',kindText:'하한 '+dn+'단계 확대 (±'+dn*10+'%)',direction:'down'};
            if(prev&&(up<pu||dn<pd))return {release:'JX0',basis:'제한폭 축소 이벤트'};
            return null;
        }
        return null;
    }
    async function onFuturesEvent(e) {
        rollover();
        const body=e.body||{},futcode=String(e.futcode||body.futcode||'').trim();if(!/^[A-Z0-9]{8}$/.test(futcode))return;
        const event=futuresEventKind({...e,futcode},body);if(!event)return;
        if(event.release){
            // End the active row of the same kind on this contract before its 5-minute countdown.
            const r=[...rows.values()].find(x=>x.exchange==='FUT'&&x.contract?.code===futcode&&x.active&&x.kind===event.release);if(!r)return;
            const key=rowKey(r),at=e.receivedAt??now();clearTimeout(futuresTimers.get(key));futuresTimers.delete(key);
            r.active=false;r.releasedAt=at;r.lastEventAt=at;r.atRelease=releaseValues(r,event.basis);r.releaseBody=body;
            const rec=records.get(recordId(r));if(rec)rec.atRelease=columns(view(r));
            persist();emit();scheduleUnwatch(r.code);return;
        }
        await masters().catch(()=>{});
        const f=futuresMaster.find(x=>x.shcode===futcode);if(!f)return;
        const code=String(f.basecode).trim().replace(/^A(?=[0-9A-Z]{6}$)/,'');if(!/^[0-9A-Z]{6}$/.test(code))return;
        const at=e.receivedAt??now(),master=stockMaster.get(code);
        const contract={code:futcode,name:f.hname,month:String(f.hname?.match(/20\d{4}/)?.[0]||'')};
        const key=code+':FUT:'+futcode,old=rows.get(key),same=[...rows.values()].find(r=>r.code===code&&r.contracts?.length);
        rows.set(key,{code,exchange:'FUT',contract,name:master?.name||old?.name||code,market:master?.market||'-',kind:event.kind,kindText:event.kindText,direction:event.direction,
            startedAt:at,lastEventAt:at,releasedAt:null,active:true,contracts:same?.contracts||old?.contracts||[],futuresChecked:same?.futuresChecked||false,count:(old?.count||0)+1,activatedAt:now(),atStart:null,atRelease:null,eventBody:body});
        futureOwner.set(futcode,code);lastReceivedAt=now();
        clearTimeout(futuresTimers.get(key));
        const timer=setTimeout(()=>{const r=rows.get(key);if(r&&r.active&&r.startedAt===at){r.active=false;r.releasedAt=at+futuresEventMs;r.lastEventAt=r.releasedAt;r.atRelease=releaseValues(r,'5분 경과');persist();emit();scheduleUnwatch(code);}},futuresEventMs);
        timer.unref?.();futuresTimers.set(key,timer);
        if(!stopped){watchQuotes(code,[...new Set([futcode,...(rows.get(key).contracts||[]).map(c=>c.code)])]);void enrich(code);void expiryOf(futcode).then(()=>emit(),()=>{});}
        for(const [id,quote] of quotes){const [exchange,qkey]=id.split(':');if(['KRX','NXT'].includes(exchange)&&qkey===code||exchange==='FUT'&&futureOwner.get(qkey)===code)sample(code,exchange,qkey,quote.price,quote.receivedAt??now(),quote.rate??null);}
        checkGap(code);persist();emit();
    }
    // The near-month contract of each stock (from the LS master), for the LS JX0 registrations.
    async function futuresContracts() {
        await masters();
        const month=day.slice(0,7).replace('-',''),best=new Map();
        for(const f of futuresMaster) {
            const code=String(f.basecode).trim().replace(/^A(?=[0-9A-Z]{6}$)/,''),m=String(f.hname?.match(/20\d{4}/)?.[0]||'');
            if(!/^[0-9A-Z]{6}$/.test(code)||!/^[A-Z0-9]{8}$/.test(f.shcode)||/스프레드|\bSP\b|SPREAD/i.test(f.hname||'')||!m||m<month)continue;
            if(!best.has(code)||m<best.get(code).m)best.set(code,{m,shcode:f.shcode});
        }
        return [...best.values()].map(x=>x.shcode).sort();
    }
    // NH trade value unit check: when the 거래대금 상위 table (Kiwoom ka10032, million KRW) is fetched, ask NH
    // for 삼성전자 and record both. Kiwoom 005930_AL is KRX+NXT and NH KRX is KRX only, so NH (in million KRW)
    // / Kiwoom a little below 1 confirms the unit. Only where the VI monitor is on; once per 10 minutes.
    let samsungCheckedAt=0;
    async function checkSamsungAmount(kiwoomAmount) {
        const kiwoom=num(String(kiwoomAmount??'').replace(/[+,]/g,''));
        if(!enabled()||!quoteFeed?.rest||!directory||!(kiwoom>0)||now()-samsungCheckedAt<600000)return null;
        samsungCheckedAt=now();
        const line={at:new Date(now()).toISOString(),code:'005930',kiwoomMillion:kiwoom};
        try {
            const o=await quoteFeed.rest('/krstock/quote/v1/currentPrice',{market_cd:'KRX',iem_cd:'005930'});
            const raw=num(o.acml_tr_pbmn),ws=quotes.get('KRX:005930');
            // NH acml_tr_pbmn is million KRW (KRX only); Kiwoom is million KRW for KRX+NXT, so the ratio stays a little under 1 minus the NXT share.
            Object.assign(line,{nhRestRaw:raw,nhRestMillion:raw,ratio:raw==null?null:Math.round(raw/kiwoom*1000)/1000,
                nhWsMillion:ws?.amountVia==='WS'&&now()-(ws.amountAt||0)<120000?ws.amount:null});
        } catch(error) { line.error=String(error.message||error).slice(0,80); }
        try{fs.mkdirSync(directory,{recursive:true});fs.appendFileSync(path.join(directory,'amount-check-'+dayKey(now())+'.jsonl'),JSON.stringify(line)+'\n');}catch{}
        return line;
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
        syncNxtBook();void connect();
        schedule=setInterval(()=>{rollover();if(policy()&&!policy().spotAt(now())&&socket)socket.close();else if(!socket)void connect();},30000);schedule.unref?.();
    }
    function stop(){for(const t of futuresTimers.values())clearTimeout(t);futuresTimers.clear();for(const id of [...records.keys()])finishRecord(id,true);for(const t of releaseTimers2.values())clearTimeout(t);releaseTimers2.clear();stopped=true;clearTimeout(retry);clearTimeout(emitTimer);clearInterval(schedule);cleanup();for(const t of releaseTimers.values())clearTimeout(t);releaseTimers.clear();quoteFeed?.stop();nxtBook?.stop();clearInterval(futuresBookTimer);futuresBookTimer=null;socket?.terminate();socket=null;}
    // Stop the new-VI blink for one activation; a later activation creates a fresh row and blinks again.
    function dismissFlash(code,exchange,startedAt) {
        rollover();
        const row=[...rows.values()].find(r=>r.code===code&&r.exchange===exchange&&r.startedAt===startedAt);
        if(!row||!row.active||row.startedAt!==startedAt)return false;
        if(!row.flashDismissed){row.flashDismissed=true;persist();emit();}
        return true;
    }
    if(!enabled())state=disabledState;
    return {start,stop,receive,onQuote,onFuturesEvent,futuresContracts,checkSamsungAmount,snapshot,dismissFlash,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);}};
}
module.exports={createViMonitor,eventTime,parseKiwoomVi};
