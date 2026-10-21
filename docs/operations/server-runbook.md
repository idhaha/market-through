# Server Runbook: Oracle Cloud 운영 절차

**Created**: 2026-10-04 | **Applies to**: constitution.md v1.1.0 "Server Resource Constraints"

> 이 문서에는 비밀 정보(API 키, 토큰, IP, 인스턴스 식별자)를 적지 않는다. 서버 경로는 `~/market-through` 기준이다.
> "확인됨"은 서버에서 직접 확인한 항목이고, "확인 필요"는 아직 서버에서 검증하지 않은 항목이다.

## 1. 서버 개요

| 항목 | 값 | 상태 |
|---|---|---|
| 서버 | Oracle Cloud Free Tier, RAM 약 956MB | 확인됨(2026-10-04) |
| 디스크 | 약 45GB(사용 약 21%) | 확인됨(2026-10-04) |
| 웹서버 | nginx(HTTPS, 리버스 프록시), 부팅 시 자동 시작 | 배포 스크립트가 `systemctl enable nginx` 수행 |
| 앱 프로세스 | PM2, 앱 이름 `market-through`, fork 모드 | 확인됨(2026-10-04, 메모리 약 96MB) |
| 로그 관리 | pm2-logrotate | 확인됨(아래 3.2) |
| 스왑 | 2GB `/swapfile`, swappiness 10 | 확인됨(2026-10-04) |

## 2. 상태 점검 체크리스트

| 항목 | 상태 |
|---|---|
| `server.js`의 `MAX_BROWSERS`가 1로 배포되어 있음 (`grep -n "MAX_BROWSERS =" server.js`) | 확인됨(2026-10-04, 1834행) |
| 재부팅 후 PM2가 앱을 자동 시작함 (`pm2 startup` 등록 + `pm2 save`) | 확인됨(2026-10-04 재부팅 후 `market-through` online, 재시작 횟수 0) |
| `--max-memory-restart 350M` 적용 | 적용됨(2026-10-04, `pm2 restart market-through --max-memory-restart 350M` 후 `pm2 save`) |
| 재부팅 후 스왑이 자동으로 켜짐 | 확인됨(2026-10-04 재부팅 후 Swap total 2047MB) |
| pm2-logrotate 모듈의 메모리 증가 추이 | 관찰 필요(아래 3.2 참고) |

## 3. 설정 절차

### 3.1 스왑 2GB 추가 (완료, 새 서버 구성 시 참고)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
free -m
```

스왑은 같은 디스크를 쓰며 이 볼륨은 읽기 속도 제한이 있으므로, 스왑 사용량이 계속 커지면 메모리 사용을 줄여야 한다는 신호로 본다.

### 3.2 PM2 로그 순환 (완료)

2026-10-16 사용자가 Oracle에서 실행한 `pm2 conf pm2-logrotate`, `pm2 status`, `du -sh ~/.pm2/logs` 출력으로 확인했다. 앱 `market-through`와 모듈 `pm2-logrotate`가 모두 online이었다.

- 경로: `/home/ubuntu/.pm2/logs/market-through-out.log`(표준 출력), `market-through-error.log`(오류 출력). 모듈 자체 로그도 PM2 로그 폴더에 포함될 수 있다.
- `max_size=10M`: 각 로그 파일이 약 10MB를 넘으면 순환한다. `workerInterval=30`이므로 30초마다 크기를 확인하며, 순간적으로 기준 크기를 넘을 수 있다.
- `rotateInterval=0 0 * * *`: 크기가 작아도 매일 자정에 순환한다. PM2 모듈이 사용하는 서버 시간대 기준이며, 앱 일자별 로그의 한국 시간 기준과는 구분한다.
- `compress=true`: 순환된 과거 로그를 압축한다.
- `retain=5`: 출력·오류 등 각 로그 파일별로 순환된 과거 파일을 최대 5개 보관한다. 6개가 되면 가장 오래된 파일부터 삭제한다. 현재 기록 중인 파일은 이 과거 5개와 별도다.
- `dateFormat=YYYY-MM-DD_HH-mm-ss`: 순환 파일 이름에 날짜·시각을 붙인다.
- `rotateModule=true`: PM2 모듈 로그도 순환 대상으로 포함한다.

예를 들어 `market-through-out.log`에 계속 기록하다가 크기 기준에 걸리거나 자정이 되면, 기존 내용을 날짜가 붙은 압축 파일로 보관하고 현재 파일을 비워 다시 기록한다. 보통 현재 파일 1개와 과거 압축 파일 최대 5개가 남는다. 이 규칙은 `market-through-error.log`에도 따로 적용된다.

**과거 파일 5개는 5일치가 아니다.** 로그가 많으면 하루에도 여러 번 순환하므로 보관 기간은 더 짧아질 수 있다. 또한 **전체 폴더 용량의 고정 상한은 없다.** 당시 관측된 `52M`은 현재 사용량이며 최대 52MB 보관 설정이 아니다. 여러 로그 종류, 압축률, 크기 검사 사이에 증가한 양에 따라 전체 용량이 달라진다. 관리 대상 로그는 오래된 순환 파일이 삭제되지만, 별도로 남긴 파일까지 이 정책이 정리한다는 의미는 아니다.

현재 설정 확인:

```bash
pm2 conf pm2-logrotate
pm2 status
du -sh ~/.pm2/logs
ls -lh ~/.pm2/logs
```

설정을 다시 구성할 때의 값:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 5
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 set pm2-logrotate:workerInterval 30
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
pm2 set pm2-logrotate:rotateModule true
```

