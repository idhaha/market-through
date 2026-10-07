# Tasks: Rank 탭 — 실시간 종목 순위 모니터링

**Input**: Design documents from `/specs/001-rank-tab/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: 기존 패널은 quickstart.md 수동 검증 기록을 유지한다. 추가된 쏠림율 차트는 계산·연속조회 Node 테스트 및 Puppeteer 모의 API 통합 테스트로 검증한다.

**Organization**: 사용자 스토리별로 그룹화. 각 스토리는 "코드가 spec/contracts와 일치하는지 검증 → 불일치 수정 → quickstart 확인" 순서를 따른다.

## Phase 1: Setup

- [x] T001 `.env`에 `KIWOOM_APPKEY`, `KIWOOM_SECRETKEY`가 설정되어 있는지 확인 (루트 `.env`)
- [x] T002 [P] `npm ci`로 `package.json` 의존성이 정상 설치되는지 확인

**Checkpoint**: 서버 실행 가능 상태 확보

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: 이 단계 완료 전에는 User Story 작업을 시작할 수 없음

- [x] T003 Kiwoom OAuth 토큰 캐싱 로직(`cachedToken`, `tokenExpiryTime`)이 research.md의 "토큰 재사용, 무효화 시 즉시 폐기" 결정과 일치하는지 `server.js`에서 확인
- [x] T004 [P] 시장 구분(KOSPI/KOSDAQ) 캐시가 4개 패널(거래대금/실시간순위/대주가능/관심종목)에서 공유되는지 `server.js`에서 확인 (data-model.md "관계 및 상태" 참고)
- [x] T005 [P] 종목별 상세 조회 순차 처리 + 100ms 지연 로직이 `server.js`에 구현되어 있는지 확인 (FR-015)

**Checkpoint**: 공통 인프라 검증 완료 — User Story별 작업 시작 가능

---

## Phase 3: User Story 1 - 거래대금·실시간 조회 순위 확인 (Priority: P1) 🎯 MVP

**Goal**: 거래대금 상위·실시간 조회 순위 패널이 자동/수동 갱신되며 5초 이내 초기 표시

**Independent Test**: Rank 탭 진입 시 두 패널에 각 20개 항목이 표시되고, 새로고침 주기 변경/수동 조회가 동작하는지 확인

### Implementation for User Story 1

- [x] T006 [US1] `GET /api/transaction_rank` 응답 필드가 contracts/api.md와 일치하는지 확인 (`rank`, `stk_cd`, `stk_nm`, `mkt_type`, `fluc_rt`, `trde_amt`, `concentration_rate`) — `server.js`
  - 검증 완료: `/api/transaction_rank`가 실제 실행 결과에서 `items` 배열을 반환하는 것을 확인함.
- [x] T007 [US1] `GET /api/stock`의 rank 응답이 data-model.md의 WatchRankEntry 필드와 일치하는지 확인 — `server.js`
  - 검증 완료: Kiwoom `item_inq_rank` 원본에서 `bigd_rank`, `stk_cd`, `stk_nm`, `base_comp_chgr` 필드를 확인했고, 서버에서 `mkt_type`, `trde_amt`를 포함하도록 매핑함.
- [x] T008 [P] [US1] 상위 20개 제한 및 시장 구분 색상 표시(FR-007, FR-009)가 렌더링되는지 확인 — `public/app.js`
  - T008 검증 완료: 거래대금/실시간 조회 순위 모두 `slice(0, 20)`으로 상위 20개를 표시하며, `mkt_type`으로 시장구분을 표시하고 `getPriceClass()`로 상승/하락/보합 색상을 처리함.
- [x] T009 [US1] 새로고침 주기 선택(`#refreshInterval`: 30초/1분/10분/1시간/당일누적)이 FR-002대로 동작하는지 확인 — `public/app.js`
  - 검증 완료: 자동 새로고침 주기 구현 확인
