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

종목 ka10080/ka10081 원본 open_pric·high_pric·low_pric·cur_prc의 절댓값을 stock_open·stock_high·stock_low·stock_price로 전달한다. 같은 봉 배열과 X좌표를 공유하는 캔들차트를 쏠림율 아래 기본 닫힘 상태로 두고 버튼으로 펼치거나 접는다. 시가보다 현재가가 높으면 붉은색, 낮으면 파란색, 같으면 회색이다. OHLC가 누락·무효이면 해당 위치는 유지하고 캔들을 그리지 않는다.

일봉·모든 분 간격·추가조회·확대·이동·자동갱신·계산 불가 분봉 제거가 두 차트에 동일하게 반영된다. 어느 차트에서 마우스를 이동해도 동일 봉의 날짜/시간·쏠림율·전일 대비 상승률을 메인 쏠림율 차트 정보창 한 곳에 표시하고 두 차트에 같은 수직선을 표시한다. 전일 종가를 확인할 수 없으면 상승률은 -다. OHLC는 캔들 렌더링에 사용하며 정보창에는 표시하지 않는다. 가격 축은 현재 표시 범위의 OHLC에 맞춰 조절하되 시간축은 쏠림율 차트와 정확히 공유한다. 서버 재시작 후 새 OHLC 필드를 받을 수 있다.

### 마우스 정보와 전일 대비 상승률

마우스 정보는 메인 쏠림율 차트 내부의 빈 공간 한 곳에 표시하며 캔들차트에는 중복 정보창을 표시하지 않는다. 날짜/시간 · 쏠림율 · 상승률 순으로 표시하고 OHLC 및 시가 대비 문구는 제거한다. 상승률은 (현재 봉 현재가 / 전일 종가 - 1) × 100이다.

원천 pred_pre 및 pred_pre_sig(1/2 상승, 4/5 하락, 3 보합)로 전일 종가를 복원하여 stock_previous_close·stock_change_rate를 반환한다. 전일 대비 기호가 없으면 명시적 부호가 있는 pred_pre 또는 0만 사용한다. 일봉은 전일 대비 필드가 없을 때 직전 거래일 봉 종가를 사용할 수 있다. 분봉은 직전 분봉 또는 당일 시가를 전일 종가로 대체하지 않는다. 기준을 확인할 수 없으면 상승률은 -다. 새 필드는 서버 재시작 후 적용된다.

### 차트 내부 여백에 마우스 정보 배치

고정 외부 정보 영역을 제거하고 기존 정보 색상을 유지한 채 메인 쏠림율 차트 안 한 곳에만 정보를 표시한다. 선택 봉의 위·아래 공간을 비교해 여유가 큰 쪽 끝을 우선 선택한다. 정보 상자와 선분·표식 또는 캔들 고저가 영역의 충돌을 검사해 좌우 빈 위치를 찾는다. 우선 방향에 빈 위치가 없으면 반대 방향을 확인하고, 모든 위치가 겹치는 경우 겹침이 가장 적은 위치를 사용한다. 상자는 차트 가로 경계를 넘지 않고 마우스 이벤트를 가로막지 않는다. 날짜/시간·쏠림율·전일 대비 상승률 내용은 유지한다.


두 차트 모두 포인터 드래그 확대/전체 복원을 지원한다. 어느 차트에서 시작해도 드래그 진행 영역의 X좌표·폭·방향별 색상을 두 차트에 동일하게 표시한다. 공유 표시 범위를 변경하므로 종료 후 확대/복원 결과도 동일하다. 포인터 캡처·취소 처리는 드래그를 시작한 캔버스에 귀속하며 조회를 추가로 발생시키지 않는다.

### Rank 차트 펼침 상태 저장

사용자 설정 스냅샷에 rankChartDisplay={debugOpen:boolean,candleOpen:boolean}를 포함한다. 둘의 기본값은 false이며 필드가 없는 예전 설정도 닫힘으로 복원한다. 버튼 변경은 기존 saveAppData 경로로 로컬 설정과 autosaved_user_settings.json에 저장한다. 전체 설정 다운로드 및 manualsaved_user_settings/full_backup 수동 백업도 같은 스냅샷 필드를 포함한다. 기존 설정 파일·과거 백업을 직접 덮어써서 마이그레이션하지 않는다.

