'use strict';
// 대주 StopLoss 창(2026-11-19) 브라우저 확인: 가짜 키움 응답 + 실제 서비스 · 화면 파일.
// 잔고 표시 → 행 선택 → 조건 추가 → 감시 체크 끄기/켜기 → 발동 · 체결 → 기록 창, 드롭다운 순서, 달력 자동 조정, 정책 i.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const express = require('express'), { chromium } = require('playwright');
const { createShortStopLoss } = require('../../short-stoploss-service');
const { createShortStopLossAccounts } = require('../../short-stoploss-accounts');

(async () => {
    const k = { upl: 30000, lst: 1000, price: 7000, orders: [], book: new Map(), seq: 500 };
    const http = { post: async (url, body, { headers }) => {
        const api = headers['api-id'], r = data => ({ status: 200, data: { return_code: 0, ...data } });
        if (api === 'ka00001') return r({ acctNo: '3699577211' });
        if (api === 'kt00018') return r({ acnt_evlt_remn_indv_tot: [{ stk_cd: 'A004980', stk_nm: '/성신양회', crd_tp: '05', crd_tp_nm: '대주', crd_loan_dt: '20261123', rmnd_qty: '1', trde_able_qty: '1', pur_pric: '7030', cur_prc: String(k.price), evltv_prft: String(7030 - k.price), prft_rt: '0.4' },
            { stk_cd: 'A003280', stk_nm: '/흥아해운', crd_tp: '05', crd_tp_nm: '대주', crd_loan_dt: '20261123', rmnd_qty: '1', trde_able_qty: '1', pur_pric: '1560', cur_prc: '1559', evltv_prft: '1', prft_rt: '0.06' },
            ...(k.many ? Array.from({ length: 20 }, (_, i) => ({ stk_cd: 'A003280', stk_nm: '/흥아해운', crd_tp: '05', crd_tp_nm: '대주', crd_loan_dt: String(20261001 + i), rmnd_qty: '1', trde_able_qty: '1', pur_pric: '1560', cur_prc: '1559', evltv_prft: '1', prft_rt: '0.06' })) : [])] });
        if (api === 'ka10085') return r({ acnt_prft_rt: [{ stk_cd: '004980', loan_dt: '20261123', expr_dt: '20270222' }, { stk_cd: '003280', loan_dt: '20261123', expr_dt: '20270222' }] });
        if (api === 'ka10001') return body.stk_cd === '003280_NX' ? r({ cur_prc: '', base_pric: '' }) : r({ cur_prc: '+' + k.price, trde_qty: '100', upl_pric: '+' + (k.upl || 8900), lst_pric: k.lst ? '+' + k.lst : '', base_pric: '6850' });
        if (api === 'ka10004') return r({ sel_fpr_bid: '+' + (k.price + 10) });
        if (api === 'kt10006') { const o = String(++k.seq).padStart(7, '0'); k.orders.push(body); k.book.set(o, +body.ord_uv); return r({ ord_no: o }); }
        if (api === 'ka10075') return r({ oso: [] });
        if (api === 'kt00009') return r({ acnt_ord_cntr_prst_array: [...k.book].map(([o, p]) => ({ ord_no: o, cntr_qty: '1', cntr_uv: String(p - 10), io_tp_nm: '대주매수상환', crd_deal_tp: '유통대주매수상환' })) });
        return r({});
    } };
    const clock = { t: Date.parse('2026-11-20T10:00:00+09:00') };
    let on = false;
    const svc = createShortStopLoss({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'ss-browser-')), http, getToken: async () => 't', enabled: () => on,
        openDate: d => d !== '2026-12-25', now: () => clock.t, log: () => {}, wait: async ms => { clock.t += ms; } });
    const app = express(); app.use(express.json());
    const seenTokens = new Set(); app.use((req, res, next) => { if (req.headers['x-ss-token']) seenTokens.add(req.headers['x-ss-token']); next(); });
    // 독립창 앱의 여는 토큰 → 창 토큰 바꾸기(실제 규칙은 short-stoploss-window.test.cjs): 한 번만 바꿔 준다
    const usedLaunch = new Set();
    app.post('/api/short-stoploss/window-exchange', (req, res) => { const l = req.headers['x-ss-launch']; if (usedLaunch.has(l)) return res.status(401).json({ error: '이미 쓴 연결입니다. 메인 화면에서 대주StopLoss 버튼을 다시 누르세요.' }); usedLaunch.add(l); res.json({ token: 'S' + l.slice(0, 8) }); });
    app.get('/api/trading-session/calendar', (req, res) => res.json({ days: { '2026-12-25': false } }));
    // 서버와 같이 계좌 묶음으로 붙인다(계좌 하나, 2026-11-21)
    createShortStopLossAccounts([{ id: 'main', svc }]).mount(app, { allowed: () => true });
    app.use(express.static(path.join(__dirname, '..', '..', 'public')));
    const server = app.listen(0); const port = server.address().port;
    const browser = await chromium.launch({ headless: true, channel: 'msedge' }); const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    try {
        await page.goto(`http://127.0.0.1:${port}/short-stoploss.html`);
        await page.waitForSelector('#lotsTable tbody tr.pick');
        assert.equal(await page.locator('#lotsTable tbody tr.pick').count(), 2);
        assert.equal(await page.textContent('#acct'), '3699-5772-11', '계좌 문구에 앱키 등록 없음 · 상품코드까지');
        assert.ok((await page.$$eval('.acct-tag', t => t.map(x => x.textContent))).every(x => x === '5772'), '계좌가 하나여도 계좌 끝자리 표시(2026-11-23)');
        assert.equal(await page.locator('#lotsTable tbody tr').nth(1).locator('.pill.none').count(), 1, '흥아해운 NXT 비대상 표시');
        assert.deepEqual(await page.$$eval('#ticks option', o => [o[0].textContent, o.at(-1).textContent]), ['+10틱', '+1틱']);
        assert.deepEqual(await page.$$eval('#qtyPct option', o => [o[0].textContent, o.at(-1).textContent]), ['100%', '10%']);
        assert.deepEqual(await page.$$eval('#chasePct option', o => [o[0].textContent, o.at(-1).textContent]), ['10%', '1%']);
        assert.equal(await page.inputValue('#ticks'), '10');
        // 회귀(2026-11-21): 유효기간은 잔고 행을 고르기 전에도 비어 있지 않고 기본 1개월(서버 날짜 기준, 휴장일 → 직전 거래일)
        await page.waitForFunction(() => document.querySelector('#until').value === '2026-12-18');
        // 왼쪽 두 칸(대주 잔고 · 감시 목록)의 합 = 오른쪽 청산 조건 설정 높이, 두 칸은 같은 높이, 표는 칸 안에서 세로 스크롤
        const g = await page.evaluate(() => { const [a, b] = [...document.querySelectorAll('.ss-left .card.half')].map(e => e.getBoundingClientRect()); const f = document.querySelector('.ss-form').getBoundingClientRect();
            return { a: a.height, b: b.height, top: a.top - f.top, bottom: b.bottom - f.bottom, scroll: getComputedStyle(document.querySelector('.card.half .tbl-wrap')).overflowY }; });
        assert.ok(Math.abs(g.a - g.b) <= 1 && Math.abs(g.top) <= 1 && Math.abs(g.bottom) <= 1 && g.scroll === 'auto', JSON.stringify(g));
        // 행 선택 → 조건 추가
        await page.locator('#lotsTable tbody tr.pick').first().click();
        assert.equal(await page.inputValue('#until'), '2026-12-18', '기본 1개월(12-20 일요일 → 12-18)');
        // 회귀(2026-11-23): 계좌는 대출일 아래 따로, 빈 감시가의 회색 글자는 "현재 7,000"(입력값처럼 보이지 않게)
        assert.equal(await page.textContent('#fAcct'), '3699-5772-11');
        assert.equal(await page.getAttribute('#trigger', 'placeholder'), '현재 7,000');
        // 감시가 기본값: 현재가 7,000 바로 위 한 호가(업틱) 7,010이 들어가 있어 고치지 않고 바로 조건 추가 가능, 직접 고치기 전까지는 현재가를 따라간다
        assert.equal(await page.inputValue('#trigger'), '7,010'); assert.equal(await page.isDisabled('#addBtn'), false); assert.match(await page.textContent('#chaseNote'), /7,710원/);
        k.price = 7020; await page.click('#refreshBtn'); await page.waitForFunction(() => document.querySelector('#trigger').value === '7,030');
        await page.click('#trigUp'); assert.equal(await page.inputValue('#trigger'), '7,040');
        k.price = 7000; await page.click('#refreshBtn'); await page.waitForTimeout(2500); assert.equal(await page.inputValue('#trigger'), '7,040', '화살표로 고친 뒤에는 따라가지 않음');
        await page.fill('#trigger', ''); assert.equal(await page.isDisabled('#addBtn'), true);
        // 회귀(2026-11-23): 전각 숫자로 쳐도 감시가로 읽어 조건 추가가 켜지고 추격 한도 금액이 나온다(예전: 0으로 읽혀 꺼짐 · "-원")
        await page.locator('#trigger').focus(); await page.keyboard.insertText('７３００');
        assert.equal(await page.isDisabled('#addBtn'), false); assert.match(await page.textContent('#chaseNote'), /8,030원/);
        await page.locator('#ticks').focus(); assert.equal(await page.inputValue('#trigger'), '7,300', '칸을 떠나면 보통 숫자로 바꿈');
        // 한 호가씩: 빈 칸이면 현재가 기준(↑ 7,010 · ↓ 7,000), 가격대 경계에서 단위가 바뀐다, 호가 단위에 안 맞는 값은 맞는 호가로
        const step = async (v, how) => { await page.fill('#trigger', v); if (how === 'up' || how === 'down') await page.click(how === 'up' ? '#trigUp' : '#trigDown'); else { await page.locator('#trigger').focus(); await page.keyboard.press(how); } return page.inputValue('#trigger'); };
        assert.deepEqual([await step('', 'up'), await step('', 'down'), await step('', 'ArrowUp')], ['7,010', '7,000', '7,010']);
        assert.deepEqual([await step('2,000', 'down'), await step('1,999', 'up'), await step('2,000', 'ArrowUp'), await step('5,000', 'ArrowDown'), await step('20,000', 'down'), await step('7,003', 'up'), await step('7,003', 'down')],
            ['1,999', '2,000', '2,005', '4,995', '19,990', '7,010', '7,000']);
        // 회귀(2026-11-23): 그날 하한가(시험 1,000) · 상한가(시험 30,000)에 닿으면 그 방향 화살표는 더 눌리지 않고, 범위 밖 값은 조건 추가를 끈다
        assert.equal(await step('1,001', 'down'), '1,000'); assert.equal(await page.isDisabled('#trigDown'), true, '하한가 아래는 없음'); assert.equal(await page.isDisabled('#trigUp'), false);
        await page.keyboard.press('ArrowDown'); assert.equal(await page.inputValue('#trigger'), '1,000');
        assert.equal(await step('29,950', 'up'), '30,000'); assert.equal(await page.isDisabled('#trigUp'), true, '상한가 위는 없음');
        await page.keyboard.press('ArrowUp'); assert.equal(await page.inputValue('#trigger'), '30,000');
        await page.fill('#trigger', '31,000'); assert.equal(await page.isDisabled('#addBtn'), true); assert.match(await page.textContent('#chaseNote'), /상한가 30,000보다 높습니다/);
        assert.equal(await step('31,000', 'down'), '30,000', '범위 밖에서 누르면 가까운 끝으로');
        await page.fill('#trigger', '900'); assert.equal(await page.isDisabled('#addBtn'), true); assert.match(await page.textContent('#chaseNote'), /하한가 1,000보다 낮습니다/);
        await page.fill('#trigger', '28,000'); assert.equal(await page.textContent('#chaseNote'), '30,000원(상한가)', '추격 한도도 상한가를 넘지 않음'); assert.equal(await page.isDisabled('#addBtn'), false);
        // 회귀(2026-11-23): 계좌가 하나뿐이어도 표의 대출일 아래 줄에 계좌 뒤 4자리를 보인다
        assert.deepEqual((await page.$$eval('#lotsTable .acct-tag', t => t.map(x => [x.textContent, x.parentElement.cellIndex, getComputedStyle(x).display]))).filter((v, i, a) => i === 0 || JSON.stringify(v) !== JSON.stringify(a[0])), [['5772', 0, 'block']]);
        await page.fill('#trigger', '7300');
        assert.match(await page.textContent('#chaseNote'), /8,030/);
        // 회귀(2026-11-23): 주 수는 보유수량(1주)보다 많이 넣을 수 없다 — 조건 추가가 꺼지고 이유가 보이며, 서버도 거부한다
        await page.check('input[name="qtyMode"][value="shares"]'); await page.fill('#qtyShares', '2');
        assert.equal(await page.isDisabled('#addBtn'), true); assert.equal(await page.textContent('#qtyNote'), '보유수량 1주보다 많습니다'); assert.equal(await page.isVisible('#qtyNote'), true);
        const over = await page.evaluate(async () => { const st = await (await fetch('/api/short-stoploss/state')).json(); const r = await fetch('/api/short-stoploss/watches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lotKey: st.lots[0].key, trigger: 7300, ticks: 10, chasePct: 10, qtyMode: 'shares', qtyValue: 2 }) }); return [r.status, (await r.json()).error]; });
        assert.deepEqual(over, [400, '보유수량(1주)보다 많이 설정할 수 없습니다']);
        await page.fill('#qtyShares', '1'); assert.equal(await page.isDisabled('#addBtn'), false); assert.equal(await page.isVisible('#qtyNote'), false);
        await page.check('input[name="qtyMode"][value="pct"]');
        // 달력: 아이콘을 눌러야 뜨고, 휴장일을 고르면 직전 거래일
        assert.equal(await page.isHidden('#cal'), true);
        await page.click('#calBtn'); assert.equal(await page.isVisible('#cal'), true);
        await page.click('#cal .hd button[aria-label="다음 달"]').catch(() => {});
        await page.fill('#until', '2026-12-25'); await page.dispatchEvent('#until', 'change');
        assert.equal(await page.inputValue('#until'), '2026-12-24');
        await page.fill('#until', ''); await page.dispatchEvent('#until', 'change');
        assert.equal(await page.inputValue('#until'), '2026-12-18', '칸을 비우면 기본 1개월로 돌아감');
        // 직접 고른 날짜는 2초마다 오는 상태 갱신에 덮어쓰이지 않는다
        await page.fill('#until', '2026-12-24'); await page.dispatchEvent('#until', 'change'); await page.locator('#trigger').focus(); await page.waitForTimeout(2600);
        assert.equal(await page.inputValue('#until'), '2026-12-24', '직접 고른 날짜 유지');
        await page.fill('#until', '2027-05-01'); await page.dispatchEvent('#until', 'change');
        assert.equal(await page.inputValue('#until'), '2027-02-22', '만기일 이후 → 만기일');
        page.on('dialog', d => d.dismiss());
        // 회귀(2026-11-19): 날짜를 고친 직후 조건 추가를 누르면 안내 줄이 나타나 버튼을 밀어 클릭이 빗나갔다.
        await page.click('#addBtn');
        await page.waitForSelector('#watchTable tbody .st');
        assert.equal(await page.textContent('#watchTable tbody .st'), '감시중');
        // 회귀(2026-11-23): 수량 칸은 설정(주 · %)과 상관없이 주 수 먼저, %는 괄호. 값은 설정한 그대로(주 설정은 그 주 수, % 설정은 가능수량 × % 내림 · 최소 1주)
        assert.equal(await page.textContent('#watchTable tbody tr td:nth-child(5)'), '1주 (100%)');
        const q = (w, able) => page.evaluate(([w, able]) => { const st = { lotKey: 'x', ...w }; const lots = able == null ? [] : [{ key: 'x', able, qty: Math.max(able, 10) }]; return window.__ssQtyTextWith(st, lots); }, [w, able]);
        assert.deepEqual([await q({ qtyMode: 'pct', qtyValue: 30 }, 10), await q({ qtyMode: 'pct', qtyValue: 10 }, 5), await q({ qtyMode: 'shares', qtyValue: 3 }, 10), await q({ qtyMode: 'shares', qtyValue: 10 }, 10),
            await q({ qtyMode: 'pct', qtyValue: 50 }, null), await q({ qtyMode: 'shares', qtyValue: 4 }, null), await q({ qtyMode: 'pct', qtyValue: 50, orders: [{ qty: 7 }] }, 0), await q({ qtyMode: 'pct', qtyValue: 100 }, 0),
            await q({ qtyMode: 'pct', qtyValue: 100, status: '체결완료', orders: [{ qty: 2, filled: 2 }] }, null), await q({ qtyMode: 'shares', qtyValue: 3, status: '체결완료', orders: [{ qty: 2, filled: 2 }, { qty: 1, filled: 1 }] }, null),
            await q({ qtyMode: 'shares', qtyValue: 3, status: '체결완료', orders: [{ qty: 3, filled: 3, able: 10 }] }, null), await q({ qtyMode: 'shares', qtyValue: 3, status: '주문접수', orders: [{ qty: 3, filled: 0 }] }, 9)],
            ['3주 (30%)', '1주 (10%)', '3주 (30%)', '10주 (100%)', '- (50%)', '4주', '7주 (50%)', '0주 (100%)', '2주 (100%)', '3주 (100%)', '3주 (30%)', '3주 (30%)']);
        // 상태 칸 등 말줄임 칸은 마우스를 올리면 전체 문구(title), 종목 코드는 이름 아래 줄
        assert.equal(await page.getAttribute('#watchTable tbody tr td:nth-child(2)', 'title'), '감시중');
        const nm = await page.evaluate(() => { const n = document.querySelector('#watchTable tbody .namecell .name').getBoundingClientRect(), c = document.querySelector('#watchTable tbody .namecell .code').getBoundingClientRect(); return c.top >= n.bottom - 1; });
        assert.equal(nm, true, '코드가 이름 아래 줄');
        // 열 경계를 끌어 폭 조절 → 다시 열어도 유지 → 두 번 누르면 처음 폭
        const colW = () => page.evaluate(() => Math.round(document.querySelectorAll('#watchTable thead th')[2].getBoundingClientRect().width));
        const w0 = await colW();
        const grip = page.locator('#watchTable thead th').nth(2).locator('.col-grip');
        const gb = await grip.boundingBox();
        await page.mouse.move(gb.x + 3, gb.y + gb.height / 2); await page.mouse.down(); await page.mouse.move(gb.x + 43, gb.y + gb.height / 2, { steps: 5 }); await page.mouse.up();
        const w1 = await colW(); assert.ok(Math.abs(w1 - w0 - 40) <= 2, JSON.stringify({ w0, w1 }));
        await page.reload(); await page.waitForSelector('#watchTable tbody .st');
        assert.ok(Math.abs(await colW() - w1) <= 2, '다시 열어도 폭 유지');
        await page.locator('#watchTable thead th').nth(2).locator('.col-grip').dblclick();
        assert.ok(Math.abs(await colW() - w0) <= 2, '두 번 누르면 처음 폭');
        await page.locator('#lotsTable tbody tr.pick').first().click(); await page.fill('#trigger', '7300');
        // 감시 체크 끄기/켜기
        const cols = () => page.evaluate(() => [...document.querySelectorAll('#watchTable thead th, #lotsTable thead th')].map(th => Math.round(th.getBoundingClientRect().left)));
        const colsBefore = await cols();
        const box = page.locator('#watchTable tbody input[type=checkbox]').first();
        await box.uncheck(); await page.waitForFunction(() => document.querySelector('#watchTable tbody .st').textContent === '중지');
        assert.deepEqual(await cols(), colsBefore, '감시를 꺼도 열 위치가 그대로');
        assert.equal(await page.$eval('#watchTable thead th', th => getComputedStyle(th).textAlign), 'center');
        await page.check('#watchAll'); await page.waitForFunction(() => document.querySelector('#watchTable tbody .st').textContent === '감시중');
        // 주문 처리 중에는 판정 · 결과 칸에 지금 주문 가격 · 정정 횟수 · 체결 수량
        const proc = await page.evaluate(() => { const w = { status: '정정중', firePrice: 6940, orders: [{ ex: 'KRX', price: 7500, cap: 7630, attempts: 2, filled: 0, qty: 1 }] }; return window.__ssLastText ? window.__ssLastText(w) : null; });
        assert.equal(proc, 'KRX 주문 7,500 · 정정 2회 · 0/1주 체결');
        // 자동 주문 꺼짐이면 발동하지 않는다
        k.price = 7350; await svc.step();
        assert.equal(k.orders.length, 0);
        // 켜면 발동 → 대주상환(77) → 체결완료
        on = true; await svc.step();
        for (let i = 0; i < 50 && svc._state().watches[0].status !== '체결완료'; i++) await new Promise(r => setTimeout(r, 10));
        assert.equal(k.orders.length, 1); assert.equal(k.orders[0].crd_deal_tp, '77'); assert.equal(k.orders[0].ord_uv, '7450');
        await page.waitForFunction(() => document.querySelector('#watchTable tbody .st').textContent === '체결완료', null, { timeout: 5000 });
        // 기록 창
        await page.locator('#watchTable tbody button', { hasText: '기록' }).first().click();
        await page.waitForSelector('#logModal:not([hidden])');
        const logText = await page.textContent('#logList');
        assert.match(logText, /발동/); assert.match(logText, /상환대주/); assert.match(logText, /체결/);
        await page.click('#logModal [data-close]');
        // 잔고가 많아도 창 전체는 스크롤되지 않고 대주 잔고 칸 안에서만 스크롤된다(창 크기 고정 설계)
        k.many = true; await page.click('#refreshBtn'); await page.waitForFunction(() => document.querySelectorAll('#lotsTable tbody tr').length > 20);
        const sc = await page.evaluate(() => { const w = document.querySelector('#lotsTable').closest('.tbl-wrap'); return { page: document.documentElement.scrollHeight - innerHeight, inner: w.scrollHeight - w.clientHeight }; });
        assert.ok(sc.page <= 0 && sc.inner > 0, JSON.stringify(sc));
        // 안내 문구 · 전체 중지 띠는 겹쳐 뜨고 배치를 밀지 않는다
        const shift = await page.evaluate(() => { const r = () => document.querySelector('.ss-main').getBoundingClientRect().top; const b = r(); document.getElementById('messageText').textContent = '시험 안내'; document.getElementById('message').hidden = false; document.getElementById('haltBanner').hidden = false; const after = r(); document.getElementById('messageOk').click(); document.getElementById('haltBanner').hidden = true; return after - b; });
        assert.equal(shift, 0);
        // 안내 문구는 확인을 눌러야 없어진다
        await page.evaluate(() => { document.getElementById('messageText').textContent = '시험'; document.getElementById('message').hidden = false; });
        await page.waitForTimeout(300); assert.equal(await page.isVisible('#message'), true);
        await page.click('#messageOk'); assert.equal(await page.isVisible('#message'), false);
        // 메인 화면 버튼이 여는 크기(1200×660)에서 창 전체 스크롤도, 설정란 안 스크롤도 없다
        // 넓은 창: 남는 폭을 모든 열이 기본 폭 비율대로 나눠 가진다(한 열만 크게 늘어나지 않음, 2026-11-20 사용자 지적)
        await page.setViewportSize({ width: 1700, height: 900 });
        await page.waitForTimeout(200);
        const wide = await page.evaluate(() => [...document.querySelectorAll('#lotsTable thead th')].map(h => Math.round(h.getBoundingClientRect().width)));
        // 날짜 · 보유 · 가능수량은 기본 폭 그대로, 종목 · 가격 · 평가손익만 기본 폭 비율로 넓어짐(2026-11-20 사용자 요청: 날짜는 딱 맞게)
        assert.deepEqual([wide[0], wide[2], wide[3], wide[7]], [72, 48, 70, 72], JSON.stringify(wide));
        assert.ok(Math.abs(wide[1] / wide[6] - 150 / 120) < 0.05, JSON.stringify(wide));
        await page.setViewportSize({ width: 1200, height: 660 });
        const fit = await page.evaluate(() => { const f = document.querySelector('.ss-form'); return { page: document.documentElement.scrollHeight - innerHeight, form: f.scrollHeight - f.clientHeight, wrapped: f.getBoundingClientRect().top > 100 }; });
        assert.deepEqual(fit, { page: 0, form: 0, wrapped: false }, JSON.stringify(fit));
        // 가운데 화살표로 청산 조건 설정을 접고 편다(기본 펼침). 접어도 왼쪽 가로폭 · 높이는 그대로이고(2026-11-20 사용자 지시), 위쪽 띠의 상태 · 시각 · 시간대는 그대로 보인다
        const foldInfo = () => page.evaluate(() => { const f = document.querySelector('.ss-form'), l = document.querySelector('.ss-left').getBoundingClientRect(), top = id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= 44; };
            return { formShown: f.offsetWidth > 0, leftW: Math.round(l.width), leftH: Math.round(l.height), expanded: document.getElementById('foldBtn').getAttribute('aria-expanded'), page: document.documentElement.scrollHeight - innerHeight, header: ['autoState', 'clock', 'segment'].every(top) }; });
        const open0 = await foldInfo(); assert.equal(open0.formShown, true); assert.equal(open0.expanded, 'true');
        await page.click('#foldBtn');
        const closed = await foldInfo(); assert.equal(closed.formShown, false); assert.equal(closed.expanded, 'false'); assert.ok(closed.leftW === open0.leftW && closed.leftH === open0.leftH && closed.page === 0 && closed.header, JSON.stringify([open0, closed]));
        await page.setViewportSize({ width: 640, height: 660 });
        const narrow = await foldInfo(); assert.ok(narrow.leftW <= 640 - 24 && narrow.leftH === open0.leftH && narrow.page === 0 && narrow.header && !narrow.formShown, '좁은 창에서 접은 상태 ' + JSON.stringify(narrow));
        await page.setViewportSize({ width: 1200, height: 660 });
        await page.click('#foldBtn'); const open1 = await foldInfo(); assert.deepEqual([open1.formShown, open1.leftW, open1.expanded], [true, open0.leftW, 'true']);
        // 독립창 앱(2026-11-20): 앱이 주는 window.chrome.webview를 흉내 낸다. 주소의 토큰을 X-SS-Token으로 보내고,
        // 접으면 창 폭을 화살표 옆까지 줄이라고(resize-window:-N), 펴면 다시 N만큼 늘리라고 앱에 알린다. 접힘 상태는 다시 열어도 그대로
        const np = await browser.newPage({ viewport: { width: 1200, height: 660 } }); np.on('pageerror', e => errors.push(String(e)));
        await np.addInitScript(() => { window.chrome = window.chrome || {}; window.chrome.webview = { postMessage: m => { (window.__msgs = window.__msgs || []).push(m); } }; });
        const tok = 'a'.repeat(64); seenTokens.clear();
        await np.goto(`http://127.0.0.1:${port}/short-stoploss.html#token=${tok}`); await np.waitForSelector('#lotsTable tbody tr.pick');
        assert.ok(seenTokens.has('S' + tok.slice(0, 8)) && !seenTokens.has(tok), '여는 토큰은 바꾸는 데만 쓰고 대주 API에는 창 토큰'); assert.equal(await np.evaluate(() => location.hash), '', '주소에서 토큰을 지운다');
        const nInfo = () => np.evaluate(() => ({ msgs: window.__msgs || [], leftW: Math.round(document.querySelector('.ss-left').getBoundingClientRect().width), closed: document.body.classList.contains('form-closed'), fold: JSON.parse(localStorage.getItem('short-stoploss-fold') || 'null'), need: Math.ceil(document.querySelector('.ss-fold').getBoundingClientRect().right) + 12 }));
        const n0 = await nInfo(); assert.deepEqual(n0.msgs.filter(m => m.startsWith('resize-window')), [], '처음에는 창 크기를 바꾸지 않는다');
        await np.click('#foldBtn'); const n1 = await nInfo();
        const cut = 1200 - n1.need; assert.ok(cut > 400, JSON.stringify(n1));
        assert.deepEqual(n1.msgs.filter(m => m.startsWith('resize-window')), [`resize-window:${-cut},0,1200,660`], JSON.stringify(n1));
        assert.equal(n1.leftW, n0.leftW, '접어도 잔고 · 감시 목록 폭 그대로'); assert.deepEqual(n1.fold, { closed: true, left: n1.fold.left, openWidth: 1200 });
        // 앱이 창을 줄인 것처럼 화면 폭을 맞춘다. 접은 채로 닫았다 다시 열면(앱이 접은 크기로 창을 연다) 접힌 상태로 열리고 창 크기는 건드리지 않는다
        await np.setViewportSize({ width: n1.need, height: 660 });
        await np.reload(); await np.waitForSelector('#lotsTable tbody tr.pick'); const n2 = await nInfo();
        assert.equal(n2.closed, true); assert.equal(n2.leftW, n0.leftW); assert.deepEqual(n2.msgs.filter(m => m.startsWith('resize-window')), [], JSON.stringify(n2));
        assert.ok(seenTokens.size === 1 && usedLaunch.size === 1, '새로고침 뒤에도 같은 창 토큰(다시 바꾸지 않음)');
        await np.click('#foldBtn'); const n3 = await nInfo();
        assert.deepEqual(n3.msgs.filter(m => m.startsWith('resize-window')), [`resize-window:${cut},0,${n1.need},660`], JSON.stringify(n3));
        assert.equal(n3.closed, false); assert.deepEqual(n3.fold, { closed: false });
        // 메인 화면 버튼을 다시 누르면 앱이 새 토큰을 넘긴다(서버 재시작 뒤 이어 쓰기)
        const tok2 = 'b'.repeat(64); await np.evaluate(t => window.refreshNativeShortStopLossCredentials(t), tok2); await np.waitForTimeout(500);
        assert.ok(seenTokens.has('S' + tok2.slice(0, 8)), '새 창 토큰으로 다시 조회');
        // 이미 쓴 여는 토큰이 다시 오면 안내를 띄우되, 쓰던 창 토큰으로 계속 조회한다
        seenTokens.clear(); await np.evaluate(t => window.refreshNativeShortStopLossCredentials(t), tok); await np.waitForTimeout(2600);
        assert.match(await np.textContent('#messageText'), /이미 쓴 연결/); assert.ok(seenTokens.has('S' + tok2.slice(0, 8)), '쓰던 창 토큰 유지');
        await np.close();
        // 설정란 i 풍선은 왼쪽 칸 경계에 잘리지 않고 창 안에 다 보인다(2026-11-20 사용자 지적)
        for (const label of ['미체결 정정 설명', '수량 설명', '주문 거래소 설명']) {
            await page.hover(`.ss-form [aria-label="${label}"]`);
            const b = await page.evaluate(() => { const r = document.getElementById('floatTip').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vis: getComputedStyle(document.getElementById('floatTip')).display, w: innerWidth, h: innerHeight }; });
            assert.ok(b.vis === 'block' && b.l >= 0 && b.r <= b.w && b.t >= 0 && b.b <= b.h, label + ' ' + JSON.stringify(b));
        }
        await page.mouse.move(5, 5);
        // 정책 i
        await page.click('#policyBtn'); assert.match(await page.textContent('#policyBody'), /추격 한도/);
        // 정책 표 2개: 확인 주기(3줄) · 서버 재시작(5줄)
        assert.equal(await page.locator('#policyBody table').count(), 2);
        assert.ok((await page.locator('#policyBody table').nth(0).textContent()).includes('내 주문체결(00) · 3초 조회')); assert.equal(await page.locator('#policyBody table').nth(0).locator('tbody tr').count(), 3);
        assert.match(await page.locator('#policyBody table').nth(1).textContent(), /주문 전에 꺼짐/); assert.equal(await page.locator('#policyBody table').nth(1).locator('tbody tr').count(), 5);
        assert.deepEqual(errors, []);
        console.log('short-stoploss-browser: 모든 확인 통과');
    } finally { await browser.close(); server.close(); svc.stop(); }
})().catch(error => { console.error(error); process.exit(1); });
