const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConcentrationChartService, calculatePoints } = require('../concentration-chart');

process.env.KIWOOM_APPKEY = 'test-key';
process.env.KIWOOM_SECRETKEY = 'test-secret';
const minute = (time, price = '-100', volume = '10') => ({ cntr_tm: time, cur_prc: price, trde_qty: volume });
const daily = (date, price = '100', volume = '10', turnover = String(Math.abs(Number(price)) * Number(volume))) => ({ dt: date, cur_prc: price, trde_qty: volume, trde_prica: turnover });
const rows = list => new Map(list.map(row => [row.cntr_tm || row.dt, row]));
function service(post, marketCache = { '005930': { type: 'K', code: '0' } }) {
    return createConcentrationChartService({ axios: { post }, marketCache, getAccessToken: async () => 'test-token',
        now: () => new Date('2026-10-06T16:00:00Z'), pause: async () => {} });
}
function response(field, list, nextKey = '') {
    return { data: { return_code: 0, [field]: list }, headers: { 'cont-yn': nextKey ? 'Y' : 'N', 'next-key': nextKey } };
}

test('minute ratios use absolute price, integer volume, same timestamp, and exclude pre-09:00 NXT', () => {
    const stock = rows([minute('20261007080000'), minute('20261007090000'), minute('20261007090100'), minute('20261007090200', '100', '0'), minute('20261007090300')]);
    const market = rows([minute('20261007090000', '+1,000', '10'), minute('20261007090200', '1000', '10'), minute('20261007090300', '1000', '0')]);
    const points = calculatePoints(stock, market, 'minute', 1);
    assert.deepEqual(points.map(point => point.value), [0.1, null, 0, null]);
    assert.equal(points[0].time, '20261007090000');
});

test('minute index estimate applies index /100 and volume *10000 without changing the stock estimate', () => {
    const [point] = calculatePoints(rows([minute('20261007100000', '276000', '198028')]),
        rows([minute('20261007100000', '-693230', '2562')]), 'minute', 1);
    assert.equal(point.stock_turnover, 54655728000);
    assert.equal(point.market_turnover, 177605526000);
    assert(Math.abs(point.value - 30.773664103221655) < 1e-6);
    const [scaled] = calculatePoints(rows([minute('20261007100000', '276000', '198028')]),
        rows([minute('20261007100000', '-693230', '2562')]), 'minute', 1);
    const rawRatio = (276000 * 198028) / (693230 * 2562) * 100;
    assert(Math.abs(scaled.value * 100 - rawRatio) < 1e-9);
});

test('daily ratios align dates and leave unavailable / invalid data blank', () => {
    const points = calculatePoints(rows([daily('20261006', '-100', '10'), daily('20261007', 'invalid', '10')]),
        rows([daily('20261006', '1000', '10'), daily('20261007', '1000', '10')]), 'day', 1);
    assert.deepEqual(points.map(point => point.value), [10, null]);
});

test('daily ratios and diagnostics use actual reported turnover and match the Samsung table', () => {
    const [point] = calculatePoints(rows([daily('20261007', '269000', '24741933', '6746718')]),
        rows([daily('20261007', '680390', '269959', '20576543')]), 'day', 1);
    assert.equal(point.stock_turnover, 6746718000000);
    assert.equal(point.market_turnover, 20576543000000);
    assert.equal(point.stock_price, 269000);
    assert.equal(point.stock_volume, 24741933);
    assert.equal(point.market_price, 680390);
    assert.equal(point.market_volume, 269959);
    assert(Math.abs(point.value - 32.78839404656069) < 1e-9);
    const [missing] = calculatePoints(rows([minute('20261007195900')]), new Map(), 'minute', 1);
    assert.equal(missing.market_turnover, null);
    assert.equal(missing.market_price, null);
    assert.equal(missing.value, null);
});

test('daily turnover does not depend on price or volume and never falls back when turnover is missing', () => {
    const stock = rows([
        daily('20261005', 'invalid', 'invalid', '6,746,718'),
        { dt: '20261006', cur_prc: '269000', trde_qty: '24741933' },
        daily('20261007', '269000', '24741933', '6746718')
    ]);
    const market = rows([
        daily('20261005', 'invalid', 'invalid', '20,576,543'),
        daily('20261006', '680390', '269959', '20576543'),
        daily('20261007', '680390', '269959', '0')
    ]);
    const points = calculatePoints(stock, market, 'day', 1);
    assert.equal(Math.round(points[0].value), 33);
    assert.equal(points[1].value, null);
    assert.equal(points[1].stock_turnover, null);
    assert.equal(points[2].value, null);
});

test('15-minute market candle uses final price times combined volume without mixing dates', () => {
    const points = calculatePoints(rows([minute('20261006090000', '200', '30'), minute('20261007090000', '200', '30')]), rows([
        minute('20261006090000', '1000', '10'), minute('20261006090500', '1500', '10'), minute('20261006091000', '2000', '10'),
        minute('20261007090000', '1000', '30')
    ]), 'minute', 15);
    assert.deepEqual(points.map(point => point.value), [0.1, 0.2]);
});

