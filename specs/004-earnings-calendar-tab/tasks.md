# Tasks: 증시캘린더 탭 — 경제지표·실적 일정

**Input**: Design documents from `/specs/004-earnings-calendar-tab/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: 브라운필드 검증 작업. quickstart.md로 검증.

## Phase 1: Setup

- [x] T001 `GET /calendar` 및 `/api/toss_calendar_proxy` 라우트가 정상 등록되어 있는지 확인 — `server.js`

## Phase 2: Foundational

**⚠️ CRITICAL**

- [x] T002 프록시 허용 호스트가 `tossinvest.com`, `toss.im` 하위 도메인으로 제한(FR-007)되어 있는지 확인 — `server.js`
- [x] T003 [P] HTML `<base>` 태그 및 URL 변환 스크립트 삽입이 정상 동작하는지 확인(같은 출처 iframe 임베드 전제조건) — `server.js`

**Checkpoint**: 프록시 보안/임베드 기반 검증 완료

---

## Phase 3: User Story 1 - 경제지표·실적 일정 조회 (Priority: P1) 🎯 MVP

**Goal**: 당월 일정이 10초 이내 표시되고 필터가 정상 동작

**Independent Test**: 탭 진입 시 당월 일정 표시 및 유형/지역 필터 확인

### Implementation for User Story 1

- [x] T004 [US1] 월별 일정 API(표시 월 ±3개월, 총 7개월) 프록시가 contracts/api.md와 일치하는지 확인(FR-001) — `server.js`
- [ ] T005 [P] [US1] 일정 유형(전체/경제지표/실적), 지역(전체/국내/해외) 필터(FR-002)가 동작하는지 확인 — 토스 임베드 내부 UI, `server.js` 프록시 응답 확인
- [ ] T006 [US1] 주별/월별 보기 전환(FR-003)이 정상 동작하는지 확인
- [ ] T007 [US1] 월 이동 시 인접 월 데이터가 정상 로드되는지 확인
- [x] T008 [US1] T004~T007 코드 검토에서 확인된 불일치 없음. 원격 캘린더 동작 검증은 T009에 남김 — `server.js`
- [ ] T009 [US1] quickstart.md 시나리오 1~4 실행 후 SC-001, SC-002 확인

**Checkpoint**: User Story 1 독립적으로 동작

---

## Phase 4: User Story 2 - 주간 AI 요약 확인 (Priority: P2)

**Goal**: 주간 AI 요약 카드가 정상 표시됨

### Implementation for User Story 2

- [x] T010 [US2] 주간 AI 요약 API 프록시(FR-004)가 contracts/api.md와 일치하는지 확인 — `server.js`
- [x] T011 [US2] T010 코드 검토에서 확인된 불일치 없음. 원격 카드 표시 검증은 T012에 남김 — `server.js`
- [x] T012 [US2] quickstart.md에서 요약 카드 표시 확인

**Checkpoint**: User Story 1, 2 모두 독립적으로 동작

---

## Phase 5: User Story 3 - 화면 새로고침 (Priority: P3)

**Goal**: 새로고침 버튼으로 iframe이 재로드되고 상태가 정확히 갱신됨

### Implementation for User Story 3

- [x] T013 [US3] `refreshEarningsTab`의 about:blank → 원래 URL 재할당(100ms) 로직(FR-005)을 확인 — `public/app.js`
- [x] T014 [US3] 캡처 모드 중 새로고침 억제(FR-008)가 동작하는지 확인 — `public/app.js`
- [x] T015 [US3] T013~T014 코드 검토에서 확인된 불일치 없음. 실제 UI 검증은 T016에 남김 — `public/app.js`
- [ ] T016 [US3] quickstart.md 시나리오 5 실행 후 SC-003 확인

**Checkpoint**: 3개 User Story 모두 독립적으로 동작

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T017 [P] 토스 원본 캘린더 새 창 열기 동작을 코드에서 확인 — `public/app.js`
- [ ] T018 quickstart.md 전체 시나리오 최종 실행

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2/US3(US1과 독립적으로 병렬 가능) → Polish

## Notes

- 이 기능은 외부 서비스(토스증권) 의존도가 높아, 검증 시점의 실제 응답 구조 변경 여부를 함께 기록해 둘 것을 권장.

---

## Verification Log — 2026-09-30

> 원칙: 현재 구현을 기준으로 정적 검증했습니다. 코드 수정은 하지 않았으며, 실제 Toss 응답/브라우저 렌더링이 필요한 항목은 별도 보류했습니다.

### Phase 1 / Foundational

- [x] **T001 🟢** `server.js`에 `GET /calendar` 및 호환 경로 `GET /api/toss_calendar`가 등록되어 있음. 별도로 `/api/toss_calendar_proxy`도 구현되어 있음.
- [x] **T002 🟢** `toss_calendar_proxy`에서 `https:`이면서 호스트가 `(^|\.)tossinvest.com` 또는 `(^|\.)toss.im`인 경우만 허용하고, 그 외에는 400을 반환함.
- [x] **T003 🟢** `/calendar` 응답 HTML에 `<base href="https://www.tossinvest.com/">`와 URL rewrite bootstrap script를 삽입함. `fetch`, XHR, SharedWorker, 이미지 URL 및 History API 경로를 같은 출처 프록시로 재작성하는 로직이 확인됨.

### User Story 1

- [x] **T004 🟢** `toss_calendar_proxy`가 `url` 쿼리로 전달된 Toss URL을 그대로 프록시하며 15초 timeout을 사용함. Toss 캘린더 번들에서 월별 API와 주간 요약 API를 해당 프록시로 연결하는 코드도 확인됨. 월별 7개월 선반입 자체는 Toss 원본 번들의 쿼리 구성에 의존하므로 서버 프록시 코드만으로 정확한 7개월 요청 개수는 확정하지 않음.
- [ ] **T005 ⏳** 일정 유형/지역 필터는 Toss 임베드 내부 UI에 의존함. 현재 정적 코드만으로 실제 필터 결과와 1초 이내 갱신을 확정할 수 없어 브라우저 검증 필요.
- [ ] **T006 ⏳** 주별/월별 보기 전환은 Toss 임베드 내부 UI 동작이므로 브라우저 검증 필요.
- [ ] **T007 ⏳** 이전/다음 월 이동과 인접 월 데이터 로드는 실제 Toss 응답을 받아야 확인 가능.
- [x] **T008 🟢** T004~T007 코드 검토에서 확정 불일치가 없어 수정할 코드 없음. 실제 UI 확인은 T009에 남김.
- [ ] **T009 ⏳** quickstart 1~4는 실제 외부 서비스 응답을 포함한 브라우저 검증 필요.

### User Story 2

- [x] **T010 🟢** Toss 캘린더 페이지 번들에서 주간 AI 요약 요청을 `/api/toss_calendar_proxy`로 재작성하는 코드가 확인됨. 프록시는 Toss 호스트만 허용하고 15초 timeout을 사용함.
- [x] **T011 🟢** T010 검토에서 확정 불일치가 없어 수정할 코드 없음. 카드 표시 검증은 T012에 남김.
- [ ] **T012 ⏳** 실제 주간 AI 요약 카드 표시 여부는 Toss 원격 응답 및 브라우저 렌더링 확인 필요.

### User Story 3

- [x] **T013 🟢** `refreshEarningsTab()`가 `iframe.src = 'about:blank'` 후 100ms 뒤 원래 `currentSrc`를 재할당하며, 상태를 `새로고침 완료`, 시각을 현재 시각으로 갱신함.
- [x] **T014 🟢** `refreshEarningsTab()` 시작 시 `isCapturing`이면 새로고침을 실행하지 않고 콘솔에만 기록함.
- [x] **T015 🟢** T013~T014 검토에서 확정 불일치가 없어 수정할 코드 없음. 브라우저 검증은 T016에 남김.
- [ ] **T016 ⏳** 실제 브라우저에서 새로고침 시나리오 검증 필요.

### Polish

- [x] **T017 🟢** 증시캘린더 UI에 `토스 캘린더 ↗` 버튼이 있고 `window.open('https://www.tossinvest.com/calendar', '_blank')`으로 원본 페이지를 새 창에서 열도록 구현되어 있음.
- [ ] **T018 ⏳** quickstart 전체 최종 실행은 실제 Toss 서비스/브라우저 검증 필요.

### 현재 결론

**004-earnings-calendar-tab에서는 정적 코드 기준으로 명확한 수정 대기 불일치는 발견되지 않았습니다.**

현재 남은 핵심은 **T005/T006/T007/T009/T012/T016/T018의 실제 브라우저 검증**입니다. 특히 이 기능은 Toss증권 외부 서비스에 강하게 의존하므로, 정적 코드만으로 `10초 이내`, `1초 이내`, 실제 필터/월 이동/AI 카드 표시까지 확정하지 않았습니다.

**코드 수정은 하지 않았습니다.**

## 2026-10-01 Implementation Status

코드/계약 대조 결과 명확한 구현 불일치는 없어 수정이 필요하지 않았다. 라우트 등록, Toss 호스트 허용 목록, 같은 출처 프록시 스크립트, 월별/주간 요약 프록시 연결, 캡처 중 새로고침 억제와 원본 페이지 링크는 코드 검토를 완료했다. Toss 내부 필터·월 이동·요약 카드 및 새로고침 화면은 사용자가 요청한 전체 구현 우선 순서에 따라 검증을 뒤로 미뤘으며 T005~T007/T009/T012/T016/T018은 미완료로 둔다.


## 2026-10-01 추가 브라우저 검증

- **T005 부분 확인:** localhost 임베드에서 경제지표/실적 유형 선택 상태가 바뀌고 해당 유형의 일정 목록/열이 바뀌는 것을 확인했다. 국내/해외 필터는 선택 후 결과 범위가 명확히 달라지는지 확인하지 못해 미완료로 둔다.
- **T012 🟢** 주간 AI 요약 카드 링크가 표시됨을 확인했다.
- **T016 부분 확인:** 앱 상태는 새로고침 완료와 시각으로 갱신되지만, iframe 일정표는 재로드 후에도 로딩 스켈레톤으로 남았다. 외부 데이터가 다시 렌더링되는지는 미확인으로 두며 통과 처리하지 않는다.
- **T006/T007/T009/T018** 주별/월별 전환, 월 이동, 필터/데이터 완전 로드 최종 검증은 미완료.

## 2026-10-02 지역 필터 조사 메모 — T005 미완료

- `전체 → 국내` 클릭 시 `onValueChange('kr')`, reducer(`all → kr`), country hook 상태(`kr`)까지는 확인됨.
- 실패 재현에서도 SegmentedControl prop/value와 국내 Radio item의 `groupValue`가 `kr`/선택됨으로 렌더됐지만, 다음 프레임 및 350ms 뒤 DOM 선택은 계속 `all`. 실패 때 commit 로그가 없고 성공 재현 때는 나타남.
- 동일 시점에 월별 proxy 요청이나 `Uncaught` 오류는 관찰되지 않음. 클릭 후 자동 스크롤을 100ms 늦추는 시도도 실패하여 해당 지연 변경은 소스에서 되돌림.
- 원인과 수정은 미확정. 재개 시 React render가 실제 DOM에 commit되지 않는 경로를 우선 조사하고 T005는 미완료로 유지. `server.js`에는 클릭 단위 진단 계측이 남아 있음.

## Current refresh policy — 2026-10-06

기존 about:blank와 100ms 지연 재로드 및 새로고침 완료 문구 설명은 과거 기록이다. 현재는 공급자 전용 iframe을 보존하고 당일 재진입/자동 갱신을 억제하며 새로고침 버튼으로 현재 공급자의 src를 다시 설정한다. load 이벤트 후 캘린더 표시 중으로 안내한다. 현재 구현과 검증 범위는 ../007-multi-source-market-calendar/plan.md 및 quickstart.md를 따른다.
