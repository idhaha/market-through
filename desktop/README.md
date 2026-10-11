# Rank 독립창

Windows x64 전용 앱이다. 거래대금 상위 표와 쏠림율차트만 표시한다. 메인 페이지에서 로그인 후 Rank의 독립창 버튼으로 실행한다. 메인 페이지를 닫거나 새로고침하면 연결을 종료한다.
스마트폰과 Windows가 아닌 기기에는 독립창 버튼을 표시하지 않는다. Windows PC는 브라우저 창 너비와 관계없이 사용할 수 있다.

허용 주소: `https://azikanbal.duckdns.org`, `http://localhost:3000`. 하나의 설치 앱으로 운영과 로컬을 모두 사용한다. 현재 연결된 페이지의 주소에서만 콘텐츠를 불러온다.

## 설치/사용

서비스에 배포한 뒤 Rank의 **독립창** 버튼을 누른다. 20초 이내 앱 연결이 확인되지 않으면 미설치 또는 실행 취소 안내와 함께 `/downloads/MarketThroughSetup.exe`를 자동 다운로드한다. 받은 파일을 직접 실행한다. 별도 설치 링크는 표시하지 않는다. 로그인/서버 연결 오류일 때는 자동 다운로드하지 않는다. 설치 위치는 `%LOCALAPPDATA%\MarketThrough\Independent`, 창 상태와 WebView2 사용자 폴더는 `%LOCALAPPDATA%\MarketThrough\State`다. 관리자 권한이 필요 없는 사용자별 HKCU protocol 등록을 사용한다.

Windows x64와 .NET Framework 4.6.2 이상을 사용한다. WebView2 Runtime이 이미 있으면 재설치하지 않는다. 없으면 Microsoft 공식 bootstrapper를 PC에서 다운로드하고 Authenticode 서명을 확인하여 설치한다. 런타임 다운로드는 Oracle 서버에 올리지 않는다. 인터넷이나 PC 정책 때문에 실패하면 설치 화면에 오류를 표시한다.

앱 설치 후 웹페이지의 독립창 버튼을 다시 누르고 브라우저의 외부 앱 실행 안내를 승인한다. ‘쏠림율 차트 종목 동기화 해제’를 체크하면 독립창과 메인에서 각각 다른 종목을 자유롭게 선택한다. 체크 해제 시 메인 선택을 다시 따른다. 시장/거래소/갱신 간격/봉 종류·간격은 공유하고 줌·스크롤은 각각 유지한다.
거래대금 상위와 쏠림율차트는 왼쪽 위의 ▲/▼로 각각 접거나 펼칠 수 있다. 접은 콘텐츠의 제목은 유지되고 나머지 콘텐츠가 전체 폭을 사용한다. 이 동작은 메인 Rank의 표시와 조회 상태를 바꾸지 않는다.
창 높이를 조절하면 표의 목록 영역·행 높이·글자 크기와 차트 높이도 함께 조절된다. 표는 약 20행을 기준으로 크기를 조절하며 가독성을 위해 최소·최대 크기를 제한한다. 작은 창에서는 최소 높이와 스크롤을 유지한다. 종목 동기화 해제 체크박스는 쏠림율차트 제목 옆에 표시한다. 이 화면 변경은 독립창을 닫았다가 다시 열면 적용되며 앱 재설치는 필요 없다.

## 빌드

저장소 루트에서 Windows PowerShell:

```powershell
node desktop/generate-page.cjs
./desktop/build.ps1 -Publish
```

SDK package는 고정 버전 `Microsoft.Web.WebView2 1.0.3537.50`을 공식 NuGet에서 받아 캐시한다. `build`와 `packages`, `dist`는 Git에서 제외한다. 게시 대상은 `public/downloads/MarketThroughSetup.exe` 하나이며 runtime 포함 없이 약 260KB다. 새 앱 코드를 변경할 때 반드시 재빌드한다. .NET SDK/Rust/Node를 최종 사용자 PC에 추가 설치하지 않는다.

다른 로컬 포트가 필요하면 `-ServerOrigin` 배열에 운영 주소와 해당 로컬 주소를 명시하여 빌드한다. 허용 목록은 포트까지 정확히 검사한다.

배포는 일반 웹서비스 배포에 `rank-independent.js`, `public/rank-independent-*`, HTML/CSS/차트 코드, 설치 파일을 포함하여 Express를 재시작한다. 설치 파일의 허용 origin 목록을 변경했다면 기존 PC 앱도 재설치한다. 파일은 현재 코드 서명되지 않았으므로 Windows 다운로드/실행 확인이 발생할 수 있다.

## 확인

```powershell
./desktop/test.ps1
```

`tests/RankNativeSmoke.cs`를 desktop/build의 WebView2 DLL을 참조해 x64 exe로 컴파일하면 테스트가 실제 WebView2 런타임 초기화와 relay 페이지 로드도 확인한다. 사용자 상태를 변경하지 않고 workspace 내 native-test-state를 사용한다.

남은 인수 확인: 운영 HTTPS에서 실제 Google 로그인 연결, protocol 실행/다중 실행, 다른 일반 앱과의 항상 위, 실제 drag/resize/최소화·복원, 다중 모니터 복원, runtime 없는 새 PC 자동 설치. 자동 테스트가 이 인수 확인을 대체하지 않는다.

## 제거

독립창을 닫은 후 **Windows 설정 → 앱 → 설치된 앱 → MarketThrough 독립창 → 제거**를 실행한다. 앱 파일(Independent), 창 위치·WebView2 사용자 데이터(State), HKCU protocol 및 설치된 앱 등록을 함께 지운다. 빈 MarketThrough 폴더도 제거한다. 다른 앱도 사용하는 Microsoft WebView2 Runtime은 유지한다.

이전 설치에 제거 기능이 없었다면 새 설치 파일을 한 번 실행해 덮어 설치하면 등록된다. 수동 폴더 삭제나 regedit 작업은 필요 없다. 제거 프로그램은 자신도 지우기 위해 TEMP의 복사본으로 실행하며 해당 작은 임시 실행 파일은 Windows 임시 파일 정리 대상이다. 설치 폴더에 다른 용도의 파일이 있으면 보존한다.

