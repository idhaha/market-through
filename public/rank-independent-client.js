(() => {
    'use strict';
    window.rankIndependentClient = true;
    const rawFetch = window.fetch.bind(window), params = new URLSearchParams(location.hash.slice(1));
    const id = params.get('id'), token = params.get('token');
    history.replaceState(null, '', location.pathname);
    let version = -1, lastSnapshot, closed = false;
    const pending = new Map(), outgoing = [], acknowledgements = [];
    const enqueue = value => outgoing.push({ id: crypto.randomUUID(), ...value });
    let candleOpen = false;
    window.saveAppData = () => {
        const value = window.getConcentrationDisplaySettings?.().candleOpen;
        if (typeof value === 'boolean' && value !== candleOpen) {
            candleOpen = value; enqueue({ type: 'display', candleOpen: value });
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
        if (typeof input !== 'string' || !/^\/api\/concentration-(chart|stock|stocks)(\?|$)/.test(input)) return rawFetch(input, options);
        const result = await command({ type: 'request', path: input, body: options.body ? JSON.parse(options.body) : null,
            selection: window.getRankChartState?.()?.selection, pinned: document.getElementById('rankStockPinned').checked }, options.signal);
        return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json' } });
    };
    document.addEventListener('DOMContentLoaded', () => {
        const status = document.getElementById('rankConnectionStatus'), pin = document.getElementById('rankStockPinned');
        const layout = document.getElementById('tab_rank');
        let foldLayout = null;
        window.addEventListener('resize', () => {
            if (!foldLayout) return;
            const panels = [...layout.children];
            if (panels.every(item => item.classList.contains('independent-collapsed'))) return;
            // Keep manual resizing available after the native fold resize completes.
            layout.style.flex = '1'; layout.style.width = '100%'; layout.style.height = 'auto';
            if (foldLayout.stacked) {
                layout.style.gridTemplateRows = panels.map(item => item.classList.contains('independent-collapsed') ? (item.querySelector('.independent-panel-title').offsetHeight + 40) + 'px' : 'minmax(300px, 1fr)').join(' ');
            } else {
                layout.style.gridTemplateColumns = panels.map(item => item.classList.contains('independent-collapsed') ? Math.max(180, item.querySelector('.independent-panel-title').scrollWidth + 40) + 'px' : 'minmax(0, 1fr)').join(' ');
                layout.style.gridTemplateRows = 'minmax(300px, 1fr)';
            }
        });
        function resizeForFold(panel, toggle) {
            const panels = [...layout.children];
            if (!foldLayout) foldLayout = { stacked: panels[1].offsetTop > panels[0].offsetTop + 20,
                sizes: panels.map(item => ({ width: item.offsetWidth, height: item.offsetHeight })) };
            const index = panels.indexOf(panel);
            if (!panel.classList.contains('independent-collapsed')) foldLayout.sizes[index] = { width: panel.offsetWidth, height: panel.offsetHeight };
            const before = layout.getBoundingClientRect();
            toggle();
            const sizes = panels.map((item, i) => {
                if (!item.classList.contains('independent-collapsed')) return foldLayout.sizes[i];
                const heading = item.querySelector('.independent-panel-title');
                return { width: Math.max(180, heading.scrollWidth + 40), height: heading.offsetHeight + 40 };
            });
            const width = foldLayout.stacked ? Math.max(...sizes.map(item => item.width)) : sizes[0].width + sizes[1].width + 14;
            const height = foldLayout.stacked ? sizes[0].height + sizes[1].height + 14 : Math.max(...sizes.map(item => item.height));
            layout.style.gridTemplateColumns = foldLayout.stacked ? 'minmax(0, 1fr)' : sizes.map(item => item.width + 'px').join(' ');
            layout.style.gridTemplateRows = foldLayout.stacked ? sizes.map(item => item.height + 'px').join(' ') : height + 'px';
            layout.style.flex = 'none'; layout.style.width = width + 'px'; layout.style.height = height + 'px';
            window.chrome?.webview?.postMessage(`resize-window:${Math.round(width - before.width)},${Math.round(height - before.height)},${innerWidth},${innerHeight}`);
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
        // Measure the actual list viewport rather than relying on table container units.
        const rowSizing = new ResizeObserver(() => {
            const height = rows.clientHeight;
            if (!height) return;
            const rowHeight = Math.min(60, Math.max(24, 24 + height * 0.035));
            rows.style.setProperty('--rank-row-height', rowHeight + 'px');
            rows.style.setProperty('--rank-row-padding', (2 + (rowHeight - 24) / 2) + 'px');
        });
        rowSizing.observe(rows);
        const chart = document.getElementById('concentrationChartPanel');
        const chartBody = document.createElement('div'); chartBody.id = 'independentChartContent';
        chartBody.append(...chart.childNodes); chart.append(chartBody);
        const chartHeading = document.createElement('div'); chartHeading.className = 'independent-chart-heading';
        const chartTitle = document.createElement('h2'); chartTitle.textContent = '쏠림율차트'; chartHeading.append(chartTitle); chart.prepend(chartHeading);
        collapseControl(chart, chartTitle, [chartBody]);
        chartHeading.append(pin.closest('label'));
        function apply(snapshot) {
            if (!snapshot) return;
            lastSnapshot = snapshot;
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
            if (snapshot.display) {
                candleOpen = snapshot.display.candleOpen === true;
                window.applyConcentrationDisplaySettings?.({ ...window.getConcentrationDisplaySettings(), candleOpen });
            }
        }
        pin.addEventListener('change', () => { if (!pin.checked) window.applyRankChartState?.(lastSnapshot?.chart); });
        document.getElementById('rankIndependentRefresh').addEventListener('click', () => {
            enqueue({ type: 'refresh' }); if (pin.checked) window.refreshConcentrationChart?.();
        });
        for (const key of ['mrktTp', 'stexTp', 'refreshInterval']) document.getElementById(key).addEventListener('change', event => { enqueue({ type: 'conditions', values: { [key]: event.target.value } }); });
        async function tick() {
            if (closed) return;
            const nextCommand = outgoing.shift(), acks = acknowledgements.splice(0);
            try {
                const response = await peer({ version, command: nextCommand, acks });
                if ([401, 404].includes(response.status)) {
                    closed = true; status.textContent = '메인 페이지 연결이 종료되었습니다. 메인 페이지에서 다시 실행하세요.';
                    pending.forEach(request => request.reject(new Error(status.textContent))); pending.clear();
                    window.chrome?.webview?.postMessage('connection-ended'); return;
                }
                if (!response.ok) throw new Error('연결 실패');
                const result = await response.json();
                for (const reply of result.replies || []) { pending.get(reply.id)?.resolve(reply); pending.delete(reply.id); acknowledgements.push(reply.id); }
                if (result.snapshot) { version = result.version; apply(result.snapshot); }
                status.textContent = '';
            } catch (error) { if (nextCommand) outgoing.unshift(nextCommand); acknowledgements.unshift(...acks); status.textContent = '메인 페이지 연결 재시도 중'; }
            finally { if (!closed) setTimeout(tick, outgoing.length ? 50 : 500); }
        }
        if (!/^[a-f0-9]{32}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(token || '')) { status.textContent = '메인 페이지의 독립창 버튼으로 실행하세요.'; closed = true; return; }
        tick();
        window.addEventListener('pagehide', () => peer({ close: true }));
        // Pinned selections use the shared query owner on the same refresh schedule.
        let refresh = Date.now();
        setInterval(() => { const interval = Number(document.getElementById('refreshInterval').selectedOptions[0]?.dataset.interval);
            if (pin.checked && interval > 0 && Date.now() - refresh >= interval) { refresh = Date.now(); window.refreshConcentrationChart?.(); }
        }, 1000);
    });
})();
