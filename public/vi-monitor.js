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
    const cell=(tr,text,className='')=>{const td=document.createElement('td');td.textContent=text;td.className=className;tr.append(td);return td;};
    // Clicked rows stop blinking; the server stores it per activation and syncs every window.
    const flashKey=r=>r.code+':'+r.exchange+':'+r.startedAt;
    const dismissing=new Set();
    const value=(r,key)=>key==='futureRate'?r.futures?.[month.value]?.rate:r[key];
    function sorted() {
        return [...data.rows].sort((a,b)=>{
            const x=value(a,sort.key),y=value(b,sort.key);
            if(x==null&&y!=null)return 1;if(y==null&&x!=null)return -1;
            return (x===y||x==null?0:(x>y?1:-1)*sort.direction)||(b.startedAt??-Infinity)-(a.startedAt??-Infinity)||a.code.localeCompare(b.code)||a.exchange.localeCompare(b.exchange);
        });
    }
    // 해제까지(예상): minutes:seconds:milliseconds, redrawn every frame like a stopwatch countdown.
    const remaining=ms=>String(Math.floor(ms/60000)).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+':'+String(ms%1000).padStart(3,'0');
    function countdown() {
        for(const el of body.querySelectorAll('[data-until]')) {
            const ms=Math.max(0,Math.ceil(Number(el.dataset.until)-Date.now()));
            el.textContent=ms?remaining(ms):'해제 수신 대기';
            el.className='countdown'+(ms>0&&ms<=30000?' soon':'');
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
            cell(tr,i+1);cell(tr,r.market||'-');cell(tr,r.name||r.code,'name').title=r.code;
            const rate=cell(tr,percent(r.rate),r.rate>0?'up':r.rate<0?'down':'muted');rate.title='KRX 현재가의 전일 대비 등락률';
            cell(tr,Number.isFinite(r.amount)?r.amount.toLocaleString('ko-KR',{maximumFractionDigits:0}):'—','amount');
            cell(tr,r.exchange);cell(tr,kind[r.kind]||'—');cell(tr,time(r.startedAt));cell(tr,r.active?'—':time(r.releasedAt));
            const cd=cell(tr,r.active?'':'해제','countdown');if(r.active&&r.startedAt!=null)cd.dataset.until=r.startedAt+120000;
            const nxt=cell(tr,percent(r.nxtRate),r.nxtRate>0?'up':r.nxtRate<0?'down':'muted');
            nxt.title=`KRX 수신 ${time(r.krxReceivedAt)} / NXT 수신 ${time(r.nxtReceivedAt)}`;
            const future=r.futures?.[month.value];
            cell(tr,percent(future?.rate),future?.rate>0?'up':future?.rate<0?'down':'muted').title=future?`${future.name||future.code} · 만기 ${future.expiry} · 수신 ${time(future.receivedAt)}`:r.detailError||'해당 월물 또는 가격 미수신';
            fragment.append(tr);
        });
        if(!data.rows.length){const tr=document.createElement('tr');const td=cell(tr,'수신한 당일 VI 종목이 없습니다.','vi-empty');td.colSpan=12;fragment.append(tr);}
        body.replaceChildren(fragment);
        const active=data.rows.filter(r=>r.active),krx=new Set(active.filter(r=>r.exchange==='KRX').map(r=>r.code)),nxt=new Set(active.filter(r=>r.exchange==='NXT').map(r=>r.code));
        summary.textContent=`현재 발동 중 · KRX ${krx.size}종목 · NXT ${nxt.size}종목 · 양 시장 ${[...krx].filter(c=>nxt.has(c)).length}종목 · 당일 해제 ${data.rows.filter(r=>!r.active).length}건`;
        for(const button of document.querySelectorAll('[data-sort]')) {
            const on=button.dataset.sort===sort.key;
            // Like preview.html: once a column is chosen, the other sortable columns show a dot.
            button.querySelector('.sort-icon').innerHTML=on||!sort.explicit?SORT_ARROWS:SORT_DOT;
            button.closest('th').setAttribute('aria-sort',on?(sort.direction<0?'descending':'ascending'):'none');
        }
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
        dismissing.add(key);tr.classList.remove('vi-flash-up','vi-flash-down');tr.removeAttribute('data-flash');
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
                    if(frame.startsWith('data: ')){data=JSON.parse(frame.slice(6));status.textContent=[data.connection,data.quoteConnection,data.storageError,data.historyWarning].filter(Boolean).join(' · ');render();}
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