- [x] T010 [US1] 수동 조회 버튼(`#manualRefresh`)이 4개 패널을 동시에 갱신 시도하는지 확인 (FR-003) — `public/app.js`
  - 검증 완료: `#manualRefresh` 클릭 시 `loadData()`, `loadTransactionRank()`, `loadWatchlistRank()`가 실행되도록 수정함. `/api/stock`, `/api/transaction_rank`, `/api/watchlist_rank` 요청이 모두 발생하는 것을 확인함. `/api/stock`에서 Kiwoom 순위와 eFriend 대주가능 종목을 함께 조회하므로 Rank의 4개 패널이 갱신됨.
- [x] T011 [US1] 통신 실패 시 에러 상태 표시(FR-006)가 구현되어 있는지 확인 — `public/app.js`
- [x] T011a [US1] `#lastUpdate`가 마지막 성공 데이터 수신 시각으로 정확히 갱신되는지 확인 (FR-004) — `public/app.js`
- [x] T011b [US1] `#statusText`가 대기/로딩 중/완료/실패 4개 상태를 정확히 전환하는지 확인 (FR-005) — `public/app.js`
- [x] T012 [US1] T006~T011에서 발견된 spec 대비 불일치를 수정 — `server.js`, `public/app.js`
  - 검증 완료:
    - `/api/transaction_rank` 응답을 `items` 기준으로 정리함.
    - `/api/stock` 응답은 실제 구현 및 프론트 사용 구조에 맞춰 `data.kiwoom` / `data.efriend`로 정리함.
    - Rank 두 순위 패널의 표시 수를 상위 20개로 제한함.
    - 수동 조회 시 `loadData()`, `loadTransactionRank()`, `loadWatchlistRank()`가 실행되도록 정리함.
    - `lastUpdate`는 성공 데이터 수신 시에만 갱신하고 전체조회 명령 전송만으로 갱신하지 않도록 수정함.
    - `statusText`는 대기/로딩 중/완료/실패 상태로 표시하도록 정리함.
    - `contracts/api.md`의 `/api/stock` 응답 필드명을 실제 구현과 동일하게 `kiwoom`으로 수정함.
- [ ] T013 [US1] quickstart.md 시나리오 1~3 실행 후 SC-001, SC-002 충족 확인
  - 2026-10-01 재시작 후 localhost 수동 조회에서 `/api/transaction_rank`는 08:47:56에 원본 100건을 받고 08:48:00에 30건을 반환했다. 브라우저에서 패널 1·2 각 20행과 완료 상태를 확인했고 30초 자동 갱신도 확인했다. 다만 SC-001은 네 패널 전체 초기 표시 기준이며, 당시 패널 3은 eFriend 키 미설정, 패널 4는 사용자 숨김 상태였으므로 전체 기준을 완료로 표시하지 않는다.
  - 시나리오 1: 부분 통과 — 후보 제한 전 거래대금 패널은 약 11초가 걸렸으나, 수정 후 패널 1 응답은 약 4초로 줄었다. 패널 2도 데이터가 표시됐다. 네 패널 전체 SC-001은 당시 패널 3 설정 누락과 패널 4 숨김으로 미검증이다.
  - 시나리오 2: 통과 — `#manualRefresh` 클릭 후 Rank 데이터 조회가 수행되고 패널 1·2에 각 20행 및 완료 상태가 표시됨.
  - 시나리오 3: 통과 — 30초 설정에서 서버 응답 로그가 08:48:00, 08:48:30, 08:49:00에 반복되는 것을 확인함.

- [ ] 후속 과제: 대주가능 종목 조회 범위 확대
  - 현재 eFriend 대주가능 종목은 최대 100개까지만 조회되는 상태임.
  - 정상적으로는 100개를 초과하는 종목도 조회할 수 있어야 함.
  - 현재 기능은 미완성 상태이므로 이번 T013에서는 수정하지 않음.
  - 향후 대주가능 종목 조회 개선 작업 시 페이징/조회 제한 및 현재가·시장구분 보정 로직을 함께 검토할 것.
**Checkpoint**: User Story 1 독립적으로 완전히 동작

---

## Phase 4: User Story 2 - 대주가능 종목 확인 (Priority: P2)

