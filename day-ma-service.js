'use strict';
// 분봉 캔들의 일봉 기준 이동평균선 재료(2026-11-24, docs/MINUTE_DAILY_MA.md).
// 캔들 대상의 일봉 [날짜, 시가, 종가]를 돌려준다. 이평 계산은 화면(public/day-ma.js)이 그때그때 한다(계산값은 저장하지 않는다).
// 끝난 날(어제까지)만 준다. 오늘 봉을 빼서 장중에 키움 · LS를 다시 부르지 않고, 오늘 시가는 화면이 오늘 첫 분봉에서 잡는다.
// 일봉은 이미 저장 중인 곳에서 읽는다(키움 일봉 저장 kiwoom-daily-store · 종목 선물 일봉 · 지수 선물 연결 일봉). 새 파일을 만들지 않는다.
//   대상(target): stock:<종목코드>       키움 ka10081 통합(_AL) 수정주가 일봉
//                 index:kospi|kosdaq     키움 ka20006 업종 일봉(001 · 101)
//                 stockFutures:<종목코드> LS t8405 연결선물 일봉(종목 선물 수급 카드)
//                 indexFutures:futures|futuresKosdaq  LS t2214 주간 연결선물 일봉(야간은 빼고 주간 시가 · 종가)
const URL = 'https://api.kiwoom.com/api/dostk/chart';
const MARGIN_DAYS = 140; // 60일선에 필요한 앞선 59거래일 + 긴 연휴 여유(달력 일수)
const PAGE_LIMIT = 20;
const INDEX = { kospi: '001', kosdaq: '101' };
const INDEX_FUTURES = ['futures', 'futuresKosdaq'];
const CACHE_MS = 10 * 60000;

const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const kstDay = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
const shiftDay = (ymd, days) => kstDay(Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00+09:00`) + days * 86400000);
const validDay = value => /^\d{8}$/.test(value) && shiftDay(value, 0) === value;
const price = value => Math.abs(Number(String(value ?? '').replace(/[,+]/g, '')));
const header = (headers, name) => {
    if (!headers) return '';
    if (typeof headers.get === 'function') return String(headers.get(name) ?? '');
    const key = Object.keys(headers).find(k => k.toLowerCase() === name);
    return key ? String(headers[key] ?? '') : '';
};

function parseTarget(value) {
    const [kind, id = ''] = String(value || '').split(':');
    if (kind === 'stock' && /^[0-9A-Z]{6}$/.test(id)) return { kind, id };
    if (kind === 'index' && Object.hasOwn(INDEX, id)) return { kind, id };
    if (kind === 'stockFutures' && /^[0-9A-Z]{6}$/.test(id)) return { kind, id };
    if (kind === 'indexFutures' && INDEX_FUTURES.includes(id)) return { kind, id };
    return null;
}

function createDayMaService({ kiwoomHttp, getKiwoomToken, stockFutures, indexFutures, now = Date.now }) {
    const cache = new Map();

    // 키움 일봉: base_dt를 through로 주면 kiwoom-daily-store가 다 받은 구간은 파일에서 답한다(연속조회도 "store:" 키로 날짜 기준).
    async function kiwoomDaily(api, body, field, from, through, scale) {
        const rows = new Map();
        let next = '';
        for (let page = 0; page < PAGE_LIMIT; page++) {
            const response = await kiwoomHttp.post(URL, { ...body, base_dt: through }, {
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getKiwoomToken()}`, 'api-id': api, 'cont-yn': next ? 'Y' : 'N', 'next-key': next },
                timeout: 10000
            });
            if (Number(response?.data?.return_code ?? 0) !== 0) throw failure(response?.data?.return_msg || '일봉 조회 실패', 502);
            const list = response?.data?.[field];
            if (!Array.isArray(list)) throw failure('일봉 응답 형식 오류', 502);
            let oldest = null;
            for (const row of list) {
                const day = String(row.dt || '');
                if (!/^\d{8}$/.test(day)) continue;
                if (!oldest || day < oldest) oldest = day;
                const open = price(row.open_pric) / scale, close = price(row.cur_prc) / scale;
                if (day <= through && open > 0 && close > 0) rows.set(day, [day, open, close]);
            }
            const key = header(response.headers, 'next-key');
            if (header(response.headers, 'cont-yn').toUpperCase() !== 'Y' || !oldest || oldest < from || !key || key === next) break;
            next = key;
        }
        return rows;
    }
    const fromCandles = (candles, through) => new Map((candles || [])
        .map(c => [kstDay(c.t), Number(c.open), Number(c.close)])
        .filter(([day, open, close]) => day <= through && open > 0 && close > 0)
        .map(row => [row[0], row]));

    async function load(target, from, through) {
        if (target.kind === 'stock') return kiwoomDaily('ka10081', { stk_cd: `${target.id}_AL`, upd_stkpc_tp: '1' }, 'stk_dt_pole_chart_qry', from, through, 1);
        if (target.kind === 'index') return kiwoomDaily('ka20006', { inds_cd: INDEX[target.id] }, 'inds_dt_pole_qry', from, through, 100);
        if (target.kind === 'stockFutures') {
            if (!stockFutures) throw failure('종목 선물 일봉을 쓸 수 없습니다.', 503);
            const result = await stockFutures.candles({ code: target.id, mode: 'day', from, to: through });
            return fromCandles(result.points, through);
        }
        if (!indexFutures) throw failure('지수 선물 일봉을 쓸 수 없습니다.', 503);
        const result = await indexFutures.sessionDaily(target.id, from, through);
        return fromCandles(result.candles, through);
    }

    // input: { target, from, to } (from · to: 화면에 보이는 분봉의 첫 · 끝 거래일 YYYYMMDD)
    async function query(input = {}) {
        const target = parseTarget(input.target), from = String(input.from || ''), to = String(input.to || '');
        if (!target || !validDay(from) || !validDay(to) || from > to) throw failure('잘못된 이평 조회 조건입니다.');
        const yesterday = shiftDay(kstDay(now()), -1), through = to < yesterday ? to : yesterday, start = shiftDay(from, -MARGIN_DAYS);
        const key = `${target.kind}:${target.id}:${start}:${through}`, cached = cache.get(key);
        if (cached && now() - cached.at < CACHE_MS) return cached.promise;
        const promise = load(target, start, through).then(rows => ({
            success: true, target: `${target.kind}:${target.id}`, from: start, through,
            rows: [...rows.values()].sort((a, b) => a[0].localeCompare(b[0]))
        }));
        cache.set(key, { at: now(), promise });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
        promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key); });
        return promise;
    }
    return { query };
}

module.exports = { createDayMaService, parseTarget };
