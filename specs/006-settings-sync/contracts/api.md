# API Contracts: 설정 저장 및 동기화

## GET /api/settings
**Query**: `_t=<timestamp>` (캐시 방지)
**Response 200 (설정 있음)**: `{ "success": true, "data": <AppSettingsSnapshot> }`
**Response 200 (설정 없음)**: `{ "success": true, "data": null }`
**Response 500**: 파일 읽기/JSON 파싱 실패 시

## POST /api/settings
**Request body**: `<AppSettingsSnapshot>` 전체 (Express JSON 본문 한도 50MB)
**Response 200**: `{ "success": true }`
**Response 500**: 파일 쓰기 실패 시
**참고**: 요청은 전체 스냅샷이지만, 서버는 기존의 `memoHtml`, `memoDelta`, `memoUpdatedAt`을 보존한다. 메모는 전용 경로에서만 명시 저장한다. 파일은 임시 파일 작성 후 원자적으로 교체한다.

## POST /api/settings/memo
**Request body**: `{ "memoHtml": string, "memoDelta": object|null, "memoUpdatedAt": number, "initialSettings": <AppSettingsSnapshot> }`
**Response 200**: `{ "success": true }`
**동작**: 메모 필드를 저장하고 나머지 서버 설정을 보존한다. 이전 메모가 비어 있지 않고 내용이 변경되면 `user_settings.memo-backup.json`에 직전 메모를 보관한다. 실패한 브라우저 저장은 클라이언트의 로컬 미동기화 복사본으로 보존한다.

## POST /api/settings/backups
**Request body**: `{ "json": string }`
**Response 200**: `{ "success": true, "filename": <JSON filename> }`
**Response 400**: 누락된 내용 또는 올바른 AppSettingsSnapshot이 아닌 JSON
**Response 500**: 프로젝트 루트 백업 파일 쓰기 실패
**동작**: 전체 AppSettingsSnapshot을 `manualsaved_user_settings_<timestamp>.json` 하나로 프로젝트 루트(`__dirname`)에 저장한다. 같은 시각에 생성된 이름이 이미 있으면 덮어쓰지 않는다.

## GET /api/settings/backups
**Response 200**: `{ "success": true, "files": [{ "filename": string, "bytes": number, "updatedAt": number }] }`
**동작**: `autosaved_user_settings.json`, 새 형식인 `manualsaved_user_settings_<timestamp>.json`, 기존 `full_backup_<timestamp>.json` 백업을 최신순으로 반환한다.

## GET /api/settings/backups/:filename
**Response 200**: `{ "success": true, "filename": string, "content": string }`
**Response 404**: 허용된 이름 형식이 아니거나 파일이 없음
**동작**: `autosaved_user_settings.json`, `manualsaved_user_settings_<timestamp>.json` 또는 기존 `full_backup_<timestamp>.json` 백업을 읽기 전용으로 반환한다. 경로 구성 요소는 허용하지 않는다.

### Rank 차트 펼침 상태 저장

사용자 설정 스냅샷에 rankChartDisplay={debugOpen:boolean,candleOpen:boolean}를 포함한다. 둘의 기본값은 false이며 필드가 없는 예전 설정도 닫힘으로 복원한다. 버튼 변경은 기존 saveAppData 경로로 로컬 설정과 autosaved_user_settings.json에 저장한다. 전체 설정 다운로드 및 manualsaved_user_settings/full_backup 수동 백업도 같은 스냅샷 필드를 포함한다. 기존 설정 파일·과거 백업을 직접 덮어써서 마이그레이션하지 않는다.

시작 시 서버/로컬 설정 적용과 수동 백업 복원 모두 동일한 상태 적용 함수를 사용한다. 복원 자체는 토글 클릭이나 별도 자동 저장을 발생시키지 않는다. 값은 엄격한 boolean true만 펼침으로 처리한다. 저장 실패 처리는 기존 설정 동기화 정책을 따른다.

### 봉 종류와 간격 저장

차트 기본 봉 종류는 day(일봉), 기본 분 간격은 1이다. 기존 rankChartDisplay 설정에 mode(day/minute)와 interval(1·3·5·10·15·30·45·60)을 추가한다. 일·분 및 분 간격 변경은 기존 사용자 설정 자동 저장과 수동 백업에 포함된다. 시작/설정 불러오기/전체 백업 복원 시 선택 버튼과 차트에 적용한다. 필드가 없거나 무효이면 일봉·1분으로 처리한다. 일봉에서도 마지막 분 간격을 보존하고 분봉 전환 시 적용한다.

## DELETE /api/settings/backups/:filename — 2026-10-10

기존 API 로그인 정책을 적용한다. 기존 getBackupPath의 파일명 패턴 및 프로젝트 루트 경로 검증 후 지정한 파일 하나를 삭제한다. autosaved_user_settings.json은 403으로 거부한다. 허용되지 않은 이름은 400, 없는 파일은 404, 삭제 실패는 500이다. 성공은 {success:true,filename}, 실패는 {success:false,error}이다. 디렉터리·임의 경로 및 다른 설정 파일은 삭제 대상으로 허용하지 않는다.