**Goal**: 한투 eFriend 연동으로 대주가능 종목을 등락률 순으로 표시하며, 키 미설정 시에도 서버가 정상 동작

**Independent Test**: `.env`에서 `EFRIEND_*`를 제거한 뒤에도 서버가 크래시 없이 빈 목록을 반환하는지 확인

### Implementation for User Story 2

- [x] T014 [US2] `EFRIEND_*` 환경변수가 없을 때 `GET /api/stock`의 efriend 응답이 빈 배열을 반환하는지 확인 (FR-012) — `server.js`
  - 정적 검증 완료: 세 환경변수 중 하나라도 없으면 eFriend 토큰/데이터 요청을 건너뛰며, `efriendStocks`의 초기 빈 배열을 응답의 `data.efriend`로 반환한다. 실제 키 제거 후 서버 재시작 시나리오는 아직 실행하지 않았다.
- [x] T015 [US2] 매매가능수량 강조 표시 및 매매가능금액(현재가×수량) 계산·표시(FR-011)를 확인 — `public/app.js`
  - 정적 검증 완료: `trad_psbl_qty2`가 0보다 크면 수량 셀에 `price-up` 강조 클래스를 적용하고, 현재가(`stck_prpr`, 없으면 `bfdy_clpr`)와 수량의 곱을 매매가능금액으로 표시한다.
- [x] T016 [US2] T014~T015에서 발견된 불일치를 수정 — `server.js`, `public/app.js`
  - 정적 검토에서 T014/T015 불일치가 발견되지 않아 코드 수정은 불필요하다. eFriend 키 누락 시 키움 토큰/조회 경로는 유지되고 eFriend 요청만 생략된다.
- [x] T017 [US2] quickstart.md 시나리오 4 실행 후 FR-012 및 SC-003(eFriend 장애 시 나머지 3개 패널 정상 동작) 확인

**Checkpoint**: User Story 1과 2가 모두 독립적으로 동작

---

## Phase 5: User Story 3 - 관심종목 하락률 순위 확인 (Priority: P3)

**Goal**: 사용자가 선택/입력한 관심종목 그룹의 하락률 상위 종목을 확인하고, 선택값이 유지됨

**Independent Test**: 관심종목 그룹을 변경한 뒤 새로고침해도 선택값이 유지되는지 확인

### Implementation for User Story 3

- [x] T018 [US3] `GET /api/watchlist_groups`, `GET /api/watchlist_rank`가 contracts/api.md와 일치하는지 확인 — `server.js`
  - 검증 결과: 이전 서버 응답은 두 엔드포인트 모두 `data` 배열을 반환해 계약의 `groups`/`items`와 달랐다. T021에서 서버와 프론트 호출부를 함께 수정했다.
- [x] T019 [US3] 관심종목 그룹 선택이 `localStorage`(`watchlist_selected_group`)에 저장·복원되는지 확인 (FR-014) — `public/app.js`
  - 정적 검증 완료: 드롭다운 선택과 직접 입력 모두 `watchlist_selected_group`에 저장되며, 그룹 목록을 로드할 때 저장값을 선택 및 입력란에 복원한다.
- [x] T020 [US3] 그룹 ID 직접 입력이 드롭다운 선택보다 우선 적용되는지 확인 — `public/app.js`
  - 정적 검증 완료: 조회 시 입력란 값을 먼저 사용하고 비어 있을 때만 드롭다운 값, 기본 그룹 ID 순으로 대체한다.
- [x] T021 [US3] T018~T020에서 발견된 불일치를 수정 — `server.js`, `public/app.js`
  - 그룹 API는 `{ success, groups, server_time }`, 순위 API는 `{ success, grp_id, items, server_time }`를 반환하고 프론트엔드는 새 필드를 사용한다. 순위 API 응답도 하락률 오름차순(가장 큰 하락 우선)으로 정렬한다.
- [ ] T022 [US3] quickstart.md 시나리오 5 실행 후 SC-004 충족 확인
  - 정적 경로 확인 완료. 브라우저 검증은 현재 브라우저 탭이 Google 인증 화면에 있어 실행하지 못했고, 패널 4도 사용자가 숨김 처리한 상태다. 사용자가 인증된 브라우저에서 패널 4를 잠시 표시하고 그룹을 변경한 뒤 새로고침하여 선택값이 유지되는지 확인해야 한다.

