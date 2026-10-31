const { dayKey } = require('./supply-store');
const { timestamp } = require('./supply-service');
const compact = t => dayKey(t).replaceAll('-', '');
function createBrokerComparisonService({ broker, data, turnoverReference, concentrationReference }) {
    const scope = broker === 'ls' ? 'LS 종목은 통합, 시장은 업종지수 기준 · 통합 집계 범위 미확인' : '한투 업종지수 거래대금 · 통합 집계 범위 미확인';
    async function turnover(input = {}) {
        const base = await turnoverReference.query(input), mode = input.mode || 'day', warnings = [], markets = {};
        await Promise.all(['kospi','kosdaq'].map(async market => {
            const prices = base.markets[market] || [], dates = [...new Set(prices.map(p=>compact(p.t)))].sort();
            const result = await data.amounts(market, mode, dates, true);
            warnings.push(...result.warnings);
            markets[market] = prices.map(p => ({ ...p, market_turnover: result.values.get(mode==='day'?timestamp(compact(p.t)):p.t) ?? null }));
        }));
        return { ...base, markets, source:broker, warnings:[...warnings,scope],
            description:mode==='minute'?'1분별 당일 누적 거래대금 · 웹소켓 우선, REST 보완':'증권사 REST 일별 거래대금' };
    }
    async function concentration(input, owner) {
        // LS supplies the ratio denominator below. Kiwoom is needed only for
        // stock candles/timestamps, not its separately paginated index history.
        const base = await concentrationReference.query(input.mode==='minute'?{...input,prices_only:true}:input, owner);
        if (!base.success || !base.points?.length) return base;
        const code=String(input.code).replace(/_(AL|NX)$/i,''),market=base.market==='K'?'kospi':'kosdaq';
        const dates=[...new Set(base.points.map(p=>p.time.slice(0,8)))].sort(),mode=base.mode;
        data.watchStock(code,owner);
        const [stock,index,stockCumulative,indexCumulative]=await Promise.all([data.amounts(code,mode,dates),data.amounts(market,mode,dates),...(mode==='minute'?[data.amounts(code,mode,dates,true),data.amounts(market,mode,dates,true)]:[null,null])]);
        const points=base.points.map(p=>{
            const t=timestamp(p.time.slice(0,8),mode==='day'?'000000':p.time.slice(8));
            const numerator=stock.values.get(t) ?? null,denominator=index.values.get(t) ?? null;
            const cumulativeStock=stockCumulative?.values.get(t)??null,cumulativeMarket=indexCumulative?.values.get(t)??null;
            return {...p,cumulative_value:cumulativeStock!==null&&cumulativeMarket>0?cumulativeStock/cumulativeMarket*100:null,stock_turnover_cumulative:cumulativeStock,market_turnover_cumulative:cumulativeMarket,stock_turnover:numerator,market_turnover:denominator,
                stock_turnover_million:numerator===null?null:numerator/1000000,market_turnover_million:denominator===null?null:denominator/1000000,
                value:numerator!==null&&denominator>0?numerator/denominator*100:null};
        });
        const warnings=[...stock.warnings,...index.warnings,scope];
        return {...base,points,source:'LS',warnings,partial:warnings.some(w=>/실패|오류/.test(w)),
            notice:points.some(p=>p.value===null)?'LS 거래대금 미제공 구간은 결측 · 가격 캔들은 키움 자료':''};
    }
    return {turnover,concentration};
}
module.exports={createBrokerComparisonService};
