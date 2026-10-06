# Data Model: 캘린더 공급자별 열린 페이지

## Persisted Selection

activeCalendarId는 toss / seibro / investing이며 기존 saveAppData로 저장한다. 공급자 ID 호환성을 유지한다.

## Browser DOM State

- Toss: iframeEarnings, data-calendar-urls 및 data-calendar-source 메타데이터도 보유.
- SEIBro: iframeEarningsSeibro.
- Investing.com: centralBanksFrame 및 centralBanksFramePanel.
- 각 iframe dataset.loadedDate: 마지막 접속을 시작한 Asia/Seoul 날짜. 성공 확인 날짜가 아니다.
- Toss/SEIBro dataset.requestedAt: 마지막 접속 요청 시각.
- Investing.com loadingTimer: 20초 안내 해제 타이머.

상태는 메모리 전용이다. 당일 재진입은 src를 변경하지 않는다. 강제 새로고침 또는 날짜 변경은 해당 iframe src를 다시 설정한다. hidden은 표시만 바꾸고 iframe을 제거하지 않는다. 페이지 재로드와 DOM 재생성 시 상태가 소실된다.
