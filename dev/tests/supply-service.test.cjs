const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSupplyService, quantity, timestamp, collectingAt, investorObservationAt } = require('../../supply-service');
const { createSupplyStore } = require('../../supply-store');

const today = '20261020';
test('daily candle endpoint requests only OHLC without investor or program queries',async t=>{
    const f=fixture(t,async api=>{
        assert.equal(api,'ka10081');
        return {data:{stk_dt_pole_chart_qry:[{dt:today,open_pric:'100',high_pric:'110',low_pric:'90',cur_prc:'105'}]},headers:{}};
    });
    f.setTime(timestamp(today,'210000'));
    await f.service.configure(['005930'],0);
    f.calls.length=0;
    const result=await f.service.candles({code:'005930',mode:'day'});
    assert.equal(result.points[0].close,105);
    assert.deepEqual(f.calls.map(c=>c.headers['api-id']),['ka10081']);
});
test('futures require a confirmed session day, including Friday night but excluding weekend and holiday starts', () => {
    const {futuresObservationAt} = require('../../supply-service');
    assert.equal(futuresObservationAt(timestamp('20261023','220000'),'2026-10-23'),true);
    assert.equal(futuresObservationAt(timestamp('20261024','010000'),'2026-10-23'),true);
    assert.equal(futuresObservationAt(timestamp('20261024','060000'),'2026-10-23'),false);
    assert.equal(futuresObservationAt(timestamp('20261024','220000'),'2026-10-24'),false);
    assert.equal(futuresObservationAt(timestamp('20261026','010000'),'2026-10-23'),false);
    assert.equal(futuresObservationAt(timestamp('20261026','220000'),'2026-10-23'),false);
    assert.equal(futuresObservationAt(timestamp('20261026','220000'),undefined),false);
});
const investorRow = (overrides = {}) => ({ dt: today, ind_invsr: '+10', frgnr_invsr: '--20', orgn: '+30', ...overrides });
function fixture(t, handler, marketHandler) {
    const output = path.resolve(__dirname, '../output'); fs.mkdirSync(output, { recursive: true });
    const directory = fs.mkdtempSync(path.join(output, 'market-supply-test-'));
    let time = timestamp(today, '101500');
    const calls = [];
    const service = createSupplyService({ directory, now: () => time, getToken: async () => 'test-token', pause: async () => {},
        resolveStock: async code => ({ code, name: `종목${code}` }), log: () => {},
        http: { post: async (url, body, options) => {
            calls.push({ url, body, headers: options.headers });
            if (options.headers['api-id'] === 'ka10080' && collectingAt(time)) return marketHandler ? marketHandler(body) : { data: { stk_min_pole_chart_qry: [{ cntr_tm: new Date(time + 9 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0,14), trde_qty: '1' }] } };
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
    assert.equal(investorObservationAt(timestamp(today, '153100')), true);
    assert.equal(investorObservationAt(timestamp(today, '153200')), true);
    assert.equal(investorObservationAt(timestamp(today, '200100')), true);
    assert.equal(investorObservationAt(timestamp(today, '200200')), false);
    assert.equal(collectingAt(timestamp('20261018', '101500')), false);
});
test('evening investor polling continues while unchanged observations are not duplicated', async t => {
    let investor = { ind_invsr: '+10', frgnr_invsr: '--20', orgn: '+30' }, program = '--40', programTime = '153000';
    const f = fixture(t, api => {
        if (api === 'ka10060') return { data: { stk_invsr_orgn_chart: [investorRow(investor)] }, headers: {} };
        if (api === 'ka90008') return { data: { stk_tm_prm_trde_trnsn: [{ tm: programTime, prm_netprps_qty: program }] }, headers: {} };
        return normal(api);
    });
    await f.service.configure(['005930'], 0); await f.service.collect();
    f.setTime(timestamp(today, '153000')); await f.service.collect();
    f.setTime(timestamp(today, '153100')); await f.service.collect();
    assert.equal((await f.service.query({ code: '005930', mode: 'minute' })).points.length, 3, 'program remains stored every minute after the investor close');
    investor = { ind_invsr: '+11', frgnr_invsr: '--21', orgn: '+31' };
    f.setTime(timestamp(today, '153100')); await f.service.collect();
    program = '--41'; programTime = '153200'; f.setTime(timestamp(today, '153200')); await f.service.collect();
    f.setTime(timestamp(today, '153300')); await f.service.collect();
    const points = (await f.service.query({ code: '005930', mode: 'minute' })).points;
    assert.deepEqual(points.map(point => [point.individual, point.foreign, point.institution, point.program]), [[10, -20, 30, undefined], [10, -20, 30, -40], [11, -21, 31, -40], [undefined, undefined, undefined, -41], [undefined, undefined, undefined, -41]]);
    assert.equal(f.calls.filter(call => call.headers['api-id'] === 'ka10060').length, 6, 'Investor polling continues after 15:31');
    assert.equal(f.calls.filter(call => call.headers['api-id'] === 'ka90008').length, 6);
});
test('changed individual investor data is collected at 20:01 and stops at 20:02', async t => {
    let foreign = '-20';
    const f = fixture(t, (api, body) => api === 'ka10060'
        ? {data:{stk_invsr_orgn_chart:[investorRow({frgnr_invsr:foreign})]}} : normal(api,body));
    await f.service.configure(['005930'],0); await f.service.collect();
    foreign = '-21'; f.setTime(timestamp(today,'200100')); await f.service.collect();
    assert.equal(f.service.store.points('005930','2026-10-20').at(-1).foreign,-21);
    const count = f.calls.length;
    f.setTime(timestamp(today,'200200')); await f.service.collect();
    assert.equal(f.calls.length,count);
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

test('program history retains received dates when an older page fails', async t => {
    const f = fixture(t, (api, body, headers) => {
        if (api === 'ka10081') return { data: { stk_dt_pole_chart_qry: ['20261020','20261019'].map(dt => ({ dt, open_pric: '100', high_pric: '120', low_pric: '90', cur_prc: '110' })) }, headers: {} };
        if (api === 'ka90013') {
            if (headers['next-key']) throw Error('temporary source failure');
            return { data: { stk_daly_prm_trde_trnsn: [{ dt: today, prm_netprps_qty: '-40' }] }, headers: { 'cont-yn': 'Y', 'next-key': 'older' } };
        }
        return normal(api, body);
    });
    f.service.store.configure([{ code: '005930', name: '삼성전자' }], 0);
    const result = await f.service.query({ code: '005930' });
    assert.equal(result.points.at(-1).program, -40);
    assert.equal(result.points[0].program, undefined);
    assert.ok(result.warnings.some(message => message.includes('ka90013') && message.includes('수신한 구간 표시')));
    assert.equal(f.calls.filter(call => call.headers['api-id'] === 'ka90013').length, 3);
});

test('a transient program history failure is retried before discarding the source', async t => {
    let failed = false;
    const f = fixture(t, (api, body) => {
        if (api === 'ka90013' && !failed) { failed = true; throw Error('temporary source failure'); }
        return normal(api, body);
    });
    f.service.store.configure([{ code: '005930', name: '삼성전자' }], 0);
    const result = await f.service.query({ code: '005930' });
    assert.equal(result.points.at(-1).program, -40); assert.deepEqual(result.warnings, []);
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
    const f = fixture(t, (api, body) => api === 'ka10060'
        ? { data: { stk_invsr_orgn_chart: [investorRow({ dt: stale ? '20261019' : today, ind_invsr: '', orgn: '0' })] }, headers: {} }
        : normal(api, body));
    await f.service.configure(['005930'], 0); await f.service.collect();
    const point = (await f.service.query({ code: '005930', mode: 'minute' })).points[0];
    assert.equal(point.individual, undefined); assert.equal(point.foreign, -20); assert.equal(point.institution, 0); assert.equal(point.program, -40);
    assert.match(f.service.summary().statuses['005930'].error, /일부 투자자/);
    stale = true; f.setTime(timestamp('20261021', '101500')); await f.service.collect();
    assert.deepEqual(f.service.store.dates('005930'), ['2026-10-20']);
});
test('intraday collects all three actual ka10060 values and no ka10063 requests', async t => {
    let latest = { ind_invsr: '111', frgnr_invsr: '--222', orgn: '+333' };
    const f = fixture(t, (api, body) => api === 'ka10060' ? { data: { stk_invsr_orgn_chart: [investorRow(latest)] }, headers: {} } : normal(api, body));
    f.service.store.configure([{ code: '005930', name: '삼성전자' }], 0);
    await f.service.collect();
    latest = { ind_invsr: '121', frgnr_invsr: '--232', orgn: '+343' };
    f.setTime(timestamp(today, '101600')); await f.service.collect();
    const result = await f.service.query({ code: '005930', mode: 'minute' });
    assert.deepEqual(result.points.map(p => [p.individual, p.foreign, p.institution]), [[111,-222,333],[121,-232,343]]);
    assert.equal(result.investor_api, 'ka10060'); assert.equal(result.individual_supported, true);
    assert.ok(!f.calls.some(call => call.headers['api-id'] === 'ka10063'));
    assert.ok(!result.warnings.some(message => message.includes('개인 장중 미지원')));
});

test('one failed source or stock does not stop collection of the others', async t => {
    let failProgram = false;
    const f = fixture(t, (api, body) => {
        if (body.stk_cd === '000660_AL' || failProgram && api === 'ka90008') throw new Error('source unavailable');
        return normal(api, body);
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
    const f = fixture(t, (api, body) => api === 'ka10060' ? new Promise(resolve => { release = () => resolve(normal(api, body)); }) : normal(api, body));
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

test('market probe waits through delayed opening, throttles, persists and survives trading pauses', async t => {
    let rows = [{ cntr_tm: '20261019080000', trde_qty: '10' }];
    const f = fixture(t, normal, () => ({ data: { stk_min_pole_chart_qry: rows } }));
    f.setTime(timestamp(today, '080000'));
    await f.service.configure(['005930'], 0); await f.service.collect();
    assert.equal(f.calls.length, 1); assert.deepEqual(f.service.store.dates('005930'), []);
    await f.service.collect(); assert.equal(f.calls.length, 1);
    f.setTime(timestamp(today, '090100')); rows = [{ cntr_tm: today+'090100', trde_qty: '0' }];
    await f.service.collect(); assert.equal(f.calls.length, 2);
    f.setTime(timestamp(today, '100000')); rows = [{ cntr_tm: today+'100000', trde_qty: '1' }];
    await f.service.collect(); assert.equal(f.service.summary().market_confirmed, true);
    const probes = f.calls.filter(c => c.headers['api-id'] === 'ka10080').length;
    f.setTime(timestamp(today, '110000')); rows = [];
    await f.service.collect();
    assert.equal(f.calls.filter(c => c.headers['api-id'] === 'ka10080').length, probes);
    assert.equal(f.service.store.points('005930', '2026-10-20').length, 2);
    const restarted = createSupplyService({ directory: f.directory, now: () => timestamp(today,'120000'), getToken: async () => 'test', pause: async () => {}, http: { post: async (url, body, options) => { assert.notEqual(options.headers['api-id'],'ka10080'); return normal(options.headers['api-id'],body); } } });
    await restarted.collect(); assert.equal(restarted.summary().market_confirmed, true);
    f.setTime(timestamp('20261021','080000')); await f.service.collect();
    assert.equal(f.service.summary().market_confirmed, false);
});
test('market probe retries errors until 10:30 and does not collect after unconfirmed cutoff', async t => {
    let fail = true;
    const f = fixture(t, normal, () => { if (fail) throw Error('network'); return { data: { stk_min_pole_chart_qry: [] } }; });
    f.setTime(timestamp(today,'102900')); await f.service.configure(['005930'],0); await f.service.collect();
    assert.equal(f.calls.length,1); fail = false;
    f.setTime(timestamp(today,'103000')); await f.service.collect(); assert.equal(f.calls.length,2);
    f.setTime(timestamp(today,'103100')); await f.service.collect(); assert.equal(f.calls.length,2);
    assert.deepEqual(f.service.store.dates('005930'), []);
});
test('10:30 final probe can confirm opening and start collection immediately', async t => {
    const f = fixture(t, normal); f.setTime(timestamp(today,'103000'));
    await f.service.configure(['005930'],0); await f.service.collect();
    assert.equal(f.service.summary().market_confirmed,true);
    assert.equal(f.service.store.points('005930','2026-10-20').length,1);
});


test('daily refresh reuses historical pages and only reloads the latest two trading dates across day rollover',async t=>{
    let nextDay=false;
    const f=fixture(t,(api,body,headers)=>{
        const recent=nextDay?['20261021','20261020']:['20261020','20261019'];
        const old=['20261016','20261015'];
        if(api==='ka10081')return {data:{stk_dt_pole_chart_qry:[...recent,...old].map(dt=>({dt,open_pric:'100',high_pric:'120',low_pric:'90',cur_prc:'110'}))},headers:{}};
        const field=api==='ka10060'?'stk_invsr_orgn_chart':'stk_daly_prm_trde_trnsn';
        const dates=headers['next-key']?old:recent;
        return {data:{[field]:dates.map(dt=>api==='ka10060'?investorRow({dt}):{dt,prm_netprps_qty:'-40'})},headers:headers['next-key']?{}:{'cont-yn':'Y','next-key':'older'}};
    });
    f.setTime(timestamp(today,'220000'));f.service.store.configure([{code:'005930',name:'삼성전자'}],0);
    const first=await f.service.query({code:'005930'});assert.equal(f.calls.length,5);
    f.setTime(timestamp(today,'220101'));
    const refreshed=await f.service.query({code:'005930'});
    assert.equal(f.calls.length,8,'Only one anchor + one page per investor/program API after cache expiry');
    assert.deepEqual(refreshed.points,first.points);
    assert.ok(f.calls.slice(5).every(c=>!c.headers['next-key']));
    nextDay=true;f.setTime(timestamp('20261021','000100'));
    const rolled=await f.service.query({code:'005930'});
    assert.equal(f.calls.length,11);assert.equal(rolled.points.at(-1).t,timestamp('20261021'));
    assert.ok(f.calls.slice(8).every(c=>!c.headers['next-key']));
    assert.deepEqual(fs.readdirSync(f.directory),['watchlist.json'],'No daily cache is written to disk');
});

test('historical daily pages remain cached after latest-data cache expiry',async t=>{
    const f=fixture(t,(api)=>{
        if(api==='ka10081')return {data:{stk_dt_pole_chart_qry:[{dt:'20261016',open_pric:'100',high_pric:'120',low_pric:'90',cur_prc:'110'}]},headers:{}};
        return api==='ka10060'?{data:{stk_invsr_orgn_chart:[investorRow({dt:'20261016'})]},headers:{}}:{data:{stk_daly_prm_trde_trnsn:[{dt:'20261016',prm_netprps_qty:'-40'}]},headers:{}};
    });
    f.setTime(timestamp(today,'220000'));f.service.store.configure([{code:'005930',name:'삼성전자'}],0);
    await f.service.query({code:'005930',cursor:'20261016'});const calls=f.calls.length;
    f.setTime(timestamp(today,'220101'));await f.service.query({code:'005930',cursor:'20261016'});assert.equal(f.calls.length,calls);
});

test('progressive daily exposes investor data while program is blocked and shares one job across polling callers',async t=>{
    let release,started;
    const gate=new Promise(resolve=>{release=resolve;}), programStarted=new Promise(resolve=>{started=resolve;});
    t.after(()=>release());
    const f=fixture(t,async(api,body)=>{if(api==='ka90013'){started();await gate;}return normal(api,body);});
    f.setTime(timestamp(today,'220000'));f.service.store.configure([{code:'005930',name:'삼성전자'}],0);
    const first=await f.service.query({code:'005930',progressive:'1'});assert.equal(first.pending,true);assert.equal(first.candles.length,1);
    await programStarted;
    const partial=await f.service.query({code:'005930',progressive:'1'});
    assert.equal(partial.pending,true);assert.equal(partial.points[0].foreign,-20);assert.equal(partial.points[0].program,undefined);
    await f.service.query({code:'005930',progressive:'1'});assert.equal(f.calls.length,3);
    release();const final=await f.service.query({code:'005930'});assert.equal(final.points[0].program,-40);assert.equal(f.calls.length,3);
});
