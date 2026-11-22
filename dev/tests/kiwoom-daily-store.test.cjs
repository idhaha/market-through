// 지난날 키움 일봉 저장(2026-11-22): 오늘 봉은 늘 키움, 끝난 날은 다 받은 구간이면 파일에서 같은 모양(최신순 600봉 · 연속조회)으로 답한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createKiwoomDailyStore } = require('../../kiwoom-daily-store');

const NOW = Date.parse('2026-11-20T06:00:00Z'); // 한국 11/20
const shift = (ymd, d) => new Date(Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10).replaceAll('-', '');
const DAYS = []; for (let d = '20261120'; DAYS.length < 1300; d = shift(d, -1)) { const w = new Date(Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T00:00:00Z`)).getUTCDay(); if (w && w !== 6) DAYS.push(d); }
const LISTED = DAYS.at(-1);
function kiwoom(calls, price = () => '100') {
    return { post: async (url, body, options) => {
        calls.push({ api: options.headers['api-id'], base: body.base_dt, next: options.headers['next-key'] || '' });
        const rows = DAYS.filter(d => d <= body.base_dt).slice(0, 600).map(dt => ({ dt, cur_prc: price(dt), open_pric: '1', high_pric: '2', low_pric: '1' }));
        const more = DAYS.filter(d => d <= body.base_dt).length > 600;
        return { data: { return_code: 0, stk_dt_pole_chart_qry: rows }, headers: { 'cont-yn': more ? 'Y' : 'N', 'next-key': more ? 'KIWOOM-KEY' : '' } };
    } };
}
function setup(t) {
    const directory = fs.mkdtempSync(path.join(path.resolve(__dirname, '../output'), 'kiwoom-daily-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}
const ask = (http, base, next = '') => http.post('https://api.kiwoom.com/api/dostk/chart', { stk_cd: '005930_AL', upd_stkpc_tp: '1', base_dt: base },
    { headers: { 'api-id': 'ka10081', 'cont-yn': next ? 'Y' : 'N', 'next-key': next } });
async function walk(http) {
    const pages = []; let next = '';
    for (;;) { const r = await ask(http, '20261120', next); pages.push(r); if (r.headers['cont-yn'] !== 'Y') break; next = r.headers['next-key']; }
    return pages;
}

test('처음엔 키움에서 받아 끝난 날을 저장하고, 재시작 뒤에는 오늘 쪽만 키움 · 지난 쪽은 파일에서 같은 값으로 답한다', async t => {
    const directory = setup(t), calls = [];
    const first = await walk(createKiwoomDailyStore({ directory, now: () => NOW, log: () => {} }).wrap(kiwoom(calls)));
    assert.equal(first.length, 3); assert.equal(calls.length, 3);
    assert.ok(first[0].headers['next-key'].startsWith('store:'), '연속조회도 날짜 기준');
    assert.deepEqual(calls.map(c => c.next), ['', '', ''], '키움에는 base_dt로만 묻는다');
    const all = first.flatMap(p => p.data.stk_dt_pole_chart_qry.map(r => r.dt));
    assert.equal(all.length, 1300); assert.equal(all[0], '20261120'); assert.equal(all.at(-1), LISTED);
    calls.length = 0;
    const again = await walk(createKiwoomDailyStore({ directory, now: () => NOW, log: () => {} }).wrap(kiwoom(calls)));
    assert.equal(calls.length, 1, '오늘이 든 첫 쪽만 키움');
    assert.deepEqual(again.flatMap(p => p.data.stk_dt_pole_chart_qry.map(r => r.dt)), all);
    assert.equal(again.at(-1).headers['cont-yn'], 'N', '상장 첫날에서 끝난다');
    // 지난날 기준일(base_dt) 요청도 파일에서.
    calls.length = 0;
    const past = await ask(createKiwoomDailyStore({ directory, now: () => NOW, log: () => {} }).wrap(kiwoom(calls)), '20250102');
    assert.equal(calls.length, 0); assert.equal(past.data.stk_dt_pole_chart_qry[0].dt <= '20250102', true);
});

test('겹치는 날 종가가 바뀌면(수정주가) 저장본을 버리고 새로 쌓는다', async t => {
    const directory = setup(t), calls = [];
    await walk(createKiwoomDailyStore({ directory, now: () => NOW, log: () => {} }).wrap(kiwoom(calls)));
    const changed = kiwoom(calls, dt => dt < '20260801' ? '50' : '100'); // 8월 전 봉이 반으로(병합 반영 등)
    const http = createKiwoomDailyStore({ directory, now: () => NOW, log: () => {} }).wrap(changed);
    await walk(http);
    calls.length = 0;
    const past = await ask(createKiwoomDailyStore({ directory, now: () => NOW, log: () => {} }).wrap(changed), '20260310');
    assert.equal(past.data.stk_dt_pole_chart_qry[0].cur_prc, '50');
});

test('다른 API와 예전 키움 연속조회 키는 그대로 지나간다', async t => {
    const directory = setup(t), seen = [];
    const http = createKiwoomDailyStore({ directory, now: () => NOW, log: () => {} }).wrap({ post: async (url, body, options) => { seen.push(options.headers['api-id']); return { data: { return_code: 0 }, headers: {} }; } });
    await http.post('https://api.kiwoom.com/api/dostk/chart', { stk_cd: '005930_AL' }, { headers: { 'api-id': 'ka10060' } });
    await http.post('https://api.kiwoom.com/api/dostk/chart', { stk_cd: '005930_AL', base_dt: '20261120' }, { headers: { 'api-id': 'ka10081', 'cont-yn': 'Y', 'next-key': 'KIWOOM' } });
    assert.deepEqual(seen, ['ka10060', 'ka10081']);
});
