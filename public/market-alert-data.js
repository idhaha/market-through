/* Reference text from the user's test.xlsx (Sheet2 A1:C12), not a live trigger calculator. */
(() => {
    const circuit = [
        { stage: '1단계', condition: '지수가 전일 종가 대비 8% 이상 하락하여 1분간 지속', action: '20분간 매매 중단 → 이후 10분간 단일가 매매 후 재개' },
        { stage: '2단계', condition: '지수가 전일 종가 대비 15% 이상 하락하고 1단계 발동 지수보다 낮은 상태가 1분간 지속', action: '20분간 매매 중단 → 이후 10분간 단일가 매매 후 재개' },
        { stage: '3단계', condition: '지수가 전일 종가 대비 20% 이상 하락하고 2단계 발동 지수보다 낮은 상태가 1분간 지속', action: '당일 주식시장 즉시 종료 (조기 마감)' }
    ];
    const sidecar = [
        { stage: '코스피', condition: '코스피200 선물이 전일 종가 대비 5% 이상 상승 또는 하락하여 1분간 지속', action: '프로그램 매매 호가 효력 5분 정지 후 자동 해제 · 개인 거래 가능' },
        { stage: '코스닥', condition: '코스닥150 선물이 전일 종가 대비 6% 이상 상승 또는 하락하여 1분간 지속', action: '프로그램 매매 호가 효력 5분 정지 후 자동 해제 · 개인 거래 가능' }
    ];
    window.marketAlertGuide = { circuit, sidecar,
        notes: ['서킷브레이커: 하락 시 발동. 제공 자료의 제한: 09:00~09:05 및 14:50 이후 발동하지 않음.',
            '사이드카: 상승·하락 모두 발동. 제공 자료의 제한: 하루 1회, 14:50 이후 발동하지 않음.'],
        describe: event => event.kind === 'circuit' ? circuit[event.stage - 1] : sidecar[event.market === '1' ? 0 : 1] };
})();