**Checkpoint**: 3개 User Story 모두 독립적으로 동작

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T023 [P] 발견된 수정 사항 중 현재 Feature Spec Kit 문서와 다른 부분이 있으면 문서 갱신
  - `contracts/api.md`를 현재 성공 응답 envelope(`success`, `server_time`, `grp_id`)까지 명시하도록 갱신했다.
- [ ] T024 장 운영 시간 외 전일 마감 데이터 정상 표시(FR-017)를 4개 패널 모두에서 확인 (보류: 사용자가 추후 재검증 요청)
  - 부분 확인(2026-10-01 08:58, localhost, 장 시작 전): 패널 1·2 각각 20행, 패널 3은 eFriend 대주가능 종목 100행이 표시됐다. 패널 4는 사용자가 숨긴 상태여서 4개 패널 전체 FR-017 판정은 보류한다. 07:54 당시 패널 1·2가 비었던 현상의 원인은 여전히 미확정이다.
- [x] T025 캡처 모드 중 자동 갱신 중단(FR-018), 비활성 탭에서의 조용한 실패 처리(FR-019)를 `public/app.js`에서 확인
  - 캡처 중 Rank 및 ADR 자동 갱신 함수가 `isCapturing`을 확인하고 종료한다. 거래대금/관심종목 요청 실패도 비활성 탭에서는 UI를 변경하지 않고 경고 로그만 남기도록 보완했다.
- [ ] T026 quickstart.md 전체 시나리오(1~6)를 순서대로 실행하여 SC-001~004 최종 확인

---

- [x] T027 [P] 전역 `전체조회`가 Rank/ADR/동적 탭 갱신 명령을 호출하고 버튼 상태/완료 문구가 FR-020대로 동작하는지 브라우저에서 확인 — `public/app.js`
- [x] T028 [P] 작은 화면 `더 보기` 메뉴의 열기/닫기 및 바깥 클릭 종료가 FR-021대로 동작하는지 브라우저에서 확인 — `public/app.js`, `public/index.html`
  - 정적 검증 완료: 버튼 클릭 시 `.right-controls`의 `show-all` 클래스를 토글하고 메뉴 바깥을 클릭하면 제거한다. 이 경로에서 설정 저장 함수를 호출하지 않는다. 좁은 화면에서의 실제 표시 확인은 남아 있다.

## Verification Log

> 2026-09-30 기준 검증 진행 기록. 체크박스는 **검증 완료**를 의미하며, 발견된 불일치가 있는 태스크는 수정 전까지 체크하지 않는다. 실제 코드 수정은 T012에서 일괄 결정/반영한다.

### Completed

- **T001 🟢** — 루트 `.env`에 `KIWOOM_APPKEY`, `KIWOOM_SECRETKEY`가 존재함을 확인. 실제 비밀값은 기록하지 않는다.
- **T002 🟢** — `npm ci` 성공 확인 (`193 packages added`, `194 packages audited`). 설치 자체는 정상이며, 보고된 npm 취약점은 별도 후속 검토 사항이다.
- **T003 🟢** — `server.js`에서 `cachedToken`/`tokenExpiryTime`을 이용한 OAuth 토큰 재사용 및 만료 시 재발급을 확인. 무효 토큰 조건에서 두 값을 초기화하는 로직도 확인.
- **T004 🟢** — `server.js`의 전역 `marketCache`가 거래대금/실시간순위/대주가능/관심종목 처리에서 공통 사용됨을 확인.
- **T005 🟢** — `/api/transaction_rank`의 종목 상세 조회가 `chunkSize = 1`로 순차 처리되고 각 처리 후 100ms 지연됨을 확인.

### Mismatches Found

