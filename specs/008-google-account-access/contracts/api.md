# API Contracts: Google 계정 접근 제어

기본적으로 `/api` 경로의 모든 요청은 유효한 서버 세션 쿠키를 요구한다. 예외는 아래 로그인 세션 절차뿐이다. `OPTIONS` preflight는 CORS 미들웨어에서 처리된다.

## POST /api/auth/login

**Auth**: 공개

**Request body**: `{ "credential": <Google ID token> }`

**Response 200**: `{ "success": true, "user": { "email": string, "name": string, "picture": string, "isAdmin": boolean, "reauthenticateAt": number } }`

**Response 400**: credential 누락 또는 문자열이 아님

**Response 401**: Google 토큰 검증 실패, audience 불일치, 이메일 미확인 또는 만료

**Response 403**: Google 인증은 유효하지만 이메일이 허용 목록에 없음

**Side effect**: `azikanbal_session` HttpOnly 쿠키 설정, 최초 7일 만료, 인증 요청에서 시간당 갱신하되 최초 로그인부터 30일 상한. HTTPS 요청에는 Secure 속성 포함.

## GET /api/auth/session

**Auth**: 공개 조회 절차; 유효 쿠키가 있으면 현재 허용 상태도 재검사

**Response 200**: `{ "authenticated": true, "user": { "email": string, "name": string, "picture": string, "isAdmin": boolean, "reauthenticateAt": number } }`

**Response 401**: `{ "authenticated": false }`

## POST /api/auth/logout

**Auth**: 공개 세션 종료 절차

**Response 200**: `{ "success": true }`

**Side effect**: 현재 세션을 제거하고 세션 쿠키 만료 처리.

## GET /api/auth/users

**Auth**: `azikanbal@gmail.com` 관리자 세션

**Response 200**: `{ "success": true, "emails": string[] }` (관리자 이메일 포함)

**Response 401**: 세션 없음 또는 만료

**Response 403**: 일반 허용 계정

## POST /api/auth/users

**Auth**: `azikanbal@gmail.com` 관리자 세션

**Request body**: `{ "email": string }`

**Response 200**: `{ "success": true, "emails": string[] }`

**Response 400**: 이메일 형식 오류

**Response 409**: 중복 이메일 또는 관리자 이메일 재등록

**Persistence**: `authorized_emails.json`을 원자적 파일 교체 방식으로 저장한다. 파일은 Git에서 제외한다.

## DELETE /api/auth/users/:email

**Auth**: `azikanbal@gmail.com` 관리자 세션

**Response 200**: `{ "success": true, "emails": string[] }`

**Response 400**: 초기 관리자 계정 삭제 시도

**Response 404**: 허용 목록에 없는 이메일

**Side effect**: 허용 목록에서 제거하고 해당 계정의 메모리·파일 세션을 폐기한다.

## Other /api routes

로그인·세션 확인·로그아웃을 제외한 모든 `/api` 엔드포인트는 유효한 허용 계정 세션이 필요하다. 인증이 없거나 허용 목록에서 제거된 경우 `{ "success": false, "error": "로그인이 필요합니다." }`와 HTTP 401을 반환한다. 이 인증은 계정별 설정 데이터 분리를 의미하지 않으며 기존 서버 설정은 공용이다.

## 운영 HTTPS 전송 계약

- 운영 HTTP 접속은 Nginx에서 HTTPS로 HTTP 301 이동한다. 운영 HTTPS 접속의 인증서는 Let's Encrypt 발급이며 2026-10-19 외부 신뢰 검증과 HTTP 200 응답을 확인했다.
- TLS 인증서 발급·갱신은 서버 운영 계층의 책임이다. Express에 별도의 인증서 관리 API를 추가하지 않는다.
- HTTPS 프록시 요청은 원래 프로토콜을 Express에 전달해야 한다. 현재 쿠키 코드는 `req.secure` 또는 `X-Forwarded-Proto: https`이면 Secure 속성을 붙인다. 실제 Nginx 전달 설정 및 로그인 응답 쿠키 확인은 미완료다.
- 로컬 HTTP 개발을 위한 기존 동작은 유지한다. 인증서 개인키는 API 응답이나 저장소에 포함하지 않는다.

## 세션 영속화 및 기한 계약 (2026-10-24)

- `user.reauthenticateAt`은 최초 로그인부터 30일 뒤의 Unix epoch 밀리초다. 시간당 연장이나 서버 재시작으로 변경하지 않는다.
- 현재 세션 조회도 정상 인증 요청이며 슬라이딩 갱신 대상이다. 서버가 세션을 검사할 때 쿠키 수명을 실제 만료까지로 설정한다.
- 세션 발급은 파일 저장 성공 후 응답한다. 현재 구현에서 저장 실패는 로그인 핸들러의 401 오류 경로로 처리된다. 갱신 저장 실패는 기존 세션 만료를 유지한다.
- 로그아웃 저장 실패는 HTTP 503과 오류 메시지를 반환하며 성공 응답으로 처리하지 않는다.
- 로그인·세션 응답은 `Cache-Control: no-store`이며 원본 토큰이나 해시는 JSON 응답에 포함하지 않는다. 원본은 HttpOnly 쿠키로만 전달한다.
