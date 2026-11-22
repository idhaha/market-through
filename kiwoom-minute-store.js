'use strict';
// 키움 1분봉 원본 저장소(2026-11-21, docs/CHART_DATA_STORAGE.md).
// 끝난 거래일의 1분봉을 종목(<code>_AL, ka10080) · 업종 지수(001/101, ka20005)마다 하루 한 파일로 둔다.
//   data/kiwoom-minute/<symbol>/<YYYY-MM-DD>.json.gz  =  { v, symbol, day, prev, rows }
//   rows: 키움 원본 행에서 차트가 쓰는 칸만 배열로(FIELDS 순서). prev: 키움 응답에서 본 그 종목의 바로 전 거래일(YYYYMMDD) 또는 null.
// 중복 저장을 막는 규칙:
//  - 한 (종목, 날짜)는 파일 하나다. 쏠림율 · 종목수급 캔들 · 한투/LS 비교 카드가 모두 이 파일을 함께 읽는다.
//  - 1분봉만 저장한다. 3 · 5 · 10분 등은 1분봉을 묶어 만들고 따로 저장하지 않는다.
//  - 계산값(쏠림율, 거래대금)은 저장하지 않는다. 원본 칸만 두고 읽을 때 계산한다.
//  - 이미 있는 파일은 다시 쓰지 않는다(키움 분봉은 수정주가를 적용하지 않아 끝난 날 값이 바뀌지 않는다).
//  - 압축본만 쓴다(원본 · 압축본 두 벌을 두지 않는다). 쓰기 전에 압축을 풀어 같은지 확인한다.
// 저장 조건(저장하는 쪽에서 확인): 오늘보다 이전 날, 그날 행이 1개 이상, 응답이 그날을 다 덮음(더 이전 날 행이 함께 왔거나 연속조회 끝).
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');

const STOCK_FIELDS = ['cntr_tm', 'cur_prc', 'trde_qty', 'open_pric', 'high_pric', 'low_pric', 'pred_pre', 'pred_pre_sig'];
const INDEX_FIELDS = ['cntr_tm', 'cur_prc', 'trde_qty', 'open_pric', 'high_pric', 'low_pric'];
const SYMBOL = /^(?:[0-9A-Za-z]{6}_AL|001|101)$/;
const DAY = /^\d{8}$/;
const fieldsOf = symbol => symbol.endsWith('_AL') ? STOCK_FIELDS : INDEX_FIELDS;

function createKiwoomMinuteStore({ directory, log = console.warn }) {
    const memo = new Map(); // 최근 읽은 파일(같은 날을 여러 카드가 연달아 읽음)
    const fileOf = (symbol, day) => path.join(directory, symbol, `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}.json.gz`);
    function valid(symbol, day) { return SYMBOL.test(symbol) && DAY.test(day); }
    function read(symbol, day) {
        if (!valid(symbol, day)) return null;
        const file = fileOf(symbol, day), key = `${symbol}:${day}`;
        if (memo.has(key)) return memo.get(key);
        let value;
        try { value = JSON.parse(zlib.gunzipSync(fs.readFileSync(file))); }
        catch (error) { if (error.code !== 'ENOENT') log(`[KiwoomMinute] ${symbol} ${day} 읽기 실패: ${error.message}`); return null; }
        if (value?.v !== 1 || value.symbol !== symbol || value.day !== day || !Array.isArray(value.rows)) return null;
        const fields = fieldsOf(symbol);
        const result = { day, prev: DAY.test(value.prev || '') ? value.prev : null,
            rows: value.rows.map(row => Object.fromEntries(fields.map((field, i) => [field, row[i]]))) };
        memo.set(key, result);
        if (memo.size > 400) memo.delete(memo.keys().next().value);
        return result;
    }
    const has = (symbol, day) => valid(symbol, day) && fs.existsSync(fileOf(symbol, day));
    // rows: 그날(day) 행만. 이미 있으면 쓰지 않고 false.
    function save(symbol, day, rows, prev) {
        if (!valid(symbol, day) || !Array.isArray(rows) || !rows.length) return false;
        if (rows.some(row => String(row.cntr_tm || '').slice(0, 8) !== day)) throw new Error(`${symbol} ${day}: 다른 날 행이 섞여 저장하지 않습니다.`);
        const file = fileOf(symbol, day);
        if (fs.existsSync(file)) return false;
        const fields = fieldsOf(symbol);
        const ordered = [...rows].sort((a, b) => String(a.cntr_tm).localeCompare(String(b.cntr_tm)));
        if (new Set(ordered.map(row => String(row.cntr_tm))).size !== ordered.length) throw new Error(`${symbol} ${day}: 같은 시각 행이 겹쳐 저장하지 않습니다.`);
        const json = JSON.stringify({ v: 1, symbol, day, prev: DAY.test(prev || '') ? prev : null,
            rows: ordered.map(row => fields.map(field => row[field] ?? null)) });
        const packed = zlib.gzipSync(json);
        if (zlib.gunzipSync(packed).toString() !== json) throw new Error(`${symbol} ${day}: 압축 확인 실패`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(temp, packed);
        // 다른 요청이 그사이 같은 날을 저장했으면 그 파일을 그대로 둔다(한 벌만).
        if (fs.existsSync(file)) { fs.rmSync(temp, { force: true }); return false; }
        fs.renameSync(temp, file);
        return true;
    }
    return { read, has, save, fileOf };
}

// 한 번 받은 응답(행 목록 + 연속조회 여부)에서 day를 저장해도 되는지와 그 종목의 바로 전 거래일을 구한다.
// 행 시각: 분봉 cntr_tm(YYYYMMDDHHMMSS). 오늘(today, YYYYMMDD)과 그 뒤는 저장하지 않는다.
function completeDay(rows, day, today, more) {
    const ofDay = rows.filter(row => String(row.cntr_tm || '').slice(0, 8) === day);
    const earlier = rows.map(row => String(row.cntr_tm || '').slice(0, 8)).filter(d => DAY.test(d) && d < day).sort();
    const prev = earlier.at(-1) || null;
    const covered = Boolean(prev) || !more;
    return { rows: ofDay, prev, storable: day < today && ofDay.length > 0 && covered };
}

module.exports = { createKiwoomMinuteStore, completeDay, STOCK_FIELDS, INDEX_FIELDS };