- **T006 🔴** — `contracts/api.md`는 `GET /api/transaction_rank` 성공 응답을 최상위 `items` 배열로 정의하지만, 현재 `server.js`는 최상위 `data` 배열을 반환한다. 현재 `public/app.js`도 `result.data`를 사용하므로, 서버만 변경하면 프론트엔드가 깨질 수 있다. T012에서 계약/구현 중 기준을 결정한 후 수정한다.
- **T007 🔴** — `data-model.md`의 `WatchRankEntry`는 `bigd_rank`, `stk_cd`, `stk_nm`, `mkt_type`, `base_comp_chgr`, `trde_amt`를 요구한다. 현재 `/api/stock`은 원본 `stock`을 spread하고 `mkt_type`, `trde_amt`를 보강하지만 `bigd_rank`/`base_comp_chgr`를 명시적으로 매핑하거나 보장하지 않는다. 실제 Kiwoom 원본 응답에 해당 필드가 있을 가능성은 있으나, 현재 코드만으로 계약 필드 보장을 확인할 수 없어 불일치로 기록한다. T012에서 수정 여부를 결정한다.
- **T008 🔴** — `public/app.js`에서 실시간 조회 순위(`renderTable`)와 거래대금 순위(`loadTransactionRank`) 모두 `slice(0, 20)`으로 상위 20개 제한은 구현되어 있다. 그러나 시장 구분은 단순히 `<td class="market-type">${marketLabel}</td>`로 출력할 뿐, K/Q에 따라 별도 색상 클래스나 스타일을 적용하지 않는다. `price-up`/`price-down`은 등락률 색상용이지 시장 구분 색상이 아니다. 따라서 FR-007의 20개 제한은 충족하지만 FR-009의 시장 구분 색상 표시는 현재 코드에서 확인되지 않아 T008은 미완료로 기록한다. T012에서 수정 여부를 결정한다.
- **T009 🟢** — `#refreshInterval`의 30초/1분/10분/1시간/당일누적 옵션과 선택값에 따른 자동 갱신 로직을 확인했다.
- **T010 🔴** — `#manualRefresh`가 `loadData()`, `loadTransactionRank()`, `loadWatchlistRank()`만 호출하고 ADR 갱신(`updateAdrFromSource()`)은 호출하지 않아 4개 패널 동시 갱신 요구와 불일치한다. T012에서 수정한다.
- **T011 🟢** — `loadData()`의 HTTP/API 실패 처리, 에러 메시지 표시 및 실패 상태 전환을 확인했다.
- **T011a 🔴** — `loadData()` 성공 시의 `#lastUpdate` 갱신은 적절하지만, `refreshAllTabs()`에서 실제 데이터 성공 여부와 무관하게 `#lastUpdate`를 현재 시각으로 갱신하는 경로가 확인되었다. T012에서 수정한다.
- **T011b 🔴** — `#statusText`의 대기/로딩/완료/실패 상태 전환은 존재하지만, `refreshAllTabs()`가 `전체 탭 갱신 명령 전송됨`을 직접 출력하는 별도 경로가 있어 요구된 4개 상태 외 문구가 표시될 수 있다. T012에서 수정한다.
- **T014 🟢** — `/api/stock`에서 `EFRIEND_APPKEY`, `EFRIEND_SECRETKEY`, `EFRIEND_DOMAIN` 중 하나라도 없으면 eFriend API를 건너뛰고 `efriendStocks = []`로 반환하는 경로를 확인했다.
- **T015 🟢** — eFriend 영역에서 매매가능수량을 표시하고, 현재가 × 매매가능수량으로 매매가능금액을 계산·표시하는 구현을 확인했다.
- **T018/T021 🟢** — 계약 기준으로 수정 완료. `/api/watchlist_groups`는 `groups`, `/api/watchlist_rank`는 `items`를 반환하며, 프론트 호출부도 같은 필드를 읽는다. 순위 API 응답은 하락률 내림차순(수치 오름차순)으로 정렬한다.
- **T019/T020 🟢** — 정적 코드 검토로 저장·복원 및 직접 입력 우선 순서를 확인했다. 실제 브라우저 새로고침 동작은 T022에서 검증해야 한다.
- **T016 🟢** — T014/T015 정적 검토 결과 불일치 없음. eFriend 토큰 발급 실패는 별도 catch에서 기록되고 요청 처리가 계속되며, 키 누락 시 eFriend 호출을 건너뛰어 빈 배열을 반환한다. 프론트엔드는 빈 목록 안내를 표시한다. 코드 수정 불필요.
- **T017 🟢** — localhost에서 eFriend 키 누락 시 패널 3 빈 목록 및 서버 정상 동작을 확인했다. 2026-10-01 08:57 서버 재시작 후 eFriend 토큰 발급 성공, 대주가능 목록 100개 반환 및 브라우저 표시도 확인했다. 패널 1·2는 각각 20개가 계속 표시됐다. 다만 다음 페이지 요청은 `CTX_AREA_NK100` 입력 크기 오류로 종료되어 100개 초과 조회는 후속 과제에 남긴다. 숨김 처리된 패널 4는 검증 범위에서 제외했다. 07:54에 일시적으로 패널 1·2가 비었던 원인은 미확정이며, 사용자가 개장 전 HTS에도 실시간 조회 순위가 있었다고 확인했으므로 시장 개장만을 원인으로 간주하지 않는다. 빈 상태 문구는 모든 Rank 패널에서 `데이터가 없습니다.`로 통일했다.
- **T022 🟠** — 저장/복원 구현은 정적으로 확인했다. 실제 시나리오는 패널 4 표시가 필요하므로 사용자가 나중으로 미루도록 한 상태에서 보류한다.
- **T023 🟢** — spec/plan/data-model/contracts/quickstart와 서버·프론트 구현을 비교했다. API envelope 및 필드 계약은 기존 수정과 일치한다. 거래대금 API의 상위 30개 보정 후보 최적화 근거와 절충점을 research.md에 기록하고, quickstart.md에 SC-001 전체 판정에 필요한 패널 표시 및 API 설정 조건을 적었다. 사용자의 패널 숨김 및 eFriend 키 미설정은 실패로 오인하지 않고 전체 기준 미검증으로 기록한다.
- **T024 🟠** — 2026-10-01 08:58 장 시작 전에는 패널 1·2 각각 20행과 패널 3의 eFriend 데이터 100행이 표시되는 것을 확인했다. 이전 07:54 빈 화면 현상은 현재 재현되지 않았고 당시 API 건수 기록이 없어 원인은 미확정이다. 패널 4가 사용자에 의해 숨겨져 있어 4개 패널 전체 FR-017 검증은 보류한다.
- **T025 🟢** — 정적 코드 검증 완료. 캡처 플래그 중 자동 갱신이 건너뛰며, Rank 비활성 시 거래대금/관심종목 요청의 실패 내용을 콘솔 경고로만 기록하도록 수정했다. 실제 캡처 조작 및 API 장애 주입은 실행하지 않았다.
- **T026 🟠** — quickstart.md 부분 실행 결과 (2026-10-01, 인증된 localhost):
  - 시나리오 1: 재시작 후 수동 조회 로그에서 `/api/transaction_rank`가 08:47:56에 원본 100건을 받고 08:48:00에 30개를 반환했다. 브라우저에서는 패널 1·2 각 20행과 `완료` 상태를 확인했다. 패널 1 응답은 5초 이내이나 네 패널 전체 SC-001은 미검증이다.
  - 시나리오 2: 수동 `조회` 후 갱신 시각이 `08:33:12`에서 `08:35:53`으로 바뀌고 패널 1·2에 각 20행 표시됨.
  - 시나리오 3: 30초 주기로 변경한 뒤 `08:36:45`에서 `08:37:15`로 갱신 시각 변경을 확인했다. 사용자 요청에 따라 주기는 30초로 유지한다(이전 설정은 10분).
  - 시나리오 4: eFriend 환경변수 누락 시 패널 3 빈 안내 및 서버 정상 동작을 확인했고, 이후 키 복원/재시작 후 토큰 발급 성공과 패널 3의 100개 데이터 표시도 확인했다. 추가 페이지 요청은 `CTX_AREA_NK100` 크기 오류로 중단됐다(T017).
  - 시나리오 5: 사용자가 패널 4 검증을 나중으로 미루도록 요청해 보류(T022).
  - 시나리오 6: 앞선 장 외 관찰에서 패널 1·2가 비어 FR-017 기대와 불일치했으며 원인은 미확정(T024). 수정 전 패널 1 초기 응답은 약 11초였고, 수정 후 수동 조회에서는 약 4초였다.
  - 따라서 SC-001~004 전체 최종 판정은 미완료다.
