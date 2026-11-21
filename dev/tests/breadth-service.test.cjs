const { test } = require('node:test');
// 1분봉 축은 저장된 분 파일의 하루 08:00~20:00 매분이다(2026-11-21). 수집한 분(값이 하나라도 있는 행)만 고른다.
const seen=(r,id)=>{const keep=new Set(r.dates.filter(d=>['highs','lows','adr'].some(k=>r.series[k].points.find(p=>p.date===d)?.value!=null)));return r.series[id].points.filter(p=>keep.has(p.date));};
// 두 날(오늘 쪽 첫 쪽 + 날짜 커서 다음 쪽)을 옛 날부터.
const twoDays=async(service,market,id='highs',all=false)=>{const a=await service.query({mode:'minute',market});const b=a.cursor?await service.query({mode:'minute',market,cursor:a.cursor}):null;const pick=r=>all?r.series[id].points:seen(r,id);return [...(b?pick(b):[]),...pick(a)].map(p=>p.value);};
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
            if (api === 'ka10099') return { data: { list: body.mrkt_tp === '0'
                ? [{ code: '005930', name: '삼성전자', marketCode: '0' }, { code: '000660', name: 'SK하이닉스', marketCode: '0' },{ code: '005935', name: '삼성전자우', marketCode: '0' }, { code: '069500', name: 'KODEX 200', marketCode: '8' }]
                : [{ code: '005930', name: '시험보통주', marketCode: '10' }, { code: '000660', name: '시험보통주2', marketCode: '10' }, { code: '123450', name: '시험스팩1호', marketCode: '10' }] }, headers: {} };
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
    assert.equal(seen(minute,'highs')[0].value, 1);
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
    const f = fixture(t); let repeated = false; const original = f.options.http.post;
    f.options.http.post = async (url, body, options) => options.headers['api-id'] === 'ka10099' ? original(url, body, options) : ({ data: { ntl_pric: [{ stk_cd: options.headers['next-key'] ? '000660' : '005930' }] },
        headers: !options.headers['next-key'] || repeated ? { 'cont-yn': 'Y', 'next-key': 'opaque-key' } : {} });
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
 assert.equal(seen(kospi,'highs')[0].value,1);assert.equal(seen(kosdaq,'highs')[0].value,2);
 assert.equal(seen(both,'highs')[0].value,3);assert.equal(seen(both,'lows')[0].value,0);
 for(const market of ['kosdaq','all'])assert.equal((await f.service.query({market})).series.highs.points.find(p=>p.date==='2026-10-20').value,null);
 await assert.rejects(f.service.query({market:'invalid'}));
});


test('KOSDAQ failure cannot commit a partial combined snapshot',async t=>{
 const f=fixture(t),original=f.options.http.post;
 f.options.http.post=(url,body,options)=>{if(body.mrkt_tp==='101')throw new Error('KOSDAQ unavailable');return original(url,body,options);};
 await f.service.tick();assert.deepEqual(f.service.minuteRows('2026-10-21'),[]);
});


test('old combined minute JSON and gzip remain queryable only as all; new data wins and originals remain intact',async t=>{
 const zlib=require('node:zlib');const f=fixture(t);
 const legacyCombinedDirectory=path.join(f.root,'old-combined'),legacyKospiDirectory=path.join(f.root,'old-kospi');
 fs.mkdirSync(legacyCombinedDirectory);fs.mkdirSync(legacyKospiDirectory);
 const old21=JSON.stringify([{t:timestamp('20261021','080100'),highs:46,lows:131}]);
 const old22=JSON.stringify([{t:timestamp('20261022','080100'),highs:57,lows:344}]);
 fs.writeFileSync(path.join(legacyCombinedDirectory,'2026-10-21.json'),old21);
 const compressed=zlib.gzipSync(old22);fs.writeFileSync(path.join(legacyCombinedDirectory,'2026-10-22.json.gz'),compressed);
 const options={...f.options,legacyCombinedDirectory,legacyKospiDirectory};
 let service=createBreadthService(options);
 options.http.post=async()=>({data:{stk_min_pole_chart_qry:['20261021080100','20261022080100'].map(cntr_tm=>({cntr_tm,cur_prc:'100',open_pric:'100',high_pric:'100',low_pric:'100'}))},headers:{}});
 f.at('20261023','120000');
 assert.deepEqual(await twoDays(service,'all'),[46,57]);
 for(const market of ['kospi','kosdaq'])assert.ok((await twoDays(service,market,'highs',true)).every(v=>v===null));
 fs.writeFileSync(path.join(legacyKospiDirectory,'2026-10-21.json'),JSON.stringify([{t:timestamp('20261021','080100'),highs:10,lows:20}]));
 fs.writeFileSync(path.join(options.directory,'2026-10-22.json'),JSON.stringify([{t:timestamp('20261022','080100'),kospi:{highs:1,lows:2},kosdaq:{highs:3,lows:4}}]));
 service=createBreadthService(options);
 assert.deepEqual(await twoDays(service,'all'),[46,4]);
 assert.deepEqual(await twoDays(service,'kospi'),[10,1]);
 assert.equal(fs.readFileSync(path.join(legacyCombinedDirectory,'2026-10-21.json'),'utf8'),old21);
 assert.ok(fs.readFileSync(path.join(legacyCombinedDirectory,'2026-10-22.json.gz')).equals(compressed));
});

