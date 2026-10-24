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
        panel.innerHTML = `<div class="concentration-chart-header"><h2>ADR</h2><div class="rank-market-choice" role="radiogroup" aria-label="ADR 시장 선택"><label><input type="radio" name="rank-adr-market" value="kospi" checked>KOSPI</label><label><input type="radio" name="rank-adr-market" value="kosdaq">KOSDAQ</label></div><output></output></div><div class="rank-adr-area"><canvas role="img" aria-label="당일 ADR 분봉 차트"></canvas><div class="concentration-tooltip" hidden></div></div><p role="status" class="rank-adr-status"></p>`;
        row.append(panel);
        }
        panel.querySelector('.concentration-chart-header').insertAdjacentHTML('beforeend', `<button type="button" class="chart-info-button volatility-help-trigger" aria-label="ADR 설명" aria-describedby="adrGuide">i</button>
            <div id="adrGuide" class="volatility-guide adr-guide" role="tooltip">
                <h3>ADR (Advance Decline Ratio)이란?</h3>
                <p>20거래일 동안 상승종목 누계를 하락종목 누계로 나눈 백분율로 표시하며, 증권시장 내의 매수세력과 매도세력의 크기를 가늠하는 지표로 쓰이고 있습니다.</p>
                <p>ADR이 100%인 경우는 상승종목수와 하락종목수가 균형을 이루고 있다는 것을 나타내며 120% 이상이면 과열권, 75% 이하면 바닥권으로 판단합니다.</p>
                <div class="adr-formula" aria-label="ADR 백분율은 20거래일 일간 상승종목의 합을 일간 하락종목의 합으로 나눈 값 곱하기 100">ADR(%) = <span class="adr-fraction"><span>일간 상승종목의 합</span><span>일간 하락종목의 합</span></span> × 100</div>
                <p class="adr-formula-period">누계 기간: 20거래일</p>
            </div>`);
        const infoButton = panel.querySelector('.chart-info-button'), guide = panel.querySelector('#adrGuide');
        let guideTimer;
        const hideGuide = () => guide.classList.remove('is-visible');
        const showGuide = () => {
            clearTimeout(guideTimer);
            guide.style.top = `${infoButton.getBoundingClientRect().bottom - panel.getBoundingClientRect().top + 8}px`;
            guide.classList.add('is-visible');
        };
        infoButton.addEventListener('mouseenter', showGuide); infoButton.addEventListener('focus', showGuide);
        infoButton.addEventListener('mouseleave', () => { guideTimer = setTimeout(hideGuide, 150); });
        infoButton.addEventListener('blur', hideGuide);
        infoButton.addEventListener('keydown', event => { if (event.key === 'Escape') hideGuide(); });
        guide.addEventListener('mouseenter', () => clearTimeout(guideTimer));
        guide.addEventListener('mouseleave', hideGuide);
        let selectedMarket = 'kospi';
        const canvas = panel.querySelector('canvas');
        const ctx = canvas.getContext('2d'), status = panel.querySelector('[role="status"]');
        const output = panel.querySelector('output'), tooltip = panel.querySelector('.concentration-tooltip');
        tooltip.className = 'chart-hover-info';
        canvas.parentElement.before(tooltip);
        const controls = document.createElement('div'); controls.className = 'rank-adr-controls';
        controls.innerHTML = '<button type="button" data-adr-mode="day" class="active">일</button><button type="button" data-adr-mode="minute">1분봉</button><button type="button" data-adr-more class="concentration-icon-button" aria-label="ADR 과거 추가조회" disabled>▥+</button><button type="button" class="concentration-candle-toggle" aria-expanded="false">캔들차트</button>';
        panel.querySelector('.concentration-chart-header').after(controls);
        controls.append(output);
        const valueWithDate = document.createElement('span'); valueWithDate.className = 'chart-value-with-date';
        output.before(valueWithDate); valueWithDate.append(output);
        const currentDate = document.createElement('span'); currentDate.className = 'chart-value-date'; currentDate.textContent = '—';
        valueWithDate.prepend(currentDate);
        const candleArea = document.createElement('div'); candleArea.className = 'rank-adr-candle-area'; candleArea.hidden = true;
        candleArea.innerHTML = '<canvas role="img" aria-label="시장 지수 캔들차트"></canvas><div class="concentration-tooltip" hidden></div><p class="rank-adr-candle-status" role="status"></p>';
        canvas.parentElement.after(candleArea);
        const candleCanvas = candleArea.querySelector('canvas'), candleCtx = candleCanvas.getContext('2d');
        const candleTip = candleArea.querySelector('.concentration-tooltip'), candleStatus = candleArea.querySelector('p');
        const candleButton = controls.querySelector('.concentration-candle-toggle');
        const zoomBar = document.createElement('div'); zoomBar.className = 'concentration-chart-footer rank-adr-zoom';
        zoomBar.innerHTML = '<input type="range" min="0" max="0" value="0" aria-label="ADR 과거 구간 이동" disabled><div class="concentration-controls"><button type="button" aria-label="ADR 차트 축소" disabled>−</button><button type="button" aria-label="ADR 차트 확대" disabled>+</button></div>';
        candleArea.after(zoomBar);
        const slider = zoomBar.querySelector('input'), [zoomOut, zoomIn] = zoomBar.querySelectorAll('button');
        let viewStart = 0, viewCount = null, drag = null, refreshPending = false;
        let mode = 'day', range = '5y', hover = null, candles = [], candleController, candleGeometry = null;
        let points = [], controller, geometry, resizeFrame = null, closing = null;
        let candlePointerY = null;
        const latestByMarket = new Map();
        const dateKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
        let chartDay = dateKey(Date.now());
        const timeLabel = t => new Date(t).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
        const referencePages = new Map();
        let referencePoints = [], referenceCursor = null, referenceLoading = false;
        const moreButton = controls.querySelector('[data-adr-more]');
        const moreIcon = document.querySelector('#concentrationMore svg');
        if (moreIcon) moreButton.replaceChildren(moreIcon.cloneNode(true));
        function axisPoints() {
            if (!referencePoints.length) return points;
            const values = new Map(points.map(p=>[p.t,p.adr]));
            return referencePoints.map(p=>({t:p.t,adr:values.get(p.t) ?? null}));
        }
        let todayOnly = true;
        window.RankChartAxis.todayButton(panel,'[data-adr-mode="minute"]',()=>mode,()=>{todayOnly=true;draw();void window.refreshRankAdrChart();});
        window.RankChartAxis.registerHistoryLoader('adr',()=>window.refreshRankAdrChart(true),()=>referenceLoading);
        moreButton.addEventListener('click',()=>window.RankChartAxis.requestHistory(mode));
        function viewportPoints() {
            {const view=window.RankChartAxis.sharedRange('adr',axisPoints(),p=>p.t,mode,viewStart,viewCount,draw);viewStart=view.start;viewCount=view.count;}
            const count = Math.min(axisPoints().length, viewCount ?? axisPoints().length);
            viewStart = Math.max(0,Math.min(viewStart,axisPoints().length-count));
            return axisPoints().slice(viewStart,viewStart+count);
        }
        function updateZoomControls() {
            const count = Math.min(axisPoints().length,viewCount ?? axisPoints().length);
            slider.max = String(Math.max(0,axisPoints().length-count)); slider.value = String(viewStart); slider.disabled = count >= axisPoints().length;
            window.RankChartAxis.updateSlider('adr',slider);
            zoomIn.disabled = count <= Math.min(10,axisPoints().length); zoomOut.disabled = !axisPoints().length || count >= axisPoints().length;
        }
        function zoom(factor, anchor = .5) {
            if (!axisPoints().length) return;
            const current = Math.min(axisPoints().length,viewCount ?? axisPoints().length);
            const count = Math.min(axisPoints().length,Math.max(Math.min(10,axisPoints().length),Math.round(current*factor)));
            viewCount = count === axisPoints().length ? null : count;
            viewStart = Math.max(0,Math.min(axisPoints().length-count,Math.round(viewStart + anchor * (current - count)))); clearHover();
        }
        zoomIn.addEventListener('click', () => zoom(.5)); zoomOut.addEventListener('click', () => zoom(2));
        slider.addEventListener('input', () => { viewStart=Number(slider.value); clearHover(); });
        function draw() {
            window.RankChartAxis.candleLabel(candleArea,selectedMarket==='kosdaq'?'KOSDAQ':'KOSPI');
            const latest = points.at(-1);
            currentDate.textContent = latest ? dateKey(latest.t) : closing ? chartDay : '—';
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
            const left = 16, top = 10, bottom = h - 34;
            ctx.font = '12px Inter, sans-serif';
            const highestCandle = candles.reduce((highest, point) => Math.max(highest, Number(point.high) || 0), 0);
            const candleAxisWidth = candleArea.hidden || !candles.length ? 0 : ctx.measureText(Math.round(highestCandle).toLocaleString('ko-KR')).width;
            const right = w - Math.max(58, candleAxisWidth + 12);
            const values = visiblePoints.map(p => p.adr).filter(Number.isFinite);
            if (closing) values.push(closing.adr);
            const min = Math.floor((Math.min(60, ...values) - 5) / 10) * 10, max = Math.ceil((Math.max(140, ...values) + 5) / 10) * 10;
            const y = v => bottom - (v - min) / (max - min) * (bottom - top);
            const start = mode==='minute' && todayOnly?Date.parse(`${dateKey(Date.now())}T08:00:00+09:00`):visiblePoints[0]?.t ?? closing?.t ?? Date.parse(`${chartDay}T08:00:00+09:00`);
            const end = visiblePoints.at(-1)?.t ?? start;
            const sessionX=window.RankChartAxis.sessionX(visiblePoints,p=>p.t,left,right,mode==='minute',mode==='day');
            const x = t => {
                if(sessionX)return sessionX(t);
                if (mode !== 'day') return left + (t - start) / Math.max(1, end - start) * (right - left);
                const index = visiblePoints.findIndex(p => p.t >= t);
                return left + Math.max(0, index < 0 ? visiblePoints.length - 1 : index) / Math.max(1, visiblePoints.length - 1) * (right - left);
            };
            const boundaryXs = [];
            visiblePoints.forEach((point,i) => {
                const length = mode === 'minute' ? 10 : 7;
                if (i && dateKey(point.t).slice(0,length) !== dateKey(visiblePoints[i-1].t).slice(0,length)
                    && (!boundaryXs.length || x(point.t) - boundaryXs.at(-1) >= 32)) boundaryXs.push(x(point.t));
            });
            geometry = { x, y, left, right, top, bottom, start, end, points:visiblePoints, boundaryXs };
            drawBoundaries(ctx,top,bottom);

            ctx.fillStyle = 'rgba(200, 200, 200, 0.2)'; ctx.fillRect(left, y(120), right - left, y(80) - y(120));
            ctx.font = '12px Inter, sans-serif';
            const gridColor = '#b8c1cc';
            const labelColor = getComputedStyle(panel).getPropertyValue('--text-muted').trim() || '#64748b';
            for (let v = Math.ceil(min / 10) * 10; v <= max; v += 10) {
                if ([80, 100, 120].includes(v)) continue;
                ctx.strokeStyle = gridColor; ctx.setLineDash([3, 5]); ctx.beginPath();
                ctx.moveTo(left, y(v)); ctx.lineTo(right, y(v)); ctx.stroke();
                ctx.fillStyle = labelColor; ctx.textAlign = 'right'; ctx.fillText(v, w - 4, y(v) + 4);
            }
            for (const [v, color] of [[80, '#ff6b6b'], [100, '#ff6b6b'], [120, '#ff6b6b']]) {
                ctx.strokeStyle = gridColor; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(right, y(v)); ctx.stroke();
                ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(v, w - 4, y(v) + 4);
            }
            ctx.setLineDash([]); ctx.fillStyle = getComputedStyle(panel).getPropertyValue('--text-muted');
            ctx.textAlign = 'center';
            if (!visiblePoints.length && closing) {
                const markerX = closing.t ? x(closing.t) : (left + right) / 2;
                ctx.fillStyle = '#f97316';
                ctx.beginPath(); ctx.arc(markerX, y(closing.adr), 4, 0, Math.PI * 2); ctx.fill();
                ctx.textAlign = markerX > (left + right) / 2 ? 'right' : 'left';
                ctx.fillText(`마감 ${closing.adr.toFixed(2)}%`, markerX > (left + right) / 2 ? markerX - 10 : markerX + 10, y(closing.adr) - 10);
                ctx.textAlign = 'center';
            }
            geometry.ticks = window.RankChartAxis.eightTick(ctx,window.RankChartAxis.ticks(ctx, visiblePoints, p=>p.t, p=>x(p.t), left, right, mode),left,right,mode==='minute',window.RankChartAxis.sessionStartLabel(visiblePoints,p=>p.t));
            drawXAxis(ctx, h);
            ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
            ctx.strokeStyle = '#339af0'; ctx.lineWidth = 2; ctx.beginPath();
            visiblePoints.forEach((p, i) => { if (!Number.isFinite(p.adr)) return; if (!i || !Number.isFinite(visiblePoints[i-1].adr) || (mode === 'minute' && p.t - visiblePoints[i - 1].t > 120000)) ctx.moveTo(x(p.t), y(p.adr)); else ctx.lineTo(x(p.t), y(p.adr)); }); ctx.stroke();
            ctx.restore();
            // Mark the latest data point even before today's first sample arrives.
            const latestPoint = points.at(-1);
            if (latestPoint && visiblePoints.some(p => p.t === latestPoint.t)) { ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(x(latestPoint.t), y(latestPoint.adr), 4, 0, Math.PI * 2); ctx.fill(); }
            if (hover && Number.isFinite(hover.adr)) {
                ctx.strokeStyle = '#000'; ctx.setLineDash([3,3]); ctx.beginPath(); ctx.moveTo(x(hover.t), top); ctx.lineTo(x(hover.t), bottom); ctx.stroke(); ctx.setLineDash([]);
                drawHoverValue(ctx, geometry, hover.adr, `${hover.adr.toFixed(2)}%`, '#000');
                ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x(hover.t), y(hover.adr), 4, 0, Math.PI * 2); ctx.fill();
            }
            drawCandles();
            drawDrag(ctx, geometry);
        }
        function drawHoverValue(context, graph, value, label, color) {
            const py = graph.y(value), badgeY = Math.max(graph.top + 10, Math.min(graph.bottom - 10, py));
            context.save(); context.lineWidth = 1; context.strokeStyle = color; context.setLineDash([3,3]);
            context.beginPath(); context.moveTo(graph.left, py); context.lineTo(graph.right, py); context.stroke(); context.setLineDash([]);
            context.font = 'bold 11px Arial'; context.fillStyle = color;
            const badgeWidth = context.measureText(label).width + 12, badgeX = Math.max(0,context.canvas.clientWidth-badgeWidth-4);
            context.fillRect(badgeX, badgeY - 10, badgeWidth, 20);
            context.fillStyle = '#fff'; context.textAlign = 'left'; context.textBaseline = 'middle'; context.fillText(label, badgeX + 6, badgeY); context.restore();
        }
        function drawXAxis(context, height) {
            context.font = '12px Inter, sans-serif'; context.fillStyle = getComputedStyle(panel).getPropertyValue('--text-muted').trim() || '#64748b';
            for (const tick of geometry.ticks) { context.textAlign = tick.align || 'center'; context.fillText(tick.label, tick.labelX, height - 8); }
        }
        function drawBoundaries(context, upper, lower) {
            context.save(); context.strokeStyle = '#b8c1cc'; context.lineWidth = 1; context.setLineDash([3,5]);
            (geometry?.boundaryXs || []).forEach(px => { context.beginPath(); context.moveTo(px,upper); context.lineTo(px,lower); context.stroke(); }); context.restore();
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
            const layout=window.RankChartAxis.candleLayout(visible,p=>p.low,p=>p.high,p=>geometry.x(p.t),h,geometry.left,geometry.right);
            const lo=layout.minimum,hi=layout.maximum,y=layout.y,cw=layout.width;
            candleGeometry = { ...geometry, top:layout.top, bottom:layout.bottom, y, candleWidth:cw };
            candleCtx.font = '12px Inter, sans-serif'; candleCtx.textAlign = 'left';
            for (let i=0; i<5; i++) { const v = lo + (hi-lo) * i/4; candleCtx.strokeStyle = '#b8c1cc'; candleCtx.setLineDash([3,5]); candleCtx.beginPath(); candleCtx.moveTo(geometry.left,y(v)); candleCtx.lineTo(geometry.right,y(v)); candleCtx.stroke(); candleCtx.fillStyle='#64748b'; candleCtx.textAlign='right'; candleCtx.fillText(Math.round(v).toLocaleString('ko-KR'),w-4,y(v)+4); }
            candleCtx.setLineDash([]);
            drawBoundaries(candleCtx,layout.top,layout.bottom);
            candleCtx.lineWidth=1;
            visible.forEach(p => {
                const x = geometry.x(p.t), color = p.close >= p.open ? '#e11d48' : '#2563eb';
                candleCtx.strokeStyle = color; candleCtx.fillStyle = color; candleCtx.beginPath(); candleCtx.moveTo(x,y(p.high)); candleCtx.lineTo(x,y(p.low)); candleCtx.stroke();
                candleCtx.fillRect(x-cw/2,Math.min(y(p.open),y(p.close)),cw,Math.max(1,Math.abs(y(p.open)-y(p.close))));
            });
            if (hover) {
                candleCtx.strokeStyle='#000'; candleCtx.setLineDash([3,3]); candleCtx.beginPath(); candleCtx.moveTo(geometry.x(hover.t),layout.top); candleCtx.lineTo(geometry.x(hover.t),layout.bottom); candleCtx.stroke(); candleCtx.setLineDash([]);
                const point = visible.find(p => p.t === hover.t);
                const price = point?.close;
                if (Number.isFinite(price)) drawHoverValue(candleCtx, candleGeometry, price, price.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}), '#000');
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
            if(referencePoints.length){candles=referencePoints;candleStatus.textContent='';draw();return;}
            if(candleArea.hidden || !points.length)return;
            candleController?.abort();const current=candleController=new AbortController();
            const from=dateKey(points[0].t).replaceAll('-',''),to=dateKey(points.at(-1).t).replaceAll('-','');
            try {
                const response=await fetch(`/api/adr/candles?market=${selectedMarket}&mode=${mode}&from=${from}&to=${to}`,{signal:current.signal});
                const result=await response.json();if(!response.ok)throw new Error(result.error || '캔들 조회 실패');
                if(current!==candleController)return;
                candles=Array.isArray(result.points)?result.points:[];candleStatus.textContent=result.partial?'일부 캔들 구간 표시':candles.length?'':'캔들 데이터 없음';draw();
            } catch(error){if(error.name!=='AbortError')candleStatus.textContent='캔들 조회 실패';}
        }
        window.refreshRankAdrChart = async (more = false) => {
            if(window.rankManagedChartRefresh && !window.rankChartRefreshStarted)return;
            if (referenceLoading || more && !referenceCursor) return;
            if (drag) { refreshPending=true; return; }
            if(more){window.RankChartAxis.showHistory();todayOnly=false;}
            refreshPending=false;
            controller?.abort(); controller = new AbortController();
            const current = controller, market = selectedMarket, day = dateKey(Date.now());
            const key = `rank-adr:${market}:${day}`;
            const beforeOpen = new Date(Date.now() + 9 * 3600000).getUTCHours() < 9;
            referenceLoading = true; moreButton.disabled = true;
            let referenceWarning = '';
            const oldAnchor = viewportPoints()[0]?.t;
            try {
                const keys = more ? [referenceCursor] : [...new Set(['', ...referencePages.keys()])];
                try {
                    for (const cursor of keys) {
                        const response = await fetch(`/api/chart-reference?mode=${mode}&market=${market}&cursor=${encodeURIComponent(cursor || '')}`,{signal:current.signal});
                        const body = await response.text();
                        let page;
                        try { page = JSON.parse(body); } catch { throw new Error('기준 캔들 API 미반영 · 서버 업데이트·재시작 필요'); }
                        if(!response.ok)throw new Error(page.error || '기준 캔들 조회 실패');
                        if(!Array.isArray(page.points))throw new Error('기준 캔들 응답 형식 오류');
                        if(current!==controller)return;
                        referencePages.set(cursor || '',page);
                    }
                } catch(error) {
                    if(error.name==='AbortError')throw error;
                    referenceWarning=error.message;
                }
                referencePoints = [...new Map([...referencePages.values()].flatMap(p=>p.points || []).map(p=>[p.t,p])).values()].sort((a,b)=>a.t-b.t);
                referenceCursor = [...referencePages.values()].at(-1)?.cursor || null;
                if(more){viewStart=0;viewCount=null;}
                else if(viewCount!=null)viewStart=Math.max(0,referencePoints.findIndex(p=>p.t>=oldAnchor));
                if (mode === 'day') {
                    const response = await fetch(`/api/adr/history?market=${market}&range=${range}`, { signal: current.signal });
                    const data = await response.json(); if (!response.ok) throw new Error('ADR 일별 조회 실패');
                    if (current !== controller) return;
                    points = (Array.isArray(data.series) ? data.series : []).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.adr != null && Number.isFinite(Number(p.adr))).map(p => ({ t: Date.parse(`${p.date}T09:00:00+09:00`), adr: Number(p.adr) })).filter(p=>!referencePoints.length || p.t>=referencePoints[0].t && p.t<=referencePoints.at(-1).t).sort((a,b) => a.t-b.t);
                    closing = null; hover = null; tooltip.hidden = true;
                    panel.querySelector('h2').textContent = 'ADR';
                    output.textContent = points.length ? `${points.at(-1).adr.toFixed(1)}%` : '—';
                    canvas.setAttribute('aria-label', `${market.toUpperCase()} ADR 일별 ${range.toUpperCase()} 차트`);
                    window.setRankCardConnection?.(panel, true);
                    status.textContent = referencePoints.length ? `${dateKey(referencePoints[0].t)} ~ ${dateKey(referencePoints.at(-1).t)} · ${referencePoints.length}봉${points.length ? '' : ' · ADR 데이터 없음'}` : points.length ? `${dateKey(points[0].t)} ~ ${dateKey(points.at(-1).t)} · 지표 자료 표시 중` : '일별 데이터 없음';
                    draw(); loadCandles(); return;
                }
                const response = await fetch(`/api/adr/today?market=${market}`, { signal: current.signal });
                if (!response.ok) throw new Error('조회 실패');
                const data = await response.json();
                if (current !== controller) return;
                let saved = [];
                try {
                    saved = JSON.parse(localStorage.getItem(key) || '[]');
                    const session = JSON.parse(localStorage.getItem(`rank-adr-session:${market}`) || 'null');
                    saved = [...(Array.isArray(saved) ? saved : []), ...(Array.isArray(session?.points) ? session.points : [])];
                    if (!saved.length) {
                        const oldKey = Object.keys(localStorage).filter(item => item.startsWith(`rank-adr:${market}:`) && item.slice(-10) <= day).sort().at(-1);
                        if (oldKey) saved = JSON.parse(localStorage.getItem(oldKey) || '[]');
                    }
                } catch (_) { /* Storage is optional. */ }
                const normalize = p => {
                    if (!p || p.adr == null || !Number.isFinite(Number(p.adr))) return null;
                    let t = Number(p.t); if (t < 1e12) t *= 1000;
                    if (!Number.isFinite(t) || t <= 0 || dateKey(t) > day || beforeOpen && dateKey(t) === day) return null;
                    const minute = Math.floor(t / 60000) * 60000;
                    const clock = new Date(minute + 9 * 3600000); const m = clock.getUTCHours() * 60 + clock.getUTCMinutes();
                    return m >= 540 && m <= 930 ? { t: minute, adr: Number(p.adr) } : null;
                };
                const upstream = (Array.isArray(data.intraday) ? data.intraday : []).map(normalize).filter(Boolean);
                if (data.adr != null && data.asOf != null) { const p = normalize({ t: data.asOf, adr: data.adr }); if (p) upstream.push(p); }
                const received = [...(Array.isArray(saved) ? saved : []), ...(latestByMarket.get(market)?.points || []), ...upstream].map(normalize).filter(Boolean);
                const last = data.lastClosed;
                const lastDate = /^\d{8}$/.test(last?.date || '') && last.adr != null && Number.isFinite(Number(last.adr)) ? `${last.date.slice(0, 4)}-${last.date.slice(4, 6)}-${last.date.slice(6, 8)}` : null;
                closing = null;
                const previous = latestByMarket.get(market);
                const lastSample = last?.asOf != null ? normalize({ t: last.asOf, adr: last.adr }) : null;
                const latest = [...received, ...(lastSample ? [lastSample] : [])].sort((a, b) => a.t - b.t).at(-1);
                // Keep the last received session until a newer timestamp advances it.
                if (previous && (!latest || latest.t < previous.t) && (!lastDate || lastDate <= previous.day)) {
                    points = previous.points; closing = previous.closing; chartDay = previous.day;
                } else {
                    const latestDay = latest ? dateKey(latest.t) : null;
                    chartDay = lastDate && lastDate <= day && (!latestDay || lastDate > latestDay) ? lastDate : latestDay || previous?.day || day;
                    const selected = received.filter(p => dateKey(p.t) === chartDay);
                    if (!selected.length && lastDate === chartDay) {
                        const sample = last.asOf != null ? normalize({ t: last.asOf, adr: last.adr }) : null;
                        closing = { adr: Number(last.adr), t: sample && dateKey(sample.t) === chartDay ? sample.t : null };
                    }
                    const minutes = new Map(selected.map(p => [p.t, p]));
                    points = [...minutes.values()].sort((a, b) => a.t - b.t);
                    if (latest) latestByMarket.set(market, { t: latest.t, day: chartDay, points, closing });
                }
                if (points.length) {
                    try {
                        const sessionKey = `rank-adr:${market}:${chartDay}`;
                        Object.keys(localStorage).filter(key => key.startsWith(`rank-adr:${market}:`) && key !== sessionKey).forEach(key => localStorage.removeItem(key));
                        localStorage.setItem(sessionKey, JSON.stringify(points));
                        localStorage.setItem(`rank-adr-session:${market}`, JSON.stringify({ points }));
                    } catch (_) { /* Storage is optional; the server retains the session. */ }
                }
                output.textContent = points.length ? `${points.at(-1).adr.toFixed(1)}%` : closing ? `${closing.adr.toFixed(1)}%` : '—';
                const session = chartDay < day ? '직전 거래일 · 당일 데이터 대기' : data.marketStatus === 'open' ? '장중' : '장 마감';
                panel.querySelector('h2').textContent = 'ADR';
                canvas.setAttribute('aria-label', `${chartDay} ADR ${closing ? '마감값 · 분봉 기록 없음' : '분봉 차트'}`);
                tooltip.hidden = true;
                status.textContent = points.length ? `${chartDay} · ${timeLabel(points.at(-1).t)} 기준 · ${session}` : closing ? `${chartDay} · ${session} · 마감값 · 분봉 기록 없음` : `${day} · 당일 데이터 대기 중`;
                window.setRankCardConnection?.(panel, !data.sourceError);
                if (data.sourceError) status.textContent += ` · ${data.sourceError}`;
                hover = null; draw(); loadCandles();
            } catch (error) { if (error.name !== 'AbortError') { window.setRankCardConnection?.(panel, false); status.textContent = 'ADR 조회 실패 · 다음 Rank 갱신 때 재시도'; } }
            finally {
                if(current===controller) {
                    if(referenceWarning){status.textContent += ` · ${referenceWarning}`;window.setRankCardConnection?.(panel,false);}
                    referenceLoading=false;moreButton.disabled=!referenceCursor;
                }
            }
        };
        function changeView() { todayOnly=true;referencePages.clear();referencePoints=[];referenceCursor=null;referenceLoading=false;controller?.abort(); candleController?.abort(); viewStart=0; viewCount=null; drag=null; points = []; closing = null; hover = null; candles = []; tooltip.hidden = true; candleTip.hidden = true; output.textContent = '—'; draw(); window.refreshRankAdrChart(); }
        panel.querySelector('.rank-market-choice').addEventListener('change', event => { selectedMarket = event.target.value; chartDay = dateKey(Date.now()); changeView(); });
        controls.querySelectorAll('[data-adr-mode]').forEach(button => button.addEventListener('click', () => {
            mode = button.dataset.adrMode;
            controls.querySelectorAll('[data-adr-mode]').forEach(b => b.classList.toggle('active', b === button));
            changeView();
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
            if (!window.rankCandleSyncing && typeof saveAppData === 'function') saveAppData();
        });
        window.RankChartAxis.registerHover('adr',()=>mode,()=>hover?.t,key=>{
            hover=geometry?.points.find(p=>window.RankChartAxis.matchesHover(p.t,key,mode)) ?? null;
            candlePointerY=null;tooltip.hidden=true;candleTip.hidden=true;draw();
        });
        function hoverChart(event) {
            if (drag) return;
            if (!geometry) return;
            candlePointerY = event.currentTarget === candleCanvas ? event.clientY - candleCanvas.getBoundingClientRect().top : null;
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
            tooltip.textContent = `${dateKey(p.t)}${mode === 'minute' ? ` ${timeLabel(p.t)}` : ''} · ADR ${Number.isFinite(p.adr)?p.adr.toFixed(2)+'%':'—'}`; tooltip.hidden = false; draw();
        }
        function clearHover() { hover = null; candlePointerY = null; tooltip.hidden = true; candleTip.hidden = true; draw(); }
        [canvas, candleCanvas].forEach(c => { c.addEventListener('mousemove', hoverChart); c.addEventListener('mouseleave', clearHover); });
        [canvas,candleCanvas].forEach(surface => {
            surface.addEventListener('wheel', event => {
                if (!geometry || !axisPoints().length || drag || !event.deltaY) return;
                const px = event.clientX - surface.getBoundingClientRect().left;
                if (px < geometry.left || px > geometry.right) return;
                event.preventDefault(); zoom(event.deltaY < 0 ? .8 : 1.25, (px - geometry.left) / (geometry.right - geometry.left));
            }, { passive: false });
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
                    if(previous.endX<previous.startX){viewStart=0;viewCount=null;}
                    window.RankChartAxis.selectViewport('adr',(previous.startX-geometry.left)/(geometry.right-geometry.left),(previous.endX-geometry.left)/(geometry.right-geometry.left));
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
        draw(); if(!window.rankManagedChartRefresh)window.refreshRankAdrChart();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