당시 앱 메모리는 115.4MB, 순환 모듈은 21.0MB로 표시됐다. 이는 해당 시점의 관측값이며 고정 사용량이나 제한값이 아니다.

참고: pm2-logrotate 모듈 자체가 메모리를 사용하며 관측값이 30.7MB → 47.7MB → 56.5MB → 70.7MB로 올라갔다(2026-10-04, 재부팅·앱 재시작 직후 포함). 앱(Node 약 55~100MB)보다 커질 수 있으므로 계속 증가하면(예: 100MB 이상) 모듈을 제거하고 서버 기본 logrotate로 대체하는 것을 검토한다.

애플리케이션 로그는 `retained-logs.js`에서 한국 시간 기준 일자별 파일(`logs/server_debug.YYYY-MM-DD.log`, `logs/puppeteer_debug.YYYY-MM-DD.log`)에 기록한다. 오늘·어제 파일만 보관하고, 서버 시작 시와 한국 시간 자정에 이틀 전 이하 파일을 삭제한다. 자정 타이머가 늦게 실행되어도 날짜 변경 후 첫 기록 시 다시 정리한다. 새 기록에는 UTC ISO 시각을 붙인다. 프로젝트 바로 아래 `logs` 폴더는 서버 시작 시 자동 생성한다. 기존 `dev/output` 또는 `dev_tools/logs`의 로그는 자동 이동·삭제하지 않으며, 새 버전 배포 후 서버를 재시작하면 더 이상 기록하지 않는다. 필요 없으면 재시작 후 수동 삭제할 수 있다. PM2 출력 로그의 순환 설정과는 별개다. `update-market_2.sh` 자체에는 로그 삭제나 순환 설정 명령이 없다. 앱 로그 정리는 서버 코드가, PM2 출력 로그 순환은 실행 중인 `pm2-logrotate` 모듈이 각각 수행한다.

### 3.3 재부팅 후 자동 시작 (등록 및 재부팅 동작 확인 완료)

```bash
pm2 startup        # 출력되는 sudo ... 명령을 복사해 그대로 실행
pm2 save
systemctl is-enabled pm2-ubuntu   # enabled 이면 등록된 것
```

메모리 이상 증가 시 PM2가 앱을 자동 재시작하도록 `--max-memory-restart 350M`을 적용했다(`pm2 restart market-through --max-memory-restart 350M` 후 `pm2 save`). Node 정상 사용량은 약 55~100MB이다.

## 4. 배포 절차

배포는 서버에서 배포 스크립트(`update-market_2.sh`)로 수행한다. 스크립트가 하는 일: nginx 확인, `git fetch` + `git reset --hard origin/br_oracle`, `npm ci`, `pm2 reload`(없으면 `pm2 start`), `pm2 save`, 상태 출력.

