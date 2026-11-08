(() => {
    'use strict';
    // TTL: responses that include today (always revalidated while the market is open).
    // HISTORY_TTL: past pages (date cursor before today). Their data only changes when the server rewrites
    // stored past data, which the data revisions below catch, so they can be kept longer.
    const TTL=16*3600000,HISTORY_TTL=7*24*3600000,FRESH=60000,MAX_BYTES=24*1024*1024,MAX_ENTRIES=180;
    const nativeFetch=window.fetch.bind(window),memory=new Map(),pending=new Map(),blocked=new Set(),handoff=new Map(),closedRefresh=new Map(),CLOSE_GRACE=2*60000;
    let database,identity,identityAt=0,identityJob,revision=0;
    const routes=/^\/api\/(?:concentration-chart|kis-concentration-chart|ls-concentration-chart|chart-reference|(?:kis-|ls-)?turnover\/chart|(?:kis-|ls-)?supply\/chart|ls-stock-futures\/chart|(?:kiwoom-|ls-)?market-supply\/chart|adr\/(?:candles|history|today)|risk\/(?:breadth|sentiment|volatility))$/;
    const day=()=>new Date(Date.now()+32400000).toISOString().slice(0,10);
    async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
    function db(){
        if(!window.indexedDB)return Promise.resolve(null);
        if(!database)database=new Promise(resolve=>{try{const r=indexedDB.open('marketthrough-chart-cache-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('responses',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);r.onblocked=()=>resolve(null);}catch{resolve(null);}});
        return database;
    }
    async function storage(action,key,value){
        const d=await db();if(!d)return null;
        return new Promise(resolve=>{try{const tx=d.transaction('responses',action==='get'?'readonly':'readwrite'),store=tx.objectStore('responses');const r=action==='get'?store.get(key):action==='put'?store.put(value):store.delete(key);let result=null;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>resolve(null);}catch{resolve(null);}});
    }
    let pruneJob;
    async function prune(){
        if(pruneJob)return pruneJob;
        pruneJob=(async()=>{const d=await db();if(!d)return;await new Promise(resolve=>{try{const tx=d.transaction('responses','readwrite'),store=tx.objectStore('responses'),r=store.openCursor(),items=[];r.onsuccess=()=>{const c=r.result;if(c){if(!c.value.meta)items.push({key:c.key,at:c.value.at,bytes:c.value.bytes||0,ttl:c.value.ttl||TTL});c.continue();return;}let size=0,count=0;for(const item of items.sort((a,b)=>b.at-a.at)){size+=item.bytes;count++;if(Date.now()-item.at>=item.ttl||count>MAX_ENTRIES||size>MAX_BYTES)store.delete(item.key);}};tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();}catch{resolve();}});})().finally(()=>pruneJob=null);return pruneJob;
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
        await new Promise(resolve=>{try{const tx=d.transaction('responses','readwrite'),r=tx.objectStore('responses').openCursor();r.onsuccess=()=>{const c=r.result;if(!c)return;if(!c.value.meta&&c.value.scope===owner&&match(c.value))c.delete();c.continue();};tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();}catch{resolve();}});
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
    function notify(url){document.dispatchEvent(new CustomEvent('rank-chart-cache-updated',{detail:{path:url.pathname,mode:url.searchParams.get('mode')}}));}
    async function request(input,options={}){
        const url=new URL(typeof input==='string'?input:input.url,location.href),method=(options.method||'GET').toUpperCase();
        if(url.origin!==location.origin||!routes.test(url.pathname)||!['GET','POST'].includes(method))return nativeFetch(input,options);
        let body;try{body=method==='POST'?JSON.parse(options.body||'{}'):null;}catch{return nativeFetch(input,options);}
        // Concentration cursors are short-lived, owner-bound server sessions.
        if(body?.cursor)return nativeFetch(input,options);
        const owner=await account();throwIfAborted(options.signal);if(!owner)return nativeFetch(input,options);
        await syncRevisions(owner);throwIfAborted(options.signal);
        url.searchParams.sort();const canonical=body?JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b)))):'';
        const key=await hash(owner+'|'+method+'|'+url.href+'|'+canonical),epoch=revision;
        if(handoff.has(key)){const saved=handoff.get(key);handoff.delete(key);if(Date.now()-saved.at<FRESH)return response(saved.data);}
        async function network(background=false){
            if(pending.has(key))return (await waitForShared(pending.get(key),options.signal)).clone();
            // A chart owns its subscription, not the shared network request.
            // History restoration in one card must not cancel its peer's read.
            const {signal,...sharedOptions}=options;
            const task=(async()=>{
                const r=await nativeFetch(input,sharedOptions);let data;try{data=await r.clone().json();}catch{return r;}
                if(epoch!==revision)return r;
                if(r.status===401||r.status===403){memory.delete(key);await storage('delete',key);identityAt=0;return r;}
                const revised=r.ok&&await checkRevision(owner,url,r);
                if(r.ok&&data.pending){blocked.add(key);if(background){handoff.set(key,{data,at:Date.now()});while(handoff.size>MAX_ENTRIES)handoff.delete(handoff.keys().next().value);notify(url);}return r;}
                blocked.delete(key);
                if(r.ok&&safe(data)&&hasValues(data)){
                    // open: fetched while the market was open, so today's data may still be growing.
                    const entry={key,at:Date.now(),data,bytes:JSON.stringify(data).length*2,scope:owner,open:window.TradingRefresh?.allowsUrl?.(url)!==false,
                        path:url.pathname,ttl:method==='GET'&&historical(url)?HISTORY_TTL:TTL};
                    if(entry.bytes<5*1024*1024){memory.delete(key);memory.set(key,entry);let size=0;for(const value of memory.values())size+=value.bytes;while(memory.size>MAX_ENTRIES||size>MAX_BYTES){const first=memory.keys().next().value;size-=memory.get(first).bytes;memory.delete(first);}
                        const saved=body?{...entry,data:{...data,cursor:null,has_more:false}}:entry;
                        await storage('put',key,saved);void prune();
                    }
                }else{memory.delete(key);await storage('delete',key);}
                if(background&&r.ok){handoff.set(key,{data,at:Date.now()});while(handoff.size>MAX_ENTRIES)handoff.delete(handoff.keys().next().value);notify(url);}
                else if(revised)notify(url);
                return r;
            })().finally(()=>{if(pending.get(key)===task)pending.delete(key);});pending.set(key,task);
            return (await waitForShared(task,signal)).clone();
        }
        if(blocked.has(key))return network();
        const entry=memory.get(key)||await storage('get',key);throwIfAborted(options.signal);
        if(entry&&entry.scope===owner&&Date.now()>=entry.at&&(Date.now()-entry.at<(entry.ttl||TTL) || window.TradingRefresh?.allowsUrl(url)===false)){
            // Persisted concentration responses have no reusable server cursor.
            // A user-initiated initial read must restore pagination even while
            // periodic broker refresh is paused for a closed market.
            if(body && !entry.data.cursor)return network();
            const isHistorical=method==='GET'&&historical(url);
            // Persisted POST responses deliberately have no reusable pagination cursor.
            const marketOpen=window.TradingRefresh?.allowsUrl(url)!==false;
            if(!isHistorical && marketOpen && (Date.now()-entry.at>=1000||body&&!entry.data.cursor))void network(true).catch(()=>{});
            // Closed market: a response saved while it was open stops partway through today, so replace
            // it once in the background. Responses saved after the close are complete and stay as they are.
            // closedAt is the latest close of this URL's market (futures also close after the night
            // session), so the check repeats at every close. Within the grace period the server may
            // still be writing the last minutes, so wait for a read after it.
            else if(!isHistorical && !marketOpen){
                const closedAt=window.TradingRefresh?.closedAtUrl?.(url),mark=closedAt??'open';
                const stale=closedAt!=null ? Date.now()>=closedAt+CLOSE_GRACE && entry.at<closedAt+CLOSE_GRACE : entry.open!==false;
                if(stale && closedRefresh.get(key)!==mark){closedRefresh.set(key,mark);void network(true).catch(()=>{});}
            }
            return response(entry.data);
        }
        if(entry)await storage('delete',key);
        return network();
    }
    function invalidateIdentity(){identityAt=0;identity=null;revision++;memory.clear();blocked.clear();handoff.clear();closedRefresh.clear();syncJobs.clear();}
    window.RankChartCache={fetch:request,invalidateIdentity,ttl:TTL};
    const refreshers={
        '/api/concentration-chart':'refreshConcentrationChart','/api/kis-concentration-chart':'refreshKisConcentrationChart','/api/ls-concentration-chart':'refreshLsConcentrationChart',
        '/api/turnover/chart':'refreshRankTurnoverChart','/api/kis-turnover/chart':'refreshRankKisTurnoverChart','/api/ls-turnover/chart':'refreshRankLsTurnoverChart',
        '/api/supply/chart':'refreshRankSupplyChart','/api/kis-supply/chart':'refreshRankKisSupplyChart','/api/ls-supply/chart':'refreshRankLsSupplyChart','/api/ls-stock-futures/chart':'refreshRankFuturesSupplyChart',
        '/api/market-supply/chart':'refreshRankMarketSupplyChart','/api/kiwoom-market-supply/chart':'refreshRankKiwoomMarketSupplyChart','/api/ls-market-supply/chart':'refreshRankLsMarketSupplyChart',
        '/api/adr/candles':'__allCharts','/api/chart-reference':'__allCharts',
        '/api/adr/today':'refreshRankAdrChart','/api/adr/history':'refreshRankAdrChart','/api/risk/breadth':'refreshRankBreadthChart','/api/risk/sentiment':'refreshRankSentimentChart','/api/risk/volatility':'refreshRankVolatilityChart'
    };
    const timers=new Map();document.addEventListener('rank-chart-cache-updated',event=>{
        const name=(window.rankIndependentClient || !window.refreshLsConcentrationChart) && event.detail.path==='/api/ls-concentration-chart'?'refreshConcentrationChart':window.rankIndependentClient && event.detail.path==='/api/kis-supply/chart'?'refreshRankSupplyChart':refreshers[event.detail.path];
        if(!window.rankIndependentClient && ['/api/turnover/chart','/api/ls-turnover/chart'].includes(event.detail.path)){
            const state=window.getRankCombinedTurnoverState?.(),combinedKey='combinedTurnover';
            if(state && (state.mode==='minute'?'/api/ls-turnover/chart':'/api/turnover/chart')===event.detail.path && !timers.has(combinedKey))timers.set(combinedKey,setTimeout(()=>{timers.delete(combinedKey);void Promise.resolve(window.refreshRankCombinedTurnoverChart?.()).catch(()=>{});},100));
        }
        if(!window.rankIndependentClient && ['/api/supply/chart','/api/kis-supply/chart'].includes(event.detail.path)){
            const state=window.getRankCombinedSupplyState?.(),combinedKey='combinedSupply';
            if(state && (state.mode==='minute'?'/api/kis-supply/chart':'/api/supply/chart')===event.detail.path && !timers.has(combinedKey))timers.set(combinedKey,setTimeout(()=>{timers.delete(combinedKey);void Promise.resolve(window.refreshRankCombinedSupplyChart?.()).catch(()=>{});},100));
        }
        if(!window.rankIndependentClient && ['/api/ls-market-supply/chart','/api/kiwoom-market-supply/chart','/api/market-supply/chart'].includes(event.detail.path)){
            {
            const state=window.getRankCombinedMarketSupplyDisplaySettings?.(),key='combinedMarketSupply';
            const path=state?.mode==='day'?'/api/ls-market-supply/chart':state?.selected?.startsWith('futures')?'/api/market-supply/chart':'/api/kiwoom-market-supply/chart';
            if(state && path===event.detail.path && !timers.has(key))timers.set(key,setTimeout(()=>{timers.delete(key);void Promise.resolve(window.refreshRankCombinedMarketSupplyChart?.()).catch(()=>{});},100));
            }
            {
            const state=window.getRankCombinedMarketSupplySecondaryDisplaySettings?.(),key='combinedMarketSupplySecondary';
            const path=state?.mode==='day'?'/api/ls-market-supply/chart':state?.selected?.startsWith('futures')?'/api/market-supply/chart':'/api/kiwoom-market-supply/chart';
            if(state && path===event.detail.path && !timers.has(key))timers.set(key,setTimeout(()=>{timers.delete(key);void Promise.resolve(window.refreshRankCombinedMarketSupplySecondaryChart?.()).catch(()=>{});},100));
            }
        }
        const mode=event.detail.mode==='minute'?'minute':'day',key=name==='__allCharts'?name+':'+mode:name;
        if(!name||timers.has(key))return;
        timers.set(key,setTimeout(()=>{timers.delete(key);void Promise.resolve(name==='__allCharts'?window.RankChartAxis?.refreshCharts?.({mode}):window[name]?.()).catch(()=>{});},100));
    });
})();
