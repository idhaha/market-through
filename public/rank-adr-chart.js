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
        panel.innerHTML = `<div class="concentration-chart-header"><select class="interval-select" aria-label="ADR 시장 선택"><option value="kospi">KOSPI</option><option value="kosdaq">KOSDAQ</option></select><h2>ADR · 당일 1분</h2><output></output></div><div class="rank-adr-area"><canvas role="img" aria-label="당일 ADR 분봉 차트"></canvas><div class="concentration-tooltip" hidden></div></div><p role="status" class="rank-adr-status"></p>`;
        row.append(panel);
        }
        const select = panel.querySelector('select'), canvas = panel.querySelector('canvas');
        const ctx = canvas.getContext('2d'), status = panel.querySelector('[role="status"]');
        const output = panel.querySelector('output'), tooltip = panel.querySelector('.concentration-tooltip');
        let points = [], controller, geometry, resizeFrame = null, closing = null;
        const latestByMarket = new Map();
        const dateKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
        let chartDay = dateKey(Date.now());
        const timeLabel = t => new Date(t).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
        function draw() {
            const w = canvas.clientWidth, h = canvas.clientHeight;
            if (!w || !h) return;
            const pixelWidth = Math.round(w * devicePixelRatio), pixelHeight = Math.round(h * devicePixelRatio);
            if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
            if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            ctx.clearRect(0, 0, w, h);
            const left = 42, right = w - 16, top = 16, bottom = h - 30;
            const values = points.map(p => p.adr);
            if (closing) values.push(closing.adr);
            const min = Math.min(60, ...values) - 5, max = Math.max(140, ...values) + 5;
            const y = v => bottom - (v - min) / (max - min) * (bottom - top);
            const day = chartDay, start = Date.parse(`${day}T09:00:00+09:00`), end = Date.parse(`${day}T15:30:00+09:00`);
            const x = t => left + (t - start) / (end - start) * (right - left);
            geometry = { x, y, left, right, start, end };
            ctx.fillStyle = 'rgba(200, 200, 200, 0.2)'; ctx.fillRect(left, y(120), right - left, y(80) - y(120));
            ctx.font = '11px Arial';
            for (const [v, color] of [[80, '#ffa94d'], [100, '#ff6b6b'], [120, '#51cf66']]) {
                ctx.strokeStyle = color; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(right, y(v)); ctx.stroke();
                ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(v, left - 6, y(v) + 4);
            }
            ctx.setLineDash([]); ctx.fillStyle = getComputedStyle(panel).getPropertyValue('--text-muted');
            ctx.textAlign = 'center';
            if (!points.length && closing) {
                const markerX = closing.t ? x(closing.t) : (left + right) / 2;
                ctx.fillStyle = '#339af0';
                ctx.beginPath(); ctx.arc(markerX, y(closing.adr), 5, 0, Math.PI * 2); ctx.fill();
                ctx.textAlign = markerX > (left + right) / 2 ? 'right' : 'left';
                ctx.fillText(`마감 ${closing.adr.toFixed(2)}%`, markerX > (left + right) / 2 ? markerX - 10 : markerX + 10, y(closing.adr) - 10);
                ctx.textAlign = 'center';
            }
            for (const minute of [0, 90, 180, 270, 390]) { const t = start + minute * 60000; ctx.fillText(timeLabel(t), x(t), h - 8); }
            ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
            ctx.strokeStyle = '#339af0'; ctx.lineWidth = 2; ctx.beginPath();
            points.forEach((p, i) => { if (!i || p.t - points[i - 1].t > 120000) ctx.moveTo(x(p.t), y(p.adr)); else ctx.lineTo(x(p.t), y(p.adr)); }); ctx.stroke();
            ctx.fillStyle = '#339af0'; points.forEach(p => { ctx.beginPath(); ctx.arc(x(p.t), y(p.adr), 2, 0, Math.PI * 2); ctx.fill(); }); ctx.restore();
        }
        window.refreshRankAdrChart = async () => {
            controller?.abort(); controller = new AbortController();
            const current = controller, market = select.value, day = dateKey(Date.now());
            const key = `rank-adr:${market}:${day}`;
            try {
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
                panel.querySelector('h2').textContent = chartDay < day ? 'ADR · 직전 거래일' : 'ADR · 당일 1분';
                canvas.setAttribute('aria-label', `${chartDay} ADR ${closing ? '마감값 · 분봉 기록 없음' : '분봉 차트'}`);
                tooltip.hidden = true;
                status.textContent = points.length ? `${chartDay} · ${timeLabel(points.at(-1).t)} 기준 · ${session} · Jusikbot` : closing ? `${chartDay} · ${session} · 마감값 · 분봉 기록 없음 · Jusikbot` : `${day} · 당일 데이터 대기 중 · Jusikbot`;
                draw();
            } catch (error) { if (error.name !== 'AbortError') status.textContent = 'ADR 조회 실패 · 다음 Rank 갱신 때 재시도'; }
        };
        select.addEventListener('change', () => { points = []; closing = null; chartDay = dateKey(Date.now()); output.textContent = '—'; tooltip.hidden = true; draw(); window.refreshRankAdrChart(); });
        canvas.addEventListener('mousemove', event => {
            if (!geometry) return;
            if (closing) {
                tooltip.textContent = `${chartDay} · 마감 ADR ${closing.adr.toFixed(2)}%${closing.t ? ` · ${timeLabel(closing.t)} 기준` : ''}`;
                tooltip.hidden = false;
                return;
            }
            if (!points.length) return;
            const px = event.clientX - canvas.getBoundingClientRect().left;
            const t = geometry.start + (px - geometry.left) / (geometry.right - geometry.left) * (geometry.end - geometry.start);
            const p = points.reduce((a, b) => Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a);
            tooltip.textContent = `${timeLabel(p.t)} · ADR ${p.adr.toFixed(2)}%`; tooltip.hidden = false;
        });
        canvas.addEventListener('mouseleave', () => { tooltip.hidden = true; });
        function scheduleResize() {
            if (resizeFrame !== null) return;
            resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            const size = concentration.getBoundingClientRect();
            if (size.width > 0 && size.height > 0) {
                const candle = document.getElementById('concentrationCandleArea');
                const candleHeight = candle && !candle.hidden ? candle.getBoundingClientRect().height : 0;
                const width = `${size.width}px`, height = `${size.height - candleHeight}px`;
                if (panel.style.width !== width) panel.style.width = width;
                if (panel.style.height !== height) panel.style.height = height;
            }
            draw();
            });
        }
        new ResizeObserver(scheduleResize).observe(concentration);
        new ResizeObserver(scheduleResize).observe(canvas.parentElement);
        draw(); window.refreshRankAdrChart();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
