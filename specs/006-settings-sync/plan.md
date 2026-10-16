# Implementation Plan: 설정 저장 및 동기화

**Branch**: `006-settings-sync` | **Date**: 2026-09-29 | **Spec**: specs/006-settings-sync/spec.md

## Summary

전체 앱 설정(탭 구성, 갱신 주기, 메모, 관심종목 그룹 등)을 서버 프로젝트 루트의 단일 파일(`user_settings_autosaved.json`)에 전체 스냅샷 방식으로 저장·복원한다. 브라우저 로컬 저장소는 서버 장애 시 복구용 사본으로 유지한다. 전체 백업은 `user_settings_manualsaved_<timestamp>.json` 한 파일로 서버 프로젝트 루트에 저장한다. 버전 관리나 필드 단위 병합 없이 "마지막 저장 우선" 정책을 따른다.

## Technical Context

**Language/Version**: Node.js >= 18(Express), 브라우저 localStorage API

**Primary Dependencies**: express(정적 파일 서빙 및 JSON 본문 파싱, 50MB 한도)

**Storage**: 서버 프로젝트 루트의 `user_settings_autosaved.json`(설정·메모 영구 스냅샷), 루트 JSON 전체 백업 파일, 장애 복구용 브라우저 `localStorage`(`MultiChart_State_v1` 등)

**Testing**: 자동화 테스트 없음. quickstart.md로 수동 검증.

**Target Platform**: Oracle Cloud + PM2, 브라우저

**Project Type**: 웹 서비스

**Performance Goals**: 로컬 저장 1초 이내(SC-001), 서버 우선 적용 100%(SC-002)

**Constraints**: `user_settings_autosaved.json`은 git에 커밋되지 않아야 한다(Constitution 원칙 III). 동시 저장 시 필드 병합 없이 마지막 저장이 전체를 덮어쓴다(현재 정책으로 문서화, 다중 사용자 확장 시 재검토 필요).

**Scale/Scope**: 1인 사용자, 여러 브라우저/PC에서 순차 접속(동시 다중 사용자 편집은 범위 밖)

## Constitution Check

- **I. Spec-First**: PASS
- **II. External API Resilience**: 해당 없음(외부 API 미사용) — N/A로 처리.
- **III. Secrets Isolation**: PASS — `user_settings_autosaved.json`은 `.gitignore`에 포함되어야 하며, API 키를 포함하지 않는다(탭 구성/메모 등 사용자 데이터만 저장).
- **IV. Solo-Maintainer Simplicity**: PASS — 버전 관리·잠금·병합 로직을 추가하지 않고 전체 스냅샷 덮어쓰기 방식을 유지(현재 1인 사용자 규모에 적합, 문서화된 한계로 명시).
- **V. Agent-Agnostic Workflow**: PASS

위반 없음. (다만 3.7절의 "충돌/원자성 없음" 한계는 향후 다중 사용자 확장 시 Constitution II 위반 소지가 있어, `/speckit-analyze` 단계에서 재검토 권장.)

## Project Structure

### Documentation (this feature)
```text
specs/006-settings-sync/
├── plan.md
├── research.md
├── data-model.md
├── contracts/
└── quickstart.md
```

### Source Code (repository root)
```text
server.js                 # GET/POST /api/settings
public/
├── app.js                 # saveAppData, getSerializedState, applyData,
                            # 시작 시 복원 로직, 전체 JSON 백업 내보내기·가져오기
└── index.html
user_settings_autosaved.json # 서버 저장 파일 (.gitignore 포함 필수)
.gitignore                  # user_settings_autosaved.json 및 백업 파일 제외 확인 대상
```

**Structure Decision**: 기존 구조 유지. 별도 DB나 버전 관리 시스템 도입 없이 단일 JSON 파일 + 전체 스냅샷 저장 방식을 그대로 사용.

## Complexity Tracking
해당 없음.
