(() => {
    'use strict';
    // 트레이딩 탭 "대주StopLoss" 버튼(2026-11-19): 수급 버튼 왼쪽.
    // 2026-11-20부터 수급 · VI 창처럼 데스크톱 독립창 앱(marketthrough://)으로 연다. 창 위치 · 크기는 앱이 기억하고,
    // 메인 화면의 확대 · 축소 배율을 대주창이 따라간다. Windows PC에서만 버튼을 보인다(VI 창과 같음).
    function place(controls, button) {
        const rank = controls.querySelector('[data-independent="rank"]');
        if (rank) { if (button.nextElementSibling !== rank) rank.before(button); return true; }
        return false;
    }
    document.addEventListener('DOMContentLoaded', () => {
        const controls = document.getElementById('rankIndependentControls');
        const platform = navigator.userAgentData?.platform || navigator.platform || '';
        if (!controls || !/Win/i.test(platform)) return;
        const button = document.createElement('button'), status = document.createElement('span');
        button.type = 'button'; button.className = 'btn-secondary'; button.textContent = '대주StopLoss';
        button.title = '키움 대주 StopLoss 독립창'; button.dataset.independent = 'short-stoploss';
        status.setAttribute('role', 'status'); status.dataset.independent = 'short-stoploss-status';
        const put = () => { button.after(status); };
        if (place(controls, button)) put();
        else {
            controls.prepend(button); put();
            const watch = new MutationObserver(() => { if (place(controls, button)) { put(); watch.disconnect(); } });
            watch.observe(controls, { childList: true });
        }
        const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        // 메인 화면 확대 · 축소가 바뀌면 열린 대주창에 알린다
        let token = sessionStorage.getItem('short-stoploss-window-token') || '', lastScale = devicePixelRatio;
        window.addEventListener('resize', () => {
            if (Math.abs(devicePixelRatio - lastScale) < 0.001 || !token) return; lastScale = devicePixelRatio;
            post('/api/short-stoploss/window-scale', { token, scale: devicePixelRatio }).then(r => { if (r.status === 404) { token = ''; sessionStorage.removeItem('short-stoploss-window-token'); } }).catch(() => {});
        });
        button.addEventListener('click', async () => {
            button.disabled = true; status.textContent = '대주창 실행 중';
            try {
                const response = await post('/api/short-stoploss/window', { scale: devicePixelRatio });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw Error(data.error || '로그인과 서버 연결을 확인하세요.');
                token = data.token; sessionStorage.setItem('short-stoploss-window-token', token); lastScale = devicePixelRatio;
                location.href = 'marketthrough://open?url=' + encodeURIComponent(location.origin + '/short-stoploss.html#token=' + token);
                // 20초 안에 창이 연결되지 않으면 설치 안내를 보이되, 여는 토큰이 살아 있는 5분 동안은 계속 확인해
                // 늦게 "앱 열기"를 허용해 창이 연결되면 안내를 지운다. 버튼을 다시 누르면 이전 확인은 멈춘다
                const mine = token, started = Date.now();
                const check = async () => {
                    if (token !== mine) return;
                    try { const r = await post('/api/short-stoploss/window-status', { token: mine }); if ((await r.json()).connected) { if (token === mine) { status.textContent = ''; button.disabled = false; } return; } } catch {}
                    const waited = Date.now() - started;
                    if (waited >= 20000 && button.disabled) {
                        status.textContent = '창이 열리지 않으면 최신 독립창 앱을 설치하세요. ';
                        const link = document.createElement('a'); link.href = '/downloads/MarketThroughSetup.exe'; link.download = 'MarketThroughSetup.exe'; link.textContent = '설치 파일 다운로드'; status.append(link); button.disabled = false;
                    }
                    if (waited < 5 * 60000) setTimeout(check, waited < 20000 ? 1000 : 3000);
                };
                setTimeout(check, 1000);
            } catch (error) { status.textContent = error.message; button.disabled = false; }
        });
    });
})();
