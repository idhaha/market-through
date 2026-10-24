(() => {
    'use strict';
    function initialize() {
        const adr = document.getElementById('rankAdrChartPanel');
        if (!adr || document.getElementById('rankTurnoverChartPanel')) return;
        const panel = document.createElement('section');
        panel.id = 'rankTurnoverChartPanel'; panel.className = 'panel rank-adr-panel rank-turnover-panel';
        panel.innerHTML = `<div class="concentration-chart-header"><h2>거래대금</h2><div class="rank-market-choice" role="radiogroup" aria-label="거래대금 시장 선택"><label><input type="radio" name="rank-turnover-market" value="kospi" checked>KOSPI</label><label><input type="radio" name="rank-turnover-market" value="kosdaq">KOSDAQ</label></div><div class="turnover-legend"><span data-market="kospi"><span>● KOSPI</span><output data-latest="kospi">—</output></span><span data-market="kosdaq"><span>● KOSDAQ</span><output data-latest="kosdaq">—</output></span></div></div><div class="rank-adr-controls"><button type="button" data-mode="day" class="active">일</button><button type="button" data-mode="minute">1분봉</button><button type="button" data-more class="concentration-icon-button" aria-label="거래대금 과거 추가조회" title="과거 데이터 더 불러오기" disabled>▥+</button><button type="button" class="concentration-candle-toggle" aria-expanded="false">캔들차트</button></div><div class="turnover-hover-info" aria-live="off"></div><div class="rank-adr-area"><canvas role="img" aria-label="코스피 코스닥 거래대금 차트"></canvas><div class="concentration-tooltip" hidden></div></div><div class="rank-adr-candle-area" hidden><canvas role="img" aria-label="선택 시장 지수 캔들차트"></canvas></div><div class="concentration-chart-footer rank-adr-zoom"><input type="range" min="0" max="0" value="0" aria-label="거래대금 과거 구간 이동" disabled><div class="concentration-controls"><button type="button" aria-label="거래대금 차트 축소">−</button><button type="button" aria-label="거래대금 차트 확대">+</button></div></div><p role="status" class="rank-adr-status"></p>`;
        adr.after(panel);
        panel.querySelector('.rank-adr-controls').append(panel.querySelector('.turnover-legend'));
        const latestDate = document.createElement('span');
        latestDate.className = 'turnover-latest-date'; latestDate.textContent = '—';
        panel.querySelector('.turnover-legend').prepend(latestDate);
        let selectedMarket = 'kospi';
        const canvas = panel.querySelector('.rank-adr-area canvas'), ctx = canvas.getContext('2d');
        const candleArea = panel.querySelector('.rank-adr-candle-area'), candle = candleArea.querySelector('canvas'), cc = candle.getContext('2d');
        const tip = panel.querySelector('.turnover-hover-info'), status = panel.querySelector('[role="status"]'), slider = panel.querySelector('input[type="range"]');
        const [out, into] = panel.querySelectorAll('.concentration-controls button');
        const colors = {kospi:'#339af0',kosdaq:'#e11d48'}, names = {kospi:'KOSPI',kosdaq:'KOSDAQ'};
        let data = {kospi:[],kosdaq:[]}, previous = {kospi:null,kosdaq:null};
        let mode = 'day', dates = [], start = 0, count = null, controller, hover = null, geometry, drag = null, refreshPending = false;
        let candlePointerY = null;
        const dateKey = t => new Date(t + 9 * 3600000).toISOString().slice(0,10);
        function surface(c, context) {
            const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
            c.width = Math.round(w*dpr); c.height = Math.round(h*dpr); context.setTransform(dpr,0,0,dpr,0,0); context.clearRect(0,0,w,h);
            context.font = '12px Inter, sans-serif'; return {w,h};
        }
        window.RankChartAxis.registerHover('turnover',()=>mode,()=>hover,key=>{
            hover=geometry?.visible.find(t=>window.RankChartAxis.matchesHover(t,key,mode)) ?? null;
            candlePointerY=null;tip.hidden=true;draw();
        });
        function draw() {
            window.RankChartAxis.candleLabel(candleArea,selectedMarket==='kosdaq'?'KOSDAQ':'KOSPI');
            {const view=window.RankChartAxis.sharedRange('turnover',dates,t=>t,mode,start,count,draw);start=view.start;count=view.count;}
            const n = Math.min(dates.length,count ?? dates.length); start = Math.max(0,Math.min(start,dates.length-n));
            const visible = dates.slice(start,start+n), indices = new Map(visible.map((t,i) => [t,i]));
            slider.max = String(dates.length-n); slider.value = String(start); slider.disabled = n >= dates.length;
            window.RankChartAxis.updateSlider('turnover',slider);
            into.disabled = n <= 10; out.disabled = n >= dates.length;
            const {w,h} = surface(canvas,ctx), left = 16, top = 10, bottom = h-34;
            const rows = Object.fromEntries(Object.keys(data).map(m => [m,data[m].filter(p => indices.has(p.t))]));
            const selected = rows[selectedMarket].filter(window.RankChartAxis.validCandle);
            const highestCandle = selected.reduce((highest, point) => Math.max(highest, Number(point.high) || 0), 0);
            const candleAxisWidth = candleArea.hidden || !selected.length ? 0 : ctx.measureText(Math.round(highestCandle).toLocaleString('ko-KR')).width;
            const right = w - Math.max(58, candleAxisWidth + 18);
            if (right <= left || bottom <= top) return;
            const sessionX=window.RankChartAxis.sessionX(visible,t=>t,left,right,mode==='minute',mode==='day');
            const x = t => sessionX?sessionX(t):left + indices.get(t)/Math.max(1,n-1)*(right-left);
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
            const ticks = window.RankChartAxis.eightTick(ctx,window.RankChartAxis.ticks(ctx, visible, t=>t, x, left, right, mode),left,right,mode==='minute',window.RankChartAxis.sessionStartLabel(visible,t=>t));
            function axis(context,height) { context.font='12px Inter, sans-serif'; context.fillStyle=muted; context.textAlign='center'; ticks.forEach(({label,labelX})=>context.fillText(label,labelX,height-8)); }
            const boundaryXs = [];
            visible.forEach((t,i) => {
                const length = mode === 'minute' ? 10 : 7;
                if (i && dateKey(t).slice(0,length) !== dateKey(visible[i-1]).slice(0,length)
                    && (!boundaryXs.length || x(t) - boundaryXs.at(-1) >= 32)) boundaryXs.push(x(t));
            });
            function boundaries(context, upper, lower) {
                context.save(); context.strokeStyle='#b8c1cc'; context.lineWidth=1; context.setLineDash([3,5]);
                boundaryXs.forEach(px => {context.beginPath();context.moveTo(px,upper);context.lineTo(px,lower);context.stroke();});context.restore();
            }
            boundaries(ctx,top,bottom);
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
            const latestDates = ['kospi','kosdaq'].map(m => {
                const point = data[m].filter(p => Number.isFinite(p.market_turnover)).at(-1);
                return point ? dateKey(point.t) : null;
            });
            const availableDates = [...new Set(latestDates.filter(Boolean))];
            latestDate.textContent = availableDates.length <= 1 ? availableDates[0] || '—'
                : latestDates.map((date, i) => `${names[['kospi','kosdaq'][i]]} ${date || '—'}`).join(' · ');
            if (candleArea.hidden) return;
            const size=surface(candle,cc); axis(cc,size.h);
            if (!selected.length) return;
            const layout=window.RankChartAxis.candleLayout(selected,p=>p.low,p=>p.high,p=>x(p.t),size.h,left,right);
            const lo=layout.minimum,hi=layout.maximum,cy=layout.y,cw=layout.width;
            cc.textAlign='left';
            for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4;cc.fillStyle=muted;cc.textAlign='right';cc.fillText(Math.round(v).toLocaleString('ko-KR'),size.w-4,cy(v)+4);cc.strokeStyle=border;cc.setLineDash([3,5]);cc.beginPath();cc.moveTo(left,cy(v));cc.lineTo(right,cy(v));cc.stroke();}
            cc.setLineDash([]);
            boundaries(cc,layout.top,layout.bottom);
            cc.lineWidth=1;
            selected.forEach(p=>{cc.fillStyle=cc.strokeStyle=p.close>=p.open?'#e11d48':'#2563eb';cc.beginPath();cc.moveTo(x(p.t),cy(p.high));cc.lineTo(x(p.t),cy(p.low));cc.stroke();cc.fillRect(x(p.t)-cw/2,Math.min(cy(p.open),cy(p.close)),cw,Math.max(1,Math.abs(cy(p.open)-cy(p.close))));});
            if(hover&&indices.has(hover)){cc.strokeStyle='#000';cc.setLineDash([3,3]);cc.beginPath();cc.moveTo(x(hover),layout.top);cc.lineTo(x(hover),layout.bottom);cc.stroke();cc.setLineDash([]);}
            const hovered=selected.find(p=>p.t===hover);
            const price=hovered?.close;
            if(hover&&Number.isFinite(price))drawHoverValue(cc,{left,right,top:layout.top,bottom:layout.bottom,y:cy},price,price.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}),'#000');
            drawDrag(cc,layout.top,layout.bottom);
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
        const moreButton = panel.querySelector('[data-more]');
        const icon = document.querySelector('#concentrationMore svg');
        if (icon) moreButton.replaceChildren(icon.cloneNode(true));
        let cursor = null, loading = false;
        const loadedPages = new Map();
        let todayOnly = true;
        window.RankChartAxis.todayButton(panel,'[data-mode="minute"]',()=>mode,()=>{todayOnly=true;draw();void load();});
        async function load(more = false) {
            if(window.rankManagedChartRefresh && !window.rankChartRefreshStarted)return;
            if (loading || more && !cursor) return;
            if (drag) { refreshPending = true; return; }
            if(more){window.RankChartAxis.showHistory();todayOnly=false;}
            refreshPending = false; loading = true; moreButton.disabled = true;
            const current = controller = new AbortController();
            const anchor = dates[start], followLatest = start + (count ?? dates.length) >= dates.length;
            status.textContent = '거래대금 조회 중';
            try {
                const keys = more ? [cursor] : [...new Set(['', ...loadedPages.keys()])];
                for (const key of keys) {
                    const response = await fetch(`/api/turnover/chart?mode=${mode}&cursor=${encodeURIComponent(key || '')}`, {signal:current.signal});
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.error || '거래대금 조회 실패');
                    if (current !== controller) return;
                    const old = loadedPages.get(key || '');
                    if (old) for (const market of ['kospi','kosdaq']) result.markets[market] = [...new Map([...(old.markets[market] || []), ...(result.markets[market] || [])].map(p=>[p.t,p])).values()];
                    loadedPages.set(key || '', result);
                }
                const pages = [...loadedPages.values()];
                for (const market of ['kospi','kosdaq']) {
                    data[market] = [...new Map(pages.flatMap(p => p.markets[market] || []).map(p => [p.t,p])).values()].sort((a,b)=>a.t-b.t);
                }
                dates = [...new Set(Object.values(data).flat().map(p=>p.t))].sort((a,b)=>a-b);
                cursor = pages.at(-1)?.cursor || null;
                if (more) { start = 0; count = null; }
                else if (count != null) start = followLatest ? Math.max(0,dates.length-count) : Math.max(0,dates.findIndex(t=>t>=anchor));
                hover = null; tip.hidden = true;
                const warnings = pages.flatMap(p=>p.warnings || []);
                status.textContent = [dates.length ? `${dateKey(dates[0])} ~ ${dateKey(dates.at(-1))}` : '데이터 없음', mode === 'minute' ? '1분 누적 거래대금은 지수×거래량 기반 추정값' : '당일 거래대금은 누적값', ...warnings].join(' · ');
                window.setRankCardConnection?.(panel, !warnings.length);
            } catch(error) {
                if (error.name !== 'AbortError') { status.textContent = `${error.message}${dates.length ? ' · 이전 데이터 표시' : ''} · 다음 갱신 때 재시도`; window.setRankCardConnection?.(panel,false); }
            } finally {
                loading = false; moreButton.disabled = !cursor; draw();
                if (refreshPending) { refreshPending = false; void load(); }
            }
        }
        window.refreshRankTurnoverChart = () => load();
        window.RankChartAxis.registerHistoryLoader('turnover',()=>load(true),()=>loading,()=>({hasMore:!!cursor,cursor}));
        moreButton.addEventListener('click',()=>window.RankChartAxis.requestHistory(mode));
        panel.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
            if(loading || mode===button.dataset.mode)return;
            mode=button.dataset.mode;todayOnly=true; data={kospi:[],kosdaq:[]}; dates=[]; loadedPages.clear(); cursor=null;
            start=0;count=null;hover=null;tip.hidden=true;
            panel.querySelectorAll('[data-mode]').forEach(el=>el.classList.toggle('active',el===button));
            canvas.setAttribute('aria-label',`코스피 코스닥 ${mode==='minute'?'당일 1분 누적 추정':'일별'} 거래대금 차트`);
            candle.setAttribute('aria-label',`${names[selectedMarket]} 지수 ${mode==='minute'?'1분봉':'일봉'} 캔들차트`);
            window.refreshRankTurnoverChart();
        }));
        panel.querySelector('.rank-market-choice').addEventListener('change',event=>{selectedMarket=event.target.value;tip.hidden=true;hover=null;candle.setAttribute('aria-label',`${names[selectedMarket]} 지수 ${mode==='minute'?'1분봉':'일봉'} 캔들차트`);draw();});
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
            if (!window.rankCandleSyncing && typeof saveAppData === 'function') saveAppData();
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
                    if(previous.endX<previous.startX){start=0;count=null;}
                    window.RankChartAxis.selectViewport('turnover',(previous.startX-geometry.left)/(geometry.right-geometry.left),(previous.endX-geometry.left)/(geometry.right-geometry.left));
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
        new ResizeObserver(resize).observe(adr);new ResizeObserver(draw).observe(canvas.parentElement);resize();if(!window.rankManagedChartRefresh)window.refreshRankTurnoverChart();
    }
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})();
