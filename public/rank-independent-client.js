(() => {
    'use strict';
    window.rankIndependentClient = true;
    const rawFetch = window.fetch.bind(window), params = new URLSearchParams(location.hash.slice(1));
    const id = params.get('id'), token = params.get('token');
    history.replaceState(null, '', location.pathname);
    let version = -1, relayEpoch = null, lastSnapshot, closed = false, serverRefresh = null, receivedAt = 0, serverAge = 0, transportFailed = false;
    const pending = new Map(), outgoing = [], acknowledgements = [];
    const enqueue = value => { const id = crypto.randomUUID(); outgoing.push({ id, ...value }); return id; };
    window.saveAppData = () => {};
    const peer = payload => rawFetch(`/api/rank-independent/peer/${id}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
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
            selection: window.getRankChartState?.()?.selection, pinned: false }, options.signal);
        return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json' } });
    };
    document.addEventListener('DOMContentLoaded', () => {
        const status = document.getElementById('rankConnectionStatus');
        document.getElementById('independentAlwaysOnTop').addEventListener('change', event => {
            window.chrome?.webview?.postMessage(`topmost:${event.target.checked}`);
        });
        const layout = document.getElementById('tab_rank');
        let supplyKey = '', supplySettingsPending = null;
        let deferredSnapshot = false;
        function mountSupply() {
            const supply = document.getElementById('rankSupplyChartPanel'), header = supply.querySelector('.concentration-chart-header');
            const content = document.createElement('div'); content.id = 'independentSupplyContent';
            content.append(...[...supply.children].filter(node => node !== header && !node.classList.contains('rank-connection-dot'))); supply.append(content);
            collapseControl(supply, header.querySelector('h2'), [content]);
            if (lastSnapshot?.supply) applySupplySnapshot(lastSnapshot.supply);
        }
        if (document.getElementById('rankSupplyChartPanel')) mountSupply();
        else document.addEventListener('rank-supply-ready', mountSupply, { once: true });
        function applySupplySnapshot(value) {
            const showCandles = window.getRankSupplyState?.().showCandles === true;
            window.applyRankSupplyState?.({ ...value, showCandles });
        }
        function sendSupplySettings() {
            const value = window.getRankSupplyState?.(); if (!value) return;
            const settings = { selected: value.selected, mode: value.mode, visibleSeries: value.visibleSeries };
            const key = JSON.stringify(settings);
            if (key === supplyKey) return;
            const previous = supplyKey ? JSON.parse(supplyKey) : {};
            const changed = Object.keys(settings).filter(name => JSON.stringify(previous[name]) !== JSON.stringify(settings[name]));
            supplyKey = key; supplySettingsPending = enqueue({ type: 'supply-display', settings, changed, pinned: false });
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
        const candleHeights = new Map();
        const candleWindowGrowth = new Map();
        let restoringInitialDisplay = false;
        let initialDisplayApplied = false;
        let automaticResize = false, resizeReset, resizeComplete;
        const resizeQueue = [];
        function finishResize() {
            if (!automaticResize) return;
            automaticResize = false; clearTimeout(resizeReset);
            const complete = resizeComplete; resizeComplete = null; complete?.();
            startResize();
        }
        function startResize() {
            if (automaticResize || !resizeQueue.length) return;
            const { delta, complete, target } = resizeQueue.shift();
            const before = innerHeight;
            resizeComplete = complete ? () => complete(innerHeight - before) : null;
            automaticResize = true;
            resizeReset = setTimeout(finishResize, 1000);
            const change = target == null ? (typeof delta === 'function' ? delta() : delta) : target - innerHeight;
            if (window.chrome?.webview) window.chrome.webview.postMessage(`resize-window:0,${Math.round(change)},${innerWidth},${innerHeight}`);
            else requestAnimationFrame(finishResize);
        }
        function requestHeight(delta, complete, target) {
            resizeQueue.push({ delta, complete, target });
            startResize();
        }
        function fixRows(sizes) {
            layout.style.gridTemplateColumns = 'minmax(0, 1fr)';
            // Cards have intrinsic, capped heights. Pixel tracks retain obsolete
            // table/header heights after row-count changes or narrow-window wraps.
            layout.style.gridTemplateRows = sizes.map(() => 'max-content').join(' ');
            layout.style.flex = '1'; layout.style.width = '100%';
            layout.style.height = 'auto';
            layout.style.minHeight = '';
        }
        document.addEventListener('rank-candle-display', event => {
            const chart = document.getElementById(event.detail.panel || 'concentrationChartPanel');
            const main = chart.querySelector('.concentration-chart-area, .rank-adr-area');
            const candle = chart.querySelector('.concentration-candle-area, .rank-adr-candle-area');
            const panels = [...layout.children], index = panels.indexOf(chart);
            if (index < 0 || chart.classList.contains('independent-collapsed')) return;
            if (restoringInitialDisplay) { if (event.detail.open) requestAnimationFrame(() => candleHeights.set(chart.id, candle.clientHeight)); return; }
            const sizes = panels.map(item => ({ width: item.offsetWidth, height: item.offsetHeight }));
            // Concentration publishes before toggling; supply publishes after toggling.
            // Recover the original plot height in either order.
            const plotHeight = event.detail.open
                ? main.clientHeight + (main.style.flex || candle.hidden ? 0 : candle.clientHeight)
                : candleHeights.get(chart.id) || candle.clientHeight || main.clientHeight;
            main.style.flex = '0 0 ' + plotHeight + 'px'; main.style.height = plotHeight + 'px';
            candle.style.flex = '0 0 ' + plotHeight + 'px'; candle.style.height = plotHeight + 'px';
            const delta = event.detail.open ? plotHeight : -plotHeight;
            sizes[index].height += delta;
            if (event.detail.open) candleHeights.set(chart.id, plotHeight); else candleHeights.delete(chart.id);
            foldLayout = { stacked: true, sizes: sizes.map((size, i) => panels[i].classList.contains('independent-collapsed') ? foldLayout?.sizes[i] || size : size) };
            fixRows(sizes);
            const growth = event.detail.open ? delta : () => -(candleWindowGrowth.get(chart.id) ?? plotHeight);
            requestHeight(growth, event.detail.open ? actual => candleWindowGrowth.set(chart.id, Math.max(0, actual)) : () => candleWindowGrowth.delete(chart.id));
        });
        window.addEventListener('rank-native-resize-complete', () => requestAnimationFrame(finishResize));
        window.addEventListener('resize', () => {
            if (automaticResize || !foldLayout) return;
            candleWindowGrowth.clear();
            const panels = [...layout.children];
            if (panels.every(item => item.classList.contains('independent-collapsed'))) return;
            for (const panel of panels) panel.querySelectorAll('.concentration-chart-area, .rank-adr-area, .concentration-candle-area, .rank-adr-candle-area').forEach(area => { area.style.flex = ''; area.style.height = ''; });
            layout.style.flex = '1'; layout.style.width = '100%'; layout.style.height = 'auto';
            layout.style.gridTemplateRows = panels.map(() => 'max-content').join(' ');
            requestAnimationFrame(() => {
                if (!foldLayout) return;
                panels.forEach((panel, index) => {
                    if (!panel.classList.contains('independent-collapsed')) foldLayout.sizes[index] = { width: panel.offsetWidth, height: panel.offsetHeight };
                    const candle = panel.querySelector('.concentration-candle-area, .rank-adr-candle-area');
                    if (candle && !candle.hidden) candleHeights.set(panel.id, candle.clientHeight);
                });
            });
        });
        function resizeForFold(panel, toggle) {
            layout.style.minHeight = '';
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
            fixRows(sizes);
            layout.scrollTop = 0; document.scrollingElement.scrollTop = 0;
            const bodyStyle = getComputedStyle(document.body);
            const toolbar = document.querySelector('.independent-toolbar');
            const toolbarStyle = getComputedStyle(toolbar);
            const contentHeight = panels.reduce((sum, item) => sum + item.getBoundingClientRect().height, 0) + parseFloat(getComputedStyle(layout).rowGap) * (panels.length - 1);
            const viewportHeight = Math.ceil(contentHeight + toolbar.offsetHeight + parseFloat(toolbarStyle.marginTop) + parseFloat(toolbarStyle.marginBottom) + parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom));
            // A candle may overflow the monitor: size from the actual viewport,
            // never subtract an offscreen content height from the native window.
            requestHeight(0, null, viewportHeight);
            if (!panels.some(item => item.classList.contains('independent-collapsed'))) {
                // Resume responsive sizing after the native window restores its full size.
                setTimeout(() => {
                    const fixedPlot = [...layout.querySelectorAll('.concentration-chart-area, .rank-adr-area')].some(area => area.style.flex);
                    if (!layout.querySelector('.independent-collapsed') && !rowLimit && !candleHeights.size && !fixedPlot) { layout.removeAttribute('style'); foldLayout = null; }
                }, 100);
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
                panel.querySelector('.independent-row-limit')?.toggleAttribute('disabled', collapsed);
                layout.classList.toggle('independent-has-collapse', !!layout.querySelector('.independent-collapsed'));
            }
            button.addEventListener('click', () => resizeForFold(panel, () => { panel.classList.toggle('independent-collapsed'); update(); })); update();
        }
        const table = document.getElementById('transactionTable').closest('.panel');
        const tableBody = table.querySelector('.table-wrapper'); tableBody.id = 'independentTransactionContent';
        collapseControl(table, table.querySelector('h2'), [tableBody], table.querySelector('.panel-controls'));
        const rows = document.getElementById('transactionBody');
        let rowBaseline = null, resetRowBaseline = false;
        let rowLimit = 0, defaultTableHeight = null;
        const rowLimitButton = document.createElement('button');
        rowLimitButton.type = 'button'; rowLimitButton.className = 'independent-row-limit'; rowLimitButton.innerHTML = '<svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true" focusable="false"><path d="M9 2v16M4 7l5-5 5 5M4 13l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        table.querySelector('h2').after(rowLimitButton);
        function fitTableRows(previousHeight) {
            if (table.classList.contains('independent-collapsed')) return;
            const panels = [...layout.children], index = panels.indexOf(table);
            const current = table.getBoundingClientRect().height;
            if (rowLimit && rowBaseline) {
                rows.style.setProperty('--rank-row-height', rowBaseline.height + 'px');
                rows.style.setProperty('--rank-row-padding', rowBaseline.padding + 'px');
            }
            const visible = [...rows.children].slice(0, rowLimit || rows.children.length);
            const target = rowLimit ? Math.ceil(current - rows.clientHeight + visible.reduce((sum, row) => sum + row.getBoundingClientRect().height, 0)) : defaultTableHeight;
            const before = Number.isFinite(previousHeight) ? previousHeight : current;
            if (!target || Math.abs(target - before) < 1) return;
            const sizes = panels.map(item => ({ width: item.offsetWidth, height: item.getBoundingClientRect().height }));
            sizes[index].height = target;
            foldLayout = { stacked: true, sizes: sizes.map((size, i) => panels[i].classList.contains('independent-collapsed') ? foldLayout?.sizes[i] || size : size) };
            fixRows(sizes); requestHeight(target - before);
        }
        function updateRowLimitButton() {
            const current = rowLimit ? rowLimit + '개' : '기본', next = rowLimit === 5 ? '10개' : rowLimit === 10 ? '기본' : '5개';
            rowLimitButton.title = '목록 ' + current + ' 표시 · 클릭하면 ' + next;
            rowLimitButton.setAttribute('aria-label', rowLimitButton.title);
        }
        rowLimitButton.addEventListener('click', () => {
            const previousHeight = table.getBoundingClientRect().height;
            if (!rowLimit) defaultTableHeight = table.classList.contains('independent-collapsed') ? foldLayout?.sizes[[...layout.children].indexOf(table)]?.height : table.getBoundingClientRect().height;
            rowLimit = rowLimit === 0 ? 5 : rowLimit === 5 ? 10 : 0;
            if (rowLimit) rows.dataset.rowLimit = String(rowLimit); else delete rows.dataset.rowLimit;
            rows.scrollTop = 0;
            updateRowLimitButton(); fitTableRows(previousHeight);
            if (!rowLimit) defaultTableHeight = null;
        });
        updateRowLimitButton();
        // Measure the actual list viewport rather than relying on table container units.
        const rowSizing = new ResizeObserver(() => {
            const height = rows.clientHeight;
            if (!height || !rowBaseline || rowLimit) return;
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
        function apply(snapshot) {
            if (!snapshot) return;
            deferredSnapshot = pending.size > 0 || !!supplySettingsPending;
            const applyConnection = (target, record, flag, fallback) => {
                if (record && typeof record.ok === 'boolean' && Number.isFinite(record.at)) window.setRankCardConnection?.(target, record.ok, record.at);
                else window.setRankCardConnection?.(target, typeof flag === 'boolean' ? flag : fallback);
            };
            applyConnection('#transactionTable', snapshot.tableConnection, snapshot.tableConnected, !!snapshot.rows);
            {
                const legacyHealthy = !!snapshot.chart?.points?.length && !/실패|오류|만료|연결.*종료/.test(snapshot.chart?.status || '');
                applyConnection('#concentrationChartPanel', snapshot.chartConnection, snapshot.chartConnected, legacyHealthy);
            }
            lastSnapshot = snapshot;
            if (snapshot.supply && !pending.size && !supplySettingsPending) {
                const value = snapshot.supply;
                restoringInitialDisplay = !initialDisplayApplied;
                applySupplySnapshot(value); restoringInitialDisplay = false;
                const current = window.getRankSupplyState?.();
                if (current) supplyKey = JSON.stringify({ selected: current.selected, mode: current.mode, visibleSeries: current.visibleSeries });
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
            if (rowLimit) fitTableRows();
            for (const [key, value] of Object.entries(snapshot.conditions || {})) {
                const select = document.getElementById(key); if (!select) continue;
                if (![...select.options].some(option => option.value === value)) select.add(new Option(value === '0' ? '수동' : `${Number(value) / 1000}초`, value));
                select.value = value;
            }
            if (!pending.size) window.applyRankChartState?.(snapshot.chart);
            initialDisplayApplied = true;
        }
        document.getElementById('rankIndependentRefresh').addEventListener('click', () => {
            enqueue({ type: 'refresh' });
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
                    supply: info.data.supply || lastSnapshot.supply,
                    tableConnection: { ok: !info.error, at: Date.now() - serverAge }, chartConnection: { ok: !info.error, at: Date.now() - serverAge },
                    refreshStatus: { time: formatServerRefreshTime(info.data.at), text: '완료' } });
            }
            paintFreshness();
        }
        setInterval(paintFreshness, 1000);
        async function tick() {
            if (closed) return;
            const nextCommand = outgoing.shift(), acks = acknowledgements.splice(0);
            try {
                const response = await peer({ version, epoch: relayEpoch, command: nextCommand, acks, pinned: false });
                if ([401, 404].includes(response.status)) {
                    document.querySelectorAll('#tab_rank .panel').forEach(panel => window.setRankCardConnection?.(panel, false));
                    version = -1;
                    // The authenticated main page restores the same capability after
                    // server restart. Keep the view and retry instead of stopping.
                    throw new Error('메인 페이지 연결 복구 대기');
                }
                if (!response.ok) throw new Error('연결 실패');
                const result = await response.json();
                relayEpoch = result.epoch || null;
                if (nextCommand?.id === supplySettingsPending) supplySettingsPending = null;
                for (const reply of result.replies || []) { pending.get(reply.id)?.resolve(reply); pending.delete(reply.id); acknowledgements.push(reply.id); }
                if (result.snapshot) { version = result.version; apply(result.snapshot); }
                else if (deferredSnapshot && !pending.size && !supplySettingsPending) apply(lastSnapshot);
                status.textContent = '';
                if (result.serverRefresh) applyServerRefresh(result.serverRefresh);
            } catch (error) { transportFailed = true; document.querySelectorAll('#tab_rank .panel').forEach(panel => window.setRankCardConnection?.(panel, false)); if (nextCommand) outgoing.unshift(nextCommand); acknowledgements.unshift(...acks); status.textContent = '서버 연결 재시도 중 · 갱신 지연'; document.getElementById('independentStatusText').textContent = '갱신 지연'; }
            finally { if (!closed) setTimeout(tick, transportFailed ? 1000 : outgoing.length ? 50 : 500); }
        }
        if (!/^[a-f0-9]{32}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(token || '')) { status.textContent = '메인 페이지의 독립창 버튼으로 실행하세요.'; closed = true; return; }
        tick();
        window.addEventListener('pagehide', () => peer({ close: true }));
    });
})();
