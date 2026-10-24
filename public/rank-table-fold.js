(() => {
    // This state belongs only to the main page, never to the independent relay/settings.
    function initialize() {
        const root = document.getElementById('tab_rank');
        if (!root || document.body.classList.contains('rank-independent')) return;
        const tables = ['transactionTable', 'stockTable', 'efriendStockTable', 'watchlistTable']
            .map(id => document.getElementById(id)).filter(Boolean);
        let limit = 0;
        const buttons = [];
        function update() {
            root.dataset.tableRowLimit = String(limit);
            const current = limit ? `${limit}개` : '기본';
            const next = limit === 0 ? '10개' : limit === 10 ? '5개' : '기본';
            for (const button of buttons) {
                button.title = `전체 테이블 ${current} 표시 · 클릭하면 ${next}`;
                button.setAttribute('aria-label', button.title);
            }
            for (const table of tables) table.tBodies[0].scrollTop = 0;
        }
        for (const table of tables) {
            const heading = table.closest('.panel').querySelector('.panel-header h2');
            const group = document.createElement('div');
            group.className = 'main-rank-table-title';
            heading.before(group); group.append(heading);
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'main-rank-row-limit';
            button.setAttribute('aria-controls', tables.map(item => item.tBodies[0].id).join(' '));
            button.innerHTML = '<svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><path d="M9 2v16M4 7l5-5 5 5M4 13l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            button.addEventListener('click', () => { limit = limit === 0 ? 10 : limit === 10 ? 5 : 0; update(); });
            group.append(button); buttons.push(button);
        }
        update();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
