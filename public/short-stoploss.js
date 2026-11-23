(() => {
    'use strict';
    // 대주 StopLoss 창 (2026-11-19). 서버: short-stoploss-service.js, 정책: docs/KIWOOM_SHORT_STOPLOSS.md
    const $ = id => document.getElementById(id);
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const tick = p => p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
    const floorTick = p => Math.floor(p / tick(p)) * tick(p);
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
    window.refreshNativeShortStopLossCredentials = next => { ready = exchange(next); ready.then(() => { if (!linkError) { $('message').hidden = true; loadCalendar(); } loop(); }); };
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
    for (let i = 10; i >= 1; i--) $('chasePct').append(el('option', { value: i, selected: i === 10 }, `${i}%`));
    for (let i = 100; i >= 10; i -= 10) $('qtyPct').append(el('option', { value: i, selected: i === 100 }, `${i}%`));

    // ---- 렌더링 ----
    const serverNow = () => Date.now() + offset;
    const kstDay = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
    function renderTop() {
        $('autoState').textContent = state.enabled ? '자동 주문 켜짐' : '자동 주문 꺼짐(이 서버)';
        $('autoState').className = 'ss-pill ' + (state.enabled ? 'on' : 'off');
        $('autoState').title = state.enabled ? '' : '이 서버는 주문을 내지 않습니다. 서버 설정 SHORT_STOPLOSS=on으로 켭니다.';
        $('segment').textContent = state.segment ? state.segment.label : '장 시간 아님';
        // 실시간 연결은 계좌마다 따로 보인다(2026-11-21): 기본 계좌는 VI 모니터와 공용 연결, 추가 계좌는 그 계좌 앱키의 연결
        const rts = (state.accounts?.length ? state.accounts : [{ account: state.account, realtime: state.realtime }]).filter(a => a.realtime), box = $('rtStates');
        const pills = rts.map(a => { const r = a.realtime, name = multi() ? acctShort(a) + ' ' : ''; return el('span', { class: 'ss-pill ' + (r.connected ? 'on' : 'off'), title: `계좌 ${a.account || ''} 키움 웹소켓: ${r.state || ''}${r.connected ? '' : ' · 끊긴 동안은 1초 조회로 감시'}` }, name + (r.connected ? '실시간 연결' : '실시간 끊김')); });
        const sig = pills.map(p => p.className + p.textContent + p.title).join('|'); if (box.dataset.sig !== sig) { box.textContent = ''; box.append(...pills); box.dataset.sig = sig; }
        // 정규장(09:00~15:20)은 NXT 거래 종목이면 SOR, 아니면 KRX(2026-11-20). 고른 종목이 없으면 둘 다 보여 준다
        const seg = state.segment, pick = currentLot();
        $('exNow').textContent = '지금: ' + (seg?.id === 'KRX' ? (pick ? (pick.nxt ? 'SOR' : 'KRX(NXT 비대상)') : 'SOR · NXT 비대상은 KRX') : seg?.ex || (seg ? '보류' : '주문 안 함'));
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
    const acctShort = x => { const a = String(x?.account || x?.acct || ''); const m = a.match(/^\d{4}-(\d{4})/); return m ? m[1] : a; }; // 계좌번호 뒤 4자리(3699-5772-11 → 5772)
    // 계좌 뒤 4자리는 표의 대출일 아래 줄에 붙인다(2026-11-23: 종목 코드 옆 → 대출일 아래, 계좌가 하나뿐이어도 보인다)
    const acctTag = x => { const a = x.account || x.acct || state?.account; return a ? el('span', { class: 'acct-tag', title: '계좌 ' + a }, acctShort({ account: a })) : ''; };
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
                el('td', { title: l.loanDt }, short(l.loanDt), acctTag(l)), el('td', { title: `${l.name} ${l.code}` }, el('span', { class: 'namecell strong' }, el('span', { class: 'nm' }, el('span', { class: 'name' }, l.name), el('span', { class: 'code' }, l.code)), badges(l.nxt))),
                el('td', { class: 'r' }, fmt(l.qty)), el('td', { class: 'r' + (l.able < l.qty ? ' warn' : '') }, fmt(l.able) + (l.able < l.qty ? ` (미체결 ${fmt(l.qty - l.able)})` : '')),
                el('td', { class: 'r' }, fmt(l.sellPrice)), el('td', { class: 'r' }, fmt(l.price)),
                el('td', { class: 'r ' + (l.pl > 0 ? 'gain' : l.pl < 0 ? 'loss' : '') }, `${l.pl > 0 ? '+' : ''}${fmt(l.pl)} (${l.rate > 0 ? '+' : ''}${l.rate.toFixed(2)}%)`),
                el('td', { title: l.maturity || '' }, short(l.maturity)));
            body.append(tr);
        }
    }
    function statusClass(s) { return s === '감시중' ? 'on' : s === '중지' || s === '만료' ? 'off' : ACTIVE.includes(s) ? 'busy' : s === '체결완료' ? 'done' : 'bad'; }
    function methodText(w) { return w.upperLimit ? '상한가 지정가' : `+${w.ticks}틱` + (w.fix ? ` · 정정(한도 ${w.chasePct}%)` : ' · 정정 안 함') + (w.cancelPending ? ' · 미체결 취소' : '') + (w.allLots ? ' · 전체 대출일' : ''); }
    function lastText(w) {
        if (w.status === '감시중') {
            if (!state.enabled) return '자동 주문 꺼짐 · 판정 안 함';
            if (!w.lastCheck) return '판정 대기';
            return new Date(w.lastCheck.at + 9 * 3600000).toISOString().slice(11, 19) + ' ' + w.lastCheck.text;
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
                el('td', { title: `${w.name} ${w.code}` }, el('span', { class: 'namecell' }, el('span', { class: 'nm' }, el('span', { class: 'name' }, w.name), el('span', { class: 'code' }, w.code)), badges(w.nxt))),
                el('td', { title: w.loanDt }, short(w.loanDt), acctTag(w)), el('td', { class: 'r' }, w.qtyMode === 'pct' ? w.qtyValue + '%' : w.qtyValue + '주'),
                el('td', { class: 'r' }, fmt(w.trigger)), el('td', { class: 'wrap', title: methodText(w) }, methodText(w)), el('td', { title: '~' + w.until }, '~' + short(w.until)),
                el('td', { class: 'wrap ' + (['실패', '확인 필요', '부분체결'].includes(w.status) ? 'loss' : 'muted') }, lastText(w)), el('td', {}, buttons)));
        }
    }

    // ---- 설정란 ----
    function currentLot() { const w = state?.watches.find(x => x.id === selectedWatch); return state?.lots.find(l => l.key === (w ? w.lotKey : selectedLot)) || (w ? { key: w.lotKey, code: w.code, name: w.name, loanDt: w.loanDt, maturity: w.maturity, nxt: w.nxt, acct: w.acct, account: w.account, able: 0 } : null); }
    function fillLotInfo(lot) {
        const name = $('fName'); name.textContent = '';
        if (!lot) { name.textContent = '-'; $('fLot').textContent = '-'; $('fAcct').textContent = '-'; return; }
        name.append(lot.name, ' ', el('span', { class: 'code' }, lot.code), badges(lot.nxt), el('span', { class: 'dae' }, '대주'));
        $('fLot').textContent = `${lot.loanDt} · 가능수량 ${fmt(lot.able)}주 · 만기 ${lot.maturity || '-'}`;
        $('fAcct').textContent = lot.account || state?.account || '-'; // 계좌는 대출일 아래 따로(2026-11-23)
    }
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
        const v = fmt(lot.upper ? Math.min(lot.upper, tickUp(lot.price)) : tickUp(lot.price)); $('trigger').placeholder = '현재 ' + fmt(lot.price);
        if ($('trigger').value !== v) { $('trigger').value = v; updateForm(); }
    }
    function pickLot(key) {
        selectedLot = key; selectedWatch = '';
        const lot = currentLot();
        fillLotInfo(lot);
        // 감시가 기본값(2026-11-23): 업틱룰처럼 현재가 바로 위 한 호가를 넣어 두어 고치지 않고도 바로 조건 추가를 할 수 있다.
        // 칸을 직접 고치거나 화살표를 쓰기 전까지(triggerAuto)는 현재가가 바뀌면 따라간다. 칸을 비우면 회색 "현재 ○○"만 보인다
        $('trigger').value = ''; $('trigger').placeholder = lot?.price ? '현재 ' + fmt(lot.price) : ''; triggerAuto = true; autoTrigger();
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
        $('trigger').value = fmt(w.trigger); $('ticks').value = w.ticks; $('upperLimit').checked = w.upperLimit; $('fix').checked = w.fix; $('chasePct').value = w.chasePct;
        document.querySelector(`input[name="qtyMode"][value="${w.qtyMode}"]`).checked = true;
        if (w.qtyMode === 'pct') $('qtyPct').value = w.qtyValue; else $('qtyShares').value = w.qtyValue;
        $('allLots').checked = w.allLots; $('cancelPending').checked = w.cancelPending; $('until').value = w.until; $('calNote').hidden = true;
        $('formMode').textContent = `감시 건 수정 (${w.status})`;
        renderAll(); updateForm();
    }
    function formValue() {
        const mode = document.querySelector('input[name="qtyMode"]:checked').value;
        return { trigger: num($('trigger').value), ticks: +$('ticks').value, upperLimit: $('upperLimit').checked, fix: $('fix').checked, chasePct: +$('chasePct').value,
            qtyMode: mode, qtyValue: mode === 'pct' ? +$('qtyPct').value : num($('qtyShares').value),
            allLots: $('allLots').checked, cancelPending: $('cancelPending').checked, until: $('until').value };
    }
    function updateForm() {
        const v = formValue(), lot = currentLot();
        $('chasePct').disabled = !v.fix || v.upperLimit; $('fix').disabled = v.upperLimit;
        $('qtyPct').disabled = v.qtyMode !== 'pct'; $('qtyShares').disabled = v.qtyMode !== 'shares';
        // 감시가 범위(2026-11-23): 그날 하한가 ~ 상한가. 넘으면 조건 추가를 끄고 이유를 추격 한도 자리에 보인다
        const up = lot?.upper || 0, low = lot?.lower || 0;
        const range = !v.trigger ? '' : up && v.trigger > up ? `감시가가 상한가 ${fmt(up)}보다 높습니다` : low && v.trigger < low ? `감시가가 하한가 ${fmt(low)}보다 낮습니다` : '';
        const cap = v.trigger ? floorTick(v.trigger * (1 + v.chasePct / 100)) : 0; // 고른 %를 감시가에 더한 가격, 상한가를 넘으면 상한가(서버 주문도 같음)
        $('chaseNote').textContent = range || (!v.fix || v.upperLimit ? (v.upperLimit ? '상한가 주문' : '정정 안 함') : !cap ? '-원' : up && cap >= up ? `${fmt(up)}원(상한가)` : `${fmt(cap)}원`);
        $('chaseNote').classList.toggle('warn', !!range);
        const w = state?.watches.find(x => x.id === selectedWatch);
        const ok = !!lot && v.trigger > 0 && !range && (v.qtyMode === 'pct' || v.qtyValue >= 1) && !busy;
        $('addBtn').disabled = !ok || !!w; $('editBtn').disabled = !ok || !w || ACTIVE.includes(w.status) || ['체결완료', '부분체결', '잔고없음'].includes(w.status);
        $('fromDay').textContent = kstDay(serverNow()) + ' ~';
        // 화살표: 상한가에 닿으면 ↑, 하한가(없으면 1원)에 닿으면 ↓를 더 누를 수 없다
        const base = v.trigger || lot?.price || 0, floor = Math.max(1, low);
        $('trigUp').disabled = !lot || !base || (up > 0 && base >= up);
        $('trigDown').disabled = !lot || !base || (v.trigger ? v.trigger <= floor : floorTick(base) < floor);
    }
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
    $('trigUp').addEventListener('click', () => stepTrigger(1));
    $('trigDown').addEventListener('click', () => stepTrigger(-1));
    $('trigger').addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stepTrigger(e.key === 'ArrowUp' ? 1 : -1); } });
    for (const id of ['trigger', 'ticks', 'upperLimit', 'fix', 'chasePct', 'qtyPct', 'qtyShares', 'allLots', 'cancelPending']) { $(id).addEventListener('input', updateForm); $(id).addEventListener('change', updateForm); }
    for (const r of document.querySelectorAll('input[name="qtyMode"]')) r.addEventListener('change', updateForm);
    $('trigger').addEventListener('blur', () => { const n = num($('trigger').value); if (n) $('trigger').value = fmt(n); });
    $('qtyShares').addEventListener('blur', () => { const n = num($('qtyShares').value); if (n) $('qtyShares').value = String(n); });
    $('addBtn').addEventListener('click', () => {
        const lot = currentLot(), v = formValue();
        if (lot.price && lot.price >= v.trigger && !confirm(`현재가 ${fmt(lot.price)}이 감시가 ${fmt(v.trigger)} 이상입니다. 등록하면 바로 발동해 대주상환 주문이 나갈 수 있습니다. 계속할까요?`)) return;
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
            $('logSub').textContent = `대출일 ${w.loanDt} · 감시가 ${fmt(w.trigger)} · ${methodText(w)} · ~${w.until} · 상태 ${w.status}`;
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
        ['발동 조건', ['현재가 ≥ 감시가 하나입니다', '09:00~15:20: KRX · NXT 체결 중 어느 쪽이든(주문은 SOR, NXT 비대상은 KRX) · 08:00~08:50 · 15:30~20:00: NXT 체결 · 15:20~15:30: KRX 예상체결가', '오늘 체결이 없는 값으로는 판정하지 않습니다. 등록할 때 이미 조건을 만족하면 확인을 받습니다']],
        ['주문 거래소 (시간대별 자동)', ['08:00~08:50 NXT(NXT 종목만) · 08:50~09:00 보류 · 09:00~15:20 SOR(NXT 비대상은 KRX) · 15:20~15:30 KRX 단일가 · 15:30~20:00 NXT(NXT 종목만)', 'SOR: 키움이 KRX · NXT 중 유리한 곳으로 보냅니다. 2026-11-20 실계좌로 대주상환 접수 · 취소 · 체결을 확인했습니다(SOR 정정은 아직 실제로 해 보지 않음)', '정규장 마감 뒤 남은 수량은 NXT 종목이면 NXT로 다시 냅니다', '수능일 같은 특수 시간표는 아직 반영하지 않습니다']],
        ['주문 가격 · 수량', ['발동 체결가 + 틱(+1~+10, 기본 +10) 지정가, 상한가를 넘으면 상한가', '상한가 선택칸: 처음부터 상한가로 내고 정정하지 않습니다', '수량: 가능수량의 10~100%(기본 100%) 또는 주 수. 드롭다운은 큰 값이 위']],
        ['미체결 정정 (기본 켜짐)', ['3초 간격 최대 3회: 1회 그때 매도1호가 + 틱, 2회 매도1호가 + 틱 × 2, 3회 추격 한도 가격', '추격 한도: 발동가 대비 1~10%(기본 10%). 처음 주문과 모든 정정가는 한도 · 상한가를 넘지 않습니다', '끄면 정정하지 않고 미체결을 알리기만 합니다. 3회 뒤에도 남으면 한도 가격 주문을 둡니다']],
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
        ['화면', ['창 크기는 고정(메인 화면 버튼으로 1200×660). 잔고 · 감시 건이 늘면 각 칸 안에서만 스크롤되고, 열 너비도 고정입니다', '안내 문구(주황)와 전체 중지 띠(빨강)는 맨 위 띠 아래에 겹쳐 뜨고 "확인"을 눌러야 닫힙니다. 아래 칸을 밀지 않습니다', '감시 체크박스: 켜면 감시, 끄면 중지(실시간 등록도 해지) · 전체 감시 체크박스', '판정 · 결과: 감시 중이면 마지막 판정 시세, 주의가 필요하면 그 이유, 끝났으면 한 줄 결과 · 기록: 처리 과정 전체']],
        ['아직 시험하지 않은 것', ['SOR 체결 · 정정 주문 · 15:20~15:30 단일가 접수 · 애프터마켓 체결(2026-11-20 예약 시험), 여러 대출일 동시 상환, VI 중 접수, ETF · ETN 호가단위, 대주 우선으로 VI 등록을 해지하는 경우']]
    ];
    // 항목: [제목, 목록] 또는 [제목, 목록, 표(첫 줄이 머리글), 표 아래 목록]
    function renderPolicy() {
        const b = $('policyBody'); b.textContent = '';
        for (const [title, lines, table, after] of POLICY) {
            b.append(el('h3', {}, title), el('ul', {}, lines.map(t => el('li', {}, t))));
            if (table) b.append(el('table', {}, el('thead', {}, el('tr', {}, table[0].map(t => el('th', { scope: 'col' }, t)))), el('tbody', {}, table.slice(1).map(r => el('tr', {}, r.map((t, i) => el(i ? 'td' : 'th', i ? {} : { scope: 'row' }, t)))))));
            if (after) b.append(el('ul', {}, after.map(t => el('li', {}, t))));
        }
    }
    $('policyBtn').addEventListener('click', () => { renderPolicy(); $('policyModal').hidden = false; $('policyModal').querySelector('[data-close]').focus(); });
    for (const m of document.querySelectorAll('.modal')) {
        m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; });
        m.addEventListener('keydown', e => { if (e.key === 'Escape') m.hidden = true; });
    }

    // ---- 설명 풍선: i에 마우스를 올리거나 키보드로 고르면 화면 맨 위에 띄운다(칸 경계에 잘리지 않음) ----
    const floatTip = el('div', { id: 'floatTip', role: 'tooltip' }); document.body.append(floatTip);
    function showTip(tip) {
        const box = tip.querySelector('.tipbox'), btn = tip.querySelector('.i'); if (!box || !btn) return;
        floatTip.innerHTML = box.innerHTML; floatTip.className = box.classList.contains('wide') ? 'wide' : ''; floatTip.style.display = 'block';
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
    // 독립창 앱: 메인 화면의 확대 · 축소 배율을 따라간다(VI 창과 같음). 메인 화면이 바꾼 배율을 5초마다 확인한다
    let scaleAt = 0;
    async function followScale() {
        if (!native || !token || Date.now() - scaleAt < 5000) return; scaleAt = Date.now();
        try {
            const r = await fetch('/api/short-stoploss/window-info', { headers: auth() }); if (!r.ok) return;
            const ratio = Number((await r.json()).scale) / devicePixelRatio;
            if (Number.isFinite(ratio) && ratio >= 0.25 && ratio <= 4 && Math.abs(ratio - 1) > 0.02) native.postMessage('page-scale:' + ratio);
        } catch {}
    }
    setInterval(() => { $('clock').textContent = new Date(serverNow() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' '); }, 500);
    let timer;
    async function loop() { clearTimeout(timer); try { await poll(); } catch (error) { say(error.message); } timer = setTimeout(loop, document.hidden ? 10000 : 2000); }
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
    resizable($('lotsTable'), 'short-stoploss-cols-lots'); resizable($('watchTable'), 'short-stoploss-cols-watch');
    autoUntil(); loadCalendar(); loop();
})();
