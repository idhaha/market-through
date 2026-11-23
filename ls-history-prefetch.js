'use strict';
// 지난 분봉 미리 받기(2026-11-23). 과거 분봉 구간 보기에서 서버에 아직 없는 날을 화면이 처음 열면 서버가 그때 LS · 한투에서 받느라
// 요청 하나에 3~9초씩 걸렸다(오라클 측정: 쏠림율 LS 9.5초, 시장 거래대금 6.8초, 종목 선물 가격 4.6초). 매일 밤 최근 60거래일
// (분봉 구간 한도와 같음)을 미리 받아 저장해 둔다. 이미 저장된 날은 각 서비스가 저장분을 읽고 증권사를 부르지 않는다.
//   · LS 1분 거래대금: 시장(KOSPI · KOSDAQ)과 관심 종목 → ls-turnover (시장 거래대금 카드 · 쏠림율 LS의 분자 · 분모)
//   · 종목 선물 1분 가격: 관심 종목 → ls-stock-futures (한투 FHKIF03020200)
// 관심 종목은 종목 수급 카드에 등록한 종목이다. 증권사 호출은 천천히(LS 거래대금은 그 서비스의 1.1초 간격, 종목 선물은 1초 쉼).
// AI나 다른 스케줄러 없이 서버 안 타이머로 돈다(정기 수집이 켜진 서버, 오라클에서만 시작).
function createLsHistoryPrefetch({ turnover, futuresCandles, stocks, openDate = () => null, now = () => Date.now(), log = () => {},
    days = 60, hour = 20, minute = 20, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const kstDay = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
    // 어제부터 거슬러 올라가며 장이 열린 날(주말 · 달력에 휴장으로 적힌 날 제외) count개. 오늘은 장중 자료라 넣지 않는다.
    function pastOpenDays(count = days) {
        const out = [];
        for (let t = Date.parse(kstDay(now()) + 'T00:00:00Z') - 86400000, i = 0; out.length < count && i < 400; t -= 86400000, i++) {
            const date = new Date(t).toISOString().slice(0, 10), weekday = new Date(t).getUTCDay();
            if (weekday === 0 || weekday === 6 || openDate(date) === false) continue;
            out.push(date);
        }
        return out;
    }
    let running = null, timer = null;
    function run() {
        if (running) return running;
        running = (async () => {
            const started = now(), list = pastOpenDays();
            const codes = [...new Set((stocks() || []).map(String).filter(code => /^\d{6}$/.test(code)))];
            const noFutures = new Set();
            let checks = 0, failures = 0;
            for (const date of list) {
                const compact = date.replaceAll('-', '');
                for (const instrument of ['kospi', 'kosdaq', ...codes]) {
                    checks++;
                    try { const result = await turnover(instrument, 'minute', [compact]); if (result?.warnings?.length) failures++; }
                    catch { failures++; }
                }
                for (const code of codes) {
                    if (noFutures.has(code)) continue;
                    checks++;
                    const before = now();
                    try { await futuresCandles({ code, mode: 'minute', date }); }
                    catch (error) { if (error?.status === 404) noFutures.add(code); else failures++; }
                    if (now() - before > 200) await pause(1000); // 증권사까지 간 조회만 쉰다(저장분은 바로 읽힌다)
                }
            }
            log(`[미리 받기] ${list.at(-1) || '-'} ~ ${list[0] || '-'} ${list.length}거래일 · 관심 종목 ${codes.length}개(선물 없음 ${noFutures.size}) · ${checks}번 확인 · 실패 ${failures} · ${Math.round((now() - started) / 1000)}초`);
            return { days: list.length, codes: codes.length, checks, failures };
        })().finally(() => { running = null; });
        return running;
    }
    // 다음 hour:minute(한국 시각)까지 남은 ms.
    function msUntilNext() {
        const k = new Date(now() + 9 * 3600000);
        let next = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), hour, minute) - 9 * 3600000;
        if (next <= now()) next += 86400000;
        return next - now();
    }
    function start() {
        if (timer) return;
        const schedule = () => {
            timer = setTimeout(() => { void run().catch(error => log(`[미리 받기] 실패: ${error.message}`)).finally(schedule); }, msUntilNext());
            timer.unref?.();
        };
        schedule();
    }
    function stop() { clearTimeout(timer); timer = null; }
    return { run, start, stop, pastOpenDays, msUntilNext };
}
module.exports = { createLsHistoryPrefetch };
