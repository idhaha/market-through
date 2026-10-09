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

추가 소스: `concentration-chart.js`, `public/concentration-chart.js`, `dev_tools/debug/concentration-chart.test.js`, `dev_tools/debug/concentration-chart-ui.test.js`. 상세 구현 참고: ../../docs/CONCENTRATION_CHART.md. 기존 SC-001~004 미검증 항목은 차트 테스트 통과와 별개로 유지한다.

분봉 X축은 하루 전체 또는 120봉 이하 구간에서 시간만 표시하며 매시 경계를 기준으로 눈금을 배치한다. 좁은 화면에서는 눈금 간격을 늘리고 툴팁·하단 기간의 분 표시는 유지한다.

분봉 X축은 전체 보기에서 시간만 표시하고, 확대 후 인접 눈금 사이에 충분한 여유가 있으면 30분 간격(09:00·09:30 등)으로 표시한다. 화면이 좁으면 매시 또는 더 넓은 간격을 유지한다.

분봉 X축 눈금에는 시·분 접미사를 붙이지 않는다. 매시 간격은 09·10처럼, 30분 간격은 09:00·09:30처럼 표시한다.

## 5분봉 원본 비교 디버깅 (2026-10-08)

차트 오른쪽에 삼성전자(ka10080, 통합 거래소 005930_AL)와 코스피(ka20005, 업종 001)의 최근 완료된 5분봉 5개를 각각 최신순으로 표시한다. cntr_tm은 봉 시작 시각이며 시작+5분이 지난 봉만 포함한다. cur_prc·trde_qty는 부호·선행 0을 포함한 원본 값을 그대로 표시한다. 두 원천을 따로 표시해 시장 데이터 누락을 숨기지 않는다. 비교 대상은 차트 선택 종목·간격과 독립적이다.

최초 화면 표시 때 조회하고 5분 경계 2초 뒤마다 재조회한다. 진행 중 봉은 제외하고 조회 실패 시 기존 표를 유지한다. 중복 조회·숨김 문서·캡처 중 조회를 건너뛰며 문서 복귀 시 재조회한다. 디버깅용 타이머는 Rank 주기의 차트 갱신 타이머와 별도다. 데스크톱 패널 폭은 기존 절반 폭에 360px를 추가하며 휴대폰은 표를 차트 아래에 배치한다.

차트 API의 minute/interval=5 응답은 debug_five_bars={fetched_at, stock, market}를 추가한다. stock·market 배열 항목은 {cntr_tm, cur_prc, trde_qty} 원본 필드이며 다른 봉 종류·간격에서는 debug_five_bars=null이다. 디버깅 요청은 code=005930, mode=minute, interval=5를 고정한다. 운영 서버는 새 응답 필드 반영을 위해 재시작해야 한다.

## 차트 종목 직접 입력

차트 종목명은 편집 가능한 입력란이다. 정확한 종목명 또는 6자리 종목코드를 입력하고 Enter를 누르면 테이블 표시 여부와 무관하게 해당 종목 차트를 조회한다. 현재 일/분 및 간격 설정은 유지한다. 실패 시 기존 선택과 차트를 유지하며 오류를 안내하고, 검색 중 테이블 종목을 선택하면 늦은 검색 결과를 무시한다.

인증된 GET /api/concentration-stock?q=입력값은 {success:true, stock:{code,name,market}}를 반환한다. 이름 조회는 ka10099의 코스피/코스닥 전체 연속조회 목록으로 정확히 일치하는 종목을 찾고 성공 목록을 24시간 메모리 캐시한다. 코드 조회는 ka10100으로 이름과 시장을 검증한다. 빈 입력 400, 미일치/모호한 이름/지원하지 않는 시장 404, 외부 오류 502다. 최초 이름 조회는 목록을 가져오는 시간이 필요하다. 서버 재시작이 필요하다.

### 디버깅 대상 및 조회 방식 수정

이전 삼성전자 고정 규칙을 대체한다. 디버깅은 테이블 또는 직접 입력으로 선택한 종목과 해당 시장(코스피 001 / 코스닥 101)의 완료된 최근 5개 5분봉을 표시한다. 선택 즉시 재조회하고, 다른 종목의 늦은 응답을 취소·무시한다. 차트 봉 설정과 무관하게 디버깅은 5분봉을 사용한다.

POST /api/concentration-chart에 {code:선택종목, mode:"minute", interval:5, debug_five:true}를 보내면 최신 원천 페이지 두 개만 조회하여 {success,market,debug_five_bars}를 반환한다. 과거 기록 보충·차트 커서 생성은 생략한다. 빈 데이터·조회 실패·서버 응답 필드 누락을 표에 안내한다. 실패 시 같은 종목의 기존 값은 보존한다. 새 서버 코드 적용에는 재시작이 필요하다.

### KRX 종료 후 디버깅 갱신 중지

한국 시간 평일 09:00~15:30에만 디버깅을 조회한다. 15:30 경계의 예약 조회는 2초 뒤 마지막 완료 봉을 한 번 가져오고 중지한다. 이후 예약·종목 선택·문서 복귀로도 디버깅을 조회하지 않으며 기존 표를 유지하고 갱신 중지 상태를 표시한다. 다음 평일 정규장 시간에 예약 조회가 재개된다. 일반 쏠림율 차트의 Rank 주기 갱신 규칙은 유지한다. 이 시간 게이트는 정규 시간 기준이며 휴장일·특별 운영시간 자동 판별은 포함하지 않는다.

## 쏠림율 아래 종목 캔들차트

