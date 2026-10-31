# 로컬 비전 모델 비교 (2026-10-30)

비교 모델: `qwen3-vl:8b-instruct`, `qwen3.5:9b` (모델 digest와 양자화는 `meta.json`).

## 최종 CPU 결과

- 8B Instruct: 화면 위치 찾기 10/10, 중앙값 74.1초. OCR 5장 303자 중 편집 오류 10자(CER 3.3%), 한글 음절 CER 0%, 숫자·단위 토큰 31/32, OCR 중앙값 81.2초.
- 9B: 화면 위치 찾기 8/10, 중앙값 50.0초. OCR 5장 303자 중 편집 오류 47자(CER 15.5%), 한글 음절 CER 5.1%, 숫자·단위 토큰 27/32, OCR 중앙값 9.7초.
- 최종 CPU 요청 30건은 모두 정상 완료했다. 이 작은 표본에서는 8B가 더 정확했고 9B가 더 빨랐다. CER에는 지정한 행 전사 순서를 바꾼 오류도 포함한다.
- GPU 실행은 양쪽 모두 오류가 있어 전체 비교를 완료하지 못했다. 이 수치는 CPU 전용 결과이며 정상 GPU 실행의 성능을 뜻하지 않는다.

이미지 해시, 모델별 결과 개수·중복, CPU 할당, 보고서 상대 경로는 `verify.cjs`로 검증했다. 결과는 `verification.json`이다.

## 평가 자료

- GUI: ScreenSpot test 1,272개 중 결과 확인 전에 균등 간격으로 선정한 10개. 원본 이미지와 정답 영역은 `cases.json`.
- 한글 OCR: 기존 앱 테스트 캡처에서 확대·축소 없이 잘라낸 5개 영역. 정답 303자는 추론 전에 수동 전사하고 고정했다. 원본 파일 해시와 정답은 `ocr-cases.json`.
- 모든 모델에 같은 이미지 바이트와 과제별 같은 프롬프트를 전달한다. 외부 모델 API는 호출하지 않는다.

## 두 실행 환경을 구분한다

GPU 실행은 두 모델 모두 이미지 인코딩 중 Vulkan `device lost`와 HTTP 500을 반복해 조기 중단했다. 미실행 사례는 오답으로 채우지 않았다. `results.json`은 실제 반환된 GPU 요청 기록이며 `gpu-failure-evidence.txt`는 관련 서버 로그 발췌다. GPU 표본 전체에 대한 모델 정확도 순위는 산출할 수 없다.

전체 GUI 비교는 CPU 전용으로 별도 실행한다. 동일한 10개 화면에서 긴 변이 1,280px를 넘는 경우에만 System.Drawing HighQualityBicubic으로 축소해 PNG로 저장했다. 두 모델은 같은 축소 파일 바이트를 받는다. 정답 영역은 정규화 좌표이므로 그대로 유지한다. 원본과 축소본 매핑·해시는 `cpu-gui-cases.json`이다. 결과는 `cpu-gui-results.json`, 모델 할당·워밍업 기록은 `cpu-gui-meta.json`이다. 작은 글자는 축소로 읽기 어려워질 수 있으며 원본 GPU 결과와 섞어 채점하지 않는다. 실행 순서는 8B 전반 5개 → 9B 전체 10개 → 8B 후반 5개이며, 블록마다 채점하지 않는 OCR 이미지로 워밍업한다.

CPU OCR은 별도 진단 실행이다. 두 모델 모두 `num_gpu=0`, temperature 0, seed 42, context 8192, think false, 출력 한도 1024를 사용한다. 모델별 별도 이미지 워밍업 후 OCR 5개를 한 번씩 실행한다. 원시 결과는 `cpu-ocr-results.json`, 실제 GPU 할당이 0인지 확인한 기록은 `cpu-ocr-meta.json`이다. CPU OCR 시간과 앞선 GPU 시간을 직접 비교하지 않는다.

최초 CPU 실행 후 9B 태그에만 presence_penalty=1.5 기본값이 있음을 확인했다(`model-defaults.json`). 8B의 실제 실행 로그는 presence=0, frequency=0, repeat=1이었다. 최종 비교에는 이 값을 명시한 9B 추가 실행을 사용한다. 최초 결과와 메타데이터는 `cpu-ocr-default-results.json`, `cpu-ocr-default-meta.json`으로 보존했다. 입력 이미지, 프롬프트, 정답은 바꾸지 않았다.

## 점수

- CER: NFC 정규화 후 공백·줄바꿈을 제거한 Unicode 글자 단위 편집거리 / 정답 글자 수. 숫자·기호는 유지한다. 전체 오류 수와 전체 정답 글자 수의 비율로 합산한다.
- 한글 CER: 한글 음절만 남긴 보조 지표.
- 숫자·단위 토큰 일치: 공백을 제거한 뒤 정답의 숫자 토큰이 출력에 있는지 중복 개수까지 대조한다. 위치·순서는 별도 평가하지 않는 보조 지표다.
- 호출 실패는 정상 전사와 구분하며 CER 계산에서 제외한다. 원문과 실행 범위를 보고서에서 함께 확인한다.
- 작은 표본이며 같은 앱의 제한된 글꼴·디자인만 포함한다. 일반 문서·사진·손글씨 평가로 일반화하지 않는다.

## 파일과 재현

- `report.html`: 이미지, 정답, 각 모델 출력과 계산 결과.
- `summary.json`: 계산 결과와 사용한 개별 기록.
- `benchmark.cjs`: 직접 Ollama HTTP API 호출. `cpu-ocr` 모드는 CPU OCR만 수행한다.
- `cpu-gui.cjs`: 같은 10개의 축소 화면을 CPU로 비교한다. 시간 제한은 이미지별 10분이며 실패도 기록한다.
- `report.cjs`: 원시 JSON에서 점수와 HTML을 재생성한다.

```powershell
node outputs/vision-benchmark-20261030/report.cjs
# CPU OCR 재실행은 기존 CPU 결과 파일을 덮어쓴다.
node outputs/vision-benchmark-20261030/benchmark.cjs cpu-ocr
```

Codex가 표본 선정, 정답 검수, 실행·오류 분석, 점수 계산과 결과 통합을 담당했다. 보고서의 기본 CSS 초안은 로컬 `qwen2.5-coder:7b`에 실제 요청한 뒤 검토·확장했다. 이미지 평가 자체는 위 두 비전 모델을 Ollama 로컬 API로 호출했다.
