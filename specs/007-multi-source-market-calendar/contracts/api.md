# API Contract: 중앙은행 테이블 이미지

## GET /api/central-banks/image

기존 /api 인증 미들웨어 적용: 로그인 세션 필요. 요청 URL/쿼리로 외부 캡처 대상을 지정하지 않으며 소스는 서버의 고정 Investing.com 중앙은행 URL이다. 선택 쿼리 force_refresh=true 또는 1은 당일 캐시를 우회하여 새로 캡처한다. 생략 또는 다른 값은 당일 캐시를 재사용한다. 이미 진행 중인 캡처는 강제/일반 요청 모두 공유한다.

### Success — HTTP 200

- Content-Type: image/png
- Cache-Control: private, no-store
- Content-Disposition: inline; filename="world_central_banks.png"
- X-Capture-Date: 한국시간 YYYY-MM-DD
- X-Captured-At: ISO 시각
- Body: 테이블만 포함한 PNG 바이너리

world_central_banks.png는 응답 파일명이며 서버 디스크에 저장되는 파일이 아니다. 서버 당일 메모리 캐시가 있으면 동일 캡처를 반환한다. 진행 중 요청은 하나의 캡처 Promise를 공유한다.

### Errors

- HTTP 401: 기존 인증 미들웨어의 JSON 오류, success=false 및 로그인 필요 메시지.
- HTTP 502: success=false, error='중앙은행 금리 이미지를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.'

실패 결과는 성공 캐시로 저장하지 않는다. 화면은 오류 메시지와 새로고침 재시도 안내를 제공한다.

## 요청 구분

- 일반 진입: GET /api/central-banks/image — 당일 성공 캐시 재사용.
- 새로고침 버튼: GET /api/central-banks/image?force_refresh=true — 당일 캐시 우회 후 재캡처. force_refresh=1도 동일하다.
- 이미 캡처 중이면 추가 브라우저를 실행하지 않고 해당 결과를 공유한다.
- 강제 캡처 실패 시 해당 요청은 HTTP 502로 응답하고 기존 성공 캐시는 보존한다.

## 오류 진단 보완 — 2026-10-06

캡처 실패의 HTTP 502 JSON에는 stage(browser/navigation/table/screenshot/unknown)를 추가한다. error는 해당 단계의 사용자 안내이며 상세 예외는 서버 로그의 [Central Banks] stage= 항목으로 기록한다. 프록시/누락 라우트의 비JSON 오류는 화면이 HTTP 상태(401/404/502/504)를 함께 표시한다.
