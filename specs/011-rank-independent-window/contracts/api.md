# Rank 독립창 중계 API

모든 응답은 no-store다. API 키·시장 로그인 세션은 중계하지 않는다.

- `POST /api/rank-independent`: 기존 로그인 필수. `{id, token, ownerKey}` 발급. 임의 id 16byte, 각 key 32byte. 서버는 키의 SHA256만 보관한다.
- `POST /api/rank-independent/:id/owner`: 로그인 email + X-Rank-Owner 검증. `{snapshot?, replies?, acks?}` 보내고 `{commands, connected, closed}` 받는다.
- `DELETE /api/rank-independent/:id/owner`: 같은 소유 검사 후 채널 제거.
- `POST /api/rank-independent/peer/:id`: cookie 예외는 이 POST 경로뿐. Authorization Bearer token 필수. `{version, command?, close?, acks?, pinned?}` 보내고 `{version, snapshot?, replies, serverRefresh}` 받는다.

snapshot: 거래대금 rows(클라이언트에서 table tag/속성 allowlist 적용), chart(selection/mode/interval/points/cursor/hasMore/busy/market/status/revision), display(candle 등), conditions(mrktTp/stexTp/refreshInterval).

명령: conditions, refresh, display(candleOpen), request(허용 concentration-chart/stock/stocks 경로만). 모든 명령 id는 UUID이며 조회 응답은 같은 id/body/status로 반환한다. main에서는 모르는 명령이나 경로를 시장 API에 넘기지 않는다. 명령과 응답은 수신 확인(acks) 전까지 유지하고 재전송 id를 합쳐 잠시 연결이 끊겨도 중복 실행하지 않는다.

메인·peer 중 마지막 통신 기준 120초 TTL, 최대 8채널/사용자당 2채널, snapshot 2MB, 각 reply 2MB/누적 4MB, command queue 32개/각 8KB. 서버 재시작 시 메모리 연결은 종료되고 웹페이지에서 다시 실행한다. 연결 만료 시 마지막 차트를 유지하고 재실행을 안내하며 네이티브 창을 닫지 않는다.

## 서버 갱신 계약

- `serverRefresh`: `{data, interval, error, serverNow}`. `interval`은 선택 주기(ms), `serverNow`는 서버 현재시각(ms), `data.at`은 마지막 성공 완료시각(ms)이며 `data`는 최초 성공 전 null일 수 있다. 데이터에는 `items`, 공유 `chart`, 선택적으로 `peerChart`가 포함된다.
- 서버는 메인 탭 휴면 중에도 활성 peer의 데이터를 갱신한다. conditions·refresh는 서버에 적용하고 owner 명령 큐에도 유지한다. owner가 복귀하면 기존 acks 방식으로 처리한다.
- 서버 처리 request의 응답도 기존 id/body/status로 반환한다. 비고정 종목 차트 상태는 서버 생성 `server-chart` 명령으로 메인에 반영한다.
- peer는 조회·연결 실패 또는 마지막 성공 데이터 경과시간이 interval + 90000ms를 초과하면 ‘갱신 지연’을 표시하고 마지막 데이터·완료시각을 보존한다. 정상 수신 후 ‘완료’로 복구한다.
