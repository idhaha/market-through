# Tasks: Rank 독립창

- [x] T001 확정 정책(Windows/WebView2, 공유 상태와 개별 viewport, Rank탭 종목동기화 해제)을 spec에 반영
- [x] T002 짧은 수명, 인증/소유 검증, RAM/queue 제한 중계 API 구현
- [x] T003 원본 유지, 독립창 버튼 하나로 실행/미연결 시 안내 및 설치 파일 자동 다운로드, 중복 실행/종료/재실행 상태 구현
- [x] T004 차트 snapshot/apply API 및 데이터 요청 합치기 구현
- [x] T005 최소 전용 페이지, 공유 조건·기본 종목 및 Rank탭 종목동기화 해제 구현
- [x] T006 개별 zoom/scroll 및 기존 차트 그리기 재사용
- [x] T007 C# native titlebar/TopMost/minimize/close/resize/drag 구현
- [x] T008 bounds 저장/복원 및 화면 밖 보정 구현
- [x] T009 허용 origin 검증, 단일 인스턴스 mutex/pipe 구현
- [x] T010 사용자별 protocol 설치 및 WebView2 runtime 확인/공식 다운로드/서명 검증 구현
- [x] T011 운영 origin 설치 파일 빌드 및 public/downloads에 준비
- [x] T012 relay/browser 기능과 native 검증 자동화
- [x] T016 설치된 앱 등록 및 앱/상태/protocol/등록 제거 구현, 기존 설치 덮어쓰기 지원
- [x] T017 독립창 각 패널의 접기/펼치기와 전체 폭 재배치 구현 및 메인 유지/추가 조회 없음 검증
- [ ] T013 운영 서버 배포 후 HTTPS/외부 앱 실행 및 실제 로그인 연결 확인
- [ ] T014 다른 일반 앱과의 항상 위, 작업표시줄 최소화/복원, drag/resize/다중 모니터 인수 확인
- [ ] T015 WebView2 없는 신규 Windows PC의 최초 설치/재설치 확인



## 서버 갱신 및 지연 표시 (2026-10-20 문서 반영)

- [x] T018 메인 탭 휴면과 독립적인 서버 갱신 및 조건 변경 전 응답 무효화 구현 — `rank-independent.js`, `server.js`
- [x] T019 독립창 주기 변경·조회 명령의 서버 적용 및 메인 전달 유지 — 휴면 중이면 복귀 후 처리
- [x] T020 조회·연결 실패 및 선택 주기 + 90초 초과 시 ‘갱신 지연’, 마지막 데이터 유지 및 정상 수신 후 복구 구현
- [x] T021 정상 메시지와 날짜 형식을 `완료 | YYYY/MM/DD HH:mm:ss`로 통일 — 독립창은 서버 완료시각(KST)
- [x] T022 서버 휴면 독립 갱신·명령 전달·실패 복구·시각 형식 회귀 테스트 작성 — `dev/tests/rank-server-refresh.test.cjs`
- [ ] T023 Oracle 환경에서 메인 탭 장시간 휴면 중 서버 갱신, 독립창 주기 변경·조회 및 메인 복귀 후 반영 인수 확인
- [ ] T024 실제 네트워크 단절·복구와 주기 + 90초 초과 시 지연 표시·마지막 데이터 유지·정상 복구 인수 확인
