(() => {
    'use strict';
    // Trading tab "데이터 수집 i": which broker, transport and file each table/chart uses.
    // Keep in step with the server services when a source changes (checked 2026-11-07).
    const groups = {
        title: '받는 방식 묶음',
        note: [
            '같은 묶음 이름은 같은 연결 또는 같은 조회에서 받는 데이터입니다. 저장 경로는 서버의 data 폴더 기준입니다.',
            '파일 저장: 서버가 직접 받는 실시간 연결과 정기 조회는 NH 현재가를 빼고 모두 data 아래 폴더에 저장됩니다. 화면 조회는 서버 메모리에만 잠시 보관합니다. 예외는 ADR 분봉(adr-minutes), 선물 주간 LS 조회분(ls-futures-test), 변동성·심리(volatility)입니다. 트레이딩 탭의 표 4개는 저장하지 않고, VI 모니터는 당일 VI 목록과 종목 정보를 vi-monitor에 저장합니다.',
            '로컬 서버에서만: 장운영 알림[실시간-LS1]과 VI 모니터[실시간-키움VI · 실시간-NH · 정기-LS종목정보]는 로컬 서버에서만 켭니다. 오라클은 꺼 두어 화면에 "꺼 두었습니다"로 표시합니다.',
            '※ 표시: 지금은 수집하지 않는 대체 원천입니다(화면에 쓰는 곳이 없어 2026-11-07부터 멈춤). 서버 설정 ALT_SUPPLY_COLLECTION=on으로 켜면 같은 데이터를 수집할 수 있습니다. 대괄호는 그때의 묶음 이름입니다.',
            'LS 종목 수급 TR: t1717은 투자자, t1637은 프로그램입니다.'
        ],
        head: ['묶음', '증권사 · TR', '받는 데이터', '파일 저장'],
        sections: [
            ['실시간 연결 · 연결 하나에 여러 항목이 함께 들어옵니다', [
                ['실시간-LS1', 'LS 웹소켓 1개 · JIF', '장운영 알림(사이드카 · 서킷브레이커) · 로컬 서버에서만', 'market-alerts (당일 경보 · 상태)'],
                ['실시간-키움VI', '키움 웹소켓 1개 · 1h (전체 종목, _NX)', 'VI 모니터의 VI 발동 · 해제(KRX · NXT) · 로컬 서버에서만', 'vi-monitor (당일 VI 목록)'],
                ['실시간-NH', 'NH 웹소켓 1개 · oc, nc, vC (최대 30건)', 'VI 걸린 종목의 KRX · NXT · 주식선물 현재가와 등락률 · 거래대금. 한도를 넘는 종목은 NH 조회(5초) · 로컬 서버에서만', '저장 안 함'],
                ['실시간-한투', '한투 웹소켓 1개 · H0UNPGM0', '등록 종목 프로그램 매매\n※ KOSPI · KOSDAQ 지수 거래대금은 같은 연결의 한투 H0UPCNT0 [실시간-한투] · FHKUP03500200 [정기-한투지수]로도 수집 가능', 'kis-supply (프로그램)']
            ]],
            ['서버 정기 조회 · 화면과 관계없이 장중에 서버가 조회해 저장합니다', [
                ['정기-키움시장', '키움 ka10051, ka90005 · 1분', '현물 시장 투자자 · 프로그램\n※ LS t1602 · t1662 [정기-LS시장]로도 수집 가능', 'kiwoom-market-supply'],
                ['정기-한투선물', '한투 FHPTJ04030000 · 1분', '선물 주간 투자자\n※ LS t1602(선물 900/901) [정기-LS시장]로도 수집 가능', 'market-supply'],
                ['정기-LS야간', 'LS t8463(야간) · 1분', '선물 야간 투자자', 'market-supply'],
                ['정기-한투종목', '한투 HHPTJ04160200 · 1분', '등록 종목 외국인 · 기관\n※ 키움 ka10060 · ka90008 [정기-키움종목]로도 수집 가능\n※ LS t1717(투자자) · t1637(프로그램) [정기-LS종목]로도 수집 가능', 'kis-supply'],
                ['정기-키움신고신저', '키움 ka10016 · 1분\n키움 ka10099(종목 목록) · 하루 1회', '52주 신고가 · 신저가 종목 수 (보통주만 · ETF · ETN · 우선주 · 리츠 · 스팩 제외)', 'breadth'],
                ['정기-지표', 'jusikbot risk-history · 1시간', '변동성 · Fear & Greed · 하이일드', 'volatility'],
                ['정기-LS종목정보', 'LS t8436, t8401 · 하루 1회\nLS t8402 · 종목마다 하루 1회','VI 모니터의 종목명 · 시장, 주식선물 대응 · 만기(그날 첫 VI 때 조회) · 로컬 서버에서만', 'vi-monitor (masters.json)'],
                ['정기-LS선물종목', 'LS t8463(투자자) · 1분\nLS t2522(기초자산 · 최근월물) · 하루 1회', '등록 종목의 주식선물 개인 · 외국인 · 기관 순매수 계약(08:45~16:20)', 'ls-stock-futures']
            ]],
            ['화면 조회', [
                ['조회', '표 · 차트별 TR (아래 표 참고)', '브라우저 자동 새로고침(기본 30초)이나 조작 때 서버가 증권사에 조회합니다.', '저장 안 함 (서버 메모리 캐시)\n예외는 아래 표에 표시'],
                ['백그라운드 갱신', '화면 조회와 같은 TR', '브라우저가 하나도 없을 때 서버가 화면 조회를 대신 실행합니다(새로고침 간격 설정을 따름).', 'background-refresh (최근 결과)']
            ]]
        ]
    };
    const tables = {
        title: '표 5개',
        head: ['표', '증권사 · TR', '방식', '파일 저장'],
        sections: [[null, [
            ['거래대금 상위', '키움 ka10032, 종목정보 ka10100', '[조회] 장중에만 새로고침', '저장 안 함'],
            ['실시간 조회 순위', '키움 ka00198', '[조회] 장중에만 새로고침', '저장 안 함'],
            ['대주가능 종목', '한투 CTSC2702R(대주 수량), FHKST01010100(현재가), 한투 종목 마스터 파일', '[조회] 실시간 조회 순위를 받을 때 함께 조회', '저장 안 함'],
            ['관심종목 하락률 순위 (탭 맨 아래)', '키움 ka01301(관심종목 목록), ka10095(시세 일괄), 보조 ka10007 · ka10100', '[조회] 장중에만 새로고침 · 백그라운드 갱신은 하지 않음', '저장 안 함'],
            ['VI 모니터 (별도 창)', 'VI 발동 · 해제: 키움 1h\n현재가 · 등락률 · 거래대금: NH oc · nc · vC\n종목명 · 선물 대응 · 만기: LS t8436 · t8401 · t8402', '[실시간-키움VI] · [실시간-NH] · [정기-LS종목정보]\n로컬 서버에서만 수신 · 자세한 내용은 VI 창의 i', 'vi-monitor (당일 VI 목록, 종목 정보)\n현재가는 저장 안 함']
        ]]]
    };
    const index = '키움 지수 ka20005(분) · ka20006(일)\n[조회] · 저장 안 함';
    const charts = {
        title: '차트 10개',
        head: ['차트', '분봉', '일봉', '가격 캔들'],
        sections: [[null, [
            ['쏠림율', 'LS 종목 t8452 ÷ 시장 t8409\n[조회] · 저장 안 함\n※ 한투 지수 거래대금 FHKUP03500200 [정기-한투지수] · H0UPCNT0 [실시간-한투]로도 수집 가능',
                '키움 종목 ka10081 ÷ 시장 ka20006\n[조회] · 저장 안 함', '키움 ka10080(분) · ka10081(일)\n[조회] · 저장 안 함'],
            ['시장 거래대금', 'LS t8409\n[조회] · 저장 안 함\n※ 한투 H0UPCNT0 [실시간-한투] · FHKUP03500200 [정기-한투지수]로도 수집 가능',
                '키움 ka20006\n[조회] · 저장 안 함', index],
            ['종목 수급', '외국인 · 기관: 한투 HHPTJ04160200 [정기-한투종목]\n개인: 미제공\n프로그램: 한투 H0UNPGM0 [실시간-한투]\n저장: kis-supply\n※ 키움 ka10060 · ka90008 [정기-키움종목]로도 수집 가능\n※ LS t1717(투자자) · t1637(프로그램) [정기-LS종목]로도 수집 가능',
                '키움 ka10060(투자자) · ka90013(프로그램)\n[조회] · 저장 안 함', '키움 ka10080(분) · ka10081(일)\n[조회] · 저장 안 함'],
            ['종목 선물 수급', '개인 · 외국인 · 기관(계약): LS t8463 [정기-LS선물종목]\n프로그램: 미제공\n저장: ls-stock-futures (수집한 날부터, LS 전일분 포함)',
                'LS t8462 (2026-02-11부터)\n[조회] · 저장 안 함', '분: 한투 FHKIF03020200 그날 최근월물(2025-10-29부터, 수급 없는 날 포함) [조회] · 저장 안 함(서버 메모리 캐시)\n일: LS t8405 연결선물(최근월물만 연결) [조회] · 저장 안 함'],
            ['시장 수급 (KOSPI · KOSDAQ)', '키움 ka10051 · ka90005 [정기-키움시장]\n저장: kiwoom-market-supply\n※ LS t1602 · t1662 [정기-LS시장]로도 수집 가능',
                'LS t1665(투자자) · t1633(프로그램)\n[조회] · 저장 안 함', index],
            ['시장 수급 (선물)', '주간: 한투 FHPTJ04030000 [정기-한투선물] 저장값을 먼저 보이고 LS t8463(주간) [조회]으로 보완\n야간: LS t8463 [정기-LS야간]\n저장: market-supply, ls-futures-test(LS 주간 조회분)\n※ LS t1602(선물 900/901) [정기-LS시장]로도 수집 가능',
                'LS t8462(주간만)\n[조회] · 저장 안 함', 'LS t8465(주간 분) · t8461(야간 분) · t2214(주간 일) · t8459(야간 일)\n[조회] · 저장 안 함'],
            ['52주 신고/신저', '키움 ka10016 중 보통주 [정기-키움신고신저]\n저장: breadth (2026-11-09부터 표시)', '~2026-11-06: 키움 ka10081 보통주 일봉으로 계산 (KOSPI 1985-11~ · KOSDAQ 1997-05~, 상장폐지 종목 빠짐)\n2026-11-09~: 마감 뒤 ka10016 보통주 수\n저장: breadth', index],
            ['ADR', 'jusikbot adr/today\n[조회] · 저장: adr-minutes', 'jusikbot adr/history\n[조회] · 저장 안 함', index],
            ['변동성', '없음 (일봉만)', 'jusikbot risk-history\n[조회] · [정기-지표]\n저장: volatility', '없음'],
            ['Fear & Greed · 하이일드', '없음 (일봉만)', 'jusikbot risk-history (변동성과 같은 조회)\n[조회] · [정기-지표]\n저장: volatility', '없음']
        ]]]
    };

    const tokens = {
        title: '토큰',
        note: [
            '증권사 접근 토큰은 서버가 받아 파일에 저장해 두고, 서버를 다시 시작해도 만료 전까지 그대로 씁니다. 저장 경로는 서버의 data 폴더 기준입니다.',
            '로컬과 오라클은 같은 앱키를 쓰지만 토큰은 서버마다 따로 받습니다. 예약 스크립트는 토큰을 직접 받지 않고 로컬 서버의 파일을 같이 씁니다.'
        ],
        head: ['증권사', '저장 위치', '다시 받는 때', '서버 재시작 때', '같이 쓰는 곳'],
        sections: [[null, [
            ['키움', 'kiwoom-token', '받은 뒤 24시간으로 보고 만료 5분 전\n토큰 오류 응답이면 바로', '파일의 토큰 재사용', '52주 신고 과거 채우기 작업'],
            ['LS', 'ls-token', '응답의 유효시간 기준 만료 1분 전\n거절(401 또는 토큰 오류)이면 바로, 1분 안에 받은 토큰은 유지', '파일의 토큰 재사용', '만기일 시험 등 예약 작업'],
            ['한투', 'kis-token', '응답의 유효시간 기준 만료 5분 전\n토큰 오류(EGW00121 · EGW00123)면 바로, 1분 안에 받은 토큰은 유지', '파일의 토큰 재사용 (같은 도메인 · 앱키일 때만)', '없음 (서버만)'],
            ['NH', 'nh-plug', '24시간 재사용\n인증 오류(401 · IGW40043)일 때만 다시 받음 (다시 받으면 NH 보안 알림)', '파일의 토큰 재사용', 'VI 모니터 (로컬 서버에서만)']
        ]]]
    };

    // Browser chart cache (rank-chart-cache.js) and server data revisions (chart-revisions.js), 2026-11-08.
    const cache = {
        title: '화면 차트 캐시',
        note: [
            '브라우저는 차트 응답을 이 PC의 브라우저 저장소(IndexedDB)에 보관해, 다시 열 때 증권사 조회 없이 바로 그립니다. Ctrl+F5로는 지워지지 않습니다. 계정마다 따로 보관하고, 오류·미제공·미완료 응답은 보관하지 않습니다.',
            '서버가 저장한 과거 자료를 고치면(빠진 날 채우기, 지난 자료 가져오기, 기준 변경) 서버의 그 차트 버전이 바뀝니다. 브라우저는 화면을 열 때와 응답을 받을 때 버전을 비교해, 바뀐 차트의 보관 응답을 시장·종목·과거 쪽 구분 없이 한꺼번에 버리고 다시 받습니다. 그래서 한 차트에 고치기 전과 후의 값이 섞이지 않습니다.',
            '버전은 지난 날의 파일이나 값이 바뀔 때만 올라갑니다. 오늘 수집과 새 날짜가 늘어나는 것은 버전을 바꾸지 않습니다. 전날은 야간 선물 때문에 다음 날 06:00까지 오늘로 봅니다.',
            '증권사에서 바로 받는 차트(쏠림율, 시장 거래대금 일봉, 종목 수급 일봉, 지수 캔들 등)는 과거가 바뀌지 않아 버전이 없습니다.'
        ],
        head: ['응답', '보관 기간', '다시 받는 때'],
        sections: [[null, [
            ['오늘이 들어 있는 첫 쪽', '16시간', '장중: 보관값을 먼저 그리고 곧바로 다시 받아 바꿈\n장 마감 뒤: 장중에 받은 응답이면 마감 2분 뒤 한 번 다시 받음\n버전이 바뀌면 바로'],
            ['더 불러오기로 받은 과거 쪽 (날짜 커서가 오늘 이전)', '7일', '보관 기간이 지나거나 버전이 바뀔 때만'],
            ['쏠림율 분봉의 과거 쪽 (서버 세션 커서)', '보관 안 함', '매번'],
            ['버전이 있는 차트', '-', '52주 신고/신저(breadth) · 종목 수급 분봉(kis-supply, ls-supply, supply) · 종목 선물 수급(ls-stock-futures) · 시장 수급(market-supply, kiwoom-market-supply, ls-market-supply) · 시장 거래대금 분봉과 쏠림율 LS(ls-turnover) · 한투 쏠림율(kis-concentration) · 변동성과 F&G·하이일드(volatility)'],
            ['한도', '전체 180개 · 24MB', '넘치면 오래된 응답부터 지움 (응답 하나가 5MB를 넘으면 보관 안 함)']
        ]]]
    };

    function build(dialog, spec) {
        const block = document.createElement('section'); block.className = 'data-collection-category';
        const title = document.createElement('h3'); title.textContent = spec.title; block.append(title);
        for (const line of spec.note || []) { const note = document.createElement('p'); note.className = 'data-collection-note'; note.textContent = line; block.append(note); }
        const scroll = document.createElement('div'); scroll.className = 'data-collection-scroll'; block.append(scroll);
        const table = document.createElement('table'); scroll.append(table);
        const headRow = table.createTHead().insertRow();
        for (const label of spec.head) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; headRow.append(th); }
        const body = table.createTBody();
        for (const [caption, rows] of spec.sections) {
            if (caption) { const cell = body.insertRow().insertCell(); cell.colSpan = spec.head.length; cell.className = 'data-collection-group'; cell.textContent = caption; }
            for (const values of rows) {
                const row = body.insertRow();
                values.forEach((value, i) => {
                    const cell = document.createElement(i ? 'td' : 'th'); if (!i) cell.scope = 'row';
                    cell.textContent = value; row.append(cell);
                });
            }
        }
        dialog.append(block);
    }

    window.MarketThroughGuide = { build };

    function initialize() {
        // The VI window loads this file only for build(); it has no trading tab.
        const controls = document.querySelector('#tab_rank .header-controls');
        if (!controls || document.getElementById('dataCollectionGuide')) return;
        const info = document.createElement('span'); info.className = 'market-alert-info data-collection-info'; info.append('데이터 수집');
        const icon = document.createElement('button');
        icon.type = 'button'; icon.className = 'chart-info-button market-alert-info-icon'; icon.textContent = 'i';
        icon.setAttribute('aria-label', '데이터 수집 안내'); icon.setAttribute('aria-haspopup', 'dialog'); icon.setAttribute('aria-controls', 'dataCollectionGuide');
        info.append(icon);
        // Just left of the note button; the note sits left of the capture button.
        const note = document.getElementById('quickNoteButton');
        if (note && note.parentElement === controls) controls.insertBefore(info, note);
        else controls.insertBefore(info, controls.querySelector('.capture-btn-small') || controls.firstChild);

        const dialog = document.createElement('dialog'); dialog.id = 'dataCollectionGuide'; dialog.className = 'data-collection-dialog';
        dialog.setAttribute('aria-labelledby', 'dataCollectionGuideTitle');
        const close = document.createElement('button'); close.type = 'button'; close.className = 'market-alert-dialog-close'; close.textContent = '닫기';
        close.addEventListener('click', () => dialog.close()); dialog.append(close);
        const heading = document.createElement('h2'); heading.id = 'dataCollectionGuideTitle'; heading.textContent = '데이터 수집 안내'; dialog.append(heading);
        for (const spec of [groups, tables, charts, tokens, cache]) build(dialog, spec);
        document.body.append(dialog);
        icon.addEventListener('click', () => dialog.showModal());
        dialog.addEventListener('click', event => {
            if (event.target !== dialog) return;
            const r = dialog.getBoundingClientRect();
            if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true }); else initialize();
})();
