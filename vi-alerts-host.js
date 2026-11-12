'use strict';
// 어느 서버가 VI 모니터와 장운영 알림(사이드카 · 서킷, LS JIF)을 받을지 정한다.
// - VI 모니터(키움 VI · NH 현재가): 2026-11-10부터 로컬 PC에서만 켠다(장중 시험 때문). 기본값: Windows(로컬) 켬, 그 밖(오라클) 끔.
//   VI_REALTIME=on/off로 바꿀 수 있다. 오라클 .env의 VI_ALERTS_REALTIME=on은 VI에 쓰지 않는다.
// - 장운영 알림: 2026-11-09부터 오라클에서만 켠다. 기본값: Windows 끔, 그 밖 켬. MARKET_ALERTS_REALTIME=on/off,
//   없으면 예전 이름 VI_ALERTS_REALTIME(오라클 .env에 on으로 있음)을 읽는다.
// 예전 설정 VI_MONITOR_REALTIME · MARKET_ALERT_REALTIME은 읽지 않는다.
const flag = value => { const v = String(value || '').trim().toLowerCase(); return v === 'on' ? true : v === 'off' ? false : null; };
function viRealtime(env = process.env, platform = process.platform) {
    return flag(env.VI_REALTIME) ?? platform === 'win32';
}
function alertsRealtime(env = process.env, platform = process.platform) {
    return flag(env.MARKET_ALERTS_REALTIME) ?? flag(env.VI_ALERTS_REALTIME) ?? platform !== 'win32';
}
// - 종목 선물 수급 수집(LS t8463, 1분마다): 2026-11-12부터 오라클에서만 한다. 같은 LS 앱키로 두 서버가 같은 종목을 부르면
//   LS 부하가 두 배라서다(11/11 오라클 912회 중 485회 실패). 기본값: Windows 끔, 그 밖 켬. STOCK_FUTURES_COLLECT=on/off.
//   수집하지 않는 서버도 화면 조회는 그대로 된다(저장 파일이 없거나 오래됐으면 그 자리에서 t8463 조회).
function stockFuturesCollect(env = process.env, platform = process.platform) {
    return flag(env.STOCK_FUTURES_COLLECT) ?? platform !== 'win32';
}
// 서버 시작 때 server_debug에 남기는 줄.
function viAlertsStartupLines(env = process.env, platform = process.platform) {
    const where = platform === 'win32' ? '로컬 PC' : '오라클';
    const lines = [
        `[VI 모니터] 이 서버에서 ${viRealtime(env, platform) ? '수신함' : '수신 안 함'} (${flag(env.VI_REALTIME) == null ? '기본값: VI는 로컬 PC에서만 · 여기는 ' + where : 'VI_REALTIME=' + String(env.VI_REALTIME).trim()})`,
        `[장운영 알림] 이 서버에서 ${alertsRealtime(env, platform) ? '수신함' : '수신 안 함'} (${flag(env.MARKET_ALERTS_REALTIME) != null ? 'MARKET_ALERTS_REALTIME=' + String(env.MARKET_ALERTS_REALTIME).trim() : flag(env.VI_ALERTS_REALTIME) != null ? 'VI_ALERTS_REALTIME=' + String(env.VI_ALERTS_REALTIME).trim() : '기본값: 오라클에서만 · 여기는 ' + where})`
    ];
    lines.push(`[종목 선물 수급] 이 서버에서 1분 수집 ${stockFuturesCollect(env, platform) ? '함' : '안 함'} (${flag(env.STOCK_FUTURES_COLLECT) == null ? '기본값: 오라클에서만 · 여기는 ' + where : 'STOCK_FUTURES_COLLECT=' + String(env.STOCK_FUTURES_COLLECT).trim()})`);
    if (['VI_MONITOR_REALTIME', 'MARKET_ALERT_REALTIME'].some(name => env[name] != null))
        lines.push('[VI · 장운영 알림] 예전 설정 VI_MONITOR_REALTIME · MARKET_ALERT_REALTIME은 더 쓰지 않음');
    return lines;
}
// 예전 이름: 2026-11-09 코드와 테스트 호환.
const viAlertsRealtime = alertsRealtime;
module.exports = { viRealtime, alertsRealtime, viAlertsRealtime, stockFuturesCollect, viAlertsStartupLines };