test('counts common stocks only: ETF, preferred and SPAC codes from ka10016 are dropped; list fetched once a day, saved list used on failure', async t => {
 const f=fixture(t),original=f.options.http.post;let listFails=false;
 f.options.http.post=async(url,body,options)=>{
  const api=options.headers['api-id'];
  if(api==='ka10099'&&listFails)throw new Error('list offline');
  const response=await original(url,body,options);
  if(api==='ka10016'&&body.ntl_tp==='1')response.data.ntl_pric.push({stk_cd:'005935'},{stk_cd:'069500_AL'},{stk_cd:'123450'},{stk_cd:'000660'});
  return response;
 };
 assert.deepEqual(await f.service.snapshot(),{kospi:{highs:2,lows:0},kosdaq:{highs:2,lows:0}});
 assert.equal(f.calls.filter(c=>c.api==='ka10099').length,2);
 assert.ok(f.calls.filter(c=>c.api==='ka10099').every(c=>c.headers['api-id']==='ka10099'));
 await f.service.snapshot();assert.equal(f.calls.filter(c=>c.api==='ka10099').length,2);
 const saved=JSON.parse(fs.readFileSync(path.join(f.options.directory,'universe.json'),'utf8'));
 assert.deepEqual([saved.kospi,saved.kosdaq],[['000660','005930'],['000660','005930']]);
 listFails=true;f.at('20261022','080100');
 const next=createBreadthService(f.options);
 assert.deepEqual(await next.snapshot(),{kospi:{highs:2,lows:0},kosdaq:{highs:2,lows:0}});
 fs.rmSync(path.join(f.options.directory,'universe.json'));
 await assert.rejects(createBreadthService(f.options).snapshot(),/list offline/);
});

test('minuteFrom hides minutes saved on the old ETF-including basis without touching the files', async t => {
 const f=fixture(t);fs.mkdirSync(f.options.directory,{recursive:true});
 const old=JSON.stringify([{t:timestamp('20261106','090000'),kospi:{highs:45,lows:355},kosdaq:{highs:7,lows:370}}]);
 fs.writeFileSync(path.join(f.options.directory,'2026-11-06.json'),old);
 fs.writeFileSync(path.join(f.options.directory,'daily.json'),JSON.stringify({points:[],basis:'common',computedThrough:'2026-11-06',minuteFrom:'2026-11-09'}));
 assert.deepEqual(f.service.minuteRows('2026-11-06'),[]);
 assert.equal(fs.readFileSync(path.join(f.options.directory,'2026-11-06.json'),'utf8'),old);
 fs.writeFileSync(path.join(f.options.directory,'2026-11-09.json'),old);
 assert.equal(f.service.minuteRows('2026-11-09').length,1);
 f.options.http.post=async()=>({data:{stk_dt_pole_chart_qry:[{dt:'20261106',open_pric:'1',high_pric:'1',low_pric:'1',cur_prc:'1'}]},headers:{}});
 f.at('20261108','120000');
 const day=await createBreadthService(f.options).query({market:'kospi'});
 assert.match(day.notice,/보통주 · KRX\+NXT 통합 · 2026-11-06까지 일봉 계산, 이후 키움 집계/);
});
test('1분봉 축은 키움 없이 저장된 분 파일: 하루 08:00~20:00 매분(놓친 분은 빈칸), 커서는 날짜(그날 포함)',async t=>{
 const f=fixture(t);fs.mkdirSync(f.options.directory,{recursive:true});
 const save=(day,clocks)=>fs.writeFileSync(path.join(f.options.directory,day+'.json'),JSON.stringify(clocks.map((c,i)=>({t:timestamp(day.replaceAll('-',''),c),kospi:{highs:i+1,lows:1}}))));
 save('2026-10-19',['090000']);save('2026-10-20',['080000','080200','200000']);
 f.at('20261021','120000');const before=f.calls.length;
 const today=await f.service.query({mode:'minute',market:'kospi'});
 // 10/21은 분 파일이 없다 → 가장 최근 10/20.
 assert.equal(today.dates[0],'2026-10-20 08:00');assert.equal(today.dates.at(-1),'2026-10-20 20:00');assert.equal(today.dates.length,721);
 assert.deepEqual(today.series.highs.points.slice(0,3).map(p=>p.value),[1,null,2],'08:01은 수집을 놓쳐 빈칸');
 assert.equal(today.cursor,'20261019');assert.equal(today.has_more,true);
 assert.equal(f.calls.slice(before).filter(c=>c.api==='ka10080').length,0,'키움 분봉을 부르지 않는다');
 const past=await f.service.query({mode:'minute',market:'kospi',cursor:'20261019'});
 assert.equal(past.dates[0],'2026-10-19 08:00');assert.equal(seen(past,'highs')[0].date,'2026-10-19 09:00');assert.equal(past.has_more,false);assert.equal(past.cursor,null);
 // 커서 날에 분 파일이 없으면 그 이전 날.
 assert.equal((await f.service.query({mode:'minute',market:'kospi',cursor:'20261020'})).dates[0],'2026-10-20 08:00');
 // 오늘은 지금 시각까지만.
 save('2026-10-21',['080000']);f.at('20261021','080500');
 const live=await f.service.query({mode:'minute',market:'kospi',cursor:'20261021'});
 assert.equal(live.dates.at(-1),'2026-10-21 08:05');
});
