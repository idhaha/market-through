\# Specification Quality Checklist: Rank 탭 — 실시간 종목 순위 모니터링



\*\*Purpose\*\*: Validate specification completeness and quality before proceeding to planning

\*\*Created\*\*: 2026-09-29

\*\*Feature\*\*: specs/001-rank-tab/spec.md



\## Content Quality



\- \[x] No implementation details (languages, frameworks, APIs)

\- \[x] Focused on user value and business needs

\- \[x] Written for non-technical stakeholders

\- \[x] All mandatory sections completed



\## Requirement Completeness



\- \[x] No \[NEEDS CLARIFICATION] markers remain

\- \[x] Requirements are testable and unambiguous

\- \[x] Success criteria are measurable

\- \[x] Success criteria are technology-agnostic (no implementation details)

\- \[x] All acceptance scenarios are defined

\- \[x] Edge cases are identified

\- \[x] Scope is clearly bounded

\- \[x] Dependencies and assumptions identified



\## Feature Readiness



\- \[x] All functional requirements have clear acceptance criteria

\- \[x] User scenarios cover primary flows

\- \[x] Feature meets measurable outcomes defined in Success Criteria

\- \[x] No implementation details leak into specification



\## Notes



\- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.

## 2026-10-07 쏠림율 확장 문서 검토

- [x] FR-010을 두 순위 테이블에 적용하고 시장 미확인 시 계산 불가를 명시했다.
- [x] US4, FR-022~031, SC-005~008 및 acceptance scenarios를 추가했다.
- [x] 일봉 실제 거래대금과 분봉 사용자 지정 추정식을 구분하고 단위·원천 API 계약을 별도 문서에 명시했다.
- [x] 조회 실패·시장 누락·커서 만료·경합·캡처·로딩·휴대폰·자동 갱신 상태 보존을 포함했다.
- [x] 데이터 모델·계획·계약·검증 절차·완료 작업 목록을 같은 범위로 갱신했다.
- [x] 모의 테스트 통과, 실제 응답 검산, 기존 운영 검증 보류 상태를 구분했다.

이 체크리스트는 명세 완결성 검토이며 배포 완료 또는 기존 SC-001~004 전체 통과 판정이 아니다.

## Rank ADR 및 공통 차트 문서 검토 (2026-10-13)

- [x] ADR 고정탭은 제거하고 Rank ADR의 데이터 소스/API/기간 선택 범위를 명시한다.
- [x] FR-032~040, SC-009~011 및 T066~074가 최신 구현을 설명한다.
- [x] 시간 단위·거래일 전환·빈 intraday·lastClosed·장외 asOf의 의미와 서버 저장 없음이 명시돼 있다.
- [x] 캔들 API 시장·모드·연속조회·가격 배율·부분 조회·인증/실패 응답이 계약에 있다.
- [x] 정보창 한 곳·X축 배지 제거·최종값 위치·줌 바 순서/간격/무채움·쏠림율 연도를 반영했다.
- [x] 실제 원천 확인과 모의 브라우저/API 테스트, 운영 미검증 범위를 구분했다.
- [x] 현재 단계는 로컬 구현 문서화이며 새 기능 branch/활성 feature 선택이나 운영 배포를 변경하지 않았다.

- [x] 고정 ADR 화면·조회·타이머·설정 제거와 이전 백업 호환을 FR-041/SC-012에 명시한다.

## 거래대금 및 세 차트 최종 문서 검토 (2026-10-13)

- [x] US6·FR-042~050/056·SC-013~017에 두 시장 동시 표시/선 강조·일봉 기간·당일 1분 누적·캔들·줌·Rank 갱신 범위를 명시했다.
- [x] 일봉 쏠림율과 같은 원천/원 단위 market_turnover, 공유 변환·null/0 구분·OHLC 제외 정책을 계약/모델에 기록했다.
- [x] 제목·당일 1분·MAX/MIN 제거·80/100/120 빨강과 한 줄 배치로 기존 ADR 요구사항을 갱신했다.
- [x] 오른쪽 Y축·공통 가로 점선·이동 점·오늘 주황 점·수평선/값 배지·끝 점 잘림 방지·공통 마지막 값 글꼴/정렬을 기록했다.
- [x] 거래대금의 커서 정보 줄과 오늘 값 두 줄, 시장명 왼쪽/수치 오른쪽 정렬·오늘 누락 시 —를 구분했다.
- [x] 기존 UI 폭/모든 봉 표식/극값 기록의 대체 범위와 FR/SC/task 의존성을 명시했다.
- [x] 모의 브라우저/API/픽셀 검증과 사용자 Oracle 운영 확인을 구분했다. T089는 2026-10-13 사용자 확인으로 완료하고 실제 데이터 검산·항목별 상세 검증은 T088/T090에 남겼다.
- [x] 새 브랜치·활성 feature 선택·사용자 백업·서버 기록 저장·운영 배포를 변경하지 않는 기존 Rank 문서 갱신이다.

