// 지난날 키움 1분봉 저장(2026-11-21): 한 (종목, 날짜)는 파일 하나, 1분봉만, 원본 칸만, 다시 쓰지 않음,
// 쏠림율 · 종목수급 캔들이 같은 파일을 함께 쓰고, 저장된 날은 키움을 부르지 않는다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { createKiwoomMinuteStore, completeDay } = require('../../kiwoom-minute-store');
const { createConcentrationChartService } = require('../../concentration-chart');
const { createSupplyService } = require('../../supply-service');

process.env.KIWOOM_APPKEY = 'test-key'; process.env.KIWOOM_SECRETKEY = 'test-secret';
const NOW = new Date('2026-10-06T16:00:00Z'); // 한국 2026-10-07 01:00 → 오늘 20261007(아직 행 없음)
const DAYS = ['20261006', '20261005', '20261002', '20261001'];
const stockRow = (day, hm, price) => ({ cntr_tm: `${day}${hm}00`, cur_prc: `-${price}`, trde_qty: '10', open_pric: String(price), high_pric: String(price + 1), low_pric: String(price - 1), pred_pre: '-1', pred_pre_sig: '5', extra: 'x' });
const indexRow = (day, hm, price) => ({ cntr_tm: `${day}${hm}00`, cur_prc: `-${price}`, trde_qty: '5', open_pric: String(price), high_pric: String(price), low_pric: String(price) });
const stockRows = DAYS.flatMap((day, i) => ['0900', '0901', '1530'].map((hm, j) => stockRow(day, hm, 100 + i * 10 + j)));
const indexRows = DAYS.flatMap((day, i) => ['0900', '0901', '1530'].map((hm, j) => indexRow(day, hm, 300000 + i)));
// 키움 흉내: base_dt(없으면 오늘)까지의 행을 최신순으로, 한 쪽에 두 날치만 주고 더 있으면 cont-yn Y.
function kiwoom(calls) {
    return async (url, body, options) => {
        const id = options.headers['api-id'];
        calls.push({ id, base: body.base_dt || '', scope: body.tic_scope, upd: body.upd_stkpc_tp });
        const source = id === 'ka10080' ? stockRows : indexRows, field = id === 'ka10080' ? 'stk_min_pole_chart_qry' : 'inds_min_pole_qry';
        const base = body.base_dt || '20261007';
        const days = [...new Set(source.map(r => r.cntr_tm.slice(0, 8)).filter(d => d <= base))].sort().reverse();
        const page = days.slice(0, 2), more = days.length > 2;
        const list = source.filter(r => page.includes(r.cntr_tm.slice(0, 8))).sort((a, b) => b.cntr_tm.localeCompare(a.cntr_tm));
        return { data: { return_code: 0, [field]: list }, headers: { 'cont-yn': more ? 'Y' : 'N', 'next-key': more ? 'k' : '' } };
    };
}
function tempDir(t) {
    const root = fs.mkdtempSync(path.join(path.resolve(__dirname, '../output'), 'kiwoom-minute-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
const concentration = (store, calls, keep = true) => createConcentrationChartService({ axios: { post: kiwoom(calls) },
    marketCache: { '005930': { type: 'K', code: '0' } }, getAccessToken: async () => 'token', now: () => NOW, pause: async () => {},
    minuteStore: store, keepStock: () => keep });
const files = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter(f => /\.(gz|tmp)$/.test(f)).map(f => f.replaceAll('\\', '/')).sort() : [];

test('쏠림율 1분봉: 처음엔 날마다 키움에서 받아 끝난 날만 한 번씩 저장하고, 다음 조회는 저장 파일만 읽어 같은 값을 낸다', async t => {
    const dir = tempDir(t), store = createKiwoomMinuteStore({ directory: dir });
    const calls = [];
    const first = await concentration(store, calls).query({ code: '005930', mode: 'minute', interval: 1 }, 'owner');
    assert.equal(first.has_more, false);
    assert.equal(first.points.length, 12);
    // 오늘(행 없음) 1번 + 지난 4일 종목 · 업종 각 1번. 모두 1분봉 · 분봉은 실제 체결값(0).
    assert.deepEqual(calls.filter(c => c.id === 'ka10080').map(c => c.base), ['', ...DAYS]);
    assert.deepEqual(calls.filter(c => c.id === 'ka20005').map(c => c.base), DAYS);
    assert.ok(calls.every(c => c.scope === '1') && calls.filter(c => c.id === 'ka10080').every(c => c.upd === '0'));
    const saved = files(dir);
    assert.deepEqual(saved, [...DAYS.map(d => `001/${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}.json.gz`), ...DAYS.map(d => `005930_AL/${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}.json.gz`)].sort());
    // 원본 칸만(쏠림율 같은 계산값 · 쓰지 않는 칸 없음), 그날 행만.
    const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, '005930_AL', '2026-10-05.json.gz'))));
    assert.equal(raw.prev, '20261002'); assert.equal(raw.rows.length, 3); assert.equal(raw.rows[0].length, 8);
    assert.ok(!JSON.stringify(raw).includes('"x"'));
    const mtimes = saved.map(f => fs.statSync(path.join(dir, f)).mtimeMs);

    // 새 세션(서버 재시작과 같음): 오늘만 키움, 지난날은 파일. 값은 처음과 같다.
    const again = [];
    const second = await concentration(createKiwoomMinuteStore({ directory: dir }), again).query({ code: '005930', mode: 'minute', interval: 1 }, 'owner');
    assert.deepEqual(again.map(c => [c.id, c.base]), [['ka10080', '']]);
    assert.deepEqual(second.points, first.points);
    // 같은 날을 다시 쓰지 않았다(한 벌, 임시 파일 없음).
    assert.deepEqual(files(dir), saved);
    assert.deepEqual(saved.map(f => fs.statSync(path.join(dir, f)).mtimeMs), mtimes);
});

