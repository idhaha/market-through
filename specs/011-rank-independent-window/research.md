# Execution Environment Findings: Rank 독립창

**Date**: 2026-10-11

사용자는 Windows 데스크톱/WebView2 방식을 확정했고 실제 서비스 주소는 https://azikanbal.duckdns.org 이다. 작은 앱을 사용자 PC에 설치하여 protocol로 실행한다. 서버 프로세스에서 사용자 Windows 창을 만드는 구조가 아니다.

환경 확인: .NET Framework csc.exe와 WebView2 Runtime이 설치되어 있다. .NET SDK/Rust toolchain은 없다. csc로 x64 WinForms를 빌드하며 공식 Microsoft.Web.WebView2 1.0.3537.50 SDK와 x64 loader만 포함한다. 설치 파일은 약 260KB로 Oracle에 대형 브라우저 runtime을 올리지 않는다.

- SDK: https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3537.50
- Runtime bootstrapper: https://go.microsoft.com/fwlink/p/?LinkId=2124703

데이터·시장·거래소·갱신 간격·봉 종류/간격은 공유한다. 선택은 기본 공유 및 독립창 쏠림율 차트 종목 동기화 해제 예외를 제공하고 zoom/scroll은 개별 유지한다. app.js를 독립창에 로드하지 않고 기존 차트 그리기와 snapshot/apply API를 재사용한다. 저장소가 다른 browser/WebView2 연결은 cookie/BroadcastChannel 대신 짧은 수명의 권한 제한 relay를 사용한다.

검증: Edge 컨텍스트 간 relay, C# protocol/origin 검증·TopMost 속성·bounds 보정, 실제 WebView2 초기화 및 shared snapshot 로드. WebView2 자식 프로세스가 sandbox 접근 제한으로 종료되어 native 통합 테스트는 일반 실행 권한으로 수행했다. 실제 다른 앱과의 window z-order·작업표시줄 복원·신규 PC runtime 설치는 수동 인수 항목이다.


