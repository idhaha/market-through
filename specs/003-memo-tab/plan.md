# Implementation Plan: 메모 탭 — 캘린더 및 리치 텍스트 메모

**Branch**: `003-memo-tab` | **Date**: 2026-09-29 | **Spec**: specs/003-memo-tab/spec.md

## Summary

메모 탭은 좌측 Google Calendar(FullCalendar + Google Identity Services) 연동과 우측 Quill 리치 텍스트 에디터를 결합한 2분할 작업공간이다. 캘린더는 Google API를 직접 호출(서버 경유 없음)하고, 메모는 브라우저 로컬 저장과 서버(`/api/settings`) 이중 저장 방식을 유지한다.

## Technical Context

**Language/Version**: 브라우저 ES(FullCalendar v6.1.10, Quill v1.3.6), 저장 경로는 기존 Express `/api/settings` 재사용

**Primary Dependencies**: FullCalendar, Quill, Google Identity Services(OAuth2 Implicit Flow) — 모두 CDN 로드, 프로젝트 자체 npm 의존성 추가 없음

**Storage**: 브라우저 `localStorage`(`memoContent_html`, `memoContent_delta`) + 서버 `user_settings_autosaved.json`(전체 스냅샷의 일부 필드로 포함)

**Testing**: 자동화 테스트 없음. quickstart.md로 수동 검증.

**Target Platform**: 브라우저(Google 계정 인증 필요), Oracle Cloud 서버

**Project Type**: 웹 서비스

**Performance Goals**: 저장 완료 피드백 3초 이내(SC-001), 새로고침 5초 이내(SC-003)

**Constraints**: 타이핑 중 자동 저장 금지(다중 PC 레이스 컨디션 방지, Constitution 원칙과 별개로 기존 설계 원칙). 숨김 탭 초기화 순서 주의(높이 0 에러 방지). 서비스 이메일 허용 목록과 Google Cloud OAuth 테스트 사용자 audience는 별개다. 현재 OAuth audience는 테스트 모드이며, 테스트 사용자로 등록되지 않은 이메일은 Calendar scope 사용이 Google에 의해 거부된다.

**Scale/Scope**: 1인 사용자, 개인 Google 계정 1개 기준

## Constitution Check

- **I. Spec-First**: PASS
- **II. External API Resilience**: PASS — Google 토큰 만료(401) 시 자동 재인증, 네트워크 단절 시 로컬 보존으로 유실 방지.
- **External OAuth Configuration**: Google Cloud `Testing` 상태에서는 OAuth 프로젝트 테스트 사용자만 Calendar scope를 승인받을 수 있다. `authorized_emails.json`은 이 Google Cloud 설정을 변경하지 않는다. 현재 `idhaha@gmail.com`은 Google 테스트 사용자로 추가하지 않기로 결정했으며, 이 계정의 캘린더 사용은 차단된 상태로 기록한다.
- **III. Secrets Isolation**: PASS — Google OAuth 클라이언트 ID/토큰은 브라우저 세션에서만 처리되며 서버에 저장하지 않음. `user_session` 로컬 키는 `user_settings_autosaved.json`에 포함되지 않음(3.1절 기준).
- **IV. Solo-Maintainer Simplicity**: PASS — 기존 CDN 라이브러리 조합 유지, 새 백엔드 컴포넌트 추가 없음.
- **V. Agent-Agnostic Workflow**: PASS

위반 없음.

## Project Structure

### Documentation (this feature)
```text
specs/003-memo-tab/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
└── quickstart.md
```

### Source Code (repository root)
```text
server.js                 # GET/POST /api/settings (메모 필드 포함 전체 스냅샷 저장)
public/
├── index.html             # tab_memo 마크업, FullCalendar/Quill CDN 스크립트
├── app.js                 # Quill 초기화, [Today] 버튼, Google OAuth 플로우, 캘린더 CRUD
└── style.css
```

**Structure Decision**: 기존 구조 유지. Google Calendar 연동은 서버를 거치지 않고 브라우저에서 Google API를 직접 호출하는 기존 방식을 유지(백엔드 프록시 불필요).

## Complexity Tracking
해당 없음.
