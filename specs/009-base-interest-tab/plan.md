# Implementation Plan: 기준금리 고정 탭

**Date**: 2026-10-06

## Design

- base-interest.js: 은행 순서/제목, 단일 브라우저 순차 SVG 캡처, Highcharts 변경 확인, 메모리 작업 상태 및 일별 캐시.
- server.js: GET /api/base-interest/charts와 202 진행 응답. 작업 중/완료 상태는 즉시 반환하여 nginx 요청 제한과 분리한다.
- public/app.js: 고정 탭 생성·복원 보호, 2열 카드, 진행 상태 폴링, 화면 일별 캐시, 명시적 새로고침 버튼.
- public/style.css: 카드 제목 좌측 상단과 2열 레이아웃 및 스크롤.
- central-banks.js: 기존 브라우저 경로/팝업 처리를 재사용한다.

## Browser Capture

사용자 base_interest.js처럼 channel=chrome 우선. Chrome 미설치일 때만 resolveBrowserPath로 대체한다. 기본 5초 후 은행 탭을 순차 클릭하고 선택 코드와 Highcharts 점 데이터를 확인한다. 유효 데이터 변경을 확인하지 못하면 실패로 처리한다. 현재 사이트 SVG는 highcharts-root 클래스가 없어 section#leftColumn svg 첫 요소를 사용한다. CDP Page.captureScreenshot으로 외부 폰트 대기 없이 PNG를 메모리로 받는다.

## Server Resource Policy

기존 TE activeBrowsers/MAX_BROWSERS 카운터를 새 캡처와 중앙은행 테이블에서도 공유한다. 최대 45초 슬롯 대기 후 한도 초과면 실패한다. 브라우저 종료 뒤 슬롯을 반환한다. 12개 차트는 하나의 브라우저에서 순차 처리하며 이미지마다 브라우저를 실행하지 않는다.

## State and UI

서버 작업은 loading → ready/partial/error이다. pending 중 일반/강제 요청 모두 공유한다. 당일 ready/partial은 캐시한다. 전체 오류는 명시적 새로고침 또는 다음 날 조회로 재시도한다. 강제 전체 실패 시 당일 이전 성공 결과를 refreshError와 함께 제공한다.

화면은 처음 또는 새로고침 시 요청하고 2초 간격으로 상태를 확인한다. 개별 상태 조회 제한 45초(전체 남은 시간 이내), 전체 화면 대기 제한 6분이다. 요청 타임아웃·네트워크 오류·비JSON 502/503/504 응답은 2초 후 연속 최대 3회 재시도한다. 정상 응답을 받으면 연속 실패 횟수를 초기화한다. force_refresh는 첫 요청에만 전달하여 응답 유실 시에도 중복 캡처를 시작하지 않는다. 완료 후 화면 메모리에 보관하여 재진입 요청을 생략한다. 이미지 decode가 끝나면 카드에 표시한다. 카드 내용은 설정 JSON에 저장하지 않는다.

## Technical Context

Node.js >=20, Express, 기존 Playwright/Puppeteer, vanilla JS/CSS. 추가 패키지 없음. 운영 서버에서 첫 조회/새로고침과 TE 병행 자원 사용은 수동 검증 대상이다.
