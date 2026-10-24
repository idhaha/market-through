const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBreadthService } = require('../../breadth-service');
const { createSupplyService, timestamp } = require('../../supply-service');

function fixture(t) {
    const output = path.resolve(__dirname, '../output'); fs.mkdirSync(output, { recursive: true });
    const root = fs.mkdtempSync(path.join(output, 'breadth-'));
    let time = timestamp('20261021', '080100'), confirmed = '2026-10-21', fail = false, latest = '20261021';
    const legacyFile = path.join(root, 'legacy.json');
    const original = JSON.stringify({ points: [{ date: '2026-10-20', highs: 12, lows: 3, value: 1.2, valid: 100 }] });
    fs.writeFileSync(legacyFile, original);
    const calls = [];
    const options = { directory: path.join(root, 'breadth'), legacyFile, now: () => time, pause: async () => {},
        getToken: async () => 'mock', log: () => {},
        supply: { confirmMarket: async () => Boolean(confirmed), store: { marketDay: () => confirmed ? { day: confirmed } : null } },
        http: { post: async (url, body, { headers }) => {
            const api = headers['api-id']; calls.push({ api, body, headers });
            if (api === 'ka10016') {
                if (fail && body.ntl_tp === '2') throw new Error('offline');
                return { data: { ntl_pric: body.ntl_tp === '2' ? [] : [{ stk_cd: '005930' }, { stk_cd: '005930_AL' }] }, headers: {} };
            }
            if (api === 'ka10080') return { data: { stk_min_pole_chart_qry: [{ cntr_tm: `${latest}080100`, trde_qty: '1', open_pric: '100', high_pric: '110', low_pric: '90', cur_prc: '105' }] }, headers: {} };
            if (api === 'ka10081') return { data: { stk_dt_pole_chart_qry: ['20261021', '20261020', '20261019'].map(dt => ({ dt, open_pric: '100', high_pric: '110', low_pric: '90', cur_prc: '105' })) }, headers: { 'cont-yn': 'Y' } };
            throw new Error(api);
        } }
    };
    const service = createBreadthService(options);
    t.after(() => { service.stop(); assert.equal(path.dirname(root), output); fs.rmSync(root, { recursive: true, force: true }); });
    return { service, options, root, original, calls, at: (date, clock) => { time = timestamp(date, clock); }, confirm: d => { confirmed = d; }, fail: () => { fail = true; }, latest: d => { latest = d; } };
}