test('미등록 종목은 저장하지 않고(업종 지수만 저장) 5분봉 같은 다른 간격은 저장 파일을 만들지 않는다', async t => {
    const dir = tempDir(t), store = createKiwoomMinuteStore({ directory: dir });
    await concentration(store, [], false).query({ code: '005930', mode: 'minute', interval: 1 }, 'owner');
    assert.ok(files(dir).every(f => f.startsWith('001/')) && files(dir).length === 4);
    const other = tempDir(t);
    await concentration(createKiwoomMinuteStore({ directory: other }), []).query({ code: '005930', mode: 'minute', interval: 5 }, 'owner');
    assert.deepEqual(files(other), []);
});

test('과거 구간 보기(base_dt)도 그날부터 날짜 단위로 넘기고, 이어 보기는 저장된 이전 날을 키움 없이 읽는다', async t => {
    const dir = tempDir(t), store = createKiwoomMinuteStore({ directory: dir });
    await concentration(store, []).query({ code: '005930', mode: 'minute', interval: 1 }, 'owner');
    const calls = [];
    const api = concentration(store, calls);
    const window = await api.query({ code: '005930', mode: 'minute', interval: 1, base_dt: '20261005' }, 'owner');
    assert.deepEqual(calls, []);
    assert.deepEqual([...new Set(window.points.map(p => p.time.slice(0, 8)))], ['20261001', '20261002', '20261005']);
});

test('그날을 다 덮지 못한 응답 · 오늘 · 빈 날은 저장 대상이 아니다', () => {
    const rows = [stockRow('20261006', '1530', 1), stockRow('20261006', '0900', 1)];
    assert.equal(completeDay(rows, '20261006', '20261007', true).storable, false, '더 이전 날 행 없이 연속조회가 남음');
    assert.equal(completeDay(rows, '20261006', '20261007', false).storable, true, '연속조회 끝(상장 첫날)');
    assert.equal(completeDay([...rows, stockRow('20261005', '1530', 1)], '20261006', '20261006', true).storable, false, '오늘');
    assert.equal(completeDay([stockRow('20261005', '1530', 1)], '20261006', '20261007', true).storable, false, '그날 행 없음');
    const full = completeDay([...rows, stockRow('20261005', '1530', 1)], '20261006', '20261007', true);
    assert.equal(full.storable, true); assert.equal(full.prev, '20261005'); assert.equal(full.rows.length, 2);
});

test('저장소: 이미 있는 날은 다시 쓰지 않고, 다른 날 행 · 같은 시각 겹침은 저장하지 않는다', t => {
    const dir = tempDir(t), store = createKiwoomMinuteStore({ directory: dir });
    assert.equal(store.save('005930_AL', '20261006', [stockRow('20261006', '0900', 1)], '20261005'), true);
    assert.equal(store.save('005930_AL', '20261006', [stockRow('20261006', '0900', 2)], '20261005'), false);
    assert.equal(store.read('005930_AL', '20261006').rows[0].cur_prc, '-1');
    assert.throws(() => store.save('005930_AL', '20261002', [stockRow('20261001', '0900', 1)], null));
    assert.throws(() => store.save('005930_AL', '20261002', [stockRow('20261002', '0900', 1), stockRow('20261002', '0900', 1)], null));
    assert.equal(store.save('../x', '20261006', [stockRow('20261006', '0900', 1)], null), false);
    assert.deepEqual(files(dir), ['005930_AL/2026-10-06.json.gz']);
});

