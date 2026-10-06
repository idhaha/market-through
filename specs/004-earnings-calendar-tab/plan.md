# Implementation Plan: 증시캘린더 탭 — 경제지표·실적 일정

**Branch**: `004-earnings-calendar-tab` | **Date**: 2026-09-29 | **Spec**: specs/004-earnings-calendar-tab/spec.md

## Summary

증시캘린더 탭은 토스증권 캘린더 페이지를 같은 출처(same-origin) iframe으로 임베드하기 위해, 서버가 HTML/정적 리소스/API 응답을 모두 프록시하며 URL을 임베드 출처에 맞게 재작성한다. 신규 개발이 아닌 기존 구현 문서화다.

## Technical Context

**Language/Version**: Node.js >= 18(Express 프록시), 브라우저 iframe

**Primary Dependencies**: axios(HTML/API/정적 리소스 프록시)

**Storage**: 없음(매 요청 시 원본에서 조회)

**Testing**: 자동화 테스트 없음. quickstart.md로 수동 검증.

**Target Platform**: Oracle Cloud + PM2, 브라우저

**Project Type**: 웹 서비스

**Performance Goals**: 당월 일정 10초 이내 표시(SC-001), 필터 적용 1초 이내(SC-002)

**Constraints**: 프록시 허용 호스트는 `tossinvest.com`, `toss.im` 하위 도메인으로 제한. API 프록시 응답 최대 20MB, 타임아웃 15초. HTML 프록시 타임아웃 10초.

**Scale/Scope**: 1인 사용자, 외부 서비스(토스증권) 가용성에 의존

## Constitution Check

- **I. Spec-First**: PASS
- **II. External API Resilience**: PASS — 토스 구조 변경 시에도 서버가 크래시하지 않고 콘텐츠가 비게 되는 것으로 문서화된 기존 동작 유지.
- **III. Secrets Isolation**: PASS — 이 기능은 API 키 없이 공개 페이지를 프록시.
- **IV. Solo-Maintainer Simplicity**: PASS — 기존 프록시 방식 유지, 별도 스크래핑 프레임워크 도입 없음.
- **V. Agent-Agnostic Workflow**: PASS

위반 없음.

## Project Structure

### Documentation (this feature)
```text
specs/004-earnings-calendar-tab/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
└── quickstart.md
```

### Source Code (repository root)
```text
server.js                 # GET /calendar (HTML 프록시+URL 재작성)
                           # POST /api/toss_calendar_proxy (월별/주간요약 API 프록시)
                           # GET /api/toss_calendar (호환 경로)
                           # 정적/이미지 프록시 라우트 (/assets/v2/...)
public/
├── index.html             # tab_earnings 마크업, iframe 컨테이너
├── app.js                 # refreshEarningsTab, iframe 새로고침 로직
└── style.css
```

**Structure Decision**: 기존 구조 유지. HTML/자산/API 프록시 로직은 `server.js` 내 기존 라우트에서 계속 확장.

## Complexity Tracking
해당 없음.
## Current refresh policy — 2026-10-06

기존 about:blank와 100ms 지연 재로드 및 새로고침 완료 문구 설명은 과거 기록이다. 현재는 공급자 전용 iframe을 보존하고 당일 재진입/자동 갱신을 억제하며 새로고침 버튼으로 현재 공급자의 src를 다시 설정한다. load 이벤트 후 캘린더 표시 중으로 안내한다. 현재 구현과 검증 범위는 ../007-multi-source-market-calendar/plan.md 및 quickstart.md를 따른다.
