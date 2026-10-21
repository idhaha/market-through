(() => {
    'use strict';
    function sentimentGuideMarkup() {
        return `<div id="cnnGuide" class="volatility-guide sentiment-guide" role="tooltip">
            <h3>CNN Fear &amp; Greed</h3>
            <p class="sentiment-guide-intro">주가 흐름, 시장 폭, 변동성, 채권 수요 등 여러 시장 지표를 종합한 투자심리 지표입니다.</p>
            <p><strong>점수가 낮을수록 공포가 강하고, 높을수록 탐욕이 강합니다.</strong></p>
            <h4>변화와 지속 기간을 함께 보세요</h4>
            <ol><li><strong>70 → 35로 하락</strong><p>투자심리가 빠르게 악화되고 있다는 뜻입니다. 주가 하락과 VIX 상승이 동반되는지 확인하면 위험 회피가 확대되는 상황인지 판단하는 데 도움이 됩니다.</p></li>
            <li><strong>15 → 30으로 상승</strong><p>공포가 완화되고 있다는 뜻일 수 있습니다. 다만 지수가 여전히 낮다면 시장이 완전히 안정됐다고 보기보다 회복 초기인지 살펴볼 필요가 있습니다.</p></li>
            <li><strong>85에서 장기간 유지</strong><p>과도한 낙관과 위험 선호를 경계할 만합니다. 그러나 탐욕 점수가 높다는 사실만으로 주가가 곧 하락한다고 단정할 수는 없습니다.</p></li></ol>
            <h4>CNN Fear &amp; Greed와 VIX·VKOSPI 결합 분석</h4>
            <table><thead><tr><th>CNN Fear &amp; Greed</th><th>VIX</th><th>가능한 해석</th></tr></thead><tbody>
            <tr><td>낮음</td><td>상승</td><td>공포 심리와 옵션시장의 변동성 우려가 함께 커짐</td></tr>
            <tr><td>낮음</td><td>하락</td><td>투자심리는 약하지만 변동성 우려는 완화되는 상황일 수 있음</td></tr>
            <tr><td>높음</td><td>낮음</td><td>낙관적 심리와 낮은 기대 변동성이 동반됨</td></tr>
            <tr><td>높음</td><td>상승</td><td>낙관적인 종합 심리와 커지는 변동성 우려가 엇갈림</td></tr>
            </tbody></table>
            <h4>참고: CNN은 7개 지표를 종합합니다</h4>
            <p>각 지표는 종합 점수에서 동일한 가중치를 갖습니다.</p>
            <table><thead><tr><th>구성 지표</th><th>무엇을 보는가</th><th>해석 포인트</th></tr></thead><tbody>
            <tr><td>시장 모멘텀</td><td>S&amp;P 500과 125일 이동평균</td><td>장기 추세의 강도</td></tr>
            <tr><td>주가 강도</td><td>NYSE 52주 신고가·신저가</td><td>상승 종목과 약세 종목의 상대적 우위</td></tr>
            <tr><td>주가 폭</td><td>상승·하락 거래량 지표</td><td>상승세가 시장 전반에 퍼져 있는지</td></tr>
            <tr><td>풋·콜 옵션</td><td>5일 평균 풋/콜 비율</td><td>하락 방어 수요와 위험 선호</td></tr>
            <tr><td>시장 변동성</td><td>VIX와 50일 이동평균</td><td>변동성 확대 여부</td></tr>
            <tr><td>안전자산 수요</td><td>주식과 국채의 20일 수익률 차이</td><td>주식에서 안전자산으로 이동하는 경향</td></tr>
            <tr><td>정크본드 수요</td><td>고위험·투자등급 채권의 금리 스프레드</td><td>투자자의 신용 위험 감수 성향</td></tr>
            </tbody></table>
            <p class="sentiment-guide-note">같은 Fear &amp; Greed 점수 30이라도 어떤 구성 지표가 하락을 주도했는지에 따라 시장 상황은 다를 수 있습니다.</p>
        </div>
        <div id="highYieldGuide" class="volatility-guide sentiment-guide" role="tooltip">
            <h3>ICE BofA US HY OAS</h3>
            <p class="sentiment-guide-intro">미국의 투기등급 회사채 시장에서 투자자들이 얼마나 큰 신용 위험을 우려하는지 보여주는 핵심 지표입니다. 경기침체나 금융위기 위험을 판단할 때 VIX와 함께 자주 살펴보는 지표입니다.</p>
            <p>투자자가 미국 국채보다 신용 위험이 높은 회사채에 투자하기 위해 추가로 요구하는 수익률이 얼마나 되는지 측정합니다.</p>
            <p class="sentiment-guide-note">OAS가 3%라면 국채 수익률 곡선 대비 약 <strong>3%포인트(300bp)의 추가 스프레드</strong>를 요구한다는 뜻입니다. 회사채의 실제 전체 수익률이 3%라는 의미는 아닙니다.</p>
            <h4>OAS 상승 — 신용 위험 증가 · 위험 회피 강화</h4>
            <p>투자자들이 고위험 회사채를 보유하기 위해 더 높은 보상을 요구하는 상황입니다. 기업의 부도 우려, 경기 둔화, 자금 조달 여건 악화 등이 원인일 수 있습니다.</p>
            <h4>OAS 하락 — 신용 위험 완화 · 위험 선호 회복</h4>
            <p>투자자들이 고위험 회사채를 상대적으로 편하게 매수하고, 국채 대비 추가 수익률을 덜 요구하는 상황입니다.</p>
            <h4>OAS 수치와 일반적인 해석</h4>
            <table><thead><tr><th>OAS 수치</th><th>일반적인 해석</th></tr></thead><tbody>
            <tr><td>3% 미만</td><td>신용시장이 비교적 안정적일 수 있음</td></tr>
            <tr><td>3~4%</td><td>평상시 수준에서 위험 변화 관찰</td></tr>
            <tr><td>4~6%</td><td>신용 위험 및 금융 여건 악화 가능성 주시</td></tr>
            <tr><td>6~8%</td><td>스트레스가 상당히 커졌을 가능성</td></tr>
            <tr><td>8% 이상</td><td>심각한 신용시장 불안 가능성</td></tr>
            <tr><td>10% 이상</td><td>위기 수준의 스트레스가 나타나는 국면일 수 있음</td></tr>
            </tbody></table>
            <h4>ICE BofA US HY OAS와 VIX·VKOSPI 결합 분석</h4>
            <table><thead><tr><th>지표 조합</th><th>가능한 해석</th></tr></thead><tbody>
            <tr><td>VIX 상승 + OAS 상승</td><td>주식과 신용시장에서 동시에 위험 회피가 확대되는 상황. 금융 스트레스의 강력한 경고 신호일 수 있음.</td></tr>
            <tr><td>VIX 상승 + OAS 안정</td><td>주식시장의 단기 충격이나 이벤트 위험이 두드러질 가능성.</td></tr>
            <tr><td>VIX 안정 + OAS 상승</td><td>주가 변동성은 아직 크지 않더라도 기업 신용 위험이 악화되고 있을 가능성.</td></tr>
            <tr><td>VIX 하락 + OAS 하락</td><td>주식과 회사채 시장 모두 위험 우려가 완화되는 상황일 수 있음.</td></tr>
            </tbody></table>
        </div>`;
    }
    function initialize(breadth = false, sentiment = false) {
        const panelId = sentiment ? 'rankSentimentChartPanel' : breadth ? 'rankBreadthChartPanel' : 'rankVolatilityChartPanel';
        const refreshName = sentiment ? 'refreshRankSentimentChart' : breadth ? 'refreshRankBreadthChart' : 'refreshRankVolatilityChart';
        const displayName = sentiment ? 'RankSentimentDisplaySettings' : breadth ? 'RankBreadthDisplaySettings' : 'RankVolatilityDisplaySettings';
        const concentration = document.getElementById('concentrationChartPanel');
        if (!concentration || document.getElementById(panelId)) return;
        const panel = document.createElement('section');
        panel.id = panelId; panel.className = 'panel rank-adr-panel rank-volatility-panel';
        panel.setAttribute('aria-label', sentiment ? 'CNN Fear & Greed 및 하이일드 스프레드 차트' : breadth ? '신고가-신저가 (KOSPI+KOSDAQ 통합시장) 차트' : 'VKOSPI 및 VIX 일봉 차트');
        if (breadth) panel.classList.add('rank-breadth-panel');
        if (sentiment) panel.classList.add('rank-sentiment-panel');
        panel.innerHTML = `<div class="concentration-chart-header"><h2 tabindex="0" class="volatility-help-trigger" aria-describedby="volatilityGuide">VKOSPI · VIX</h2><div id="volatilityGuide" class="volatility-guide" role="tooltip"><p class="volatility-guide-definition">옵션 가격에 반영된 향후 기대 변동성</p><p class="volatility-guide-level"><strong>30+</strong> 높은 변동성 · 시장 스트레스 가능성</p><h3>분석 지침</h3><ol><li><strong>수치보다 변화 속도를 관찰하세요.</strong> VIX가 15에서 22로 빠르게 상승하면, 25에서 26으로 완만하게 상승할 때보다 위험 회피 심리가 급격히 확대되는 신호일 수 있습니다.</li><li><strong>높은 변동성을 곧바로 반등 신호로 보지 마세요.</strong> 지수 급락 시 변동성 지수가 급등하는 경향이 있지만, 높은 수준은 며칠 또는 몇 주간 지속될 수 있습니다.</li><li><strong>지수와 변동성이 함께 오르면 상승장 내부를 살펴보세요.</strong> 지수 급락 가능성을 염두에 두고 불안이나 헤지 수요가 커지는지 확인하세요. 다만 변동성 지수의 고점이 높다는 이유만으로 주가 바닥이라고 판단해서는 안 됩니다.</li></ol></div></div>
            <div class="rank-adr-controls"><span class="rank-adr-ranges">${['6m', '1y', '3y', 'all'].map(range => `<button type="button" data-volatility-range="${range}" class="${range === '1y' ? 'active' : ''}" aria-pressed="${range === '1y'}">${range === 'all' ? '전체' : range.toUpperCase()}</button>`).join('')}</span><button type="button" class="concentration-candle-toggle" aria-expanded="false" aria-controls="volatilityCandleArea">캔들차트</button><div class="volatility-legend"><span data-volatility="vkospi">● VKOSPI <output>—</output></span><span data-volatility="vix">● VIX <output>—</output></span></div></div>
            <div class="chart-hover-info" hidden></div><div class="rank-adr-area"><canvas role="img" aria-label="VKOSPI 및 VIX 일별 변동성 지수"></canvas></div>
            <div id="volatilityCandleArea" class="rank-adr-candle-area" hidden><span class="volatility-candle-label">KOSPI</span><canvas role="img" aria-label="KOSPI 일봉 캔들차트"></canvas><p class="rank-adr-candle-status" role="status"></p></div>
            <div class="concentration-chart-footer rank-adr-zoom"><input type="range" min="0" max="0" value="0" aria-label="변동성 차트 과거 구간 이동" disabled><div class="concentration-controls"><button type="button" aria-label="변동성 차트 축소">−</button><button type="button" aria-label="변동성 차트 확대">+</button></div></div>
            <p class="rank-adr-status" role="status"></p>`;
        if (breadth) {
            panel.querySelector('h2').textContent = '신고가-신저가 (KOSPI+KOSDAQ)';
            panel.querySelector('h2').removeAttribute('aria-describedby');
            panel.querySelector('h2').removeAttribute('tabindex');
            panel.querySelector('h2').classList.remove('volatility-help-trigger');
            panel.querySelector('.volatility-guide').remove();
            panel.innerHTML = panel.innerHTML.replaceAll('volatilityCandleArea', 'breadthCandleArea').replaceAll('data-volatility="vkospi"', 'data-volatility="highs"').replaceAll('data-volatility="vix"', 'data-volatility="lows"').replaceAll('● VKOSPI', '● 신고가').replaceAll('● VIX', '● 신저가').replaceAll('변동성 차트', '신고가·신저가 차트').replaceAll('VKOSPI 및 VIX 일별 변동성 지수', 'KOSPI+KOSDAQ 통합시장 신고가 및 신저가 종목 수');
            panel.querySelector('.rank-adr-ranges').innerHTML = '<button type="button" data-breadth-mode="day" class="active" aria-pressed="true">일</button><button type="button" data-breadth-mode="minute" aria-pressed="false">1분봉</button><button type="button" data-breadth-more aria-label="신고가·신저가 과거 추가조회" disabled>▥+</button>';
            const more = panel.querySelector('[data-breadth-more]');
            more.classList.add('concentration-icon-button');
            const icon = document.querySelector('#concentrationMore svg');
            if (icon) more.replaceChildren(icon.cloneNode(true));
            panel.querySelector('.concentration-chart-header').insertAdjacentHTML('beforeend', '<span class="breadth-notice"></span>');
            panel.querySelector('.volatility-candle-label').textContent = 'KOSPI';
            panel.querySelector('.rank-adr-candle-area canvas').setAttribute('aria-label', 'KOSPI 캔들차트');
        } else panel.querySelector('h2').textContent = '변동성';
        if (sentiment) {
            const title = panel.querySelector('h2'); title.textContent = 'CNN Fear & Greed · 하이일드 스프레드 (ICE BofA US HY OAS)';
            title.title = 'CNN Fear & Greed / ICE BofA US HY OAS';
            title.removeAttribute('aria-describedby'); title.removeAttribute('tabindex'); title.classList.remove('volatility-help-trigger');
            panel.querySelector('.volatility-guide').remove();
            panel.innerHTML = panel.innerHTML.replaceAll('volatilityCandleArea', 'sentimentCandleArea').replaceAll('data-volatility="vkospi"', 'data-volatility="fear-greed"').replaceAll('data-volatility="vix"', 'data-volatility="high-yield-spread"').replaceAll('● VKOSPI', '● CNN F&G').replaceAll('● VIX', '● HY OAS').replaceAll('변동성 차트', 'CNN·하이일드 차트').replaceAll('VKOSPI 및 VIX 일별 변동성 지수', '왼쪽 축 CNN Fear & Greed, 오른쪽 축 하이일드 스프레드');
            panel.querySelector('h2').innerHTML = '<span class="volatility-help-trigger" tabindex="0" aria-describedby="cnnGuide">CNN Fear &amp; Greed</span> · <span class="volatility-help-trigger" tabindex="0" aria-describedby="highYieldGuide">하이일드 스프레드 (ICE BofA US HY OAS)</span>';
            panel.querySelector('h2').removeAttribute('title');
            panel.querySelector('.concentration-chart-header').insertAdjacentHTML('beforeend', sentimentGuideMarkup());
            panel.querySelectorAll('[data-volatility]').forEach(legend => {
                legend.classList.add('volatility-help-trigger'); legend.tabIndex = 0;
                legend.setAttribute('aria-describedby', legend.dataset.volatility === 'fear-greed' ? 'cnnGuide' : 'highYieldGuide');
            });
        }
        const row = concentration.closest('.rank-chart-row');
        if (row) row.append(panel); else concentration.after(panel);
        // Keep explanations off titles and legends so chart navigation stays unobstructed.
        panel.querySelectorAll('.volatility-help-trigger').forEach(trigger => {
            trigger.classList.remove('volatility-help-trigger');
            trigger.removeAttribute('tabindex'); trigger.removeAttribute('aria-describedby');
        });
        if (sentiment) {
            const guides = [...panel.querySelectorAll('.volatility-guide')];
            const help = document.createElement('div');
            help.id = 'sentimentGuide'; help.className = 'volatility-guide sentiment-guide';
            help.setAttribute('role', 'region'); help.setAttribute('aria-label', 'Chart explanations');
            help.innerHTML = '<div class="chart-guide-tabs" role="tablist"><button type="button" role="tab" id="cnnGuideTab" aria-controls="cnnGuide" aria-selected="true">CNN Fear &amp; Greed</button><button type="button" role="tab" id="highYieldGuideTab" aria-controls="highYieldGuide" aria-selected="false">ICE BofA US HY OAS</button></div>';
            guides.forEach((guide, index) => {
                guide.className = 'chart-guide-content'; guide.setAttribute('role', 'tabpanel');
                guide.setAttribute('aria-labelledby', index ? 'highYieldGuideTab' : 'cnnGuideTab');
                guide.hidden = index !== 0; help.append(guide);
            });
            panel.querySelector('.concentration-chart-header').append(help);
            const tabs = [...help.querySelectorAll('[role="tab"]')];
            const selectTab = tab => {
                tabs.forEach(item => item.setAttribute('aria-selected', String(item === tab)));
                guides.forEach(guide => { guide.hidden = guide.id !== tab.getAttribute('aria-controls'); });
                help.scrollTop = 0;
            };
            tabs.forEach((tab, index) => {
                tab.addEventListener('click', () => selectTab(tab));
                tab.addEventListener('keydown', event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + 1) % 2];
                    selectTab(next); next.focus();
                });
            });
        }
        const guide = panel.querySelector('.volatility-guide');
        if (guide) {
            const info = document.createElement('button');
            info.type = 'button'; info.className = 'chart-info-button volatility-help-trigger';
            info.textContent = 'i'; info.setAttribute('aria-label', 'Chart explanation');
            info.setAttribute('aria-describedby', guide.id);
            panel.querySelector('.concentration-chart-header').append(info);
        }
        let guideTimer;
        const hideGuide = () => { panel.querySelectorAll('.volatility-guide').forEach(help => help.classList.remove('is-visible')); };
        panel.querySelectorAll('.volatility-help-trigger').forEach(trigger => {
            const help = panel.querySelector(`#${trigger.getAttribute('aria-describedby')}`);
            if (!help) return;
            const show = () => {
                clearTimeout(guideTimer);
                hideGuide();
                const position = trigger.getBoundingClientRect(), parent = panel.getBoundingClientRect();
                help.style.top = `${position.bottom - parent.top + 8}px`;
                help.classList.add('is-visible');
            };
            trigger.addEventListener('mouseenter', show); trigger.addEventListener('focus', show);
            trigger.addEventListener('mouseleave', () => { guideTimer = setTimeout(hideGuide, 150); });
            trigger.addEventListener('blur', () => { guideTimer = setTimeout(() => { if (!help.contains(document.activeElement)) hideGuide(); }, 150); });
            trigger.addEventListener('keydown', event => { if (event.key === 'Escape') hideGuide(); });
        });
        panel.querySelectorAll('.volatility-guide').forEach(help => {
            help.addEventListener('mouseenter', () => clearTimeout(guideTimer));
            help.addEventListener('mouseleave', () => { guideTimer = setTimeout(hideGuide, 150); });
            help.addEventListener('focusin', () => clearTimeout(guideTimer));
            help.addEventListener('keydown', event => { if (event.key === 'Escape') hideGuide(); });
            help.addEventListener('focusout', () => { guideTimer = setTimeout(() => { if (!help.contains(document.activeElement)) hideGuide(); }, 150); });
        });
        const canvas = panel.querySelector('.rank-adr-area canvas'), ctx = canvas.getContext('2d');
        const candleArea = panel.querySelector('.rank-adr-candle-area'), candle = candleArea.querySelector('canvas'), cc = candle.getContext('2d');
        const toggle = panel.querySelector('.concentration-candle-toggle'), tip = panel.querySelector('.chart-hover-info');
        const status = panel.querySelector('.rank-adr-status'), candleStatus = panel.querySelector('.rank-adr-candle-status');
        const slider = panel.querySelector('input[type="range"]'), [out, into] = panel.querySelectorAll('.concentration-controls button');
        const ids = sentiment ? ['fear-greed', 'high-yield-spread'] : breadth ? ['highs', 'lows'] : ['vkospi', 'vix'], colors = sentiment ? { 'fear-greed': '#d97706', 'high-yield-spread': '#8b5cf6' } : breadth ? { highs: '#e11d48', lows: '#2563eb' } : { vkospi: '#339af0', vix: '#e11d48' };
        const names = sentiment ? { 'fear-greed': 'CNN F&G', 'high-yield-spread': 'HY OAS' } : breadth ? { highs: '신고가', lows: '신저가' } : { vkospi: 'VKOSPI', vix: 'VIX' };
        const latestDate = document.createElement('span');
        latestDate.className = 'risk-latest-date'; latestDate.textContent = '—';
        if (!sentiment) panel.querySelector('.volatility-legend').prepend(latestDate);
        ids.forEach(id => {
            const legend = panel.querySelector(`[data-volatility="${id}"]`);
            legend.style.color = colors[id];
            const label = document.createElement('span'); label.textContent = legend.firstChild.textContent.trim();
            legend.firstChild.replaceWith(label);
            if (sentiment) {
                const date = document.createElement('span'); date.className = 'risk-series-date'; date.textContent = '—';
                legend.prepend(date);
            }
        });
        function updateLatestDate() {
            const labels = ids.map(id => {
                const point = breadth ? data[id].find(p => p.date === dates.at(-1)) : data[id].at(-1);
                return point?.value == null ? null : point.date.slice(0,10);
            });
            const unique = [...new Set(labels.filter(Boolean))];
            if (sentiment) ids.forEach((id, i) => {
                panel.querySelector(`[data-volatility="${id}"] .risk-series-date`).textContent = labels[i] || '—';
            });
            latestDate.textContent = unique.length <= 1 ? unique[0] || '—'
                : labels.map((date, i) => `${names[ids[i]]} ${date || '—'}`).join(' · ');
        }
        const formatValue = (value, id) => breadth ? `${Math.abs(value).toLocaleString('ko-KR')}개` : `${value.toFixed(2)}${sentiment && id === 'high-yield-spread' ? '%p' : ''}`;
        let range = '1y', data = Object.fromEntries(ids.map(id => [id, []])), dates = [], candles = [], candleKey = '', candleRequest = 0;
        let start = 0, count = null, hover = null, geometry = null, candleGeometry = null, drag = null, controller, candleController;
        let pendingRefresh = false, resizeFrame;
        let breadthMode = 'day', breadthCursor = null, breadthLoading = false, pendingBreadthMode = null;
        const breadthPages = new Map();
        let candlePointerY = null;
        const dateKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
        function surface(target, context) {
            const w = target.clientWidth, h = target.clientHeight, dpr = window.devicePixelRatio || 1;
            target.width = Math.round(w * dpr); target.height = Math.round(h * dpr);
            context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, w, h); context.font = '12px Inter, sans-serif';
            return { w, h };
        }
        function draw() {
            const n = Math.min(dates.length, count ?? dates.length);
            start = Math.max(0, Math.min(start, dates.length - n));
            const visible = dates.slice(start, start + n), indices = new Map(visible.map((date, index) => [date, index]));
            slider.max = String(dates.length - n); slider.value = String(start); slider.disabled = n >= dates.length;
            into.disabled = n <= Math.min(10, dates.length); out.disabled = n >= dates.length;
            const { w, h } = surface(canvas, ctx), left = sentiment ? 54 : 16, right = w - (sentiment ? 64 : 58), top = 10, bottom = h - 34;
            if (right <= left || bottom <= top) return;
            const x = date => n === 1 ? (left + right) / 2 : left + indices.get(date) / Math.max(1, n - 1) * (right - left);
            const rows = Object.fromEntries(ids.map(id => [id, data[id].filter(point => indices.has(point.date) && point.value != null)]));
            const max = sentiment ? 100 : Math.max(10, Math.ceil(Math.max(0, ...Object.values(rows).flat().map(point => Math.abs(point.value))) / 10) * 10);
            const hyMax = sentiment ? Math.max(1, Math.ceil(Math.max(0, ...rows['high-yield-spread'].map(point => point.value)) * 2) / 2) : 1;
            const min = breadth ? -max : 0;
            const y = value => bottom - (value - min) / (max - min) * (bottom - top);
            const hyY = value => bottom - value / hyMax * (bottom - top);
            const muted = getComputedStyle(panel).getPropertyValue('--text-muted').trim() || '#64748b';
            ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.strokeStyle = '#b8c1cc'; ctx.setLineDash([3, 5]);
            for (let i = 0; i <= 4; i++) {
                const value = min + (max - min) * i / 4; ctx.beginPath(); ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke();
                if (sentiment) {
                    ctx.fillStyle = colors['fear-greed']; ctx.textAlign = 'right'; ctx.fillText(String(value), left - 8, y(value) + 4);
                    ctx.fillStyle = colors['high-yield-spread']; ctx.textAlign = 'left'; ctx.fillText((hyMax * i / 4).toFixed(2), right + 8, y(value) + 4);
                } else ctx.fillText(breadth ? Math.round(value).toLocaleString('ko-KR') : value.toFixed(value % 1 ? 1 : 0), w - 4, y(value) + 4);
            }
            ctx.setLineDash([]);
            if (sentiment) {
                for (const [id, axisX] of [['fear-greed', left], ['high-yield-spread', right]]) { ctx.strokeStyle = colors[id]; ctx.beginPath(); ctx.moveTo(axisX, top); ctx.lineTo(axisX, bottom); ctx.stroke(); }
            }
            const hours = breadth && breadthMode === 'minute' && (n <= 120 || visible[0]?.slice(0,10) === visible.at(-1)?.slice(0,10));
            const candidates = hours ? visible.filter((date, i) => !i || date.slice(11,13) !== visible[i-1].slice(11,13)) : visible;
            const ticks = candidates.filter((_, index) => index % Math.max(1, Math.ceil(candidates.length / Math.max(1, (right - left) / 70))) === 0);
            const axis = (context, height) => { context.fillStyle = muted; context.textAlign = 'center'; ticks.forEach(date => { const label = breadth ? hours ? date.slice(11,13) : date.slice(5,10).replace('-', '/') : date.slice(2), half = context.measureText(label).width / 2; context.fillText(label, Math.max(left + half, Math.min(right - half, x(date))), height - 8); }); };
            const separators = [];
            visible.forEach((date, i) => {
                const length = breadthMode === 'minute' ? 10 : 7;
                if (i && date.slice(0,length) !== visible[i-1].slice(0,length) && (!separators.length || x(date) - x(separators.at(-1)) >= 32)) separators.push(date);
            });
            const boundaries = (context, upper, lower) => {
                context.save(); context.strokeStyle = '#b8c1cc'; context.setLineDash([3,5]);
                separators.forEach(date => { context.beginPath(); context.moveTo(x(date), upper); context.lineTo(x(date), lower); context.stroke(); }); context.restore();
            };
            boundaries(ctx, top, bottom);
            axis(ctx, h);
            for (const id of ids) {
                const seriesY = sentiment && id === 'high-yield-spread' ? hyY : y;
                ctx.strokeStyle = colors[id]; ctx.lineWidth = 2; ctx.beginPath();
                if (breadth) {
                    const width = Math.max(1, Math.min(12, (right - left) / Math.max(1, n) * .7));
                    ctx.fillStyle = colors[id];
                    rows[id].forEach(point => ctx.fillRect(x(point.date) - width / 2, Math.min(y(0), y(point.value)), width, Math.abs(y(point.value) - y(0))));
                } else {
                    rows[id].forEach((point, index) => { if (!index) ctx.moveTo(x(point.date), seriesY(point.value)); else ctx.lineTo(x(point.date), seriesY(point.value)); }); ctx.stroke();
                }
                const latest = data[id].at(-1)?.date;
                if (!breadth) rows[id].filter(point => point.date === latest || point.date === hover || rows[id].length === 1).forEach(point => { ctx.fillStyle = point.date === latest ? '#f97316' : colors[id]; ctx.beginPath(); ctx.arc(x(point.date), seriesY(point.value), 4, 0, Math.PI * 2); ctx.fill(); });
                const selected = rows[id].find(point => point.date === hover);
                if (selected) {
                    if (!breadth) drawHoverValue(ctx, { left, right, top, bottom, y: seriesY }, selected.value, formatValue(selected.value, id), colors[id], sentiment && id === 'fear-greed');
                    else { ctx.fillStyle = colors[id]; ctx.textAlign = 'right'; ctx.fillText(formatValue(selected.value, id), w - 4, seriesY(selected.value) + 14); }
                }
            }
            ctx.lineWidth = 1; geometry = { visible, left, right, top, bottom, x };
            if (hover && indices.has(hover)) { ctx.strokeStyle = '#000'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x(hover), top); ctx.lineTo(x(hover), bottom); ctx.stroke(); ctx.setLineDash([]); }
            if (drag) { ctx.fillStyle = 'rgba(51,154,240,.15)'; ctx.fillRect(Math.min(drag.from, drag.to), top, Math.abs(drag.to - drag.from), bottom - top); }
            if (!candleArea.hidden) drawCandles({ visible, indices, x, left, right, axis, boundaries });
        }
        function drawHoverValue(context, graph, value, label, color, leftAxis = false) {
            const py = graph.y(value), badgeY = Math.max(graph.top + 10, Math.min(graph.bottom - 10, py));
            context.save(); context.lineWidth = 1; context.strokeStyle = color; context.setLineDash([3, 3]);
            context.beginPath(); context.moveTo(graph.left, py); context.lineTo(graph.right, py); context.stroke(); context.setLineDash([]);
            context.font = 'bold 11px Arial'; context.fillStyle = color;
            const width = context.measureText(label).width + 12;
            const badgeX = leftAxis ? Math.max(0, graph.left - width) : Math.max(0, context.canvas.clientWidth - width - 4);
            context.fillRect(badgeX, badgeY - 10, width, 20);
            context.fillStyle = '#fff'; context.textAlign = 'left'; context.textBaseline = 'middle'; context.fillText(label, badgeX + 6, badgeY); context.restore();
        }
        function drawCandles({ visible, indices, x, left, right, axis, boundaries }) {
            const { w, h } = surface(candle, cc), top = 24, bottom = h - 30;
            const rows = candles.filter(point => indices.has(point.date));
            candleGeometry = null;
            if (!rows.length || right <= left || bottom <= top) return;
            let min = Math.min(...rows.map(point => point.low)), max = Math.max(...rows.map(point => point.high));
            const pad = Math.max(1, (max - min) * .08); min -= pad; max += pad;
            const y = value => bottom - (value - min) / (max - min) * (bottom - top);
            cc.textAlign = 'right'; cc.fillStyle = '#64748b'; cc.strokeStyle = '#b8c1cc';
            for (let i = 0; i <= 4; i++) { const value = min + (max - min) * i / 4; cc.setLineDash([3, 5]); cc.beginPath(); cc.moveTo(left, y(value)); cc.lineTo(right, y(value)); cc.stroke(); cc.fillText(Math.round(value).toLocaleString('ko-KR'), w - 4, y(value) + 4); } cc.setLineDash([]);
            boundaries(cc, top, bottom);
            const width = Math.max(1, Math.min(12, (right - left) / Math.max(1, visible.length) * .65));
            rows.forEach(point => { cc.strokeStyle = cc.fillStyle = point.close >= point.open ? '#e11d48' : '#2563eb'; cc.beginPath(); cc.moveTo(x(point.date), y(point.high)); cc.lineTo(x(point.date), y(point.low)); cc.stroke(); cc.fillRect(x(point.date) - width / 2, Math.min(y(point.open), y(point.close)), width, Math.max(1, Math.abs(y(point.open) - y(point.close)))); });
            axis(cc, h); candleGeometry = { top, bottom };
            if (hover && indices.has(hover)) { cc.strokeStyle = '#000'; cc.setLineDash([3, 3]); cc.beginPath(); cc.moveTo(x(hover), top); cc.lineTo(x(hover), bottom); cc.stroke(); cc.setLineDash([]); }
            const hovered = rows.find(point => point.date === hover);
            const price = hovered?.close;
            if (hover && Number.isFinite(price)) drawHoverValue(cc, { left, right, top, bottom, y }, price, price.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), '#000');
            if (drag) { cc.fillStyle = 'rgba(51,154,240,.15)'; cc.fillRect(Math.min(drag.from, drag.to), top, Math.abs(drag.to - drag.from), bottom - top); }
        }
        async function loadCandles() {
            if (candleArea.hidden || !dates.length) return;
            const key = `${breadth ? breadthMode : 'day'}:${dates[0]}:${dates.at(-1)}`;
            if (key === candleKey && candles.length) { draw(); return; }
            candleController?.abort(); candleController = new AbortController(); const request = ++candleRequest;
            candleStatus.textContent = 'KOSPI 일봉 조회 중…';
            try {
                const minute = breadth && breadthMode === 'minute';
                const from = new Date(Date.parse(`${dates[0].slice(0,10)}T00:00:00Z`) - (minute ? 0 : 35 * 86400000)).toISOString().slice(0, 10).replaceAll('-', '');
                const response = await fetch(`/api/adr/candles?market=kospi&mode=${minute ? 'minute' : 'day'}&from=${from}&to=${dates.at(-1).slice(0,10).replaceAll('-', '')}`, { signal: candleController.signal });
                const result = await response.json(); if (!response.ok) throw new Error(result.error || 'KOSPI 캔들 조회 실패');
                if (request !== candleRequest) return;
                candles = (Array.isArray(result.points) ? result.points : []).filter(point => ['t', 'open', 'high', 'low', 'close'].every(key => point[key] != null && Number.isFinite(Number(point[key])))).map(point => ({ ...point, date: minute ? new Date(Number(point.t) + 9 * 3600000).toISOString().slice(0,16).replace('T', ' ') : dateKey(Number(point.t)) })).sort((a, b) => a.t - b.t);
                candles.forEach((point, index) => {
                    const previous = index > 0 ? Number(candles[index - 1].close) : null;
                    point.changeRate = previous > 0 ? (Number(point.close) / previous - 1) * 100 : null;
                });
                candleKey = key; candleStatus.textContent = candles.length ? result.partial ? 'KOSPI · 일부 구간만 조회되었습니다.' : '' : 'KOSPI 캔들 데이터 없음'; draw();
            } catch (error) { if (error.name !== 'AbortError' && request === candleRequest) candleStatus.textContent = error.message; }
        }
        async function refreshBreadth(more = false) {
            if (breadthLoading) return;
            breadthLoading = true;
            canvas.classList.add('is-loading'); candle.classList.add('is-loading');
            canvas.parentElement.setAttribute('aria-busy', 'true');
            const button = panel.querySelector('[data-breadth-more]'); button.disabled = true;
            status.textContent = '신고가·신저가 조회 중…';
            try {
                const cursors = more ? [breadthCursor] : [...new Set(['', ...breadthPages.keys()])];
                for (const cursor of cursors) {
                    const response = await fetch(`/api/risk/breadth?mode=${breadthMode}&cursor=${encodeURIComponent(cursor || '')}`);
                    const result = await response.json(); if (!response.ok) throw new Error(result.error || '신고저가 조회 실패');
                    breadthPages.set(cursor || '', result);
                }
                const pages = [...breadthPages.values()];
                dates = [...new Set(pages.flatMap(p => p.dates || []))].sort();
                for (const id of ids) data[id] = [...new Map(pages.flatMap(p => p.series?.[id]?.points || []).map(p => [p.date, p])).values()].sort((a,b) => a.date.localeCompare(b.date));
                const last = pages.at(-1); breadthCursor = last?.has_more ? last.cursor : null;
                ids.forEach(id => { const latest = data[id].find(p => p.date === dates.at(-1)); panel.querySelector(`[data-volatility="${id}"] output`).textContent = latest?.value == null ? '—' : formatValue(latest.value,id); });
                updateLatestDate();
                panel.querySelector('.breadth-notice').textContent = (pages[0]?.notice || '').replace(' · ', '\n');
                panel.querySelector('.breadth-notice').title = pages[0]?.notice || '';
                status.textContent = [dates.length ? `${dates[0]} ~ ${dates.at(-1)}` : '기준 봉 없음', pages[0]?.warning, '키움 · 250일 고저 기준 · 누락 —'].filter(Boolean).join(' · ');
                window.setRankCardConnection?.(panel, !pages[0]?.warning);
                if (more) { start = 0; count = null; }
                candleKey = ''; draw(); void loadCandles();
            } catch (error) { status.textContent = error.message; window.setRankCardConnection?.(panel, false); }
            finally {
                breadthLoading = false; button.disabled = !breadthCursor;
                canvas.classList.remove('is-loading'); candle.classList.remove('is-loading');
                canvas.parentElement.setAttribute('aria-busy', 'false');
                if (pendingBreadthMode) {
                    const mode = pendingBreadthMode; pendingBreadthMode = null;
                    panel.querySelector(`[data-breadth-mode="${mode}"]`).click();
                }
            }
        }
        panel.querySelector('[data-breadth-more]')?.addEventListener('click', () => refreshBreadth(true));
        panel.querySelectorAll('[data-breadth-mode]').forEach(button => button.addEventListener('click', () => {
            if (breadthLoading) { pendingBreadthMode = button.dataset.breadthMode; return; }
            if (breadthMode === button.dataset.breadthMode) return;
            breadthMode = button.dataset.breadthMode; breadthCursor = null; breadthPages.clear();
            candleController?.abort(); candleRequest++; candleKey = '';
            start = 0; count = null; hover = null; tip.hidden = true; data = Object.fromEntries(ids.map(id => [id, []])); dates = []; candles = [];
            panel.querySelectorAll('[data-breadth-mode]').forEach(item => { const active = item === button; item.classList.toggle('active',active); item.setAttribute('aria-pressed',String(active)); });
            void refreshBreadth(); save();
        }));
        window[refreshName] = async () => {
            if (drag) { pendingRefresh = true; return; } pendingRefresh = false;
            if (breadth) return refreshBreadth();
            controller?.abort(); const current = controller = new AbortController(); status.textContent = sentiment ? 'CNN·하이일드 조회 중…' : breadth ? '신고가·신저가 조회 중…' : 'VIX·VKOSPI 조회 중…';
            try {
                const response = await fetch(`/api/risk/${sentiment ? 'sentiment' : breadth ? 'breadth' : 'volatility'}?range=${range}`, { signal: current.signal });
                const result = await response.json(); if (!response.ok) throw new Error(result.error || '변동성 지수 조회 실패');
                if (current !== controller) return;
                data = Object.fromEntries(ids.map(id => [id, result.series?.[id]?.points || []]));
                dates = [...new Set(ids.flatMap(id => data[id].map(point => point.date)))].sort();
                ids.forEach(id => { const legend = panel.querySelector(`[data-volatility="${id}"]`); legend.style.color = colors[id]; legend.querySelector('output').textContent = data[id].length ? formatValue(data[id].at(-1).value, id) : '—'; });
                updateLatestDate();
                const errors = ids.flatMap(id => [result.series?.[id]?.error, result.series?.[id]?.warning]).filter(Boolean);
                window.setRankCardConnection?.(panel, errors.length === 0);
                status.textContent = [dates.length ? `${dates[0]} ~ ${dates.at(-1)}` : '일봉 데이터 없음', ...errors, '출처: Jusikbot'].join(' · ');
                draw(); loadCandles();
            } catch (error) { if (error.name !== 'AbortError' && current === controller) { window.setRankCardConnection?.(panel, false); status.textContent = error.message; } }
        };
        panel.querySelectorAll('[data-volatility-range]').forEach(button => button.addEventListener('click', () => {
            range = button.dataset.volatilityRange; start = 0; count = null; hover = null; tip.hidden = true;
            candleController?.abort(); candleRequest++; candles = []; candleKey = '';
            panel.querySelectorAll('[data-volatility-range]').forEach(item => { const selected = item === button; item.classList.toggle('active', selected); item.setAttribute('aria-pressed', String(selected)); });
            window[refreshName](); save();
        }));
        const save = () => { if (!window.rankCandleSyncing && typeof saveAppData === 'function') saveAppData(); };
        window[`get${displayName}`] = () => ({ range, ...(breadth ? { mode: breadthMode } : {}), candleOpen: !candleArea.hidden });
        window[`apply${displayName}`] = settings => {
            if (breadth) {
                const mode = settings?.mode === 'minute' ? 'minute' : 'day';
                if (mode !== breadthMode) panel.querySelector(`[data-breadth-mode="${mode}"]`).click();
                candleArea.hidden = !settings?.candleOpen; toggle.setAttribute('aria-expanded', String(!candleArea.hidden)); resize(); return;
            }
            const next = ['6m', '1y', '3y', 'all'].includes(settings?.range) ? settings.range : '1y', changed = next !== range;
            if (changed) { candleController?.abort(); candleRequest++; candles = []; candleKey = ''; hover = null; tip.hidden = true; }
            range = next; candleArea.hidden = !settings?.candleOpen; toggle.setAttribute('aria-expanded', String(!candleArea.hidden));
            panel.querySelectorAll('[data-volatility-range]').forEach(button => { const selected = button.dataset.volatilityRange === range; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
            resize(); if (changed) { start = 0; count = null; window[refreshName](); } else loadCandles();
        };
        toggle.addEventListener('click', () => { candleArea.hidden = !candleArea.hidden; toggle.setAttribute('aria-expanded', String(!candleArea.hidden)); if (candleArea.hidden) { candleController?.abort(); candleRequest++; } else loadCandles(); resize(); save(); });
        slider.addEventListener('input', () => { start = Number(slider.value); hover = null; tip.hidden = true; draw(); });
        const zoom = (factor, anchor = .5) => { const current = Math.min(dates.length, count ?? dates.length); count = Math.max(Math.min(10, dates.length), Math.min(dates.length, Math.round(current * factor))); start = Math.max(0, Math.min(dates.length - count, Math.round(start + anchor * (current - count)))); hover = null; tip.hidden = true; draw(); };
        into.addEventListener('click', () => zoom(.7)); out.addEventListener('click', () => zoom(1.5));
        [canvas, candle].forEach(target => {
            const offset = event => Math.max(geometry.left, Math.min(geometry.right, event.clientX - target.getBoundingClientRect().left));
            target.addEventListener('pointerdown', event => {
                if (event.button !== 0 || !geometry?.visible.length) return;
                const px = event.clientX - target.getBoundingClientRect().left, py = event.clientY - target.getBoundingClientRect().top;
                const area = target === canvas ? geometry : candleGeometry;
                if (!area || px < geometry.left || px > geometry.right || py < area.top || py > area.bottom) return;
                drag = { target, id: event.pointerId, from: offset(event), to: offset(event), start, count: geometry.visible.length };
                hover = null; tip.hidden = true; target.setPointerCapture(event.pointerId); draw();
            });
            target.addEventListener('pointermove', event => {
                if (drag?.target === target) { drag.to = offset(event); draw(); return; }
                if (drag || !geometry?.visible.length) return;
                candlePointerY = target === candle ? event.clientY - candle.getBoundingClientRect().top : null;
                const px = event.clientX - target.getBoundingClientRect().left;
                if (px < geometry.left || px > geometry.right) { hover = null; tip.hidden = true; draw(); return; }
                hover = geometry.visible.reduce((a, b) => Math.abs(geometry.x(a) - px) < Math.abs(geometry.x(b) - px) ? a : b);
                tip.replaceChildren(document.createTextNode(hover));
                ids.forEach(id => {
                    const label = document.createElement('span'); label.textContent = names[id]; label.style.color = colors[id];
                    const selected = data[id].find(point => point.date === hover);
                    tip.append(' · ', label, ` ${selected?.value != null ? formatValue(selected.value, id) : '—'}`);
                });
                const point = !candleArea.hidden && candles.find(point => point.date === hover);
                if (point) tip.append(` · 등락율 ${point.changeRate == null ? '—' : `${point.changeRate > 0 ? '+' : ''}${point.changeRate.toFixed(2)}%`}`);
                tip.hidden = false; draw();
            });
            const finish = event => {
                if (drag?.target !== target || drag.id !== event.pointerId) return;
                const previous = drag; drag = null;
                if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
                if (event.type === 'pointerup' && Math.abs(previous.to - previous.from) > 10) {
                    if (previous.to > previous.from) { const first = Math.floor((previous.from - geometry.left) / (geometry.right - geometry.left) * (previous.count - 1)), last = Math.ceil((previous.to - geometry.left) / (geometry.right - geometry.left) * (previous.count - 1)); count = Math.min(dates.length, Math.max(Math.min(10, dates.length), last - first + 1)); start = previous.start + first; }
                    else { start = 0; count = null; }
                }
                draw(); if (pendingRefresh) window[refreshName]();
            };
            target.addEventListener('pointerup', finish); target.addEventListener('pointercancel', finish); target.addEventListener('lostpointercapture', finish);
            target.addEventListener('mouseleave', () => { if (!drag) { hover = null; candlePointerY = null; tip.hidden = true; draw(); } });
            target.addEventListener('wheel', event => { if (!dates.length || !geometry || drag || !event.deltaY) return; const px = event.clientX - target.getBoundingClientRect().left; if (px < geometry.left || px > geometry.right) return; event.preventDefault(); zoom(event.deltaY < 0 ? .8 : 1.25, (px - geometry.left) / (geometry.right - geometry.left)); }, { passive: false });
        });
        function resize() {
            const base = concentration.getBoundingClientRect().height - (document.getElementById('concentrationCandleArea')?.hidden === false ? document.getElementById('concentrationCandleArea').getBoundingClientRect().height : 0);
            if (base > 0) panel.style.height = `${base + (candleArea.hidden ? 0 : 280)}px`;
            draw();
        }
        const schedule = () => { if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = null; resize(); }); };
        new ResizeObserver(schedule).observe(concentration); new ResizeObserver(schedule).observe(canvas.parentElement);
        resize(); window[refreshName]();
    }
    const mount = () => { initialize(); initialize(true); initialize(false, true); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