시작 시 서버/로컬 설정 적용과 수동 백업 복원 모두 동일한 상태 적용 함수를 사용한다. 복원 자체는 토글 클릭이나 별도 자동 저장을 발생시키지 않는다. 값은 엄격한 boolean true만 펼침으로 처리한다. 저장 실패 처리는 기존 설정 동기화 정책을 따른다.

## 개발 도구 폴더 정리 (2026-10-09)

개발용 JS·Python 실행 파일은 dev_tools/debug에 모으고 PNG·TXT·JSON·LOG·HTML 조회 결과 및 자료는 dev_tools/output에 모은다. 기존 experiments/tests/logs/exports 하위 폴더는 이 기준으로 통합했다. 출력 경로는 실행 작업 디렉터리와 무관하게 스크립트 위치 기준 dev_tools/output으로 지정한다. 서버 디버그 로그도 dev_tools/output/server_debug.log에 기록한다. 자동 회귀 테스트도 dev_tools/debug에 포함한다. 과거 fix/patch 스크립트는 일회성 수정 도구이며 이동 과정에서 실행하지 않는다.

데이터 추출 예: node dev_tools/debug/export-kospi-five-minute.js, node dev_tools/debug/check-kospi-outside-session.js. 정리는 파일 이동 전후 SHA256 일치로 검증했고, 변경한 스크립트는 구문 검사로 확인한다. API 호출이나 과거 패치 실행은 검증에 필요하지 않다.

## Rank ADR 및 공통 표시 갱신 (2026-10-13)

- `public/rank-adr-chart.js`가 vanilla canvas로 ADR·지수 캔들·시간축·줌·커서를 관리한다. `public/index.html`에 정적 패널을 두고 `public/style.css`로 쏠림율과 나란히 배치한다.
- `server.js`의 인증된 GET `/api/adr/today`, `/api/adr/history`, `/api/adr/candles`는 각각 외부 ADR JSON, 일별 시계열, 키움 지수 OHLC를 반환한다. 고정 ADR 탭의 HTML 프록시 `/api/adr`는 제거한다.
- `loadTransactionRank()` 시작 시 ADR 갱신을 호출한다. Rank의 설정된 타이머와 캡처 건너뛰기를 공유하며 일/1분 모드 둘 다 같은 주기를 사용한다. 캔들은 펼친 상태에서 ADR 갱신 뒤 조회한다.
- 브라우저에서 초/밀리초 시간 단위를 정규화하고 분 단위로 병합한다. 시장별 마지막 수신 시각·거래일·분봉을 메모리에 유지하며 당일 분봉만 localStorage에 보관할 수 있다. 서버에는 일별·분별 차트 기록을 쓰지 않는다.
- 기간 API는 원천 범위를 그대로 조회한다. 지수는 ka20006(일)/ka20005(1분), 업종 001/101을 사용하고 요청 내 최대 12페이지 및 페이지 사이 350ms 지연으로 조회를 제한한다. 한도에 걸리면 일부 구간 표시를 안내하며 장기 기록을 서버에 축적하지 않는다.
- 확대 창은 전체 수신 배열과 별도로 관리하고 지수의 표시 범위와 X좌표를 공유한다. 드래그 중 자동 갱신은 종료 후 처리한다. 조회 취소·최신 요청 확인으로 오래된 시장/기간 응답을 차단한다.
- 두 메인 차트만 정보창을 표시한다. 최종값은 버튼 줄 오른쪽, 하단은 줌 바→기간 정보(8px), 쏠림율 기간은 연도 포함, range 트랙은 채움 없는 동일 색이다.
- 쏠림율 캔들 높이를 ADR 기준 높이 계산에서 제외한다. ResizeObserver 쓰기는 requestAnimationFrame에서 처리하고 변경된 크기만 적용한다.
- 검증: `dev_tools/debug/rank-adr.test.cjs`, `tests/adr-routes.test.cjs`, `dev_tools/debug/rank-refresh.test.cjs`. 모의 캔들 조회·브라우저 동작 및 실제 ADR history 응답 확인을 구분한다. 실제 키움 장기 지수 조회와 Oracle 운영 검증은 완료로 주장하지 않는다.

