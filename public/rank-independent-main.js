(() => {
    'use strict';
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    const mobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);
    // Only Windows desktops can run the installed native app. Do not infer this from screen width.
    if (mobile || !/Win/i.test(platform)) return;
    const rawFetch = window.fetch.bind(window);
    const inflight = new Map(), recent = new Map();
    const allowed = path => /^\/api\/(?:concentration-(chart|stock|stocks)|ls-concentration-chart|kis-supply\/chart|supply\/(watchlist|chart|candles))(\?|$)/.test(path);
    // One query owner, including requests made on behalf of the native view.
    window.fetch = async (input, options = {}) => {
        if (typeof input !== 'string' || !allowed(input)) return rawFetch(input, options);
        const key = input + '\n' + (options.body || '');
        if (!inflight.has(key)) {
            const { signal, ...sharedOptions } = options;
            const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 65000);
            inflight.set(key, rawFetch(input, { ...sharedOptions, signal: controller.signal }).then(async response => {
                const result = { body: await response.text(), status: response.status };
                if (response.ok) recent.set(key, { ...result, time: Date.now() });
                while (recent.size > 32) recent.delete(recent.keys().next().value);
                return result;
            }).finally(() => { clearTimeout(timeout); inflight.delete(key); }));
        }
        const result = await inflight.get(key);
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return new Response(result.body, { status: result.status, headers: { 'Content-Type': 'application/json' } });
    };
    document.addEventListener('DOMContentLoaded', () => {
        const controls = document.getElementById('rankIndependentControls');
        if (!controls) return;
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '독립창'; button.className = 'btn-secondary';
        const message = document.createElement('span'); message.setAttribute('role', 'status');
        controls.append(button, message);
        let channel, timer, running = false, connected = false, started = 0, peerLastSeen = 0;
        let dirty = true, chartKey = '', replies = [], acknowledgements = [];
        const handled = new Set();
        window.addEventListener('rank-connection-change', () => { dirty = true; });
        function reset(text = '') {
            clearTimeout(timer);
            if (channel) rawFetch(`/api/rank-independent/${channel.id}/owner`, { method: 'DELETE', headers: { 'X-Rank-Owner': channel.ownerKey } }).catch(() => {});
            channel = null; connected = false; replies = []; acknowledgements = []; handled.clear(); button.disabled = false; message.textContent = text;
        }
        async function downloadInstaller() {
            const text = '독립창 앱이 설치되지 않았거나 실행이 취소되어 연결하지 못했습니다. 설치 파일을 다운로드합니다. 다운로드한 MarketThroughSetup.exe를 실행해 설치한 뒤 독립창 버튼을 다시 누르세요.';
            reset(text);
            try {
                const response = await rawFetch('/downloads/MarketThroughSetup.exe', { method: 'HEAD' });
                if (!response.ok) throw new Error('설치 파일을 다운로드할 수 없습니다. 서버에 설치 파일이 배포되어 있는지 확인하세요.');
                window.alert(text);
                const link = document.createElement('a');
                link.href = '/downloads/MarketThroughSetup.exe'; link.download = 'MarketThroughSetup.exe'; link.hidden = true;
                document.body.append(link); link.click(); link.remove();
            } catch (error) { message.textContent = error.message; }
        }
        function chartMetadata(state){
            if(!state)return state;
            const {points,candles,priceHistory,minuteDays,...metadata}=state;return metadata;
        }
        function snapshot() {
            const cell = document.querySelector('#transactionBody tr[data-chart-code] td');
            const style = cell && getComputedStyle(cell);
            return { tableConnection: window.getRankCardConnectionState?.('#transactionTable'), chartConnection: window.getRankCardConnectionState?.('#combinedConcentrationChartPanel'), tableConnected: window.getRankCardConnection?.('#transactionTable') === true, chartConnected: window.getRankCardConnection?.('#combinedConcentrationChartPanel') === true, rows: document.getElementById('transactionBody').innerHTML, chart: chartMetadata(window.getRankChartState?.()), display: window.getConcentrationDisplaySettings?.(),
                supply: chartMetadata(window.getRankSupplyState?.()),
                refreshStatus: { time: document.getElementById('lastUpdate')?.textContent || '-', text: document.getElementById('statusText')?.textContent || '대기 중' },
                typography: { rootFontSize: getComputedStyle(document.documentElement).fontSize, family: getComputedStyle(document.body).fontFamily,
                    pixelRatio: devicePixelRatio, cellFont: style?.fontSize, cellPadding: style && parseFloat(style.paddingTop), rowHeight: cell?.parentElement.getBoundingClientRect().height },
                conditions: Object.fromEntries(['mrktTp', 'stexTp', 'refreshInterval'].map(id => [id, document.getElementById(id)?.value])) };
        }
        async function execute(command) {
            try {
                if (command.type === 'supply-watchlist') { await window.refreshRankSupplyChart?.(); dirty = true; return; }
                if (command.type === 'supply-display' && command.pinned) return;
                if (command.type === 'supply-display') {
                    const current = window.getRankSupplyState?.() || {};
                    const fields = ['selected', 'mode', 'visibleSeries'];
                    const changes = Object.fromEntries((Array.isArray(command.changed) ? command.changed : Object.keys(command.settings || {})).filter(key => fields.includes(key)).map(key => [key, command.settings[key]]));
                    const settings = { ...current, ...changes, ...(command.pinned ? { selected: current.selected || '' } : {}) };
                    window.applyRankSupplySettings?.(settings); dirty = true; return;
                }
                if (command.type === 'server-chart') { window.applyRankChartState?.(command.chart); dirty = true; return; }
                if (command.type === 'conditions') {
                    for (const [id, value] of Object.entries(command.values || {})) {
                        if (!['mrktTp', 'stexTp', 'refreshInterval'].includes(id)) continue;
                        const select = document.getElementById(id);
                        if ([...select.options].some(option => option.value === value) && select.value !== value) { select.value = value; select.dispatchEvent(new Event('change')); }
                    }
                    dirty = true; return;
                }
                if (command.type === 'refresh') { if (window.loadTransactionRank) await window.loadTransactionRank({ refreshMarketCharts: false, reportStatus: true }); else window.refreshConcentrationChart?.(); return; }
                if (command.type !== 'request' || !allowed(command.path) || command.path.length > 300) throw new Error('지원하지 않는 요청입니다.');
                if (command.path === '/api/concentration-chart' && !command.pinned && !command.body?.debug_five) {
                    window.setRankChartQuery?.(command.selection, command.body.mode, command.body.interval, !command.pinned);
                }
                const body = command.body ? JSON.stringify(command.body) : '';
                const key = command.path + '\n' + body;
                const cached = recent.get(key);
                let result = cached && Date.now() - cached.time < 5000 ? cached : null;
                if (!result) {
                    const response = await window.fetch(command.path, body ? { method: command.method === 'PUT' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body } : {});
                    result = { body: await response.text(), status: response.status };
                }
                replies.push({ id: command.id, ...result });
            } catch (error) { replies.push({ id: command.id, body: JSON.stringify({ success: false, error: error.message }), status: 502 }); }
        }
        async function tick() {
            if (!channel || running) return;
            running = true;
            const pending = replies.splice(0), acks = acknowledgements.splice(0);
            try {
                const payload = { replies: pending, acks };
                if (dirty) { payload.snapshot = snapshot(); dirty = false; }
                const response = await rawFetch(`/api/rank-independent/${channel.id}/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Rank-Owner': channel.ownerKey }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
                if (response.status === 404) {
                    const restored = await rawFetch(`/api/rank-independent/${channel.id}/recover`, { method: 'POST',
                        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: channel.token, ownerKey: channel.ownerKey }), signal: AbortSignal.timeout(10000) });
                    if (!restored.ok) throw new Error('독립창 연결 복구 재시도');
                    replies.unshift(...pending); acknowledgements.unshift(...acks); dirty = true;
                    message.textContent = '독립창 연결 복구 중';
                    return;
                }
                if (!response.ok) throw new Error('독립창 연결 재시도');
                const result = await response.json();
                if (result.connected) { connected = true; peerLastSeen = Date.now(); message.textContent = ''; }
                if (result.closed) { reset(); return; }
                if (connected && Date.now() - peerLastSeen > 120000) message.textContent = '독립창 연결 재시도 중';
                if (!connected && Date.now() - started > 20000) {
                    await downloadInstaller(); return;
                }
                for (const command of result.commands) {
                    acknowledgements.push(command.id);
                    if (!handled.has(command.id)) {
                        handled.add(command.id); while (handled.size > 128) handled.delete(handled.values().next().value);
                        execute(command);
                    }
                }
            } catch (error) { replies.unshift(...pending); acknowledgements.unshift(...acks); dirty = true; message.textContent = '독립창 연결 재시도 중'; }
            finally { running = false; if (channel) timer = setTimeout(tick, 500); }
        }
        button.addEventListener('click', async () => {
            if (channel || button.disabled) return;
            button.disabled = true;
            try {
                const response = await rawFetch('/api/rank-independent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                if (!response.ok) throw new Error('로그인과 서버 연결을 확인하세요.');
                channel = await response.json(); started = Date.now(); dirty = true; message.textContent = '독립창 앱 실행 중';
                tick();
                // Capability is placed in the fragment, never in HTTP access logs.
                const url = location.origin + '/rank-independent.html#' + new URLSearchParams({ id: channel.id, token: channel.token });
                location.href = 'marketthrough://open?url=' + encodeURIComponent(url);
            } catch (error) { reset(error.message); }
        });
        new MutationObserver(() => { dirty = true; }).observe(document.getElementById('transactionBody'), { childList: true, subtree: true, characterData: true });
        const statusObserver = new MutationObserver(() => { dirty = true; });
        for (const id of ['lastUpdate', 'statusText']) {
            const element = document.getElementById(id);
            if (element) statusObserver.observe(element, { childList: true, subtree: true, characterData: true });
        }
        document.addEventListener('rank-chart-state', () => {
            const chart = window.getRankChartState?.(); if (!chart) return;
            // Zoom/scroll redraws do not publish view state or duplicate large snapshots.
            const key = JSON.stringify([chart.selection, chart.mode, chart.interval, chart.cursor, chart.busy, chart.status, chart.revision, window.getConcentrationDisplaySettings?.()]);
            if (key !== chartKey) { chartKey = key; dirty = true; }
        });
        document.addEventListener('rank-supply-state', () => { dirty = true; });
        for (const id of ['mrktTp', 'stexTp', 'refreshInterval']) document.getElementById(id)?.addEventListener('change', () => { dirty = true; });
        window.addEventListener('resize', () => { dirty = true; });
        window.addEventListener('pagehide', () => { if (channel) rawFetch(`/api/rank-independent/${channel.id}/owner`, { method: 'DELETE', headers: { 'X-Rank-Owner': channel.ownerKey }, keepalive: true }); });
    });
})();
