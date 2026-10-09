# API Contracts: Rank 탭

## GET /api/transaction_rank
**Query**: `mrkt_tp` (000|001|101), `stex_tp` (1|2|3, 기본 3)
**Response 200**:
//아래 값은 응답 구조를 설명하기 위한 예시이며, 실제 종목 및 값은 API 조회 결과에 따라 달라진다.
```json
{ "items": [ { "rank": 1, "stk_cd": "005930", "stk_nm": "삼성전자", "mkt_type": "K", "fluc_rt": "+1.23", "trde_amt": 12345, "concentration_rate": 5 } ] }
```
**실패 시**: 키움 키 누락 → HTTP 500. 시장 미확인 또는 시장 전체 거래대금 조회 실패·0·유효하지 않은 값이면 `concentration_rate`는 JSON `null`이며 UI에서 `-`로 표시한다.

## GET /api/stock
**Query**: `qry_tp` (1~5)
**Response 200**:
```json
{ "data": { "kiwoom": [ /* WatchRankEntry[] */ ], "efriend": [ /* LendableStockEntry[] */ ] } }
```
**실패 시**: 한투 키 누락 → `data.efriend`는 빈 배열(`[]`), 서버 오류 없음.

## GET /api/watchlist_groups
**Response 200**: `{ "success": true, "groups": [ { "grp_id": "074", "grp_nm": "..." } ], "server_time": "..." }`

## GET /api/watchlist_rank
**Query**: `grp_id`
**Response 200**: `{ "success": true, "grp_id": "074", "items": [ /* WatchlistGroup.entries[] */ ], "server_time": "..." }`, 하락률 큰 순 정렬.

## GET /api/watchlist_debug (비공개/디버그 전용)
프론트엔드에서 사용하지 않는 수동 디버그 엔드포인트. 이 계약 문서의 공식 API 범위에서 제외한다.

> 위 응답 스키마는 현재 `server.js` 구현과 이 Feature의 `data-model.md`를 근거로 정리한 계약이며, 필드명은 실제 코드의 원본 키를 그대로 따른다.

## 두 순위 테이블의 공통 쏠림율 계약

`/api/transaction_rank`의 items 및 `/api/stock`의 data.kiwoom 항목은 `market_trde_prica`(백만원, number|null), `concentration_rate`(정수 %, number|null)를 포함한다. 거래대금 순위 분자는 ka10032의 trde_prica, 조회 순위 분자는 ka10007의 trde_prica다. 분모는 ka20001의 trde_prica이며 K는 mrkt_tp=0/inds_cd=001, Q는 mrkt_tp=1/inds_cd=101이다. 각 시장을 요청당 한 번 조회하며 round(trde_amt / market_trde_prica × 100)를 적용한다. 유효한 ka10100 시장 캐시는 재사용할 수 있고 미확인 시장을 추정하지 않는다. 두 성공 응답에는 `success: true`와 `server_time`도 포함한다.

## POST /api/concentration-chart

기존 사용자 인증 필수. 요청:

```json
{ "code": "005930", "mode": "minute", "interval": 5, "cursor": "선택적 이전 성공 응답 커서" }
```

code는 6자리 영숫자 종목코드이며 _AL/_NX 접미사는 정규화한다. mode는 day 또는 minute, interval은 1·3·5·10·15·30·45·60이다. cursor 생략 시 새 조회를 시작한다.

성공 응답 필드:

- `success: true`, `market: "K" | "Q"`, `mode`, `interval`.
- `points`: data-model.md의 ConcentrationPoint 배열. 쏠림율은 소수값을 유지한다.
- `cursor`: 인증 사용자·종목·봉 종류·간격에 귀속된 메모리 세션 식별자.
- `has_more`: 과거 추가조회 가능 여부. `history_pending`: 시장 기록이 종목 조회 기간을 아직 덮지 못했는지 여부.
- `calculation`: 사용한 계산식 설명, `index_interval`: 분봉 시장 원천 간격 또는 일봉 null.

원천과 계산:

