# Implementation Plan: Rank 독립창

확정 환경은 Windows x64 WinForms + Microsoft WebView2다. C# 코드는 시스템 .NET Framework 컴파일러로 빌드하며 NuGet SDK DLL과 x64 loader만 작은 앱에 포함한다. WebView2 runtime은 PC의 기존 설치를 사용하고 없으면 설치 프로그램이 공식 Microsoft bootstrapper를 내려받아 서명 확인 후 설치한다.

메인 브라우저가 유일한 데이터 조회 주체다. 기존 거래대금 표와 차트 DOM은 유지한다. 독립창 전용 HTML은 동일 차트 코드를 사용하지만 app.js·로그인·Rank 자동 조회 루프를 실행하지 않는다. chart state 공개 API로 points/selection/query 상태를 공유하고 visible/start/hover 등 viewport는 보내지 않는다.

같은 브라우저와 WebView2는 쿠키 저장소가 달라 BroadcastChannel을 사용하지 않는다. 서버의 최대 8개, 메인 heartbeat 120초 TTL 중계 채널을 사용한다. 인증된 owner는 채널 소유 email과 별도 owner key를 검사한다. peer는 crypto 무작위 토큰으로 해당 채널의 snapshot과 제한된 명령/응답만 사용한다. 공개 API 예외는 정확히 peer POST 한 경로뿐이며 데이터 API 인증은 유지한다. 토큰은 HTTP query가 아닌 launch URL fragment로 전달하고 메인 로그인 쿠키는 전달하지 않는다.

중계 snapshot 최대 2MB, 응답 누적 최대 4MB, 명령 최대 32개/8KB, 사용자당 최대 2개 채널로 RAM을 제한한다. 메인의 동일 market query는 in-flight 합치기 및 peer 요청에 한해 5초 최근 응답 사용을 적용한다. 독립창 처음 열 때 기존 snapshot을 바로 사용한다. pin된 다른 종목의 추가 조회는 허용한다.

네이티브 앱은 HKCU marketthrough protocol로 실행되고 프로세스 mutex와 named pipe로 한 인스턴스를 유지한다. 허용 서버/페이지를 검증하고 다른 탐색/새 창/권한을 막는다. 제목줄 drag, 가장자리 resize, TopMost, minimize, close와 bounds 저장/화면 보정을 WinForms/Win32로 처리한다. 메인 종료 시 연결 종료에 따라 닫으며, 앱 닫기 시 native HTTP 종료 통지와 브라우저 pagehide를 사용한다.

검증은 Express 실제 relay + 분리된 Playwright 브라우저 컨텍스트, C# native smoke 및 실제 WebView2 페이지 로드를 사용한다. 다른 일반 윈도우, 작업표시줄 복원, 다중 모니터 물리 배치, 깨끗한 PC 설치는 수동 인수 단계로 분리한다.
