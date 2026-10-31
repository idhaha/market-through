# 시장경보 통신

기존 로그인 세션 인증과 no-store를 적용한다.

- GET `/api/market-alerts`: 접속 사용자 기준 상태. day, epoch, version, startedAt, lastReceivedAt, disconnectedAt, connection, storageError, historyWarning, events 배열. 이벤트는 data-model의 필드에 visible·acknowledged를 추가한다. 같은 epoch의 이전 version 응답은 브라우저에서 무시해 지연 폴링이 확인 상태를 되돌리지 않게 한다.
- POST `/api/market-alerts/acknowledge`: `{ids: string[]}`(최대64). 해당 사용자만 확인 처리하고 최신 상태를 반환한다. 알 수 없는 id는 무시하고 잘못된 입력은 400이다. 확인은 발동·해제 상태나 다른 사용자에 영향을 주지 않는다.
- GET `/api/market-alerts/diagnostics`: 인증된 진단. 제한된 수신 표본은 receivedAt, market, status만 포함한다. 토큰이나 임의 원본 문자열은 전달하지 않는다.
- 독립창: 기존 capability로 인증하는 peer POST에 marketAlertAck 배열을 추가한다. 서버가 채널 소유자로 확인 처리하며 매 peer 응답의 marketAlerts에 최신 상태를 반환한다. 이메일·임의 사용자 ID는 브라우저 요청에서 받지 않는다.
- 확인 전송 실패 시 독립창은 id를 재전송한다. 중복 확인은 멱등이며, 새로운 단계 id에는 이전 확인이 적용되지 않는다.

화면 안내 열기는 확인과 분리한다. 배너·카드 테두리는 보이는 미확인 이벤트만 일괄 확인하며 새 단계까지 미리 확인하지 않는다.