- **T027 🟢** — 로그인된 localhost 브라우저에서 `전체조회` 클릭 시 버튼이 `갱신 중...`으로 비활성화되고 약 2초 후 활성화되는 것을 확인했다. 완료 상태는 `완료`로 표시됐고 소스에서 Rank/ADR/동적 탭 갱신 함수 호출을 확인했다.
- **T028 🟢** — 브라우저 viewport를 500×900으로 임시 설정해 `더 보기`가 표시되는 것을 확인했다. 버튼 클릭 후 `.right-controls`에 `show-all`이 붙고 `전체 설정 PC에서 불러오기` 버튼이 보였으며, 탭 영역 바깥 클릭 후 클래스와 표시가 원상 복귀했다. viewport override는 검증 후 초기화했다. 구현은 클래스 토글만 하며 설정 저장 함수를 호출하지 않는다.

### Next

- **빈 상태 안내** — Rank 패널 1~4의 빈 데이터 문구를 `데이터가 없습니다.`로 통일했다. 숨김 처리된 패널 4는 사용자 지시에 따라 이후 실제 화면 검증에서 제외한다.
- **T022 실제 확인 필요** — 관심종목 패널(현재 사용자가 숨김 처리)을 잠시 표시한 뒤 다른 그룹을 선택하고 페이지를 새로고침해 선택값이 유지되는지 확인한다. 패널을 계속 숨겨 둘 경우 이 브라우저 시나리오는 미검증으로 남긴다.
- **T024 추후 재개** — 사용자가 지금은 확인할 수 없으므로 장외 시간에 다시 확인하기로 했다. 다음에 장외 공백이 재현되면 `dev_tools/logs/server_debug.log`에서 원본/최종 응답 건수를 대조한다. 이번 진행은 이 항목을 기다리지 않고 002-adr-tab으로 넘어간다.
- **T012** — Codex 사용 가능 시 T006~T011b에서 발견된 불일치를 `server.js`, `public/app.js`에서 일괄 결정·수정한다.
- **T024는 사용자 요청으로 보류**하며, 장외 재검증 기회가 생기면 재개한다. 남은 Rank 전체 검증(T013/T022/T026)과 숨김 패널4 확인은 미완료 기록으로 유지한다.