- 종목 분봉 ka10080/stk_min_pole_chart_qry/cntr_tm: abs(int(cur_prc)) × int(trde_qty).
- 종목 일봉 ka10081/stk_dt_pole_chart_qry/dt: trde_prica × 1,000,000원.
- 시장 분봉 ka20005/inds_min_pole_qry/cntr_tm: (abs(int(cur_prc)) / 100) × (int(trde_qty) × 10,000). 사용자 지정 추정식이며 공식 거래량 단위를 검증한 실제 거래대금으로 간주하지 않는다.
- 시장 일봉 ka20006/inds_dt_pole_qry/dt: trde_prica × 1,000,000원. 일봉 거래대금 누락 시 가격×거래량으로 대체하지 않는다.
- 각 봉 쏠림율 = 종목 거래대금 / 해당 시장 거래대금 × 100. 시장 001은 코스피, 101은 코스닥. 종목은 통합 거래소 코드 `<code>_AL`, 수정주가 구분 0, 일봉 기준일은 한국 날짜를 사용한다.
- 분봉은 09:00 기준 같은 날짜·시간 구간을 맞춘다. 시장 15·45분은 5분, 60분은 30분을 묶어 마지막 현재가와 합산 거래량으로 추정한다. 09:00 이전 또는 분모 누락·0·무효는 value=null이다.

종목·시장 cont-yn/next-key를 각각 보관한다. 시장 조회는 종목의 가장 오래된 봉까지 진행하되 요청당 추가 12페이지로 제한하며 남은 조회는 history_pending으로 알린다. 다음 추가조회는 미완료 시장 데이터를 먼저 채운다. 실패한 추가조회는 마지막 성공 커서로 재시도할 수 있다. 원천별 최대 50,000봉, 세션 유효기간은 마지막 성공부터 30분이다.

오류: 인증 없음 401, 입력 오류 400, 같은 세션 조회 중 409, 만료·다른 사용자·다른 조건 커서 410, 시장 미확인 422, 외부 조회 실패 502. 키 설정 누락 등 서버 설정 오류도 실패 응답으로 반환한다. 오류 안내는 기존 차트 레이아웃을 변경하지 않는다.

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

### 동일 시각 디버깅 비교 (2026-10-09)

종목의 독립적인 최신 5봉 대신 시장의 최근 완료된 5개 5분봉 cntr_tm을 기준으로 종목 원본을 정확히 매칭한다. stock·market 배열의 길이와 시각 순서는 동일하다. 해당 시각 종목 봉이 없으면 그 시각은 유지하고 cur_prc/trde_qty를 null(UI는 -)로 표시한다. 시장 마감 이후 NXT 종목 봉은 비교 표에 포함하지 않는다. 시장 봉이 없으면 양쪽 모두 빈 배열이다. 이 규칙은 일반 차트 응답의 디버깅 필드와 디버깅 전용 요청에 동일하게 적용한다.

## 쏠림율 아래 종목 캔들차트

종목 ka10080/ka10081 원본 open_pric·high_pric·low_pric·cur_prc의 절댓값을 stock_open·stock_high·stock_low·stock_price로 전달한다. 같은 봉 배열과 X좌표를 공유하는 캔들차트를 쏠림율 아래 기본 펼침 상태로 표시하며 버튼으로 접거나 펼친다. 시가보다 현재가가 높으면 붉은색, 낮으면 파란색, 같으면 회색이다. OHLC가 누락·무효이면 해당 위치는 유지하고 캔들을 그리지 않는다.

일봉·모든 분 간격·추가조회·확대·이동·자동갱신·계산 불가 분봉 제거가 두 차트에 동일하게 반영된다. 어느 차트에서 마우스를 이동해도 동일 봉의 날짜/시간·쏠림율·OHLC와 시가 대비 상승률((현재가/시가-1)×100)을 함께 표시하고 두 차트에 같은 세로 위치선을 표시한다. 시가가 없거나 0이면 상승률은 -다. 가격 축은 현재 표시 범위의 OHLC에 맞춰 조절하되 시간축은 쏠림율 차트와 정확히 공유한다. 서버 재시작 후 새 OHLC 필드를 받을 수 있다.

### 마우스 정보와 전일 대비 상승률

마우스 정보는 상단 차트 밖의 고정 높이 영역 한 곳에 표시해 두 그래프를 가리지 않는다. 날짜/시간 · 쏠림율 · 상승률 순으로 표시하고 OHLC 및 시가 대비 문구는 제거한다. 상승률은 (현재 봉 현재가 / 전일 종가 - 1) × 100이다.

원천 pred_pre 및 pred_pre_sig(1/2 상승, 4/5 하락, 3 보합)로 전일 종가를 복원하여 stock_previous_close·stock_change_rate를 반환한다. 전일 대비 기호가 없으면 명시적 부호가 있는 pred_pre 또는 0만 사용한다. 일봉은 전일 대비 필드가 없을 때 직전 거래일 봉 종가를 사용할 수 있다. 분봉은 직전 분봉 또는 당일 시가를 전일 종가로 대체하지 않는다. 기준을 확인할 수 없으면 상승률은 -다. 새 필드는 서버 재시작 후 적용된다.
