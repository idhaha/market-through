// 키움 앱키 토큰(2026-11-22 오라클 장애 재발 방지): 만료 직전 여러 요청이 동시에 와도 새 토큰은 한 번만 받고,
// 키움이 거부한(8005) 토큰은 버린 뒤 다시 받으며, 늦게 온 옛 토큰 거부가 새 토큰을 버리지 않는다.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createKiwoomKeyToken } = require('../../kiwoom-key-token');

function setup(t) {
    const dir = fs.mkdtempSync(path.join(path.resolve(__dirname, '../output'), 'kiwoom-key-token-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let issued = 0, time = Date.parse('2026-11-22T06:00:00Z');
    const http = { post: async () => { issued++; await new Promise(r => setTimeout(r, 5)); return { data: { return_code: 0, token: 'T' + issued } }; } };
    const token = createKiwoomKeyToken({ appKey: 'k', secretKey: 's', file: path.join(dir, 'token.json'), http, now: () => time });
    return { token, file: path.join(dir, 'token.json'), issued: () => issued, advance: ms => { time += ms; } };
}

test('동시에 여러 요청이 토큰을 찾아도 새 토큰은 한 번만 받는다', async t => {
    const s = setup(t);
    const tokens = await Promise.all(Array.from({ length: 7 }, () => s.token.get()));
    assert.equal(s.issued(), 1); assert.deepEqual(new Set(tokens), new Set(['T1']));
    assert.equal(JSON.parse(fs.readFileSync(s.file, 'utf8')).token, 'T1');
    // 만료 5분 전: 다시 동시에 찾아도 한 번만.
    s.advance(86400000 - 200000);
    const again = await Promise.all(Array.from({ length: 7 }, () => s.token.get()));
    assert.equal(s.issued(), 2); assert.deepEqual(new Set(again), new Set(['T2']));
});

test('거부된 토큰은 버리고 다음에 새로 받지만, 이미 바뀐 뒤 늦게 온 옛 토큰 거부는 새 토큰을 버리지 않는다', async t => {
    const s = setup(t);
    assert.equal(await s.token.get(), 'T1');
    s.token.reject('T1');
    assert.equal(await s.token.get(), 'T2'); assert.equal(s.issued(), 2);
    s.token.reject('T1');
    assert.equal(await s.token.get(), 'T2'); assert.equal(s.issued(), 2);
    s.token.reject();
    assert.equal(await s.token.get(), 'T3');
});

test('재시작 때 파일의 토큰이 거부돼 있으면 한 번 거부된 뒤 새로 받는다', async t => {
    const s = setup(t);
    fs.writeFileSync(s.file, JSON.stringify({ token: 'STALE', expires: Date.parse('2026-11-23T06:00:00Z') }));
    assert.equal(await s.token.get(), 'STALE'); assert.equal(s.issued(), 0);
    s.token.reject('STALE');
    assert.equal(await s.token.get(), 'T1');
});
