# Data Model: 설정 저장 및 동기화

## AppSettingsSnapshot
| 필드 | 설명 |
|---|---|
| activeTabId | 현재 활성 탭 ID |
| tabs[] | `{id, name}` 목록, 표시 순서 |
| contents | 탭 ID별 설정/상태 객체 |
| rankInterval / adrInterval | 갱신 주기 선택값 |
| watchlistGroupId | 관심종목 그룹 |
| memoHtml / memoDelta | 메모 내용(003-memo-tab과 공유 필드) |
| memoUpdatedAt | 마지막 서버 메모 저장 시각. 일반 설정 저장은 기존 값을 보존한다. |
| updatedAt | 직렬화 시점 타임스탬프(충돌 해결에는 미사용) |

## LocalStorageKeys (스냅샷과 별개로 관리)
| 키 | 설명 |
|---|---|
| MultiChart_State_v1 | AppSettingsSnapshot의 로컬 사본 |
| memoContent_html / memoContent_delta | 메모 로컬 폴백 |
| memoContent_updatedAt | 서버에서 적용/저장된 메모 시각 |
| memoPendingServerSyncV1 | 서버 저장 실패 후 재접속에도 보존할 메모와 시각 |
| watchlist_selected_group | 관심종목 그룹 선택 복원용 |
| user_session | 세션 토큰(스냅샷에 포함 안 됨) |

## ServerSettingsFile (autosaved_user_settings.json)
- AppSettingsSnapshot 전체를 JSON으로 저장하는 서버 측 단일 파일.
- 메모 변경 전 이전의 비어 있지 않은 메모는 `user_settings.memo-backup.json`에 별도 저장한다.

### Rank 차트 펼침 상태 저장

사용자 설정 스냅샷에 rankChartDisplay={debugOpen:boolean,candleOpen:boolean}를 포함한다. 둘의 기본값은 false이며 필드가 없는 예전 설정도 닫힘으로 복원한다. 버튼 변경은 기존 saveAppData 경로로 로컬 설정과 autosaved_user_settings.json에 저장한다. 전체 설정 다운로드 및 manualsaved_user_settings/full_backup 수동 백업도 같은 스냅샷 필드를 포함한다. 기존 설정 파일·과거 백업을 직접 덮어써서 마이그레이션하지 않는다.

시작 시 서버/로컬 설정 적용과 수동 백업 복원 모두 동일한 상태 적용 함수를 사용한다. 복원 자체는 토글 클릭이나 별도 자동 저장을 발생시키지 않는다. 값은 엄격한 boolean true만 펼침으로 처리한다. 저장 실패 처리는 기존 설정 동기화 정책을 따른다.

### 봉 종류와 간격 저장

차트 기본 봉 종류는 day(일봉), 기본 분 간격은 1이다. 기존 rankChartDisplay 설정에 mode(day/minute)와 interval(1·3·5·10·15·30·45·60)을 추가한다. 일·분 및 분 간격 변경은 기존 사용자 설정 자동 저장과 수동 백업에 포함된다. 시작/설정 불러오기/전체 백업 복원 시 선택 버튼과 차트에 적용한다. 필드가 없거나 무효이면 일봉·1분으로 처리한다. 일봉에서도 마지막 분 간격을 보존하고 분봉 전환 시 적용한다.
