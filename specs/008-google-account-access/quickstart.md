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

## HTTPS 및 인증서 갱신 점검

운영 서버에 SSH로 접속한 다음 실행한다. 개인키 파일 내용을 출력하거나 공유하지 않는다.

```bash
sudo certbot certificates
systemctl list-timers --all | grep -i certbot
sudo systemctl status certbot.timer --no-pager
sudo journalctl -u certbot.service --since '7 days ago' --no-pager
sudo certbot renew --dry-run
```

- 인증서 목록에서 운영 도메인과 현재 만료일을 확인한다.
- 타이머의 NEXT가 다음 실행 시각이고 `certbot.timer`가 `certbot.service`를 호출하는지 확인한다. snap 설치라면 `snap.certbot.renew.timer` 등 실제 출력의 유닛 이름으로 상태·로그를 조회한다.
- 서버 출력의 시간대가 UTC이면 한국 시간은 9시간을 더한다. 확인한 과거의 다음 실행 시각을 현재 일정처럼 사용하지 않는다.
- 서비스 정상 실행이나 `No renewals were attempted`는 인증서 갱신 성공의 증거가 아니다. 갱신 시점 이전이면 갱신을 수행하지 않을 수 있다.
- 모의 갱신 결과에서 모든 대상 인증서의 모의 갱신 성공(`all simulated renewals succeeded`)을 확인한다. 실패하면 해당 오류를 해결한 뒤 다시 검증한다.
- 모의 갱신은 운영 인증서를 교체하지 않으며 실제 갱신 후 Nginx 적용까지 증명하지 않는다. 서버의 갱신 설정에서 Nginx installer 또는 deploy hook을 확인하고 실제 갱신 이후 제공 중인 인증서를 다시 확인한다.
- 이번 대화에서는 HTTPS 정상 응답·HTTP 301 이동·무료 인증서·타이머 예약까지만 확인했다. 모의 갱신 및 갱신 후 Nginx 적용은 미확인이다.

설정 방식의 공식 설명: [Certbot Nginx 안내](https://certbot.eff.org/instructions?os=snap&ws=nginx).

## 로그인 유지 검증 (2026-10-24)

1. `node --test dev/tests/auth-session-store.test.cjs dev/tests/auth-session-status.test.cjs dev/tests/auth-session-failure.test.cjs` 실행: 로컬 4개 테스트 통과 기록. 저장·복원·토큰 비노출·시간당 갱신·고정 기한·실패 처리 및 날짜별 UI 동작을 검증한다.
2. 배포 후 최초 재로그인하고 `/api/auth/session`의 `user.reauthenticateAt`과 서버 여유 왼쪽 D-30일을 확인한다. 토큰·세션 파일 내용을 공유하지 않는다.
3. 같은 프로필 쿠키를 유지한 채 서버를 재시작해 인증이 복원되는지 확인한다. 다른 PC/프로필은 별도 기한이며 한쪽 로그아웃이 다른 쪽에 영향을 주지 않는지 확인한다.
4. 격리된 테스트 환경의 시계를 주입해 시간당 연장·7일 미접속 만료·30일 상한을 검증한다. 운영 파일이나 시스템 시간을 변경해 시험하지 않는다.
5. D-7 시 보이는 페이지에서 팝업 1회, 같은 날 새로고침 시 미표시, 다음 한국 날짜 재표시, 백그라운드 복귀 시 안내를 확인한다. 작은 화면에서 헤더 배치도 확인한다.
6. 허용 취소 후 모든 해당 세션의 API가 거부되는지 확인한다. 파일 손상/쓰기 실패는 격리 테스트로 확인한다.
7. 운영 JSON이 public·설정 백업·Git에 포함되지 않고 서버 계정만 접근 가능한지 확인한다. Windows는 ACL, Linux는 디렉터리·파일 권한을 확인한다.

실제 Google 인증과 운영 배포 후 검증은 미완료이며 tasks.md T024로 추적한다.
