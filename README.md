# MarketThrough — 실시간 금융 대시보드 웹서비스

Oracle Cloud Free Tier를 활용한 키움증권 실시간종목조회순위 데이터 표시 웹 애플리케이션입니다.

## 📋 기능

- ✅ 키움증권, 한국투자증권 REST API를 통한 실시간종목조회순위 데이터 조회
- ✅ 거래대금 순위 및 실시간 조회 순위 표시
- ✅ ADR 차트 (KOSPI/KOSDAQ)
- ✅ 실적 발표 캘린더
- ✅ 해외 동향 차트 (Finviz)
- ✅ 자동 새로고침 (설정 가능)
- ✅ 현대적이고 아름다운 다크모드 UI
- ✅ 반응형 디자인 (모바일/태블릿/데스크톱)
- ✅ Oracle Cloud Free Tier에서 24/7 운영

## 🏗️ 프로젝트 구조

```
d:\Program\MarketThrough\
├── public/                # 정적 파일 (프론트엔드)
│   ├── index.html         # 메인 HTML
│   ├── style.css          # 스타일시트
│   └── app.js             # 클라이언트 JavaScript
├── server.js              # Express 서버 (백엔드)
├── package.json           # 프로젝트 의존성
├── .env                   # 환경 변수 (API 키)
├── docs/                  # 시스템 사양서
├── dev/                   # 개발용 코드와 실행 결과
│   ├── tests/             # 자동 검증 테스트
│   ├── scripts/           # 조회·추출·점검·복구 도구
│   └── output/            # 생성된 테스트 결과물 (Git 제외)
├── logs/                  # 운영 로그: 한국 시간 기준 오늘·어제 (Git 제외)
└── .gitignore             # Git 제외 파일
```

## 개발 폴더 및 테스트

2026-10-16에 개발용 최상위 이름을 `dev`로 정했다. `debug`는 디버깅 전용으로 오해하거나 도구의 자동 생성 폴더와 혼동하기 쉬우므로 사용하지 않는다.

```text
dev/
├── tests/      # 자동 검증 테스트
├── scripts/    # 조회·추출·점검·복구 및 수동 실험 도구
└── output/     # 실행해서 생성된 이미지·JSON·CSV·HTML 등

logs/           # 프로젝트 루트의 운영 로그 폴더
```

### 분류 기준

- 예상 결과와 비교해 성공·실패를 판정하는 코드는 `dev/tests/`에 둔다. 기존 프로젝트 루트의 `tests/`도 이곳으로 통합했다.
- 데이터를 조회·추출하거나 환경을 점검·복구하는 도구는 `dev/scripts/`에 둔다. 이름이 `test_*.py`, `test-*.js`여도 API를 호출하고 결과를 출력하는 수동 실험이면 여기에 둔다.
- 실행 결과물은 `dev/output/`에 둔다. 필요한 스크립트가 폴더를 자동 생성하고, Git에서는 제외한다.
- 운영 로그는 `dev/output/`에 기록하지 않는다. 프로젝트 루트 `logs/`에 한국 시간 기준 일자별로 기록하며 오늘·어제 파일만 보관한다.
- 기존 로그 파일은 자동 삭제하지 않고 사용자가 수동 정리한다.

기존 일회성 스크립트의 Git 제외 정책은 유지한다. 공유가 필요한 도구를 추가할 때는 `.gitignore`의 `dev/scripts/` 예외도 함께 추가한다. 과거 수정·패치 스크립트는 폴더 정리나 검증을 이유로 실행하지 않는다.

### 실행 방법

명령은 프로젝트 루트에서 실행한다.

```powershell
node dev/tests/retained-logs.test.cjs
node dev/tests/adr-routes.test.cjs
node dev/tests/rank-refresh.test.cjs
node --test dev/tests/concentration-chart.test.js
node dev/tests/chart-presentation.test.cjs
node dev/tests/rank-session-retention.test.cjs
```

브라우저 테스트는 설치된 Edge 등 해당 테스트가 지정한 브라우저가 필요하다. 외부 API를 호출하는 수동 도구는 자동 회귀 검증과 구분한다.

## 🚀 Oracle Cloud 배포 가이드

