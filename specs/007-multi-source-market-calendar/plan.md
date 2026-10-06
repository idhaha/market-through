# Implementation Plan: 증시캘린더 다중 소스 탭

**Updated**: 2026-10-06 | **Spec**: spec.md

## Summary

세 공급자 전용 iframe을 유지한다. Toss는 /calendar 프록시, SEIBro와 Investing.com은 직접 HTTPS 접속을 사용한다. 공급자별 첫 진입과 한국시간 날짜 변경 또는 명시적 새로고침에만 src를 설정한다.

## Technical Context

기존 vanilla JavaScript/CSS와 Express를 사용하며 추가 의존성은 없다. activeCalendarId만 기존 설정에 저장한다. iframe과 조회 날짜는 DOM 메모리에서 유지한다.

## Constitution Check

실제 코드와 검증 결과를 문서화한다. 외부 페이지가 표시되지 않으면 원본 링크로 확인할 수 있다. 추가 서버 브라우저나 디스크 이미지 저장이 필요하지 않다.

## Project Structure / Design Decisions

- public/app.js: iframeEarnings는 Toss iframe 및 공급자 URL/현재 선택 메타데이터를 유지한다. iframeEarningsSeibro는 SEIBro 전용이다. centralBanksFramePanel 안의 centralBanksFrame은 Investing.com 전용이다.
- initializeTab 및 selectEarningsCalendar는 loadEarningsCalendarFrame을 호출한다. 최초 선택 전에는 src를 지정하지 않는다.
- loadEarningsCalendarFrame은 공급자별 dataset.loadedDate를 Asia/Seoul 날짜와 비교한다. investing은 기존 loadCentralBanksFrame에 위임한다.
- 새로고침 버튼만 forceRefresh=true를 전달한다. 전체 자동 갱신은 false로 호출하므로 당일 페이지를 유지한다.
- Investing.com 로딩 안내는 load 이벤트 또는 20초 후 해제한다. cross-origin 응답 상태를 확인할 수 없으므로 성공으로 단정하지 않는다.
- public/style.css의 hidden 규칙으로 비선택 iframe 및 로딩 안내를 숨긴다.

## Deployment / Limits

정적 파일 변경을 서비스에 반영하고 브라우저 페이지를 다시 열어야 한다. iframe의 자체 요청과 팝업은 통제하지 않는다. 예전 central-banks.js 및 /api/central-banks/image는 서버에 남아 있으나 현 소탭에서 호출하지 않는다. 기준금리 12개 차트는 별도 009 기능이며 운영 검증은 대기 상태이다.
