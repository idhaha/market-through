'use strict';
// VI 창 가상 화면 (2026-11-14 선물 가격제한 정책): 실제 vi-monitor-service.js · futures-limit-watch.js · VI 창(public)에
// 가상의 LS 메시지(JD0 · JC0 · JX0 · JIF)와 시세를 넣어 화면을 만든다. 증권사에는 접속하지 않는다.
// 사용: node dev/vi-futures-limit-demo.cjs            → outputs/vi-futures-limit-demo/에 화면 그림 2장
//       node dev/vi-futures-limit-demo.cjs --serve    → 그림을 만든 뒤 주소를 출력하고 창을 열어 둔다(Ctrl+C로 끝).
// 화면 시각은 2026-11-16(월) 13:30으로 고정한다(브라우저 시계도 같은 시각으로 맞춤). 두 번째 그림은 15:46(장 마감 뒤).
// 시간 단축: 해제 뒤 첫 체결 대기(실제 1분)는 0.6초. 그 밖의 시각 판정(5분 · 5분 30초 · 15:45)은 실제 값 그대로다.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const express = require('express'), { chromium } = require('playwright');
const { createViMonitor } = require('../vi-monitor-service');
const { createViWindowAccess } = require('../vi-monitor-routes');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'outputs', 'vi-futures-limit-demo');
const at = s => Date.parse('2026-11-16T' + s + '+09:00');
const hhmmss = t => new Date(t + 9 * 3600000).toISOString().slice(11, 19).replaceAll(':', '');
// 가상 종목: 기초주식, 감시 월물(전일 거래량이 많은 월물), 기준가.
const STOCKS = [
    { code: '005930', name: '삼성전자', market: '1', fut: 'A116C000', next: 'A1171000', ref: 100000 },
    { code: '000660', name: 'SK하이닉스', market: '1', fut: 'A126C000', next: 'A1271000', ref: 500000 },
    { code: '373220', name: 'LG에너지솔루션', market: '1', fut: 'A3F6C000', next: 'A3F71000', ref: 400000 },
    { code: '005380', name: '현대차', market: '1', fut: 'A1G6C000', next: 'A1G71000', ref: 250000 },
    { code: '035720', name: '카카오', market: '1', fut: 'A1J6C000', next: 'A1J71000', ref: 40000 },
    { code: '068270', name: '셀트리온', market: '1', fut: 'A1K71000', next: 'A1K6C000', ref: 200000 },
    { code: '247540', name: '에코프로비엠', market: '2', fut: 'A2E6C000', next: 'A2E71000', ref: 150000 }
];
const byFut = new Map(STOCKS.flatMap(s => [[s.fut, s], [s.next, s]]));
const month = code => code.slice(4, 5) === 'C' ? '202612' : '202701';
function lsHttp() {
    return { post: async (url, body, { headers }) => {
        const tr = headers.tr_cd, i = body[tr + 'InBlock'] || {}, ok = d => ({ data: { rsp_cd: '00000', ...d } });
        if (tr === 't8436') return ok({ t8436OutBlock: STOCKS.map(s => ({ shcode: s.code, hname: s.name, gubun: s.market })) });
        if (tr === 't8401') return ok({ t8401OutBlock: STOCKS.flatMap(s => [s.fut, s.next].map(c => ({ basecode: 'A' + s.code, shcode: c, hname: `${s.name} F ${month(c)}` }))) });
        if (tr === 't8402') { const s = byFut.get(i.focode); return ok({ t8402OutBlock: { price: String(s.ref), recprice: String(s.ref), volume: '1200', mulcnt: '10', lastmonth: month(i.focode) === '202612' ? '20261210' : '20270114', uplmtprice: String(s.ref * 1.1), dnlmtprice: String(s.ref * 0.9) } }); }
        if (tr === 't8404') { const s = byFut.get(i.focode); return ok({ t8404OutBlock1: [{ chetime: i.etime || '133000', price: s.ref, chdegree: '88.40' }] }); }
        if (tr === 't8405') { const s = byFut.get(i.shcode); return ok({ t8405OutBlock1: [{ date: '20261113', volume: i.shcode === s.fut ? 50000 : 900 }] }); }
        if (tr === 't8403') return ok({ t8403OutBlock: Object.fromEntries(Array.from({ length: 10 }, (_, k) => [['bidho' + (k + 1), byFut.get(i.shcode).ref * (1 - k * 0.001)], ['bidrem' + (k + 1), 20 + k]]).flat()) });
        return ok({});
    } };
}
class NoSocket { constructor() { this.readyState = 0; } on() {} send() {} close() {} terminate() {} }
async function main() {
    const serve = process.argv.includes('--serve');
    const keepAlive = setInterval(() => {}, 1000); // the service's timers are unref'd
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-demo-'));
    const clock = { t: at('13:30:00') };
    const quoteFeed = { start() {}, stop() {}, watch() {}, unwatch() {}, nxtSupported: () => true, snapshot() {}, state: () => ({ wanted: 6, subscribed: 6, rest: 0 }) };
    const strengths = { '005930:KRX': 104.31, '000660:NXT': 96.12 };
    const m = createViMonitor({ directory, now: () => clock.t, policy: () => ({ openDate: () => true, spotAt: () => true }), http: lsHttp(), getToken: async () => 'demo', kiwoomToken: async () => 'demo',
        WebSocket: NoSocket, quoteFeed, restGapMs: 1, futuresWaitMs: 600, strength: async ({ exchange, code }) => ({ value: strengths[code + ':' + exchange] ?? 100 }),
        futuresEventsState: () => '등록 JIF 1 · JX0 282 · JD0 282 · JC0 3 (가상)' });
    m.start();
    const ev = (tr, futcode, body, t) => m.onFuturesEvent({ tr, futcode, body: { futcode, ...body }, receivedAt: t });
    const q = (exchange, key, price, t, extra = {}) => m.onQuote({ exchange, key, price, via: 'WS', receivedAt: t, ...extra });
    const settle = () => new Promise(r => setTimeout(r, 150));
    await m.baseContracts();
    for (const s of STOCKS) for (const c of [s.fut, s.next]) await ev('JD0', c, { dy_gubun: '2', dy_uplmtprice: String(s.ref * 1.1), dy_dnlmtprice: String(s.ref * 0.9) }, at('08:30:00'));
    const near = (s, t, side = 'up') => ev('JD0', s.fut, { dy_gubun: '1', dy_uplmtprice: String(side === 'up' ? s.ref * 1.1 : s.ref * 0.92), dy_dnlmtprice: String(side === 'up' ? s.ref * 1.08 : s.ref * 0.9) }, t);
    const spot = (s, pct, t) => { q('KRX', s.code, Math.round(s.ref * (1 + pct / 100)), t, { rate: pct, amount: 150000 }); q('NXT', s.code, Math.round(s.ref * (1 + pct / 100) * 1.002), t, { rate: pct, amount: 9000 }); };
    const [sam, hynix, lges, hyundai, kakao, cell, eco] = STOCKS;
    // 1) 현물 VI: 삼성전자 KRX VI 13:29:10 (체결강도 104.31). SK하이닉스 NXT VI, KRX 마지막 체결 3분 전(1% 판정 제외).
    clock.t = at('13:29:10'); m.receive({ trnm: 'REAL', data: [{ type: '1h', item: '005930', values: { '1223': '132910', '1224': '000000', '9068': '2', '9069': '1', '9008': '001' } }] });
    spot(sam, 6.2, at('13:29:11')); q('FUT', sam.fut, 107000, at('13:29:40'));
    clock.t = at('13:28:30'); m.receive({ trnm: 'REAL', data: [{ type: '1h', item: '000660_NX', values: { '1223': '132830', '1224': '000000', '9068': '1', '9069': '1', '9008': '001' } }] });
    q('KRX', hynix.code, 520000, at('13:26:20'), { rate: 4, amount: 300000 }); q('NXT', hynix.code, 527000, at('13:29:50'), { rate: 5.4, amount: 21000 });
    // 2) 선물 +10% 도달 13:29:00 (5분 카운트다운 중): JD0 근처 → JC0 체결가 = 상한가.
    clock.t = at('13:29:00'); await near(sam, clock.t); await ev('JC0', sam.fut, { price: String(sam.ref * 1.1), chetime: '132900', cpower: '131.20' }, clock.t); await settle();
    // 3) 해제 대기: SK하이닉스 선물 +10% 도달 13:22:30, 5분이 지났는데 JX0을 아직 받지 못함.
    clock.t = at('13:22:30'); await near(hynix, clock.t); await ev('JC0', hynix.fut, { price: String(hynix.ref * 1.1), chetime: '132230', cpower: '142.75' }, clock.t); await settle();
    // 4) 가격제한폭 先확대: LG에너지솔루션 +10% 도달 13:02:00 → 코스피 CB 13:04:10 → 재개 13:24:10 → JX0 13:24:12 → 첫 체결.
    clock.t = at('13:02:00'); spot(lges, 9.6, clock.t); await near(lges, clock.t); await ev('JC0', lges.fut, { price: String(lges.ref * 1.1), chetime: '130200', cpower: '155.03' }, clock.t); await settle();
    await ev('JIF', '', { jangubun: '1', jstatus: '61' }, at('13:04:10')); await ev('JIF', '', { jangubun: '1', jstatus: '62' }, at('13:24:10'));
    clock.t = at('13:24:12'); await ev('JX0', lges.fut, { upstep: '02', dnstep: '01', uplmtprice: String(lges.ref * 1.2), dnlmtprice: String(lges.ref * 0.9) }, clock.t); await settle();
    spot(lges, 11.8, at('13:24:15')); await ev('JC0', lges.fut, { price: String(lges.ref * 1.13), chetime: '132416' }, at('13:24:16')); await settle();
    // 5) 놓친 도달(역산): 현대차 JX0만 받음 13:26:40 → 발동 ≈13:21:40, 바로 해제(첫 체결).
    spot(hyundai, 9.1, at('13:26:00'));
    clock.t = at('13:26:40'); await ev('JX0', hyundai.fut, { upstep: '02', dnstep: '01', uplmtprice: String(hyundai.ref * 1.2), dnlmtprice: String(hyundai.ref * 0.9) }, clock.t); await settle();
    await ev('JC0', hyundai.fut, { price: String(hyundai.ref * 1.115), chetime: '132645' }, at('13:26:45')); await settle();
    // 6) -10% 도달 12:50:00 → JX0 12:55:00, 1분 안에 체결 없음 → 체결 없음.
    clock.t = at('12:50:00'); spot(kakao, -9.4, clock.t); await near(kakao, clock.t, 'down'); await ev('JC0', kakao.fut, { price: String(kakao.ref * 0.9), chetime: '125000', cpower: '61.48' }, clock.t); await settle();
    clock.t = at('12:55:00'); await ev('JX0', kakao.fut, { upstep: '01', dnstep: '02', uplmtprice: String(kakao.ref * 1.1), dnlmtprice: String(kakao.ref * 0.8) }, clock.t); await settle();
    // 7) 셀트리온: 감시 월물이 1월물(전일 거래량이 더 많음). +10% 도달 12:40 → JX0 12:45:01 → +20% 도달 13:27:00(카운트다운 중).
    clock.t = at('12:40:00'); spot(cell, 9.7, clock.t); await near(cell, clock.t); await ev('JC0', cell.fut, { price: String(cell.ref * 1.1), chetime: '124000', cpower: '120.11' }, clock.t); await settle();
    clock.t = at('12:45:01'); await ev('JX0', cell.fut, { upstep: '02', dnstep: '01', uplmtprice: String(cell.ref * 1.2), dnlmtprice: String(cell.ref * 0.9) }, clock.t); await settle();
    await ev('JC0', cell.fut, { price: String(cell.ref * 1.12), chetime: '124503' }, at('12:45:03')); await settle();
    spot(cell, 18.6, at('13:27:00')); clock.t = at('13:27:00'); await ev('JC0', cell.fut, { price: String(cell.ref * 1.2), chetime: '132700', cpower: '170.55' }, clock.t); await settle();
    // 화면 시각 13:30:00. 가격: 삼성전자 현물 +6.2%, 선물 +10% → 괴리율.
    clock.t = at('13:30:00'); spot(sam, 6.2, at('13:29:58')); q('FUT', cell.next, 230000, at('13:29:59'));
    // 카카오: 확대 뒤 첫 체결을 기다리는 시간(실제 1분, 여기서는 0.6초)이 지나 '체결 없음'으로 고정되도록 기다린다.
    await new Promise(r => setTimeout(r, 700));
    const app = express(); createViWindowAccess({ session: () => null }).mount(app, m); app.use(express.static(path.join(root, 'public')));
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const url = `http://127.0.0.1:${server.address().port}/vi-monitor.html`;
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const page = await browser.newPage({ viewport: { width: 1760, height: 560 } });
    await page.clock.install({ time: clock.t }); await page.addInitScript(() => { try { localStorage.setItem('viGapOnly', 'false'); } catch {} });
    await page.goto(url); await page.waitForSelector('#viBody td.name'); await page.clock.runFor(1000); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, '1-장중-1330.png'), fullPage: true, animations: 'disabled' });
    // 마우스 오버 예: 先확대 행의 구분 칸.
    const tips = await page.evaluate(() => [...document.querySelectorAll('#viBody tr')].map(tr => ({ name: tr.cells[2]?.textContent, kind: tr.cells[8]?.textContent, kindTitle: tr.cells[8]?.title, start: tr.cells[9]?.textContent, cp: tr.cells[4]?.textContent, krxTitle: tr.cells[12]?.title, fut: tr.cells[14]?.textContent })));
    fs.writeFileSync(path.join(out, 'tooltips.json'), JSON.stringify(tips, null, 1));
    // 15:46: 장 마감 뒤 해제 신호 없음.
    clock.t = at('15:46:00'); m.tick(); await settle();
    await page.clock.setFixedTime(clock.t); await page.reload(); await page.waitForSelector('#viBody td.name'); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, '2-장마감-1546.png'), fullPage: true, animations: 'disabled' });
    console.log('그림: ' + out);
    if (serve) { console.log('가상 화면 주소: ' + url + ' (브라우저 시계는 실제 시각이라 카운트다운은 맞지 않을 수 있음, Ctrl+C로 끝)'); await browser.close(); return; }
    clearInterval(keepAlive); await browser.close(); server.close(); m.stop(); process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
