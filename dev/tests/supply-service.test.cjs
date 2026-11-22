const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSupplyService, quantity, timestamp, collectingAt, investorObservationAt } = require('../../supply-service');
const { createSupplyStore } = require('../../supply-store');

const today = '20261020';
test('initial daily price-only count uses the latest 600 bars without an arbitrary calendar fallback',async t=>{
 const rows=Array.from({length:602},(_,i)=>({dt:new Date(timestamp(today)-i*86400000+32400000).toISOString().slice(0,10).replaceAll('-',''),open_pric:'100',high_pric:'110',low_pric:'90',cur_prc:'105'}));
 const f=fixture(t,async api=>{assert.equal(api,'ka10081');return {data:{stk_dt_pole_chart_qry:rows},headers:{'cont-yn':'Y','next-key':'unused'}};});
 f.setTime(timestamp(today,'210000'));await f.service.configure(['005930'],0);
 const r=await f.service.candles({code:'005930',mode:'day',count:'600'});
 assert.equal(r.points.length,600);assert.equal(r.points[0].t,timestamp(rows[599].dt));assert.equal(r.points.at(-1).t,timestamp(today));
});
test('daily candles honor an explicit shared range beyond one year, including continuation',async t=>{
 let count=0;
 const f=fixture(t,async(api,body)=>{
  assert.equal(api,'ka10081');count++;
  const dates=count===1?['20261020','20251029']:['20240514','20240513'];
  return {data:{stk_dt_pole_chart_qry:dates.map(dt=>({dt,open_pric:'100',high_pric:'110',low_pric:'90',cur_prc:'105'}))},headers:count===1?{'cont-yn':'Y','next-key':'older'}:{}};
 });
 f.setTime(timestamp(today,'210000'));await f.service.configure(['005930'],0);
 const result=await f.service.candles({code:'005930',mode:'day',from:'20240514',to:today});
 assert.deepEqual(result.points.map(p=>day(p.t)),['2024-05-14','2025-10-29','2026-10-20']);
 assert.equal(count,2);
 await assert.rejects(f.service.candles({code:'005930',mode:'day',from:'20260230',to:today}));
 function day(t){return new Date(t+32400000).toISOString().slice(0,10);}
});
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
    // 일봉 가격은 수정주가로 받는다(2026-11-21).
    assert.ok(f.calls.filter(call => call.headers['api-id'] === 'ka10081').every(call => call.body.upd_stkpc_tp === '1'));
    assert.deepEqual(fs.readdirSync(f.directory), ['watchlist.json']);
    await assert.rejects(f.service.query({ code: '005930', cursor: 'bad' }), /잘못된/);
});
test('completed days compress losslessly after 20:02 and archived reads and late updates work', async t => {
    const f = fixture(t, normal);
    await f.service.configure(['005930'], 0);
    f.service.store.merge('005930', { t: timestamp(today, '101500'), foreign: -20, program: -40 });
    const original = f.service.store.points('005930', '2026-10-20');
    const file = path.join(f.directory, '005930', '2026-10-20.json');
    const originalSize = fs.statSync(file).size;
    f.setTime(timestamp(today, '200100')); assert.equal(f.service.store.archiveCompleted(), 0);
    f.setTime(timestamp(today, '200200')); assert.equal(f.service.store.archiveCompleted(), 1);
    assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(`${file}.gz`), true);
    assert.ok(fs.statSync(`${file}.gz`).size < originalSize);
    assert.deepEqual(f.service.store.points('005930', '2026-10-20'), original);
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
test('종목 분봉 수급은 키움에서 모으거나 읽지 않는다(2026-11-22, 소스는 한 곳: 한투 kis-supply)', async t => {
    const f = fixture(t, api => { throw new Error(`Unexpected API ${api}`); });
    f.setTime(timestamp(today, '101500'));
    await f.service.configure(['005930'], 0);
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.calls, [], '종목 등록이 키움 분봉 수급 수집(ka10060 · ka90008)을 부르지 않는다');
    assert.equal(f.service.collect, undefined); assert.equal(f.service.start, undefined);
    await assert.rejects(f.service.query({ code: '005930', mode: 'minute' }), /한투/);
    assert.deepEqual(fs.readdirSync(f.directory), ['watchlist.json']);
    assert.equal(f.service.summary().statuses, undefined);
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
test('minute price candles use the latest real trading day without writing flow data', async t => {
    const f = fixture(t, api => {
        if (api !== 'ka10080') throw new Error(`Unexpected API ${api}`);
        return { data: { stk_min_pole_chart_qry: [{ cntr_tm: '20261019101500', open_pric: '100', high_pric: '120', low_pric: '90', cur_prc: '110' }] }, headers: {} };
    });
    f.setTime(timestamp(today, '220000')); await f.service.configure(['005930'], 0);
    const price = await f.service.candles({ code: '005930', mode: 'minute' });
    assert.equal(price.date, '2026-10-19'); assert.equal(price.points.length, 1);
    assert.deepEqual(fs.readdirSync(f.directory), ['watchlist.json']);
});
test('minute price history advertises previous trading dates', async t => {
    const f = fixture(t, api => {
        if (api !== 'ka10080') throw new Error(`Unexpected API ${api}`);
        return { data: { stk_min_pole_chart_qry: ['20261020','20261019','20261016'].map(day => ({
            cntr_tm: day + '101500', open_pric: '100', high_pric: '120', low_pric: '90', cur_prc: '110'
        })) }, headers: {} };
    });
    f.setTime(timestamp(today, '220000')); await f.service.configure(['005930'], 0);
    const first = await f.service.candles({ code: '005930', mode: 'minute' });
    assert.equal(first.has_more, true); assert.equal(first.cursor, '20261019'); assert.equal(first.points.length, 1);
    const second = await f.service.candles({ code: '005930', mode: 'minute', date: '2026-10-19' });
    assert.equal(second.has_more, true); assert.equal(second.cursor, '20261016');
    const third = await f.service.candles({ code: '005930', mode: 'minute', date: '2026-10-16' });
    assert.equal(third.has_more, false); assert.equal(third.points.length, 1);
    assert.deepEqual(fs.readdirSync(f.directory), ['watchlist.json']);
});

test('market probe waits through delayed opening, throttles, persists and survives trading pauses', async t => {
    let rows = [{ cntr_tm: '20261019080000', trde_qty: '10' }];
    const f = fixture(t, normal, () => ({ data: { stk_min_pole_chart_qry: rows } }));
    f.setTime(timestamp(today, '080000'));
    await f.service.configure(['005930'], 0); await f.service.confirmMarket();
    assert.equal(f.calls.length, 1); assert.deepEqual(f.service.store.dates('005930'), []);
    await f.service.confirmMarket(); assert.equal(f.calls.length, 1);
    f.setTime(timestamp(today, '090100')); rows = [{ cntr_tm: today+'090100', trde_qty: '0' }];
    await f.service.confirmMarket(); assert.equal(f.calls.length, 2);
    f.setTime(timestamp(today, '100000')); rows = [{ cntr_tm: today+'100000', trde_qty: '1' }];
    await f.service.confirmMarket(); assert.equal(f.service.summary().market_confirmed, true);
    const probes = f.calls.filter(c => c.headers['api-id'] === 'ka10080').length;
    f.setTime(timestamp(today, '110000')); rows = [];
    await f.service.confirmMarket();
    assert.equal(f.calls.filter(c => c.headers['api-id'] === 'ka10080').length, probes);
    const restarted = createSupplyService({ directory: f.directory, now: () => timestamp(today,'120000'), getToken: async () => 'test', pause: async () => {}, http: { post: async (url, body, options) => { assert.notEqual(options.headers['api-id'],'ka10080'); return normal(options.headers['api-id'],body); } } });
    await restarted.confirmMarket(); assert.equal(restarted.summary().market_confirmed, true);
    f.setTime(timestamp('20261021','080000')); await f.service.confirmMarket();
    assert.equal(f.service.summary().market_confirmed, false);
});
test('market probe retries errors until 10:30 and stops probing after the 10:30 cutoff', async t => {
    let fail = true;
    const f = fixture(t, normal, () => { if (fail) throw Error('network'); return { data: { stk_min_pole_chart_qry: [] } }; });
    f.setTime(timestamp(today,'102900')); await f.service.configure(['005930'],0); await f.service.confirmMarket();
    assert.equal(f.calls.length,1); fail = false;
    f.setTime(timestamp(today,'103000')); await f.service.confirmMarket(); assert.equal(f.calls.length,2);
    f.setTime(timestamp(today,'103100')); await f.service.confirmMarket(); assert.equal(f.calls.length,2);
    assert.deepEqual(f.service.store.dates('005930'), []);
});
test('10:30 final probe can confirm opening', async t => {
    const f = fixture(t, normal); f.setTime(timestamp(today,'103000'));
    await f.service.configure(['005930'],0); await f.service.confirmMarket();
    assert.equal(f.service.summary().market_confirmed,true);
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
test('지난날 분봉 캔들은 base_dt로 그날 끝부터 한 쪽만 받는다(2026-11-21: 오늘부터 거슬러 오느라 먼 날일수록 느렸다)', async t => {
    const pages = [];
    const f = fixture(t, (api, body, headers) => {
        if (api !== 'ka10080') throw new Error(`Unexpected API ${api}`);
        pages.push({ base: body.base_dt, next: headers['next-key'] || '' });
        // base_dt를 주면 그날 19:59부터 거슬러 900봉: 그날과 전 거래일 일부.
        if (body.base_dt !== '20261016') return { data: { stk_min_pole_chart_qry: [{ cntr_tm: '20261020101500', open_pric: '1', high_pric: '1', low_pric: '1', cur_prc: '1' }] }, headers: { 'cont-yn': 'Y', 'next-key': 'K' + pages.length } };
        return { data: { stk_min_pole_chart_qry: [['20261016195900', 120], ['20261016090000', 110], ['20261015195900', 105]].map(([cntr_tm, p]) => ({ cntr_tm, open_pric: String(p), high_pric: String(p), low_pric: String(p), cur_prc: String(p) })) }, headers: { 'cont-yn': 'Y', 'next-key': 'K' } };
    });
    f.setTime(timestamp(today, '220000')); await f.service.configure(['005930'], 0);
    const price = await f.service.candles({ code: '005930', mode: 'minute', date: '2026-10-16' });
    assert.deepEqual(pages, [{ base: '20261016', next: '' }], '기준일 한 쪽으로 끝난다');
    assert.equal(price.date, '2026-10-16'); assert.deepEqual(price.points.map(p => p.close), [110, 120]);
    assert.equal(price.cursor, '20261015');
});
