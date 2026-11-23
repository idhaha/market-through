// 분봉 캔들의 일봉 기준 이평(2026-11-24, docs/MINUTE_DAILY_MA.md).
//  - 서버(day-ma-service): 저장된 키움 일봉에서 [날짜, 시가, 종가]를 어제까지 돌려주고, 다 받은 구간이면 키움을 부르지 않는다.
//  - 화면(public/day-ma.js): N일선 = (앞 N-1거래일 종가 + 그날 시가) / N. 지난날은 일봉 시가, 오늘은 08:00 이후 첫 분봉 시가.
//    시가 전에는 그리지 않고, 야간 선물 봉은 다음 주간 거래일에 붙인다. 하루 동안 수평선, 날짜가 바뀌는 봉에서 계단.
// 기준값: 사용자가 보낸 키움 HTS 화면(2026-11-23 삼성전자 통합, 시가 174,000)의 10일 195,370.00 · 20일 206,435.00.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), vm = require('node:vm');
const { createKiwoomDailyStore } = require('../../kiwoom-daily-store');
const { createDayMaService } = require('../../day-ma-service');

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/day-ma/005930-daily.json'), 'utf8')).rows;
const NOW = Date.parse('2026-11-23T01:30:00Z'); // 한국 11/23(월) 10:30
const kst = (day, clock) => Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${clock}:00+09:00`);

function storeDirectory(t) {
    const directory = fs.mkdtempSync(path.join(path.resolve(__dirname, '../output'), 'day-ma-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    // 키움 일봉 저장 형식(kiwoom-daily-store): 다 받은 구간 [처음, 11/22]. 시험 자료가 70봉뿐이라 처음 날을 상장 첫날(exhausted)로 둔다.
    const rows = FIXTURE.map(([dt, open, close]) => ({ dt, open_pric: String(open), cur_prc: String(close), high_pric: String(Math.max(open, close)), low_pric: String(Math.min(open, close)) }));
    fs.mkdirSync(path.join(directory, 'ka10081'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'ka10081', '005930_AL_1.json.gz'), zlib.gzipSync(JSON.stringify({ v: 1, rows, ranges: [[FIXTURE[0][0], '20261122']], exhausted: FIXTURE[0][0] })));
    return directory;
}

test('서버: 저장된 일봉 구간이면 키움을 부르지 않고 어제까지 [날짜, 시가, 종가]를 준다', async t => {
    const calls = [];
    const http = createKiwoomDailyStore({ directory: storeDirectory(t), now: () => NOW }).wrap({ post: async (...args) => { calls.push(args); throw new Error('키움을 부르면 안 됩니다'); } });
    const service = createDayMaService({ kiwoomHttp: http, getKiwoomToken: async () => 'token', now: () => NOW });
    const result = await service.query({ target: 'stock:005930', from: '20261117', to: '20261123' });
    assert.equal(calls.length, 0);
    assert.equal(result.through, '20261122', '오늘(11/23) 봉은 빼고 어제까지');
    assert.equal(result.rows.at(-1)[0], '20261120');
    assert.deepEqual(result.rows.at(-1), ['20261120', 190800, 180900]);
    assert.ok(result.rows.filter(([d]) => d < '20261117').length >= 59, '60일선에 필요한 앞선 59거래일 이상');
    // 같은 요청은 서버 메모리에서 바로 답한다.
    assert.equal(await service.query({ target: 'stock:005930', from: '20261117', to: '20261123' }), result);
});

test('서버: 잘못된 대상 · 날짜는 400', async () => {
    const service = createDayMaService({ kiwoomHttp: { post: async () => { throw new Error('부르면 안 됨'); } }, getKiwoomToken: async () => 'x', now: () => NOW });
    for (const input of [{ target: 'stock:../x', from: '20261117', to: '20261123' }, { target: 'index:nasdaq', from: '20261117', to: '20261123' },
        { target: 'stock:005930', from: '20261131', to: '20261201' }, { target: 'stock:005930', from: '20261123', to: '20261117' }])
        await assert.rejects(service.query(input), error => error.status === 400, JSON.stringify(input));
});

test('서버: 지수 일봉은 100으로 나누고, 선물은 각 서비스의 일봉을 쓴다', async () => {
    const bodies = [];
    const kiwoomHttp = { post: async (url, body, options) => { bodies.push([options.headers['api-id'], body]);
        return { data: { return_code: 0, inds_dt_pole_qry: [{ dt: '20261120', open_pric: '492851', cur_prc: '486996' }, { dt: '20261123', open_pric: '480000', cur_prc: '481000' }] }, headers: { 'cont-yn': 'N' } }; } };
    const at = day => Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00+09:00`);
    const stockFutures = { candles: async input => ({ points: [{ t: at('20261120'), open: 190000, close: 181000 }, { t: at('20261123'), open: 175000, close: 176000 }], input }) };
    const indexFutures = { sessionDaily: async (code, from, to) => ({ candles: [{ t: at('20261120'), open: 650.5, close: 640.25 }], args: [code, from, to] }) };
    const service = createDayMaService({ kiwoomHttp, getKiwoomToken: async () => 'x', stockFutures, indexFutures, now: () => NOW });
    const index = await service.query({ target: 'index:kospi', from: '20261120', to: '20261123' });
    assert.deepEqual(bodies[0], ['ka20006', { inds_cd: '001', base_dt: '20261122' }]);
    assert.deepEqual(index.rows, [['20261120', 4928.51, 4869.96]], '오늘 봉은 빼고 지수는 /100');
    assert.deepEqual((await service.query({ target: 'stockFutures:005930', from: '20261120', to: '20261123' })).rows, [['20261120', 190000, 181000]]);
    assert.deepEqual((await service.query({ target: 'indexFutures:futures', from: '20261120', to: '20261123' })).rows, [['20261120', 650.5, 640.25]]);
});

