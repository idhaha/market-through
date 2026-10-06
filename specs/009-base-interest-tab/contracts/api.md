# API Contract: 기준금리 차트

## GET /api/base-interest/charts

로그인 세션 필요. Cache-Control: private, no-store.

- 일반 요청: 당일 상태 재사용 또는 캐시 없으면 작업 시작.
- force_refresh=true 또는 1: 새 작업 시작. 이미 작업 중이면 동일 작업 공유.
- HTTP 202: status=loading. 작업 진행을 2초 간격 조회하며 charts에 완료된 이미지가 포함된다.
- HTTP 200: status=ready 또는 partial. 당일 이전 성공 자료를 refreshError와 함께 반환할 수도 있다.
- HTTP 502: status=error, 사용자 오류 메시지.
- HTTP 401: 기존 API 인증 미들웨어의 로그인 필요 오류.

응답 필드: id, date, capturedAt, status, error, charts. charts는 항상 은행 순서의 12개 항목이고 각 항목은 code, name, image, error를 가진다. image는 data:image/png;base64,... 또는 null이다.

작업은 HTTP 요청이 닫혀도 계속 진행하며 브라우저는 작업 종료 시 닫힌다. 서버 재시작은 작업과 캐시를 초기화한다.
