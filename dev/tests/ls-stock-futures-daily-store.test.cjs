'use strict';
// 종목 선물 일봉 지난날 저장(2026-11-22): t8405 연결선물 가격과 t8462 일별 수급의 끝난 날을 파일로 두고,
// 서버를 다시 켜도 그 날들은 LS에 다시 묻지 않는다. 오늘(수급은 최근 이틀 포함)은 늘 LS에서 받는다.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createLsStockFutures } = require('../../ls-stock-futures');

const shift = (ymd, d) => new Date(Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}T00:00:00Z`) + d * 86400000).toISOString().slice(0, 10).replaceAll('-', '');
const weekdays = (from, to) => { const out = []; for (let d = to; d >= from; d = shift(d, -1)) { const w = new Date(Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T00:00:00Z`)).getUTCDay(); if (w && w !== 6) out.push(d); } return out; };
const kst = ymd => Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}T10:00:00+09:00`);

// 오늘(today)까지의 평일을 최신순으로 주는 가짜 LS. t8405는 100봉씩 이어 받기, t8462는 from_date~to_date 150행씩.
function fakeLs(calls, today, close = () => 2) {
    const days = weekdays('20230101', today), flowDays = days.filter(d => d >= '20260211');
    return { post: async (url, body, { headers }) => {
        const tr = headers.tr_cd, input = body[tr + 'InBlock']; calls.push({ tr, input }); const data = { rsp_cd: '00000' };
        if (tr === 't2522') data.t2522OutBlock1 = [{ bsc_asts_nm: '삼성전자', bsc_asts_is_cd: '005930', bsc_asts_id: 'S11', nmc_is_shrt_cd: 'A116C000' }];
        if (tr === 't8405') {
            const rows = days.filter(d => !input.date || d <= input.date).slice(0, 100);
            data.t8405OutBlock1 = rows.map(date => ({ date, open: 1, high: 3, low: 1, close: close(date) }));
            data.t8405OutBlock = { date: rows.length === 100 ? shift(rows.at(-1), -1) : '', cts_code: 'X', lastdate: 'Y' };
        }
        if (tr === 't8462') data.t8462OutBlock1 = flowDays.filter(d => d >= input.from_date && d <= input.to_date).slice(0, 150).map(date => ({ date, sv_08: -Number(date.slice(-2)), sv_17: Number(date.slice(4, 6)), sv_18: 1 }));
        return { data };
    } };
}
function setup(t) {
    const directory = fs.mkdtempSync(path.join(path.resolve(__dirname, '../output'), 'lsf-daily-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}
const service = (directory, today, calls, close) => createLsStockFutures({ http: fakeLs(calls, today, close), getToken: async () => 't', directory,
    supply: { summary: () => ({ stocks: [] }) }, now: () => kst(today), policy: () => ({ openDate: () => true }), pause: async () => {} });

test('연결선물 일봉 가격: 다음 날 새 서버는 최신 한 쪽만 LS에 묻고 지난날은 파일에서 같은 값으로 준다', async t => {
    const directory = setup(t), calls = [];
    const first = await service(directory, '20261120', calls).candles({ code: '005930', mode: 'day', from: '20000101' });
    assert.equal(first.exhausted, true);
    const firstPages = calls.filter(c => c.tr === 't8405').length;
    assert.ok(firstPages > 3);
    calls.length = 0;
    const next = await service(directory, '20261123', calls).candles({ code: '005930', mode: 'day', from: '20000101' });
    assert.equal(calls.filter(c => c.tr === 't8405').length, 1, '새로 받은 쪽이 저장된 날에 닿으면 멈춘다');
    assert.equal(next.exhausted, true); assert.equal(next.partial, false);
    assert.deepEqual(next.points.slice(0, first.points.length - 1), first.points.slice(0, -1), '지난날 값이 같다');
    assert.equal(next.points.at(-1).t, Date.parse('2026-11-23T00:00:00+09:00'), '오늘 봉은 LS에서');
    // 보통 화면(600봉)도 한 쪽만.
    calls.length = 0;
    const page = await service(directory, '20261123', calls).candles({ code: '005930', mode: 'day', count: '600' });
    assert.equal(page.points.length, 600); assert.equal(calls.filter(c => c.tr === 't8405').length, 1);
});

test('연결선물 일봉 가격: 겹치는 날 종가가 바뀌면 저장본을 버리고 초기화 기록을 남긴다', async t => {
    const directory = setup(t), calls = [];
    await service(directory, '20261120', calls).candles({ code: '005930', mode: 'day', from: '20000101' });
    const changed = service(directory, '20261123', calls, date => date < '20261110' ? 1.5 : 2);
    const result = await changed.candles({ code: '005930', mode: 'day', from: '20000101' });
    assert.equal(result.points.find(p => p.t === Date.parse('2026-03-03T00:00:00+09:00')).close, 1.5, '옛 값을 섞지 않는다');
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'daily', 'resets.json'), 'utf8')).count, 1);
});

test('일별 수급(t8462): 끝난 날은 저장하고 다음 서버는 저장된 날 다음부터만 묻는다', async t => {
    const directory = setup(t), calls = [];
    const first = await service(directory, '20261120', calls).query({ code: '005930', mode: 'day' });
    assert.equal(calls.filter(c => c.tr === 't8462').length, 2);
    calls.length = 0;
    const next = await service(directory, '20261123', calls).query({ code: '005930', mode: 'day' });
    const asked = calls.filter(c => c.tr === 't8462');
    assert.equal(asked.length, 1); assert.equal(asked[0].input.from_date, '20261118', '11/17까지 저장(사흘 전), 그 다음 날부터');
    assert.deepEqual(next.points.slice(0, first.points.length), first.points, '지난날 값이 같다');
    assert.equal(next.points.length, first.points.length + 1, '11/23이 더해진다');
    // 저장된 범위 안의 과거 커서는 LS를 부르지 않는다.
    calls.length = 0;
    const past = await service(directory, '20261123', calls).query({ code: '005930', mode: 'day', cursor: '20260901' });
    assert.equal(calls.filter(c => c.tr === 't8462').length, 0);
    assert.equal(past.points.at(-1).t, Date.parse('2026-09-01T00:00:00+09:00'));
});
