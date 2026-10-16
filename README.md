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
│   ├── output/            # 생성된 테스트 결과물 (Git 제외)
│   └── README.md          # 분류 기준과 실행 안내
├── logs/                  # 운영 로그: 한국 시간 기준 오늘·어제 (Git 제외)
└── .gitignore             # Git 제외 파일
```

개발 파일의 분류 기준과 실행 방법은 [dev/README.md](dev/README.md)를 참고한다.

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
