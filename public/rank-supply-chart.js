(() => {
    'use strict';
    const series = ['individual', 'foreign', 'institution', 'program'];
    const names = { individual: '개인', foreign: '외국인', institution: '기관', program: '프로그램' };
    const colors = { individual: '#339af0', foreign: '#e11d48', institution: '#16a34a', program: '#8b5cf6' };
    const dayKey = t => window.RankChartAxis?.kstDay ? window.RankChartAxis.kstDay(t) : new Date(t + 9 * 3600000).toISOString().slice(0, 10);
    const clock = t => new Date(t + 9 * 3600000).toISOString().slice(11, 16);
    const afterInvestorClose = t => {
        const clock = new Date(t + 9 * 3600000);
        return clock.getUTCHours() * 60 + clock.getUTCMinutes() > 930;
    };
    const formatShares = (n, signed = true) => {
        if (!Number.isFinite(n)) return '미제공';
        const thousands = Math.abs(n) >= 1000;
        const value = thousands ? Math.trunc(n / 1000) : n;
        return `${signed && value > 0 ? '+' : ''}${value.toLocaleString('ko-KR')}${thousands ? '천주' : '주'}`;
    };
    // 종목 선물 수급 arrives in net contracts; × the contract multiplier (10 stocks, 100 ETF, from the server) gives
    // shares so it reads on the same 주/천주 scale as 종목 수급.
    function contractShares(result) {
        const multiplier = Number(result.multiplier) > 0 ? Number(result.multiplier) : 10;
        return (result.points || []).filter(p => Number.isFinite(p.t)).map(p => {
            const next = { ...p };
            for (const field of ['individual', 'foreign', 'institution']) if (Number.isFinite(p[field])) next[field] = p[field] * multiplier;
            return next;
        });
    }
    // Minute y range shared between 종목 수급 (combined) and 종목 선물 수급 (futures) for the same stock.
    const yPeers = new Map();
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
        const response = await (window.RankChartCache?.fetch || fetch)(url, options), data = await response.json();
        if (!response.ok || !data.success) throw Object.assign(new Error(data.error || '수급 조회 실패'), { status: response.status });
        return data;
    }
    function initialize(broker = '') {
        if (broker && window.rankIndependentClient) return;
        const combined = broker === 'combined', futures = broker === 'futures';
        // The futures card keeps the program series for the same layout as 종목 수급; LS has no stock futures program
        // trading, so it shows as 미제공 (empty lane on the day chart).
        const cardSeries = series, format = formatShares;
        // 만드는 카드: 독립창 기본(''), 메인 통합('combined'), 종목 선물('futures'). 증권사별 비교 카드는 2026-11-22 정리.
        const suffix = combined ? 'CombinedSupply' : futures ? 'FuturesSupply' : 'Supply';
        const panelId = `rank${suffix}ChartPanel`, axisId = broker ? `${broker}Supply` : 'supply';
        const api = name => name.replace('Supply', suffix);
        const eventName = name => broker ? name.replace('rank-supply', `rank-${broker}-supply`) : name;
        const endpoint = futures ? '/api/ls-stock-futures/chart' : '/api/supply/chart';
        const candleEndpoint = futures ? '/api/ls-stock-futures/candles' : '/api/supply/candles';
        const selectionKey = broker ? `rank${suffix}SelectedV1` : 'rankSupplySelectedV1';
        const breadth = document.getElementById('rankBreadthChartPanel'), row = window.rankIndependentClient ? document.getElementById('tab_rank') : breadth?.closest('.rank-chart-row');
        if (!row || document.getElementById(panelId)) return;
        const panel = document.createElement('section');
        panel.id = panelId; panel.className = 'panel rank-adr-panel rank-supply-panel' + (futures ? ' rank-futures-supply-panel' : broker ? ' rank-broker-supply-panel' : '');
        panel.setAttribute('aria-label', futures ? '종목 선물 수급 차트' : '종목별 수급 차트');
        panel.innerHTML = `<div class="concentration-chart-header"><h2>${futures ? '종목 선물 수급' : '종목 수급'}${combined || futures || window.rankIndependentClient ? '' : '(키움)'}</h2>${futures ? '' : '<button type="button" data-action="add-stock" aria-haspopup="dialog" aria-expanded="false">+ 종목 추가</button>'}</div>
            <div class="rank-adr-controls"><select class="supply-stock-select" aria-label="수급 종목 선택"></select><button type="button" data-mode="day" class="active" aria-pressed="true">일봉</button><button type="button" data-mode="minute" aria-pressed="false">1분봉(누적)</button>
            <button type="button" class="concentration-candle-toggle" aria-expanded="false">캔들차트</button></div>
            <div class="supply-legend">${cardSeries.map(s => `<button type="button" data-series="${s}" aria-label="${names[s]} 표시" title="${names[s]} 표시 전환" aria-pressed="true" style="color:${colors[s]}"><span>${Array.from(names[s])[0]}</span><output><span class="supply-value-number">—</span><span class="supply-value-unit"></span></output></button>`).join('')}</div>
            <div class="chart-hover-info" hidden></div><div class="rank-adr-area"><canvas role="img" aria-label="${futures ? '개인 외국인 기관 순매수수량 차트 (선물 계약×승수, 프로그램 미제공)' : '개인 외국인 기관 프로그램 순매수수량 차트'}"></canvas></div>
            <div class="rank-adr-candle-area" hidden><canvas role="img" aria-label="${futures ? '선택 종목 주식선물(연결선물) 가격 캔들차트' : '선택 종목 가격 캔들차트'}"></canvas></div>
            <div class="concentration-chart-footer rank-adr-zoom"><input type="range" min="0" max="0" value="0" aria-label="수급 과거 구간 이동" disabled><div class="concentration-controls"><button type="button" aria-label="수급 차트 축소">−</button><button type="button" aria-label="수급 차트 확대">+</button></div></div>
            <button type="button" data-action="more" class="concentration-icon-button" title="과거 데이터 더 불러오기" aria-label="과거 데이터 더 불러오기"><svg width="28" height="28" viewBox="0 0 34 34" shape-rendering="crispEdges" aria-hidden="true"><rect x="1" y="1" width="32" height="32" fill="#ededed"/><path d="M10 5v20" stroke="#737373" stroke-width="2"/><rect x="6" y="9" width="9" height="12" fill="#505050"/><path d="M22 5v20" stroke="#c0c0c0" stroke-width="2"/><rect x="18" y="9" width="9" height="12" fill="#969696"/><path d="M25 21v10M21 26h10" stroke="#444444" stroke-width="4"/></svg></button><p class="rank-adr-status" role="status"></p>`;
        row.append(panel);
        window.RankSupplyGuide?.attach(panel, futures ? 'futures' : 'stock', futures ? 'ls' : window.rankIndependentClient ? 'combined' : broker || 'kiwoom');
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
        // 종목 선물 수급 follows the 종목 수급 watchlist and selection, so only the stock card has the add button.
        addButton?.addEventListener('click', openPicker);
        let multiplier = 10, config = { stocks: [], archive: [], revision: 0 }, selected = '', mode = 'day', cursor = null, hasMore = false, loading = false, historyLoaded = false, flowDates = null;
        let flowLoading=false, flowCoverageFirst='', candleError='';
        const minuteDays = new Set(), candleCache = new Map(), priceHistory = new Map(); const candleInflight = new Map(), candleFetchedAt = new Map();
        let priceCursor = null, candleLoading = false;
        // The candle cursor only counts while it points at a day not requested yet: while that day's candles are
        // still loading, reusing it would ask the same day again (2026-11-07 Oracle: "과거 조회가 진행되지 않았습니다").
        const nextPriceCursor = () => priceCursor && !minuteDays.has(`${priceCursor.slice(0,4)}-${priceCursor.slice(4,6)}-${priceCursor.slice(6,8)}`) ? priceCursor : null;
        let points = [], candles = [], start = 0, count = null, hover = null, drag = null, geometry;
        let controller, candleController, revision = 0, candleRevision = 0, refreshing = false, refreshPending = false;
        let showCandles = false, candleMessage = '', chartMessage = '', configError = '';
        const visibleSeries = new Set(cardSeries);
        const selectionStorage=window.rankIndependentClient?sessionStorage:localStorage;
        try { selected = selectionStorage.getItem(selectionKey) || ''; } catch {}
        function remember() { try { selectionStorage.setItem(selectionKey, selected); } catch {} }
        function setStatus() { status.textContent = [configError, chartMessage, candleMessage].filter(Boolean).join(' · '); status.title = status.textContent; }
        // 분봉 y축 동기화 with the other card (종목 수급 ↔ 종목 선물 수급), checked by default.
        const yPeerKey = window.rankIndependentClient ? '' : combined ? 'futures' : futures ? 'combined' : '';
        let ySync = true, yShared = '';
        try { ySync = localStorage.getItem(`${panelId}YSync`) !== '0'; } catch {}
        const ySyncLabel = document.createElement('label'); ySyncLabel.className = 'supply-y-sync'; ySyncLabel.hidden = true;
        ySyncLabel.innerHTML = `<input type="checkbox"><span>${futures ? '종목수급과' : '종목선물수급과'} y축 동기화</span>`;
        ySyncLabel.title = `분봉에서 같은 종목의 ${futures ? '종목 수급' : '종목 선물 수급'} 카드와 Y축 범위를 맞춤`;
        const ySyncBox = ySyncLabel.querySelector('input'); ySyncBox.checked = ySync;
        if (yPeerKey) panel.append(ySyncLabel);
        function paintYSync() { const show = !!yPeerKey && mode === 'minute'; ySyncLabel.hidden = !show; panel.classList.toggle('y-sync-visible', show); ySyncBox.checked = ySync; }
        ySyncBox.addEventListener('change', () => {
            ySync = ySyncBox.checked; try { localStorage.setItem(`${panelId}YSync`, ySync ? '1' : '0'); } catch {}
            draw(); publish(); if (typeof saveAppData === 'function') saveAppData();
        });
        if (yPeerKey) yPeers.set(broker, { selected: () => selected, mode: () => mode, visible: () => [...visibleSeries], draw: () => draw(),
            rows: (first, last) => displayFlow(points, mode).filter(p => p.t >= first && p.t <= last) });
        const settings = () => ({ selected, mode, showCandles, visibleSeries: [...visibleSeries], ySync });
        window[api('getRankSupplyDisplaySettings')] = settings;
        function publish() { if (broker) { try { localStorage.setItem(`${panelId}Settings`, JSON.stringify(settings())); } catch {} } document.dispatchEvent(new CustomEvent(eventName('rank-supply-state'), { detail: settings() })); }
        window[api('getRankSupplyYRange')] = () => ({ mode, selected, multiplier, min: geometry?.min, max: geometry?.max, first: geometry?.rows[0]?.t, last: geometry?.rows.at(-1)?.t });
        window[api('getRankSupplyState')] = () => ({ ...settings(), config, points, candles, flowCoverageFirst, cursor, hasMore, priceCursor, minuteDays: [...minuteDays], priceHistory: [...priceHistory], chartMessage, connection: window.getRankCardConnectionState?.(panel) });
        window[api('applyRankSupplySettings')] = (value, fetchData = true) => {
            if (!value || !['day', 'minute'].includes(value.mode)) return;
            const changed = selected !== value.selected || mode !== value.mode;
            if (changed) { controller?.abort(); candleController?.abort(); ++revision; ++candleRevision; loading = candleLoading = false; selected = value.selected || ''; mode = value.mode; clearView(); remember(); }
            showCandles = !window.rankIndependentClient && typeof window.rankMainCandleOpen==='boolean' ? window.rankMainCandleOpen : value.showCandles === true; candleArea.hidden = !showCandles;
            panel.querySelector('.concentration-candle-toggle').setAttribute('aria-expanded', String(showCandles));
            if (typeof value.ySync === 'boolean') { ySync = value.ySync; try { localStorage.setItem(`${panelId}YSync`, ySync ? '1' : '0'); } catch {} }
            if (Array.isArray(value.visibleSeries)) { visibleSeries.clear(); value.visibleSeries.filter(s => cardSeries.includes(s)).forEach(s => visibleSeries.add(s)); }
            panel.querySelectorAll('[data-series]').forEach(b => b.setAttribute('aria-pressed', String(visibleSeries.has(b.dataset.series))));
            panel.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
            paintStocks(); resize(); if (changed && fetchData) void load();
        };
        window[api('applyRankSupplyState')] = value => {
            if (!value?.config || !Array.isArray(value.points)) return;
            const same = value.selected === selected && value.mode === mode;
            config = value.config; window[api('applyRankSupplySettings')](value, false);
            if(typeof value.flowCoverageFirst==='string')flowCoverageFirst=value.flowCoverageFirst;
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
        if (broker) {
            panel.addEventListener('change', () => { if (typeof saveAppData === 'function') saveAppData(); });
            panel.addEventListener('click', event => { if (event.target.closest('[data-mode],[data-series]') && typeof saveAppData === 'function') queueMicrotask(() => saveAppData()); });
        }
        stockSelect.addEventListener('change', () => queueMicrotask(publish));
        let dailyCandleCoverage = null, dailyCandleAttempt = '', candleWork;
        function dailyCandleRange(target) {
            const first = [window.RankChartAxis.dailyDomain()?.first, flowCoverageFirst, target].filter(Boolean).map(value=>value.slice(0,10)).sort()[0];
            return {...(first?{from:first.replaceAll('-','')}:{count:'600'}),to:dayKey(Date.now()).replaceAll('-','')};
        }
        function clearView() {
            candleController?.abort();++candleRevision;candleLoading=false;
            todayOnly=true;
            points = []; candles = []; start = 0; count = null; hover = null; info.hidden = true;
            cursor = null; hasMore = false; historyLoaded = false; flowDates = null; flowCoverageFirst=''; candleError='';
            minuteDays.clear();
            priceHistory.clear(); priceCursor = null;
            dailyCandleCoverage = null; dailyCandleAttempt = '';
            candleMessage = ''; chartMessage = ''; draw();
        }
        function surface(c, context) {
            const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
            c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, w, h);
            context.font = '12px Inter, sans-serif'; return { w, h };
        }
        // 조회 중 그리기(2026-11-22): 응답 처리 · 캔들 합치기 중의 그리기는 다음 화면 프레임에 한 번으로 묶는다.
        // 같은 과거 구간을 다시 열면 저장된 캔들과 수급 저장 전 날 건너뛰기로 하루씩 거슬러 가는 조회가 서버를 거치지 않고
        // 한 작업 안에서 이어져, 매번 바로 그리던 것이 오라클에서 1~2초 화면을 멈추게 했다.
        let drawPending = null;
        function requestDraw() {
            if (drawPending) return;
            const run = () => { drawPending = null; draw(); };
            drawPending = typeof requestAnimationFrame === 'function' && !document.hidden ? { frame: requestAnimationFrame(run) } : { timer: setTimeout(run, 16) };
        }
        function draw() {
            if (drawPending) { if (drawPending.frame) cancelAnimationFrame(drawPending.frame); else clearTimeout(drawPending.timer); drawPending = null; }
            if (mode === 'day' && selected && showCandles && !candleLoading) {
                const range=dailyCandleRange(),key=`${selected}:${range.from || '600bars'}:${range.to}`;
                if ((!dailyCandleCoverage || dailyCandleCoverage.from>range.from || dailyCandleCoverage.to<range.to) && dailyCandleAttempt!==key) {
                    dailyCandleAttempt=key;
                    queueMicrotask(()=>{if(mode==='day'&&selected&&showCandles)void loadCandles(undefined,true);});
                }
            }
            if(window.rankIndependentClient && !futures)panel.querySelector('h2').textContent='종목 수급';
            window.RankChartAxis.loadingBar(canvas.parentElement,flowLoading,'수급');
            window.RankChartAxis.loadingBar(candleArea,candleLoading,'캔들');
            window.RankChartAxis.candleLabel(candleArea,config.archive.find(stock=>stock.code===selected)?.name || selected);
            const { w, h } = surface(canvas, ctx);
            {const view=window.RankChartAxis.sharedRange(axisId,points,p=>p.t,mode,start,count,draw);start=view.start;count=view.count;}
            const n = Math.min(points.length, count ?? points.length);
            start = Math.max(0, Math.min(start, points.length - n));
            const rows = displayFlow(points, mode).slice(start, start + n), indices = new Map(rows.map((p, i) => [p.t, i]));
            const {left,right}=window.RankChartAxis.plotBounds(axisId,w,12,w-82), top = 10, bottom = h - 34;
            const sessionX=window.RankChartAxis.sessionX(rows,p=>p.t,left,right,mode==='minute',mode==='day');
            const x = t => sessionX?sessionX(t):left + indices.get(t) / Math.max(1, n - 1) * (right - left);
            slider.max = String(points.length - n); slider.value = String(start); slider.disabled = n >= points.length;
            window.RankChartAxis.updateSlider(axisId,slider);
            panel.querySelector('[aria-label="수급 차트 확대"]').disabled = n <= 10;
            panel.querySelector('[aria-label="수급 차트 축소"]').disabled = n >= points.length;
            more.hidden = false; more.disabled = !selected || !(hasMore || mode === 'minute' && nextPriceCursor()) || loading || mode === 'minute' && candleLoading;
            // 최소 · 최대만 필요하니 배열을 만들지 않고 한 번 훑는다(2026-11-22, 과거 구간 그리기 속도).
            const seriesList = [...visibleSeries];
            let min = 0, max = 0, valueCount = 0;
            for (const p of rows) for (const s of seriesList) { const v = p[s]; if (Number.isFinite(v)) { valueCount++; if (v < min) min = v; if (v > max) max = v; } }
            const values = { length: valueCount };
            if (yPeerKey && mode === 'minute' && rows.length) {
                // Tell the other card when this card's own range changes, so both redraw on the same scale.
                const own = [selected, rows[0].t, rows.at(-1).t, min, max, [...visibleSeries]].join('|');
                if (own !== yShared) { yShared = own; const other = yPeers.get(yPeerKey); if (other) requestAnimationFrame(() => other.draw()); }
                const peer = ySync ? yPeers.get(yPeerKey) : null;
                if (peer && peer.selected() === selected && peer.mode() === 'minute') {
                    const fields = peer.visible();
                    for (const p of peer.rows(rows[0].t, rows.at(-1).t)) for (const field of fields) if (Number.isFinite(p[field])) { min = Math.min(min, p[field]); max = Math.max(max, p[field]); }
                }
            }
            const span = Math.max(1, max - min), padding = span * .08; min -= padding; max += padding;
            const y = v => bottom - (v - min) / (max - min) * (bottom - top);
            geometry = { rows, left, right, top, bottom, x, y, min, max };
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
                if(mode==='minute'){window.RankChartAxis.drawDayBoundaries(context,left,right,upper,lower);return;}
                context.save(); context.strokeStyle = '#b8c1cc'; context.lineWidth = 1; context.setLineDash([3,5]);
                boundaryXs.forEach(px => { context.beginPath(); context.moveTo(px,upper); context.lineTo(px,lower); context.stroke(); }); context.restore();
            }
            const lanes = new Map();
            if (mode === 'day') {
                let laneHeight2;
                const laneFields=['program','foreign','institution','individual'].filter(field=>cardSeries.includes(field));
                laneHeight2=(bottom-top)/laneFields.length;
                laneFields.forEach((field,i)=>{
                    const zero=top+laneHeight2*(i+.5);
                    const values=rows.map(p=>p[field]).filter(Number.isFinite);
                    const extent=Math.max(1,...values.map(Math.abs));
                    lanes.set(field,{zero,y:value=>zero-value/extent*(laneHeight2/2-9)});
                    ctx.save();ctx.strokeStyle='#64748b';ctx.lineWidth=1.5;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(left,zero);ctx.lineTo(right,zero);ctx.stroke();ctx.restore();
                    ctx.fillStyle=colors[field];ctx.textAlign='right';ctx.save();ctx.textBaseline='middle';ctx.fillText(names[field],w-4,zero);
                    // A source without this series (stock futures program) keeps its lane empty, marked 미제공.
                    if(!values.length && rows.length){ctx.fillStyle='#94a3b8';ctx.textAlign='center';ctx.fillText('미제공',(left+right)/2,zero-10);}ctx.restore();
                });
            } else grid(ctx, w, min, max, y);
            boundaries(ctx,top,bottom);
            if (mode !== 'day' && values.length) {
                ctx.save();ctx.strokeStyle='#64748b';ctx.lineWidth=1.5;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(left,y(0));ctx.lineTo(right,y(0));ctx.stroke();
                ctx.fillStyle='#64748b';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('0',right+4,y(0));ctx.restore();
            }
            const ticks = window.RankChartAxis.eightTick(ctx,window.RankChartAxis.ticks(ctx, rows, p=>p.t, p=>x(p.t), left, right, mode),left,right,mode==='minute',window.RankChartAxis.sessionStartLabel(rows,p=>p.t));
            function timeAxis(context, height) {
                context.fillStyle = muted; context.textAlign = 'center';
                ticks.forEach(({label,labelX})=>context.fillText(label,labelX,height-8));
            }
            timeAxis(ctx, h);
            const latestDates = [...new Set(cardSeries.map(s => points.findLast(point => Number.isFinite(point[s])))
                .filter(Boolean).map(point => dayKey(point.t)))].sort();
            latestDate.textContent = latestDates.length > 1 ? `${latestDates[0]} ~ ${latestDates.at(-1)}` : latestDates[0] || '—';
            cardSeries.forEach(s => {
                const button = panel.querySelector(`[data-series="${s}"]`), last = points.findLast(point => Number.isFinite(point[s]));
                const label=last ? format(last[s]) : points.length ? '미제공' : '—', unit=label.match(/(억원|천주|주|천계약|계약)$/)?.[0] || '';
                button.querySelector('.supply-value-number').textContent=unit ? label.slice(0,-unit.length) : label;
                button.querySelector('.supply-value-unit').textContent=unit;
                button.querySelector('output').title = last ? `${label} · ${dayKey(last.t)} ${clock(last.t)} 기준` : '관측값 없음';
                button.querySelector('output').style.color = colors[s];
                let stamp=button.querySelector('.supply-observed-time');
                if(!stamp){stamp=document.createElement('small');stamp.className='supply-observed-time';button.append(stamp);}
                stamp.textContent=mode==='minute' && last ? clock(last.t) : '';
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
                if(mode==='minute'){
                    ctx.save();ctx.setLineDash([3,4]);ctx.beginPath();let observed;
                    rows.forEach(p=>{if(!Number.isFinite(p[s]))return;
                        if(observed && window.RankChartAxis.intradayGap(observed.t,p.t,1200)){
                            ctx.moveTo(x(observed.t),y(observed[s]));ctx.lineTo(x(p.t),y(p[s]));
                        }observed=p;
                    });ctx.stroke();ctx.restore();
                }
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
                cardSeries.forEach(s => {
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
            window.RankChartAxis.drawOhlc(cc, visible, p => x(p.t), cy, width);
            // 분봉에만 일봉 기준 이평(2026-11-24, docs/MINUTE_DAILY_MA.md). 종목은 통합 일봉, 종목 선물은 연결선물 일봉.
            if (mode === 'minute' && selected) window.RankDayMa?.draw(cc, { target: `${futures ? 'stockFutures' : 'stock'}:${selected}`, candles: candles.filter(window.RankChartAxis.validCandle), visible,
                x: p => x(p.t), y: cy, left, right, top: layout.top, bottom: layout.bottom, redraw: requestDraw });
            cursor(cc, size.h); selection(cc, size.h);
            const hovered = visible.find(p => p.t === hover);
            if (hovered) valueBadge(cc, hovered.close, cy(hovered.close), '#000', size.h, hovered.close.toLocaleString('ko-KR'));
        }
        function paintStocks() {
            paintYSync();
            stockSelect.replaceChildren();
            config.stocks.forEach(stock => {
                const button = new Option(Array.from(stock.name).slice(0, 6).join(''), stock.code);
                // 수집 상태는 예전 키움 분봉 수집기의 것이라 없앴다(2026-11-22, 분봉 수급은 한투 자료 한 곳).
                button.title = `${stock.name} (${stock.code})`;
                stockSelect.add(button);
            });
            const stock = config.archive.find(stock => stock.code === selected);
            if (stock && !config.stocks.some(item => item.code === selected)) {
                const option = new Option(Array.from(stock.name).slice(0,6).join('') + ' (보관)', selected); option.title = stock.name; stockSelect.add(option);
            }
            stockSelect.value = selected; stockSelect.title = stockSelect.selectedOptions[0]?.title || '';
            stockSelect.disabled = saving || !stockSelect.options.length; if (addButton) { addButton.disabled = saving; addButton.setAttribute('aria-expanded', String(!picker.hidden)); }
            paintArchive();
        }
        document.addEventListener('rank-stock-supply-selection', event => {
            if (config.stocks.some(stock => stock.code === event.detail?.code)) choose(event.detail.code, false);
        });
        document.addEventListener('rank-concentration-selection',event=>{
            const code=event.detail?.stock?.code;
            if(config.stocks.some(stock=>stock.code===code))choose(code,false);
        });
        function choose(code, broadcast = true) {
            if (selected === code) return;
            const restoreWindow=mode==='minute'?window.RankChartAxis.minuteDomain():null;
            selected = code; remember(); clearView(); paintStocks();
            if (broadcast) document.dispatchEvent(new CustomEvent('rank-stock-supply-selection', { detail: { code,stock:config.stocks.find(stock=>stock.code===code)||config.archive.find(stock=>stock.code===code),source:axisId } }));
            if(restoreWindow && restoreWindow.first.slice(0,10)<window.RankChartAxis.sessionDay())todayOnly=false;
            void load(false,restoreWindow);
        }
        // reuseToday(2026-11-24): 과거로 이어 받는 동안(더 불러오기 · 과거 구간 열기 · 공통 축 범위 맞추기)은 1분 안에 받은 오늘 캔들을 다시 쓴다.
        // 쪽마다 오늘 캔들을 0.3~1.9초씩 다시 받고 있었다(측정 6번: 8번). 30초 자동 갱신은 그대로 새로 받는다.
        function loadCandles(target, onlyCoverage = false, reuseToday = false) {
            if(candleLoading){
                if(target)return Promise.resolve(candleWork).then(()=>loadCandles(target,false,true));
                return candleWork;
            }
            return candleWork=performCandleLoad(target, onlyCoverage, reuseToday || !!target);
        }
        async function performCandleLoad(target, onlyCoverage, reuseToday = false) {
            const dailyRange=mode==='day'?dailyCandleRange(target):null;
            if((target || onlyCoverage) && dailyRange && dailyCandleCoverage && dailyCandleCoverage.from<=dailyRange.from && dailyCandleCoverage.to>=dailyRange.to)return;
            if(candleLoading && !target)return;
            candleController?.abort(); const current = candleController = new AbortController(), id = ++candleRevision;
            candleMessage = ''; candleError='';
            if (!selected || !showCandles && mode === 'day') { requestDraw(); return; }
            candleLoading = true; candleMessage = '캔들 조회 중…'; setStatus(); requestDraw();
            try {
                const requestedDays=new Set(minuteDays);
                // 주말 · 휴장일 캔들은 묻지 않는다(2026-11-23: 과거 구간에서 빈 날 11번을 0.3~0.5초씩 차례로 물었다).
                if(target && mode==='minute'){const domain=window.RankChartAxis.minuteDomain();for(const day of domain.days || [])if(day>=target.slice(0,10) && (!domain.openDate || domain.openDate(day)))requestedDays.add(day);requestedDays.add(target.slice(0,10));}
                const days = dailyRange?['']:[...requestedDays].sort(); if (!days.length) days.push(mode==='minute' && window.RankChartAxis.minuteWindow?.()?.to || ''); // 과거 구간 보기 중에는 오늘 캔들을 받지 않는다
                const merged = new Map(candles.map(point => [point.t, point])); let partial = false;
                const keyOf = day => `${selected}:${mode}:${dailyRange?(dailyRange.from || '600bars')+':'+dailyRange.to:day || dayKey(Date.now())}`;
                // 지난날 캔들은 끝난 날이라 받은 것을 그대로 쓴다: 취소하지 않고(다음 조회가 이어 받음) 같은 날을 두 번 묻지 않는다.
                const today = dayKey(Date.now()), past = day => !dailyRange && day && day < today;
                const fetchDay = day => {
                    const key = keyOf(day), cached = candleCache.get(key);
                    if (cached && (past(day) || reuseToday && Date.now() - (candleFetchedAt.get(key) || 0) < 60000)) return Promise.resolve(cached);
                    if (candleInflight.has(key)) return candleInflight.get(key);
                    const params = new URLSearchParams({ code: selected, mode, ...(dailyRange?dailyRange:day ? { date: day } : {}) });
                    const job = request(`${candleEndpoint}?${params}`, past(day) ? {} : { signal: current.signal }).then(result => {
                        if(!result.partial){candleCache.set(key, result);candleFetchedAt.set(key,Date.now());} if (candleCache.size > 90) candleCache.delete(candleCache.keys().next().value);
                        return result;
                    }).finally(() => { if (candleInflight.get(key) === job) candleInflight.delete(key); });
                    if (past(day)) candleInflight.set(key, job);
                    return job;
                };
                // 종목 선물 분봉 캔들(2026-11-23 사용자 결정): 지난날 하나에 한투가 약 4초 걸려, 과거 구간을 하루씩 차례로 받으면 31일에 약 125초였다.
                // 3일까지 함께 묻는다: 그릴 날을 받는 동안 다음에 거슬러 갈 지난날 2일(장이 열린 날, 구간 시작일까지)도 미리 받아 캐시에 둔다.
                const width = futures && mode === 'minute' ? 3 : 1, ahead = [];
                if (width > 1 && !dailyRange && !todayOnly && days[0]) { // 당일만 볼 때는 지난날을 미리 받지 않는다
                    const floor = window.RankChartAxis.minuteWindow?.()?.from || '', openDay = window.RankChartAxis.minuteDomain()?.openDate;
                    for (let d = days[0], i = 0; ahead.length < 2 && i < 14; i++) {
                        d = new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
                        if (floor && d < floor) break;
                        if ([0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()) || openDay && !openDay(d)) continue;
                        if (!candleCache.has(keyOf(d))) ahead.push(d);
                    }
                }
                const queue = [...days].reverse(), results = new Map();
                const worker = async () => { while (queue.length && id === candleRevision) { const day = queue.shift(); results.set(day, await fetchDay(day)); } };
                // 미리 받기: 비어 있는 자리만큼(동시 3개까지). 실패는 무시한다(그날 차례에 다시 묻는다).
                const prefetch = () => { for (const d of ahead) { if (candleInflight.size >= width) break; if (!candleCache.has(keyOf(d)) && !candleInflight.has(keyOf(d))) void fetchDay(d).catch(() => {}); } };
                const work = Promise.all(Array.from({ length: Math.min(width, queue.length) }, worker));
                prefetch();
                await work;
                prefetch();
                if (id !== candleRevision) return;
                for (const day of days) {
                    const result = results.get(day);
                    partial ||= result.partial;
                    for (const point of result.points || []) merged.set(point.t, point);
                    const actualDay = result.date || (result.points?.length ? dayKey(result.points.at(-1).t) : day);
                    if (actualDay && !result.partial) priceHistory.set(actualDay, result.has_more ? result.cursor : null);
                }
                if (id !== candleRevision) return;
                if(dailyRange && !partial)dailyCandleCoverage={...dailyRange,from:dailyRange.from || [...merged.values()].map(p=>dayKey(p.t).replaceAll('-','')).sort()[0] || dailyRange.to};
                candles = [...merged.values()].sort((a,b) => a.t - b.t);
                priceCursor = [...priceHistory.values()].filter(value => value && !priceHistory.has(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`)).sort().at(-1) || null;
                const anchor = points[start]?.t, atEnd = start + Math.min(points.length, count ?? points.length) >= points.length;
                const timeline = new Map(candles.map(point => [point.t, { t: point.t }]));
                for (const point of points) timeline.set(point.t, point);
                points = [...timeline.values()].sort((a,b) => a.t - b.t);
                if (count != null) start = atEnd ? Math.max(0, points.length - count) : Math.max(0, points.findIndex(point => point.t >= anchor));
                candleError=partial?'캔들 일부 과거 구간만 제공':'';
                candleMessage = partial ? '캔들 일부 과거 구간만 제공' : candles.length ? '' : '가격 캔들 없음';
            } catch (error) { if (error.name !== 'AbortError' && id === candleRevision) { candleError=error.message; candleMessage = '캔들 조회 실패'; } }
            if (id === candleRevision) {
                candleLoading = false; setStatus(); requestDraw(); publish();
                if (refreshPending && !refreshing && !loading && !drag) { refreshPending = false; void window[api('refreshRankSupplyChart')](); }
            }
        }
        window.RankChartAxis.registerHover(axisId,()=>mode,()=>hover,key=>{
            hover=geometry?.rows.find(p=>window.RankChartAxis.matchesHover(p.t,key,mode))?.t ?? null;
            info.hidden=true;draw();
        });
        let todayOnly = true;
        window.RankChartAxis.todayButton(panel,'[data-mode="minute"]',()=>mode,()=>{todayOnly=true;draw();void load();});
        // 과거 분봉 구간 보기(2026-11-21, RankChartAxis.showWindow): 받은 분봉을 비우고 day(YYYYMMDD) 이전부터 다시 받게 한다.
        // 이어지는 과거 조회(load(true))가 그 날짜부터 하루씩 거슬러 간다.
        function seek(day) {
            if (!selected) return;
            ++revision; controller?.abort(); loading = false; flowLoading = false;
            clearView(); todayOnly = false; cursor = day; hasMore = true;
        }
        async function load(append = false, restoreWindow = null) {
            if(window.rankManagedChartRefresh && !window.rankChartRefreshStarted)return;
            const nextCursor = append ? [hasMore ? cursor : null, mode === 'minute' ? nextPriceCursor() : null].filter(Boolean).sort().at(-1) : null;
            if (append && (loading || !nextCursor)) return;
            controller?.abort(); const current = controller = new AbortController(), id = ++revision;

            if (!selected) { loading = false; clearView(); chartMessage = futures ? '종목 수급 카드의 + 종목 추가에서 최대 5종목을 지정하세요.' : '+ 종목 추가에서 최대 5종목을 지정하세요.'; setStatus(); return; }
            if(append){window.RankChartAxis.showHistory();todayOnly=false;}
            loading = true; flowLoading=true; chartMessage = append ? '과거 수급 조회 중…' : '수급 조회 중…'; setStatus(); requestDraw();
            try {
                let firstResponse=true;
                if(showCandles || mode==='minute')void loadCandles(undefined,false,append);
                do {
                const params = new URLSearchParams({ code: selected, mode, ...(mode === 'day' ? { progressive: '1' } : {}), ...(append ? { cursor: nextCursor } : {}) });
                // 수급 저장이 시작되기 전 날(available_dates의 첫 날보다 이른 날)은 서버에 묻지 않고 빈 날로 넘긴다(2026-11-22).
                // 과거 구간(7~8월)에서 한투 종목수급 · 종목 선물 수급이 자료 없는 날을 하루씩 1~3초씩 22번 묻고 있었다.
                const askedDay = append && mode === 'minute' && /^\d{8}$/.test(String(nextCursor || '')) ? `${nextCursor.slice(0,4)}-${nextCursor.slice(4,6)}-${nextCursor.slice(6,8)}` : '';
                // 건너뛴 날도 한 번은 다른 일(그리기 · 다른 카드)에 차례를 넘긴다. 그렇지 않으면 이어지는 날들이 한 작업 안에서 끝까지 돈다.
                const skipped = askedDay && flowDates?.length && askedDay < flowDates[0];
                if (skipped) { await new Promise(resolve => setTimeout(resolve, 0)); if (id !== revision) return; }
                const result = skipped
                    ? { success: true, mode: 'minute', date: askedDay, points: [], available_dates: flowDates, has_more: false, cursor: null, warnings: [] }
                    : await request(`${(combined || window.rankIndependentClient) && mode === 'minute' ? '/api/kis-supply/chart' : endpoint}?${params}`, { signal: current.signal });
                if (mode === 'minute' && Array.isArray(result.available_dates) && result.available_dates.length) flowDates = [...result.available_dates].sort();
                if (id !== revision) return;
                const followLatest = start + Math.min(points.length, count ?? points.length) >= points.length, oldAnchor = points[start]?.t;
                const coverageDate=result.date || (append && nextCursor ? `${nextCursor.slice(0,4)}-${nextCursor.slice(4,6)}-${nextCursor.slice(6,8)}` : '');
                const coverage=mode==='minute' && coverageDate ? coverageDate+' 00:00' : (result.points || []).filter(p=>Number.isFinite(p.t)).map(p=>new Date(p.t+9*3600000).toISOString().slice(0,mode==='minute'?16:10).replace('T',' ')).sort()[0];
                if(coverage && (!flowCoverageFirst || coverage<flowCoverageFirst))flowCoverageFirst=coverage;
                const fresh = futures ? contractShares(result) : (result.points || []).filter(p => Number.isFinite(p.t));
                if (futures && Number(result.multiplier) > 0) multiplier = Number(result.multiplier);
                points = mergeFlow(points, fresh);
                if (mode === 'day') {
                    candles = [...new Map([...candles, ...(result.candles || [])].map(p => [p.t, p])).values()].sort((a,b) => a.t - b.t);
                }
                if (append || !historyLoaded) { cursor = result.cursor; hasMore = result.has_more === true; historyLoaded = true; }
                if(firstResponse && restoreWindow && mode==='minute'){
                    // A symbol change must refill the existing common period, not just its latest session.
                    // Closed days (weekends, holidays) have no flow: skip them (2026-11-12: one browser asked 11/7 · 11/8 4,775 times each on 11/11).
                    const calendar=window.TradingRefresh?.state?.days || {},open=day=>![0,6].includes(new Date(day+'T00:00:00Z').getUTCDay()) && calendar[day]!==false;
                    const days=restoreWindow.days.filter(day=>day>=restoreWindow.first.slice(0,10) && day<=restoreWindow.last.slice(0,10) && open(day));
                    for(const day of days){
                        minuteDays.add(day);
                        if(day===result.date)continue;
                        if(flowDates?.length && day<flowDates[0]){const first=day+' 00:00';if(!flowCoverageFirst || first<flowCoverageFirst)flowCoverageFirst=first;continue;}
                        const params=new URLSearchParams({code:selected,mode:'minute',date:day});
                        const past=await request(`${(combined || window.rankIndependentClient) && mode === 'minute' ? '/api/kis-supply/chart' : endpoint}?${params}`,{signal:current.signal});
                        if(id!==revision)return;
                        const first=day+' 00:00';if(!flowCoverageFirst || first<flowCoverageFirst)flowCoverageFirst=first;
                        points=mergeFlow(points,futures?contractShares(past):(past.points || []).filter(p=>Number.isFinite(p.t)));
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
                const hasFlow = points.some(point => cardSeries.some(field => Number.isFinite(point[field])));
                const periodPoints=mode==='minute' && todayOnly?points.filter(p=>dayKey(p.t)===window.RankChartAxis.sessionDay()):points;
                const period = periodPoints.length ? `${dayKey(periodPoints[0].t)}${dayKey(periodPoints[0].t) === dayKey(periodPoints.at(-1).t) ? '' : ' ~ ' + dayKey(periodPoints.at(-1).t)}` : '당일 자료 없음';
                const message = mode === 'minute' ? `${period}` : `일별 순매수수량${futures ? ` (계약×${multiplier})` : ''} · ${points.length.toLocaleString()}봉`;
                let warnings = (result.warnings || []).filter(text => !text.startsWith('1분마다 관측한 당일 누적 순매수수량'));
                warnings = window.RankSupplyGuide?.loadingWarnings(panel, mode, warnings) || warnings;
                chartMessage = `${hasFlow ? message : '수급 기록 없음'}${warnings.length ? ` · ${warnings.join(' · ')}` : ''}${result.status?.error && mode === 'minute' ? ` · ${result.status.error}` : ''}`;
                if(result.pending)chartMessage=hasFlow?`${chartMessage} · 추가 조회 중…`:'가격 수신 · 수급 조회 중…';
                window.setRankCardConnection?.(panel, !result.status?.error && !result.warnings?.some(text => /실패|오류/.test(text)));
                hover = null; info.hidden = true; setStatus(); requestDraw();
                flowLoading=!!result.pending;
                if (showCandles || mode === 'minute') void loadCandles(undefined,false,append);
                publish();
                firstResponse=false;
                if (!result.pending) break;
                await new Promise(resolve=>setTimeout(resolve,400));
                if (id !== revision || current.signal.aborted) return;
                } while(true);
            } catch (error) {
                if (error.name === 'AbortError' || id !== revision) return;
                // A stock with no source (e.g. no stock futures, 404) has no history to page through either.
                if (error.status === 404) { hasMore = false; cursor = null; priceCursor = null; priceHistory.clear(); }
                chartMessage = `${error.message}${points.length ? ' · 이전 데이터 표시' : ''}`; setStatus();
                window.setRankCardConnection?.(panel, false);
            }
            finally {
                if (id === revision) {
                    loading = false; flowLoading=false; requestDraw(); publish();
                    if (refreshPending && !refreshing && !drag) { refreshPending = false; void window[api('refreshRankSupplyChart')](); }
                }
            }
        }
        window[api('refreshRankSupplyChart')] = async () => {
            if(window.rankManagedChartRefresh && !window.rankChartRefreshStarted)return;
            if (drag || refreshing || loading) { refreshPending = true; return; }
            refreshing = true; refreshPending = false;
            try {
                config = await request('/api/supply/watchlist', { cache: 'no-store' }); configError = '';
                if (!config.archive.some(stock => stock.code === selected)) { selected = config.stocks[0]?.code || ''; clearView(); remember(); }
                paintStocks(); await load(false,mode==='minute'?window.RankChartAxis.minuteDomain():null);
            } catch (error) { configError = `수집 종목 조회 실패: ${error.message}`; setStatus(); }
            finally { refreshing = false; if (refreshPending && !drag) { refreshPending = false; void window[api('refreshRankSupplyChart')](); } }
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
            mode = button.dataset.mode; todayOnly=true;clearView();paintYSync();
            panel.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
            load();
        }));
        window.RankChartAxis.registerHistoryLoader(axisId,()=>load(true),()=>loading || mode==='minute' && candleLoading,()=>({identity:selected,coverageFirst:flowCoverageFirst,ensureRange:async target=>{await loadCandles(target);if(candleError)throw new Error(candleError);},seek:mode==='minute'?seek:undefined,leaveWindow:mode==='minute'?()=>{if(selected){++revision;controller?.abort();loading=false;flowLoading=false;clearView();void load();}}:undefined,hasMore:!!selected && (hasMore || mode==='minute' && !!nextPriceCursor()),cursor:[cursor,nextPriceCursor()].join(':')}));
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
                    window.RankChartAxis.selectViewport(axisId, (previous.from-geometry.left)/(geometry.right-geometry.left), (previous.to-geometry.left)/(geometry.right-geometry.left));
                }
                draw(); if (refreshPending) window[api('refreshRankSupplyChart')]();
            });
            const cancel = () => { if (drag?.surface === c) { drag = null; draw(); if (refreshPending) window[api('refreshRankSupplyChart')](); } };
            c.addEventListener('pointercancel', cancel); c.addEventListener('lostpointercapture', cancel);
            c.addEventListener('pointerleave', () => { if (!drag) { hover = null; info.hidden = true; draw(); } });
        });
        const picker = document.createElement('dialog'); picker.className = 'supply-stock-dialog'; picker.hidden = true;
        picker.setAttribute('aria-labelledby', `${panelId}PickerTitle`);
        picker.innerHTML = `<h2 id="${panelId}PickerTitle">수급 종목 추가·삭제</h2><p>최대 5종목 · 삭제해도 저장한 기록은 유지됩니다.</p><ul class="supply-picker-stocks"></ul><form class="supply-search"><label>종목명 또는 코드 <input type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${panelId}StockSuggestions" autocomplete="off" maxlength="80" required></label><button type="submit">추가</button><button type="button" data-close>닫기</button></form><div id="${panelId}StockSuggestions" class="supply-suggestions" role="listbox" aria-label="종목 검색 결과" hidden></div><p role="status"></p><details class="supply-archive-menu"><summary>보관 기록</summary><div></div></details>`;
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
                else { paintStocks(); void window[api('refreshRankSupplyChart')](); }
            } catch (error) {
                picker.hidden = false; pickerStatus.textContent = error.message;
                if (error.status === 409) {
                    try { config = await request('/api/supply/watchlist', { cache: 'no-store' }); pickerStatus.textContent = '다른 창의 최신 종목을 불러왔습니다. 다시 추가하거나 제외하세요.'; }
                    catch { pickerStatus.textContent = '최신 설정 조회 실패 · 조회 후 다시 시도하세요.'; }
                }
            } finally { saving = false; paintStocks(); document.dispatchEvent(new Event('rank-supply-watchlist')); }
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
                        button.id = panelId + '-stock-option-' + index; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false'); button.tabIndex = -1;
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
        const reference = (document.getElementById('concentrationChartPanel') || document.getElementById('combinedConcentrationChartPanel')) || breadth;
        window[api('applyRankSupplyCandleOpen')] = open => {
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
        let resizeFrame = 0;
        function scheduleResize() {
            if (resizeFrame) return;
            resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; resize(); });
        }
        new ResizeObserver(scheduleResize).observe(reference); new ResizeObserver(scheduleResize).observe(canvas.parentElement);
        new ResizeObserver(scheduleResize).observe(panel.querySelector('.rank-adr-controls'));
        document.addEventListener('visibilitychange', () => { if (!document.hidden) window[api('refreshRankSupplyChart')](); });
        window.addEventListener('online', window[api('refreshRankSupplyChart')]);
        if(!window.rankIndependentClient && typeof window.rankMainCandleOpen==='boolean')window[api('applyRankSupplyCandleOpen')](window.rankMainCandleOpen);
        if (broker) { try { window[api('applyRankSupplySettings')](JSON.parse(localStorage.getItem(`${panelId}Settings`)), false); } catch {} }
        document.addEventListener('rank-supply-watchlist', () => { void window[api('refreshRankSupplyChart')](); });
        resize(); document.dispatchEvent(new Event(eventName('rank-supply-ready')));
        if (!window.rankIndependentClient && !window.rankManagedChartRefresh) window[api('refreshRankSupplyChart')]();
    }
    // Main page: the combined stock supply card and the 종목 선물 수급 card (same selection and refresh policy).
    const initializeAll = () => { if (window.rankIndependentClient) initialize(); else { initialize('combined'); initialize('futures'); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeAll, { once: true }); else initializeAll();
})();
