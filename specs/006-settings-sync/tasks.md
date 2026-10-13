# Tasks: 설정 저장 및 동기화

**Input**: Design documents from `/specs/006-settings-sync/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: 브라운필드 검증 작업. quickstart.md로 검증.

## Phase 1: Setup

- [x] T001 `autosaved_user_settings.json` 및 메모 백업/임시 파일이 `.gitignore`에 포함됨을 확인 — `.gitignore`

## Phase 2: Foundational

**⚠️ CRITICAL**

- [x] T002 `getSerializedState()`가 AppSettingsSnapshot을 포함하며 메모 저장 시각을 추가함을 확인 — `public/app.js`
- [x] T003 [P] `GET/POST /api/settings`의 응답, 캐시 방지 헤더, 50MB 한도 및 전용 메모 저장 경로를 contracts/api.md에 반영 — `server.js`

**Checkpoint**: 저장 스냅샷 구조 검증 완료

---

## Phase 3: User Story 1 - 설정 자동 저장 (Priority: P1) 🎯 MVP

**Goal**: 구성 변경 시 로컬 즉시 기록 후 서버 저장이 자동 발생

**Independent Test**: 탭 이름 변경 후 새로고침해도 유지되는지 확인

### Implementation for User Story 1

- [x] T004 [US1] 일반 설정 변경은 `saveAppData()`, 메모 저장 버튼은 전용 서버 경로로 저장됨을 확인하고 FR-001에 경계를 명시 — `public/app.js`, `specs/006-settings-sync/spec.md`
- [x] T005 [P] [US1] 로컬 저장 → 서버 전송 순서를 코드 및 localhost API 왕복으로 확인 — `public/app.js`
- [ ] T006 [US1] 서버 저장 실패 시 로컬 유지 + 사용자 경고(FR-003)를 확인 — `public/app.js`
- [x] T007 [US1] `isInitializing` 중 자동 저장 잠금 및 복원 종료 후 해제를 확인 — `public/app.js`
- [x] T008 [US1] 메모 실패 저장의 로컬 대기본, 시각 보존, 서버 원자 저장 및 복구 백업 보호를 구현 — `public/app.js`, `server.js`
- [ ] T009 [US1] quickstart.md 시나리오 1~2 실행 후 SC-001 확인

**Checkpoint**: User Story 1 독립적으로 동작

---

## Phase 4: User Story 2 - 여러 PC 간 설정 동기화 (Priority: P2)

**Goal**: 시작 시 서버 설정 우선 적용, 서버 접근 불가 시 로컬 폴백

### Implementation for User Story 2

- [x] T010 [US2] 서버에 비어있지 않은 `tabs`가 있으면 서버 데이터를 우선 적용함을 확인 — `public/app.js`
- [x] T011 [US2] 서버 접근 실패 시 유효한 로컬 설정으로 대체함을 확인 — `public/app.js`
- [x] T012 [US2] 서버·로컬 모두 없을 때 고정 탭+기본 Rank로 시작함을 확인 — `public/app.js`
- [x] T013 [US2] T010~T012 코드 검토에서 확인된 불일치 없음 — `public/app.js`
- [ ] T014 [US2] quickstart.md 시나리오 2~3 실행 후 SC-002, SC-003 확인

**Checkpoint**: User Story 1, 2 모두 독립적으로 동작

---

## Phase 5: User Story 3 - 전체 설정 백업/복원 (Priority: P3)

**Goal**: 전체 설정을 단일 JSON으로 백업하고 전체 복원

### Implementation for User Story 3

- [x] T015 [US3] 사용자 정의 탭 유무와 무관하게 전체 설정 JSON을 백업하도록 확인 — `public/app.js`
- [x] T016 [P] [US3] 단일 JSON 서버 백업 API로 전체 스냅샷을 프로젝트 루트에 저장 — `public/app.js`, `server.js`
- [x] T017 [US3] JSON 전체 백업에 커스텀 탭을 포함한 앱 설정이 담기는지 확인 — `public/app.js`
- [x] T018 [US3] JSON 전체 백업 판별 및 사용자 확인 절차를 확인하고 메모 HTML 누락 시 기존 값을 보존하도록 수정 — `public/app.js`
- [x] T019 [US3] T015~T018 코드 검토에서 확인된 수정 사항 반영 — `public/app.js`
- [x] T020 [US3] quickstart.md 시나리오 4~6 실행 후 SC-004 확인 — 사용자 Oracle 클라우드 검증 완료 (2026-10-03)

**Checkpoint**: 3개 User Story 모두 독립적으로 동작

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T021 서버가 저장하는 클라이언트 스냅샷에 API 키/토큰을 포함하지 않음을 확인 — `public/app.js`, `server.js`
- [x] T022 [P] 동시 저장 충돌 시 "마지막 저장 우선" 동작(FR-012)이 문서화된 한계로 명확히 기록되어 있는지 확인 — 마이그레이션 감사에서 확인한 기존 3.4절 충돌 정책과 대조 완료
- [ ] T023 quickstart.md 전체 시나리오 최종 실행
- [x] T024 [US3] 단일 가져오기 버튼이 현재 서버 프로젝트 루트 파일을 불러오고 범위를 풍선 도움말로 안내 — `public/index.html`, `public/app.js`, `server.js`

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2(US1 전제) → US3(US1/US2와 독립적으로 병렬 가능) → Polish

## Notes

- FR-012(동시 저장 시 마지막 저장 우선, 병합 없음)는 현재 정책으로 "수정 대상 버그"가 아니라 "문서화된 한계"로 취급한다. 다중 사용자 확장이 실제 필요해지면 별도 spec으로 분리해 재설계할 것.

---

## Verification Log — 2026-09-30

> 원칙: 이번 단계에서는 코드 수정 없이 현재 구현을 검증했습니다. 브라우저에서만 확인 가능한 항목은 `⏳`로 남겼습니다.

### Phase 1 / Foundational

| Task | 결과 | 검증 내용 |
|---|---|---|
| T001 | ⏳ | 당시 제공된 소스 집합에는 `.gitignore` 파일이 없어 설정 파일이 실제로 git ignore 되는지는 확인하지 못했습니다. 이후 `.gitignore`를 확인하고 갱신했다. |
| T002 | 🟢 | `getSerializedState()`가 `activeTabId`, `tabs`, `contents`, `rankInterval`, `watchlistGroupId`, `memoHtml`, `memoDelta`, `updatedAt`를 모두 반환합니다. `memoTabIconMigrationV1`은 추가 필드입니다. |
| T003 | 🟢 | `GET /api/settings`는 `Cache-Control: no-store...`, `Pragma: no-cache`, `Expires: 0`을 설정하고 계약 형태 `{success:true,data}` / `data:null`을 반환합니다. `POST /api/settings`도 `{success:true}`를 반환합니다. Express JSON body limit은 50MB입니다. |

### User Story 1

| Task | 결과 | 검증 내용 |
|---|---|---|
| T004 | 🔴 | 탭 추가/삭제/이름변경/순서변경/차트 입력/간격 변경/관심종목 변경에는 `saveAppData()` 호출이 확인됩니다. 그러나 메모 저장은 `saveMemoToServer()`를 별도 호출하며 `saveAppData()`를 호출하지 않습니다. FR-001의 “메모 저장 시 전체 설정 자동 저장”과 구현이 다릅니다. |
| T005 | 🟢 | `saveAppData()`에서 `localStorage.setItem(STORAGE_KEY, ...)`을 먼저 수행한 뒤 `syncSettingsToServer(storageData)`를 호출합니다. |
| T006 | 🟢 | 서버 저장 실패/응답 false 시 `alert()`로 사용자에게 실패를 알리고, 서버 전송 실패와 무관하게 이미 로컬 저장이 완료된 구조입니다. |
| T007 | 🟢 | `saveAppData()` 첫 줄에서 `isInitializing`이면 저장을 수행하지 않고 종료합니다. `applyData()`도 복원 중 `isInitializing = true`로 잠그며 완료 후 해제합니다. |
| T008 | 🔴 | T004 불일치가 있으므로 수정 대상입니다. |
| T009 | ⏳ | quickstart 시나리오 1~2와 SC-001은 실제 브라우저에서 확인해야 합니다. |

### User Story 2

| Task | 결과 | 검증 내용 |
|---|---|---|
| T010 | 🟢 | 초기화에서 서버 데이터를 먼저 가져오고, `serverData.tabs.length > 0`이면 항상 서버 데이터를 `finalData`로 선택합니다. |
| T011 | 🟢 | 서버 로드 실패 시 `loadAppDataFromServer()`가 `null`을 반환하고 이후 `localData`를 `finalData`로 사용합니다. |
| T012 | 🟢 | 서버/로컬 설정이 모두 없으면 `ensurePermanentTabs()` 후 `activateTab(PERM_TAB_ID)`를 실행합니다. |
| T013 | 🟢 | T010~T012의 정적 구현상 불일치는 발견되지 않았습니다. |
| T014 | ⏳ | 서버 재시작/다른 브라우저 및 서버 접근 불가 상황은 실제 환경에서 확인해야 합니다. |

### User Story 3

| Task | 결과 | 검증 내용 |
|---|---|---|
| T015 | 🟢 | `bulkExportSettings()`는 `overseas_custom` 또는 `exchange_rate` 탭이 하나도 없으면 안내 후 종료하고 다운로드를 실행하지 않습니다. |
| T016 | 🟢 | TXT를 즉시 다운로드하고 JSON은 `setTimeout(..., 100)` 후 다운로드하도록 구현되어 있습니다. |
| T017 | 🟢 | TXT import는 `[탭이름]` 단위로 커스텀 탭을 생성/갱신하며 기존 고정 탭이나 메모/갱신 간격을 직접 변경하는 로직은 없습니다. |
| T018 | 🟢 | JSON에서 `data.tabs && data.contents`를 확인한 뒤 전체 백업으로 판별하고, `confirm()` 후 `applyFullStateBackup(data)`를 호출합니다. |
| T019 | 🟢 | T015~T018에 대한 정적 코드 불일치는 확인되지 않았습니다. |
| T020 | ⏳ | 서버 프로젝트 루트 백업 파일 생성 및 서버 백업을 이용한 복원 런타임 확인이 필요합니다. |

### Polish

| Task | 결과 | 검증 내용 |
|---|---|---|
| T021 | 🟢 | 현재 `getSerializedState()`가 저장하는 스냅샷에는 API key/token 필드가 없고, 서버 `/api/settings`는 설정 스냅샷을 설정 JSON에 저장합니다. 앱 설정 저장 경로에서 API 키를 추가하는 코드는 확인되지 않았습니다. 단, 실제 파일 내용까지는 별도 확인이 필요합니다. |
| T022 | 🟢 | 마이그레이션 감사에서 확인한 기존 3.4절 정책을 대조한 결과, 공유 서버 파일에 전체 스냅샷을 저장하고 동시 저장 시 마지막 POST의 전체 상태가 남으며 필드 병합/충돌 알림이 없다는 한계가 006의 snapshot/last-write-wins 설명과 일치함을 확인했다. |
| T023 | ⏳ | quickstart 전체 시나리오 1~6은 실제 브라우저/서버 환경에서 실행해야 합니다. |

### Modification Pending

1. **T004 / T008** — 메모 저장 시 FR-001의 전체 설정 자동 저장 요구와 현재 `saveMemoToServer()` 별도 저장 경로의 정합성 검토가 필요합니다.
2. T001 — `.gitignore` 확인 필요.
3. T022 — 마이그레이션 감사에서 확인한 기존 3.4절 충돌 정책과 대조 완료. 이후에는 006 Spec Kit 문서를 기준으로 유지한다.

### Runtime Verification Pending

- T009: 탭 이름 변경 후 새로고침 / 서버 중지 상태 저장
- T014: 다른 브라우저 서버 설정 우선 / 서버 장애 로컬 폴백
- T020: 전체 JSON 백업 생성 및 복원
- T023: 전체 quickstart 1~6

### 현재 결론

정적 코드 기준으로 **핵심적인 수정 후보는 T004 하나**입니다.
특히 이번 검증에서 `saveAppData()`가 대부분의 설정 변경을 자동 저장하지만 **메모 저장만 별도의 `/api/settings/memo` 경로를 사용**한다는 점이 확인되었습니다. Spec의 FR-001은 메모 저장도 전체 설정 자동 저장 대상이라고 명시하므로, 코드 수정 전에 이 경계를 결정해야 합니다.

## 2026-10-01 Implementation Update

구현 기준 불일치와 메모 내구성 문제를 수정했다. 메모 저장 실패 시 미동기화 로컬 사본을 유지하고, 오래된 서버 값이 이를 덮지 않도록 했으며, 설정 파일 원자 저장·직전 메모 백업·저장 시각 보존을 추가했다. 메모 저장은 사용자가 저장 버튼을 누를 때만 별도 API로 실행된다는 기존 동작을 FR-001에 명확히 기록했다.

localhost 재시작 후 메모 API 왕복과 `memoUpdatedAt`을 생략한 일반 설정 POST를 실행했다. 응답은 모두 성공했고, 읽어온 뒤 메모 내용 hash와 저장 시각이 유지됐다. **사용자 요청에 따라 저장 실패 주입, 로컬 대기 메모 복구, 다중 브라우저, 내보내기/복원 전체 quickstart 검증은 나중에 수행한다.** 구현 완료와 이 런타임 검증 완료를 구분해 T006/T009/T014/T020/T023은 미완료로 남긴다.

위 Implementation Update가 기존 2026-09-30 로그의 `Modification Pending` 및 `현재 결론`을 대체한다. 이전 문구는 당시 확인 기록으로만 남겨 둔다.


## 2026-10-01 추가 브라우저 검증

- **T009 부분:** 테스트용 동적 탭 이름을 차트 2에서 임시 이름으로 변경하고 페이지를 재로드해 이름이 유지되는 것을 확인했다. 이름은 원래 차트 2로 복원했다. quickstart 시나리오 2(서버 중지 상태 저장 실패/경고)는 서버에 장애를 주입해야 하므로 실행하지 않았다.
- **T006/T014/T020/T023:** 저장 실패 주입, 두 브라우저 서버 우선/로컬 폴백, 전체 백업/복원 및 전체 quickstart는 미완료.


## 2026-10-01 추가 검증: T020 백업 내보내기

- 브라우저에서 테스트용 동적 탭 `차트 2`가 존재한 상태로 전체 설정 저장 버튼을 눌렀다. 내보내기 핸들러가 실행되었고, 코드 경로상 커스텀 TXT와 전체 JSON 백업을 연속 다운로드하도록 트리거한다.
- JSON 복원은 전체 앱 상태를 교체하고 서버/메모 저장까지 수행하므로, 임의 백업으로 현재 사용자 설정을 덮어쓰지 않았다. 테스트 파일을 선택해 복원 취소를 자동 검증하려 했으나 현재 CUA 파일 업로드 API가 노출되지 않아 취소 단계는 미검증이다.
- 따라서 T020/SC-004 및 T023은 미완료 유지. 사용자가 실제 다운로드 파일을 확인하고 별도 백업 사본으로 복원 후 탭 구성이 동일한지 확인해야 한다.
- T006도 서버 장애를 주입한 런타임 확인은 아직 미완료. 코드상 로컬 저장 뒤 서버 오류를 `alert()`로 통지하지만, 실제 저장 실패 때 이 동작을 확인하려면 서버 연결을 일시 차단해야 한다.

## 2026-10-01 추가 가상 브라우저 검증

- **T020 부분:** 현재 서버 설정 스냅샷(23개 탭)을 백업 파일로 선택해 JSON 전체 복원을 실행했다. 확인 절차와 완료 안내가 표시되었고, 탭 목록·설정 내용은 유지됐다. 첫 검증에서 저장된 `activeTabId`가 복원 대상 탭이 아니라 복원 직전 탭으로 남는 결함을 확인했다.
- **수정:** `applyFullStateBackup()`에서 백업의 활성 탭을 먼저 적용한 뒤 설정 스냅샷을 저장하도록 순서를 변경했다 (`public/app.js`). 같은 JSON 백업을 다시 가져와 화면의 활성 탭과 서버 `user_settings.json`의 `activeTabId`가 모두 `tab_grid_1790822002619`로 일치하는 것을 확인했다. 서버 파일의 탭 목록도 백업과 동일한 23개이며 임시 탭은 남지 않았다.
- TXT 가져오기는 `[Codex 임시검증]` 테스트 섹션을 통해 새 탭이 추가되는 것을 확인했다. 이후 JSON 백업을 다시 복원해 임시 탭이 제거되고 원래 23개 탭 구성이 되돌아오는 것을 확인했다.
- 전체 저장 버튼은 실행했지만 브라우저 다운로드 이벤트에서 TXT/JSON 각각의 실제 파일 생성 경로를 확인하지 못했다. 따라서 T020은 다운로드 파일 확인이 남아 미완료 유지한다.
- **T006 미완료:** 코드 검토상 로컬 저장 후 서버 오류를 사용자에게 `alert()`로 알린다. 실제 실패 경고 확인에는 localhost 서버를 잠시 중지해야 하며, 프로세스 시작 명령이 확인되지 않아 이 세션에서 임의로 종료하지 않았다. 사용자 확인 후 진행한다.

## 2026-10-01 T006 서버 중지 재현

- 사용자 확인에 따라 브라우저 테스트 중 localhost 서버를 중지했다. `http://localhost:3000/` 요청이 3초 제한 내 응답하지 않는 것을 확인했다.
- 기존 동적 탭 이름 변경 UI로 임시 변경을 시도했고, 화면에는 변경값이 반영된 뒤 원래 `차트 2`로 되돌렸다. 정적 코드에서 `saveAppData()`가 먼저 localStorage에 기록하고, 실패한 fetch를 catch해 `alert("서버 저장 중 오류 발생: " + e.message)`를 호출하는 것을 확인했다.
- 자동화 브라우저가 JavaScript alert를 안정적으로 노출하지 않아 실제 경고 문구 표시 여부는 런타임에서 판정하지 못했다. 따라서 T006은 코드 검토 pass / alert 런타임 미확인으로 미완료 유지한다. 포트 3000 서버 재시작 후 원래 설정이 다시 적용되는지 확인이 필요하다.

