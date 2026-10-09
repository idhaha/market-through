(() => {
    'use strict';
    const scopes = [1, 3, 5, 10, 15, 30, 45, 60];
    const state = { selection: null, mode: 'day', interval: 1, points: [], cursor: null,
        hasMore: false, busy: false, visible: 0, start: 0, request: 0, controller: null, hover: null, drag: null };
    const encoded = value => encodeURIComponent(String(value || '')).replace(/'/g, '%27');
    window.rankChartRowAttributes = (stock, efriend = false) => {
        const code = String(efriend ? stock.pdno || '' : stock.stk_cd || '').replace(/_(AL|NX)$/i, '');
        if (!/^[0-9A-Za-z]{6}$/.test(code)) return '';
        const name = efriend ? stock.prdt_name : stock.stk_nm || stock.isu_nm;
        const market = ['K', 'Q'].includes(stock.mkt_type) ? stock.mkt_type : '';
        return `data-chart-code="${code}" data-chart-name="${encoded(name || code)}" data-chart-market="${market}" tabindex="0" role="button" aria-label="${encoded(name || code)}"`;
    };

    document.addEventListener('DOMContentLoaded', () => {
        const panel = document.getElementById('concentrationChartPanel');
        if (!panel) return;
        const canvas = document.getElementById('concentrationCanvas');
        const status = document.getElementById('concentrationStatus');
        const name = document.getElementById('concentrationStockName');
        const market = document.getElementById('concentrationMarket');
        const more = document.getElementById('concentrationMore');
        const slider = document.getElementById('concentrationRange');
        const zoomIn = document.getElementById('concentrationZoomIn');
        const zoomOut = document.getElementById('concentrationZoomOut');
        const tooltip = document.getElementById('concentrationTooltip');
        const currentRate = document.getElementById('concentrationCurrentRate');
        const debugToggle = document.getElementById('concentrationDebugToggle');
        const debugPanel = document.getElementById('concentrationFiveDebug');
        const chartArea = canvas.parentElement;
        const ctx = canvas.getContext('2d');
        const candleCanvas = document.getElementById('concentrationCandleCanvas');
        const candleArea = document.getElementById('concentrationCandleArea');
        const candleTooltip = document.getElementById('concentrationCandleTooltip');
        const candleToggle = document.getElementById('concentrationCandleToggle');
        const candleCtx = candleCanvas.getContext('2d');
        let geometry = null;
        let candleGeometry = null;

        const debugStatus = document.getElementById('concentrationDebugStatus');
        let debugBusy = false;
        let debugCode = null;
        let debugController = null;
        let debugRequest = 0;
        function renderDebugBars(id, title, bars) {
            const container = document.getElementById(id);
            container.replaceChildren();
            const heading = document.createElement('strong'); heading.textContent = title; container.append(heading);
            const table = document.createElement('table');
            const header = table.createTHead().insertRow();
            ['cntr_tm', 'cur_prc', 'trde_qty', '계산 거래대금(원)'].forEach(text => {
                const cell = document.createElement('th'); cell.textContent = text; header.append(cell);
            });
            const body = table.createTBody();
            (bars || []).forEach(bar => {
                const row = body.insertRow();
                const time = String(bar.cntr_tm || '');
                const parse = value => {
                    const text = String(value ?? '').replace(/,/g, '').trim();
                    return /^[+-]?\d+$/.test(text) ? Number(text) : NaN;
                };
                const price = Math.abs(parse(bar.cur_prc)), volume = parse(bar.trde_qty);
                const amount = id === 'concentrationDebugMarket' ? (price / 100) * (volume * 10000) : price * volume;
                const formatted = Number.isFinite(amount) && volume >= 0 ? amount.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : null;
                [`${time.slice(4,6)}/${time.slice(6,8)} ${time.slice(8,10)}:${time.slice(10,12)}`, bar.cur_prc, bar.trde_qty, formatted]
                    .forEach(value => { row.insertCell().textContent = value == null ? '-' : String(value); });
            });
            container.append(table);
        }
        let debugClosingDate = null;
        function debugSessionTime() {
            const korea = new Date(Date.now() + 9 * 60 * 60 * 1000);
            return { day: korea.getUTCDay(), date: korea.toISOString().slice(0, 10),
                seconds: korea.getUTCHours() * 3600 + korea.getUTCMinutes() * 60 + korea.getUTCSeconds() };
        }
        async function refreshFiveDebug(closingTick = false) {
            if (!state.selection || document.hidden || (typeof isCapturing !== 'undefined' && isCapturing)) return;
            const session = debugSessionTime();
            const weekday = session.day !== 0 && session.day !== 6;
            const trading = weekday && session.seconds >= 9 * 3600 && session.seconds < 15 * 3600 + 30 * 60;
            const finalBar = weekday && closingTick && session.seconds >= 15 * 3600 + 30 * 60
                && session.seconds < 15 * 3600 + 31 * 60 && debugClosingDate !== session.date;
            if (!trading && !finalBar) {
                debugStatus.textContent = 'KRX 정규장 외 · 디버깅 갱신 중지';
                return;
            }
            const selection = { ...state.selection };
            if (debugBusy && debugCode === selection.code) return;
            debugController?.abort();
            const request = ++debugRequest;
            const changed = debugCode !== selection.code;
            debugCode = selection.code;
            debugBusy = true;
            const controller = new AbortController(); debugController = controller;
            const timeout = setTimeout(() => controller.abort(), 60000);
            if (changed) {
                renderDebugBars('concentrationDebugStock', `${selection.name} · ka10080`, []);
                renderDebugBars('concentrationDebugMarket', '해당 시장 · ka20005', []);
            }
            debugStatus.textContent = '5분봉 조회 중';
            try {
                const response = await fetch('/api/concentration-chart', { method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: selection.code, mode: 'minute', interval: 5, debug_five: true }), signal: controller.signal });
                const result = await response.json();
                if (request !== debugRequest || state.selection?.code !== selection.code) return;
                if (!response.ok || !result.success) throw new Error(result.error || '조회 실패');
                if (!result.debug_five_bars) throw new Error('5분봉 원본 응답이 없습니다. 서버 재시작을 확인하세요.');
                renderDebugBars('concentrationDebugStock', `${selection.name} · ka10080 · 통합 거래소`, result.debug_five_bars.stock);
                renderDebugBars('concentrationDebugMarket', result.market === 'Q' ? '코스닥 · ka20005 · 업종 101' : '코스피 · ka20005 · 업종 001', result.debug_five_bars.market);
                if (finalBar) debugClosingDate = session.date;
                const empty = !result.debug_five_bars.stock.length || !result.debug_five_bars.market.length;
                debugStatus.textContent = `${empty ? '완료된 5분봉 데이터가 부족합니다. · ' : ''}조회 ${new Date(result.debug_five_bars.fetched_at).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} · 시장과 동일 봉 시각${finalBar ? ' · KRX 종료, 갱신 중지' : ''}`;
            } catch (error) {
                if (request === debugRequest && error.name !== 'AbortError') debugStatus.textContent = `${error.message} · 다음 5분 마감에 재조회`;
            } finally {
                clearTimeout(timeout);
                if (request === debugRequest) debugBusy = false;
            }
        }
        function scheduleFiveDebug() {
            const delay = 300000 - (Date.now() % 300000) + 2000;
            setTimeout(async () => { await refreshFiveDebug(true); scheduleFiveDebug(); }, delay);
        }
        refreshFiveDebug();
        scheduleFiveDebug();
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFiveDebug(); });

        window.getConcentrationDisplaySettings = () => ({
            debugOpen: !debugPanel.hidden, candleOpen: !candleArea.hidden, mode: state.mode, interval: state.interval
        });
        window.applyConcentrationDisplaySettings = settings => {
            const mode = settings?.mode === 'minute' ? 'minute' : 'day';
            const interval = scopes.includes(Number(settings?.interval)) ? Number(settings.interval) : 1;
            const changed = state.mode !== mode || state.interval !== interval;
            state.mode = mode; state.interval = interval;
            debugPanel.hidden = settings?.debugOpen !== true;
            candleArea.hidden = settings?.candleOpen !== true;
            panel.classList.toggle('debug-collapsed', debugPanel.hidden);
            debugToggle.setAttribute('aria-expanded', String(!debugPanel.hidden));
            debugToggle.setAttribute('aria-label', debugPanel.hidden ? '디버깅 펼치기' : '디버깅 접기');
            debugToggle.title = debugPanel.hidden ? '디버깅 펼치기' : '디버깅 접기';
            candleToggle.setAttribute('aria-expanded', String(!candleArea.hidden));
            candleToggle.textContent = '캔들차트';
            candleToggle.setAttribute('aria-label', candleArea.hidden ? '캔들차트 펼치기' : '캔들차트 접기');
            state.hover = null; tooltip.hidden = true; candleTooltip.hidden = true;
            draw();
            if (changed && state.selection) load();
        };
        function saveDisplaySettings() {
            if (typeof saveAppData === 'function') saveAppData();
        }
        debugToggle.addEventListener('click', () => {
            const settings = window.getConcentrationDisplaySettings();
            settings.debugOpen = !settings.debugOpen;
            window.applyConcentrationDisplaySettings(settings);
            saveDisplaySettings();
        });
        function updateControls() {
            debugToggle.disabled = state.busy;
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
        }
        function selectedRows() {
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
        function drawCandles(points, plot, x, ratio, labels, boundaries) {
            candleGeometry = null;
            if (candleArea.hidden) return;
            const width = chartArea.clientWidth, height = candleArea.clientHeight;
            candleCanvas.width = Math.round(width * ratio); candleCanvas.height = Math.round(height * ratio);
            candleCtx.setTransform(ratio, 0, 0, ratio, 0, 0); candleCtx.clearRect(0, 0, width, height);
            const top = 36, bottom = height - 30;
            const candles = points.filter(validCandle);
            if (!candles.length) {
                candleCtx.fillStyle = '#64748b'; candleCtx.font = '12px Inter, sans-serif'; candleCtx.textAlign = 'center';
                candleCtx.fillText('캔들 데이터가 없습니다.', width / 2, height / 2); return;
            }
            let minimum = candles.reduce((min, p) => Math.min(min, p.stock_low), Infinity);
            let maximum = candles.reduce((max, p) => Math.max(max, p.stock_high), -Infinity);
            const padding = Math.max((maximum - minimum) * .08, maximum * .001);
            minimum -= padding; maximum += padding;
            const y = price => bottom - (price - minimum) / (maximum - minimum) * (bottom - top);
            const candleWidth = Math.max(1, Math.min(10, (plot.right - plot.left - 24) / Math.max(1, points.length) * .7));
            candleGeometry = { plot: { ...plot, top, bottom }, points, x, y, candleWidth, width, height };
            candleCtx.font = '11px Inter, sans-serif'; candleCtx.textBaseline = 'middle';
            for (let tick = 0; tick <= 4; tick++) {
                const price = minimum + (maximum - minimum) * tick / 4;
                candleCtx.beginPath(); candleCtx.setLineDash([3,5]); candleCtx.strokeStyle = '#d6dbe1';
                candleCtx.moveTo(plot.left, y(price)); candleCtx.lineTo(plot.right, y(price)); candleCtx.stroke();
                candleCtx.fillStyle = '#64748b'; candleCtx.textAlign = 'left';
                candleCtx.fillText(Math.round(price).toLocaleString('ko-KR'), plot.right + 8, y(price));
            }
            candleCtx.setLineDash([]);
            boundaries.forEach(boundaryX => {
                candleCtx.beginPath(); candleCtx.setLineDash([3, 5]); candleCtx.strokeStyle = '#d6dbe1';
                candleCtx.moveTo(boundaryX, top); candleCtx.lineTo(boundaryX, bottom); candleCtx.stroke();
            });
            candleCtx.setLineDash([]);
            const bodyWidth = Math.max(1, Math.min(10, (plot.right - plot.left - 24) / Math.max(1, points.length) * .7));
            points.forEach((point, i) => {
                if (!validCandle(point)) return;
                const color = point.stock_price > point.stock_open ? '#e11d48' : point.stock_price < point.stock_open ? '#2563eb' : '#64748b';
                candleCtx.strokeStyle = color; candleCtx.fillStyle = color; candleCtx.lineWidth = 1;
                candleCtx.beginPath(); candleCtx.moveTo(x(i), y(point.stock_high)); candleCtx.lineTo(x(i), y(point.stock_low)); candleCtx.stroke();
                const bodyTop = Math.min(y(point.stock_open), y(point.stock_price));
                candleCtx.fillRect(x(i) - bodyWidth / 2, bodyTop, bodyWidth, Math.max(1, Math.abs(y(point.stock_open) - y(point.stock_price))));
            });
            if (state.hover != null && points[state.hover]) {
                candleCtx.beginPath(); candleCtx.setLineDash([3,3]); candleCtx.strokeStyle = '#94a3b8';
                candleCtx.moveTo(x(state.hover), top); candleCtx.lineTo(x(state.hover), bottom); candleCtx.stroke(); candleCtx.setLineDash([]);
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
            const settings = window.getConcentrationDisplaySettings();
            settings.candleOpen = !settings.candleOpen;
            window.applyConcentrationDisplaySettings(settings);
            saveDisplaySettings();
        });
        function draw() {
            if (state.busy && state.points.length) { updateControls(); return; }
            const width = chartArea.clientWidth;
            if (!width) return;
            const height = chartArea.clientHeight;
            const ratio = window.devicePixelRatio || 1;
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.clearRect(0, 0, width, height);
            const plot = { left: 16, top: 18, right: width - 58, bottom: height - 34 };
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
            plot.right = width - Math.max(58, priceMargin, ctx.measureText(`${axisMaximum.toLocaleString()}%`).width + 18) - 26;
            debugToggle.style.left = `${width - 22}px`;
            debugToggle.style.top = `${(plot.top + plot.bottom) / 2 - 13}px`;
            const xLabels = [];
            const boundaries = [];
            canvas.setAttribute('aria-label', `시장 거래대금 대비 종목 거래대금 비율 차트, 세로축 0~${axisMaximum.toLocaleString()}%, 자동 범위`);
            const x = index => points.length <= 1 ? (plot.left + plot.right) / 2
                : plot.left + index / (points.length - 1) * (plot.right - plot.left - 24);
            const y = value => plot.bottom - value / axisMaximum * (plot.bottom - plot.top);
            geometry = { plot, points, x, y, width, height };
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#64748b';
            for (let tick = 0; tick <= tickCount; tick++) {
                const percent = tick * tickStep;
                ctx.beginPath(); ctx.setLineDash([3, 5]); ctx.strokeStyle = '#d6dbe1';
                ctx.moveTo(plot.left, y(percent)); ctx.lineTo(plot.right, y(percent)); ctx.stroke();
                ctx.fillText(`${percent.toLocaleString()}%`, plot.right + 10, y(percent));
            }
            // Daily bars already represent dates; a separator on every bar forms a dense mesh.
            // Show month boundaries for daily charts and day boundaries for minute charts.
            const boundaryLength = state.mode === 'day' ? 6 : 8;
            let lastDay = points[0]?.time.slice(0, boundaryLength);
            let lastBoundaryX = -Infinity;
            for (let i = 1; i < points.length; i++) {
                const day = points[i].time.slice(0, boundaryLength);
                if (day !== lastDay) {
                    if (x(i) - lastBoundaryX >= 32) {
                        ctx.beginPath(); ctx.setLineDash([3, 5]); ctx.strokeStyle = '#d6dbe1';
                        ctx.moveTo(x(i), plot.top); ctx.lineTo(x(i), plot.bottom); ctx.stroke();
                        lastBoundaryX = x(i);
                        boundaries.push(lastBoundaryX);
                    }
                    lastDay = day;
                }
            }
            ctx.setLineDash([]);
            if (!points.length) {
                ctx.textAlign = 'center'; ctx.fillStyle = '#64748b';
                if (!state.busy) ctx.fillText(state.selection
                    ? '표시할 데이터가 없습니다.' : '위 테이블에서 종목을 선택하세요.', width / 2, height / 2);
            } else {
                ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top); ctx.clip();
                ctx.lineWidth = 1.5; ctx.strokeStyle = '#ea580c'; ctx.beginPath();
                let connected = false;
                points.forEach((point, i) => {
                    if (point.value == null) { connected = false; return; }
                    if (connected) ctx.lineTo(x(i), y(point.value)); else ctx.moveTo(x(i), y(point.value));
                    connected = true;
                });
                ctx.stroke();
                // Mark every valid candle, including full-history views.
                points.forEach((point, i) => {
                    if (point.value == null) return;
                    ctx.beginPath(); ctx.fillStyle = '#ea580c'; ctx.arc(x(i), y(point.value), 2, 0, 2 * Math.PI); ctx.fill();
                });
                ctx.restore();
                const latest = points.at(-1);
                if (Number.isFinite(latest?.value) && latest.time === state.points.at(-1)?.time) {
                    const lastX = x(points.length - 1);
                    const lastY = y(latest.value);
                    ctx.beginPath(); ctx.fillStyle = '#2563eb'; ctx.arc(lastX, lastY, 4, 0, 2 * Math.PI); ctx.fill();
                    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
                }
                const singleDay = points[0].time.slice(0, 8) === points.at(-1).time.slice(0, 8);
                const timeLabels = state.mode === 'minute' && (singleDay || points.length <= 120);
                ctx.fillStyle = '#64748b'; ctx.textAlign = 'center';
                if (timeLabels) {
                    const plotWidth = plot.right - plot.left;
                    const halfHours = [];
                    let previousBucket = '';
                    points.forEach((point, i) => {
                        const bucket = `${point.time.slice(0, 10)}${Number(point.time.slice(10, 12)) < 30 ? '00' : '30'}`;
                        if (bucket !== previousBucket) halfHours.push({ i, bucket });
                        previousBucket = bucket;
                    });
                    const zoomed = state.visible < state.points.length;
                    const halfHourSpacing = halfHours.slice(1).reduce((minimum, tick, i) =>
                        Math.min(minimum, x(tick.i) - x(halfHours[i].i)), Infinity);
                    const showHalfHours = zoomed && halfHours.length > 1 && halfHourSpacing >= 65;
                    const ticks = showHalfHours ? halfHours : halfHours.filter((tick, i) =>
                        i === 0 || tick.bucket.slice(0, 10) !== halfHours[i - 1].bucket.slice(0, 10));
                    const maxLabels = Math.max(1, Math.floor(plotWidth / (showHalfHours ? 65 : 45)));
                    const stride = Math.max(1, Math.ceil(ticks.length / maxLabels));
                    ticks.forEach(({ i, bucket }, index) => {
                        if (index % stride !== 0) return;
                        const label = showHalfHours ? `${bucket.slice(8, 10)}:${bucket.slice(10, 12)}` : bucket.slice(8, 10);
                        const halfWidth = ctx.measureText(label).width / 2;
                        const labelX = Math.min(plot.right - halfWidth, Math.max(plot.left + halfWidth, x(i)));
                        ctx.fillText(label, labelX, height - 14);
                        xLabels.push({ label, labelX });
                    });
                } else {
                    const labelCount = Math.max(2, Math.floor((plot.right - plot.left) / 130));
                    const step = Math.max(1, Math.ceil(points.length / labelCount));
                    let previousDate = '';
                    for (let i = 0; i < points.length; i += step) {
                        const label = formatDate(points[i].time);
                        if (label === previousDate) continue;
                        const halfWidth = ctx.measureText(label).width / 2;
                        const labelX = Math.min(plot.right - halfWidth, Math.max(plot.left + halfWidth, x(i)));
                        ctx.fillText(label, labelX, height - 14);
                        xLabels.push({ label, labelX });
                        previousDate = label;
                    }
                }
                if (state.hover != null && points[state.hover]) {
                    ctx.beginPath(); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#94a3b8';
                    ctx.moveTo(x(state.hover), plot.top); ctx.lineTo(x(state.hover), plot.bottom); ctx.stroke(); ctx.setLineDash([]);
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
                ? `${current.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%` : '-';
            const first = points[0], last = points.at(-1);
            document.getElementById('concentrationPeriod').textContent = first
                ? `${formatDate(first.time)}${state.mode === 'minute' ? ` ${formatTime(first.time)}` : ''} — ${formatDate(last.time)}${state.mode === 'minute' ? ` ${formatTime(last.time)}` : ''} · ${points.length.toLocaleString()} / ${state.points.length.toLocaleString()}봉`
                : '쏠림율';
            updateControls();
        }
        async function load(append = false, refresh = false) {
            if (!state.selection || (append && state.busy)) return;
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
                const response = await fetch('/api/concentration-chart', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: state.selection.code, mode: state.mode, interval: state.interval, cursor: append ? state.cursor : null }),
                    signal: controller.signal
                });
                const result = await response.json();
                if (request !== state.request) return;
                if (!response.ok || !result.success) throw new Error(result.error || '차트 조회 실패');
                if (debugCode !== state.selection.code) refreshFiveDebug();
                const freshPoints = state.mode === 'minute' ? result.points.filter(point => Number.isFinite(point.value)) : result.points;
                if ((refresh || append) && previous.points.length && result.points.length) {
                    const earliest = result.points[0].time;
                    state.points = [...previous.points.filter(point => point.time < earliest), ...freshPoints];
                } else {
                    state.points = refresh && !result.points.length ? previous.points : freshPoints;
                }
                state.cursor = result.cursor; state.hasMore = result.has_more;
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
                const valid = state.points.filter(point => point.value != null).length;
                status.textContent = result.history_pending ? '시장 과거 데이터가 더 필요합니다. 추가 조회 버튼을 눌러 주세요.'
                    : !state.points.length ? '표시할 데이터가 없습니다.' : !valid ? '같은 날짜·시간의 시장 거래대금이 없어 계산할 수 없습니다.'
                    : '';
            } catch (error) {
                if (request !== state.request || error.name === 'AbortError') return;
                if (!append && !refresh) { state.points = []; state.start = 0; state.visible = 0; }
                status.textContent = `${error.message} · ${refresh ? '다음 갱신 주기에 다시 조회합니다.' : append ? '추가 조회 버튼으로 다시 시도하세요.' : '일/분 버튼으로 다시 시도하세요.'}`;
                if (error.message.includes('만료')) { state.cursor = null; state.hasMore = false; }
            } finally {
                if (request === state.request) { state.busy = false; draw(); }
            }
        }
        window.refreshConcentrationChart = () => {
            if (!state.selection || state.busy || state.drag || (typeof isCapturing !== 'undefined' && isCapturing)) return;
            return load(false, true);
        };
        let lookupVersion = 0;
        const suggestions = document.getElementById('concentrationStockSuggestions');
        let suggestionVersion = 0, suggestionTimer, suggestionRows = [], activeSuggestion = -1, lastSuggestionQuery = null;
        function hideSuggestions() {
            suggestionVersion++; clearTimeout(suggestionTimer); suggestions.hidden = true;
            name.setAttribute('aria-expanded', 'false'); name.removeAttribute('aria-activedescendant');
            suggestionRows = []; activeSuggestion = -1; lastSuggestionQuery = null;
        }
        function chooseStock(stock) {
            lookupVersion++; hideSuggestions();
            state.selection = { code: stock.code, name: stock.name };
            name.value = stock.name; market.textContent = stock.market === 'K' ? '코스피' : '코스닥';
            selectedRows(); load(); refreshFiveDebug();
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
                        const item = document.createElement('div'); item.id = `stock-suggestion-${i}`;
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
        name.addEventListener('blur', hideSuggestions);
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
            lookupVersion++; hideSuggestions();
            state.selection = { code: row.dataset.chartCode, name: decodeURIComponent(row.dataset.chartName) };
            name.value = state.selection.name;
            market.textContent = row.dataset.chartMarket === 'K' ? '코스피' : row.dataset.chartMarket === 'Q' ? '코스닥' : '-';
            selectedRows(); load(); refreshFiveDebug();
        }
        document.getElementById('tab_rank').addEventListener('click', event => {
            const row = event.target.closest('tr[data-chart-code]');
            if (row) selectRow(row);
        });
        document.getElementById('tab_rank').addEventListener('keydown', event => {
            const row = event.target.closest('tr[data-chart-code]');
            if (row && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectRow(row); }
        });
        panel.querySelectorAll('[data-chart-mode]').forEach(button => button.addEventListener('click', () => {
            state.mode = button.dataset.chartMode; updateControls(); saveDisplaySettings(); load();
        }));
        panel.querySelectorAll('[data-chart-interval]').forEach(button => button.addEventListener('click', () => {
            const interval = Number(button.dataset.chartInterval);
            if (state.mode !== 'minute' || !scopes.includes(interval)) return;
            state.interval = interval; updateControls(); saveDisplaySettings(); load();
        }));
        more.addEventListener('click', () => load(true));
        function zoom(factor) {
            if (!state.points.length) return;
            const center = state.start + state.visible / 2;
            state.visible = Math.min(state.points.length, Math.max(Math.min(10, state.points.length), Math.round(state.visible * factor)));
            state.start = Math.max(0, Math.min(state.points.length - state.visible, Math.round(center - state.visible / 2)));
            state.hover = null; tooltip.hidden = true; draw();
        }
        zoomIn.addEventListener('click', () => zoom(0.5));
        zoomOut.addEventListener('click', () => zoom(2));
        slider.addEventListener('input', () => { state.start = Number(slider.value); state.hover = null; tooltip.hidden = true; draw(); });
        const dragX = event => Math.max(geometry.plot.left, Math.min(geometry.plot.right - 24,
            event.clientX - event.currentTarget.getBoundingClientRect().left));
        [canvas, candleCanvas].forEach(surface => {
        surface.addEventListener('pointerdown', event => {
            if (event.button !== 0 || state.busy || !geometry?.points.length) return;
            if (state.drag) return;
            const graph = surface === candleCanvas ? candleGeometry : geometry;
            if (!graph) return;
            const bounds = surface.getBoundingClientRect();
            const offsetX = event.clientX - bounds.left;
            const offsetY = event.clientY - bounds.top;
            if (offsetX < geometry.plot.left || offsetX > geometry.plot.right - 24 || offsetY < graph.plot.top || offsetY > graph.plot.bottom) return;
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
                if (drag.endX > drag.startX) {
                    const span = geometry.plot.right - geometry.plot.left - 24;
                    const first = Math.floor((drag.startX - geometry.plot.left) / span * (drag.visible - 1));
                    const last = Math.ceil((drag.endX - geometry.plot.left) / span * (drag.visible - 1));
                    state.visible = Math.min(state.points.length, Math.max(Math.min(10, state.points.length), last - first + 1));
                    state.start = Math.min(state.points.length - state.visible, drag.start + first);
                } else {
                    state.visible = state.points.length;
                    state.start = 0;
                }
            }
            state.hover = null; tooltip.hidden = true; draw();
        });
        function cancelDrag() {
            if (!state.drag || state.drag.surface !== surface) return;
            state.drag = null; state.hover = null; tooltip.hidden = true; draw();
        }
        surface.addEventListener('pointercancel', cancelDrag);
        surface.addEventListener('lostpointercapture', cancelDrag);
        });
        function segmentHitsBox(ax, ay, bx, by, box) {
            let low = 0, high = 1;
            const dx = bx - ax, dy = by - ay;
            const tests = [[-dx, ax - box.left], [dx, box.right - ax], [-dy, ay - box.top], [dy, box.bottom - ay]];
            for (const [p, q] of tests) {
                if (p === 0) { if (q < 0) return false; continue; }
                const fraction = q / p;
                if (p < 0) low = Math.max(low, fraction); else high = Math.min(high, fraction);
                if (low > high) return false;
            }
            return true;
        }
        function positionHoverInfo(tip, graph, candle = false) {
            if (!graph || state.hover == null) { tip.hidden = true; return; }
            tip.hidden = false;
            const { plot, points, x, y, width } = graph;
            const point = points[state.hover];
            if (!point) { tip.hidden = true; return; }
            const highY = candle ? (validCandle(point) ? y(point.stock_high) : (plot.top + plot.bottom) / 2) : Number.isFinite(point.value) ? y(point.value) : plot.top;
            const lowY = candle && validCandle(point) ? y(point.stock_low) : highY;
            const preferTop = highY - plot.top >= plot.bottom - lowY;
            tip.style.maxWidth = `${Math.max(40, plot.right - plot.left - 8)}px`;
            const boxWidth = tip.offsetWidth, boxHeight = tip.offsetHeight;
            const leftLimit = Math.max(4, plot.left + 4);
            const rightLimit = Math.max(leftLimit, Math.min(width - boxWidth - 4, plot.right - boxWidth - 4));
            const clamp = value => Math.max(leftLimit, Math.min(rightLimit, value));
            const anchor = clamp(x(state.hover) - boxWidth / 2);
            const candidates = [anchor, clamp(x(state.hover) + 12), clamp(x(state.hover) - boxWidth - 12), leftLimit, rightLimit];
            for (let left = leftLimit; left <= rightLimit; left += 12) candidates.push(left);
            candidates.sort((a,b) => Math.abs(a - anchor) - Math.abs(b - anchor));
            let best = null;
            for (const isTop of [preferTop, !preferTop]) {
                const top = isTop ? 4 : Math.max(4, plot.bottom - boxHeight - 4);
                for (const left of candidates) {
                    const box = { left: left - 5, right: left + boxWidth + 5, top: top - 5, bottom: top + boxHeight + 5 };
                    let collisions = 0;
                    points.forEach((p, i) => {
                        if (candle) {
                            if (!validCandle(p)) return;
                            const half = graph.candleWidth / 2;
                            if (x(i) + half >= box.left && x(i) - half <= box.right && y(p.stock_low) >= box.top && y(p.stock_high) <= box.bottom) collisions++;
                        } else if (Number.isFinite(p.value)) {
                            if (segmentHitsBox(x(i), y(p.value), x(i), y(p.value), box)) collisions++;
                            if (i && Number.isFinite(points[i - 1].value) && segmentHitsBox(x(i - 1), y(points[i - 1].value), x(i), y(p.value), box)) collisions++;
                        }
                    });
                    if (!best || collisions < best.collisions) best = { left, top, collisions };
                    if (!collisions) break;
                }
                if (best?.collisions === 0) break;
            }
            tip.style.left = `${best.left}px`; tip.style.top = `${best.top}px`;
        }
        function hoverChart(event) {
            if (state.busy || state.drag || !geometry?.points.length) return;
            const { plot, points, x, width } = geometry;
            const offset = event.clientX - event.currentTarget.getBoundingClientRect().left;
            if (offset < plot.left || offset > plot.right) { clearHover(); return; }
            const index = Math.max(0, Math.min(points.length - 1, Math.round((offset - plot.left) / (plot.right - plot.left - 24) * (points.length - 1))));
            const point = points[index]; state.hover = index;
            const change = candleChange(point);
            const text = `${formatDate(point.time)}${state.mode === 'minute' ? ` ${formatTime(point.time)}` : ''} · 쏠림율 ${point.value == null ? '-' : `${point.value.toFixed(2)}%`} · 상승률 ${change == null ? '-' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`}`;
            [tooltip, candleTooltip].forEach(tip => {
                tip.textContent = text;
                tip.hidden = false;
            });
            draw();
            positionHoverInfo(tooltip, geometry);
            positionHoverInfo(candleTooltip, candleGeometry, true);
        }
        function clearHover() { state.hover = null; tooltip.hidden = true; candleTooltip.hidden = true; draw(); }
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
            if (width > 0) panel.style.setProperty('--concentration-base-width', `${width}px`);
        }
        if (transactionPanel) new ResizeObserver(matchTransactionWidth).observe(transactionPanel);
        matchTransactionWidth();
        new ResizeObserver(draw).observe(chartArea);
        selectedRows(); draw();
    });
})();