종목 ka10080/ka10081 원본 open_pric·high_pric·low_pric·cur_prc의 절댓값을 stock_open·stock_high·stock_low·stock_price로 전달한다. 같은 봉 배열과 X좌표를 공유하는 캔들차트를 쏠림율 아래 기본 펼침 상태로 표시하며 버튼으로 접거나 펼친다. 시가보다 현재가가 높으면 붉은색, 낮으면 파란색, 같으면 회색이다. OHLC가 누락·무효이면 해당 위치는 유지하고 캔들을 그리지 않는다.

일봉·모든 분 간격·추가조회·확대·이동·자동갱신·계산 불가 분봉 제거가 두 차트에 동일하게 반영된다. 어느 차트에서 마우스를 이동해도 동일 봉의 날짜/시간·쏠림율·OHLC와 시가 대비 상승률((현재가/시가-1)×100)을 함께 표시하고 두 차트에 같은 세로 위치선을 표시한다. 시가가 없거나 0이면 상승률은 -다. 가격 축은 현재 표시 범위의 OHLC에 맞춰 조절하되 시간축은 쏠림율 차트와 정확히 공유한다. 서버 재시작 후 새 OHLC 필드를 받을 수 있다.

### 마우스 정보와 전일 대비 상승률

마우스 정보는 상단 차트 밖의 고정 높이 영역 한 곳에 표시해 두 그래프를 가리지 않는다. 날짜/시간 · 쏠림율 · 상승률 순으로 표시하고 OHLC 및 시가 대비 문구는 제거한다. 상승률은 (현재 봉 현재가 / 전일 종가 - 1) × 100이다.

원천 pred_pre 및 pred_pre_sig(1/2 상승, 4/5 하락, 3 보합)로 전일 종가를 복원하여 stock_previous_close·stock_change_rate를 반환한다. 전일 대비 기호가 없으면 명시적 부호가 있는 pred_pre 또는 0만 사용한다. 일봉은 전일 대비 필드가 없을 때 직전 거래일 봉 종가를 사용할 수 있다. 분봉은 직전 분봉 또는 당일 시가를 전일 종가로 대체하지 않는다. 기준을 확인할 수 없으면 상승률은 -다. 새 필드는 서버 재시작 후 적용된다.

### 차트 내부 여백에 마우스 정보 배치

고정 외부 정보 영역을 제거하고 기존 정보 색상을 유지한 채 두 차트 안에 정보를 표시한다. 선택 봉의 위·아래 공간을 비교해 여유가 큰 쪽 끝을 우선 선택한다. 정보 상자와 선분·표식 또는 캔들 고저가 영역의 충돌을 검사해 좌우 빈 위치를 찾는다. 우선 방향에 빈 위치가 없으면 반대 방향을 확인하고, 모든 위치가 겹치는 경우 겹침이 가장 적은 위치를 사용한다. 상자는 차트 가로 경계를 넘지 않고 마우스 이벤트를 가로막지 않는다. 날짜/시간·쏠림율·전일 대비 상승률 내용은 유지한다.


두 차트 모두 포인터 드래그 확대/전체 복원을 지원한다. 어느 차트에서 시작해도 드래그 진행 영역의 X좌표·폭·방향별 색상을 두 차트에 동일하게 표시한다. 공유 표시 범위를 변경하므로 종료 후 확대/복원 결과도 동일하다. 포인터 캡처·취소 처리는 드래그를 시작한 캔버스에 귀속하며 조회를 추가로 발생시키지 않는다.

### Rank 차트 펼침 상태 저장

사용자 설정 스냅샷에 rankChartDisplay={debugOpen:boolean,candleOpen:boolean}를 포함한다. 둘의 기본값은 false이며 필드가 없는 예전 설정도 닫힘으로 복원한다. 버튼 변경은 기존 saveAppData 경로로 로컬 설정과 autosaved_user_settings.json에 저장한다. 전체 설정 다운로드 및 manualsaved_user_settings/full_backup 수동 백업도 같은 스냅샷 필드를 포함한다. 기존 설정 파일·과거 백업을 직접 덮어써서 마이그레이션하지 않는다.

시작 시 서버/로컬 설정 적용과 수동 백업 복원 모두 동일한 상태 적용 함수를 사용한다. 복원 자체는 토글 클릭이나 별도 자동 저장을 발생시키지 않는다. 값은 엄격한 boolean true만 펼침으로 처리한다. 저장 실패 처리는 기존 설정 동기화 정책을 따른다.

## 개발 도구 폴더 정리 (2026-10-09)

개발용 JS·Python 실행 파일은 dev_tools/debug에 모으고 PNG·TXT·JSON·LOG·HTML 조회 결과 및 자료는 dev_tools/output에 모은다. 기존 experiments/tests/logs/exports 하위 폴더는 이 기준으로 통합했다. 출력 경로는 실행 작업 디렉터리와 무관하게 스크립트 위치 기준 dev_tools/output으로 지정한다. 서버 디버그 로그도 dev_tools/output/server_debug.log에 기록한다. 자동 회귀 테스트도 dev_tools/debug에 포함한다. 과거 fix/patch 스크립트는 일회성 수정 도구이며 이동 과정에서 실행하지 않는다.

데이터 추출 예: node dev_tools/debug/export-kospi-five-minute.js, node dev_tools/debug/check-kospi-outside-session.js. 정리는 파일 이동 전후 SHA256 일치로 검증했고, 변경한 스크립트는 구문 검사로 확인한다. API 호출이나 과거 패치 실행은 검증에 필요하지 않다.
