(() => {
    'use strict';
    // VI 창 행 분석 차트 (2026-11-14): 행 맨 오른쪽 버튼 → '발동(등록)'부터 '해제 + 1분'까지(켜져 있는 행은 지금까지)의
    // 1초마다(그때까지의 마지막 체결) Base 등락률(왼쪽 축) · 괴리율(오른쪽 축) · Base 체결강도(축 없이 자기 범위로 그리고 마지막 값을 선 끝에 표시).
    // 서버 /api/vi-monitor/chart (vi-monitor-service.js chartData)가 시장별 시간대별 체결로 계산한 값을 그린다.
    const NS = 'http://www.w3.org/2000/svg';
    const W = 960, H = 440, M = { left: 64, right: 64, top: 28, bottom: 42 };
    const COLORS = { rate: '#111827', KRX: '#2563eb', NXT: '#16a34a', FUT: '#d97706', strength: '#9333ea' };
    const one = v => { const r = Math.round(v * 10) / 10; return (r === 0 ? 0 : r).toFixed(1); };
    const pct = v => Number.isFinite(v) ? (Math.round(v * 10) / 10 > 0 ? '+' : '') + one(v) + '%' : '—';
    const clock = t => Number.isFinite(t) ? new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
    const el = (name, attrs = {}, parent) => { const e = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.append(e); return e; };
    // Nice axis ticks.
    function ticks(min, max, count = 5) {
        if (!(max > min)) { max = min + 1; min -= 1; }
        const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= raw) || raw;
        const out = []; for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
        return out;
    }
    const range = (values, pad = 0.1, withZero = false) => {
        let lo = Math.min(...values, ...(withZero ? [0] : [])), hi = Math.max(...values, ...(withZero ? [0] : []));
        if (!Number.isFinite(lo)) return [-1, 1];
        if (hi - lo < 0.2) { lo -= 0.1; hi += 0.1; }
        const p = (hi - lo) * pad; return [lo - p, hi + p];
    };
    function timeStep(span) { return [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].map(s => s * 1000).find(s => span / s <= 8) || 7200000; }
    // Step line (a value holds until the next trade).
    function stepPath(points, x, y) { let d = ''; points.forEach(([t, v], i) => { d += (i ? `H${x(t).toFixed(1)}V` : `M${x(t).toFixed(1)},`) + y(v).toFixed(1); }); return d; }
    function draw(svg, data) {
        svg.replaceChildren();
        const { from, to, series } = data, plotW = W - M.left - M.right, plotH = H - M.top - M.bottom;
        const span = Math.max(1000, to - from), x = t => M.left + (t - from) / span * plotW;
        const rates = series.rate.map(p => p[1]).filter(Number.isFinite), gaps = Object.values(series.gaps).flat().map(p => p[1]).filter(Number.isFinite);
        const [rl, rh] = range(rates), [gl, gh] = range(gaps, 0.15, true);
        const yl = v => M.top + (rh - v) / (rh - rl) * plotH, yr = v => M.top + (gh - v) / (gh - gl) * plotH;
        el('rect', { x: M.left, y: M.top, width: plotW, height: plotH, class: 'vc-plot' }, svg);
        for (const v of ticks(rl, rh)) { if (v < rl || v > rh) continue; el('line', { x1: M.left, x2: M.left + plotW, y1: yl(v), y2: yl(v), class: 'vc-grid' }, svg); el('text', { x: M.left - 6, y: yl(v) + 4, class: 'vc-tick vc-left' }, svg).textContent = one(v) + '%'; }
        for (const v of ticks(gl, gh)) { if (v < gl || v > gh) continue; el('text', { x: M.left + plotW + 6, y: yr(v) + 4, class: 'vc-tick vc-right' }, svg).textContent = one(v) + '%'; }
        if (gl < 0 && gh > 0) el('line', { x1: M.left, x2: M.left + plotW, y1: yr(0), y2: yr(0), class: 'vc-zero' }, svg);
        const step = timeStep(span); for (let t = Math.ceil(from / step) * step; t <= to; t += step) { el('line', { x1: x(t), x2: x(t), y1: M.top + plotH, y2: M.top + plotH + 4, class: 'vc-axis' }, svg); el('text', { x: x(t), y: M.top + plotH + 18, class: 'vc-tick vc-mid' }, svg).textContent = clock(t); }
        el('text', { x: 8, y: 16, class: 'vc-axis-title' }, svg).textContent = '등락률 (' + data.baseLabel + ')';
        el('text', { x: W - 8, y: 16, class: 'vc-axis-title vc-right-title' }, svg).textContent = '괴리율 (÷ ' + data.baseLabel + ' − 1)';
        // Markers: 발동, 해제, 해제 + 1분.
        const marks = [[data.startedAt, '발동'], [data.releasedAt, '해제'], [data.end, '해제+1분']].filter(([t]) => Number.isFinite(t) && t >= from && t <= to + 1);
        for (const [t, label] of marks) { el('line', { x1: x(t), x2: x(t), y1: M.top, y2: M.top + plotH, class: 'vc-mark' }, svg); const nearEnd = x(t) > M.left + plotW - 70; el('text', { x: x(t) + (nearEnd ? -3 : 3), y: M.top + 12, class: 'vc-mark-label' + (nearEnd ? ' vc-mark-end' : '') }, svg).textContent = label; }
        // Strength on its own scale (no axis); its last value at the end of the line.
        const st = series.strength.filter(p => Number.isFinite(p[1]));
        if (st.length) {
            const [sl, sh] = range(st.map(p => p[1]), 0.2), ys = v => M.top + (sh - v) / (sh - sl) * plotH;
            el('path', { d: stepPath(st, x, ys) + `H${x(to).toFixed(1)}`, class: 'vc-line vc-strength', stroke: COLORS.strength }, svg);
            const lastV = st.at(-1)[1], ly = Math.min(M.top + plotH - 4, Math.max(M.top + 26, ys(lastV) - 8));
            el('text', { x: x(to) - 4, y: ly, class: 'vc-strength-label', fill: COLORS.strength }, svg).textContent = '체결강도 ' + Math.round(lastV);
        }
        for (const [m, list] of Object.entries(series.gaps)) if (list.length) el('path', { d: stepPath(list, x, yr) + `H${x(to).toFixed(1)}`, class: 'vc-line', stroke: COLORS[m] }, svg);
        if (series.rate.length) el('path', { d: stepPath(series.rate, x, yl) + `H${x(to).toFixed(1)}`, class: 'vc-line vc-rate', stroke: COLORS.rate }, svg);
        // Hover: values at the pointer time.
        const cross = el('line', { y1: M.top, y2: M.top + plotH, class: 'vc-cross', visibility: 'hidden' }, svg);
        const hit = el('rect', { x: M.left, y: M.top, width: plotW, height: plotH, fill: 'transparent' }, svg);
        const at = (list, t) => { let v = null; for (const p of list) { if (p[0] > t) break; v = p[1]; } return v; };
        const tip = svg.parentElement.querySelector('.vc-tip');
        hit.addEventListener('mousemove', e => {
            const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W, t = from + (px - M.left) / plotW * span;
            cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
            const lines = [clock(t), `등락률 ${pct(at(series.rate, t))}`, ...Object.entries(series.gaps).map(([m, l]) => `${data.labels[m]} 괴리율 ${pct(at(l, t))}`)];
            const s = at(series.strength, t); if (Number.isFinite(s)) lines.push('체결강도 ' + Math.round(s));
            tip.textContent = lines.join('  ·  '); tip.hidden = false;
        });
        hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    }
    let dialog, svg, title, legend, note, current = null;
    function ensure() {
        if (dialog) return;
        dialog = document.createElement('dialog'); dialog.id = 'viChart'; dialog.className = 'vi-chart-dialog';
        dialog.innerHTML = '<div class="vc-head"><h2></h2><button type="button" class="vc-refresh">새로고침</button><button type="button" class="vc-close">닫기</button></div>'
            + '<div class="vc-legend"></div><div class="vc-body"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="분석 차트"></svg><p class="vc-tip" hidden></p></div><p class="vc-note"></p>';
        document.body.append(dialog);
        svg = dialog.querySelector('svg'); title = dialog.querySelector('h2'); legend = dialog.querySelector('.vc-legend'); note = dialog.querySelector('.vc-note');
        dialog.querySelector('.vc-close').addEventListener('click', () => dialog.close());
        dialog.querySelector('.vc-refresh').addEventListener('click', () => current && void load(current));
        dialog.addEventListener('click', e => { if (e.target !== dialog) return; const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); });
    }
    async function load(req) {
        current = req;
        note.textContent = '체결 자료를 받는 중… (기록되지 않은 구간은 수십 초 걸릴 수 있습니다)'; svg.replaceChildren(); legend.replaceChildren();
        const q = new URLSearchParams({ key: req.key, startedAt: String(req.startedAt), ...(req.day ? { day: req.day } : {}) });
        try {
            const response = await fetch('/api/vi-monitor/chart?' + q, { headers: req.token ? { 'X-VI-Token': req.token } : {} });
            const data = await response.json().catch(() => ({}));
            if (current !== req) return;
            if (!response.ok) { note.textContent = data.error || '차트 자료를 받지 못했습니다'; return; }
            title.textContent = `${data.name} · ${data.baseLabel} Base · ${data.kindText || ''} · ${clock(data.startedAt)} ~ ${data.releasedAt ? '해제 ' + clock(data.releasedAt) + ' + 1분' : '지금 (' + clock(data.to) + ')'}`;
            for (const [key, label] of [['rate', '등락률 (' + data.baseLabel + ', 왼쪽 축)'], ...Object.keys(data.series.gaps).map(m => [m, data.labels[m] + ' 괴리율 (오른쪽 축)']), ['strength', '체결강도 (' + data.baseLabel + ', 축 없음)']]) {
                const item = document.createElement('span'); item.className = 'vc-key'; item.style.setProperty('--vc-color', COLORS[key]); item.textContent = label; legend.append(item);
            }
            draw(svg, data);
                        note.textContent = [`${Math.round((data.stepMs || 1000) / 1000)}초 간격 ${data.series.rate.length}점`, data.complete ? (data.recorded ? '해제 + 1분까지 끝난 구간 · 기록됨' : '해제 + 1분까지 끝난 구간 · 거래대금 · 시가총액 설정 밖이라 기록 안 함') : '지금까지의 구간 (새로고침으로 다시 받음)', ...(data.notes || []), data.source].filter(Boolean).join(' · ');
            if (!data.series.rate.length) note.textContent = '이 구간의 Base 체결을 받지 못했습니다 · ' + note.textContent;
        } catch { if (current === req) note.textContent = '차트 자료를 받지 못했습니다'; }
    }
    // Called by vi-monitor.js with the row's key, activation time, the shown day and the window token.
    window.openViChart = req => { ensure(); title.textContent = '분석 차트'; dialog.showModal(); void load(req); };
})();