## 2026-10-01 서버 재시작 후 확인 및 초기 활성 탭 복원 수정

- 사용자가 서버를 재시작한 뒤 `GET /api/settings`가 HTTP 200으로 응답했고, 23개 탭 및 `activeTabId=tab_grid_1790822002619` (이름 `차트 2`)를 확인했다. 임시 탭 이름은 서버 데이터에 남지 않았다.
- 브라우저 재로드 시 Rank가 기본 활성 상태로 남는 별도 결함을 발견했다. `index.html`이 처음부터 Rank 콘텐츠에 `active` 클래스를 두어 `applyData()`가 저장된 `activeTabId`를 적용하지 못했다.
- 초기 설정 적용 전에 기본 active 클래스를 지우도록 수정했고 (`public/app.js`), 재로드 후 화면 활성 콘텐츠가 `tab_grid_1790822002619`임을 확인했다.
- 사용자가 요청한 복원된 활성 탭과 서버 설정 일치 확인은 pass. T006의 실패 경고 노출 여부는 여전히 미확인이다.

## 2026-10-01 백업 내보내기 검증 범위 정정

- TXT/JSON 내보내기 구현은 브라우저의 `<a download>`를 사용하므로 파일은 브라우저가 실행되는 PC의 다운로드 위치에 저장된다. Oracle 서버의 프로젝트 루트에 저장되는 동작은 구현되어 있지 않다.
- 앞서 기록한 `Downloads`의 파일명/크기/내용 검사는 Codex 실행 환경에서 브라우저 다운로드 결과를 검사한 것이다. Oracle 서버 파일 시스템에 백업 파일이 생성됐다는 증거가 아니며, `user_settings.json`과 다운로드 JSON의 비교도 서버 파일 저장 동작을 검증하지 않는다.
- 따라서 T020의 브라우저 다운로드 및 가져오기/복원 시나리오는 검증했지만, 사용자가 Oracle 서버 루트에 파일 저장을 기대한다면 이는 현재 spec의 “PC에 저장하기”와 다른 요구사항이다. 서버 루트 저장은 미구현이며, 이 검증 범위에는 포함하지 않는다.

