# Data Model: 메모 탭

## Memo
| 필드 | 설명 |
|---|---|
| memoHtml | Quill 에디터 HTML 출력 |
| memoDelta | Quill Delta(JSON, 구조화 서식) |

## CalendarEvent
| 필드 | 설명 |
|---|---|
| id | Google Calendar 이벤트 ID |
| title | 제목 |
| start / end | 시작/종료 일시 |
| allDay | 종일 여부 |
| description | 설명 |
| isHoliday | 공휴일 캘린더 출처 여부(읽기 전용 판별용, 파생값) |

## 저장 위치
- Memo는 로컬(`memoContent_html`, `memoContent_delta`)과 서버(`user_settings_autosaved.json`의 `memoHtml`, `memoDelta` 필드)에 이중 저장된다.
- CalendarEvent는 Google Calendar가 단일 진실 소스(source of truth)이며, 이 앱은 저장하지 않고 매번 조회한다.
