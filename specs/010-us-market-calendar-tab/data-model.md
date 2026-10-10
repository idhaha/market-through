# Data Model: 자본동향 고정 탭

**Date**: 2026-10-10

## Saved State

전체 설정의 contents.tab_us에 다음 구조를 저장한다. 예시 값은 문서용이다.

```json
{
  "name": "자본동향",
  "items": [
    { "id": "unique-item-id", "title": "자본동향 일정", "url": "https://example.com/calendar", "description": "자본동향 주요 발표 일정 참고" }
  ]
}
```

items 배열 순서가 표시 순서이다. tabs 목록에는 id=tab_us, name=자본동향을 포함하고 선택 중이면 activeTabId=tab_us이다. ID는 수정·이동 시 유지하고 신규/새로저장 때 생성한다.

## Validation

제목·URL 앞뒤 공백을 제거하고 두 값 모두 필수로 검증한다. URL은 유효한 절대 HTTP/HTTPS 주소이어야 한다. 제목과 URL이 모두 같은 다른 항목이 있으면 저장을 거부한다. 한 값만 같으면 허용한다.

불러온 items가 배열이 아니면 빈 배열로 처리한다. 제목·URL이 문자열이 아닌 항목은 제외한다. 누락되거나 중복된 ID는 생성하여 쌍을 유지한다. 불러온 문자열 URL의 유효성은 열기/저장 시 확인한다.

## Draft State

초안은 {id: 기존 ID 또는 null, title, url}이다. 추가/편집 시 생성, 저장 성공·ESC·설정 복원 시 제거한다. 다른 항목 편집/추가 전 기존 초안 폐기 확인을 제공한다. 초안은 전체 설정에 직렬화하지 않는다.

## Storage

브라우저 MultiChart_State_v1 및 서버 autosaved_user_settings.json에 기존 전체 설정 구조로 저장한다. 자본동향 전용 데이터 파일은 만들지 않는다. 저장 실패 시 로컬/서버 결과를 상태 메시지로 알린다.

## Optional Description

description은 선택적 문자열이다. 기존 항목에 필드가 없으면 화면과 편집에서는 빈 문자열로 취급하며 새 저장에는 앞뒤 공백을 제거한 값을 포함한다. 새로저장은 원본 설명을 보존하면서 초안 설명을 새 ID에 복사한다. 설명만 다른 동일 제목·URL은 중복으로 거부한다.

## Column Width

contents.tab_us.titleColumnWidth는 표 전체 너비 대비 항목 열의 백분율(15–65)이다. 누락/잘못된 값은 28%로 표시한다. 드래그 종료 또는 키보드 조절 후 기존 전체 설정 저장에 포함한다.
