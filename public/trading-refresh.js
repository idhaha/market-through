(() => {
    let state=null,checked=0,pending;
    async function update(){
        if(state && Date.now()-checked<60000)return state;
        if(pending)return pending;
        pending=fetch('/api/trading-session',{cache:'no-store'}).then(async response=>{
            if(!response.ok)throw Error();const value=await response.json();
            if(typeof value.spot!=='boolean'||typeof value.futures!=='boolean')throw Error();
            state=value;checked=Date.now();return state;
        }).catch(()=>{state={spot:false,futures:false,night:false,calendarKnown:false};checked=Date.now();return state;}).finally(()=>{pending=null;});return pending;
    }
    function allows(id){
        if(['sentiment','volatility'].includes(id))return true;
        const panelIds={combinedMarketSupply:'rankCombinedMarketSupplyChartPanel',combinedMarketSupplySecondary:'rankCombinedMarketSupplySecondaryChartPanel',testMarketSupply:'rankTestMarketSupplyChartPanel',marketSupply:'rankMarketSupplyChartPanel',lsMarketSupply:'rankLsMarketSupplyChartPanel',kiwoomMarketSupply:'rankKiwoomMarketSupplyChartPanel'};
        const panel=document.getElementById(panelIds[id]);
        const future=panel?.querySelector('input[value^="futures"]:checked');
        return future ? state?.futures===true : state?.spot===true;
    }
    function allowsUrl(url){
        if(!state)return true;
        if(url.pathname.startsWith('/api/risk/') && url.pathname!=='/api/risk/breadth')return true;
        const code=url.searchParams.get('code');
        return code?.startsWith('futures') ? state.futures : state.spot;
    }
    window.TradingRefresh={update,allows,allowsUrl,get state(){return state;}};
    void update();
})();
