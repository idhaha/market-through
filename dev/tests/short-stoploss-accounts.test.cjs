'use strict';
// 대주 StopLoss 여러 계좌(2026-11-21): 보유 잔고 행마다 자기 계좌 앱키로 조회 · 주문하는지 확인한다.
//  - 두 계좌(기본 3699-5772-11, 추가 5641-0328-10: 끝자리 28 계좌, 실제 ka00001 형식)에 같은 종목 · 같은 대출일 대주가 있어도 행 · 감시 건이 섞이지 않는다.
//  - 28 계좌 행의 감시가 발동하면 28 계좌 토큰으로만 kt10006이 나가고 기본 계좌에는 주문이 없다(반대도 같음).
//  - 실시간도 계좌별: 기본 계좌는 VI 공용 연결(그룹 3 · 4), 28 계좌는 28 앱키 자기 연결(그룹 1 · 2)로 0B와 자기 계좌 00을 받는다.
//    28 계좌는 자기 연결의 0B로 바로 발동하고 접수 · 체결을 00으로 확인한다(조회에는 체결이 안 보이게 해서 00만으로 확인되는지 본다).
//    기본 계좌 연결의 00은 28 계좌에 오지 않는다(주문번호가 겹쳐도 오판하지 않음).
//  - 화면: 계좌 끝자리 표시, 계좌 고르기(보기만), 28 행을 골라 조건 추가 → 28 계좌로 등록.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const express = require('express'), { chromium } = require('playwright');
const { createShortStopLoss } = require('../../short-stoploss-service');
const { createShortStopLossAccounts } = require('../../short-stoploss-accounts');

function fakeKiwoom(token, acctNo, pur) {
    const k = { token, price: 7000, orders: [], book: new Map(), seq: 500, calls: [] };
    k.http = { post: async (url, body, { headers }) => {
        const api = headers['api-id'], r = data => ({ status: 200, data: { return_code: 0, ...data } });
        assert.equal(headers.authorization, 'Bearer ' + token, api + ' 호출이 다른 계좌 토큰으로 나감');
        k.calls.push(api);
        if (api === 'ka00001') return r({ acctNo });
        if (api === 'kt00018') return r({ acnt_evlt_remn_indv_tot: [{ stk_cd: 'A004980', stk_nm: '/성신양회', crd_tp: '05', crd_tp_nm: '대주', crd_loan_dt: '20261124', rmnd_qty: '1', trde_able_qty: '1', pur_pric: String(pur), cur_prc: String(k.price), evltv_prft: '0', prft_rt: '0' }] });
        if (api === 'ka10085') return r({ acnt_prft_rt: [{ stk_cd: '004980', loan_dt: '20261124', expr_dt: '20270222' }] });
        if (api === 'ka10001') return r({ cur_prc: '+' + k.price, trde_qty: '100', upl_pric: '+8900', base_pric: '6850' });
        if (api === 'ka10004') return r({ sel_fpr_bid: '+' + (k.price + 10) });
        if (api === 'kt10006') { const o = String(++k.seq).padStart(7, '0'); k.orders.push(body); if (!k.noFillQuery) k.book.set(o, +body.ord_uv); k.onOrder?.(o, body); return r({ ord_no: o }); }
        if (api === 'ka10075') return r({ oso: [] });
        if (api === 'kt00009') return r({ acnt_ord_cntr_prst_array: [...k.book].map(([o, p]) => ({ ord_no: o, cntr_qty: '1', cntr_uv: String(p - 10), io_tp_nm: '대주매수상환', crd_deal_tp: '유통대주매수상환' })) });
        return r({});
    } };
    return k;
}

