(() => {
    'use strict';
    function initialize() {
        const concentration = document.getElementById('concentrationChartPanel');
        if (!concentration || concentration.dataset.adrInitialized) return;
        concentration.dataset.adrInitialized = 'true';
        let row = concentration.closest('.rank-chart-row');
        if (!row) { row = document.createElement('div'); row.className = 'rank-chart-row'; concentration.before(row); row.append(concentration); }
        let panel = document.getElementById('rankAdrChartPanel');
        if (!panel) {
        panel = document.createElement('section');
        panel.className = 'panel rank-adr-panel';
        panel.innerHTML = `<div class="concentration-chart-header"><select class="interval-select" aria-label="ADR 시장 선택"><option value="kospi">KOSPI</option><option value="kosdaq">KOSDAQ</option></select><h2>ADR</h2><output></output></div><div class="rank-adr-area"><canvas role="img" aria-label="당일 ADR 분봉 차트"></canvas><div class="concentration-tooltip" hidden></div></div><p role="status" class="rank-adr-status"></p>`;
        row.append(panel);
        }
        const select = panel.querySelector('select'), canvas = panel.querySelector('canvas');
        const ctx = canvas.getContext('2d'), status = panel.querySelector('[role="status"]');
        const output = panel.querySelector('output'), tooltip = panel.querySelector('.concentration-tooltip');
        tooltip.className = 'chart-hover-info';
        canvas.parentElement.before(tooltip);
        const controls = document.createElement('div'); controls.className = 'rank-adr-controls';
        controls.innerHTML = `<button type="button" data-adr-mode="day">일</button><button type="button" data-adr-mode="minute" class="active">당일 1분</button><span class="rank-adr-ranges" hidden>${['6m','1y','3y','5y'].map(r => `<button type="button" data-adr-range="${r}" class="${r === '1y' ? 'active' : ''}">${r.toUpperCase()}</button>`).join('')}</span><button type="button" class="concentration-candle-toggle" aria-expanded="false">캔들차트</button>`;
        panel.querySelector('.concentration-chart-header').after(controls);
        controls.append(output);
        const candleArea = document.createElement('div'); candleArea.className = 'rank-adr-candle-area'; candleArea.hidden = true;
        candleArea.innerHTML = '<canvas role="img" aria-label="시장 지수 캔들차트"></canvas><div class="concentration-tooltip" hidden></div><p class="rank-adr-candle-status" role="status"></p>';
        status.before(candleArea);
        const candleCanvas = candleArea.querySelector('canvas'), candleCtx = candleCanvas.getContext('2d');
        const candleTip = candleArea.querySelector('.concentration-tooltip'), candleStatus = candleArea.querySelector('p');
        const candleButton = controls.querySelector('.concentration-candle-toggle');
        const zoomBar = document.createElement('div'); zoomBar.className = 'concentration-chart-footer rank-adr-zoom';
        zoomBar.innerHTML = '<input type="range" min="0" max="0" value="0" aria-label="ADR 과거 구간 이동" disabled><div class="concentration-controls"><button type="button" aria-label="ADR 차트 축소" disabled>−</button><button type="button" aria-label="ADR 차트 확대" disabled>+</button></div>';
        status.before(zoomBar);
        const slider = zoomBar.querySelector('input'), [zoomOut, zoomIn] = zoomBar.querySelectorAll('button');
        let viewStart = 0, viewCount = null, drag = null, refreshPending = false;
        let mode = 'minute', range = '1y', hover = null, candles = [], candleController, candleGeometry = null;
        let points = [], controller, geometry, resizeFrame = null, closing = null;
        const latestByMarket = new Map();
        const dateKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
        let chartDay = dateKey(Date.now());
        const timeLabel = t => new Date(t).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
        function viewportPoints() {
            const count = Math.min(points.length, viewCount ?? points.length);
            viewStart = Math.max(0,Math.min(viewStart,points.length-count));
            return points.slice(viewStart,viewStart+count);
        }
        function updateZoomControls() {
            const count = Math.min(points.length,viewCount ?? points.length);
            slider.max = String(Math.max(0,points.length-count)); slider.value = String(viewStart); slider.disabled = count >= points.length;
            zoomIn.disabled = count <= Math.min(10,points.length); zoomOut.disabled = !points.length || count >= points.length;
        }
        function zoom(factor) {
            if (!points.length) return;
            const current = Math.min(points.length,viewCount ?? points.length), center = viewStart+current/2;
            const count = Math.min(points.length,Math.max(Math.min(10,points.length),Math.round(current*factor)));
            viewCount = count === points.length ? null : count;
            viewStart = Math.max(0,Math.min(points.length-count,Math.round(center-count/2))); clearHover();
        }
        zoomIn.addEventListener('click', () => zoom(.5)); zoomOut.addEventListener('click', () => zoom(2));
        slider.addEventListener('input', () => { viewStart=Number(slider.value); clearHover(); });
        function draw() {
            const visiblePoints = viewportPoints();
            updateZoomControls();
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if (!w || !h) return;
            const pixelWidth = Math.round(w * devicePixelRatio), pixelHeight = Math.round(h * devicePixelRatio);
            if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
            if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            ctx.clearRect(0, 0, w, h);
            ctx.lineWidth = 1;
            const left = 16, top = 10, bottom = h - 30;
            ctx.font = '11px Arial';
            const highestCandle = candles.reduce((highest, point) => Math.max(highest, Number(point.high) || 0), 0);
            const candleAxisWidth = candleArea.hidden || !candles.length ? 0 : ctx.measureText(highestCandle.toFixed(2)).width;
            const right = w - Math.max(70, 36 + candleAxisWidth + 12);
            const values = visiblePoints.map(p => p.adr);
            if (closing) values.push(closing.adr);
            const min = Math.min(60, ...values) - 5, max = Math.max(140, ...values) + 5;
            const y = v => bottom - (v - min) / (max - min) * (bottom - top);
            const day = chartDay, start = (mode === 'day' || viewCount !== null) && visiblePoints.length ? visiblePoints[0].t : Date.parse(`${day}T09:00:00+09:00`), end = (mode === 'day' || viewCount !== null) && visiblePoints.length ? visiblePoints.at(-1).t : Date.parse(`${day}T15:30:00+09:00`);
            const x = t => {
                if (mode !== 'day') return left + (t - start) / (end - start) * (right - left);
                const index = visiblePoints.findIndex(p => p.t >= t);
                return left + Math.max(0, index < 0 ? visiblePoints.length - 1 : index) / Math.max(1, visiblePoints.length - 1) * (right - left);
            };
            geometry = { x, y, left, right, top, bottom, start, end, points:visiblePoints };
            ctx.fillStyle = 'rgba(200, 200, 200, 0.2)'; ctx.fillRect(left, y(120), right - left, y(80) - y(120));
            ctx.font = '11px Arial';
            const gridColor = '#d6dbe1';
            const labelColor = getComputedStyle(panel).getPropertyValue('--text-muted').trim() || '#64748b';
            for (let v = Math.ceil(min / 10) * 10; v <= max; v += 10) {
                if ([80, 100, 120].includes(v)) continue;
                ctx.strokeStyle = gridColor; ctx.setLineDash([3, 5]); ctx.beginPath();
                ctx.moveTo(left, y(v)); ctx.lineTo(right, y(v)); ctx.stroke();
                ctx.fillStyle = labelColor; ctx.textAlign = 'right'; ctx.fillText(v, w - 36, y(v) + 4);
            }
            for (const [v, color] of [[80, '#ff6b6b'], [100, '#ff6b6b'], [120, '#ff6b6b']]) {
                ctx.strokeStyle = gridColor; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(right, y(v)); ctx.stroke();
                ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(v, w - 36, y(v) + 4);
            }
            ctx.setLineDash([]); ctx.fillStyle = getComputedStyle(panel).getPropertyValue('--text-muted');
            ctx.textAlign = 'center';
            if (!visiblePoints.length && closing) {
                const markerX = closing.t ? x(closing.t) : (left + right) / 2;
                ctx.fillStyle = '#339af0';
                ctx.beginPath(); ctx.arc(markerX, y(closing.adr), 5, 0, Math.PI * 2); ctx.fill();
                ctx.textAlign = markerX > (left + right) / 2 ? 'right' : 'left';
                ctx.fillText(`마감 ${closing.adr.toFixed(2)}%`, markerX > (left + right) / 2 ? markerX - 10 : markerX + 10, y(closing.adr) - 10);
                ctx.textAlign = 'center';
            }
            geometry.ticks = [];
            if (mode === 'minute') {
                const count = Math.max(2,Math.floor((right-left)/85));
                for (let i=0;i<=count;i++) { const t = start+(end-start)*i/count; geometry.ticks.push({ x:x(t), label:timeLabel(t) }); }
            } else {
                const step = { '6m': 1, '1y': 2, '3y': 4, '5y': 12 }[range];
                const firstDate = dateKey(start);
                const firstLabel = range === '5y' || firstDate.slice(5,7) === '01' ? `${firstDate.slice(0,4)}년` : `${Number(firstDate.slice(8))}일`;
                if (visiblePoints.length) geometry.ticks.push({ x:left, label:firstLabel, align:'left' });
                let lastLabelRight = left + ctx.measureText(firstLabel).width, previousMonth = firstDate.slice(0,7);
                visiblePoints.forEach(p => {
                    const d = dateKey(p.t), monthKey = d.slice(0,7), month = Number(d.slice(5,7));
                    if (monthKey !== previousMonth && (month === 1 || (month - 1) % step === 0)) {
                        const label = month === 1 || range === '5y' ? `${d.slice(0,4)}년` : `${month}월`;
                        const half = ctx.measureText(label).width / 2;
                        if (x(p.t) - half > lastLabelRight + 12 && x(p.t) + half <= right) {
                            geometry.ticks.push({ x:x(p.t), label }); lastLabelRight = x(p.t) + half;
                        }
                    }
                    previousMonth = monthKey;
                });
            }
            drawXAxis(ctx, h);
            ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
            ctx.strokeStyle = '#339af0'; ctx.lineWidth = 2; ctx.beginPath();
            visiblePoints.forEach((p, i) => { if (!i || (mode === 'minute' && p.t - visiblePoints[i - 1].t > 120000)) ctx.moveTo(x(p.t), y(p.adr)); else ctx.lineTo(x(p.t), y(p.adr)); }); ctx.stroke();
            const today = dateKey(Date.now());
            ctx.restore();
            // Keep the minute line continuous; only the latest current-day point is marked.
            const todayPoint = visiblePoints.filter(p => dateKey(p.t) === today).at(-1);
            if (todayPoint) { ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(x(todayPoint.t), y(todayPoint.adr), 4, 0, Math.PI * 2); ctx.fill(); }
            if (hover) {
                ctx.strokeStyle = '#64748b'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(x(hover.t), top); ctx.lineTo(x(hover.t), bottom); ctx.stroke(); ctx.setLineDash([]);
                drawHoverValue(ctx, geometry, hover.adr, `${hover.adr.toFixed(2)}%`, '#339af0');
                ctx.fillStyle = dateKey(hover.t) === today ? '#f97316' : '#339af0'; ctx.beginPath(); ctx.arc(x(hover.t), y(hover.adr), 4, 0, Math.PI * 2); ctx.fill();
            }
            drawCandles();
            drawDrag(ctx, geometry);
        }
        function drawHoverValue(context, graph, value, label, color) {
            const py = graph.y(value), badgeY = Math.max(graph.top + 10, Math.min(graph.bottom - 10, py));
            context.save(); context.lineWidth = 1; context.strokeStyle = color; context.setLineDash([3,3]);
            context.beginPath(); context.moveTo(graph.left, py); context.lineTo(graph.right, py); context.stroke(); context.setLineDash([]);
            context.font = 'bold 11px Arial'; context.fillStyle = color;
            const badgeWidth = context.measureText(label).width + 12, badgeX = Math.max(0,Math.min(graph.right,context.canvas.clientWidth-badgeWidth));
            context.fillRect(badgeX, badgeY - 10, badgeWidth, 20);
            context.fillStyle = '#fff'; context.textAlign = 'left'; context.textBaseline = 'middle'; context.fillText(label, badgeX + 6, badgeY); context.restore();
        }
        function drawXAxis(context, height) {
            context.font = '11px Arial'; context.fillStyle = getComputedStyle(panel).getPropertyValue('--text-muted').trim() || '#64748b';
            for (const tick of geometry.ticks) { context.textAlign = tick.align || 'center'; context.fillText(tick.label, tick.x, height - 8); }
        }
        function drawCandles() {
            candleGeometry = null;
            if (candleArea.hidden || !geometry) return;
            const w = candleCanvas.clientWidth, h = candleCanvas.clientHeight;
            if (!w || !h) return;
            const pw = Math.round(w * devicePixelRatio), ph = Math.round(h * devicePixelRatio);
            if (candleCanvas.width !== pw) candleCanvas.width = pw;
            if (candleCanvas.height !== ph) candleCanvas.height = ph;
            candleCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); candleCtx.clearRect(0,0,w,h);
            drawXAxis(candleCtx, h);
            const visible = candles.filter(p => p.t >= geometry.start && p.t <= geometry.end);
            if (!visible.length) return;
            const lo = Math.min(...visible.map(p => p.low)), hi = Math.max(...visible.map(p => p.high));
            const margin = Math.max((hi - lo) * 0.1, hi * .001), y = v => h - 28 - (v - lo + margin) / (hi - lo + margin * 2) * (h - 44);
            const cw = Math.max(1, Math.min(8, (geometry.right - geometry.left) / Math.max(1, mode === 'day' ? geometry.points.length : (geometry.end-geometry.start)/60000) * .7));
            candleGeometry = { ...geometry, top:16, bottom:h-28, y, candleWidth:cw };
            candleCtx.font = '11px Arial'; candleCtx.textAlign = 'left';
            for (let i=0; i<5; i++) { const v = lo + (hi-lo) * i/4; candleCtx.strokeStyle = '#d6dbe1'; candleCtx.setLineDash([3,5]); candleCtx.beginPath(); candleCtx.moveTo(geometry.left,y(v)); candleCtx.lineTo(geometry.right,y(v)); candleCtx.stroke(); candleCtx.fillStyle='#64748b'; candleCtx.textAlign='right'; candleCtx.fillText(v.toFixed(2),w-36,y(v)+4); }
            candleCtx.setLineDash([]);
            visible.forEach(p => {
                const x = geometry.x(p.t), color = p.close >= p.open ? '#e11d48' : '#2563eb';
                candleCtx.strokeStyle = color; candleCtx.fillStyle = color; candleCtx.beginPath(); candleCtx.moveTo(x,y(p.high)); candleCtx.lineTo(x,y(p.low)); candleCtx.stroke();
                candleCtx.fillRect(x-cw/2,Math.min(y(p.open),y(p.close)),cw,Math.max(1,Math.abs(y(p.open)-y(p.close))));
            });
            if (hover) {
                candleCtx.strokeStyle='#64748b'; candleCtx.setLineDash([3,3]); candleCtx.beginPath(); candleCtx.moveTo(geometry.x(hover.t),16); candleCtx.lineTo(geometry.x(hover.t),h-28); candleCtx.stroke(); candleCtx.setLineDash([]);
                const point = visible.find(p => p.t === hover.t);
                if (point) drawHoverValue(candleCtx, candleGeometry, point.close, point.close.toFixed(2), '#339af0');
                candleTip.hidden = true;
            } else candleTip.hidden = true;
            drawDrag(candleCtx, candleGeometry);
        }
        function drawDrag(context, graph) {
            if (!drag || !graph) return;
            context.fillStyle = drag.endX >= drag.startX ? 'rgba(15,23,42,.12)' : 'rgba(234,88,12,.12)';
            context.fillRect(Math.min(drag.startX,drag.endX),graph.top,Math.abs(drag.endX-drag.startX),graph.bottom-graph.top);
        }
        async function loadCandles() {
            candleController?.abort(); candles = []; draw();
            if (candleArea.hidden || !points.length && !closing) return;
            const current = candleController = new AbortController();
            const from = (mode === 'day' && points.length ? dateKey(points[0].t) : chartDay).replaceAll('-','');
            const to = (mode === 'day' && points.length ? dateKey(points.at(-1).t) : chartDay).replaceAll('-','');
            candleStatus.textContent = '시장 지수 조회 중';
            try {
                const response = await fetch(`/api/adr/candles?market=${select.value}&mode=${mode}&from=${from}&to=${to}`, { signal: current.signal });
                const data = await response.json(); if (!response.ok) throw new Error(data.error || '캔들 조회 실패');
                if (current !== candleController) return;
                candles = Array.isArray(data.points) ? data.points : [];
                candleStatus.textContent = data.partial ? '조회된 일부 구간 표시' : candles.length ? '' : '표시할 시장 지수 데이터 없음'; draw();
            } catch (e) { if (e.name !== 'AbortError' && current === candleController) candleStatus.textContent = e.message; }
        }
        window.refreshRankAdrChart = async () => {
            if (drag) { refreshPending=true; return; }
            refreshPending=false;
            controller?.abort(); controller = new AbortController();
            const current = controller, market = select.value, day = dateKey(Date.now());
            const key = `rank-adr:${market}:${day}`;
            try {
                if (mode === 'day') {
                    const response = await fetch(`/api/adr/history?market=${market}&range=${range}`, { signal: current.signal });
                    const data = await response.json(); if (!response.ok) throw new Error('ADR 일별 조회 실패');
                    if (current !== controller) return;
                    points = (Array.isArray(data.series) ? data.series : []).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.adr != null && Number.isFinite(Number(p.adr))).map(p => ({ t: Date.parse(`${p.date}T09:00:00+09:00`), adr: Number(p.adr) })).sort((a,b) => a.t-b.t);
                    closing = null; hover = null; tooltip.hidden = true;
                    panel.querySelector('h2').textContent = 'ADR';
                    output.textContent = points.length ? `${points.at(-1).adr.toFixed(2)}%` : '—';
                    canvas.setAttribute('aria-label', `${market.toUpperCase()} ADR 일별 ${range.toUpperCase()} 차트`);
                    status.textContent = points.length ? `${dateKey(points[0].t)} ~ ${dateKey(points.at(-1).t)}` : '일별 데이터 없음';
                    draw(); loadCandles(); return;
                }
                const response = await fetch(`/api/adr/today?market=${market}`, { signal: current.signal });
                if (!response.ok) throw new Error('조회 실패');
                const data = await response.json();
                if (current !== controller) return;
                let saved = []; try { saved = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { /* Storage is optional. */ }
                const normalize = p => {
                    if (!p || p.adr == null || !Number.isFinite(Number(p.adr))) return null;
                    let t = Number(p.t); if (t < 1e12) t *= 1000;
                    if (!Number.isFinite(t) || t <= 0 || dateKey(t) > day) return null;
                    const minute = Math.floor(t / 60000) * 60000;
                    const clock = new Date(minute + 9 * 3600000); const m = clock.getUTCHours() * 60 + clock.getUTCMinutes();
                    return m >= 540 && m <= 930 ? { t: minute, adr: Number(p.adr) } : null;
                };
                const upstream = (Array.isArray(data.intraday) ? data.intraday : []).map(normalize).filter(Boolean);
                if (data.adr != null && data.asOf != null) { const p = normalize({ t: data.asOf, adr: data.adr }); if (p) upstream.push(p); }
                const today = [...(Array.isArray(saved) ? saved : []), ...upstream].map(normalize).filter(p => p && dateKey(p.t) === day);
                const last = data.lastClosed;
                const lastDate = /^\d{8}$/.test(last?.date || '') ? `${last.date.slice(0, 4)}-${last.date.slice(4, 6)}-${last.date.slice(6, 8)}` : null;
                closing = null;
                const previous = latestByMarket.get(market);
                const lastSample = last?.asOf != null ? normalize({ t: last.asOf, adr: last.adr }) : null;
                const latest = [...upstream, ...today, ...(lastSample ? [lastSample] : [])].sort((a, b) => a.t - b.t).at(-1);
                // Keep the last received session until a newer timestamp advances it.
                if (previous && (!latest || latest.t < previous.t)) {
                    points = previous.points; closing = previous.closing; chartDay = previous.day;
                } else {
                    chartDay = latest ? dateKey(latest.t) : lastDate && lastDate <= day ? lastDate : previous?.day || day;
                    const selected = chartDay === day ? today : upstream.filter(p => dateKey(p.t) === chartDay);
                    if (!selected.length && lastDate === chartDay) {
                        const sample = last.asOf != null ? normalize({ t: last.asOf, adr: last.adr }) : null;
                        closing = { adr: Number(last.adr), t: sample && dateKey(sample.t) === chartDay ? sample.t : null };
                    }
                    const minutes = new Map(selected.map(p => [p.t, p]));
                    points = [...minutes.values()].sort((a, b) => a.t - b.t);
                    if (latest) latestByMarket.set(market, { t: latest.t, day: chartDay, points, closing });
                }
                if (chartDay === day && points.length) { try { localStorage.setItem(key, JSON.stringify(points)); } catch (_) { /* Storage is optional. */ } }
                output.textContent = points.length ? `${points.at(-1).adr.toFixed(2)}%` : closing ? `${closing.adr.toFixed(2)}%` : '—';
                const session = chartDay < day ? '직전 거래일 · 당일 데이터 대기' : data.marketStatus === 'open' ? '장중' : '장 마감';
                panel.querySelector('h2').textContent = 'ADR';
                canvas.setAttribute('aria-label', `${chartDay} ADR ${closing ? '마감값 · 분봉 기록 없음' : '분봉 차트'}`);
                tooltip.hidden = true;
                status.textContent = points.length ? `${chartDay} · ${timeLabel(points.at(-1).t)} 기준 · ${session}` : closing ? `${chartDay} · ${session} · 마감값 · 분봉 기록 없음` : `${day} · 당일 데이터 대기 중`;
                hover = null; draw(); loadCandles();
            } catch (error) { if (error.name !== 'AbortError') status.textContent = 'ADR 조회 실패 · 다음 Rank 갱신 때 재시도'; }
        };
        function changeView() { controller?.abort(); candleController?.abort(); viewStart=0; viewCount=null; drag=null; points = []; closing = null; hover = null; candles = []; tooltip.hidden = true; candleTip.hidden = true; output.textContent = '—'; draw(); window.refreshRankAdrChart(); }
        select.addEventListener('change', () => { chartDay = dateKey(Date.now()); changeView(); });
        controls.querySelectorAll('[data-adr-mode]').forEach(button => button.addEventListener('click', () => {
            mode = button.dataset.adrMode;
            controls.querySelectorAll('[data-adr-mode]').forEach(b => b.classList.toggle('active', b === button));
            controls.querySelector('.rank-adr-ranges').hidden = mode !== 'day'; changeView();
        }));
        controls.querySelectorAll('[data-adr-range]').forEach(button => button.addEventListener('click', () => {
            range = button.dataset.adrRange; controls.querySelectorAll('[data-adr-range]').forEach(b => b.classList.toggle('active', b === button)); changeView();
        }));
        window.getRankAdrCandleOpen = () => !candleArea.hidden;
        window.applyRankAdrCandleOpen = open => {
            if (candleArea.hidden === (open !== true)) return;
            candleArea.hidden = open !== true;
            candleButton.setAttribute('aria-expanded', String(!candleArea.hidden));
            scheduleResize(); loadCandles();
        };
        candleButton.addEventListener('click', () => {
            window.applyRankAdrCandleOpen(candleArea.hidden);
            if (typeof saveAppData === 'function') saveAppData();
        });
        function hoverChart(event) {
            if (drag) return;
            if (!geometry) return;
            if (closing) {
                tooltip.textContent = `${chartDay} · 마감 ADR ${closing.adr.toFixed(2)}%${closing.t ? ` · ${timeLabel(closing.t)} 기준` : ''}`;
                tooltip.hidden = false;
                return;
            }
            if (!geometry.points.length) return;
            const px = event.clientX - event.currentTarget.getBoundingClientRect().left;
            if (px < geometry.left || px > geometry.right) { clearHover(); return; }
            const p = geometry.points.reduce((a, b) => Math.abs(geometry.x(b.t) - px) < Math.abs(geometry.x(a.t) - px) ? b : a);
            hover = p;
            tooltip.textContent = `${dateKey(p.t)}${mode === 'minute' ? ` ${timeLabel(p.t)}` : ''} · ADR ${p.adr.toFixed(2)}%`; tooltip.hidden = false; draw();
        }
        function clearHover() { hover = null; tooltip.hidden = true; candleTip.hidden = true; draw(); }
        [canvas, candleCanvas].forEach(c => { c.addEventListener('mousemove', hoverChart); c.addEventListener('mouseleave', clearHover); });
        [canvas,candleCanvas].forEach(surface => {
            const offset = event => Math.max(geometry.left,Math.min(geometry.right,event.clientX-surface.getBoundingClientRect().left));
            surface.addEventListener('pointerdown', event => {
                const graph=surface===canvas?geometry:candleGeometry;
                if (event.button!==0 || drag || !graph || !geometry.points.length) return;
                const rect=surface.getBoundingClientRect(), px=event.clientX-rect.left, py=event.clientY-rect.top;
                if (px<graph.left || px>graph.right || py<graph.top || py>graph.bottom) return;
                drag={surface,id:event.pointerId,startX:offset(event),endX:offset(event),start:viewStart,count:geometry.points.length};
                hover=null; tooltip.hidden=true; surface.setPointerCapture(event.pointerId); draw();
            });
            surface.addEventListener('pointermove', event => { if (drag?.surface===surface && drag.id===event.pointerId) { drag.endX=offset(event); draw(); } });
            surface.addEventListener('pointerup', event => {
                if (drag?.surface!==surface || drag.id!==event.pointerId) return;
                const previous=drag; previous.endX=offset(event); drag=null;
                if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
                if (Math.abs(previous.endX-previous.startX)>10) {
                    if (previous.endX>previous.startX) {
                        const first=Math.floor((previous.startX-geometry.left)/(geometry.right-geometry.left)*(previous.count-1));
                        const last=Math.ceil((previous.endX-geometry.left)/(geometry.right-geometry.left)*(previous.count-1));
                        const count=Math.min(points.length,Math.max(Math.min(10,points.length),last-first+1));
                        viewCount=count===points.length?null:count; viewStart=Math.min(points.length-count,previous.start+first);
                    } else { viewStart=0; viewCount=null; }
                }
                clearHover();
                if (refreshPending) window.refreshRankAdrChart();
            });
            const cancel=() => { if (drag?.surface===surface) {drag=null;clearHover();if (refreshPending) window.refreshRankAdrChart();} };
            surface.addEventListener('pointercancel',cancel); surface.addEventListener('lostpointercapture',cancel);
        });
        function scheduleResize() {
            if (resizeFrame !== null) return;
            resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            const size = concentration.getBoundingClientRect();
            if (size.width > 0 && size.height > 0) {
                const candle = document.getElementById('concentrationCandleArea');
                const candleHeight = candle && !candle.hidden ? candle.getBoundingClientRect().height : 0;
                const baseHeight = size.height - candleHeight;
                panel.style.setProperty('--rank-adr-base-height', `${baseHeight}px`);
                const height = `${baseHeight + (candleArea.hidden ? 0 : 280)}px`;
                if (panel.style.height !== height) panel.style.height = height;
            }
            draw();
            });
        }
        new ResizeObserver(scheduleResize).observe(concentration);
        new ResizeObserver(scheduleResize).observe(canvas.parentElement);
        new ResizeObserver(scheduleResize).observe(candleArea);
        draw(); window.refreshRankAdrChart();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
