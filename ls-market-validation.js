// Public unit/market checks confirmed on 2026-10-26; contains no credentials or observations.
// Runtime validation.json may override individual entries, including disabling them.
const entries = [
 ['UPM:U0','kospi','HHmmss',1],['UPM:U1','kosdaq','HHmmss',1],
 ['UBT:U001','kospi','HHmmsscc',100],['UBT:U301','kosdaq','HHmmsscc',100]
];
module.exports=Object.fromEntries(entries.map(([key,market,timeFormat,toMillionWon])=>[key,{
 market,cumulative:true,timeFormat,toMillionWon,provisional:false,
 evidence:'2026-10-26 confirmed cash-market checks; see docs/LS_MARKET_SUPPLY.md'
}]));
