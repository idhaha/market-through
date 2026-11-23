// 지난 분봉 미리 받기(2026-11-23): 매일 20:20(처음 22:00에서 당김) 최근 60거래일의 LS 1분 거래대금(시장 · 관심 종목)과 종목 선물 1분 가격을 받아 둔다.
const test = require('node:test'), assert = require('node:assert/strict');
const { createLsHistoryPrefetch } = require('../../ls-history-prefetch');
const at = s => Date.parse(s);

function setup({ now = at('2026-11-23T23:00:00+09:00'), holidays = [], noFutures = [], codes = ['005930', '000660'] } = {}) {
    const calls = { turnover: [], futures: [], pauses: 0, logs: [] };
    let clock = now;
    const prefetch = createLsHistoryPrefetch({
        now: () => clock, days: 5,
        openDate: date => holidays.includes(date) ? false : null,
        stocks: () => codes,
        turnover: async (instrument, mode, dates) => { calls.turnover.push(`${instrument}:${mode}:${dates.join(',')}`); return { values: new Map(), warnings: [] }; },
        futuresCandles: async input => {
            calls.futures.push(`${input.code}:${input.date}`);
            if (noFutures.includes(input.code)) throw Object.assign(new Error('주식선물이 없는 종목입니다.'), { status: 404 });
            clock += 500; // 증권사까지 간 것처럼 시간이 걸린다
            return { success: true, points: [] };
        },
        pause: async () => { calls.pauses++; },
        log: message => calls.logs.push(message)
    });
    return { prefetch, calls };
}

test('어제부터 장이 열린 날만 고른다(오늘 · 주말 · 휴장일 제외)', () => {
    const { prefetch } = setup({ holidays: ['2026-11-18'] });
    // 2026-11-23(월) 밤: 11/20(금) 11/19 11/17 11/16 11/13 — 11/21 · 22 주말, 11/18 휴장
    assert.deepEqual(prefetch.pastOpenDays(), ['2026-11-20', '2026-11-19', '2026-11-17', '2026-11-16', '2026-11-13']);
});

test('날마다 시장 두 곳과 관심 종목의 1분 거래대금, 관심 종목의 종목 선물 1분 가격을 확인한다', async () => {
    const { prefetch, calls } = setup();
    const result = await prefetch.run();
    assert.equal(result.days, 5);
    assert.equal(calls.turnover.length, 5 * 4);
    assert.ok(calls.turnover.includes('kospi:minute:20261120') && calls.turnover.includes('kosdaq:minute:20261116') && calls.turnover.includes('000660:minute:20261117'));
    assert.equal(calls.futures.length, 5 * 2);
    assert.ok(calls.futures.includes('005930:2026-11-20'));
    assert.equal(calls.pauses, 10, '증권사까지 간 종목 선물 조회 뒤에만 쉰다');
    assert.match(calls.logs.at(-1), /5거래일 · 관심 종목 2개/);
});

test('주식선물이 없는 종목은 한 번 확인한 뒤 건너뛴다', async () => {
    const { prefetch, calls } = setup({ noFutures: ['000660'] });
    const result = await prefetch.run();
    assert.equal(calls.futures.filter(c => c.startsWith('000660')).length, 1);
    assert.equal(result.failures, 0);
    assert.match(calls.logs.at(-1), /선물 없음 1/);
});

test('다음 20:20(한국 시각)까지 기다린다', () => {
    assert.equal(setup({ now: at('2026-11-23T19:20:00+09:00') }).prefetch.msUntilNext(), 3600000);
    assert.equal(setup({ now: at('2026-11-23T20:50:00+09:00') }).prefetch.msUntilNext(), 23.5 * 3600000);
});

test('도는 중에 다시 불러도 한 번만 돈다', async () => {
    const { prefetch, calls } = setup({ codes: [] });
    await Promise.all([prefetch.run(), prefetch.run()]);
    assert.equal(calls.turnover.length, 5 * 2);
});
