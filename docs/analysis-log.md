\# Spec-Kit 정합성 분석 로그



이 파일은 `/speckit-analyze` 실행 결과를 기록합니다. 원래 spec-kit 워크플로우는 이 리포트를 파일로 저장하지 않지만(read-only 분석), 재작업 방지를 위해 이 프로젝트에서는 별도로 남깁니다.



\---



\## 2026-09-29 — 초기 6개 기능 분석 (constitution v1.0.0 기준)



\### 001-rank-tab — MEDIUM 4건 발견



| ID | Category | Severity | Location(s) | Summary | Recommendation | Status |

|----|----------|----------|-------------|---------|----------------|--------|

| I1 | Inconsistency | MEDIUM | server.js:1053-1056 | `GET /api/watchlist\_debug`가 spec/plan/contracts에 미문서화, app.js에서도 미사용(디버그 전용으로 추정) | 제거하거나 spec.md Assumptions에 "디버그 전용, 미사용"으로 명시 | Open |

| C1 | Coverage Gap | MEDIUM | spec.md FR-004 | "마지막 갱신 시각 표시" 요구사항의 전용 검증 태스크 없음 | tasks.md Phase 3에 태스크 추가 | Open |

| C2 | Coverage Gap | MEDIUM | spec.md FR-005 | "로딩 상태 표시" 요구사항의 전용 검증 태스크 없음 | tasks.md Phase 3에 태스크 추가 | Open |

| E1 | Underspecification | MEDIUM | spec.md SC-003 | "외부 API 장애 시 나머지 패널 정상" 기준이 tasks.md에 명시적으로 연결 안 됨 | T017 설명에 SC-003 명시 또는 별도 태스크 신설 | Open |



Coverage: 23개 요구사항(FR 19 + SC 4) 중 19개 완전 커버 (약 82.6%). Critical: 0.



\### 002-adr-tab — 이상 없음

코드(`extractArrayFromHtml`, `getCombinedRange`, `syncToKosdaq/Kospi`, `drawLineChart`)와 spec/plan/contracts 완전 일치. `saveAppData()` 미호출(FR-008)도 확인. Coverage 100%, Critical 0.



\### 003-memo-tab — 이상 없음

Quill 초기화, `\[Today]` 버튼, 이중 저장, Google Calendar 병렬 조회, 401 처리까지 spec/plan과 일치. Coverage 100%, Critical 0.



\### 004-earnings-calendar-tab — 이상 없음

`/calendar`·`/api/toss\_calendar` 이중 경로, `refreshEarningsTab`의 100ms 로직, 캡처 중 스킵까지 spec/plan과 일치. Coverage 100%, Critical 0.



\### 005-dynamic-tabs — CRITICAL 1건 발견 (해결됨)



| ID | Category | Severity | Location(s) | Summary | Recommendation | Status |

|----|----------|----------|-------------|---------|----------------|--------|

| F1 | Inconsistency / Missing Dependency | HIGH | server.js:1904-1958, plan.md Technical Context | `GET /api/fred`가 axios가 아니라 `child\_process.exec()`로 `fred\_api.py`(Python)를 실행. plan.md Technical Context에 Python 의존성 누락 | plan.md에 Python 서브프로세스 의존성 명시 | Open (문서 미보강) |

| F2 | Constitution/Structural Conflict | CRITICAL | server.js:1925 (`exec(... 'fred\_api.py' ..., {cwd: \_\_dirname})`) | `fred\_api.py`/`requirements.txt`가 dev\_tools로 이동되어 프로젝트 루트에 없었음 → `/api/fred` 호출 시 즉시 실패(실제 장애 확인됨, `Test-Path`로 둘 다 false) | 루트로 복구 | \*\*Resolved\*\* (2026-09-29, 커밋 `6e96c4c`로 fred\_api.py/requirements.txt 루트 복구 후 push 완료) |

| C1 | Coverage Gap | LOW | tasks.md 005 | "FRED = Python 서브프로세스" 사실이 tasks.md에 검증 태스크로 없음 | Foundational 단계에 검증 태스크 추가 | Open |



Coverage: 약 95%. Critical: 1건 (해결됨).



\### 006-settings-sync — 이상 없음

`saveAppData`, `getSerializedState`, `/api/settings` GET/POST 구조가 spec/plan과 일치. Coverage 100%, Critical 0.



\---



\## Open Items 요약 (다음에 처리할 것)



\- \[V] 001: `/api/watchlist\_debug` 처리 방침 결정(제거 vs 문서화)

\- \[V] 001: tasks.md에 FR-004, FR-005, SC-003 검증 태스크 추가

\- \[V] 005: plan.md Technical Context에 Python(`fred\_api.py`) 의존성 명시

\- \[V] 005: tasks.md Foundational 단계에 FRED 서브프로세스 의존성 검증 태스크 추가


2026-10-13: 002-adr-tab 사양과 고정 ADR 기능을 삭제하고 Rank ADR 사양(001-rank-tab)으로 통합했다. 위의 과거 검토 기록은 당시 상태를 나타낸다.
