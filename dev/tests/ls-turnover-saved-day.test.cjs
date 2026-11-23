// 2026-11-23 오라클: 수능일(11/19, 10:00~16:30) LS 1분 거래대금 저장분을 09:00 기준으로 "덜 받은 날"로 보아, 화면이 볼 때마다 LS에서
// 다시 받아 같은 내용으로 파일을 덮어썼다. 수정 시각이 바뀌어 차트 변경 번호(ls-turnover)가 하루 380번 올랐고,
// 그때마다 브라우저가 시장 거래대금 · 쏠림율 저장분을 버렸다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const { createBrokerTurnoverData } = require('../../broker-turnover-data');
const { createSupplyStore } = require('../../supply-store');

const at = (day, hm) => Date.parse(`${day}T${hm}:00+09:00`);
function savedDay(directory, day, from, to) {
    const rows = []; let total = 0;
    for (let t = at(day, from); t <= at(day, to); t += 60000) { total += 1000000; rows.push({ t, amount: total, amount_at: t }); }
    fs.mkdirSync(path.join(directory, 'KOSPI0'), { recursive: true });
    const file = path.join(directory, 'KOSPI0', `${day}.json.gz`);
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(rows)));
    return file;
}

test('개장이 늦은 날(수능일 10:00~16:30)도 다 받아 둔 날이면 LS를 다시 부르지 않고 파일을 건드리지 않는다', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-saved-day-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = savedDay(directory, '2026-11-19', '10:00', '16:30');
    const old = new Date('2026-11-20T00:00:00Z'); fs.utimesSync(file, old, old);
    const calls = [];
    const data = createBrokerTurnoverData({
        broker: 'ls', directory, now: () => at('2026-11-23', '21:30'), transport: { setStreams() {} }, getToken: async () => 't', pause: async () => {},
        http: { post: async (url, body) => { calls.push(Object.keys(body)[0]); throw new Error('LS를 부르면 안 된다'); } }
    });
    const result = await data.amounts('kospi', 'minute', ['20261119']);
    assert.equal(calls.length, 0, '저장분으로 답한다');
    assert.equal(result.warnings.length, 0);
    assert.ok(result.values.size > 300);
    assert.equal(fs.statSync(file).mtimeMs, old.getTime(), '파일을 다시 쓰지 않는다');
});

test('같은 값을 다시 저장하면 파일을 다시 쓰지 않고, 값이 바뀌면 쓴다', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'supply-store-same-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = createSupplyStore({ directory, now: () => at('2026-11-23', '21:30'), fields: ['amount'] });
    const file = savedDay(directory, '2026-11-19', '10:00', '10:05');
    const old = new Date('2026-11-20T00:00:00Z'); fs.utimesSync(file, old, old);
    const same = store.points('KOSPI0', '2026-11-19');
    store.mergeMany('KOSPI0', same);
    assert.equal(fs.statSync(file).mtimeMs, old.getTime(), '같은 내용이면 그대로 둔다');
    store.mergeMany('KOSPI0', [{ ...same[0], amount: 7 }]);
    assert.notEqual(fs.statSync(file).mtimeMs, old.getTime());
    assert.equal(store.points('KOSPI0', '2026-11-19')[0].amount, 7);
});
