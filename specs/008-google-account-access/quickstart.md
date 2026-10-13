# Quickstart: Google 계정 접근 제어 수동 검증

1. 서버를 시작하고 로그아웃 상태에서 앱을 연다. 로그인 UI만 보이고 대시보드 데이터 API가 인증 없이 응답하지 않는지 확인한다.
2. `azikanbal@gmail.com` Google 계정으로 로그인해 프로필 아이콘, 허용 이메일 관리 목록, 추가/삭제 및 로그아웃 버튼을 확인한다.
3. 테스트 이메일을 등록한 뒤 로그아웃하고 해당 Google 계정으로 로그인할 수 있는지 확인한다.
4. 일반 허용 계정으로 프로필을 열어 허용 이메일 관리 영역이 보이지 않는지 확인하고, 관리자 API를 직접 호출해도 권한 오류인지 확인한다.
5. 허용 이메일을 삭제한 뒤 해당 계정의 기존 세션에서 데이터 API가 거부되는지 확인한다.
6. 로그아웃 후 새로고침해 로그인 화면이 나타나는지 확인한다.
7. 개발자 도구에서 `/api/stock`, `/api/settings`, `/api/adr/today?market=kospi` 등 주요 데이터 API를 쿠키 없이 요청해 인증 오류를 확인한다.
8. localhost에서 Google 버튼을 시험하기 전 OAuth 웹 클라이언트의 Authorized JavaScript origins에 `http://localhost`와 `http://localhost:3000`이 등록되어 있는지 확인한다. OAuth 동의 화면이 Testing 상태라면 `azikanbal@gmail.com`을 Test users에도 등록한다.

운영 도메인이나 OAuth client ID가 바뀌면 Google Identity 설정의 승인된 origin 및 `GOOGLE_CLIENT_ID` 값도 함께 확인한다. HTTP localhost 응답은 Google Identity Services 로컬 테스트 요구사항에 맞는 `Referrer-Policy: no-referrer-when-downgrade` 헤더를 포함해야 한다.