test('stock and index have separate continuation keys; market coverage catches up; duplicate bars are replaced', async () => {
    const calls = [];
    const api = service(async (url, body, options) => {
        const id = options.headers['api-id'];
        const key = options.headers['next-key'];
        calls.push({ id, key, body });
        if (id === 'ka10080') return key
            ? response('stk_min_pole_chart_qry', [minute('20261007090000'), minute('20261006090000')])
            : response('stk_min_pole_chart_qry', [minute('20261007100000'), minute('20261007090000')], 'stock-2');
        if (!key) return response('inds_min_pole_qry', [minute('20261007100000', '1000')], 'index-2');
        if (key === 'index-2') return response('inds_min_pole_qry', [minute('20261007090000', '1000')], 'index-3');
        return response('inds_min_pole_qry', [minute('20261006090000', '2000')]);
    });
    const input = { code: '005930', mode: 'minute', interval: 1 };
    const first = await api.query(input, 'owner');
    assert.deepEqual(first.points.map(point => point.value), [0.1, 0.1]);
    assert.equal(first.has_more, true);
    const second = await api.query({ ...input, cursor: first.cursor }, 'owner');
    assert.deepEqual(second.points.map(point => point.value), [0.05, 0.1, 0.1]);
    assert.equal(second.has_more, false);
    assert.deepEqual(calls.map(call => call.key), ['', '', 'index-2', 'stock-2', 'index-3']);
    assert.equal(calls[0].body.stk_cd, '005930_AL');
    assert.equal(calls[1].body.inds_cd, '001');
    await assert.rejects(api.query({ ...input, cursor: first.cursor }, 'someone-else'), error => error.status === 410);
});

test('KOSDAQ daily APIs use industry 101 and Korea base date', async () => {
    const calls = [];
    const api = service(async (url, body, options) => {
        calls.push({ body, id: options.headers['api-id'] });
        return options.headers['api-id'] === 'ka10081'
            ? response('stk_dt_pole_chart_qry', [daily('20261007')])
            : response('inds_dt_pole_qry', [daily('20261007', '2000')]);
    }, { '123456': { code: '10', type: 'Q' } });
    const result = await api.query({ code: '123456', mode: 'day', interval: 1 }, 'owner');
    assert.equal(result.market, 'Q');
    assert.equal(result.points[0].value, 5);
    assert.equal(calls[0].body.base_dt, '20261007');
    assert.equal(calls[1].body.inds_cd, '101');
    assert.deepEqual(calls.map(call => call.id), ['ka10081', 'ka20006']);
});

test('all stock minute scopes are accepted and unsupported index scopes use smaller divisors', async () => {
    for (const [interval, expected] of [[1, 1], [3, 3], [5, 5], [10, 10], [15, 5], [30, 30], [45, 5], [60, 30]]) {
        const calls = [];
        const api = service(async (url, body, options) => {
            calls.push(body);
            return options.headers['api-id'] === 'ka10080'
                ? response('stk_min_pole_chart_qry', [minute('20261007090000')])
                : response('inds_min_pole_qry', [minute('20261007090000', '1000')]);
        });
        await api.query({ code: '005930', mode: 'minute', interval }, 'owner');
        assert.equal(calls[0].tic_scope, String(interval));
        assert.equal(calls[1].tic_scope, String(expected));
    }
});

test('failed market lookup never uses a default denominator', async () => {
    let chartCalled = false;
    const api = service(async url => {
        if (url.endsWith('/chart')) chartCalled = true;
        return { data: { return_code: 0, marketCode: '' } };
    }, {});
    await assert.rejects(api.query({ code: '005930', mode: 'minute', interval: 1 }, 'owner'), error => error.status === 422);
    assert.equal(chartCalled, false);
});

test('failed continuation can be retried with the same stock key', async () => {
    let fail = false;
    const keys = [];
    const api = service(async (url, body, options) => {
        if (options.headers['api-id'] === 'ka20005') return response('inds_min_pole_qry', [minute('20261007090000', '1000')]);
        const key = options.headers['next-key']; keys.push(key);
        if (key && fail) throw new Error('temporary failure');
        return response('stk_min_pole_chart_qry', [minute('20261007090000')], key ? '' : 'next-stock');
    });
    const input = { code: '005930', mode: 'minute', interval: 1 };
    const first = await api.query(input, 'owner'); fail = true;
    await assert.rejects(api.query({ ...input, cursor: first.cursor }, 'owner'), /temporary failure/);
    fail = false;
    const retry = await api.query({ ...input, cursor: first.cursor }, 'owner');
    assert.equal(retry.has_more, false);
    assert.deepEqual(keys, ['', 'next-stock', 'next-stock']);
});
