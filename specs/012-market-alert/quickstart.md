# 검증 및 운영

2026-10-30 검증 결과: 서버 테스트7개, 브라우저 시나리오(메인·독립창 표시, 양방향 확인, 2·3단계 재점멸, 지연 응답 무시, 카드 테두리, 안내창·모바일·reduced-motion), 기존 독립창 유지·재시작 복구 테스트, 구문 및 diff 검사를 통과했다. 실제 LS 연결20초에서 JIF 구독 승인을 확인했으며 그 시간에는 이벤트를 수신하지 못했다. 서버 재시작·운영 배포와 실제 경보 발동/해제 인수 확인은 아직 수행하지 않았다.

## 로컬 검증

프로젝트 루트에서:

```powershell
node --test dev/tests/market-alerts.test.cjs
node dev/tests/market-alerts-browser.test.cjs
node dev/tests/rank-independent-retention.test.cjs
node dev/tests/rank-independent-recovery.test.cjs
```

브라우저 테스트는 설치된 Edge와 Playwright를 사용하며 실제 증권사에 접속하지 않는다.

## 운영 적용

서버를 정상 재시작해야 새 수신 코드가 시작된다. LS_APPKEY/LS_SECRETKEY는 서버 환경변수를 재사용한다. 로그인한 메인 화면에 연결 상태·수신 이전 이력 미확인 안내가 나타나는지 확인한다. 독립창도 서버 peer 상태로 동기화한다.

## 장중 수신 진단

```powershell
node scripts/check-market-alerts.cjs --seconds=20
```

이 명령은 별도의 일시 구독을 열어 종료 시 연결을 정리하며 주문을 전송하거나 당일 서버 상태 파일을 수정하지 않는다. 기존 연결과 LS의 연결 한도를 공유하므로 운영 서버에서 이미 수신 중이면 로그인 후 `/api/market-alerts/diagnostics`를 우선 확인한다. 구독 ACK만 받으면 이벤트 수신·실제 경보 발동까지 검증된 것은 아니다.

실제 CB/사이드카 발생 시 시장·단계·발동/해제를 HTS와 대조한다. 발생 후 배너 확인, 다음 단계 재점멸, 양쪽 창 확인 동기화, 해제 후 색 유지와 시각 표시, 공식 장마감 시 초기화를 확인한다. 서버가 꺼진 시간의 경보는 이력 미확인 안내가 유지되며 자동으로 없었다고 판단하지 않는다.
