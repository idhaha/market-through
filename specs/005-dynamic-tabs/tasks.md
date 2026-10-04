# Tasks: 동적 탭 — 사용자 정의 차트 탭

**Input**: Design documents from `/specs/005-dynamic-tabs/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: 브라운필드 검증 작업. quickstart.md로 검증.

## Phase 1: Setup

- [x] T001 `+` 메뉴에 차트 그리드, 해외종목 커스텀, 환율/금리 커스텀 3가지 유형을 추가 — `public/index.html`, `public/app.js`

## Phase 2: Foundational

**⚠️ CRITICAL**

- [x] T002 기존 스냅샷과 호환되도록 생성 시각 기반 ID, 배열형 차트 그리드 데이터 및 객체형 커스텀 탭 구조를 data-model.md에 정확히 반영 — `public/app.js`, `specs/005-dynamic-tabs/data-model.md`
- [x] T003 [P] 개별 데이터 소스 실패가 탭 전체에 영향을 주지 않는 격리 구조(FR-007)가 공통으로 적용되어 있는지 확인 — `public/app.js`
- [x] T003a `fred_api.py`, `requirements.txt`가 프로젝트 루트에 존재하는지 확인 — 파일 존재 확인 완료. Python 의존성 설치/실행은 후속 런타임 검증에 남김.

**Checkpoint**: 탭 생명주기/격리 공통 로직 검증 완료

---

## Phase 3: User Story 1 - 차트 그리드 탭 추가 (Priority: P1) 🎯 MVP

**Goal**: 차트 그리드 탭 추가 후 1초 이내 사용 가능, TradingView/Investing.com 전환 가능

**Independent Test**: `+` → `Dynamic 차트` 선택 시 기본 심볼 4종이 채워지는지 확인

### Implementation for User Story 1

- [x] T004 [US1] 기본 심볼 4종(`FX_IDC:USDKRW`, `KRX:KOSPI`, `KRX:KOSDAQ`, `BINANCE:BTCUSDT`, FR-002)이 정확한지 확인 — `public/app.js`
- [x] T005 [P] [US1] TradingView ↔ Investing.com 전환이 저장 모드 `main`/`sub`와 `mainSrc`/`subSrc`에 반영되는지 data-model.md에 구현 기준으로 기록 — `public/app.js`, `specs/005-dynamic-tabs/data-model.md`
- [x] T006 [US1] 심볼 입력 후 [이동] 클릭 시 `getDirectTradingViewUrl` 임베드 갱신을 확인 — `public/app.js`
- [x] T007 [US1] 새 탭이 생성 직후 활성화되고 저장되는지(FR-005) 확인 — `public/app.js`
- [x] T008 [US1] `+` 메뉴에 누락된 환율/금리 커스텀 탭 생성을 추가하고, 기존 저장 데이터는 호환 유지 — `public/index.html`, `public/app.js`
- [ ] T009 [US1] quickstart.md 시나리오 1~3 실행 후 SC-001 확인

**Checkpoint**: User Story 1 독립적으로 동작

---

## Phase 4: User Story 2 - 해외종목/환율·금리 커스텀 탭 (Priority: P2)

**Goal**: 사용자 정의 문법으로 여러 데이터 소스를 구획별로 렌더링

### Implementation for User Story 2

- [x] T010 [US2] `parseCustomCharts` 문법 파싱(구획, 쌍/삼중항 판별)이 spec.md의 문법 예시대로 동작하는지 확인 — `public/app.js`
- [x] T011 [P] [US2] Finviz/TradingEconomics/FRED/ECOS 응답 계약을 실제 서버/프론트가 사용하는 envelope와 일치시킴 — `specs/005-dynamic-tabs/contracts/api.md`
- [x] T012 [US2] 개별 항목 실패 시 나머지 항목이 정상 로드되는지(FR-007) 확인 — `public/app.js`
- [x] T013 [US2] 빈 설정 시 "등록된 차트가 없습니다" 안내가 표시되는지 확인 — `public/app.js`
- [x] T014 [US2] T010~T013 코드 검토 및 API 계약 보정 완료. 외부 소스 런타임 검증은 T015에 남김 — `specs/005-dynamic-tabs/contracts/api.md`
- [ ] T015 [US2] quickstart.md 시나리오 4~5 실행 후 SC-002, SC-003 확인

**Checkpoint**: User Story 1, 2 모두 독립적으로 동작

---

## Phase 5: User Story 3 - 동적 탭 관리 (Priority: P3)

**Goal**: 드래그 순서 변경, 더블클릭 이름 변경, 우클릭 삭제가 정상 동작

### Implementation for User Story 3

- [ ] T016 [US3] 드래그 순서 변경 결과가 저장되는지(FR-006) 확인 — `public/app.js`
- [ ] T017 [US3] 더블클릭 이름 변경 및 고정 탭 제외 처리(FR-006)를 확인 — `public/app.js`
- [ ] T018 [US3] 우클릭 삭제 확인 대화상자 및 데이터 정리(FR-006)를 확인 — `public/app.js`
- [x] T019 [US3] T016~T018 코드 검토에서 확인된 불일치 없음 — `public/app.js`
- [ ] T020 [US3] quickstart.md 시나리오 6 실행

**Checkpoint**: 3개 User Story 모두 독립적으로 동작

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T021 [P] 캡처 모드 중 동적 탭 로드/새로고침 억제(FR-009) 확인 — `public/app.js`
- [x] T022 같은 탭 내 캔버스 차트 간 커서/줌 동기화 범위(FR-008)가 외부 iframe까지 확장되지 않음을 확인 — `public/app.js`
- [ ] T023 quickstart.md 전체 시나리오 최종 실행
- [x] T024 [US2] FRED 관측치를 영속 디스크 캐시에 저장하고 재시작 시 불러오며, 키별 월별 전체 조회·월중 증분 병합·30일 겹침·실패 표식 보존을 구현 — `server.js`, `fred_api.py`
- [x] T025 [US2] 신규 FRED 시리즈 최초 전체 조회, 입력에서 제거된 캐시 보존, 1년 미사용 시리즈의 전체 기간 캐시 정리 정책을 문서화하고 구현 — `.gitignore`, `specs/005-dynamic-tabs/`
- [ ] T026 [US2] Quickstart 시나리오 11~13에서 재시작 유지, 월별/증분 갱신, 신규·삭제 후 재등록 및 1년 미사용 시리즈 정리를 수동 검증
- [x] T027 [US2] 서버 TE 수집을 Chrome 동시 1개로 제한하고, 한도 초과 시 추가 실행 없이 실패 처리하며, 종료 후 슬롯을 반납(FR-022) — `server.js`
- [x] T028 [US2] 화면에서 TE 요청을 전역 대기열로 한 번에 1개씩 전송(FR-023) — `public/app.js`
- [x] T029 [US2] FRED 사용 시각의 디스크 저장을 5분 주기로 변경하고 `fred_api.py` 동시 실행을 2개로 제한(FR-019, FR-020) — `server.js`
- [ ] T030 [US2] 운영 서버에서 TE/FRED 차트를 한꺼번에 로딩하며 `free -m`, `ps`로 Chrome 동시 1개와 메모리 안정을 확인(SC-004)
- [ ] T031 [US2] quickstart.md 시나리오 14~16(TE 순차 로딩, 운영 서버 Chrome 1개 확인, FRED 사용 시각 5분 저장) 수동 검증 — 시나리오는 추가 완료 — `specs/005-dynamic-tabs/quickstart.md`

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2(US1과 독립적) → US3(탭 존재 전제, US1/US2 완료 후 검증 권장) → Polish

## Notes

- 커스텀 문법 파서는 휴리스틱 기반임을 검증 시 전제하고, "의도와 다르게 해석되는" 사례는 버그가 아니라 문서화된 한계(Assumptions)로 분류한다.

---

## Verification Log — 2026-09-30

> 원칙: 명세와 구현 불일치를 보정했다. 브라우저/외부 서비스에서만 확인 가능한 항목은 `⏳`로 남겼다.

| Task | 결과 | 검증 내용 |
|---|---|---|
| T001 | 🟢 | `+` 메뉴에 Static(해외종목), Dynamic(그리드), 금리/환율(커스텀) 탭 생성 항목이 있다. |
| T002 | 🟢 | 생성 ID와 기존 저장 구조를 하위 호환성 보존을 위해 data-model.md에 명시했다. |
| T003 | 🟢 | 이미지 로드는 `onerror`에서 해당 항목만 완료 처리하고, 다중 시리즈도 항목별 로드/예외 처리가 존재하여 개별 실패가 전체 로드를 중단하지 않는 구조입니다. |
| T003a | 🟡 | 프로젝트 루트에 `fred_api.py`, `requirements.txt`가 있음을 확인했다(2026-10-04 `git ls-files`). 로컬에서는 FRED 차트가 정상 표시됐다. 운영 서버에서의 Python 실행은 T030에서 확인한다. |
| T004 | 🟢 | 기본 심볼 4종은 `FX_IDC:USDKRW`, `KRX:KOSPI`, `KRX:KOSDAQ`, `BINANCE:BTCUSDT`로 구현되어 있습니다. |
| T005 | 🟢 | TradingView/Investing 전환은 `main`/`sub`로 저장된다. 추가 AlphaSquare 바로가기도 spec에 명시했다. |
| T006 | 🟢 | [이동]은 `loadChartFromInput()`을 호출하며 TradingView URL 갱신 경로가 존재합니다. |
| T007 | 🟢 | 새 탭 생성 직후 `createTabButtonElement` → `createTabContentElement` → `activateTab` 순으로 활성화하고 `saveAppData()`를 호출합니다. |
| T008 | 🟢 | 누락된 환율/금리 탭 생성 메뉴를 추가했다. 기존 차트 그리드 스냅샷을 바꾸지 않았다. |
| T009 | ⏳ | quickstart 시나리오 1~3 및 1초 이내(SC-001)는 브라우저 실행 검증이 필요합니다. |
| T010 | 🟢 | `parseCustomCharts()`가 구획(`<...>`), 쌍/삼중항, 레거시 형식을 휴리스틱으로 분기합니다. 문서화된 휴리스틱 한계와도 일치합니다. |
| T011 | 🟢 | 계약 문서를 서버와 프론트가 사용하는 응답 형식에 맞췄다. 외부 API 정상 응답은 런타임 검증에 남겼다. |
| T012 | 🟢 | 이미지와 다중 시리즈 데이터 모두 개별 항목의 실패를 전체 탭 실패로 전파하지 않도록 처리하는 코드가 있습니다. |
| T013 | 🟢 | 빈 설정/해석 결과가 없을 때 `등록된 차트가 없습니다` 안내를 렌더링합니다. |
| T014 | 🟢 | 코드상 추가 불일치는 확인되지 않았으며, API 계약 문서를 구현과 일치시켰다. |
| T015 | ⏳ | quickstart 시나리오 4~5와 SC-002/SC-003은 실제 브라우저 및 외부 데이터 소스 검증이 필요합니다. |
| T016 | 🟢 | 드래그 종료 시 `saveAppData()`를 호출하고, 드래그 대상에서 `data-perm` 탭을 제외합니다. |
| T017 | 🟢 | 더블클릭 이름 변경 및 `saveAppData()`가 구현되어 있으며 `data-perm`은 대상에서 제외됩니다. |
| T018 | 🟢 | 우클릭 메뉴에서 확인 후 DOM 제거 + `delete tabData[tabId]` + `saveAppData()`가 수행됩니다. 고정 탭은 삭제 대상에서 제외됩니다. |
| T019 | 🟢 | T016~T018의 코드 경로는 정적 검토 기준 충족한다. |
| T020 | ⏳ | quickstart 시나리오 6의 실제 드래그/이름변경/삭제 동작은 브라우저 검증이 필요합니다. |
| T021 | 🟢 | `isCapturing` 검사로 `refreshOverseasCustomCharts()` 및 `refreshExchangeRateCharts()` 등 동적 데이터 로드를 캡처 중 건너뛰도록 되어 있습니다. |
| T022 | 🟢 | 커서/줌 동기화 대상은 `canvas[data-chart-type="multi-series"]`, `canvas[data-chart-type="te-single"]`로 한정되어 외부 iframe은 동기화 대상에 포함되지 않습니다. |
| T023 | ⏳ | 전체 quickstart 최종 실행은 브라우저 검증이 필요합니다. |
| T024 | 🟢 | FRED 캐시는 디스크에서 불러오고 저장한다. 신규 키와 월별 첫 조회는 전체 지정 기간을 받고, 같은 달 후속 조회는 30일 겹침 구간부터 가져와 날짜 기준으로 병합한다. 갱신 실패는 완료 월을 기록하지 않으며 기존 자료가 있으면 stale 자료를 제공한다. |
| T025 | 🟢 | 신규 시리즈는 전체 조회로 초기화하고, 입력에서 제거된 캐시는 보존한다. 1년간 미사용한 시리즈는 모든 기간 캐시가 정리되어 이후 재조회 시 전체 기간을 다시 가져온다. |
| T026 | ⏳ | 외부 FRED API, 서버 재시작 및 1년 미사용 시리즈 정리를 포함하는 수동 검증은 아직 수행하지 않았다. |

### Modification Pending

코드/문서에서 확인된 명세 불일치는 수정했다. 남은 항목은 사용자 브라우저와 외부 데이터 소스가 필요한 검증이다.

### Runtime / External Verification Pending

- T003a: Python 의존성 설치 및 실행
- T009: Dynamic 차트 생성 및 TradingView/Investing 전환
- T015: Static/커스텀 차트 실제 데이터 및 실패 격리
- T020: 탭 관리 UI 실제 동작
- T023: 전체 quickstart

### 참고

- `+` 메뉴는 이제 차트 그리드, 해외종목 커스텀, 환율/금리 커스텀을 직접 생성합니다.
- `data-model.md`는 차트 그리드의 기존 배열 스키마와 `mode=main|sub`를 호환 구조로 설명합니다.

## 2026-10-01 Implementation Status

누락됐던 환율/금리 커스텀 탭 생성 메뉴와 생성·저장 경로를 추가했다. 차트 그리드의 기존 저장 형식은 하위 호환을 유지하며 data-model에 문서화했고, FRED/ECOS/TradingEconomics API 계약을 실제 프론트/서버 응답 envelope에 맞췄다. 문서에 기록된 불일치 수정은 완료했으며, 브라우저/외부 서비스 및 Python 의존성 실행 검증은 사용자가 요청한 후속 검증 단계까지 보류한다.


## 2026-10-01 추가 브라우저 검증

- **T004 🟢 + 주의:** 새 차트 2에는 명세의 네 심볼이 기본 입력됐다. TradingView 임베드에서는 KRX:KOSPI와 KRX:KOSDAQ가 이 심볼은 존재하지 않습니다 / TradingView에서만 제공되는 심볼 오류를 보였다. 값 자체는 명세와 같으나 기본 위젯에서 두 지수가 표시되지 않는 동작상 문제를 기록한다.
- **T006 🟢:** 테스트 탭의 첫 차트에 NASDAQ:AAPL 입력 후 [이동]을 눌렀고 TradingView iframe URL이 해당 심볼로 갱신됐다. 전체 페이지 재로드 후 이 입력은 기본값으로 돌아왔다.
- **T007 🟢:** 차트 2가 생성 직후 active 상태였고, 페이지 재로드 후 탭과 네 기본 심볼이 서버 설정에서 복원됐다.
- **T009 부분:** quickstart 1~3 중 기본 탭 생성/심볼 적용/TradingView↔Investing.com 전환은 확인했다. 1초 기준 측정은 하지 않았다.
- 제공처 전환 확인을 위해 차트 2를 테스트 생성했으며, 이 탭은 재로드 후에도 설정에 남아 있다. 사용자가 원하면 정리한다.

## 2026-10-04 TE/FRED 서버 자원 정책 반영

> 배경: 2026-10-03~04 서버 정지(504) 장애에서 Chrome이 동시에 약 5개 실행되어 RAM 1GB 서버가 메모리 부족이 되었다. 상세는 `docs/operations/server-runbook.md` 참고.

| Task | 결과 | 검증 내용 |
|---|---|---|
| T027 | 🟢 | 한도 초과 시 45초 대기 후 Chrome을 추가로 띄우지 않고 실패 처리하며, 슬롯은 Chrome 종료(10초 후 강제 종료) 뒤에 반납하도록 수정했다. 운영 서버의 `server.js` 1834행에서 `MAX_BROWSERS = 1`을 확인했다. 한도 초과·슬롯 반납 로직은 모의 코드로 단위 검증했다. |
| T028 | 🟢 | `queueTeRequest` 전역 대기열을 적용했다. 모의 코드로 5개 동시 요청이 1개씩 순서대로 실행되고 중간 실패가 뒤 요청을 막지 않음을 확인했다. 로컬 브라우저에서 TE/FRED 8개 차트가 모두 표시됨을 사용자가 확인했다. |
| T029 | 🟢 | `markFredCacheUsed`는 메모리에만 기록하고 변경 시 5분 주기로 저장하도록 바꿨다. `fred_api.py` 동시 실행을 2개로 제한했다(모의 코드로 최대 동시 2개 확인). |
| T030 | ⏳ | 운영 서버에서 TE/FRED 차트를 동시에 열었을 때의 Chrome 개수와 메모리는 아직 확인하지 않았다. 서버 재부팅 후 유휴 상태에서는 앱이 정상 기동했다. |
| T031 | 🟡 | 시나리오 14~16을 quickstart.md에 추가했다. 수동 검증은 아직 수행하지 않았다(시나리오 15는 T030과 같은 운영 서버 확인). |

### 참고

- `contracts/api.md`, `research.md`, `data-model.md`, `quickstart.md`를 같은 날 코드에 맞게 갱신했다(TE/FRED/ECOS 오류 응답과 쿼리, 인증 필수, 캐시 구조, 자원 정책 결정 기록, 새 시나리오).
- 코드 대조 결과 spec에 없던 서버 동작을 FR-018~FR-023으로 추가했다. 기간별 일수(3650/1825/730/365/180), UTC 월 경계, stale 응답, 정리 대상 규칙(사용 시각 없음)이 해당한다.
- `data/fred-cache/`는 `git ls-files`에 없다(2026-10-04 확인).

### 알려진 한계

- TE 차트가 많은 탭은 한 번에 1개씩 로딩되어 전체 시간이 길다.
- FRED 사용 시각은 5분 주기로 저장되므로 그 사이 서버가 종료되면 최근 사용 시각이 유실될 수 있다(1년 기준 정리에는 영향이 거의 없음).