---

## Dependencies & Execution Order

- **Setup (Phase 1)**: 의존성 없음 — 즉시 시작
- **Foundational (Phase 2)**: Setup 완료 후 진행 — 모든 User Story를 막는 선행 조건
- **User Stories (Phase 3~5)**: Foundational 완료 후 시작 가능. P1→P2→P3 순서 권장(우선순위 기준)이나, 서로 다른 엔드포인트를 다루므로 병렬 진행도 가능
- **Polish (Phase 6)**: 진행하고자 하는 모든 User Story 완료 후

### User Story Dependencies

- **US1 (P1)**: Foundational 이후 바로 시작 가능, 다른 스토리에 의존하지 않음
- **US2 (P2)**: Foundational 이후 바로 시작 가능, US1과 독립적(다른 엔드포인트)
- **US3 (P3)**: Foundational 이후 바로 시작 가능, US1/US2와 독립적(다른 엔드포인트)

### Parallel Opportunities

- T002는 독립적으로 병렬 가능
- T004, T005는 서로 다른 검증 대상이라 병렬 가능
- T008은 렌더링 검증이라 T006/T007(API 검증)과 병렬 가능
- US1/US2/US3는 서로 다른 엔드포인트·UI 영역을 다루므로 전체 병렬 진행 가능

---

## Implementation Strategy

### MVP First (User Story 1만)

