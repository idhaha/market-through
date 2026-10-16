# 개발 폴더 구성

2026-10-16에 개발용 최상위 이름을 `dev`로 정했다. `debug`는 디버깅 전용으로 오해하거나 도구의 자동 생성 폴더와 혼동하기 쉬우므로 사용하지 않는다.

```text
dev/
├── tests/      # 자동 검증 테스트
├── scripts/    # 조회·추출·점검·복구 및 수동 실험 도구
└── output/     # 실행해서 생성된 이미지·JSON·CSV·HTML 등

logs/           # 프로젝트 루트의 운영 로그 폴더
```

## 분류 기준

- 예상 결과와 비교해 성공·실패를 판정하는 코드는 `tests/`에 둔다. 기존 프로젝트 루트의 `tests/`도 이곳으로 통합했다.
- 데이터를 조회·추출하거나 환경을 점검·복구하는 도구는 `scripts/`에 둔다. 이름이 `test_*.py`, `test-*.js`여도 API를 호출하고 결과를 출력하는 수동 실험이면 여기에 둔다.
- 실행 결과물은 `output/`에 둔다. 필요한 스크립트가 폴더를 자동 생성하고, Git에서는 제외한다.
- 운영 로그는 `output/`에 기록하지 않는다. 프로젝트 루트 `logs/`에 한국 시간 기준 일자별로 기록하며 오늘·어제 파일만 보관한다.
- 기존 로그 파일은 자동 삭제하지 않고 사용자가 수동 정리한다.

기존 일회성 스크립트의 Git 제외 정책은 유지한다. 공유가 필요한 도구를 추가할 때는 `.gitignore`의 `dev/scripts/` 예외도 함께 추가한다. 과거 수정·패치 스크립트는 폴더 정리나 검증을 이유로 실행하지 않는다.

## 실행 방법

명령은 프로젝트 루트에서 실행한다.

```powershell
node dev/tests/retained-logs.test.cjs
node dev/tests/adr-routes.test.cjs
node dev/tests/rank-refresh.test.cjs
node --test dev/tests/concentration-chart.test.js
node dev/tests/chart-presentation.test.cjs
node dev/tests/rank-session-retention.test.cjs
```

브라우저 테스트는 설치된 Edge 등 해당 테스트가 지정한 브라우저가 필요하다. 외부 API를 호출하는 수동 도구는 자동 회귀 검증과 구분한다.