검토 결과: 이번 추가 요구사항에는 미해결 clarification 표시가 없다. API·색상 코드·글꼴 구현 상세는 plan/contracts/model에 기록하며 기능 요구사항은 사용자 동작으로 정의했다. 기존 브라운필드 문서의 다른 미완료 항목 및 과거 단계 기록은 이번 검토로 완료 처리하지 않는다.

### 당일 1분 누적 검토 (2026-10-14)

- [x] 실제 일봉 거래대금과 추정 분봉 누적값을 분리하고, ka20005 거래량/누적거래량을 실제 거래대금으로 오인하지 않는다.
- [x] 일봉만 제공한다는 이전 설명을 현재 일봉·당일 1분 전환 동작에 맞춰 수정했다.
- [x] 두 시장 누적, 전일 주황색 기준선, 겹치지 않는 레이블, 일봉과 동일한 선·마지막 점, 마우스오버 비율과 기준값 누락 처리를 검증 가능한 요구사항으로 기록했다.
- [x] 미선택 선만 흐리게 하고 두 시장의 범례 이름·최신 수치는 항상 고유색으로 선명하게 유지하도록 기록했다.
- [x] 모의 테스트와 2026-10-14 단일 일자 실제 추정 오차를 구분하고 Oracle 장중·휴장일 재확인을 미완료로 남겼다.

### 운영 확인 추가 (2026-10-13)

- [x] 사용자 보고 “oracle에서 세 차트 모드 잘 동작한다”를 세 차트의 운영 정상 동작 확인으로 기록했다.
- [x] 운영 확인 주체·날짜·범위를 quickstart에 명시하고, 상세 데이터/상태/환경 검증까지 완료한 것으로 확대하지 않았다.
## 2026-10-18 시장 위험지표 확장 명세 검토

- [x] 사용자 관점의 두 시나리오와 독립 검증 조건을 기록했다.
- [x] 데이터 보존 범위(ADR 하루/위험지표 누적), 부분 실패와 VIX 결측을 구분했다.
- [x] 기존 요구사항과 충돌하는 ADR 서버 저장 금지·브라우저 전용 기록을 최신 절로 대체했다.
- [x] 최종 사용자 수정(캔들 종가 기준, 중립 수치색, 제목 대신 i, CNN/HY 내부 탭)을 반영했다.
- [x] 기간·배치·축·설정 복원·줌·설명·카드 높이를 검증 가능한 요구사항으로 기록했다.
- [x] 원천 기간 응답에서 미보유 날짜만 저장하는 동작과 미보유 날짜만 네트워크 수신한다는 보장을 구별했다.
- [x] 미해결 clarification 표시 없이 코드·계약·모델·계획·작업을 상호 연결했다.
- [x] 로컬 검증과 Oracle 운영 검증을 분리하고 기존 미완료 작업을 유지했다.

명세 검토 통과. 기존 기능 문서 갱신이므로 새 feature·브랜치·활성 feature 선택은 만들지 않았다. 구현 계획은 현재 코드에 동기화했으며 다음 단계는 T116/T117 운영 검증이다.
## 2026-10-20 상태점 명세 검토

- [x] 카드별 위치·점 개수·크기 불변을 명시했다.
- [x] 녹색/빨간색과 최초 미수신·실패·지연·오프라인을 검증 가능하게 정의했다.
- [x] 연결 상태와 시세의 날짜/정확성을 구분하고 지연 계산은 plan에 기록했다.
- [x] 메인/독립창 동기화·원래 시각 유지·독립 종목 예외·중복 점 방지를 포함했다.
- [x] 실제 로컬 테스트와 Oracle 미완료 검증을 구분했다. 새 미해결 clarification은 없다.
