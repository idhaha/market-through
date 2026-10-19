(() => {
    'use strict';
    function initialize() {
        const adr = document.getElementById('rankAdrChartPanel');
        if (!adr || document.getElementById('rankTurnoverChartPanel')) return;
        const panel = document.createElement('section');
        panel.id = 'rankTurnoverChartPanel'; panel.className = 'panel rank-adr-panel rank-turnover-panel';
        panel.innerHTML = `<div class="concentration-chart-header"><h2>거래대금</h2><div class="rank-market-choice" role="radiogroup" aria-label="거래대금 시장 선택"><label><input type="radio" name="rank-turnover-market" value="kospi" checked>KOSPI</label><label><input type="radio" name="rank-turnover-market" value="kosdaq">KOSDAQ</label></div><div class="turnover-legend"><span data-market="kospi"><span>● KOSPI</span><output data-latest="kospi">—</output></span><span data-market="kosdaq"><span>● KOSDAQ</span><output data-latest="kosdaq">—</output></span></div></div><div class="rank-adr-controls"><button type="button" data-mode="day" class="active">일</button><button type="button" data-mode="minute">당일1분(누적)</button><span class="rank-adr-ranges">${['6m','1y','3y','5y'].map(r => `<button type="button" data-range="${r}" class="${r === '1y' ? 'active' : ''}">${r.toUpperCase()}</button>`).join('')}</span><button type="button" class="concentration-candle-toggle" aria-expanded="false">캔들차트</button></div><div class="turnover-hover-info" aria-live="off"></div><div class="rank-adr-area"><canvas role="img" aria-label="코스피 코스닥 거래대금 차트"></canvas><div class="concentration-tooltip" hidden></div></div><div class="rank-adr-candle-area" hidden><canvas role="img" aria-label="선택 시장 지수 캔들차트"></canvas></div><div class="concentration-chart-footer rank-adr-zoom"><input type="range" min="0" max="0" value="0" aria-label="거래대금 과거 구간 이동" disabled><div class="concentration-controls"><button type="button" aria-label="거래대금 차트 축소">−</button><button type="button" aria-label="거래대금 차트 확대">+</button></div></div><p role="status" class="rank-adr-status"></p>`;
        adr.after(panel);
        panel.querySelector('.rank-adr-controls').append(panel.querySelector('.turnover-legend'));
        let selectedMarket = 'kospi';
        const canvas = panel.querySelector('.rank-adr-area canvas'), ctx = canvas.getContext('2d');
        const candleArea = panel.querySelector('.rank-adr-candle-area'), candle = candleArea.querySelector('canvas'), cc = candle.getContext('2d');
        const tip = panel.querySelector('.turnover-hover-info'), status = panel.querySelector('[role="status"]'), slider = panel.querySelector('input[type="range"]');
        const [out, into] = panel.querySelectorAll('.concentration-controls button');
        const colors = {kospi:'#339af0',kosdaq:'#e11d48'}, names = {kospi:'KOSPI',kosdaq:'KOSDAQ'};
        let data = {kospi:[],kosdaq:[]}, dailyData = {kospi:[],kosdaq:[]}, minuteData = {kospi:[],kosdaq:[]}, previous = {kospi:null,kosdaq:null};
        let mode = 'day', dates = [], range = '1y', start = 0, count = null, controller, hover = null, geometry, drag = null, refreshPending = false;
        let candlePointerY = null;
        const dateKey = t => new Date(t + 9 * 3600000).toISOString().slice(0,10);
        function surface(c, context) {
            const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
            c.width = Math.round(w*dpr); c.height = Math.round(h*dpr); context.setTransform(dpr,0,0,dpr,0,0); context.clearRect(0,0,w,h);
            context.font = '12px Inter, sans-serif'; return {w,h};
        }
        function draw() {
            const n = Math.min(dates.length,count ?? dates.length); start = Math.max(0,Math.min(start,dates.length-n));
            const visible = dates.slice(start,start+n), indices = new Map(visible.map((t,i) => [t,i]));
            slider.max = String(dates.length-n); slider.value = String(start); slider.disabled = n >= dates.length;
            into.disabled = n <= 10; out.disabled = n >= dates.length;
            const {w,h} = surface(canvas,ctx), left = 16, top = 10, bottom = h-30;
            const rows = Object.fromEntries(Object.keys(data).map(m => [m,data[m].filter(p => indices.has(p.t))]));
            const selected = rows[selectedMarket];
            const highestCandle = selected.reduce((highest, point) => Math.max(highest, Number(point.high) || 0), 0);
            const candleAxisWidth = candleArea.hidden || !selected.length ? 0 : ctx.measureText(Math.round(highestCandle).toLocaleString('ko-KR')).width;
            const right = w - Math.max(58, candleAxisWidth + 12);
            if (right <= left || bottom <= top) return;
            const x = t => left + indices.get(t)/Math.max(1,n-1)*(right-left);
            const values = Object.values(rows).flat().filter(p => Number.isFinite(p.market_turnover)).map(p => p.market_turnover/1e12);
            const benchmarks = mode === 'minute' ? Object.values(previous).filter(Number.isFinite).map(v=>v/1e12) : [];
            const max = Math.max(10,Math.ceil(Math.max(0,...values,...benchmarks)/10)*10), y = v => bottom-v/max*(bottom-top);
            const style = getComputedStyle(panel), muted = style.getPropertyValue('--text-muted').trim(), border = '#b8c1cc';
            ctx.textAlign = 'left'; ctx.fillStyle = muted;
            for (let v=0;v<=max;v+=10) { ctx.strokeStyle=border; ctx.setLineDash([3,5]); ctx.beginPath(); ctx.moveTo(left,y(v)); ctx.lineTo(right,y(v)); ctx.stroke(); ctx.textAlign='right'; ctx.fillText(`${v}조`,w-4,y(v)+4); }
            ctx.setLineDash([]);
            if (mode === 'minute' && Number.isFinite(previous[selectedMarket])) {
                const benchmark = previous[selectedMarket]/1e12;
                ctx.save();ctx.strokeStyle='#f97316';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left,y(benchmark));ctx.lineTo(right,y(benchmark));ctx.stroke();
                const label=`전일 ${benchmark.toFixed(2)}조`, lineY=y(benchmark);
                ctx.font='bold 11px Arial';ctx.textAlign='right';
                const labelY=lineY-top>=25 ? lineY-10 : lineY+18;
                const labelWidth=ctx.measureText(label).width, labelRight=right-4;
                ctx.fillStyle=getComputedStyle(panel).getPropertyValue('--bg-primary').trim() || '#fff';
                ctx.fillRect(labelRight-labelWidth-4,labelY-12,labelWidth+8,16);
                ctx.fillStyle='#f97316';ctx.fillText(label,labelRight,labelY);ctx.restore();
            }
            const ticks = visible.filter((_,i) => i % Math.max(1,Math.ceil(n/Math.max(1,Math.floor((right-left)/90)))) === 0);
            function axis(context,height) { context.font='12px Inter, sans-serif'; context.fillStyle=muted; context.textAlign='center'; ticks.forEach(t => context.fillText(mode==='minute' ? new Date(t+9*3600000).toISOString().slice(11,16) : dateKey(t).slice(2),x(t),height-8)); }
            axis(ctx,h);
            for (const m of [selectedMarket === 'kospi' ? 'kosdaq' : 'kospi',selectedMarket]) {
                ctx.globalAlpha = m === selectedMarket ? 1 : .22; ctx.strokeStyle=colors[m]; ctx.lineWidth=m === selectedMarket ? 2 : 1.5; ctx.beginPath();
                let connected=false;
                rows[m].forEach(p => { if (!Number.isFinite(p.market_turnover)) {connected=false;return;} if (!connected) ctx.moveTo(x(p.t),y(p.market_turnover/1e12)); else ctx.lineTo(x(p.t),y(p.market_turnover/1e12)); connected=true; }); ctx.stroke();
                if (rows[m].length === 1 && Number.isFinite(rows[m][0].market_turnover)) {ctx.beginPath();ctx.arc(x(rows[m][0].t),y(rows[m][0].market_turnover/1e12),3,0,Math.PI*2);ctx.fillStyle=colors[m];ctx.fill();}
                const latestTime = data[m].filter(p => Number.isFinite(p.market_turnover)).at(-1)?.t;
                rows[m].forEach(p => {
                    if (!Number.isFinite(p.market_turnover) || p.t !== latestTime && p.t !== hover) return;
                    ctx.fillStyle = p.t === latestTime ? '#f97316' : colors[m];
                    ctx.beginPath(); ctx.arc(x(p.t),y(p.market_turnover/1e12),4,0,Math.PI*2); ctx.fill();
                });
            }
            ctx.globalAlpha=1; ctx.lineWidth=1;
            geometry = {visible,x,left,right,top,bottom};
            drawDrag(ctx, top, bottom);
            if (hover && indices.has(hover)) {ctx.strokeStyle='#000';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x(hover),top);ctx.lineTo(x(hover),bottom);ctx.stroke();ctx.setLineDash([]);}
            if (hover && indices.has(hover)) {
                for (const m of ['kospi','kosdaq']) {
                    const point=rows[m].find(p=>p.t===hover);
                    if (Number.isFinite(point?.market_turnover)) drawHoverValue(ctx,{left,right,top,bottom,y},point.market_turnover/1e12,`${(point.market_turnover/1e12).toFixed(1)}조`,colors[m]);
                }
            }
            panel.querySelectorAll('[data-market]').forEach(el => {el.style.color=colors[el.dataset.market];el.querySelector('span').style.opacity='1';});
            panel.querySelectorAll('[data-latest]').forEach(el => {
                const point=data[el.dataset.latest].filter(p=>Number.isFinite(p.market_turnover)).at(-1);
                el.textContent=point?`${(point.market_turnover/1e12).toFixed(1)}조원`:'—';
            });
            if (candleArea.hidden) return;
            const size=surface(candle,cc); axis(cc,size.h);
            if (!selected.length) return;
            const lo=Math.min(...selected.map(p=>p.low)), hi=Math.max(...selected.map(p=>p.high)), margin=Math.max((hi-lo)*.1,hi*.001);
            const cy=v=>size.h-28-(v-lo+margin)/(hi-lo+2*margin)*(size.h-44), cw=Math.max(1,Math.min(8,(right-left)/Math.max(1,n)*.7));
            cc.textAlign='left';
            for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4;cc.fillStyle=muted;cc.textAlign='right';cc.fillText(Math.round(v).toLocaleString('ko-KR'),size.w-4,cy(v)+4);cc.strokeStyle=border;cc.setLineDash([3,5]);cc.beginPath();cc.moveTo(left,cy(v));cc.lineTo(right,cy(v));cc.stroke();}
            cc.setLineDash([]);
            selected.forEach(p=>{cc.fillStyle=cc.strokeStyle=p.close>=p.open?'#e11d48':'#2563eb';cc.beginPath();cc.moveTo(x(p.t),cy(p.high));cc.lineTo(x(p.t),cy(p.low));cc.stroke();cc.fillRect(x(p.t)-cw/2,Math.min(cy(p.open),cy(p.close)),cw,Math.max(1,Math.abs(cy(p.open)-cy(p.close))));});
            if(hover&&indices.has(hover)){cc.strokeStyle='#000';cc.setLineDash([3,3]);cc.beginPath();cc.moveTo(x(hover),16);cc.lineTo(x(hover),size.h-28);cc.stroke();cc.setLineDash([]);}
            const hovered=selected.find(p=>p.t===hover);
            const price=hovered?.close;
            if(hover&&Number.isFinite(price))drawHoverValue(cc,{left,right,top:16,bottom:size.h-28,y:cy},price,price.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}),'#000');
            drawDrag(cc,16,size.h-28);
        }
        function drawHoverValue(context,graph,value,label,color) {
            const py=graph.y(value), badgeY=Math.max(graph.top+10,Math.min(graph.bottom-10,py));
            context.save();context.lineWidth=1;context.strokeStyle=color;context.setLineDash([3,3]);
            context.beginPath();context.moveTo(graph.left,py);context.lineTo(graph.right,py);context.stroke();context.setLineDash([]);
            context.font='bold 11px Arial';context.fillStyle=color;
            const badgeWidth=context.measureText(label).width+12,badgeX=Math.max(0,context.canvas.clientWidth-badgeWidth-4);
            context.fillRect(badgeX,badgeY-10,badgeWidth,20);
            context.fillStyle='#fff';context.textAlign='left';context.textBaseline='middle';context.fillText(label,badgeX+6,badgeY);context.restore();
        }
        function drawDrag(context,top,bottom) {
            if (!drag) return;
            context.fillStyle=drag.endX>=drag.startX?'rgba(51,154,240,.14)':'rgba(225,29,72,.10)';
            context.fillRect(Math.min(drag.startX,drag.endX),top,Math.abs(drag.endX-drag.startX),bottom-top);
        }
        window.refreshRankTurnoverChart = async () => {
            if (drag) {refreshPending=true;return;}
            refreshPending=false;
            controller?.abort(); const current=controller=new AbortController(); status.textContent='거래대금 조회 중';
            if (mode === 'minute') {
                const today = dateKey(Date.now()), day = today.replaceAll('-',''), messages = [];
                const beforeOpen = new Date(Date.now() + 9 * 3600000).getUTCHours() < 9;
                for (const market of ['kospi','kosdaq']) {
                    if (current.signal.aborted) return;
                    try {
                        if (!minuteData[market].length) {
                            try {
                                const session = JSON.parse(localStorage.getItem(`rank-turnover-session:${market}`) || 'null');
                                if (Array.isArray(session?.points)) minuteData[market] = session.points.filter(p => Number.isFinite(p.t) && dateKey(p.t) <= today && (!beforeOpen || dateKey(p.t) < today));
                                if (Number.isFinite(session?.previous)) previous[market] = session.previous;
                            } catch (_) { /* Storage is optional. */ }
                        }
                        if (!dailyData[market].some(p => dateKey(p.t) < today && Number.isFinite(p.market_turnover))) {
                            const fromDate = new Date(`${today}T00:00:00Z`);fromDate.setUTCDate(fromDate.getUTCDate()-14);
                            const response = await fetch(`/api/adr/candles?market=${market}&mode=day&from=${fromDate.toISOString().slice(0,10).replaceAll('-','')}&to=${day}`,{signal:current.signal});
                            if (!response.ok) throw new Error('전일 거래대금 조회 실패');
                            const result = await response.json();dailyData[market]=result.points || [];
                        }
                        const priorDay = dailyData[market].filter(p => dateKey(p.t) < today).map(p => dateKey(p.t)).sort().at(-1);
                        const retainedDay = minuteData[market].at(-1) ? dateKey(minuteData[market].at(-1).t) : null;
                        const fallbackDay = [priorDay, retainedDay].filter(Boolean).sort().at(-1);
                        const queryDay = beforeOpen && fallbackDay ? fallbackDay.replaceAll('-','') : day;
                        let response=await fetch(`/api/adr/candles?market=${market}&mode=minute&from=${queryDay}&to=${queryDay}`,{signal:current.signal});
                        if (!response.ok) throw new Error('분봉 조회 실패');
                        let result=await response.json();
                        let fresh=(result.points || []).filter(p=>Number.isFinite(p.t) && dateKey(p.t)<=today && (!beforeOpen || dateKey(p.t)<today));
                        if (!fresh.length && !minuteData[market].length && fallbackDay && queryDay===day) {
                            const fallback=fallbackDay.replaceAll('-','');
                            response=await fetch(`/api/adr/candles?market=${market}&mode=minute&from=${fallback}&to=${fallback}`,{signal:current.signal});
                            if (!response.ok) throw new Error('직전 거래일 분봉 조회 실패');
                            result=await response.json();fresh=(result.points || []).filter(p=>Number.isFinite(p.t)&&dateKey(p.t)===fallbackDay);
                        }
                        if (current!==controller) return;
                        const sessionDay=[...minuteData[market],...fresh].map(p=>dateKey(p.t)).sort().at(-1);
                        const merged=new Map([...minuteData[market],...fresh].filter(p=>dateKey(p.t)===sessionDay).map(p=>[p.t,p]));
                        let sum=0;
                        minuteData[market]=[...merged.values()].sort((a,b)=>a.t-b.t).map(p=>{
                            if (Number.isFinite(p.market_turnover_estimate)) sum+=p.market_turnover_estimate;
                            return {...p,market_turnover:Number.isFinite(p.market_turnover_estimate)?sum:null};
                        });
                        previous[market]=dailyData[market].filter(p=>dateKey(p.t)<sessionDay&&Number.isFinite(p.market_turnover)).at(-1)?.market_turnover ?? previous[market];
                        if (minuteData[market].length) {
                            try { localStorage.setItem(`rank-turnover-session:${market}`,JSON.stringify({points:minuteData[market],previous:previous[market]})); } catch (_) { /* Storage is optional. */ }
                        } else messages.push(`${names[market]} 당일 분봉 없음`);
                        if (previous[market]===null) messages.push(`${names[market]} 전일 기준값 없음`);
                        if (result.partial) messages.push(`${names[market]} 일부 구간`);
                    } catch(error) {
                        if(error.name==='AbortError')return;
                        messages.push(`${names[market]} 조회 실패 · 다음 갱신 때 재시도`);
                    }
                }
                if(current!==controller)return;
                data=minuteData;dates=[...new Set(Object.values(data).flat().map(p=>p.t))].sort((a,b)=>a-b);hover=null;tip.hidden=true;
                const ratios=['kospi','kosdaq'].map(m=>{
                    const amount=data[m].at(-1)?.market_turnover, base=previous[m];
                    return Number.isFinite(amount)&&Number.isFinite(base)&&base>0?`${names[m]} 전일 대비 ${(amount/base*100).toFixed(1)}%`:null;
                }).filter(Boolean);
                window.setRankCardConnection?.(panel, !messages.some(message=>/실패/.test(message)));
                status.textContent=['1분 누적 거래대금은 지수×거래량 기반 추정값',...ratios,...messages].join(' · ');draw();return;
            }
            const today=dateKey(Date.now()), fromDate=new Date(`${today}T00:00:00Z`);
            fromDate.setUTCMonth(fromDate.getUTCMonth()-({'6m':6,'1y':12,'3y':36,'5y':60}[range]));
            const from=fromDate.toISOString().slice(0,10).replaceAll('-',''), to=today.replaceAll('-','');
            const results=[];
            for (const market of ['kospi','kosdaq']) {
                if (current.signal.aborted) return;
                const latest=data[market].at(-1)?.t;
                const recent=new Date(latest || 0);
                recent.setUTCDate(recent.getUTCDate()-7);
                const marketFrom=latest ? Math.max(Number(from),Number(recent.toISOString().slice(0,10).replaceAll('-',''))) : Number(from);
                try {
                    const response=await fetch(`/api/adr/candles?market=${market}&mode=day&from=${marketFrom}&to=${to}`,{signal:current.signal});
                    const result=await response.json();
                    if(!response.ok)throw new Error(result.error || `HTTP ${response.status}`);
                    results.push({status:'fulfilled',value:result});
                } catch(error) {
                    if(error.name==='AbortError')return;
                    results.push({status:'rejected',reason:error});
                }
            }
            if(current!==controller)return;
            const messages=[];
            ['kospi','kosdaq'].forEach((m,i)=>{
                const result=results[i];
                if(result.status==='fulfilled'){
                    const fresh=Array.isArray(result.value.points)?result.value.points.filter(p=>Number.isFinite(p.t)):[];
                    data[m]=[...new Map([...data[m],...fresh].map(p=>[p.t,p])).values()].sort((a,b)=>a.t-b.t).filter(p=>dateKey(p.t).replaceAll('-','')>=from);
                    if(result.value.partial)messages.push(`${names[m]} 일부 구간`);
                    if(!data[m].some(p=>Number.isFinite(p.market_turnover)))messages.push(`${names[m]} 거래대금 데이터 없음`);
                }else messages.push(data[m].length ? `${names[m]} 갱신 실패 · 이전 데이터 표시 · 다음 갱신 때 재시도` : `${names[m]} 조회 실패 · 다음 갱신 때 재시도`);
            });
            dailyData=data;dates=[...new Set(Object.values(data).flat().map(p=>p.t))].sort((a,b)=>a-b);hover=null;tip.hidden=true;
            window.setRankCardConnection?.(panel, !messages.some(message=>/실패/.test(message)));
            status.textContent=messages.join(' · ') || (dates.length?`${dateKey(dates[0])} ~ ${dateKey(dates.at(-1))} · 당일 거래대금은 누적값`:'일별 데이터 없음');draw();
        };
        panel.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
            if(mode===button.dataset.mode)return;
            mode=button.dataset.mode;data=mode==='minute'?minuteData:dailyData;dates=[...new Set(Object.values(data).flat().map(p=>p.t))].sort((a,b)=>a-b);
            start=0;count=null;hover=null;tip.hidden=true;
            panel.querySelectorAll('[data-mode]').forEach(el=>el.classList.toggle('active',el===button));
            panel.querySelector('.rank-adr-ranges').hidden=mode==='minute';
            canvas.setAttribute('aria-label',`코스피 코스닥 ${mode==='minute'?'당일 1분 누적 추정':'일별'} 거래대금 차트`);
            candle.setAttribute('aria-label',`${names[selectedMarket]} 지수 ${mode==='minute'?'1분봉':'일봉'} 캔들차트`);
            window.refreshRankTurnoverChart();
        }));
        panel.querySelector('.rank-market-choice').addEventListener('change',event=>{selectedMarket=event.target.value;tip.hidden=true;hover=null;candle.setAttribute('aria-label',`${names[selectedMarket]} 지수 ${mode==='minute'?'1분봉':'일봉'} 캔들차트`);draw();});
        panel.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>{range=b.dataset.range;start=0;count=null;data={kospi:[],kosdaq:[]};dates=[];panel.querySelectorAll('[data-range]').forEach(el=>el.classList.toggle('active',el===b));draw();window.refreshRankTurnoverChart();}));
        const candleButton = panel.querySelector('.concentration-candle-toggle');
        window.getRankTurnoverCandleOpen = () => !candleArea.hidden;
        window.applyRankTurnoverCandleOpen = open => {
            if (candleArea.hidden === (open !== true)) return;
            candleArea.hidden = open !== true;
            candleButton.setAttribute('aria-expanded', String(!candleArea.hidden));
            resize();
        };
        candleButton.addEventListener('click', () => {
            window.applyRankTurnoverCandleOpen(candleArea.hidden);
            if (typeof saveAppData === 'function') saveAppData();
        });
        function zoom(factor,anchor=.5){if(!dates.length)return;const n=Math.min(dates.length,count??dates.length);count=Math.min(dates.length,Math.max(Math.min(10,dates.length),Math.round(n*factor)));start=Math.max(0,Math.min(dates.length-count,Math.round(start+anchor*(n-count))));hover=null;tip.hidden=true;draw();}
        into.addEventListener('click',()=>zoom(.5));out.addEventListener('click',()=>zoom(2));slider.addEventListener('input',()=>{start=Number(slider.value);draw();});
        [canvas,candle].forEach(c=>{
            c.addEventListener('wheel',event=>{if(!geometry?.visible.length||drag||!event.deltaY)return;const px=event.clientX-c.getBoundingClientRect().left;if(px<geometry.left||px>geometry.right)return;event.preventDefault();zoom(event.deltaY<0?.8:1.25,(px-geometry.left)/(geometry.right-geometry.left));},{passive:false});
            const offset=event=>Math.max(geometry.left,Math.min(geometry.right,event.clientX-c.getBoundingClientRect().left));
            c.addEventListener('pointerdown',event=>{
                if(event.button!==0 || drag || !geometry?.visible.length)return;
                const rect=c.getBoundingClientRect(), px=event.clientX-rect.left, py=event.clientY-rect.top;
                const top=c===canvas?geometry.top:16, bottom=c===canvas?geometry.bottom:c.clientHeight-28;
                if(px<geometry.left||px>geometry.right||py<top||py>bottom)return;
                drag={surface:c,id:event.pointerId,startX:offset(event),endX:offset(event),start,count:geometry.visible.length};
                hover=null;tip.hidden=true;c.setPointerCapture(event.pointerId);draw();
            });
            c.addEventListener('pointermove',event=>{if(drag?.surface===c&&drag.id===event.pointerId){drag.endX=offset(event);draw();}});
            c.addEventListener('pointerup',event=>{
                if(drag?.surface!==c||drag.id!==event.pointerId)return;
                const previous=drag;previous.endX=offset(event);drag=null;
                if(c.hasPointerCapture(event.pointerId))c.releasePointerCapture(event.pointerId);
                if(Math.abs(previous.endX-previous.startX)>10){
                    if(previous.endX>previous.startX){
                        const first=Math.floor((previous.startX-geometry.left)/(geometry.right-geometry.left)*(previous.count-1));
                        const last=Math.ceil((previous.endX-geometry.left)/(geometry.right-geometry.left)*(previous.count-1));
                        count=Math.min(dates.length,Math.max(Math.min(10,dates.length),last-first+1));start=Math.min(dates.length-count,previous.start+first);
                    }else{start=0;count=null;}
                }
                draw();if(refreshPending)window.refreshRankTurnoverChart();
            });
            const cancel=()=>{if(drag?.surface===c){drag=null;draw();if(refreshPending)window.refreshRankTurnoverChart();}};
            c.addEventListener('pointercancel',cancel);c.addEventListener('lostpointercapture',cancel);
        });
        [canvas,candle].forEach(c=>{
            c.addEventListener('mousemove',event=>{if(drag || !geometry?.visible.length)return;candlePointerY=c===candle?event.clientY-candle.getBoundingClientRect().top:null;const px=event.clientX-c.getBoundingClientRect().left;if(px<geometry.left||px>geometry.right)return;hover=geometry.visible.reduce((a,b)=>Math.abs(geometry.x(a)-px)<Math.abs(geometry.x(b)-px)?a:b);tip.replaceChildren(document.createTextNode(dateKey(hover)+(mode==='minute'?' '+new Date(hover+9*3600000).toISOString().slice(11,16):'')));
        ['kospi','kosdaq'].forEach(m=>{
            const p=data[m].find(p=>p.t===hover), amount=p?.market_turnover;
            const label=document.createElement('span');label.textContent=names[m];label.style.color=colors[m];
            const ratio=mode==='minute'&&Number.isFinite(previous[m])&&previous[m]>0 ? `(전일대비 ${(amount/previous[m]*100).toFixed(1)}%)` : '';
            tip.append(' · ',label,Number.isFinite(amount)?` ${(amount/1e12).toFixed(2)}조원${ratio}`:' —');
        });tip.hidden=false;draw();});c.addEventListener('mouseleave',()=>{hover=null;candlePointerY=null;tip.hidden=true;draw();});});
        function resize(){const base=Number.parseFloat(adr.style.getPropertyValue('--rank-adr-base-height')) || 450;panel.style.height=`${base+(candleArea.hidden?0:280)}px`;draw();}
        new ResizeObserver(resize).observe(adr);new ResizeObserver(draw).observe(canvas.parentElement);resize();window.refreshRankTurnoverChart();
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
