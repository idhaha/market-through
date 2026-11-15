'use strict';
// VI monitor (2026-11-07 layout; 2026-11-11: KRX · NXT · 선물 발동 거래소별 Base 괴리율, 선물 가격제한 이벤트 행):
//  - VI 발동·해제 (KRX · NXT): Kiwoom realtime 1h, one websocket.
//  - Current prices of VI stocks (KRX · NXT · stock futures): NH realtime oc/nc/vC through quoteFeed.
//  - Stock names, futures mapping and expiry: LS t8436 · t8401 · t8402, fetched once a day and saved.
// LS VI_ matched Kiwoom on all 3,110 KRX VIs (2026-11-05); LS NVI has no whole-market key (2026-11-06),
// so the LS websocket is no longer used here and LS keeps only the market alert (JIF) session.
const fs = require('node:fs');
const path = require('node:path');
const { createFuturesLimitWatch, clockAt } = require('./futures-limit-watch');
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
    enabled=()=>true,kiwoomToken,rejectKiwoomToken=()=>{},quoteFeed=null,nxtBook=null,futuresBookMs=5000,log=()=>{},releaseGraceMs=180000,gapThreshold=1,recordMs=240000,releaseWaitMs=15000,futuresEventMs=300000,futuresEventsState=()=>'',futuresMinute=null,historyDays=Infinity,futuresWaitMs=60000,unsubscribeDelayMs=30000,strength=null,staleMs=60000,lateMs=30000,restGapMs=1050,stockTrades=null,chartPages=40,chartKisPages=400,chartStepMs=1000,recordTimer=(fn,ms)=>{const t=setTimeout(fn,ms);t.unref?.();return t;}}={}) {
    let day=dayKey(now()), rows=new Map(), quotes=new Map(), masterDay='', stockMaster=new Map(), futuresMaster=[], expiries={}, futuresRefs={}, futuresMul={}, masterTask;
    // 선물 오늘 체결 여부(2026-11-13): 월물마다 LS t8402 거래량 · 현재가를 확인한 값 {volume, price, at}. NH 실시간 체결이 오면 volume을 null(체결 있음, 수량 모름)로 바꾼다.
    // 가격이 없는 이유가 '오늘 체결 없음'인지 '아직 못 받음'인지 가르는 데 쓴다. 메모리에만 두고 날이 바뀌면 지운다.
    const futuresTrade=new Map(),futuresTradeTasks=new Map();
    let socket, stopped=true, connecting=false, retry, ackTimer, regTimer, schedule, saveTimer, masterTimer, emitTimer, registered=0, reconnects=0;
    let state='대기 중', storageError='', lastReceivedAt=null;
    // 거래대금(전일기준) · 시가총액 필터(2026-11-10):
    //  - 상장주식수 · 전일 종가: 키움 ka10099(코스피 0 · 코스닥 10), 하루 1회.
    //  - 전일 거래대금: 키움 ka10081 일봉(종목코드_AL = KRX+NXT 통합, trde_prica 백만 원)의 오늘 전 마지막 날, VI가 난 종목만
    //    그날 처음 한 번 조회. 둘 다 filters.json에 따로 저장(LS 종목 정보 저장과 무관하게).
    //  - 시가총액(현 시점) = 상장주식수 × 지금 받은 현재가(KRX, 없으면 NXT, 없으면 전일 종가).
    let staleSaved=null,savedFilters=null;
    let listInfo=new Map(), prevAmounts=new Map(), kiwoomListTask=null, kiwoomListDay='', kiwoomQueue=Promise.resolve();
    const prevTasks=new Map(), filterFile=directory&&path.join(directory,'filters.json');
    let filterTimer;
    try {
        const saved=filterFile&&fs.existsSync(filterFile)&&JSON.parse(fs.readFileSync(filterFile,'utf8'));
        if(saved&&saved.day!==day)savedFilters=saved;
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
    const rowKey=r=>r.code+':'+r.exchange+(r.exchange==='FUT'?':'+(r.contract?.code||'')+(r.limit?':'+r.limit.side+r.limit.stage:''):'');
    const disabledState='이 서버에서는 VI 수신을 꺼 두었습니다 (로컬 PC 서버에서 수신)';
    // 날짜별 VI 창 기록(2026-11-14): 날이 바뀔 때 그날 행을 화면에 보이던 값 그대로 days/날짜.json에 남긴다.
    // 휴일 · 장 시작 전(08:00 전)에는 오늘 행이 없으면 마지막으로 남긴 장의 행을 보여 준다.
    // 서버가 꺼진 채 날이 바뀌었으면 시작할 때 state.json의 지난 날 행을 남긴다(staleSaved, 맨 아래에서 처리).
    const dayDirectory=directory&&path.join(directory,'days');
    try {
        if(file && fs.existsSync(file)) {
            const saved=JSON.parse(fs.readFileSync(file,'utf8'));
            if(typeof saved.day==='string'&&saved.day<day&&Array.isArray(saved.rows)&&saved.rows.length)staleSaved={day:saved.day,rows:saved.rows.slice(-10000)};
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
    // Rows saved before 2026-11-13 could miss the futures check: a later row of the same stock did not take over the check
    // another row had made, so the 선물 괴리율 stayed "—" (브이엠 KRX 행 등). On a restart, take it from a checked row of
    // the same stock, else from today's saved LS futures master (no contract for the stock = no stock futures). A released
    // row of a stock without futures then shows '미지원' instead of the empty value frozen at its release.
    const futuresCandidates=code=>futuresMaster.filter(f=>String(f.basecode).trim().replace(/^A(?=[0-9A-Z]{6}$)/,'')===code&&/^[A-Z0-9]{8}$/.test(f.shcode)&&!/스프레드|SP|SPREAD/i.test(f.hname||''));
    for(const r of rows.values()) {
        if(r.futuresChecked||r.exchange==='FUT')continue;
        const sib=[...rows.values()].find(x=>x.code===r.code&&x.futuresChecked);
        if(sib){r.futuresChecked=true;r.contracts=sib.contracts||[];}
        else if(masterDay===day&&futuresMaster.length&&!futuresCandidates(r.code).length){r.futuresChecked=true;r.contracts=[];}
        else continue;
        const fut=r.atRelease?.gap?.FUT;
        if(!r.contracts.length&&fut&&typeof fut==='object'&&fut.recent==null&&fut.next==null)r.atRelease.gap.FUT='미지원';
    }
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
    // A row still active when its day ends keeps the values shown at that moment as its release values.
    function frozen(v) {
        const {flashDismissed,releasePending,...row}=v;
        if(!row.active)return row;
        return {...row,active:false,releasedAt:null,endedOpen:true,
            atRelease:{at:null,basis:'해제 수신 없이 장 종료',rate:row.exchange==='FUT'?row.rate:row.atStart?.rate??row.rate,amount:row.amount,marketCap:row.marketCap,bidAverage:row.bidAverage,gap:row.gap}};
    }
    const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d);
    let latestArchive;
    function archiveDay(d,viewRows) {
        if(!dayDirectory||!validDay(d)||!viewRows.length)return;
        const saved={day:d,savedAt:now(),rows:viewRows.map(frozen)};
        try{fs.mkdirSync(dayDirectory,{recursive:true});fs.writeFileSync(path.join(dayDirectory,d+'.json.tmp'),JSON.stringify(saved));fs.renameSync(path.join(dayDirectory,d+'.json.tmp'),path.join(dayDirectory,d+'.json'));}
        catch{storageError='VI 날짜별 기록 저장 실패';}
        if(!latestArchive||latestArchive.day<=d)latestArchive=saved;
        pruneDays();
    }
    // Keep only the newest historyDays saved days (Oracle: 1, the last session; local: all).
    function pruneDays() {
        if(!(historyDays<Infinity))return;
        for(const old of archivedDays().slice(historyDays))try{fs.rmSync(path.join(dayDirectory,old+'.json'),{force:true});}catch{}
    }
    // Saved days (newest first) and one saved day, for the window's date picker.
    function archivedDays() {
        if(!dayDirectory)return [];
        try{return fs.readdirSync(dayDirectory).map(f=>/^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1]).filter(Boolean).sort().reverse();}catch{return [];}
    }
    function archivedDay(d) {
        if(!dayDirectory||!validDay(d))return null;
        try{const saved=JSON.parse(fs.readFileSync(path.join(dayDirectory,d+'.json'),'utf8'));return saved&&saved.day===d&&Array.isArray(saved.rows)?saved:null;}catch{return null;}
    }
    function previousSession() {
        if(latestArchive===undefined){const last=archivedDays().find(d=>d<day);latestArchive=last?archivedDay(last):null;}
        return latestArchive&&latestArchive.day<day?latestArchive:null;
    }
    // The next session has started: a trading day (calendar; unknown = weekday) from 08:00 (NXT pre-market).
    function sessionStarted() {
        const k=new Date(now()+9*3600000),minute=k.getUTCHours()*60+k.getUTCMinutes();
        const open=policy()?.openDate?.(day);
        return (open===true||open==null&&![0,6].includes(k.getUTCDay()))&&minute>=480;
    }
    function rollover() {
        if(day===dayKey(now()))return;
        if(rows.size)archiveDay(day,[...rows.values()].map(view));
        for(const id of [...records.keys()])finishRecord(id,true);
        day=dayKey(now());rows.clear();quotes.clear();masterDay='';expiries={};futuresRefs={};futuresMul={};futuresTrade.clear();futuresTradeTasks.clear();enrichments.clear();strengthOf.clear();limitsTasks.clear();marketEvents.length=0;samples.clear();futureOwner.clear();prevAmounts.clear();kiwoomListDay='';
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
    // 장 전 · 체결 전 표시(2026-11-15): 그 시장 정규장이 아직 열리지 않았으면 받은 가격은 전일 종가다. 괴리율은 그 가격으로 그대로
    // 계산하되(1% 판정 포함) gapState에 '장 전'을 적어 화면이 작고 흐리게 + "장 전"을 붙인다(11/12 JYP Ent. NXT 08:03 행 KRX −9.3%).
    // KRX가 열렸어도 그날 거래대금이 0이면(시가 단일가에서 바로 VI 등) '체결 전'(11/12 JYP Ent. KRX 09:00:05 행의 Base).
    // 개장: KRX 09:00, 주식선물 08:45, NXT 08:00(프리마켓). 수능일은 거래소 공지대로 1시간 늦고 NXT 프리마켓이 없다.
    const OPEN_DELAY={'2026-11-19':60};// 2027학년도 수능(한국거래소 2026-11-05 공지: 정규장 10:00, 주식 파생 09:45)
    function preOpen(market,t=now()){
        const k=new Date(t+9*3600000),m=k.getUTCHours()*60+k.getUTCMinutes(),d=OPEN_DELAY[dayKey(t)]||0;
        return m<({KRX:540,FUT:525,NXT:d?540:480}[market]??0)+d;
    }
    const baseQuote=r=>r.exchange==='FUT'?quotes.get('FUT:'+r.contract?.code):quotes.get(r.exchange+':'+r.code);
    function view(r) {
        const krx=quotes.get('KRX:'+r.code),nxt=quotes.get('NXT:'+r.code),base=baseQuote(r),basePrice=base?.price;
        const nxtSupported=quoteFeed?.nxtSupported?.(r.code),futuresSupported=r.futuresChecked?(r.contracts||[]).length>0:r.exchange==='FUT'?true:null;
        // 선물 칸(2026-11-14): 월물 선택 없이 그 종목의 감시 월물(전일 거래량이 많은 월물) 하나와 비교한다.
        const fb=r.exchange==='FUT'?null:baseOf(r.code,r.contracts||[]);
        const fq=fb&&quotes.get('FUT:'+fb.code),ft=fb&&futuresTrade.get(fb.code),fidle=fb&&!fq&&ft?.volume===0;
        const futuresBase=fb?{...fb,expiry:(r.contracts||[]).find(c=>c.code===fb.code)?.expiry||null,price:fq?.price??null,receivedAt:fq?.receivedAt??null,tradeAt:fq?.tradeAt??null,source:fq?.source??null,volume:ft?.volume??null,tradeCheckedAt:ft?.at??null}:null;
        const gap={
            KRX:r.exchange==='KRX'?'Base':comparison(krx?.price,basePrice),
            NXT:r.exchange==='NXT'?'Base':nxtSupported===false?'미지원':comparison(nxt?.price,basePrice),
            FUT:r.exchange==='FUT'?'Base':futuresSupported===false?'미지원':!fb?null:fidle?'체결 없음':comparison(fq?.price,basePrice)
        };
        const gapState={KRX:preOpen('KRX')?'장 전':krx?.amount===0?'체결 전':null,NXT:preOpen('NXT')?'장 전':null,FUT:preOpen('FUT')?'장 전':null};
        // 1% 판정에는 마지막 체결이 1분 안인 시장만 쓴다(2026-11-14). 칸에는 값을 두고 마우스 오버로 알린다.
        const age=q=>q?.tradeAt!=null?Math.max(0,now()-q.tradeAt):null;
        const tradeAge={KRX:age(krx),NXT:age(nxt),FUT:r.exchange==='FUT'?age(base):age(fq)};
        const book=r.exchange==='KRX'?quotes.get('BID:'+r.code):r.exchange==='NXT'?quotes.get('BID:NXT:'+r.code):r.exchange==='FUT'?quotes.get('BID:FUT:'+r.contract?.code):null;
        const listed=listInfo.get(r.code),spot=(r.exchange==='NXT'?nxt?.price:krx?.price)||krx?.price||nxt?.price||listed?.lastPrice||null,prev=prevAmounts.get(r.code);
        return {...r,rowKey:rowKey(r),bidAverage:book?.value??null,bidAverageAt:book?.receivedAt??null,bidAverageVia:book?.via??null,
            rate:r.exchange==='FUT'?futuresRate(r.contract?.code,basePrice):base?.rate??null,amount:r.exchange==='FUT'?null:base?.amount??null,basePrice:basePrice??null,baseReceivedAt:base?.receivedAt??null,
            krxPrice:krx?.price??null,nxtPrice:nxt?.price??null,krxReceivedAt:krx?.receivedAt??null,nxtReceivedAt:nxt?.receivedAt??null,futuresBase,gap,gapState,tradeAge,staleMs,
            // Kept for older windows: NXT 괴리율 against KRX on KRX rows.
            nxtRate:typeof gap.NXT==='number'?gap.NXT:null,
            nxtSupported:nxtSupported===false?false:nxtSupported===true?true:null,futuresSupported,
            prevAmount:prev?.amount??null,prevAmountDate:prev?.date??null,prevAmountState:prevAmounts.has(r.code)?(prev?'ok':'none'):'pending',
            marketCap:listed&&spot?listed.listCount*spot:null,marketCapBasis:listed?(spot===listed.lastPrice&&!krx?.price&&!nxt?.price?'전일 종가':(r.exchange==='NXT'&&nxt?.price?'NXT 현재가':krx?.price?'KRX 현재가':'NXT 현재가')):null,
            durationMs:r.exchange==='FUT'?futuresEventMs:120000,waiting:!!r.waiting};
    }
    function snapshot() {
        rollover();
        const futuresText=futuresEventsState();
        // 휴일 · 장 시작 전: 오늘 행이 아직 없으면 직전 장 기록을 보여 준다.
        const previous=!rows.size&&!sessionStarted()?previousSession():null;
        if(previous)return {day,shownDay:previous.day,previousSession:true,restored:previous.restored||null,connection:state,quoteConnection:quoteState(),futuresConnection:futuresText?'선물 이벤트 '+futuresText:'',lastReceivedAt,storageError,historyWarning:'',gapThreshold,
            rows:previous.rows.slice().sort((a,b)=>(b.startedAt??-Infinity)-(a.startedAt??-Infinity)||a.code.localeCompare(b.code))};
        return {day,shownDay:day,previousSession:false,connection:state,quoteConnection:quoteState(),futuresConnection:futuresText?'선물 이벤트 '+futuresText:'',lastReceivedAt,storageError,historyWarning:initialWarning,gapThreshold,
            rows:[...rows.values()].map(view).sort((a,b)=>b.startedAt-a.startedAt||a.code.localeCompare(b.code))};
    }
    // The VI window columns (same labels and units), saved with the records so they can be read without the code.
    const KIND={'1':'정적','2':'동적','3':'동적,정적'};
    const clockText=t=>Number.isFinite(t)?new Date(t+9*3600000).toISOString().slice(11,19):null;
    const round2=v=>Number.isFinite(v)?Math.round(v*100)/100:null;
    const gapText=g=>typeof g==='string'?g:round2(g);
    function columns(v) {
        const rel=!v.active&&v.atRelease?v.atRelease:null,g=rel?rel.gap:v.gap,fut=g?.FUT;
        return {시장:v.market||null,종목명:v.name||v.code,종목코드:v.code,'발동 거래소':v.exchange==='FUT'?'선물 '+(v.contract?.code||''):v.exchange,구분:v.kindText||KIND[v.kind]||null,
            등락률:round2(rel?rel.rate:v.atStart?.rate??v.rate),'시가총액(원)':(rel?rel.marketCap:v.marketCap)!=null?Math.round(rel?rel.marketCap:v.marketCap):null,
            '거래대금(백만)':rel?rel.amount:v.amount,'발동 시각':clockText(v.startedAt),'해제 시각':v.active?null:clockText(v.releasedAt),
            'KRX 괴리율':gapText(g?.KRX),'NXT 괴리율':gapText(g?.NXT),
            '선물 괴리율':typeof fut==='object'&&fut?gapText(fut.recent):gapText(fut),'선물 월물':v.exchange==='FUT'?v.contract?.code||null:v.futuresBase?.code||null,'체결강도':round2(v.cpower?.value),
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
        return {at:now(),basis,rate:v.rate,amount:v.amount,marketCap:v.marketCap,bidAverage:v.bidAverage,basePrice:v.basePrice,gap:v.gap,gapState:v.gapState,
            // Older fields (2026-11-09 windows).
            nxtRate:typeof v.gap.NXT==='number'?v.gap.NXT:null,futuresBase:v.futuresBase?{code:v.futuresBase.code,name:v.futuresBase.name,month:v.futuresBase.month}:null,cpower:v.cpower??null};
    }
    const releaseTimers2=new Map();
    function settleRelease(r,basis) {
        const id=recordId(r);clearTimeout(releaseTimers2.get(id));releaseTimers2.delete(id);
        if(!r.releasePending)return;
        r.releasePending=false;r.atRelease=releaseValues(r,r.releaseBasis?r.releaseBasis+' · '+basis:basis);judgeBackfill(r);
        const rec=records.get(id);if(rec)rec.atRelease=columns(view(r));
        fillReleaseFutures(r);
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
        const v=view(r),out=[],fresh=k=>!!v.gapState[k]||v.tradeAge[k]!=null&&v.tradeAge[k]<=staleMs;// 장 전 · 체결 전 시장은 체결 없이도 그 가격으로 판정(2026-11-15)
        if(typeof v.gap.KRX==='number'&&fresh('KRX'))out.push({kind:'KRX',value:v.gap.KRX});
        if(typeof v.gap.NXT==='number'&&fresh('NXT'))out.push({kind:'NXT',value:v.gap.NXT});
        if(typeof v.gap.FUT==='number'&&fresh('FUT'))out.push({kind:'선물',value:v.gap.FUT,contract:v.futuresBase?.code});
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
        const fb=r.exchange==='FUT'?null:baseOf(r.code,r.contracts||[])?.code;
        let i=0;
        for(let t=from;t<=to;t+=1000) {
            while(i<list.length&&list[i].t<=t){const x=list[i++];last.set(keyOf(x),{price:x.price,rate:x.rate??last.get(keyOf(x))?.rate??null});}
            const base=last.get(baseKey),gap=key=>key===baseKey?'Base':round2(comparison(last.get(key)?.price,base?.price));
            out.push([(t-from)/1000,round2(base?.rate),gap('KRX'),gap('NXT'),r.exchange==='FUT'?'Base':fb?gap('FUT:'+fb):null]);
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
            secondsFields:['초','Base 등락률','KRX 괴리율','NXT 괴리율','선물 괴리율(감시 월물)'],seconds:perSecond(r,from,to)};
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
        watch?.setPinned(limitRows().filter(r=>r.active||r.releasePending).map(r=>r.contract.code));
        if(emitTimer||!listeners.size)return;
        emitTimer=setTimeout(()=>{emitTimer=null;const data=snapshot();for(const listener of listeners)listener(data);},50);emitTimer.unref?.();
    }
    let queue=Promise.resolve();
    async function rest(tr,endpoint,params,cont=false) {
        const task=queue.then(async()=>{
            const response=await http.post('https://openapi.ls-sec.co.kr:8080/'+endpoint,{[tr+'InBlock']:params},{headers:{authorization:'Bearer '+await getToken(),'Content-Type':'application/json; charset=UTF-8',tr_cd:tr,tr_cont:cont?'Y':'N',tr_cont_key:''},timeout:15000});
            if(String(response.data?.rsp_cd)!=='00000')throw Error('LS '+tr+' 조회 실패');
            return response.data;
        });
        queue=task.catch(()=>{}).then(()=>new Promise(resolve=>{const timer=setTimeout(resolve,restGapMs);timer.unref?.();}));
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
        futuresMul[code]=num(d?.mulcnt)>0?num(d.mulcnt):null;persistMasters();noteTrade(code,d);
        return {expiry:expiries[code],price:num(d?.price)};
    }
    // 선물 오늘 체결 확인(2026-11-13). 가격이 발동 · 해제 순간에 들어왔는지만 보지 않고 LS t8402로 그날 체결을 확인한다.
    //  - 거래량 0: 오늘 체결이 없다. 이때 t8402 현재가는 전일 종가라 괴리율에 쓰지 않고 '체결 없음'으로 보인다
    //    (이전에는 이 전일 종가를 첫 가격으로 넣어 지난 가격과의 괴리율이 나왔다).
    //  - 거래량 > 0: 현재가가 오늘 마지막 체결가다. NH 실시간 값이 없거나 1분 넘게 오래됐으면 그 값을 쓴다
    //    (서버 재시작 뒤에는 저장된 만기 정보 때문에 t8402를 다시 부르지 않아 가격이 비었다).
    function noteTrade(code,d) {
        const volume=num(d?.volume),p=price(d?.price);if(volume==null)return;
        futuresTrade.set(code,{volume,price:p,at:now()});
        const q=quotes.get('FUT:'+code);
        if(volume>0&&p>0&&(!q||q.source==='LS'||now()-(q.receivedAt||0)>60000))quotes.set('FUT:'+code,{price:p,receivedAt:now(),source:'LS'});
    }
    // Asks t8402 again only when the last check is older than maxAgeMs; a contract seen trading stays trading for the day.
    function checkTrade(code,maxAgeMs=60000) {
        const t=futuresTrade.get(code);
        if(t&&(t.volume>0&&quotes.has('FUT:'+code)||now()-t.at<maxAgeMs))return Promise.resolve(t);
        // (volume null = the last answer failed or had no 거래량; asked again after maxAgeMs.)
        if(futuresTradeTasks.has(code))return futuresTradeTasks.get(code);
        const unknown=()=>{if(!futuresTrade.get(code)||futuresTrade.get(code).volume===null)futuresTrade.set(code,{volume:null,price:null,at:now()});};
        const task=rest('t8402','futureoption/market-data',{focode:code}).then(d=>{noteTrade(code,d.t8402OutBlock);unknown();return futuresTrade.get(code);})
            .catch(()=>{unknown();return null;}).finally(()=>futuresTradeTasks.delete(code));
        futuresTradeTasks.set(code,task);return task;
    }
    // Contracts of a row without a futures price: check today's trades now (on activation, after the months are found).
    function checkRowTrades(r) {
        const missing=(r.contracts||[]).filter(c=>!quotes.has('FUT:'+c.code));
        if(missing.length)void Promise.all(missing.map(c=>checkTrade(c.code))).then(()=>emit());
    }
    // 해제 때 선물 괴리율이 비었으면(그 순간 선물 가격이 없었음) 바로 t8402로 확인해 채운다: 체결이 있었으면 마지막 체결가로 계산하고,
    // 없었으면 '체결 없음'으로 남긴다.
    function fillReleaseFutures(r) {
        const a=r.atRelease,g=a?.gap,c=a?.futuresBase;if(r.exchange==='FUT'||!g||!c||g.FUT!=null)return;
        void checkTrade(c.code,15000).then(()=>{
            if(r.atRelease!==a||g.FUT!=null)return;
            const q=quotes.get('FUT:'+c.code),t=futuresTrade.get(c.code),v=!q&&t?.volume===0?'체결 없음':comparison(q?.price,a.basePrice);
            if(v==null)return;g.FUT=v;
            const rec=records.get(recordId(r));if(rec)rec.atRelease=columns(view(r));
            persist();emit();
        });
    }
    // ---- 해제 때 선물 괴리율을 한투 1분봉으로 확인(2026-11-13)
    // 해제 순간의 선물 가격이 남지 않은 행(재시작 전 값이 비었거나, 예전 방식이 체결 없는 월물의 전일 종가로 계산한 값)은
    // 한투 FHKIF03020200(시장 JF) 1분봉으로 다시 본다: 해제 시각까지 그날 봉이 하나도 없으면 '체결 없음'(값이 있었어도 전일 종가로 만든
    // 것이므로 바꾼다), 비어 있던 값은 해제 시각을 담은(또는 그 앞의 마지막) 봉 종가로 해제 때 Base 가격과 비교한다. 봉 종가는 그 분의
    // 마지막 체결가라 해제 순간과 1분 안쪽으로 다를 수 있어, 해제 때 받은 값이 있으면(봉도 있으면) 그대로 둔다.
    // 2026-11-13 오늘 자료: 차기월 7행(+24.91%, +12.04%, −12.41%, −9.86% 등)이 봉 없는 월물의 전일 종가 값이었다.
    // 행마다 한 번만 확인하고(atRelease.futuresVerified) 서버 시작 때 오늘 해제된 행만 본다.
    // 한투 코드: LS A116C000(삼성전자 2026-12) → A11612 (기초자산 2자리 + 연도 끝자리 + 월, 월 A·B·C = 10·11·12).
    const kisFuturesCode=ls=>{const m={A:'10',B:'11',C:'12'}[ls[4]]||(/[1-9]/.test(ls[4])?'0'+ls[4]:null);return /^A[0-9A-Z]{7}$/.test(ls)&&m?'A'+ls.slice(1,3)+ls[3]+m:null;};
    const kstClock=t=>new Date(t+9*3600000).toISOString().slice(11,19).replaceAll(':','');
    async function futuresPriceAt(lsCode,t) {
        const code=kisFuturesCode(lsCode),ymd=dayKey(t).replaceAll('-','');if(!code)return undefined;
        const bars=(await futuresMinute({code,date:ymd,hour:kstClock(t)})).filter(b=>String(b.stck_bsop_date)===ymd);
        const before=bars.map(b=>({hour:String(b.stck_cntg_hour||'').padStart(6,'0'),price:price(b.futs_prpr)})).filter(b=>b.price>0&&b.hour<=kstClock(t)).sort((a,b)=>b.hour.localeCompare(a.hour));
        return before.length?{price:before[0].price,hour:before[0].hour}:null;
    }
    let verifying=false;
    async function verifyReleasedFutures() {
        if(!futuresMinute||verifying)return;verifying=true;
        try {
            for(const r of [...rows.values()]) {
                const a=r.atRelease,g=a?.gap,c=a?.futuresBase;
                if(stopped||r.exchange==='FUT'||r.active||!a||a.futuresVerified||!c||!g||typeof g.FUT==='object'&&g.FUT||g.FUT==='미지원'||a.gapState?.FUT==='장 전'||!(a.basePrice>0)||!Number.isFinite(r.releasedAt)||dayKey(r.releasedAt)!==day)continue;
                const t=r.releasedAt;let bar;
                try{bar=await futuresPriceAt(c.code,t);}catch(e){log('[VI 선물 분봉] 한투 FHKIF03020200 조회 실패 '+c.code+': '+String(e?.message||e).slice(0,100));bar=undefined;}
                if(bar===undefined)continue;
                // A value taken at the release (realtime price) is more exact than a minute close: keep it while the bars show trades.
                if(!(bar&&g.FUT!=null)){
                    const value=bar?comparison(bar.price,a.basePrice):'체결 없음';
                    if(g.FUT!==value){a.futuresCorrected={before:g.FUT??null,source:bar?'한투 분봉 '+bar.hour.slice(0,2)+':'+bar.hour.slice(2,4)+' 종가':'한투 분봉 없음(해제까지 체결 없음)'};g.FUT=value;}
                }
                a.futuresVerified=true;persist();emit();
            }
        } finally { verifying=false; }
    }
    // 같은 종목의 다른 행(다른 거래소 · 다시 발동)이 이미 확인한 선물 월물 정보. 새 행이 이를 넘겨받지 않으면 선물 확인이 끝났는데도
    // '확인 전'으로 남아 선물 괴리율이 "—"였다(2026-11-13 브이엠 KRX 행 등 40행).
    const checkedSibling=code=>[...rows.values()].find(r=>r.code===code&&r.futuresChecked);
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
                const {expiry}=await expiryOf(f.shcode);
                if(day!==requestDay)return;
                if(!expiry || expiry<day.replaceAll('-',''))continue;
                contracts.push({code:f.shcode,name:f.hname,expiry});
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
            // Months without a price yet: today's trades from t8402 (after a restart the saved expiries skip that call).
            const firstRow=[...rows.values()].find(r=>r.code===code&&r.exchange!=='FUT');if(firstRow)checkRowTrades(firstRow);
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
            const sib=old?.futuresChecked?old:checkedSibling(e.code);
            rows.set(key,{code:e.code,exchange:e.exchange,name:master?.name||old?.name||e.code,market:e.market||master?.market||'-',kind:e.kind,direction:e.direction,startedAt:at,lastEventAt:at,releasedAt:null,active:true,
                contracts:sib?.contracts||old?.contracts||[],...(sib?{futuresChecked:true}:{}),count:(old?.count||0)+1,activatedAt:now(),atStart:null,atRelease:null});
            if(!stopped&&!old?.active)checkRowTrades(rows.get(key));
            // 체결강도 at the activation (2026-11-14): KIS FHKST01010300 tday_rltv (KRX: 시장 J, NXT: 시장 NX), once per activation.
            if(!stopped&&!old?.active&&strength){const row=rows.get(key);void strength({exchange:e.exchange,code:e.code}).then(x=>{if(x&&Number.isFinite(x.value)&&rows.get(key)===row&&!row.cpower){row.cpower={value:x.value,at:x.at??now(),source:'한투 '+(e.exchange==='NXT'?'NX':'KRX')+' 체결강도'};persist();emit();}}).catch(()=>{});}
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
        // tradeAt: the last trade we know of. Realtime ticks (NH WS, LS JC0) are trades; a polled price counts only when it changed.
        const t0=q.receivedAt??now(),tradeAt=['WS','JC0'].includes(q.via)||old&&q.price!==old.price?t0:old?.tradeAt??null;
        quotes.set(id,{price:q.price,rate:q.rate??old?.rate??null,amount:q.amount??old?.amount??null,amountVia:q.amount!=null?q.via:old?.amountVia,
            amountAt:q.amount!=null?q.receivedAt??now():old?.amountAt,receivedAt:t0,tradeAt,source:q.via==='JC0'?'LS 실시간 체결':'NH '+(q.via==='WS'?'실시간':'조회')});
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
    // ---- 주식선물 가격제한 도달 행 (2026-11-14 정책, futures-limit-watch.js 설명 참고)
    //  - 발동: 감시 월물의 체결가가 그날(확대 뒤에는 그 단계) 상·하한가와 같아진 순간. 구분 "+10% 도달" · "-20% 도달".
    //  - 해제: 그 방향 다음 단계 확대(LS JX0)를 받은 때. '해제까지'는 발동부터 5분, 지나도 JX0이 없으면 "해제 대기".
    //    해제 때 값은 해제 뒤 첫 선물 체결(최대 futuresWaitMs = 1분)로 고정하고, 그 안에 체결이 없으면 "체결 없음"으로 둔다.
    //  - 3단계(±30%)는 더 확대되지 않아 5분 뒤 "마지막 단계"로 해제한다. 15:45까지 해제 신호가 없으면 "해제 신호 없음"으로 닫는다.
    //  - JX0이 발동 + 5분 30초보다 늦게 오면: 발동 5분 안에 그 시장(코스피 · 코스닥) CB 발동(JIF 61 · 68)을 받았고 JX0이 CB 해제 ·
    //    호가접수(62 · 70) 뒤에 왔을 때만 "가격제한폭 先확대"로 바꾼다(규정: 5분 안에 장이 중단되면 단일가 재개 직전에 먼저 확대).
    //    그 밖에는 구분을 두고 마우스 오버에 늦은 시간과 "원인 미확인"(연결이 끊겼던 때는 "판정 불가")을 남긴다.
    //    08:45~09:00 · 장 마감 동시호가(15:35~)에 생긴 행과 역산 행은 이 판정을 하지 않는다.
    //  - 놓친 도달: 행 없이 JX0을 받으면 발동 = JX0 − 5분으로 역산한 행을 만들고(backfilled, 화면 ≈), 괴리율 1% 판정은 해제 때 값으로 한다.
    const futuresTimers=new Map(),marketEvents=[],feedDown=[],strengthOf=new Map(),limitsTasks=new Set();
    const registrationListeners=new Set();
    let limitsQueue=Promise.resolve(),baseState={day:'',base:{},volumes:{},ready:false},baseTask=null;
    const notifyRegistrations=()=>{for(const fn of registrationListeners)try{fn();}catch{}};
    const kstMinute=t=>{const k=new Date(t+9*3600000);return k.getUTCHours()*60+k.getUTCMinutes();};
    const sessionWindow=t=>kstMinute(t)<540?'preopen':kstMinute(t)>=935?'closing':'regular';
    const limitText=(side,stage)=>(side==='up'?'+':'-')+stage*10+'% 도달';
    const stockOf=futcode=>{const f=futuresMaster.find(x=>x.shcode===futcode);if(!f)return null;const code=String(f.basecode).trim().replace(/^A(?=[0-9A-Z]{6}$)/,'');return /^[0-9A-Z]{6}$/.test(code)?{code,f}:null;};
    const contractOf=(futcode,f)=>({code:futcode,name:f?.hname||futcode,month:String(f?.hname?.match(/20\d{4}/)?.[0]||'')});
    const limitRows=()=>[...rows.values()].filter(r=>r.exchange==='FUT'&&r.limit);
    // LS t8404 (주식선물 시간대별 체결): the latest trades, newest first. chetime HHMMSS…, chdegree = 체결강도.
    async function recentTrades(futcode,etime=''){
        const d=await rest('t8404','futureoption/market-data',{focode:futcode,cvolume:0,stime:'',etime,cts_time:''});
        return (d.t8404OutBlock1||[]).map(x=>({price:price(x.price),at:clockAt(x.chetime,now()),cpower:num(x.chdegree)})).filter(x=>x.price>0);
    }
    const watch=createFuturesLimitWatch({now,unsubscribeDelayMs,
        onSubscriptions:()=>notifyRegistrations(),
        needLimits:code=>{
            // Limits not seen yet (JD0 dy_gubun 2 comes before the first trade): LS t8402 상 · 하한가, one contract at a time.
            if(limitsTasks.has(code))return;limitsTasks.add(code);
            limitsQueue=limitsQueue.then(()=>rest('t8402','futureoption/market-data',{focode:code})).then(d=>{const o=d.t8402OutBlock||{};watch.setLimits(code,{up:price(o.uplmtprice),dn:price(o.dnlmtprice)});noteTrade(code,o);}).catch(()=>{});
        },
        // When a month becomes near the limit: the trades before the JC0 registration (back to the first trade at the limit).
        checkLast:async(futcode,{up,dn})=>{
            const list=await recentTrades(futcode);if(!list.length)return null;
            const atLimit=x=>up>0&&x.price>=up||dn>0&&x.price<=dn;
            if(!atLimit(list[0]))return list[0];
            let first=list[0];for(const x of list){if(!atLimit(x)||(x.price>=up)!==(first.price>=up))break;first=x;}
            return {...first,cpower:list[0].cpower};
        },
        onTrade:t=>{if(t.cpower!=null)strengthOf.set(t.futcode,{value:t.cpower,at:t.at});onQuote({exchange:'FUT',key:t.futcode,price:t.price,receivedAt:t.receivedAt??now(),via:'JC0'});},
        onHit:h=>void hitRow(h).catch(()=>{}),
        onExpand:e=>void expandRow(e).catch(()=>{}),
        onMarket:m=>{if(m.market&&m.status){marketEvents.push(m);if(marketEvents.length>500)marketEvents.shift();}}
    });
    const marketCode=m=>m==='K'?'1':m==='Q'?'2':null;
    function feedWasDown(from,to){return feedDown.some(x=>x.from<=to&&(x.to??now())>=from);}
    function onFuturesConnection(up){
        if(!up){if(!feedDown.length||feedDown.at(-1).to!=null)feedDown.push({from:now(),to:null});}
        else if(feedDown.length&&feedDown.at(-1).to==null)feedDown.at(-1).to=now();
        if(feedDown.length>200)feedDown.shift();
    }
    async function fetchFuturesStrength(r,etime=''){
        try{const list=await recentTrades(r.contract.code,etime);const x=list.find(t=>t.cpower!=null);if(x&&!r.cpower){r.cpower={value:x.cpower,at:x.at,source:'LS t8404'};persist();emit();}}catch{}
    }
    async function newLimitRow({futcode,side,stage,at,price:p,limitPrice=null,cpower,backfilled=false}){
        await masters().catch(()=>{});
        const s=stockOf(futcode);if(!s)return null;
        rollover();
        const {code,f}=s,master=stockMaster.get(code),contract=contractOf(futcode,f);
        const key=code+':FUT:'+futcode+':'+side+stage;
        if(rows.has(key))return null;
        const same=[...rows.values()].find(r=>r.code===code&&r.contracts?.length);
        const recent=strengthOf.get(futcode);
        const r={code,exchange:'FUT',contract,limit:{side,stage,price:limitPrice??p??null},name:master?.name||code,market:master?.market||'-',kind:'LIMIT',kindText:limitText(side,stage),direction:side==='up'?'up':'down',
            startedAt:at,lastEventAt:at,releasedAt:null,active:true,contracts:same?.contracts||[],futuresChecked:same?.futuresChecked||false,count:1,activatedAt:now(),
            atStart:p>0?{at,rate:futuresRate(futcode,p),price:p,via:'LS'}:null,atRelease:null,window:backfilled?'backfill':sessionWindow(at),
            ...(backfilled?{backfilled:true}:{}),cpower:cpower!=null?{value:cpower,at,source:'LS JC0'}:!backfilled&&recent&&now()-recent.at<60000?{...recent,source:'LS JC0'}:null};
        rows.set(key,r);futureOwner.set(futcode,code);lastReceivedAt=now();
        if(!stopped){watchQuotes(code,[...new Set([futcode,...(r.contracts||[]).map(c=>c.code)])]);void enrich(code);}
        // 기준가 · 거래승수 (t8402) for the futures 등락률 and 호가 금액.
        void expiryOf(futcode).then(()=>{if(r.atStart&&r.atStart.rate==null)r.atStart.rate=futuresRate(futcode,r.atStart.price);emit();},()=>{});
        if(!r.cpower)void fetchFuturesStrength(r,backfilled?kstClock(at):'');
        return r;
    }
    async function hitRow(h){
        const r=await newLimitRow({...h,limitPrice:h.limit});if(!r)return;
        // 5 minutes after the hit: the last stage is released; otherwise the row waits for the JX0 expansion.
        clearTimeout(futuresTimers.get(rowKey(r)));
        const timer=setTimeout(()=>{if(!r.active)return;if(r.limit.stage>=3)releaseLimit(r,r.startedAt+futuresEventMs,'마지막 단계 (±30%) · 더 확대되지 않음');else{r.waiting=true;persist();emit();}},Math.max(0,r.startedAt+futuresEventMs-now()));
        timer.unref?.();futuresTimers.set(rowKey(r),timer);
        for(const [id,quote] of quotes){const [exchange,qkey]=id.split(':');if(['KRX','NXT'].includes(exchange)&&qkey===r.code||exchange==='FUT'&&futureOwner.get(qkey)===r.code)sample(r.code,exchange,qkey,quote.price,quote.receivedAt??now(),quote.rate??null);}
        checkGap(r.code);persist();emit();
    }
    async function expandRow(e){
        rollover();
        await masters().catch(()=>{});
        const stage=e.step-1;if(stage<1)return;
        const r=limitRows().find(x=>x.contract?.code===e.futcode&&x.limit.side===e.side&&x.limit.stage===stage);
        if(r&&r.active){
            const delay=e.at-r.startedAt-futuresEventMs;
            if(r.window==='regular'&&delay>lateMs){
                const mk=marketCode(r.market);
                const cb=marketEvents.find(m=>m.market===mk&&['61','68'].includes(m.status)&&m.at>=r.startedAt-1000&&m.at<=r.startedAt+futuresEventMs);
                const resume=cb&&marketEvents.find(m=>m.market===mk&&['62','70'].includes(m.status)&&m.at>cb.at&&m.at<=e.at+60000);
                if(cb&&resume){r.reachText=r.kindText;r.kindText='가격제한폭 先확대';r.preExpand={cbAt:cb.at,cbStatus:cb.status,resumeAt:resume.at,expandAt:e.at};}
                else r.lateNote=feedWasDown(r.startedAt,e.at)?'LS 연결이 끊겼던 때라 先확대 판정 불가':`규정 5분보다 ${Math.round(delay/1000)}초 늦게 수신 · 원인 미확인`;
            }
            releaseLimit(r,e.at,'JX0 '+(e.side==='up'?'상한':'하한')+' '+e.step+'단계 확대 수신',{expandLimit:e.limit});
            return;
        }
        if(r)return;
        // Missed hit: rebuild the row from the expansion (발동 = JX0 − 5분).
        const b=await newLimitRow({futcode:e.futcode,side:e.side,stage,at:e.at-futuresEventMs,price:null,limitPrice:e.prevLimit??null,cpower:null,backfilled:true});
        if(b)releaseLimit(b,e.at,'JX0 '+(e.side==='up'?'상한':'하한')+' '+e.step+'단계 확대 수신 (발동은 역산)',{expandLimit:e.limit});
    }
    // Release of a limit row: the values at the first futures trade after it (up to futuresWaitMs), else "체결 없음".
    function releaseLimit(r,at,basis,{wait=true,expandLimit=null,note=null}={}){
        clearTimeout(futuresTimers.get(rowKey(r)));futuresTimers.delete(rowKey(r));
        r.active=false;r.waiting=false;r.releasedAt=at;r.lastEventAt=at;r.releaseBasis=basis;if(expandLimit)r.expandLimit=expandLimit;if(note)r.closeNote=note;
        const id=recordId(r);
        if(!wait){r.atRelease=releaseValues(r,basis);judgeBackfill(r);const rec=records.get(id);if(rec)rec.atRelease=columns(view(r));persist();emit();scheduleUnwatch(r.code);return;}
        r.releasePending=true;r.releaseAskedAt=now();
        clearTimeout(releaseTimers2.get(id));
        const timer=setTimeout(()=>{
            releaseTimers2.delete(id);if(!r.releasePending)return;
            r.releasePending=false;const v=releaseValues(r,basis+' · 해제 뒤 1분 선물 체결 없음'),nt=x=>typeof x==='number'||x==null?'체결 없음':x;
            r.atRelease={...v,rate:null,noTrade:true,gap:{KRX:nt(v.gap.KRX),NXT:nt(v.gap.NXT),FUT:'Base'}};
            const rec=records.get(id);if(rec)rec.atRelease=columns(view(r));
            persist();emit();scheduleUnwatch(r.code);
        },futuresWaitMs);timer.unref?.();releaseTimers2.set(id,timer);
        persist();emit();
    }
    // Backfilled rows: the 1% check uses the release values (the activation moment itself was not seen).
    function judgeBackfill(r){
        if(!r.backfilled||r.gapHit||!r.atRelease)return;
        const g=r.atRelease.gap||{},list=[['KRX',g.KRX],['NXT',g.NXT]].filter(([,v])=>typeof v==='number'&&Math.abs(v)>=gapThreshold);
        if(list.length){const [kind,value]=list.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]))[0];r.gapHit=r.gapMax={at:r.atRelease.at??now(),kind,value:round2(value),fromRelease:true};}
    }
    // 15:45: rows still waiting for their expansion close with "해제 신호 없음" (CB 3단계: the market ended the day).
    function tick(){
        rollover();
        queueCharts();
        if(kstMinute(now())>=945)for(const r of limitRows())if(r.active){
            const mk=marketCode(r.market),cb3=marketEvents.some(m=>m.market===mk&&m.status==='69'&&m.at>=r.startedAt);
            releaseLimit(r,now(),'해제 신호 없음',{wait:false,note:cb3?'CB 3단계로 당일 매매 종료':r.window==='preopen'?'08:45~09:00에 도달 · 확대 신호를 받지 못함':r.window==='closing'?'장 마감 동시호가에 도달 · 확대 신호를 받지 못함':'장 마감까지 확대(JX0)를 받지 못함'});
        }
        const k=new Date(now()+9*3600000);
        if(enabled()&&kstMinute(now())>=450&&kstMinute(now())<945&&policy()?.openDate?.(day)!==false&&![0,6].includes(k.getUTCDay()))void baseContracts().catch(()=>{});
    }
    async function onFuturesEvent(e) {
        rollover();
        const body=e.body||{};
        if(e.tr!=='JIF'&&!body.futcode&&e.futcode)body.futcode=e.futcode;
        watch.receive(e.tr,body,e.receivedAt??now());
    }
    // ---- 감시 월물(기준종목, 2026-11-14): 종목마다 최근월 · 차월 중 전일 거래량(LS t8405 futcheck 0, 그 월물의 일별)이 많은 월물.
    // 거래소 규정의 기준종목 = 직전 거래일 정규거래 약정수량이 가장 많은 결제월(직전 거래일 · 당일 최종거래일 월물 제외).
    // 만기(최종거래일)는 그 달 둘째 목요일(휴장이면 앞 영업일)로 계산해 오늘 만기 월물을 뺀다. 하루 한 번, 결과는 futures-base.json.
    // 다 구하기 전에는 최근월물을 쓰고, 구하면 등록을 바꾼다(sync). 확대 뒤에도 바꾸지 않는다(거래소가 이 월물로 확대를 판단).
    const baseFile=directory&&path.join(directory,'futures-base.json');
    function lastTradingDay(ym){
        const y=Number(ym.slice(0,4)),m=Number(ym.slice(4,6));if(!y||!m)return '';
        let d=1;while(new Date(Date.UTC(y,m-1,d)).getUTCDay()!==4)d++;d+=7;
        let t=Date.UTC(y,m-1,d);
        for(let i=0;i<7;i++){const s=new Date(t).toISOString().slice(0,10);if(policy()?.openDate?.(s)!==false&&![0,6].includes(new Date(t).getUTCDay()))return s;t-=86400000;}
        return new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);
    }
    function monthCandidates(){
        const by=new Map();
        for(const f of futuresMaster){
            const code=String(f.basecode).trim().replace(/^A(?=[0-9A-Z]{6}$)/,''),m=String(f.hname?.match(/20\d{4}/)?.[0]||'');
            if(!/^[0-9A-Z]{6}$/.test(code)||!/^[A-Z0-9]{8}$/.test(f.shcode)||/스프레드|\bSP\b|SPREAD/i.test(f.hname||'')||!m)continue;
            if(lastTradingDay(m)<=day)continue;
            if(!by.has(code))by.set(code,[]);
            by.get(code).push({futcode:f.shcode,name:f.hname,month:m});
        }
        for(const list of by.values())list.sort((a,b)=>a.month.localeCompare(b.month));
        return new Map([...by].map(([code,list])=>[code,list.slice(0,2)]));
    }
    try{const saved=baseFile&&fs.existsSync(baseFile)&&JSON.parse(fs.readFileSync(baseFile,'utf8'));if(saved&&saved.day===day&&saved.base&&typeof saved.base==='object')baseState={day,base:saved.base,volumes:saved.volumes||{},ready:true};}catch{}
    async function baseContracts(){
        if(baseState.day===day&&baseState.ready)return baseState.base;
        if(baseTask)return baseTask;
        baseTask=(async()=>{
            const requestDay=day;await masters();
            const today=day.replaceAll('-',''),base={},volumes={};
            for(const [code,list] of monthCandidates()){
                if(day!==requestDay)return baseState.base;
                let best=list[0];
                if(list.length>1){
                    for(const c of list){
                        try{const d=await rest('t8405','futureoption/market-data',{shcode:c.futcode,futcheck:'0',date:'',cts_code:'',lastdate:'',cnt:5});
                            const prev=(d.t8405OutBlock1||[]).filter(x=>String(x.date)<today).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0];
                            volumes[c.futcode]={date:prev?String(prev.date):null,volume:num(prev?.volume)};}catch{volumes[c.futcode]={date:null,volume:null};}
                    }
                    const v=c=>volumes[c.futcode]?.volume??-1;
                    best=list.reduce((a,b)=>v(b)>v(a)?b:a,list[0]);
                }
                base[code]={futcode:best.futcode,name:best.name,month:best.month,candidates:list.map(c=>c.futcode)};
            }
            if(day!==requestDay)return baseState.base;
            baseState={day,base,volumes,ready:true};
            if(baseFile)try{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(baseFile+'.tmp',JSON.stringify({day,base,volumes}));fs.renameSync(baseFile+'.tmp',baseFile);}catch{}
            log('[선물 가격제한] 감시 월물 '+Object.keys(base).length+'종목 (전일 거래량 비교 '+Object.keys(volumes).length+'월물)');
            notifyRegistrations();emit();return base;
        })().finally(()=>{baseTask=null;});
        return baseTask;
    }
    // The watched month of a stock: the base month when known, else the nearest of its months.
    function baseOf(code,contracts=[]){
        const b=baseState.day===day&&baseState.base[code];
        if(b)return {code:b.futcode,name:b.name,month:b.month,basis:'전일 거래량이 많은 월물'};
        const c=contracts.find(x=>!x.expiry||x.expiry>day.replaceAll('-',''))||contracts[0];
        return c?{code:c.code,name:c.name,month:String(c.name?.match(/20\d{4}/)?.[0]||''),basis:'최근월물(감시 월물 계산 전)'}:null;
    }
    // LS registrations for ls-futures-events.js: JIF, JX0 · JD0 per watched month, JC0 for near · expanded · shown months.
    async function futuresRegistrations(){
        rollover();
        void baseContracts().catch(()=>{});
        let months;
        if(baseState.day===day&&baseState.ready)months=Object.values(baseState.base).map(b=>b.futcode);
        else months=await futuresContracts().catch(()=>[]);
        return [['JIF','0'],...[...new Set(months)].sort().flatMap(c=>[['JX0',c],['JD0',c]]),...watch.subscriptions().sort().map(c=>['JC0',c])];
    }
    // The near-month contract of each stock (from the LS master): the registrations until the base months are known.
    async function futuresContracts() {
        await masters();
        const best=new Map();
        for(const [code,list] of monthCandidates())if(list[0])best.set(code,list[0].futcode);
        return [...best.values()].sort();
    }
    // ---- 행 분석 차트 (2026-11-14): '발동(등록)'부터 '해제 + 1분'까지(켜져 있는 행은 지금까지) 1초마다 등락률 · 괴리율 · 체결강도.
    //  - 매 체결이 아니라 1초 간격(chartStepMs) 시각마다 시장별 그때까지의 마지막 체결로 계산한다(체결이 많은 종목도 조회 수가 구간 ÷ 1초 이하).
    //    KRX · NXT 현물: 한투 FHPST01060000(시장 J · NX, 그 시각 이전 체결 30건, tday_rltv = 그 체결 때 체결강도). 한 번 받은 30건이 덮는
    //    1초 시각은 다시 조회하지 않고, VI 중처럼 체결이 없는 동안은 마지막 체결 시각까지 건너뛴다.
    //    선물: LS t8404(30건씩 cts_time, chdegree)를 구간 앞까지 받은 뒤 1초 시각에 맞춘다(최대 chartPages번, 넘으면 앞부분이 빈다).
    //  - 값: Base 등락률(선물은 체결가 ÷ t8402 기준가 − 1), 괴리율 = (그 시장 ÷ Base − 1) × 100(표와 같음), Base 체결강도. 선물은 표와 같은 월물.
    //  - 기록: 거래대금(전일기준) · 시가총액 설정(VI 창 드롭다운, 서버 record-filter.json)을 만족하는 행만, 해제 + 1분이 지나면 자동으로
    //    한 번 만들어 vi-monitor/charts/날짜/에 남긴다(로컬 PC 서버). 설정을 만족하지 않는 행도 버튼을 누르면 그때 계산해 보여 주지만 남기지 않는다.
    const chartTasks=new Map(),chartQueue=[],recordFilterFile=directory&&path.join(directory,'record-filter.json');
    let recordFilter={prevAmount:0,marketCap:0},chartQueueRunning=false;
    try{const saved=recordFilterFile&&fs.existsSync(recordFilterFile)&&JSON.parse(fs.readFileSync(recordFilterFile,'utf8'));if(saved)recordFilter={prevAmount:Number(saved.prevAmount)||0,marketCap:Number(saved.marketCap)||0};}catch{}
    function setRecordFilter({prevAmount,marketCap}){
        recordFilter={prevAmount:Math.max(0,Number(prevAmount)||0),marketCap:Math.max(0,Number(marketCap)||0)};
        if(recordFilterFile)try{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(recordFilterFile,JSON.stringify({...recordFilter,at:now()}));}catch{}
        return recordFilter;
    }
    // Same rule as the window's dropdowns: an unknown value does not pass a set threshold. 시가총액 = the shown value (release value once released).
    function passesRecordFilter(r){
        const v=view(r),cap=!r.active&&r.atRelease?r.atRelease.marketCap:v.marketCap;
        return (!recordFilter.prevAmount||v.prevAmount!=null&&v.prevAmount>=recordFilter.prevAmount)&&(!recordFilter.marketCap||cap!=null&&cap>=recordFilter.marketCap);
    }
    const chartFile=(d,id)=>directory&&path.join(directory,'charts',d,id.replace(/[^0-9A-Za-z:_-]/g,'_').replaceAll(':','_')+'.json');
    const stockTrade=x=>({at:clockAt(x.stck_cntg_hour,now()),price:price(x.stck_prpr),rate:num(x.prdy_ctrt)==null?null:['4','5'].includes(String(x.prdy_vrss_sign))?-Math.abs(num(x.prdy_ctrt)):Math.abs(num(x.prdy_ctrt)),cpower:num(x.tday_rltv)});
    // As-of trade at each grid time (grid ascending), newest first through the KIS pages.
    async function kisSamples(market,code,grid){
        const out=new Map();let i=grid.length-1,calls=0;
        while(i>=0&&calls<chartKisPages){
            calls++;const hour=kstClock(grid[i]);
            let raw;try{raw=await stockTrades({market,code,hour});}catch{await new Promise(r=>setTimeout(r,1000));raw=await stockTrades({market,code,hour});}
            const list=(raw||[]).map(stockTrade).filter(x=>x.price>0).sort((a,b)=>b.at-a.at);
            if(!list.length)break;
            const earliest=list.at(-1).at;
            // Every grid time down to the earliest trade of this page has its as-of trade in the page.
            while(i>=0&&grid[i]>=earliest){const t=grid[i];const x=list.find(y=>y.at<=t);if(x)out.set(t,x);i--;}
            if(i<0)break;
            // No trade between the page and the next grid time: the next query starts there (skips quiet stretches such as a VI).
            if(list.length<30){while(i>=0){out.set(grid[i],null);i--;}break;}
        }
        return {samples:out,truncated:i>=0&&calls>=chartKisPages};
    }
    const lsFuturesTrades=async(code,from,to)=>{
        const out=[];let cts='',calls=0;
        const etime=kstClock(Math.min(to+60000,Date.parse(dayKey(to)+'T23:59:00+09:00'))).slice(0,4);
        while(calls<chartPages){
            calls++;
            const d=await rest('t8404','futureoption/market-data',{focode:code,cvolume:0,stime:'',etime,cts_time:cts},!!cts);
            const list=(d.t8404OutBlock1||[]).map(x=>({at:clockAt(String(x.chetime||''),to),price:price(x.price),cpower:num(x.chdegree)})).filter(x=>x.price>0);
            out.push(...list.filter(x=>x.at<=to));
            cts=String(d.t8404OutBlock?.cts_time||'');
            if(!list.length||Math.min(...list.map(x=>x.at))<from||!cts)return {trades:out.sort((a,b)=>a.at-b.at),truncated:false};
        }
        return {trades:out.sort((a,b)=>a.at-b.at),truncated:true};
    };
    async function chartData({key,startedAt,day:d=day}){
        rollover();
        const today=d===day,id=key+':'+startedAt,file=chartFile(d,id);
        try{if(file&&fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
        const pick=list=>list.find(r=>(r.rowKey||rowKey(r))===key&&r.startedAt===startedAt);
        const row=today?pick([...rows.values()]):pick(archivedDay(d)?.rows||[]);
        if(!row)throw Object.assign(Error('행을 찾지 못했습니다'),{status:404});
        if(!today)throw Object.assign(Error('이 행은 차트 기록이 없습니다 (거래대금 · 시가총액 설정을 만족한 행만 해제 + 1분 뒤 기록하고, 시간대별 체결 조회는 당일만 됩니다)'),{status:404});
        if(!Number.isFinite(row.startedAt))throw Object.assign(Error('발동 시각을 받지 못한 행입니다'),{status:404});
        if(chartTasks.has(id))return chartTasks.get(id);
        const task=(async()=>{
            // The futures months of the stock (normally known since the activation).
            if(row.exchange!=='FUT'&&!row.futuresChecked)await enrich(row.code)?.catch?.(()=>{});
            const v=view(row),from=row.startedAt,end=Number.isFinite(row.releasedAt)?row.releasedAt+60000:null,to=Math.min(end??now(),now());
            const grid=[];for(let t=from;t<to;t+=chartStepMs)grid.push(t);grid.push(to);
            const fut=row.exchange==='FUT'?row.contract?.code:v.futuresBase?.code;
            if(fut)await expiryOf(fut).catch(()=>{});
            const markets=[['KRX',row.code],['NXT',v.nxtSupported===false?null:row.code],['FUT',fut]].filter(([,k])=>k);
            const got={},notes=[];
            // 한투(KRX · NXT)와 LS(선물)는 함께, 한투 두 시장은 차례로 조회한다(11/14: 한투를 동시에 부르면 500 초당 한도).
            const one=async(m,k)=>{
                try{
                    if(m==='FUT'){
                        const r=await lsFuturesTrades(k,from,to),s=new Map();let j=-1;
                        for(const t of grid){while(j+1<r.trades.length&&r.trades[j+1].at<=t)j++;s.set(t,j>=0?r.trades[j]:null);}
                        got[m]=s;if(r.truncated)notes.push('선물 체결이 많아 앞부분이 빠짐');return;
                    }
                    if(!stockTrades){notes.push(m+' 체결 조회 없음');return;}
                    const r=await kisSamples(m==='KRX'?'J':'NX',k,grid);got[m]=r.samples;if(r.truncated)notes.push(m+' 조회 수 한도로 앞부분이 빠짐');
                }catch(e){notes.push(m+' 조회 실패: '+String(e?.message||e).slice(0,60));}
            };
            await Promise.all([(async()=>{for(const [m,k] of markets)if(m!=='FUT')await one(m,k);})(),...markets.filter(([m])=>m==='FUT').map(([m,k])=>one(m,k))]);
            const base=row.exchange,series={rate:[],strength:[],gaps:{}};
            for(const m of Object.keys(got))if(m!==base)series.gaps[m]=[];
            for(const t of grid){
                const b=got[base]?.get(t);if(!b)continue;
                series.rate.push([t,round2(base==='FUT'?futuresRate(fut,b.price):b.rate)]);if(b.cpower!=null)series.strength.push([t,Math.round(b.cpower)]);
                for(const m of Object.keys(series.gaps)){const x=got[m].get(t);if(x)series.gaps[m].push([t,round2(comparison(x.price,b.price))]);}
            }
            const label=m=>m==='FUT'?'선물 '+(Number(String((row.exchange==='FUT'?row.contract?.month:v.futuresBase?.month)||'').slice(4))||'')+'월':m;
            const out={id,day:d,code:row.code,name:row.name,base,baseLabel:label(base),labels:Object.fromEntries(Object.keys(got).map(m=>[m,label(m)])),kindText:row.kindText||KIND[row.kind]||null,
                startedAt:row.startedAt,releasedAt:row.releasedAt??null,from,to,end,stepMs:chartStepMs,complete:end!=null&&now()>=end,series,notes,
                source:'1초마다 그때까지의 마지막 체결 · KRX · NXT: 한투 FHPST01060000 (시간대별 체결, tday_rltv) · 선물: LS t8404 (chdegree)'};
            out.recorded=out.complete&&passesRecordFilter(row)&&!notes.some(n=>/실패/.test(n));
            if(out.recorded&&file)try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(out));}catch{out.recorded=false;}
            return out;
        })().finally(()=>chartTasks.delete(id));
        chartTasks.set(id,task);return task;
    }
    // Automatic records: rows past their release + 1 minute that pass the filter, one at a time (called from tick).
    function queueCharts(){
        for(const r of rows.values()){
            if(r.active||!Number.isFinite(r.startedAt)||!Number.isFinite(r.releasedAt)||now()<r.releasedAt+65000||r.chartRecorded)continue;
            const id=(r.rowKey||rowKey(r))+':'+r.startedAt,file=chartFile(day,id);
            if(file&&fs.existsSync(file)){r.chartRecorded=true;continue;}
            if(!passesRecordFilter(r)||chartQueue.includes(r))continue;
            chartQueue.push(r);
        }
        if(chartQueueRunning||!chartQueue.length||!stockTrades&&!enabled())return;
        chartQueueRunning=true;
        void (async()=>{
            try{while(chartQueue.length&&!stopped){const r=chartQueue.shift();try{const c=await chartData({key:rowKey(r),startedAt:r.startedAt});if(c.recorded)r.chartRecorded=true;else r.chartRecorded='skip';}catch{r.chartRecorded='skip';}}}
            finally{chartQueueRunning=false;}
        })();
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
    let showingPrevious=null;
    function start(){
        if(!enabled()){state=disabledState;emit();return;}
        if(!stopped)return;stopped=false;quoteFeed?.start();
        // Prices for VIs still active after a restart.
        for(const r of rows.values())if(r.active){watchQuotes(r.code,(r.contracts||[]).map(c=>c.code));void enrich(r.code);}
        syncNxtBook();void connect();void verifyReleasedFutures();
        schedule=setInterval(()=>{tick();const showing=!rows.size&&!sessionStarted();if(showing!==showingPrevious){showingPrevious=showing;emit();}if(policy()&&!policy().spotAt(now())&&socket)socket.close();else if(!socket)void connect();},30000);schedule.unref?.();
    }
    function stop(){watch.stop();for(const t of futuresTimers.values())clearTimeout(t);futuresTimers.clear();for(const id of [...records.keys()])finishRecord(id,true);for(const t of releaseTimers2.values())clearTimeout(t);releaseTimers2.clear();stopped=true;clearTimeout(retry);clearTimeout(emitTimer);clearInterval(schedule);cleanup();for(const t of releaseTimers.values())clearTimeout(t);releaseTimers.clear();quoteFeed?.stop();nxtBook?.stop();clearInterval(futuresBookTimer);futuresBookTimer=null;socket?.terminate();socket=null;}
    // Stop the new-VI blink for one activation; a later activation creates a fresh row and blinks again.
    function dismissFlash(code,exchange,startedAt) {
        rollover();
        const row=[...rows.values()].find(r=>r.code===code&&r.exchange===exchange&&r.startedAt===startedAt);
        if(!row||!row.active||row.startedAt!==startedAt)return false;
        if(!row.flashDismissed){row.flashDismissed=true;persist();emit();}
        return true;
    }
    if(!enabled())state=disabledState;
    // The server was off when the day changed: keep that day's saved rows as its record (values as saved; no live prices).
    if(staleSaved&&!archivedDay(staleSaved.day)) {
        const valid=staleSaved.rows.filter(r=>r&&/^[0-9A-Z]{6}$/.test(r.code)&&['KRX','NXT','FUT'].includes(r.exchange)&&Number.isFinite(r.lastEventAt)&&typeof r.active==='boolean');
        const keep=[listInfo,prevAmounts];
        if(savedFilters?.day===staleSaved.day){
            if(Array.isArray(savedFilters.kiwoomList))listInfo=new Map(savedFilters.kiwoomList.map(([code,listCount,lastPrice])=>[code,{listCount,lastPrice}]));
            if(savedFilters.prevAmounts&&typeof savedFilters.prevAmounts==='object')prevAmounts=new Map(Object.entries(savedFilters.prevAmounts));
        }
        try{archiveDay(staleSaved.day,valid.map(view));}finally{[listInfo,prevAmounts]=keep;}
    }
    staleSaved=null;savedFilters=null;
    return {start,stop,archivedDays,archivedDay,chartData,setRecordFilter,recordFilter:()=>({...recordFilter}),tick,onFuturesConnection,futuresRegistrations,baseContracts,onRegistrations(fn){registrationListeners.add(fn);return()=>registrationListeners.delete(fn);},receive,onQuote,onFuturesEvent,futuresContracts,checkSamsungAmount,snapshot,dismissFlash,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);}};
}
module.exports={createViMonitor,eventTime,parseKiwoomVi};
