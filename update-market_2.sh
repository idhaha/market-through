#!/bin/bash
# 에러 발생 시 즉시 중단
set -e

echo "=========================================="
echo "🚀 배포 시작"
echo Nginx: HTTPS 및 리버스 프록시, 부팅 시 자동 실행
echo PM2: Node.js 애플리케이션 관리 및 부팅 시 자동 실행
echo update-market.sh: 코드 배포, 의존성 설치, 애플리케이션 갱신, 서비스 상태 확인
echo "=========================================="

echo "🔧 1. Nginx 상태 확인..."

sudo nginx -t

sudo systemctl enable nginx

if ! systemctl is-active --quiet nginx; then
    sudo systemctl start nginx
fi

if ! systemctl is-active --quiet nginx; then
    echo "❌ Nginx 실행 실패"
    exit 1
fi

echo "✅ Nginx 정상 실행"

echo "=========================================="
echo "📥 2. 최신 코드 동기화"
echo "=========================================="

cd ~/market-through
OLD_LOCK=$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1)

git fetch origin br_oracle --tags
git reset --hard origin/br_oracle

echo "🔎 최신 정보 확인:"
git log -1 --oneline
echo "🏷️ 현재 태그: $(git describe --tags --always)"

echo "=========================================="
echo "📦 3. 의존성 설치"
echo "=========================================="

NEW_LOCK=$(sha256sum package-lock.json 2>/dev/null | cut -d' ' -f1)
if [ "$OLD_LOCK" != "$NEW_LOCK" ] || [ ! -d node_modules ]; then
    npm ci
else
    echo "의존성 변경 없음: npm ci 건너뜀"
fi

echo "=========================================="
echo "🔄 4. PM2 프로세스 업데이트"
echo "=========================================="

pm2 reload market-through --update-env || \
    pm2 start server.js --name market-through --max-memory-restart 350M

pm2 save

echo "=========================================="
echo "🔍 5. 최종 상태 확인"
echo "=========================================="

sudo systemctl is-active nginx
pm2 status

echo "=========================================="
echo "✅ 배포 및 서버 갱신 완료!"
echo "=========================================="