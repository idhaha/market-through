const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSupplyService, quantity, timestamp, collectingAt } = require('../../supply-service');
const { createSupplyStore } = require('../../supply-store');

const today = '20261020';
const investorRow = (overrides = {}) => ({ dt: today, ind_invsr: '+10', frgnr_invsr: '--20', orgn: '+30', ...overrides });
function fixture(t, handler) {
    const output = path.resolve(__dirname, '../output'); fs.mkdirSync(output, { recursive: true });
    const directory = fs.mkdtempSync(path.join(output, 'market-supply-test-'));
    let time = timestamp(today, '101500');
    const calls = [];
    const service = createSupplyService({ directory, now: () => time, getToken: async () => 'test-token', pause: async () => {},
        resolveStock: async code => ({ code, name: `종목${code}` }), log: () => {},
        http: { post: async (url, body, options) => {
            calls.push({ url, body, headers: options.headers });
            return handler(options.headers['api-id'], body, options.headers, calls);
        } }
    });
    t.after(() => {
        service.stop();
        assert.equal(path.dirname(path.resolve(directory)), output);
        fs.rmSync(directory, { recursive: true, force: true });
    });
    return { directory, service, calls, setTime: value => { time = value; } };
}
function normal(api, body) {
    if (api === 'ka10081') return { data: { stk_dt_pole_chart_qry: [{ dt: today, open_pric: '100', high_pric: '120', low_pric: '90', cur_prc: '110' }] }, headers: {} };
    if (api === 'ka10060') return { data: { stk_invsr_orgn_chart: [investorRow()] }, headers: {} };
    if (api === 'ka90013') return { data: { stk_daly_prm_trde_trnsn: [{ dt: today, prm_netprps_qty: '-40' }] }, headers: {} };
    if (api === 'ka90008') return { data: { stk_tm_prm_trde_trnsn: [{ tm: '101400', prm_netprps_qty: '--40' }] }, headers: {} };
    throw new Error(`Unexpected API ${api}`);
}

