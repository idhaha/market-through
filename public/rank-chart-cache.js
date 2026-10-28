(() => {
    'use strict';
    const TTL=16*3600000,FRESH=60000,MAX_BYTES=24*1024*1024,MAX_ENTRIES=180;
    const nativeFetch=window.fetch.bind(window),memory=new Map(),pending=new Map(),blocked=new Set(),handoff=new Map();
    let database,identity,identityAt=0,identityJob,revision=0;
    const routes=/^\/api\/(?:concentration-chart|kis-concentration-chart|ls-concentration-chart|chart-reference|(?:kis-|ls-)?turnover\/chart|(?:kis-|ls-)?supply\/chart|(?:kiwoom-|ls-)?market-supply\/chart|adr\/(?:candles|history|today)|risk\/(?:breadth|sentiment|volatility))$/;
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
        pruneJob=(async()=>{const d=await db();if(!d)return;await new Promise(resolve=>{try{const tx=d.transaction('responses','readwrite'),store=tx.objectStore('responses'),r=store.openCursor(),items=[];r.onsuccess=()=>{const c=r.result;if(c){items.push({key:c.key,at:c.value.at,bytes:c.value.bytes||0});c.continue();return;}let size=0,count=0;for(const item of items.sort((a,b)=>b.at-a.at)){size+=item.bytes;count++;if(Date.now()-item.at>=TTL||count>MAX_ENTRIES||size>MAX_BYTES)store.delete(item.key);}};tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();}catch{resolve();}});})().finally(()=>pruneJob=null);return pruneJob;
    }
    async function account(){
        // Native views authenticate by relay capability, not browser login cookies.
        if(window.rankIndependentClient)return /^[a-f0-9]{64}$/.test(window.rankIndependentCacheScope||'')?'independent:'+window.rankIndependentCacheScope:null;
        // Recheck the signed-in server identity before consulting persisted chart data.
        if(identityAt+FRESH>Date.now())return identity;
        if(!identityJob)identityJob=(async()=>{try{const r=await nativeFetch('/api/auth/session',{cache:'no-store'}),v=await r.json();if(!r.ok||!v.authenticated||!v.user?.email){identity=null;identityAt=Date.now();return null;}const next=await hash(String(v.user.email).trim().toLowerCase());if(identity!==next){memory.clear();blocked.clear();handoff.clear();revision++;}identity=next;identityAt=Date.now();return identity;}catch{return null;}})().finally(()=>identityJob=null);
        return identityJob;
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
    function notify(url){document.dispatchEvent(new CustomEvent('rank-chart-cache-updated',{detail:{path:url.pathname,mode:url.searchParams.get('mode')}}));}
    async function request(input,options={}){
        const url=new URL(typeof input==='string'?input:input.url,location.href),method=(options.method||'GET').toUpperCase();
        if(url.origin!==location.origin||!routes.test(url.pathname)||!['GET','POST'].includes(method))return nativeFetch(input,options);
        let body;try{body=method==='POST'?JSON.parse(options.body||'{}'):null;}catch{return nativeFetch(input,options);}
        // Concentration cursors are short-lived, owner-bound server sessions.
        if(body?.cursor)return nativeFetch(input,options);
        const owner=await account();throwIfAborted(options.signal);if(!owner)return nativeFetch(input,options);
        url.searchParams.sort();const canonical=body?JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b)))):'';
        const key=await hash(owner+'|'+method+'|'+url.href+'|'+canonical),epoch=revision;
        if(handoff.has(key)){const saved=handoff.get(key);handoff.delete(key);if(Date.now()-saved.at<FRESH)return response(saved.data);}
        async function network(background=false){
            if(pending.has(key)){try{return (await pending.get(key)).clone();}catch(e){if(e.name==='AbortError'&&!options.signal?.aborted)return nativeFetch(input,options);throw e;}}
            const task=(async()=>{
                const r=await nativeFetch(input,options);let data;try{data=await r.clone().json();}catch{return r;}
                if(epoch!==revision)return r;
                if(r.status===401||r.status===403){memory.delete(key);await storage('delete',key);identityAt=0;return r;}
                if(r.ok&&data.pending){blocked.add(key);if(background){handoff.set(key,{data,at:Date.now()});while(handoff.size>MAX_ENTRIES)handoff.delete(handoff.keys().next().value);notify(url);}return r;}
                blocked.delete(key);
                if(r.ok&&safe(data)&&hasValues(data)){
                    const entry={key,at:Date.now(),data,bytes:JSON.stringify(data).length*2,scope:owner};
                    if(entry.bytes<5*1024*1024){memory.delete(key);memory.set(key,entry);let size=0;for(const value of memory.values())size+=value.bytes;while(memory.size>MAX_ENTRIES||size>MAX_BYTES){const first=memory.keys().next().value;size-=memory.get(first).bytes;memory.delete(first);}
                        const saved=body?{...entry,data:{...data,cursor:null,has_more:false}}:entry;
                        await storage('put',key,saved);void prune();
                    }
                }else{memory.delete(key);await storage('delete',key);}
                if(background&&r.ok){handoff.set(key,{data,at:Date.now()});while(handoff.size>MAX_ENTRIES)handoff.delete(handoff.keys().next().value);notify(url);}return r;
            })();pending.set(key,task);
            try{return (await task).clone();}finally{if(pending.get(key)===task)pending.delete(key);}
        }
        if(blocked.has(key))return network();
        const entry=memory.get(key)||await storage('get',key);throwIfAborted(options.signal);
        if(entry&&entry.scope===owner&&Date.now()>=entry.at&&Date.now()-entry.at<TTL){
            const isHistorical=method==='GET'&&historical(url);
            // Persisted POST responses deliberately have no reusable pagination cursor.
            if(!isHistorical&&(Date.now()-entry.at>=1000||body&&!entry.data.cursor))void network(true).catch(()=>{});
            return response(entry.data);
        }
        if(entry)await storage('delete',key);
        return network();
    }
    function invalidateIdentity(){identityAt=0;identity=null;revision++;memory.clear();blocked.clear();handoff.clear();}
    window.RankChartCache={fetch:request,invalidateIdentity,ttl:TTL};
    const refreshers={
        '/api/concentration-chart':'refreshConcentrationChart','/api/kis-concentration-chart':'refreshKisConcentrationChart','/api/ls-concentration-chart':'refreshLsConcentrationChart',
        '/api/turnover/chart':'refreshRankTurnoverChart','/api/kis-turnover/chart':'refreshRankKisTurnoverChart','/api/ls-turnover/chart':'refreshRankLsTurnoverChart',
        '/api/supply/chart':'refreshRankSupplyChart','/api/kis-supply/chart':'refreshRankKisSupplyChart','/api/ls-supply/chart':'refreshRankLsSupplyChart',
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
            const state=window.getRankCombinedMarketSupplyDisplaySettings?.(),key='combinedMarketSupply';
            const path=state?.mode==='day'?'/api/ls-market-supply/chart':state?.selected?.startsWith('futures')?'/api/market-supply/chart':'/api/kiwoom-market-supply/chart';
            if(state && path===event.detail.path && !timers.has(key))timers.set(key,setTimeout(()=>{timers.delete(key);void Promise.resolve(window.refreshRankCombinedMarketSupplyChart?.()).catch(()=>{});},100));
        }
        const mode=event.detail.mode==='minute'?'minute':'day',key=name==='__allCharts'?name+':'+mode:name;
        if(!name||timers.has(key))return;
        timers.set(key,setTimeout(()=>{timers.delete(key);void Promise.resolve(name==='__allCharts'?window.RankChartAxis?.refreshCharts?.({mode}):window[name]?.()).catch(()=>{});},100));
    });
})();
