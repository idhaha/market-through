(() => {
    function arrangeTabs() {
        document.querySelectorAll('#tabContents > .tab-content > .container').forEach(container => {
            const header = container.querySelector(':scope > header');
            if (!header || container.querySelector(':scope > .tab-scroll-body')) return;
            const body = document.createElement('div');
            body.className = 'tab-scroll-body';
            let next = header.nextSibling;
            // Status messages immediately below a title belong to the fixed heading.
            while (next && (next.nodeType === Node.TEXT_NODE || next.classList?.contains('us-info-row') || next.classList?.contains('status-info'))) {
                const following = next.nextSibling;
                header.append(next); next = following;
            }
            while (next) { const following = next.nextSibling; body.append(next); next = following; }
            container.append(body); container.classList.add('tab-fixed-heading-layout');
        });
    }
    const root = document.getElementById('tabContents');
    if (!root) return;
    arrangeTabs();
    new MutationObserver(arrangeTabs).observe(root, { childList: true, subtree: true });
})();
