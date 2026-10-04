# Data Model: 동적 탭

## DynamicTab
| 필드 | 설명 |
|---|---|
| id | `tabs[]`에 저장되는 생성 시각 기반 ID |
| name | `tabs[]`에 저장되는 탭 이름(표시용, ID와 별개) |
| type | 차트 그리드는 `tab_grid_*` ID에서 유추하며 기존 저장값은 셀 배열이다. 사용자 정의 탭은 `overseas_custom` 또는 `exchange_rate` 객체로 저장된다. |
| config | 차트 그리드는 `contents[id]` 자체가 GridCell 배열이다. 사용자 정의 탭은 객체의 `config` 문자열에 입력 문법을 저장한다. |

## GridCell (type=chart_grid일 때 config 내부)
| 필드 | 설명 |
|---|---|
| symbol | 심볼 또는 URL |
| mode | `main`(TradingView/AlphaSquare URL) \| `sub`(Investing.com iframe) |
| mainSrc | TradingView 임베드 URL |
| subSrc | Investing.com 임베드 URL |

## CustomChartEntry (type=overseas_custom/exchange_rate일 때 config 내부)
| 필드 | 설명 |
|---|---|
| url | 데이터 소스 URL 또는 `fred(...)`/`ecos(...)` 표현식 |
| label | 표시명 |
| period | 기간(선택, 삼중항 문법일 때만) |
| sectionTitle | 소속 구획 제목 |

### 금리/환율 탭 FRED 항목

`exchange_rate` 탭의 항목 `url`은 `fred(seriesId[, period])` 표현식을 포함할 수 있고 `label`은 차트 범례에 사용된다. 기간을 생략하면 최근 1년을 요청한다.

```text
("fred(DGS10)", "미국채 10년물")
("fred('DGS10','10년')", "미국채 10년물", "fred('DGS2','10년')", "미국채 2년물")
```

| 기간 입력 | API period | 조회 범위 |
|---|---|---|
| 생략, `1년`, `1y` | `1y` | 최근 약 1년 |
| `10년`, `10y` | `10y` | 최근 약 10년 |
| `5년`, `5y` | `5y` | 최근 약 5년 |
| `2년`, `2y` | `2y` | 최근 약 2년 |
| `6개월`, `6m` | `6m` | 최근 약 180일 |

같은 입력 행에서 `url, label` 쌍을 반복하면 쌍마다 하나의 시계열이 되고 모두 한 Canvas에 렌더링된다. 예를 들어 2/3/4개 시리즈는 각각 4/6/8개의 필드를 가진다. `DGS2`는 2년 만기 series지만 `fred(DGS2,10y)`의 `10y`는 조회 lookback이다. 설명 페이지 `https://fred.stlouisfed.org/series/DGS10`은 이 앱의 데이터 API 입력 표현식이 아니다.

## Section
| 필드 | 설명 |
|---|---|
| title | 구획 제목 |
| color | 구획 색상(`sectorColors` 매핑) |

## 저장 호환성

- `tab_grid_*` ID를 가진 과거 스냅샷은 `contents[id]`에 셀 객체 배열을 직접 저장한다. 앱은 이 구조를 계속 읽고 쓴다.
- 사용자 정의 탭은 `{ type, config, sectorColors }` 형태로 저장한다. `exchange_rate` 유형은 별도 생성 메뉴와 TXT 가져오기로 만들 수 있다.
- 탭 이름과 순서는 전체 스냅샷의 `tabs[]` 항목이 관리한다.

## FRED 디스크 캐시

FRED 캐시는 `data/fred-cache/cache.json`에 저장되며 Git 추적에서 제외한다. 키는 series ID와 요청 기간의 조합이다.

| 필드 | 설명 |
|---|---|
| seriesId | FRED series ID. 미사용 만료는 기간별 키가 아니라 시리즈 단위로 계산한다. |
| data | 날짜 오름차순 관측값 배열(`date`, `value`) |
| lastFullRefreshMonth | 해당 키에 전체 기간을 마지막으로 조회해 성공한 UTC 월(`YYYY-MM`) |
| lastUsedAt | 이 시리즈/기간 키를 마지막으로 요청한 시각(ISO 8601) |
| updatedAt | 마지막 성공 조회 시각(ISO 8601) |

서버 시작 시와 실행 중 하루 한 번, 마지막 사용 시각이 365일보다 오래된 시리즈를 캐시에서 제거한다. 한 시리즈의 어떤 기간이든 조회되면 해당 시리즈의 모든 기간 캐시를 사용 중인 것으로 보존한다. 이미 캐시 항목이 있는 키에 요청이 들어오면 갱신 성공 여부와 관계없이 사용 시각을 서버 메모리에서 즉시 갱신하고, 디스크에는 변경이 있을 때만 최대 5분 간격으로 저장한다(키가 처음 만들어질 때와 갱신 성공 시에는 즉시 저장). 서버가 저장 주기 전에 종료되면 그 사이의 사용 시각 갱신은 유실될 수 있다. 사용 시각이 없거나 해석할 수 없는 항목은 정리 대상이 된다. 매월 해당 키의 첫 요청 또는 캐시가 없는 신규 시리즈 요청은 전체 지정 기간을 조회하고, 월별 완료 표식은 조회가 성공한 뒤에만 저장한다. 같은 달의 다음 요청은 최신 관측일 30일 전부터 다시 조회해 최근 수정·지연 발표분을 날짜 기준으로 덮어쓴다. 입력에서 삭제한 시리즈의 캐시는 1년간 미사용 상태가 될 때까지 보존되어 다시 추가하면 재사용할 수 있다. 매월 전체 기간 조회는 겹침 범위보다 오래된 수정값도 반영한다.

## TE 메모리 캐시 (비영속)

`GET /api/trading-economics`의 성공 결과는 서버 메모리에만 저장된다. 서버를 재시작하면 사라지며 만료 시간은 없다.

| 필드 | 설명 |
|---|---|
| key | `url + "_" + duration` (예: `https://tradingeconomics.com/...` + `_10년`) |
| timestamp | 저장 시각(ms) |
| data | 수집한 시계열. 웹페이지 수집은 `[{ DateTime, Value }]`, 일반 HTTP 요청은 원본 배열 |

`force_refresh=true|1` 요청은 캐시를 무시하고 다시 수집한 뒤 같은 키를 덮어쓴다. 실패한 수집은 저장하지 않는다.