## 2026-10-01 프로젝트 루트 저장/복원 요구 반영

- 사용자 요청에 따라 정상 동기화 설정과 메모의 영구 저장 위치를 서버 프로젝트 루트 파일로 확정했다. 브라우저 `localStorage`는 서버 장애 시 미동기화 변경 복구를 위해 남기는 임시 사본이다. 브라우저 세션 토큰은 기존처럼 브라우저에만 보관한다.
- TXT/JSON 백업 다운로드를 서버 POST로 변경해 파일명을 서버에서 생성하고 `__dirname`(프로젝트 루트)에 저장한다. 생성된 JSON 백업을 서버에서 목록 조회/읽기 후 UI에서 선택해 복원할 수 있게 했다. 경로 탐색 문자열은 허용 파일명 정규식으로 차단하며 백업 파일 패턴은 `.gitignore`에 추가했다.
- T020은 localhost 재시작 후 루트 파일 생성, 목록/읽기 및 복원 경로를 실제 확인할 때까지 미완료다. 이전의 Downloads 폴더 확인은 Oracle 루트 저장 검증으로 간주하지 않는다.

## 2026-10-01 단일 프로젝트 루트 가져오기

- 사용자 요청에 따라 별도 PC 파일 불러오기 버튼을 제거하고, 단일 📂 버튼이 항상 현재 백엔드 프로젝트 루트에서 가져오도록 변경했다. localhost에서는 로컬 프로젝트 루트, Oracle 도메인에서는 Oracle 프로젝트 루트를 가리킨다.
- 당시 루트 목록에는 `user_settings.json`과 생성된 TXT/JSON 백업만 포함했다. 현재 이름은 `autosaved_user_settings.json`으로 바꾸고 이전 TXT 백업도 계속 읽을 수 있도록 한다.
- localhost의 격리된 3100 포트에서 목록과 기존 `user_settings.json` 읽기를 검증했다. 프로젝트 루트의 현재 설정은 23개 탭이며, 구문 검사도 통과했다. Oracle에는 변경을 배포한 뒤 새 파일명/백업명 목록과 복원 흐름을 확인해야 하므로 T020은 미완료다.

