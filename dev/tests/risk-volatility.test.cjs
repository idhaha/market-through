const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createVolatilityService } = require('../../risk-volatility');

(async () => {
    const root = path.resolve('dev/output'); fs.mkdirSync(root, { recursive: true });
    const directory = fs.mkdtempSync(path.join(root, 'volatility-test-'));
    try {
        let now = Date.parse('2026-10-18T12:00:00Z'), latestDate = '2026-10-16', incomingDate = '2026-10-16', offline = false;
        const calls = [], latestCalls = [];
        const options = { directory, now: () => now,
            getLatest: async () => { latestCalls.push(now); if (offline) throw Error('Offline'); return { data: { indicators: ['vix', 'vkospi'].map(id => ({ id, asOfLabel: latestDate })) } }; },
            get: async params => {
                calls.push(params); if (offline) throw Error('Offline');
                return { data: { asOf: incomingDate, points: [{ date: incomingDate, value: params.id === 'vix' ? 20 : 48 }, { date: '2026-10-15', value: incomingDate === '2026-10-16' ? 18 : 999 }, ...(incomingDate < '2027-01-01' ? [{ date: '2023-10-20', value: 12 }] : []), { date: 'bad', value: 3 }, { date: '2026-10-14', value: null }] } };
            }
        };
        let service = createVolatilityService(options);
        const [a, b] = await Promise.all([service.query('all'), service.query('all')]);
        assert.deepEqual(a, b); assert.equal(calls.length, 2); assert.ok(calls.every(call => call.span === '3y'));
        assert.equal(a.series.vix.points.length, 3); assert.equal(a.series.vix.points[0].date, '2023-10-20');
        assert.equal((await service.query('6m')).series.vix.points.length, 2);
        await service.query('1y'); await service.query('3y'); assert.equal(calls.length, 2, 'View ranges read the same disk archive');
        now += 300001; await service.query('all');
        assert.equal(calls.length, 2, 'No history download when latest trading date is already saved'); assert.equal(latestCalls.length, 1);
        now = Date.parse('2026-10-19T22:00:00Z'); latestDate = incomingDate = '2026-10-19';
        await service.query('all'); assert.equal(calls.length, 4); assert.ok(calls.slice(-2).every(call => call.span === '6m'));
        assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'vix.json'), 'utf8')).points.length, 4);
        service = createVolatilityService(options);
        await service.query('all'); assert.equal(calls.length, 4, 'Server restart reads disk without another bootstrap');
        now = Date.parse('2027-10-20T22:00:00Z'); latestDate = incomingDate = '2027-10-20';
        const full = await service.query('all');
        assert.equal(full.series.vix.points[0].date, '2023-10-20', 'Old records survive beyond source three-year window');
        assert.ok(!(await service.query('3y')).series.vix.points.some(point => point.date === '2023-10-20'));
        assert.equal(full.series.vix.points.length, 5);
        assert.equal(full.series.vix.points.find(point => point.date === '2026-10-15').value, 18, 'Existing daily observations are never overwritten');
        now += 300001; offline = true;
        const stale = await service.query('all'); assert.equal(stale.series.vix.points.length, 5); assert.ok(stale.series.vix.warning);
        await assert.rejects(service.query('5y'), error => error.status === 400);
        const partial = createVolatilityService({ directory: path.join(directory, 'partial'), now: () => now, get: async ({ id }) => { if (id === 'vix') throw Error('Offline'); return { data: { points: [{ date: '2027-10-20', value: 48 }] } }; } });
        const result = await partial.query(); assert.ok(result.series.vix.error); assert.equal(result.series.vkospi.points.length, 1);
        const breadth = createVolatilityService({ kind: 'breadth', directory: path.join(directory, 'breadth'), now: () => now, get: async ({ id, span }) => {
            assert.equal(id, 'new-highs-lows'); assert.equal(span, '3y');
            return { data: { points: [{ date: '2027-10-20', value: -0.38, highs: 4, lows: 7, valid: 795 }, { date: '2027-10-19', value: 0, highs: 0, lows: 0, valid: 795 }] } };
        } });
        const breadthResult = await breadth.query('all');
        assert.equal(breadthResult.series.highs.points.at(-1).value, 4);
        assert.equal(breadthResult.series.lows.points.at(-1).value, -7);
        assert.equal(breadthResult.series.net.points.at(-1).value, -0.38, 'Negative net values remain valid');
        assert.equal(breadthResult.series.highs.points[0].value, 0, 'Zero counts are retained');
        assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'breadth/new-highs-lows.json'), 'utf8')).points[1].valid, 795);
        const sentiment = createVolatilityService({ kind: 'sentiment', directory: path.join(directory, 'sentiment'), now: () => now, get: async ({ id }) => {
            assert.ok(['fear-greed', 'high-yield-spread'].includes(id));
            return { data: { points: [{ date: '2027-10-20', value: id === 'fear-greed' ? 17.94 : 3.23 }] } };
        } });
        const combined = await sentiment.query('all');
        assert.equal(combined.series['fear-greed'].points[0].value, 17.94);
        assert.equal(combined.series['high-yield-spread'].points[0].value, 3.23);
        assert.equal(fs.existsSync(path.join(directory, 'sentiment/fear-greed.json')), true);
        assert.equal(fs.existsSync(path.join(directory, 'sentiment/high-yield-spread.json')), true);
        console.log('PASS volatility persistent archive, bootstrap, missing-date append, no history for unchanged date, range reuse, restart, old-date retention and offline fallback');
    } finally { assert.ok(path.resolve(directory).startsWith(root + path.sep)); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
