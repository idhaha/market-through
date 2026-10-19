(() => {
    const states = new Map();
    const getPanel = target => typeof target === 'string' ? document.querySelector(target)?.closest('.panel') : target?.closest('.panel');
    function paint(panel, state) {
        let dot = panel.querySelector(':scope > .rank-connection-dot');
        // Layout wrappers may move card children; keep exactly one card-level indicator.
        panel.querySelectorAll('.rank-connection-dot').forEach(candidate => {
            if (candidate !== dot) {
                if (!dot) { dot = candidate; panel.prepend(dot); }
                else candidate.remove();
            }
        });
        if (!dot) { dot = document.createElement('span'); dot.className = 'rank-connection-dot'; dot.setAttribute('role','img'); panel.prepend(dot); }
        const interval = Number(document.querySelector('#refreshInterval option:checked')?.dataset.interval) || 600000;
        const healthy = navigator.onLine && state?.ok && Date.now() - state.at < interval * 2 + 90000;
        dot.classList.toggle('is-connected', !!healthy);
        dot.title = healthy ? '정상 연결 · 최근 조회 성공' : '연결 확인 필요 · 미수신, 조회 실패 또는 갱신 지연';
        dot.setAttribute('aria-label',dot.title);
    }
    window.setRankCardConnection = (target, ok, at = Date.now()) => { const panel=getPanel(target); if(!panel)return; const state={ok,at};states.set(panel,state);paint(panel,state);window.dispatchEvent(new Event('rank-connection-change')); };
    window.getRankCardConnectionState = target => { const state=states.get(getPanel(target)); return state ? {...state} : null; };
    window.getRankCardConnection = target => { const panel=getPanel(target); return !!panel?.querySelector(':scope > .rank-connection-dot.is-connected'); };
    function refresh() { document.querySelectorAll('#tab_rank .grid-container > .panel, #tab_rank .rank-chart-row > .panel, #tab_rank > .panel').forEach(panel=>paint(panel,states.get(panel))); }
    const root=document.getElementById('tab_rank'); if(root){new MutationObserver(refresh).observe(root,{childList:true,subtree:true});refresh();}
    setInterval(refresh,5000);window.addEventListener('offline',refresh);window.addEventListener('online',refresh);
    const original=window.fetch;
    window.fetch=async function(input,options){
        const path=new URL(typeof input==='string'?input:input.url,location.href).pathname;
        const targets=path==='/api/transaction_rank'?['#transactionTable']:path==='/api/stock'?['#stockTable','#efriendStockTable']:path==='/api/watchlist_rank'?['#watchlistTable']:[];
        try {const response=await original.call(this,input,options);if(targets.length){let data;try{data=await response.clone().json();}catch{}for(const target of targets)window.setRankCardConnection(target,response.ok&&data?.success===true&&!data?.error);}return response;}
        catch(error){if(error.name!=='AbortError')targets.forEach(target=>window.setRankCardConnection(target,false));throw error;}
    };
})();