고정 ADR 제거 시 app.js의 탭 생성·렌더러·이벤트·타이머와 전용 CSS, server.js의 /api/adr HTML 프록시를 삭제한다. applyData/applyFullStateBackup에서 기존 설정을 복사한 후 tab_adr 및 adrInterval만 제거한다. Rank의 세 JSON API와 차트 모듈은 유지한다.

## 거래대금 및 세 차트 공통 표시 계획 (2026-10-13)

- FR-042~050/SC-013~016은 `public/rank-turnover-chart.js`, 기존 ADR/쏠림율 모듈 및 `public/style.css`로 구현한다. 새 의존성·독립 타이머·저장소는 추가하지 않는다.
- 거래대금은 인증된 `/api/adr/candles`를 day 모드로 KOSPI/KOSDAQ 각각 조회한다. OHLC와 `market_turnover`를 같은 응답에서 받아 캔들 펼침 때 재조회하지 않는다. 서버는 `concentration-chart.js`의 `dailyTurnover`를 일봉 쏠림율과 공유한다.
- `public/app.js`의 기존 Rank 갱신 경로에서 `refreshRankTurnoverChart`를 호출한다. 두 요청은 독립 결과로 처리하고 최신 요청 확인·취소로 이전 기간 응답의 덮어쓰기를 방지한다. 드래그 중 시작되는 갱신은 종료 후 처리한다.
- 세 패널은 3개 동일 폭 grid와 20px 간격을 사용한다. 기존 Rank 최소 폭/가로 스크롤을 유지하고 디버깅 펼침으로 패널 폭을 추가하지 않는다. ADR·거래대금의 캔들은 각 패널만 280px 늘린다.
- 공통 가로선은 #d6dbe1, dash [3,5]이며 Y축은 오른쪽이다. 쏠림율·ADR 선은 #339af0/2px, 거래대금은 KOSPI #339af0·KOSDAQ #e11d48이며 미선택 선 alpha .22다. 오늘 점은 #f97316. ADR 80/100/120 눈금 글자는 모두 #ff6b6b이며 MAX/MIN 표식은 제거한다.
- 최종값은 캔들 버튼 행, 오른쪽 여백 70px, 공통 16px/700 글꼴이다. 쏠림율·ADR는 파란색, 거래대금은 각 시장명과 오늘 값을 시장 고유색으로 항상 선명하게 표시한다. 거래대금은 두 행의 시장명 왼쪽/오늘 값 오른쪽 정렬, 오늘 봉 누락 시 —다. 메인 위 마우스 정보 줄을 유지하되 그래프 상단 여백은 10px로 줄인다.
- 이동 점·수직선과 값 기준 수평선·축 배지를 표시한다. 배지는 캔버스 폭으로 위치를 제한하고 ADR 마지막 주황색 점은 plot clip 해제 뒤 그려 온전한 원을 유지한다.
- 기존 문서의 ADR 줄바꿈·MAX/MIN·색상 기준선 및 모든 쏠림율 봉 표식 설명은 최신 spec에 따른다. ADR 데이터 보존/캔들 조회 정책은 유지하며 거래대금은 메모리 상태만 사용한다.
- 검증은 dev_tools/debug/rank-turnover.test.cjs, dev_tools/debug/rank-adr.test.cjs, tests/adr-routes.test.cjs, dev_tools/debug/rank-refresh.test.cjs에 한정한다. 실제 키움 두 시장 장기 일봉과 Oracle 배포 검증은 수동 확인 대상으로 남긴다.

### 거래대금 당일1분(누적) 확장 (2026-10-14)

- 일봉의 실제 `market_turnover`와 분봉의 `market_turnover_estimate`를 분리한다. ka20005의 `cur_prc/100 × trde_qty × 10,000`은 추정식이며 첨부 API 필드 표에는 실제 분봉 거래대금이 없다. `acc_trde_qty`는 누적거래량이고 예시의 `trde_prica`는 일봉 형태이므로 분봉 거래대금으로 사용하지 않는다.
- 당일 분봉만 조회해 오름차순으로 추정값을 누적한다. 일봉 캐시에서 오늘 이전의 마지막 실제 거래대금을 시장별 전일 기준으로 가져온다. 두 시장의 선·강조·오늘 마지막 주황 점·캔들/줌 동작은 일봉과 공유한다.
- 축은 전일 기준선을 포함한다. 선택 시장의 전일 수평선과 레이블은 코스닥 선과 구별되는 주황색이며 레이블은 선과 간격을 두고 위쪽 공간이 부족하면 아래에 놓는다. 장 초반 누적선이 낮게 보이는 한계는 상태 줄의 최신 전일 대비 비율과 마우스 정보의 시각별 비율로 보완한다.
- 최신값에는 추정 기호를 붙이지 않고 상태 줄에 추정임을 명시한다. 마우스 정보는 시장별 금액 뒤에 `(전일대비 xx.x%)`를 붙이며 전일 기준이 없거나 0이면 생략한다. `dev_tools/debug/rank-turnover-minute.test.cjs`에서 누적·기준선·레이블 간격·마지막 점·비율을 모의 검증한다. 실제 키움 데이터 비교는 별도 관찰이며 운영 배포 검증은 아니다.

