(() => {
    'use strict';
    const scopes = [1];
    const encoded = value => encodeURIComponent(String(value || '')).replace(/'/g, '%27');
    window.rankChartRowAttributes = (stock, efriend = false) => {
        const code = String(efriend ? stock.pdno || '' : stock.stk_cd || '').replace(/_(AL|NX)$/i, '');
        if (!/^[0-9A-Za-z]{6}$/.test(code)) return '';
        const name = efriend ? stock.prdt_name : stock.stk_nm || stock.isu_nm;
        const market = ['K', 'Q'].includes(stock.mkt_type) ? stock.mkt_type : '';
        return `data-chart-code="${code}" data-chart-name="${encoded(name || code)}" data-chart-market="${market}" tabindex="0" role="button" aria-label="${encoded(name || code)}"`;
    };

    document.addEventListener('DOMContentLoaded', () => {
        const original = document.getElementById('concentrationChartPanel');
        if (original && !window.rankIndependentClient && original.closest('.rank-chart-row')) {
            const copy = original.cloneNode(true);
            for (const element of [copy, ...copy.querySelectorAll('*')]) {
                for (const attr of ['id', 'aria-controls', 'aria-describedby']) {
                    const value = element.getAttribute(attr);
                    if (value) element.setAttribute(attr, value.replaceAll('concentration', 'kisConcentration'));
                }
            }
            copy.querySelector('h2').textContent = '쏠림율[한투]';
            copy.querySelectorAll('.rank-card-source,.rank-connection-dot').forEach(element => element.remove());
            copy.setAttribute('aria-label', '쏠림율[한투] 차트');
            copy.querySelector('#kisConcentrationMore').setAttribute('data-action', 'more');
            copy.querySelector('#kisConcentrationPeriod').classList.add('concentration-period');
            original.closest('.rank-chart-row').append(copy);
        }
        initialize();
        if (document.getElementById('kisConcentrationChartPanel')) initialize(true);
    });
    function initialize(kis = false) {
        const state = { selection: null, mode: 'day', interval: 1, points: [], cursor: null,
            hasMore: false, busy: false, visible: 0, start: 0, request: 0, controller: null, hover: null, drag: null };
        const chartKey = kis ? 'kisConcentration' : 'concentration';
        const get = id => document.getElementById(kis ? id.replace(/^concentration/, 'kisConcentration') : id);
        const api = name => kis ? name.replace('Concentration', 'KisConcentration').replace('RankChart', 'KisRankChart') : name;
        let refreshPending = false, refreshTimer = null;
        function flushRefresh() {
            if (!refreshPending || state.busy || state.drag || (typeof isCapturing !== 'undefined' && isCapturing) || refreshTimer) return;
            refreshTimer = setTimeout(() => { refreshTimer = null; if (refreshPending) window[api('refreshConcentrationChart')]?.(); }, 0);
        }
        const panel = get('concentrationChartPanel');
        if (!panel) return;
        if (!kis) document.addEventListener('click', event => {
            if (window.rankIndependentClient || window.rankCandleSyncing) return;
            const button = event.target.closest?.('.rank-chart-row .concentration-candle-toggle');
            if (!button || button.disabled) return;
            const open = button.getAttribute('aria-expanded') !== 'true';
            window.rankMainCandleOpen=open;
            event.preventDefault(); event.stopImmediatePropagation();
            window.rankCandleSyncing = true;
            try {
                // Reuse each chart's own loading, rendering and accessibility logic.
                for (const target of document.querySelectorAll('.rank-chart-row .concentration-candle-toggle')) {
                    if (!target.disabled && (target.getAttribute('aria-expanded') === 'true') !== open) target.click();
                }
            } finally { window.rankCandleSyncing = false; }
            if (typeof saveAppData === 'function') saveAppData();
        }, true);
        const canvas = get('concentrationCanvas');
        const status = get('concentrationStatus');
        const name = get('concentrationStockName');
        const market = get('concentrationMarket');
        const more = get('concentrationMore');
        const slider = get('concentrationRange');
        const zoomIn = get('concentrationZoomIn');
        const zoomOut = get('concentrationZoomOut');
        const tooltip = get('concentrationTooltip');
        const currentRate = get('concentrationCurrentRate');
        const valueWithDate = document.createElement('span'); valueWithDate.className = 'chart-value-with-date';
        currentRate.before(valueWithDate); valueWithDate.append(currentRate);
        const currentDate = document.createElement('span'); currentDate.className = 'chart-value-date concentration-value-date'; currentDate.textContent = '—';
        panel.append(currentDate);
        function positionCurrentDate() {
            const box = panel.getBoundingClientRect(), value = currentRate.getBoundingClientRect();
            currentDate.style.right = `${box.right - panel.clientLeft - value.right}px`;
            currentDate.style.top = `${value.top - box.top - panel.clientTop - 15}px`;
        }
        currentRate.closest('.concentration-timeframe-row')?.addEventListener('scroll', positionCurrentDate);
        const chartArea = canvas.parentElement;
        tooltip.className = 'chart-hover-info';
        chartArea.before(tooltip);
        const ctx = canvas.getContext('2d');
        const candleCanvas = get('concentrationCandleCanvas');
        const candleArea = get('concentrationCandleArea');
        const candleTooltip = get('concentrationCandleTooltip');
        const candleToggle = get('concentrationCandleToggle');
        const candleCtx = candleCanvas.getContext('2d');
        let geometry = null;
        let sharedRevision = 0;
        let candleGeometry = null;
        let candlePointerY = null;

        window[api('getConcentrationDisplaySettings')] = () => ({
            candleOpen: !candleArea.hidden, mode: state.mode, interval: state.interval,
            ...(window.getRankAdrCandleOpen ? { adrCandleOpen: window.getRankAdrCandleOpen() } : {}),
            ...(window.getRankTurnoverCandleOpen ? { turnoverCandleOpen: window.getRankTurnoverCandleOpen() } : {}),
            ...(window.getRankVolatilityDisplaySettings ? { volatility: window.getRankVolatilityDisplaySettings() } : {}),
            ...(window.getRankBreadthDisplaySettings ? { breadth: window.getRankBreadthDisplaySettings() } : {}),
            ...(window.getRankMarketSupplyDisplaySettings ? { marketSupply: window.getRankMarketSupplyDisplaySettings() } : {}),
            ...(window.getRankSentimentDisplaySettings ? { sentiment: window.getRankSentimentDisplaySettings() } : {})
        });
        window[api('applyConcentrationDisplaySettings')] = settings => {
            const nextCandleOpen = settings?.candleOpen === true;
            if(!kis && !window.rankIndependentClient)window.rankMainCandleOpen=nextCandleOpen;
            if (!kis && nextCandleOpen !== !candleArea.hidden) document.dispatchEvent(new CustomEvent('rank-candle-display', { detail: { open: nextCandleOpen } }));
            const mode = settings?.mode === 'minute' ? 'minute' : 'day';
            const interval = scopes.includes(Number(settings?.interval)) ? Number(settings.interval) : 1;
            const changed = state.mode !== mode || state.interval !== interval;
            state.mode = mode; state.interval = interval;
            candleArea.hidden = settings?.candleOpen !== true;
            candleToggle.setAttribute('aria-expanded', String(!candleArea.hidden));
            candleToggle.textContent = '캔들차트';
            candleToggle.setAttribute('aria-label', candleArea.hidden ? '캔들차트 펼치기' : '캔들차트 접기');
            if (!kis) {
                if (!window.rankIndependentClient || settings && 'adrCandleOpen' in settings) window.applyRankAdrCandleOpen?.(window.rankIndependentClient ? settings.adrCandleOpen === true : nextCandleOpen);
                if (!window.rankIndependentClient || settings && 'turnoverCandleOpen' in settings) window.applyRankTurnoverCandleOpen?.(window.rankIndependentClient ? settings.turnoverCandleOpen === true : nextCandleOpen);
                if (settings && 'volatility' in settings) window.applyRankVolatilityDisplaySettings?.(window.rankIndependentClient ? settings.volatility : {...settings.volatility,candleOpen:nextCandleOpen});
                if (settings && 'breadth' in settings) window.applyRankBreadthDisplaySettings?.(window.rankIndependentClient ? settings.breadth : {...settings.breadth,candleOpen:nextCandleOpen});
                if (settings && 'marketSupply' in settings) window.applyRankMarketSupplyDisplaySettings?.(settings.marketSupply);
                if (settings && 'sentiment' in settings) window.applyRankSentimentDisplaySettings?.(window.rankIndependentClient ? settings.sentiment : {...settings.sentiment,candleOpen:nextCandleOpen});
                if(!window.rankIndependentClient){ window.applyRankSupplyCandleOpen?.(nextCandleOpen); window.applyRankMarketSupplyCandleOpen?.(nextCandleOpen); }
                window.applyKisConcentrationDisplaySettings?.(settings);
            }
            state.hover = null; tooltip.hidden = true; candleTooltip.hidden = true;
            draw();
            if (changed && state.selection) load();
        };
        function saveDisplaySettings() {
            if (!window.rankCandleSyncing && typeof saveAppData === 'function') saveAppData();
        }
        function updateControls() {
            canvas.classList.toggle('is-loading', state.busy);
            candleCanvas.classList.toggle('is-loading', state.busy);
            if (state.busy || state.hover == null) candleTooltip.hidden = true;
            chartArea.setAttribute('aria-busy', String(state.busy));
            panel.querySelectorAll('[data-chart-mode]').forEach(button => {
                const active = button.dataset.chartMode === state.mode;
                button.classList.toggle('active', active);
                button.setAttribute('aria-pressed', String(active));
            });
            panel.querySelectorAll('[data-chart-interval]').forEach(button => {
                const active = Number(button.dataset.chartInterval) === state.interval;
                button.classList.toggle('active', active);
                button.setAttribute('aria-pressed', String(active));
                button.disabled = state.mode === 'day';
            });
            more.disabled = !state.selection || state.busy || !state.hasMore;
            more.setAttribute('aria-busy', String(state.busy));
            zoomIn.disabled = state.busy || state.points.length < 2 || state.visible <= Math.min(10, state.points.length);
            zoomOut.disabled = state.busy || !state.points.length || state.visible >= state.points.length;
            slider.max = String(Math.max(0, state.points.length - state.visible));
            slider.value = String(state.start);
            slider.disabled = state.busy || !state.points.length || state.visible >= state.points.length;
            window.RankChartAxis.updateSlider(chartKey,slider,state.busy);
        }
        function selectedRows() {
            if (kis) return;
            document.querySelectorAll('#tab_rank tr[data-chart-code]').forEach(row => {
                const selected = row.dataset.chartCode === state.selection?.code;
                row.classList.toggle('concentration-selected', selected);
                row.setAttribute('aria-pressed', String(selected));
                row.setAttribute('aria-label', `${decodeURIComponent(row.dataset.chartName)} 쏠림율 차트 보기`);
            });
        }
        function formatDate(time) { return `${time.slice(4, 6)}/${time.slice(6, 8)}`; }
        function formatTime(time) { return `${time.slice(8, 10)}:${time.slice(10, 12)}`; }
        function validCandle(point) {
            return [point.stock_open, point.stock_high, point.stock_low, point.stock_price].every(value => Number.isFinite(value) && value > 0)
                && point.stock_high >= Math.max(point.stock_open, point.stock_price)
                && point.stock_low <= Math.min(point.stock_open, point.stock_price);
        }
        function candleChange(point) {
            return Number.isFinite(point.stock_change_rate) ? point.stock_change_rate : null;
        }
        function drawHoverValue(context, plot, y, value, label) {
            const py=y(value), badgeY=Math.max(plot.top+10,Math.min(plot.bottom-10,py));
            context.save();context.lineWidth=1;context.strokeStyle='#000';context.setLineDash([3,3]);
            context.beginPath();context.moveTo(plot.left,py);context.lineTo(plot.right,py);context.stroke();context.setLineDash([]);
            context.font='bold 11px Arial';context.fillStyle='#000';
            const badgeWidth=context.measureText(label).width+12,badgeX=Math.max(0,context.canvas.clientWidth-badgeWidth-4);
            context.fillRect(badgeX,badgeY-10,badgeWidth,20);
            context.fillStyle='#fff';context.textAlign='left';context.textBaseline='middle';context.fillText(label,badgeX+6,badgeY);context.restore();
        }
        function drawCandles(points, plot, x, ratio, labels, boundaries) {
            candleGeometry = null;
            if (candleArea.hidden) return;
            const width = chartArea.clientWidth, height = candleArea.clientHeight;
            candleCanvas.width = Math.round(width * ratio); candleCanvas.height = Math.round(height * ratio);
            candleCtx.setTransform(ratio, 0, 0, ratio, 0, 0); candleCtx.clearRect(0, 0, width, height);

            const candles = points.filter(validCandle);
            if (!candles.length) {
                candleCtx.font='12px Inter, sans-serif';candleCtx.textAlign='center';candleCtx.fillStyle='#64748b';labels.forEach(({label,labelX})=>candleCtx.fillText(label,labelX,height-14));
                candleCtx.fillStyle = '#64748b'; candleCtx.font = '12px Inter, sans-serif'; candleCtx.textAlign = 'center';
                candleCtx.fillText('캔들 데이터가 없습니다.', width / 2, height / 2); return;
            }
            const layout=window.RankChartAxis.candleLayout(candles,p=>p.stock_low,p=>p.stock_high,p=>x(points.indexOf(p)),height,plot.left,plot.right);
            const {top,bottom,minimum,maximum,y}=layout,candleWidth=layout.width;
            candleGeometry = { plot: { ...plot, top, bottom }, points, x, y, candleWidth, width, height };
            candleCtx.font = '12px Inter, sans-serif'; candleCtx.textBaseline = 'middle';
            for (let tick = 0; tick <= 4; tick++) {
                const price = minimum + (maximum - minimum) * tick / 4;
                candleCtx.beginPath(); candleCtx.setLineDash([3,5]); candleCtx.strokeStyle = '#b8c1cc';
                candleCtx.moveTo(plot.left, y(price)); candleCtx.lineTo(plot.right, y(price)); candleCtx.stroke();
                candleCtx.fillStyle = '#64748b'; candleCtx.textAlign = 'right';
                candleCtx.fillText(Math.round(price).toLocaleString('ko-KR'), width - 4, y(price));
            }
            candleCtx.setLineDash([]);
            boundaries.forEach(boundaryX => {
                candleCtx.beginPath(); candleCtx.setLineDash([3, 5]); candleCtx.strokeStyle = '#b8c1cc';
                candleCtx.moveTo(boundaryX, top); candleCtx.lineTo(boundaryX, bottom); candleCtx.stroke();
            });
            candleCtx.setLineDash([]);
            const bodyWidth = candleWidth;
            points.forEach((point, i) => {
                if (!validCandle(point)) return;
                const color = point.stock_price >= point.stock_open ? '#e11d48' : '#2563eb';
                candleCtx.strokeStyle = color; candleCtx.fillStyle = color; candleCtx.lineWidth = 1;
                candleCtx.beginPath(); candleCtx.moveTo(x(i), y(point.stock_high)); candleCtx.lineTo(x(i), y(point.stock_low)); candleCtx.stroke();
                const bodyTop = Math.min(y(point.stock_open), y(point.stock_price));
                candleCtx.fillRect(x(i) - bodyWidth / 2, bodyTop, bodyWidth, Math.max(1, Math.abs(y(point.stock_open) - y(point.stock_price))));
            });
            if (state.hover != null && points[state.hover]) {
                candleCtx.beginPath(); candleCtx.setLineDash([3,3]); candleCtx.strokeStyle = '#000';
                candleCtx.moveTo(x(state.hover), top); candleCtx.lineTo(x(state.hover), bottom); candleCtx.stroke(); candleCtx.setLineDash([]);
                const point=points[state.hover];
                const price = point.stock_price;
                if(validCandle(point))drawHoverValue(candleCtx,{...plot,top,bottom},y,price,Math.round(price).toLocaleString('ko-KR'));
            }
            if (state.drag) {
                const left = Math.min(state.drag.startX, state.drag.endX);
                const span = Math.abs(state.drag.endX - state.drag.startX);
                candleCtx.fillStyle = state.drag.endX >= state.drag.startX ? 'rgba(15, 23, 42, 0.12)' : 'rgba(234, 88, 12, 0.12)';
                candleCtx.fillRect(left, top, span, bottom - top);
            }
            candleCtx.textAlign = 'center'; candleCtx.fillStyle = '#64748b';
            labels.forEach(({ label, labelX }) => candleCtx.fillText(label, labelX, height - 14));
        }
        candleToggle.addEventListener('click', () => {
            const settings = window[api('getConcentrationDisplaySettings')]();
            settings.candleOpen = !settings.candleOpen;
            window[api('applyConcentrationDisplaySettings')](settings);
            saveDisplaySettings();
        });
        function draw() {
            window.RankChartAxis.candleLabel(candleArea,state.selection?.name || state.selection?.code || '');
            if (!kis && !window.rankIndependentClient) document.dispatchEvent(new Event('rank-chart-state'));
            const width = chartArea.clientWidth;
            if (!width) return;
            const height = chartArea.clientHeight;
            const ratio = window.devicePixelRatio || 1;
            const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
            if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
            if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, width, height);
            ctx.lineWidth = 1;
            const plot = { left: 16, top: 10, right: width - 58, bottom: height - 34 };
            {const view=window.RankChartAxis.sharedRange(chartKey,state.points,p=>p.time,state.mode,state.start,state.visible,draw);state.start=view.start;state.visible=view.count ?? state.visible;}
            const points = state.points.slice(state.start, state.start + state.visible);
            const maximum = points.reduce((max, point) => Number.isFinite(point.value) ? Math.max(max, point.value) : max, 0);
            let tickStep = 10;
            if (maximum > 70) {
                const target = maximum / 7;
                const magnitude = 10 ** Math.floor(Math.log10(target));
                tickStep = [1, 2, 2.5, 5, 10].find(factor => factor * magnitude >= target) * magnitude;
            }
            const axisMaximum = Math.max(70, Math.ceil(maximum * 1.15 / tickStep) * tickStep);
            const tickCount = Math.round(axisMaximum / tickStep);
            ctx.font = '12px Inter, sans-serif';
            const maxPrice = points.reduce((max, point) => Math.max(max, point.stock_high || 0), 0);
            const priceMargin = !candleArea.hidden ? ctx.measureText(Math.ceil(maxPrice * 1.1).toLocaleString()).width + 18 : 0;
            plot.right = width - Math.max(58, priceMargin, ctx.measureText(`${axisMaximum.toLocaleString()}%`).width + 18);
            Object.assign(plot,window.RankChartAxis.plotBounds(chartKey,width,plot.left,plot.right));
            const xLabels = [];
            const boundaries = [];
            canvas.setAttribute('aria-label', `시장 거래대금 대비 종목 거래대금 비율 차트, 세로축 0~${axisMaximum.toLocaleString()}%, 자동 범위`);
            const sessionX=window.RankChartAxis.sessionX(points,p=>p.time,plot.left,plot.right,state.mode==='minute',state.mode==='day');
            const x = index => sessionX?sessionX(points[index].time):points.length <= 1 ? (plot.left + plot.right) / 2
                : plot.left + index / (points.length - 1) * (plot.right - plot.left);
            const y = value => plot.bottom - value / axisMaximum * (plot.bottom - plot.top);
            geometry = { plot, points, x, y, width, height };
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#64748b';
            for (let tick = 0; tick <= tickCount; tick++) {
                const percent = tick * tickStep;
                ctx.beginPath(); ctx.setLineDash([3, 5]); ctx.strokeStyle = '#b8c1cc';
                ctx.moveTo(plot.left, y(percent)); ctx.lineTo(plot.right, y(percent)); ctx.stroke();
                ctx.textAlign = 'right'; ctx.fillText(`${percent.toLocaleString()}%`, width - 4, y(percent));
            }
            // Daily charts mark month boundaries; minute charts mark trading days.
            {
                const boundaryLength = state.mode === 'minute' ? 8 : 6;
                let lastDay = points[0]?.time.slice(0, boundaryLength);
                let lastBoundaryX = -Infinity;
                for (let i = 1; i < points.length; i++) {
                    const day = points[i].time.slice(0, boundaryLength);
                    if (day !== lastDay) {
                        if (x(i) - lastBoundaryX >= 32) {
                            ctx.beginPath(); ctx.setLineDash([3, 5]); ctx.strokeStyle = '#b8c1cc';
                            ctx.moveTo(x(i), plot.top); ctx.lineTo(x(i), plot.bottom); ctx.stroke();
                            lastBoundaryX = x(i);
                            boundaries.push(lastBoundaryX);
                        }
                        lastDay = day;
                    }
                }
            }
            ctx.setLineDash([]);
            if (!points.length) {
                if(state.mode==='minute'){xLabels.push(...window.RankChartAxis.ticks(ctx,points,p=>p.time,(_,i)=>x(i),plot.left,plot.right,state.mode));ctx.textAlign='center';ctx.fillStyle='#64748b';xLabels.forEach(({label,labelX})=>ctx.fillText(label,labelX,height-14));}
                ctx.textAlign = 'center'; ctx.fillStyle = '#64748b';
                if (!state.busy) ctx.fillText(state.selection
                    ? '표시할 데이터가 없습니다.' : '위 테이블에서 종목을 선택하세요.', width / 2, height / 2);
            } else {
                ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); ctx.clip();
                ctx.lineWidth = 2; ctx.strokeStyle = '#339af0'; ctx.setLineDash([]); ctx.beginPath();
                let connected = false;
                points.forEach((point, i) => {
                    if (point.value == null) { connected = false; return; }
                    if (connected) ctx.lineTo(x(i), y(point.value)); else ctx.moveTo(x(i), y(point.value));
                    connected = true;
                });
                ctx.stroke();
                ctx.restore();
                const latest = points.at(-1);
                if (Number.isFinite(latest?.value) && latest.time === state.points.at(-1)?.time) {
                    const lastX = x(points.length - 1);
                    const lastY = y(latest.value);
                    ctx.beginPath(); ctx.fillStyle = '#f97316'; ctx.arc(lastX, lastY, 4, 0, 2 * Math.PI); ctx.fill();
                }
                ctx.fillStyle = '#64748b'; ctx.textAlign = 'center';
                xLabels.push(...window.RankChartAxis.eightTick(ctx,window.RankChartAxis.ticks(ctx, points, p=>p.time, (_,i)=>x(i), plot.left, plot.right, state.mode),plot.left,plot.right,state.mode==='minute',window.RankChartAxis.sessionStartLabel(points,p=>p.time)));
                xLabels.forEach(({label,labelX})=>ctx.fillText(label,labelX,height-14));
                if (state.hover != null && points[state.hover]) {
                    ctx.beginPath(); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#000';
                    ctx.moveTo(x(state.hover), plot.top); ctx.lineTo(x(state.hover), plot.bottom); ctx.stroke(); ctx.setLineDash([]);
                    const point = points[state.hover];
                    if (Number.isFinite(point.value)) {
                        drawHoverValue(ctx,plot,y,point.value,`${point.value.toFixed(2)}%`);
                        ctx.fillStyle = '#000';
                        ctx.beginPath(); ctx.arc(x(state.hover), y(point.value), 4, 0, Math.PI * 2); ctx.fill();
                    }
                }
            }
            if (state.drag) {
                const left = Math.min(state.drag.startX, state.drag.endX);
                const span = Math.abs(state.drag.endX - state.drag.startX);
                ctx.fillStyle = state.drag.endX >= state.drag.startX ? 'rgba(15, 23, 42, 0.12)' : 'rgba(234, 88, 12, 0.12)';
                ctx.fillRect(left, plot.top, span, plot.bottom - plot.top);
            }
            drawCandles(points, plot, x, ratio, xLabels, boundaries);
            const current = state.points.at(-1);
            currentRate.textContent = Number.isFinite(current?.value)
                ? `${current.value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : '-';
            currentDate.textContent = Number.isFinite(current?.value) && /^\d{8}/.test(current.time)
                ? `${current.time.slice(0,4)}-${current.time.slice(4,6)}-${current.time.slice(6,8)}` : '—';
            positionCurrentDate();
            const first = points[0], last = points.at(-1);
            const periodDate = time => `${time.slice(0,4)}-${time.slice(4,6)}-${time.slice(6,8)}`;
            get('concentrationPeriod').textContent = first
                ? `${periodDate(first.time)}${state.mode === 'minute' ? ` ${formatTime(first.time)}` : ''} — ${periodDate(last.time)}${state.mode === 'minute' ? ` ${formatTime(last.time)}` : ''} · ${points.length.toLocaleString()} / ${state.points.length.toLocaleString()}봉`
                : '쏠림율';
            updateControls();
        }
        let todayOnly = true;
        window.RankChartAxis.todayButton(panel,'[data-chart-mode="minute"]',()=>state.mode,()=>{todayOnly=true;draw();void load(false,true);});
        async function load(append = false, refresh = false) {
            if(window.rankManagedChartRefresh && !window.rankChartRefreshStarted)return;
            if (!state.selection || (append && state.busy)) return;
            if(append){window.RankChartAxis.showHistory();todayOnly=false;}else if(!refresh){todayOnly=true;}
            state.historyError='';
            const previous = { points: state.points, start: state.start, visible: state.visible };
            state.controller?.abort();
            const controller = new AbortController();
            state.controller = controller;
            const request = ++state.request;
            state.busy = true; state.hover = null; tooltip.hidden = true;
            if (state.drag && canvas.hasPointerCapture(state.drag.pointerId)) canvas.releasePointerCapture(state.drag.pointerId);
            state.drag = null;
            if (!append && !refresh) { state.cursor = null; state.hasMore = false; }
            status.textContent = '';
            draw();
            try {
                const response = await fetch(kis ? '/api/kis-concentration-chart' : '/api/concentration-chart', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: state.selection.code, mode: state.mode, interval: state.interval, cursor: append ? state.cursor : null }),
                    signal: controller.signal
                });
                const result = await response.json();
                if (request !== state.request) return;
                if (!response.ok || !result.success) throw new Error(result.error || '차트 조회 실패');
                const freshPoints = result.points;
                if ((refresh || append) && previous.points.length && result.points.length) {
                    const earliest = result.points[0].time;
                    state.points = [...previous.points.filter(point => point.time < earliest), ...freshPoints];
                } else {
                    state.points = refresh && !result.points.length ? previous.points : freshPoints;
                }
                state.cursor = result.cursor; state.hasMore = result.has_more;state.historyProgress=result.history_progress;state.historyError=result.partial ? result.notice || '거래대금 일부 조회 실패' : '';
                state.visible = state.points.length; state.start = 0;
                if (refresh && previous.visible < previous.points.length) {
                    state.visible = Math.min(previous.visible, state.points.length);
                    const anchor = previous.points[previous.start]?.time;
                    const anchoredStart = state.points.findIndex(point => point.time >= anchor);
                    state.start = previous.start + previous.visible === previous.points.length
                        ? state.points.length - state.visible
                        : Math.max(0, Math.min(state.points.length - state.visible, anchoredStart < 0 ? previous.start : anchoredStart));
                }

                market.textContent = result.market === 'K' ? '코스피' : '코스닥';
                window.setRankCardConnection?.('#' + chartKey + 'ChartPanel', !result.partial);
                const valid = state.points.filter(point => point.value != null).length;
                status.textContent = result.history_pending ? '시장 과거 데이터가 더 필요합니다. 추가 조회 버튼을 눌러 주세요.'
                    : result.partial && result.notice ? result.notice : !state.points.length ? '표시할 데이터가 없습니다.' : !valid ? '같은 날짜·시간의 시장 거래대금이 없어 계산할 수 없습니다.'
                    : result.notice || '';
            } catch (error) {
                if (request !== state.request || error.name === 'AbortError') return;
                state.historyError=error.message;
                window.setRankCardConnection?.('#' + chartKey + 'ChartPanel', false);
                if (!append && !refresh) { state.points = []; state.start = 0; state.visible = 0; }
                status.textContent = `${error.message} · ${refresh ? '다음 갱신 주기에 다시 조회합니다.' : append ? '추가 조회 버튼으로 다시 시도하세요.' : '일/분 버튼으로 다시 시도하세요.'}`;
                if (error.message.includes('만료')) { state.cursor = null; state.hasMore = false; }
            } finally {
                if (request === state.request) { state.busy = false; sharedRevision++; draw(); flushRefresh(); }
            }
        }
        window[api('refreshConcentrationChart')] = () => {
            if (!state.selection) return;
            if (state.busy || state.drag || (typeof isCapturing !== 'undefined' && isCapturing)) { refreshPending = true; return; }
            refreshPending = false;
            return load(false, true);
        };
        window[api('getRankChartState')] = () => ({ selection: state.selection, mode: state.mode, interval: state.interval,
            points: state.points, cursor: state.cursor, hasMore: state.hasMore, busy: state.busy,
            market: market.textContent, status: status.textContent, revision: sharedRevision });
        window[api('applyRankChartState')] = data => {
            if (!data || !Array.isArray(data.points)) return;
            const changed = state.selection?.code !== data.selection?.code || state.mode !== data.mode || state.interval !== data.interval;
            const atEnd = state.start + state.visible >= state.points.length;
            Object.assign(state, { selection: data.selection, mode: data.mode, interval: data.interval, points: data.points,
                cursor: data.cursor, hasMore: data.hasMore, busy: data.busy });
            if (changed || !state.visible) { state.start = 0; state.visible = state.points.length; }
            else { state.visible = Math.min(state.visible, state.points.length); state.start = atEnd ? state.points.length - state.visible : Math.min(state.start, state.points.length - state.visible); }
            // Shared snapshots keep arriving while a manual stock query is being
            // edited. Keep that draft separate from the selected chart stock.
            if (document.activeElement !== name) name.value = state.selection?.name || '';
            market.textContent = data.market || ''; status.textContent = data.status || '';
            if(changed){todayOnly=true;}selectedRows(); draw();
        };
        window[api('selectRankChartStock')] = stock => chooseStock(stock);
        window[api('setRankChartQuery')] = (selection, mode, interval, followSelection) => {
            const changed = state.mode !== mode || state.interval !== interval || (followSelection && state.selection?.code !== selection?.code);
            state.mode = mode === 'minute' ? 'minute' : 'day'; state.interval = scopes.includes(Number(interval)) ? Number(interval) : 1;
            if (followSelection && selection && /^[0-9A-Za-z]{6}$/.test(selection.code)) {
                state.selection = selection;
                if (document.activeElement !== name) name.value = selection.name;
            }
            if (changed) { selectedRows(); saveDisplaySettings(); load(); }
        };
        let lookupVersion = 0;
        const suggestions = get('concentrationStockSuggestions');
        let suggestionVersion = 0, suggestionTimer, suggestionRows = [], activeSuggestion = -1, lastSuggestionQuery = null;
        function hideSuggestions() {
            suggestionVersion++; clearTimeout(suggestionTimer); suggestions.hidden = true;
            name.setAttribute('aria-expanded', 'false'); name.removeAttribute('aria-activedescendant');
            suggestionRows = []; activeSuggestion = -1; lastSuggestionQuery = null;
        }
        function chooseStock(stock) {
            const restoreRange=state.mode==='minute'?window.RankChartAxis.minuteDomain():window.RankChartAxis.dailyDomain();
            lookupVersion++; hideSuggestions();
            state.selection = { code: stock.code, name: stock.name };
            name.value = stock.name; market.textContent = stock.market === 'K' ? '코스피' : stock.market === 'Q' ? '코스닥' : '-';
            panel.querySelector('.rank-selection-history-notice')?.remove();
            selectedRows(); void load().then(()=>{if(state.selection?.code===stock.code)return window.RankChartAxis.restoreHistoryRange(chartKey,restoreRange);});
            document.dispatchEvent(new CustomEvent('rank-concentration-selection', { detail: { source: chartKey, stock } }));
        }
        function highlightSuggestion(index) {
            activeSuggestion = index;
            [...suggestions.children].forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
            const item = suggestions.children[index];
            if (item) { name.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
        }
        // Korean IME keeps the last syllable composing until another key is pressed.
        // Search completed syllables immediately, excluding standalone consonants/vowels.
        const suggestionQuery = () => name.value.replace(/[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]/g, '').trim();
        name.addEventListener('input', () => {
            const query = suggestionQuery();
            if (query === lastSuggestionQuery) return;
            lookupVersion++; hideSuggestions();
            const version = suggestionVersion;
            if (!query) return;
            lastSuggestionQuery = query;
            suggestionTimer = setTimeout(async () => {
                try {
                    const response = await fetch(`/api/concentration-stocks?q=${encodeURIComponent(query)}`);
                    const result = await response.json();
                    if (version !== suggestionVersion || suggestionQuery() !== query || document.activeElement !== name) return;
                    if (!response.ok || !result.success) throw new Error(result.error || '종목 검색 실패');
                    suggestionRows = result.stocks; suggestions.replaceChildren();
                    suggestionRows.forEach((stock, i) => {
                        const item = document.createElement('div'); item.id = `${chartKey}-stock-suggestion-${i}`;
                        item.setAttribute('role', 'option'); item.setAttribute('aria-selected', 'false');
                        item.textContent = `${stock.name} (${stock.code}) · ${stock.market === 'K' ? '코스피' : '코스닥'}`;
                        item.addEventListener('mousedown', event => { event.preventDefault(); chooseStock(stock); });
                        suggestions.appendChild(item);
                    });
                    suggestions.hidden = !suggestionRows.length; name.setAttribute('aria-expanded', String(!suggestions.hidden));
                } catch (error) { if (version === suggestionVersion) { lastSuggestionQuery = null; status.textContent = error.message; } }
            }, 120);
        });
        // Some IMEs update their composition before emitting a normal input event.
        // Read the input after the browser applies that composition to its value.
        name.addEventListener('compositionupdate', () => requestAnimationFrame(() => {
            if (document.activeElement === name) name.dispatchEvent(new Event('input'));
        }));
        name.addEventListener('compositionend', () => name.dispatchEvent(new Event('input')));
        name.addEventListener('blur', () => {
            hideSuggestions();
            name.value = state.selection?.name || '';
        });
        name.addEventListener('keydown', event => {
            // Arrow navigation works even while the IME finalizes its last syllable.
            if (event.isComposing && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
            if (event.key === 'Escape') { hideSuggestions(); return; }
            if (suggestions.hidden) return;
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault();
                highlightSuggestion(activeSuggestion < 0 ? (event.key === 'ArrowDown' ? 0 : suggestionRows.length - 1)
                    : (activeSuggestion + (event.key === 'ArrowDown' ? 1 : -1) + suggestionRows.length) % suggestionRows.length);
            } else if (event.key === 'Enter' && activeSuggestion >= 0) {
                event.preventDefault(); event.stopImmediatePropagation(); chooseStock(suggestionRows[activeSuggestion]);
            }
        });

        name.addEventListener('keydown', async event => {
            if (event.key !== 'Enter' || event.isComposing) return;
            event.preventDefault();
            const query = name.value.trim();
            const version = ++lookupVersion;
            if (!query) { status.textContent = '종목명 또는 종목코드를 입력하세요.'; return; }
            try {
                const response = await fetch(`/api/concentration-stock?q=${encodeURIComponent(query)}`);
                const result = await response.json();
                if (version !== lookupVersion || name.value.trim() !== query) return;
                if (!response.ok || !result.success) throw new Error(result.error || '종목 조회 실패');
                chooseStock(result.stock);
            } catch (error) {
                if (version === lookupVersion) status.textContent = error.message;
            }
        });
        function selectRow(row) {
            chooseStock({ code: row.dataset.chartCode, name: decodeURIComponent(row.dataset.chartName), market: row.dataset.chartMarket });
        }
        if (!kis) document.getElementById('tab_rank').addEventListener('click', event => {
            const row = event.target.closest('tr[data-chart-code]');
            if (row) selectRow(row);
        });
        if (!kis) document.getElementById('tab_rank').addEventListener('keydown', event => {
            const row = event.target.closest('tr[data-chart-code]');
            if (row && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectRow(row); }
        });
        panel.querySelectorAll('[data-chart-mode]').forEach(button => button.addEventListener('click', () => {
            if (button.dataset.chartMode === 'minute' && state.mode !== 'minute') state.interval = 1;
            state.mode = button.dataset.chartMode; updateControls(); saveDisplaySettings(); load();
        }));
        window.RankChartAxis.registerHistoryLoader(chartKey,()=>load(true),()=>state.busy,()=>({hasMore:!!state.selection && state.hasMore,cursor:state.cursor,progress:state.historyProgress,error:state.historyError,identity:state.selection?.code}));
        more.addEventListener('click', () => window.RankChartAxis.requestHistory(state.mode));
        function zoom(factor, anchor = .5) {
            if (!state.points.length) return;
            const previousCount = state.visible;
            state.visible = Math.min(state.points.length, Math.max(Math.min(10, state.points.length), Math.round(state.visible * factor)));
            state.start = Math.max(0, Math.min(state.points.length - state.visible, Math.round(state.start + anchor * (previousCount - state.visible))));
            state.hover = null; tooltip.hidden = true; draw(); flushRefresh();
        }
        zoomIn.addEventListener('click', () => zoom(0.5));
        zoomOut.addEventListener('click', () => zoom(2));
        slider.addEventListener('input', () => { state.start = Number(slider.value); state.hover = null; tooltip.hidden = true; draw(); });
        const dragX = event => Math.max(geometry.plot.left, Math.min(geometry.plot.right,
            event.clientX - event.currentTarget.getBoundingClientRect().left));
        [canvas, candleCanvas].forEach(surface => {
        surface.addEventListener('wheel', event => {
            if (!geometry?.points.length || state.drag || state.busy || !event.deltaY) return;
            const px = event.clientX - surface.getBoundingClientRect().left;
            const left = geometry.plot.left, right = geometry.plot.right;
            if (px < left || px > right) return;
            event.preventDefault(); zoom(event.deltaY < 0 ? .8 : 1.25, (px - left) / (right - left));
        }, { passive: false });
        surface.addEventListener('pointerdown', event => {
            if (event.button !== 0 || state.busy || !geometry?.points.length) return;
            if (state.drag) return;
            const graph = surface === candleCanvas ? candleGeometry : geometry;
            if (!graph) return;
            const bounds = surface.getBoundingClientRect();
            const offsetX = event.clientX - bounds.left;
            const offsetY = event.clientY - bounds.top;
            if (offsetX < geometry.plot.left || offsetX > geometry.plot.right || offsetY < graph.plot.top || offsetY > graph.plot.bottom) return;
            state.drag = { surface, pointerId: event.pointerId, startX: dragX(event), endX: dragX(event), start: state.start, visible: state.visible };
            state.hover = null; tooltip.hidden = true;
            surface.setPointerCapture(event.pointerId);
            draw();
        });
        surface.addEventListener('pointermove', event => {
            if (!state.drag || state.drag.surface !== surface || state.drag.pointerId !== event.pointerId) return;
            state.drag.endX = dragX(event);
            draw();
        });
        surface.addEventListener('pointerup', event => {
            if (!state.drag || state.drag.surface !== surface || state.drag.pointerId !== event.pointerId) return;
            const drag = state.drag;
            drag.endX = dragX(event);
            state.drag = null;
            if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
            if (Math.abs(drag.endX - drag.startX) > 10) {
                if(drag.endX<drag.startX){state.start=0;state.visible=state.points.length;}
                window.RankChartAxis.selectViewport(chartKey,(drag.startX-geometry.plot.left)/(geometry.plot.right-geometry.plot.left),(drag.endX-geometry.plot.left)/(geometry.plot.right-geometry.plot.left));
            }
            state.hover = null; tooltip.hidden = true; draw(); flushRefresh();
        });
        function cancelDrag() {
            if (!state.drag || state.drag.surface !== surface) return;
            state.drag = null; state.hover = null; tooltip.hidden = true; draw(); flushRefresh();
        }
        surface.addEventListener('pointercancel', cancelDrag);
        surface.addEventListener('lostpointercapture', cancelDrag);
        });
        window.RankChartAxis.registerHover(chartKey,()=>state.mode,()=>geometry?.points[state.hover]?.time,key=>{
            const index=geometry?.points.findIndex(p=>window.RankChartAxis.matchesHover(p.time,key,state.mode)) ?? -1;
            state.hover=index<0?null:index;candlePointerY=null;tooltip.hidden=true;candleTooltip.hidden=true;draw();
        });
        function hoverChart(event) {
            if (state.busy || state.drag || !geometry?.points.length) return;
            candlePointerY = event.currentTarget === candleCanvas ? event.clientY - candleCanvas.getBoundingClientRect().top : null;
            const { plot, points, x, width } = geometry;
            const offset = event.clientX - event.currentTarget.getBoundingClientRect().left;
            if (offset < plot.left || offset > plot.right) { clearHover(); return; }
            const index = points.reduce((best,_,i)=>Math.abs(x(i)-offset)<Math.abs(x(best)-offset)?i:best,0);
            const point = points[index]; state.hover = index;
            const change = candleChange(point);
            const date = `${point.time.slice(0,4)}-${point.time.slice(4,6)}-${point.time.slice(6,8)}`;
            const text = `${date}${state.mode === 'minute' ? ` ${formatTime(point.time)}` : ''} · 쏠림율 ${point.value == null ? '-' : `${point.value.toFixed(2)}%`} · 상승률 ${change == null ? '-' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`}`;
            tooltip.textContent = text;
            tooltip.hidden = false;
            candleTooltip.hidden = true;
            draw();
        }
        function clearHover() { state.hover = null; candlePointerY = null; tooltip.hidden = true; candleTooltip.hidden = true; draw(); }
        [canvas, candleCanvas].forEach(surface => {
            surface.addEventListener('mousemove', hoverChart);
            surface.addEventListener('mouseleave', clearHover);
        });
        const observer = new MutationObserver(selectedRows);
        ['transactionBody', 'tableBody', 'efriendTableBody'].forEach(id => {
            const body = document.getElementById(id); if (body) observer.observe(body, { childList: true });
        });
        const transactionPanel = document.getElementById('transactionTable')?.closest('.panel');
        function matchTransactionWidth() {
            const width = transactionPanel?.getBoundingClientRect().width;
            if (width > 0 && panel.style.getPropertyValue('--concentration-base-width') !== `${width}px`) {
                panel.style.setProperty('--concentration-base-width', `${width}px`);
            }
        }
        let resizeFrame = null;
        function scheduleChartResize() {
            if (resizeFrame !== null) return;
            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = null;
                matchTransactionWidth();
                draw();
            });
        }
        if (transactionPanel) new ResizeObserver(scheduleChartResize).observe(transactionPanel);
        matchTransactionWidth();
        new ResizeObserver(scheduleChartResize).observe(chartArea);
        document.addEventListener('rank-concentration-selection', event => {
            if (event.detail.source !== chartKey && event.detail.stock?.code !== state.selection?.code) chooseStock(event.detail.stock);
        });
        if (kis) document.addEventListener('rank-chart-state', () => {
            const selection = window.getRankChartState?.()?.selection;
            if (selection && selection.code !== state.selection?.code) chooseStock(selection);
        });
        selectedRows(); draw();
    }
})();
