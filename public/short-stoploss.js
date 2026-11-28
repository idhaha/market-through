(() => {
    'use strict';
    // 대주 StopLoss 창 (2026-11-19). 서버: short-stoploss-service.js, 정책: docs/KIWOOM_SHORT_STOPLOSS.md
    const $ = id => document.getElementById(id);
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const tick = p => p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
    const floorTick = p => Math.floor(p / tick(p)) * tick(p);
    const ceilTick = p => { const t = tick(p), c = Math.ceil(p / t) * t; return tick(c) === t ? c : Math.ceil(p / tick(c)) * tick(c); };
    // 청산 조건(2026-11-28, 서버 short-stoploss-service.js와 같은 규칙): 손절 · 익절 목표가 · 익절 트레일링. 예전 건은 손절 · 원만 켠 건
    const stopActive = w => w.stopOn !== false && w.trigger > 0;
    const targetActive = w => !!(w.profitOn && w.targetOn && w.target > 0);
    const trailActive = w => !!(w.profitOn && w.trailOn && w.trailMin > 0 && w.trailMa > 0);
    const pctNum = s => { const v = Math.abs(Number(String(s ?? '').normalize('NFKC').replace(/[^0-9.]/g, ''))); return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0; };
    // 한 호가 위 · 아래(2026-11-23): 가격대 경계에서는 단위가 바뀐다(1,999 ↑ 2,000 ↑ 2,005 / 5,000 ↓ 4,995). 호가 단위에 안 맞는 값은 먼저 맞는 호가로 간다
    const tickUp = p => { const a = floorTick(p); return a + tick(a); };
    const tickDown = p => { const a = floorTick(p); return Math.max(1, a < p ? a : p - tick(p - 1)); };
    // 숫자 읽기: 한글 입력기 전각 모드로 친 숫자(７３５０)도 받는다. 예전에는 칸에 숫자가 보여도 0으로 읽혀 조건 추가가 꺼지고 추격 한도가 "-원"이었다
    const num = s => Number(String(s ?? '').normalize('NFKC').replace(/[^0-9]/g, ''));
    const el = (tag, props = {}, ...children) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v); } for (const c of children.flat()) if (c != null) n.append(c instanceof Node ? c : String(c)); return n; };
    const badges = nxt => el('span', { class: 'ex', 'aria-label': nxt ? 'KRX · NXT 거래' : 'KRX만 거래' }, el('span', { class: 'pill krx' }, 'KRX'), el('span', { class: 'pill ' + (nxt ? 'nxt' : 'none') }, 'NXT'));
    const ACTIVE = ['발동', '주문접수', '정정중', '미체결'];
    const short = d => d ? String(d).slice(2) : '-'; // 표에서는 연도 두 자리(26-11-24): 열 너비를 고정해 두기 위해

    let state = null, offset = 0, selectedLot = '', selectedWatch = '', calendar = {}, calView = null, busy = false;
    // 독립창 앱으로 열면 주소의 #token=...은 '여는 토큰'(5분 안에 한 번만 쓸 수 있음)이다. 이것을 곧바로 '창 토큰'으로 바꿔 받아
    // 창 안(sessionStorage)에만 두고 X-SS-Token으로 보낸다. 앱 실행 인자에 남은 여는 토큰은 바꾸는 순간 쓸 수 없게 된다(short-stoploss-window.js)
    let token = sessionStorage.getItem('short-stoploss-token') || '', linkError = '';
    // 바꿔 받기에 실패해도 이미 쓰던 창 토큰이 있으면 그대로 쓴다(그 토큰도 끝났으면 다음 조회에서 401 안내가 뜬다)
    async function exchange(launch) {
        let error = '';
        try {
            const r = await fetch('/api/short-stoploss/window-exchange', { method: 'POST', headers: { 'X-SS-Launch': launch } });
            const data = await r.json().catch(() => ({}));
            if (r.ok) { token = data.token; linkError = ''; sessionStorage.setItem('short-stoploss-token', token); return; }
            error = data.error || '대주창 연결에 실패했습니다. 메인 화면에서 대주StopLoss 버튼을 다시 누르세요.';
        } catch { error = '서버에 연결하지 못했습니다. 메인 화면에서 대주StopLoss 버튼을 다시 누르세요.'; }
        if (token) setTimeout(() => say(error)); else linkError = error;
    }
    const launch = new URLSearchParams(location.hash.slice(1)).get('token');
    if (launch) history.replaceState(null, '', location.pathname);
    let ready = launch ? exchange(launch) : Promise.resolve();
    const auth = () => token ? { 'X-SS-Token': token } : {};
    // 대주창이 이미 열려 있을 때 메인 화면 버튼을 다시 누르면 앱이 새 여는 토큰을 넘긴다(서버 재시작 뒤 이어 쓰기)
    window.refreshNativeShortStopLossCredentials = next => { if ($('topmost')?.checked) window.chrome?.webview?.postMessage('topmost:true'); /* 앱이 다시 열면서 항상 위를 끄므로 체크 상태대로 되돌린다 */ ready = exchange(next); ready.then(() => { if (!linkError) { $('message').hidden = true; loadCalendar(); } loop(); }); };
    async function api(method, url, body) {
        await ready;
        if (linkError) throw Error(linkError);
        const r = await fetch('/api/short-stoploss' + url, { method, headers: { 'Content-Type': 'application/json', ...auth() }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
        const data = await r.json().catch(() => ({}));
        if (r.status === 401) throw Error(token ? (data.error || '대주창 연결이 끝났습니다. 메인 화면에서 대주StopLoss 버튼을 다시 누르세요.') : '로그인이 필요합니다. 메인 화면에서 로그인한 뒤 다시 여세요.');
        if (!r.ok) throw Error(data.error || '서버 오류');
        return data;
    }
    // 안내 문구: 전체 중지 띠와 같은 자리에 겹쳐 띄우고, 사용자가 "확인"을 눌러야 없어진다(창 크기 · 배치에 영향 없음).
    const say = text => { if (!text) return; $('messageText').textContent = text; $('message').hidden = false; };
    $('messageOk').addEventListener('click', () => { $('message').hidden = true; $('messageText').textContent = ''; });

    // ---- 드롭다운(큰 값이 위) ----
    for (let i = 10; i >= 1; i--) $('ticks').append(el('option', { value: i, selected: i === 10 }, `+${i}틱`));
    for (let i = 10; i >= 1; i--) $('chasePct').append(el('option', { value: i, selected: i === 10 }, `+${i}%`));
    // 100%-1주(값 −1, 2026-11-27 사용자 요청): 100% 바로 아래 한 칸이고 기본값. 나머지는 10% 단위
    for (const i of [60, 30, 15, 10, 5, 3, 1]) $('trailMin').append(el('option', { value: i, selected: i === 15 }, String(i)));
    for (const i of [60, 20, 10, 5, 3]) $('trailMa').append(el('option', { value: i, selected: i === 10 }, String(i)));
    for (const i of [100, -1, 90, 80, 70, 60, 50, 40, 30, 20, 10]) $('qtyPct').append(el('option', { value: i, selected: i === -1 }, pctLabel(i)));

    // ---- 렌더링 ----
    const serverNow = () => Date.now() + offset;
    const kstDay = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
    function renderTop() {
        // 한 계좌라도 켜져 있으면 켜짐(2026-11-26). 꺼진 계좌가 섞이면 풍선에 그 계좌를 적는다.
        const offAccts = (state.accounts || []).filter(a => a.enabled === false).map(a => a.account);
        $('autoState').textContent = state.enabled ? (offAccts.length ? '자동 주문 켜짐(일부 계좌)' : '자동 주문 켜짐') : '자동 주문 꺼짐';
        $('autoState').className = 'ss-pill ' + (state.enabled ? 'on' : 'off');
        $('autoState').title = !state.enabled ? '자동 주문이 꺼져 있어 주문을 내지 않습니다(서버 설정 SHORT_STOPLOSS=on으로 켭니다). 장 시간과는 관계없습니다.' : offAccts.length ? '자동 주문 꺼진 계좌: ' + offAccts.join(', ') : '';
        $('segment').textContent = state.segment ? state.segment.label : '장 시작 전';
        // 실시간 연결은 계좌마다 따로 보인다(2026-11-21): 기본 계좌는 VI 모니터와 공용 연결, 추가 계좌는 그 계좌 앱키의 연결
        const rts = (state.accounts?.length ? state.accounts : [{ account: state.account, realtime: state.realtime }]).filter(a => a.realtime), box = $('rtStates');
        const pills = rts.map(a => { const r = a.realtime, name = multi() ? acctShort(a) + ' ' : ''; return el('span', { class: 'ss-pill ' + (r.connected ? 'on' : 'off'), title: `계좌 ${a.account || ''} 키움 웹소켓: ${r.state || ''}${r.connected ? '' : ' · 끊긴 동안은 1초 조회로 감시'}` }, name + (r.connected ? '실시간 연결' : '실시간 끊김')); });
        const sig = pills.map(p => p.className + p.textContent + p.title).join('|'); if (box.dataset.sig !== sig) { box.textContent = ''; box.append(...pills); box.dataset.sig = sig; }
        // 정규장(09:00~15:20) · 애프터마켓(16:00~20:00)은 NXT 거래 종목이면 SOR, 아니면 KRX(2026-11-20 · 11-24). 고른 종목이 없으면 둘 다 보여 준다
        const seg = state.segment, pick = currentLot();
        const nxtOnly = seg?.ex === 'NXT' && pick && !pick.nxt;
        $('exNow').textContent = '지금: ' + (seg?.dual ? (pick ? (pick.nxt ? 'SOR' : 'KRX(NXT 비대상)') : 'SOR · NXT 비대상은 KRX') : nxtOnly ? '주문 안 함(NXT 비대상)' : seg?.ex ? seg.ex + (seg.id === 'NXT_SINGLE' ? '(미리 접수 · 15:40 체결)' : '') : (seg ? '보류' : '주문 안 함'));
        $('haltBanner').hidden = !state.halted;
        $('haltText').textContent = state.halted ? '전체 감시 중지: ' + state.haltedReason : '';
        renderAccounts();
        $('lotsAt').textContent = state.lotsError ? '잔고 조회 실패: ' + state.lotsError : state.lotsAt ? new Date(state.lotsAt + 9 * 3600000).toISOString().slice(11, 19) + ' 조회' : '';
    }
    // 계좌(2026-11-21): 잔고 · 감시 건은 저마다 자기 계좌로 조회 · 주문한다. 계좌가 둘 이상이면 종목 코드 옆에 계좌번호 뒤 4자리를 붙이고,
    // 계좌 고르기로 한 계좌만 볼 수 있다(전체가 기본, 이 PC에 기억). 고르기는 보기만 바꾸고 감시 · 주문에는 영향이 없다.
    let acctFilter = ''; try { acctFilter = localStorage.getItem('short-stoploss-acct') || ''; } catch {}
    const accounts = () => state?.accounts || [];
    const multi = () => accounts().length > 1;
    const acctShort = x => { const a = String(x?.account || x?.acct || ''); const m = a.match(/^\d{4}-(\d{4})/); return m ? m[1] : a; }; // 계좌번호 가운데 4자리(3699-5772-11 → 5772): 위쪽 실시간 표시용
    const acct8 = a => { const d = String(a || '').replace(/\D/g, ''); return d.length >= 8 ? d.slice(0, 4) + '-' + d.slice(4, 8) : String(a || ''); }; // 앞 8자리(3699-5772-11 → 3699-5772, 2026-11-24)
    // 계좌는 표의 종목명 아래 줄, 종목 코드 오른쪽에 앞 8자리로(2026-11-24 사용자 결정, 계좌가 하나뿐이어도 보인다)
    const acctTag = x => { const a = x.account || x.acct || state?.account; return a ? el('span', { class: 'acct-tag', title: '계좌 ' + a }, acct8(a)) : ''; };
    const shown = list => list.filter(x => !acctFilter || x.acct === acctFilter);
    function renderAccounts() {
        const sel = $('acct'), list = accounts();
        if (acctFilter && !list.some(a => a.id === acctFilter)) acctFilter = '';
        const opts = list.length > 1 ? [['', '전체 계좌'], ...list.map(a => [a.id, a.account])] : [[list[0]?.id ?? '', list[0]?.account || state.account || '계좌 확인 중']];
        const sig = JSON.stringify(opts);
        if (sel.dataset.sig !== sig) { sel.textContent = ''; for (const [v, t] of opts) sel.append(el('option', { value: v }, t)); sel.dataset.sig = sig; }
        sel.value = list.length > 1 ? acctFilter : opts[0][0]; sel.disabled = list.length < 2;
    }
    $('acct').addEventListener('change', () => {
        acctFilter = $('acct').value; try { localStorage.setItem('short-stoploss-acct', acctFilter); } catch {}
        const lot = currentLot(); if (acctFilter && lot && lot.acct && lot.acct !== acctFilter) { selectedLot = ''; selectedWatch = ''; fillLotInfo(null); $('formMode').textContent = '잔고에서 행을 고르세요'; }
        renderAll(); updateForm();
    });
    function renderLots() {
        const body = $('lotsTable').tBodies[0]; body.textContent = '';
        const lots = shown(state.lots);
        if (!lots.length) { body.append(el('tr', {}, el('td', { colspan: 8, class: 'empty' }, '대주 잔고가 없습니다'))); return; }
        for (const l of lots) {
            const tr = el('tr', { class: 'pick' + (l.key === selectedLot ? ' sel' : ''), tabindex: 0, onclick: () => pickLot(l.key), onkeydown: e => { if (e.key === 'Enter') pickLot(l.key); } },
                el('td', { title: `${l.name} ${l.code}` }, el('span', { class: 'namecell strong' }, badges(l.nxt), el('span', { class: 'nm' }, el('span', { class: 'name' }, l.name), el('span', { class: 'code' }, l.code, acctTag(l))))),
                el('td', { class: 'r' }, fmt(l.qty)), el('td', { class: 'r' + (l.able < l.qty ? ' warn' : '') }, fmt(l.able) + (l.able < l.qty ? ` (미체결 ${fmt(l.qty - l.able)})` : '')),
                el('td', { class: 'r' }, fmt(l.sellPrice)), el('td', { class: 'r' }, fmt(l.price)),
                el('td', { class: 'r ' + (l.pl > 0 ? 'pl-up' : l.pl < 0 ? 'pl-down' : '') }, `${l.pl > 0 ? '+' : ''}${fmt(l.pl)} (${l.rate > 0 ? '+' : ''}${l.rate.toFixed(2)}%)`),
                el('td', { title: l.loanDt }, short(l.loanDt)), el('td', { title: l.maturity || '' }, short(l.maturity)));
            body.append(tr);
        }
    }
    function statusClass(s) { return s === '감시중' ? 'on' : s === '중지' || s === '만료' ? 'off' : ACTIVE.includes(s) ? 'busy' : s === '체결완료' ? 'done' : 'bad'; }
    // 청산 조건 꼬리표(2026-11-28): 익절 목표가(빨강 ≤) · 트레일링(보라) · 손절(파랑 ≥) 중 켠 것만. 좁은 열이라 가격만 보이고 자세한 내용은 풍선
    function condParts(w) {
        const basis = b => b === 'reg' ? '등록 시 현재가' : '매입단가';
        return [targetActive(w) && ['tp', `≤ ${fmt(w.target)}`, `익절 목표가 ≤ ${fmt(w.target)}${w.targetMode === 'pct' ? ` (${basis(w.targetBasis)} -${w.targetPct}%)` : ''}`],
            trailActive(w) && ['tr', `${w.trailMin}분 ${w.trailMa}이평`, `익절 트레일링 ${w.trailMin}분봉 종가 ≥ ${w.trailMa}이평`],
            stopActive(w) && ['sl', `≥ ${fmt(w.trigger)}`, `손절 ≥ ${fmt(w.trigger)}${w.stopMode === 'pct' ? ` (${basis(w.stopBasis)} +${w.stopPct}%)` : ''}`]].filter(Boolean);
    }
    const condLabel = w => condParts(w).map(p => p[2]).join(' · ') || '-';
    const condTags = w => el('span', { class: 'cond-tags' }, condParts(w).map(([c, t, title]) => el('span', { class: 'tag ' + c, title }, t)));
    function methodText(w) { return w.upperLimit ? '상한가 지정가' : `+${w.ticks}틱` + (w.fix ? ` · 정정(한도 ${w.chasePct}%)` : ' · 정정 안 함') + (w.cancelPending ? ' · 미체결 취소' : '') + (w.allLots ? ' · 전체 대출일' : ''); }
    function lastText(w) {
        if (w.status === '감시중') {
            if (!(state.accounts?.find(a => a.id === w.acct)?.enabled ?? state.enabled)) return '자동 주문 꺼짐 · 판정 안 함'; // 그 감시 건 계좌 기준(2026-11-26)
            const parts = [];
            if (w.lastCheck && (stopActive(w) || targetActive(w))) parts.push(new Date(w.lastCheck.at + 9 * 3600000).toISOString().slice(11, 19) + ' ' + w.lastCheck.text);
            if (trailActive(w)) parts.push(w.trail ? w.trail.text : `트레일링 ${w.trailMin}분봉이 끝나면 판정`);
            return parts.join(' · ') || '판정 대기';
        }
        // 주문 처리 중(발동 · 주문접수 · 정정중 · 미체결): 지금 주문 가격 · 정정 횟수 · 체결 수량
        if (ACTIVE.includes(w.status)) {
            const os = w.orders || [];
            if (!os.length || !os.some(o => o.price)) return `${fmt(w.firePrice)} 발동 · 주문 내는 중`;
            return os.filter(o => o.price).map(o => `${o.ex} 주문 ${fmt(o.price)}${o.cap && o.price >= o.cap ? '(한도)' : ''} · 정정 ${o.attempts || 0}회 · ${o.filled || 0}/${o.qty}주 체결`).join(' / ');
        }
        if (w.status === '만료') return `유효기간 종료(${w.until} 20:00)`;
        if (w.status === '중지') return state.halted ? '전체 감시 중지됨' : '감시 꺼짐';
        return w.note || (w.log?.length ? '' : '') || w.status;
    }
    window.__ssLastText = w => lastText(w); // 화면 시험용(판정 · 결과 문구 확인)
    window.__ssQtyTextWith = (w, lots) => qtyText(w, lots); // 화면 시험용(수량 칸)
    // 할당(2026-11-24): 같은 대출일 묶음에 감시 건을 여러 개 둘 수 있다. 주문 전(감시중 · 중지) 건의 수량은 그 묶음에 할당된 것으로 보고,
    // 새 건의 가능수량은 남은 수량이다(서버 short-stoploss-service.js와 같은 규칙). 등록 때 정한 주 수는 w.shares, 그때 보유수량은 w.baseQty
    const ALLOC = ['감시중', '중지'];
    // 수량 %: −1은 "100%-1주"(가능수량에서 1주를 남김), 그 밖에는 내림 · 최소 1주(서버 pctShares와 같음)
    function pctShares(base, v) { return v === -1 ? Math.max(0, base - 1) : base >= 1 ? Math.max(1, Math.floor(base * v / 100)) : 0; }
    function pctLabel(v) { return v === -1 ? '100%-1주' : v + '%'; }
    function watchShares(w, lot) {
        if (w.shares > 0) return w.shares;
        if (!lot) return w.qtyMode === 'shares' ? w.qtyValue : null;
        return w.qtyMode === 'pct' ? pctShares(lot.able, w.qtyValue) : Math.min(w.qtyValue, lot.able);
    }
    function remainingFor(lot, exceptId) {
        if (!lot || typeof lot.qty !== 'number') return null; // 잔고에서 사라진 건(보유 모름)
        const used = (state?.watches || []).filter(w => w.lotKey === lot.key && w.id !== exceptId && ALLOC.includes(w.status)).reduce((a, w) => a + (watchShares(w, lot) || 0), 0);
        return Math.max(0, lot.able - used);
    }
    // 감시 · 청산수량(2026-11-24): 청산 전에는 감시수량, 청산 뒤에는 청산(체결)수량. 둘 다 "N주 (보유수량 대비 %)"
    // 예: 보유 10주를 6주 · 4주 두 건으로 나누면 6주 (60%), 4주 (40%)
    function qtyText(w, lots = state.lots) {
        const lot = lots.find(l => l.key === w.lotKey), os = (w.orders || []).filter(o => o.qty > 0);
        let n, base = w.baseQty || 0;
        if (os.length) {
            const filled = os.reduce((a, o) => a + (o.filled || 0), 0);
            n = w.status === '체결완료' ? filled : os.reduce((a, o) => a + o.qty, 0);
            if (!base) base = os.every(o => o.able > 0) ? os.reduce((a, o) => a + o.able, 0) : (lot?.qty || 0) + filled; // 예전 건: 주문 때 가능수량 또는 남은 보유 + 체결
        } else {
            n = watchShares(w, lot);
            if (!base) base = lot?.qty || 0;
        }
        if (n == null) return w.qtyMode === 'pct' ? `- (${pctLabel(w.qtyValue)})` : '-';
        return `${fmt(n)}주${base > 0 ? ` (${Math.min(100, Math.round(n / base * 100))}%)` : ''}`;
    }
    function renderWatches() {
        const body = $('watchTable').tBodies[0]; body.textContent = '';
        const ws = shown(state.watches);
        $('watchSummary').textContent = `감시중 ${ws.filter(w => w.status === '감시중').length}건 · 처리 중 ${ws.filter(w => ACTIVE.includes(w.status)).length}건 · 체결 ${ws.filter(w => w.status === '체결완료').length}건`;
        const toggles = ws.filter(w => ['감시중', '중지'].includes(w.status));
        const all = $('watchAll'); all.disabled = !toggles.length || state.halted;
        const on = toggles.filter(w => w.status === '감시중').length;
        all.checked = toggles.length > 0 && on === toggles.length; all.indeterminate = on > 0 && on < toggles.length;
        if (!ws.length) { body.append(el('tr', {}, el('td', { colspan: 10, class: 'empty' }, '감시 조건이 없습니다. 잔고에서 행을 고르고 조건을 추가하세요.'))); return; }
        for (const w of ws) {
            const canToggle = ['감시중', '중지'].includes(w.status) && !state.halted;
            const box = el('input', { type: 'checkbox', 'aria-label': `${w.name} 감시`, disabled: !canToggle });
            box.checked = w.status === '감시중';
            box.addEventListener('click', e => e.stopPropagation());
            box.addEventListener('change', () => act(() => api('POST', `/watches/${w.id}/enabled`, { enabled: box.checked })));
            const buttons = el('span', { class: 'row' });
            if (!ACTIVE.includes(w.status)) buttons.append(el('button', { type: 'button', class: 'btn small', onclick: e => { e.stopPropagation(); if (confirm(`${w.name}(${w.loanDt}) 감시 조건을 지울까요?`)) act(() => api('DELETE', `/watches/${w.id}`)); } }, '삭제'));
            if (w.status === '만료') buttons.append(el('button', { type: 'button', class: 'btn small', onclick: e => { e.stopPropagation(); pickWatch(w.id); setFold(true); $('until').focus(); openCal(); } }, '연장'));
            buttons.append(el('button', { type: 'button', class: 'btn small link', onclick: e => { e.stopPropagation(); showLog(w.id); } }, '기록'));
            body.append(el('tr', { class: 'pick' + (w.id === selectedWatch ? ' sel' : ''), onclick: () => pickWatch(w.id) },
                el('td', {}, box), el('td', {}, el('span', { class: 'st ' + statusClass(w.status) }, w.status)),
                el('td', { title: `${w.name} ${w.code}` }, el('span', { class: 'namecell' }, badges(w.nxt), el('span', { class: 'nm' }, el('span', { class: 'name' }, w.name), el('span', { class: 'code' }, w.code, acctTag(w))))),
                el('td', { class: 'r' }, qtyText(w)), el('td', { class: 'wrap', title: condLabel(w) }, condTags(w)), el('td', { class: 'wrap', title: methodText(w) }, methodText(w)),
                el('td', { class: 'wrap ' + (['실패', '확인 필요', '부분체결'].includes(w.status) ? 'loss' : 'muted') }, lastText(w)),
                el('td', { title: w.loanDt }, short(w.loanDt)), el('td', { title: '~' + w.until }, '~' + short(w.until)), el('td', {}, buttons)));
        }
    }

    // ---- 설정란 ----
    function currentLot() { const w = state?.watches.find(x => x.id === selectedWatch); return state?.lots.find(l => l.key === (w ? w.lotKey : selectedLot)) || (w ? { key: w.lotKey, code: w.code, name: w.name, loanDt: w.loanDt, maturity: w.maturity, nxt: w.nxt, acct: w.acct, account: w.account, able: 0 } : null); }
    function fillLotInfo(lot) {
        const name = $('fName'); name.textContent = '';
        if (!lot) { name.textContent = '-'; $('fLot').textContent = '-'; $('fAcct').textContent = '-'; return; }
        name.append(lot.name, ' ', el('span', { class: 'code' }, lot.code), badges(lot.nxt), el('span', { class: 'dae' }, '대주'));
        // 가능수량은 다른 감시 건(감시중 · 중지)에 할당한 수량을 뺀 남은 수량(2026-11-26 사용자 지적: 등록한 수량까지 다 가능으로 보였음)
        const rem = remainingFor(lot, selectedWatch), held = rem == null ? lot.able : rem;
        // 대출일 · 만기일은 잔고 표에 있어 설정란에서는 가능수량만 보인다(2026-11-26 사용자 요청: 제목 '대출일' → '가능수량').
        // 매입단가(2026-11-28): 잔고의 공매도단가. 손절 · 익절 %의 기준
        const avg = avgOf(lot);
        $('fLot').textContent = `${fmt(held)}주${rem != null && rem < lot.able ? ` (감시 등록 ${fmt(lot.able - rem)}주 제외)` : ''}${avg ? ` · 매입단가 ${fmt(avg)}` : ''}`;
        $('fAcct').textContent = acct8(lot.account || state?.account) || '-'; // 계좌는 대출일 아래 따로, 앞 8자리(2026-11-24)
    }
    // 매입단가 · 등록 시 현재가: 고친 건은 등록 때 값, 새 건은 지금 잔고 값
    const selWatch = () => state?.watches.find(x => x.id === selectedWatch);
    const avgOf = lot => lot?.sellPrice || selWatch()?.avgPrice || 0;
    const regOf = lot => selWatch()?.regPrice || lot?.price || 0;
    function defaultUntil(lot) { const d = new Date(kstDay(serverNow()) + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return adjust(d.toISOString().slice(0, 10), lot).value; }
    // 유효기간 칸은 비워 두지 않고 처음부터 기본값(오늘 + 1개월)을 넣는다(2026-11-21). 사용자가 직접 고르기 전까지(untilAuto)는
    // 서버 시각 · 휴장일 달력 · 고른 잔고의 만기일을 받은 뒤와 날짜가 바뀐 뒤에도 기본값을 다시 맞춘다. 칸을 지우면 기본값으로 돌아간다.
    let untilAuto = true;
    function autoUntil() {
        if (!untilAuto || selectedWatch || document.activeElement === $('until')) return;
        const v = defaultUntil(currentLot()); if ($('until').value !== v) $('until').value = v;
    }
    let triggerAuto = false;
    function autoTrigger() {
        if (!triggerAuto || selectedWatch) return;
        const lot = currentLot(); if (!lot?.price) return;
        const v = fmt(lot.price); $('trigger').placeholder = '현재 ' + fmt(lot.price);
        if ($('trigger').value !== v) { $('trigger').value = v; updateForm(); }
    }
    function pickLot(key) {
        selectedLot = key; selectedWatch = '';
        const lot = currentLot();
        fillLotInfo(lot);
        // 수량은 남은 가능수량 기준으로 다시 채운다(2026-11-27 사용자 지적): 감시 건을 보다가 같은 종목 잔고를 고르면 '주' 칸에 그 감시 건 수량(예: 171주)이 남아
        // 남은 1주보다 많다며 조건 추가가 꺼졌다. '주' 칸 = 남은 수량, % = 기본 100%-1주(남은 수량이 1주뿐이면 1주를 남길 수 없어 100%)
        const rem = remainingFor(lot, ''); $('qtyPct').value = rem != null && rem < 2 ? 100 : -1; $('qtyShares').value = rem != null && rem >= 1 ? String(rem) : '';
        // 감시가 기본값(2026-11-23): 현재가를 넣어 두어 고치지 않고도 바로 조건 추가를 할 수 있다(청산이라 업틱룰과 무관, 사용자 결정).
        // 현재가 = 감시가라 등록하면 바로 발동할 수 있어, 조건 추가 때 확인을 받는다.
        // 칸을 직접 고치거나 화살표를 쓰기 전까지(triggerAuto)는 현재가가 바뀌면 따라간다. 칸을 비우면 회색 "현재 ○○"만 보인다
        $('trigger').value = ''; $('trigger').placeholder = lot?.price ? '현재 ' + fmt(lot.price) : ''; triggerAuto = true; autoTrigger();
        // 청산 조건 기본값(2026-11-28): 손절 · 원(현재가)만 켜짐 = 예전과 같음. 익절은 꺼 두고, 켜면 목표가 매입단가 -5% · 트레일링 15분 10이평
        setExit({ stopOn: true, stopMode: 'price', stopPct: 3, stopBasis: 'avg', profitOn: false, targetOn: true, targetMode: 'pct', targetPct: 5, targetBasis: 'avg', target: 0, trailOn: false, trailMin: 15, trailMa: 10 });
        $('until').value = defaultUntil(lot); untilAuto = true; $('calNote').hidden = true;
        $('formMode').textContent = '새 조건';
        renderAll(); updateForm();
        $('trigger').focus();
    }
    // 청산 조건 설정 접기 · 펴기(2026-11-20). 접어도 잔고 · 감시 목록의 가로폭은 그대로 두고(접기 직전 폭으로 고정),
    // 독립창 앱에서는 창 오른쪽 끝을 화살표 옆까지 줄이고 펴면 그만큼 다시 늘린다(앱이 창 왼쪽 위 위치를 그대로 둔다).
    // 앱이 아닌 브라우저 탭에서는 창 크기는 그대로이고 오른쪽이 비어 보인다.
    // 접힘 상태는 저장해 두고 다음에 열 때 그대로 연다. 창 위치 · 크기는 앱이 기억한다(접은 채 닫았으면 접은 크기).
    const native = window.chrome?.webview;
    const resizeWindow = dw => { if (native && dw) native.postMessage(`resize-window:${Math.round(dw)},0,${window.innerWidth},${window.innerHeight}`); };
    // 펼 때 돌아갈 창 안쪽 폭(CSS px). 늘릴 양을 그때 다시 계산해(목표 폭 - 지금 폭) 반올림 오차가 접고 펼 때마다 쌓이지 않게 한다
    let foldOpenWidth = 0;
    const saveFold = left => { try { localStorage.setItem('short-stoploss-fold', JSON.stringify(left ? { closed: true, left, openWidth: foldOpenWidth } : { closed: false })); } catch {} };
    function setFold(open, { restore } = {}) {
        const left = document.querySelector('.ss-left');
        if (open === !document.body.classList.contains('form-closed')) return;
        if (!open) {
            const width = restore ? restore.left : left.getBoundingClientRect().width;
            left.style.flex = `0 1 ${width}px`;
            document.body.classList.add('form-closed');
            if (restore) foldOpenWidth = restore.openWidth;
            else {
                const need = Math.ceil($('foldBtn').closest('.ss-fold').getBoundingClientRect().right) + 12;
                foldOpenWidth = native ? window.innerWidth : 0;
                if (native && window.innerWidth > need) resizeWindow(need - window.innerWidth);
            }
            saveFold(width);
        } else {
            left.style.flex = '';
            document.body.classList.remove('form-closed');
            if (foldOpenWidth > window.innerWidth) resizeWindow(foldOpenWidth - window.innerWidth);
            foldOpenWidth = 0;
            saveFold(0);
        }
        const b = $('foldBtn'), label = open ? '청산 조건 설정 접기' : '청산 조건 설정 펴기';
        b.setAttribute('aria-expanded', String(open)); b.setAttribute('aria-label', label); b.title = label;
    }
    try { const f = JSON.parse(localStorage.getItem('short-stoploss-fold') || 'null'); if (f && f.closed && f.left > 0) setFold(false, { restore: { left: f.left, openWidth: Math.max(0, Number(f.openWidth) || 0) } }); } catch {}
    $('foldBtn').addEventListener('click', () => setFold(document.body.classList.contains('form-closed')));
    function pickWatch(id) {
        const w = state.watches.find(x => x.id === id); if (!w) return;
        selectedWatch = id; selectedLot = w.lotKey; triggerAuto = false;
        fillLotInfo(currentLot());
        $('trigger').value = w.trigger ? fmt(w.trigger) : ''; setExit(w); $('ticks').value = w.ticks; $('upperLimit').checked = w.upperLimit; $('fix').checked = w.fix; $('chasePct').value = w.chasePct;
        document.querySelector(`input[name="qtyMode"][value="${w.qtyMode}"]`).checked = true;
        if (w.qtyMode === 'pct') $('qtyPct').value = w.qtyValue; else $('qtyShares').value = w.qtyValue;
        $('allLots').checked = w.allLots; $('cancelPending').checked = w.cancelPending; $('until').value = w.until; $('calNote').hidden = true;
        $('formMode').textContent = `감시 건 수정 (${w.status})`;
        renderAll(); updateForm();
    }
    // 청산 조건 칸 채우기(새 건 기본값 · 고르는 감시 건). 예전 건(stopOn 없음)은 손절 · 원
    function setExit(w) {
        const radio = (name, v) => { const r = document.querySelector(`input[name="${name}"][value="${v}"]`); if (r) r.checked = true; };
        $('stopOn').checked = w.stopOn !== false; radio('stopMode', w.stopMode === 'pct' ? 'pct' : 'price');
        $('stopPct').value = '+' + (Number(w.stopPct) || 3).toFixed(1); $('stopBasis').value = w.stopBasis === 'reg' ? 'reg' : 'avg';
        $('profitOn').checked = !!w.profitOn; $('targetOn').checked = w.targetOn !== false; radio('targetMode', w.targetMode === 'price' ? 'price' : 'pct');
        $('targetPct').value = '-' + (Number(w.targetPct) || 5).toFixed(1); $('targetBasis').value = w.targetBasis === 'reg' ? 'reg' : 'avg';
        $('targetPrice').value = w.target ? fmt(w.target) : '';
        $('trailOn').checked = !!w.trailOn; $('trailMin').value = String(w.trailMin || 15); $('trailMa').value = String(w.trailMa || 10);
    }
    function formValue() {
        const mode = document.querySelector('input[name="qtyMode"]:checked').value;
        const radio = name => document.querySelector(`input[name="${name}"]:checked`)?.value;
        return { stopOn: $('stopOn').checked, stopMode: radio('stopMode'), stopPct: pctNum($('stopPct').value), stopBasis: $('stopBasis').value,
            profitOn: $('profitOn').checked, targetOn: $('targetOn').checked, targetMode: radio('targetMode'), target: num($('targetPrice').value), targetPct: pctNum($('targetPct').value), targetBasis: $('targetBasis').value,
            trailOn: $('trailOn').checked, trailMin: +$('trailMin').value, trailMa: +$('trailMa').value,
            trigger: num($('trigger').value), ticks: +$('ticks').value, upperLimit: $('upperLimit').checked, fix: $('fix').checked, chasePct: +$('chasePct').value,
            qtyMode: mode, qtyValue: mode === 'pct' ? +$('qtyPct').value : num($('qtyShares').value),
            allLots: $('allLots').checked, cancelPending: $('cancelPending').checked, until: $('until').value };
    }
    function updateForm() {
        const v = formValue(), lot = currentLot();
        $('chasePct').disabled = !v.fix || v.upperLimit; $('fix').disabled = v.upperLimit; $('ticks').disabled = v.upperLimit; // 상한가로면 틱은 안 씀
        $('qtyPct').disabled = v.qtyMode !== 'pct'; $('qtyShares').disabled = v.qtyMode !== 'shares';
        { const rem = remainingFor(lot, selectedWatch), n = num($('qtyShares').value), off = v.qtyMode !== 'shares' || !lot || rem != null && rem < 1;
          $('sharesUp').disabled = off || rem != null && n >= rem; $('sharesDown').disabled = off || n === 1; }
        // 청산 조건(2026-11-28): 켠 것만 판정. %는 기준가(매입단가 · 등록 시 현재가)로 원 단위 값을 미리 계산해 괄호에 보인다(서버도 같은 계산으로 저장)
        const ex = exitState(v, lot);
        // 감시가 · 목표가 범위(2026-11-23): 그날 하한가 ~ 상한가. 넘으면 조건 추가를 끄고 이유를 추격 한도 자리에 보인다
        const up = lot?.upper || 0, low = lot?.lower || 0;
        const outOf = (p, name) => !p ? '' : up && p > up ? `${name}가 상한가 ${fmt(up)}보다 높습니다` : low && p < low ? `${name}가 하한가 ${fmt(low)}보다 낮습니다` : '';
        const range = (ex.stop && outOf(ex.stopPrice, '감시가')) || (ex.target && outOf(ex.targetPrice, '목표가')) || '';
        // 추격 한도 미리보기: 손절 감시가, 손절을 껐으면 목표가, 둘 다 없으면 현재가로 계산
        const capBase = ex.stop ? ex.stopPrice : ex.target ? ex.targetPrice : ex.trail ? lot?.price || 0 : 0;
        const cap = capBase ? floorTick(capBase * (1 + v.chasePct / 100)) : 0; // 고른 %를 기준가에 더한 가격, 상한가를 넘으면 상한가(서버 주문도 같음)
        $('chaseNote').textContent = range || (!v.fix || v.upperLimit ? (v.upperLimit ? '상한가 주문' : '정정 안 함') : !cap ? '-원' : up && cap >= up ? `${fmt(up)}원(상한가)` : `${fmt(cap)}원`);
        $('chaseNote').classList.toggle('warn', !!range);
        const w = state?.watches.find(x => x.id === selectedWatch);
        // 수량은 남은 가능수량까지(2026-11-24): 다른 감시 건에 할당한 수량을 뺀 나머지. %는 남은 수량 기준으로 주 수를 보여 준다
        const rem = remainingFor(lot, selectedWatch);
        const pctN = rem == null ? null : pctShares(rem, v.qtyValue);
        const qtyErr = rem == null ? '' : rem < 1 ? '남은 가능수량이 없습니다(다른 감시 건에 모두 할당)' : v.qtyMode === 'shares' && v.qtyValue > rem ? `남은 가능수량 ${fmt(rem)}주보다 많습니다` : v.qtyMode === 'pct' && v.qtyValue === -1 && rem < 2 ? '100%-1주는 남은 가능수량이 2주 이상일 때만 쓸 수 있습니다' : '';
        // 수량 줄(2026-11-27 사용자 결정): "남은 N주의" 문구는 없애고, % 드롭다운 뒤 주 수는 '주'를 골라도 그대로 보인다
        // (수량 % · 주를 바꿔도 줄 너비 · 창 크기가 변하지 않게). '주'를 고른 동안에도 드롭다운의 %로 계산한 주 수다.
        const pctCalc = rem == null || rem < 1 ? 0 : pctShares(rem, Number($('qtyPct').value));
        $('qtyCalc').textContent = pctCalc >= 1 ? `${fmt(pctCalc)}주` : '';
        $('qtyNote').textContent = qtyErr; $('qtyNote').hidden = !qtyErr;
        const ok = !!lot && ex.valid && !range && !qtyErr && (v.qtyMode === 'pct' || v.qtyValue >= 1) && !busy;
        $('addBtn').disabled = !ok || !!w; $('editBtn').disabled = !ok || !w || ACTIVE.includes(w.status) || ['체결완료', '부분체결', '잔고없음'].includes(w.status);
        // 파란 버튼(2026-11-27 사용자 결정): 새로 설정할 때는 조건 추가, 감시 목록의 건을 고르면 조건 수정
        $('addBtn').classList.toggle('primary', !w); $('editBtn').classList.toggle('primary', !!w);
        $('fromDay').textContent = kstDay(serverNow()) + ' ~';
        // 화살표: 상한가에 닿으면 ↑, 하한가(없으면 1원)에 닿으면 ↓를 더 누를 수 없다
        const base = v.trigger || lot?.price || 0, floor = Math.max(1, low), stopPriceOn = v.stopOn && v.stopMode === 'price';
        $('trigUp').disabled = !stopPriceOn || !lot || !base || (up > 0 && base >= up);
        $('trigDown').disabled = !stopPriceOn || !lot || !base || (v.trigger ? v.trigger <= floor : floorTick(base) < floor);
        const tBase = v.target || lot?.price || 0, targetPriceOn = v.profitOn && v.targetOn && v.targetMode === 'price';
        $('tgUp').disabled = !targetPriceOn || !lot || !tBase || (up > 0 && tBase >= up);
        $('tgDown').disabled = !targetPriceOn || !lot || !tBase || (v.target ? v.target <= floor : floorTick(tBase) < floor);
        renderExit(v, lot, ex);
    }
    // 켠 조건 · 원 단위 값 · 등록 가능 여부
    function exitState(v, lot) {
        const basis = b => b === 'reg' ? regOf(lot) : avgOf(lot);
        const stopPrice = v.stopMode === 'pct' ? (basis(v.stopBasis) && v.stopPct >= 0.1 && v.stopPct <= 50 ? ceilTick(basis(v.stopBasis) * (1 + v.stopPct / 100)) : 0) : v.trigger;
        const targetPrice = v.targetMode === 'pct' ? (basis(v.targetBasis) && v.targetPct >= 0.1 && v.targetPct <= 50 ? floorTick(basis(v.targetBasis) * (1 - v.targetPct / 100)) : 0) : v.target;
        const stop = v.stopOn && stopPrice > 0, target = v.profitOn && v.targetOn && targetPrice > 0, trail = v.profitOn && v.trailOn;
        // 켠 조건은 값이 있어야 하고, 하나 이상 켜져 있어야 한다
        const valid = (!v.stopOn || stop) && (!(v.profitOn && v.targetOn) || target) && (stop || target || trail);
        return { stopPrice, targetPrice, stop, target, trail, valid };
    }
    // 박스 흐림 · 입력 잠금 · 괄호 금액 · 트레일링 현재 줄
    function renderExit(v, lot, ex) {
        const lockBox = (box, on) => { box.classList.toggle('dis', !on); };
        const lockRow = (row, on, chosen) => { row.classList.toggle('off', on && !chosen); for (const n of row.querySelectorAll('input:not([type=radio]),select,button.step-btn')) if (n.id !== 'trigUp' && n.id !== 'trigDown' && n.id !== 'tgUp' && n.id !== 'tgDown') n.disabled = !(on && chosen); for (const r of row.querySelectorAll('input[type=radio]')) r.disabled = !on; };
        lockBox($('slBox'), v.stopOn);
        const [sp, spc] = $('slBox').querySelectorAll('.mode-row'); lockRow(sp, v.stopOn, v.stopMode === 'price'); lockRow(spc, v.stopOn, v.stopMode === 'pct');
        lockBox($('tpBox'), v.profitOn); $('targetOn').disabled = !v.profitOn; $('trailOn').disabled = !v.profitOn;
        const tOn = v.profitOn && v.targetOn; $('targetSub').classList.toggle('dis', v.profitOn && !v.targetOn);
        const [tp, tpc] = $('targetSub').querySelectorAll('.mode-row'); lockRow(tp, tOn, v.targetMode === 'price'); lockRow(tpc, tOn, v.targetMode === 'pct');
        const trOn = v.profitOn && v.trailOn; $('trailSub').classList.toggle('dis', v.profitOn && !v.trailOn); $('trailMin').disabled = !trOn; $('trailMa').disabled = !trOn;
        const avg = avgOf(lot), vsAvg = p => avg && p ? `(매입단가 ${p >= avg ? '+' : ''}${((p / avg - 1) * 100).toFixed(2)}%)` : '';
        $('stopPriceNote').textContent = v.stopMode === 'price' ? vsAvg(v.trigger) : '';
        $('stopCalc').textContent = v.stopMode === 'pct' && ex.stopPrice ? `(${fmt(ex.stopPrice)}원)` : '';
        $('targetPriceNote').textContent = v.targetMode === 'price' ? vsAvg(v.target) : '';
        $('targetCalc').textContent = v.targetMode === 'pct' && ex.targetPrice ? `(${fmt(ex.targetPrice)}원)` : '';
        // 트레일링 현재 줄: 고른 감시 건의 마지막 판정 봉(봉 종가 · 이평). '<' · '≧'는 위 줄 '≧'와 같은 가로 위치
        const w = selWatch(), tr = w && trailActive(w) && w.trail && w.trail.ma ? w.trail : null;
        if (tr) {
            $('trLead').textContent = ''; $('trLead').append(`${new Date(tr.bar + 9 * 3600000).toISOString().slice(11, 16)} 현재 `, el('b', {}, fmt(tr.close)));
            $('trLt').textContent = tr.close >= tr.ma ? '≧' : '<'; $('trMa').textContent = fmt(tr.ma);
            const d = (tr.close / tr.ma - 1) * 100; $('trDiff').textContent = `(${d >= 0 ? '+' : ''}${d.toFixed(2)}%)`; $('trDiff').className = d >= 0 ? 'loss' : 'gain';
        } else { $('trLead').textContent = trOn ? '등록 뒤 처음 끝나는 봉부터 판정' : ''; $('trLt').textContent = ''; $('trMa').textContent = ''; $('trDiff').textContent = ''; }
        alignTrail();
    }
    function alignTrail() {
        const lead = $('trLead'), lt = $('trLt'); lead.style.width = '';
        if (!lt.textContent || !lead.offsetParent) return;
        const a = $('trOp').getBoundingClientRect(), b = lt.getBoundingClientRect();
        lead.style.width = Math.max(0, lead.getBoundingClientRect().width + (a.left + a.width / 2) - (b.left + b.width / 2)) + 'px';
    }
    addEventListener('resize', alignTrail);
    // 감시가 한 호가씩(2026-11-23): 화살표 버튼 · 칸에서 키보드 ↑ ↓. 빈 칸이면 현재가 기준(↑ 현재가 위 첫 호가, ↓ 현재가)
    function stepTrigger(dir) {
        const lot = currentLot(), v = num($('trigger').value), p = v || lot?.price || 0; if (!p) return; triggerAuto = false;
        const up = lot?.upper || 0, floor = Math.max(1, lot?.lower || 0);
        let next = v ? (dir > 0 ? tickUp(v) : tickDown(v)) : (dir > 0 ? tickUp(p) : floorTick(p));
        if (up && next > up) next = up; if (next < floor) next = floor; // 범위 밖 값에서 누르면 가까운 끝으로
        $('trigger').value = fmt(next);
        updateForm();
    }
    $('trigger').addEventListener('input', () => { triggerAuto = false; });
    // 목표가 한 호가씩(감시가와 같은 규칙, 빈 칸이면 현재가 기준) · % 0.5%p씩
    function stepTarget(dir) {
        const lot = currentLot(), v = num($('targetPrice').value), p = v || lot?.price || 0; if (!p || $('targetPrice').disabled) return;
        const up = lot?.upper || 0, floor = Math.max(1, lot?.lower || 0);
        let next = v ? (dir > 0 ? tickUp(v) : tickDown(v)) : (dir > 0 ? tickUp(p) : floorTick(p));
        if (up && next > up) next = up; if (next < floor) next = floor;
        $('targetPrice').value = fmt(next); updateForm();
    }
    $('tgUp').addEventListener('click', () => stepTarget(1)); $('tgDown').addEventListener('click', () => stepTarget(-1));
    $('targetPrice').addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepTarget(e.key === 'ArrowUp' ? 1 : -1); } });
    $('targetPrice').addEventListener('blur', () => { const n = num($('targetPrice').value); if (n) $('targetPrice').value = fmt(n); });
    // %: 손절은 +, 목표가는 −로 보인다(0.1~50%). 화살표 ↑는 값을 0.5%p 크게(손절 +3.0 → +3.5, 목표가 -5.0 → -5.5가 아니라 화면 숫자 기준 -4.5)
    function stepPct(id, dir) {
        const inp = $(id); if (inp.disabled) return; const sign = id === 'stopPct' ? 1 : -1;
        const shown = sign * (pctNum(inp.value) || (sign > 0 ? 3 : 5)), next = Math.round((shown + dir * 0.5) * 10) / 10;
        const mag = Math.min(50, Math.max(0.5, sign * next)); inp.value = (sign > 0 ? '+' : '-') + mag.toFixed(1); updateForm();
    }
    for (const [id, upId, downId] of [['stopPct', 'slPctUp', 'slPctDown'], ['targetPct', 'tpPctUp', 'tpPctDown']]) {
        $(upId).addEventListener('click', () => stepPct(id, 1)); $(downId).addEventListener('click', () => stepPct(id, -1));
        $(id).addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepPct(id, e.key === 'ArrowUp' ? 1 : -1); } });
        $(id).addEventListener('blur', () => { const n = pctNum($(id).value); if (n) $(id).value = (id === 'stopPct' ? '+' : '-') + n.toFixed(1); });
    }
    $('trigUp').addEventListener('click', () => stepTrigger(1));
    $('trigDown').addEventListener('click', () => stepTrigger(-1));
    $('trigger').addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepTrigger(e.key === 'ArrowUp' ? 1 : -1); } });
    // '주' 칸에 남은 가능수량보다 많이 치면 남은 수량으로 바꾼다(2026-11-27 사용자 요청). updateForm보다 먼저 돈다
    $('qtyShares').addEventListener('input', () => { const rem = remainingFor(currentLot(), selectedWatch), n = num($('qtyShares').value); if (rem != null && rem >= 1 && n > rem) $('qtyShares').value = String(rem); });
    // '주' 칸 1주씩(2026-11-27 사용자 요청): 화살표 버튼 · 칸에서 키보드 ↑ ↓. 1주 ~ 남은 가능수량. 빈 칸이면 ↑ 1주, ↓ 남은 수량
    function stepShares(dir) {
        if ($('qtyShares').disabled) return;
        const rem = remainingFor(currentLot(), selectedWatch), max = rem == null ? Infinity : rem, v = num($('qtyShares').value);
        if (!(max >= 1)) return;
        const next = !v ? (dir > 0 ? 1 : max) : Math.min(max, Math.max(1, v + dir));
        if (Number.isFinite(next)) $('qtyShares').value = String(next); updateForm();
    }
    $('sharesUp').addEventListener('click', () => stepShares(1));
    $('sharesDown').addEventListener('click', () => stepShares(-1));
    $('qtyShares').addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepShares(e.key === 'ArrowUp' ? 1 : -1); } });
    for (const id of ['trigger', 'ticks', 'upperLimit', 'fix', 'chasePct', 'qtyPct', 'qtyShares', 'allLots', 'cancelPending', 'stopOn', 'stopPct', 'stopBasis', 'profitOn', 'targetOn', 'targetPrice', 'targetPct', 'targetBasis', 'trailOn', 'trailMin', 'trailMa']) { $(id).addEventListener('input', updateForm); $(id).addEventListener('change', updateForm); }
    for (const r of document.querySelectorAll('input[name="stopMode"], input[name="targetMode"]')) r.addEventListener('change', updateForm);
    for (const r of document.querySelectorAll('input[name="qtyMode"]')) r.addEventListener('change', updateForm);
    $('trigger').addEventListener('blur', () => { const n = num($('trigger').value); if (n) $('trigger').value = fmt(n); });
    $('qtyShares').addEventListener('blur', () => { const n = num($('qtyShares').value); if (n) $('qtyShares').value = String(n); });
    // 손절을 끈 채 조건 추가(2026-11-28 사용자 결정): 오르는 쪽 보호가 없다는 확인 창을 익절 박스 자리에 띄운다(대주창 오른쪽 · 아래 경계 안)
    function askStopOff(lot) {
        const dlg = $('stopOffDlg'), box = dlg.querySelector('.cf'), avg = avgOf(lot);
        $('stopOffText').textContent = `이 조건은 값이 오르는 쪽을 감시하지 않습니다.${avg ? ` 매입단가 ${fmt(avg)}원 위로 올라가도 상환하지 않고, 목표가 · 트레일링은 매입단가 아래에서만 상환합니다.` : ''}`;
        dlg.hidden = false;
        const t = $('tpBox').getBoundingClientRect(), f = $('formCard').getBoundingClientRect(), hd = $('formCard').querySelector('.card-hd').offsetHeight, w = box.offsetWidth, h = box.offsetHeight;
        box.style.left = Math.max(8, Math.min(t.left, innerWidth - w - 8)) + 'px';
        box.style.top = Math.max(8, Math.min(Math.max(t.top, f.top + hd + 8), innerHeight - h - 8)) + 'px';
        $('stopOffOk').focus();
        return new Promise(resolve => {
            const done = ok => { dlg.hidden = true; $('stopOffOk').onclick = $('stopOffNo').onclick = dlg.onkeydown = null; resolve(ok); };
            $('stopOffOk').onclick = () => done(true);
            $('stopOffNo').onclick = () => { $('stopOn').checked = true; updateForm(); done(false); $('stopOn').focus(); };
            dlg.onkeydown = e => { if (e.key === 'Escape') done(false); };
        });
    }
    window.__ssExitState = () => exitState(formValue(), currentLot()); // 화면 시험용
    $('addBtn').addEventListener('click', async () => {
        const lot = currentLot(), v = formValue(), ex = exitState(v, lot);
        if (!v.stopOn && !await askStopOff(lot)) return;
        if (ex.stop && lot.price && lot.price >= ex.stopPrice && !confirm(`현재가 ${fmt(lot.price)}이 감시가 ${fmt(ex.stopPrice)} 이상입니다. 등록하면 바로 발동해 대주상환 주문이 나갈 수 있습니다. 계속할까요?`)) return;
        if (ex.target && lot.price && lot.price <= ex.targetPrice && !confirm(`현재가 ${fmt(lot.price)}이 목표가 ${fmt(ex.targetPrice)} 이하입니다. 등록하면 바로 발동해 대주상환 주문이 나갈 수 있습니다. 계속할까요?`)) return;
        act(async () => { const w = await api('POST', '/watches', { lotKey: lot.key, ...v }); selectedWatch = w.id; if (w.untilNote) say(w.untilNote); });
    });
    $('editBtn').addEventListener('click', () => act(async () => { const w = await api('PUT', `/watches/${selectedWatch}`, formValue()); if (w.untilNote) say(w.untilNote); }));
    $('watchAll').addEventListener('change', () => act(() => api('POST', '/watch-all', { enabled: $('watchAll').checked, acct: acctFilter || undefined })));
    $('refreshBtn').addEventListener('click', () => act(() => api('POST', '/refresh')));
    $('resumeBtn').addEventListener('click', () => { if (confirm('영웅문에서 주문을 확인했나요? 다시 쓰면 감시를 켤 수 있습니다(꺼진 건은 직접 켜야 합니다).')) act(() => api('POST', '/resume')); });

    // ---- 유효기간 달력 ----
    const isOpen = d => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w !== 0 && w !== 6 && calendar[d] !== false; };
    function adjust(s, lot) {
        const today = kstDay(serverNow()), maturity = lot?.maturity || '', notes = [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) s = today;
        if (maturity && s > maturity) { s = maturity; notes.push(`대주 만기일(${maturity}) 이후라 만기일로 맞췄습니다`); }
        if (s < today) { s = today; notes.push('오늘 이전이라 오늘로 맞췄습니다'); }
        if (!isOpen(s)) { const o = s, d = new Date(s + 'T00:00:00Z'); let g = 0; do d.setUTCDate(d.getUTCDate() - 1); while (!isOpen(d.toISOString().slice(0, 10)) && ++g < 30); s = d.toISOString().slice(0, 10); notes.push(`휴장일(${o})이라 직전 거래일 ${s}로 맞췄습니다`); }
        return { value: s, note: notes.join(' · ') };
    }
    let noteTimer;
    function setUntil(s) {
        if (!String(s || '').trim()) { untilAuto = !selectedWatch; $('until').value = defaultUntil(currentLot()); $('calNote').hidden = true; return; }
        untilAuto = false;
        const a = adjust(String(s).trim(), currentLot()); $('until').value = a.value; $('calNote').textContent = a.note; $('calNote').hidden = !a.note; clearTimeout(noteTimer); if (a.note) noteTimer = setTimeout(() => { $('calNote').hidden = true; }, 6000); }
    function renderCal() {
        const y = calView.getUTCFullYear(), m = calView.getUTCMonth(), first = new Date(Date.UTC(y, m, 1)).getUTCDay(), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const today = kstDay(serverNow()), maturity = currentLot()?.maturity || '9999-12-31';
        const cal = $('cal'); cal.textContent = '';
        cal.append(el('div', { class: 'hd' }, el('button', { type: 'button', 'aria-label': '이전 달', onclick: () => { calView.setUTCMonth(m - 1); renderCal(); } }, '‹'), `${y}년 ${m + 1}월`, el('button', { type: 'button', 'aria-label': '다음 달', onclick: () => { calView.setUTCMonth(m + 1); renderCal(); } }, '›')));
        const grid = el('div', { class: 'grid' });
        ['일', '월', '화', '수', '목', '금', '토'].forEach((n, i) => grid.append(el('span', { style: `color:${i === 0 ? '#B3261E' : i === 6 ? '#1557B0' : '#545E6E'}` }, n)));
        for (let i = 0; i < first; i++) grid.append(el('span'));
        for (let d = 1; d <= days; d++) {
            const s = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, c = [];
            if (!isOpen(s)) c.push('off'); if (s > maturity || s < today) c.push('over'); if (s === $('until').value) c.push('sel'); if (s === maturity) c.push('mat');
            grid.append(el('button', { type: 'button', class: c.join(' '), onclick: () => { setUntil(s); closeCal(); } }, d));
        }
        cal.append(grid, el('div', { class: 'ft' }, '회색: 휴장일 · 취소선: 만기일 이후 · 오늘 이전 · 빨간 테두리: 대주 만기일. 골라도 자동 조정됩니다.'));
    }
    function openCal() { const v = $('until').value || kstDay(serverNow()); calView = new Date(v.slice(0, 7) + '-01T00:00:00Z'); renderCal(); $('cal').hidden = false; $('calBtn').setAttribute('aria-expanded', 'true'); }
    function closeCal() { $('cal').hidden = true; $('calBtn').setAttribute('aria-expanded', 'false'); }
    $('calBtn').addEventListener('click', e => { e.stopPropagation(); if ($('cal').hidden) openCal(); else closeCal(); });
    $('until').addEventListener('change', () => setUntil($('until').value));
    document.addEventListener('click', e => { if (!$('cal').hidden && !$('cal').contains(e.target) && !$('calBtn').contains(e.target)) closeCal(); });
    async function loadCalendar() {
        try {
            const from = kstDay(serverNow()), to = new Date(Date.parse(from) + 120 * 86400000).toISOString().slice(0, 10);
            await ready;
            const r = await fetch(`/api/trading-session/calendar?from=${from}&to=${to}`, { credentials: 'same-origin', headers: auth() });
            if (r.ok) calendar = (await r.json()).days || {};
        } catch {}
        autoUntil();
    }

    // ---- 기록 창 ----
    async function showLog(id) {
        try {
            const { watch: w, log } = await api('GET', `/watches/${id}/log`);
            $('logTitle').textContent = `처리 기록 · ${w.name} ${w.code}`;
            $('logSub').textContent = `대출일 ${w.loanDt} · ${condLabel(w)} · ${methodText(w)} · ~${w.until} · 상태 ${w.status}`;
            const list = $('logList'); list.textContent = '';
            for (const e of log) list.append(el('div', { class: 'lr' }, el('span', { class: 't' }, new Date(e.at + 9 * 3600000).toISOString().slice(5, 19).replace('T', ' ')), el('span', { class: 'k' }, e.kind), el('span', {}, e.text)));
            if (!log.length) list.append(el('div', { class: 'lr' }, el('span'), el('span'), el('span', { class: 'muted' }, '기록이 없습니다')));
            const orders = w.orders || [], filled = orders.reduce((s, o) => s + (o.filled || 0), 0), total = orders.reduce((s, o) => s + o.qty, 0);
            const prices = orders.flatMap(o => o.fillPrices || []), avg = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
            const sum = $('logSum'); sum.textContent = '';
            const item = (k, v) => el('div', {}, el('span', {}, k), el('b', {}, v));
            sum.append(item('체결', total ? `${fmt(filled)}/${fmt(total)}주` : '-'), item('평균 상환가(참고)', avg ? fmt(avg) : '-'),
                item('발동가 대비', avg && w.firePrice ? `${avg - w.firePrice >= 0 ? '+' : ''}${fmt(avg - w.firePrice)}원` : '-'), item('정정', `${orders.reduce((s, o) => s + (o.attempts || 0), 0)}회`));
            $('logModal').hidden = false; $('logModal').querySelector('[data-close]').focus();
        } catch (error) { say(error.message); }
    }

    // ---- 정책 전체(창 제목 옆 i) ----
    // 엔진 시간표(2026-11-24 사용자 요청: 거래소 · 접수 · 체결 가능 여부를 한 표로). 칸의 ○ △ × ?는 색으로 구분한다
    const TIMETABLE = [
        ['시간', 'KRX', 'NXT', 'SOR', '판정(현재가)', '엔진 주문'],
        ['08:00~08:50', '접수 × 장개시전 (11/25)', '접수 ○ · 체결 ○ (11/20)', '접수 ○ (11/25) · 체결 ?', 'NXT 체결가', 'NXT (비대상은 09:00 대기)'],
        ['08:50~09:00', '접수 ○ (11/25) · 체결 △ 09:00', '접수 × 휴장 (11/25)', '접수 ○ (11/25) · 체결 △ 09:00', '판정 안 함', '보류'],
        ['09:00~15:20', '접수 ○ · 체결 ○ (11/19)', '접수 ○ · 체결 ○', '접수 ○ · 체결 ○ (11/20)', 'KRX · NXT 체결가', 'SOR (비대상은 KRX)'],
        ['15:20~15:30', '접수 ○ · 체결 △ 15:30 (11/20)', '접수 × 휴장 (11/25)', '접수 ○ (11/25) · 체결 △ 15:30', 'KRX 예상체결가', 'KRX'],
        ['15:30~15:40', '접수 × · 체결 ×', '접수 ○ · 체결 △ 15:40 (11/24)', '접수 ○ (11/25) · 체결 △ 15:40 → NXT (11/27)', 'NXT 예상체결가(없으면 마지막 체결가)', 'NXT 미리 접수 · 정정 안 함'],
        ['15:40~16:00', '접수 × 장종료 (11/24)', '접수 ○ · 체결 ○', '접수 ○ · 체결 ○ → NXT (11/25)', 'NXT 체결가', 'NXT (비대상은 16:00 대기)'],
        ['16:00~20:00', '접수 ○ · 체결 ○ (11/25)', '접수 ○ · 체결 ○ (11/23)', '접수 ○ · 체결 ○ → NXT (11/25)', 'KRX · NXT 체결가', 'SOR (비대상은 KRX)'],
        ['20:00~08:00', '×', '×', '×', '감시 정지', '주문 안 함']
    ];
    const MARKS = { '○': 'mk-ok', '△': 'mk-wait', '×': 'mk-no', '?': 'mk-unk' };
    const marked = t => String(t).split(/([○△×?])/).filter(Boolean).map(p => MARKS[p] ? el('span', { class: 'mk ' + MARKS[p] }, p) : p);
    const timetableEl = cls => el('table', { class: cls }, el('thead', {}, el('tr', {}, TIMETABLE[0].map(t => el('th', { scope: 'col' }, t)))),
        el('tbody', {}, TIMETABLE.slice(1).map(r => el('tr', {}, r.map((t, i) => el(i ? 'td' : 'th', i ? {} : { scope: 'row' }, marked(t)))))));
    // 주문 거래소 i 풍선에도 같은 시간표(2026-11-24 사용자 요청)
    $('exTimetable')?.append(timetableEl('tt'));
    const POLICY = [
        ['쓰는 키움 API (2026-11-19 · 20 실계좌 시험으로 확인)', ['대주 잔고: kt00018 개별 조회(대출일별 행 · 가능수량), 만기일은 ka10085', '상환 주문: kt10006에 신용구분 77(대주상환) · 대출일. 공식 명세에 없는 값이라 접수마다 "+상환대주"를 확인합니다. KRX · NXT 접수 · 체결 확인', '정정 kt10008 · 취소 kt10009 · 접수 확인 ka10075 · kt00009, 시세 조회 ka10001 · 호가 ka10004', '대주매도(진입)는 API에서 막혀 있어 영웅문에서 합니다. 일반 매수(kt10000)는 대주를 갚지 않아 쓰지 않습니다']],
        ['실시간 (VI 모니터와 공용 연결)', ['키움 웹소켓은 앱키당 하나만 열 수 있어(새 연결이 기존 연결을 끊음), VI 모니터의 연결 하나에 대주 감시 종목 체결(0B)과 주문체결 · 잔고(00 · 04)를 함께 등록합니다', '실시간이 붙어 있으면 체결이 올 때마다 바로 판정하고 조회는 5초 간격 보조, 끊기면 1초 조회로 감시합니다. 위쪽 "실시간 연결" 표시로 상태를 봅니다', '주문을 낸 뒤의 접수 확인("+상환대주" · 신용 77)과 체결 확인도 내 주문체결 이벤트(00)로 바로 합니다. 조회(접수 1초 · 체결 3초)는 이벤트를 놓쳤을 때의 보조입니다', '충돌하면 대주가 우선입니다: 대주 실시간 등록이 거부되면 VI 등록을 해지하고 대주를 다시 등록합니다', 'VI 모니터를 켜지 않는 서버(오라클)는 조회만으로 감시합니다']],
        ['확인 주기 (서로 다른 세 가지)', ['발동 판정 · 주문 뒤 확인 · 기록 주기는 서로 다릅니다'],
            [['주기', '무엇을 하나', '언제 돌아가나'],
             ['실시간 체결(0B) · 5초 조회(실시간이 끊기면 1초)', '발동 판정용 현재가 확인. 0B는 그 종목에서 누가 사고팔든 체결이 날 때마다 오고, 5초 조회는 실시간을 놓쳤을 때의 보조', '감시중일 때'],
             ['내 주문체결(00) · 3초 조회', '주문 뒤 접수 · 체결 확인. 00은 내 주문이 접수 · 체결 · 정정 · 취소될 때만 오고 바로 반영, 3초 조회는 보조. 덜 체결됐으면 3초마다 미체결 정정(최대 3회)을 결정', '주문을 낸 뒤'],
             ['30초 기록', '확인용 기록 파일 남기기(감시 건의 마지막 판정 · 실시간 수신 건수). 판정 · 주문과는 무관. 파일은 당일 것만 두고 지난 날짜는 지웁니다', '감시 건이 있을 때만']]],
        ['계좌 (2026-11-21)', ['키움 계좌마다 앱키를 따로 둡니다(기본 앱키 계좌 · 끝자리 28 계좌). 두 계좌의 대주 잔고 · 감시 건을 한 화면에 함께 보여 주고, 계좌가 둘 이상이면 종목 코드 옆에 계좌번호 뒤 4자리(예: 0328)를 붙입니다', '잔고 조회 · 대주상환 주문 · 정정 · 취소 · 미체결 확인은 그 잔고 행(감시 건)의 계좌 앱키로 합니다. 다른 계좌로 주문이 나가지 않습니다', '실시간도 계좌마다 그 계좌 앱키의 웹소켓으로 받습니다(웹소켓은 앱키당 하나). 기본 계좌는 VI 모니터와 공용 연결, 끝자리 28 계좌는 자기 연결로 감시 종목 체결(0B)과 그 계좌의 주문체결(00)을 받아 바로 판정 · 확인합니다. 위쪽 "실시간 연결"은 두 계좌가 모두 붙어 있을 때 켜집니다', '잔고 칸의 계좌 고르기는 보기만 바꿉니다. 전체 감시 체크는 지금 보고 있는 계좌(전체 계좌면 모두)에 적용됩니다', '안전장치로 감시가 멈추면 그 계좌만 멈춥니다']],
        ['감시 단위', ['잔고에서 고른 한 행(종목 + 대출일)만 감시합니다', '"다른 대출일 묶음도 함께 상환"(기본 꺼짐)을 켜면 같은 종목의 모든 대출일을 대출일별로, 만기가 가까운 것부터 상환합니다']],
        ['발동 조건 (2026-11-28)', ['익절 · 손절 중 켠 것이 먼저 맞는 쪽으로 상환합니다. 각자 자기 조건만 봅니다', '손절: 현재가 ≧ 감시가. 원으로 넣거나, 매입단가(공매도단가) · 등록 시 현재가 대비 +%로 넣습니다(호가단위로 올림해 저장)', '익절 목표가: 현재가 ≦ 목표가. 원 또는 매입단가 · 등록 시 현재가 대비 −%(호가단위로 내림해 저장)', '익절 트레일링 스탑: KRX+NXT 통합 N분봉이 끝난 순간 종가 ≧ M이평(단순)이면 그때 현재가 기준으로 상환. 등록(다시 켠) 뒤 처음 끝나는 봉부터 보고, 봉 종가가 매입단가 이상이면 상환하지 않습니다(그 구간은 손절 조건만, 손절을 껐으면 아무것도 안 함)', '어느 조건으로 발동해도 주문은 같습니다(체결가 +틱 지정가 · 미체결 추격 정정 · 수량)', '현재가를 어느 거래소 체결가로 판정하는지는 아래 시간표의 "판정" 칸. 오늘 체결이 없는 값으로는 판정하지 않습니다', '등록할 때 이미 조건을 만족하면 확인을 받고, 손절을 끈 채 등록하면 오르는 쪽 보호가 없다는 확인을 받습니다', '예전에 등록한 건은 손절 · 원만 켠 건으로 이어집니다']],
        ['엔진 시간표 (평일, 대주상환 기준)', ['○ 됨 · △ 접수만 받고 정해진 시각에 한꺼번에 체결 · × 안 됨 · ? 아직 시험 안 함. 괄호는 실계좌로 확인한 날짜', '2026-09-14 KRX 시간 개편(KRX 애프터마켓 16:00~20:00, 대주 09:00~20:00) 기준입니다'],
            TIMETABLE,
            ['SOR: 키움이 KRX · NXT 중 유리한 곳으로 보냅니다. 장 마감 뒤 SOR 주문이 실제로 어느 거래소로 갔는지는 체결 전이라 아직 모릅니다(조회에 "SOR"로만 나옴). SOR 정정은 아직 실제로 해 보지 않았습니다', '정규장 · 종가 단일가 주문이 15:30에 남아 없어지면 NXT 종목은 NXT로(15:30~15:40은 미리 접수), NXT 비대상은 16:00에 KRX로 다시 냅니다', 'ETF · ETN은 KRX 애프터마켓 대상이 아닙니다. 수능일 같은 특수 시간표는 아직 반영하지 않습니다']],
        ['주문 가격 · 수량', ['발동 체결가 + 틱(+1~+10, 기본 +10) 지정가, 상한가를 넘으면 상한가', '상한가 선택칸: 처음부터 상한가로 내고 정정하지 않습니다', '수량: 가능수량의 100% · 100%-1주(기본) · 90~10% 또는 주 수. 드롭다운은 큰 값이 위', '같은 대출일 묶음에 감시 건을 여러 개 둘 수 있습니다(2026-11-24). 가능수량은 다른 감시 건(감시중 · 중지)에 이미 할당한 수량을 뺀 남은 수량이고, %는 등록할 때 남은 수량 기준 주 수로 정해집니다. 예: 10주 중 60%(6주) 등록 뒤 다음 건의 100%는 4주. 감시 목록에는 6주 (60%), 4주 (40%)처럼 보유수량 대비로 보입니다']],
        ['미체결 추격 한도 (기본 켜짐)', ['3초 간격 최대 3회: 1회 그때 매도1호가 + 틱, 2회 매도1호가 + 틱 × 2, 3회 추격 한도 가격', '추격 한도: 발동가 대비 1~10%(기본 10%). 처음 주문과 모든 정정가는 한도 · 상한가를 넘지 않습니다', '끄면 정정하지 않고 미체결을 알리기만 합니다. 3회 뒤에도 남으면 한도 가격 주문을 둡니다']],
        ['동일종목 미체결 상환 취소 후 주문 (기본 켜짐)', ['미체결 대주상환 주문이 있으면 가능수량이 0이라 거부되므로, 발동 때 먼저 취소합니다']],
        ['유효기간', ['기본 등록일 + 1개월. 만기일 이후 → 만기일, 오늘 이전 → 오늘, 휴장일 → 직전 거래일로 자동 조정', '마지막 날 20:00에 만료되고, 만료 건은 연장 뒤 다시 켭니다']],
        ['서버가 꺼졌다 켜질 때', ['감시하던 건은 서버가 켜지자마자 저장된 조건으로 자동으로 다시 감시합니다. 따로 켤 필요가 없습니다. 상태별 동작은 아래와 같습니다.'],
            [['꺼질 때 상태', '켜진 뒤 동작'],
             ['감시중', '그대로 감시를 이어 갑니다. 첫 판정에서 이미 감시가 이상이면 바로 발동합니다.'],
             ['중지(체크 끔), 전체 중지', '그대로 유지합니다.'],
             ['주문이 나간 상태(주문접수 · 정정중 · 미체결)', '주문번호로 체결 추적과 정정을 이어 갑니다. 새 주문은 내지 않습니다.'],
             ['"발동"을 기록했지만 주문 전에 꺼짐', '주문이 나갔는지 알 수 없어 다시 발동하지 않습니다. "확인 필요"로 바꾸고 감시를 끕니다. 영웅문에서 확인한 뒤 조건을 고치면 다시 쓸 수 있습니다.'],
             ['꺼진 사이 유효기간이 지남', '첫 판정에서 "만료"로 바뀝니다.']],
            ['꺼져 있던 동안의 시세는 볼 수 없습니다. 그사이 감시가를 넘었다가 다시 내려왔다면 발동하지 않습니다.']],
        ['안전장치 · 기록', ['발동은 한 번만: 주문 전에 "발동"을 파일에 기록합니다', '주문 직전에 잔고를 다시 조회합니다', '접수 3초 안에 "+상환대주"가 확인되지 않으면 즉시 취소하고 전체 감시를 멈춥니다(빨간 띠, "확인했습니다"를 눌러야 닫힘)', '발동 · 주문 · 정정 · 체결 · 감시 켬/끔은 바로 저장하고, 30초마다 감시 건의 마지막 판정 · 실시간 수신 건수를 확인용으로 따로 남깁니다(발동 시점과는 무관)', '자동 주문은 SHORT_STOPLOSS=on인 서버에서만 냅니다(지금은 로컬 PC만). 관리자 계정만 이 창을 쓸 수 있습니다']],
        ['화면', ['처음 창 크기는 1220×840(2026-11-28, 열 때 설정란이 넘치면 그만큼 창을 늘림). 잔고 · 감시 건이 늘면 각 칸 안에서만 스크롤되고, 열 너비도 고정입니다', '안내 문구(주황)와 전체 중지 띠(빨강)는 맨 위 띠 아래에 겹쳐 뜨고 "확인"을 눌러야 닫힙니다. 아래 칸을 밀지 않습니다', '감시 체크박스: 켜면 감시, 끄면 중지(실시간 등록도 해지) · 전체 감시 체크박스', '판정 · 결과: 감시 중이면 마지막 판정 시세, 주의가 필요하면 그 이유, 끝났으면 한 줄 결과 · 기록: 처리 과정 전체']],
        ['아직 시험하지 않은 것', ['시간표의 ? 칸(장 전 08:00~08:50 SOR 체결 거래소), SOR 정정, 여러 대출일 동시 상환, VI 중 접수, ETF · ETN 호가단위, 대주 우선으로 VI 등록을 해지하는 경우']]
    ];
    // 항목: [제목, 목록] 또는 [제목, 목록, 표(첫 줄이 머리글), 표 아래 목록]
    function renderPolicy() {
        const b = $('policyBody'); b.textContent = '';
        for (const [title, lines, table, after] of POLICY) {
            b.append(el('h3', {}, title), el('ul', {}, lines.map(t => el('li', {}, t))));
            if (table) b.append(el('table', {}, el('thead', {}, el('tr', {}, table[0].map(t => el('th', { scope: 'col' }, t)))), el('tbody', {}, table.slice(1).map(r => el('tr', {}, r.map((t, i) => el(i ? 'td' : 'th', i ? {} : { scope: 'row' }, marked(t))))))));
            if (after) b.append(el('ul', {}, after.map(t => el('li', {}, t))));
        }
    }
    // 항상 위(2026-11-26 사용자 요청): 독립창 앱(WebView2)에 topmost 메시지를 보낸다. 브라우저에서는 감춘다.
    if (window.chrome?.webview) {
        $('topmost').addEventListener('change', e => window.chrome.webview.postMessage('topmost:' + e.target.checked));
        try { $('scaleSync').checked = localStorage.getItem('ss-scale-sync') === 'true'; } catch {}
        $('scaleSync').addEventListener('change', e => { try { localStorage.setItem('ss-scale-sync', String(e.target.checked)); } catch {} if (e.target.checked) { scaleAt = 0; followScale(); } });
    } else $('topmostWrap').hidden = true;
    $('policyBtn').addEventListener('click', () => { renderPolicy(); $('policyModal').hidden = false; $('policyModal').querySelector('[data-close]').focus(); });
    for (const m of document.querySelectorAll('.modal')) {
        m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; });
        m.addEventListener('keydown', e => { if (e.key === 'Escape') m.hidden = true; });
    }

    // ---- 설명 풍선: i에 마우스를 올리거나 키보드로 고르면 화면 맨 위에 띄운다(칸 경계에 잘리지 않음) ----
    const floatTip = el('div', { id: 'floatTip', role: 'tooltip' }); document.body.append(floatTip);
    function showTip(tip) {
        const box = tip.querySelector('.tipbox'), btn = tip.querySelector('.i'); if (!box || !btn) return;
        floatTip.innerHTML = box.innerHTML; floatTip.className = box.classList.contains('xwide') ? 'xwide' : box.classList.contains('wide') ? 'wide' : ''; floatTip.style.display = 'block';
        const r = btn.getBoundingClientRect(), w = floatTip.offsetWidth, h = floatTip.offsetHeight, m = 8;
        let left = Math.min(Math.max(m, r.right - w + 8), innerWidth - w - m);
        let top = r.top - h - 8; if (top < m) top = Math.min(r.bottom + 8, innerHeight - h - m);
        floatTip.style.left = Math.round(left) + 'px'; floatTip.style.top = Math.round(Math.max(m, top)) + 'px';
    }
    const hideTip = () => { floatTip.style.display = 'none'; };
    document.addEventListener('mouseover', e => { const t = e.target.closest('.tip'); if (t) showTip(t); });
    document.addEventListener('mouseout', e => { const t = e.target.closest('.tip'); if (t && !t.contains(e.relatedTarget)) hideTip(); });
    document.addEventListener('focusin', e => { const t = e.target.closest('.tip'); if (t) showTip(t); else hideTip(); });
    document.addEventListener('scroll', hideTip, true);

    // ---- 갱신 ----
    function fillTitles(table) { for (const td of table.tBodies[0].querySelectorAll('td')) if (!td.title && !td.querySelector('input,button')) td.title = td.textContent.replace(/s+/g, ' ').trim(); }
    function renderAll() { if (!state) return; renderTop(); renderLots(); renderWatches(); fillTitles($('lotsTable')); fillTitles($('watchTable')); }
    async function act(fn) { busy = true; updateForm(); try { await fn(); await poll(); } catch (error) { say(error.message); await poll().catch(() => {}); } finally { busy = false; updateForm(); } }
    async function poll() {
        const s = await api('GET', '/state'); offset = s.now - Date.now(); state = s;
        if (selectedWatch && !s.watches.some(w => w.id === selectedWatch)) selectedWatch = '';
        renderAll(); updateForm();
        if (selectedLot) fillLotInfo(currentLot());
        autoUntil(); autoTrigger();
        followScale();
    }
    // 독립창 앱: '메인창과 보기배율 동기화'를 켰을 때만 메인 화면의 확대 · 축소 배율을 따라간다(2026-11-26, 기본 끔, 이 창에 저장). 메인 화면이 바꾼 배율을 5초마다 확인한다
    let scaleAt = 0;
    async function followScale() {
        if (!native || !token || !$('scaleSync')?.checked || Date.now() - scaleAt < 5000) return; scaleAt = Date.now();
        try {
            const r = await fetch('/api/short-stoploss/window-info', { headers: auth() }); if (!r.ok) return;
            const ratio = Number((await r.json()).scale) / devicePixelRatio;
            if (Number.isFinite(ratio) && ratio >= 0.25 && ratio <= 4 && Math.abs(ratio - 1) > 0.02) native.postMessage('page-scale:' + ratio);
        } catch {}
    }
    setInterval(() => { $('clock').textContent = new Date(serverNow() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' '); }, 500);
    let timer;
    // 창 크기 맞추기(2026-11-28 사용자 요청: 설정란에 스크롤이 생기지 않게): 독립창 앱에서 열 때 한 번, 설정란이 넘치는 만큼 창 높이를,
    // 폭이 1220보다 좁으면 그만큼 폭을 늘려 달라고 앱에 알린다. 줄이지는 않고, 설정란을 접어 둔 상태에서는 건드리지 않는다
    // (앱은 화면 아래 끝을 넘으면 창을 위로 올리고, 화면보다 크면 화면 높이까지만 늘린다)
    const WINDOW_WIDTH = 1220; let sized = false;
    function fitWindow() {
        if (sized || !native || document.body.classList.contains('form-closed')) return; sized = true;
        const f = $('formCard'), dh = Math.max(0, f.scrollHeight - f.clientHeight), dw = Math.max(0, WINDOW_WIDTH - window.innerWidth);
        if (dw || dh) native.postMessage(`resize-window:${Math.ceil(dw)},${Math.ceil(dh)},${window.innerWidth},${window.innerHeight}`);
    }
    async function loop() { clearTimeout(timer); try { await poll(); fitWindow(); } catch (error) { say(error.message); } timer = setTimeout(loop, document.hidden ? 10000 : 2000); }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
    // 열 폭 조절: 머리글 오른쪽 경계를 끌면 그 열의 폭이 바뀐다. 폭은 이 PC 브라우저에 저장하고, 경계를 두 번 누르면 처음 폭으로 돌아간다.
    // 열 폭: 날짜 · 수량 · 체크 · 버튼 같은 열은 기본 폭 그대로(data-base), 종목 · 가격 · 문구 열(data-flex)만 남는 폭을 기본 폭 비율로 나눠 가진다.
    // 머리글 오른쪽 경계를 끌면 그 열 폭이 바뀌고(이 PC 브라우저에 저장), 경계를 두 번 누르면 처음 상태로 돌아간다.
    function resizable(table, key) {
        const cols = [...table.querySelectorAll('colgroup col')], ths = [...table.tHead.rows[0].cells], wrap = table.parentElement;
        const base = cols.map(c => Number(c.dataset.base) || 60), flex = cols.map(c => c.hasAttribute('data-flex'));
        let custom = false;
        const setWidths = ws => { ws.forEach((w, i) => { cols[i].style.width = w + 'px'; }); table.style.width = ws.reduce((a, b) => a + b, 0) + 'px'; };
        function autoFit() {
            if (custom) return;
            // 화면 배율(175% 등)에서는 clientWidth가 반올림돼 실제 폭보다 0.x px 클 수 있어 표 아래 가로 스크롤이 생긴다. 소수점 폭을 내림하고 1px 여유를 둔다
            const avail = Math.min(wrap.clientWidth, Math.floor(wrap.getBoundingClientRect().width)) - 1, sum = base.reduce((a, b) => a + b, 0), flexSum = base.reduce((a, b, i) => a + (flex[i] ? b : 0), 0);
            const extra = Math.max(0, avail - sum);
            const ws = base.map((b, i) => flex[i] ? Math.floor(b + extra * b / flexSum) : b);
            ws[flex.lastIndexOf(true)] += Math.max(0, avail - ws.reduce((a, b) => a + b, 0)); // 내림으로 남은 몇 px
            setWidths(ws);
        }
        try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); if (Array.isArray(saved) && saved.length === cols.length && saved.every(w => w > 0)) { custom = true; setWidths(saved); } } catch {}
        const save = () => { try { localStorage.setItem(key, JSON.stringify(cols.map(c => parseFloat(c.style.width) || 0))); } catch {} };
        ths.forEach((th, i) => {
            const grip = el('span', { class: 'col-grip', 'aria-hidden': 'true', title: '끌어서 열 폭 조절 · 두 번 누르면 처음 폭' });
            grip.addEventListener('pointerdown', e => {
                e.preventDefault(); grip.setPointerCapture(e.pointerId);
                custom = true;
                const ws = cols.map(c => parseFloat(c.style.width) || 0), start = e.clientX, width = ws[i];
                const move = ev => { ws[i] = Math.max(32, Math.round(width + ev.clientX - start)); setWidths(ws); };
                const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); save(); };
                grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
            });
            grip.addEventListener('dblclick', () => { custom = false; try { localStorage.removeItem(key); } catch {} autoFit(); });
            th.append(grip);
        });
        new ResizeObserver(autoFit).observe(wrap); autoFit();
    }
    resizable($('lotsTable'), 'short-stoploss-cols-lots-v2'); resizable($('watchTable'), 'short-stoploss-cols-watch-v3'); // 열 순서가 바뀌어(2026-11-24) · 감시가 열이 청산 조건 열로 넓어져(2026-11-28) 예전에 저장한 폭은 쓰지 않는다
    autoUntil(); loadCalendar(); loop();
})();
