# Data Model: Rank 탭

## TransactionRankEntry (거래대금 순위 항목)
| 필드 | 설명 | 비고 |
|---|---|---|
| rank | 순위(정수) | |
| stk_cd | 종목코드 | 원본 `_AL` 접미사 제거 후 사용 |
| stk_nm | 종목명 | KODEX/TIGER 시작 종목 제외 |
| mkt_type | 시장 구분(K/Q) | ka10100 조회로 보강 |
| fluc_rt | 등락률(%) | 원본 flu_rt |
| trde_amt | 거래대금(백만원) | 원본 trde_prica |
| concentration_rate | 쏠림율(정수 % 또는 null) | round(종목 ÷ 해당 시장 거래대금 × 100); UI는 null을 -로 표시 |
| market_trde_prica | 해당 시장 전체 거래대금(백만원 또는 null) | ka20001 trde_prica |

## WatchRankEntry (실시간 조회 순위 항목)
| 필드 | 설명 |
|---|---|
| bigd_rank | 순위 |
| stk_cd | 종목코드 |
| stk_nm | 종목명 |
| mkt_type | 시장 구분(K/Q) |
| base_comp_chgr | 등락률 |
| trde_amt | 누적 거래대금(백만원, ka10007 보강) |
| market_trde_prica | 해당 시장 전체 거래대금(백만원 또는 null) |
| concentration_rate | 쏠림율(정수 % 또는 null), TransactionRankEntry와 같은 계산 |

## LendableStockEntry (대주가능 종목)
| 필드 | 설명 |
|---|---|
| pdno | 차트 선택에 사용하는 종목코드 |
| prdt_name | 종목명 |
| mkt_type | 시장 구분(Kiwoom ka10100으로 판별, 실패 시 "-") |
| prdy_ctrt | 등락률 |
| trad_psbl_qty2 | 매매가능수량 |
| 매매가능금액 | 현재가 × 매매가능수량 (계산값) |

## WatchlistGroup (관심종목 그룹)
| 필드 | 설명 |
|---|---|
| grp_id | 그룹 ID (기본값 `074`) |
| entries[] | 그룹 내 종목 목록(순위, 시장, 종목명, 등락률, 거래대금) |

## 관계 및 상태
- 4개 엔티티 모두 조회 시점의 스냅샷이며 영속 저장되지 않는다(설정 저장 대상 아님 — `006-settings-sync`와는 무관).
- `mkt_type` 판별은 4개 엔티티가 공통으로 서버 메모리의 종목코드별 시장 캐시를 공유한다.

## ConcentrationPoint / ChartResponse

- `time`: 일봉 YYYYMMDD, 분봉 YYYYMMDDHHMMSS. 과거→최신 순서이며 같은 시간은 중복 제거한다.
- `value`: 소수 쏠림율(%) 또는 null. 분봉 UI는 null 봉을 제외하고 일봉 UI는 선을 끊는다.
- `stock_turnover`, `market_turnover`: 일봉 실제 원 단위 거래대금, 분봉 종목 가격×거래량 및 시장 추정 거래대금.
- `stock_turnover_million`, `market_turnover_million`: 일봉 원본 백만원 거래대금, 분봉은 null.
- `stock_price`, `stock_volume`, `market_price`, `market_volume`: 원천 가격·거래량 숫자 또는 null. 일봉 계산은 이 필드에 의존하지 않는다.
- 응답은 `success`, `market`(K/Q), `mode`, `interval`, `points`, `cursor`, `has_more`, `history_pending`, `calculation`, `index_interval`을 포함한다.

## ChartSession / ChartViewState

서버 세션은 UUID 커서, 인증 사용자, 종목, 봉 종류, 간격, 각 원천의 봉 Map과 별도 연속조회 헤더, 마지막 성공 시각 및 조회 중 상태를 보관한다. 마지막 성공부터 30분 유효하며 영속 저장하지 않는다. 다른 사용자나 다른 조회 조건에 커서를 재사용할 수 없다. 실패한 추가조회는 성공 상태를 변경하지 않는다.

