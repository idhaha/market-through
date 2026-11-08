const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createMacroSeriesCache } = require('../../macro-series-cache');

const day = (base, n) => new Date(Date.parse(base + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// Business-day-like series from start to end (inclusive), value from fn(date).
const series = (start, end, fn = () => 1) => { const out = []; for (let d = start; d <= end; d = day(d, 1)) out.push({ date: d, value: fn(d) }); return out; };

function fixture(t, { teScrape } = {}) {
    const output = path.resolve(__dirname, '../output'); fs.mkdirSync(output, { recursive: true });
    const root = fs.mkdtempSync(path.join(output, 'macro-series-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let time = Date.parse('2026-11-09T01:00:00Z'); // 10:00 KST
    // The source as it is "now": tests change values to simulate revisions.
    const source = { fred: series('2016-11-01', '2026-11-08', () => 4) };
    const calls = [];
    const timers = [];
    const sources = {
        fred: {
            keyOf: p => `${p.seriesId}_${p.period}`,
            fullFrom: (p, now) => new Date(now - 3650 * 86400000).toISOString().slice(0, 10),
            fetch: async (p, from) => { calls.push({ source: 'fred', from }); if (source.fail) throw new Error('down'); return source.fred.filter(r => r.date >= from); },
            policy: { wait: 1000 }
        },
        te: {
            keyOf: p => p.url,
            dayOf: r => r.DateTime.slice(0, 10), idOf: r => r.DateTime,
            fetch: async () => { calls.push({ source: 'te' }); return teScrape ? teScrape() : [{ DateTime: '2026-11-08T00:00:00.000Z', Value: 1400 }]; },
            policy: { wait: 0, forceFresh: 30 * 60000 }
        }
    };
    const make = (extra = {}) => createMacroSeriesCache({ directory: path.join(root, 'macro'), sources, now: () => time, schedule: (fn, delay) => { timers.push({ fn, delay }); return { unref() {} }; }, ...extra });
    return { make, source, calls, timers, root, advance: ms => { time += ms; }, at: iso => { time = Date.parse(iso); } };
}

test('history is fetched once, then served from disk across requests and a server restart', async t => {
    const f = fixture(t);
    let cache = f.make();
    const first = await cache.get('fred', { seriesId: 'DGS10', period: '10y' });
    assert.equal(first.status, 'fetched');
    assert.equal(f.calls.length, 1);
    assert.equal(first.rows.at(-1).date, '2026-11-08');
    const second = await cache.get('fred', { seriesId: 'DGS10', period: '10y' });
    assert.equal(second.status, 'cache');
    // Restart: a new instance reads the stored file and does not call the source.
    cache = f.make();
    const third = await cache.get('fred', { seriesId: 'DGS10', period: '10y' });
    assert.equal(third.status, 'cache');
    assert.equal(third.rows.length, first.rows.length);
    assert.equal(f.calls.length, 1);
});

test('a stale copy refetches only the recent part and keeps older stored rows', async t => {
    const f = fixture(t);
    const cache = f.make();
    await cache.get('fred', { seriesId: 'DGS10', period: '10y' });
    f.advance(2 * 3600000);
    f.source.fred.push({ date: '2026-11-09', value: 5 });
    f.source.fred.find(r => r.date === '2026-11-01').value = 4.5; // revised inside the overlap
    const result = await cache.get('fred', { seriesId: 'DGS10', period: '10y' });
    assert.equal(result.status, 'refreshed');
    assert.equal(f.calls[1].from, '2026-10-09'); // 30 days before the newest stored day
    assert.equal(result.rows.find(r => r.date === '2026-11-01').value, 4.5);
    assert.equal(result.rows.at(-1).date, '2026-11-09');
    assert.equal(result.rows[0].date, f.source.fred.find(r => r.date >= result.rows[0].date).date);
    assert.ok(result.rows.length > 3000);
});

test('a failed refresh serves the stored rows instead of an error', async t => {
    const f = fixture(t);
    const cache = f.make();
    const stored = await cache.get('fred', { seriesId: 'DGS10', period: '10y' });
    f.advance(2 * 3600000); f.source.fail = true;
    const result = await cache.get('fred', { seriesId: 'DGS10', period: '10y' });
    assert.equal(result.status, 'stale');
    assert.equal(result.refreshError, 'down');
    assert.equal(result.rows.length, stored.rows.length);
});

test('Trading Economics answers from disk at once and scrapes in the background when stale', async t => {
    let release;
    const f = fixture(t, { teScrape: () => f.calls.length === 1 ? [{ DateTime: '2016-11-08T00:00:00.000Z', Value: 1100 }, { DateTime: '2026-11-08T00:00:00.000Z', Value: 1400 }]
        : new Promise(resolve => { release = () => resolve([{ DateTime: '2025-11-10T00:00:00.000Z', Value: 1450 }, { DateTime: '2026-11-09T01:00:00.000Z', Value: 1410 }]); }) });
    const cache = f.make();
    await cache.get('te', { url: 'krw' });
    f.advance(2 * 3600000);
    const answered = await cache.get('te', { url: 'krw' });
    assert.equal(answered.status, 'refreshing');
    assert.equal(answered.rows.length, 2);
    release(); await new Promise(r => setImmediate(r));
    // The 1Y-only scrape replaced rows from its first day and kept the older 10Y history.
    const next = await cache.get('te', { url: 'krw' });
    assert.equal(next.status, 'cache');
    assert.deepEqual(next.rows.map(r => r.Value), [1100, 1450, 1410]);
    // Opening the tab again soon does not scrape; force within 30 minutes neither.
    assert.equal((await cache.get('te', { url: 'krw' }, { force: true })).status, 'cache');
    assert.equal(f.calls.length, 2);
});

test('the dawn run refetches the whole history: revised and removed past values are replaced', async t => {
    const f = fixture(t);
    const cache = f.make();
    await cache.get('fred', { seriesId: 'DGS10', period: '10y' });
    // FRED revises a value from two years ago and drops a holiday observation.
    f.source.fred.find(r => r.date === '2024-03-04').value = 9;
    f.source.fred = f.source.fred.filter(r => r.date !== '2024-03-05');
    f.at('2026-11-09T22:20:00Z'); // 07:20 KST next day
    const summary = await cache.refreshHistory();
    assert.deepEqual(summary.refreshed, ['fred:DGS10_10y']);
    const rows = (await cache.get('fred', { seriesId: 'DGS10', period: '10y' })).rows;
    assert.equal(rows.find(r => r.date === '2024-03-04').value, 9);
    assert.equal(rows.find(r => r.date === '2024-03-05'), undefined);
    // The incremental path alone would not have seen the 2024 revision.
    assert.ok(f.calls.at(-1).from < '2017-01-01');
    assert.equal(cache.state().historyDay, '2026-11-10');
});

test('the dawn run is scheduled for 07:20 KST and a missed run catches up after a restart', async t => {
    const f = fixture(t);
    let cache = f.make();
    await cache.get('fred', { seriesId: 'DGS10', period: '10y' });
    // 10:00 KST, no run today yet -> catch-up after 3 minutes.
    assert.equal(cache.start().missed, true);
    assert.equal(f.timers.at(-1).delay, 3 * 60000);
    await f.timers.at(-1).fn();
    assert.equal(cache.state().historyDay, '2026-11-09');
    // After the run the next one is the following 07:20 KST.
    assert.equal(f.timers.at(-1).delay, Date.parse('2026-11-10T07:20:00+09:00') - Date.parse('2026-11-09T10:00:00+09:00'));
    // A restart the same day does not run it again.
    cache.stop(); cache = f.make();
    assert.equal(cache.start().missed, false);
    // Before 07:20 the run waits for 07:20.
    f.at('2026-11-10T06:00:00+09:00'); cache.stop(); cache = f.make();
    assert.equal(cache.start().missed, false);
    assert.equal(f.timers.at(-1).delay, 80 * 60000);
});

test('series not used for 30 days are not refetched at dawn; a year unused removes them', async t => {
    const f = fixture(t);
    const cache = f.make();
    await cache.get('fred', { seriesId: 'DGS10', period: '10y' });
    f.advance(40 * 86400000);
    let summary = await cache.refreshHistory();
    assert.deepEqual(summary.refreshed, []);
    f.advance(330 * 86400000);
    summary = await cache.refreshHistory();
    assert.deepEqual(summary.removed, ['fred:DGS10_10y']);
    assert.equal(fs.readdirSync(path.join(f.root, 'macro', 'fred')).filter(n => n.endsWith('.json')).length, 0);
});

// Oracle sits behind nginx with a 60 s read timeout: a request waiting longer gets "Proxy 504" on the screen.
test('no request waits past maxWait: a slow first scrape answers pending, keeps going and is saved', async t => {
    let release;
    const f = fixture(t, { teScrape: () => new Promise(resolve => { release = () => resolve([{ DateTime: '2026-11-08T00:00:00.000Z', Value: 1400 }]); }) });
    const cache = f.make({ maxWait: 50 });
    const started = Date.now();
    await assert.rejects(cache.get('te', { url: 'https://tradingeconomics.com/south-korea/currency' }), error => error.pending === true);
    assert.ok(Date.now() - started < 1000, 'answered at maxWait, not when the scrape ends');
    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    const next = await cache.get('te', { url: 'https://tradingeconomics.com/south-korea/currency' });
    assert.equal(next.status, 'cache');
    assert.equal(next.rows[0].Value, 1400);
    assert.equal(f.calls.length, 1, 'the second request reused the background scrape');
});

test('a forced refetch also stops waiting at maxWait and answers with the stored copy', async t => {
    let slow = false, release;
    const f = fixture(t, { teScrape: () => slow ? new Promise(resolve => { release = () => resolve([{ DateTime: '2026-11-09T00:00:00.000Z', Value: 1410 }]); }) : [{ DateTime: '2026-11-08T00:00:00.000Z', Value: 1400 }] });
    const cache = f.make({ maxWait: 50 });
    await cache.get('te', { url: 'u' });
    f.advance(31 * 60000); slow = true;
    const started = Date.now();
    const forced = await cache.get('te', { url: 'u' }, { force: true });
    assert.ok(Date.now() - started < 1000);
    assert.equal(forced.status, 'refreshing');
    assert.equal(forced.rows.length, 1);
    release();
});
