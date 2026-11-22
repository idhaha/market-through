// 지난 구간 지수 1분봉(2026-11-22): 오늘부터 거슬러 오지 않고 그날 파일을 읽거나 키움 base_dt로 그날만 받아 저장한다.
// 시장 수급 카드의 지난날 가격도 같은 길을 쓴다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createIndexCandleStore } = require('../../index-candle-store');
const { createKiwoomMinuteStore } = require('../../kiwoom-minute-store');
const { createChartReferenceService } = require('../../chart-reference-service');

const NOW = Date.parse('2026-10-07T01:00:00Z'); // 한국 10/07 10:00
const DAYS = ['20261006', '20261005', '20261002', '20261001']; // 10/03~04 휴장
const row = (day, hm, close) => ({ cntr_tm: `${day}${hm}00`, open_pric: String(close), high_pric: String(close), low_pric: String(close), cur_prc: String(close), trde_qty: '2' });
function kiwoom(calls) {
    return { post: async (url, body, options) => {
        calls.push({ api: options.headers['api-id'], base: body.base_dt || '', code: body.inds_cd });
        const base = body.base_dt || '20261007', days = DAYS.filter(d => d <= base).slice(0, 2);
        const rows = days.flatMap((d, i) => ['1530', '0900'].map(hm => row(d, hm, 300000 + Number(d.slice(-2)) * 100)));
        return { data: { return_code: 0, inds_min_pole_qry: rows }, headers: DAYS.filter(d => d <= base).length > 2 ? { 'cont-yn': 'Y', 'next-key': 'k' } : {} };
    } };
}
function setup(t) {
    const dir = fs.mkdtempSync(path.join(path.resolve(__dirname, '../output'), 'index-past-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const calls = [], minuteStore = createKiwoomMinuteStore({ directory: dir });
    const store = createIndexCandleStore({ http: kiwoom(calls), getToken: async () => 'token', now: () => NOW, pause: async () => {}, log: () => {}, minuteStore });
    return { dir, calls, store };
}

test('지난 구간은 그날만 받고(base_dt) 끝난 날을 저장하며, 다시 보면 키움을 부르지 않는다', async t => {
    const { dir, calls, store } = setup(t);
    const first = await store.range({ market: 'kospi', mode: 'minute', from: '20261002', to: '20261005' });
    assert.deepEqual(calls.map(c => c.base), ['20261005', '20261002'], '오늘부터 거슬러 오지 않고 구간 끝 날짜부터 하루씩');
    assert.deepEqual([...new Set(first.points.map(p => new Date(p.t + 9 * 3600000).toISOString().slice(0, 10)))], ['2026-10-02', '2026-10-05']);
    assert.equal(first.previousDay, '20261001');
    assert.deepEqual(fs.readdirSync(path.join(dir, '001')).sort(), ['2026-10-02.json.gz', '2026-10-05.json.gz']);
    const again = await store.range({ market: 'kospi', mode: 'minute', from: '20261002', to: '20261005' });
    assert.equal(calls.length, 2, '두 번째는 저장 파일');
    assert.deepEqual(again.points, first.points);
    // 휴장일(10/04)로 끝나는 구간도 그 전 거래일부터.
    const weekend = await store.range({ market: 'kospi', mode: 'minute', from: '20261002', to: '20261004' });
    assert.deepEqual([...new Set(weekend.points.map(p => new Date(p.t + 9 * 3600000).toISOString().slice(0, 10)))], ['2026-10-02']);
});

test('오늘이 든 범위는 예전처럼 최신부터 받는다', async t => {
    const { calls, store } = setup(t);
    await store.range({ market: 'kospi', mode: 'minute', from: '20261006', to: '20261007' });
    assert.equal(calls[0].base, '', '최신 쪽부터');
});

test('차트 기준 서비스는 지난 구간 범위를 그대로 넘긴다', async t => {
    const { store } = setup(t);
    const reference = createChartReferenceService({ store });
    const result = await reference.range({ market: 'kospi', mode: 'minute', from: '20261005', to: '20261005' });
    assert.equal(result.points.length, 2); assert.equal(result.previousDay, '20261002');
});