브라우저 상태는 선택 종목명·시장, 봉 설정, 전체 기록, 표시 범위, 최신 값, 커서, 로딩/드래그 상태 및 요청 버전을 보관한다. 자동 갱신은 최신 페이지를 교체하고 더 오래된 기록을 유지한다. 시장 미확인 상태를 코스닥으로 대체하지 않는다. 차트 설정은 새로운 영속 설정 저장 대상으로 추가하지 않는다.

## 5분봉 원본 비교 디버깅 (2026-10-08)

차트 오른쪽에 삼성전자(ka10080, 통합 거래소 005930_AL)와 코스피(ka20005, 업종 001)의 최근 완료된 5분봉 5개를 각각 최신순으로 표시한다. cntr_tm은 봉 시작 시각이며 시작+5분이 지난 봉만 포함한다. cur_prc·trde_qty는 부호·선행 0을 포함한 원본 값을 그대로 표시한다. 두 원천을 따로 표시해 시장 데이터 누락을 숨기지 않는다. 비교 대상은 차트 선택 종목·간격과 독립적이다.

최초 화면 표시 때 조회하고 5분 경계 2초 뒤마다 재조회한다. 진행 중 봉은 제외하고 조회 실패 시 기존 표를 유지한다. 중복 조회·숨김 문서·캡처 중 조회를 건너뛰며 문서 복귀 시 재조회한다. 디버깅용 타이머는 Rank 주기의 차트 갱신 타이머와 별도다. 데스크톱 패널 폭은 기존 절반 폭에 360px를 추가하며 휴대폰은 표를 차트 아래에 배치한다.

차트 API의 minute/interval=5 응답은 debug_five_bars={fetched_at, stock, market}를 추가한다. stock·market 배열 항목은 {cntr_tm, cur_prc, trde_qty} 원본 필드이며 다른 봉 종류·간격에서는 debug_five_bars=null이다. 디버깅 요청은 code=005930, mode=minute, interval=5를 고정한다. 운영 서버는 새 응답 필드 반영을 위해 재시작해야 한다.

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

### Rank 차트 펼침 상태 저장

사용자 설정 스냅샷에 rankChartDisplay={debugOpen:boolean,candleOpen:boolean}를 포함한다. 둘의 기본값은 false이며 필드가 없는 예전 설정도 닫힘으로 복원한다. 버튼 변경은 기존 saveAppData 경로로 로컬 설정과 autosaved_user_settings.json에 저장한다. 전체 설정 다운로드 및 manualsaved_user_settings/full_backup 수동 백업도 같은 스냅샷 필드를 포함한다. 기존 설정 파일·과거 백업을 직접 덮어써서 마이그레이션하지 않는다.

시작 시 서버/로컬 설정 적용과 수동 백업 복원 모두 동일한 상태 적용 함수를 사용한다. 복원 자체는 토글 클릭이나 별도 자동 저장을 발생시키지 않는다. 값은 엄격한 boolean true만 펼침으로 처리한다. 저장 실패 처리는 기존 설정 동기화 정책을 따른다.

### 봉 종류와 간격 저장

차트 기본 봉 종류는 day(일봉), 기본 분 간격은 1이다. 기존 rankChartDisplay 설정에 mode(day/minute)와 interval(1·3·5·10·15·30·45·60)을 추가한다. 일·분 및 분 간격 변경은 기존 사용자 설정 자동 저장과 수동 백업에 포함된다. 시작/설정 불러오기/전체 백업 복원 시 선택 버튼과 차트에 적용한다. 필드가 없거나 무효이면 일봉·1분으로 처리한다. 일봉에서도 마지막 분 간격을 보존하고 분봉 전환 시 적용한다.

## Rank ADR 상태 (2026-10-13)