주의:
- `git reset --hard`는 서버에서 직접 수정한 코드를 지운다. 서버에서 코드를 고치지 않는다.
- 런타임 데이터 파일(`user_settings_autosaved.json`, `authorized_emails.json`, `user_settings.memo-backup.json`, `data/fred-cache/`, `.env`)은 Git에서 추적되지 않는다(2026-10-04 `git ls-files`로 확인). 새 데이터 파일이 생기면 `.gitignore` 제외 여부를 먼저 확인한다.
- `npm ci`는 `node_modules`를 지우고 다시 설치하므로 메모리·디스크 부담이 크다. 의존성(`package-lock.json`)이 바뀌지 않았다면 건너뛰는 것을 권장한다.
- 배포 직후 `free -m`, `pm2 status`로 메모리와 상태를 확인하고, TE 차트 탭이 하나씩 차례로 로딩되는지 본다.

## 5. 장애 대응: 504 Gateway Time-out / 서버가 매우 느림

1. SSH 명령이 안 먹으면 OCI 웹 콘솔에서 인스턴스를 재부팅한다(Reboot, 안 되면 Force reboot). Terminate는 인스턴스를 삭제하므로 누르지 않는다.
2. 재부팅 직후 SSH로 접속해 부하를 먼저 끊는다.

```bash
sudo systemctl stop nginx
pm2 stop all
pkill -f chrome
rm -rf /tmp/puppeteer_dev_chrome_profile-*
```

3. 상태 확인

```bash
free -m
df -h /
ps aux --sort=-rss | head -8
du -sh ~/.pm2/logs
```

4. 직전 부팅의 메모리 부족(OOM) 기록 확인

```bash
sudo journalctl -k -b -1 | grep -c "invoked oom-killer"
sudo journalctl -k -b -1 2>/dev/null | grep -i -E "out of memory|oom|killed process" | tail
```

OOM 순간의 프로그램별 메모리 합계(MB, 프로세스 수):

```bash
sudo journalctl -k -b -1 | awk '/invoked oom-killer/{n++} n>=1 && $5=="kernel:" && $6=="[" && $7 ~ /^[0-9]+\]$/ {rss[n,$18]+=$11; cnt[n,$18]++} END{for(k in rss){split(k,a,SUBSEP); printf "%d %6.0f MB %-18s %3d\n", a[1], rss[k]*4/1024, a[2], cnt[k]}}' | sort -k1,1n -k2,2nr
```

5. 원인 해소 후 앱을 켜고(`pm2 start server.js --name market-through` 또는 `pm2 restart market-through`), 안정되면 마지막에 `sudo systemctl start nginx`를 실행한다.

## 6. 장애 기록

### 2026-10-03~04: 504 및 서버 정지

- 증상: 웹서비스 504, SSH 명령이 매우 느리다가 거의 멈춤. I/O 대기 90% 이상, 다수 프로세스 D 상태.
- 확인된 사실: 스왑이 없었고(RAM 약 1GB), 직전 부팅 기록에 OOM killer가 4번 발생. 각 시점에 chrome 프로세스 25~28개(약 600~670MB 합계, 공유 메모리 중복 포함)가 떠 있었고 Node는 약 79MB. 디스크 용량·오류는 정상(21% 사용).
- 추정: `chrome_crashpad`가 10개였던 점으로 보아 Chrome이 약 5개 동시에 실행 중이었던 것으로 보인다(Chrome 1회 실행당 crashpad 2개라는 가정, 확정 아님).
- 코드 원인(확인됨): TE 프록시에서 Chrome 슬롯이 가득 차면 최대 90초 대기 후 한도를 무시하고 Chrome을 추가로 실행했고, Chrome을 닫기 전에 슬롯을 먼저 반납했다. 화면은 TE 차트를 동시에 요청했고(`force=true`), 504 시 같은 요청을 재시도했다.
- 조치: 스왑 2GB 추가, `MAX_BROWSERS` 1로 축소, 한도 초과 시 실패 처리(대기 45초), 종료 후 슬롯 반납과 프로세스 강제 종료, 화면에서 TE 요청을 한 번에 1개씩 대기열 처리, FRED Python 동시 2개 제한, FRED 사용 시각의 디스크 저장을 최대 5분 간격으로 변경, pm2-logrotate 설정.
- 영향 없음으로 확인: Python(OOM 표에 없음), 디스크 용량·오류, 외부 SSH 공격(실패한 로그인 기록 3건).

## 7. 후속 과제 (Future work)

- TE 스크래핑 시 Chrome을 요청마다 새로 띄우지 않고 1개를 재사용(요청마다 탭만 생성, 일정 시간 미사용 시 종료)하는 방식 검토. 메모리 사용과 실행 시간을 측정한 뒤 결정한다.
- 서버 메모리 여유(`free -m`의 available, Swap 사용량)를 일정 기간 관찰해 Chrome 동시 수를 늘릴 수 있는지 판단한다.