test('종목수급 캔들과 쏠림율은 같은 저장 파일을 함께 쓴다(한 벌)', async t => {
    const dir = tempDir(t), store = createKiwoomMinuteStore({ directory: dir });
    const supplyDir = path.join(dir, '..', path.basename(dir) + '-supply'); t.after(() => fs.rmSync(supplyDir, { recursive: true, force: true }));
    const calls = [];
    const supply = createSupplyService({ directory: supplyDir, http: { post: kiwoom(calls) }, getToken: async () => 'token',
        resolveStock: async code => ({ code, name: '삼성전자' }), now: () => NOW.getTime(), pause: async () => {}, log: () => {}, minuteStore: store });
    supply.store.configure([{ code: '005930', name: '삼성전자' }], 0);
    // 종목수급 캔들이 먼저 받아 저장 → 쏠림율은 그 날을 키움 없이 읽는다.
    const candles = await supply.candles({ code: '005930', mode: 'minute', date: '2026-10-05' });
    assert.deepEqual(calls.map(c => [c.id, c.base, c.upd]), [['ka10080', '20261005', '0']]);
    assert.equal(candles.cursor, '20261002');
    assert.deepEqual(files(dir), ['005930_AL/2026-10-05.json.gz']);
    const again = await supply.candles({ code: '005930', mode: 'minute', date: '2026-10-05' });
    assert.equal(calls.length, 1, '두 번째는 파일');
    assert.deepEqual(again.points, candles.points); assert.equal(again.cursor, candles.cursor);
    const conc = [];
    const result = await concentration(store, conc).query({ code: '005930', mode: 'minute', interval: 1, base_dt: '20261005', prices_only: true }, 'owner');
    assert.ok(!conc.some(c => c.id === 'ka10080' && c.base === '20261005'));
    assert.deepEqual(result.points.filter(p => p.time.startsWith('20261005')).map(p => p.stock_price), candles.points.map(p => p.close));
    // 쏠림율이 저장한 날도 종목수급 캔들이 그대로 읽는다.
    const before = calls.length;
    await supply.candles({ code: '005930', mode: 'minute', date: '2026-10-02' });
    assert.equal(calls.length, before);
    assert.deepEqual(files(dir).filter(f => f.startsWith('005930_AL/')), ['005930_AL/2026-10-01.json.gz', '005930_AL/2026-10-02.json.gz', '005930_AL/2026-10-05.json.gz']);
});

test('쏠림율 1분봉 이어 보기는 이번에 받은 날만 보낸다(쌓인 날 전체를 다시 보내지 않음, 2026-11-22 오라클 메모리 재시작)', async t => {
    const dir = tempDir(t), store = createKiwoomMinuteStore({ directory: dir });
    // 하루 500봉: 첫 쪽은 900봉이 넘을 때까지(두 날), 다음 쪽은 나머지 두 날.
    const many = DAYS.flatMap((day, i) => Array.from({ length: 500 }, (_, m) => stockRow(day, String(800 + Math.floor(m / 60) * 100 + m % 60).padStart(4, '0'), 100 + i)));
    const idx = DAYS.flatMap((day, i) => Array.from({ length: 500 }, (_, m) => indexRow(day, String(800 + Math.floor(m / 60) * 100 + m % 60).padStart(4, '0'), 300000 + i)));
    const post = async (url, body, options) => {
        const id = options.headers['api-id'], source = id === 'ka10080' ? many : idx, field = id === 'ka10080' ? 'stk_min_pole_chart_qry' : 'inds_min_pole_qry';
        const base = body.base_dt || '20261007', days = [...new Set(source.map(r => r.cntr_tm.slice(0, 8)).filter(d => d <= base))].sort().reverse();
        const page = days.slice(0, 2), list = source.filter(r => page.includes(r.cntr_tm.slice(0, 8))).sort((a, b) => b.cntr_tm.localeCompare(a.cntr_tm));
        return { data: { return_code: 0, [field]: list }, headers: { 'cont-yn': days.length > 2 ? 'Y' : 'N', 'next-key': days.length > 2 ? 'k' : '' } };
    };
    const api = createConcentrationChartService({ axios: { post }, marketCache: { '005930': { type: 'K', code: '0' } }, getAccessToken: async () => 'token',
        now: () => NOW, pause: async () => {}, minuteStore: store, keepStock: () => true });
    const first = await api.query({ code: '005930', mode: 'minute', interval: 1 }, 'owner');
    const days = r => [...new Set(r.points.map(p => p.time.slice(0, 8)))].sort();
    assert.deepEqual(days(first), ['20261005', '20261006']); assert.equal(first.has_more, true);
    const second = await api.query({ code: '005930', mode: 'minute', interval: 1, cursor: first.cursor }, 'owner');
    assert.deepEqual(days(second), ['20261001', '20261002'], '두 번째 쪽에는 새 날만');
    assert.notEqual(second.history_progress, first.history_progress, '더 불러오기가 진행으로 본다');
    // 날을 나눠 계산해도 한 번에 계산한 값과 같다.
    const whole = await createConcentrationChartService({ axios: { post }, marketCache: { '005930': { type: 'K', code: '0' } }, getAccessToken: async () => 'token',
        now: () => NOW, pause: async () => {} }).query({ code: '005930', mode: 'minute', interval: 1 }, 'owner');
    const byTime = new Map(whole.points.map(p => [p.time, p.value]));
    for (const p of [...first.points, ...second.points]) if (byTime.has(p.time)) assert.equal(p.value, byTime.get(p.time), p.time);
});
