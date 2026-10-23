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
    const viewportPanels={concentration:'concentrationChartPanel',supply:'rankSupplyChartPanel',breadth:'rankBreadthChartPanel',turnover:'rankTurnoverChartPanel',adr:'rankAdrChartPanel',volatility:'rankVolatilityChartPanel',sentiment:'rankSentimentChartPanel'};
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
    let historyMode=false, sharedCutoff='',redrawQueued=false,historyBusy=false;
    let dailyHistory=false,dailyCutoff='',rangeRevision=0;
    const historyLoaders=new Map();
    function notifyCharts() {
        if(redrawQueued)return;redrawQueued=true;
        queueMicrotask(()=>{redrawQueued=false;for(const chart of minuteCharts.values())chart.draw();});
    }
    function showHistory(){if(historyBusy)return;historyMode=true;for(const chart of minuteCharts.values())chart.applied=undefined;notifyCharts();}
    function showToday(){viewports.delete('minute');historyMode=false;for(const chart of minuteCharts.values())chart.applied=undefined;notifyCharts();}
    const refreshOrder=['concentration','supply','breadth','turnover','adr','sentiment','volatility'];
    const refreshMethods={concentration:'refreshConcentrationChart',supply:'refreshRankSupplyChart',breadth:'refreshRankBreadthChart',turnover:'refreshRankTurnoverChart',adr:'refreshRankAdrChart',sentiment:'refreshRankSentimentChart',volatility:'refreshRankVolatilityChart'};
    function refreshCharts({skipConcentration=false}={}) {
        window.rankChartRefreshStarted=true;
        const pending=[];
        for(const id of refreshOrder){
            if(skipConcentration && id==='concentration')continue;
            try {const result=window[refreshMethods[id]]?.();pending.push(Promise.resolve(result));}
            catch(error){pending.push(Promise.reject(error));}
        }
        return Promise.allSettled(pending);
    }
    function registerHistoryLoader(id,load,busy=()=>false){historyLoaders.set(id,{load,busy});}
    async function requestHistory(mode='minute') {
        if(historyBusy)return;
        const before=mode==='day'?dailyCutoff:sharedCutoff;
        historyBusy=true;
        const participants=[...minuteCharts.entries()].filter(([id,c])=>c.mode===mode && historyLoaders.has(id)).sort(([a],[b])=>(refreshOrder.indexOf(a)<0?99:refreshOrder.indexOf(a))-(refreshOrder.indexOf(b)<0?99:refreshOrder.indexOf(b)));
        const failures=[];
        try {
            for(const [id] of participants){
                const loader=historyLoaders.get(id),deadline=Date.now()+20000;
                try {
                    while(loader.busy() && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
                    if(loader.busy())throw new Error('조회 대기 시간 초과');
                    await loader.load();
                } catch(error){failures.push(id);}
            }
        } finally {
            historyBusy=false;
            const starts=[...minuteCharts.values()].filter(c=>c.mode===mode && c.first).map(c=>c.first).sort();
            const candidate=starts.at(-1);
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
            viewports.delete(mode);
            for(const chart of minuteCharts.values())chart.applied=undefined;
            notifyCharts();
        }
        const after=mode==='day'?dailyCutoff:sharedCutoff;
        const advanced=Boolean(after && (!before || after<before));
        const panelIds={concentration:'concentrationChartPanel',supply:'rankSupplyChartPanel',breadth:'rankBreadthChartPanel',turnover:'rankTurnoverChartPanel',adr:'rankAdrChartPanel',volatility:'rankVolatilityChartPanel',sentiment:'rankSentimentChartPanel'};
        if(typeof document!=='undefined')for(const [id] of participants){
            const panel=document.getElementById(panelIds[id]);if(!panel)continue;
            let notice=panel.querySelector('.rank-history-notice');
            if(!notice){notice=document.createElement('p');notice.className='rank-history-notice';notice.setAttribute('role','status');panel.append(notice);}
            notice.textContent=advanced?'':failures.length?'일부 차트의 과거 조회가 완료되지 않아 기존 표시 기간을 유지합니다.':'공통으로 표시할 더 이전 자료가 없어 기존 표시 기간을 유지합니다.';
            notice.hidden=advanced;
        }
        return {advanced,failures};
    }
    function sharedRange(id,values,getDate,mode,start,count,draw) {
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
        const visible=changed?size:Math.min(count ?? values.length,size);
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
        if(!viewport && (!dailyHistory || !dailyCutoff))return null;
        const active=[...minuteCharts.values()].filter(c=>c.mode==='day');
        const first=viewport?.first || dailyCutoff;
        const last=viewport?.last || active.map(c=>c.last).filter(Boolean).sort().at(-1);
        const days=[...new Set([first,last,...active.flatMap(c=>c.days || [])])].filter(d=>d>=first && d<=last).sort();
        if(!days.length)return null;
        return {first,last,days};
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
        const selector='[data-chart-mode],[data-mode],[data-adr-mode],[data-breadth-mode],[data-rank-mode]';
        const buttonMode=button=>button.dataset.chartMode || button.dataset.mode || button.dataset.adrMode || button.dataset.breadthMode || button.dataset.rankMode;
        let modeRevision=0,dispatchingMode=false;
        function synchronizeMode(mode) {
            viewports.delete(mode);
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
    window.RankChartAxis={updateSlider,scrollViewport,synchronizeViewport,refreshOrder,refreshCharts,registerHistoryLoader,requestHistory,showHistory,showToday,sharedRange,dailyDomain,minuteDomain,ticks,todayRange,limitToday,sessionRange,limitSessions,sessionX,eightTick,sessionStartLabel,candleLayout,todayButton};
})();
