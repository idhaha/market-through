// 오라클 중복 자료 정리(2026-11-22, 소스는 한 곳): 고른 묶음의 지난날 파일 중 로컬 백업에 같은 사본이 있는 것만 지운다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { SETS, plan, topOf } = require('../oracle-remove-duplicate-data.cjs');

test('키움 분봉 수급 묶음은 종목 날짜 파일만 고르고, 목록 · 장날 파일과 다른 폴더는 건드리지 않는다', () => {
    const rule = SETS['supply-minute'];
    for (const rel of ['supply/005930/2026-10-21.json.gz', 'supply/028050/2026-11-13.json']) assert.ok(rule.test(rel), rel);
    for (const rel of ['supply/watchlist.json', 'supply/market-day.json', 'kis-supply/005930/2026-10-21.json.gz',
        'kiwoom-minute/005930_AL/2026-10-21.json.gz', 'supply/005930/../watchlist.json', 'supply/005930/2026-10-21.json.gz.tmp'])
        assert.ok(!rule.test(rel), rel);
    assert.ok(SETS['kis-concentration'].test('kis-concentration/0001/20261023.json'));
    assert.ok(!SETS['ls-market-supply-raw'].test('ls-market-supply/validation.json'));
    assert.ok(SETS['kis-spot-market-supply'].test('market-supply/KOSPI0/2026-11-20.json.gz'));
    // 오라클에서 목록을 볼 폴더 이름(셸 명령에 들어가므로 영문 · 숫자 · '-'만).
    assert.deepEqual(Object.keys(SETS).map(topOf), ['supply', 'ls-supply', 'ls-market-supply', 'kis-turnover', 'kis-concentration', 'market-supply']);
    for (const rel of ['market-supply/FUTURE/2026-11-20.json.gz', 'market-supply/FUTKQ0/2026-11-20.json.gz', 'kiwoom-market-supply/KOSPI0/2026-11-20.json.gz'])
        assert.ok(!SETS['kis-spot-market-supply'].test(rel), rel);
});

test('로컬 백업과 크기 · sha256이 같은 지난날 파일만 지우고, 없거나 다르거나 오늘 파일은 남긴다', t => {
    const backup = fs.mkdtempSync(path.join(path.resolve(__dirname, '../output'), 'dup-cleanup-'));
    t.after(() => fs.rmSync(backup, { recursive: true, force: true }));
    const put = (rel, text) => { const file = path.join(backup, ...rel.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    const entry = (rel, text) => ({ rel, size: Buffer.byteLength(text), hash: crypto.createHash('sha256').update(text).digest('hex') });
    put('supply/005930/2026-10-21.json.gz', 'same'); put('supply/005930/2026-10-22.json.gz', 'old copy');
    put('supply/005930/2026-11-22.json', 'today'); put('supply/watchlist.json', 'w');
    const remote = [entry('supply/005930/2026-10-21.json.gz', 'same'), entry('supply/005930/2026-10-22.json.gz', 'changed'),
        entry('supply/005930/2026-10-23.json.gz', 'no backup'), entry('supply/005930/2026-11-22.json', 'today'), entry('supply/watchlist.json', 'w')];
    const result = plan(remote, { sets: ['supply-minute'], backup, today: '2026-11-22' });
    assert.deepEqual(result.remove.map(f => f.rel), ['supply/005930/2026-10-21.json.gz']);
    assert.deepEqual(result.skip.map(f => [f.rel, f.why]), [['supply/005930/2026-10-22.json.gz', '로컬 백업과 다름'],
        ['supply/005930/2026-10-23.json.gz', '로컬 백업 없음'], ['supply/005930/2026-11-22.json', '오늘 파일']]);
    assert.throws(() => plan(remote, { sets: ['unknown'], backup, today: '2026-11-22' }), /모르는 묶음/);
    assert.deepEqual(plan(remote, { sets: [], backup, today: '2026-11-22' }).remove, []);
});
