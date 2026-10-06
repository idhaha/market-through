# Integration Contract: 증시캘린더

## Current iframe sources

- toss: /calendar — 기존 Toss 프록시 및 내부 연동 계약 유지.
- seibro: https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/company/BIP_CNTS01041V.xml&menuNo=285
- investing: https://kr.investing.com/central-banks/

각 공급자 iframe은 최초 선택, 한국시간 날짜 변경 후 조회, 명시적 새로고침 때만 src를 설정한다. Investing.com 및 SEIBro iframe은 사용자 브라우저에서 직접 접속한다.

## Legacy image endpoint

GET /api/central-banks/image는 기존 서버 코드에 남아 있지만 현재 소탭에서는 호출하지 않는다. 기존 인증, PNG 응답, force_refresh 및 서버 메모리 캐시 구현은 변경하지 않았다. 현재 화면 계약은 이미지 API에 의존하지 않는다.

## Browser boundary

외부 iframe의 HTTP 상태, DOM 및 회원가입 팝업을 부모 앱에서 확인하거나 조작할 수 없다. load 이벤트를 정상 콘텐츠 표시의 증거로 취급하지 않으며 원본 링크를 제공한다.
