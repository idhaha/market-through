(() => {
    'use strict';
    let token=new URLSearchParams(location.hash.slice(1)).get('token')||sessionStorage.getItem('vi-window-token')||'';
    // Follow the main browser's zoom (sent by the server). The ratio uses the current zoom, so repeats are harmless.
    const applyScale=scale=>{const ratio=Number(scale)/devicePixelRatio;if(Number.isFinite(ratio)&&ratio>=0.25&&ratio<=4&&Math.abs(ratio-1)>0.02)window.chrome?.webview?.postMessage('page-scale:'+ratio);};
    if(token)sessionStorage.setItem('vi-window-token',token);
    history.replaceState(null,'',location.pathname);
    const body=document.getElementById('viBody'),status=document.getElementById('viStatus'),summary=document.getElementById('viSummary');
    // liveData: the server stream. historyData: a past day chosen with the date picker (2026-11-14); shown instead of the stream.
    let data={rows:[]},liveData=null,historyData=null,sort={key:'startedAt',direction:-1},controller,closed=false,retryTimer;
    // Sort icons from preview.html: up/down arrows (active direction highlighted) and a dot for inactive columns.
    const SORT_ARROWS='<svg viewBox="0 0 10 14"><path class="v" d="M5 2V12"/><path class="u" d="M3.2 3.6L5 1.6L6.8 3.6"/><path class="d" d="M3.2 10.4L5 12.4L6.8 10.4"/></svg>';
    const SORT_DOT='<svg viewBox="0 0 10 14"><circle cx="5" cy="7" r="1.2"/></svg>';
    for(const button of document.querySelectorAll('[data-sort]')){const icon=document.createElement('em');icon.className='sort-icon';icon.setAttribute('aria-hidden','true');button.append(icon);}
    const time=t=>Number.isFinite(t)?new Date(t).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
    // 소수점 1자리(2026-11-14). 반올림해 0이 되면 부호 없이 0.0%.
    const one=v=>{const r=Math.round(v*10)/10;return (r===0?0:r).toFixed(1);};
    const percent=v=>Number.isFinite(v)?(Math.round(v*10)/10>0?'+':'')+one(v)+'%':'—';
    const kind={'1':'정적','2':'동적','3':'동적,정적'};
    // Amounts in KRW as whole numbers with 만 · 억 · 조 (2026-11-09: no decimals): 2,345,678,901 → 23억, 45,678,900 → 4,568만.
    const UNITS=[[1e12,'조'],[1e8,'억'],[1e4,'만']];
    const money=v=>{
        if(!Number.isFinite(v))return '—';
        const unit=UNITS.find(([size])=>Math.abs(v)>=size);
        if(!unit)return Math.round(v).toLocaleString('ko-KR')+'원';
        return Math.round(v/unit[0]).toLocaleString('ko-KR')+unit[1];
    };
    // 괴리율 1% 이상 보기 (default on, remembered): only VIs whose |괴리율| reached the threshold before the release.
    const gapOnly=document.getElementById('viGapOnly');
    // 거래대금(전일기준) · 시가총액 filters (remembered). A row whose value is not known yet is hidden while a filter is set.
    const prevFilter=document.getElementById('viPrevAmount'),capFilter=document.getElementById('viMarketCap'),filterNote=document.getElementById('viFilterNote');
    // 2026-11-14: the same two values tell the server which rows get a chart record (해제 + 1분 뒤 1초 간격 자료).
    const sendRecordFilter=()=>fetch('/api/vi-monitor/record-filter',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-VI-Token':token}:{})},
        body:JSON.stringify({prevAmount:Number(prevFilter.value)||0,marketCap:Number(capFilter.value)||0})}).catch(()=>{});
    for(const [select,key] of [[prevFilter,'viPrevAmount'],[capFilter,'viMarketCap']]){
        const saved=localStorage.getItem(key);if(saved&&[...select.options].some(o=>o.value===saved))select.value=saved;
        select.addEventListener('change',()=>{localStorage.setItem(key,select.value);void sendRecordFilter();render();});
    }
    // 2026-11-11: values follow the triggering exchange (Base). Active rows show the live values (등락률: the value at the
    // activation); released rows keep the values at the release (atRelease).
    const rel=r=>!r.active?r.atRelease||null:null;
    const shown=(r,field)=>{const x=rel(r);if(!r.active)return x?x[field]??null:null;return field==='rate'&&r.exchange!=='FUT'?(r.atStart?.rate??r.rate):r[field];};
    const shownGap=r=>!r.active?rel(r)?.gap??null:r.gap??null;
    // 선물 칸(2026-11-14): 그 종목의 감시 월물 하나. 예전 기록(최근월 · 차기월 객체)은 최근월 값을 쓴다.
    const stateText=(state,isBase)=>state==='장 전'?'장 전: 이 시장은 아직 정규장 전이라 받은 가격이 전일 종가입니다. 괴리율은 그 가격으로 계산했고 1% 판정에도 넣습니다 (개장 KRX 09:00, 주식선물 08:45, NXT 08:00 · 수능일은 1시간 늦음)'
        :isBase?'체결 전: 이 시장은 열렸지만 그날 체결이 아직 없어(거래대금 0) Base 가격이 전일 종가입니다. 다른 시장 괴리율은 이 가격 기준입니다'
        :'체결 전: 이 시장은 열렸지만 그날 체결이 아직 없어(거래대금 0) 가격이 전일 종가입니다. 괴리율은 그 가격으로 계산했고 1% 판정에도 넣습니다';
    const futureGap=g=>g==null?null:g.FUT&&typeof g.FUT==='object'?g.FUT.recent??null:g.FUT??null;
    const monthText=m=>/^20\d{4}$/.test(String(m||''))?Number(String(m).slice(4))+'월':'';
    const futureMonth=r=>{const b=r.futuresBase||rel(r)?.futuresBase;if(b)return {code:b.code,name:b.name,month:b.month};const c=r.futures?.recent||r.contracts?.[0];return c?{code:c.code,name:c.name,month:String(c.name?.match(/20\d{4}/)?.[0]||'')}:null;};
    const minutesAgo=ms=>ms<60000?Math.round(ms/1000)+'초':Math.floor(ms/60000)+'분';
    // 1% 판정 제외 표시: 켜져 있는 행에서 그 시장 마지막 체결이 1분보다 오래됐을 때.
    const staleNote=(r,k)=>{const a=r.active?r.tradeAge?.[k]:null,limit=r.staleMs||60000;return a==null?(r.active&&r.tradeAge&&r.tradeAge[k]===null?' · 오늘 받은 체결 시각 없음 · 1% 판정 제외':''):a>limit?` · 체결 ${minutesAgo(a)} 전 · 1% 판정 제외`:'';};
    const passes=r=>{
        const minPrev=Number(prevFilter.value),minCap=Number(capFilter.value),cap=shown(r,'marketCap');
        return (!minPrev||r.prevAmount!=null&&r.prevAmount>=minPrev)&&(!minCap||cap!=null&&cap>=minCap);
    };
    gapOnly.checked=localStorage.getItem('viGapOnly')!=='false';
    gapOnly.addEventListener('change',()=>{localStorage.setItem('viGapOnly',String(gapOnly.checked));render();});
    const cell=(tr,text,className='')=>{const td=document.createElement('td');td.textContent=text;td.className=className;tr.append(td);return td;};
    // Clicked rows stop blinking; the server stores it per activation and syncs every window.
    const flashKey=r=>r.code+':'+r.exchange+':'+r.startedAt+(r.exchange==='FUT'?':'+(r.contract?.code||''):'');
    const dismissing=new Set();
    // Sort values: 해제 시각 only for released rows, 해제까지 by the expected release (activation + 2 min) of active rows.
    const numeric=v=>typeof v==='number'?v:null;
    const value=(r,key)=>['rate','marketCap','amount','bidAverage'].includes(key)?shown(r,key)
        :key==='gapKRX'?numeric(shownGap(r)?.KRX):key==='gapNXT'?numeric(shownGap(r)?.NXT):key==='gapFUT'?numeric(futureGap(shownGap(r))):key==='cpower'?(r.cpower?.value??null)
        :key==='exchange'?exchangeText(r):key==='kind'?(r.kind??null)
        :key==='releasedAt'?(r.active?null:r.releasedAt):key==='remaining'?(r.active&&r.startedAt!=null?r.startedAt+(r.durationMs||120000):null):key==='name'?(r.name||r.code):r[key];
    // 발동 거래소: KRX · NXT · 선물 M월 (contract month from the LS name, e.g. 202612 → 선물 12월).
    const exchangeText=r=>r.exchange!=='FUT'?r.exchange:'선물'+(r.contract?.month?' '+Number(r.contract.month.slice(4))+'월':'');
    const compare=(x,y)=>typeof x==='string'&&typeof y==='string'?x.localeCompare(y,'ko'):x>y?1:x<y?-1:0;
    function sorted() {
        return data.rows.filter(r=>(!gapOnly.checked||r.gapHit)&&passes(r)).sort((a,b)=>{
            const x=value(a,sort.key),y=value(b,sort.key);
            if(x==null&&y!=null)return 1;if(y==null&&x!=null)return -1;
            return (x===y||x==null?0:compare(x,y)*sort.direction)||(b.startedAt??-Infinity)-(a.startedAt??-Infinity)||a.code.localeCompare(b.code)||a.exchange.localeCompare(b.exchange);
        });
    }
    // 해제까지(예상): minutes:seconds:hundredths (two digits), redrawn every frame like a stopwatch countdown.
    // At zero it stays 00:00:00 until the release event arrives (the tooltip says so); it is not replaced by text.
    const remaining=ms=>String(Math.floor(ms/60000)).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+':'+String(Math.floor(ms/10)%100).padStart(2,'0');
    function countdown() {
        for(const el of body.querySelectorAll('[data-until]')) {
            const ms=Math.max(0,Math.ceil(Number(el.dataset.until)-Date.now()));
            // 선물 행: 5분이 지나도 확대(JX0)를 받지 못했으면 "해제 대기"(2026-11-14).
            el.textContent=el.dataset.futures&&!ms?'해제 대기':remaining(ms);
            el.title=el.dataset.futures?(ms?'한도 도달 + 5분(거래소 확대 예정)까지 남은 시간':'5분이 지났지만 가격제한폭 확대(JX0)를 아직 받지 못했습니다 · 받으면 해제, 15:45까지 없으면 해제 신호 없음'):(ms?'발동 시각 + 2분까지 남은 예상 시간':'예상 시간이 지났습니다 · 해제 수신 대기');
            el.className='countdown'+(ms<=30000?' soon':'');
            // Blink only in the last 30 seconds before the expected release. VI rows keep blinking while they wait for the release;
            // futures rows stop once they become 해제 대기 (2026-11-14: a late expansion can take hours; the color and text stay).
            const tr=el.closest('tr');if(tr?.dataset.flash)tr.classList.toggle('vi-blink',ms<=30000&&!(el.dataset.futures&&!ms));
        }
    }
    const tickClock=()=>{document.getElementById('viClock').textContent=new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});};
    const frame=()=>{countdown();requestAnimationFrame(frame);};
    // Sort arrows are painted when the page opens too, not only when data arrives: after a refresh they were empty
    // until the first data or a click (2026-11-12).
    function paintSortIcons() {
        for(const button of document.querySelectorAll('[data-sort]')) {
            const on=button.dataset.sort===sort.key;
            // Like preview.html: once a column is chosen, the other sortable columns show a dot.
            button.querySelector('.sort-icon').innerHTML=on||!sort.explicit?SORT_ARROWS:SORT_DOT;
            button.closest('th').setAttribute('aria-sort',on?(sort.direction<0?'descending':'ascending'):'none');
        }
    }
    function render() {
        const fragment=document.createDocumentFragment();
        sorted().forEach((r,i)=>{
            const tr=document.createElement('tr');tr.dataset.code=r.code;tr.dataset.exchange=r.exchange;
            tr.classList.toggle('released',!r.active);
            if(r.active && ['up','down'].includes(r.direction) && !r.flashDismissed && !dismissing.has(flashKey(r))) {
                tr.dataset.flash=flashKey(r);
                tr.classList.add('vi-flash-'+r.direction);
                // Rebuilding rows for quotes or sorting must preserve the blink phase.
                tr.style.setProperty('--vi-flash-delay',`-${performance.now()%1500}ms`);
            }
            cell(tr,i+1);cell(tr,r.market||'-');
            const hit=r.gapHit?` · 괴리율 1% 이상: ${r.gapHit.kind} ${percent(r.gapHit.value)} (${time(r.gapHit.at)})${r.gapMax&&r.gapMax!==r.gapHit?` · 최대 ${r.gapMax.kind} ${percent(r.gapMax.value)}`:''}`:'';
            cell(tr,r.name||r.code,'name').title=r.code+(r.restored?' · '+r.restored:'')+hit+` · 전일 거래대금 ${r.prevAmount!=null?money(r.prevAmount):r.prevAmountState==='pending'?'확인 중':'없음'}`;
            const x=rel(r),base=exchangeText(r),released=x?` · 해제 때 값 (${x.basis}, ${time(x.at)})`:r.releasePending?' · 해제 때 값 기다리는 중':'';
            // 등락률 · 시가총액 · 거래대금 · 호가 평균: the triggering exchange (Base); futures rows: 등락률 against the LS t8402 기준가, no 거래대금.
            const rate=shown(r,'rate'),rateCell=cell(tr,percent(rate),rate>0?'up':rate<0?'down':'muted');
            rateCell.title=r.exchange==='FUT'?`${base} 등락률: 선물 현재가 ÷ LS t8402 기준가 − 1 · 발동 때 ${percent(r.atStart?.rate)}${x?` · 해제 때 ${percent(x.rate)}`:''}${released}`:`${base} 전일 대비 등락률 · 발동 때 ${percent(r.atStart?.rate)}${x?` · 해제 때 ${percent(x.rate)}`:''}${released}`;
            // 체결강도(2026-11-14): 발동 때 값(매수 체결량 ÷ 매도 체결량 × 100, 그날 누적). 역산 행은 역산한 발동 시각 무렵 값.
            const cp=r.cpower?.value,cpCell=cell(tr,Number.isFinite(cp)?(r.backfilled?'≈':'')+Math.round(cp):'—','amount');
            cpCell.title=Number.isFinite(cp)?`${base} 체결강도 ${Math.round(cp)} (${r.cpower.source||''}${r.cpower.at?' · '+time(r.cpower.at):''}) · 발동 때 값`:'체결강도 미수신';
            const cap=shown(r,'marketCap');cell(tr,money(cap),'amount').title=cap!=null?`${Math.round(cap).toLocaleString('ko-KR')}원 · ${r.marketCapBasis||''} 기준${released}`:'상장주식수 또는 현재가 확인 중';
            const amount=shown(r,'amount');cell(tr,Number.isFinite(amount)?amount.toLocaleString('ko-KR',{maximumFractionDigits:0}):'—','amount').title=r.exchange==='FUT'?'선물 거래대금은 받지 않습니다':`${base} 누적 거래대금(백만 원)${released}`;
            cell(tr,base).title=r.exchange==='FUT'?`${r.contract?.name||r.contract?.code} (${r.contract?.code})${r.limit?' · 감시 월물(전일 거래량이 많은 월물)':''}`:'';
            // 구분: 선물 도달 행은 "+10% 도달" 등, 가격제한폭 先확대, 마우스 오버에 한도 · 해제 근거.
            const kindCell=cell(tr,r.kindText||kind[r.kind]||'—');
            if(r.limit){
                const lines=[`${r.reachText||r.kindText}: ${r.contract?.name||r.contract?.code} 체결가가 ${r.limit.side==='up'?'상한가':'하한가'} ${Number.isFinite(r.limit.price)?r.limit.price.toLocaleString('ko-KR')+'원':''}에 도달 (${r.limit.stage}단계 ±${r.limit.stage*10}%)`];
                if(r.backfilled)lines.push('도달을 받지 못해 확대(JX0) 수신 시각 − 5분으로 발동 시각을 역산한 행입니다. 괴리율 1% 판정은 해제 때 값으로 했습니다.');
                if(r.window==='preopen')lines.push('08:45~09:00(장 시작 전)에 도달');else if(r.window==='closing')lines.push('장 마감 동시호가에 도달');
                if(r.preExpand)lines.push(`가격제한폭 先확대: 도달 뒤 5분 안에 시장 거래가 중단(CB ${time(r.preExpand.cbAt)})됐다가 단일가로 재개(${time(r.preExpand.resumeAt)})되기 직전에 거래소가 가격제한폭을 먼저 확대했습니다(확대 수신 ${time(r.preExpand.expandAt)}).`);
                if(r.lateNote)lines.push(r.lateNote);
                if(!r.active&&r.releaseBasis)lines.push('해제: '+r.releaseBasis+(r.closeNote?' · '+r.closeNote:''));
                if(r.expandLimit)lines.push(`확대된 한도 ${Number(r.expandLimit).toLocaleString('ko-KR')}원`);
                kindCell.title=lines.join('\n');
            }
            cell(tr,(r.backfilled?'≈':'')+time(r.startedAt)).title=r.backfilled?'역산한 발동 시각 (확대 수신 − 5분)':'';cell(tr,r.active?'—':time(r.releasedAt));
            const cd=cell(tr,r.active?'':'해제','countdown');if(r.active&&r.startedAt!=null){cd.dataset.until=r.startedAt+(r.durationMs||120000);if(r.exchange==='FUT')cd.dataset.futures='1';}
            // 괴리율: 'Base' in the triggering exchange's column, 미지원 for NXT 미상장 / no stock futures, else vs Base.
            // 장 전 · 체결 전(2026-11-15): 값은 그대로(전일 종가 기준) 두고 작고 흐리게, 옆에 상태 글자. 해제된 행은 해제 때 상태.
            const st=(x?x.gapState:r.gapState)||{};
            const g=shownGap(r),gapCell=(v,title,suffix='',state=null)=>{const td=v==='Base'?cell(tr,'Base','base'):typeof v==='string'?cell(tr,v,'muted'):cell(tr,percent(v),v>0?'up':v<0?'down':'muted');
                if(state&&(v==='Base'||typeof v==='number')){td.classList.add('vi-pre');const s=document.createElement('span');s.className='vi-pre-tag';s.textContent=state;td.append(s);title=(title?title+'\n':'')+stateText(state,v==='Base');}if(suffix&&v!=='Base'){const m=document.createElement('span');m.className='vi-month';m.textContent=' '+suffix;td.append(m);}td.title=title;return td;};
            gapCell(g?.KRX,r.exchange==='KRX'?'발동 거래소(Base)':`KRX ÷ ${base} − 1${released}${st.KRX?'':staleNote(r,'KRX')}`,'',st.KRX);
            gapCell(g?.NXT,r.exchange==='NXT'?'발동 거래소(Base)':g?.NXT==='미지원'?'NXT에서 거래하지 않는 종목':`NXT ÷ ${base} − 1${released}${st.NXT?'':staleNote(r,'NXT')}`,'',st.NXT);
            const fv=futureGap(g),future=futureMonth(r),fname=future?.name||future?.code||'이 월물',mlabel=r.exchange==='FUT'?'':monthText(future?.month);
            // Released values checked against KIS 1-minute bars carry their source (2026-11-13).
            const checked=x?.futuresCorrected?.source??x?.futuresCorrected?.recent?.source;
            gapCell(fv,r.exchange==='FUT'?'발동 거래소(Base)':fv==='미지원'?'주식선물이 없는 종목':fv==='체결 없음'?(checked?`${fname} 해제 때까지 오늘 체결 없음 (${checked})`:`${fname} 오늘 체결 없음 (LS t8402 거래량 0)`):future?`${fname} ÷ ${base} − 1 · 감시 월물(전일 거래량이 많은 월물)${released}${checked?' · '+checked:''}${st.FUT?'':staleNote(r,'FUT')}`:r.detailError||'해당 월물 또는 가격 미수신',mlabel,st.FUT);
            const bid=shown(r,'bidAverage'),book=cell(tr,money(bid),'amount');
            const market=r.exchange==='FUT'?'선물':r.exchange;
            book.title=Number.isFinite(bid)?`${market} 매수 10호가 평균 ${Math.round(bid).toLocaleString('ko-KR')}원${x?released:` · 수신 ${time(r.bidAverageAt)}${r.bidAverageVia==='REST'?' (NH 조회 5초 주기)':r.bidAverageVia==='KIS'?' (한투 NX 조회 5초 주기)':r.bidAverageVia==='LS'?' (LS t8403 조회 5초 주기 · 잔량 계약 × 거래승수)':''}`}`:`${market} 호가 미수신`;
            // 분석 차트 버튼(맨 오른쪽, 2026-11-14): 네모 안 우상향 화살표. 발동부터 해제 + 1분까지(켜져 있으면 지금까지).
            const chartCell=cell(tr,'','vi-chart-cell');
            if(Number.isFinite(r.startedAt)){
                const b=document.createElement('button');b.type='button';b.className='vi-chart-button';b.title='분석 차트: 발동부터 해제 + 1분까지 1초마다 등락률 · 괴리율 · 체결강도';b.setAttribute('aria-label',(r.name||r.code)+' 분석 차트');
                b.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 12.5L12 4"/><path d="M7 4H12V9"/></svg>';
                const key=r.rowKey||r.code+':'+r.exchange+(r.exchange==='FUT'?':'+(r.contract?.code||'')+(r.limit?':'+r.limit.side+r.limit.stage:''):'');
                const day=data.history?data.day:data.previousSession?data.shownDay:null;
                b.addEventListener('click',e=>{e.stopPropagation();window.openViChart?.({key,startedAt:r.startedAt,day,token});});
                chartCell.append(b);
            }
            fragment.append(tr);
        });
        if(!fragment.childNodes.length){const tr=document.createElement('tr');const td=cell(tr,data.rows.length?'조건에 맞는 VI 종목이 없습니다. (괴리율 1% 이상 보기 · 거래대금 · 시가총액 조건을 바꾸면 더 볼 수 있습니다)':data.history?(data.missing?`${data.day} VI 기록이 없습니다. (기록은 이 서버가 VI를 받은 날부터 쌓입니다)`:`${data.day} VI 기록이 없습니다.`):'수신한 당일 VI 종목이 없습니다.','vi-empty');td.colSpan=17;fragment.append(tr);}
        body.replaceChildren(fragment);
        const active=data.rows.filter(r=>r.active),krx=new Set(active.filter(r=>r.exchange==='KRX').map(r=>r.code)),nxt=new Set(active.filter(r=>r.exchange==='NXT').map(r=>r.code));
        if(data.history||data.previousSession){const day=data.history?data.day:data.shownDay;summary.textContent=`${data.history?'':'직전 장 '}${day} 기록 · 해제 ${data.rows.length}건 · 괴리율 1% 이상 ${data.rows.filter(r=>r.gapHit).length}건`;}
        else summary.textContent=`현재 발동 중 · KRX ${krx.size}종목 · NXT ${nxt.size}종목 · 양 시장 ${[...krx].filter(c=>nxt.has(c)).length}종목 · 선물 도달 ${active.filter(r=>r.exchange==='FUT').length}건 · 당일 해제 ${data.rows.filter(r=>!r.active).length}건 · 괴리율 1% 이상 ${data.rows.filter(r=>r.gapHit).length}건`;
        paintSortIcons();
        // Rows hidden only because their value is not known yet (still loading) are counted, so they are not mistaken for "none".
        const unknown=data.rows.filter(r=>(!gapOnly.checked||r.gapHit)&&!passes(r)&&(Number(prevFilter.value)&&r.prevAmount==null||Number(capFilter.value)&&shown(r,'marketCap')==null)).length;
        filterNote.textContent=unknown?`값 확인 전이라 빠진 행 ${unknown}건`:'';filterNote.title=filterNote.textContent;
        countdown();
    }
    paintSortIcons();
    for(const button of document.querySelectorAll('[data-sort]'))button.addEventListener('click',()=>{
        const key=button.dataset.sort;
        sort=sort.key!==key||!sort.explicit?{key,direction:-1,explicit:true}:sort.direction===-1?{key,direction:1,explicit:true}:{key:'startedAt',direction:-1};render();
    });
    body.addEventListener('click',e=>{
        const tr=e.target.closest('tr[data-flash]');if(!tr)return;
        const key=tr.dataset.flash,startedAt=Number(key.split(':')[2]);
        dismissing.add(key);tr.classList.remove('vi-flash-up','vi-flash-down','vi-blink');tr.removeAttribute('data-flash');
        fetch('/api/vi-monitor/flash-dismiss',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-VI-Token':token}:{})},body:JSON.stringify({code:tr.dataset.code,exchange:tr.dataset.exchange,startedAt})})
            .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);})
            .catch(()=>{dismissing.delete(key);status.textContent='깜박임 해제 저장 실패 · 다시 클릭해 주세요';render();});
    });
    document.getElementById('viTopmost').addEventListener('change',e=>window.chrome?.webview?.postMessage('topmost:'+e.target.checked));
    // 날짜 선택(2026-11-14): 지난 날짜는 서버의 날짜별 기록을 읽어 보여 주고, '실시간으로'나 오늘 날짜를 고르면 스트림으로 돌아간다.
    const dateInput=document.getElementById('viDate'),liveButton=document.getElementById('viLive');
    function liveStatus(){
        const d=liveData||{};
        return [d.previousSession?`휴장 · 장 시작 전이라 직전 장(${d.shownDay}) 기록을 보여 줍니다 (다음 장 08:00부터 실시간)${d.restored?' · '+d.restored.note:''}`:'',d.connection,d.quoteConnection,d.futuresConnection,d.storageError,d.historyWarning].filter(Boolean).join(' · ');
    }
    function showLive(){
        historyData=null;liveButton.hidden=true;
        if(liveData){data=liveData;status.textContent=liveStatus();status.classList.toggle('vi-history-note',!!liveData.previousSession);if(document.activeElement!==dateInput)dateInput.value=liveData.shownDay||liveData.day||'';dateInput.max=liveData.day||'';}
        render();
    }
    let historyRequest=0;
    async function showDay(date){
        if(!date||liveData&&(date===liveData.day||date===liveData.shownDay))return showLive();
        const id=++historyRequest;liveButton.hidden=false;status.textContent=`${date} 기록 읽는 중…`;
        try{
            const response=await fetch('/api/vi-monitor/history?date='+encodeURIComponent(date),{headers:token?{'X-VI-Token':token}:{}});
            if(id!==historyRequest)return;
            if(response.status===401)throw Error('연결 만료');
            const saved=response.ok?await response.json():{rows:[],missing:response.status===404};
            if(id!==historyRequest)return;
            historyData={history:true,day:date,rows:Array.isArray(saved.rows)?saved.rows:[],missing:!response.ok,restored:saved.restored||null};data=historyData;
            status.textContent=`${date} 기록 · 해제 때 값으로 고정된 화면${historyData.restored?' · '+historyData.restored.note+' (괴리율 기록으로 복원)':''} · 실시간 수신은 그대로 계속됩니다`;status.classList.add('vi-history-note');render();
        }catch(error){if(id===historyRequest){status.textContent=error.message==='연결 만료'?'연결 만료 · 메인 화면에서 VI 독립창을 다시 열어주세요.':`${date} 기록을 읽지 못했습니다`;}}
    }
    dateInput.addEventListener('change',()=>void showDay(dateInput.value));
    liveButton.addEventListener('click',showLive);
    async function connect() {
        controller?.abort();controller=new AbortController();
        try {
            const response=await fetch('/api/vi-monitor/stream',{headers:token?{'X-VI-Token':token}:{},signal:controller.signal});
            if(!response.ok)throw Error(response.status===401?'연결 만료':'HTTP '+response.status);
            const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
            while(!closed) {
                const {value,done}=await reader.read();if(done)break;
                buffer+=decoder.decode(value,{stream:true});
                let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
                    if(frame.startsWith('event: scale\ndata: ')){try{applyScale(JSON.parse(frame.slice(frame.indexOf('data: ')+6)).scale);}catch{}continue;}
                    if(frame.startsWith('data: ')){liveData=JSON.parse(frame.slice(6));if(!historyData)showLive();}
                }
            }
            if(!closed)throw Error('연결 중단');
        } catch(error) {
            if(closed||error.name==='AbortError')return;
            if(error.message==='연결 만료'){
                status.textContent='연결 만료 · 메인 화면에서 VI 독립창을 다시 열어주세요.';
                // The window token lives in the server's memory, so a server restart ends it (2026-11-12). Before any data the
                // table kept saying "VI 수신 연결 중…"; say it in the table too.
                if(!data.rows.length){const tr=document.createElement('tr');const td=cell(tr,'연결이 만료됐습니다(서버가 다시 시작됨). 메인 화면에서 VI 독립창을 다시 열어주세요.','vi-empty');td.colSpan=17;body.replaceChildren(tr);}
                return;
            }
            status.textContent='서버 연결 재시도 중 · 마지막 수신 자료 표시';
            retryTimer=setTimeout(connect,3000);
        }
    }
    window.refreshNativeViCredentials=newToken=>{token=newToken;sessionStorage.setItem('vi-window-token',token);clearTimeout(retryTimer);void connect();};
    window.addEventListener('pagehide',()=>{closed=true;clearTimeout(retryTimer);controller?.abort();});
    setInterval(tickClock,1000);tickClock();requestAnimationFrame(frame);void connect();void sendRecordFilter();
})();