## 2026-10-01 저장 파일명 및 백업 접두어 정리

- 자동 저장 파일명을 `autosaved_user_settings.json`으로 변경했다. 프로젝트 루트의 기존 파일은 사용자가 같은 이름으로 직접 변경하기로 했다. `.gitignore`에는 새 이름과 이전 이름을 모두 유지해 데이터가 실수로 커밋되지 않도록 했다.
- 새 TXT/JSON 백업은 확장자로 용도를 구분하고 접두어는 `full_backup_<timestamp>`로 통일했다. 기존 `bulk_settings_<timestamp>.txt`는 이전 백업 호환을 위해 읽기 허용 목록에 남겼다.
- 새 자동 저장 파일과 백업 이름은 프로젝트 루트에서 읽고 쓸 수 있지만, 사용자가 파일명을 변경한 뒤 Oracle 재시작/런타임 확인 전까지 T020은 미완료다.

## 2026-10-02 추가 런타임 확인

- 테스트용 서버를 프로젝트 루트에서 별도 포트(3137)로 실행해 읽기 API만 확인했다. `GET /api/settings`는 HTTP 200, `success=true`, 23개 탭, `Cache-Control: no-store...`를 반환했다. 설정 스냅샷 최상위 필드에서 API key/secret/token 필드는 발견되지 않았다. `GET /api/settings/backups`도 HTTP 200으로 성공했고 기존 자동 저장 파일 1개를 반환했다. 테스트 서버는 확인 후 종료했다.
- T020 백업 생성 API의 격리 검증은 프로젝트 루트 파일 쓰기 단계에서 Windows `EPERM`을 반환해 완료하지 못했다. 테스트 백업 파일은 생성되지 않았고 서버 설정 파일도 변경하지 않았다. 이 환경에서 프로젝트 루트 파일 쓰기가 허용된 서버 실행 환경에서 다시 확인해야 한다.
- **미완료 유지:** T006의 실제 UI 경고 확인, T009 서버 오프라인 시나리오, T014 다른 브라우저/서버 오프라인 폴백, T020 백업 파일 생성 및 UI 복원, T023 전체 브라우저 시나리오. 이번 실행에서는 브라우저 시나리오를 수행하지 않았다.

