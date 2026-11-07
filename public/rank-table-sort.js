(() => {
    'use strict';
    // Trading tab tables (거래대금 상위 · 실시간 조회 순위 · 대주가능 종목): every column but 순위 sorts.
    // Same icons and cycle as the VI window: descending → ascending → original (server) order.
    // The app rewrites a tbody on every refresh, so the chosen sort is applied again to the new rows.
    const ARROWS = '<svg viewBox="0 0 10 14"><path class="v" d="M5 2V12"/><path class="u" d="M3.2 3.6L5 1.6L6.8 3.6"/><path class="d" d="M3.2 10.4L5 12.4L6.8 10.4"/></svg>';
    const DOT = '<svg viewBox="0 0 10 14"><circle cx="5" cy="7" r="1.2"/></svg>';
    const tableIds = ['transactionTable', 'stockTable', 'efriendStockTable'];
    // Numbers such as "+2.35%", "-1.20%", "1,234" and "38%" sort as numbers; '-' and empty cells go last.
    function cellValue(row, index) {
        const text = (row.cells[index]?.textContent || '').trim();
        if (!text || text === '-' || text === '—') return null;
        const compact = text.replace(/[\s,%원개]/g, '');
        return /^[-+]?\d+(\.\d+)?$/.test(compact) ? Number(compact) : text;
    }
    function setup(table) {
        const head = table.tHead?.rows[0], body = table.tBodies[0];
        if (!head || !body || head.dataset.sortReady) return;
        head.dataset.sortReady = '1';
        let sort = null, applying = false;
        const buttons = [];
        [...head.cells].forEach((th, index) => {
            if (index === 0) return;
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'rank-sort-button';
            button.append(...th.childNodes);
            const icon = document.createElement('em'); icon.className = 'sort-icon'; icon.setAttribute('aria-hidden', 'true');
            button.append(icon); th.append(button); th.setAttribute('aria-sort', 'none');
            button.addEventListener('click', () => {
                sort = !sort || sort.index !== index ? { index, direction: -1 } : sort.direction === -1 ? { index, direction: 1 } : null;
                apply(); paint();
            });
            buttons.push({ button, icon, th, index });
        });
        function paint() {
            for (const { icon, th, index } of buttons) {
                const on = sort?.index === index;
                // Like the VI window: arrows everywhere until a column is chosen, then dots on the others.
                icon.innerHTML = on || !sort ? ARROWS : DOT;
                th.setAttribute('aria-sort', on ? (sort.direction < 0 ? 'descending' : 'ascending') : 'none');
            }
        }
        function apply() {
            const rows = [...body.rows];
            // Message rows ("데이터가 없습니다", 조회 실패) span the table and are left alone.
            if (!rows.length || rows.some(row => [...row.cells].some(cell => cell.colSpan > 1))) return;
            // New rows remember their server position, which is the original order.
            rows.forEach((row, position) => { if (row.dataset.sortOrder === undefined) row.dataset.sortOrder = String(position); });
            const order = row => Number(row.dataset.sortOrder);
            const sorted = rows.slice().sort((a, b) => {
                if (!sort) return order(a) - order(b);
                const x = cellValue(a, sort.index), y = cellValue(b, sort.index);
                if (x == null && y != null) return 1;
                if (y == null && x != null) return -1;
                const compared = x == null ? 0 : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
                return compared * sort.direction || order(a) - order(b);
            });
            if (sorted.every((row, position) => row === rows[position])) return;
            applying = true; body.append(...sorted);
        }
        new MutationObserver(() => { if (applying) { applying = false; return; } apply(); }).observe(body, { childList: true });
        paint(); apply();
    }
    function initialize() { for (const id of tableIds) { const table = document.getElementById(id); if (table) setup(table); } }
    window.RankTableSort = { initialize };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})();
