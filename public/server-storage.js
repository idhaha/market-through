(() => {
    let pending;
    window.refreshServerStorage = () => {
        if (pending) return pending;
        const output = document.getElementById('serverStorage');
        if (!output) return;
        pending = (async () => {
            try {
                const response = await fetch('/api/server/storage', { cache: 'no-store' });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error();
                const gb = value => (value / 1024 ** 3).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
                output.textContent = `서버 여유 ${gb(data.available_bytes)} / ${gb(data.total_bytes)} GB`;
                output.title = `데이터 저장 디스크 · 사용률 ${data.used_percent}% · ${new Date(data.checked_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 확인\nGB 표시는 1,024³바이트 기준`;
            } catch {
                output.textContent = '서버 용량 확인 불가';
                output.title = '다음 갱신 때 다시 확인합니다.';
            }
        })().finally(() => { pending = null; });
        return pending;
    };
    const initialize = () => {
        window.refreshServerStorage();
        setInterval(window.refreshServerStorage, 5 * 60 * 1000);
        window.addEventListener('online', window.refreshServerStorage);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
    else initialize();
})();