## 2026-10-03 오프라인 폴백 검증 시도

- 사용자는 Chrome Network에서 `Offline`을 켜고 페이지 새로고침을 시도했다. 이때 브라우저가 앱 정적 파일 요청도 차단해 `ERR_CONNECTION_REFUSED`/공룡 오프라인 화면이 나타났다. 이는 설정 폴백 결과가 아니다.
- 서버를 다시 켜고 앱이 열린 상태에서 `Offline`을 선택한 뒤 앱의 `전체조회`를 실행했다. 사용자가 확인한 화면에서는 탭과 레이아웃이 남아 있었고 차트 안 외부 콘텐츠는 갱신되지 않았다. 이는 열린 문서가 유지된 상태의 네트워크 차단 관찰이며, 초기 `/api/settings` 실패 후 localStorage 스냅샷이 선택됐다는 증거로는 부족하다.
- Network에 보인 `settings?_t=...` 요청은 사용자가 Headers에서 HTTP 200을 확인했다. 기록이 Offline 전 요청인지 이후 새 요청인지 확인되지 않아 실패 증거로 계산하지 않는다. 이후 Offline 상태에서 앱은 보였으나 새 `settings` 요청이 목록에 나타나지 않았다.
- 별도 격리 검증으로 프로젝트 파일을 제공하는 테스트 서버와 새 Puppeteer 프로필을 준비하고 `/api/settings`만 차단하도록 설정했다. 브라우저는 HTML/CSS/JS 파일을 요청했으나 테스트 페이지 초기화/요청 발생 단계에서 멈춰 결과를 수집하지 못했다. 테스트 프로세스를 종료했으며 프로젝트 설정 파일은 수정하지 않았다.
- **T014 오프라인 폴백은 미검증 상태로 유지한다.** 앞선 브라우저 테스트의 서버 우선 적용 확인과 이 오프라인 폴백 확인은 별도 결과로 취급한다. T006/T009/T020/T023의 기존 미완료 상태도 유지한다.

