const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {viRealtime,alertsRealtime,stockFuturesCollect,viAlertsStartupLines}=require('../../vi-alerts-host');
// 2026-11-10: VI 모니터는 로컬 PC에서만(장중 시험), 장운영 알림은 오라클에서만. 오라클 .env의 VI_ALERTS_REALTIME=on은 경보에만 쓴다.
test('VI runs on the local Windows PC, market alerts on Oracle (Linux)',()=>{
    assert.equal(viRealtime({},'win32'),true);assert.equal(viRealtime({},'linux'),false);
    assert.equal(viRealtime({VI_ALERTS_REALTIME:'on'},'linux'),false,'Oracle .env VI_ALERTS_REALTIME=on no longer turns the VI on');
    assert.equal(viRealtime({VI_REALTIME:'on'},'linux'),true);assert.equal(viRealtime({VI_REALTIME:'off'},'win32'),false);
    assert.equal(alertsRealtime({},'win32'),false);assert.equal(alertsRealtime({},'linux'),true);
    assert.equal(alertsRealtime({VI_ALERTS_REALTIME:'on'},'linux'),true);assert.equal(alertsRealtime({MARKET_ALERTS_REALTIME:'off',VI_ALERTS_REALTIME:'on'},'linux'),false);
    assert.equal(alertsRealtime({VI_MONITOR_REALTIME:'false',MARKET_ALERT_REALTIME:'false'},'linux'),true,'the old settings are not read');
    assert.deepEqual(viAlertsStartupLines({VI_ALERTS_REALTIME:'on'},'linux'),['[VI 모니터] 이 서버에서 수신 안 함 (기본값: VI는 로컬 PC에서만 · 여기는 오라클)','[장운영 알림] 이 서버에서 수신함 (VI_ALERTS_REALTIME=on)','[종목 선물 수급] 이 서버에서 1분 수집 함 (기본값: 오라클에서만 · 여기는 오라클)']);
    assert.deepEqual(viAlertsStartupLines({},'win32'),['[VI 모니터] 이 서버에서 수신함 (기본값: VI는 로컬 PC에서만 · 여기는 로컬 PC)','[장운영 알림] 이 서버에서 수신 안 함 (기본값: 오라클에서만 · 여기는 로컬 PC)','[종목 선물 수급] 이 서버에서 1분 수집 안 함 (기본값: 오라클에서만 · 여기는 로컬 PC)']);
});
// 2026-11-12: 종목 선물 수급 1분 수집(LS t8463)은 오라클에서만. 같은 LS 앱키로 두 서버가 부르면 부하가 두 배다.
test('stock futures flow is collected on Oracle only',()=>{
    assert.equal(stockFuturesCollect({},'linux'),true);assert.equal(stockFuturesCollect({},'win32'),false);
    assert.equal(stockFuturesCollect({STOCK_FUTURES_COLLECT:'on'},'win32'),true);assert.equal(stockFuturesCollect({STOCK_FUTURES_COLLECT:'off'},'linux'),false);
    assert.ok(fs.readFileSync('server.js','utf8').includes('collects: () => stockFuturesCollect()'),'server.js passes the switch');
});
test('server.js wires the VI and the alerts to their own switch',()=>{
    const server=fs.readFileSync('server.js','utf8');
    assert.match(server,/enabled: alertsRealtime\n?\r?\n?\}\);/);assert.match(server,/enabled: viRealtime,/);
    assert.match(server,/if \(alertsRealtime\(\)\) marketAlertService\.start\(\);/);assert.match(server,/if \(viRealtime\(\)\) \{ viMonitorService\.start\(\); lsFuturesEvents\.start\(\); \}/);
    assert.doesNotMatch(server,/process\.env\.(VI_MONITOR_REALTIME|MARKET_ALERT_REALTIME)/);
});
