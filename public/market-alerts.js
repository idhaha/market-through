(() => {
    'use strict';
    document.addEventListener('DOMContentLoaded', () => {
        const root = document.getElementById('tab_rank'), guide = window.marketAlertGuide;
        if (!root || !guide) return;
        root.classList.add('market-alerts');
        const independent = window.rankIndependentClient === true;
        const info = document.createElement('span');
        info.className = 'market-alert-info'; info.append('시장경보');
        const infoIcon = document.createElement('button');
        infoIcon.type = 'button'; infoIcon.className = 'chart-info-button market-alert-info-icon'; infoIcon.textContent = 'i';
        infoIcon.setAttribute('aria-label', '시장경보'); infoIcon.setAttribute('aria-haspopup', 'dialog'); infoIcon.setAttribute('aria-controls', 'marketAlertGuide');
        info.append(infoIcon);
        const controls = document.getElementById('rankIndependentControls');
        // Keep the header order: native window, note, market information.
        if (!independent && controls) {
            const nativeButton = controls.querySelector('button:not(#quickNoteButton)');
            if (nativeButton) nativeButton.after(info); else controls.append(info);
            const note = document.getElementById('quickNoteButton');
            if (note) info.before(note);
        }
        else if (!independent) root.append(info);
        const area = document.createElement('section'); area.id = 'marketAlertArea'; area.setAttribute('aria-label', '시장경보');
        const banner = document.createElement('div'); banner.id = 'marketAlertBanner';
        const status = document.createElement('span'); status.className = 'market-alert-status'; status.setAttribute('role', 'status');
        const loadingStatus = independent ? document.getElementById('rankRefreshStatus') : root.querySelector('.status-info');
        if (!independent) {
            const separator = document.createElement('span');
            separator.className = 'status-separator';
            separator.textContent = '|';
            (loadingStatus || area).append(separator, status);
        }
        area.append(banner); area.hidden = true;
        const header = independent ? document.querySelector('.independent-toolbar') : root.querySelector('header');
        const slot = independent ? header : root.querySelector('.header-single-line');
        // Reuse the title row. The loading/status row remains independently visible.
        if (!header || !slot) return;
        if (independent) {
            if (loadingStatus) loadingStatus.after(area);
            else slot.prepend(area);
        } else {
            const controls = slot.querySelector('.header-controls');
            slot.insertBefore(area, controls);
        }
        header.classList.add('market-alert-header'); area.classList.add('market-alert-slot'); area.tabIndex = 0;
        const dialog = document.createElement('dialog'); dialog.id = 'marketAlertGuide'; dialog.className = 'market-alert-dialog';
        dialog.setAttribute('aria-labelledby', 'marketAlertGuideTitle');
        const close = document.createElement('button'); close.type = 'button'; close.className = 'market-alert-dialog-close'; close.textContent = '닫기';
        close.addEventListener('click', () => dialog.close()); dialog.append(close);
        const title = document.createElement('h2'); title.id = 'marketAlertGuideTitle'; title.textContent = '시장경보 안내'; dialog.append(title);
        const text = (tag, value, parent) => { const node = document.createElement(tag); node.textContent = value; parent.append(node); return node; };
        text('p', '제공 자료 기준 · 표는 좌우로 스크롤할 수 있습니다.', dialog);
        for (const [name, rows, note] of [['서킷브레이커 · 주식시장 전체 정지', guide.circuit, guide.notes[0]], ['사이드카 · 프로그램 매매 정지', guide.sidecar, guide.notes[1]]]) {
            text('h3', name, dialog);
            const scroll = document.createElement('div'); scroll.className = 'market-alert-table-scroll'; dialog.append(scroll);
            const table = document.createElement('table'); scroll.append(table);
            const head = table.createTHead().insertRow(); for (const label of ['단계/시장', '조건', '조치']) text('th', label, head).scope = 'col';
            const body = table.createTBody(); for (const row of rows) { const tr = body.insertRow(); for (const key of ['stage', 'condition', 'action']) text('td', row[key], tr); }
            text('p', note, dialog);
        }
        text('p', '설명은 첨부 엑셀을 정리한 내용입니다. 실제 경보는 LS JIF의 발동·해제 통보를 따릅니다. JIF는 이벤트 시각을 제공하지 않아 화면 시각은 한국 시간 수신시각입니다.', dialog);
        document.body.append(dialog);
        infoIcon.addEventListener('click', () => dialog.showModal());
        dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
        let state, offline = false, lastSignature = '', pendingAck = false;
        const time = value => value == null ? '-' : new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
        const visible = () => (state?.events || []).filter(event => event.visible);
        async function acknowledge(ids) {
            if (independent || !ids.length || pendingAck) return;
            pendingAck = true;
            try {
                const response = await fetch('/api/market-alerts/acknowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }), signal: AbortSignal.timeout(10000) });
                if (!response.ok) throw new Error('확인 실패');
                apply(await response.json());
            } catch { offline = true; paint(); }
            finally { pendingAck = false; }
        }
        function paint() {
            status.textContent = state ? [offline ? '서버 연결 지연 · 마지막 경보 유지' : state.connection,
                '수신 시작 ' + time(state.startedAt), state.lastReceivedAt ? '마지막 시장경보 ' + time(state.lastReceivedAt) : '시장경보 이벤트 수신 대기', state.historyWarning, state.storageError].filter(Boolean).join(' · ').replace(/JIF/g, '시장경보') : '시장경보 연결 대기';
            const events = visible(), signature = JSON.stringify(events);
            area.hidden = events.length === 0;
            header.classList.toggle('market-alert-active', events.length > 0);
            if (signature === lastSignature) return;
            lastSignature = signature;
            const unread = events.some(e => !e.acknowledged);
            const rank = e => (e.active ? 0 : 2) + (e.kind === 'circuit' ? 0 : 1);
            const representative = [...events].sort((a, b) => rank(a) - rank(b))[0];
            root.classList.toggle('market-alert-unread', unread);
            if (representative) {
                root.dataset.alertColor = representative.kind === 'circuit' ? 'red' : 'orange';
            } else { delete root.dataset.alertColor; }
            root.style.setProperty('--alert-delay', `${-(Date.now() % 1500)}ms`);
            if (independent) {
                header.dataset.alertUnread = String(unread);
                if (representative) header.dataset.alertColor = root.dataset.alertColor;
                else delete header.dataset.alertColor;
                header.style.setProperty('--alert-delay', root.style.getPropertyValue('--alert-delay'));
            }
            banner.replaceChildren();
            const compact = new Map();
            for (const event of events) {
                const key = event.market + ':' + event.kind, previous = compact.get(key);
                if (!previous || event.kind !== 'circuit' || event.stage >= previous.stage) compact.set(key, event);
            }
            const displayed = [...compact.values()];
            for (const event of displayed) {
                const description = guide.describe(event), item = document.createElement('div');
                item.className = 'market-alert-banner'; item.dataset.unread = String(!event.acknowledged);
                const label = `${event.market === '1' ? '코스피' : '코스닥'} ${event.kind === 'circuit' ? '서킷브레이커 ' + event.stage + '단계' : '사이드카 ' + (event.stage === 'buy' ? '매수' : '매도')}`;
                if (independent) {
                    text('strong', event.kind === 'circuit' ? `${event.market === '1' ? '코스피' : '코스닥'} 서킷브레이커 ${event.stage}단계` : `사이드카 ${event.market === '1' ? '코스피' : '코스닥'}`, item);
                } else {
                    const timeline = `발동(${time(event.occurredAt)})${event.releasedAt != null ? ' 해제(' + time(event.releasedAt) + ')' : ''}${event.resumedAt != null ? ' 재개(' + time(event.resumedAt) + ')' : ''}`;
                    text('strong', `${label} · ${timeline}${event.active && event.stage === 3 ? ' · 당일 시장 종료' : ''}`, item);
                    text('span', '[조건] ' + description.condition, item).className = 'market-alert-detail';
                    text('span', '[조치] ' + description.action, item).className = 'market-alert-detail';
                }
                item.title = item.textContent;
                banner.append(item);
            }
        }
        function apply(value) {
            if (!value || (state?.epoch === value.epoch && value.version < state.version)) return;
            state = value; offline = false; paint();
        }
        root.addEventListener('click', event => {
            if (independent || !(event.target instanceof Element)) return;
            if (event.target.closest('.panel,button,a,input,select,textarea,label,[role="button"],.market-alert-info')) return;
            void acknowledge(visible().filter(e => !e.acknowledged).map(e => e.id));
        });
        if (!independent) area.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault(); void acknowledge(visible().filter(e => !e.acknowledged).map(e => e.id));
        });
        window.addEventListener('market-alert-state', event => apply(event.detail));
        window.addEventListener('market-alert-offline', () => { offline = true; paint(); });
        if (independent) { apply(window.lastMarketAlertState); paint(); }
        else {
            let closed = false;
            async function poll() {
                try {
                    const response = await fetch('/api/market-alerts', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
                    if (response.status === 401) {
                        state = null; lastSignature = ''; banner.replaceChildren(); area.hidden = true;
                        delete root.dataset.alertColor; root.classList.remove('market-alert-unread');
                        header.classList.remove('market-alert-active');
                        throw new Error('로그인 필요');
                    }
                    if (!response.ok) throw new Error('연결 실패');
                    apply(await response.json());
                } catch { offline = true; paint(); }
                finally { if (!closed) setTimeout(poll, 1000); }
            }
            window.addEventListener('pagehide', () => { closed = true; });
            window.addEventListener('pageshow', event => { if (event.persisted) { closed = false; void poll(); } });
            void poll();
        }
    });
})();
