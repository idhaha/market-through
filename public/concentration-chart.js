(() => {
    'use strict';
    const scopes = [1, 3, 5, 10, 15, 30, 45, 60];
    const state = { selection: null, mode: 'minute', interval: 1, points: [], cursor: null,
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
        const chartArea = canvas.parentElement;
        const ctx = canvas.getContext('2d');
        let geometry = null;

        function updateControls() {
            canvas.classList.toggle('is-loading', state.busy);
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
            plot.right = width - Math.max(58, ctx.measureText(`${axisMaximum.toLocaleString()}%`).width + 18);
            canvas.setAttribute('aria-label', `시장 거래대금 대비 종목 거래대금 비율 차트, 세로축 0~${axisMaximum.toLocaleString()}%, 자동 범위`);
            const x = index => points.length <= 1 ? (plot.left + plot.right) / 2
                : plot.left + index / (points.length - 1) * (plot.right - plot.left - 24);
            const y = value => plot.bottom - value / axisMaximum * (plot.bottom - plot.top);
            geometry = { plot, points, x, width, height };
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
                // Dots also make isolated valid bars visible between missing values.
                if (points.length <= 150) points.forEach((point, i) => {
                    if (point.value == null) return;
                    ctx.beginPath(); ctx.fillStyle = '#ea580c'; ctx.arc(x(i), y(point.value), 2, 0, 2 * Math.PI); ctx.fill();
                });
                ctx.restore();
                const latest = points.at(-1);
                if (Number.isFinite(latest?.value)) {
                    const lastX = x(points.length - 1);
                    const lastY = y(latest.value);
                    ctx.beginPath(); ctx.fillStyle = '#ea580c'; ctx.arc(lastX, lastY, 3, 0, 2 * Math.PI); ctx.fill();
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
        function selectRow(row) {
            state.selection = { code: row.dataset.chartCode, name: decodeURIComponent(row.dataset.chartName) };
            name.textContent = state.selection.name;
            market.textContent = row.dataset.chartMarket === 'K' ? '코스피' : row.dataset.chartMarket === 'Q' ? '코스닥' : '-';
            selectedRows(); load();
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
            state.mode = button.dataset.chartMode; updateControls(); load();
        }));
        panel.querySelectorAll('[data-chart-interval]').forEach(button => button.addEventListener('click', () => {
            const interval = Number(button.dataset.chartInterval);
            if (state.mode !== 'minute' || !scopes.includes(interval)) return;
            state.interval = interval; updateControls(); load();
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
            event.clientX - canvas.getBoundingClientRect().left));
        canvas.addEventListener('pointerdown', event => {
            if (event.button !== 0 || state.busy || !geometry?.points.length) return;
            const bounds = canvas.getBoundingClientRect();
            const offsetX = event.clientX - bounds.left;
            const offsetY = event.clientY - bounds.top;
            if (offsetX < geometry.plot.left || offsetX > geometry.plot.right - 24 || offsetY < geometry.plot.top || offsetY > geometry.plot.bottom) return;
            state.drag = { pointerId: event.pointerId, startX: dragX(event), endX: dragX(event), start: state.start, visible: state.visible };
            state.hover = null; tooltip.hidden = true;
            canvas.setPointerCapture(event.pointerId);
            draw();
        });
        canvas.addEventListener('pointermove', event => {
            if (!state.drag || state.drag.pointerId !== event.pointerId) return;
            state.drag.endX = dragX(event);
            draw();
        });
        canvas.addEventListener('pointerup', event => {
            if (!state.drag || state.drag.pointerId !== event.pointerId) return;
            const drag = state.drag;
            drag.endX = dragX(event);
            state.drag = null;
            if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
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
            if (!state.drag) return;
            state.drag = null; state.hover = null; tooltip.hidden = true; draw();
        }
        canvas.addEventListener('pointercancel', cancelDrag);
        canvas.addEventListener('lostpointercapture', cancelDrag);
        canvas.addEventListener('mousemove', event => {
            if (state.busy || state.drag || !geometry?.points.length) return;
            const { plot, points, x, width } = geometry;
            const offset = event.clientX - canvas.getBoundingClientRect().left;
            if (offset < plot.left || offset > plot.right) { tooltip.hidden = true; state.hover = null; draw(); return; }
            const index = Math.max(0, Math.min(points.length - 1, Math.round((offset - plot.left) / (plot.right - plot.left - 24) * (points.length - 1))));
            const point = points[index]; state.hover = index;
            tooltip.textContent = `${formatDate(point.time)}${state.mode === 'minute' ? ` ${formatTime(point.time)}` : ''} · ${point.value == null ? '-' : `${point.value.toFixed(2)}%`}`;
            tooltip.hidden = false;
            tooltip.style.left = `${Math.max(8, Math.min(width - tooltip.offsetWidth - 8, x(index) + 12))}px`;
            draw();
        });
        canvas.addEventListener('mouseleave', () => { state.hover = null; tooltip.hidden = true; draw(); });
        const observer = new MutationObserver(selectedRows);
        ['transactionBody', 'tableBody', 'efriendTableBody'].forEach(id => {
            const body = document.getElementById(id); if (body) observer.observe(body, { childList: true });
        });
        new ResizeObserver(draw).observe(chartArea);
        selectedRows(); draw();
    });
})();
