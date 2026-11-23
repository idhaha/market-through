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

// 2026-11-24 오라클 측정: 지난날 쏠림율이 정규장 381분 중 380분만 나왔다. 저장분은 누적이라 1분 값을 직전 분과의 차이로 만드는데,
// 그날 첫 분(시장 09:00, 수능일 10:00)은 직전 분이 없어 빈칸이었다. 개장 시각의 첫 분은 누적값이 곧 그 분 거래대금이다.
test('저장된 지난날의 개장 첫 분(평소 09:00 · 수능일 10:00) 1분 거래대금이 빈칸이 아니다', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-saved-open-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    savedDay(directory, '2026-11-20', '09:00', '15:30');
    savedDay(directory, '2026-11-19', '10:00', '16:30');
    const data = createBrokerTurnoverData({
        broker: 'ls', directory, now: () => at('2026-11-24', '09:30'), transport: { setStreams() {} }, getToken: async () => 't', pause: async () => {},
        http: { post: async () => { throw new Error('LS를 부르면 안 된다'); } }
    });
    const result = await data.amounts('kospi', 'minute', ['20261119', '20261120']);
    assert.equal(result.values.get(at('2026-11-20', '09:00')), 1000000, '평소 09:00');
    assert.equal(result.values.get(at('2026-11-20', '09:01')), 1000000);
    assert.equal(result.values.get(at('2026-11-19', '10:00')), 1000000, '수능일 10:00');
    assert.equal(result.values.has(at('2026-11-20', '08:59')), false);
});

// 저장분이 장중에 끊겨 개장 시각이 아닌 분부터 시작하면 첫 분은 누적 전체라 1분 값으로 쓰지 않는다.
test('개장 시각이 아닌 분에서 시작한 날의 첫 분은 빈칸으로 둔다', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-saved-late-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    savedDay(directory, '2026-11-20', '10:15', '15:30');
    const data = createBrokerTurnoverData({
        broker: 'ls', directory, now: () => at('2026-11-24', '09:30'), transport: { setStreams() {} }, getToken: async () => 't', pause: async () => {},
        http: { post: async () => ({ data: {} }) }
    });
    const result = await data.amounts('kospi', 'minute', ['20261120']);
    assert.equal(result.values.has(at('2026-11-20', '10:15')), false);
});
