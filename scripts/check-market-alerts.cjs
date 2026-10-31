// Read-only quote subscription diagnostic. No orders, credentials in output or state-file writes.
'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { createMarketAlerts } = require('../market-alert-service');
const seconds = Number(process.argv.find(arg => arg.startsWith('--seconds='))?.split('=')[1] || 20);
if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300) {
    console.error('Usage: node scripts/check-market-alerts.cjs --seconds=20 (5..300)'); process.exitCode = 2;
} else if (!process.env.LS_APPKEY?.trim() || !process.env.LS_SECRETKEY?.trim()) {
    console.error('LS_APPKEY / LS_SECRETKEY 설정이 필요합니다.'); process.exitCode = 2;
} else {
    const service = createMarketAlerts({
        getToken: async () => {
            const response = await require('axios').post('https://openapi.ls-sec.co.kr:8080/oauth2/token', new URLSearchParams({
                grant_type: 'client_credentials', appkey: process.env.LS_APPKEY.trim(), appsecretkey: process.env.LS_SECRETKEY.trim(), scope: 'oob'
            }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 });
            if (!response.data?.access_token) throw new Error('인증 실패');
            return response.data.access_token;
        }
    });
    let done = false;
    function finish() {
        if (done) return; done = true;
        const result = service.diagnostics(); service.stop();
        console.log(JSON.stringify({ observedSeconds: seconds, ...result }, null, 2));
        if (result.connection !== 'JIF 구독 중') process.exitCode = 1;
    }
    service.start(); setTimeout(finish, seconds * 1000);
    process.once('SIGINT', finish); process.once('SIGTERM', finish);
}
