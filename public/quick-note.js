(() => {
    'use strict';
    const initialize = () => {
        const controls = document.getElementById('rankIndependentControls');
        if (!controls || document.getElementById('quickNoteButton')) return;
        const button = document.createElement('button');
        button.id = 'quickNoteButton'; button.type = 'button';
        button.className = 'btn-secondary quick-note-button'; button.title = '노트 열기';
        button.setAttribute('aria-label', '노트 열기'); button.setAttribute('aria-controls', 'quickNotePanel');
        button.setAttribute('aria-expanded', 'false');
        button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="2" width="17" height="20" rx="2" fill="#facc15" stroke="#ca8a04"/><path d="M8 3h10a1 1 0 0 1 1 1v16H8Z" fill="#fef9c3"/><path d="M3 6h3M3 11h3M3 16h3" stroke="#854d0e" stroke-width="2" stroke-linecap="round"/><path d="M11 7h5M11 11h5M11 15h3" stroke="#713f12" stroke-width="1.5" stroke-linecap="round"/></svg>';
        controls.insertBefore(button, controls.querySelector('.market-alert-info') || controls.querySelector('[role="status"]'));
        const native = document.body.classList.contains('quick-note-native');
        if (!native) {
            let statusRegion = controls.querySelector('[role="status"]');
            if (!statusRegion) { statusRegion = document.createElement('span'); statusRegion.setAttribute('role', 'status'); controls.append(statusRegion); }
            const launchStatus = document.createElement('span'); statusRegion.append(launchStatus);
            button.addEventListener('click', async () => {
                if (button.disabled) return;
                button.disabled = true;
                try {
                    const response = await fetch('/api/quick-note/window', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                    const result = await response.json();
                    if (!response.ok || !result.success) throw new Error('로그인과 서버 연결을 확인하세요.');
                    launchStatus.textContent = '노트 창 실행 중…';
                    location.href = 'marketthrough://open?url=' + encodeURIComponent(location.origin + '/quick-note.html#token=' + result.token);
                    let attempts = 0;
                    const check = async () => {
                        try {
                            const reply = await fetch('/api/quick-note/window-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: result.token }) });
                            const state = await reply.json();
                            if (state.connected) { launchStatus.textContent = ''; button.disabled = false; return; }
                        } catch { /* Keep checking until the installation hint is shown. */ }
                        if (++attempts < 20) { setTimeout(check, 1000); return; }
                        launchStatus.textContent = '노트 창이 열리지 않으면 최신 독립창 앱을 설치하세요. ';
                        const link = document.createElement('a'); link.href = '/downloads/MarketThroughSetup.exe'; link.download = 'MarketThroughSetup.exe'; link.textContent = '설치 파일 다운로드'; launchStatus.append(link);
                        button.disabled = false;
                    };
                    setTimeout(check, 1000);
                } catch (error) { launchStatus.textContent = error.message; button.disabled = false; }
            });
            return;
        }
        let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
        history.replaceState(null, '', location.pathname);
        const noteFetch = (options = {}) => fetch('/api/quick-note', { ...options, headers: { ...options.headers, 'X-Note-Token': token } });
        const panel = document.createElement('section');
        panel.id = 'quickNotePanel'; panel.className = 'quick-note-panel'; panel.hidden = true;
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'quickNoteTitle');
        panel.innerHTML = '<div class="quick-note-header"><strong id="quickNoteTitle">노트</strong><label><input type="checkbox" id="quickNoteTopmost"> 항상 위</label><button type="button" class="quick-note-close" aria-label="노트 닫기">×</button></div><div class="quick-note-editor"><div id="quickNoteText"></div></div><div class="quick-note-footer"><div class="quick-note-status" role="status" aria-live="polite"></div><button type="button" class="quick-note-cancel">취소</button><button type="button" class="quick-note-save">저장</button></div>';
        document.body.append(panel);
        const status = panel.querySelector('[role="status"]'), saveButton = panel.querySelector('.quick-note-save');
        const cancelButton = panel.querySelector('.quick-note-cancel'), closeButton = panel.querySelector('.quick-note-close');
        let editor, loaded = false, loading = false, saving = false, conflict = false, revision = 0, saved = '', dirty = false;
        const update = () => {
            dirty = loaded && !!editor && JSON.stringify(editor.getContents()) !== saved;
            saveButton.disabled = !loaded || saving || conflict || !dirty;
            cancelButton.disabled = saving; closeButton.disabled = saving;
            window.chrome?.webview?.postMessage('note-dirty:' + (dirty || saving));
        };
        const ensureEditor = () => {
            if (editor) return true;
            if (!window.Quill) { status.textContent = '편집기를 불러오지 못했습니다. 페이지를 새로고침하세요.'; return false; }
            editor = new Quill('#quickNoteText', {
                theme: 'snow', placeholder: '메모를 작성하세요...',
                modules: { toolbar: { container: [
                    [{ header: [1, 2, 3, false] }], ['bold', 'italic', 'underline', 'strike'],
                    [{ list: 'ordered' }, { list: 'bullet' }], [{ color: [] }, { background: [] }],
                    ['blockquote', 'code-block'], ['link', 'image'], ['clean'], ['today']
                ], handlers: { today() {
                    const index = editor.getSelection(true)?.index ?? editor.getLength() - 1;
                    editor.insertText(index, new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' ', 'user');
                } } } }
            });
            const today = panel.querySelector('.ql-today'); today.textContent = '오늘'; today.title = '오늘 날짜 삽입';
            editor.root.setAttribute('aria-label', '메모 내용'); editor.enable(false);
            editor.on('text-change', () => {
                update();
                if (loaded && !saving && !conflict) status.textContent = dirty ? '저장하지 않은 변경 내용' : '서버에 저장됨';
            });
            return true;
        };
        async function load() {
            if (loading || !ensureEditor()) return;
            loading = true; loaded = false; update(); editor.enable(false);
            status.textContent = '서버에서 노트를 불러오는 중…';
            try {
                const response = await noteFetch({ cache: 'no-store' }), result = await response.json();
                if (!response.ok || !result.success) throw new Error();
                revision = result.revision;
                if (result.delta) editor.setContents(result.delta); else editor.setText(result.text || '');
                saved = JSON.stringify(editor.getContents()); loaded = true; conflict = false; editor.enable(true);
                status.textContent = '저장 버튼을 누르면 서버에 반영됩니다.';
                if (!panel.hidden) editor.focus();
            } catch { status.textContent = '노트를 불러오지 못했습니다. 다시 열면 재시도합니다.'; }
            finally { loading = false; update(); }
        }
        async function save() {
            if (!loaded || saving || !dirty || conflict) return;
            const delta = editor.getContents(); saving = true; editor.enable(false); update(); status.textContent = '서버에 저장 중…';
            try {
                const response = await noteFetch({
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: editor.getText(), delta, revision })
                });
                const result = await response.json(); if (response.status === 409) conflict = true;
                if (!response.ok || !result.success) throw new Error(result.error || '서버에 저장하지 못했습니다. 저장 버튼으로 재시도하세요.');
                revision = result.revision; saved = JSON.stringify(delta); status.textContent = '서버에 저장됨';
            } catch (error) { status.textContent = error.message; }
            finally { saving = false; editor.enable(true); update(); }
        }
        function close(discard) {
            if (saving) return;
            if (discard && editor && loaded) { editor.setContents(JSON.parse(saved)); update(); }
            window.chrome?.webview?.postMessage('note-close');
        }
        button.addEventListener('click', () => {
            if (!panel.hidden) { close(false); return; }
            panel.hidden = false; button.setAttribute('aria-expanded', 'true');
            if (!dirty || !loaded) load(); else editor?.focus();
        });
        saveButton.addEventListener('click', save); cancelButton.addEventListener('click', () => close(true));
        closeButton.addEventListener('click', () => close(false));
        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close(false); }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
        });
        window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
        panel.querySelector('#quickNoteTopmost').addEventListener('change', event => window.chrome?.webview?.postMessage('topmost:' + event.target.checked));
        window.refreshNativeNoteCredentials = value => {
            token = value;
            window.chrome?.webview?.postMessage('topmost:' + panel.querySelector('#quickNoteTopmost').checked);
            // A status request acknowledges reopening without replacing an unsaved draft.
            if (!dirty && !saving) load(); else noteFetch({ cache: 'no-store' }).catch(() => {});
        };
        update();
        button.click();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})();
