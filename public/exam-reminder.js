// 수능일 미등록 알림(2026-11-20). /api/trading-session의 examReminder(10/20부터 그해 수능일이 등록되지 않았을 때)를
// 메인 화면 맨 위 바에 띄운다. TradingRefresh.update()는 60초 안에는 저장된 응답을 돌려주므로 조회가 따로 늘지 않는다.
// "오늘 숨기기"는 이 브라우저에서 그날(서버 기준 날짜)만 숨긴다. 독립창에는 넣지 않는다.
(() => {
    const box = document.getElementById('examReminder');
    if (!box) return;
    const key = 'examReminderHiddenDay';
    const read = () => { try { return localStorage.getItem(key); } catch { return null; } };
    let day = null, registeredYear = null;
    async function check() {
        let state = null;
        try { state = await window.TradingRefresh?.update?.(); } catch { state = null; }
        const message = typeof state?.examReminder === 'string' ? state.examReminder : '';
        day = typeof state?.date === 'string' ? state.date : null;
        if (message) {
            box.title = message;
            box.querySelector('.exam-reminder-detail').textContent = `${day.slice(0, 4)}년 수능일이 등록되지 않았습니다 · 거래소 공지 확인 후 설정(⚙)의 올해 수능일 칸에 입력`;
        }
        box.hidden = !message || read() === day || registeredYear === day?.slice(0, 4);
    }
    box.querySelector('button').addEventListener('click', () => {
        try { localStorage.setItem(key, day || ''); } catch {}
        box.hidden = true;
    });
    // 설정 창에서 그해 수능일을 저장하면 다음 확인(최대 1분)을 기다리지 않고 바로 숨긴다.
    document.addEventListener('exam-days-updated', event => {
        if (day && (event.detail || []).some(d => d.date?.slice(0, 4) === day.slice(0, 4))) { registeredYear = day.slice(0, 4); box.hidden = true; }
        else if (registeredYear === day?.slice(0, 4)) { registeredYear = null; void check(); }
    });
    void check();
    setInterval(() => void check(), 60000);
})();
