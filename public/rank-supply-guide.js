(() => {
    'use strict';
    const editStorageKey = 'rankChartGuideEditsV1', maxText = 20000, entries = new Map();
    function validEdits(value) {
        const result = Object.create(null);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
        for (const [key, text] of Object.entries(value).slice(0, 64)) {
            if (/^[A-Za-z][A-Za-z0-9:_-]{0,199}$/.test(key) && typeof text === 'string' && text.length <= maxText && text.trim()) result[key] = text;
        }
        return result;
    }
    let edits = Object.create(null), editor;
    try { edits = validEdits(JSON.parse(localStorage.getItem(editStorageKey))); } catch {}
    function plainText(element) {
        const copy = element.cloneNode(true);
        copy.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
        copy.querySelectorAll('td,th').forEach(node => node.append('\t'));
        copy.querySelectorAll('h1,h2,h3,h4,h5,p,dt,dd,li,tr,div').forEach(node => node.append('\n'));
        return copy.textContent.replace(/\n{3,}/g, '\n\n').trim();
    }
    function renderEdit(entry) {
        const text = edits[entry.key];
        if (typeof text === 'string') {
            const p = document.createElement('p'); p.className = 'chart-guide-custom-text'; p.textContent = text;
            entry.target.replaceChildren(p);
        } else entry.target.replaceChildren(...entry.original.map(node => node.cloneNode(true)));
    }
    function applyEdits(value) {
        edits = validEdits(value);
        try { localStorage.setItem(editStorageKey, JSON.stringify(edits)); } catch {}
        entries.forEach(renderEdit);
    }
    function createEditor() {
        const dialog = document.createElement('dialog'); dialog.className = 'chart-guide-editor';
        dialog.setAttribute('aria-labelledby', 'chartGuideEditorTitle');
        dialog.innerHTML = '<form><h2 id="chartGuideEditorTitle">설명 편집</h2><p class="chart-guide-editor-context"></p><label for="chartGuideEditorText">설명 내용</label><textarea id="chartGuideEditorText" maxlength="20000" spellcheck="false" required></textarea><p class="chart-guide-editor-hint">현재 선택한 탭의 설명만 수정합니다. 내용은 일반 텍스트로 저장됩니다.</p><p role="status"></p><div class="chart-guide-editor-actions"><button type="button" data-reset>기본 설명 불러오기</button><span></span><button type="button" data-cancel>취소</button><button type="submit">저장</button></div></form>';
        document.body.append(dialog);
        const input = dialog.querySelector('textarea'), status = dialog.querySelector('[role=status]');
        let active;
        function restoreFocus() { const button = active?.button, onClose = active?.onClose; active = null; button?.focus(); onClose?.(); }
        function close() { dialog.close(); restoreFocus(); }
        dialog.querySelector('[data-reset]').addEventListener('click', () => { input.value = active.entry.defaultText; status.textContent = '저장을 누르면 기본 설명으로 복원됩니다.'; input.focus(); });
        dialog.querySelector('[data-cancel]').addEventListener('click', close);
        dialog.addEventListener('close', () => { if (!dialog.open) restoreFocus(); });
        dialog.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            const text = input.value.trim();
            if (!text) { status.textContent = '설명 내용을 입력하세요.'; input.focus(); return; }
            if (text.length > maxText) { status.textContent = '설명은 20,000자까지 저장할 수 있습니다.'; input.focus(); return; }
            const next = { ...edits };
            if (text === active.entry.defaultText.trim()) delete next[active.entry.key]; else next[active.entry.key] = text;
            try { localStorage.setItem(editStorageKey, JSON.stringify(next)); }
            catch { status.textContent = '설명을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.'; return; }
            edits = validEdits(next); renderEdit(active.entry);
            if (typeof saveAppData === 'function') {
                try { Promise.resolve(saveAppData()).catch(() => {}); } catch {}
            }
            close();
        });
        return { open(entry, button, onClose) {
            if (dialog.open) return;
            active = { entry, button, onClose }; dialog.querySelector('.chart-guide-editor-context').textContent = entry.label;
            input.value = edits[entry.key] ?? entry.defaultText; status.textContent = '';
            dialog.showModal(); input.focus(); input.setSelectionRange(0, 0);
        } };
    }
    function makeEditable(button, guide, beforeOpen = () => {}) {
        if (button.dataset.guideEditable) return;
        button.dataset.guideEditable = 'true'; button.title = '마우스 오버: 설명 보기 · 더블클릭 또는 F2: 설명 편집'; button.setAttribute('aria-keyshortcuts', 'F2');
        const targets = [...guide.querySelectorAll('[role=tabpanel]')];
        let doubleClickTarget;
        button.addEventListener('mousedown', event => {
            if (event.detail === 1) doubleClickTarget = guide.classList.contains('is-visible') ? targets.find(node => !node.hidden) || guide : null;
        });
        for (const target of targets.length ? targets : [guide]) {
            const key = target.id || `${guide.id}Content`;
            const label = document.getElementById(target.getAttribute('aria-labelledby'))?.textContent;
            const entry = { key, target, original: [...target.childNodes].map(node => node.cloneNode(true)), defaultText: plainText(target),
                label: `${button.closest('.panel')?.querySelector('h2')?.textContent || '차트'}${label ? ' · ' + label : ''}` };
            entries.set(key, entry); if (Object.hasOwn(edits, key)) renderEdit(entry);
        }
        function open(event) {
            event.preventDefault(); event.stopPropagation();
            const target = event.type === 'dblclick' && doubleClickTarget || targets.find(node => !node.hidden) || guide, key = target.id || `${guide.id}Content`;
            doubleClickTarget = null;
            const reopen = () => {
                beforeOpen();
                if (target !== guide && target.hidden) [...guide.querySelectorAll('[role=tab]')].find(tab => tab.getAttribute('aria-controls') === target.id)?.click();
            };
            reopen();
            if (!editor) editor = createEditor();
            editor.open(entries.get(key), button, reopen);
        }
        button.addEventListener('dblclick', open);
        button.addEventListener('keydown', event => { if (event.key === 'F2') open(event); });
    }
    const people = ['개인', '외국인', '기관'];
    const rows = (labels, transport, source) => labels.map(label => ({ label, transport, source }));
    function description(kind, broker, mode) {
        const minute = mode === 'minute';
        if (kind === 'concentration' && broker === 'ls') return {
            sources:[...rows(['종목 거래대금'],minute?'웹소켓 우선 · REST 보완':'REST API',minute?'LS US3 · t8452':'LS t8451'),...rows(['시장 거래대금'],minute?'웹소켓 우선 · REST 보완':'REST API',minute?'LS IJ_ · t8409':'LS t8429')],
            unit:'쏠림율 = 선택 종목 거래대금 ÷ 소속 시장 거래대금 ×100. 단위는 %이며 순매수 비율이 아닙니다.',
            note:minute?'웹소켓 누적 거래대금의 연속된 분간 차이로 1분 금액을 구합니다. 수신 단절 구간에 차액을 몰아넣지 않으며 REST의 분별 거래대금으로 보완합니다.':'종목·업종의 일별 보고 거래대금을 사용합니다.',
            candles:'키움증권 · 선택 종목의 일봉 ka10081, 분봉 ka10080을 공유합니다. LS 카드도 가격 캔들은 키움입니다.',
            extra:'종목은 LS 통합시장, 시장은 LS 업종지수 기준입니다. 업종의 KRX+NXT 통합 범위는 미확인으로 두며, 분모가 없거나 0인 구간은 비율을 만들지 않습니다.',
            comparison:'키움 분봉은 추정 거래대금, 한투·LS는 보고 거래대금을 사용하므로 집계 범위·시각과 계산 방식 차이를 확인하세요.' };
        if (kind === 'turnover' && broker !== 'kiwoom') return {
            sources:rows(['KOSPI','KOSDAQ'],minute?'웹소켓 우선 · REST 보완':'REST API',broker==='ls'?(minute?'LS IJ_ · t8409':'LS t8429'):(minute?'한투 H0UPCNT0 · FHKUP03500200':'한투 FHKUP03500100')),
            unit:minute?'표시 단위는 조원이며, 각 분에 관측한 당일 누적 거래대금입니다. 순매수대금이 아닙니다.':'표시 단위는 조원이며, 각 거래일의 보고 거래대금입니다.',
            note:minute?'웹소켓 누적값을 분당 마지막 값으로 저장하고 완료된 분부터 표시합니다. 과거·미수신 구간은 같은 증권사의 REST 자료로 보완하며, 복원할 수 없는 값은 결측으로 남깁니다.':'같은 증권사의 시장 일별 거래대금을 사용합니다. 키움 거래대금으로 빈 값을 대체하지 않습니다.',
            candles:'키움증권 · 선택 시장 현물지수 일봉 ka20006, 분봉 ka20005를 공유합니다.',
            extra:'시장 업종지수의 거래대금입니다. KRX+NXT 통합 집계 여부는 별도 확인이 필요합니다.',
            comparison:'기존 키움 분봉 거래대금은 지수×거래량 기반 추정치이므로, 보고 거래대금을 쓰는 한투·LS와 다를 수 있습니다.' };
        if (kind === 'concentration') {
            const kis = broker === 'kis';
            return { sources: kis
                ? [...rows(['종목 거래대금'], 'REST API', minute ? '한투 FHKST03010230 · 통합 종목' : '한투 FHKST03010100 · 통합 종목'), ...rows(['시장 거래대금'], 'REST API', minute ? '한투 FHKUP03500200 · 업종지수' : '한투 FHKUP03500100 · 업종지수')]
                : [...rows(['종목 거래대금'], 'REST API', minute ? '키움 ka10080 · 통합 종목(_AL)' : '키움 ka10081 · 통합 종목(_AL)'), ...rows(['시장 거래대금'], 'REST API', minute ? '키움 ka20005 · 업종지수' : '키움 ka20006 · 업종지수')],
                unit: '쏠림율 = 선택 종목 거래대금 ÷ 해당 종목이 속한 시장의 거래대금 × 100. 표시 단위는 %입니다. 개인·기관·외국인 수급이나 순매수 비율이 아닙니다.',
                note: kis
                    ? minute ? '종목과 시장의 누적 거래대금을 각각 직전 1분 값과 차감해 해당 1분의 금액을 구합니다. 종목은 원, 업종은 백만원이므로 단위를 원으로 맞춰 계산합니다. 시장 분봉은 서버에서 분당 수집하며 누락된 분에 차액을 임의로 나누지 않습니다.' : '종목·업종 API가 보고한 일별 거래대금을 같은 원 단위로 환산해 계산합니다. 거래대금은 한투 REST 자료입니다.'
                    : minute ? '키움 분봉의 종가 × 거래량을 종목 거래대금 추정치로 사용합니다. 시장은 지수값을 100으로 나누고 거래량을 10,000배 한 뒤 곱한 추정치입니다. 실제 체결별 거래대금을 합산한 값과 다를 수 있습니다.' : '키움 일봉의 보고 거래대금(trde_prica)을 사용합니다. 원본 백만원을 원으로 맞춰 계산하며, 종가 × 거래량으로 추정하지 않습니다.',
                candles: '키움증권 · 선택 종목의 가격 캔들입니다. 일봉 ka10081, 1분봉 ka10080, 통합 종목코드(_AL)를 사용합니다. 쏠림율(한투)도 가격 캔들은 키움 자료를 공유합니다.',
                extra: minute ? '당일 누적 비중이 아니라 해당 1분의 거래대금 비중입니다. 종목과 지수의 시간대·제공 범위가 달라 분모가 없거나 0이면 비율을 만들지 않습니다. 가격 캔들이 있어도 쏠림율 선은 결측일 수 있습니다.' : '선택 종목이 코스피 소속이면 코스피, 코스닥 소속이면 코스닥을 분모로 사용합니다. 큰 값은 거래 집중도를 뜻하며 매수 우위를 뜻하지 않습니다.',
                comparison: '키움 분봉은 가격·거래량 기반 추정, 한투 분봉은 보고 누적 거래대금의 차분이므로 두 카드가 항상 같은 값을 보이지는 않습니다. 원천 갱신 시각과 시장 범위도 함께 확인하세요.' };
        }
        if (kind === 'turnover') return {
            sources: rows(['KOSPI', 'KOSDAQ'], 'REST API', minute ? '키움 ka20005 · 시장 지수 1분봉' : '키움 ka20006 · 시장 지수 일봉'),
            unit: minute ? '표시 단위는 조원입니다. 시장의 당일 누적 거래대금 추정치이며 순매수대금이나 거래 수량이 아닙니다.' : '표시 단위는 조원입니다. 각 거래일의 전체 거래대금이며 순매수대금이 아닙니다.',
            note: minute ? '시장 지수 종가(원본 ÷100) × 해당 분 거래량(원본 ×10,000)으로 분별 금액을 추정한 뒤 그날의 값들을 누적합니다. 실제 보고 거래대금과 다를 수 있으며 웹소켓 수신값이 아닙니다.' : '키움 일봉이 보고한 거래대금(trde_prica, 백만원)을 원으로 환산해 사용합니다. 종가 × 거래량 추정값이 아닙니다.',
            candles: '키움증권 · 선택한 코스피/코스닥 현물지수입니다. 일봉 ka20006, 분봉 ka20005로, 거래대금 계산에 쓰는 지수 가격과 같은 원천입니다.',
            extra: minute ? '주황색 전일 기준선은 선택 시장의 전 거래일 일봉 거래대금입니다. 오늘 누적 추정치와 전일 하루 전체 금액을 비교하는 선이며 전일 같은 시각 값은 아닙니다.' : '두 시장의 거래 규모를 비교합니다. 매수와 매도가 맞물린 전체 거래 금액이므로, 금액 증가만으로 순매수 증가를 판단할 수 없습니다.',
            comparison: '화면의 자동 새로고침 때 REST로 조회하며 서버 응답은 1분 캐시를 사용합니다. 작은 값이나 결측을 다른 시장의 값으로 대체하지 않습니다.' };
        if (kind === 'breadth') return {
            sources: [...rows(['신고가 종목 수'], 'REST API', '키움 ka10016 · 신고가 목록'), ...rows(['신저가 종목 수'], 'REST API', '키움 ka10016 · 신저가 목록')],
            unit: '단위는 종목 수(개)입니다. 선택 시장에서 기준을 충족한 종목을 중복 제거해 센 값입니다. 신저가는 비교를 위해 차트 아래쪽(음수 방향)에 그리지만 실제 종목 수는 양수입니다. 주식 수량·거래대금·순매수금액이 아닙니다.',
            note: '키움의 250일 기간·고저가 기준·KRX+NXT 통합 조건으로 코스피와 코스닥 목록을 각각 조회합니다. 카드의 52주 표기는 이 250거래일 조건을 뜻하며 정확히 365일을 세는 방식은 아닙니다. 웹소켓을 사용하지 않습니다.',
            candles: '키움증권 · 선택 시장의 코스피/코스닥 현물지수입니다. 일봉 ka20006, 분봉 ka20005를 사용합니다. KOSPI+KOSDAQ 합계 선택 시에도 캔들은 KOSPI입니다. 종목 수의 가격이 아니라 시장 지수 흐름을 함께 보는 캔들입니다.',
            extra: minute ? '공통 개장 확인 후 서버가 분당 한 번 목록을 조회해 그 시점의 종목 수를 저장합니다. 각 분에 새로 발생한 종목 수를 더한 값이 아니므로 감소할 수도 있습니다. 수집 이전의 분봉은 소급 생성하지 않습니다.' : '서버가 보관한 날짜별 최종 집계를 표시합니다. 과거에는 출처·시장 범위가 다른 기록이 포함될 수 있으며 해당 구간 안내를 따릅니다. 통합 합계를 코스피·코스닥으로 임의 분할하지 않습니다.',
            comparison: '신고가가 많을수록 상승 참여 폭, 신저가가 많을수록 하락 압력이 넓다는 참고 지표입니다. 목록 집계 완료와 원천 갱신에 시간이 걸릴 수 있으며 미수집은 실제 0과 구별합니다.' };
        if (kind === 'stock') {
            let sources, note;
            if (broker === 'kiwoom') {
                sources = [...rows(people, 'REST API', '키움 ka10060'), ...rows(['프로그램'], 'REST API', minute ? '키움 ka90008' : '키움 ka90013')];
                note = minute ? '개인·외국인·기관은 REST를 1분마다 조회한 당일 누적값입니다. 프로그램도 REST 조회이며 웹소켓을 사용하지 않습니다.' : '각 거래일의 순매수수량입니다. 투자자와 프로그램 모두 키움 REST 자료입니다.';
            } else if (broker === 'kis') {
                sources = minute
                    ? [{ label: '개인', transport: '미제공', source: '한투 장중 추정 API에 개인 항목 없음' }, ...rows(['외국인', '기관'], 'REST API', '한투 HHPTJ04160200 · 비정기 가집계'), ...rows(['프로그램'], '웹소켓', '한투 H0UNPGM0 · KRX+NXT 통합')]
                    : [...rows(people, 'REST API', '한투 FHPTJ04160001 · KRX · 날짜별 과거 조회'), ...rows(['프로그램'], 'REST API', '한투 FHPPG04650201 · KRX+NXT 통합')];
                note = minute ? '외국인·기관은 직원 가집계로 비정기 갱신됩니다. 1분마다 조회해도 같은 값이 반복될 수 있습니다. 프로그램은 계속 수신한 값 중 분당 마지막 누적값을 사용합니다.' : '투자자는 KRX, 프로그램은 통합시장 자료이므로 범위가 다릅니다. 당일 투자자 값은 장중 일봉에 넣지 않으며, 날짜를 지정해 과거 페이지를 추가 조회합니다.';
            } else {
                sources = [...rows(people, 'REST API', 'LS t1717 · KRX+NXT 통합 추정치'), ...rows(['프로그램'], minute ? '웹소켓' : 'REST API', minute ? 'LS UPH · KRX+NXT 통합' : 'LS t1637 · KRX+NXT 통합')];
                note = minute ? '투자자는 실시간 정보가 아닌 REST 추정치입니다. 1분마다 관측하며 원천 갱신이 느리면 값이 반복됩니다. 프로그램은 계속 수신한 값 중 분당 마지막 누적값을 사용합니다.' : '각 거래일의 순매수수량입니다. 개인·외국인·기관은 LS의 투자자 추정 자료입니다.';
            }
            return { sources, unit: '네 항목 모두 순매수수량입니다. 기본 단위는 주, 절댓값 1,000주 이상은 천주로 표시하며 천주 미만 자릿수는 버립니다. 매수대금이 아닙니다.', note,
                candles: '키움증권 · 선택 종목의 가격 캔들입니다. 일봉 ka10081, 분봉 ka10080을 사용하며 통합 종목코드(_AL)로 조회합니다. 한투·LS 카드의 캔들도 키움 자료입니다.',
                extra: minute ? '프로그램은 당일 누적값이며 분간 증감량이 아닙니다. 한투·LS 프로그램은 완료된 분부터 표시합니다. 투자자는 REST 관측 시각 기준이며, 장 마감 뒤에는 최종 관측값을 이어 표시할 수 있습니다.' : '같은 종목·같은 날짜라도 투자자 추정치, 거래소 범위와 집계 시점에 따라 증권사 간 값이 다를 수 있습니다.' };
        }
        let sources, note;
        if (broker === 'kiwoom') {
            sources = [...rows(people, 'REST API', '키움 ka10051 · KRX+NXT 통합'), ...rows(['프로그램'], 'REST API', minute ? '키움 ka90005 · KRX+NXT 통합' : '키움 ka90010 · KRX+NXT 통합')];
            sources.push(...rows(['KOSPI선물·KOSDAQ선물 개인·외국인·기관'], 'REST API', minute?'한투 FHPTJ04030000 · 선물 프로그램 미제공':'LS t8462 · 주간(D) 일별 금액 · 선물 프로그램 미제공'));
            note = minute ? '분당 한 번 조회합니다. 투자자는 관측 시각의 당일 누적값을 쌓고, 프로그램은 API가 제공하는 원천 분 시각을 사용합니다. 현재 분은 완료 후 표시합니다.' : '기준일의 종합 업종 행과 일자별 프로그램 자료를 사용합니다. 현물은 키움, KOSPI200·KOSDAQ150 선물은 LS t8462 주간(D) 일별 순매수대금입니다. 야간은 합산하지 않으며 선물 프로그램은 미제공입니다.';
        } else if (broker === 'ls' && minute) {
            sources = [...rows(people, '웹소켓', 'LS 현물 UBT(U001/U301) · 선물 BMT(900/901)'), ...rows(['프로그램'], '웹소켓', 'LS UPM(U0/U1) · 현물만 제공')];
            note = '계속 수신한 값 중 원천 시각 기준 분당 마지막 누적값을 사용합니다. 현물 투자자는 통합시장입니다. 프로그램은 추가 검증 안내를 유지하며, 선물 BMT의 대상·단위·누적 여부는 별도 검증 상태를 따릅니다. 선물 프로그램은 미제공입니다.';
        } else if (broker === 'ls') {
            sources = [...rows(people,'REST API','현물: LS t1665 · KRX+NXT 통합 / 선물: LS t8462 · 주간(D)'),...rows(['프로그램'],'REST API','현물: LS t1633 · KRX+NXT 통합 / 선물: 미제공')];
            note = 'LS 일별 순매수대금입니다. 투자자는 수치·일별 금액(sa_08/sa_17/sa_18), 프로그램은 금액·수치·일별 전체순매수(tot3)를 사용합니다. 선물은 t8462 주간(D) 일별 순매수대금이며 야간은 합산하지 않습니다. 선물 프로그램은 미제공입니다. LS 미제공 날짜는 결측이며 다른 증권사로 대체하지 않습니다.';
        } else {
            sources = [...rows(people, 'REST API', minute ? '한투 FHPTJ04030000' : '한투 FHPTJ04040000'), ...rows(['프로그램'], 'REST API', minute ? '한투 FHPPG04600101 · 통합' : '한투 FHPPG04600001 · 통합')];
            note = `${minute ? '분당 한 번 조회합니다. 투자자는 원천 시각이 없어 REST 관측 시각을 기록하고, 프로그램은 API의 원천 시각을 사용합니다. 선물 프로그램은 미제공입니다.' : '각 거래일의 순매수대금입니다. 일봉은 코스피·코스닥 현물만 제공합니다.'} 투자자의 KRX+NXT 통합 집계 여부는 미확인이고, 프로그램은 통합시장 자료입니다.`;
        }
        return { sources, unit: `현물 네 항목은 모두 순매수대금이며 화면 단위는 억원입니다. 수량(주·계약)이 아닙니다. 내부 백만원 값을 100으로 나눠 표시합니다.${broker === 'ls' && minute ? ' LS 현물 투자자 원본 억원은 저장 시 백만원으로 환산합니다. 선물의 대상·단위는 별도 검증 안내를 확인하세요.' : ''}`, note,
            candles: '키움증권 · 코스피/코스닥 현물지수 캔들입니다. 일봉 ka20006, 분봉 ka20005를 사용합니다. 한투·LS 카드도 같은 키움 가격 원천을 공유합니다. 선물을 선택해도 아래 캔들은 해당 코스피/코스닥 현물지수이며 선물 가격이 아닙니다.',
            extra: minute ? '당일 누적 순매수대금이며 1분 동안 새로 매수한 금액이 아닙니다. 투자자 관측 이력은 수집한 시점부터 쌓이며, 프로그램 과거 보완 여부는 각 원천의 제공 범위를 따릅니다.' : '가격과 수급의 제공 기간이 다르면 일부 날짜는 수급이 미제공일 수 있습니다.' };
    }
    function marketScope(kind, broker, mode) {
        if (kind === 'concentration') return '종목: KRX+NXT 통합 / 시장 분모: 업종지수 기준, KRX+NXT 통합 집계 여부 미확인';
        if (kind === 'turnover') return 'KOSPI·KOSDAQ 업종지수 기준 / KRX+NXT 통합 집계 여부 미확인';
        if (kind === 'breadth') return '현재 목록 조회: KRX+NXT 통합(stex_tp=3) / 과거 저장 자료는 해당 구간의 출처·시장 범위 안내 확인';
        if (kind === 'stock') {
            if (broker === 'kis') return mode === 'minute'
                ? '외국인·기관 가집계: KRX / 개인: 미제공 / 프로그램: KRX+NXT 통합'
                : '개인·외국인·기관: KRX / 프로그램: KRX+NXT 통합';
            return broker === 'ls' ? '투자자 추정치·프로그램: KRX+NXT 통합(exchgubun=U·UPH)' : '투자자·프로그램: KRX+NXT 통합(종목코드 _AL)';
        }
        if (broker === 'kiwoom') return mode === 'minute' ? '현물: 키움 KRX+NXT 통합(stex_tp=3) / 선물: 한투 별도 파생시장 · 프로그램 미제공' : '현물: 키움 KRX+NXT 통합(stex_tp=3) / 선물: LS KRX 주간(D), 야간 제외 · 프로그램 미제공';
        if (broker === 'ls') return mode === 'minute'
            ? '현물 투자자·프로그램: KRX+NXT 통합(UBT·UPM) / 선물 BMT: 별도 파생시장, 대상·단위 검증 안내 확인'
            : '현물 투자자·프로그램: KRX+NXT 통합(exchgubun=U) / 선물 일봉: KRX 주간(D), 야간 제외 · 프로그램 미제공';
        return '현물 투자자: KRX+NXT 통합 여부 미확인 / 현물 프로그램: 통합(UN) / 선물: 별도 파생시장, 프로그램 미제공';
    }
    function attach(panel, kind, broker) {
        if (panel.querySelector('.supply-info-button')) return;
        const id = `${panel.id}Guide`, title = panel.querySelector('h2').textContent;
        panel.classList.add('rank-data-guide-card');
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'chart-info-button supply-info-button'; button.textContent = 'i';
        button.setAttribute('aria-label', `${title} 데이터 안내`); button.setAttribute('aria-controls', id); button.setAttribute('aria-expanded', 'false');
        const guide = document.createElement('section'); guide.id = id; guide.className = 'volatility-guide sentiment-guide supply-data-guide';
        guide.setAttribute('role', 'region'); guide.setAttribute('aria-label', `${title} 데이터 안내`); guide.hidden = true;
        const tabs = document.createElement('div'); tabs.className = 'chart-guide-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '조회 주기별 데이터 안내');
        const contents = [];
        for (const [mode, text] of [['day', '일봉'], ['minute', '1분봉']]) {
            const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = text; tab.dataset.guideMode = mode;
            tab.id = `${id}${mode}Tab`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `${id}${mode}`); tabs.append(tab);
            const content = document.createElement('div'); content.id = `${id}${mode}`; content.setAttribute('role', 'tabpanel'); content.setAttribute('aria-labelledby', tab.id); content.tabIndex = 0;
            const selectedBroker = window.rankIndependentClient && mode === 'minute' ? kind === 'concentration' ? 'ls' : kind === 'stock' ? 'kis' : broker : broker;
            const spec = description(kind, selectedBroker, mode);
            if(kind==='concentration' && mode==='minute')spec.extra += ' 파란 선은 해당 분의 쏠림율, 주황 선은 당일 누적 종목 거래대금 ÷ 당일 누적 시장 거래대금 ×100입니다. 분별 비율의 합계가 아닙니다. 날짜가 바뀌면 누적을 초기화하며, 장 시작 누적 자료를 확보하지 못한 구간은 미제공입니다.';
            if(kind==='concentration' && broker==='ls' && mode==='minute')spec.extra += ' LS 시장 REST의 15:30 마감봉은 사후 집계 금액이 반영될 수 있어 한투의 해당 시각 누적 차분과 값이 다를 수 있습니다. 타사 값으로 보정하지 않습니다.';
            const heading = document.createElement('h3'); heading.textContent = `${title} · ${text}`; content.append(heading);
            const unit = document.createElement('p'); unit.className = 'sentiment-guide-note'; unit.textContent = spec.unit; content.append(unit);
            const summaryTitle = document.createElement('h4'); summaryTitle.textContent = '일봉·분봉 수신 방식'; content.append(summaryTitle);
            const summary = document.createElement('dl'); summary.className = 'supply-source-list chart-transport-summary';
            for (const [period, label] of [['day','일봉'],['minute','1분봉']]) {
                const periodBroker = window.rankIndependentClient && period === 'minute' ? kind === 'concentration' ? 'ls' : kind === 'stock' ? 'kis' : broker : broker;
                const periodSpec = description(kind, periodBroker, period);
                const term = document.createElement('dt'); term.textContent = label;
                const detail = document.createElement('dd');
                detail.textContent = periodSpec.sources.map(source => `${source.label}: ${source.transport} (${source.source})`).join(' / ') + ' · 시장 범위: ' + marketScope(kind, periodBroker, period);
                summary.append(term, detail);
            }
            content.append(summary);
            const detailsTitle = document.createElement('h4'); detailsTitle.textContent = `${text} 항목별 원천`; content.append(detailsTitle);
            const list = document.createElement('dl'); list.className = 'supply-source-list';
            for (const source of spec.sources) {
                const term = document.createElement('dt'); term.textContent = source.label;
                const detail = document.createElement('dd'); detail.textContent = `${source.transport} · ${source.source}`; list.append(term, detail);
            }
            content.append(list);
            for (const [label, text] of [['시장 범위', marketScope(kind, selectedBroker, mode)], ['집계·갱신', spec.note], ['캔들 출처', spec.candles], ['읽는 방법', spec.extra], ['비교 시 참고', spec.comparison || '양수는 순매수, 음수는 순매도입니다. 프로그램은 투자자 구분과 겹칠 수 있으므로 개인·외국인·기관과 더하지 않습니다. 결측·미제공 구간은 실제 0과 구별하며 임의로 채우지 않습니다.']]) {
                const h = document.createElement('h4'), p = document.createElement('p'); h.textContent = label; p.textContent = text; content.append(h, p);
            }
            contents.push(content);
        }
        guide.append(tabs, ...contents); panel.append(button, guide);
        const tabButtons = [...tabs.children];
        function select(mode) { tabButtons.forEach((tab, i) => { const active = tab.dataset.guideMode === mode; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; contents[i].hidden = !active; }); guide.scrollTop = 0; }
        tabButtons.forEach((tab, i) => {
            tab.addEventListener('click', () => select(tab.dataset.guideMode));
            tab.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault(); const next = tabButtons[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (i + 1) % 2]; select(next.dataset.guideMode); next.focus();
            });
        });
        let timer, pinned = false;
        function hide() { clearTimeout(timer); pinned = false; guide.hidden = true; guide.classList.remove('is-visible'); button.setAttribute('aria-expanded', 'false'); }
        function show() {
            clearTimeout(timer);
            if (guide.hidden) {
                const active = panel.querySelector('[data-mode].active,[data-chart-mode].active,[data-breadth-mode].active');
                select((active?.dataset.mode || active?.dataset.chartMode || active?.dataset.breadthMode || panel.dataset.chartMode) === 'minute' ? 'minute' : 'day');
            }
            document.dispatchEvent(new CustomEvent('rank-supply-guide-open', { detail: panel.id }));
            guide.style.top = `${button.getBoundingClientRect().bottom - panel.getBoundingClientRect().top + 8}px`;
            guide.hidden = false; guide.classList.add('is-visible'); button.setAttribute('aria-expanded', 'true');
        }
        function scheduleHide() { clearTimeout(timer); if (!pinned) timer = setTimeout(() => { if (!guide.contains(document.activeElement) && document.activeElement !== button) hide(); }, 150); }
        button.addEventListener('mouseenter', show); button.addEventListener('focus', show);
        button.addEventListener('mouseleave', scheduleHide); button.addEventListener('blur', scheduleHide);
        button.addEventListener('click', () => { if (pinned) hide(); else { pinned = true; show(); } });
        guide.addEventListener('mouseenter', () => clearTimeout(timer)); guide.addEventListener('mouseleave', scheduleHide);
        guide.addEventListener('focusin', () => clearTimeout(timer)); guide.addEventListener('focusout', scheduleHide);
        document.addEventListener('pointerdown', event => { if (!guide.hidden && !guide.contains(event.target) && !button.contains(event.target)) hide(); });
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && !guide.hidden && !document.querySelector('.chart-guide-editor[open]')) { const returnFocus = guide.contains(document.activeElement); hide(); if (returnFocus) { button.focus(); hide(); } } });
        document.addEventListener('rank-supply-guide-open', event => { if (event.detail !== panel.id) hide(); });
        select('day');
        makeEditable(button, guide, () => { pinned = true; show(); });
    }
    window.RankSupplyGuide = { attach, makeEditable, getEdits: () => ({ ...edits }), applyEdits };
})();