// ---- 화면 계산(public/day-ma.js)을 node에서 돌린다: fetch는 서버 응답을 흉내 내고, 캔버스는 그린 경로를 남긴다.
function loadClient({ now, rows, through = '20261122' }) {
    const requests = [];
    const window = {};
    const context = vm.createContext({ window, console, Date: class extends Date { static now() { return now; } }, Map, Set, Number, String, Math, Array, Object, encodeURIComponent,
        fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ success: true, rows, through }) }; } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/day-ma.js'), 'utf8'), context);
    return { api: window.RankDayMa, requests };
}
function recorder() {
    const paths = [];
    let current = null;
    return { paths, ctx: { save() {}, restore() {}, clip() {}, rect() {}, setLineDash() {}, set lineWidth(v) { this._w = v; }, get lineWidth() { return this._w; },
        set strokeStyle(v) { this._s = v; }, beginPath() { current = { color: this._s, points: [] }; },
        moveTo(x, y) { current.points.push(['M', x, y]); }, lineTo(x, y) { current.points.push(['L', x, y]); }, stroke() { if (current.points.length) paths.push({ ...current, width: this._w }); } } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function candlesOf(day, clocks, firstOpen) { return clocks.map((clock, i) => ({ t: kst(day, clock), open: i === 0 ? firstOpen : firstOpen + 100, high: firstOpen + 500, low: firstOpen - 500, close: firstOpen + 100 })); }
const options = (candles, extra = {}) => ({ target: 'stock:005930', candles, x: p => (p.t - candles[0].t) / 60000, y: v => -v, left: -1e9, right: 1e9, top: -1e9, bottom: 1e9, ...extra });

test('화면: 오늘 08:00 첫 분봉 시가로 계산한 값이 키움 HTS(10일 195,370 · 20일 206,435)와 같고 선은 1px · 정해진 색', async () => {
    const { api, requests } = loadClient({ now: NOW, rows: FIXTURE });
    const today = candlesOf('20261123', ['08:00', '08:01', '09:00', '10:29'], 174000);
    const { ctx, paths } = recorder();
    let redrawn = 0;
    api.draw(ctx, options(today, { redraw: () => redrawn++ }));
    assert.equal(paths.length, 0, '일봉이 오기 전에는 그리지 않는다');
    await flush(); await flush();
    assert.equal(redrawn, 1); assert.equal(requests.length, 1);
    assert.match(requests[0], /target=stock%3A005930&from=20261123&to=20261123/);
    api.draw(ctx, options(today));
    const level = color => paths.find(p => p.color === color)?.points.map(([, , y]) => -y);
    assert.deepEqual(paths.map(p => [p.color, p.width]), [['#ff00ff', 1], ['#000080', 1], ['#ff6600', 1], ['#00a000', 1]]);
    assert.equal(level('#ff00ff')[0], (189800 + 196400 + 197300 + 180900 + 174000) / 5, '5일선 자홍');
    assert.equal(level('#000080')[0], 195370, '10일선 남색 = 키움 195,370.00');
    assert.equal(level('#ff6600')[0], 206435, '20일선 주황 = 키움 206,435.00');
    assert.ok(level('#00a000').every(v => v === level('#00a000')[0]), '하루 동안 수평선');
    api.draw(ctx, options(today)); await flush();
    assert.equal(requests.length, 1, '받은 구간은 다시 묻지 않는다');
});

test('화면: KRX 종목은 09:00 첫 봉, 시가가 생기기 전에는 오늘 선을 그리지 않는다, 지난날은 일봉 시가', async () => {
    const { api } = loadClient({ now: NOW, rows: FIXTURE });
    const past = candlesOf('20261120', ['09:00', '15:20'], 999999); // 지난날 분봉 시가는 쓰지 않고 일봉 시가 190,800
    const today = candlesOf('20261123', ['09:00', '09:01'], 175000);
    const { ctx, paths } = recorder();
    api.draw(ctx, options([...past, ...today])); await flush();
    api.draw(ctx, options([...past, ...today]));
    const tenDay = paths.find(p => p.color === '#000080').points;
    const priorTen = FIXTURE.filter(([d]) => d < '20261120').slice(-9).reduce((s, [, , c]) => s + c, 0);
    assert.equal(-tenDay[0][2], (priorTen + 190800) / 10, '지난날은 일봉 시가');
    assert.equal(-tenDay.at(-1)[2], (FIXTURE.slice(-9).reduce((s, [, , c]) => s + c, 0) + 175000) / 10, '오늘은 09:00 첫 봉 시가');
    // 지난날 수평(M→L) → 오늘 첫 봉에서 앞 값 높이로 이어 수직으로 꺾고(L, L) → 오늘 수평(L).
    const xOf = p => (p.t - past[0].t) / 60000;
    assert.deepEqual(tenDay.map(p => p.slice(0, 2)), [['M', 0], ['L', xOf(past[1])], ['L', xOf(today[0])], ['L', xOf(today[0])], ['L', xOf(today[1])]], '날짜가 바뀌는 봉에서 계단');
    assert.equal(tenDay[2][2], tenDay[1][2]); assert.equal(tenDay[3][2], tenDay[4][2]);
    // 장 시작 전: 오늘 봉이 없으면 오늘 선은 없고 지난날 선만.
    const before = recorder();
    api.draw(before.ctx, options(past));
    assert.ok(before.paths.length && before.paths.every(p => p.points.every(([, x]) => x <= (past.at(-1).t - past[0].t) / 60000)));
    // 오늘 봉이 08:00 전 것뿐이면(시가 아님) 그리지 않는다.
    const early = recorder();
    api.draw(early.ctx, options([{ t: kst('20261123', '07:59'), open: 1, high: 1, low: 1, close: 1 }]));
    assert.equal(early.paths.length, 0);
});

test('화면: 앞 거래일 일봉이 빠졌으면 그날 선을 그리지 않는다(앞선 종가가 하루 밀린 값 방지)', async () => {
    const { api } = loadClient({ now: NOW, rows: FIXTURE.filter(([d]) => d !== '20261120') });
    const candles = [...candlesOf('20261120', ['09:00'], 190800), ...candlesOf('20261123', ['09:00'], 174000)];
    const { ctx, paths } = recorder();
    api.draw(ctx, options(candles)); await flush(); api.draw(ctx, options(candles));
    assert.equal(paths.length, 0);
});

test('화면: 지수 선물 야간 봉은 다음 주간 거래일에 붙고, 주간 시가 전 야간 봉에는 선이 없다', async () => {
    const rows = FIXTURE.map(([d, o, c]) => [d, o / 1000, c / 1000]);
    const { api } = loadClient({ now: Date.parse('2026-11-23T11:00:00Z'), rows }); // 한국 11/23 20:00(야간 중)
    const friday = candlesOf('20261120', ['08:45', '15:45'], 190.8);
    const fridayNight = candlesOf('20261120', ['18:00', '23:59'], 181);
    const monday = candlesOf('20261123', ['08:45', '15:45'], 174);
    const mondayNight = candlesOf('20261123', ['18:00', '19:59'], 175);
    const candles = [...friday, ...fridayNight, ...monday, ...mondayNight];
    const { ctx, paths } = recorder();
    const opts = options(candles, { target: 'indexFutures:futures', night: true });
    api.draw(ctx, opts); await flush(); api.draw(ctx, opts);
    const five = paths.find(p => p.color === '#ff00ff').points, x = p => (p.t - candles[0].t) / 60000;
    const at = px => -[...five].reverse().find(([, x0]) => x0 <= px)[2];
    const mondayFive = (FIXTURE.slice(-4).reduce((s, [, , c]) => s + c / 1000, 0) + 174) / 5;
    assert.ok(Math.abs(at(x(fridayNight[0])) - mondayFive) < 1e-9, '금요일 야간 봉은 월요일 값');
    assert.ok(Math.max(...five.map(([, px]) => px)) <= x(monday.at(-1)), '월요일 야간(화요일 거래일, 시가 전)에는 선 없음');
});
