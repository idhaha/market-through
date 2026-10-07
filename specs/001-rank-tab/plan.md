# Implementation Plan: Rank 탭 — 실시간 종목 순위 모니터링

**Branch**: `001-rank-tab` | **Date**: 2026-09-29 | **Spec**: specs/001-rank-tab/spec.md

**Input**: Feature specification from `/specs/001-rank-tab/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Rank 탭은 거래대금 상위(키움), 실시간 조회 순위(키움), 대주가능 종목(한투 eFriend), 관심종목 하락률 순위 4개 패널을 하나의 화면에서 자동/수동 갱신으로 제공한다. 이미 `server.js`(백엔드 프록시·집계)와 `public/app.js`(프론트엔드 렌더링)로 구현·운영 중이며, 본 계획은 기존 아키텍처를 유지한 채 spec의 요구사항과 코드 간 정합성을 정리하는 것을 목적으로 한다.

## Technical Context

**Language/Version**: JavaScript (Node.js >= 20, CommonJS), 브라우저 ES 문법(빌드 단계 없음)

**Primary Dependencies**: express ^4.18.2(백엔드 라우팅), axios ^1.6.0(외부 API 호출), cors ^2.8.5, dotenv ^16.3.1(환경변수)

**Storage**: 영속 저장소 없음. 인증 토큰 및 시장구분 캐시는 서버 프로세스 메모리(변수/Map)에 보관하며, 서버 재시작 시 초기화된다.

**Testing**: 기존 패널은 quickstart.md 수동 검증 기록을 유지한다. 쏠림율 차트는 Node 테스트와 Puppeteer 모의 API 브라우저 테스트로 계산·연속조회·표시·자동 갱신을 검증한다. 실제 시장 데이터 검증은 별도로 기록한다.

**Target Platform**: Oracle Cloud Free Tier(Ubuntu) 서버에서 PM2로 상시 구동, 브라우저(데스크톱/모바일 반응형)로 접근

**Project Type**: 웹 서비스 — 단일 Express 서버가 API와 정적 프론트엔드(`public/`)를 함께 서빙
**Cross-feature UI ownership**: 전역 `전체조회` 및 작은 화면 `더 보기` 작업 메뉴는 공통 UI 동작의 Source of Truth를 이 feature의 spec에서 관리하며, 구현은 기존 `public/app.js`/`index.html`의 전역 컨트롤을 기준으로 한다.

**Performance Goals**: 초기 로드 5초 이내(SC-001), 자동 갱신 주기 오차 ±5초 이내(SC-002)

**Constraints**: 키움증권 REST API 초당 요청 제한(약 5회) 준수를 위해 종목별 상세 조회는 순차 처리 + 100ms 지연 적용. 각 패널 표시는 최대 20개 항목으로 제한.

**Scale/Scope**: 1인 운영자 기준 소규모 트래픽(동시 접속 수 명 이내로 가정). 대규모 동시 사용자 대응은 범위 밖.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Spec-First Documentation**: PASS — 본 plan은 spec.md와 실제 `server.js`/`public/app.js` 동작을 근거로 작성했다.
- **II. External API Resilience**: PASS — 기존 구현이 이미 한투 키 누락 시 빈 배열 반환, 시세 조회 실패 시 개별 패널만 실패 처리하는 방식을 따르고 있으며 본 계획도 이를 그대로 유지한다.
- **III. Secrets Isolation**: PASS — 키움/한투 API 키는 `.env`에서만 읽으며, 이 기능 구현에 새로운 민감정보 저장소를 추가하지 않는다.
- **IV. Solo-Maintainer Simplicity**: PASS — 새로운 프레임워크, DB, 메시지 큐 등 추가 없이 기존 Express 단일 서버 구조를 그대로 사용한다.
- **V. Agent-Agnostic Workflow**: PASS — 모든 산출물(spec, plan, research, data-model, contracts, quickstart)은 일반 Markdown이다.

위반 사항 없음 — Complexity Tracking 불필요.

## Project Structure

### Documentation (this feature)

```text
specs/001-rank-tab/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
server.js                    # Express 백엔드 — Rank 관련 라우트:
                              #   GET /api/transaction_rank
                              #   GET /api/stock
                              #   GET /api/watchlist_groups
                              #   GET /api/watchlist_rank
