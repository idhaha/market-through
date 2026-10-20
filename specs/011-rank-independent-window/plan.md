# Implementation Plan: Rank 독립창

확정 환경은 Windows x64 WinForms + Microsoft WebView2다. C# 코드는 시스템 .NET Framework 컴파일러로 빌드하며 NuGet SDK DLL과 x64 loader만 작은 앱에 포함한다. WebView2 runtime은 PC의 기존 설치를 사용하고 없으면 설치 프로그램이 공식 Microsoft bootstrapper를 내려받아 서명 확인 후 설치한다.

활성 독립창의 데이터 갱신은 서버가 관리하며 메인 탭의 타이머·휴면 상태에 의존하지 않는다. 메인 브라우저의 기존 조회와 설정 동기화는 유지한다. 기존 거래대금 표와 차트 DOM은 유지한다. 독립창 전용 HTML은 동일 차트 코드를 사용하지만 app.js·로그인·Rank 자동 조회 루프를 실행하지 않는다. chart state 공개 API로 points/selection/query 상태를 공유하고 visible/start/hover 등 viewport는 보내지 않는다.

같은 브라우저와 WebView2는 쿠키 저장소가 달라 BroadcastChannel을 사용하지 않는다. 서버의 최대 8개, 메인·독립창 중 마지막 통신 기준 120초 TTL 중계 채널을 사용한다. 인증된 owner는 채널 소유 email과 별도 owner key를 검사한다. peer는 crypto 무작위 토큰으로 해당 채널의 snapshot과 제한된 명령/응답만 사용한다. 공개 API 예외는 정확히 peer POST 한 경로뿐이며 데이터 API 인증은 유지한다. 토큰은 HTTP query가 아닌 launch URL fragment로 전달하고 메인 로그인 쿠키는 전달하지 않는다.

중계 snapshot 최대 2MB, 응답 누적 최대 4MB, 명령 최대 32개/8KB, 사용자당 최대 2개 채널로 RAM을 제한한다. 메인의 동일 market query는 in-flight 합치기 및 peer 요청에 한해 5초 최근 응답 사용을 적용한다. 독립창 처음 열 때 기존 snapshot을 바로 사용한다. pin된 다른 종목의 추가 조회는 허용한다.

네이티브 앱은 HKCU marketthrough protocol로 실행되고 프로세스 mutex와 named pipe로 한 인스턴스를 유지한다. 허용 서버/페이지를 검증하고 다른 탐색/새 창/권한을 막는다. 제목줄 drag, 가장자리 resize, TopMost, minimize, close와 bounds 저장/화면 보정을 WinForms/Win32로 처리한다. 연결 만료 시에도 마지막 데이터를 표시한 채 창을 유지하며, 앱 닫기 시 native HTTP 종료 통지와 브라우저 pagehide를 사용한다.

검증은 Express 실제 relay + 분리된 Playwright 브라우저 컨텍스트, C# native smoke 및 실제 WebView2 페이지 로드를 사용한다. 다른 일반 윈도우, 작업표시줄 복원, 다중 모니터 물리 배치, 깨끗한 PC 설치는 수동 인수 단계로 분리한다.

## 서버 갱신 및 지연 표시 (2026-10-20 반영)

- `rank-independent.js`의 서버 스케줄러가 활성 peer와 snapshot이 있는 채널을 조회하고 30초·1분·10분·1시간 중 선택 주기로 갱신한다. 조회 진행 중 중복 실행을 막고 조건 변경 전 응답이 새 상태를 덮어쓰지 않도록 세대를 검사한다.
- `server.js`에서 거래대금 조회와 쏠림율차트 서비스를 호출한다. 종목 동기화를 해제한 독립창 차트도 서버 갱신에 포함한다.
- peer의 conditions·refresh 명령은 서버에 적용하면서 owner 명령 큐에도 보관한다. 메인은 휴면에서 복귀해 큐를 처리한다. 주기 변경 확인 전 이전 메인 snapshot이 새 주기를 덮어쓰지 않는다.
- `public/rank-independent-client.js`는 서버 완료시각·서버 현재시각과 수신 이후 경과시간으로 지연을 계산한다. 실패 또는 선택 주기 + 90초 초과 시 마지막 데이터를 유지하며 ‘갱신 지연’을 표시한다.
- 정상 표시는 `완료 | YYYY/MM/DD HH:mm:ss`이며 서버 완료시각을 한국 시간으로 표시한다. 메인과 시각 값이 반드시 같아야 하는 것은 아니다.
- 검증: `dev/tests/rank-server-refresh.test.cjs`, `dev/tests/rank-refresh.test.cjs`, `dev/tests/rank-independent-retention.test.cjs`. 운영 장시간 휴면·복귀 인수 검증은 별도로 남긴다.
