(() => {
    'use strict';
    // VI window "i": data sources, why each source, caveats and test results.
    // Matches vi-monitor-service.js (Kiwoom VI, NH prices, LS daily masters) as of 2026-11-07.
    const guide = window.MarketThroughGuide;
    if (!guide) return;
    const sources = {
        title: '받는 데이터',
        note: [
            '로컬 서버에서만 받습니다. 오라클은 VI_MONITOR_REALTIME=false로 꺼 두어, VI 창을 열어도 수신하지 않고 "꺼 두었습니다"로 표시합니다.',
            '같은 묶음 이름은 트레이딩 탭 "데이터 수집 i"의 받는 방식 묶음과 같습니다. [실시간-키움VI]와 [실시간-NH]는 각각 웹소켓 1개입니다.'
        ],
        head: ['항목', '증권사 · TR', '방식', '파일 저장'],
        sections: [[null, [
            ['VI 발동 · 해제 (KRX · NXT)', '키움 1h (전체 종목, NXT는 _NX)', '[실시간-키움VI]\n해제 시각은 1224(releaseTime) 칸', 'vi-monitor (당일 VI 목록)'],
            ['KRX 현재가 · 등락률 · 거래대금', 'NH oc', '[실시간-NH]\n한도를 넘는 종목은 NH 조회(5초)', '저장 안 함'],
            ['NXT 현재가', 'NH nc', '[실시간-NH]\n한도를 넘는 종목은 NH 조회(5초)', '저장 안 함'],
            ['주식선물 현재가 (최근월 · 차기월)', 'NH vC\n첫 값은 LS t8402', '[실시간-NH]\n한도를 넘는 종목은 NH 조회(5초)', '저장 안 함'],
            ['종목명 · 시장, 주식선물 대응', 'LS t8436 · t8401', '[정기-LS종목정보]\n그날 첫 VI 때 하루 1회 조회', 'vi-monitor (masters.json)'],
            ['선물 만기 (월물 선택)', 'LS t8402', '[정기-LS종목정보]\n종목마다 하루 1회 조회', 'vi-monitor (masters.json)']
        ]]]
    };
    const reasons = {
        title: '이렇게 받는 이유',
        note: ['LS 실시간 연결은 사이드카 · 서킷 알림(JIF) 1개만 씁니다. 이 알림도 로컬 서버에서만 켭니다.'],
        head: ['역할', '증권사', '이유'],
        sections: [[null, [
            ['VI 발동 · 해제', '키움', 'LS NVI에는 전체 종목 등록 키가 없어 NXT VI를 받으려면 종목을 하나씩 등록해야 합니다. 키움은 한 번 등록으로 KRX · NXT를 모두 받습니다.\nKRX VI는 키움과 LS가 3,110건 모두 일치했습니다(11/5).'],
            ['현재가', 'NH', 'LS 실시간 연결을 쓰지 않으려고 NH로 받습니다. 등락률 · 거래대금도 같은 체결 메시지에 들어 있습니다.'],
            ['종목 정보', 'LS', 'NH 선물 마스터에는 만기일이 없습니다. 조회 방식이라 실시간 연결 수와 관계없습니다.'],
            ['사이드카 · 서킷 알림', 'LS JIF', '대신 받을 곳이 없어 그대로 둡니다.']
        ]]]
    };
    const cautions = {
        title: '주의할 점',
        head: ['항목', '내용'],
        sections: [[null, [
            ['해제 시각', '키움 해제 이벤트의 시각 칸(1223)은 발동 시각입니다. 해제 시각은 1224(releaseTime) 칸에서 읽어 표시합니다. 1224가 000000이면 발동, 아니면 해제입니다.\n예전 LS는 해제 이벤트의 시각이 곧 해제 시각이었습니다.'],
            ['키움 중복 · 연장', '같은 VI가 SOR(_AL) 항목으로 한 번 더 오므로 거릅니다. VI 연장(구분 4)은 새 발동으로 보지 않습니다.'],
            ['NH 한도', '실시간 구독은 연결당 30건입니다. VI 종목 하나에 KRX · NXT · 선물 2개 월물로 최대 4건을 씁니다(NXT 미상장, 선물 없는 종목은 덜 씀).\n넘는 종목은 NH 조회로 5초마다 받습니다(조회는 초당 5회까지). VI가 몰리는 16:00 직후에는 갱신이 느려질 수 있습니다.'],
            ['현재가 구독 해제', '종목의 VI가 모두 해제되고 3분 뒤 NH 구독을 풉니다. 그 뒤 해제된 행의 가격과 괴리율은 마지막 값에 멈춥니다.'],
            ['NH 토큰', 'data/nh-plug/token.json에 두고 24시간 재사용합니다. 재발급하면 NH 보안 알림이 가므로 인증 오류 때만 재발급합니다.'],
            ['NH 기타', 'NXT 미상장 종목은 NH가 "거래불가"로 답해 NXT 구독을 하지 않습니다.\n선물코드는 LS 코드 앞에 K를 붙여 조회합니다(A116B000 → KA116B000).'],
            ['거래대금 단위', '트레이딩 탭의 표 3개와 같은 백만 원입니다. NH 실시간 value는 백만 원이고, NH 조회 acml_tr_pbmn은 원 단위로 보고 백만 원으로 바꿉니다.\n장중에 거래대금 상위 표(키움, 백만 원)를 받을 때 NH에 삼성전자를 조회해, 두 값을 data/vi-monitor/amount-check-날짜.jsonl에 10분마다 남겨 단위를 확인합니다. 키움 값은 KRX+NXT 합이라 비율이 1보다 조금 작으면 정상입니다.'],
            ['LS 종목 정보', 'data/vi-monitor/masters.json에 저장해, 같은 날 서버를 재시작해도 다시 조회하지 않습니다. 날짜가 바뀌면 다시 받습니다.'],
            ['LS 토큰', '로컬과 오라클이 같은 LS 앱키를 씁니다. LS가 토큰을 거절하면 다음 조회에서 다시 발급합니다(1분 안에 받은 토큰은 유지).'],
            ['해제까지(예상)', '발동 시각 + 2분까지 분:초:밀리초로 줄어드는 예상값입니다. 실제 해제는 받은 해제 이벤트로 표시합니다.'],
            ['이력', '서버가 받기 전이나 연결이 끊긴 동안의 VI는 알 수 없습니다. 받은 당일 목록은 data/vi-monitor에 저장해 재시작해도 유지합니다.']
        ]]]
    };
    const tests = {
        title: '시험 결과',
        head: ['날짜', '시험', '결과'],
        sections: [[null, [
            ['11/4', '키움 VI 하루 수신', 'SOR 2,243건이 모두 KRX 또는 NXT 이벤트와 같은 내용이었습니다. NXT 장전(08:00~08:50) VI도 받았습니다.'],
            ['11/5', 'KRX VI: 키움 대 LS VI_', '3,110건이 종목 · 구분 · 시각(1초 이내)으로 모두 일치했습니다. LS가 1초 빠른 건 108건, 키움이 1초 빠른 건 12건입니다.'],
            ['11/5', 'KRX 애프터마켓 VI (16:00~20:00)', '양쪽 모두 1,434건으로 같았습니다.'],
            ['11/5', 'NXT VI', '키움 492건(121종목), LS NVI 전체 등록 0건'],
            ['11/5', 'NH 현재가', 'KRX 실시간 9,261건 · 조회 6,419건, NXT 2,851건 · 1,494건, 주식선물 766건 · 662건. 오류 0건.\n실시간 가격과 조회 가격을 113번 대조해 108번 같았습니다.'],
            ['11/6', 'LS NVI 등록 키', '종목별 NVI 73건이 키움과 73/73 일치(0~1초)했습니다.\n전체 키 N000000 · U000000은 0건이었습니다. 같은 시간 키움 NXT VI는 555건(258종목)이었습니다.'],
            ['11/7', '키움 · NH 구성 적용', '모의 메시지로 해제 시각, SOR 거르기, NH 등락률 · 거래대금, 구독 해제, 종목 정보 저장을 확인했습니다. 실제 장중 수신은 다음 거래일에 처음 확인합니다.']
        ]]]
    };

    function initialize() {
        const controls = document.querySelector('.vi-panel .vi-controls');
        if (!controls || document.getElementById('viMonitorGuide')) return;
        const icon = document.createElement('button');
        icon.type = 'button'; icon.className = 'chart-info-button vi-info-button'; icon.textContent = 'i';
        icon.setAttribute('aria-label', 'VI 모니터 안내'); icon.setAttribute('aria-haspopup', 'dialog'); icon.setAttribute('aria-controls', 'viMonitorGuide');
        controls.append(icon);
        const dialog = document.createElement('dialog'); dialog.id = 'viMonitorGuide'; dialog.className = 'data-collection-dialog';
        dialog.setAttribute('aria-labelledby', 'viMonitorGuideTitle');
        const close = document.createElement('button'); close.type = 'button'; close.className = 'vi-guide-close'; close.textContent = '닫기';
        close.addEventListener('click', () => dialog.close()); dialog.append(close);
        const heading = document.createElement('h2'); heading.id = 'viMonitorGuideTitle'; heading.textContent = 'VI 모니터 안내'; dialog.append(heading);
        for (const spec of [sources, reasons, cautions, tests]) guide.build(dialog, spec);
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
