// 거래소가 정규장을 늦게 여는 날. KST 날짜('YYYY-MM-DD')별로 개장 · 마감을 몇 분 늦추는지 적는다.
// 2026-11-19 오라클: LS 업종지수 1분봉 첫 행이 10:00이라 시장 누적 거래대금이 "09:00 시작이 아님"으로 모두 비었다
// (쏠림율 분봉 누적 · LS 거래대금 분봉이 그 날만 안 그려짐).
//
// 갱신 방법
//  - 수능일: 매년 한국거래소 공지(보통 10~11월 초)를 보고 설정 창(⚙)의 "수능일" 칸에 입력한다(관리자). 입력은
//    data/trading-session/calendar.json의 openDelays에 저장되고 배포 없이 바로 적용된다. 아래 코드 표는 기본값으로 남긴다
//    (코드 표와 calendar.json에 같은 날이 있으면 calendar.json이 이긴다).
//    10/20부터 그해 '수능' 줄이 생길 때까지(최대 12/31) 메인 화면 맨 위 바에 "수능일 미등록"을 띄우고 서버 로그에도 하루 한 번 남긴다
//    (examReminder). 날짜가 아니라 reason으로 찾으므로 수능이 12월인 해(2020-12-03)나 11월의 다른 지연일과 섞이지 않는다.
//  - 새해 첫 거래일: 표에 적지 않는다. 휴장일 달력(trading-session.js, 한투 CTCA0903R)에서 그해 처음 장이 열리는 날을
//    찾아 10:00 개장(마감은 평소대로)으로 본다. 1월 1일부터 그 전날까지 평일 중 달력에 없는 날이 있으면 판단하지 않는다(0).
//  - 표에 없는 지연일: 그날 업종지수 첫 분봉이 늦은 시각으로 들어오면 서버 로그에 경고한다(broker-turnover-data.js).
const OPEN_DELAY = {
    '2026-11-19': { open: 60, close: 60, reason: '수능' } // 2027학년도 수능(한국거래소 2026-11-05 공지: 정규장 10:00~16:30, 주식 파생 09:45~16:45, NXT 프리마켓 없음)
};
const NEW_YEAR = { open: 60, close: 0 }; // 새해 첫 거래일: 10:00 개장, 15:30 마감
const weekend = day => [0, 6].includes(new Date(day + 'T00:00:00Z').getUTCDay());
const nextDay = day => new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
// 휴장일 달력이 그해 첫 거래일이라고 확인해 줄 때만 true.
function firstTradingDay(day, openDate = require('./trading-session').current()?.openDate) {
    if (!openDate || weekend(day) || openDate(day) !== true) return false;
    for (let d = day.slice(0, 4) + '-01-01'; d < day; d = nextDay(d)) {
        if (weekend(d)) continue;
        if (openDate(d) !== false) return false; // 장이 열렸거나(true) 달력에 없음(null)
    }
    return true;
}
// 코드 표 + 설정 창에서 입력한 표(calendar.json openDelays).
function table(policy = require('./trading-session').current()) {
    return { ...OPEN_DELAY, ...(policy?.openDelays?.() || {}) };
}
function delays(day, openDate) {
    return table()[day] || (firstTradingDay(day, openDate) ? NEW_YEAR : null);
}
const openDelay = (day, openDate) => delays(day, openDate)?.open || 0;
const closeDelay = (day, openDate) => delays(day, openDate)?.close || 0;
// 'HHMMSS'를 분 단위로 민다.
function shiftClock(clock, minutes) {
    if (!minutes) return clock;
    const total = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(2, 4)) + minutes;
    return String(Math.floor(total / 60)).padStart(2, '0') + String(total % 60).padStart(2, '0') + clock.slice(4, 6);
}
// 10/20~12/31에 그해 reason '수능' 줄이 표에 없으면 알림 문구, 아니면 null.
function examReminder(today, rows = table()) {
    const year = today.slice(0, 4), md = today.slice(5);
    if (md < '10-20' || Object.entries(rows).some(([d, v]) => d.startsWith(year + '-') && v?.reason === '수능')) return null;
    return `${year}년 수능일이 등록되지 않았습니다. 한국거래소의 수능일 개장 시각 공지를 확인해 설정(⚙)의 올해 수능일 칸에 입력하세요. 빠뜨리면 그날 쏠림율 누적 · LS 거래대금 분봉이 그려지지 않습니다.`;
}
module.exports = { OPEN_DELAY, table, openDelay, closeDelay, firstTradingDay, shiftClock, examReminder };