### 1. Oracle Cloud 인스턴스 생성

1. **Compute Instance 생성**
   - Shape: `VM.Standard.E2.1.Micro` (Free Tier)
   - Image: Ubuntu 22.04 LTS
   - Public IP 할당

2. **보안 리스트 설정**
   - TCP 22 (SSH)
   - TCP 3000 (Node.js 서버)
   - 선택: TCP 80/443 (Nginx 프록시 사용 시)

### 2. 인스턴스 설정

SSH로 접속:
```bash
ssh -i <your_key> ubuntu@<public_ip>
```

필수 패키지 설치:
```bash
# 시스템 업데이트
sudo apt update && sudo apt upgrade -y

# Node.js 24 설치
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git

# PM2 설치 (프로세스 매니저)
sudo npm install -g pm2
```

### 3. 프로젝트 배포

```bash
# 저장소 클론
git clone https://github.com/idhaha/kiwoom_realtimerank.git
cd kiwoom_realtimerank
git checkout br_oracle

# 의존성 설치
npm ci

# 환경 변수 설정
nano .env
```

`.env` 파일 내용:
```dotenv
KIWOOM_APPKEY=your_app_key_here
KIWOOM_SECRETKEY=your_secret_key_here
```

### 4. 서버 실행

```bash
# PM2로 서버 시작
pm2 start server.js --name kiwoom-service

# 부팅 시 자동 시작 설정
pm2 save
pm2 startup  # 출력된 명령어 실행

# 상태 확인
pm2 status
pm2 logs kiwoom-service
```

### 5. 접속

브라우저에서 `http://<public_ip>:3000` 접속

## 🔄 업데이트 배포

로컬에서 코드 수정 후:

```bash
# 로컬 PC
git add .
git commit -m "업데이트 내용"
git push origin br_oracle
```

Oracle 인스턴스에서:

```bash
# Oracle Cloud 인스턴스
cd ~/kiwoom_realtimerank
git pull origin br_oracle
npm ci  # 의존성 변경 시
pm2 restart kiwoom-service
```

## 🔑 키움 API 정보

- **실시간종목조회순위**: ka00198
- **거래대금상위**: ka10032
- **주식기본정보**: ka10100
- **시세표성정보**: ka10007
- **도메인**: https://api.kiwoom.com

## 💡 사용 방법

1. 웹사이트에 접속하면 자동으로 데이터가 로드됩니다
2. 4개의 고정 탭: Rank, ADR, 실적, 해외동향
3. `+` 버튼으로 커스텀 차트 탭 추가 가능
4. 자동 새로고침 간격 설정 가능 (30초 ~ 1시간)

## 🎨 UI 특징

- 다크모드 기반 프리미엄 디자인
- 그라디언트 및 glassmorphism 효과
- 부드러운 애니메이션 및 호버 효과
- 반응형 레이아웃
- 탭 기반 멀티 뷰

## 🔧 문제 해결

### 서버가 실행되지 않음
```bash
pm2 logs kiwoom-service  # 로그 확인
pm2 restart kiwoom-service  # 재시작
```

### 포트 접근 불가
- Oracle Cloud 보안 리스트에서 포트 3000 허용 확인
- 인스턴스 방화벽 확인: `sudo ufw status`

### 데이터가 표시되지 않음
- `.env` 파일에 API 키가 올바르게 설정되었는지 확인
- 브라우저 개발자 도구(F12) Console 탭에서 에러 확인

## 🛠️ 로컬 개발

```bash
# 의존성 설치
npm install

# 환경 변수 설정 (.env 파일 생성)
# KIWOOM_APPKEY=...
# KIWOOM_SECRETKEY=...

# 개발 서버 시작
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

## 📝 라이선스

이 프로젝트는 개인 사용을 위한 것입니다.

## 🙋 도움말

- [Oracle Cloud 문서](https://docs.oracle.com/en-us/iaas/Content/home.htm)
- [키움증권 API 문서](https://apiportal.kiwoom.com/)
- [GitHub Repository](https://github.com/idhaha/kiwoom_realtimerank)

---

**Made with ❤️ using Oracle Cloud Free Tier**
