(() => {
    function dateParts(value) {
        if (typeof value === 'number') return new Date(value + 9 * 3600000).toISOString().slice(0,16).replace('T',' ');
        const raw=String(value);
        return /^\d{8}/.test(raw) ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)} ${raw.slice(8,10)||'00'}:${raw.slice(10,12)||'00'}` : raw;
    }
    function ticks(context, values, getDate, x, left, right, mode) {
        if(mode==='minute')return minuteTicks(context,values,getDate,left,right);
        const daily=dailyDomain();
        if(mode==='day' && daily){
            // Select dates once from the shared domain, independently of each card's axis gutters.
            const indices=[...new Set(Array.from({length:5},(_,i)=>Math.round(i*(daily.days.length-1)/4)))];
            let previousRight=-Infinity;
            return indices.flatMap(index=>{
                const label=daily.days[index].slice(2,10),width=context.measureText(label).width;
                const labelX=Math.max(left+width/2,Math.min(right-width/2,left+index/Math.max(1,daily.days.length-1)*(right-left)));
                if(width>right-left || labelX-width/2<previousRight+16)return [];
                previousRight=labelX+width/2;return [{label,labelX}];
            });
        }
        if (!values.length || right<=left) return [];
        const dates=values.map(value=>dateParts(getDate(value)));
        const multipleDays=mode==='minute' && dates[0].slice(0,10)!==dates.at(-1).slice(0,10);
        const result=[];let previousRight=-Infinity,previousLabel='';
        values.forEach((value,i)=>{
            const date=dates[i],label=mode==='minute'?`${multipleDays?date.slice(5,10)+' ':''}${date.slice(11,16)}`:date.slice(2,10);
            const width=context.measureText(label).width;
            if(width>right-left || label===previousLabel)return;
            const labelX=Math.max(left+width/2,Math.min(right-width/2,x(value,i)));
            if(labelX-width/2<previousRight+16)return;
            result.push({label,labelX});previousRight=labelX+width/2;previousLabel=label;
        });
        return result;
    }
    function todayRange(values,getDate) {
        const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        const start=values.findIndex(v=>dateParts(getDate(v)).slice(0,10)===day);
        return start<0?{start:values.length,count:0}:{start,count:values.slice(start).filter(v=>dateParts(getDate(v)).slice(0,10)===day).length};
    }
    function limitToday(values,getDate,start,count) {
        const day=todayRange(values,getDate),size=Math.min(count ?? values.length,day.count);
        return {start:Math.max(day.start,Math.min(start,day.start+day.count-size)),count:size};
    }
    const minuteCharts=new Map();
    const viewports=new Map();
    let viewportSource=null,viewportBefore=null;
    const viewportPanels={combinedMarketSupply:'rankCombinedMarketSupplyChartPanel',combinedSupply:'rankCombinedSupplyChartPanel',combinedTurnover:'rankCombinedTurnoverChartPanel',combinedConcentration:'combinedConcentrationChartPanel',lsConcentration:'lsConcentrationChartPanel',kisTurnover:'rankKisTurnoverChartPanel',lsTurnover:'rankLsTurnoverChartPanel',kiwoomMarketSupply:'rankKiwoomMarketSupplyChartPanel',kisSupply:'rankKisSupplyChartPanel',lsSupply:'rankLsSupplyChartPanel',lsMarketSupply:'rankLsMarketSupplyChartPanel',concentration:'concentrationChartPanel',kisConcentration:'kisConcentrationChartPanel',supply:'rankSupplyChartPanel',marketSupply:'rankMarketSupplyChartPanel',breadth:'rankBreadthChartPanel',turnover:'rankTurnoverChartPanel',adr:'rankAdrChartPanel',volatility:'rankVolatilityChartPanel',sentiment:'rankSentimentChartPanel'};
    const hoverCharts=new Map();
    function hoverKey(value,mode) { return value==null?null:dateParts(value).slice(0,mode==='minute'?16:10); }
    function registerHover(id,getMode,getValue,apply) { hoverCharts.set(id,{getMode,getValue,apply}); }
    function synchronizeHover(id,clear=false) {
        const source=hoverCharts.get(id);if(!source)return;
        const mode=source.getMode(),key=clear?null:hoverKey(source.getValue(),mode);
        for(const [peerId,peer] of hoverCharts)if(peerId!==id)peer.apply(peer.getMode()===mode?key:null);
    }
    function matchesHover(value,key,mode) { return key!=null && hoverKey(value,mode)===key; }
    function synchronizeViewport(id) {
        const chart=minuteCharts.get(id);
        if(!chart?.dates.length || !chart.count)return;
        const first=chart.dates[chart.start],last=chart.dates[chart.start+chart.count-1];
        if(!first || !last)return;
        viewports.set(chart.mode,{first,last});notifyCharts();
    }
    function viewportRange(chart,start,count) {
        const viewport=viewports.get(chart.mode);
        if(viewport && viewportSource!==chart.id){
            const first=chart.dates.findIndex(d=>d>=viewport.first);
            start=first<0?chart.dates.length:first;
            count=chart.dates.slice(start).filter(d=>d<=viewport.last).length;
        }
        chart.start=start;chart.count=Math.min(count??chart.dates.length,chart.dates.length-start);
        return {start,count};
    }
    let historyMode=false, sharedCutoff='',redrawQueued=false,historyBusy=false,historyEpoch=0;
    let dailyHistory=false,dailyCutoff='',rangeRevision=0;
    const historyLoaders=new Map();
    let historyButtonsQueued=false;
    function scheduleHistoryButtons(){
        if(typeof document==='undefined' || historyButtonsQueued)return;
        historyButtonsQueued=true;queueMicrotask(()=>{
            historyButtonsQueued=false;
            for(const [id,chart] of minuteCharts){
                const loader=historyLoaders.get(id);if(!loader?.state)continue;
                const panel=document.getElementById(viewportPanels[id]);if(!panel)continue;
                const button=panel.querySelector('#concentrationMore,#kisConcentrationMore,[data-action="more"],[data-adr-more],[data-more],[data-breadth-more],[data-risk-more]');
                if(!button)continue;
                const available=[...minuteCharts].some(([peerId,peer])=>peer.mode===chart.mode && historyLoaders.get(peerId)?.state?.().hasMore);
                button.disabled=historyBusy || !available;
            }
        });
    }
    function notifyCharts() {
        if(redrawQueued)return;redrawQueued=true;
        queueMicrotask(()=>{redrawQueued=false;for(const chart of minuteCharts.values())chart.draw();});
    }
    function showHistory(){if(historyBusy)return;historyMode=true;for(const chart of minuteCharts.values())chart.applied=undefined;notifyCharts();}
    function resetHistoryWork(){
        historyEpoch++;historyBusy=false;pendingHistoryTargets.clear();
        if(typeof document!=='undefined')document.querySelectorAll('#tab_rank .rank-history-notice').forEach(notice=>notice.remove());
        scheduleHistoryButtons();
    }
    function showToday(){resetHistoryWork();viewports.delete('minute');historyMode=false;sharedCutoff=new Date(Date.now()+9*3600000).toISOString().slice(0,10)+' 08:00';rangeRevision++;for(const chart of minuteCharts.values())chart.applied=undefined;notifyCharts();}
    const refreshOrder=['concentration','combinedConcentration','supply','marketSupply','breadth','turnover','adr','sentiment','volatility','kisConcentration','lsMarketSupply','kisSupply','lsSupply','kiwoomMarketSupply','lsConcentration','kisTurnover','lsTurnover','combinedTurnover','combinedSupply','combinedMarketSupply'];
    const refreshMethods={combinedMarketSupply:'refreshRankCombinedMarketSupplyChart',combinedSupply:'refreshRankCombinedSupplyChart',combinedTurnover:'refreshRankCombinedTurnoverChart',combinedConcentration:'refreshConcentrationChart',lsConcentration:'refreshLsConcentrationChart',kisTurnover:'refreshRankKisTurnoverChart',lsTurnover:'refreshRankLsTurnoverChart',kiwoomMarketSupply:'refreshRankKiwoomMarketSupplyChart',kisSupply:'refreshRankKisSupplyChart',lsSupply:'refreshRankLsSupplyChart',lsMarketSupply:'refreshRankLsMarketSupplyChart',concentration:'refreshConcentrationChart',kisConcentration:'refreshKisConcentrationChart',supply:'refreshRankSupplyChart',marketSupply:'refreshRankMarketSupplyChart',breadth:'refreshRankBreadthChart',turnover:'refreshRankTurnoverChart',adr:'refreshRankAdrChart',sentiment:'refreshRankSentimentChart',volatility:'refreshRankVolatilityChart'};
    function refreshCharts({skipConcentration=false,mode=null}={}) {
        window.rankChartRefreshStarted=true;
        const pending=[];
        for(const id of refreshOrder){
            if(id==='concentration' && minuteCharts.has('combinedConcentration') || id==='combinedConcentration' && !minuteCharts.has('combinedConcentration'))continue;
            if(mode && minuteCharts.get(id)?.mode!==mode)continue;
            if(skipConcentration && id==='concentration')continue;
            try {const result=window[refreshMethods[id]]?.();pending.push(Promise.resolve(result));}
            catch(error){pending.push(Promise.reject(error));}
        }
        return Promise.allSettled(pending);
    }
    const pendingHistoryTargets=new Map();
    function registerHistoryLoader(id,load,busy=()=>false,state){historyLoaders.set(id,{load,busy,state});}
    const selectionRestores=new Map();
    async function restoreHistoryRange(id,range){
        if(!range?.first)return;
        const token={},loader=historyLoaders.get(id);if(!loader?.state)return;
        selectionRestores.set(id,token);
        const chart=minuteCharts.get(id),mode=chart?.mode,identity=loader.state().identity;
        const current=()=>selectionRestores.get(id)===token && minuteCharts.get(id)?.mode===mode && loader.state().identity===identity;
        const ready=async()=>{const until=Date.now()+20000;while(loader.busy() && current() && Date.now()<until)await new Promise(r=>setTimeout(r,50));if(!current())throw new Error('cancelled');if(loader.busy())throw new Error('조회 대기 시간 초과');};
        try{
            await ready();let pages=0;
            while(current()){
                const state=loader.state(),first=state.coverageFirst || minuteCharts.get(id)?.first;
                if(state.error)throw new Error(state.error);
                if(first && first<=range.first || !state.hasMore)break;
                if(++pages>80)throw new Error('과거 조회 페이지 한도 도달');
                const previous=`${first}:${state.cursor}:${state.progress}`;
                await loader.load();await ready();
                const next=loader.state(),after=next.coverageFirst || minuteCharts.get(id)?.first;
                if(next.hasMore && previous===`${after}:${next.cursor}:${next.progress}`)throw new Error('과거 조회가 진행되지 않았습니다.');
            }
            if(!current())return;
            await loader.state().ensureRange?.(range.first);await ready();
            if(loader.state().error)throw new Error(loader.state().error);
        }catch(error){
            if(!current())return;
            if(typeof document!=='undefined'){
                const panel=document.getElementById(viewportPanels[id]);if(panel){
                    let notice=panel.querySelector('.rank-selection-history-notice');
                    if(!notice){notice=document.createElement('p');notice.className='rank-selection-history-notice';notice.setAttribute('role','status');panel.append(notice);}
                    notice.textContent='선택 변경 후 과거 자료 조회 실패: '+error.message;
                }
            }
            return {error:error.message};
        }
    }
    async function requestHistory(mode='minute') {
        if(historyBusy)return;
        const epoch=historyEpoch;
        let before=mode==='day'?dailyCutoff:sharedCutoff;
        historyBusy=true;scheduleHistoryButtons();
        const participants=[...minuteCharts.entries()].filter(([id,c])=>c.mode===mode && historyLoaders.has(id)).sort(([a],[b])=>(refreshOrder.indexOf(a)<0?99:refreshOrder.indexOf(a))-(refreshOrder.indexOf(b)<0?99:refreshOrder.indexOf(b)));
        const failures=[], exhausted=[];
        const coordinated=participants.some(([id])=>historyLoaders.get(id).state);
        const originalViewport=viewports.get(mode);
        const initialDomain=mode==='day'?dailyDomain():minuteDomain();
        if(coordinated && initialDomain){
            before=before || initialDomain.first;
            viewports.set(mode,{first:initialDomain.first,last:initialDomain.last});
        }
        const hadVisibleData=participants.some(([id])=>minuteCharts.get(id)?.dates.some(date=>!initialDomain || date>=initialDomain.first && date<=initialDomain.last));
        let target=pendingHistoryTargets.get(mode), cancelled=false,showAvailable=false;
        const ensureReady=async loader=>{
            const deadline=Date.now()+20000;
            while(loader.busy() && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
            if(epoch!==historyEpoch){cancelled=true;throw new Error('조회 주기 변경');}
            if(loader.busy())throw new Error('조회 대기 시간 초과');
        };
        const step=async id=>{
            const loader=historyLoaders.get(id);await ensureReady(loader);
            if(minuteCharts.get(id)?.mode!==mode){cancelled=true;throw new Error('조회 주기 변경');}
            const old=minuteCharts.get(id)?.first, cursor=loader.state?.().cursor,progress=loader.state?.().progress;
            await loader.load();await ensureReady(loader);
            if(minuteCharts.get(id)?.mode!==mode){cancelled=true;throw new Error('조회 주기 변경');}
            const state=loader.state?.();
            if(state?.error)throw new Error(state.error);
            if(minuteCharts.get(id)?.first===old && state?.hasMore && state.cursor===cursor && state.progress===progress)throw new Error('과거 조회가 진행되지 않았습니다.');
        };
        try {
            if(coordinated){
                for(const [id] of participants){try{await ensureReady(historyLoaders.get(id));}catch{failures.push(id);}}
                // One leading page establishes a fixed target; peers catch up to it.
                if(!target && (!failures.length || mode==='minute')){
                    const leaders=[...participants].sort(([a],[b])=>(minuteCharts.get(a)?.first || '').localeCompare(minuteCharts.get(b)?.first || ''));
                    for(const [id] of leaders){
                        const loader=historyLoaders.get(id);if(failures.includes(id) || !loader.state?.().hasMore)continue;
                        try{
                            let pages=0;
                            while(loader.state().hasMore && (!target || target>=before)){
                                if(++pages>80)throw new Error('과거 조회 페이지 한도 도달');
                                await step(id);target=minuteCharts.get(id)?.first;
                            }
                        }catch{failures.push(id);if(cancelled || mode!=='minute')break;continue;}
                        if(target && target<before)break;
                    }
                    if(!target)target=before || participants.map(([id])=>minuteCharts.get(id)?.first).filter(Boolean).sort()[0];
                }
                if(target && (!failures.length || mode==='minute')){
                    for(const [id] of participants){
                        const loader=historyLoaders.get(id);let pages=0;
                        try{
                            while(!minuteCharts.get(id)?.first || minuteCharts.get(id).first>target){
                                if(!loader.state?.().hasMore){exhausted.push(id);break;}
                                if(++pages>80)throw new Error('과거 조회 페이지 한도 도달');
                                await step(id);
                            }
                        }catch{failures.push(id);}
                    }
                }
                if(target && (!failures.length || mode==='minute')){
                    for(const [id] of participants){
                        const loader=historyLoaders.get(id),ensure=loader.state?.().ensureRange;
                        if(ensure)try{await ensure(target);await ensureReady(loader);if(loader.state?.().error)throw new Error(loader.state().error);}catch{failures.push(id);}
                    }
                }
                if(failures.length && target && !cancelled)pendingHistoryTargets.set(mode,target);
                else pendingHistoryTargets.delete(mode);
            }else for(const [id] of participants){
                const loader=historyLoaders.get(id),deadline=Date.now()+20000;
                try {
                    while(loader.busy() && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
                    if(epoch!==historyEpoch){cancelled=true;throw new Error('조회 주기 변경');}
            if(loader.busy())throw new Error('조회 대기 시간 초과');
                    await loader.load();
                } catch(error){failures.push(id);}
            }
        } finally {
            if(epoch!==historyEpoch)return {advanced:false,failures:[],cancelled:true};
            historyBusy=false;
            // A failed comparison source must not hide minute history already
            // fetched by other cards, even when today's view contains data.
            if(coordinated && failures.length && (mode==='minute' || !hadVisibleData) && !cancelled){
                const available=participants.filter(([id])=>!failures.includes(id)).map(([id])=>minuteCharts.get(id)?.first).filter(Boolean).sort();
                if(available.length){
                    if(!target || before && target>=before)target=available[0];
                    showAvailable=!!target && (!before || target<before);
                }
            }
            const starts=[...minuteCharts.values()].filter(c=>c.mode===mode && c.first).map(c=>c.first).sort();
            const candidate=coordinated ? (failures.length && !showAvailable || cancelled ? before : target) : starts.at(-1);
            if(mode==='day') {
                dailyHistory=true;
                if(candidate && (!before || candidate<before))dailyCutoff=candidate;
                else if(before)dailyCutoff=before;
            } else {
                historyMode=true;
                if(candidate && (!before || candidate<before))sharedCutoff=candidate;
                else if(before)sharedCutoff=before;
            }
            rangeRevision++;
            if(coordinated && (failures.length || cancelled) && !showAvailable){
                if(originalViewport)viewports.set(mode,originalViewport);
                else if(initialDomain)viewports.set(mode,{first:initialDomain.first,last:initialDomain.last});
            }else viewports.delete(mode);
            for(const chart of minuteCharts.values())chart.applied=undefined;
            notifyCharts();scheduleHistoryButtons();
        }
        const after=mode==='day'?dailyCutoff:sharedCutoff;
        const advanced=Boolean(after && (!before || after<before));
        const panelIds=viewportPanels;
        if(typeof document!=='undefined')for(const [id] of participants){
            const panel=document.getElementById(panelIds[id]);if(!panel)continue;
            let notice=panel.querySelector('.rank-history-notice');
            if(!notice){notice=document.createElement('p');notice.className='rank-history-notice';notice.setAttribute('role','status');panel.append(notice);}
            notice.textContent=showAvailable?'일부 차트 조회 실패 · 확보한 과거 자료를 표시합니다.':advanced && !exhausted.length?'':failures.length?'일부 차트의 과거 조회가 완료되지 않아 기존 표시 기간을 유지합니다.':exhausted.length?'일부 차트는 원천 과거 자료가 끝나 해당 구간을 결측으로 표시합니다.':'공통으로 표시할 더 이전 자료가 없어 기존 표시 기간을 유지합니다.';
            notice.hidden=advanced && !failures.length && !exhausted.length;
        }
        return {advanced,failures,exhausted,target,partial:showAvailable};
    }
    function sharedRange(id,values,getDate,mode,start,count,draw) {
        scheduleHistoryButtons();
        const previous=minuteCharts.get(id);
        if(mode==='minute' && previous && previous.mode!=='minute')historyMode=false;
        const length=mode==='day'?10:16;
        const first=values.length?dateParts(getDate(values[0])).slice(0,length):'';
        const last=values.length?dateParts(getDate(values.at(-1))).slice(0,length):'';
        const days=[...new Set(values.map(v=>dateParts(getDate(v)).slice(0,10)))].sort();
        const signature=`${mode}:${first}:${last}:${days.join(',')}`;
        const chart={id,dates:values.map(v=>dateParts(getDate(v)).slice(0,length)),signature,mode,first,last,days,draw,applied:previous?.applied,revision:previous?.revision};minuteCharts.set(id,chart);
        const starts=[...minuteCharts.values()].filter(c=>c.mode==='minute' && c.first).map(c=>c.first);
        const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)+' 08:00';
        const candidate=historyMode && starts.length?starts.sort().at(-1):today;
        const cutoff=historyBusy ? (sharedCutoff || today) : historyMode && sharedCutoff && candidate>sharedCutoff ? sharedCutoff : candidate;
        if(cutoff!==sharedCutoff || previous?.signature!==signature){sharedCutoff=cutoff;notifyCharts();}
        if(mode!=='minute' && !(mode==='day' && dailyHistory && dailyCutoff))return viewportRange(chart,start,count);
        const effective=mode==='day'?dailyCutoff:cutoff;
        const index=values.findIndex(v=>dateParts(getDate(v)).slice(0,length)>=effective);
        const rangeStart=index<0?values.length:index,size=values.length-rangeStart;
        const changed=chart.applied!==effective || chart.revision!==rangeRevision || (size>0 && !previous?.size) || previous?.mode!==mode;chart.applied=effective;chart.size=size;chart.revision=rangeRevision;
        // A blank pre-open draw leaves count=0. In the default live view the
        // available session must grow with incoming bars, rather than retaining
        // that empty (or first-bar-only) count until the mode is toggled.
        const liveRange=!viewports.has(mode) && viewportSource!==id;
        const visible=changed || liveRange?size:Math.min(count ?? values.length,size);
        return viewportRange(chart,changed?rangeStart:Math.max(rangeStart,Math.min(start,values.length-visible)),visible);
    }
    function sessionRange(values,getDate,depth=0) {
        const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        const days=[...new Set([today,...values.map(v=>dateParts(getDate(v)).slice(0,10)).filter(d=>d<=today)])].sort();
        const first=days[Math.max(0,days.length-1-depth)];
        const start=values.findIndex(v=>{const day=dateParts(getDate(v)).slice(0,10);return day>=first && day<=today;});
        return start<0?{start:values.length,count:0}:{start,count:values.slice(start).filter(v=>dateParts(getDate(v)).slice(0,10)<=today).length};
    }
    function limitSessions(values,getDate,start,count,depth) {
        const range=sessionRange(values,getDate,depth),size=Math.min(count ?? values.length,range.count);
        return {start:Math.max(range.start,Math.min(start,range.start+range.count-size)),count:size};
    }
    function dailyDomain() {
        const viewport=viewports.get('day');
        const active=[...minuteCharts.values()].filter(c=>c.mode==='day' && c.dates.length);
        const first=viewport?.first || (dailyHistory && dailyCutoff) || active.map(c=>c.first).sort()[0];
        const last=viewport?.last || active.map(c=>c.last).filter(Boolean).sort().at(-1);
        const days=[...new Set([first,last,...active.flatMap(c=>c.days || [])])].filter(d=>d>=first && d<=last).sort();
        if(!days.length)return null;
        return {first,last,days};
    }
    const plotMargins=new Map();
    function plotBounds(id,width,left,right) {
        if(!window.rankIndependentClient)return {left,right};
        const margin={left,right:width-right},previous=plotMargins.get(id);
        plotMargins.set(id,margin);
        if(!previous || previous.left!==margin.left || previous.right!==margin.right)notifyCharts();
        return {left:Math.max(...[...plotMargins.values()].map(p=>p.left)),right:width-Math.max(...[...plotMargins.values()].map(p=>p.right))};
    }
    function minuteDomain(values=[],getDate=v=>v,useViewport=true) {
        const active=[...minuteCharts.values()].filter(c=>c.mode==='minute');
        const dates=values.map(v=>dateParts(getDate(v)).slice(0,16));
        const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        const localFirst=dates[0]?.slice(0,10) || today;
        const viewport=useViewport?viewports.get('minute'):null;
        const first=viewport?.first || (active.length ? (sharedCutoff || today+' 08:00') : localFirst+' 08:00');
        const latest=active.length ? active.map(c=>c.last).filter(v=>v && v>=first).sort().at(-1) : dates.at(-1);
        const now=new Date(Date.now()+9*3600000).toISOString().slice(0,16).replace('T',' ');
        const last=viewport?.last || latest || (now>=first?now:first);
        const days=[...new Set([first.slice(0,10),last.slice(0,10),...(active.length?active.flatMap(c=>c.days || []):dates.map(d=>d.slice(0,10)))])].filter(d=>d>=first.slice(0,10)&&d<=last.slice(0,10)).sort();
        const clock=date=>Number(date.slice(11,13))*60+Number(date.slice(14,16));
        const offset=clock(first)-480;
        const position=value=>{const date=dateParts(value),day=date.slice(0,10);return days.indexOf(day)*720+clock(date)-480-offset;};
        const span=Math.max(1,position(last));
        return {first,last,days,offset,span,position};
    }
    function sliderDomain(mode) {
        if(mode==='minute'){
            const domain=minuteDomain([],v=>v,false);
            return {...domain,at:position=>{
                const total=Math.round(position)+domain.offset,index=Math.min(domain.days.length-1,Math.max(0,Math.floor(total/720)));
                const minutes=480+total-index*720;
                return domain.days[index]+' '+String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
            }};
        }
        const active=[...minuteCharts.values()].filter(c=>c.mode==='day' && c.first);
        const first=dailyCutoff || active.map(c=>c.first).sort().at(-1),last=active.map(c=>c.last).sort().at(-1);
        if(!first || !last)return null;
        const days=[...new Set([first,last,...active.flatMap(c=>c.days)])].filter(d=>d>=first && d<=last).sort();
        return {first,last,span:Math.max(0,days.length-1),position:value=>days.indexOf(value.slice(0,10)),at:position=>days[Math.max(0,Math.min(days.length-1,Math.round(position)))]};
    }
    function sliderRange(mode) {
        const domain=sliderDomain(mode);if(!domain)return null;
        const viewport=viewports.get(mode) || domain;
        const start=Math.max(0,domain.position(viewport.first));
        const span=Math.max(0,Math.min(domain.span,domain.position(viewport.last)-start));
        return {domain,start,span,travel:Math.max(0,domain.span-span)};
    }
    function updateSlider(id,slider,busy=false) {
        const chart=minuteCharts.get(id);if(!chart)return;
        const range=sliderRange(chart.mode);if(!range)return;
        slider.dataset.sharedChart=id;slider.min='0';slider.max='10000';slider.step='1';
        slider.value=String(range.travel?Math.round(Math.min(range.travel,range.start)/range.travel*10000):0);
        slider.disabled=busy || range.travel===0;
    }
    function scrollViewport(id,value) {
        const chart=minuteCharts.get(id);if(!chart)return;
        const range=sliderRange(chart.mode);if(!range || !range.travel)return;
        const start=Math.round(Math.max(0,Math.min(10000,Number(value)))/10000*range.travel);
        viewports.set(chart.mode,{first:range.domain.at(start),last:range.domain.at(start+range.span)});notifyCharts();
    }
    // Select on the rendered common time axis, not a chart's private row count.
    function selectViewport(id,from,to) {
        const chart=minuteCharts.get(id);if(!chart)return;
        viewportSource=null;
        if(to<from){
            viewports.delete(chart.mode);
            const domain=chart.mode==='day'?dailyDomain():minuteDomain();
            if(domain)viewports.set(chart.mode,{first:domain.first,last:domain.last});
            notifyCharts();return;
        }
        const a=Math.max(0,Math.min(1,from)),b=Math.max(0,Math.min(1,to));
        let first,last;
        if(chart.mode==='day'){
            const domain=dailyDomain();if(!domain)return;
            first=domain.days[Math.floor(a*(domain.days.length-1))];
            last=domain.days[Math.ceil(b*(domain.days.length-1))];
        }else{
            const domain=minuteDomain();
            const at=fraction=>{
                const position=domain.offset+Math.round(fraction*domain.span);
                const index=Math.max(0,Math.min(domain.days.length-1,Math.floor(position/720)));
                const minute=480+position-index*720;
                return domain.days[index]+' '+String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
            };
            first=at(a);last=at(b);
        }
        if(first && last){viewports.set(chart.mode,{first,last});notifyCharts();}
    }
    function sessionX(values,getDate,left,right,active,day=false) {
        if(!active){const daily=day?dailyDomain():null;return daily?value=>left+daily.days.indexOf(dateParts(value).slice(0,10))/Math.max(1,daily.days.length-1)*(right-left):null;}
        const domain=minuteDomain(values,getDate);
        return value=>left+domain.position(value)/domain.span*(right-left);
    }
    function minuteTicks(context,values,getDate,left,right) {
        if(right<=left)return [];
        const domain=minuteDomain(values,getDate),multiple=domain.days.length>1;
        const intervals=[1,2,5,10,15,30,60,120,240,360,720,1440,2880,5760];
        const step=intervals.find(n=>n>=domain.span/6) || Math.ceil(domain.span/6/720)*720;
        const offsets=[0];
        for(let n=step;n<domain.span;n+=step)offsets.push(n);
        offsets.push(domain.span);
        const labels=[];let previousRight=-Infinity;
        for(const offset of offsets){
            const total=offset+domain.offset,index=Math.min(domain.days.length-1,Math.floor(total/720));
            const minutes=480+total-index*720;
            const clock=String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(Math.floor(minutes%60)).padStart(2,'0');
            const label=(multiple?domain.days[index].slice(5)+' ':'')+clock,width=context.measureText(label).width;
            const labelX=Math.max(left+width/2,Math.min(right-width/2,left+offset/domain.span*(right-left)));
            if(width>right-left || labelX-width/2<previousRight+16)continue;
            labels.push({label,labelX});previousRight=labelX+width/2;
        }
        return labels;
    }
    function eightTick(context,labels,left,right,active,label='08:00') {
        if(!active)return labels;
        const width=context.measureText(label).width;
        if(width>right-left)return [];
        const first={label,labelX:left+width/2};
        return [first,...labels.filter(p=>p.label!==label && p.labelX-context.measureText(p.label).width/2>=left+width+16)];
    }
    function sessionStartLabel(values,getDate) {
        const domain=minuteDomain(values,getDate);
        return (domain.days.length>1?domain.first.slice(5,10)+' ':'')+domain.first.slice(11,16);
    }
    function marketChoice(name, choices, value, label) {
        const group=document.createElement('div');group.className='rank-market-choice';group.setAttribute('role','radiogroup');group.setAttribute('aria-label',label);
        let selected=value;
        Object.defineProperty(group,'value',{get:()=>group.querySelector('input:checked')?.value || selected,set:value=>{selected=value;group.querySelectorAll('input').forEach(input=>input.checked=input.value===value);}});
        Object.defineProperty(group,'selectedOptions',{get:()=>[...group.querySelectorAll('input:checked')].map(input=>({textContent:input.parentElement.textContent}))});
        group.setChoices=choices=>{
            const signature=JSON.stringify(choices);if(group.dataset.choices===signature)return;
            group.dataset.choices=signature;
            group.replaceChildren(...choices.map(([value,text])=>{
                const item=document.createElement('label'),input=document.createElement('input');input.type='radio';input.name='rank-market-'+name;input.value=value;input.checked=value===selected;
                item.append(input,document.createTextNode(text));return item;
            }));
        };
        group.addEventListener('change',event=>{selected=event.target.value;});group.setChoices(choices);return group;
    }
    function validCandle(point) {
        return ['open','high','low','close'].every(key=>Number.isFinite(point?.[key]) && point[key]>0) &&
            point.low<=Math.min(point.open,point.close) && point.high>=Math.max(point.open,point.close);
    }
    function candleLabel(area, text) {
        let label=area.querySelector('.rank-candle-label,.volatility-candle-label,.market-candle-label');
        if(!label){label=document.createElement('span');area.prepend(label);}
        if(label.className!=='rank-candle-label')label.className='rank-candle-label';
        if(label.textContent!==(text || ''))label.textContent=text || '';
        label.hidden=!text;
        if(label.title!==(text || ''))label.title=text || '';
        const canvas=area.querySelector('canvas');
        if(canvas && text && canvas.getAttribute('aria-label')!==text+' 캔들차트')canvas.setAttribute('aria-label',text+' 캔들차트');
    }
    function candleLayout(rows,getLow,getHigh,x,height,left,right) {
        const low=Math.min(...rows.map(getLow)),high=Math.max(...rows.map(getHigh));
        const pad=Math.max(1,(high-low)*.1),top=10,bottom=height-30;
        const positions=rows.map((p,i)=>x(p,i)).sort((a,b)=>a-b);
        const spacing=positions.slice(1).map((v,i)=>v-positions[i]).filter(v=>v>0);
        const width=Math.max(1,Math.min(8,(spacing.length?Math.min(...spacing):(right-left))*.7));
        const minimum=Math.max(0,low-pad),maximum=high+pad;
        return {top,bottom,minimum,maximum,width,y:v=>bottom-(v-minimum)/Math.max(1,maximum-minimum)*(bottom-top)};
    }
    function todayButton(panel,selector,getMode,onToday) {
        const minute=panel.querySelector(selector);if(!minute)return;
        const button=document.createElement('button');button.type='button';button.className='chart-today-button';button.textContent='당일';
        minute.after(button);button.addEventListener('click',()=>{showToday();onToday();});
        const update=()=>{button.hidden=getMode()!=='minute';};
        new MutationObserver(update).observe(minute,{attributes:true,attributeFilter:['class','aria-pressed']});update();return button;
    }
    if(typeof document!=='undefined') {
        let syncingMarket=false;
        document.addEventListener('change',event=>{
            const input=event.target;
            if(syncingMarket || !input.matches?.('.rank-market-choice input[type="radio"]') || !input.closest('#tab_rank'))return;
            syncingMarket=true;
            try{
                for(const group of document.querySelectorAll('#tab_rank .rank-market-choice[role="radiogroup"]')){
                    if(group===input.closest('.rank-market-choice'))continue;
                    const peer=[...group.querySelectorAll('input[type="radio"]')].find(peer=>peer.value===input.value && !peer.disabled);
                    if(peer && !peer.checked)peer.click();
                }
            }finally{syncingMarket=false;}
        });
        // Local handlers choose the source time first; peers use their own hover rendering.
        document.addEventListener('mousemove',event=>{
            if(!event.target.matches?.('canvas') || event.buttons)return;
            const entry=Object.entries(viewportPanels).find(([,panel])=>event.target.closest('#'+panel));
            if(entry)synchronizeHover(entry[0]);
        });
        for(const type of ['mouseleave','pointerdown','pointercancel'])document.addEventListener(type,event=>{
            if(!event.target.matches?.('canvas'))return;
            const entry=Object.entries(viewportPanels).find(([,panel])=>event.target.closest('#'+panel));
            if(entry)synchronizeHover(entry[0],true);
        },true);
        // Local handlers update their range first; publish it to peers after the event.
        for(const type of ['click','input','wheel','pointerup'])document.addEventListener(type,event=>{
            const target=event.target;
            if(type==='input' && target.dataset?.sharedChart){
                scrollViewport(target.dataset.sharedChart,target.value);event.stopImmediatePropagation();return;
            }
            const control=type==='click'?target.closest?.('.concentration-controls button'):type==='input'?target.matches?.('input[type="range"]'):target.matches?.('canvas');
            if(!control)return;
            const entry=Object.entries(viewportPanels).find(([,panel])=>target.closest?.('#'+panel));
            if(!entry)return;
            const id=entry[0];viewportSource=id;
            const chart=minuteCharts.get(id);viewportBefore=chart?`${chart.start}:${chart.count}`:null;
        },true);
        for(const type of ['click','input','wheel','pointerup'])document.addEventListener(type,()=>{
            const id=viewportSource,chart=minuteCharts.get(id);viewportSource=null;
            if(chart && `${chart.start}:${chart.count}`!==viewportBefore)synchronizeViewport(id);
            viewportBefore=null;
        });
        const selector='button[data-chart-mode],button[data-mode],button[data-adr-mode],button[data-breadth-mode],button[data-rank-mode]';
        const buttonMode=button=>button.dataset.chartMode || button.dataset.mode || button.dataset.adrMode || button.dataset.breadthMode || button.dataset.rankMode;
        let modeRevision=0,dispatchingMode=false;
        function synchronizeMode(mode) {
            resetHistoryWork();viewports.delete(mode);pendingHistoryTargets.delete(mode);
            const revision=++modeRevision;
            if(mode==='day' && [...minuteCharts.values()].some(c=>c.mode==='minute')){dailyHistory=false;dailyCutoff='';}
            if(mode==='minute')showToday();
            function apply() {
                if(revision!==modeRevision)return;
                let pending=false;dispatchingMode=true;
                try {
                    for(const panel of document.querySelectorAll('#tab_rank .panel')) {
                        const target=[...panel.querySelectorAll(selector)].find(button=>buttonMode(button)===mode);
                        // Daily-only charts keep their day button when minute is selected.
                        if(!target || target.classList.contains('active'))continue;
                        if(!target.disabled)target.click();
                        if(!target.classList.contains('active'))pending=true;
                    }
                } finally {dispatchingMode=false;}
                if(pending)setTimeout(apply,100);
                else if(typeof saveAppData==='function')saveAppData();
            }
            queueMicrotask(apply);
        }
        document.addEventListener('click',event=>{
            if(dispatchingMode)return;
            const button=event.target.closest?.(selector);
            if(!button || button.disabled || !button.closest('#tab_rank .panel'))return;
            const mode=buttonMode(button);
            if(mode==='day' || mode==='minute')synchronizeMode(mode);
        },true);
    }
    function loadingBar(area, busy, label = '지표') {
        if (!area) return;
        area.setAttribute('aria-busy', String(!!busy));
        let bar=area.querySelector(':scope > .rank-chart-loading');
        if (!bar && busy) {
            bar=document.createElement('div');bar.className='efriend-loading-overlay rank-chart-loading';
            bar.setAttribute('role','progressbar');bar.innerHTML='<span class="efriend-loading-spinner"></span><b></b>';area.append(bar);
        }
        if(bar){bar.hidden=!busy;bar.setAttribute('aria-label',`${label} 조회 중`);bar.querySelector('b').textContent=`${label} 조회 중…`;}
    }
    function intradayGap(a,b,close=1200) {
        if(!a || !b || b-a<=60000)return false;
        const x=new Date(a+32400000),y=new Date(b+32400000);
        return x.toISOString().slice(0,10)===y.toISOString().slice(0,10)
            && x.getUTCHours()*60+x.getUTCMinutes()>=480
            && y.getUTCHours()*60+y.getUTCMinutes()<=close;
    }
    function concentrationCumulative(points) {
        const result=new Map();let day,stock=0,market=0,stockReady=false,marketReady=false;
        for(const p of [...points].sort((a,b)=>String(a.time).localeCompare(String(b.time)))){
            const d=p.time.slice(0,8),clock=p.time.slice(8,12);
            if(d!==day){day=d;stock=market=0;stockReady=marketReady=false;}
            if(clock==='0800')stockReady=true;if(clock==='0900')marketReady=true;
            if(Number.isFinite(p.stock_turnover))stock+=p.stock_turnover;else stockReady=false;
            if(clock>='0900'){if(Number.isFinite(p.market_turnover))market+=p.market_turnover;else marketReady=false;}
            result.set(p.time,Object.hasOwn(p,'cumulative_value')?p.cumulative_value:stockReady&&marketReady&&market>0?stock/market*100:null);
        }
        return result;
    }
    window.RankChartAxis={concentrationCumulative,loadingBar,intradayGap,restoreHistoryRange,marketChoice,validCandle,candleLabel,selectViewport,plotBounds,registerHover,synchronizeHover,matchesHover,updateSlider,scrollViewport,synchronizeViewport,refreshOrder,refreshCharts,registerHistoryLoader,requestHistory,showHistory,showToday,sharedRange,dailyDomain,minuteDomain,ticks,todayRange,limitToday,sessionRange,limitSessions,sessionX,eightTick,sessionStartLabel,candleLayout,todayButton};
})();
