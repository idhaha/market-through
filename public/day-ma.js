(() => {
    'use strict';
    // 분봉 캔들 위 일봉 기준 이동평균선(2026-11-24, docs/MINUTE_DAILY_MA.md).
    // N일선(D) = (D 이전 N-1거래일 종가 합 + D 시가) / N. 키움 수식관리자 (nPreDayClose(4)+…+nPreDayClose(1)+DayOpen())/5와 같다.
    // 지난날 시가 · 종가는 서버 /api/day-ma(일봉 저장본, 어제까지)에서 받고, 오늘 시가는 오늘 08:00 이후 첫 분봉의 시가로 잡는다
    // (통합 일봉 시가 = NXT 종목은 08:00 첫 체결, KRX 종목 · 지수는 정규장 시가, 수능일은 10:00 시가. 저장 분봉으로 확인).
    // 시가가 생기기 전에는 그날 선을 그리지 않는다. 계산값은 저장하지 않고 그릴 때마다 계산한다(4개 선 60일치 약 0.03ms).
    // 하루 동안 값이 같아 수평선이고 날짜가 바뀌는 봉에서 계단처럼 꺾인다. 세로축은 캔들로만 정하고 범위 밖은 잘린다. 범례는 없다.
    const LINES = [[5, '#ff00ff'], [10, '#000080'], [20, '#ff6600'], [60, '#00a000']];
    const KST = 9 * 3600000, DAY_MS = 86400000, DAY_START = 8 * 60, NIGHT_START = 18 * 60, RETRY_MS = 60000;
    const states = new Map();
    const dayOfPoint = new WeakMap(); // 봉 → 거래일 번호(그 봉 객체가 버려지면 함께 사라진다)
    const dayNames = new Map();
    const dayName = n => { let s = dayNames.get(n); if (s === undefined) { s = new Date(n * DAY_MS).toISOString().slice(0, 10).replaceAll('-', ''); if (dayNames.size > 5000) dayNames.clear(); dayNames.set(n, s); } return s; };
    const dayNumber = t => Math.floor((t + KST) / DAY_MS);
    const minuteOfDay = t => Math.floor(((t + KST) % DAY_MS) / 60000);

    function stateOf(target) {
        let state = states.get(target);
        if (!state) { state = { days: [], opens: new Map(), prefix: [0], requestedFrom: null, through: null, pending: null, failed: null, waiters: new Set(), version: 0, memos: new Map() }; states.set(target, state); }
        return state;
    }
    function accept(state, rows, requestedFrom, through) {
        const merged = new Map(state.days.map((day, i) => [day, [state.opens.get(day), state.prefix[i + 1] - state.prefix[i]]]));
        for (const [day, open, close] of rows) if (/^\d{8}$/.test(day) && open > 0 && close > 0) merged.set(day, [open, close]);
        state.days = [...merged.keys()].sort();
        state.opens = new Map(state.days.map(day => [day, merged.get(day)[0]]));
        state.prefix = [0]; for (const day of state.days) state.prefix.push(state.prefix.at(-1) + merged.get(day)[1]);
        // 다 받은 시작 날: 요청한 날, 또는 앞선 59거래일이 이미 있는 가장 이른 날(서버가 140일 앞부터 주므로 보통 이쪽이 더 이르다).
        // 그래야 다른 카드가 조금 더 앞 날짜부터 그려도 같은 일봉을 다시 묻지 않는다.
        const earliest = [state.requestedFrom, requestedFrom, state.days[59]].filter(Boolean).sort()[0];
        state.requestedFrom = earliest;
        if (!state.through || through > state.through) state.through = through;
        state.version++; state.memos.clear();
    }
    // from · to: 그릴 분봉의 첫 · 끝 거래일(YYYYMMDD). 다 받은 구간이면 아무것도 하지 않는다.
    function ensure(target, from, to, redraw) {
        const state = stateOf(target), yesterday = dayName(dayNumber(Date.now()) - 1), need = to < yesterday ? to : yesterday;
        if (state.requestedFrom && state.requestedFrom <= from && state.through && state.through >= need) return;
        if (redraw) state.waiters.add(redraw);
        if (state.pending) return;
        const want = state.requestedFrom && state.requestedFrom < from ? state.requestedFrom : from;
        const key = `${want}:${to}`;
        if (state.failed && state.failed.key === key && Date.now() - state.failed.at < RETRY_MS) return;
        state.pending = (async () => {
            try {
                const response = await fetch(`/api/day-ma?target=${encodeURIComponent(target)}&from=${want}&to=${to}`, { cache: 'no-store' });
                const result = await response.json();
                if (!response.ok || !Array.isArray(result.rows)) throw new Error(result.error || '이평 일봉 조회 실패');
                // 서버가 답한 끝 날이 화면 시계와 하루 어긋나도(자정 무렵) 같은 요청을 되풀이하지 않게, 요청한 범위는 받은 것으로 본다.
                const through = String(result.through || need);
                accept(state, result.rows, want, through > need ? through : need);
                state.failed = null;
                const waiters = [...state.waiters]; state.waiters.clear();
                for (const fn of waiters) try { fn(); } catch (error) { console.warn('[일봉 이평] 다시 그리기 실패', error); }
            } catch (error) { state.failed = { key, at: Date.now() }; console.warn('[일봉 이평]', target, error.message); }
            finally { state.pending = null; }
        })();
    }
    // 봉마다 거래일 번호. night: 지수 선물처럼 야간(18:00~다음 날 08:00 전) 봉이 있으면 그 봉은 뒤이어 오는 주간 거래일에 붙인다
    // (차트의 거래일 묶음과 같다). 아직 주간이 오지 않은 야간 봉은 null(그날 시가 전이라 그리지 않음).
    function tradingDays(ts, night) {
        const days = new Array(ts.length);
        let next = null;
        for (let i = ts.length - 1; i >= 0; i--) {
            const t = ts[i];
            if (!Number.isFinite(t)) { days[i] = null; continue; }
            const day = dayNumber(t), minute = minuteOfDay(t);
            if (!night || (minute >= DAY_START && minute < NIGHT_START)) { days[i] = day; next = day; }
            else days[i] = minute >= NIGHT_START ? next : (next != null && next >= day ? next : null);
        }
        return days;
    }
    // 거래일별 [5일, 10일, 20일, 60일] 값(없으면 null).
    function averages(state, candles, days, ts, open) {
        const today = dayNumber(Date.now()), result = new Map(), firstOpen = new Map(), ordered = [...new Set(days.filter(d => d != null))].sort((a, b) => a - b);
        for (let i = 0; i < candles.length; i++) {
            const day = days[i];
            // 그날 08:00 이후 봉만 시가 후보(야간 선물 봉은 앞 날짜라 빠진다).
            const t = ts[i];
            if (day == null || firstOpen.has(day) || dayNumber(t) !== day || minuteOfDay(t) < DAY_START) continue;
            const value = Number(open(candles[i]));
            if (value > 0) firstOpen.set(day, value);
        }
        ordered.forEach((day, k) => {
            const name = dayName(day);
            // 지난날은 일봉 시가, 오늘은 첫 분봉 시가. 지난날인데 일봉이 없으면(자료 빠짐) 그리지 않는다.
            const dayOpen = state.opens.get(name) ?? (day === today ? firstOpen.get(day) : undefined);
            // 바로 앞 거래일(분봉 기준)의 일봉이 없으면 앞선 종가가 하루 밀려 계산되므로 그리지 않는다.
            const previous = k > 0 ? dayName(ordered[k - 1]) : null;
            if (!(dayOpen > 0) || (previous && !state.opens.has(previous))) { result.set(day, null); return; }
            let lo = 0, hi = state.days.length;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (state.days[mid] < name) lo = mid + 1; else hi = mid; }
            result.set(day, LINES.map(([n]) => lo >= n - 1 ? (state.prefix[lo] - state.prefix[lo - (n - 1)] + dayOpen) / n : null));
        });
        return result;
    }
    // options: target('stock:005930' 등), candles(전체, 시가 · 거래일 판단용), visible(그릴 봉, 기본 candles), time(p)→ms, open(p),
    //          x(p, k)→화면 x(k: visible 안 순번), y(가격)→화면 y, left · right · top · bottom(그래프 영역), night, redraw(자료가 온 뒤 다시 그리기)
    function draw(ctx, options) {
        const { target, candles, time = p => p.t, open = p => p.open, x, y, left, right, top, bottom, night = false, redraw } = options || {};
        if (!ctx || !target || !Array.isArray(candles) || !candles.length || typeof x !== 'function' || typeof y !== 'function') return;
        const visible = options.visible || candles, state = stateOf(target);
        // 봉 목록 · 받은 일봉 · 날짜가 그대로면 지난 계산을 다시 쓴다(쏠림율 카드는 봉이 1만 5천 개라 마우스를 움직일 때마다 다시 계산하지 않게).
        const signature = `${night}|${candles.length}|${time(candles[0])}|${time(candles.at(-1))}|${state.version}|${dayNumber(Date.now())}`;
        // 같은 대상(예: KOSPI 지수)을 여러 카드가 각자의 봉 목록으로 그리므로 카드마다 하나씩 남도록 몇 개를 둔다.
        let memo = state.memos.get(signature);
        if (!memo) {
            // 봉 시각은 한 번만 구한다(쏠림율 카드의 시각은 글자라 바꾸는 데 시간이 든다).
            let ts = candles.map(p => time(p)), ordered = candles;
            if (!ts.every((t, i) => i === 0 || ts[i - 1] <= t)) {
                const order = ts.map((t, i) => i).sort((a, b) => ts[a] - ts[b]);
                ordered = order.map(i => candles[i]); ts = order.map(i => ts[i]);
            }
            const days = tradingDays(ts, night);
            let first = null, last = null;
            for (let i = 0; i < days.length; i++) {
                const d = days[i];
                if (d == null) continue;
                // 야간 봉이 있는 대상(지수 선물)만 봉마다 정한 거래일을 그 봉에 붙여 둔다(2026-11-24). 야간 봉의 거래일은 뒤에 주간 봉이
                // 와야 정해지므로 정해진 것만 붙인다. 그 밖의 대상은 거래일 = 봉 시각의 날짜라 그릴 때 바로 구한다(붙이는 비용이 더 크다).
                if (night) dayOfPoint.set(ordered[i], d);
                if (first == null || d < first) first = d; if (last == null || d > last) last = d;
            }
            memo = { first, last, hits: 0, values: state.days.length ? averages(state, ordered, days, ts, open) : new Map() };
            state.memos.set(signature, memo);
            if (state.memos.size > 8) state.memos.delete(state.memos.keys().next().value);
        }
        memo.hits++;
        if (memo.first == null) return;
        ensure(target, dayName(memo.first), dayName(memo.last), redraw);
        if (!state.days.length) return;
        const { values } = memo;
        ctx.save();
        ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip();
        ctx.lineWidth = 1; ctx.setLineDash([]);
        // 봉마다 위치 · 그날 값을 한 번만 찾고, 같은 날이 이어지는 동안은 마지막 봉 위치만 기억한다(선 4개가 같은 표를 쓴다).
        const runs = [];
        let run = null;
        visible.forEach((p, k) => {
            const px = x(p, k);
            if (!Number.isFinite(px)) return;
            // 같은 봉 목록을 세 번째 그릴 때부터(마우스 이동 등) 봉에 거래일을 붙여 두고 그 값을 쓴다. 조회 중처럼 목록이 계속 바뀌면 붙이지 않는다.
            let day = dayOfPoint.get(p);
            if (day === undefined) { day = night ? null : dayNumber(time(p)); if (!night && memo.hits > 1) dayOfPoint.set(p, day); }
            if (run && run.day === day) { run.to = px; return; }
            run = { day, row: values.get(day) || null, from: px, to: px }; runs.push(run);
        });
        LINES.forEach(([, color], line) => {
            ctx.strokeStyle = color; ctx.beginPath();
            let previous = null;
            for (const { row, from, to } of runs) {
                const value = row?.[line] ?? null;
                if (value == null) { previous = null; continue; }
                if (previous == null) ctx.moveTo(from, y(value));
                else { ctx.lineTo(from, y(previous)); ctx.lineTo(from, y(value)); }
                ctx.lineTo(to, y(value));
                previous = value;
            }
            ctx.stroke();
        });
        ctx.restore();
    }
    // 시험 · 점검용: 대상의 거래일(YYYYMMDD) 이평 값. 오늘 시가를 따로 주지 않으면 지난날만 계산된다.
    function valuesOf(target, day, todayOpen) {
        const state = states.get(target);
        if (!state?.days.length) return null;
        const dayOpen = state.opens.get(day) ?? todayOpen;
        if (!(dayOpen > 0)) return null;
        const lo = state.days.filter(d => d < day).length;
        return Object.fromEntries(LINES.map(([n]) => [n, lo >= n - 1 ? (state.prefix[lo] - state.prefix[lo - (n - 1)] + dayOpen) / n : null]));
    }
    // 점검용(분봉 로딩 측정 스크립트가 경우마다 남긴다): 대상별 받은 일봉 범위 · 조회 중 · 실패.
    const status = () => Object.fromEntries([...states].map(([target, s]) => [target, { 일봉수: s.days.length, 처음: s.days[0] || null, 끝: s.days.at(-1) || null,
        다받은시작: s.requestedFrom, 다받은끝: s.through, 조회중: !!s.pending, 실패: s.failed ? new Date(s.failed.at).toISOString() : null }]));
    window.RankDayMa = { draw, ensure, valuesOf, status, LINES, reset: () => states.clear() };
})();