## 2026-10-03 설정·백업 파일명 통일

- 영구 설정 파일의 활성 경로는 `autosaved_user_settings.json`으로 통일한다. 사용자가 프로젝트 루트의 기존 파일명을 직접 변경하기로 했다. 과거 검증 로그의 `user_settings.json` 표기는 당시 기록이며 현재 코드 경로를 뜻하지 않는다.
- TXT와 JSON 백업은 용도가 확장자로 구분되므로 공통 접두어 `full_backup_<timestamp>`를 사용한다. 새 생성은 이미 이 규칙을 따르고 있었으며, 이번 정리에서 과거 `bulk_settings_<timestamp>.txt`를 API 목록/읽기에서 허용하던 호환 분기를 제거했다.
- 기존 `bulk_settings_*.txt` 파일은 디스크에서 삭제하지 않으며 새 JSON 백업 흐름에서 제공하지 않는다. `.gitignore`의 구형 TXT 패턴은 과거 파일 보호를 위해 유지한다.

## 2026-10-03 전체 백업 JSON 단일화

- 사용자 결정에 따라 서버 프로젝트 루트 백업을 `full_backup_<timestamp>.json` 한 파일로 통일한다. 전체 스냅샷 JSON 자체에 사용자 정의 탭을 포함한 모든 앱 설정이 있으므로 별도 커스텀 탭 TXT 백업은 만들지 않는다.
- 백업 버튼은 커스텀 탭 유무와 관계없이 전체 상태 JSON 하나를 저장한다. 가져오기 버튼은 서버 루트의 자동 저장 JSON 또는 전체 백업 JSON을 선택하고, 전체 교체 확인 후 복원한다. 서버 API의 목록/읽기/쓰기 허용 형식도 `.json`으로 제한한다.
- 과거 T016/T017의 TXT+JSON 일괄 백업 및 TXT 커스텀 탭 가져오기 요구는 이 결정으로 대체됐다. 개별 차트 입력 모달의 `.txt` 파일 입출력은 별도 기능이므로 유지한다. 기존 프로젝트 루트의 TXT 백업 파일은 삭제하지 않지만 새 가져오기 목록에서는 노출하지 않는다.
- T020은 JSON 한 파일 생성·목록·복원 런타임 검증이 남아 있으므로 미완료다.

