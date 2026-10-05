# Implementation Plan: 증시캘린더 다중 소스 탭

**Branch**: `007-multi-source-market-calendar` | **Updated**: 2026-10-06 | **Spec**: spec.md

## Summary

Toss /calendar 프록시와 SEIBro iframe을 유지하고, Investing.com 소탭을 각국 금리 일정으로 변경한다. 중앙은행 페이지는 Playwright로 테이블 PNG를 캡처하여 표시한다. 성공 이미지는 한국시간 기준 당일 메모리에서 재사용하며 이미지 디코딩 전까지 중앙 로딩 안내를 제공한다.

## Technical Context

- **Language/Version**: vanilla JavaScript/CSS, Node.js >=20 (Playwright 1.63 의존성 요구).
- **Dependencies**: playwright ^1.63.0 추가, 기존 Puppeteer 및 Express 재사용.
- **Browser**: CENTRAL_BANKS_CHROMIUM_PATH가 지정되면 해당 경로, 아니면 puppeteer.executablePath()가 존재할 때 그 Chromium 사용. 경로가 없으면 Playwright 기본 Chromium을 사용하므로 해당 브라우저 설치가 필요하다.
- **Storage**: activeCalendarId만 기존 설정에 저장. PNG/Blob URL 및 조회 Promise는 메모리 전용이며 설정 스냅샷·디스크에 저장하지 않는다.
- **Testing**: 실제 외부 PNG 캡처, 캐시 로직 모의 검증, headless 브라우저의 지연 응답/이미지 표시 검증 및 구문 검사 수행. 운영 통합 검증은 quickstart 참고.
- **Constraints**: 외부 차단/DOM 변경 가능. 최대 10초는 테이블 탐색 구간이고 페이지 접속 제한은 별도로 60초이다.

## Constitution Check

- Spec-First: 구현 및 사용자 요청을 이 기능 산출물에 반영.
- External API Resilience: 실패 안내, 재시도, 공급자 격리, 중복 요청 공유.
- Secrets Isolation: 고정 공개 소스 URL과 기존 API 인증 사용.
- Solo-Maintainer Simplicity: 기존 설정과 설치된 Chromium 재사용. 추가 브라우저 설치를 피할 수 있도록 실행 경로 선택.
- Agent-Agnostic Workflow: 일반 Markdown 문서 및 API 계약.

## Project Structure

- central-banks.js: 테이블 식별, headless 접속/팝업 처리, PNG 캡처 및 날짜별 메모리 캐시.
- server.js: 인증 미들웨어 아래 GET /api/central-banks/image.
- public/app.js: 공급자 전환, 이미지 메모리 캐시, 로딩/오류 표시, 크기와 여백.
- public/style.css: 소탭 스타일 및 .embedded-iframe[hidden] 표시 억제.
- specs/007-multi-source-market-calendar/: spec, plan, tasks, quickstart, data-model, research, contracts/api.

## Design Decisions

1. 기존 investing 공급자 ID를 유지해 저장 설정을 호환한다. iframe URL은 about:blank로 설정하고 이미지 선택 시 숨긴다.
2. 페이지 접속 → 기본 1초 대기 → 팝업 처리 → 최대 10초 반복 탐색 → 네 헤더/은행 네 개 이상 확인 → 테이블만 캡처 → finally 브라우저 종료 순서다.
3. 외부 폰트 로딩 때문에 locator.screenshot이 대기한 실제 사례가 있었다. Playwright CDP 세션의 Page.captureScreenshot과 테이블 boundingBox 및 문서 스크롤 좌표를 사용해 정확한 영역을 캡처한다. captureBeyondViewport=true, scale=1이며 파일 경로를 지정하지 않는다.
4. 서버는 날짜, capturedAt, PNG Buffer와 진행 Promise를 보유한다. 서버 날짜는 Asia/Seoul 기준이며 성공 때 날짜를 기록한다.
5. 화면은 날짜, capturedAt, Blob URL 및 진행 Promise를 보유한다. 교체 시 이전 Object URL을 해제한다. 서버/API 이미지에 HTTP 디스크 캐시를 의존하지 않는다.
6. 로딩 시작 즉시 중앙 메시지와 aria-busy=true를 설정하고 image.decode() 이후 교체한다. 렌더 토큰으로 이전 호출이 최신 표시를 덮어쓰지 못하게 한다.
7. 이미지 스타일은 public/app.js의 image.style.cssText에서 width:100%, max-width:800px, height:auto, margin-top:30px로 조절한다.
8. 일반 진입·자동 갱신은 당일 캐시를 사용한다. 새로고침 버튼만 forceRefresh=true를 전달하고 API의 force_refresh=true로 서버 캐시도 우회한다. 진행 중 캡처는 일반/강제 요청 모두 공유한다. 자정 자동 실행은 제공하지 않는다.

## Deployment / Limits

npm ci 후 서버 재시작이 필요하다. Node.js >=20과 실행 가능한 Chromium을 확인한다. 캐시는 프로세스별이며 서버 재시작 때 초기화된다. 기존 TradingEconomics 브라우저 슬롯과 이 캡처 슬롯은 공유하지 않으므로 두 기능을 함께 쓰는 운영 환경의 메모리는 별도 확인이 필요하다.
