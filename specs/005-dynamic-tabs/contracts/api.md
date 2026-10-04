# API Contracts: 동적 탭

> 모든 `/api/*` 요청은 로그인 세션이 필요하다(008-google-account-access). 세션이 없으면 HTTP 401과 `{ "success": false, "error": "로그인이 필요합니다." }`로 응답한다. 로그인·세션 확인·로그아웃 경로만 예외이다.

## GET /api/finviz-image?url=...
**Response 200**: 이미지 바이너리(프록시 패스스루). `Content-Type`은 원본 값(없으면 `image/png`), `Cache-Control: public, max-age=300`. 원본 요청 제한 시간은 10초이다.
**Response 400**: `{ "error": "URL 파라미터가 필요합니다." }`
**Response 500**: `{ "error": "이미지를 가져오는데 실패했습니다.", "details": "..." }`
> Finviz 오류 응답에는 `success` 필드가 없다.

## GET /api/trading-economics?url=...
**쿼리**: `url`(필수), `duration`(선택, 예: `10년`), `force_refresh`(`true` 또는 `1`이면 서버 메모리 캐시를 무시하고 다시 수집)

**Response 200**: `{ "success": true, "data": [...] }` (캐시 적중 시에도 같은 envelope)
- TE 웹페이지 URL(Puppeteer 수집): `data`는 `[{ "DateTime": "ISO 8601", "Value": number }]`
- 그 밖의 URL(일반 HTTP 요청, 제한 시간 15초): 원본 응답 배열을 그대로 전달

**Response 400**: `{ "error": "URL 파라미터가 필요합니다." }` (`success` 필드 없음)
**Response 500**: `{ "success": false, "error": "데이터 획득 실패", "details": "..." }`

**서버 동작**
- 성공한 결과만 `url + "_" + duration` 키로 서버 메모리에 캐시한다(만료 없음, 서버 재시작 시 사라짐). 실패는 캐시하지 않는다.
- TE 웹페이지 수집은 Chrome을 동시에 1개만 실행한다. 실행 중이면 최대 45초 대기하고, 그래도 비지 않으면 추가 실행 없이 HTTP 500(`details`: "브라우저 사용량이 많아 잠시 후 다시 시도해 주세요.")으로 응답한다. 웹서버 프록시의 60초 제한보다 짧게 두어 504가 되지 않도록 한다.
- Chrome이 10초 안에 닫히지 않으면 프로세스를 강제 종료한 뒤 실행 슬롯을 반납한다.
- 성공 응답(캐시 미적중)에는 `Cache-Control: public, max-age=300`이 붙는다.

**클라이언트 호출 규칙**: 화면은 TE 요청을 전역 대기열로 한 번에 1개씩 보내며, 실행 중인 요청마다 120초 타임아웃을 적용한다. 다중 시리즈 차트에서는 504·타임아웃·네트워크 오류 시 2초 뒤 1회 재시도하며, 재시도 요청도 대기열을 거친다.

## FRED/ECOS 프록시 (경로는 server.js 기준)
**FRED `GET /api/fred?series_id=...&period=...`**: `{ "success": true, "data": [{ "date": "...", "value": 0 }], "cacheStatus": "monthly-full|incremental|stale" }`

입력 표현식 `fred(DGS10,10y)`는 `series_id=DGS10&period=10y`로 변환된다. 기간을 생략하면 클라이언트가 `1y`를 전달하며, `10년/10y`, `5년/5y`, `2년/2y`, `1년/1y`, `6개월/6m` 별칭을 정규화한다. `force_refresh` 쿼리는 디스크 캐시 갱신 주기를 우회하지 않는다.