test('migration preserves original bytes; baseline page keeps missing slots and original counts', async t => {
    const f = fixture(t); f.service.migrate();
    assert.equal(fs.readFileSync(path.join(f.options.directory, 'jusikbot-backup.json'), 'utf8'), f.original);
    const result = await f.service.query();
    assert.equal(result.dates.length, 3);
    assert.deepEqual(result.series.highs.points.map(p => p.value), [null, 12, null]);
    assert.equal(result.cursor, '20261018');
    assert.equal(result.candles.length, 3);
    f.service.migrate(); assert.equal(fs.readFileSync(f.options.legacyFile, 'utf8'), f.original);
});
test('08:01 integrated snapshot counts both markets separately and deduplicates exchanges, zero is valid, once per minute', async t => {
    const f = fixture(t); await Promise.all([f.service.tick(), f.service.tick()]); await f.service.tick();
    const rows = f.service.minuteRows('2026-10-21');
    assert.equal(rows.length, 1); assert.equal(rows[0].kospi.highs, 1); assert.equal(rows[0].kospi.lows, 0);
    assert.equal(f.calls.filter(c => c.api === 'ka10016').length, 4);
    assert.ok(f.calls.filter(c => c.api === 'ka10016').every(c => ['001','101'].includes(c.body.mrkt_tp) && c.body.stex_tp === '3' && c.body.dt === '250'));
    const minute = await f.service.query({ mode: 'minute' });
    assert.equal(minute.series.highs.points[0].value, 1);
});
test('failed low list leaves whole minute absent; unconfirmed market does not collect', async t => {
    const f = fixture(t); f.fail(); await f.service.tick(); assert.deepEqual(f.service.minuteRows('2026-10-21'), []);
    f.confirm(null); const count = f.calls.length; await f.service.tick(); assert.equal(f.calls.length, count);
});
test('20:02 daily commit is idempotent and minute archive remains readable after compression', async t => {
    const f = fixture(t); await f.service.tick(); f.at('20261021', '200200'); await f.service.tick(); await f.service.tick();
    assert.ok(fs.existsSync(path.join(f.options.directory, '2026-10-21.json.gz')));
    assert.equal(f.service.minuteRows('2026-10-21').length, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(f.options.directory, 'daily.json')));
    assert.equal(saved.points.length, 2); assert.equal(saved.points.at(-1).kospi.highs, 1);
});
test('restart before 08:00 recovers prior day; 08:00 cutoff and changed session cannot misdate data', async t => {
    const f = fixture(t); f.at('20261022', '075900'); await f.service.tick();
    const saved = JSON.parse(fs.readFileSync(path.join(f.options.directory, 'daily.json')));
    assert.equal(saved.points.at(-1).date, '2026-10-21');
    const second = fixture(t); second.at('20261022', '080000'); second.confirm(null); await second.service.tick();
    assert.equal(JSON.parse(fs.readFileSync(path.join(second.options.directory, 'daily.json'))).points.length, 1);
    const third = fixture(t); third.at('20261022', '075900'); third.latest('20261022'); await third.service.tick();
    assert.equal(JSON.parse(fs.readFileSync(path.join(third.options.directory, 'daily.json'))).points.length, 1);
});
test('continuation counts all pages and repeated keys fail without partial commit', async t => {
    const f = fixture(t); let repeated = false;
    f.options.http.post = async (url, body, { headers }) => ({ data: { ntl_pric: [{ stk_cd: headers['next-key'] ? '000660' : '005930' }] },
        headers: !headers['next-key'] || repeated ? { 'cont-yn': 'Y', 'next-key': 'opaque-key' } : {} });
    assert.deepEqual(await f.service.snapshot(), { kospi: { highs: 2, lows: 2 }, kosdaq: { highs: 2, lows: 2 } });
    repeated = true; await assert.rejects(f.service.snapshot(), /연속조회 키/);
});
test('shared opening confirmation works without supply registrations and shares concurrent probe', async t => {
    const f = fixture(t); let probes = 0;
    const supply = createSupplyService({ directory: path.join(f.root, 'supply'), now: () => timestamp('20261021', '080100'), pause: async () => {},
        getToken: async () => 'mock', resolveStock: async () => {}, http: { post: async () => {
            probes++; return { data: { stk_min_pole_chart_qry: [{ cntr_tm: '20261021080000', trde_qty: '1' }] } };
        } } });
    assert.deepEqual(await Promise.all([supply.confirmMarket(), supply.confirmMarket()]), [true, true]);
    assert.equal(probes, 1); assert.equal(supply.store.marketDay().day, '2026-10-21');
});
test('600 baseline bars remain visible when every breadth value is missing', async t => {
    const f = fixture(t);
    f.options.http.post = async () => ({ data: { stk_dt_pole_chart_qry: Array.from({ length: 600 }, (_, i) => {
        const dt = new Date(timestamp('20261021') - i * 86400000).toISOString().slice(0,10).replaceAll('-', '');
        return { dt, open_pric: '100', high_pric: '110', low_pric: '90', cur_prc: '105' };
    }) }, headers: {} });
    f.service.migrate();
    fs.writeFileSync(path.join(f.options.directory, 'daily.json'), JSON.stringify({ points: [] }));
    const result = await f.service.query();
    assert.equal(result.dates.length, 600);
    assert.ok(result.series.highs.points.every(p => p.value === null));
    assert.equal(result.candles.length, 600);
});


test('market queries isolate values, sum normal zeros, reject invalid markets and leave old KOSPI history missing for KOSDAQ/all', async t => {
 const f=fixture(t);
 const original=f.options.http.post;
 f.options.http.post=async(url,body,options)=>{
  const response=await original(url,body,options);
  if(options.headers['api-id']==='ka10016' && body.mrkt_tp==='101' && body.ntl_tp==='1')response.data.ntl_pric.push({stk_cd:'000660'});
  return response;
 };
 await f.service.tick();
 const kospi=await f.service.query({mode:'minute',market:'kospi'});
 const kosdaq=await f.service.query({mode:'minute',market:'kosdaq'});
 const both=await f.service.query({mode:'minute',market:'all'});
 assert.equal(kospi.series.highs.points[0].value,1);assert.equal(kosdaq.series.highs.points[0].value,2);
 assert.equal(both.series.highs.points[0].value,3);assert.equal(both.series.lows.points[0].value,0);
 for(const market of ['kosdaq','all'])assert.equal((await f.service.query({market})).series.highs.points.find(p=>p.date==='2026-10-20').value,null);
 await assert.rejects(f.service.query({market:'invalid'}));
});


test('KOSDAQ failure cannot commit a partial combined snapshot',async t=>{
 const f=fixture(t),original=f.options.http.post;
 f.options.http.post=(url,body,options)=>{if(body.mrkt_tp==='101')throw new Error('KOSDAQ unavailable');return original(url,body,options);};
 await f.service.tick();assert.deepEqual(f.service.minuteRows('2026-10-21'),[]);
});
