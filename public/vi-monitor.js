(() => {
    'use strict';
    let token=new URLSearchParams(location.hash.slice(1)).get('token')||sessionStorage.getItem('vi-window-token')||'';
    // Follow the main browser's zoom (sent by the server). The ratio uses the current zoom, so repeats are harmless.
    const applyScale=scale=>{const ratio=Number(scale)/devicePixelRatio;if(Number.isFinite(ratio)&&ratio>=0.25&&ratio<=4&&Math.abs(ratio-1)>0.02)window.chrome?.webview?.postMessage('page-scale:'+ratio);};
    if(token)sessionStorage.setItem('vi-window-token',token);
    history.replaceState(null,'',location.pathname);
    const body=document.getElementById('viBody'),status=document.getElementById('viStatus'),summary=document.getElementById('viSummary'),month=document.getElementById('viFutureMonth');
    let data={rows:[]},sort={key:'startedAt',direction:-1},controller,closed=false,retryTimer;
    // Sort icons from preview.html: up/down arrows (active direction highlighted) and a dot for inactive columns.
    const SORT_ARROWS='<svg viewBox="0 0 10 14"><path class="v" d="M5 2V12"/><path class="u" d="M3.2 3.6L5 1.6L6.8 3.6"/><path class="d" d="M3.2 10.4L5 12.4L6.8 10.4"/></svg>';
    const SORT_DOT='<svg viewBox="0 0 10 14"><circle cx="5" cy="7" r="1.2"/></svg>';
    for(const button of document.querySelectorAll('[data-sort]')){const icon=document.createElement('em');icon.className='sort-icon';icon.setAttribute('aria-hidden','true');button.append(icon);}
    const time=t=>Number.isFinite(t)?new Date(t).toLocaleTimeString('en-GB',{timeZone:'Asia/Seoul',hourCycle:'h23',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
    const percent=v=>Number.isFinite(v)?(v>0?'+':'')+v.toFixed(2)+'%':'—';
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
    for(const [select,key] of [[prevFilter,'viPrevAmount'],[capFilter,'viMarketCap']]){
        const saved=localStorage.getItem(key);if(saved&&[...select.options].some(o=>o.value===saved))select.value=saved;
        select.addEventListener('change',()=>{localStorage.setItem(key,select.value);render();});
    }
    // 2026-11-11: values follow the triggering exchange (Base). Active rows show the live values (등락률: the value at the
    // activation); released rows keep the values at the release (atRelease).
    const rel=r=>!r.active?r.atRelease||null:null;
    const shown=(r,field)=>{const x=rel(r);if(!r.active)return x?x[field]??null:null;return field==='rate'&&r.exchange!=='FUT'?(r.atStart?.rate??r.rate):r[field];};
    const shownGap=r=>!r.active?rel(r)?.gap??null:r.gap??null;
    const futureGap=(g,m)=>g==null?null:typeof g.FUT==='string'?g.FUT:g.FUT?.[m]??null;
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
        :key==='gapKRX'?numeric(shownGap(r)?.KRX):key==='gapNXT'?numeric(shownGap(r)?.NXT):key==='gapFUT'?numeric(futureGap(shownGap(r),month.value))
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
            el.textContent=remaining(ms);
            el.title=el.dataset.futures?(ms?'선물 이벤트 + 5분까지 남은 시간':'5분이 지났습니다 · 해제로 바뀌는 중'):(ms?'발동 시각 + 2분까지 남은 예상 시간':'예상 시간이 지났습니다 · 해제 수신 대기');
            el.className='countdown'+(ms<=30000?' soon':'');
            // Blink only in the last 30 seconds before the expected release (and while waiting for it).
            const tr=el.closest('tr');if(tr?.dataset.flash)tr.classList.toggle('vi-blink',ms<=30000);
        }
    }
    const tickClock=()=>{document.getElementById('viClock').textContent=new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});};
    const frame=()=>{countdown();requestAnimationFrame(frame);};
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
            cell(tr,r.name||r.code,'name').title=r.code+hit+` · 전일 거래대금 ${r.prevAmount!=null?money(r.prevAmount):r.prevAmountState==='pending'?'확인 중':'없음'}`;
            const x=rel(r),base=exchangeText(r),released=x?` · 해제 때 값 (${x.basis}, ${time(x.at)})`:r.releasePending?' · 해제 때 값 기다리는 중':'';
            // 등락률 · 시가총액 · 거래대금 · 호가 평균: the triggering exchange (Base); futures rows: 등락률 against the LS t8402 기준가, no 거래대금.
            const rate=shown(r,'rate'),rateCell=cell(tr,percent(rate),rate>0?'up':rate<0?'down':'muted');
            rateCell.title=r.exchange==='FUT'?`${base} 등락률: 선물 현재가 ÷ LS t8402 기준가 − 1 · 발동 때 ${percent(r.atStart?.rate)}${x?` · 해제 때 ${percent(x.rate)}`:''}${released}`:`${base} 전일 대비 등락률 · 발동 때 ${percent(r.atStart?.rate)}${x?` · 해제 때 ${percent(x.rate)}`:''}${released}`;
            const cap=shown(r,'marketCap');cell(tr,money(cap),'amount').title=cap!=null?`${Math.round(cap).toLocaleString('ko-KR')}원 · ${r.marketCapBasis||''} 기준${released}`:'상장주식수 또는 현재가 확인 중';
            const amount=shown(r,'amount');cell(tr,Number.isFinite(amount)?amount.toLocaleString('ko-KR',{maximumFractionDigits:0}):'—','amount').title=r.exchange==='FUT'?'선물 거래대금은 받지 않습니다':`${base} 누적 거래대금(백만 원)${released}`;
            cell(tr,base).title=r.exchange==='FUT'?`${r.contract?.name||r.contract?.code} (${r.contract?.code})`:'';
            cell(tr,r.kindText||kind[r.kind]||'—');cell(tr,time(r.startedAt));cell(tr,r.active?'—':time(r.releasedAt));
            const cd=cell(tr,r.active?'':'해제','countdown');if(r.active&&r.startedAt!=null){cd.dataset.until=r.startedAt+(r.durationMs||120000);if(r.exchange==='FUT')cd.dataset.futures='1';}
            // 괴리율: 'Base' in the triggering exchange's column, 미지원 for NXT 미상장 / no stock futures, else vs Base.
            const g=shownGap(r),gapCell=(v,title)=>{const td=v==='Base'?cell(tr,'Base','base'):v==='미지원'?cell(tr,'미지원','muted'):cell(tr,percent(v),v>0?'up':v<0?'down':'muted');td.title=title;return td;};
            gapCell(g?.KRX,r.exchange==='KRX'?'발동 거래소(Base)':`KRX ÷ ${base} − 1${released}`);
            gapCell(g?.NXT,r.exchange==='NXT'?'발동 거래소(Base)':g?.NXT==='미지원'?'NXT에서 거래하지 않는 종목':`NXT ÷ ${base} − 1${released}`);
            const fv=futureGap(g,month.value),future=r.futures?.[month.value];
            gapCell(fv,r.exchange==='FUT'?'발동 거래소(Base)':fv==='미지원'?'주식선물이 없는 종목':future?`${future.name||future.code} ÷ ${base} − 1 · 만기 ${future.expiry}${released}`:r.detailError||'해당 월물 또는 가격 미수신');
            const bid=shown(r,'bidAverage'),book=cell(tr,money(bid),'amount');
            book.title=r.exchange==='FUT'?'선물 행은 호가 평균 없음':Number.isFinite(bid)?`${r.exchange} 매수 10호가 평균 ${Math.round(bid).toLocaleString('ko-KR')}원${x?released:` · 수신 ${time(r.bidAverageAt)}${r.bidAverageVia==='REST'?' (NH 조회 5초 주기)':r.bidAverageVia==='KIS'?' (한투 NX 조회 5초 주기)':''}`}`:`${r.exchange} 호가 미수신`;
            fragment.append(tr);
        });
        if(!fragment.childNodes.length){const tr=document.createElement('tr');const td=cell(tr,data.rows.length?'조건에 맞는 VI 종목이 없습니다. (괴리율 1% 이상 보기 · 거래대금 · 시가총액 조건을 바꾸면 더 볼 수 있습니다)':'수신한 당일 VI 종목이 없습니다.','vi-empty');td.colSpan=15;fragment.append(tr);}
        body.replaceChildren(fragment);
        const active=data.rows.filter(r=>r.active),krx=new Set(active.filter(r=>r.exchange==='KRX').map(r=>r.code)),nxt=new Set(active.filter(r=>r.exchange==='NXT').map(r=>r.code));
        summary.textContent=`현재 발동 중 · KRX ${krx.size}종목 · NXT ${nxt.size}종목 · 양 시장 ${[...krx].filter(c=>nxt.has(c)).length}종목 · 선물 이벤트 ${active.filter(r=>r.exchange==='FUT').length}건 · 당일 해제 ${data.rows.filter(r=>!r.active).length}건 · 괴리율 1% 이상 ${data.rows.filter(r=>r.gapHit).length}건`;
        for(const button of document.querySelectorAll('[data-sort]')) {
            const on=button.dataset.sort===sort.key;
            // Like preview.html: once a column is chosen, the other sortable columns show a dot.
            button.querySelector('.sort-icon').innerHTML=on||!sort.explicit?SORT_ARROWS:SORT_DOT;
            button.closest('th').setAttribute('aria-sort',on?(sort.direction<0?'descending':'ascending'):'none');
        }
        // Rows hidden only because their value is not known yet (still loading) are counted, so they are not mistaken for "none".
        const unknown=data.rows.filter(r=>(!gapOnly.checked||r.gapHit)&&!passes(r)&&(Number(prevFilter.value)&&r.prevAmount==null||Number(capFilter.value)&&shown(r,'marketCap')==null)).length;
        filterNote.textContent=unknown?`값 확인 전이라 빠진 행 ${unknown}건`:'';filterNote.title=filterNote.textContent;
        countdown();
    }
    for(const button of document.querySelectorAll('[data-sort]'))button.addEventListener('click',()=>{
        const key=button.dataset.sort;
        sort=sort.key!==key||!sort.explicit?{key,direction:-1,explicit:true}:sort.direction===-1?{key,direction:1,explicit:true}:{key:'startedAt',direction:-1};render();
    });
    month.addEventListener('change',render);
    body.addEventListener('click',e=>{
        const tr=e.target.closest('tr[data-flash]');if(!tr)return;
        const key=tr.dataset.flash,startedAt=Number(key.split(':')[2]);
        dismissing.add(key);tr.classList.remove('vi-flash-up','vi-flash-down','vi-blink');tr.removeAttribute('data-flash');
        fetch('/api/vi-monitor/flash-dismiss',{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-VI-Token':token}:{})},body:JSON.stringify({code:tr.dataset.code,exchange:tr.dataset.exchange,startedAt})})
            .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);})
            .catch(()=>{dismissing.delete(key);status.textContent='깜박임 해제 저장 실패 · 다시 클릭해 주세요';render();});
    });
    document.getElementById('viTopmost').addEventListener('change',e=>window.chrome?.webview?.postMessage('topmost:'+e.target.checked));
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
                    if(frame.startsWith('data: ')){data=JSON.parse(frame.slice(6));status.textContent=[data.connection,data.quoteConnection,data.futuresConnection,data.storageError,data.historyWarning].filter(Boolean).join(' · ');render();}
                }
            }
            if(!closed)throw Error('연결 중단');
        } catch(error) {
            if(closed||error.name==='AbortError')return;
            if(error.message==='연결 만료'){status.textContent='연결 만료 · 메인 화면에서 VI 독립창을 다시 열어주세요.';return;}
            status.textContent='서버 연결 재시도 중 · 마지막 수신 자료 표시';
            retryTimer=setTimeout(connect,3000);
        }
    }
    window.refreshNativeViCredentials=newToken=>{token=newToken;sessionStorage.setItem('vi-window-token',token);clearTimeout(retryTimer);void connect();};
    window.addEventListener('pagehide',()=>{closed=true;clearTimeout(retryTimer);controller?.abort();});
    setInterval(tickClock,1000);tickClock();requestAnimationFrame(frame);void connect();
})();
