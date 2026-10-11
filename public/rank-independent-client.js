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
            button.addEventListener('click', () => { panel.classList.toggle('independent-collapsed'); update(); }); update();
        }
        const table = document.getElementById('transactionTable').closest('.panel');
        const tableBody = table.querySelector('.table-wrapper'); tableBody.id = 'independentTransactionContent';
        collapseControl(table, table.querySelector('h2'), [tableBody], table.querySelector('.panel-controls'));
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
