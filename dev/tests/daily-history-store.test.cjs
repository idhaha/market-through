// 지난날 일봉 저장(2026-11-22): 일별 수급 이력 캐시가 끝난 날(3일 이상 전)의 행과 다 받은 범위를 파일로 두고,
// 서버를 다시 켜도 그 범위는 증권사에 다시 묻지 않는다. 최근 이틀은 예전처럼 다시 받는다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createHistoryCache } = require('../../daily-query-cache');

const NOW = Date.parse('2026-11-20T06:00:00Z'); // 한국 11/20 15:00
function setup(t) {
    const directory = fs.mkdtempSync(path.join(path.resolve(__dirname, '../output'), 'daily-history-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const calls = [];
    const load = async (from, to) => { calls.push([from, to]); const rows = []; for (const dt of ['20261110', '20261111', '20261112', '20261113', '20261116', '20261117', '20261118', '20261119', '20261120']) if (dt >= from && dt <= to) rows.push({ dt, foreign: Number(dt.slice(-2)) }); return { rows }; };
    return { directory, calls, load };
}

test('끝난 날은 파일에서 읽고 증권사에 다시 묻지 않는다(재시작 뒤에도)', async t => {
    const { directory, calls, load } = setup(t);
    const first = await createHistoryCache({ now: () => NOW, directory }).read('005930:ka10060', { from: '20261110', to: '20261120', load });
    assert.deepEqual(calls, [['20261110', '20261120']]);
    assert.equal(first.rows.length, 9);
    assert.ok(fs.existsSync(path.join(directory, '005930_ka10060.json.gz')));
    // 새 서버: 11/18 이후(최근 이틀 · 오늘)만 다시 묻는다.
    calls.length = 0;
    const again = await createHistoryCache({ now: () => NOW, directory }).read('005930:ka10060', { from: '20261110', to: '20261120', load });
    assert.deepEqual(calls, [['20261118', '20261120']]);
    assert.deepEqual(again.rows, first.rows);
    // 저장된 범위 안의 과거 구간만 보면 증권사를 부르지 않는다.
    calls.length = 0;
    await createHistoryCache({ now: () => NOW, directory }).read('005930:ka10060', { from: '20261110', to: '20261113', load });
    assert.deepEqual(calls, []);
});

test('실패하거나 일부만 받은 범위는 저장하지 않는다', async t => {
    const { directory } = setup(t);
    await createHistoryCache({ now: () => NOW, directory }).read('k', { from: '20261110', to: '20261113', load: async () => ({ rows: [{ dt: '20261110', foreign: 1 }], partial: true }) });
    assert.ok(!fs.existsSync(path.join(directory, 'k.json.gz')));
    await createHistoryCache({ now: () => NOW, directory }).read('k', { from: '20261110', to: '20261113', load: async () => { throw new Error('조회 실패'); } });
    assert.ok(!fs.existsSync(path.join(directory, 'k.json.gz')));
});

test('directory가 없으면 예전처럼 메모리에만 둔다', async () => {
    const calls = [];
    const cache = createHistoryCache({ now: () => NOW });
    await cache.read('k', { from: '20261110', to: '20261113', load: async (f, t) => { calls.push([f, t]); return { rows: [] }; } });
    await cache.read('k', { from: '20261110', to: '20261113', load: async (f, t) => { calls.push([f, t]); return { rows: [] }; } });
    assert.equal(calls.length, 1);
});
