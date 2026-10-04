<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0 (MINOR: 서버 자원 제약 섹션 추가 및 배포 방식 실제 동작에 맞게 수정)
- Modified principles: II. External API Resilience (외부 데이터 소스 목록 보완: adrinfo.kr, Google 로그인), III. Secrets Isolation (서버가 만드는 사용자 데이터 파일 목록 구체화)
- Added sections: Technology & Deployment Constraints 안의 "Server Resource Constraints"
- Modified sections: Technology & Deployment Constraints (Frontend에 FullCalendar 명시, Deployment를 실제 배포 스크립트 동작으로 수정)
- Removed sections: 없음
- Follow-up TODOs: RATIFICATION_DATE는 이전에 공식적으로 비준된 기록이 없으므로 최초 작성일을 기준으로 설정되어 있음. 이 날짜가 적절한지 확인하거나, 프로젝트가 더 이전 시점에 이미 "ratified"된 것으로 간주되어야 한다면 해당 날짜를 제공해야 함.
-->
# MarketThrough Constitution

## Core Principles

### I. Spec-First Documentation

Sync Impact Report와 본 constitution은 앞으로 프로젝트의 개발 및 유지보수에 적용된다.

다만 코드베이스(server.js, public/app.js 등)는 본 constitution보다 먼저 작성되었다. 따라서 기존 기능에 대한 specs를 작성할 때는 반드시 실제 실행 중인 코드를 기준으로 작성하고 검증해야 하며, 기억이나 추측에 의존해서는 안 된다.

specs에는 검증되지 않은 계획이나 희망 사항을 현재 구현된 기능인 것처럼 기술해서는 안 된다. 계획된 변경 사항은 future work로 별도로 기술한다.

코드와 관련 Spec Kit 문서(spec.md, plan.md, tasks.md, contracts 등)의 내용이 서로 다른 경우, 영향을 받는 spec을 최종 확정하기 전에 어느 쪽이 잘못되었는지 확인하고 해당 불일치를 해결해야 한다.

### II. External API Resilience
이 프로젝트는 여러 외부 데이터 소스(Kiwoom REST, eFriend, TradingEconomics, FRED, ECOS, TradingView, Investing.com, Finviz, Toss Securities calendar, Google Calendar, Google Identity Services 로그인, adrinfo.kr ADR 프록시)에 의존한다.

각 연동은 장애가 발생하더라도 정상적으로 기능을 축소하여 동작해야 한다. 캐시된 데이터나 마지막으로 확인된 데이터를 제공하거나 명확한 오류 상태를 표시해야 하며, 서버가 중단되거나 전체 UI가 빈 화면이 되어서는 안 된다.

하나의 외부 API 장애로 인해 서로 관련 없는 다른 기능까지 중단되어서는 안 된다.

### III. Secrets Isolation (NON-NEGOTIABLE)
API 키, 토큰 및 세션 관련 비밀 정보는 .env에만 저장해야 하며 git에 커밋해서는 안 된다.

user_settings.json과 같은 사용자별 백업 파일은 저장소에 추가해서는 안 된다. 서버가 프로젝트 루트에 생성하는 autosaved_user_settings.json, user_settings.memo-backup.json, full_backup_*, bulk_settings_* 파일도 같은 규칙을 따른다.

설정 파일을 변경하는 커밋을 하기 전에 작성자는 .gitignore가 여전히 이러한 파일을 제외하고 있는지 반드시 확인해야 한다.

### IV. Solo-Maintainer Simplicity
이 프로젝트는 별도의 테스트 또는 운영 팀 없이 한 명의 개발자가 유지보수한다.

새로운 추상화, 의존성 또는 아키텍처 계층을 추가할 경우 현재 실제로 필요한 이유가 있어야 한다(YAGNI).

추측에 기반한 범용적인 설계보다는 현재 spec을 충족하는 가장 단순한 변경을 우선한다.

### V. Agent-Agnostic Workflow
Spec Kit 산출물(constitution, specs, plans, tasks)은 일반 Markdown으로 관리한다. 이를 통해 Claude, ChatGPT/Codex, Antigravity 등 서로 다른 AI 코딩 도구를 사용하더라도 특정 도구에 종속되지 않고 프로젝트 작업을 계속할 수 있어야 한다.