## 2026-10-03 백업 파일명 변경

- 새 전체 설정 백업 파일명을 `manualsaved_user_settings_<timestamp>.json`으로 바꿨다. 내용은 `autosaved_user_settings.json`과 동일한 AppSettingsSnapshot 구조이며, 파일명과 스냅샷 시점만 구별된다.
- 기존 `full_backup_<timestamp>.json` 파일은 이름을 바꾸거나 삭제하지 않는다. API 목록과 복원에서 계속 읽을 수 있게 두고, 이후 저장부터 새 접두어를 사용한다. `.gitignore`에는 새 이름 패턴을 추가했다.

## 2026-10-03 백업 선택 모달

- 번호 입력 `prompt`를 스크롤 가능한 앱 모달로 교체했다. 파일명 검색, 수정 시각·크기 표시, 최신순 정렬, 키보드 위/아래·Enter·Escape, 취소 및 명시적 전체 복원 확인을 지원한다.
- 구현 당시에는 런타임 UI 검증을 실행하지 않았다. 이후 사용자가 Oracle 클라우드에서 정상 동작을 확인해 T020을 완료 처리했다.

## 2026-10-03 T020 Oracle 클라우드 확인

- 사용자가 Oracle 클라우드 배포 환경에서 백업 선택 모달이 정상 동작하는 것을 확인했다. 프로젝트 루트 JSON 목록에서 선택하고 복원하는 흐름을 확인했으며, 백업 JSON 단일 파일 동작 기준으로 T020/SC-004를 완료 처리했다.
- T023의 전체 quickstart 검증과 T006/T009/T014는 별도 항목이므로 미완료 상태를 유지한다.
