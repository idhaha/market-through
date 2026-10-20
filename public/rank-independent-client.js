(() => {
    'use strict';
    window.rankIndependentClient = true;
    const rawFetch = window.fetch.bind(window), params = new URLSearchParams(location.hash.slice(1));
    const id = params.get('id'), token = params.get('token');
    history.replaceState(null, '', location.pathname);
    let version = -1, lastSnapshot, closed = false, serverRefresh = null, receivedAt = 0, serverAge = 0, transportFailed = false;
    const pending = new Map(), outgoing = [], acknowledgements = [];
    const enqueue = value => { const id = crypto.randomUUID(); outgoing.push({ id, ...value }); return id; };
    let candleOpen = false;
    let pendingCandleChange = null;
    window.saveAppData = () => {
        const value = window.getConcentrationDisplaySettings?.().candleOpen;
        if (typeof value === 'boolean' && value !== candleOpen) {
            candleOpen = value; pendingCandleChange = enqueue({ type: 'display', candleOpen: value });
        }
    };
    const peer = payload => rawFetch(`/api/rank-independent/peer/${id}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    function command(value, signal) {
        const requestId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            if (closed) return reject(new Error('메인 페이지 연결이 종료되었습니다.'));
            const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('메인 페이지 응답 시간이 초과되었습니다.')); }, 65000);
            pending.set(requestId, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
            outgoing.push({ id: requestId, ...value });
            signal?.addEventListener('abort', () => { pending.get(requestId)?.reject(new DOMException('Aborted', 'AbortError')); pending.delete(requestId); }, { once: true });
        });
    }
    window.fetch = async (input, options = {}) => {
        if (typeof input !== 'string' || !/^\/api\/(?:concentration-(chart|stock|stocks)|supply\/(watchlist|chart|candles))(\?|$)/.test(input)) return rawFetch(input, options);
        const result = await command({ type: 'request', path: input, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null,
            selection: window.getRankChartState?.()?.selection, pinned: document.getElementById('rankStockPinned').checked }, options.signal);
        return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json' } });
    };
    document.addEventListener('DOMContentLoaded', () => {
        const status = document.getElementById('rankConnectionStatus'), pin = document.getElementById('rankStockPinned');
        document.getElementById('independentAlwaysOnTop').addEventListener('change', event => {
            window.chrome?.webview?.postMessage(`topmost:${event.target.checked}`);
        });
        const layout = document.getElementById('tab_rank');
        let supplyPinned, supplyKey = '', supplySettingsPending = null;
        function mountSupply() {
            const supply = document.getElementById('rankSupplyChartPanel'), header = supply.querySelector('.concentration-chart-header');
            const content = document.createElement('div'); content.id = 'independentSupplyContent';
            content.append(...[...supply.children].filter(node => node !== header && !node.classList.contains('rank-connection-dot'))); supply.append(content);
            const label = document.createElement('label'); label.className = 'independent-supply-pin';
            supplyPinned = document.createElement('input'); supplyPinned.type = 'checkbox'; supplyPinned.id = 'rankSupplyPinned';
            label.append(supplyPinned, ' 종목동기화 해제'); header.append(label);
            collapseControl(supply, header.querySelector('h2'), [content]);
            supplyPinned.addEventListener('change', () => {
                if (!supplyPinned.checked && lastSnapshot?.supply) window.applyRankSupplyState?.(lastSnapshot.supply);
                sendSupplySettings();
            });
            if (lastSnapshot?.supply) window.applyRankSupplyState?.(lastSnapshot.supply);
        }
        if (document.getElementById('rankSupplyChartPanel')) mountSupply();
        else document.addEventListener('rank-supply-ready', mountSupply, { once: true });
        function sendSupplySettings() {
            const value = window.getRankSupplyState?.(); if (!value) return;
            const settings = { selected: value.selected, mode: value.mode, showCandles: value.showCandles, visibleSeries: value.visibleSeries };
            const key = JSON.stringify([settings, !!supplyPinned?.checked]);
            if (key === supplyKey) return;
            supplyKey = key; supplySettingsPending = enqueue({ type: 'supply-display', settings, pinned: !!supplyPinned?.checked });
        }
        document.addEventListener('rank-supply-state', sendSupplySettings);
        function collapsedSize(panel) {
            const heading = panel.querySelector('.independent-panel-title');
            const style = getComputedStyle(panel);
            const horizontal = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
            const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
            return { width: Math.ceil(Math.max(180, heading.querySelector('h2').scrollWidth + 24 + 8 + horizontal)), height: Math.ceil(heading.offsetHeight + vertical) };
        }
        let foldLayout = null;
        let candleResizeHeight = null;
        const candleWindowBases = new Map();
        const candleHeight = 190;
        let restoringInitialDisplay = false;
        let initialDisplayApplied = false;
        document.addEventListener('rank-candle-display', event => {
            const chart = document.getElementById(event.detail.panel || 'concentrationChartPanel');
            const before = layout.getBoundingClientRect();
            layout.classList.toggle('independent-candle-open', !!layout.querySelector('.concentration-candle-area:not([hidden]), .rank-adr-candle-area:not([hidden])'));
            // The initial server snapshot describes the current state; only a user toggle changes window size.
            if (restoringInitialDisplay) return;
            const delta = event.detail.open ? candleHeight : -candleHeight;
            let candleWindowBase = candleWindowBases.get(chart.id);
            if (foldLayout) { const index = [...layout.children].indexOf(chart); foldLayout.sizes[index].height = Math.max(300, foldLayout.sizes[index].height + delta); }
            if (chart.classList.contains('independent-collapsed')) { candleWindowBases.delete(chart.id); return; }
            if (event.detail.open) {
                candleWindowBase = { layoutHeight: before.height, viewportHeight: innerHeight };
                candleWindowBases.set(chart.id, candleWindowBase);
            }
            candleResizeHeight = Math.max(300, !event.detail.open && candleWindowBase ? candleWindowBase.layoutHeight : before.height + delta);
            layout.style.minHeight = candleResizeHeight + 'px';
            if (foldLayout) {
                layout.style.height = candleResizeHeight + 'px';
                layout.style.gridTemplateRows = foldLayout.stacked
                    ? [...layout.children].map((item, index) => item.classList.contains('independent-collapsed') ? (item.querySelector('.independent-panel-title').offsetHeight + 40) + 'px' : foldLayout.sizes[index].height + 'px').join(' ')
                    : candleResizeHeight + 'px';
            }
            const viewportDelta = !event.detail.open && candleWindowBase ? Math.min(0, candleWindowBase.viewportHeight - innerHeight) : delta;
            for (const [key, value] of candleWindowBases) if (key !== chart.id) { value.layoutHeight += delta; value.viewportHeight += viewportDelta; }
            window.chrome?.webview?.postMessage(`resize-window:0,${Math.round(viewportDelta)},${innerWidth},${innerHeight}`);
            if (!event.detail.open) candleWindowBases.delete(chart.id);
        });
        window.addEventListener('resize', () => {
            if (candleResizeHeight !== null && layout.clientHeight >= candleResizeHeight && innerHeight >= candleResizeHeight + document.querySelector('.independent-toolbar').offsetHeight + 16) {
                layout.style.minHeight = ''; candleResizeHeight = null;
            }
            if (!foldLayout) return;
            const panels = [...layout.children];
            if (panels.every(item => item.classList.contains('independent-collapsed'))) return;
            // Keep manual resizing available after the native fold resize completes.
            layout.style.flex = '1'; layout.style.width = '100%'; layout.style.height = 'auto';
            if (foldLayout.stacked) {
                layout.style.gridTemplateRows = panels.map(item => item.classList.contains('independent-collapsed') ? collapsedSize(item).height + 'px' : 'minmax(500px, 1fr)').join(' ');
            } else {
                layout.style.gridTemplateColumns = panels.map(item => item.classList.contains('independent-collapsed') ? collapsedSize(item).width + 'px' : 'minmax(0, 1fr)').join(' ');
                layout.style.gridTemplateRows = 'minmax(300px, 1fr)';
            }
        });
        function resizeForFold(panel, toggle) {
            layout.style.minHeight = ''; candleResizeHeight = null; candleWindowBases.clear();
            const panels = [...layout.children];
            if (!foldLayout) foldLayout = { stacked: true,
                sizes: panels.map(item => ({ width: item.offsetWidth, height: item.offsetHeight })) };
            const index = panels.indexOf(panel);
            if (!panel.classList.contains('independent-collapsed')) foldLayout.sizes[index] = { width: panel.offsetWidth, height: panel.offsetHeight };
            toggle();
            const sizes = panels.map((item, i) => {
                if (!item.classList.contains('independent-collapsed')) return foldLayout.sizes[i];
                return collapsedSize(item);
            });
            const height = foldLayout.stacked ? sizes.reduce((sum, item) => sum + item.height, 0) + 14 * (sizes.length - 1) : Math.max(...sizes.map(item => item.height));
            layout.style.gridTemplateColumns = foldLayout.stacked ? 'minmax(0, 1fr)' : sizes.map(item => item.width + 'px').join(' ');
            layout.style.gridTemplateRows = foldLayout.stacked ? sizes.map(item => item.height + 'px').join(' ') : height + 'px';
            layout.style.flex = 'none'; layout.style.width = '100%'; layout.style.height = height + 'px';
            layout.scrollTop = 0; document.scrollingElement.scrollTop = 0;
            const bodyStyle = getComputedStyle(document.body);
            const toolbar = document.querySelector('.independent-toolbar');
            const toolbarStyle = getComputedStyle(toolbar);
            const viewportHeight = Math.ceil(height + toolbar.offsetHeight + parseFloat(toolbarStyle.marginTop) + parseFloat(toolbarStyle.marginBottom) + parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom));
            // A candle may overflow the monitor: size from the actual viewport,
            // never subtract an offscreen content height from the native window.
            window.chrome?.webview?.postMessage(`resize-window:0,${viewportHeight - innerHeight},${innerWidth},${innerHeight}`);
            if (!panels.some(item => item.classList.contains('independent-collapsed'))) {
                // Resume responsive sizing after the native window restores its full size.
                setTimeout(() => { layout.removeAttribute('style'); foldLayout = null; }, 100);
            }
        }
        function collapseControl(panel, heading, bodies, controls) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'independent-collapse';
            button.setAttribute('aria-expanded', 'true'); button.setAttribute('aria-controls', bodies.map(body => body.id).join(' '));
            const name = heading.textContent;
            const group = document.createElement('div'); group.className = 'independent-panel-title';
            heading.before(group); group.append(button, heading);
            function update() {
                const collapsed = panel.classList.contains('independent-collapsed');
                button.textContent = collapsed ? '▼' : '▲'; button.setAttribute('aria-expanded', String(!collapsed));
                button.setAttribute('aria-label', name + (collapsed ? ' 펼치기' : ' 접기')); button.title = button.getAttribute('aria-label');
                bodies.forEach(body => { body.hidden = collapsed; }); if (controls) controls.hidden = collapsed;
                layout.classList.toggle('independent-has-collapse', !!layout.querySelector('.independent-collapsed'));
            }
            button.addEventListener('click', () => resizeForFold(panel, () => { panel.classList.toggle('independent-collapsed'); update(); })); update();
        }
        const table = document.getElementById('transactionTable').closest('.panel');
        const tableBody = table.querySelector('.table-wrapper'); tableBody.id = 'independentTransactionContent';
        collapseControl(table, table.querySelector('h2'), [tableBody], table.querySelector('.panel-controls'));
        const rows = document.getElementById('transactionBody');
        let rowBaseline = null, resetRowBaseline = false;
        // Measure the actual list viewport rather than relying on table container units.
        const rowSizing = new ResizeObserver(() => {
            const height = rows.clientHeight;
            if (!height || !rowBaseline) return;
            if (resetRowBaseline) { rowBaseline.viewport = height; resetRowBaseline = false; }
            const reduction = Math.min(0, height - rowBaseline.viewport);
            const padding = Math.max(0, rowBaseline.padding + reduction * 0.01);
            const rowHeight = rowBaseline.height - 2 * (rowBaseline.padding - padding);
            rows.style.setProperty('--rank-row-height', rowHeight + 'px');
            rows.style.setProperty('--rank-row-padding', padding + 'px');
        });
        rowSizing.observe(rows);
        const chart = document.getElementById('concentrationChartPanel');
        const chartBody = document.createElement('div'); chartBody.id = 'independentChartContent';
        chartBody.append(...[...chart.childNodes].filter(node => !node.classList?.contains('rank-connection-dot'))); chart.append(chartBody);
        const chartHeading = document.createElement('div'); chartHeading.className = 'independent-chart-heading';
        const chartTitle = document.getElementById('concentrationChartTitle');
        chartHeading.append(chartTitle, chart.querySelector('.concentration-stock-picker'), document.getElementById('concentrationMarket')); chart.prepend(chartHeading);
        collapseControl(chart, chartTitle, [chartBody]);
        chartHeading.append(pin.closest('label'));
        function apply(snapshot) {
            if (!snapshot) return;
            const applyConnection = (target, record, flag, fallback) => {
                if (record && typeof record.ok === 'boolean' && Number.isFinite(record.at)) window.setRankCardConnection?.(target, record.ok, record.at);
                else window.setRankCardConnection?.(target, typeof flag === 'boolean' ? flag : fallback);
            };
            applyConnection('#transactionTable', snapshot.tableConnection, snapshot.tableConnected, !!snapshot.rows);
            const ownSelection = window.getRankChartState?.()?.selection?.code;
            if (!pin.checked || ownSelection === snapshot.chart?.selection?.code) {
                const legacyHealthy = !!snapshot.chart?.points?.length && !/실패|오류|만료|연결.*종료/.test(snapshot.chart?.status || '');
                applyConnection('#concentrationChartPanel', snapshot.chartConnection, snapshot.chartConnected, legacyHealthy);
            }
            lastSnapshot = snapshot;
            if (snapshot.supply && !pending.size && !supplySettingsPending) {
                const own = window.getRankSupplyState?.();
                const value = supplyPinned?.checked && own && own.selected !== snapshot.supply.selected ? { ...snapshot.supply, selected: own.selected, points: own.mode === snapshot.supply.mode ? own.points : [], candles: own.mode === snapshot.supply.mode ? own.candles : [], cursor: own.cursor, hasMore: own.hasMore, priceCursor: own.priceCursor, minuteDays: own.minuteDays, priceHistory: own.priceHistory } : snapshot.supply;
                restoringInitialDisplay = !initialDisplayApplied;
                window.applyRankSupplyState?.(value); restoringInitialDisplay = false;
                const current = window.getRankSupplyState?.();
                if (current) supplyKey = JSON.stringify([{ selected: current.selected, mode: current.mode, showCandles: current.showCandles, visibleSeries: current.visibleSeries }, !!supplyPinned?.checked]);
            }
            if (snapshot.refreshStatus) {
                document.getElementById('independentLastUpdate').textContent = snapshot.refreshStatus.time;
                document.getElementById('independentStatusText').textContent = snapshot.refreshStatus.text;
            }
            const body = document.getElementById('transactionBody');
            // Accept only the known table elements/attributes. Never insert executable HTML.
            const template = document.createElement('template'); template.innerHTML = '<table><tbody>' + snapshot.rows + '</tbody></table>';
            for (const node of [...template.content.querySelectorAll('*')]) {
                if (!['TABLE', 'TBODY', 'TR', 'TD', 'SPAN'].includes(node.tagName)) { node.remove(); continue; }
                for (const attr of [...node.attributes]) if (!/^(class|data-chart-(code|name|market)|tabindex|role|aria-label)$/.test(attr.name)) node.removeAttribute(attr.name);
            }
            if (body.dataset.sharedRows !== snapshot.rows) {
                body.replaceChildren(...template.content.querySelector('tbody').childNodes); body.dataset.sharedRows = snapshot.rows;
            }
            const typography = snapshot.typography;
            if (typography) {
                if (/^\d+(\.\d+)?px$/.test(typography.rootFontSize || '')) document.documentElement.style.fontSize = typography.rootFontSize;
                if (typeof typography.family === 'string') document.body.style.fontFamily = typography.family;
                if (/^\d+(\.\d+)?px$/.test(typography.cellFont || '')) body.style.setProperty('--rank-row-font', typography.cellFont);
                const ratio = typography.pixelRatio / devicePixelRatio;
                if (Number.isFinite(ratio) && ratio >= 0.25 && ratio <= 4 && Math.abs(ratio - 1) > 0.02) {
                    resetRowBaseline = true; window.chrome?.webview?.postMessage('page-scale:' + ratio);
                }
            }
            if (!rowBaseline && body.querySelector('tr[data-chart-code] td')) {
                const cell = body.querySelector('tr[data-chart-code] td');
                const padding = Number.isFinite(typography?.cellPadding) ? typography.cellPadding : parseFloat(getComputedStyle(cell).paddingTop);
                const height = Number.isFinite(typography?.rowHeight) ? typography.rowHeight : cell.parentElement.getBoundingClientRect().height;
                rowBaseline = { viewport: body.clientHeight, padding, height };
                body.style.setProperty('--rank-row-height', height + 'px'); body.style.setProperty('--rank-row-padding', padding + 'px');
            }
            for (const [key, value] of Object.entries(snapshot.conditions || {})) {
                const select = document.getElementById(key); if (!select) continue;
                if (![...select.options].some(option => option.value === value)) select.add(new Option(value === '0' ? '수동' : `${Number(value) / 1000}초`, value));
                select.value = value;
            }
            if (!pending.size && (!pin.checked || window.getRankChartState?.()?.selection?.code === snapshot.chart?.selection?.code)) window.applyRankChartState?.(snapshot.chart);
            else if (pin.checked && snapshot.chart && !pending.size) {
                const own = window.getRankChartState?.();
                if (own && (own.mode !== snapshot.chart.mode || own.interval !== snapshot.chart.interval)) {
                    window.applyConcentrationDisplaySettings?.({ ...window.getConcentrationDisplaySettings(), mode: snapshot.chart.mode, interval: snapshot.chart.interval });
                }
            }
            if (pendingCandleChange && snapshot.displayCommandId === pendingCandleChange) pendingCandleChange = null;
            if (snapshot.display && !pendingCandleChange) {
                candleOpen = snapshot.display.candleOpen === true;
                restoringInitialDisplay = !initialDisplayApplied;
                window.applyConcentrationDisplaySettings?.({ ...window.getConcentrationDisplaySettings(), candleOpen });
                restoringInitialDisplay = false;
                initialDisplayApplied = true;
            }
        }
        pin.addEventListener('change', () => { if (!pin.checked) window.applyRankChartState?.(lastSnapshot?.chart); });
        document.getElementById('rankIndependentRefresh').addEventListener('click', () => {
            enqueue({ type: 'refresh' }); if (pin.checked) window.refreshConcentrationChart?.();
            window.refreshRankSupplyChart?.();
        });
        for (const key of ['mrktTp', 'stexTp', 'refreshInterval']) document.getElementById(key).addEventListener('change', event => { enqueue({ type: 'conditions', values: { [key]: event.target.value } }); });
        function formatServerRefreshTime(timestamp) {
            const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
            }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
            return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
        }
        function paintFreshness() {
            if (!serverRefresh) return;
            const age = serverAge + Date.now() - receivedAt;
            const delayed = transportFailed || serverRefresh.error || !serverRefresh.data || age > serverRefresh.interval + 90000;
            document.getElementById('independentStatusText').textContent = delayed ? '갱신 지연' : '완료';
            if (delayed) status.textContent = '갱신 지연 · 마지막 데이터를 표시하고 있습니다.';
        }
        function applyServerRefresh(info) {
            transportFailed = false; serverRefresh = info; receivedAt = Date.now();
            serverAge = info.data ? Math.max(0, info.serverNow - info.data.at) : 0;
            if (info.data && lastSnapshot) {
                const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
                const rows = (info.data.items || []).slice(0, 20).map((stock, index) => {
                    const code = String(stock.stk_cd || '').replace(/_(AL|NX)$/i, '');
                    const name = stock.stk_nm || stock.isu_nm || code;
                    const rate = Number(stock.fluc_rt || stock.base_comp_chgr || 0);
                    const amount = parseInt(String(stock.trde_amt || stock.acml_tr_pbmn || 0).replace(/[^0-9]/g, '')) || 0;
                    const attributes = /^[0-9A-Za-z]{6}$/.test(code) ? `data-chart-code="${code}" data-chart-name="${encodeURIComponent(name)}" data-chart-market="${escape(stock.mkt_type)}" tabindex="0" role="button"` : '';
                    return `<tr ${attributes}><td class="align-right">${escape(stock.rank || index + 1)}</td><td class="market-type">${escape(stock.mkt_type || '-')}</td><td>${escape(name)}</td><td class="align-right num-cell ${rate > 0 ? 'price-up' : rate < 0 ? 'price-down' : ''}">${Number.isFinite(rate) ? rate.toFixed(2) + '%' : '-'}</td><td class="align-right num-cell">${(amount > 100000000 ? Math.round(amount / 1000000) : amount).toLocaleString()}</td><td class="align-right num-cell">${stock.concentration_rate != null && Number.isFinite(Number(stock.concentration_rate)) ? Number(stock.concentration_rate) + '%' : '-'}</td></tr>`;
                }).join('') || '<tr><td colspan="6">데이터가 없습니다.</td></tr>';
                apply({ ...lastSnapshot, rows, chart: info.data.chart || lastSnapshot.chart,
                    supply: info.data.peerSupply || info.data.supply || lastSnapshot.supply,
                    tableConnection: { ok: !info.error, at: Date.now() - serverAge }, chartConnection: { ok: !info.error, at: Date.now() - serverAge },
                    refreshStatus: { time: formatServerRefreshTime(info.data.at), text: '완료' } });
            }
            if (pin.checked && info.data?.peerChart && !pending.size && window.getRankChartState?.()?.selection?.code === info.data.peerChart.selection?.code) window.applyRankChartState?.(info.data.peerChart);
            paintFreshness();
        }
        setInterval(paintFreshness, 1000);
        async function tick() {
            if (closed) return;
            const nextCommand = outgoing.shift(), acks = acknowledgements.splice(0);
            try {
                const response = await peer({ version, command: nextCommand, acks, pinned: pin.checked });
                if ([401, 404].includes(response.status)) {
                    document.querySelectorAll('#tab_rank .panel').forEach(panel => window.setRankCardConnection?.(panel, false));
                    closed = true; status.textContent = '메인 페이지 연결이 종료되었습니다. 메인 페이지에서 다시 실행하세요.';
                    pending.forEach(request => request.reject(new Error(status.textContent))); pending.clear();
                    // Keep the last displayed chart open even when the relay expires.
                    return;
                }
                if (!response.ok) throw new Error('연결 실패');
                const result = await response.json();
                if (nextCommand?.id === supplySettingsPending) supplySettingsPending = null;
                for (const reply of result.replies || []) { pending.get(reply.id)?.resolve(reply); pending.delete(reply.id); acknowledgements.push(reply.id); }
                if (result.snapshot) { version = result.version; apply(result.snapshot); }
                status.textContent = '';
                if (result.serverRefresh) applyServerRefresh(result.serverRefresh);
            } catch (error) { transportFailed = true; document.querySelectorAll('#tab_rank .panel').forEach(panel => window.setRankCardConnection?.(panel, false)); if (nextCommand) outgoing.unshift(nextCommand); acknowledgements.unshift(...acks); status.textContent = '서버 연결 재시도 중 · 갱신 지연'; document.getElementById('independentStatusText').textContent = '갱신 지연'; }
            finally { if (!closed) setTimeout(tick, outgoing.length ? 50 : 500); }
        }
        if (!/^[a-f0-9]{32}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(token || '')) { status.textContent = '메인 페이지의 독립창 버튼으로 실행하세요.'; closed = true; return; }
        tick();
        window.addEventListener('pagehide', () => peer({ close: true }));
        // Pinned selections use the shared query owner on the same refresh schedule.
        let refresh = Date.now();
        setInterval(() => { const interval = Number(document.getElementById('refreshInterval').selectedOptions[0]?.dataset.interval);
            if (!serverRefresh && pin.checked && interval > 0 && Date.now() - refresh >= interval) { refresh = Date.now(); window.refreshConcentrationChart?.(); }
        }, 1000);
    });
})();
