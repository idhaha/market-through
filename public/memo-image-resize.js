// 노트(Quill 1.3.6) 그림 크기 조절 (2026-11-12).
// 그림을 붙여 넣거나 클릭하면 선택 상태가 되어 그림 둘레에 테두리와 조절점 8개(꼭지점 4 · 변 가운데 4)를 띄운다.
// 조절점을 끌면 너비가 바뀌고 높이는 비율대로 따라간다. 끝나면 Quill 이미지의 width 속성으로 남겨 저장 · 불러오기에 그대로 쓰인다.
// 그림 밖을 누르거나 글을 치거나 Esc를 누르면 선택이 풀린다. 선택한 채 Delete · Backspace를 누르면 그림을 지운다.
(function () {
    'use strict';
    const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const MIN_WIDTH = 24;
    function attach(quill) {
        if (!quill || quill.__imageResize) return;
        quill.__imageResize = true;
        const root = quill.root, container = quill.container;
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        const overlay = document.createElement('div');
        overlay.className = 'memo-image-overlay';
        overlay.hidden = true;
        for (const pos of HANDLES) {
            const h = document.createElement('span');
            h.className = 'memo-image-handle memo-image-handle-' + pos;
            h.dataset.pos = pos;
            overlay.append(h);
        }
        const size = document.createElement('span');
        size.className = 'memo-image-size';
        overlay.append(size);
        container.append(overlay);
        let selected = null, drag = null;
        const known = new WeakSet();
        const remember = () => { for (const img of root.querySelectorAll('img')) known.add(img); };
        function place() {
            if (!selected || !root.contains(selected)) { hide(); return; }
            const c = container.getBoundingClientRect(), r = selected.getBoundingClientRect();
            // Absolute positions start inside the container's border (clientLeft · clientTop).
            Object.assign(overlay.style, { left: (r.left - c.left - container.clientLeft) + 'px', top: (r.top - c.top - container.clientTop) + 'px', width: r.width + 'px', height: r.height + 'px' });
            size.textContent = Math.round(r.width) + ' × ' + Math.round(r.height);
        }
        function select(img) { selected = img; overlay.hidden = false; place(); }
        function hide() { selected = null; overlay.hidden = true; drag = null; }
        root.addEventListener('click', e => { if (e.target.tagName === 'IMG') select(e.target); });
        root.addEventListener('scroll', place);
        window.addEventListener('resize', place);
        document.addEventListener('mousedown', e => { if (selected && !overlay.contains(e.target) && e.target !== selected) hide(); }, true);
        root.addEventListener('keydown', e => {
            if (!selected) return;
            if (e.key === 'Escape') { hide(); return; }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const blot = Quill.find(selected);
                if (blot) { e.preventDefault(); e.stopPropagation(); const index = quill.getIndex(blot); quill.deleteText(index, 1, 'user'); quill.setSelection(index, 0, 'user'); }
                hide(); return;
            }
            hide();
        }, true);
        quill.on('text-change', (delta, old, source) => {
            // A newly pasted or inserted picture is selected at once; pictures loaded from the server are not.
            const fresh = source === 'user' && delta.ops.some(op => op.insert && typeof op.insert === 'object' && op.insert.image)
                ? [...root.querySelectorAll('img')].filter(img => !known.has(img)) : [];
            remember();
            if (fresh.length) requestAnimationFrame(() => { const img = fresh[fresh.length - 1]; if (img.complete) select(img); else img.addEventListener('load', () => select(img), { once: true }); });
            else requestAnimationFrame(place);
        });
        remember();
        overlay.addEventListener('mousedown', e => {
            const pos = e.target.dataset && e.target.dataset.pos;
            if (!pos || !selected) return;
            e.preventDefault(); e.stopPropagation();
            const r = selected.getBoundingClientRect();
            drag = { pos, x: e.clientX, y: e.clientY, width: r.width, ratio: r.height / Math.max(r.width, 1) };
        });
        document.addEventListener('mousemove', e => {
            if (!drag || !selected) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y, p = drag.pos;
            // Left handles grow to the left; top and bottom handles change the height, turned into a width by the ratio.
            let change = p.includes('e') ? dx : p.includes('w') ? -dx : 0;
            if (p === 'n' || p === 's') change = (p === 's' ? dy : -dy) / (drag.ratio || 1);
            else if (p.length === 2) { const v = (p.includes('s') ? dy : -dy) / (drag.ratio || 1); if (Math.abs(v) > Math.abs(change)) change = v; }
            const max = root.clientWidth - 40;
            const width = Math.round(Math.max(MIN_WIDTH, Math.min(max, drag.width + change)));
            selected.style.width = width + 'px'; selected.style.height = 'auto';
            place();
        });
        document.addEventListener('mouseup', () => {
            if (!drag || !selected) { drag = null; return; }
            drag = null;
            const width = Math.round(selected.getBoundingClientRect().width), blot = Quill.find(selected);
            selected.style.width = ''; selected.style.height = '';
            if (blot) { blot.format('width', String(width)); blot.format('height', null); quill.update('user'); }
            place();
        });
    }
    window.MemoImageResize = { attach };
})();