public/
├── index.html                # tab_rank 마크업 포함
├── app.js                    # Rank 패널 렌더링/자동갱신 로직 (loadData, loadTransactionRank 등)
└── style.css                 # Rank 테이블/상태 표시 스타일
docs/
└── reference/                 # 키움/한투 API 참고문서
.env                          # KIWOOM_APPKEY, KIWOOM_SECRETKEY, EFRIEND_* (git 미포함)
```

**Structure Decision**: 별도 프론트엔드/백엔드 분리 없이, 기존 단일 저장소·단일 Express 프로세스 구조를 그대로 유지한다(Option 1: Single project 변형 — 빌드 단계 없는 정적 프론트엔드를 백엔드가 직접 서빙). 차트 계산·연속조회는 `concentration-chart.js`, 브라우저 차트는 `public/concentration-chart.js`로 분리하고 기존 `server.js`와 `public/app.js`에 연결한다. 새 프레임워크나 DB는 추가하지 않는다.

## Complexity Tracking

> 해당 없음 — Constitution Check 위반 없음.

## 쏠림율 확장 계획 및 구현 정합성 (2026-10-07)

FR-010 및 FR-022~031을 추가 범위로 관리한다. 두 테이블은 공통 계산 함수를 사용하고 시장 판별 실패를 null로 전달한다. 인증된 `POST /api/concentration-chart`는 사용자별 메모리 커서로 종목·시장 연속조회를 관리한다. 세션은 마지막 성공부터 30분 유효하며 서버 재시작 시 초기화된다. 원천별 50,000봉 상한과 한 요청당 시장 추가 12페이지 제한을 적용한다.

일봉은 실제 거래대금, 분봉은 사용자 지정 시장 거래대금 추정식을 사용한다. 코스피 001·코스닥 101을 선택하고 09:00 기준 시간 구간을 정렬한다. 시장 15·45분은 5분, 60분은 30분을 합산한다. 계산 계약은 contracts/api.md, 데이터 구조는 data-model.md에 둔다.

브라우저는 기존 정적 JavaScript와 canvas로 선·격자·드래그 영역을 그린다. 로딩 중 기존 그림을 보존하고 블러를 적용한다. 자동 갱신은 기존 Rank 타이머를 공유하며 최신 페이지를 과거 기록에 병합하고 확대 구간을 유지한다. 요청 취소와 응답 버전 검사로 종목 변경 경합을 방지한다.

추가 소스: `concentration-chart.js`, `public/concentration-chart.js`, `tests/concentration-chart.test.js`, `tests/concentration-chart-ui.test.js`. 상세 구현 참고: ../../docs/CONCENTRATION_CHART.md. 기존 SC-001~004 미검증 항목은 차트 테스트 통과와 별개로 유지한다.

분봉 X축은 하루 전체 또는 120봉 이하 구간에서 시간만 표시하며 매시 경계를 기준으로 눈금을 배치한다. 좁은 화면에서는 눈금 간격을 늘리고 툴팁·하단 기간의 분 표시는 유지한다.

분봉 X축은 전체 보기에서 시간만 표시하고, 확대 후 인접 눈금 사이에 충분한 여유가 있으면 30분 간격(09:00·09:30 등)으로 표시한다. 화면이 좁으면 매시 또는 더 넓은 간격을 유지한다.

분봉 X축 눈금에는 시·분 접미사를 붙이지 않는다. 매시 간격은 09·10처럼, 30분 간격은 09:00·09:30처럼 표시한다.
