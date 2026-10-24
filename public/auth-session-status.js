(() => {
    let deadline = null;
    function render() {
        const output = document.getElementById('reauthCountdown');
        if (!deadline || !output) return;
        const remaining = deadline - Date.now();
        if (remaining <= 0) { location.reload(); return; }
        const days = Math.ceil(remaining / 86400000);
        output.hidden = false;
        output.textContent = `재인증 D-${String(days).padStart(2, '0')}일`;
        output.title = `재인증 기한: ${new Date(deadline).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`;
        if (days > 7 || document.visibilityState === 'hidden') return;
        const date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
        const key = `auth-reauth-notice:${deadline}`;
        try {
            if (localStorage.getItem(key) === date) return;
            localStorage.setItem(key, date);
        } catch { return; }
        alert(`로그인 재인증까지 ${days}일 남았습니다. 기한이 되면 Google 계정으로 다시 로그인해 주세요.`);
    }
    window.updateAuthSessionStatus = user => {
        if (!Number.isFinite(user?.reauthenticateAt)) return;
        deadline = user.reauthenticateAt;
        render();
    };
    async function check() {
        try {
            const response = await fetch('/api/auth/session', { cache: 'no-store' });
            if (response.status === 401) {
                if (deadline) location.reload();
                return;
            }
            if (!response.ok) return;
            const data = await response.json();
            if (data.authenticated) window.updateAuthSessionStatus(data.user);
        } catch { /* Retry after a temporary network failure. */ }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); void check(); } });
    setInterval(() => { render(); void check(); }, 60000);
})();