개발 테스트 실행 파일은 `dev/tests/`, 테스트 결과물은 `dev/output/`에 둔다. 운영 로그는 이 폴더들과 분리해 프로젝트 바로 아래 `logs/`에만 기록한다. 기존 로그 파일은 사용자가 수동 정리하며 배포 코드에서 이동·삭제하지 않는다.

설정 파일명은 자동 저장 `user_settings_autosaved.json`, 수동 저장 `user_settings_manualsaved_YYYYMMDD_HHMMSS_mmm.json`으로 통일한다. 자동 저장은 기존처럼 단일 최신 파일을 덮어쓰며 시각별 파일을 새로 만들지 않는다. 서버 시작 시 기존 `autosaved_user_settings.json` 및 `manualsaved_user_settings_…json`/`autosaved_user_settings_…json`을 새 이름으로 바꾼다. 같은 새 이름의 파일이 이미 있으면 덮어쓰지 않고 양쪽을 유지한다. 구형 파일명과 `full_backup_…json`도 백업 목록·읽기·복원에서 지원한다. 현재 자동 저장 파일은 백업 삭제 대상에서 제외한다. 파일명 변경은 설정 내용이나 수정 시각을 변경하지 않는다.

## 8. HTTPS 및 무료 인증서 자동 갱신

