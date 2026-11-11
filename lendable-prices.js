'use strict';
// 대주 표 현재가 · 등락률 채우기 (2026-11-09).
// 한투 관심종목(멀티종목) 시세 FHKST11300006으로 30종목씩 받는다. 예전에는 종목마다 FHKST01010100을 불러 한투 조회 줄
// (kis-http.js, 0.55초에 1건)을 2.5분 넘게 차지했다. 공식 가이드는 시장 코드로 J(KRX) · NX(NXT)만 적지만 UN(통합)도
// 받으며, 같은 시각 단건 UN과 현재가 · 등락률 · 거래대금이 같았다(005930 · 000660 · 265520 · 035760 대조).
// ETN(Q 접두어, 단건에서 J로 조회)과 멀티 응답에 없는 종목만 예전 단건 조회로 받는다.
const MULTI_SIZE = 30;
const etnCode = code => code.length === 6 && (code.startsWith('5') || code.startsWith('7'));

async function fillLendablePrices({ stocks, get, domain, headers, log = () => {} }) {
    const noPrice = stock => { stock.prdy_ctrt = '0.00'; stock.stck_prpr = stock.bfdy_clpr; };
    async function singlePrice(stock) {
        let iscd = stock.pdno.trim();
        if (etnCode(iscd)) iscd = 'Q' + iscd; // ETN 예외처리 (CSV 명세서 권장사항)
        try {
            const response = await get(`${domain}/uapi/domestic-stock/v1/quotations/inquire-price`, {
                headers: headers('FHKST01010100'),
                // UN (KRX+NXT 통합): before the KRX open (NXT 08:00~08:50) J has no trade yet and returns no change rate.
                // ETNs (Q prefix) stay on J, as UN support for them is not confirmed.
                params: { FID_COND_MRKT_DIV_CODE: iscd.startsWith('Q') ? 'J' : 'UN', FID_INPUT_ISCD: iscd },
                timeout: 3000
            });
            const output = response.data?.output;
            if (output) { stock.prdy_ctrt = output.prdy_ctrt; stock.stck_prpr = output.stck_prpr; stock.rprs_mrkt_kor_name = output.rprs_mrkt_kor_name; }
            else noPrice(stock);
        } catch { noPrice(stock); }
    }
    const listed = stocks.filter(stock => stock.pdno);
    const single = listed.filter(stock => etnCode(stock.pdno.trim()));
    const multi = listed.filter(stock => !etnCode(stock.pdno.trim()));
    let multiCalls = 0, multiFailures = 0;
    for (let i = 0; i < multi.length; i += MULTI_SIZE) {
        const chunk = multi.slice(i, i + MULTI_SIZE), params = {};
        chunk.forEach((stock, n) => { params['FID_COND_MRKT_DIV_CODE_' + (n + 1)] = 'UN'; params['FID_INPUT_ISCD_' + (n + 1)] = stock.pdno.trim(); });
        try {
            multiCalls++;
            const response = await get(`${domain}/uapi/domestic-stock/v1/quotations/intstock-multprice`, { headers: headers('FHKST11300006'), params, timeout: 5000 });
            if (String(response.data?.rt_cd) !== '0' || !Array.isArray(response.data?.output))
                throw new Error(`${response.data?.msg_cd || ''} ${response.data?.msg1 || '응답 형식 오류'}`.trim());
            const rows = new Map(response.data.output.map(row => [String(row.inter_shrn_iscd || '').trim(), row]));
            for (const stock of chunk) {
                const row = rows.get(stock.pdno.trim());
                if (row && row.inter2_prpr != null && String(row.inter2_prpr).trim() !== '') { stock.prdy_ctrt = row.prdy_ctrt; stock.stck_prpr = row.inter2_prpr; }
                else single.push(stock);
            }
        } catch (error) {
            multiFailures++; single.push(...chunk);
            if (multiFailures === 1) log(`[대주 현재가] 한투 멀티 시세(FHKST11300006) 실패 · 단건 조회로 대신함: ${String(error.message || error).slice(0, 120)}`);
        }
    }
    for (const stock of single) await singlePrice(stock);
    return { multiCalls, multiFailures, singleCalls: single.length };
}

module.exports = { fillLendablePrices, MULTI_SIZE };
