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
