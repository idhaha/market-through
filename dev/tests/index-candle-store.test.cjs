// Shared index candle store: one Kiwoom series per market/mode, sliced per chart request.
const assert = require('node:assert/strict');
const { createIndexCandleStore, FRESH_MS } = require('../../index-candle-store');

const kst = s => Date.parse(s.replace(' ', 'T') + '+09:00');
const row = (stamp, close = 100000) => ({ cntr_tm: stamp, open_pric: String(close), high_pric: String(close), low_pric: String(close), cur_prc: String(close), trde_qty: '1' });

function fakeKiwoom(clock) {
    const calls = [];
    // Newest-first minute rows; three rows per page like a tiny Kiwoom page.
    const minutes = { '001': [], '101': [] };
    const add = (code, stamp, close) => minutes[code].unshift(row(stamp, close));
    for (const code of ['001', '101']) for (const s of ['20261028090000', '20261028153000', '20261029090000', '20261029100000', '20261029131000', '20261030090000', '20261030153000']) add(code, s, code === '001' ? 300000 : 70000);
    let fail = false;
    const http = { post: async (url, body, options) => {
        calls.push({ code: body.inds_cd, api: options.headers['api-id'], next: options.headers['next-key'] });
        if (fail) throw Object.assign(new Error('network'), { code: 'ECONNRESET' });
        if (body.tic_scope) {
            const visible = minutes[body.inds_cd].filter(r => kst(`${r.cntr_tm.slice(0,4)}-${r.cntr_tm.slice(4,6)}-${r.cntr_tm.slice(6,8)} ${r.cntr_tm.slice(8,10)}:${r.cntr_tm.slice(10,12)}:00`) <= clock.now);
            const offset = Number(options.headers['next-key'] || 0), rows = visible.slice(offset, offset + 3);
            return { data: { inds_min_pole_qry: rows }, headers: offset + 3 < visible.length ? { 'cont-yn': 'Y', 'next-key': String(offset + 3) } : {} };
        }
        const days = [{ dt: '20261030', open_pric: '300000', high_pric: '301000', low_pric: '299000', cur_prc: '300500', trde_prica: '10,000,000' }, { dt: '20261029', open_pric: '299000', high_pric: '300000', low_pric: '298000', cur_prc: '299500', trde_prica: '9,000,000' }];
        return { data: { inds_dt_pole_qry: days }, headers: {} };
    } };
    return { http, calls, add, setFail: v => { fail = v; } };
}

(async () => {
    const clock = { now: kst('2026-10-30 16:00:00') };
    const kiwoom = fakeKiwoom(clock);
    const store = createIndexCandleStore({ http: kiwoom.http, getToken: async () => 'token', now: () => clock.now, pause: async () => {}, log: () => {} });
    const times = r => r.points.map(p => new Date(p.t + 9 * 3600000).toISOString().slice(5, 16));

    // Three charts ask at once with different ranges: one Kiwoom load, identical candles for shared days.
    const [adr, breadth, supply] = await Promise.all([
        store.range({ market: 'kosdaq', mode: 'minute', from: '20261029', to: '20261030' }),
        store.range({ market: 'kosdaq', mode: 'minute', from: '20261029', to: '20261030' }),
        store.range({ market: 'kosdaq', mode: 'minute', from: '20261030', to: '20261030' })
    ]);
    assert.deepEqual(times(adr), ['10-29T09:00', '10-29T10:00', '10-29T13:10', '10-30T09:00', '10-30T15:30'], 'oldest requested day keeps its morning');
    assert.deepEqual(times(breadth), times(adr));
    assert.deepEqual(times(supply), ['10-30T09:00', '10-30T15:30']);
    assert.equal(adr.partial, false);
    const firstLoad = kiwoom.calls.length;
    assert.ok(kiwoom.calls.every(c => c.code === '101' && c.api === 'ka20005'));

    // Within the fresh window nothing is fetched again.
    await store.range({ market: 'kosdaq', mode: 'minute', from: '20261029', to: '20261030' });
    assert.equal(kiwoom.calls.length, firstLoad, 'cached slice served without Kiwoom calls');

    // Markets are separate series.
    const kospi = await store.range({ market: 'kospi', mode: 'minute', from: '20261030', to: '20261030' });
    assert.equal(kospi.points[0].close, 3000);
    assert.ok(kiwoom.calls.slice(firstLoad).every(c => c.code === '001'));

    // A new minute today: after the fresh window only the tail is fetched (stops at known data).
    kiwoom.add('101', '20261030153100', 71000);
    clock.now = kst('2026-10-30 16:00:00') + FRESH_MS.minute + 1000;
    const before = kiwoom.calls.length;
    const refreshed = await store.range({ market: 'kosdaq', mode: 'minute', from: '20261030', to: '20261030' });
    assert.deepEqual(times(refreshed), ['10-30T09:00', '10-30T15:30', '10-30T15:31']);
    assert.equal(kiwoom.calls.length - before, 1, 'tail refresh reads one page');

    // Past-only ranges do not refresh the tail.
    clock.now += FRESH_MS.minute + 1000;
    const pastBefore = kiwoom.calls.length;
    await store.range({ market: 'kosdaq', mode: 'minute', from: '20261029', to: '20261029' });
    assert.equal(kiwoom.calls.length, pastBefore, 'historical range is served from memory');

    // Deeper history triggers one more load and keeps the oldest day complete.
    const deeper = await store.range({ market: 'kosdaq', mode: 'minute', from: '20261028', to: '20261030' });
    assert.deepEqual(times(deeper).slice(0, 2), ['10-28T09:00', '10-28T15:30']);

    // A failed refresh keeps the previous series intact; the next request recovers.
    clock.now += FRESH_MS.minute + 1000;
    kiwoom.setFail(true);
    await assert.rejects(store.range({ market: 'kosdaq', mode: 'minute', from: '20261030', to: '20261030' }));
    kiwoom.setFail(false);
    const recovered = await store.range({ market: 'kosdaq', mode: 'minute', from: '20261030', to: '20261030' });
    assert.deepEqual(times(recovered), ['10-30T09:00', '10-30T15:30', '10-30T15:31']);

    // Daily candles keep the reported market turnover.
    const daily = await store.range({ market: 'kospi', mode: 'day', from: '20261029', to: '20261030' });
    assert.deepEqual(daily.points.map(p => p.close), [2995, 3005]);
    assert.ok(Number.isFinite(daily.points[1].market_turnover));

    console.log('PASS index candle store: shared load, oldest-day completeness, tail refresh, history, failure recovery');
})().catch(e => { console.error(e); process.exitCode = 1; });
