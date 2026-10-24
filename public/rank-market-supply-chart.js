(() => {
    'use strict';
    const series = ['program', 'foreign', 'institution', 'individual'];
    const names = { individual: '개인', foreign: '외국인', institution: '기관', program: '프로그램' };
    const colors = { individual: '#339af0', foreign: '#e11d48', institution: '#16a34a', program: '#8b5cf6' };
    const dayKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
    const clock = t => new Date(t + 9 * 3600000).toISOString().slice(11, 16);
    const format = (n, signed = true) => Number.isFinite(n) ? `${signed && n > 0 ? '+' : ''}${n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}` : '미제공';
    function mergeFlow(previous, incoming) {
        const points = new Map(previous.map(point => [point.t, point]));
        for (const point of incoming) {
            const old = points.get(point.t), merged = { ...old, ...point };
            for (const field of series) if (!Number.isFinite(point[field]) && Number.isFinite(old?.[field])) merged[field] = old[field];
            points.set(point.t, merged);
        }
        return [...points.values()].sort((a,b) => a.t - b.t);
    }
    const displayFlow = source => source;
    async function request(url, options) {
        const response = await fetch(url, options), data = await response.json();
        if (!response.ok || !data.success) throw Object.assign(new Error(data.error || '수급 조회 실패'), { status: response.status });
        return data;
    }
    function initialize() {
        if (window.rankIndependentClient) return;
        const breadth = document.getElementById('rankBreadthChartPanel'), row = window.rankIndependentClient ? document.getElementById('tab_rank') : breadth?.closest('.rank-chart-row');
        if (!row || document.getElementById('rankMarketSupplyChartPanel')) return;
        const panel = document.createElement('section');
        panel.id = 'rankMarketSupplyChartPanel'; panel.className = 'panel rank-adr-panel rank-supply-panel rank-market-supply-panel';
        panel.setAttribute('aria-label', '시장 수급 차트');
        panel.innerHTML = `<div class="concentration-chart-header"><h2>시장 수급</h2></div>
            <div class="rank-adr-controls"><select class="supply-stock-select" aria-label="시장 수급 시장 선택"></select><button type="button" data-mode="day" class="active" aria-pressed="true">일봉</button><button type="button" data-mode="minute" aria-pressed="false">1분봉(누적)</button>
            <button type="button" class="concentration-candle-toggle" aria-expanded="false">캔들차트</button></div>
            <div class="supply-legend">${series.map(s => `<button type="button" data-series="${s}" aria-label="${names[s]} 표시" title="${names[s]} 표시 전환" aria-pressed="true" style="color:${colors[s]}"><span>${Array.from(names[s])[0]}</span><output>—</output></button>`).join('')}</div>
            <div class="chart-hover-info" hidden></div><div class="rank-adr-area"><canvas role="img" aria-label="개인 외국인 기관 프로그램 순매수대금 차트"></canvas></div>
            <div class="rank-adr-candle-area" hidden><span class="market-candle-label"></span><canvas role="img" aria-label="선택 시장 지수 캔들차트"></canvas></div>
            <div class="concentration-chart-footer rank-adr-zoom"><input type="range" min="0" max="0" value="0" aria-label="수급 과거 구간 이동" disabled><div class="concentration-controls"><button type="button" aria-label="시장 수급 차트 축소">−</button><button type="button" aria-label="시장 수급 차트 확대">+</button></div></div>
            <button type="button" data-action="more" class="concentration-icon-button" title="과거 데이터 더 불러오기" aria-label="과거 데이터 더 불러오기"><svg width="28" height="28" viewBox="0 0 34 34" shape-rendering="crispEdges" aria-hidden="true"><rect x="1" y="1" width="32" height="32" fill="#ededed"/><path d="M10 5v20" stroke="#737373" stroke-width="2"/><rect x="6" y="9" width="9" height="12" fill="#505050"/><path d="M22 5v20" stroke="#c0c0c0" stroke-width="2"/><rect x="18" y="9" width="9" height="12" fill="#969696"/><path d="M25 21v10M21 26h10" stroke="#444444" stroke-width="4"/></svg></button><p class="rank-adr-status" role="status"></p>`;
        breadth.before(panel);
        panel.querySelector('.rank-adr-controls').append(panel.querySelector('.supply-legend'));
        const latestDate = document.createElement('span'); latestDate.className = 'supply-latest-date'; latestDate.textContent = '—';
        panel.querySelector('.supply-legend').prepend(latestDate);
        panel.querySelector('[data-mode="minute"]').after(panel.querySelector('[data-action="more"]'));
        const canvas = panel.querySelector('.rank-adr-area canvas'), ctx = canvas.getContext('2d');
        const candleArea = panel.querySelector('.rank-adr-candle-area'), candle = candleArea.querySelector('canvas'), cc = candle.getContext('2d');
        const info = panel.querySelector('.chart-hover-info'), status = panel.querySelector('[role="status"]');
        const slider = panel.querySelector('input[type="range"]');
        const more = panel.querySelector('[data-action="more"]');
        const stockSelect = panel.querySelector('.supply-stock-select');
        stockSelect.addEventListener('change', () => { if (stockSelect.value) choose(stockSelect.value); });
        let selected = 'kospi', mode = 'day', cursor = null, hasMore = false, loading = false, historyLoaded = false;
        const minuteDays = new Set();
        let priceCursor = null, candleLoading = false;
        let points = [], candles = [], start = 0, count = null, hover = null, drag = null, geometry;
        let controller, candleController, revision = 0, candleRevision = 0, refreshing = false, refreshPending = false;
        let showCandles = false, candleMessage = '', chartMessage = '', configError = '';
        const visibleSeries = new Set(series);
        const selectionStorage=window.rankIndependentClient?sessionStorage:localStorage;
        try { selected = selectionStorage.getItem('rankMarketSupplySelectedV1') || 'kospi'; if (!['kospi','kosdaq','futures','futuresKosdaq'].includes(selected)) selected='kospi'; } catch {}
        function remember() { try { selectionStorage.setItem('rankMarketSupplySelectedV1', selected); } catch {} }
        function setStatus() { status.textContent = [configError, chartMessage, candleMessage].filter(Boolean).join(' · '); status.title = status.textContent; }
        const settings = () => ({ selected, mode, visibleSeries: [...visibleSeries] });
        window.getRankMarketSupplyDisplaySettings = settings;
        window.applyRankMarketSupplyDisplaySettings = value => {
            if (!value) return;
            if (['kospi','kosdaq','futures','futuresKosdaq'].includes(value.selected)) selected=value.selected;
            if (['day','minute'].includes(value.mode)) mode=value.mode;
            if (Array.isArray(value.visibleSeries) && value.visibleSeries.some(s=>series.includes(s))) { visibleSeries.clear();value.visibleSeries.filter(s=>series.includes(s)).forEach(s=>visibleSeries.add(s)); }
            panel.querySelectorAll('[data-series]').forEach(b=>b.setAttribute('aria-pressed',String(visibleSeries.has(b.dataset.series))));
            panel.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
            paintStocks();remember();clearView();void load();
        };
        function publish() { document.dispatchEvent(new CustomEvent('rank-market-supply-state', { detail: settings() })); }
        panel.addEventListener('change',()=>{if(typeof saveAppData==='function')saveAppData();});
        panel.addEventListener('click',event=>{if(event.target.closest('[data-mode],[data-series]') && typeof saveAppData==='function')queueMicrotask(()=>saveAppData());});
        panel.addEventListener('click', event => { if (event.target.closest('[data-mode], [data-series], .concentration-candle-toggle')) queueMicrotask(publish); });
        stockSelect.addEventListener('change', () => queueMicrotask(publish));
        function clearView() {
            todayOnly=true;
            points = []; candles = []; start = 0; count = null; hover = null; info.hidden = true;
            cursor = null; hasMore = false; historyLoaded = false;
            minuteDays.clear();
            priceCursor = null;
            candleMessage = ''; chartMessage = ''; draw();
        }
        function surface(c, context) {
            const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
            c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, w, h);
            context.font = '12px Inter, sans-serif'; return { w, h };
        }
        function draw() {
            const { w, h } = surface(canvas, ctx);
            {const view=window.RankChartAxis.sharedRange('marketSupply',points,p=>p.t,mode,start,count,draw);start=view.start;count=view.count;}
            const n = Math.min(points.length, count ?? points.length);
            start = Math.max(0, Math.min(start, points.length - n));
            const rows = displayFlow(points, mode).slice(start, start + n), indices = new Map(rows.map((p, i) => [p.t, i]));
            const left = 12, right = w - 82, top = 10, bottom = h - 34;
            const sessionX=window.RankChartAxis.sessionX(rows,p=>p.t,left,right,mode==='minute',mode==='day');
            const x = t => sessionX?sessionX(t):left + indices.get(t) / Math.max(1, n - 1) * (right - left);
            slider.max = String(points.length - n); slider.value = String(start); slider.disabled = n >= points.length;
            window.RankChartAxis.updateSlider('marketSupply',slider);
            panel.querySelector('[aria-label="시장 수급 차트 확대"]').disabled = n <= 10;
            panel.querySelector('[aria-label="시장 수급 차트 축소"]').disabled = n >= points.length;
            more.hidden = false; more.disabled = !selected || !(hasMore || mode === 'minute' && priceCursor) || loading || mode === 'minute' && candleLoading;
            const values = rows.flatMap(p => [...visibleSeries].map(s => p[s])).filter(Number.isFinite);
            let min = 0, max = 0; for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
            const span = Math.max(1, max - min), padding = span * .08; min -= padding; max += padding;
            const y = v => bottom - (v - min) / (max - min) * (bottom - top);
            geometry = { rows, left, right, top, bottom, x, y };
            if (w <= 100 || h <= 50) return;
            const muted = getComputedStyle(panel).getPropertyValue('--text-muted').trim() || '#64748b';
            function grid(context, width, low, high, toY, unit = true) {
                for (let i = 0; i < 5; i++) {
                    const value = low + (high - low) * i / 4, py = toY(value);
                    context.strokeStyle = '#b8c1cc'; context.setLineDash([3, 5]); context.lineWidth = 1;
                    context.beginPath(); context.moveTo(left, py); context.lineTo(right, py); context.stroke();
                    context.fillStyle = muted; context.textAlign = 'right';
                    context.fillText(unit ? format(Math.round(value), false) : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }), width - 4, py + 4);
                }
                context.setLineDash([]);
            }
            const boundaryXs = [];
            rows.forEach((point,i) => {
                const length = mode === 'minute' ? 10 : 7;
                if (i && dayKey(point.t).slice(0,length) !== dayKey(rows[i-1].t).slice(0,length)
                    && (!boundaryXs.length || x(point.t) - boundaryXs.at(-1) >= 32)) boundaryXs.push(x(point.t));
            });
            function boundaries(context, upper, lower) {
                context.save(); context.strokeStyle = '#b8c1cc'; context.lineWidth = 1; context.setLineDash([3,5]);
                boundaryXs.forEach(px => { context.beginPath(); context.moveTo(px,upper); context.lineTo(px,lower); context.stroke(); }); context.restore();
            }
            const lanes = new Map();
            if (mode === 'day') {
                const laneHeight=(bottom-top)/4;
                series.forEach((field,i)=>{
                    const zero=top+laneHeight*(i+.5);
                    const values=rows.map(p=>p[field]).filter(Number.isFinite);
                    const extent=Math.max(1,...values.map(Math.abs));
                    lanes.set(field,{zero,y:value=>zero-value/extent*(laneHeight/2-9)});
                    ctx.strokeStyle='#b8c1cc';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,zero);ctx.lineTo(right,zero);ctx.stroke();
                    ctx.fillStyle=colors[field];ctx.textAlign='right';ctx.save();ctx.textBaseline='middle';ctx.fillText(names[field],w-4,zero);ctx.restore();
                });
            } else grid(ctx, w, min, max, y);
            boundaries(ctx,top,bottom);
            if (mode !== 'day' && values.length) {
                ctx.strokeStyle = '#94a3b8'; ctx.beginPath(); ctx.moveTo(left, y(0)); ctx.lineTo(right, y(0)); ctx.stroke();
            }
            const ticks = window.RankChartAxis.eightTick(ctx,window.RankChartAxis.ticks(ctx, rows, p=>p.t, p=>x(p.t), left, right, mode),left,right,mode==='minute',window.RankChartAxis.sessionStartLabel(rows,p=>p.t));
            function timeAxis(context, height) {
                context.fillStyle = muted; context.textAlign = 'center';
                ticks.forEach(({label,labelX})=>context.fillText(label,labelX,height-8));
            }
            timeAxis(ctx, h);
            const latestDates = [...new Set(series.map(s => points.findLast(point => Number.isFinite(point[s])))
                .filter(Boolean).map(point => dayKey(point.t)))].sort();
            latestDate.textContent = latestDates.length > 1 ? `${latestDates[0]} ~ ${latestDates.at(-1)}` : latestDates[0] || '—';
            series.forEach(s => {
                const button = panel.querySelector(`[data-series="${s}"]`), last = points.findLast(point => Number.isFinite(point[s]));
                button.querySelector('output').textContent = last ? format(last[s]) : points.length ? '미제공' : '—';
                button.querySelector('output').title = last ? `${dayKey(last.t)} ${clock(last.t)} 기준` : '관측값 없음';
                button.querySelector('output').style.color = colors[s];
                if (!visibleSeries.has(s)) return;
                if (mode === 'day') {
                    const lane=lanes.get(s), positions=rows.map(p=>x(p.t));
                    const spacing=positions.length>1?Math.min(...positions.slice(1).map((v,i)=>v-positions[i])):8;
                    const width=Math.max(1,Math.min(12,spacing*.7));
                    rows.forEach(p=>{if(!Number.isFinite(p[s]) || p[s]===0)return;const py=lane.y(p[s]);ctx.fillStyle=p[s]>0?'#e11d48':'#2563eb';ctx.fillRect(x(p.t)-width/2,Math.min(lane.zero,py),width,Math.max(1,Math.abs(py-lane.zero)));});
                    return;
                }
                ctx.strokeStyle = colors[s]; ctx.lineWidth = 2; ctx.beginPath(); let previous;
                rows.forEach(p => {
                    if (!Number.isFinite(p[s])) { previous = null; return; }
                    const gap = mode === 'minute' && previous && p.t - previous.t > 60000;
                    if (!previous || gap) ctx.moveTo(x(p.t), y(p[s])); else ctx.lineTo(x(p.t), y(p[s]));
                    previous = p;
                }); ctx.stroke();
                rows.forEach(p => {
                    if (!Number.isFinite(p[s])) return;
                    if (p.t === last?.t || p.t === hover || rows.length === 1) {
                        ctx.fillStyle = p.t === last?.t && dayKey(p.t) === dayKey(Date.now()) ? '#f97316' : colors[s];
                        ctx.beginPath(); ctx.arc(x(p.t), y(p[s]), 3, 0, Math.PI * 2); ctx.fill();
                    }
                });
            });
            function cursor(context, height) {
                if (hover == null || !indices.has(hover)) return;
                context.strokeStyle = '#000'; context.lineWidth = 1; context.setLineDash([3, 3]);
                context.beginPath(); context.moveTo(x(hover), top); context.lineTo(x(hover), height - 30); context.stroke(); context.setLineDash([]);
            }
            function valueBadge(context, value, py, color, height, label) {
                const cy = Math.max(top + 9, Math.min(height - 39, py));
                context.strokeStyle = color; context.lineWidth = 1; context.setLineDash([3, 3]);
                context.beginPath(); context.moveTo(left, py); context.lineTo(right, py); context.stroke(); context.setLineDash([]);
                const width = context.measureText(label).width + 8;
                context.fillStyle = color; context.fillRect(w - width, cy - 9, width, 18);
                context.fillStyle = '#fff'; context.textAlign = 'right'; context.fillText(label, w - 4, cy + 4);
            }
            function selection(context, height) {
                if (!drag) return;
                context.fillStyle = '#339af033'; context.fillRect(Math.min(drag.from, drag.to), top, Math.abs(drag.to - drag.from), height - 30 - top);
            }
            cursor(ctx, h); selection(ctx, h);
            if (hover != null && indices.has(hover)) {
                const point = rows.find(p => p.t === hover);
                info.replaceChildren(document.createTextNode(`${dayKey(hover)}${mode === 'minute' ? ` ${clock(hover)}` : ''}`));
                series.forEach(s => {
                    const label = document.createElement('span'); label.style.color = colors[s];
                    const carriedAt = point[`${s}_carried_from`];
                    label.textContent = ` · ${names[s]} ${format(point[s])}${Number.isFinite(carriedAt) ? ` (${clock(carriedAt)} 최종 관측값)` : ''}`; info.append(label);
                    if (mode !== 'day' && visibleSeries.has(s) && Number.isFinite(point[s])) valueBadge(ctx, point[s], y(point[s]), colors[s], h, format(point[s]));
                });
                info.hidden = false;
            }
            panel.dataset.chartMode=mode;
            panel.dataset.market=selected;
            if (!showCandles) return;
            const size = surface(candle, cc); timeAxis(cc, size.h);
            const visible = candles.filter(p => indices.has(p.t));
            if (!visible.length) return;
            const layout=window.RankChartAxis.candleLayout(visible,p=>p.low,p=>p.high,p=>x(p.t),size.h,left,right);
            const cy=layout.y,width=layout.width;
            grid(cc,size.w,layout.minimum,layout.maximum,cy,false);
            boundaries(cc,layout.top,layout.bottom);
            cc.lineWidth=1;
            visible.forEach(p => {
                cc.strokeStyle = cc.fillStyle = p.close >= p.open ? '#e11d48' : '#2563eb';
                cc.beginPath(); cc.moveTo(x(p.t), cy(p.high)); cc.lineTo(x(p.t), cy(p.low)); cc.stroke();
                cc.fillRect(x(p.t) - width / 2, Math.min(cy(p.open), cy(p.close)), width, Math.max(1, Math.abs(cy(p.open) - cy(p.close))));
            }); cursor(cc, size.h); selection(cc, size.h);
            const hovered = visible.find(p => p.t === hover);
            if (hovered) valueBadge(cc, hovered.close, cy(hovered.close), '#000', size.h, hovered.close.toLocaleString('ko-KR'));
        }
        function paintStocks() {
            if (mode === 'day' && selected.startsWith('futures')) selected = selected === 'futuresKosdaq' ? 'kosdaq' : 'kospi';
            stockSelect.replaceChildren(...(mode === 'day' ? [['kospi','KOSPI'],['kosdaq','KOSDAQ']] : [['kospi','KOSPI'],['kosdaq','KOSDAQ'],['futures','KOSPI선물'],['futuresKosdaq','KOSDAQ선물']]).map(([value,name])=>new Option(name,value)));
            stockSelect.value=selected;
            stockSelect.title=stockSelect.selectedOptions[0]?.textContent || '시장 선택';
            const future=selected.startsWith('futures');
            window.RankChartAxis.candleLabel(candleArea,(selected==='kosdaq'||selected==='futuresKosdaq'?'KOSDAQ':'KOSPI')+(future?' (현물)':''));
            candle.setAttribute('aria-label',`${selected==='kosdaq'||selected==='futuresKosdaq'?'코스닥':'코스피'} 현물지수 캔들차트`);
            const program=panel.querySelector('[data-series="program"]');
            program.disabled=selected.startsWith('futures');
            program.title=selected.startsWith('futures')?'선물 프로그램 수급 미제공':'프로그램 표시 전환';
        }
        function choose(code) {
            if (selected === code) return;
            selected = code; remember(); clearView(); paintStocks(); load();
        }
        async function loadCandles() { draw(); }
        window.RankChartAxis.registerHover('marketSupply',()=>mode,()=>hover,key=>{
            hover=geometry?.rows.find(p=>window.RankChartAxis.matchesHover(p.t,key,mode))?.t ?? null;
            info.hidden=true;draw();
        });
        let todayOnly = true;
        window.RankChartAxis.todayButton(panel,'[data-mode="minute"]',()=>mode,()=>{todayOnly=true;draw();void load();});
        async function load(append = false) {
            if(window.rankManagedChartRefresh && !window.rankChartRefreshStarted)return;
            const nextCursor = append && hasMore ? cursor : null;
            if (append && (loading || candleLoading || !nextCursor)) return;
            controller?.abort(); const current = controller = new AbortController(), id = ++revision;
            candleController?.abort(); ++candleRevision; candleLoading = false;
            if (!selected) { loading = false; clearView(); chartMessage = '시장을 선택하세요.'; setStatus(); return; }
            if(append){window.RankChartAxis.showHistory();todayOnly=false;}
            loading = true; chartMessage = append ? '과거 수급 조회 중…' : '수급 조회 중…'; setStatus(); draw();
            try {
                let firstResponse=true;
                do {
                const params = new URLSearchParams({ code: selected, mode, ...(mode === 'day' ? { progressive: '1' } : {}), ...(append ? { cursor: nextCursor } : {}) });
                const result = await request(`/api/market-supply/chart?${params}`, { signal: current.signal });
                if (id !== revision) return;
                const followLatest = start + Math.min(points.length, count ?? points.length) >= points.length, oldAnchor = points[start]?.t;
                const fresh = (result.points || []).filter(p => Number.isFinite(p.t));
                points = mergeFlow(points, fresh);
                {
                    candles = [...new Map([...candles, ...(result.candles || [])].map(p => [p.t, p])).values()].sort((a,b) => a.t - b.t);
                }
                if (append || !historyLoaded) { cursor = result.cursor; hasMore = result.has_more === true; historyLoaded = true; }
                if (append && firstResponse) { start = 0; count = null; }
                if (!append && count != null) start = followLatest ? Math.max(0, points.length - count) : Math.max(0, points.findIndex(p => p.t >= oldAnchor));
                if (mode === 'minute') {
                    for (const point of fresh) minuteDays.add(dayKey(point.t));
                    if (append && nextCursor) minuteDays.add(`${nextCursor.slice(0,4)}-${nextCursor.slice(4,6)}-${nextCursor.slice(6,8)}`);
                }
                const hasFlow = points.some(point => series.some(field => Number.isFinite(point[field])));
                const periodPoints=mode==='minute' && todayOnly?points.filter(p=>dayKey(p.t)===dayKey(Date.now())):points;
                const period = periodPoints.length ? `${dayKey(periodPoints[0].t)}${dayKey(periodPoints[0].t) === dayKey(periodPoints.at(-1).t) ? '' : ' ~ ' + dayKey(periodPoints.at(-1).t)}` : '당일 자료 없음';
                const message = mode === 'minute' ? `${period} · 1분 누적 · 미수집 구간 제외` : `일별 순매수대금 · ${points.length.toLocaleString()}봉`;
                const warnings = (result.warnings || []).filter(text => !text.startsWith('1분마다 관측한 당일 누적 순매수대금'));
                chartMessage = `${hasFlow ? message : '수급 기록 없음'}${warnings.length ? ` · ${warnings.join(' · ')}` : ''}${result.status?.error && result.date === dayKey(Date.now()) ? ` · ${result.status.error}` : ''}`;
                if(result.pending)chartMessage=hasFlow?`${chartMessage} · 추가 조회 중…`:'가격 수신 · 수급 조회 중…';
                window.setRankCardConnection?.(panel, !result.partial && !result.warnings?.some(text => /실패|오류/.test(text)));
                hover = null; info.hidden = true; setStatus(); draw();
                if (showCandles || mode === 'minute') await loadCandles();
                publish();
                firstResponse=false;
                if (!result.pending) break;
                await new Promise(resolve=>setTimeout(resolve,400));
                if (id !== revision || current.signal.aborted) return;
                } while(true);
            } catch (error) {
                if (error.name === 'AbortError' || id !== revision) return;
                chartMessage = `${error.message}${points.length ? ' · 이전 데이터 표시' : ''}`; setStatus();
                window.setRankCardConnection?.(panel, false);
            }
            finally {
                if (id === revision) {
                    loading = false; draw(); publish();
                    if (refreshPending && !refreshing && !drag) { refreshPending = false; void window.refreshRankMarketSupplyChart(); }
                }
            }
        }
        window.refreshRankMarketSupplyChart = async () => {
            if(window.rankManagedChartRefresh && !window.rankChartRefreshStarted)return;
            if (drag || refreshing || loading || candleLoading) { refreshPending = true; return; }
            refreshing = true; refreshPending = false;
            try {
                configError = '';
                paintStocks(); await load();
            } catch (error) { configError = `시장 수급 조회 실패: ${error.message}`; setStatus(); }
            finally { refreshing = false; if (refreshPending && !drag) { refreshPending = false; void window.refreshRankMarketSupplyChart(); } }
        };
        function zoom(factor, anchor = .5) {
            if (!points.length) return;
            const previous = Math.min(points.length, count ?? points.length);
            count = Math.min(points.length, Math.max(Math.min(10, points.length), Math.round(previous * factor)));
            start = Math.max(0, Math.min(points.length - count, Math.round(start + anchor * (previous - count)))); draw();
        }
        panel.querySelector('[aria-label="시장 수급 차트 확대"]').addEventListener('click', () => zoom(.5));
        panel.querySelector('[aria-label="시장 수급 차트 축소"]').addEventListener('click', () => zoom(2));
        slider.addEventListener('input', () => { start = Number(slider.value); draw(); });
        panel.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
            if (mode === button.dataset.mode) return;
            mode = button.dataset.mode; todayOnly=true;paintStocks();remember();clearView();
            panel.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
            load();
        }));
        window.RankChartAxis.registerHistoryLoader('marketSupply',()=>load(true),()=>loading || candleLoading);
        more.addEventListener('click', () => window.RankChartAxis.requestHistory(mode));
        panel.querySelectorAll('[data-series]').forEach(button => button.addEventListener('click', () => {
            const field = button.dataset.series;
            if (visibleSeries.has(field)) { if (visibleSeries.size === 1) return; visibleSeries.delete(field); } else visibleSeries.add(field);
            button.setAttribute('aria-pressed', String(visibleSeries.has(field))); draw();
        }));
        panel.querySelector('.concentration-candle-toggle').addEventListener('click', event => {
            showCandles = !showCandles; candleArea.hidden = !showCandles; event.currentTarget.setAttribute('aria-expanded', String(showCandles));
            if (showCandles) loadCandles(); else { candleMessage = ''; setStatus(); } resize();
        });
        [canvas, candle].forEach(c => {
            const offset = event => Math.max(geometry.left, Math.min(geometry.right, event.clientX - c.getBoundingClientRect().left));
            c.addEventListener('wheel', event => {
                if (!geometry?.rows.length || drag) return; event.preventDefault();
                zoom(event.deltaY < 0 ? .8 : 1.25, (offset(event) - geometry.left) / (geometry.right - geometry.left));
            }, { passive: false });
            c.addEventListener('pointerdown', event => {
                if (event.button !== 0 || !geometry?.rows.length) return;
                drag = { from: offset(event), to: offset(event), start, n: geometry.rows.length, surface: c };
                c.setPointerCapture(event.pointerId); hover = null; info.hidden = true;
            });
            c.addEventListener('pointermove', event => {
                if (!geometry?.rows.length) return;
                if (drag) { drag.to = offset(event); draw(); return; }
                const px = offset(event); hover = geometry.rows.reduce((a, b) => Math.abs(geometry.x(a.t) - px) < Math.abs(geometry.x(b.t) - px) ? a : b).t; draw();
            });
            c.addEventListener('pointerup', event => {
                if (!drag || drag.surface !== c) return;
                const previous = drag; previous.to = offset(event); drag = null;
                if (c.hasPointerCapture(event.pointerId)) c.releasePointerCapture(event.pointerId);
                if (Math.abs(previous.to - previous.from) > 10) {
                    if (previous.to < previous.from) { start = 0; count = null; }
                    const width = geometry.right - geometry.left;
                    window.RankChartAxis.selectViewport('marketSupply',
                        (previous.from - geometry.left) / width,
                        (previous.to - geometry.left) / width);
                }
                draw(); if (refreshPending) window.refreshRankMarketSupplyChart();
            });
            const cancel = () => { if (drag?.surface === c) { drag = null; draw(); if (refreshPending) window.refreshRankMarketSupplyChart(); } };
            c.addEventListener('pointercancel', cancel); c.addEventListener('lostpointercapture', cancel);
            c.addEventListener('pointerleave', () => { if (!drag) { hover = null; info.hidden = true; draw(); } });
        });
        const reference = document.getElementById('concentrationChartPanel') || breadth;
        window.applyRankMarketSupplyCandleOpen = open => {
            showCandles=open===true;candleArea.hidden=!showCandles;
            panel.querySelector('.concentration-candle-toggle').setAttribute('aria-expanded',String(showCandles));
            if(showCandles)void loadCandles();else{candleMessage='';setStatus();}
            resize();
        };
        function resize() {
            const referenceCandles = reference.querySelector('.concentration-candle-area, .rank-adr-candle-area');
            const extra = referenceCandles && !referenceCandles.hidden ? referenceCandles.getBoundingClientRect().height : 0;
            const base = reference.getBoundingClientRect().height - extra;
            if (base <= 0) return;
            const controlExtra = Math.max(0, panel.querySelector('.rank-adr-controls').getBoundingClientRect().height - 40);
            panel.style.height = `${base + controlExtra + (showCandles ? 280 : 0)}px`; draw();
        }
        new ResizeObserver(resize).observe(reference); new ResizeObserver(draw).observe(canvas.parentElement);
        new ResizeObserver(resize).observe(panel.querySelector('.rank-adr-controls'));
        document.addEventListener('visibilitychange', () => { if (!document.hidden) window.refreshRankMarketSupplyChart(); });
        document.addEventListener('rank-market-supply-restore', event=>{const value=event.detail;if(value?.selected && ['kospi','kosdaq','futures','futuresKosdaq'].includes(value.selected)){selected=value.selected;paintStocks();remember();clearView();void load();}});
        window.addEventListener('online', window.refreshRankMarketSupplyChart);
        if(!window.rankIndependentClient && typeof window.rankMainCandleOpen==='boolean')window.applyRankMarketSupplyCandleOpen(window.rankMainCandleOpen);
        paintStocks(); resize(); document.dispatchEvent(new Event('rank-market-supply-ready'));
        if (!window.rankIndependentClient && !window.rankManagedChartRefresh) window.refreshRankMarketSupplyChart();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})();