test('sign parsing preserves missing vs zero and collecting hours use Korea time', () => {
    assert.equal(quantity('--1,234'), -1234); assert.equal(quantity('++25'), 25);
    assert.equal(quantity('0'), 0); assert.equal(quantity(''), null); assert.equal(quantity('x'), null);
    assert.equal(collectingAt(timestamp(today, '080000')), true);
    assert.equal(collectingAt(timestamp(today, '200100')), true);
    assert.equal(collectingAt(timestamp(today, '200200')), false);
    assert.equal(collectingAt(timestamp('20261018', '101500')), false);
});
test('five background stocks persist, one row per minute, restart, and removed archives survive', async t => {
    const f = fixture(t, normal), codes = ['005930', '000660', '035420', '035720', '005380'];
    await f.service.configure(codes, 0); await f.service.collect();
    for (const code of codes) {
        const result = await f.service.query({ code, mode: 'minute' });
        assert.equal(result.points.length, 1);
        assert.equal(result.points[0].foreign, -20); assert.equal(result.points[0].program, -40);
        assert.equal(result.points[0].program_at, timestamp(today, '101400'));
    }
    await f.service.collect();
    assert.equal((await f.service.query({ code: codes[0], mode: 'minute' })).points.length, 1);
    f.setTime(timestamp(today, '101600')); await f.service.collect();
    assert.equal((await f.service.query({ code: codes[0], mode: 'minute' })).points.length, 2);
    const restarted = createSupplyStore({ directory: f.directory });
    assert.equal(restarted.config().stocks.length, 5);
    assert.equal(restarted.points(codes[0], '2026-10-20').length, 2);
    await assert.rejects(f.service.configure([...codes, '051910'], 1), /최대 5/);
    await assert.rejects(f.service.configure([codes[0], codes[0]], 1), /중복/);
    await assert.rejects(f.service.configure([codes[0]], 0), /다른 창/);
    await f.service.configure(codes.slice(1), 1); await f.service.collect();
    assert.equal(f.service.summary().stocks.length, 4);
    assert.equal((await f.service.query({ code: codes[0], mode: 'minute' })).points.length, 2);
    await assert.rejects(f.service.query({ code: '../bad', mode: 'minute' }), /잘못된/);
});
test('daily pagination and cache never persist daily source data', async t => {
    const f = fixture(t, (api, body, headers) => {
        if (api === 'ka10081') return { data: { stk_dt_pole_chart_qry: ['20261020','20261019'].map(dt => ({ dt, open_pric: '100', high_pric: '120', low_pric: '90', cur_prc: '110' })) }, headers: {} };
        assert.ok(['ka10060', 'ka90013'].includes(api));
        const field = api === 'ka10060' ? 'stk_invsr_orgn_chart' : 'stk_daly_prm_trde_trnsn';
        const row = api === 'ka10060' ? investorRow() : { dt: today, prm_netprps_qty: '-40' };
        if (headers['next-key']) return { data: { [field]: [{ ...row, dt: '20261019' }] }, headers: {} };
        return { data: { [field]: [row] }, headers: { 'cont-yn': 'Y', 'next-key': 'page2' } };
    });
    f.setTime(timestamp(today, '220000')); // No collector outside market hours.
    await f.service.configure(['005930'], 0);
    const result = await f.service.query({ code: '005930', mode: 'day' });
    assert.equal(result.points.length, 2); assert.equal(result.points[1].foreign, -20); assert.equal(result.points[1].program, -40);
    assert.equal(f.calls.length, 5);
    await f.service.query({ code: '005930', mode: 'day' }); assert.equal(f.calls.length, 5);
    assert.deepEqual(fs.readdirSync(f.directory), ['watchlist.json']);
    assert.ok(f.calls.every(call => (call.headers['api-id'] === 'ka10081' || call.body.amt_qty_tp === '2') && call.body.stk_cd === '005930_AL'));
    assert.ok(f.calls.filter(call => call.headers['api-id'] === 'ka10060').every(call => call.body.unit_tp === '1' && call.body.trde_tp === '0'));
});
test('daily count and dates match one stock candle page, with older pages loaded by cursor', async t => {
    const f = fixture(t, (api, body) => {
        const dates = body.base_dt === '20261018' || body.dt === '20261018' || body.date === '20261018'
            ? ['20261016','20261015'] : ['20261020','20261019'];
        if (api === 'ka10081') return { data: { stk_dt_pole_chart_qry: dates.map(dt => ({ dt, open_pric: '100', high_pric: '120', low_pric: '90', cur_prc: '110' })) },
            headers: dates[0] === today ? { 'cont-yn': 'Y', 'next-key': 'older-page' } : {} };
        if (api === 'ka10060') return { data: { stk_invsr_orgn_chart: [investorRow({ dt: dates[0] }), investorRow({ dt: '20200101' })] }, headers: {} };
        return { data: { stk_daly_prm_trde_trnsn: dates.map(dt => ({ dt, prm_netprps_qty: '-40' })) }, headers: {} };
    });
    f.setTime(timestamp(today, '220000')); await f.service.configure(['005930'], 0);
    const first = await f.service.query({ code: '005930' });
    assert.equal(first.points.length, 2); assert.equal(first.candles.length, 2);
    assert.deepEqual(first.points.map(p => p.t), [timestamp('20261019'), timestamp(today)]);
    assert.equal(first.points[0].foreign, undefined, 'Keep the candle date even if investor data is absent');
    assert.equal(first.has_more, true); assert.equal(first.cursor, '20261018');
    const second = await f.service.query({ code: '005930', cursor: first.cursor });
    assert.equal(second.has_more, false); assert.equal(second.cursor, null);
    assert.deepEqual(second.points.map(p => p.t), [timestamp('20261015'), timestamp('20261016')]);
    assert.ok(f.calls.some(call => call.headers['api-id'] === 'ka10081' && call.body.base_dt === first.cursor));
    assert.deepEqual(fs.readdirSync(f.directory), ['watchlist.json']);
    await assert.rejects(f.service.query({ code: '005930', cursor: 'bad' }), /잘못된/);
});
test('missing source values stay missing, and stale trading dates do not become today', async t => {
    let stale = false;
    const f = fixture(t, api => api === 'ka10060'
        ? { data: { stk_invsr_orgn_chart: [investorRow({ dt: stale ? '20261019' : today, ind_invsr: '', orgn: '0' })] }, headers: {} }
        : normal(api));
    await f.service.configure(['005930'], 0); await f.service.collect();
    const point = (await f.service.query({ code: '005930', mode: 'minute' })).points[0];
    assert.equal(point.individual, undefined); assert.equal(point.institution, 0); assert.equal(point.program, -40);
    assert.match(f.service.summary().statuses['005930'].error, /部分|일부/);
    stale = true; f.setTime(timestamp('20261021', '101500')); await f.service.collect();
    assert.deepEqual(f.service.store.dates('005930'), ['2026-10-20']);
});
test('one failed source or stock does not stop collection of the others', async t => {
    let failProgram = false;
    const f = fixture(t, (api, body) => {
        if (body.stk_cd === '000660_AL' || failProgram && api === 'ka90008') throw new Error('source unavailable');
        return normal(api);
    });
    await f.service.configure(['005930','000660'], 0); await f.service.collect();
    failProgram = true; f.setTime(timestamp(today, '101600')); await f.service.collect();
    const points = (await f.service.query({ code: '005930', mode: 'minute' })).points;
    assert.equal(points.length, 2); assert.equal(points[1].program, undefined); assert.equal(points[1].foreign, -20);
    assert.equal(f.service.summary().statuses['000660'].investor_ok, false);
    assert.match(f.service.summary().statuses['005930'].error, /source unavailable/);
});
test('removing a stock during an in-flight request prevents later writes', async t => {
    let release;
    const f = fixture(t, api => api === 'ka10060' ? new Promise(resolve => { release = () => resolve(normal(api)); }) : normal(api));
    await f.service.configure(['005930'], 0);
    // Wait for the token promise and request queue to reach the deferred HTTP call.
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await f.service.configure([], 1); release(); await f.service.collect();
    assert.deepEqual(f.service.store.dates('005930'), []);
});
test('completed days compress losslessly after 20:02 and archived reads and late updates work', async t => {
    const f = fixture(t, normal);
    await f.service.configure(['005930'], 0); await f.service.collect();
    const original = f.service.store.points('005930', '2026-10-20');
    const file = path.join(f.directory, '005930', '2026-10-20.json');
    const originalSize = fs.statSync(file).size;
    f.setTime(timestamp(today, '200100')); assert.equal(f.service.store.archiveCompleted(), 0);
    f.setTime(timestamp(today, '200200')); assert.equal(f.service.store.archiveCompleted(), 1);
    assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(`${file}.gz`), true);
    assert.ok(fs.statSync(`${file}.gz`).size < originalSize);
    assert.deepEqual(f.service.store.points('005930', '2026-10-20'), original);
    assert.deepEqual((await f.service.query({ code: '005930', mode: 'minute' })).points, original);
    const restarted = createSupplyStore({ directory: f.directory, now: () => timestamp(today, '200300') });
    assert.deepEqual(restarted.dates('005930'), ['2026-10-20']);
    assert.deepEqual(restarted.points('005930', '2026-10-20'), original);
    restarted.merge('005930', { t: timestamp(today, '200100'), program: 77 });
    assert.equal(fs.existsSync(file), false);
    assert.equal(restarted.points('005930', '2026-10-20').at(-1).program, 77);
    assert.equal(restarted.archiveCompleted(), 0);
});
test('startup catch-up archives older and retired stocks while keeping today editable', async t => {
    const f = fixture(t, normal);
    f.service.store.merge('005930', { t: timestamp('20261019', '101500'), foreign: 9 });
    f.service.store.merge('005930', { t: timestamp(today, '101500'), foreign: 10 });
    assert.equal(f.service.store.archiveCompleted(), 1);
    assert.ok(fs.existsSync(path.join(f.directory, '005930', '2026-10-20.json')));
    assert.deepEqual(f.service.store.dates('005930'), ['2026-10-19','2026-10-20']);
    assert.equal(f.service.store.points('005930','2026-10-19')[0].foreign, 9);
});
test('minute cursors load preceding compressed trading days without a date picker', async t => {
    const f = fixture(t, normal); f.setTime(timestamp(today, '220000'));
    await f.service.configure(['005930'], 0);
    for (const day of ['20261016','20261019','20261020']) f.service.store.merge('005930', { t: timestamp(day, '101500'), foreign: -12 });
    assert.equal(f.service.store.archiveCompleted(), 3);
    const first = await f.service.query({ code: '005930', mode: 'minute' });
    assert.equal(first.date, '2026-10-20'); assert.equal(first.cursor, '20261019'); assert.equal(first.has_more, true);
    const second = await f.service.query({ code: '005930', mode: 'minute', cursor: first.cursor });
    assert.equal(second.date, '2026-10-19'); assert.equal(second.cursor, '20261016');
    const third = await f.service.query({ code: '005930', mode: 'minute', cursor: second.cursor });
    assert.equal(third.date, '2026-10-16'); assert.equal(third.has_more, false); assert.equal(third.cursor, null);
    assert.ok(third.points[0].t < second.points[0].t && second.points[0].t < first.points[0].t);
    assert.deepEqual((await f.service.query({ code: '005930', mode: 'minute' })).points, first.points);
});
test('price candles remain available when both daily flow sources fail', async t => {
    const f = fixture(t, api => {
        if (api === 'ka10081') return normal(api);
        throw new Error('수급 API 조회 실패');
    });
    f.setTime(timestamp(today, '220000')); await f.service.configure(['005930'], 0);
    const result = await f.service.query({ code: '005930' });
    assert.equal(result.success, true); assert.equal(result.candles.length, 1); assert.equal(result.points.length, 1);
    assert.equal(result.points[0].foreign, undefined); assert.equal(result.warnings.length, 2);
});
test('minute price-only fallback uses the latest real trading day without writing flow data', async t => {
    const f = fixture(t, api => {
        if (api !== 'ka10080') throw new Error(`Unexpected API ${api}`);
        return { data: { stk_min_pole_chart_qry: [{ cntr_tm: '20261019101500', open_pric: '100', high_pric: '120', low_pric: '90', cur_prc: '110' }] }, headers: {} };
    });
    f.setTime(timestamp(today, '220000')); await f.service.configure(['005930'], 0);
    const flow = await f.service.query({ code: '005930', mode: 'minute' }); assert.equal(flow.points.length, 0);
    const price = await f.service.candles({ code: '005930', mode: 'minute' });
    assert.equal(price.date, '2026-10-19'); assert.equal(price.points.length, 1);
    assert.deepEqual(fs.readdirSync(f.directory), ['watchlist.json']);
});
test('price history advertises previous trading dates even without stored minute flow', async t => {
    const f = fixture(t, api => {
        if (api !== 'ka10080') throw new Error(`Unexpected API ${api}`);
        return { data: { stk_min_pole_chart_qry: ['20261020','20261019','20261016'].map(day => ({
            cntr_tm: day + '101500', open_pric: '100', high_pric: '120', low_pric: '90', cur_prc: '110'
        })) }, headers: {} };
    });
    f.setTime(timestamp(today, '220000')); await f.service.configure(['005930'], 0);
    const flow = await f.service.query({ code: '005930', mode: 'minute' }); assert.equal(flow.has_more, false);
    const first = await f.service.candles({ code: '005930', mode: 'minute' });
    assert.equal(first.has_more, true); assert.equal(first.cursor, '20261019'); assert.equal(first.points.length, 1);
    const olderFlow = await f.service.query({ code: '005930', mode: 'minute', cursor: first.cursor });
    assert.equal(olderFlow.date, '2026-10-19'); assert.equal(olderFlow.points.length, 0);
    const second = await f.service.candles({ code: '005930', mode: 'minute', date: olderFlow.date });
    assert.equal(second.has_more, true); assert.equal(second.cursor, '20261016');
    const third = await f.service.candles({ code: '005930', mode: 'minute', date: '2026-10-16' });
    assert.equal(third.has_more, false); assert.equal(third.points.length, 1);
    assert.deepEqual(fs.readdirSync(f.directory), ['watchlist.json']);
});
