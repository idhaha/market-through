'use strict';
// 대주 StopLoss (2026-11-19): 가짜 키움 응답으로 발동 · 주문 본문 · 확인 장치 · 정정 · 재시작 · 시간대 · 유효기간을 확인한다.
// 실제 키움 응답 모양은 2026-11-19 실계좌 시험(outputs/kiwoom-short-cover-20261119) 기준.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const S = require('../../short-stoploss-service');
const at = s => Date.parse(s + '+09:00');

function fakeKiwoom({ price = 7350, volume = 1000, ask = 7360, nxt = true, io = '+상환대주', fill = true, able = 1 } = {}) {
    const k = { price, volume, ask, nxt, io, fill, able, orders: [], modifies: [], cancels: [], book: new Map(), seq: 100, calls: [] };
    k.http = { post: async (url, body, { headers }) => {
        const api = headers['api-id']; k.calls.push(api);
        const r = data => ({ status: 200, data: { return_code: 0, ...data } });
        if (api === 'ka00001') return r({ acctNo: '3699577211' });
        if (api === 'kt00018') { k.balanceEx = [...(k.balanceEx || []), body.dmst_stex_tp]; const nx = body.dmst_stex_tp === 'NXT' && k.nxtBalance; return r({ acnt_evlt_remn_indv_tot: [
            { stk_cd: 'A004980', stk_nm: '/성신양회', crd_tp: '05', crd_tp_nm: '대주', crd_loan_dt: '20261123', rmnd_qty: String(k.held || 1), trde_able_qty: String(k.able), pur_pric: '7030', pur_amt: String(7030 * (k.held || 1)), cur_prc: String(nx ? nx.price : k.price), evltv_prft: nx ? nx.pl : '-10', prft_rt: nx ? nx.rate : '-0.1' },
            { stk_cd: 'A180640', stk_nm: '한진칼', crd_tp: '00', crd_tp_nm: '', crd_loan_dt: '', rmnd_qty: '1', trde_able_qty: '1' }] }); }
        if (api === 'ka10085') return r({ acnt_prft_rt: [{ stk_cd: '004980', crd_tp: '07', loan_dt: '20261123', expr_dt: '20270222', crd_int: String(k.interest || 0) }] });
        if (api === 'ka10001') {
            if (body.stk_cd.endsWith('_NX') && !k.nxt) return r({ cur_prc: '', base_pric: '' });
            return r({ cur_prc: '+' + (body.stk_cd.endsWith('_NX') && k.nxtPrice ? k.nxtPrice : k.price), trde_qty: String(k.volume), upl_pric: '+8900', base_pric: '6850', exp_cntr_pric: k.exp ? '+' + k.exp : '' });
        }
        if (api === 'ka10004') return r({ sel_fpr_bid: '+' + (k.askSeq ? k.askSeq[Math.min(k.modifies.length, k.askSeq.length - 1)] : k.ask) });
        if (api === 'kt10006') {
            const ord = String(++k.seq).padStart(7, '0'); k.orders.push(body);
            k.book.set(ord, { qty: +body.ord_qty, open: k.fill ? 0 : +body.ord_qty, filled: k.fill ? +body.ord_qty : 0, price: +body.ord_uv });
            if (k.onOrder) k.onOrder(ord, body);
            return r({ ord_no: ord, return_msg: (body.dmst_stex_tp) + ' 신용 매수주문이 완료되었습니다.' });
        }
        if (api === 'kt10008') {
            const old = k.book.get(body.orig_ord_no), ord = String(++k.seq).padStart(7, '0'); k.modifies.push(body);
            k.book.set(ord, { qty: old.open, open: old.open, filled: 0, price: +body.mdfy_uv }); old.open = 0;
            return r({ ord_no: ord, base_orig_ord_no: body.orig_ord_no });
        }
        if (api === 'kt10009') { k.cancels.push(body); const o = k.book.get(body.orig_ord_no); if (o) o.open = 0; return r({ ord_no: String(++k.seq).padStart(7, '0') }); }
        if (api === 'ka10075') return r({ oso: [...k.book].filter(([, o]) => o.open > 0).map(([ord, o]) => ({ ord_no: ord, oso_qty: String(o.open), io_tp_nm: k.io, stk_cd: '004980', stex_tp: '1' })) });
        if (api === 'kt00009') return r({ acnt_ord_cntr_prst_array: [...k.book].map(([ord, o]) => ({ ord_no: ord, cntr_qty: String(o.filled), cntr_uv: String(o.filled ? o.price : 0), io_tp_nm: k.io === '+상환대주' ? '대주매수상환' : '현금매수', crd_deal_tp: k.io === '+상환대주' ? '유통대주매수상환' : '자기융자매수' })) });
        return r({});
    } };
    return k;
}
function engine(k, { t = '2026-11-20T10:00:00', on = true, dir } = {}) {
    const clock = { t: at(t) };
    const directory = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'short-stoploss-'));
    const e = S.createShortStopLoss({ directory, http: k.http, getToken: async () => 'tok', enabled: () => on, openDate: d => !['2026-12-25', '2027-01-01'].includes(d),
        now: () => clock.t, wait: async ms => { clock.t += ms; }, log: () => {} });
    return { e, clock, directory };
}
const input = (lotKey, extra = {}) => ({ lotKey, trigger: 7300, ticks: 10, upperLimit: false, fix: true, chasePct: 10, qtyMode: 'pct', qtyValue: 100, allLots: false, cancelPending: true, until: '2026-12-20', ...extra });
const settle = () => new Promise(r => setImmediate(r));
async function runUntilDone(e, w, rounds = 40) { for (let i = 0; i < rounds; i++) { await settle(); const s = e._state().watches.find(x => x.id === w.id); if (!['발동', '주문접수', '정정중', '미체결'].includes(s.status)) return s; await new Promise(r => setTimeout(r, 2)); } return e._state().watches.find(x => x.id === w.id); }

