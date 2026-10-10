# Implementation Plan: 자본동향 고정 탭

**Date**: 2026-10-10
**Scope**: 이미 구현된 코드와 대화에서 확정된 정책의 문서화.

## Technical Context

기존 Node.js/Express 및 vanilla JavaScript/CSS를 사용한다. 추가 의존성, 별도 서버 브라우저, 데이터 수집 및 상주 프로세스를 도입하지 않는다.

## Constitution Check

실제 public/us-links.js, public/app.js, public/style.css, public/index.html, server.js 및 테스트를 근거로 작성했다. 사용자 설정 실데이터 및 인증 비밀은 문서에 포함하지 않는다. 운영 검증을 완료로 표시하지 않는다.

## Design

- public/app.js: tab_us 고정 탭 생성, 이름 정규화, 증시캘린더 → 자본동향 → 기준금리 순서, 동적 초기화·설정 복원 보호. createChartGrid와 initializeTab에서 USLinks 모듈을 연결한다.
- public/us-links.js: DOM 기반 목록 렌더링, 두 추가 버튼, 셀 전체 클릭, 편집 초안, 중복/주소 검증, 저장·복사·삭제·드래그 이동. textContent 및 input.value를 사용한다.
- public/style.css: 항목·설명 제목만 표시, 항목 열 28%에 제목과 작은 URL 배치, 설명 열은 나머지 폭, 제목·테두리 없는 작업 영역 280px는 편집 중에만 확보하여 일반 상태 설명 폭 확장, 최소 표 너비 680px, 기본 행 높이 56px, 입력/작업/추가 버튼 36px, ESC와 삭제 버튼의 추가 왼쪽 여백 각각 12px.
- public/index.html: us-links.js를 app.js보다 먼저 defer 로드하고 수정 시 캐시 버전을 갱신한다.

## Interaction and Persistence

단일 클릭은 650ms 후 URL을 열고 두 번째 클릭(detail >= 2) 또는 dblclick에서 예약을 취소하고 편집한다. ⠿ 핸들은 클릭/편집 대상에서 제외한다. 키보드 F2는 편집, 링크 Enter는 열기, 입력 Enter는 저장, Escape는 초안 취소이다.

초안은 모듈 메모리에만 둔다. 저장은 기존 항목을 수정하고 새로저장은 crypto.randomUUID()로 새 항목을 추가한다. 중복 판단은 공백 제거 후 제목·URL 문자열의 완전 일치이며 URL 정규화 비교는 하지 않는다. 로드 시 잘못된 항목을 제외하고 누락/중복 ID를 재부여한다.

저장·삭제·이동은 saveAppData를 호출하여 MultiChart_State_v1 로컬 저장 및 POST /api/settings로 autosaved_user_settings.json 저장을 실행한다. 자본동향 탭 내부의 저장 호출은 Promise 큐로 순차 실행하지만 앱 전체의 다른 저장이나 다중 클라이언트까지 직렬화하는 기능은 아니다. 서버의 기존 전체 설정 저장 정책을 유지한다.

applyData 및 applyFullStateBackup에서 USLinks.refresh를 호출하여 변경된 tabData를 렌더링하고 초안을 폐기한다. 자본동향 데이터가 없는 오래된 설정도 고정 탭을 생성한다.

## Verification and Limits

node tests/us-links.test.cjs는 설치된 Edge(channel: msedge)의 headless 모드로 목록 기능과 실제 app.js의 고정 탭·설정 직렬화/복원을 검증한다. 서버 저장은 테스트에서 모의 처리하므로 운영 파일 쓰기와 실제 로그인 환경은 수동 검증 대상이다. 최근 UI 수정의 세부 시각 검증은 quickstart를 따른다.

## Related Specifications

009-base-interest-tab의 탭 위치를 본 기능 도입 후 순서로 갱신한다. 006-settings-sync의 기존 전체 설정 계약을 재사용한다.

## Description Display

items의 선택적 description을 저장하고 초안에도 포함한다. 오른쪽 설명 셀에 설명을 textContent로 표시하여 입력 HTML을 실행하지 않는다. CSS 두 줄 clamp 및 렌더 후 높이 측정으로 넘치는 설명에만 펼치기를 제공한다. 설명 영역 click/dblclick은 셀 URL 동작으로 전파하지 않는다. 설명 본문 dblclick은 해당 항목 편집을 시작하고 설명 textarea에 포커스를 둔다. 펼치기/접기 버튼 dblclick은 편집에서 제외한다. 여러 줄 textarea는 최소 72px이며 제목/URL 및 작업 버튼 36px 정책은 유지한다.

설명과 펼치기/접기 버튼은 flex 행으로 구성하여 버튼을 마지막 표시 줄 오른쪽 끝에 정렬한다. 제목은 항목 셀 너비를 활용해 줄바꿈하며 조기 말줄임을 제거한다. URL의 말줄임은 유지한다.

접힌 설명과 펼친 설명 모두 white-space: pre-wrap으로 저장된 줄바꿈을 유지한다. 접힌 상태의 clamp는 max(2, 직접 입력한 줄 수)이며 짧은 여러 줄 설명은 말줄임 없이 모두 표시한다. 긴 문장의 추가 자동 줄바꿈만 펼치기로 확인한다.

설명 제목은 span으로 표시하고 편집 중 작업 열 너비의 절반만큼 오른쪽으로 보정하여 일반 상태 가운데 위치를 유지한다. 작업 열과 보정값은 동일한 CSS 변수(--us-actions-width)를 사용한다. 설명 본문은 일반 상태에서 계속 확장된다.

항목/설명 열 경계에 pointer capture 드래그 핸들을 두고 항목 col의 백분율 너비를 갱신한다. titleColumnWidth(15–65%, 기본 28%)를 tab_us 설정에 저장하고 render에서 복원한다. 바깥 테두리/행 높이 조절은 제공하지 않는다.
