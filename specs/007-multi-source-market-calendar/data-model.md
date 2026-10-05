# Data Model: 증시캘린더 공급자와 각국 금리 이미지

## Persisted Selection

tabData.tab_earnings.activeCalendarId는 toss / seibro / investing 중 하나이다. 기존 saveAppData()로 저장한다. 표시 이름만 각국 금리 일정으로 변경하고 investing ID는 유지한다.

## Server Daily Capture (메모리 전용)

- date: Asia/Seoul 기준 YYYY-MM-DD, 성공 캡처 완료 시 기록.
- capturedAt: 성공 시각 ISO 문자열.
- png: 테이블 PNG Buffer.
- pending: 진행 중 캡처 Promise 또는 null. 동시 요청이 공유하며 성공/실패 후 해제.

일반 조회는 당일 성공 캐시를 반환한다. forceRefresh=true는 새로 캡처하고 성공 시 기존 캐시를 교체한다. 진행 중 캡처는 캐시보다 우선하여 공유한다. 강제 조회 실패 시 기존 성공 캐시를 보존하되 해당 요청에는 오류를 반환한다. 날짜가 다르면 다시 캡처하며 실패를 캐시하지 않는다. 서버 재시작 시 소실된다.

## Browser Image Cache (메모리 전용)

- date / capturedAt: API 응답 헤더 값.
- url: PNG Blob의 Object URL. 새 이미지 교체 시 이전 URL 해제.
- centralBanksImageRequest: 진행 중 API 요청 Promise 또는 null.
- panel.centralBanksRenderToken: 가장 최근 렌더를 식별하는 Symbol.

이미지 캐시를 설정 JSON에 저장하지 않는다. 페이지 재로드 시 소실되지만 서버 캐시를 사용할 수 있다.

## Display States

대기 → 중앙 로딩 메시지(role=status, aria-busy=true) → 이미지 decode 완료 → 이미지(aria-busy=false).

실패하면 오류/재시도 안내(aria-busy=false)로 전환한다. 재시도는 로딩 상태에서 시작한다. 이전 렌더 호출은 새 렌더 상태를 수정하지 않는다.