- **ADRPoint**: t(정규화한 밀리초, 분봉은 분 시작), adr(원천 ADR). 일별 date를 한국시간 09:00의 t로 변환한다.
- **ADRClosing**: adr, t|null. lastClosed의 최근 마감값이며 분봉 기록이 없을 때만 점으로 표시한다. asOf가 장중 시각이 아니면 위치를 장중 timestamp라고 주장하지 않는다.
- **ADRView**: market(kospi/kosdaq), mode(minute 기본/day), range(1y 기본 및 6m/3y/5y), chartDay, 전체 points, viewStart, viewCount(null=전체), hover, drag, refreshPending. 시장/모드/기간 변경은 확대 창을 초기화한다.
- **LatestByMarket**: 시장별 마지막 정규화 수신 시각 t, 거래일, points, closing. 더 오래된 응답으로 날짜를 되돌리지 않고 빈 응답 후 기존 수신 기록을 유지한다. 서버가 아니라 현재 페이지 메모리에만 존재한다.
- **IndexCandle**: t, open, high, low, close 및 응답 partial. 확대 창과 시간축은 ADRView를 공유하되 가격 축은 표시되는 고저가로 산출한다.
- **Browser minute cache**: localStorage `rank-adr:{market}:{YYYY-MM-DD}`에 수신한 당일 분봉 배열을 저장할 수 있다. 서버 기록 저장은 없으며 새 브라우저의 전일 분봉 복원을 보장하지 않는다.
- 쏠림율의 전일 대비 상승률·OHLC 응답은 유지한다. 마우스 표시만 메인 차트 한 곳으로 제한하며 OHLC를 tooltip에 표시하지 않는다.

퇴역 설정 호환: tab_adr 탭 목록/콘텐츠 및 adrInterval은 복원에서 제외한다. 해당 활성 탭은 tab_rank로 대체한다. 입력 스냅샷의 나머지 필드는 변경하지 않는다.

## 거래대금 및 공통 표시 모델 (2026-10-13)

- **DailyTurnover**: `{million:number|NaN, value:number|null}`. 백만원 원본을 엄격히 정수로 파싱하고 유효한 0 이상 값만 원 단위로 변환한다. 일봉 쏠림율 분모와 시장 일봉 응답이 같은 함수를 사용한다. 내부 NaN은 JSON 거래대금으로 내보내지 않고 null을 사용한다.
- **IndexCandle 확장**: day 봉은 실제 `market_turnover:number|null`, minute 봉은 별도 `market_turnover_estimate:number|null`(원)를 가진다. minute의 값은 실제 거래대금으로 취급하지 않는다. OHLC와 거래대금 단위는 각각 지수 /100 및 원 단위로 분리된다.
- **TurnoverView**: mode(day 기본/minute), dailyData·minuteData={kospi:IndexCandle[],kosdaq:IndexCandle[]}, previous={kospi:number|null,kosdaq:number|null}, 표시 data와 날짜/시각 합집합 dates, market=kospi 기본, 일봉 range=1y 기본(6m/3y/5y), start, count(null=전체), hover(timestamp|null), controller, drag, refreshPending. 분봉의 표시 market_turnover는 당일 market_turnover_estimate를 시각순으로 누적한 파생값이다. 현재 페이지 메모리만 사용하며 서버/사용자 설정 백업에 저장하지 않는다.
- **TurnoverDrag**: surface, pointer id, startX/endX, 시작 start/count. 양 캔버스가 같은 날짜 구간과 선택 음영을 공유한다. 오른쪽 드래그는 최소 10봉 범위로 확대, 반대 방향은 전체 복원한다.
- **TurnoverLatest**: 한국시간 오늘과 일치하는 시장별 마지막 유효 market_turnover를 전체 수신 배열에서 찾는다. 일봉은 실제값, 분봉은 추정 누적값이다. 과거 확대 창과 무관하며 오늘 봉이 없으면 —다. 직전 거래일을 오늘 값으로 치환하지 않는다. 분봉 hover 비율은 해당 시각의 누적 추정값 / previous × 100이며 previous가 null/0이면 비율이 없다.
- **HoverGuide**: 쏠림율 value, ADR adr, 두 시장 market_turnover/1e12, 캔들 종가를 기준으로 수평선과 오른쪽 축 배지를 계산한다. canvas 폭으로 배지 X좌표를 제한한다. 커서 임의 Y좌표의 값은 사용하지 않는다.
- 제목/버튼/축/선/최종값 배치는 FR-032~036과 FR-046~050을 따른다. ADR MAX/MIN 표시는 없고 세 차트와 캔들 Y축은 오른쪽이다.
