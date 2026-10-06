# Data Model: 기준금리 차트

- 고정 탭 ID: tab_base_interest. 제목: 기준금리. data-perm=true, draggable=false.
- BANKS: code/name 12개, 화면 배치 순서 고정.
- 서버 상태: id(작업 번호), date(Asia/Seoul 시작 날짜), capturedAt(완료 ISO 시각), status(loading/ready/partial/error), error, charts.
- 각 chart: code/name, image(PNG data URL 또는 null), error(사용자 오류 또는 null).
- pending: 실행 중 여부. 별도 캡처 진행은 하나만 허용.
- lastSuccess: 마지막 성공 또는 부분 성공 상태. 당일 강제 전체 실패 시 보존.
- refreshError: 이전 결과를 제공할 때 새 조회 실패 안내.
- 화면 baseInterestCache: 당일 완료 결과 메모리. baseInterestRequest: 폴링 중 Promise.

이미지는 API JSON의 base64로 전달하며 서버 이미지 파일, 사용자 설정 JSON 또는 localStorage에 저장하지 않는다. 부분 성공도 당일 보관한다. 날짜 변경 후 다음 조회에서 새 작업을 시작한다.