(async () => {
    const clock = { t: Date.parse('2026-11-23T10:00:00+09:00') };
    let on = false;
    // 웹소켓 흉내(계좌마다 하나): 등록한 그룹을 기억하고, 받은 실시간을 그 연결을 듣는 쪽에만 돌린다
    const fakeRt = state => { const r = { groups: {}, listeners: new Set() }; Object.assign(r, { set: (g, items, types) => { r.groups[g] = { items, types }; }, onReal: fn => r.listeners.add(fn), connected: () => true, state: () => state, status: () => ({}), push: d => { for (const fn of r.listeners) fn(d); } }); return r; };
    const mainRt = fakeRt('VI 실시간 수신 중'), rt28 = fakeRt('실시간 수신 중');
    const main = fakeKiwoom('T-main', '3699577211', 6960), k28 = fakeKiwoom('T-28', '5641032810', 6920);
    main.seq = 600; // 기본 계좌 주문번호는 0000601부터(아래에서 기본 계좌 연결에 28 계좌 주문번호 0000501의 남의 00을 보낸다)
    const make = (k, dir, realtime, rtGroups) => createShortStopLoss({ directory: fs.mkdtempSync(path.join(os.tmpdir(), dir)), http: k.http, getToken: async () => k.token, enabled: () => on,
        openDate: () => null, now: () => clock.t, log: () => {}, wait: async ms => { clock.t += ms; }, realtime, rtGroups });
    const svcMain = make(main, 'ss-acc-main-', mainRt), svc28 = make(k28, 'ss-acc-28-', rt28, { quote: '1', account: '2' });
    const all = createShortStopLossAccounts([{ id: 'main', svc: svcMain }, { id: '28', svc: svc28 }]);
    const app = express(); app.use(express.json());
    app.get('/api/trading-session/calendar', (req, res) => res.json({ days: {} }));
    all.mount(app, { allowed: () => true });
    app.use(express.static(path.join(__dirname, '..', '..', 'public')));
    const server = app.listen(0); const port = server.address().port;
    const browser = await chromium.launch({ headless: true, channel: 'msedge' }); const page = await browser.newPage({ viewport: { width: 1300, height: 760 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    try {
        // 1) 합친 상태: 같은 종목 · 대출일이 계좌별로 다른 행
        const st = await all.state();
        assert.deepEqual(st.lots.map(l => [l.key, l.account, l.sellPrice]), [['main|004980:20261124', '3699-5772-11', 6960], ['28|004980:20261124', '5641-0328-10', 6920]]);
        assert.deepEqual(st.accounts.map(a => [a.id, a.account, a.realtime.state]), [['main', '3699-5772-11', 'VI 실시간 수신 중'], ['28', '5641-0328-10', '실시간 수신 중']]);
        assert.deepEqual(st.realtime, { connected: true, state: '3699-5772-11 VI 실시간 수신 중 · 5641-0328-10 실시간 수신 중' });

        // 2) 화면: 계좌 끝자리 표시, 계좌 고르기
        await page.goto(`http://127.0.0.1:${port}/short-stoploss.html`);
        await page.waitForFunction(() => document.querySelectorAll('#lotsTable tbody tr.pick').length === 2);
        assert.deepEqual(await page.$$eval('#lotsTable .acct-tag', t => t.map(x => x.textContent)), ['5772', '0328']);
        // 회귀(2026-11-23): 계좌 뒤 4자리는 종목 코드 옆이 아니라 대출일 칸 아래 줄에 보인다
        assert.deepEqual(await page.$$eval('#lotsTable .acct-tag', t => t.map(x => [x.parentElement.cellIndex, getComputedStyle(x).display, x.getBoundingClientRect().top > x.parentElement.firstChild.parentElement.getBoundingClientRect().top + 8])), [[0, 'block', true], [0, 'block', true]]);
        assert.equal(await page.locator('#lotsTable .code .acct-tag').count(), 0);
        // 실시간 연결은 마우스를 올리지 않아도 계좌별로 따로 보인다
        assert.deepEqual(await page.$$eval('#rtStates .ss-pill', p => p.map(x => [x.textContent, x.className])), [['5772 실시간 연결', 'ss-pill on'], ['0328 실시간 연결', 'ss-pill on']]);
        rt28.connected = () => false; await page.waitForFunction(() => document.querySelectorAll('#rtStates .ss-pill')[1]?.textContent === '0328 실시간 끊김');
        assert.equal(await page.$eval('#rtStates .ss-pill', x => x.className), 'ss-pill on', '한 계좌가 끊겨도 다른 계좌 표시는 그대로');
        rt28.connected = () => true;
        assert.deepEqual(await page.$$eval('#acct option', o => o.map(x => x.textContent)), ['전체 계좌', '3699-5772-11', '5641-0328-10']);
        await page.selectOption('#acct', '28');
        await page.waitForFunction(() => document.querySelectorAll('#lotsTable tbody tr.pick').length === 1);
        assert.equal(await page.textContent('#lotsTable .acct-tag'), '0328');
        // 28 계좌 행을 골라 조건 추가 → 28 계좌 서비스에만 등록
        await page.locator('#lotsTable tbody tr.pick').first().click();
        // 계좌는 대출일 아래 따로(2026-11-23), 대출일 줄에는 계좌가 붙지 않는다
        assert.equal(await page.textContent('#fAcct'), '5641-0328-10'); assert.doesNotMatch(await page.textContent('#fLot'), /계좌/);
        await page.fill('#trigger', '7300');
        await page.click('#addBtn');
        await page.waitForSelector('#watchTable tbody .st');
        assert.equal(svc28._state().watches.length, 1); assert.equal(svcMain._state().watches.length, 0);
        // 다시 열어도 고른 계좌 유지, 전체 계좌로 돌리면 둘 다
        await page.reload(); await page.waitForFunction(() => document.querySelectorAll('#lotsTable tbody tr.pick').length === 1);
        assert.equal(await page.inputValue('#acct'), '28');
        await page.selectOption('#acct', ''); await page.waitForFunction(() => document.querySelectorAll('#lotsTable tbody tr.pick').length === 2);
        // 기본 계좌에도 감시 건(API로)
        const wMain = await (await fetch(`http://127.0.0.1:${port}/api/short-stoploss/watches`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lotKey: 'main|004980:20261124', trigger: 7500, ticks: 10, chasePct: 10, qtyMode: 'pct', qtyValue: 100 }) })).json();
        assert.match(wMain.id, /^main\|/); assert.equal(wMain.account, '3699-5772-11');
        await page.waitForFunction(() => document.querySelectorAll('#watchTable tbody .st').length === 2);

        // 3) 실시간 등록: 기본 계좌는 VI 공용 연결 그룹 3(0B) · 4(00 · 04), 28 계좌는 자기 연결 그룹 1(0B) · 2(00 · 04)
        on = true; await svcMain.step(); await svc28.step();
        assert.deepEqual(rt28.groups, { 1: { items: ['004980', '004980_NX'], types: ['0B'] }, 2: { items: [''], types: ['00', '04'] } });
        assert.deepEqual(Object.keys(mainRt.groups).sort(), ['3', '4']); assert.deepEqual(mainRt.groups['4'].types, ['00', '04']);
        // 28 계좌 주문은 체결 조회에 보이지 않게 하고, 28 연결로만 접수 · 체결(00)을 보낸다
        k28.noFillQuery = true;
        // 00이 주문 응답보다 먼저 오는 경우(실제로도 생김): 응답을 돌려주기 전에 보낸다
        k28.onOrder = o => (() => {
            rt28.push({ type: '00', item: '004980', values: { 9203: o, 913: '접수', 905: '+상환대주', 922: '77', 900: '1', 902: '1' } });
            rt28.push({ type: '00', item: '004980', values: { 9203: o, 913: '체결', 905: '+상환대주', 922: '77', 900: '1', 902: '0', 911: '1', 910: '7340' } });
        })();
        // 기본 계좌 연결에 같은 주문번호(0000501)의 일반 매수 00이 와도 28 계좌는 모른다(받았다면 확인 장치가 대주상환 아님으로 멈춤)
        mainRt.push({ type: '00', item: '005930', values: { 9203: '0000501', 913: '접수', 905: '+매수', 922: '00', 900: '1', 902: '1' } });

        // 4) 7,350 체결: 28 계좌 감시가(7,300)만 넘음 → 28 토큰으로만 주문
        main.price = k28.price = 7350;
        mainRt.push({ type: '0B', item: '004980', values: { 10: '+7350' } }); rt28.push({ type: '0B', item: '004980', values: { 10: '+7350' } });
        for (let i = 0; i < 100 && svc28._state().watches[0].status !== '체결완료'; i++) await new Promise(r => setTimeout(r, 10));
        assert.equal(svc28._state().watches[0].status, '체결완료', svc28._state().watches[0].log.map(l => l.kind + ' ' + l.text).join(' / '));
        assert.equal(k28.orders.length, 1); assert.equal(k28.orders[0].crd_deal_tp, '77'); assert.equal(k28.orders[0].crd_loan_dt, '20261124');
        assert.equal(main.orders.length, 0, '기본 계좌로는 주문이 나가지 않음');
        const log28 = svc28._state().watches[0].log.map(l => l.kind + ' ' + l.text).join(' / ');
        assert.match(log28, /실시간 판정/); assert.match(log28, /접수 확인 · 실시간/); assert.match(log28, /1\/1주 체결 · 7,340 · 실시간/);
        assert.equal(svc28.snapshot().halted, false);
        assert.equal(svcMain._state().watches[0].status, '감시중');


        // 6) 7,600: 기본 계좌 감시가(7,500) → 기본 계좌 토큰으로만 주문
        main.price = 7600; mainRt.push({ type: '0B', item: '004980', values: { 10: '+7600' } });
        for (let i = 0; i < 100 && svcMain._state().watches[0].status !== '체결완료'; i++) await new Promise(r => setTimeout(r, 10));
        assert.equal(main.orders.length, 1); assert.equal(k28.orders.length, 1);

        // 7) 화면: 기록 창은 그 계좌 건, 전체 감시는 보고 있는 계좌에만
        await page.waitForFunction(() => [...document.querySelectorAll('#watchTable tbody .st')].every(s => s.textContent === '체결완료'), null, { timeout: 5000 });
        await page.locator('#watchTable tbody button', { hasText: '기록' }).nth(1).click();
        await page.waitForSelector('#logModal:not([hidden])'); assert.match(await page.textContent('#logList'), /상환대주/); await page.click('#logModal [data-close]');
        assert.deepEqual(errors, []);
        console.log('short-stoploss-accounts: 모든 확인 통과');
    } finally { await browser.close(); server.close(); svcMain.stop(); svc28.stop(); }
})().catch(error => { console.error(error); process.exit(1); });
