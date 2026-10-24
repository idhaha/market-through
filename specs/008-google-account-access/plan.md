# Implementation Plan: Google 계정 접근 제어 및 프로필

**Branch**: `008-google-account-access` | **Date**: 2026-10-03 | **Spec**: specs/008-google-account-access/spec.md

## Summary

Google Identity Services가 사용자 로그인을 처리하고, Express 서버는 Google ID 토큰을 검증한 뒤 허용 이메일에 한해 HttpOnly 세션 쿠키를 발급한다. `/api` 인증 미들웨어가 로그인, 세션 확인, 로그아웃 외의 API 요청을 보호한다. 고정 관리자인 `azikanbal@gmail.com`만 허용 이메일 목록을 관리하며, 프로필 모달에서 이메일 관리와 로그아웃을 제공한다.

## Technical Context

**Language/Version**: Node.js >= 18, 브라우저 vanilla JavaScript/CSS

**Primary Dependencies**: 기존 Express와 Axios, Google Identity Services; 신규 패키지 없음

**Storage**: `authorized_emails.json`은 서버 프로젝트 루트의 Git 제외 파일, 세션은 메모리 Map과 `data/auth-private/sessions.json`의 해시 기반 영속 저장

**Testing**: 세션 저장소·실패 처리·재인증 UI의 Node 테스트 4개와 구문 검사. 실제 Google 연동과 운영 확인은 `quickstart.md` 수동 시나리오로 구분한다.

**Target Platform**: Oracle Cloud + PM2 및 로컬 개발 서버, 최신 브라우저

**Local OAuth Development**: Google Identity Services 테스트를 위해 `http://localhost`와 실제 포트의 Authorized JavaScript origin을 등록한다. OAuth consent audience가 Testing이면 사용할 계정을 Test users에 추가한다. HTTP localhost 응답에는 `Referrer-Policy: no-referrer-when-downgrade`를 설정한다.

## Constitution Check

- **I. Spec-First**: PASS — 현재 구현을 확인한 brownfield 요구사항과 실제 라우트 계약을 문서화한다.
- **II. External API Resilience**: PASS — Google 토큰 검증 실패는 로그인만 거부하고 명확한 오류를 반환한다.
- **III. Secrets Isolation**: PASS — 허용 목록과 임시 파일은 `.gitignore`에서 제외한다. Google client ID는 비밀 자격 증명이 아닌 OAuth audience 식별자다.
- **IV. Solo-Maintainer Simplicity**: PASS — 기존 Express/Axios와 Node 내장 fs/crypto 기반 단일 프로세스 파일 세션을 사용한다. SQLite나 신규 패키지는 추가하지 않는다.
- **V. Agent-Agnostic Workflow**: PASS — 설계 및 계약은 일반 Markdown으로 관리한다.

## Project Structure

```text
specs/008-google-account-access/
├── spec.md
├── plan.md
├── tasks.md
├── quickstart.md
└── contracts/api.md
server.js       # 토큰 검증, 세션 및 API 접근 제어, 관리자 목록 API
public/index.html # Google 로그인 UI와 프로필 모달
public/app.js   # 로그인 요청, 세션 부팅 확인, 프로필 관리 UI
public/style.css # 프로필 아이콘 및 모달 스타일
.gitignore      # 허용 목록 파일 제외
```

## Design Decisions

- 클라이언트가 제출한 이메일이나 JWT payload를 신뢰하지 않고, Google에 ID token을 검증받은 서버 응답의 이메일만 사용한다.
- 인증 미들웨어는 Express의 모든 API 핸들러보다 먼저 등록한다. 로그인·세션 확인·로그아웃 세 경로만 통과시킨다.
- 관리 권한은 브라우저 UI 표시만으로 부여하지 않고 매 관리자 API 요청에서 서버가 확인한다.
- 세션은 HttpOnly 쿠키에 opaque random ID만 담고 서버에는 해시 키로 세션 정보를 보관하고 비공개 JSON에 영속화한다.
- 프로젝트 설정은 기존 단일 공용 파일을 유지하므로 허용된 여러 계정 사이에서 데이터 격리는 제공하지 않는다.

## HTTPS 운영 구성 (2026-10-20 문서 반영)

- 운영 TLS는 기존 Nginx에서 종료하고 Express로 프록시한다. 무료 Let's Encrypt 인증서를 사용한다. 이 문서 갱신으로 서버 설정을 변경하거나 인증서를 재발급하지 않는다.
- 외부에서 HTTPS 인증서 검증 및 HTTP 200, HTTP → HTTPS 301 이동을 2026-10-19 확인했다.
- 서버의 `certbot.timer`가 `certbot.service` 실행을 예약한 사실은 사용자 출력으로 확인했다. 예약은 갱신 성공과 구분한다. 모의 갱신과 실제 갱신 결과는 아직 미확인이다.
- `server.js`의 `setAuthCookie`는 `req.secure` 또는 `X-Forwarded-Proto: https`에 따라 Secure 쿠키를 설정한다. 프록시가 원래 프로토콜을 전달하는지 운영 점검에서 확인한다. 이번 대화에서는 실제 Nginx 설정 파일과 로그인 쿠키까지 확인하지 않았다.
- 인증서 파일과 개인키는 서버에서 관리하며 저장소에 추가하지 않는다. 자동 갱신 후 Nginx 적용은 갱신 설정·로그 및 제공 중인 인증서로 검증한다.
- 운영 원본 변경 시 Google OAuth 승인 원본과 독립창 허용 원본도 함께 검토한다. 기존 운영 원본은 유지한다.

## 세션 유지 설계 (2026-10-24)

- `auth-session-store.js`: 7일 슬라이딩 만료, 시간당 갱신, 최초 로그인+30일 상한, 해시 저장·원자적 교체·복원·삭제를 담당한다.
- `server.js`: 인증 조회, 쿠키 갱신 및 로그인/현재 세션 응답의 `user.reauthenticateAt`을 연결한다.
- `public/auth-session-status.js`: 1분마다 세션 확인 및 카운트다운 갱신, 한국 날짜별 D-7 알림을 처리한다. `unlockApp`이 최초 상태를 전달한다.
- 파일 디렉터리 0700/파일 0600을 요청한다. Windows ACL은 별도 관리 대상이다. 파일 암호화나 다중 프로세스 쓰기는 이번 범위가 아니다.
- 운영 배포 전 상태이며 기존 사용자는 배포 후 재로그인해야 한다. 일반 설정 백업에 세션을 포함하지 않는다.
