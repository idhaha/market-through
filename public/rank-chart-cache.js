(() => {
    'use strict';
    // TTL: responses that include today (always revalidated while the market is open).
    // HISTORY_TTL: past pages (date cursor before today). Their data only changes when the server rewrites
    // stored past data, which the data revisions below catch, so they can be kept longer.
    const TTL=16*3600000,HISTORY_TTL=7*24*3600000,FRESH=60000,MAX_BYTES=24*1024*1024,MAX_ENTRIES=180;
    // 2026-11-23: 과거 분봉 구간 하나(60거래일)가 저장 응답 약 107건 · 21MB라, 24MB · 180건 한도에서는 같은 구간을 다시 열 때
    // 먼저 받은 카드(시장 수급)의 저장분이 이미 밀려나 서버에서 다시 받았다. 브라우저 저장(IndexedDB)은 구간 몇 개를 담도록 늘리고,
    // 메모리는 그대로 두되 둘 다 '최근에 쓴 것'을 남긴다(꺼내 쓴 응답도 쓴 시각 used를 새로 적는다).
    const DB_MAX_BYTES=160*1024*1024,DB_MAX_ENTRIES=900,TOUCH_MS=60000;
    const nativeFetch=window.fetch.bind(window),memory=new Map(),pending=new Map(),blocked=new Set(),handoff=new Map(),closedRefresh=new Map(),CLOSE_GRACE=2*60000,CURSOR_TTL=20*60000;
    let database,identity,identityAt=0,identityJob,revision=0;
    const routes=/^\/api\/(?:concentration-chart|ls-concentration-chart|chart-reference|(?:ls-)?turnover\/chart|(?:kis-)?supply\/chart|ls-stock-futures\/chart|(?:kiwoom-|ls-)?market-supply\/chart|adr\/(?:candles|history|today)|risk\/(?:breadth|sentiment|volatility))$/;
    const day=()=>new Date(Date.now()+32400000).toISOString().slice(0,10);
    async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
    function db(){
        if(!window.indexedDB)return Promise.resolve(null);
        // 2판(2026-11-26): 정리(prune)가 저장분 전체(최대 160MB)를 읽지 않도록 시각 · 크기만 담은 meta 저장소를 따로 둔다.
        // 1판에서는 저장할 때마다 정리가 모든 응답 본문을 꺼내 읽어(readwrite) 그동안 저장분 읽기가 줄을 섰다(오라클 측정 5:
        // 같은 과거 구간을 다시 열 때 저장분 한 건이 0.4~1.5초, 로컬 재현 200건에서 건당 약 0.3초). 1판 저장분에는 meta가 없어 비운다.
        if(!database)database=new Promise(resolve=>{try{const r=indexedDB.open('marketthrough-chart-cache-v1',2);r.onupgradeneeded=event=>{const d=r.result;if(!d.objectStoreNames.contains('responses'))d.createObjectStore('responses',{keyPath:'key'});else if(event.oldVersion<2)r.transaction.objectStore('responses').clear();if(!d.objectStoreNames.contains('meta'))d.createObjectStore('meta',{keyPath:'key'});};r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();database=null;};resolve(r.result);};r.onerror=()=>resolve(null);r.onblocked=()=>resolve(null);}catch{resolve(null);}});
        return database;
    }
    async function storage(action,key,value){
        const d=await db();if(!d)return null;
        // touch: 꺼내 쓴 시각(used)만 meta에 적는다(예전엔 쓴 시각 하나 때문에 0.7MB 응답을 통째로 다시 썼다).
        const stores=action==='get'?['responses']:action==='touch'?['meta']:['responses','meta'];
        return new Promise(resolve=>{try{const tx=d.transaction(stores,action==='get'?'readonly':'readwrite'),store=tx.objectStore(stores[0]);let r;
            if(action==='get')r=store.get(key);
            else if(action==='touch')r=store.put(value);
            else if(action==='put'){r=store.put(value);if(!value.meta)tx.objectStore('meta').put(metaOf(value));}
            else{r=store.delete(key);tx.objectStore('meta').delete(key);}
            let result=null;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>resolve(null);}catch{resolve(null);}});
    }
    function metaOf(entry){return {key:entry.key,at:entry.at,used:entry.used||entry.at,bytes:entry.bytes||0,ttl:entry.ttl||TTL,scope:entry.scope,path:entry.path};}
    let pruneJob;
    async function prune(){
        if(pruneJob)return pruneJob;
        pruneJob=(async()=>{const d=await db();if(!d)return;await new Promise(resolve=>{try{const tx=d.transaction(['responses','meta'],'readwrite'),store=tx.objectStore('responses'),metas=tx.objectStore('meta'),r=metas.getAll();r.onsuccess=()=>{const items=r.result||[];let size=0,count=0;for(const item of items.sort((a,b)=>b.used-a.used)){size+=item.bytes;count++;if(Date.now()-item.at>=item.ttl||count>DB_MAX_ENTRIES||size>DB_MAX_BYTES){store.delete(item.key);metas.delete(item.key);}}};tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();}catch{resolve();}});})().finally(()=>pruneJob=null);return pruneJob;
    }
    async function account(){
        // Native views authenticate by relay capability, not browser login cookies.
        if(window.rankIndependentClient)return /^[a-f0-9]{64}$/.test(window.rankIndependentCacheScope||'')?'independent:'+window.rankIndependentCacheScope:null;
        // Recheck the signed-in server identity before consulting persisted chart data.
        if(identityAt+FRESH>Date.now())return identity;
        if(!identityJob)identityJob=(async()=>{try{const r=await nativeFetch('/api/auth/session',{cache:'no-store'}),v=await r.json();if(!r.ok||!v.authenticated||!v.user?.email){identity=null;identityAt=Date.now();return null;}const next=await hash(String(v.user.email).trim().toLowerCase());if(identity!==next){memory.clear();blocked.clear();handoff.clear();revision++;}identity=next;identityAt=Date.now();return identity;}catch{return null;}})().finally(()=>identityJob=null);
        return identityJob;
    }
    // Server data revisions (chart-revisions.js). When a route's stored past data changed on the server, every
    // saved response of that route (all markets, codes and cursors) is dropped together, so a chart never
    // mixes old and new pages. Responses saved before revisions existed (no path) are dropped once. When the
    // revisions cannot be read, saved responses are used as before.
    const known=new Map(),syncJobs=new Map(),metaKey=owner=>'meta:revisions:'+owner;
    async function purge(owner,match){
        for(const [key,entry] of memory)if(entry.scope===owner&&match(entry))memory.delete(key);
        const d=await db();if(!d)return;
        // 본문은 읽지 않고 meta(scope · path)로 고른다(2026-11-26).
        await new Promise(resolve=>{try{const tx=d.transaction(['responses','meta'],'readwrite'),store=tx.objectStore('responses'),metas=tx.objectStore('meta'),r=metas.getAll();r.onsuccess=()=>{for(const m of r.result||[])if(m.scope===owner&&match(m)){store.delete(m.key);metas.delete(m.key);}};tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();}catch{resolve();}});
    }
    function syncRevisions(owner){
        if(syncJobs.has(owner))return syncJobs.get(owner);
        const job=(async()=>{
            let server=null;
            try{
                const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
                const r=await nativeFetch('/api/chart-revisions',{cache:'no-store',signal:controller.signal});clearTimeout(timer);
                const value=r.ok?await r.json():null;if(value?.revisions&&typeof value.revisions==='object'&&!Array.isArray(value.revisions))server=value.revisions;
            }catch{}
            if(!server)return;
            const saved=(await storage('get',metaKey(owner)))?.revisions;
            const changed=new Set(Object.keys(server).filter(route=>saved?.[route]!==server[route]));
            if(!saved||changed.size)await purge(owner,entry=>!entry.path||changed.has(entry.path));
            known.set(owner,{...server});
            await storage('put',metaKey(owner),{key:metaKey(owner),meta:true,at:Date.now(),revisions:server});
        })();
        syncJobs.set(owner,job);return job;
    }
    // A response carrying a newer revision during the session: drop that route's saved pages and let the
    // chart reload them, so its in-memory history pages are replaced too.
    async function checkRevision(owner,url,r){
        const value=r.headers?.get?.('X-Chart-Revision'),have=known.get(owner);
        if(!value||!have||have[url.pathname]===value)return false;
        have[url.pathname]=value;
        await purge(owner,entry=>entry.path===url.pathname);
        await storage('put',metaKey(owner),{key:metaKey(owner),meta:true,at:Date.now(),revisions:have});
        return true;
    }
    function historical(url){
        const p=url.searchParams,cursor=p.get('cursor')||'',end=(p.get('to')||p.get('date')||'').replaceAll('-','');
        const today=day().replaceAll('-','');return /^\d{8}$/.test(cursor)&&cursor<today||/^\d{8}$/.test(end)&&end<today;
    }
    function safe(data){return data&&data.success!==false&&!data.pending&&!data.partial&&!data.error&&!data.status?.error&&!(data.warnings||[]).some(w=>/실패|오류|미제공|미완료|검증 대기|자료 없음/.test(w));}
    function hasValues(data){
        const fields=['value','market_turnover','stock_turnover','individual','foreign','institution','program','adr','open','close','count'];
        const seen=new Set();function visit(v,depth){if(!v||typeof v!=='object'||depth>7||seen.has(v))return false;seen.add(v);if(fields.some(k=>typeof v[k]==='number'&&Number.isFinite(v[k])))return true;return Object.entries(v).some(([k,x])=>!['status','warnings','user','debug_five_bars'].includes(k)&&visit(x,depth+1));}return visit(data,0);
    }
    function response(data){return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json','X-MarketThrough-Chart-Cache':'hit'}});}
    function throwIfAborted(signal){if(signal?.aborted)throw new DOMException('The operation was aborted.','AbortError');}
    function waitForShared(task,signal){
        throwIfAborted(signal);if(!signal)return task;
        return new Promise((resolve,reject)=>{
            const abort=()=>reject(new DOMException('The operation was aborted.','AbortError'));
            signal.addEventListener('abort',abort,{once:true});
            task.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)abort();else resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
        });
    }
    const VOLATILE=new Set(['fetched_at','server_time','cursor']);
    function sameData(a,b){const text=v=>JSON.stringify(v,(k,x)=>VOLATILE.has(k)?undefined:x);try{return text(a)===text(b);}catch{return false;}}
    // live: 뒤에서 다시 받은 오늘 자료가 바뀐 알림(서버 과거 자료 수정 revision 알림은 live가 아니다). 쏠림율처럼 POST 본문에 mode가 있으면 그것을 쓴다.
    function notify(url,{live=false,mode}={}){document.dispatchEvent(new CustomEvent('rank-chart-cache-updated',{detail:{path:url.pathname,mode:url.searchParams.get('mode')||mode||null,live}}));}
    async function request(input,options={}){
        const url=new URL(typeof input==='string'?input:input.url,location.href),method=(options.method||'GET').toUpperCase();
        if(url.origin!==location.origin||!routes.test(url.pathname)||!['GET','POST'].includes(method))return nativeFetch(input,options);
        let body;try{body=method==='POST'?JSON.parse(options.body||'{}'):null;}catch{return nativeFetch(input,options);}
        // Concentration cursors are short-lived, owner-bound server sessions.
        // 2026-11-16: the server forgets a cursor after 30 minutes or a restart (410). Drop the cached first pages that carry it,
        // so the card's next first-page read gets a new session instead of the dead cursor again.
        // 쏠림율 1분봉 날짜 커서(day:YYYYMMDD, 2026-11-22)는 서버 세션이 아니라 같은 요청에 늘 같은 쪽을 준다. 오늘 전 날짜 커서는
        // 지난 쪽으로 저장해 다시 쓴다(2026-11-24: 같은 과거 구간을 다시 열 때 쏠림율 지난 쪽 30여 건을 서버에서 다시 받아 8.6초).
        const dayCursor=/^day:(\d{8})$/.exec(String(body?.cursor||'')),pastDayCursor=!!dayCursor&&dayCursor[1]<day().replaceAll('-','');
        // 과거 구간 첫 쪽(base_dt가 오늘 전)도 날짜 커서를 주면 지난 쪽으로 둔다. 날짜 커서는 저장해도 다시 쓸 수 있다.
        const pastBase=!!body&&!body.cursor&&/^\d{8}$/.test(String(body.base_dt||''))&&String(body.base_dt)<day().replaceAll('-',''),dayCursorOf=data=>/^day:\d{8}$/.test(String(data?.cursor||''));
        if(body?.cursor&&!pastDayCursor){const r=await nativeFetch(input,options);if(r.status===410)for(const [k,e] of memory)if(e.data?.cursor===body.cursor)memory.delete(k);return r;}
        const owner=await account();throwIfAborted(options.signal);if(!owner)return nativeFetch(input,options);
        await syncRevisions(owner);throwIfAborted(options.signal);
        url.searchParams.sort();const canonical=body?JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b)))):'';
        const key=await hash(owner+'|'+method+'|'+url.href+'|'+canonical),epoch=revision;
        if(handoff.has(key)){const saved=handoff.get(key);handoff.delete(key);if(Date.now()-saved.at<FRESH)return response(saved.data);}
        // 뒤에서 다시 받은 응답이 보여 준 것과 같으면 알리지 않는다(2026-11-25: 장중엔 1초 넘은 캐시마다 뒤에서 다시 받고 늘 알려,
        // 알림 → 카드 갱신 → 다시 받기가 0.5초마다 돌았다. 오늘 포함 구간 분봉에서 66초에 요청 1,785건, 더 불러오기 "조회 대기 시간 초과").
        // 응답마다 바뀌는 fetched_at · server_time · 세션 cursor는 비교에서 뺀다.
        async function network(background=false,previous){
            if(pending.has(key))return (await waitForShared(pending.get(key),options.signal)).clone();
            // A chart owns its subscription, not the shared network request.
            // History restoration in one card must not cancel its peer's read.
            const {signal,...sharedOptions}=options;
            const task=(async()=>{
                const r=await nativeFetch(input,sharedOptions);let data;try{data=await r.clone().json();}catch{return r;}
                if(epoch!==revision)return r;
                if(r.status===401||r.status===403){memory.delete(key);await storage('delete',key);identityAt=0;return r;}
                const revised=r.ok&&await checkRevision(owner,url,r);
                if(r.ok&&data.pending){blocked.add(key);if(background){handoff.set(key,{data,at:Date.now()});while(handoff.size>MAX_ENTRIES)handoff.delete(handoff.keys().next().value);notify(url,{live:true,mode:body?.mode});}return r;}
                blocked.delete(key);
                if(r.ok&&safe(data)&&hasValues(data)){
                    // open: fetched while the market was open, so today's data may still be growing.
                    const entry={key,at:Date.now(),data,bytes:JSON.stringify(data).length*2,scope:owner,open:window.TradingRefresh?.allowsUrl?.(url)!==false,
                        path:url.pathname,ttl:method==='GET'&&historical(url)||pastDayCursor||pastBase&&dayCursorOf(data)?HISTORY_TTL:TTL};
                    if(entry.bytes<5*1024*1024){memory.delete(key);memory.set(key,entry);let size=0;for(const value of memory.values())size+=value.bytes;while(memory.size>MAX_ENTRIES||size>MAX_BYTES){const first=memory.keys().next().value;size-=memory.get(first).bytes;memory.delete(first);}
                        const saved=body&&!(pastDayCursor||pastBase&&dayCursorOf(data))?{...entry,data:{...data,cursor:null,has_more:false}}:entry;
                        await storage('put',key,saved);void prune();
                    }
                }else{memory.delete(key);await storage('delete',key);}
                if(background&&r.ok&&(previous===undefined||!sameData(previous,data))){handoff.set(key,{data,at:Date.now()});while(handoff.size>MAX_ENTRIES)handoff.delete(handoff.keys().next().value);notify(url,{live:!revised,mode:body?.mode});}
                else if(revised)notify(url,{mode:body?.mode});
                return r;
            })().finally(()=>{if(pending.get(key)===task)pending.delete(key);});pending.set(key,task);
            return (await waitForShared(task,signal)).clone();
        }
        if(blocked.has(key))return network();
        const entry=memory.get(key)||await storage('get',key);throwIfAborted(options.signal);
        // 꺼내 쓴 응답은 최근에 쓴 것으로 옮긴다(메모리 순서 · 저장분 used). 저장분은 1분에 한 번만 다시 적는다.
        const touch=()=>{if(memory.has(key)){memory.delete(key);memory.set(key,entry);}if((!body||pastDayCursor||pastBase&&dayCursorOf(entry.data))&&!(Date.now()-(entry.used||entry.at)<TOUCH_MS)){entry.used=Date.now();void storage('touch',key,metaOf(entry));}};
        if(entry&&entry.scope===owner&&Date.now()>=entry.at&&(Date.now()-entry.at<(entry.ttl||TTL) || window.TradingRefresh?.allowsUrl(url)===false)){
            // Persisted concentration responses have no reusable server cursor.
            // A user-initiated initial read must restore pagination even while
            // periodic broker refresh is paused for a closed market.
            // A cursor older than CURSOR_TTL may already be gone on the server (30 minutes): read the first page again.
            const pastPage=pastDayCursor||pastBase&&dayCursorOf(entry.data);
            if(body && !pastPage && (!entry.data.cursor || Date.now()-entry.at>=CURSOR_TTL))return network();
            const isHistorical=method==='GET'&&historical(url)||pastPage;
            // Persisted POST responses deliberately have no reusable pagination cursor.
            const marketOpen=window.TradingRefresh?.allowsUrl(url)!==false;
            if(!isHistorical && marketOpen && (Date.now()-entry.at>=1000||body&&!entry.data.cursor))void network(true,entry.data).catch(()=>{});
            // Closed market: a response saved while it was open stops partway through today, so replace
            // it once in the background. Responses saved after the close are complete and stay as they are.
            // closedAt is the latest close of this URL's market (futures also close after the night
            // session), so the check repeats at every close. Within the grace period the server may
            // still be writing the last minutes, so wait for a read after it.
            else if(!isHistorical && !marketOpen){
                const closedAt=window.TradingRefresh?.closedAtUrl?.(url),mark=closedAt??'open';
                const stale=closedAt!=null ? Date.now()>=closedAt+CLOSE_GRACE && entry.at<closedAt+CLOSE_GRACE : entry.open!==false;
                if(stale && closedRefresh.get(key)!==mark){closedRefresh.set(key,mark);void network(true,entry.data).catch(()=>{});}
            }
            touch();
            return response(entry.data);
        }
        if(entry)await storage('delete',key);
        return network();
    }
    function invalidateIdentity(){identityAt=0;identity=null;revision++;memory.clear();blocked.clear();handoff.clear();closedRefresh.clear();syncJobs.clear();}
    window.RankChartCache={fetch:request,invalidateIdentity,ttl:TTL};
    const refreshers={
        '/api/concentration-chart':'refreshConcentrationChart','/api/ls-concentration-chart':'refreshLsConcentrationChart',
        '/api/turnover/chart':'refreshRankTurnoverChart','/api/ls-turnover/chart':'refreshRankLsTurnoverChart',
        '/api/supply/chart':'refreshRankSupplyChart','/api/kis-supply/chart':'refreshRankKisSupplyChart','/api/ls-stock-futures/chart':'refreshRankFuturesSupplyChart',
        // 시장 수급 카드(위 · 아래 두 장)는 현물 키움 · 선물 한투/LS · 일봉 LS를 섞어 쓴다. 어느 경로가 바뀌어도 두 장을 다시 받는다(2026-11-22:
        // 예전엔 없어진 단독 · 통합 카드 함수로 연결돼 있어, 서버 과거 자료가 바뀌어도 지금 카드가 새로 받지 않았다).
        '/api/market-supply/chart':'__marketSupplyCards','/api/kiwoom-market-supply/chart':'__marketSupplyCards','/api/ls-market-supply/chart':'__marketSupplyCards',
        '/api/adr/candles':'__allCharts','/api/chart-reference':'__allCharts',
        '/api/risk/breadth':'refreshRankBreadthChart','/api/risk/sentiment':'refreshRankSentimentChart','/api/risk/volatility':'refreshRankVolatilityChart'
    };
    const timers=new Map();document.addEventListener('rank-chart-cache-updated',event=>{
        // 과거 분봉 구간을 보는 동안에는 오늘 자료가 바뀌었다는 알림으로 종목 수급 · 종목 선물 수급 분봉 카드를 다시 받지 않는다
        // (2026-11-27 오라클 장중 측정 3 · 4 · 5). 장중엔 오늘 자료가 늘 바뀌어 알림이 오고, 카드가 구간 끝 날짜로 가던 조회(seek)를 끊고
        // 오늘부터 다시 받았다. 그 뒤 더 불러오기가 오늘부터 하루씩 거슬러 40쪽을 받았다. 이 카드들의 갱신은 구간을 모르고 오늘부터 받는다.
        // 30초 자동 갱신도 구간 보기 중에는 분봉 카드를 건너뛴다(RankChartAxis.refreshCharts). 쏠림율 등 다른 카드는 그대로 알린다.
        if(event.detail.live && event.detail.mode==='minute' && ['/api/supply/chart','/api/kis-supply/chart','/api/ls-stock-futures/chart'].includes(event.detail.path) && window.RankChartAxis?.minuteWindow?.())return;
        const name=(window.rankIndependentClient || !window.refreshLsConcentrationChart) && event.detail.path==='/api/ls-concentration-chart'?'refreshConcentrationChart':window.rankIndependentClient && event.detail.path==='/api/kis-supply/chart'?'refreshRankSupplyChart':refreshers[event.detail.path];
        if(!window.rankIndependentClient && ['/api/turnover/chart','/api/ls-turnover/chart'].includes(event.detail.path)){
            const state=window.getRankCombinedTurnoverState?.(),combinedKey='combinedTurnover';
            if(state && (state.mode==='minute'?'/api/ls-turnover/chart':'/api/turnover/chart')===event.detail.path && !timers.has(combinedKey))timers.set(combinedKey,setTimeout(()=>{timers.delete(combinedKey);void Promise.resolve(window.refreshRankCombinedTurnoverChart?.()).catch(()=>{});},100));
        }
        if(!window.rankIndependentClient && ['/api/supply/chart','/api/kis-supply/chart'].includes(event.detail.path)){
            const state=window.getRankCombinedSupplyState?.(),combinedKey='combinedSupply';
            if(state && (state.mode==='minute'?'/api/kis-supply/chart':'/api/supply/chart')===event.detail.path && !timers.has(combinedKey))timers.set(combinedKey,setTimeout(()=>{timers.delete(combinedKey);void Promise.resolve(window.refreshRankCombinedSupplyChart?.()).catch(()=>{});},100));
        }
        const mode=event.detail.mode==='minute'?'minute':'day',key=name==='__allCharts'?name+':'+mode:name;
        if(!name||timers.has(key))return;
        timers.set(key,setTimeout(()=>{timers.delete(key);void Promise.resolve(name==='__allCharts'?window.RankChartAxis?.refreshCharts?.({mode}):name==='__marketSupplyCards'?Promise.all([window.refreshRankTestMarketSupplyChart?.(),window.refreshRankTestMarketSupplySecondaryChart?.()]):window[name]?.()).catch(()=>{});},100));
    });
})();