(async () => {
    // 1) 호가단위 · 틱 · 추격 한도 · 정정 가격
    assert.equal(S.addTicks(7300, 10), 7400);
    assert.equal(S.addTicks(1999, 2), 2005); // 1,999 → 2,000(1원) → 2,005(5원 단위)
    assert.equal(S.chaseCap(7300, 10, 8900), 8030);
    assert.equal(S.chaseCap(7300, 5, 8900), 7660);
    assert.equal(S.chaseCap(8500, 10, 8900), 8900); // 상한가 이하
    assert.equal(S.repriceFor(1, 7500, 10, 8030), 7600);
    assert.equal(S.repriceFor(2, 7700, 10, 8030), 7900);
    assert.equal(S.repriceFor(2, 7700, 10, 7660), 7660);
    assert.equal(S.repriceFor(3, 7700, 10, 8030), 8030);

    // 2) 시간대별 주문 거래소
    const seg = t => S.segmentAt(at(t), () => true)?.id || null;
    assert.equal(seg('2026-11-20T08:05:00'), 'NXT_PRE');
    assert.equal(seg('2026-11-20T08:55:00'), 'HOLD');
    assert.equal(seg('2026-11-20T10:00:00'), 'KRX');
    assert.equal(seg('2026-11-20T15:25:00'), 'KRX_CLOSE');
    // 2026-11-24: 15:30~15:40 NXT 단일가 미리 접수 · 15:40~16:00 NXT만(KRX 장종료 거부) · 16:00~20:00 SOR
    assert.equal(seg('2026-11-20T15:35:00'), 'NXT_SINGLE');
    assert.equal(seg('2026-11-20T15:45:00'), 'NXT_AFTER');
    assert.equal(seg('2026-11-20T16:00:00'), 'AFTER');
    assert.equal(seg('2026-11-20T19:59:00'), 'AFTER');
    assert.equal(seg('2026-11-20T20:00:00'), null);
    assert.equal(seg('2026-11-21T10:00:00'), null); // 토요일
    assert.equal(S.segmentAt(at('2026-12-25T10:00:00'), d => d !== '2026-12-25'), null);

    // 3) 유효기간 자동 조정
    const opt = { today: '2026-11-20', maturity: '2027-02-22', openDate: d => !['2026-12-25'].includes(d) };
    assert.equal(S.adjustUntil('2027-03-05', opt).value, '2027-02-22');
    assert.equal(S.adjustUntil('2026-12-25', opt).value, '2026-12-24');
    assert.equal(S.adjustUntil('2026-12-20', opt).value, '2026-12-18');
    assert.equal(S.adjustUntil('2026-11-01', opt).value, '2026-11-20');
    assert.equal(S.adjustUntil('2027-01-15', opt).value, '2027-01-15');

    // 4) 발동 → 대주상환 주문 본문(77 · 대출일 · 발동가 + 10틱) → 체결완료, 다시 발동하지 않음
    {
        const k = fakeKiwoom(), { e } = engine(k);
        await e.loadLots();
        const w = await e.create(input('004980:20261123'));
        await e.step();
        const done = await runUntilDone(e, w);
        assert.equal(k.orders.length, 1, '주문 1건');
        assert.deepEqual({ ex: k.orders[0].dmst_stex_tp, code: k.orders[0].stk_cd, crd: k.orders[0].crd_deal_tp, loan: k.orders[0].crd_loan_dt, qty: k.orders[0].ord_qty, price: k.orders[0].ord_uv },
            { ex: 'SOR', code: '004980', crd: '77', loan: '20261123', qty: '1', price: '7450' }); // 정규장 · NXT 거래 종목은 SOR(2026-11-20 결정)
        assert.equal(done.status, '체결완료');
        await e.step(); await settle();
        assert.equal(k.orders.length, 1, '한 번만 발동');
    }

    // 5) 자동 주문 꺼짐(SHORT_STOPLOSS 없음)이면 주문하지 않는다
    {
        const k = fakeKiwoom(), { e } = engine(k, { on: false });
        await e.loadLots(); await e.create(input('004980:20261123')); await e.step(); await settle();
        assert.equal(k.orders.length, 0);
    }

    // 6) 확인 장치: 대주상환이 아닌 주문으로 접수되면 즉시 취소하고 전체 감시를 멈춘다
    {
        const k = fakeKiwoom({ io: '+매수신용', fill: false }), { e } = engine(k);
        await e.loadLots();
        const w = await e.create(input('004980:20261123'));
        await e.step();
        const done = await runUntilDone(e, w);
        assert.equal(k.cancels.length, 1, '즉시 취소');
        assert.equal(e._state().halted, true, '전체 중지');
        assert.equal(done.status, '실패');
    }

    // 7) 미체결 정정: 매도1호가 + 10틱 → + 20틱 → 한도(10% = 8,030), 한도를 넘지 않는다
    {
        const k = fakeKiwoom({ price: 7300, fill: false }), { e } = engine(k);
        k.askSeq = [7500, 7700, 7700]; // 정정할 때마다 매도1호가가 오른다
        await e.loadLots();
        const w = await e.create(input('004980:20261123'));
        await e.step();
        for (let i = 0; i < 40 && k.modifies.length < 3; i++) await new Promise(r => setTimeout(r, 5));
        assert.deepEqual(k.modifies.map(m => m.mdfy_uv), ['7600', '7900', '8030']);
        assert.equal(k.orders[0].ord_uv, '7400');
        e._state().watches[0].status = '실패'; // 추적 중단(가짜 시계가 6시간을 넘기도록 두지 않음)
        for (const o of k.book.values()) o.open = 0;
        await runUntilDone(e, w);
    }

    // 8) 재시작: 주문 전 "발동"에서 멈춘 건은 다시 발동하지 않는다
    {
        const k = fakeKiwoom(), first = engine(k);
        await first.e.loadLots();
        const w = await first.e.create(input('004980:20261123'));
        const st = first.e._state(); st.watches[0].status = '발동'; st.watches[0].orders = [];
        fs.writeFileSync(path.join(first.directory, 'state.json'), JSON.stringify(st));
        const again = engine(k, { dir: first.directory });
        await again.e.loadLots(); await again.e.step(); await settle();
        assert.equal(again.e._state().watches.find(x => x.id === w.id).status, '확인 필요');
        assert.equal(k.orders.length, 0);
    }

    // 9) NXT 시간대 · NXT 비대상 종목은 주문하지 않고, 오늘 체결이 없으면(거래량 0) 판정하지 않는다
    {
        const k = fakeKiwoom({ nxt: false }), { e } = engine(k, { t: '2026-11-20T08:10:00' });
        await e.loadLots(); await e.create(input('004980:20261123')); await e.step(); await settle();
        assert.equal(k.orders.length, 0);
        assert.match(e._state().watches[0].lastCheck.text, /NXT 비대상/);
        const k2 = fakeKiwoom({ volume: 0 }), b = engine(k2, { t: '2026-11-20T08:10:00' });
        await b.e.loadLots(); await b.e.create(input('004980:20261123')); await b.e.step(); await settle();
        assert.equal(k2.orders.length, 0);
    }

    // 10) 유효기간 마지막 날 20:00이 지나면 만료
    {
        const k = fakeKiwoom({ price: 7000 }), { e, clock } = engine(k, { t: '2026-11-20T10:00:00' });
        await e.loadLots(); await e.create(input('004980:20261123', { until: '2026-11-20' }));
        clock.t = at('2026-11-20T20:00:30'); await e.step();
        assert.equal(e._state().watches[0].status, '만료');
    }

    // 11) 감시 체크박스: 끄면 중지, 켜면 감시중 · 전체 감시
    {
        const k = fakeKiwoom({ price: 7000 }), { e } = engine(k);
        await e.loadLots(); const w = await e.create(input('004980:20261123'));
        assert.equal(e.setEnabled(w.id, false).status, '중지');
        assert.equal(e.setEnabled(w.id, true).status, '감시중');
        e.setAll(false); assert.equal(e._state().watches[0].status, '중지');
    }
    // 12) 서버 재시작: 감시중이던 건은 저장된 조건으로 자동으로 다시 감시하고, 조건을 만족하면 발동한다
    {
        const k = fakeKiwoom({ price: 7000 }), first = engine(k);
        await first.e.loadLots(); const w = await first.e.create(input('004980:20261123'));
        await first.e.step(); assert.equal(k.orders.length, 0);
        first.e.stop();
        k.price = 7350;
        const again = engine(k, { dir: first.directory });
        assert.equal(again.e._state().watches.find(x => x.id === w.id).status, '감시중');
        await again.e.step();
        const done = await runUntilDone(again.e, w);
        assert.equal(k.orders.length, 1); assert.equal(done.status, '체결완료');
    }
    // 13) 공용 실시간(VI 웹소켓): 감시 종목 0B · 계좌 00/04 등록, 0B 체결로 바로 발동, NXT 체결은 KRX 시간에 무시
    {
        const sets = [], listeners = [];
        const rt = { set: (grp, items, types) => sets.push({ grp, items, types }), onReal: fn => listeners.push(fn), connected: () => true, state: () => 'VI 실시간 수신 중', status: () => ({}) };
        const k = fakeKiwoom({ price: 7000 }), clock = { t: at('2026-11-20T10:00:00') };
        const e = S.createShortStopLoss({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'short-stoploss-rt-')), http: k.http, getToken: async () => 't', enabled: () => true, openDate: () => true,
            now: () => clock.t, wait: async ms => { clock.t += ms; }, log: () => {}, realtime: rt });
        await e.loadLots(); const w = await e.create(input('004980:20261123'));
        await e.step();
        assert.deepEqual(sets.find(s => s.grp === '3'), { grp: '3', items: ['004980', '004980_NX'], types: ['0B'] });
        assert.deepEqual(sets.find(s => s.grp === '4'), { grp: '4', items: [''], types: ['00', '04'] });
        listeners[0]({ type: '0B', item: '004980_NX', values: { '10': '+7290' } }); await settle();
        assert.equal(k.orders.length, 0); assert.match(e._state().watches[0].lastCheck.text, /^NXT 7,290 < 7,300 · 실시간/, 'KRX 시간에도 NXT 체결을 판정');
        listeners[0]({ type: '0B', item: '004980', values: { '10': '-7290' } }); await settle();
        assert.equal(k.orders.length, 0); assert.match(e._state().watches[0].lastCheck.text, /실시간/);
        listeners[0]({ type: '0B', item: '004980', values: { '10': '+7310' } });
        const done = await runUntilDone(e, w);
        assert.equal(k.orders.length, 1); assert.equal(k.orders[0].ord_uv, String(S.addTicks(7310, 10))); assert.equal(done.status, '체결완료');
    }

    // 14) VI 모니터 공용 등록: 공용 등록이 거부되면 연결은 유지하고 대주를 우선(VI 1h 해지, 대주 그룹 재등록), 0B는 공용 수신기로 간다
    {
        const { createViMonitor } = require('../../vi-monitor-service');
        const vi = createViMonitor({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'vi-shared-')), now: () => at('2026-11-20T10:00:00'), policy: () => ({ openDate: () => true, spotAt: () => false }),
            enabled: () => false, http: { post: async () => { throw Error('offline'); } }, getToken: async () => 'x', kiwoomToken: async () => 'x', releaseWaitMs: 5 });
        const got = []; vi.sharedRealtime.onReal(d => got.push(d.type));
        vi.sharedRealtime.set('3', ['004980'], ['0B']);
        assert.throws(() => vi.sharedRealtime.set('1', ['x'], ['0B']));
        vi.receive({ trnm: 'LOGIN', return_code: 0 }); vi.receive({ trnm: 'REG', return_code: 0 }); vi.receive({ trnm: 'REG', return_code: 0 });
        assert.equal(vi.snapshot().connection, 'VI 실시간 수신 중');
        vi.receive({ trnm: 'REG', return_code: 1, return_msg: '거부' });
        assert.equal(vi.snapshot().connection, 'VI 실시간 수신 중', '소켓이 없으면 VI 해지 없이 기록만');
        assert.equal(vi.sharedRealtime.status().errors.length, 1);
        assert.equal(vi.sharedRealtime.connected(), false, '소켓 없음');
        vi.receive({ trnm: 'REAL', data: [{ type: '0B', item: '004980', values: { '10': '7000' } }, { type: '04', item: '', values: {} }] });
        assert.deepEqual(got, ['0B', '04']);
    }
    // 15) KRX 정규장 조회 감시: KRX 체결이 감시가 아래여도 NXT 체결이 감시가 이상이면 발동하고, 주문은 SOR로 낸다(2026-11-20부터)
    {
        const k = fakeKiwoom({ price: 7200 }); k.nxtPrice = 7320;
        const { e } = engine(k);
        await e.loadLots(); const w = await e.create(input('004980:20261123'));
        await e.step(); const done = await runUntilDone(e, w);
        assert.equal(k.orders.length, 1); assert.equal(k.orders[0].dmst_stex_tp, 'SOR'); assert.equal(k.orders[0].ord_uv, String(S.addTicks(7320, 10)));
        assert.equal(done.fireSrc, 'NXT'); assert.equal(done.status, '체결완료');
    }
    // 16) 00(내 주문체결) 실시간: 접수 · 체결 이벤트로 바로 확인하고, 조회상으로는 미체결이어도 정정하지 않는다
    {
        const listeners = [];
        const rt = { set: () => {}, onReal: fn => listeners.push(fn), connected: () => true, state: () => 'VI 실시간 수신 중', status: () => ({}) };
        const k = fakeKiwoom({ price: 7000, fill: false, io: '' }); // 조회로는 접수 · 체결이 안 보이는 상황
        const ev = (ord, b, extra) => ({ type: '00', item: '004980', values: { '9203': ord, '9001': '004980', '905': '+상환대주', '922': '77', '923': b.crd_loan_dt, '900': b.ord_qty, '901': b.ord_uv, ...extra } });
        k.onOrder = (ord, b) => { listeners[0](ev(ord, b, { '913': '접수', '902': b.ord_qty })); listeners[0](ev(ord, b, { '913': '체결', '902': '0', '910': '7360', '911': '1', '914': '7360', '915': '1' })); };
        const clock = { t: at('2026-11-20T10:00:00') };
        const e = S.createShortStopLoss({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'short-stoploss-00-')), http: k.http, getToken: async () => 't', enabled: () => true, openDate: () => true,
            now: () => clock.t, wait: async ms => { clock.t += ms; }, log: () => {}, realtime: rt });
        await e.loadLots(); const w = await e.create(input('004980:20261123'));
        listeners[0]({ type: '0B', item: '004980', values: { '10': '+7350' } });
        const done = await runUntilDone(e, w);
        assert.equal(done.status, '체결완료'); assert.equal(k.modifies.length, 0, '정정 없음'); assert.equal(k.cancels.length, 0);
        const log = e.history(w.id).log.map(x => x.text).join(' | ');
        assert.match(log, /접수 확인 · 실시간/); assert.ok(log.includes('1/1주 체결 · 7,360 · 실시간'), log);
    }

    // 17) 00 이벤트가 대주상환이 아니면(신용 77이 아님) 확인 장치가 즉시 취소하고 전체 중지
    {
        const listeners = [];
        const rt = { set: () => {}, onReal: fn => listeners.push(fn), connected: () => true, state: () => 'VI 실시간 수신 중', status: () => ({}) };
        const k = fakeKiwoom({ price: 7000, fill: false, io: '' });
        k.onOrder = (ord, b) => listeners[0]({ type: '00', item: '004980', values: { '9203': ord, '905': '+매수신용', '922': '03', '900': '1', '902': '1', '913': '접수' } });
        const clock = { t: at('2026-11-20T10:00:00') };
        const e = S.createShortStopLoss({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'short-stoploss-00b-')), http: k.http, getToken: async () => 't', enabled: () => true, openDate: () => true,
            now: () => clock.t, wait: async ms => { clock.t += ms; }, log: () => {}, realtime: rt });
        await e.loadLots(); const w = await e.create(input('004980:20261123'));
        listeners[0]({ type: '0B', item: '004980', values: { '10': '+7350' } });
        const done = await runUntilDone(e, w);
        assert.equal(k.cancels.length, 1); assert.equal(e._state().halted, true); assert.equal(done.status, '실패');
    }
    // 19) 정규장 주문 거래소: NXT 비대상 종목은 KRX로 낸다(SOR은 NXT 거래 종목만, 2026-11-20 결정). 미체결 조회는 SOR이면 전체(0)로 본다
    {
        const k = fakeKiwoom({ nxt: false }); const bodies = []; const post = k.http.post; k.http.post = async (u, b, o) => { bodies.push({ api: o.headers['api-id'], b }); return post(u, b, o); };
        const { e } = engine(k);
        await e.loadLots(); const w = await e.create(input('004980:20261123'));
        await e.step(); const done = await runUntilDone(e, w);
        assert.equal(k.orders[0].dmst_stex_tp, 'KRX'); assert.equal(done.status, '체결완료');
        assert.ok(bodies.filter(x => x.api === 'ka10075').every(x => x.b.stex_tp === '1'), 'KRX 주문은 KRX(1)로 미체결 조회');
        const k2 = fakeKiwoom(); const bodies2 = []; const post2 = k2.http.post; k2.http.post = async (u, b, o) => { bodies2.push({ api: o.headers['api-id'], b }); return post2(u, b, o); };
        const { e: e2 } = engine(k2);
        await e2.loadLots(); const w2 = await e2.create(input('004980:20261123'));
        await e2.step(); await runUntilDone(e2, w2);
        assert.equal(k2.orders[0].dmst_stex_tp, 'SOR');
        assert.ok(bodies2.some(x => x.api === 'ka10075' && x.b.stex_tp === '0') && !bodies2.some(x => x.api === 'ka10075' && x.b.stex_tp === '1'), 'SOR 주문은 전체(0)로 미체결 조회');
    }
    // 18) 30초 점검 기록(realtime-날짜.jsonl): 끝나지 않은 감시 건이 있을 때만 남기고, 지난 날짜 파일은 지운다(2026-11-20 사용자 결정)
    {
        const rt = { set: () => {}, onReal: () => {}, connected: () => true, state: () => 'VI 실시간 수신 중', status: () => ({}) };
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'short-stoploss-rtlog-'));
        fs.writeFileSync(path.join(dir, 'realtime-2026-11-19.jsonl'), '{}\n'); fs.writeFileSync(path.join(dir, 'realtime-2026-11-18.jsonl'), '{}\n');
        const k = fakeKiwoom({ price: 7000 }); // 감시가 7,300 아래라 발동하지 않음
        const clock = { t: at('2026-11-20T10:00:00') };
        const e = S.createShortStopLoss({ directory: dir, http: k.http, getToken: async () => 't', enabled: () => true, openDate: () => true,
            now: () => clock.t, wait: async ms => { clock.t += ms; }, log: () => {}, realtime: rt });
        const logs = () => fs.readdirSync(dir).filter(n => n.startsWith('realtime-')).sort();
        await e.loadLots(); await e.step(); await settle();
        assert.deepEqual(logs(), [], '감시 건이 없으면 남기지 않고, 지난 날짜 파일은 지운다');
        const w = await e.create(input('004980:20261123')); clock.t += 31000; await e.step(); await settle();
        assert.deepEqual(logs(), ['realtime-2026-11-20.jsonl'], '감시 건이 있으면 당일 파일에 남긴다');
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'realtime-2026-11-20.jsonl'), 'utf8').trim().split('\n').at(-1)).watches[0].id, w.id);
        // 다음 날이 되면 전날 파일을 지우고 그날 파일만 둔다
        clock.t = at('2026-11-23T10:00:00'); await e.step(); await settle();
        assert.deepEqual(logs(), ['realtime-2026-11-23.jsonl']);
        // 감시를 지우면 다시 남기지 않는다
        e.remove(w.id); clock.t += 31000; const before = fs.readFileSync(path.join(dir, 'realtime-2026-11-23.jsonl'), 'utf8'); await e.step(); await settle();
        assert.equal(fs.readFileSync(path.join(dir, 'realtime-2026-11-23.jsonl'), 'utf8'), before);
        e.stop();
    }
    // 할당(2026-11-24): 보유 10주를 60% · 나머지 100%로 나누면 6주 · 4주. 남은 수량을 넘는 등록 · 수정은 거부, 발동하면 그 건의 주 수만 상환
    {
        const k = fakeKiwoom({ able: 10, price: 7000 }), { e } = engine(k); k.held = 10;
        await e.loadLots();
        const a = await e.create(input('004980:20261123', { qtyValue: 60 }));
        const b = await e.create(input('004980:20261123', { qtyValue: 100, trigger: 7500 }));
        assert.deepEqual([[a.shares, a.baseQty], [b.shares, b.baseQty]], [[6, 10], [4, 10]]);
        await assert.rejects(e.create(input('004980:20261123', { qtyMode: 'shares', qtyValue: 1 })), /남은 가능수량이 없습니다/);
        assert.throws(() => e.update(b.id, input('004980:20261123', { qtyMode: 'shares', qtyValue: 5, trigger: 7500 })), /남은 가능수량\(4주\)보다 많이/);
        assert.equal(e.update(b.id, input('004980:20261123', { qtyMode: 'shares', qtyValue: 4, trigger: 7500 })).shares, 4, '자기 수량은 빼고 따짐');
        k.price = 7300; await e.step(); const done = await runUntilDone(e, a);
        assert.equal(done.status, '체결완료'); assert.equal(k.orders.length, 1); assert.equal(k.orders[0].ord_qty, '6', '60% 건은 6주만 상환');
        e.stop();
    }
    // 장 마감 뒤 시간표(2026-11-24 실계좌 접수 시험 · 사용자 결정)
    {
        const run = async (t, opts = {}, extra = {}) => { const k = fakeKiwoom(opts); Object.assign(k, extra); const { e } = engine(k, { t }); await e.loadLots(); const w = await e.create(input('004980:20261123')); await e.step(); const done = await runUntilDone(e, w); e.stop(); return { k, done, log: e.history(w.id).log.map(x => x.text).join(' | ') }; };
        // 16:00~20:00: NXT 종목은 SOR, KRX · NXT 체결을 모두 판정(KRX 7,200 아래여도 NXT 7,320이면 발동)
        let r = await run('2026-11-20T16:30:00', { price: 7200 }, { nxtPrice: 7320 });
        assert.equal(r.k.orders[0].dmst_stex_tp, 'SOR'); assert.equal(r.done.fireSrc, 'NXT'); assert.equal(r.done.status, '체결완료');
        // 16:00~20:00 NXT 비대상은 KRX
        r = await run('2026-11-20T16:30:00', { nxt: false });
        assert.equal(r.k.orders[0].dmst_stex_tp, 'KRX');
        // 15:40~16:00: NXT만, NXT 비대상은 주문하지 않고 16:00 대기
        r = await run('2026-11-20T15:45:00');
        assert.equal(r.k.orders[0].dmst_stex_tp, 'NXT');
        { const k = fakeKiwoom({ nxt: false }), { e } = engine(k, { t: '2026-11-20T15:45:00' }); await e.loadLots(); await e.create(input('004980:20261123')); await e.step(); await settle();
          assert.equal(k.orders.length, 0); assert.match(e._state().watches[0].lastCheck.text, /NXT 비대상 · 16:00 KRX 대기/); e.stop(); }
        // 15:30~15:40: NXT로 미리 접수, 체결이 없어도 정정하지 않는다
        { const k = fakeKiwoom({ fill: false }), { e, clock } = engine(k, { t: '2026-11-20T15:31:00' }); const modAt = [], post = k.http.post; k.http.post = async (u, b, o) => { if (o.headers['api-id'] === 'kt10008') modAt.push(clock.t); return post(u, b, o); }; await e.loadLots(); const w = await e.create(input('004980:20261123')); await e.step();
          for (let i = 0; i < 20 && k.orders.length < 1; i++) await new Promise(r => setTimeout(r, 2));
          for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 2));
          assert.equal(k.orders[0].dmst_stex_tp, 'NXT');
          assert.ok(modAt.every(t => t >= at('2026-11-20T15:40:00')), '15:40 전에는 정정 안 함 ' + modAt.map(t => new Date(t + 9 * 3600000).toISOString().slice(11, 19)));
          assert.ok(clock.t > at('2026-11-20T15:33:00'), '단일가 구간에서 여러 번 추적');
          e._state().watches.find(x => x.id === w.id).status = '실패'; for (const o of k.book.values()) o.open = 0; await runUntilDone(e, w); e.stop(); }
        // 종가 단일가(KRX) 주문이 15:30 마감으로 없어지면: NXT 비대상은 16:00까지 기다렸다가 KRX로, NXT 종목은 15:30부터 NXT로 다시 낸다
        for (const [nxt, wantEx, notBefore] of [[false, 'KRX', '16:00:00'], [true, 'NXT', '15:30:00']]) {
            const k = fakeKiwoom({ nxt, fill: false, price: 7000 }); k.exp = 7350;
            const { e, clock } = engine(k, { t: '2026-11-20T15:25:00' }); const sentAt = [], post = k.http.post;
            k.http.post = async (u, b, o) => { const api = o.headers['api-id'];
                if (api === 'kt10006') sentAt.push(clock.t);
                if (clock.t >= at('2026-11-20T15:30:00')) for (const [ord, x] of k.book) if (x.krxClose) x.open = 0; // 15:30 마감으로 KRX 미체결 소멸
                const res = await post(u, b, o);
                if (api === 'kt10006' && b.dmst_stex_tp === 'KRX' && clock.t < at('2026-11-20T15:30:00')) k.book.get(res.data.ord_no).krxClose = true;
                if (api === 'kt10006' && sentAt.length === 2) k.book.get(res.data.ord_no).filled = k.book.get(res.data.ord_no).qty, k.book.get(res.data.ord_no).open = 0;
                return res; };
            await e.loadLots(); const w = await e.create(input('004980:20261123', { fix: false })); await e.step();
            const done = await runUntilDone(e, w, 4000);
            assert.equal(k.orders[0].dmst_stex_tp, 'KRX', '종가 단일가는 KRX');
            assert.equal(k.orders.length, 2); assert.equal(k.orders[1].dmst_stex_tp, wantEx);
            assert.ok(sentAt[1] >= at('2026-11-20T' + notBefore), `${wantEx} 재주문 시각 ${new Date(sentAt[1] + 9 * 3600000).toISOString().slice(11, 19)}`);
            assert.equal(done.status, '체결완료'); e.stop();
        }
    }
    // 평가손익 · 현재가는 영웅문 0345(통합)처럼 마지막 체결 시장 기준(2026-11-26): 정규장은 KRX, 그 밖(밤 · NXT 애프터 · 프리마켓)은 NXT 대상이면 NXT 행
    {
        const k = fakeKiwoom(); k.nxtBalance = { price: 7400, pl: '-00000000000390', rate: '-5.55' };
        const day = engine(k, { t: '2026-11-20T10:00:00' }); const dl = await day.e.loadLots();
        assert.deepEqual([dl[0].price, dl[0].pl, dl[0].priceEx], [k.price, -10, 'KRX'], '정규장: KRX'); assert.deepEqual(k.balanceEx, ['KRX']);
        k.balanceEx = []; const night = engine(k, { t: '2026-11-20T21:00:00' }); const nl = await night.e.loadLots();
        assert.deepEqual([nl[0].price, nl[0].pl, nl[0].rate, nl[0].priceEx], [7400, -390, -5.55, 'NXT'], '밤: NXT 기준'); assert.deepEqual(k.balanceEx, ['KRX', 'NXT']);
        const k2 = fakeKiwoom({ nxt: false }); k2.nxtBalance = k.nxtBalance; const off = engine(k2, { t: '2026-11-20T21:00:00' }); const ol = await off.e.loadLots();
        assert.deepEqual([ol[0].pl, ol[0].priceEx], [-10, 'KRX'], 'NXT 비대상은 KRX 그대로'); assert.deepEqual(k2.balanceEx, ['KRX'], 'NXT 비대상뿐이면 NXT 조회 안 함');
        day.e.stop(); night.e.stop(); off.e.stop();
        // 신용이자도 뺀다(0345 삼성E&A: (149,498 - 2,049) / 9,976,000 = 1.48%). 여기서는 (-10 - 5) / 7,030 = -0.21%
        const k3 = fakeKiwoom(); k3.interest = 5; const i3 = engine(k3, { t: '2026-11-20T10:00:00' }); const il = await i3.e.loadLots();
        assert.deepEqual([il[0].pl, il[0].rate, il[0].interest], [-15, -0.21, 5]); i3.e.stop();
    }
    console.log('short-stoploss: 모든 확인 통과');
})().catch(error => { console.error(error); process.exit(1); });
