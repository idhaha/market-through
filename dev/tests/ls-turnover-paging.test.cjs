// LS t8452 1분 거래대금 연속조회 경계에서 한 분이 빠지지 않는지(2026-11-27).
// 오라클 ls-turnover에 11/20 · 11/23 · 11/24 · 11/25 · 11/26의 11:20이 거래대금 0으로 저장돼 있었다. 하루 700행을 500행씩 받을 때
// 두 쪽의 경계(LS 112100 = 11:20 봉)이고, 다시 받으면 값이 있다. 다음 쪽이 cts_time 분을 빼고 주는 응답을 흉내 낸다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBrokerTurnoverData } = require('../../broker-turnover-data');
const { timestamp } = require('../../supply-service');

// 11/26 삼성전자처럼 08:01~20:00 LS 시각(봉 끝 시각), 08:50~08:59 · 15:20~15:29 · 15:31~15:40 없음, 15:30 종가 봉.
function lsDay(date) {
    const rows = [];
    for (let m = 8 * 60 + 1; m <= 20 * 60; m++) {
        const clock = `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00`;
        if (clock > '085000' && clock <= '090000') continue;
        if (clock > '152000' && clock < '153000') continue;
        if (clock > '153000' && clock <= '154000') continue;
        rows.push({ date, time: clock, value: '10' });
    }
    return rows;
}
// mode: 'exclusive' = 다음 쪽이 cts_time 분을 빼고 준다, 'inclusive' = 포함한다(2026-11-27 낮 실측).
function fakeLs(date, mode) {
    const all = lsDay(date), requests = [];
    return { requests, http: { post: async (url, body, config) => {
        const p = body.t8452InBlock, cont = config.headers.tr_cont === 'Y';
        requests.push({ cts: p.cts_time, cont });
        const pool = cont ? all.filter(r => mode === 'exclusive' ? r.time < p.cts_time : r.time <= p.cts_time) : all;
        const page = pool.slice(-500), more = pool.length > 500;
        // LS는 다음 기준으로 이번 쪽 가장 이른 분의 한 분 앞을 준다(실측: 112200 쪽 → cts_time 112100).
        const earliest = page[0].time, m = Number(earliest.slice(0, 2)) * 60 + Number(earliest.slice(2, 4)) - 1;
        const next = more ? `${String(Math.floor(m / 60)).padStart(2, '0')}${String(m % 60).padStart(2, '0')}00` : '';
        return { headers: { tr_cont: more ? 'Y' : 'N', tr_cont_key: '0' },
            data: { rsp_cd: '00000', t8452OutBlock: { cts_date: more ? date : '', cts_time: next }, t8452OutBlock1: page } };
    } } };
}

for (const mode of ['exclusive', 'inclusive']) {
    test(`LS t8452 연속조회 경계 분이 빠지지 않는다(다음 쪽이 기준 분을 ${mode === 'exclusive' ? '빼고' : '포함해'} 줄 때)`, async t => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-paging-'));
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const ls = fakeLs('20261126', mode), logs = [];
        // 장 종료 뒤(자정 지나 저장) · 장중(다음 날 10:40) 두 시계
        for (const clock of ['004700', '104000']) {
            const data = createBrokerTurnoverData({ broker: 'ls', directory: fs.mkdtempSync(path.join(directory, clock)), now: () => timestamp('20261127', clock),
                transport: { setStreams() {} }, getToken: async () => 'test', pause: async () => {}, http: ls.http, log: m => logs.push(m) });
            const result = await data.amounts('005930', 'minute', ['20261126']);
            assert.deepEqual(result.warnings, []);
            const at = hm => timestamp('20261126', hm);
            assert.equal(result.values.get(at('112000')), 10000000, '11:20 봉(LS 112100)이 있어야 한다');
            assert.equal(result.values.get(at('112100')), 10000000);
            // 저장분에도 11:20이 앞 분과 다른 누적으로 들어간다
            const points = data.store.points('005930', '2026-11-26');
            const p1119 = points.find(p => p.t === at('111900')), p1120 = points.find(p => p.t === at('112000'));
            assert.equal(p1120.amount - p1119.amount, 10000000, `${clock}: 저장된 11:20 거래대금이 0이면 안 된다`);
            assert.equal(points.length, 700);
        }
        // 두 번째 쪽은 이번 쪽 가장 이른 분(112200)을 기준으로 보낸다
        assert.deepEqual(ls.requests.slice(0, 2), [{ cts: '', cont: false }, { cts: '112200', cont: true }]);
        if (mode === 'exclusive') assert.match(logs[0], /기준 분 112200이 없어 한 분 겹쳐 받았습니다/);
        else assert.deepEqual(logs, []);
    });
}