2026-10-20 대화 내용을 반영했다. 서버 설정을 변경하거나 인증서를 새로 발급한 작업은 아니다. 요구사항과 검증 작업은 [인증·접근 명세](../../specs/008-google-account-access/spec.md#https-운영-확인-기록) 및 [작업 목록](../../specs/008-google-account-access/tasks.md#https-운영-확인-2026-10-20-반영)을 따른다.

### 확인된 상태

- 2026-10-19 외부 점검에서 운영 HTTPS 인증서 신뢰 검증과 HTTP 200 응답, HTTP → HTTPS 301 이동을 확인했다.
- 무료 Let's Encrypt 인증서이며 발급 기관은 `YR2`다. 당시 만료 시각은 한국 시간 2027-01-14 11:20:13이었다. 갱신으로 바뀔 수 있으므로 현재 만료일은 다시 조회한다.
- 사용자 제공 서버 출력에서 `certbot.timer`가 `certbot.service`를 실행하도록 예약되어 있었다. 최근 실행은 2026-10-19 04:00:28 UTC, 당시 다음 실행은 2026-10-19 21:20:28 UTC였다. 한국 시간은 각각 10월 19일 13:00:28, 10월 20일 06:20:28이다.
- 타이머 출력은 예약 증거다. 실제 서비스 성공 여부, 모의 갱신 성공 및 갱신 후 Nginx 적용까지 확인한 것은 아니다.

### 서버 점검

```bash
sudo certbot certificates
systemctl list-timers --all | grep -i certbot
sudo systemctl status certbot.timer --no-pager
sudo journalctl -u certbot.service --since '7 days ago' --no-pager
sudo certbot renew --dry-run
```

NEXT와 실제 설치된 유닛 이름을 확인한다. snap 설치일 경우 해당 타이머·서비스 이름으로 조회한다. 모의 갱신에서 모든 대상 인증서의 성공 문구를 확인하고, 실패하면 오류 원인을 해소한 뒤 다시 점검한다. 갱신 대상이 없어 종료한 서비스는 실제 갱신에 성공한 것과 구분한다.

자동 갱신 후 웹서버 적용은 Nginx installer 또는 deploy hook 등 실제 갱신 설정과 실행 로그로 확인한다. 이번 대화에는 해당 설정이나 모의 갱신 결과가 제공되지 않았다. 상세 판정 기준은 [수동 검증 절차](../../specs/008-google-account-access/quickstart.md#https-및-인증서-갱신-점검)를 참고한다. 개인키와 계정 자격 증명은 출력·공유하거나 저장소에 추가하지 않는다.

## 9. 수급 차트와 독립창 변경 적용

2026-10-21 최종 정책. 배포·서버 재시작·사용자 PC 설치는 사용자가 수행한다. 아래는 적용 절차이며 이번 문서 갱신에서 실행한 작업이 아니다.

- 서버 코드(server.js, supply-service.js, supply-store.js, rank-independent.js)는 배포 후 Node 프로세스를 재시작해야 반영된다. 기존 프로세스에서 브라우저만 새로고침하면 서버 코드는 바뀌지 않는다.
- public의 HTML·JS·CSS는 배포 후 메인 페이지 새로고침과 독립창 재실행으로 반영한다. 배포 파일과 참조 캐시 버전이 함께 반영되었는지 확인한다.
- desktop/IndependentWindow.cs의 창 크기·복구 동작 또는 허용 origin 변경은 새 설치 파일 빌드와 사용자 PC 덮어 설치가 필요하다. 제거 후 재설치는 필요 없다.
- 로컬 desktop/build.ps1 -Publish는 desktop/dist/MarketThroughSetup.exe를 만들고 public/downloads/MarketThroughSetup.exe에 복사한다. 원격 서버 배포나 PC 설치를 수행하는 명령이 아니다.

### 저장 용량과 백업

서버에서 다음 명령으로 파일시스템 여유 공간과 수급 파일 사용량을 확인한다.

```bash
df -h /
du -sh data/supply
```

헤더의 남은공간/전체공간은 서버 파일시스템 기준이며 RAM이나 별도 DB 할당량이 아니다. 가용 블록 기준으로 계산하고 페이지 조회 및 약 5분 간격으로 갱신한다. 과거에 사용자가 제시한 45G 전체·35G 여유 출력은 당시 상태이며 현재 용량으로 간주하지 않는다.

수집기는 단일 프로세스(PM2 instance 1개)로 실행한다. data/supply 전체를 백업 대상으로 포함한다. 일봉은 영구 저장하지 않고, 분봉은 당일 JSON에서 장 종료 후 날짜별 gzip으로 전환한다. 압축 검증 후에만 원본을 제거하며 오래된 압축 파일을 자동 삭제하지 않는다. 용량 정리 목적으로 이 폴더를 임의 삭제하면 분봉 이력은 API로 복구할 수 없다.

### 값이 없거나 갱신되지 않을 때

API의 실제 0, 누락 필드·빈 목록, 수집 시각이 오래된 값, 재시작하지 않은 구 프로세스를 구분한다. ka10060이 현재 거래일을 제공하는지와 각 주체의 관측 시각, 프로그램 원천 시각을 확인한다. 하루 중 한 번 갱신된 사실만으로 매분 원천이 갱신된다고 단정하지 않는다. 각 주체는 마지막 유효 관측값을 표시하므로 캔들의 마지막 시각과 수치 기준 시각이 다를 수 있다.

최종 원천은 개인·외국인·기관 ka10060, 프로그램 분봉 ka90008·일봉 ka90013이다. ka10063과 개인 고정 0 방식은 취소했다. 조회 결과와 테스트 범위는 [수급 차트](../SUPPLY_CHART.md), 설치·다중 모니터 수동 확인은 [독립창 안내](../../desktop/README.md)를 따른다.

### 수급 개장 게이트 적용 (2026-10-21)

평일 한국 시간 08:00~10:30(10:30분 포함)에 서버 전체에서 분당 최대 한 번 ka10080으로 삼성전자 통합시장 005930_AL의 1분봉을 확인한다. 현재 시각 이하의 오늘 날짜 체결시각과 양수 거래량이 있는 봉이 한 개라도 있으면 개장 확정 후 같은 수집 주기에 최대 5종목 수급 저장을 시작한다. 개장 미확인·0거래량·전일 봉·조회 오류는 수급 저장 없이 다음 분에 재확인한다. 10:30까지 미확인이면 그날 확인과 수집을 중단한다. 수능일 지연 개장도 같은 방식으로 처리한다. 개장 확정 후에는 확인 API를 중단하고 VI·서킷브레이커로 거래가 멈춰도 20:01까지 수급 수집을 유지한다. 20:02 이후 압축 정책은 유지한다. 확인 전 수급은 소급 생성하지 않는다.

market-day.json도 data/supply 백업에 포함한다. 당일 확정 파일이 있으면 10:30 이후 재시작해도 수집을 이어간다. 파일이 없거나 날짜가 다르면 10:30 이후에는 새 개장 확인을 하지 않으므로 당일 수집이 시작되지 않는다. 적용에는 사용자 서버 재시작이 필요하며 독립창 앱 재설치는 필요 없다.
