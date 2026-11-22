'use strict';
// 키움 일봉 저장(2026-11-22, docs/CHART_DATA_STORAGE.md "지난날 일봉 저장"). 종목 일봉 ka10081 · 업종 지수 일봉 ka20006의
// 끝난 날 행을 종목(지수)마다 파일 하나에 두고, 다 받은 구간 안의 요청은 키움을 부르지 않고 파일에서 같은 모양으로 답한다.
//   data/kiwoom-daily/<api>/<종목>_<수정주가 여부>.json.gz = { v, rows: [원본 행], ranges: [[처음, 끝]], exhausted: 상장 첫날 }
// 쓰는 곳: 종목수급 일봉 · 캔들(supply-service), 쏠림율 일봉(concentration-chart), 지수 일봉 캔들(index-candle-store).
// 동작: 호출하는 쪽은 예전처럼 base_dt(그날 포함 600봉)와 연속조회(cont-yn · next-key)를 쓴다. 이 저장소는 next-key를
// "store:<다음 base_dt>"로 바꿔 주어 연속조회도 날짜 기준으로 받게 하고, 그 날짜 구간이 파일에 다 있으면 파일에서 답한다.
// 오늘 봉은 저장하지 않고 늘 키움에서 받는다. 수정주가: 새로 받은 쪽의 겹치는 날 종가가 저장본과 다르면 그 종목의 저장본을 버린다.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');

