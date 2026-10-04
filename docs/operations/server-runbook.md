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

현재 설정 값(확인됨): 파일당 10MB, 5개 보관, 압축, 매일 자정 순환.

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 5
pm2 set pm2-logrotate:compress true
pm2 conf pm2-logrotate        # 설정 확인
```

참고: pm2-logrotate 모듈 자체가 메모리를 사용하며 관측값이 30.7MB → 47.7MB → 56.5MB → 70.7MB로 올라갔다(2026-10-04, 재부팅·앱 재시작 직후 포함). 앱(Node 약 55~100MB)보다 커질 수 있으므로 계속 증가하면(예: 100MB 이상) 모듈을 제거하고 서버 기본 logrotate로 대체하는 것을 검토한다.

### 3.3 재부팅 후 자동 시작 (등록 및 재부팅 동작 확인 완료)

```bash
pm2 startup        # 출력되는 sudo ... 명령을 복사해 그대로 실행
pm2 save
systemctl is-enabled pm2-ubuntu   # enabled 이면 등록된 것
```

메모리 이상 증가 시 PM2가 앱을 자동 재시작하도록 `--max-memory-restart 350M`을 적용했다(`pm2 restart market-through --max-memory-restart 350M` 후 `pm2 save`). Node 정상 사용량은 약 55~100MB이다.

## 4. 배포 절차

배포는 서버에서 배포 스크립트(`update-market.sh`)로 수행한다. 스크립트가 하는 일: nginx 확인, `git fetch` + `git reset --hard origin/br_oracle`, `npm ci`, `pm2 reload`(없으면 `pm2 start`), `pm2 save`, 상태 출력.

주의:
- `git reset --hard`는 서버에서 직접 수정한 코드를 지운다. 서버에서 코드를 고치지 않는다.
- 런타임 데이터 파일(`autosaved_user_settings.json`, `authorized_emails.json`, `user_settings.memo-backup.json`, `data/fred-cache/`, `.env`)은 Git에서 추적되지 않는다(2026-10-04 `git ls-files`로 확인). 새 데이터 파일이 생기면 `.gitignore` 제외 여부를 먼저 확인한다.
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
