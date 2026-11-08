// 52주 신고/신저 counts only common stocks (decided 2026-11-08).
// Kiwoom ka10099 lists every product of a market: KOSPI (mrkt_tp 0) mixes stocks (marketCode 0) with
// ETF (8), ETN (60/70/90) and REIT/infra/fund (6/2/4); KOSDAQ (mrkt_tp 10) is marketCode 10.
// Excluded: ETF·ETN (money-market and bond ETFs make new highs almost every day), REIT·infra·fund,
// preferred shares (code not ending in 0: same company counted twice) and SPACs (price nearly fixed).
const marketCodes = { kospi: '0', kosdaq: '10' };
function isCommonStock(item, market) {
    const code = String(item?.code || '').trim(), name = String(item?.name || '');
    return String(item?.marketCode) === marketCodes[market] && /^[0-9A-Z]{5}0$/.test(code) && !/스팩/.test(name);
}
module.exports = { isCommonStock, marketCodes };
