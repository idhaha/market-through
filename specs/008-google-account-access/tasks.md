# Tasks: Google 계정 접근 제어 및 프로필

**Input**: `/specs/008-google-account-access/`

## Implementation

- [x] T001 Google ID 토큰 검증, 허용 이메일 확인 및 서버 세션 발급 — `server.js`
- [x] T002 모든 데이터 API 앞에 세션 미들웨어를 배치하고 공개 인증 절차만 예외 처리 — `server.js`
- [x] T003 관리자 전용 허용 이메일 조회·등록·삭제 및 삭제된 계정 세션 폐기 — `server.js`
- [x] T004 로그인 전에 서버 세션을 확인하고 승인 이후에만 대시보드 데이터를 로드 — `public/app.js`
- [x] T005 프로필 아이콘, 허용 계정 관리 모달 및 하단 로그아웃 구현 — `public/index.html`, `public/app.js`, `public/style.css`
- [x] T006 허용 목록 파일을 Git 추적 대상에서 제외 — `.gitignore`
- [x] T007 API 공개·인증 계약, 관리 권한 및 세션 동작 문서화 — `contracts/api.md`

## Verification

- [x] T008 서버와 클라이언트 스크립트 구문 검사 및 `git diff --check`
- [ ] T009 브라우저에서 허용/미허용 계정 로그인, 관리자/일반 사용자 권한, 로그아웃 및 새로고침 동작 확인

> Google 연동 및 UI 동작의 최종 확인은 브라우저에서 실제 계정으로 수행해야 한다.

## HTTPS 운영 확인 (2026-10-20 반영)

- [x] T010 운영 HTTPS 인증서 신뢰 검증 및 HTTP 200 확인 — 2026-10-19 외부 점검
- [x] T011 HTTP → HTTPS 301 이동 확인 — 2026-10-19 외부 점검
- [x] T012 무료 Let's Encrypt 인증서 발급 기관·당시 유효기간 기록 — `spec.md`
- [x] T013 `certbot.timer` 예약 및 `certbot.service` 연결 확인 — 사용자가 제공한 서버 출력
- [x] T014 HTTPS 요구사항과 갱신 점검 절차를 명세·계획·quickstart·운영 문서에 반영
- [ ] T015 서버에서 `sudo certbot renew --dry-run`을 실행하고 모든 대상 인증서의 모의 갱신 성공 확인
- [ ] T016 갱신 서비스 실행 로그와 갱신 설정을 확인해 오류 유무 및 갱신 후 Nginx 적용 방식 검증
- [ ] T017 운영 로그인 쿠키의 Secure 속성과 Nginx의 원래 HTTPS 프로토콜 전달 확인

T013은 예약 등록 확인이며 T015/T016의 성공을 의미하지 않는다. 이번 작업은 문서 반영으로, 서버 설정 변경·인증서 재발급은 수행하지 않았다.

## 로그인 세션 유지 (2026-10-24)

- [x] T018 [FR-006/016~020] SHA-256 해시 기반 파일 저장·재시작 복원, 7일 유지·시간당 연장·30일 상한 구현 — `auth-session-store.js`, `server.js`.
- [x] T019 [FR-018~020] 저장 실패 처리, 비공개 경로/Git 제외, 해당 세션 로그아웃·계정 전체 폐기 연결.
- [x] T020 [FR-021] 서버 여유 왼쪽 D-OO 표시와 1분 확인·만료 시 재로그인 화면 전환 구현.
- [x] T021 [FR-022] 한국 날짜 기준 브라우저 프로필별 D-7~D-1 하루 한 번 팝업 및 새로고침 중복 억제 구현.
- [x] T022 [SC-005~006] `auth-session-store.test.cjs`, `auth-session-status.test.cjs`, `auth-session-failure.test.cjs` 4개 테스트 및 변경 JS 구문 검사 통과.
- [x] T023 spec/plan/API 계약/quickstart/운영 기록 동기화.
- [ ] T024 운영 배포 후 실제 Google 재로그인, 서버 재시작 복원, 다중 PC 독립 세션, 헤더 배치·쿠키 Secure·일별 알림을 검증한다. 로컬 테스트로 운영 검증을 완료 처리하지 않는다.
