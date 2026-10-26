(() => {
    const states = new Map();
    const cardSources = [
        ['#lsConcentrationChartPanel','LS(거래대금)·키움(가격)'], ['#rankKisTurnoverChartPanel','한투(거래대금)·키움(가격)'], ['#rankLsTurnoverChartPanel','LS(거래대금)·키움(가격)'],
        ['#rankKiwoomMarketSupplyChartPanel', '키움'],
        ['#rankKisSupplyChartPanel', '한투(수급)·키움(가격)'], ['#rankLsSupplyChartPanel', 'LS(수급)·키움(가격)'],
        ['#transactionTable', '키움'], ['#stockTable', '키움'],
        ['#efriendStockTable', '한투'], ['#watchlistTable', '키움'],
        ['#concentrationChartPanel', '키움'], ['#kisConcentrationChartPanel', '한투'], ['#rankAdrChartPanel', 'jusikbot'],
        ['#rankTurnoverChartPanel', '키움'], ['#rankSupplyChartPanel', '키움'], ['#rankMarketSupplyChartPanel', '한투'], ['#rankLsMarketSupplyChartPanel', 'LS(수급)·키움(가격)'],
        ['#rankVolatilityChartPanel', 'jusikbot'], ['#rankBreadthChartPanel', '키움'],
        ['#rankSentimentChartPanel', 'jusikbot']
    ];
    const getPanel = target => typeof target === 'string' ? document.querySelector(target)?.closest('.panel') : target?.closest('.panel');
    function paint(panel, state) {
        const source = cardSources.find(([selector]) => panel.matches(selector) || panel.querySelector(selector))?.[1];
        if (source && !panel.querySelector('.rank-card-source')) {
            const credit = document.createElement('p');
            credit.className = 'rank-card-source';
            credit.textContent = `출처: ${source}`;
            panel.append(credit);
        }
        if(source && panel.querySelector('canvas')) {
            let footer=panel.querySelector(':scope > .rank-card-footer');
            if(!footer){footer=document.createElement('div');footer.className='rank-card-footer';const messages=document.createElement('div');messages.className='rank-card-messages';footer.append(messages);panel.append(footer);}
            const messages=footer.querySelector('.rank-card-messages');
            for(const node of panel.querySelectorAll('.rank-adr-status,#concentrationPeriod,.concentration-period,.concentration-status,.rank-history-notice,.rank-selection-history-notice'))if(node.parentElement!==messages)messages.append(node);
            const credit=panel.querySelector('.rank-card-source');if(credit && credit.parentElement!==footer)footer.append(credit);
        }
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