1. Phase 1: Setup 완료
2. Phase 2: Foundational 완료 (필수)
3. Phase 3: User Story 1 완료
4. **중단 후 검증**: quickstart.md 시나리오 1~3으로 US1 독립 검증
5. 필요 시 여기까지만 배포해도 핵심 가치 제공

### Incremental Delivery

1. Setup + Foundational → 기반 확보
2. US1 추가 → 독립 검증 (MVP)
3. US2 추가 → 독립 검증
4. US3 추가 → 독립 검증
5. Polish로 마무리

## Notes

- 초기 tasks.md는 **기존 코드의 spec 준수 여부 검증 및 수정**이 목적이며, 2026-10-07 추가 범위는 사용자가 요청한 쏠림율 필드·차트 신규 구현을 포함한다(Constitution 원칙 I).
- 검증 중 실제로 스펙과 다른 동작을 발견하면, 어느 쪽이 맞는지(코드가 맞고 spec을 고쳐야 하는지, 코드를 고쳐야 하는지) 먼저 판단한 뒤 수정한다.
- 각 태스크 완료 후 커밋 권장.

## Phase 7: User Story 4 - 쏠림율 확장 (2026-10-07)

- [x] T029 [US1] 두 순위 테이블에 동일 시장별 쏠림율 계산·표시 적용, 시장 미확인 시 null/- 처리 — server.js, public/app.js, public/index.html, public/style.css (FR-008/010).
- [x] T030 [US4] 인증된 차트 API 및 시장 판별·원천 조회 구현 — server.js, concentration-chart.js (FR-022~024).
- [x] T031 [US4] 일봉 실제 거래대금, 분봉 사용자 지정 추정식 및 시간 정렬·계산 불가 처리 구현 (FR-024/025).
- [x] T032 [US4] 별도 원천 연속조회·사용자 귀속 커서·중복 제거·실패 재시도·조회 상한 구현 (FR-026).
- [x] T033 [US4] 세 테이블 선택, 일/분·간격·추가조회 버튼과 차트 렌더링 구현 — public/concentration-chart.js (FR-022/023/026/027).
- [x] T034 [US4] 최신 값 헤더 표시, 검증 패널 제거, 로딩 블러·위치 유지, 절반 폭·휴대폰 표시 및 제공 아이콘 반영 (FR-028/029).
- [x] T035 [US4] 버튼·슬라이더 및 드래그 확대/전체 복원 구현 (FR-030).
- [x] T036 [US4] Rank 주기·수동·전체조회 연동, 과거 기록·확대 구간 보존, 중복/캡처 건너뛰기와 실패 시 기존 차트 유지 구현 (FR-031).
- [x] T037 [US4] tests/concentration-chart.test.js 계산·시장 선택·집계·연속조회 11개 테스트 및 tests/concentration-chart-ui.test.js 브라우저 통합 시나리오 통과 확인.
- [x] T038 [US4] 실제 2026-10-07 삼성전자/코스피 일봉 거래대금과 테이블 수치 검산, 분봉 보정 표본 확인 — quickstart.md 기록 (SC-005).
- [x] T039 [US4] spec·plan·research·data-model·contracts·quickstart·tasks·품질 체크리스트를 최종 구현에 맞춰 갱신.

의존성: T029/T030 → T031/T032 → T033 → T034/T035/T036 → T037/T038 → T039. 자동화 검증은 SC-006~008의 모의 응답 동작을 확인한다. 운영 환경 전체 재검증 및 기존 T013/T022/T024/T026 보류 항목은 별도로 남기며 완료로 변경하지 않는다.

- [x] T040 [US4] 분봉 하루 전체·확대 구간 X축을 시간만 표시하고 매시 경계 눈금 및 좁은 화면 간격 조절 적용 — public/concentration-chart.js (FR-027).
- [x] T041 [US4] 확대 구간에서 눈금 여유가 충분할 때 30분 눈금 표시 (FR-027).
- [x] T042 [US4] X축 시간 접미사 제거: 매시 HH, 30분 간격 HH:mm 표시 적용 (FR-027).
