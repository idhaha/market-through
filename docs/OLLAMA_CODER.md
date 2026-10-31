# Ollama 로컬 코드 작업

기존 `ollama.ask_model`은 텍스트 초안용으로 유지한다. `ollama_coder`는 로컬 모델이 파일 도구를 실제로 호출할 수 있도록 만든 별도 MCP 실행기다. Node 내장 기능만 사용하며 패키지 설치가 필요 없다.

담당 범위는 AGENTS.md 그대로다. Ollama에는 HTML/CSS·보일러플레이트·변수명·명확한 단일 함수 수정 같은 단순 작업만 맡긴다. 복잡한 설계·업무 조건·상태 동기화·보안/성능 핵심 로직과 여러 파일 디버깅은 초안부터 Codex가 직접 수행한다. 도구 권한이 생겼다는 이유로 담당 범위를 넓히지 않는다. 복잡도 판단은 Codex의 책임이며 실행기가 의미적으로 모든 복잡한 요청을 판별해 차단하는 것은 아니다.

## 실행 흐름

1. Codex가 작은 작업과 관련 파일을 지정해 `start_task`를 호출한다. 모델 기본값은 `qwen2.5-coder:7b`이며 문서 초안에는 `qwen2.5:14b`를 선택할 수 있다.
2. 실행기는 지정 파일을 `dev/output/ollama-tasks/<id>/work/`에 복사한다. Ollama는 이 복사본에만 `list_files`, `read_file`, `replace_text`, `write_file`, `run_check`를 호출한다. 변경 결과를 다시 로컬 모델에 전달하는 JSON 작업 루프를 사용하므로 네이티브 tool calling 지원을 가정하지 않는다.
3. Codex는 `task_status`로 진행·변경 파일·검사 요약만 받는다. 작업이 `ready_for_review`가 되면 `review_task`로 변경 부분을 확인한다. 출력이 잘렸으면 staged_directory의 파일을 직접 읽어 검토한다.
4. Codex가 검토한 뒤 `apply_task(task_id, review_token)`으로 원본에 반영한다. 원본이 작업 시작 이후 바뀌었거나 검토 후 복사본이 바뀌면 반영을 거부한다. 코드 실행 테스트와 최종 검증은 Codex가 수행한다.
5. 실패·취소 시 원본은 유지된다. `cancel_task`로 실행 중인 로컬 요청을 취소할 수 있다. 단계 파일은 검토를 위해 남으며 MCP 프로세스를 재시작하면 기존 작업 id는 만료된다.

## 허용 범위

- `public/`, `dev/tests/`, `dev/fixtures/`, `docs/` 아래에서 Codex가 정확히 지정한 텍스트 파일만 허용한다. `writable_files`로 수정 가능한 파일을 더 줄일 수 있다. 나머지 파일은 읽기 전용 문맥이다.
- 파일1개256KiB, 작업당1~8개·합계512KiB, 기본12턴·최대24턴, 동시1작업, 최대10분이다. 원본이 미커밋 상태여도 현재 내용을 기준으로 복사하고 이후 변경 충돌을 검사한다.
- `.env`, 사용자 데이터, 인증·비밀 파일, Git·Codex 설정, AGENTS/SKILL/RULE 파일과 실행기 자체는 허용하지 않는다. 경로 이탈, 디렉터리 링크와 하드링크도 거부한다.
- 터미널 도구는 `node --check <지정된 JS/CJS/MJS 파일>`만 실행한다. shell 명령, Node 코드 평가, 수정된 코드 실행, 패키지 설치, 삭제, 커밋·배포는 제공하지 않는다. 구문 통과는 기능·보안 검증 통과를 의미하지 않는다.
- 원본 반영 도구는 Codex에게만 노출되는 별도 MCP 단계이며 로컬 모델의 작업 도구에는 없다. Codex는 변경을 읽고 이해한 뒤 반영한다.
- 모델 요청은 `http://127.0.0.1:11434`에만 보낸다. 외부 모델로 자동 전환하지 않는다. 비밀값을 instruction에 넣지 않는다. 도구 제약은 이 실행기가 제공하는 범위 제한이며 OS 전체 샌드박스가 아니다.

## 토큰 절약 사용법

Codex가 코드 전체를 읽고 다시 `ask_model`에 붙이지 않고, 작업 지시·파일 경로만 전달한다. 파일 읽기와 중간 시행착오는 로컬 모델 안에서 처리한다. Codex는 상태 요약과 필요한 변경 부분만 확인한다. 마지막 검토와 테스트에는 여전히 Codex 토큰이 사용되며 작업마다 절약량은 다르다.

호출 예:

```json
{
  "instruction": "안내 아이콘의 테두리 색만 기존 카드 정보 아이콘과 맞춰라. 다른 스타일은 유지하라.",
  "files": ["public/market-alerts.css", "public/style.css"],
  "writable_files": ["public/market-alerts.css"]
}
```

## 설치와 검증

이 프로젝트의 `.codex/config.toml`에 [설정 조각](../scripts/ollama-coder/mcp-config.toml)의 `ollama_coder` 섹션을 추가한다. 프로젝트가 신뢰된 상태여야 한다. 기존 전역 `ollama`는 유지한다. 현재 대화 도구 목록에 새 MCP가 나타나지 않으면 Codex 클라이언트의 MCP를 다시 연결하거나 새 세션을 연다. 설정 등록과 현재 세션에서 도구가 호출 가능한지는 별개다.

```powershell
node --test dev/tests/ollama-coder.test.cjs
node scripts/ollama-coder/smoke.cjs
```

두 번째 명령은 실제 로컬 모델로 임시 폴더의 작은 함수 연산자를 수정하고, 구문 검사·변경 검토·반영 경로를 확인한다. 애플리케이션 파일은 변경하지 않는다. Ollama가 실행 중이고 `qwen2.5-coder:7b`가 설치되어 있어야 한다.

2026-10-30: 실행기 테스트8개와 실제 `qwen2.5-coder:7b`의 읽기→수정→구문검사→검토 후 반영 시험이 통과했다. `qwen2.5:14b`에는 운영 가이드 초안을 위임했고 Codex가 제약 설명을 수정·보완했다. 실제 시험은 네이티브 tool calling 지원 여부를 검증한 것이 아니라 JSON 작업 루프가 정상 작동함을 검증한 것이다.

근거: [Ollama 구조화 출력](https://docs.ollama.com/capabilities/structured-outputs), [Codex MCP 구성](https://learn.chatgpt.com/docs/extend/mcp).