응답은 `{ "success": true, "data": [{ "date": "YYYY-MM-DD", "value": number }], "cacheStatus": "monthly-full|incremental|stale" }`이다. Express는 series ID와 기간 조합별 디스크 JSON 캐시를 사용하고 `python`(실패하면 `python3`)으로 `fred_api.py <seriesId> <period> <startDate>`를 argument 배열로 실행한다. 프로세스당 제한 시간은 120초이고 동시 실행은 최대 2개이며 초과분은 순서를 기다린다. 같은 시리즈/기간 조합의 중복 요청은 진행 중인 조회 결과를 공유한다. Python 스크립트는 `.env`의 `FRED_APPKEY`로 FRED 관측값을 가져온다. 월별 전체 또는 신규 키는 요청 기간 전체를 조회하며, 같은 달 후속 요청은 최신 저장 날짜보다 30일 앞서 시작한다. 새 응답은 날짜 기준 병합되고 겹치는 날짜의 값은 새 값으로 교체된다. 실패한 갱신은 월별 완료 표식을 바꾸지 않는다. 캐시가 있으면 갱신 오류 때 기존 자료를 `cacheStatus: "stale"`로 반환한다.

캐시는 `data/fred-cache/cache.json`에 보관한다. 각 시리즈/기간 키의 마지막 사용 시각은 서버 메모리에 즉시 기록하고 디스크에는 변경이 있을 때만 최대 5분 간격으로 저장한다(갱신 성공 시에는 캐시를 즉시 저장한다). 서버 시작과 실행 중 하루 한 번 확인해 365일간 사용되지 않은 시리즈의 모든 기간 캐시를 제거한다. 입력에서 제거된 시리즈라도 마지막 조회로부터 1년이 지나기 전까지는 유지한다.

**FRED 오류 응답**
- HTTP 400: `{ "success": false, "error": "A valid series_id is required" }` (`series_id`가 영문·숫자·`_`·`.`·`-` 이외 문자를 포함하거나 비어 있을 때)
- HTTP 500: `{ "success": false, "error": "..." }` (갱신에 실패했고 사용할 기존 캐시가 없을 때)
- 갱신에 실패했더라도 기존 캐시가 있으면 HTTP 200과 `cacheStatus: "stale"`, `refreshError`로 기존 자료를 반환한다.

한 입력 행의 각 FRED 항목은 별도 `/api/fred` 요청을 수행한다. `loadMultiSeriesChart()`가 결과를 하나의 Canvas에 여러 선으로 구성하며 한 요청 실패는 다른 시리즈 요청을 막지 않는다. `https://fred.stlouisfed.org/series/DGS10`은 설명 페이지이므로 현재 입력 파서가 이 URL에서 ID를 추출하지 않는다.

**ECOS `GET /api/ecos?table=...&item=...&start=YYYYMMDD&end=YYYYMMDD`**: `{ "success": true, "data": [/* ECOS row objects, including TIME and DATA_VALUE */] }`

클라이언트는 각 응답의 `data`를 차트 입력용 `{date, value}` 시계열로 변환한다. 이 프록시 응답은 공통 `{series: [...]}` envelope가 아니다. `table`을 생략하면 `817Y002`(일일 금리)를 사용하며 조회 주기는 일(`D`)로 고정이다. 원본 요청 제한 시간은 30초이다.

**ECOS 오류 응답**
- HTTP 400: `{ "success": false, "error": "item, start, end 파라미터가 필요합니다." }`
- HTTP 500: `{ "success": false, "error": "ECOS_APIKEY가 설정되지 않았습니다." }` 또는 원본 요청 실패 메시지
- HTTP 200이지만 데이터가 없거나 ECOS가 오류를 돌려준 경우: `{ "success": false, "error": "...", "code": "...", "raw": { ... } }`

**오류 응답**: 대체로 JSON `{ "success": false, "error": "..." }` 또는 HTTP 오류이며, Finviz와 TE의 400 응답은 `success` 필드가 없다. 외부 데이터 소스 하나의 오류는 해당 항목에서 격리한다.

> 실패 시 개별 항목만 콘솔 오류로 기록되며, 나머지 항목 로딩은 계속된다(FR-007).