const APIS = { ka10081: { field: 'stk_dt_pole_chart_qry', symbol: body => body.stk_cd }, ka20006: { field: 'inds_dt_pole_qry', symbol: body => body.inds_cd } };
const PAGE = 600, URL = 'https://api.kiwoom.com/api/dostk/chart';
const shift = (ymd, days) => new Date(Date.parse(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10).replaceAll('-', '');

function createKiwoomDailyStore({ directory, now = Date.now, log = console.warn }) {
    const memo = new Map();
    const today = () => new Date(now() + 9 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
    const header = (headers, name) => { if (!headers) return ''; if (typeof headers.get === 'function') return String(headers.get(name) ?? ''); const k = Object.keys(headers).find(x => x.toLowerCase() === name); return k ? String(headers[k] ?? '') : ''; };
    const fileOf = (api, symbol, adjusted) => path.join(directory, api, `${String(symbol).replace(/[^0-9A-Za-z_]/g, '')}_${adjusted}.json.gz`);
    function load(api, symbol, adjusted) {
        const key = `${api}:${symbol}:${adjusted}`;
        if (memo.has(key)) return memo.get(key);
        let value = { rows: new Map(), ranges: [], exhausted: null };
        try {
            const saved = JSON.parse(zlib.gunzipSync(fs.readFileSync(fileOf(api, symbol, adjusted))));
            if (saved?.v === 1) value = { rows: new Map(saved.rows.map(row => [String(row.dt), row])), ranges: saved.ranges || [], exhausted: saved.exhausted || null };
        } catch (error) { if (error.code !== 'ENOENT') log(`[키움 일봉 저장] ${key} 읽기 실패: ${error.message}`); }
        memo.set(key, value); if (memo.size > 200) memo.delete(memo.keys().next().value);
        return value;
    }
    function save(api, symbol, adjusted, value) {
        const file = fileOf(api, symbol, adjusted);
        const json = JSON.stringify({ v: 1, rows: [...value.rows.values()].sort((a, b) => String(a.dt).localeCompare(String(b.dt))), ranges: value.ranges, exhausted: value.exhausted });
        const packed = zlib.gzipSync(json);
        if (zlib.gunzipSync(packed).toString() !== json) return;
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, packed); fs.renameSync(temp, file); }
        catch (error) { log(`[키움 일봉 저장] ${api} ${symbol} 저장 실패: ${error.message}`); }
    }
    // 저장본을 버린 기록: <directory>/resets.json. chart-revisions가 이 파일이 생기거나 바뀌면 이 일봉을 쓰는 경로의
    // 브라우저 저장분을 한 번 버리게 한다(수정주가로 지난 가격이 바뀐 경우). 평소 지난날 추가는 이 파일을 건드리지 않는다.
    function markReset(api, symbol) {
        const file = path.join(directory, 'resets.json');
        let value = { count: 0, recent: [] };
        try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (Number.isFinite(saved?.count)) value = { count: saved.count, recent: Array.isArray(saved.recent) ? saved.recent : [] }; } catch {}
        value.count++; value.recent = [...value.recent, { at: new Date(now()).toISOString(), api, symbol }].slice(-50);
        try { fs.mkdirSync(directory, { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, file); }
        catch (error) { log(`[키움 일봉 저장] 초기화 기록 실패: ${error.message}`); }
    }
    // 구간 합치기: 겹치거나 맞닿은(끝 다음 날이 시작) 구간을 하나로.
    function addRange(ranges, from, to) {
        const list = [...ranges, [from, to]].sort((a, b) => a[0].localeCompare(b[0])), merged = [];
        for (const [a, b] of list) { const last = merged.at(-1); if (last && a <= shift(last[1], 1)) { if (b > last[1]) last[1] = b; } else merged.push([a, b]); }
        return merged;
    }
    // base까지(그날 포함) 600봉을 파일에서 답할 수 있으면 { rows(최신순), more, next }.
    function fromStore(value, base) {
        const range = value.ranges.find(([a, b]) => a <= base && base <= b);
        if (!range) return null;
        const rows = [...value.rows.values()].filter(row => row.dt >= range[0] && row.dt <= base).sort((a, b) => String(b.dt).localeCompare(String(a.dt)));
        if (rows.length >= PAGE) { const page = rows.slice(0, PAGE); return { rows: page, more: true, next: shift(page.at(-1).dt, -1) }; }
        if (value.exhausted && value.exhausted === range[0]) return { rows, more: false, next: '' };
        return null;
    }
    function accept(api, symbol, adjusted, base, rows, more) {
        const day = today(), value = load(api, symbol, adjusted);
        const past = rows.filter(row => /^\d{8}$/.test(String(row.dt)) && row.dt < day);
        if (!past.length) return;
        // 수정주가가 바뀌었으면(겹치는 날 종가가 다름) 저장본을 버리고 새로 쌓는다.
        const changed = past.some(row => { const old = value.rows.get(String(row.dt)); return old && String(old.cur_prc) !== String(row.cur_prc); });
        if (changed) { value.rows.clear(); value.ranges = []; value.exhausted = null; markReset(api, symbol); log(`[키움 일봉 저장] ${api} ${symbol} 가격이 바뀌어(수정주가) 저장본을 새로 받습니다.`); }
        for (const row of past) value.rows.set(String(row.dt), row);
        const oldest = past.map(row => String(row.dt)).sort()[0];
        value.ranges = addRange(value.ranges, oldest, base < day ? base : shift(day, -1));
        if (!more && rows.length < PAGE) value.exhausted = oldest;
        save(api, symbol, adjusted, value);
    }
    function wrap(http) {
        return {
            ...http,
            async post(url, body, options = {}) {
                const headers = options.headers || {}, api = header(headers, 'api-id'), spec = APIS[api];
                if (url !== URL || !spec || !body) return http.post(url, body, options);
                const symbol = spec.symbol(body), adjusted = api === 'ka10081' ? String(body.upd_stkpc_tp ?? '0') : '-';
                const nextKey = header(headers, 'next-key'), continued = header(headers, 'cont-yn').toUpperCase() === 'Y' && nextKey;
                if (continued && !nextKey.startsWith('store:')) return http.post(url, body, options); // 예전 키움 키(다른 경로)는 그대로
                const day = today(), base = continued ? nextKey.slice(6) : String(body.base_dt || day);
                if (base < day) {
                    const stored = fromStore(load(api, symbol, adjusted), base);
                    if (stored) return { data: { return_code: 0, return_msg: '저장본', [spec.field]: stored.rows }, headers: { 'cont-yn': stored.more ? 'Y' : 'N', 'next-key': stored.more ? 'store:' + stored.next : '' }, stored: true };
                }
                const response = await http.post(url, { ...body, base_dt: base }, { ...options, headers: { ...headers, 'cont-yn': 'N', 'next-key': '' } });
                const rows = response?.data?.[spec.field];
                if (Number(response?.data?.return_code ?? 0) !== 0 || !Array.isArray(rows)) return response;
                const more = header(response.headers, 'cont-yn').toUpperCase() === 'Y';
                try { accept(api, symbol, adjusted, base, rows, more); } catch (error) { log(`[키움 일봉 저장] ${api} ${symbol} 처리 실패: ${error.message}`); }
                const oldest = rows.map(row => String(row.dt)).filter(dt => /^\d{8}$/.test(dt)).sort()[0];
                return { ...response, headers: { ...(response.headers || {}), 'cont-yn': more && oldest ? 'Y' : 'N', 'next-key': more && oldest ? 'store:' + shift(oldest, -1) : '' } };
            }
        };
    }
    return { wrap, fileOf };
}
module.exports = { createKiwoomDailyStore };
