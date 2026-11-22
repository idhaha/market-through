const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createChartRevisions } = require('../../chart-revisions');

// 2026-11-09 10:00 KST unless moved.
function fixture(t) {
    const output = path.resolve(__dirname, '../output'); fs.mkdirSync(output, { recursive: true });
    const root = fs.mkdtempSync(path.join(output, 'revisions-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let time = Date.parse('2026-11-09T01:00:00Z');
    const routes = { '/api/kis-supply/chart': ['kis-supply'], '/api/risk/breadth': ['breadth/markets'], '/api/risk/volatility': ['volatility'], '/api/risk/sentiment': ['volatility'] };
    const data = path.join(root, 'data'), file = (rel, value) => { const full = path.join(data, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value)); };
    const make = () => createChartRevisions({ dataDirectory: data, directory: path.join(data, 'chart-revisions'), routes, now: () => time, minInterval: 0 });
    return { data, file, make, at: iso => { time = Date.parse(iso); }, touch: rel => { const full = path.join(data, rel), t2 = new Date(fs.statSync(full).mtimeMs + 5000); fs.utimesSync(full, t2, t2); } };
}

test('ordinary collection keeps revisions; a changed past day, a backfill or a removal changes only its routes', async t => {
    const f = fixture(t);
    f.file('kis-supply/005930/2026-11-05.json.gz', 'a'); f.file('kis-supply/005930/2026-11-06.json.gz', 'b');
    f.file('volatility/vix.json', { points: [{ date: '2026-11-05', value: 1 }, { date: '2026-11-06', value: 2 }], checkedAt: 1 });
    const service = f.make(), first = service.check();
    // Today's file is written every minute and a single file gains a new latest day: no change.
    f.file('kis-supply/005930/2026-11-09.json.gz', 'today'); f.file('kis-supply/005930/2026-11-09.json.gz', 'today-2');
    f.file('volatility/vix.json', { points: [{ date: '2026-11-05', value: 1 }, { date: '2026-11-06', value: 2 }, { date: '2026-11-09', value: 3 }], checkedAt: 2 });
    assert.deepEqual(service.check(), first);
    // The next day: yesterday's (11-09) file becomes past without a change.
    f.at('2026-11-10T01:00:00Z');
    assert.deepEqual(service.check(), first);
    // A finished day is rewritten (e.g. LS previous-day flow stored the next day).
    f.file('kis-supply/005930/2026-11-06.json.gz', 'b-corrected');
    const second = service.check();
    assert.notEqual(second['/api/kis-supply/chart'], first['/api/kis-supply/chart']);
    assert.equal(second['/api/risk/breadth'], first['/api/risk/breadth']);
    assert.equal(second['/api/risk/volatility'], first['/api/risk/volatility']);
    // Backfill of an older day than the newest known day.
    f.file('kis-supply/000660/2026-11-03.json.gz', 'imported');
    const third = service.check();
    assert.notEqual(third['/api/kis-supply/chart'], second['/api/kis-supply/chart']);
    // An old value inside a single file changes: both routes reading volatility change.
    f.file('volatility/vix.json', { points: [{ date: '2026-11-05', value: 9 }, { date: '2026-11-06', value: 2 }, { date: '2026-11-09', value: 3 }], checkedAt: 3 });
    const fourth = service.check();
    assert.notEqual(fourth['/api/risk/volatility'], third['/api/risk/volatility']);
    assert.notEqual(fourth['/api/risk/sentiment'], third['/api/risk/sentiment']);
    assert.equal(fourth['/api/kis-supply/chart'], third['/api/kis-supply/chart']);
    // A removed past file.
    fs.rmSync(path.join(f.data, 'kis-supply/000660/2026-11-03.json.gz'));
    assert.notEqual(service.check()['/api/kis-supply/chart'], fourth['/api/kis-supply/chart']);
});

test('the previous day stays live until 06:00 KST; the state survives a restart; a lost state gives new revisions', async t => {
    const f = fixture(t);
    f.file('breadth/markets/daily.json', { points: [{ date: '2026-11-06', kospi: { highs: 1, lows: 2 } }], basis: 'common' });
    f.file('breadth/markets/2026-11-06.json.gz', 'x');
    f.at('2026-11-09T19:00:00Z'); // 11-10 04:00 KST: 11-09 is still live
    const service = f.make(), first = service.check();
    f.file('breadth/markets/2026-11-09.json.gz', 'night write');
    f.file('breadth/markets/daily.json', { points: [{ date: '2026-11-06', kospi: { highs: 1, lows: 2 } }, { date: '2026-11-09', kospi: { highs: 3, lows: 4 } }], basis: 'common' });
    assert.deepEqual(service.check(), first);
    f.at('2026-11-09T22:00:00Z'); // 07:00 KST
    assert.deepEqual(service.check(), first);
    // Restart: same revisions; then a rewrite of past daily points (the common-stock rebuild case).
    const restarted = f.make();
    assert.deepEqual(restarted.check(), first);
    f.file('breadth/markets/daily.json', { points: [{ date: '2026-11-06', kospi: { highs: 0, lows: 9 } }, { date: '2026-11-09', kospi: { highs: 3, lows: 4 } }], basis: 'common' });
    assert.notEqual(restarted.check()['/api/risk/breadth'], first['/api/risk/breadth']);
    fs.rmSync(path.join(f.data, 'chart-revisions'), { recursive: true });
    const fresh = f.make().check();
    for (const route of Object.keys(first)) assert.notEqual(fresh[route], first[route], route);
});

test('non-data files and unreadable folders are ignored', async t => {
    const f = fixture(t);
    f.file('kis-supply/watchlist.json', { codes: [] }); f.file('breadth/markets/universe.json', { date: '2026-11-09', kospi: ['005930'] });
    const service = f.make(), first = service.check();
    f.file('kis-supply/watchlist.json', { codes: ['000660'] }); f.file('breadth/markets/universe.json', { date: '2026-11-10', kospi: [] });
    f.file('breadth/markets/daily.json.123.tmp', 'partial');
    assert.deepEqual(service.check(), first);
});

test('수정주가로 바꾼 경로(종목수급 · 쏠림율)는 저장 자료가 그대로여도 브라우저 저장 응답을 한 번 버리게 한다', t => {
    const { ROUTES, BASIS } = require('../../chart-revisions');
    const crypto = require('node:crypto');
    const output = path.resolve(__dirname, '../output'); fs.mkdirSync(output, { recursive: true });
    const root = fs.mkdtempSync(path.join(output, 'revisions-basis-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directory = path.join(root, 'data', 'chart-revisions');
    const service = createChartRevisions({ dataDirectory: path.join(root, 'data'), directory, routes: ROUTES, now: () => Date.parse('2026-11-23T01:00:00Z'), minInterval: 0 });
    const revisions = service.check(), id = JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')).id;
    const old = list => crypto.createHash('sha256').update(id + '|' + list.map(f => `${f}:0`).join('|')).digest('hex').slice(0, 16);
    assert.ok(Object.hasOwn(revisions, '/api/concentration-chart'));
    assert.equal(BASIS['/api/supply/chart'], 'adjusted-20261121');
    // 예전 계산식(기준 없음)과 달라야 브라우저가 수정 전 가격 응답을 버린다.
    assert.notEqual(revisions['/api/supply/chart'], old(ROUTES['/api/supply/chart']));
    // 기준이 없는 경로는 예전과 같은 값이라 불필요하게 버리지 않는다.
    assert.equal(revisions['/api/kis-supply/chart'], old(ROUTES['/api/kis-supply/chart']));
});

test('추가만 되는 kiwoom-minute: 처음 본 옛날 파일이 저장돼도 버전이 그대로이고, 파일이 고쳐지거나 지워질 때만 오른다', t => {
    const output = path.resolve(__dirname, '../output'); fs.mkdirSync(output, { recursive: true });
    const root = fs.mkdtempSync(path.join(output, 'revisions-append-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const data = path.join(root, 'data'), file = (rel, v) => { const full = path.join(data, rel); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, v); };
    const service = createChartRevisions({ dataDirectory: data, directory: path.join(data, 'chart-revisions'),
        routes: { '/api/concentration-chart': ['kiwoom-minute'], '/api/kis-supply/chart': ['kis-supply'] }, now: () => Date.parse('2026-11-23T01:00:00Z'), minInterval: 0 });
    file('kiwoom-minute/005930_AL/2026-11-20.json.gz', 'a'); file('kis-supply/005930/2026-11-20.json.gz', 'a');
    const first = service.check();
    // 옛날 날을 처음 봐서 저장: kiwoom-minute는 그대로, 보통 폴더(백필)는 오른다.
    file('kiwoom-minute/005930_AL/2026-11-10.json.gz', 'b'); file('kiwoom-minute/001/2026-11-10.json.gz', 'c'); file('kis-supply/005930/2026-11-10.json.gz', 'b');
    const second = service.check();
    assert.equal(second['/api/concentration-chart'], first['/api/concentration-chart']);
    assert.notEqual(second['/api/kis-supply/chart'], first['/api/kis-supply/chart']);
    // 저장된 파일이 고쳐지면 오른다.
    file('kiwoom-minute/005930_AL/2026-11-10.json.gz', 'changed');
    const third = service.check();
    assert.notEqual(third['/api/concentration-chart'], second['/api/concentration-chart']);
    // 지워져도 오른다.
    fs.rmSync(path.join(data, 'kiwoom-minute/001/2026-11-10.json.gz'));
    assert.notEqual(service.check()['/api/concentration-chart'], third['/api/concentration-chart']);
});
