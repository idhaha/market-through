# Quickstart: 자본동향 고정 탭

**Date**: 2026-10-10

## Automated Verification

프로젝트 루트에서 실행한다. 기존 Playwright 패키지와 설치된 Microsoft Edge가 필요하다.

```powershell
node --check public/app.js
node --check public/us-links.js
node tests/us-links.test.cjs
git diff --check
```

기능 테스트는 추가, 단일 클릭, 더블클릭 및 셀 여백 편집, 원본 보존 복사, 중복 거부, 수정, 드래그 이동, 삭제 확인 취소/승인, 주소 검증, 복원, 말줄임, 고정 탭 위치/유지 및 설정 직렬화를 확인한다. 서버 쓰기는 모의 처리한다.

## Manual UI Verification

1. 새로고침 후 증시캘린더 → 자본동향 → 기준금리 순서와 자본동향 탭을 확인한다.
2. 일반·편집 상태에 항목·설명 제목만 보이고 제목행이 가운데 정렬되며 오른쪽 버튼 영역의 필드 제목과 테두리가 없는지 확인한다. 항목 셀에 제목 아래 URL이 보이는지, 설명 셀이 더 넓은지, ESC로 종료하면 설명 셀이 버튼 공간까지 확장되는지 확인한다.
3. 상단 항목 추가 및 표 아래 왼쪽 원형 +가 같은 입력 행을 생성하는지 각각 확인한다.
4. 기존 항목 편집 버튼 순서가 저장 → 새로저장 → ESC → 삭제이며 삭제 버튼 앞의 추가 간격이 유지되는지 확인한다. 신규 행에는 삭제 버튼이 없어야 한다.
5. 입력창·버튼 높이 36px, 아래 +의 36px 원형, 긴 URL 말줄임, 좁은 화면 가로 스크롤을 확인한다.
6. 안내 문구가 `한 번 클릭: URL 열기 / 더블클릭: 편집 / ⠿ 드래그: 순서 이동`인지 확인한다.
7. ESC 버튼과 입력 Escape는 취소, 입력 Enter는 저장, 링크 F2는 편집인지 확인한다.

## Operational Persistence Verification (Pending)

로그인된 운영 환경에서 저장·새로저장·삭제·순서 이동 각각의 서버 성공 상태를 확인한다. 서버 autosaved_user_settings.json의 contents.tab_us.items에 ID·제목·URL·순서가 반영되는지, 새로고침과 전체 백업 복원 뒤 같은 목록이 유지되는지 확인한다. 사용자 실데이터 파일은 저장소에 추가하지 않는다.

## Description Verification

오른쪽 설명 열에 선택적 설명을 입력·저장하고 취소/복사/설정 복원을 확인한다. 두 줄을 넘는 설명에만 펼치기가 나타나고 펼치기/접기로 새 탭이 열리지 않는지 확인한다. 여러 줄 설명 입력에서 Enter는 줄바꿈이며 Ctrl/Command+Enter는 저장이다. 기존 설명 없는 항목도 편집·저장이 가능해야 한다.
