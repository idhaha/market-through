// ADR in the 52-week card (2026-11-09): official advancing/declining counts (LS t1514) saved in daily.json,
// intraday counts (Kiwoom ka20001) saved in the minute file, ADR = 20-day sum of rises ÷ falls × 100.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBreadthService } = require('../../breadth-service');
const { timestamp } = require('../../supply-service');

// 25 trading days 2026-09-28 .. 2026-10-30 (weekdays), newest first as LS returns them.
const tradingDays = (() => { const out = []; for (let t = Date.UTC(2026, 8, 28); out.length < 25; t += 86400000) { const d = new Date(t); if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); } return out; })();
const lsRow = (date, i, upcode) => ({ date: date.replaceAll('-', ''), high: String(100 + i + (upcode === '301' ? 50 : 0)), up: '2', low: '200', down: '1', unchg: '30' });

function fixture(t, { lsFails = false, kiwoomCounts = true } = {}) {
    const output = path.resolve(__dirname, '../output'); fs.mkdirSync(output, { recursive: true });
    const root = fs.mkdtempSync(path.join(output, 'breadth-adr-'));
    let time = timestamp('20261102', '090100');
    const legacyFile = path.join(root, 'legacy.json');
    fs.writeFileSync(legacyFile, JSON.stringify({ points: [{ date: '2026-10-30', highs: 5, lows: 2 }] }));
    const calls = [];
    const options = { directory: path.join(root, 'breadth'), legacyFile, now: () => time, pause: async () => {}, log: () => {},
        getToken: async () => 'kiwoom', getLsToken: async () => 'ls',
        supply: { confirmMarket: async () => true, store: { marketDay: () => ({ day: '2026-11-02' }) } },
        http: { post: async (url, body, { headers }) => {
            if (url.includes('ls-sec')) {
                calls.push({ api: 't1514', body });
                if (lsFails) throw new Error('LS offline');
                const upcode = body.t1514InBlock.upcode;
                const rows = [...tradingDays].reverse().map((date, i) => lsRow(date, 24 - i, upcode));
                return { data: { t1514OutBlock: { cts_date: '' }, t1514OutBlock1: rows.slice(0, body.t1514InBlock.cnt) } };
            }
            const api = headers['api-id']; calls.push({ api, body });
            if (api === 'ka10016') return { data: { ntl_pric: [{ stk_cd: '005930' }] }, headers: {} };
            if (api === 'ka10099') return { data: { list: [{ code: '005930', name: '삼성전자', marketCode: body.mrkt_tp === '0' ? '0' : '10' }] }, headers: {} };
            if (api === 'ka20001') {
                if (!kiwoomCounts) throw new Error('ka20001 offline');
                return { data: body.inds_cd === '001' ? { rising: '+300', upl: '5', fall: '-100', lst: '0', stdns: '20' } : { rising: '400', upl: '0', fall: '200', lst: '1', stdns: '30' } };
            }
            if (api === 'ka10080') return { data: { stk_min_pole_chart_qry: [{ cntr_tm: '20261102090100', trde_qty: '1', open_pric: '100', high_pric: '110', low_pric: '90', cur_prc: '105' }] }, headers: {} };
            if (api === 'ka10081') return { data: { stk_dt_pole_chart_qry: ['20261102', '20261030', '20261029'].map(dt => ({ dt, open_pric: '100', high_pric: '110', low_pric: '90', cur_prc: '105' })) }, headers: {} };
            throw new Error(api);
        } }
    };
    const service = createBreadthService(options);
    t.after(() => { service.stop(); fs.rmSync(root, { recursive: true, force: true }); });
    const daily = () => JSON.parse(fs.readFileSync(path.join(options.directory, 'daily.json'), 'utf8'));
    const settle = async () => { await service.tick(); for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
    return { service, options, calls, daily, settle, at: (date, clock) => { time = timestamp(date, clock); } };
}
// Expected ADR on the last day: rises (high + up) and falls (low + down) over the 20 days ending there.
const expected = (endIndex, upcode, liveRise, liveFall) => {
    let rise = 0, fall = 0;
    const days = liveRise == null ? tradingDays.slice(endIndex - 19, endIndex + 1) : tradingDays.slice(endIndex - 18, endIndex + 1);
    for (const date of days) { const i = tradingDays.indexOf(date); rise += 100 + i + (upcode === '301' ? 50 : 0) + 2; fall += 201; }
    if (liveRise != null) { rise += liveRise; fall += liveFall; }
    return Math.round(rise / fall * 10000) / 100;
};

test('first tick saves the official counts of every day into daily.json, also during market hours', async t => {
    const f = fixture(t); await f.settle();
    const saved = f.daily();
    assert.equal(saved.adrFrom, '2026-09-28'); assert.equal(saved.adrThrough, '2026-10-30');
    const last = saved.points.find(p => p.date === '2026-10-30');
    assert.deepEqual(last.kospi, { highs: 5, lows: 2, rise: 126, fall: 201, flat: 30, adr: expected(24, '001') }, 'counts and ADR join the existing highs/lows point');
    assert.deepEqual(last.kosdaq, { rise: 176, fall: 201, flat: 30, adr: expected(24, '301') });
    assert.ok(f.calls.some(c => c.api === 't1514' && c.body.t1514InBlock.upcode === '301'));
});

test('day chart: 20-day ADR from official counts; today uses the latest minute counts', async t => {
    const f = fixture(t); await f.settle(); await f.settle();
    const day = await f.service.query({ mode: 'day', market: 'kospi' });
    const adr = new Map(day.series.adr.points.map(p => [p.date, p.value]));
    assert.equal(adr.get('2026-10-30'), expected(24, '001'));
    assert.equal(adr.get('2026-10-29'), expected(23, '001'));
    // 11-02 is today: 19 official days + the minute's Kiwoom counts (rising 300 + limit-up 5, falling 100).
    assert.equal(adr.get('2026-11-02'), expected(24, '001', 305, 100));
    const all = await f.service.query({ mode: 'day', market: 'all' });
    const both = all.series.adr.points.find(p => p.date === '2026-10-30').value;
    let rise = 0, fall = 0; for (const d of tradingDays.slice(5)) { const i = tradingDays.indexOf(d); rise += (100 + i + 2) + (150 + i + 2); fall += 402; }
    assert.equal(both, Math.round(rise / fall * 10000) / 100);
});

test('minute chart: each collected minute carries the intraday counts and its ADR', async t => {
    const f = fixture(t); await f.settle();
    const row = f.service.minuteRows('2026-11-02')[0];
    assert.deepEqual(row.kospi, { highs: 1, lows: 1, rise: 305, fall: 100, flat: 20 });
    assert.deepEqual(row.kosdaq, { highs: 1, lows: 1, rise: 400, fall: 201, flat: 30 });
    const minute = await f.service.query({ mode: 'minute', market: 'kosdaq' });
    assert.equal(minute.series.adr.points[0].value, expected(24, '301', 400, 201));
});

test('a failing intraday count keeps the minute (highs/lows) and reports the ADR problem', async t => {
    const f = fixture(t, { kiwoomCounts: false }); await f.settle();
    const row = f.service.minuteRows('2026-11-02')[0];
    assert.deepEqual(row.kospi, { highs: 1, lows: 1 });
    const minute = await f.service.query({ mode: 'minute' });
    assert.equal(minute.series.adr.points[0].value, null);
    assert.match(minute.warning, /ADR 장중/);
});

test('evening: highs/lows still finalize on a day that already has ADR counts; sync runs once per day with 40 rows', async t => {
    const f = fixture(t); await f.settle();
    // Pretend LS already gave 11-02's counts before the 20:02 highs/lows commit.
    const saved = f.daily(); saved.points.push({ date: '2026-11-02', kospi: { rise: 1, fall: 1, flat: 1 } }); fs.writeFileSync(path.join(f.options.directory, 'daily.json'), JSON.stringify(saved));
    f.at('20261102', '200200'); await f.settle(); await f.settle();
    const point = f.daily().points.find(p => p.date === '2026-11-02');
    assert.equal(point.kospi.highs, 1, 'highs/lows committed next to the counts');
    const syncs = f.calls.filter(c => c.api === 't1514');
    assert.equal(syncs.filter(c => c.body.t1514InBlock.cnt === 40).length, 2, 'one evening sync (two markets) of the last 40 days');
    assert.equal(f.daily().adrSyncedFor, '2026-11-02');
});

test('LS failure: no counts, the chart still answers and says why', async t => {
    const f = fixture(t, { lsFails: true }); await f.settle();
    const day = await f.service.query({ mode: 'day' });
    assert.ok(day.series.adr.points.every(p => p.value == null));
    assert.match(day.warning, /ADR LS offline/);
});

test('a day LS reports with zero movers is a gap: no ADR for the 20-day windows that hold it', async t => {
    const f = fixture(t); const post = f.options.http.post;
    f.options.http.post = async (url, body, options) => {
        const response = await post(url, body, options);
        if (url.includes('ls-sec')) response.data.t1514OutBlock1 = response.data.t1514OutBlock1.map(r => r.date === '20261015' ? { ...r, high: '0', up: '0', low: '0', down: '0' } : r);
        return response;
    };
    await f.settle();
    const point = f.daily().points.find(p => p.date === '2026-10-15');
    assert.deepEqual(point.kospi, { gap: true });
    const day = await f.service.query({ mode: 'day' });
    const adr = new Map(day.series.adr.points.map(p => [p.date, p.value]));
    assert.equal(adr.get('2026-10-30'), null, 'window 10-05..10-30 holds the gap day');
    assert.equal(f.daily().adrFrom, '2026-09-28');
});

test('the daily ADR is saved in the file and fixes the axis: min/max with 10% margin, never below 0', async t => {
    const f = fixture(t); await f.settle();
    const saved = f.daily();
    const kospi = saved.points.filter(p => Number.isFinite(p.kospi?.adr)).map(p => p.kospi.adr);
    assert.equal(kospi.length, 6, 'days 20..25 have a full 20-day window');
    assert.ok(Number.isFinite(saved.points.find(p => p.date === '2026-10-30').all.adr), 'KOSPI+KOSDAQ ADR stored too');
    // The first collected minute (live ADR far above the history) already widened the max.
    assert.deepEqual(saved.adrScale.kospi, { min: Math.floor(Math.min(...kospi) * 0.9), max: Math.max(Math.ceil(Math.max(...kospi) * 1.1), Math.ceil(expected(24, '001', 305, 100) * 1.1)) });
    const day = await f.service.query({ mode: 'day', market: 'kospi' });
    assert.deepEqual(day.adr_scale, saved.adrScale.kospi);
});

test('a live ADR past the fixed axis widens it by 10% and keeps it; values inside leave it alone', async t => {
    const f = fixture(t); await f.settle();
    // The first minute's KOSPI live ADR (rising 305 vs falling 100) is far above the history: the max widens.
    const live = expected(24, '001', 305, 100), scale = f.daily().adrScale.kospi;
    assert.equal(scale.max, Math.ceil(live * 1.1));
    f.at('20261102', '090200'); await f.settle();
    assert.deepEqual(f.daily().adrScale.kospi, scale, 'same value again: no change');
});

test('Kiwoom time axis failing: the stored dates still carry the counts and ADR', async t => {
    const f = fixture(t); await f.settle();
    const post = f.options.http.post;
    f.options.http.post = async (url, body, options) => ['ka10081', 'ka10080'].includes(options.headers['api-id']) ? Promise.reject(new Error('[1631] 서비스 오류')) : post(url, body, options);
    const day = await f.service.query({ mode: 'day', market: 'kospi', cursor: '20261031' });
    assert.ok(day.dates.includes('2026-10-30'));
    assert.equal(day.series.adr.points.find(p => p.date === '2026-10-30').value, expected(24, '001'));
    assert.equal(day.candles.length, 0);
    assert.match(day.warning, /키움 기준 봉 조회 실패/);
    const minute = await f.service.query({ mode: 'minute', market: 'kospi' });
    assert.equal(minute.dates.length, 1);
    assert.equal(minute.series.adr.points[0].value, expected(24, '001', 305, 100));
});

test('day axis from the shared index daily page: no Samsung call; KOSDAQ uses the KOSDAQ index; cursor passes through', async t => {
    const f = fixture(t); await f.settle();
    const asked = [];
    f.options.indexCandles = null; // the service reads the option at creation: build a new one with it
    const { createBreadthService } = require('../../breadth-service');
    const service = createBreadthService({ ...f.options, indexCandles: { referencePage: async options => { asked.push(options); return {
        points: ['2026-10-29', '2026-10-30', '2026-11-02'].map(date => ({ date, t: Date.parse(date + 'T09:00:00+09:00'), open: 1, high: 2, low: 1, close: 2 })), has_more: true }; } } });
    t.after(() => service.stop());
    const before = f.calls.filter(c => c.api === 'ka10081').length;
    const day = await service.query({ mode: 'day', market: 'kosdaq', cursor: '20261102' });
    assert.deepEqual(day.dates, ['2026-10-29', '2026-10-30', '2026-11-02']);
    assert.equal(day.series.adr.points[1].value, expected(24, '301'));
    assert.equal(f.calls.filter(c => c.api === 'ka10081').length, before, 'no Samsung daily call');
    assert.deepEqual(asked, [{ market: 'kosdaq', mode: 'day', cursor: '10120261102' }]);
    assert.equal(day.cursor, '20261028'); assert.equal(day.has_more, true);
    await service.query({ mode: 'day', market: 'all' });
    assert.equal(asked.at(-1).market, 'kospi', 'KOSPI+KOSDAQ uses the KOSPI index days');
});