프로세스 단계는 특정 도구에만 존재하는 기능에 의존해서는 안 된다. 예를 들어 특정 에이전트만 수행할 수 있는 자동 커밋 같은 기능이 이에 해당한다.

이러한 편의 기능은 선택 사항이며, 작업을 진행하기 위한 필수 조건으로 사용해서는 안 된다.

## Technology & Deployment Constraints

Runtime: Node.js >= 18, Express framework (backend in server.js).

Frontend: public/ 아래의 vanilla HTML/CSS/JS를 사용하며, build step은 없다. 리치 텍스트 편집에는 Quill을, 캘린더 표시에는 FullCalendar를 사용한다(둘 다 CDN 로드).

Deployment: Oracle Cloud Free Tier 인스턴스에서 운영하며, 프로세스는 PM2로 관리한다. 현재 CI/CD pipeline은 없으며, 서버에서 배포 스크립트(update-market.sh)로 br_oracle branch를 git fetch + git reset --hard origin/br_oracle로 동기화한 뒤 pm2 reload 방식으로 배포한다. reset --hard를 사용하므로 서버에서 코드를 직접 수정하지 않으며, 런타임 데이터 파일(사용자 설정, 허용 이메일, FRED 캐시 등)은 Git에서 추적하지 않는다.

dev_tools/는 과거의 test/debug/experiment artifacts만 보관한다. 반드시 .gitignore에서 제외해야 하며, application 실행에 필요한 요소로 사용해서는 안 된다.

docs/reference/는 third-party API reference material을 보관하며, application code가 아닌 supporting documentation으로 git에서 추적한다.

### Server Resource Constraints

운영 서버는 Oracle Cloud Free Tier로 RAM이 약 1GB이므로 다음을 지킨다.

- 스왑 파일 2GB(/swapfile, vm.swappiness=10, /etc/fstab 등록)를 유지한다. 스왑은 메모리 부족 시 서버가 정지하는 것을 막는 안전망이며 성능 보강 수단이 아니다.
- Puppeteer(Chrome)는 서버에서 동시에 1개만 실행한다. 대기 한도를 넘으면 Chrome을 추가로 띄우지 않고 요청을 실패 처리해야 하며, 브라우저를 닫은 뒤에만 실행 슬롯을 반납한다.
- 메모리를 많이 쓰는 외부 프로세스(Chrome, FRED용 Python)는 동시 실행 수를 제한한다(FRED Python은 동시 2개).
- PM2 로그는 pm2-logrotate(10MB 단위, 5개 보관, 압축)로 관리해 무제한으로 커지지 않게 한다.
- 상주 메모리를 늘리는 변경(상주 프로세스, 대용량 캐시 등)은 배포 전에 1GB 한도 안에서 감당 가능한지 확인한다.

운영 절차와 장애 대응은 docs/operations/server-runbook.md를 따른다.

## Development Workflow

Feature work는 다음 Spec Kit 순서를 따른다: /speckit-constitution → /speckit-specify → /speckit-clarify → /speckit-plan → /speckit-tasks → /speckit-analyze → /speckit-implement.

기존 기능(brownfield)의 경우 실제 코드를 기준으로 먼저 spec을 작성한 다음 관련 기존 문서 및 현재 구현을 교차검증한다. 불일치 사항은 기록하고 /speckit-analyze를 통해 해결한 후 implementation work를 진행한다. 최종 확정된 요구사항과 설계는 각 feature의 Spec Kit 산출물을 Source of Truth로 사용한다.

Commits는 논리적인 변경 단위별로 수동 검토하고 직접 수행한다. 자동 또는 unattended commit은 사용하지 않는다.

## Governance

본 constitution은 기존의 상충하는 관행이나 비공식적인 규칙보다 우선한다.

Amendments는 /speckit-constitution을 통해 진행하며, 반드시 Sync Impact Report를 생성해야 한다.

Version bump는 semantic versioning을 따른다.

MAJOR: 원칙의 삭제 또는 재정의

MINOR: 새로운 원칙/section의 추가 또는 기존 원칙/section의 실질적인 확대

PATCH: 문구 수정 또는 clarification만 이루어진 경우

/speckit-analyze는 새로운 specs와 plans가 본 문서를 준수하는지 검토한다.

**Version**: 1.1.0 | **Ratified**: 2026-09-29 | **Last Amended**: 2026-10-04