### Oracle 운영 확인 추가 (2026-10-13)

사용자가 Oracle에서 쏠림율·ADR·거래대금 세 차트 정상 동작을 직접 확인했다. T089를 완료하고 quickstart에 확인 주체/날짜/내용을 기록했다. 위 운영 미검증 설명은 이 사용자 확인 이전 상태이며, 실제 원천 응답 검산·장기 데이터/실패/휴장일·장중 갱신·좁은 화면 상세 검증은 T088/T090으로 남긴다. 새 배포나 에이전트 운영 테스트를 수행한 기록은 아니다.

### 마우스 정보 줄 통일 (2026-10-13)

쏠림율/ADR도 거래대금과 같은 그래프 위 고정 정보 줄을 사용한다. 쏠림율·ADR 내부 빈 공간 배치 설명은 FR-038/050으로 대체한다. 기존 tooltip 노드를 그래프 앞의 chart-hover-info로 이동하고 내부 충돌 검사 배치 함수를 제거한다. 정보 줄은 24px이며 숨김 시에도 공간을 유지한다. 쏠림율 메인 그래프 높이는 기존 높이에서 24px 차감하고, ADR는 고정 패널 높이 안에서 flex 그래프가 줄 공간을 양보한다. 캔들 높이·공유 커서·수평선/값 배지는 유지한다.

마우스 정보 날짜는 모두 YYYY-MM-DD, 분봉은 뒤에 HH:mm을 추가한다. dev_tools/debug/rank-adr.test.cjs에서 외부 줄 위치·고정 위치·숨김 시 패널 높이 유지·쏠림율 전체 날짜·기존 차트 동작을 검증했다. 이 변경 이후 Oracle 운영 재확인은 아직 하지 않았으며 앞선 T089는 변경 이전 확인이다.
거래대금 메인 그래프의 정보 줄 아래 상단 여백(10px)을 기준으로 쏠림율·ADR 메인 그래프도 10px로 맞춘다. 패널·캔들 영역 높이는 변경하지 않는다.
세 메인 차트의 Y축 눈금은 캔버스 오른쪽에서 36px 지점에 textAlign=right로 그리고 최종값 행도 같은 36px 여백으로 맞춘다. 캔들 Y축 눈금에도 같은 기준을 적용한다.

### 운영 거래대금 갱신 실패 대응 (2026-10-13)

운영에서 차트는 그려져 있으나 KOSPI/KOSDAQ 모두 “조회 실패 · 다음 갱신 때 재시도”가 표시됐다고 사용자가 보고했다. 이는 이전 성공 데이터가 남고 새 요청이 실패한 상태를 뜻한다. 실제 실패 응답/HTTP 상태를 아직 확인하지 못했으므로 원인을 429로 확정하지 않는다. 두 시장 전체 기간 재조회가 동시에 발생하던 방식은 외부 연속조회 요청을 중복시키므로, 최초 시장별 순차 조회 후 각각 마지막 수신일 7일 전부터 최근 일봉만 조회하고 날짜별로 병합하도록 변경했다. 실패 시 이전 차트 보존을 유지하며 이전 데이터 유무에 따라 메시지를 구분한다. 서버는 인증 정보나 응답 본문 없이 시장·모드·HTTP 상태·오류 코드/메시지를 기록한다. 모의 테스트는 순차 호출·최근 구간·병합·실패 후 보존을 검증했고 실제 Oracle 실패 원인/해결 여부는 배포 후 서버 로그와 표시로 확인해야 한다.
