(() => {
    'use strict';
    const series = ['individual', 'foreign', 'institution', 'program'];
    const names = { individual: '개인', foreign: '외국인', institution: '기관', program: '프로그램' };
    const colors = { individual: '#339af0', foreign: '#e11d48', institution: '#16a34a', program: '#8b5cf6' };
    const dayKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
    const clock = t => new Date(t + 9 * 3600000).toISOString().slice(11, 16);
    const afterInvestorClose = t => {
        const clock = new Date(t + 9 * 3600000);
        return clock.getUTCHours() * 60 + clock.getUTCMinutes() > 930;
    };
    const format = (n, signed = true) => {
        if (!Number.isFinite(n)) return '미제공';
        const thousands = Math.abs(n) >= 1000;
        const value = thousands ? Math.trunc(n / 1000) : n;
        return `${signed && value > 0 ? '+' : ''}${value.toLocaleString('ko-KR')}${thousands ? '천주' : '주'}`;
    };
    function mergeFlow(previous, incoming) {
        const points = new Map(previous.map(point => [point.t, point]));
        for (const point of incoming) {
            const old = points.get(point.t), merged = { ...old, ...point };
            for (const field of series) if (!Number.isFinite(point[field]) && Number.isFinite(old?.[field])) merged[field] = old[field];
            points.set(point.t, merged);
        }
        return [...points.values()].sort((a,b) => a.t - b.t);
    }
    function displayFlow(source, mode) {
        if (mode !== 'minute') return source;
        const latest = new Map();
        return source.map(point => {
            const next = { ...point };
            for (const field of ['individual', 'foreign', 'institution']) {
                if (Number.isFinite(point[field])) latest.set(field, { value: point[field], at: point.t, day: dayKey(point.t) });
                else {
                    const previous = latest.get(field);
                    if (Number.isFinite(point.program) && afterInvestorClose(point.t) && previous?.day === dayKey(point.t)) {
                        next[field] = previous.value;
                        next[`${field}_carried_from`] = previous.at;
                    }
                }
            }
            return next;
        });
    }
    async function request(url, options) {
        const response = await fetch(url, options), data = await response.json();
        if (!response.ok || !data.success) throw Object.assign(new Error(data.error || '수급 조회 실패'), { status: response.status });
        return data;
    }
    function initialize() {
        const breadth = document.getElementById('rankBreadthChartPanel'), row = window.rankIndependentClient ? document.getElementById('tab_rank') : breadth?.closest('.rank-chart-row');
        if (!row || document.getElementById('rankSupplyChartPanel')) return;
        const panel = document.createElement('section');
        panel.id = 'rankSupplyChartPanel'; panel.className = 'panel rank-adr-panel rank-supply-panel';
        panel.setAttribute('aria-label', '종목별 수급 차트');
        panel.innerHTML = `<div class="concentration-chart-header"><h2>종목 수급</h2><button type="button" data-action="add-stock" aria-haspopup="dialog" aria-expanded="false">+ 종목 추가</button></div>
            <div class="rank-adr-controls"><select class="supply-stock-select" aria-label="수급 종목 선택"></select><button type="button" data-mode="day" class="active" aria-pressed="true">일봉</button><button type="button" data-mode="minute" aria-pressed="false">1분봉(누적)</button>
            <button type="button" class="concentration-candle-toggle" aria-expanded="false">캔들차트</button></div>
            <div class="supply-legend">${series.map(s => `<button type="button" data-series="${s}" aria-label="${names[s]} 표시" title="${names[s]} 표시 전환" aria-pressed="true" style="color:${colors[s]}"><span>${Array.from(names[s])[0]}</span><output>—</output></button>`).join('')}</div>
            <div class="chart-hover-info" hidden></div><div class="rank-adr-area"><canvas role="img" aria-label="개인 외국인 기관 프로그램 순매수수량 차트"></canvas></div>
            <div class="rank-adr-candle-area" hidden><canvas role="img" aria-label="선택 종목 가격 캔들차트"></canvas></div>
            <div class="concentration-chart-footer rank-adr-zoom"><input type="range" min="0" max="0" value="0" aria-label="수급 과거 구간 이동" disabled><div class="concentration-controls"><button type="button" aria-label="수급 차트 축소">−</button><button type="button" aria-label="수급 차트 확대">+</button></div></div>
            <button type="button" data-action="more" class="concentration-icon-button" title="과거 데이터 더 불러오기" aria-label="과거 데이터 더 불러오기"><svg width="28" height="28" viewBox="0 0 34 34" shape-rendering="crispEdges" aria-hidden="true"><rect x="1" y="1" width="32" height="32" fill="#ededed"/><path d="M10 5v20" stroke="#737373" stroke-width="2"/><rect x="6" y="9" width="9" height="12" fill="#505050"/><path d="M22 5v20" stroke="#c0c0c0" stroke-width="2"/><rect x="18" y="9" width="9" height="12" fill="#969696"/><path d="M25 21v10M21 26h10" stroke="#444444" stroke-width="4"/></svg></button><p class="rank-adr-status" role="status"></p>`;
        row.append(panel);
        panel.querySelector('.rank-adr-controls').append(panel.querySelector('.supply-legend'));
        const latestDate = document.createElement('span'); latestDate.className = 'supply-latest-date'; latestDate.textContent = '—';
        panel.querySelector('.supply-legend').prepend(latestDate);
        panel.querySelector('[data-mode="minute"]').after(panel.querySelector('[data-action="more"]'));
        const canvas = panel.querySelector('.rank-adr-area canvas'), ctx = canvas.getContext('2d');
        const candleArea = panel.querySelector('.rank-adr-candle-area'), candle = candleArea.querySelector('canvas'), cc = candle.getContext('2d');
        const info = panel.querySelector('.chart-hover-info'), status = panel.querySelector('[role="status"]');
        const slider = panel.querySelector('input[type="range"]');
        const more = panel.querySelector('[data-action="more"]');
        const stockSelect = panel.querySelector('.supply-stock-select'), addButton = panel.querySelector('[data-action="add-stock"]');
        stockSelect.addEventListener('change', () => { if (stockSelect.value) choose(stockSelect.value); });
        addButton.addEventListener('click', openPicker);
        let config = { stocks: [], archive: [], revision: 0 }, selected = '', mode = 'day', cursor = null, hasMore = false, loading = false, historyLoaded = false;
        const minuteDays = new Set(), candleCache = new Map(), priceHistory = new Map();
        let priceCursor = null, candleLoading = false;
        let points = [], candles = [], start = 0, count = null, hover = null, drag = null, geometry;
        let controller, candleController, revision = 0, candleRevision = 0, refreshing = false, refreshPending = false;
        let showCandles = false, candleMessage = '', chartMessage = '', configError = '';
        const visibleSeries = new Set(series);
        const selectionStorage=window.rankIndependentClient?sessionStorage:localStorage;
        try { selected = selectionStorage.getItem('rankSupplySelectedV1') || ''; } catch {}
        function remember() { try { selectionStorage.setItem('rankSupplySelectedV1', selected); } catch {} }
        function setStatus() { status.textContent = [configError, chartMessage, candleMessage].filter(Boolean).join(' · '); status.title = status.textContent; }
        const settings = () => ({ selected, mode, showCandles, visibleSeries: [...visibleSeries] });
        function publish() { document.dispatchEvent(new CustomEvent('rank-supply-state', { detail: settings() })); }
        window.getRankSupplyState = () => ({ ...settings(), config, points, candles, cursor, hasMore, priceCursor, minuteDays: [...minuteDays], priceHistory: [...priceHistory], chartMessage, connection: window.getRankCardConnectionState?.(panel) });
        window.applyRankSupplySettings = (value, fetchData = true) => {
            if (!value || !['day', 'minute'].includes(value.mode)) return;
            const changed = selected !== value.selected || mode !== value.mode;
            if (changed) { controller?.abort(); candleController?.abort(); ++revision; ++candleRevision; loading = candleLoading = false; selected = value.selected || ''; mode = value.mode; clearView(); remember(); }
            showCandles = !window.rankIndependentClient && typeof window.rankMainCandleOpen==='boolean' ? window.rankMainCandleOpen : value.showCandles === true; candleArea.hidden = !showCandles;
            panel.querySelector('.concentration-candle-toggle').setAttribute('aria-expanded', String(showCandles));
            if (Array.isArray(value.visibleSeries)) { visibleSeries.clear(); value.visibleSeries.filter(s => series.includes(s)).forEach(s => visibleSeries.add(s)); }
            panel.querySelectorAll('[data-series]').forEach(b => b.setAttribute('aria-pressed', String(visibleSeries.has(b.dataset.series))));
            panel.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
            paintStocks(); resize(); if (changed && fetchData) void load();
        };
        window.applyRankSupplyState = value => {
            if (!value?.config || !Array.isArray(value.points)) return;
            const same = value.selected === selected && value.mode === mode;
            config = value.config; window.applyRankSupplySettings(value, false);
            points = mergeFlow(same ? points : [], value.points);
            candles = [...new Map([...(same ? candles : []), ...(value.candles || [])].map(p => [p.t, p])).values()].sort((a,b) => a.t - b.t);
            if (!historyLoaded) { cursor = value.cursor; hasMore = !!value.hasMore; priceCursor = value.priceCursor; }
            historyLoaded = true;
            for (const day of value.minuteDays || []) minuteDays.add(day);
            for (const [day, next] of value.priceHistory || []) priceHistory.set(day, next);
            chartMessage = value.chartMessage || ''; setStatus(); draw();
            if (value.connection && typeof value.connection.ok === 'boolean') window.setRankCardConnection?.(panel, value.connection.ok, value.connection.at);
        };
        panel.addEventListener('click', event => { if (event.target.closest('[data-mode], [data-series], .concentration-candle-toggle')) queueMicrotask(publish); });
        stockSelect.addEventListener('change', () => queueMicrotask(publish));
        function clearView() {
            todayOnly=true;
            points = []; candles = []; start = 0; count = null; hover = null; info.hidden = true;
            cursor = null; hasMore = false; historyLoaded = false;
            minuteDays.clear();
            priceHistory.clear(); priceCursor = null;
            candleMessage = ''; chartMessage = ''; draw();
        }
        function surface(c, context) {
            const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
            c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, w, h);
            context.font = '12px Inter, sans-serif'; return { w, h };
        }
        function draw() {
            window.RankChartAxis.candleLabel(candleArea,config.archive.find(stock=>stock.code===selected)?.name || selected);
            const { w, h } = surface(canvas, ctx);
            {const view=window.RankChartAxis.sharedRange('supply',points,p=>p.t,mode,start,count,draw);start=view.start;count=view.count;}
            const n = Math.min(points.length, count ?? points.length);
            start = Math.max(0, Math.min(start, points.length - n));
            const rows = displayFlow(points, mode).slice(start, start + n), indices = new Map(rows.map((p, i) => [p.t, i]));
            const {left,right}=window.RankChartAxis.plotBounds('supply',w,12,w-82), top = 10, bottom = h - 34;
            const sessionX=window.RankChartAxis.sessionX(rows,p=>p.t,left,right,mode==='minute',mode==='day');
            const x = t => sessionX?sessionX(t):left + indices.get(t) / Math.max(1, n - 1) * (right - left);
            slider.max = String(points.length - n); slider.value = String(start); slider.disabled = n >= points.length;
            window.RankChartAxis.updateSlider('supply',slider);
            panel.querySelector('[aria-label="수급 차트 확대"]').disabled = n <= 10;
            panel.querySelector('[aria-label="수급 차트 축소"]').disabled = n >= points.length;
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
                    context.fillText(unit ? format(Math.round(value), false) : Math.round(value).toLocaleString('ko-KR'), width - 4, py + 4);
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
                ['program','foreign','institution','individual'].forEach((field,i)=>{
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
                    if (!Number.isFinite(p[s]) || p[s] === 0) { previous = null; return; }
                    const gap = mode === 'minute' && previous && p.t - previous.t > 60000;
                    if (!previous || gap) ctx.moveTo(x(p.t), y(p[s])); else ctx.lineTo(x(p.t), y(p[s]));
                    previous = p;
                }); ctx.stroke();
                rows.forEach(p => {
                    if (!Number.isFinite(p[s]) || p[s] === 0) return;
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
                    if (mode !== 'day' && visibleSeries.has(s) && Number.isFinite(point[s]) && point[s] !== 0) valueBadge(ctx, point[s], y(point[s]), colors[s], h, format(point[s]));
                });
                info.hidden = false;
            }
            if (!showCandles) return;
            const size = surface(candle, cc); timeAxis(cc, size.h);
            const visible = candles.filter(p => indices.has(p.t) && window.RankChartAxis.validCandle(p));
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
            stockSelect.replaceChildren();
            config.stocks.forEach(stock => {
                const button = new Option(Array.from(stock.name).slice(0, 6).join(''), stock.code);
                const state = config.statuses?.[stock.code];
                button.title = `${stock.name} (${stock.code}) · ${config.collecting ? state?.error ? '수집 확인 필요' : state?.investor_ok && state?.program_ok ? '수집 중' : '수집 대기' : '수집 시간 외'}${state?.checked_at ? ` · 확인 ${clock(state.checked_at)}` : ''}${state?.error ? `\n${state.error}` : ''}`;
                if (state?.investor_at) button.title += `\n투자자 마지막 관측 ${dayKey(state.investor_at)} ${clock(state.investor_at)}`;
                if (state?.program_at) button.title += `\n프로그램 원천 시각 ${dayKey(state.program_at)} ${clock(state.program_at)}`;
                stockSelect.add(button);
            });
            const stock = config.archive.find(stock => stock.code === selected);
            if (stock && !config.stocks.some(item => item.code === selected)) {
                const option = new Option(Array.from(stock.name).slice(0,6).join('') + ' (보관)', selected); option.title = stock.name; stockSelect.add(option);
            }
            stockSelect.value = selected; stockSelect.title = stockSelect.selectedOptions[0]?.title || '';
            stockSelect.disabled = saving || !stockSelect.options.length; addButton.disabled = saving; addButton.setAttribute('aria-expanded', String(!picker.hidden));
            paintArchive();
        }
        function choose(code) {
            if (selected === code) return;
            const restoreWindow=mode==='minute'?window.RankChartAxis.minuteDomain():null;
            selected = code; remember(); clearView(); paintStocks();
            if(restoreWindow && restoreWindow.first.slice(0,10)<dayKey(Date.now()))todayOnly=false;
            void load(false,restoreWindow);
        }
        async function loadCandles() {
            candleController?.abort(); const current = candleController = new AbortController(), id = ++candleRevision;
            candleMessage = '';
            if (!selected || !showCandles && mode === 'day') { draw(); return; }
            if (mode === 'day') { draw(); return; }
            candleLoading = true; candleMessage = '캔들 조회 중…'; setStatus(); draw();
            try {
                const days = [...minuteDays].sort(); if (!days.length) days.push('');
                const merged = new Map(candles.map(point => [point.t, point])); let partial = false;
                for (const day of days) {
                    const key = `${selected}:${day || dayKey(Date.now())}`;
                    let result = candleCache.get(key);
                    if (!result || day === dayKey(Date.now()) || !day) {
                        const params = new URLSearchParams({ code: selected, mode, ...(day ? { date: day } : {}) });
                        result = await request(`/api/supply/candles?${params}`, { signal: current.signal });
                        if (id !== candleRevision) return;
                        candleCache.set(key, result); if (candleCache.size > 60) candleCache.delete(candleCache.keys().next().value);
                    }
                    partial ||= result.partial;
                    for (const point of result.points || []) merged.set(point.t, point);
                    const actualDay = result.date || (result.points?.length ? dayKey(result.points.at(-1).t) : day);
                    if (actualDay) priceHistory.set(actualDay, result.has_more ? result.cursor : null);
                }
                if (id !== candleRevision) return;
                candles = [...merged.values()].sort((a,b) => a.t - b.t);
                priceCursor = [...priceHistory.values()].filter(value => value && !priceHistory.has(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`)).sort().at(-1) || null;
                const anchor = points[start]?.t, atEnd = start + Math.min(points.length, count ?? points.length) >= points.length;
                const timeline = new Map(candles.map(point => [point.t, { t: point.t }]));
                for (const point of points) timeline.set(point.t, point);
                points = [...timeline.values()].sort((a,b) => a.t - b.t);
                if (count != null) start = atEnd ? Math.max(0, points.length - count) : Math.max(0, points.findIndex(point => point.t >= anchor));
                candleMessage = partial ? '캔들 일부 과거 구간만 제공' : candles.length ? '' : '가격 캔들 없음';
            } catch (error) { if (error.name !== 'AbortError' && id === candleRevision) candleMessage = '캔들 조회 실패'; }
            if (id === candleRevision) {
                candleLoading = false; setStatus(); draw(); publish();
                if (refreshPending && !refreshing && !loading && !drag) { refreshPending = false; void window.refreshRankSupplyChart(); }
            }
        }
        window.RankChartAxis.registerHover('supply',()=>mode,()=>hover,key=>{
            hover=geometry?.rows.find(p=>window.RankChartAxis.matchesHover(p.t,key,mode))?.t ?? null;
            info.hidden=true;draw();
        });
        let todayOnly = true;
        window.RankChartAxis.todayButton(panel,'[data-mode="minute"]',()=>mode,()=>{todayOnly=true;draw();void load();});
        async function load(append = false, restoreWindow = null) {
            if(window.rankManagedChartRefresh && !window.rankChartRefreshStarted)return;
            const nextCursor = append ? [hasMore ? cursor : null, mode === 'minute' ? priceCursor : null].filter(Boolean).sort().at(-1) : null;
            if (append && (loading || candleLoading || !nextCursor)) return;
            controller?.abort(); const current = controller = new AbortController(), id = ++revision;
            candleController?.abort(); ++candleRevision; candleLoading = false;
            if (!selected) { loading = false; clearView(); chartMessage = '+ 종목 추가에서 최대 5종목을 지정하세요.'; setStatus(); return; }
            if(append){window.RankChartAxis.showHistory();todayOnly=false;}
            loading = true; chartMessage = append ? '과거 수급 조회 중…' : '수급 조회 중…'; setStatus(); draw();
            try {
                let firstResponse=true;
                do {
                const params = new URLSearchParams({ code: selected, mode, ...(mode === 'day' ? { progressive: '1' } : {}), ...(append ? { cursor: nextCursor } : {}) });
                const result = await request(`/api/supply/chart?${params}`, { signal: current.signal });
                if (id !== revision) return;
                const followLatest = start + Math.min(points.length, count ?? points.length) >= points.length, oldAnchor = points[start]?.t;
                const fresh = (result.points || []).filter(p => Number.isFinite(p.t));
                points = mergeFlow(points, fresh);
                if (mode === 'day') {
                    candles = [...new Map([...candles, ...(result.candles || [])].map(p => [p.t, p])).values()].sort((a,b) => a.t - b.t);
                }
                if (append || !historyLoaded) { cursor = result.cursor; hasMore = result.has_more === true; historyLoaded = true; }
                if(firstResponse && restoreWindow && mode==='minute'){
                    // A symbol change must refill the existing common period, not just its latest session.
                    const days=restoreWindow.days.filter(day=>day>=restoreWindow.first.slice(0,10) && day<=restoreWindow.last.slice(0,10));
                    for(const day of days){
                        minuteDays.add(day);
                        if(day===result.date)continue;
                        const params=new URLSearchParams({code:selected,mode:'minute',date:day});
                        const past=await request(`/api/supply/chart?${params}`,{signal:current.signal});
                        if(id!==revision)return;
                        points=mergeFlow(points,(past.points || []).filter(p=>Number.isFinite(p.t)));
                    }
                    const previous=(result.available_dates || []).filter(day=>day<restoreWindow.first.slice(0,10)).sort().at(-1);
                    cursor=previous?previous.replaceAll('-',''):null;hasMore=!!previous;historyLoaded=true;
                }
                if (append && firstResponse) { start = 0; count = null; }
                if (!append && count != null) start = followLatest ? Math.max(0, points.length - count) : Math.max(0, points.findIndex(p => p.t >= oldAnchor));
                if (mode === 'minute') {
                    for (const point of fresh) minuteDays.add(dayKey(point.t));
                    if (append && nextCursor) minuteDays.add(`${nextCursor.slice(0,4)}-${nextCursor.slice(4,6)}-${nextCursor.slice(6,8)}`);
                }
                const hasFlow = points.some(point => series.some(field => Number.isFinite(point[field])));
                const periodPoints=mode==='minute' && todayOnly?points.filter(p=>dayKey(p.t)===dayKey(Date.now())):points;
                const period = periodPoints.length ? `${dayKey(periodPoints[0].t)}${dayKey(periodPoints[0].t) === dayKey(periodPoints.at(-1).t) ? '' : ' ~ ' + dayKey(periodPoints.at(-1).t)}` : '당일 자료 없음';
                const message = mode === 'minute' ? `${period} · 1분 누적 · 미수집 구간 제외` : `일별 순매수수량 · ${points.length.toLocaleString()}봉 · 단위: 주/천주`;
                const warnings = (result.warnings || []).filter(text => !text.startsWith('1분마다 관측한 당일 누적 순매수수량'));
                chartMessage = `${hasFlow ? message : '수급 기록 없음'}${warnings.length ? ` · ${warnings.join(' · ')}` : ''}${result.status?.error && result.date === dayKey(Date.now()) ? ` · ${result.status.error}` : ''}`;
                if(result.pending)chartMessage=hasFlow?`${chartMessage} · 추가 조회 중…`:'가격 수신 · 수급 조회 중…';
                window.setRankCardConnection?.(panel, !result.warnings?.some(text => /실패|오류/.test(text)));
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
                    if (refreshPending && !refreshing && !drag) { refreshPending = false; void window.refreshRankSupplyChart(); }
                }
            }
        }
        window.refreshRankSupplyChart = async () => {
            if(window.rankManagedChartRefresh && !window.rankChartRefreshStarted)return;
            if (drag || refreshing || loading || candleLoading) { refreshPending = true; return; }
            refreshing = true; refreshPending = false;
            try {
                config = await request('/api/supply/watchlist', { cache: 'no-store' }); configError = '';
                if (!config.archive.some(stock => stock.code === selected)) { selected = config.stocks[0]?.code || ''; clearView(); remember(); }
                paintStocks(); await load(false,mode==='minute'?window.RankChartAxis.minuteDomain():null);
            } catch (error) { configError = `수집 종목 조회 실패: ${error.message}`; setStatus(); }
            finally { refreshing = false; if (refreshPending && !drag) { refreshPending = false; void window.refreshRankSupplyChart(); } }
        };
        function zoom(factor, anchor = .5) {
            if (!points.length) return;
            const previous = Math.min(points.length, count ?? points.length);
            count = Math.min(points.length, Math.max(Math.min(10, points.length), Math.round(previous * factor)));
            start = Math.max(0, Math.min(points.length - count, Math.round(start + anchor * (previous - count)))); draw();
        }
        panel.querySelector('[aria-label="수급 차트 확대"]').addEventListener('click', () => zoom(.5));
        panel.querySelector('[aria-label="수급 차트 축소"]').addEventListener('click', () => zoom(2));
        slider.addEventListener('input', () => { start = Number(slider.value); draw(); });
        panel.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
            if (mode === button.dataset.mode) return;
            mode = button.dataset.mode; todayOnly=true;clearView();
            panel.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
            load();
        }));
        window.RankChartAxis.registerHistoryLoader('supply',()=>load(true),()=>loading || candleLoading,()=>({hasMore:!!selected && (hasMore || mode==='minute' && !!priceCursor),cursor:[cursor,priceCursor].join(':')}));
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
                    window.RankChartAxis.selectViewport('supply', (previous.from-geometry.left)/(geometry.right-geometry.left), (previous.to-geometry.left)/(geometry.right-geometry.left));
                }
                draw(); if (refreshPending) window.refreshRankSupplyChart();
            });
            const cancel = () => { if (drag?.surface === c) { drag = null; draw(); if (refreshPending) window.refreshRankSupplyChart(); } };
            c.addEventListener('pointercancel', cancel); c.addEventListener('lostpointercapture', cancel);
            c.addEventListener('pointerleave', () => { if (!drag) { hover = null; info.hidden = true; draw(); } });
        });
        const picker = document.createElement('dialog'); picker.className = 'supply-stock-dialog'; picker.hidden = true;
        picker.setAttribute('aria-labelledby', 'supplyPickerTitle');
        picker.innerHTML = '<h2 id="supplyPickerTitle">수급 종목 추가·삭제</h2><p>최대 5종목 · 삭제해도 저장한 기록은 유지됩니다.</p><ul class="supply-picker-stocks"></ul><form class="supply-search"><label>종목명 또는 코드 <input type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="supplyStockSuggestions" autocomplete="off" maxlength="80" required></label><button type="submit">추가</button><button type="button" data-close>닫기</button></form><div id="supplyStockSuggestions" class="supply-suggestions" role="listbox" aria-label="종목 검색 결과" hidden></div><p role="status"></p><details class="supply-archive-menu"><summary>보관 기록</summary><div></div></details>';
        document.body.append(picker);
        let searchTimer, searchRevision = 0, saving = false, searchRows = [], activeSuggestion = -1, lastSuggestionQuery = '';
        const pickerStatus = picker.querySelector('[role="status"]'), search = picker.querySelector('input');
        const suggestions = picker.querySelector('.supply-suggestions');
        function clearSuggestions() {
            searchRows = []; activeSuggestion = -1; suggestions.replaceChildren(); suggestions.hidden = true;
            search.setAttribute('aria-expanded', 'false'); search.removeAttribute('aria-activedescendant');
        }
        function highlightSuggestion(index) {
            activeSuggestion = index;
            [...suggestions.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
            const option = suggestions.children[index];
            if (option) { search.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }); }
        }
        function paintArchive() {
            picker.querySelector('.supply-picker-stocks').replaceChildren(...config.stocks.map(stock => {
                const item = document.createElement('li'), remove = document.createElement('button');
                item.append(document.createTextNode(stock.name + ' (' + stock.code + ') '));
                remove.type = 'button'; remove.textContent = '삭제'; remove.setAttribute('aria-label', stock.name + ' 수집 제외'); remove.disabled = saving;
                remove.addEventListener('click', () => saveCodes(config.stocks.filter(s => s.code !== stock.code).map(s => s.code), selected === stock.code ? config.stocks.find(s => s.code !== stock.code)?.code || '' : selected));
                item.append(remove); return item;
            }));
            const area = picker.querySelector('.supply-archive-menu div'); area.replaceChildren();
            const archived = config.archive.filter(stock => !config.stocks.some(active => active.code === stock.code));
            picker.querySelector('.supply-archive-menu').hidden = !archived.length;
            archived.forEach(stock => {
                const button = document.createElement('button'); button.type = 'button'; button.textContent = stock.name;
                button.title = stock.code + ' · 보관 기록만 조회'; button.disabled = saving;
                button.addEventListener('click', () => { closePicker(); choose(stock.code); }); area.append(button);
            });
            picker.querySelector('button[type="submit"]').disabled = saving || config.stocks.length >= 5;
        }
        function closePicker() {
            if (saving) return;
            picker.close(); picker.hidden = true; ++searchRevision; clearTimeout(searchTimer); paintStocks();
        }
        function openPicker() {
            if (picker.open) return;
            picker.hidden = false;
            pickerStatus.textContent = config.stocks.length >= 5 ? '최대 5종목입니다. 위 목록에서 삭제한 뒤 추가할 수 있습니다.' : '';
            search.value = ''; lastSuggestionQuery = ''; clearSuggestions(); ++searchRevision; paintStocks(); picker.showModal(); search.focus();
        }
        async function saveCodes(codes, nextSelected) {
            if (saving) return; saving = true; pickerStatus.textContent = '저장 중…'; paintStocks();
            try {
                config = await request('/api/supply/watchlist', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ codes, revision: config.revision }) });
                pickerStatus.textContent = ''; picker.close(); picker.hidden = true; ++searchRevision; clearTimeout(searchTimer);
                if (selected !== nextSelected) choose(nextSelected);
                else { paintStocks(); void window.refreshRankSupplyChart(); }
            } catch (error) {
                picker.hidden = false; pickerStatus.textContent = error.message;
                if (error.status === 409) {
                    try { config = await request('/api/supply/watchlist', { cache: 'no-store' }); pickerStatus.textContent = '다른 창의 최신 종목을 불러왔습니다. 다시 추가하거나 제외하세요.'; }
                    catch { pickerStatus.textContent = '최신 설정 조회 실패 · 조회 후 다시 시도하세요.'; }
                }
            } finally { saving = false; paintStocks(); }
        }
        async function addStock(stock) {
            if (saving) return;
            if (config.stocks.length >= 5) { pickerStatus.textContent = '최대 5종목까지 지정할 수 있습니다.'; return; }
            if (config.stocks.some(item => item.code === stock.code)) { pickerStatus.textContent = '이미 지정한 종목입니다.'; return; }
            await saveCodes([...config.stocks.map(item => item.code), stock.code], stock.code);
        }
        const suggestionQuery = () => search.value.replace(/[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]/g, '').trim();
        search.addEventListener('input', () => {
            const text = suggestionQuery();
            // Korean IME commits can emit another input event after an arrow key.
            // Preserve the list and active option when the completed query did not change.
            if (text === lastSuggestionQuery) return;
            lastSuggestionQuery = text;
            clearTimeout(searchTimer); const id = ++searchRevision; clearSuggestions();
            if (!text) return;
            searchTimer = setTimeout(async () => {
                try {
                    const result = await request('/api/concentration-stocks?q=' + encodeURIComponent(text));
                    if (id !== searchRevision || picker.hidden) return;
                    searchRows = result.stocks;
                    suggestions.replaceChildren(...searchRows.map((stock, index) => {
                        const button = document.createElement('button'); button.type = 'button'; button.textContent = stock.name + ' (' + stock.code + ')'; button.disabled = saving;
                        button.id = 'supply-stock-option-' + index; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false'); button.tabIndex = -1;
                        button.addEventListener('mousedown', event => event.preventDefault());
                        button.addEventListener('click', () => addStock(stock)); return button;
                    }));
                    suggestions.hidden = !searchRows.length; search.setAttribute('aria-expanded', String(searchRows.length > 0));
                } catch (error) { if (id === searchRevision) { lastSuggestionQuery = ''; pickerStatus.textContent = error.message; } }
            }, 200);
        });
        search.addEventListener('compositionupdate', () => requestAnimationFrame(() => {
            if (document.activeElement === search) search.dispatchEvent(new Event('input'));
        }));
        search.addEventListener('compositionend', () => search.dispatchEvent(new Event('input')));
        search.addEventListener('keydown', event => {
            if (saving || event.isComposing && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
            if (suggestions.hidden || !searchRows.length) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                highlightSuggestion(activeSuggestion < 0 ? (event.key === 'ArrowDown' ? 0 : searchRows.length - 1)
                    : (activeSuggestion + (event.key === 'ArrowDown' ? 1 : -1) + searchRows.length) % searchRows.length);
            } else if (event.key === 'Enter' && activeSuggestion >= 0) {
                event.preventDefault(); void addStock(searchRows[activeSuggestion]);
            } else if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation(); lastSuggestionQuery = ''; clearSuggestions(); ++searchRevision;
            }
        });
        picker.querySelector('form').addEventListener('submit', async event => {
            event.preventDefault(); const text = search.value.trim(), id = ++searchRevision;
            if (!text || saving) return;
            try { const data = await request('/api/concentration-stock?q=' + encodeURIComponent(text)); if (id === searchRevision && !picker.hidden) await addStock(data.stock); }
            catch (error) { pickerStatus.textContent = error.message; }
        });
        picker.querySelector('[data-close]').addEventListener('click', closePicker);
        picker.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
        picker.addEventListener('close', () => { picker.hidden = true; ++searchRevision; clearTimeout(searchTimer); clearSuggestions(); paintStocks(); });
        const reference = document.getElementById('concentrationChartPanel') || breadth;
        window.applyRankSupplyCandleOpen = open => {
            showCandles=open===true;candleArea.hidden=!showCandles;
            panel.querySelector('.concentration-candle-toggle').setAttribute('aria-expanded',String(showCandles));
            if(showCandles)void loadCandles();else{candleMessage='';setStatus();}
            resize();
        };
        let independentCandleOpen = false;
        function resize() {
            if (window.rankIndependentClient) {
                panel.style.height = '';
                if (independentCandleOpen !== showCandles) { independentCandleOpen = showCandles; document.dispatchEvent(new CustomEvent('rank-candle-display', { detail: { open: showCandles, panel: panel.id } })); }
                draw(); return;
            }
            const referenceCandles = reference.querySelector('.concentration-candle-area, .rank-adr-candle-area');
            const extra = referenceCandles && !referenceCandles.hidden ? referenceCandles.getBoundingClientRect().height : 0;
            const base = reference.getBoundingClientRect().height - extra;
            if (base <= 0) return;
            const controlExtra = Math.max(0, panel.querySelector('.rank-adr-controls').getBoundingClientRect().height - 40);
            panel.style.height = `${base + controlExtra + (showCandles ? 280 : 0)}px`; draw();
        }
        new ResizeObserver(resize).observe(reference); new ResizeObserver(draw).observe(canvas.parentElement);
        new ResizeObserver(resize).observe(panel.querySelector('.rank-adr-controls'));
        document.addEventListener('visibilitychange', () => { if (!document.hidden) window.refreshRankSupplyChart(); });
        window.addEventListener('online', window.refreshRankSupplyChart);
        if(!window.rankIndependentClient && typeof window.rankMainCandleOpen==='boolean')window.applyRankSupplyCandleOpen(window.rankMainCandleOpen);
        resize(); document.dispatchEvent(new Event('rank-supply-ready'));
        if (!window.rankIndependentClient && !window.rankManagedChartRefresh) window.refreshRankSupplyChart();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})();
