(() => {
    let state=null,checked=0,pending;
    const calendarJobs=new Map();let calendarDays={};
    function acceptCalendar(days){
        const before=JSON.stringify(calendarDays);
        calendarDays={...calendarDays,...days};
        if(state)state={...state,days:calendarDays};
        if(before!==JSON.stringify(calendarDays) && typeof document.dispatchEvent==='function')document.dispatchEvent(new CustomEvent('trading-calendar-updated'));
    }
    async function ensureCalendar(from,to){
        const start=Date.parse(from+'T00:00:00+09:00')-86400000;
        from=new Date(start+9*3600000).toISOString().slice(0,10);
        let missing=false;
        for(let t=start,end=Date.parse(to+'T00:00:00+09:00');t<=end;t+=86400000){
            const date=new Date(t+9*3600000),key=date.toISOString().slice(0,10);
            if(![0,6].includes(date.getUTCDay()) && typeof calendarDays[key]!=='boolean'){missing=true;break;}
        }
        if(!missing)return;
        const key=from+':'+to,old=calendarJobs.get(key);if(old && Date.now()-old.at<15*60000)return old.promise;
        const entry={at:Date.now()};entry.promise=fetch('/api/trading-session/calendar?'+new URLSearchParams({from,to}),{cache:'no-store'})
            .then(async response=>{if(response.ok)acceptCalendar((await response.json()).days || {});}).catch(()=>{});
        calendarJobs.set(key,entry);if(calendarJobs.size>80)calendarJobs.delete(calendarJobs.keys().next().value);return entry.promise;
    }
    async function update(){
        if(state && Date.now()-checked<60000)return state;
        if(pending)return pending;
        pending=fetch('/api/trading-session',{cache:'no-store'}).then(async response=>{
            if(!response.ok)throw Error();const value=await response.json();
            if(typeof value.spot!=='boolean'||typeof value.futures!=='boolean')throw Error();
            state=value;acceptCalendar(value.days || {});checked=Date.now();return state;
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
    function accept(value){if(typeof value?.spot!=='boolean'||typeof value?.futures!=='boolean')return;state=value;acceptCalendar(value.days || {});checked=Date.now();}
    window.TradingRefresh={update,accept,ensureCalendar,allows,allowsUrl,get state(){return state;}};
    if(!window.rankIndependentClient)void update();
})();
