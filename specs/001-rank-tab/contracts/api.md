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
