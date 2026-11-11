const test = require('node:test'), assert = require('node:assert/strict');
const { fillLendablePrices } = require('../../lendable-prices');
// 2026-11-09: the 대주 table filled prices with one FHKST01010100 call per stock (~270 calls, 2.5 min+ in the shared KIS
// queue). It now asks FHKST11300006 for 30 stocks at a time with UN (KRX+NXT); ETNs and stocks missing from the answer
// keep the single-stock call.
const row = (pdno, extra = {}) => ({ pdno, prdt_name: '종목' + pdno, bfdy_clpr: '1000', ...extra });
const headers = tr => ({ tr_id: tr });

test('prices come 30 stocks per multi call (UN), ETNs and missing stocks use the single call', async () => {
    const calls = [];
    const stocks = [...Array.from({ length: 63 }, (_, i) => row(String(100000 + i))), row('520001'), row('700002')];
    const get = async (url, { headers, params }) => {
        calls.push({ tr: headers.tr_id, params });
        if (headers.tr_id === 'FHKST11300006') {
            const output = [];
            for (let n = 1; params['FID_INPUT_ISCD_' + n]; n++) {
                const code = params['FID_INPUT_ISCD_' + n];
                if (code === '100005') continue; // not in the answer
                output.push({ inter_shrn_iscd: code, inter2_prpr: String(2000 + n), prdy_ctrt: '1.5' + n, inter2_prdy_clpr: '1900' });
            }
            return { data: { rt_cd: '0', msg_cd: 'MCA00000', output } };
        }
        return { data: { output: { stck_prpr: '777', prdy_ctrt: '-0.10', rprs_mrkt_kor_name: 'KOSPI' } } };
    };
    const result = await fillLendablePrices({ stocks, get, domain: 'https://kis.test', headers });
    const multi = calls.filter(c => c.tr === 'FHKST11300006'), single = calls.filter(c => c.tr === 'FHKST01010100');
    assert.equal(multi.length, 3, '63 stocks → 30 + 30 + 3');
    assert.deepEqual(Object.keys(multi[0].params).length, 60);
    assert.ok(multi.every(c => Object.entries(c.params).filter(([k]) => k.startsWith('FID_COND_MRKT_DIV_CODE_')).every(([, v]) => v === 'UN')), 'UN (KRX+NXT) like the single call');
    assert.deepEqual(single.map(c => c.params.FID_INPUT_ISCD).sort(), ['100005', 'Q520001', 'Q700002'], 'ETNs (Q, J) and the missing stock');
    assert.deepEqual(single.map(c => c.params.FID_COND_MRKT_DIV_CODE).sort(), ['J', 'J', 'UN']);
    assert.deepEqual([stocks[0].stck_prpr, stocks[0].prdy_ctrt], ['2001', '1.51']);
    assert.deepEqual([stocks[5].stck_prpr, stocks[5].prdy_ctrt], ['777', '-0.10']);
    assert.deepEqual(result, { multiCalls: 3, multiFailures: 0, singleCalls: 3 });
});

test('a failed multi call falls back to single calls for its 30 stocks and is logged once', async () => {
    const logs = [], stocks = Array.from({ length: 31 }, (_, i) => row(String(200000 + i)));
    let singles = 0;
    const get = async (url, { headers }) => {
        if (headers.tr_id === 'FHKST11300006') return { data: { rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' } };
        singles++; if (singles === 2) throw new Error('timeout');
        return { data: { output: { stck_prpr: '500', prdy_ctrt: '0.20' } } };
    };
    const result = await fillLendablePrices({ stocks, get, domain: 'https://kis.test', headers, log: m => logs.push(m) });
    assert.deepEqual(result, { multiCalls: 2, multiFailures: 2, singleCalls: 31 });
    assert.equal(logs.length, 1);assert.match(logs[0], /FHKST11300006\) 실패.*EGW00201/);
    assert.deepEqual([stocks[1].stck_prpr, stocks[1].prdy_ctrt], ['1000', '0.00'], 'a failed single call keeps the previous close');
    assert.equal(stocks[0].stck_prpr, '500');
});
