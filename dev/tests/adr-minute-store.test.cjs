const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAdrMinuteStore } = require('../../adr-minute-store');

(async () => {
    const testRoot = path.resolve('dev/output');
    fs.mkdirSync(testRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(testRoot, 'adr-minute-test-'));
    const t = (day, clock = '09:00') => Date.parse(`${day}T${clock}:00+09:00`);
    let now = t('2026-10-16', '16:00');
    const create = () => createAdrMinuteStore({ directory, now: () => now });
    try {
        let store = create();
        assert.deepEqual(store.read('kospi'), { day: null, points: [] });
        store.merge('kospi', { intraday: [{ t: t('2026-10-16') / 1000, adr: 70 }, { t: t('2026-10-16') + 20000, adr: 71 }, { t: t('2026-10-16', '08:59'), adr: 50 }, { t: t('2026-10-19'), adr: 50 }], asOf: t('2026-10-16', '15:30'), adr: 74.83 });
        assert.deepEqual(store.read('kospi').points, [{ t: t('2026-10-16'), adr: 71 }, { t: t('2026-10-16', '15:30'), adr: 74.83 }]);
        store.merge('kosdaq', { intraday: [{ t: t('2026-10-16'), adr: 86 }] });
        store = create();
        assert.equal(store.read('kospi').points.length, 2, 'Survives a server restart');
        assert.equal(store.read('kosdaq').points[0].adr, 86, 'Markets remain separate');
        now = t('2026-10-18', '12:00');
        store.merge('kospi', { intraday: [] });
        assert.equal(store.read('kospi').day, '2026-10-16', 'Empty weekend response retains last trading day');
        now = t('2026-10-19', '09:01');
        store.merge('kospi', { intraday: [{ t: t('2026-10-19'), adr: 80 }] });
        assert.equal(store.read('kospi').points.length, 1);
        assert.equal(store.read('kospi').day, '2026-10-19', 'New trading day replaces previous session');
        store.merge('kospi', { intraday: [{ t: t('2026-10-16'), adr: 60 }] });
        assert.equal(store.read('kospi').day, '2026-10-19', 'Late older response cannot roll back the session');
        assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'kospi.json'), 'utf8')).points.length, 1);
        assert.deepEqual(fs.readdirSync(directory).sort(), ['kosdaq.json', 'kospi.json'], 'No daily files accumulate');
        assert.throws(() => store.read('../escape'));

        // Two clients and a restarted service read the same persisted response.
        const source = fs.readFileSync('server.js', 'utf8');
        const routes = new Map(); let upstreamFails = false;
        const context = { app: { get: (url, handler) => routes.set(url, handler) }, console, Date,
            adrMinuteStore: create(), axios: { get: async url => {
                if (upstreamFails) throw new Error('Offline');
                return { data: url.endsWith('/today') ? { intraday: [], adr: null, asOf: null } : { series: [] } };
            } }
        };
        vm.runInNewContext(source.slice(source.indexOf('const adrClosedFallbackCache'), source.indexOf('function readAuthorizedEmails()')), context);
        const request = async () => {
            const res = { set() { return this; }, status() { return this; }, json(data) { this.data = data; return this; } };
            await routes.get('/api/adr/today')({ query: { market: 'kospi' } }, res);
            return res.data;
        };
        const first = await request(), second = await request();
        assert.deepEqual(first.intraday, second.intraday);
        assert.equal(first.intradayDate, '2026-10-19');
        upstreamFails = true;
        const offline = await request();
        assert.deepEqual(offline.intraday, first.intraday);
        assert.ok(offline.sourceError);
        console.log('PASS ADR one-session disk retention, restart, rollover, minute deduplication, shared API responses and offline fallback');
    } finally {
        assert.ok(path.resolve(directory).startsWith(testRoot + path.sep));
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
