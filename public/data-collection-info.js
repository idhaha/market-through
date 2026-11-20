(() => {
    'use strict';
    // Trading tab "데이터 수집 i": which broker, transport and file each table/chart uses.
    // Keep in step with the server services when a source changes (checked 2026-11-07).
    const groups = {
        title: '받는 방식 묶음',
        note: [
            '같은 묶음 이름은 같은 연결 또는 같은 조회에서 받는 데이터입니다. 저장 경로는 서버의 data 폴더 기준입니다.',
            '파일 저장: 서버가 직접 받는 실시간 연결과 정기 조회는 NH 현재가를 빼고 모두 data 아래 폴더에 저장됩니다. 화면 조회는 서버 메모리에만 잠시 보관합니다. 예외는 ADR 분봉(adr-minutes), 선물 주간 LS 조회분(ls-futures-test), 변동성·심리(volatility)입니다. 트레이딩 탭의 표 4개는 저장하지 않고, VI 모니터는 당일 VI 목록과 종목 정보를 vi-monitor에 저장합니다.',
            '서버별: 장운영 알림[실시간-LS1]은 오라클 서버에서만, VI 모니터[실시간-키움VI · 실시간-NH · 실시간-LS선물이벤트 · 정기-LS종목정보 · 정기-LS선물감시월물]는 2026-11-10부터 장중 시험을 위해 로컬 PC 서버에서만 켭니다(설정 VI_REALTIME · MARKET_ALERTS_REALTIME, 기본은 VI 로컬 · 경보 오라클). 끈 서버는 화면에 "꺼 두었습니다"로 표시합니다. 한투 종목 프로그램 실시간(H0UNPGM0)도 앱키를 함께 쓰므로 오라클만 받습니다(로컬은 KIS_STOCK_REALTIME_ENABLED=false).',
            '※ 표시: 지금은 수집하지 않는 대체 원천입니다(화면에 쓰는 곳이 없어 2026-11-07부터 멈춤). 서버 설정 ALT_SUPPLY_COLLECTION=on으로 켜면 같은 데이터를 수집할 수 있습니다. 대괄호는 그때의 묶음 이름입니다.',
            'LS 종목 수급 TR: t1717은 투자자, t1637은 프로그램입니다.'
        ],
        head: ['묶음', '증권사 · TR', '받는 데이터', '파일 저장'],
        sections: [
            ['실시간 연결 · 연결 하나에 여러 항목이 함께 들어옵니다', [
                ['실시간-LS1', 'LS 웹소켓 1개 · JIF', '장운영 알림(사이드카 · 서킷브레이커) · 오라클 서버에서만', 'market-alerts (당일 경보 · 상태)'],
                ['실시간-키움VI', '키움 웹소켓 1개 · 1h (전체 종목, _NX)\n+ 대주 StopLoss 0B(감시 종목 체결, KRX · _NX) · 00 · 04(주문체결 · 잔고) 같은 연결에 함께 등록(2026-11-20부터)\n※ 키움은 앱키당 웹소켓 하나만 허용(새 연결이 기존 연결을 끊음) · 충돌하면 대주 우선', 'VI 모니터의 VI 발동 · 해제(KRX · NXT), 대주 StopLoss 실시간 판정 · 로컬 PC 서버에서만', 'vi-monitor (당일 VI 목록)'],
                ['실시간-LS선물이벤트', 'LS 웹소켓 1개 · JX0, JD0, JC0, JIF (VI_FUTURES_EVENTS=on일 때)', 'VI 모니터의 주식선물 가격제한 도달 · 확대: 감시 월물(전일 거래량이 많은 월물)마다 JX0(확대) · JD0(실시간 상·하한가, 근처 신호), 한도 근처 · 확대된 · 행이 있는 월물만 JC0(체결, 도달 판정, 해지는 30초 늦춤), JIF(CB, 가격제한폭 先확대 판정) · 로컬 PC 서버에서만', 'vi-monitor/futures-events (JX0 · JIF 원문)'],
                ['실시간-NH', 'NH 웹소켓 1개 · oc, nc, vC, ob (최대 30건)', 'VI 걸린 종목의 KRX · NXT · 주식선물 현재가와 등락률 · 거래대금, KRX 매수10호가 평균(ob). 한도를 넘는 종목은 NH 조회(5초) · 로컬 서버에서만', '저장 안 함'],
                ['실시간-한투', '한투 웹소켓 1개 · H0UNPGM0', '등록 종목 프로그램 매매\n※ KOSPI · KOSDAQ 지수 거래대금은 같은 연결의 한투 H0UPCNT0 [실시간-한투] · FHKUP03500200 [정기-한투지수]로도 수집 가능', 'kis-supply (프로그램)']
            ]],
            ['서버 정기 조회 · 화면과 관계없이 장중에 서버가 조회해 저장합니다', [
                ['정기-키움시장', '키움 ka10051, ka90005 · 1분', '현물 시장 투자자 · 프로그램\n※ LS t1602 · t1662 [정기-LS시장]로도 수집 가능', 'kiwoom-market-supply'],
                ['정기-한투선물', '한투 FHPTJ04030000 · 1분', '선물 주간 투자자\n※ LS t1602(선물 900/901) [정기-LS시장]로도 수집 가능', 'market-supply'],
                ['정기-LS야간', 'LS t8463(야간) · 1분', '선물 야간 투자자', 'market-supply'],
                ['정기-한투종목', '한투 HHPTJ04160200 · 1분', '등록 종목 외국인 · 기관\n※ 키움 ka10060 · ka90008 [정기-키움종목]로도 수집 가능\n※ LS t1717(투자자) · t1637(프로그램) [정기-LS종목]로도 수집 가능', 'kis-supply'],
                ['정기-키움신고신저', '키움 ka10016 · 1분\n키움 ka20001(업종 등락 종목 수) · 1분\n키움 ka10099(종목 목록) · 하루 1회', '52주 신고가 · 신저가 종목 수 (보통주만 · ETF · ETN · 우선주 · 리츠 · 스팩 제외)\n장중 ADR용 상승 · 하락 · 보합 종목 수 (KOSPI · KOSDAQ 종합)', 'breadth (분 파일)'],
                ['정기-LS등락', 'LS t1514 · 20:02 뒤 하루 1회(최근 40거래일)\n처음 한 번은 받을 수 있는 과거 전체', 'ADR용 거래소 공식 상승 · 하락 · 보합 종목 수 (KOSPI 2000~ · KOSDAQ 2003~)', 'breadth (daily.json)'],
                ['정기-지표', 'jusikbot risk-history · 1시간', '변동성 · Fear & Greed · 하이일드', 'volatility'],
                ['정기-LS종목정보', 'LS t8436, t8401 · 하루 1회\nLS t8402 · 종목마다 하루 1회','VI 모니터의 종목명 · 시장, 주식선물 대응 · 만기(그날 첫 VI 때 조회) · 로컬 서버에서만', 'vi-monitor (masters.json)'],
                ['정기-LS선물감시월물', 'LS t8405(futcheck 0) · 개장일 07:30부터 하루 1회, 종목마다 최근월 · 차월 2회', 'VI 모니터 선물 감시 월물(최근월 · 차월 중 전일 거래량이 많은 월물, 오늘 만기 월물 제외) · 로컬 서버에서만', 'vi-monitor (futures-base.json)'],
                ['정기-키움대주', '키움 ka10001(현재가 · KRX는 종목코드, NXT는 _NX, 정규장에는 둘 다) · 감시 중인 종목마다 5초(실시간이 끊기거나 15:20~15:30이면 1초)\n키움 kt00018(개별, 대주 잔고) · ka10085(만기일) · 30초(창을 열었거나 감시 중일 때)와 발동 때\n키움 ka10004(매도1호가) · ka10075 · kt00009(접수 · 체결 확인, [실시간-키움VI] 00 이벤트가 먼저이고 조회는 주문 뒤 3초마다 보조)', '대주 StopLoss 감시와 자동 대주상환(kt10006 신용구분 77 · 정정 kt10008 · 취소 kt10009) · 주문은 SHORT_STOPLOSS=on인 서버에서만(기본 끔), 관리자 계정만', 'short-stoploss (감시 조건 · 처리 기록, 30초마다 확인 기록 realtime-날짜)'],
                ['정기-LS선물종목', 'LS t8463(투자자) · 1분\nLS t2522(기초자산 · 최근월물) · 하루 1회', '등록 종목의 주식선물 개인 · 외국인 · 기관 순매수 계약(08:45~16:20) · 오라클 서버에서만', 'ls-stock-futures']
            ]],
            ['화면 조회', [
                ['조회', '표 · 차트별 TR (아래 표 참고)', '브라우저 자동 새로고침(기본 30초)이나 조작 때 서버가 증권사에 조회합니다.', '저장 안 함 (서버 메모리 캐시)\n예외는 아래 표에 표시'],
                ['백그라운드 갱신', '화면 조회와 같은 TR', '브라우저가 하나도 없을 때 서버가 화면 조회를 대신 실행합니다(새로고침 간격 설정을 따름).', 'background-refresh (최근 결과)']
            ]]
        ]
    };
    const tables = {
        title: '표 6개',
        head: ['표', '증권사 · TR', '방식', '파일 저장'],
        sections: [[null, [
            ['거래대금 상위', '키움 ka10032, 종목정보 ka10100', '[조회] 장중에만 새로고침', '저장 안 함'],
            ['실시간 조회 순위', '키움 ka00198', '[조회] 장중에만 새로고침', '저장 안 함'],
            ['대주가능 종목', '한투 CTSC2702R(대주 수량), FHKST11300006(현재가 · 30종목씩, ETN만 FHKST01010100), 한투 종목 마스터 파일(후보 · 종목명)\n수량이 없는 후보는 0으로 표시(표의 체크박스로 숨김 가능)', '[조회] 실시간 조회 순위를 받을 때 함께 조회', '저장 안 함'],
            ['관심종목 하락률 순위 (탭 맨 아래)', '키움 ka01301(관심종목 목록), ka10095(시세 일괄), 보조 ka10007 · ka10100', '[조회] 장중에만 새로고침 · 백그라운드 갱신은 하지 않음', '저장 안 함'],
            ['VI 모니터 (별도 창)', 'VI 발동 · 해제: 키움 1h\n현재가 · 등락률 · 거래대금: NH oc · nc · vC (발동 때 KRX는 NH 조회 1회)\n괴리율 1% 이상 VI: 발동부터 4분 가격을 vi-monitor/gap-records에 저장\n매수10호가 평균: KRX 행 NH ob · NXT 행 한투 FHKST01010200(NX) 조회 5초 · 선물 행 LS t8403 조회 5초(× 거래승수)\n체결강도: KRX · NXT 행 한투 FHKST01010300(J · NX) 발동 때 1회 · 선물 행 LS JC0 또는 t8404\n선물 가격제한 도달 · 확대: LS JD0 · JC0 · JX0 · JIF (VI_FUTURES_EVENTS=on일 때), 한도 · 놓친 체결 LS t8402 · t8404\n선물 감시 월물: LS t8405\n분석 차트: 한투 FHPST01060000(J · NX) · LS t8404, 1초 간격, 설정 만족 행은 해제 + 1분 뒤 자동 기록\n종목명 · 선물 대응 · 만기: LS t8436 · t8401 · t8402', '[실시간-키움VI] · [실시간-NH] · [실시간-LS선물이벤트] · [정기-LS종목정보] · [정기-LS선물감시월물]\n로컬 서버에서만 수신 · 자세한 내용은 VI 창의 i', 'vi-monitor (당일 VI 목록, 종목 정보, futures-base.json)\nvi-monitor/days (날짜별 VI 창 기록, 날이 바뀔 때)\nvi-monitor/charts (분석 차트, 거래대금 · 시가총액 설정 만족 행, 1초 간격)\nvi-monitor/futures-events (JX0 · JIF 원문)\n현재가는 저장 안 함'],
            ['대주 StopLoss (독립창 앱, 수급 버튼 왼쪽 대주StopLoss)', '대주 잔고: 키움 kt00018(개별) · ka10085 · NXT 거래 여부 ka10001(_NX, 하루 1회)\n감시 · 주문: [실시간-키움VI] 0B · 00 · 04 + [정기-키움대주]', '[실시간-키움VI] · [정기-키움대주] · 창을 열면 2초마다 서버 상태를 읽음 · 자동 주문은 SHORT_STOPLOSS=on인 서버에서만', 'short-stoploss (감시 조건 · 처리 기록)'],
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
                'LS t8462 (2026-02-11부터)\n[조회] · 저장 안 함', '분: 한투 FHKIF03020200 그날 최근월물(만기일 15:20부터 다음 월물, 2025-10-29부터, 수급 없는 날 포함) [조회] · 저장 안 함(서버 메모리 캐시)\n일: LS t8405 연결선물(최근월물만 연결) [조회] · 저장 안 함'],
            ['시장 수급 (KOSPI · KOSDAQ)', '키움 ka10051 · ka90005 [정기-키움시장]\n저장: kiwoom-market-supply\n※ LS t1602 · t1662 [정기-LS시장]로도 수집 가능',
                'LS t1665(투자자) · t1633(프로그램)\n[조회] · 저장 안 함', index],
            ['시장 수급 (선물)', '주간: 한투 FHPTJ04030000 [정기-한투선물] 저장값을 먼저 보이고 LS t8463(주간) [조회]으로 보완\n야간: LS t8463 [정기-LS야간]\n저장: market-supply, ls-futures-test(LS 주간 조회분)\n※ LS t1602(선물 900/901) [정기-LS시장]로도 수집 가능',
                'LS t8462(주간만)\n[조회] · 저장 안 함', 'LS t8465(주간 분) · t8461(야간 분) · t2214(주간 일) · t8459(야간 일)\n[조회] · 저장 안 함'],
            ['ADR 및 52주 신고/신저', '신고 · 신저: 키움 ka10016 중 보통주 [정기-키움신고신저]\nADR: 키움 ka20001 상승 · 하락 수 + 직전 19거래일 확정값 [정기-키움신고신저]\n저장: breadth (신고 · 신저는 2026-11-09부터 표시)', '신고 · 신저: ~2026-11-06 키움 ka10081 보통주 일봉으로 계산 (KOSPI 1985-11~ · KOSDAQ 1997-05~, 상장폐지 종목 빠짐), 2026-11-09~ 마감 뒤 ka10016 보통주 수\nADR: LS t1514 거래소 공식 상승 · 하락 수 [정기-LS등락], 오늘은 키움 ka20001 장중 값\n저장: breadth (daily.json)', index],
            ['ADR (기존 카드)', 'jusikbot adr/today\n[조회] · 저장: adr-minutes', 'jusikbot adr/history\n[조회] · 저장 안 함\n※ 2026-09-14 이후 거래소 공식값보다 낮게 나옴 (ADR 및 52주 신고/신저 카드의 i 참고)', index],
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
            ['키움', 'kiwoom-token', '받은 뒤 24시간으로 보고 만료 5분 전\n토큰 오류 응답이면 바로', '파일의 토큰 재사용', '52주 신고 과거 채우기 작업 · 대주 StopLoss(서버) · 대주 시험 스크립트(dev/kiwoom-short-*)'],
            ['LS', 'ls-token', '응답의 유효시간 기준 만료 1분 전\n거절(401 또는 토큰 오류)이면 바로, 1분 안에 받은 토큰은 유지', '파일의 토큰 재사용', '만기일 시험 등 예약 작업'],
            ['한투', 'kis-token', '응답의 유효시간 기준 만료 5분 전\n토큰 오류(EGW00121 · EGW00123)면 바로, 1분 안에 받은 토큰은 유지', '파일의 토큰 재사용 (같은 도메인 · 앱키일 때만)', '없음 (서버만)'],
            ['NH', 'nh-plug', '24시간 재사용\n인증 오류(401 · IGW40043)일 때만 다시 받음 (다시 받으면 NH 보안 알림)', '파일의 토큰 재사용', 'VI 모니터 (로컬 PC 서버에서만)']
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
            ['버전이 있는 차트', '-', 'ADR 및 52주 신고/신저(breadth) · 종목 수급 분봉(kis-supply, ls-supply, supply) · 종목 선물 수급(ls-stock-futures) · 시장 수급(market-supply, kiwoom-market-supply, ls-market-supply) · 시장 선물 수급(ls-futures-test, market-supply) · 시장 거래대금 분봉과 쏠림율 LS(ls-turnover) · 한투 쏠림율(kis-concentration) · 변동성과 F&G·하이일드(volatility)'],
            ['한도', '전체 180개 · 24MB', '넘치면 오래된 응답부터 지움 (응답 하나가 5MB를 넘으면 보관 안 함)']
        ]]]
    };

    // 장 일정(2026-11-20): 휴장일 달력(calendar.json)과 개장 지연표(market-open-delay.js)를 누가 언제 바꾸는지.
    const schedule = {
        title: '장 일정 (휴장일 · 개장 지연)',
        note: [
            '휴장일 달력은 서버가 혼자 갱신합니다. 이 창이나 Claude · Codex가 켜져 있지 않아도 되고, 오라클은 pm2가 띄워 둔 서버가 합니다.',
            '개장이 늦은 날(수능일)은 증권사 API가 개장 · 마감 시각을 주지 않아 사람이 입력합니다. 입력은 calendar.json에 저장되고 market-open-delay.js가 코드 기본값과 합쳐 바로 씁니다(배포 필요 없음).'
        ],
        head: ['항목', '저장 위치', '누가', '언제', '빠뜨리면'],
        sections: [[null, [
            ['휴장일 (공휴일 · 대체 · 임시공휴일 · 연말 휴장)', 'data/trading-session/calendar.json의 days\n(날짜마다 개장 true · 휴장 false)', '서버 자동\n(한투 국내휴장일조회 CTCA0903R)', '매일 처음 확인할 때 전날부터 몇 주치를 다시 받아 덮어씀. 실패하면 15분마다 다시\n그날 확인이 끝나면 그날 안에는 다시 조회하지 않음(장중 긴급 휴장은 다음 날 반영)\n차트에서 과거를 보면 빈 기간을 28일 단위로 채움', '조회 실패 중에는 장이 열렸다고 보지 않아 자동갱신 · 수집을 멈춤'],
            ['수능일 (정규장 늦게 열고 늦게 닫음)', 'calendar.json의 openDelays\n(코드 기본값: market-open-delay.js 표)', '관리자가 설정(⚙)의 올해 수능일 칸에 입력', '한국거래소 공지가 나오면(2026년은 11/05)\n10/20부터 그해 수능일이 없으면 맨 위 바에 "⚠ 수능일 미등록"이 뜸(최대 12/31)', '그날 시장 누적 거래대금이 비어 쏠림율 누적 · LS 거래대금 분봉이 안 그려짐(2026-11-19)'],
            ['새해 첫 거래일 (10:00 개장)', '없음 (계산)', '서버 자동', '휴장일 달력에서 1월 1일부터 그 전날까지 평일이 모두 휴장인 첫 개장일로 판정', '달력에 빈 평일이 끼면 판정하지 않고 평소 시각으로 봄'],
            ['그 밖의 지연 (거래소 장애 등)', 'market-open-delay.js 표', 'Claude · Codex가 코드 표에 더하고 배포', '생겼을 때', '그날 업종지수 첫 분봉이 09:00보다 늦으면 서버 로그에 [개장 지연] 경고']
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
        for (const spec of [groups, tables, charts, tokens, cache, schedule]) build(dialog, spec);
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
