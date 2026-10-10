/* Paired US calendar links. Drafts remain outside the persisted settings. */
(() => {
    let host, getData, persist;
    let draft = null, clickTimer = null, draggedId = null;
    let saveQueue = Promise.resolve();
    const id = () => crypto.randomUUID();
    const clearClick = () => { clearTimeout(clickTimer); clickTimer = null; };
    const items = () => {
        const data = getData();
        if (!Array.isArray(data.items)) data.items = [];
        const seen = new Set();
        data.items = data.items.filter(item => item && typeof item.title === 'string' && typeof item.url === 'string');
        data.items.forEach(item => {
            if (typeof item.id !== 'string' || !item.id || seen.has(item.id)) item.id = id();
            seen.add(item.id);
        });
        return data.items;
    };
    function message(text) { host.querySelector('[role="status"]').textContent = text; }
    function save() {
        message('저장 중…');
        // Serialize saves so older server writes cannot overwrite newer changes.
        saveQueue = saveQueue.catch(() => {}).then(() => persist()).then(ok => {
            message(ok === false ? '브라우저에 저장되었습니다. 서버 저장에 실패했습니다.' : '저장되었습니다.');
        }).catch(() => message('저장하지 못했습니다. 다시 시도해 주세요.'));
    }
    function button(text, action, className = '') {
        const el = document.createElement('button');
        el.type = 'button'; el.textContent = text; el.className = className;
        el.addEventListener('click', action);
        return el;
    }
    function begin(item) {
        clearClick();
        if (draft && !confirm('편집 중인 내용을 취소하고 다른 항목을 편집하시겠습니까?')) return;
        draft = { id: item?.id || null, title: item?.title || '', url: item?.url || '', description: typeof item?.description === 'string' ? item.description : '' };
        render(); host.querySelector('input').focus();
    }
    function commit(asNew) {
        const title = draft.title.trim(), url = draft.url.trim(), description = draft.description.trim();
        if (!title || !url) return message('제목과 URL을 모두 입력해 주세요.');
        try {
            if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error();
        } catch { return message('http:// 또는 https://로 시작하는 올바른 URL을 입력해 주세요.'); }
        const list = items();
        if (list.some(item => item.title === title && item.url === url && (asNew || item.id !== draft.id))) {
            return message('제목과 URL이 모두 동일한 항목이 이미 있습니다.');
        }
        if (asNew || !draft.id) list.push({ id: id(), title, url, description });
        else {
            const item = list.find(item => item.id === draft.id);
            if (!item) return message('원본 항목을 찾을 수 없습니다.');
            Object.assign(item, { title, url, description });
        }
        draft = null; render(); save();
    }
    function open(item) {
        try {
            if (['https:', 'http:'].includes(new URL(item.url).protocol)) window.open(item.url, '_blank', 'noopener,noreferrer');
        } catch { message('URL을 확인한 뒤 편집해 주세요.'); }
    }
    function row(item, editing) {
        const tr = document.createElement('tr');
        tr.dataset.id = item.id || '';
        for (const field of ['title', 'description']) {
            const td = document.createElement('td');
            td.className = field === 'title' ? 'us-item-cell' : 'us-description-cell';
            if (editing) {
                if (field === 'title') {
                    for (const inputField of ['title', 'url']) {
                        const input = document.createElement('input');
                        input.type = inputField === 'url' ? 'url' : 'text';
                        input.value = draft[inputField];
                        input.setAttribute('aria-label', inputField === 'url' ? 'URL' : '제목');
                        if (inputField === 'url') input.className = 'us-url-input';
                        input.addEventListener('input', () => { draft[inputField] = input.value; });
                        input.addEventListener('keydown', event => {
                            if (event.isComposing) return;
                            if (event.key === 'Enter') commit(!draft.id);
                            if (event.key === 'Escape') { draft = null; render(); }
                        });
                        td.append(input);
                    }
                } else {
                    const descriptionInput = document.createElement('textarea');
                    descriptionInput.className = 'us-description-input';
                    descriptionInput.setAttribute('aria-label', '설명');
                    descriptionInput.placeholder = '설명 (선택사항)';
                    descriptionInput.value = draft.description;
                    descriptionInput.addEventListener('input', () => { draft.description = descriptionInput.value; });
                    descriptionInput.addEventListener('keydown', event => {
                        if (event.isComposing) return;
                        if (event.key === 'Escape') { draft = null; render(); }
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(!draft.id); }
                    });
                    td.append(descriptionInput);
                }
            } else if (field === 'title') {
                const link = button(item[field], () => {}, 'us-link');
                link.title = item[field];
                // Handle the entire cell, including its padding and empty space.
                td.addEventListener('click', event => {
                    if (event.target.closest('.us-drag-handle')) return;
                    clearClick();
                    if (event.detail >= 2) {
                        event.preventDefault(); begin(item);
                        return;
                    }
                    clickTimer = setTimeout(() => { clickTimer = null; open(item); }, 650);
                });
                td.addEventListener('dblclick', event => {
                    if (event.target.closest('.us-drag-handle')) return;
                    event.preventDefault(); clearClick();
                    if (!draft) begin(item);
                });
                link.addEventListener('keydown', event => {
                    if (event.key === 'F2') { event.preventDefault(); begin(item); }
                    if (event.key === 'Enter') { event.preventDefault(); clearClick(); open(item); }
                });
                if (field === 'title') {
                    const handle = document.createElement('span');
                    handle.textContent = '⠿'; handle.className = 'us-drag-handle'; handle.draggable = !draft;
                    handle.title = '드래그하여 순서 이동';
                    handle.addEventListener('dragstart', event => {
                        clearClick(); draggedId = item.id;
                        event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move';
                    });
                    handle.addEventListener('dragend', () => { draggedId = null; clearTargets(); });
                    td.append(handle);
                }
                td.append(link);
                const urlLink = button(item.url, () => {}, 'us-link us-url-link');
                urlLink.title = item.url;
                urlLink.addEventListener('keydown', event => {
                    if (event.key === 'F2') { event.preventDefault(); begin(item); }
                    if (event.key === 'Enter') { event.preventDefault(); clearClick(); open(item); }
                });
                td.append(urlLink);
            } else {
                td.addEventListener('dblclick', event => {
                    if (event.target.closest('.us-description')) return;
                    event.preventDefault(); begin(item);
                    host.querySelector('.us-description-input').focus();
                });
                if (typeof item.description === 'string' && item.description) {
                    const details = document.createElement('div');
                    details.className = 'us-description';
                    details.addEventListener('click', event => { event.stopPropagation(); clearClick(); });
                    details.addEventListener('dblclick', event => {
                        event.stopPropagation(); clearClick();
                        if (event.target.closest('.us-description-toggle')) return;
                        begin(item);
                        host.querySelector('.us-description-input').focus();
                    });
                    const text = document.createElement('p');
                    text.className = 'us-description-text';
                    text.id = `us-description-${item.id}`;
                    text.textContent = item.description;
                    const toggle = button('펼치기', () => {
                        clearClick();
                        const expanded = toggle.getAttribute('aria-expanded') !== 'true';
                        toggle.setAttribute('aria-expanded', String(expanded));
                        text.classList.toggle('expanded', expanded);
                        toggle.textContent = expanded ? '접기' : '펼치기';
                    }, 'us-description-toggle');
                    toggle.setAttribute('aria-expanded', 'false');
                    toggle.setAttribute('aria-controls', text.id);
                    toggle.hidden = true;
                    details.append(text, toggle); td.append(details);
                }
            }
            tr.append(td);
        }
        const actions = document.createElement('td'); actions.className = 'us-actions';
        if (editing) {
            actions.append(button('저장', () => commit(false)), button('새로저장', () => commit(true)));
            actions.append(button('ESC', () => { draft = null; render(); }, 'us-cancel'));
            if (draft.id) {
                const remove = button('삭제', () => {
                    if (!confirm(`“${item.title}” 항목을 삭제하시겠습니까?`)) return;
                    getData().items = items().filter(entry => entry.id !== item.id);
                    draft = null; render(); save();
                }, 'us-delete');
                remove.setAttribute('aria-label', '항목 삭제'); actions.append(remove);
            }
        }
        if (draft) tr.append(actions);
        tr.addEventListener('dragover', event => {
            if (!draggedId || draft || draggedId === item.id) return;
            event.preventDefault(); clearTargets(); tr.classList.add('us-drop-target');
        });
        tr.addEventListener('drop', event => {
            event.preventDefault(); clearTargets();
            if (!draggedId || draft || draggedId === item.id) return;
            const list = items(), from = list.findIndex(entry => entry.id === draggedId);
            const to = list.findIndex(entry => entry.id === item.id);
            if (from < 0 || to < 0) return;
            list.splice(to, 0, list.splice(from, 1)[0]); draggedId = null; render(); save();
        });
        return tr;
    }
    function clearTargets() { host.querySelectorAll('.us-drop-target').forEach(el => el.classList.remove('us-drop-target')); }
    function applyColumnWidth() {
        const saved = Number(getData().titleColumnWidth);
        const width = Number.isFinite(saved) && saved >= 15 && saved <= 65 ? saved : 28;
        host.querySelector('.us-title-col').style.width = `${width}%`;
        const handle = host.querySelector('.us-column-resize');
        handle.setAttribute('aria-valuenow', String(Math.round(width)));
    }
    function attachColumnResize() {
        const handle = host.querySelector('.us-column-resize');
        let resizing = false, changed = false;
        const update = value => {
            getData().titleColumnWidth = Math.max(15, Math.min(65, value));
            applyColumnWidth();
        };
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault(); clearClick();
            resizing = true; changed = false;
            handle.setPointerCapture(event.pointerId);
            host.classList.add('us-resizing');
        });
        handle.addEventListener('pointermove', event => {
            if (!resizing) return;
            const rect = host.querySelector('table').getBoundingClientRect();
            update((event.clientX - rect.left) / rect.width * 100);
            changed = true;
        });
        const finish = () => {
            if (!resizing) return;
            resizing = false; host.classList.remove('us-resizing');
            if (changed) save();
        };
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('lostpointercapture', finish);
        handle.addEventListener('pointercancel', finish);
        handle.addEventListener('keydown', event => {
            const current = Number(handle.getAttribute('aria-valuenow'));
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            update(event.key === 'Home' ? 15 : event.key === 'End' ? 65 : current + (event.key === 'ArrowRight' ? 1 : -1));
            save();
        });
    }
    function render() {
        clearClick();
        host.querySelector('.us-links-table').classList.toggle('is-editing', Boolean(draft));
        host.querySelector('colgroup').innerHTML = `<col class="us-title-col"><col>${draft ? '<col class="us-actions-col">' : ''}`;
        applyColumnWidth();
        host.querySelector('.us-actions-heading').hidden = !draft;
        const body = host.querySelector('tbody'); body.replaceChildren();
        const list = items();
        list.forEach(item => body.append(row(item, draft?.id === item.id)));
        if (draft && !draft.id) body.append(row(draft, true));
        if (!list.length && !draft) {
            const tr = document.createElement('tr'), td = document.createElement('td');
            td.colSpan = 2; td.className = 'us-empty'; td.textContent = '등록된 항목이 없습니다. 항목 추가로 시작하세요.';
            tr.append(td);
            const actions = document.createElement('td'); actions.className = 'us-actions';
            if (draft) tr.append(actions); body.append(tr);
        }
        requestAnimationFrame(() => {
            host.querySelectorAll('.us-description').forEach(details => {
                const text = details.querySelector('.us-description-text');
                details.querySelector('button').hidden = text.scrollHeight <= text.clientHeight + 1;
            });
        });
    }
    window.USLinks = {
        layout: () => `<div class="container us-links-container"><header class="header-single-line"><h1><strong>자본동향</strong></h1><button type="button" class="btn-primary us-add">항목 추가</button></header><p class="us-help">한 번 클릭: URL 열기 / 더블클릭: 편집 / ⠿ 드래그: 순서 이동</p><p role="status" aria-live="polite" class="us-status"></p><div class="us-table-scroll"><table class="us-links-table"><colgroup><col class="us-title-col"><col></colgroup><thead><tr><th scope="col" class="us-item-heading">항목<span class="us-column-resize" role="separator" aria-label="항목과 설명 열 너비 조절" aria-orientation="vertical" aria-valuemin="15" aria-valuemax="65" aria-valuenow="28" tabindex="0" title="드래그하여 열 너비 조절"></span></th><th scope="col"><span class="us-description-heading">설명</span></th><td class="us-actions-heading" aria-hidden="true" hidden></td></tr></thead><tbody></tbody></table><div class="us-table-footer"><button type="button" class="us-add-circle" aria-label="아래에 항목 추가" title="항목 추가">+</button></div></div></div>`,
        mount: (element, data, saveData) => {
            if (host === element) return;
            host = element; getData = data; persist = saveData;
            host.querySelector('.us-add').addEventListener('click', () => begin(null));
            host.querySelector('.us-add-circle').addEventListener('click', () => begin(null)); render();
            attachColumnResize();
        },
        refresh: () => { if (host) { draft = null; draggedId = null; render(); message(''); } }
    };
})();
