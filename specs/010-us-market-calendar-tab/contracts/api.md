# API Contract: 자본동향 링크 목록의 설정 저장

**Date**: 2026-10-10

새 엔드포인트 없이 기존 전체 설정 API를 재사용한다.

## GET /api/settings

성공은 {success:true,data:전체 설정 또는 null}이다. contents.tab_us.items의 ID·제목·URL·순서를 복원한다. 자본동향 데이터가 없는 설정은 빈 자본동향 목록을 제공한다.

## POST /api/settings

기존 전체 설정 스냅샷을 전송하며 자본동향 데이터는 contents.tab_us={name:"자본동향",items:[{id,title,url,description}]}에 포함한다. 서버는 기존 메모 보호 규칙을 적용한 뒤 autosaved_user_settings.json을 원자적으로 쓰고 {success:true}를 반환한다. 쓰기 실패는 500 및 error 메시지이다.

검증·중복 차단은 자본동향 화면 모듈에서 수행한다. 이 API가 자본동향 항목 스키마를 별도로 검증한다고 가정하지 않는다. 전체 스냅샷 저장 방식 및 기존 인증 정책을 유지한다.

## Backup and Failure Behavior

기존 전체 설정 백업/불러오기에도 contents.tab_us를 포함한다. 로컬 저장 뒤 서버 저장이 실패하면 상태 안내를 표시한다. 운영 서버 저장 및 재시작 후 복원은 수동 확인 대상으로 남긴다.

선택적 description도 전체 설정 및 백업에 함께 저장한다. 기존 description 없는 항목은 호환되며 필수값/중복 판단은 제목·URL을 기준으로 한다.
