# Rank 독립창 중계 API

모든 응답은 no-store다. API 키·시장 로그인 세션은 중계하지 않는다.

- `POST /api/rank-independent`: 기존 로그인 필수. `{id, token, ownerKey}` 발급. 임의 id 16byte, 각 key 32byte. 서버는 키의 SHA256만 보관한다.
- `POST /api/rank-independent/:id/owner`: 로그인 email + X-Rank-Owner 검증. `{snapshot?, replies?, acks?}` 보내고 `{commands, connected, closed}` 받는다.
- `DELETE /api/rank-independent/:id/owner`: 같은 소유 검사 후 채널 제거.
- `POST /api/rank-independent/peer/:id`: cookie 예외는 이 POST 경로뿐. Authorization Bearer token 필수. `{version, command?, close?, acks?, pinned?}` 보내고 `{version, snapshot?, replies, serverRefresh}` 받는다.

snapshot: 거래대금 rows(클라이언트 table tag/속성 allowlist), chart(선택·봉·points·cursor 등), supply(선택·봉·표시 주체·수급 데이터), conditions(시장·거래소·갱신 간격)를 포함한다. 캔들 열림/닫힘은 창별 상태이며 수신 스냅샷으로 덮어쓰지 않는다.

명령: conditions, refresh, request, supply-display. request는 허용된 concentration-chart/stock/stocks 및 supply watchlist/chart/candles 경로만 처리하며 watchlist는 조회·수정을 지원한다. 각 명령은 UUID와 같은 id의 body/status 응답을 사용하고 acks 전까지 보관·재전송 중복을 제거한다. 임의 시장 API 경로는 허용하지 않는다. 캔들 공유 display 명령은 사용하지 않으며 메인에서도 처리하지 않는다.

메인·peer 중 마지막 통신 기준 120초 TTL, 최대 8채널/사용자당 2채널, snapshot 2MB, 각 reply 2MB/누적 4MB, command queue 32개/각 8KB. 서버 재시작 시 메모리 연결은 종료되고 웹페이지에서 다시 실행한다. 연결 만료 시 마지막 차트를 유지하고 재실행을 안내하며 네이티브 창을 닫지 않는다.

## 서버 갱신 계약

- `serverRefresh`: `{data, interval, error, serverNow}`. `interval`은 선택 주기(ms), `serverNow`는 서버 현재시각(ms), `data.at`은 마지막 성공 완료시각(ms)이며 `data`는 최초 성공 전 null일 수 있다. 데이터에는 `items`, 공유 `chart`와 `supply`, 호환용 선택 필드 `peerChart`·`peerSupply`가 포함된다.
- 서버는 메인 탭 휴면 중에도 활성 peer의 데이터를 갱신한다. conditions·refresh는 서버에 적용하고 owner 명령 큐에도 유지한다. owner가 복귀하면 기존 acks 방식으로 처리한다.
- 서버 처리 request의 응답도 기존 id/body/status로 반환한다. 공유 차트 상태는 서버 생성 명령과 스냅샷으로 메인에 반영한다.
- peer는 조회·연결 실패 또는 마지막 성공 데이터 경과시간이 interval + 90000ms를 초과하면 ‘갱신 지연’을 표시하고 마지막 데이터·완료시각을 보존한다. 정상 수신 후 ‘완료’로 복구한다.

## 2026-10-21 공유 상태 경계

- 종목 동기화 해제 UI는 없다. pinned는 호환용 wire 필드로 남아 있으나 현재 클라이언트는 false를 사용한다.
- supply-display는 selected·mode·visibleSeries 중 changed에 포함한 필드만 반영한다. showCandles는 공유 대상에서 제외한다.
- pendingSupplyCommandId 확인으로 처리 중인 선택 변경을 구분하며 이전 명령 확인이 최신 선택을 해제하지 않는다. 조회 중 건너뛴 최신 스냅샷은 조회 완료 후 다시 적용한다.
- 줌·스크롤·캔들 표시·카드 접기·테이블 표시 개수는 창별 상태다.
