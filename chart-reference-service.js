// Reference candle pages for chart axes. Pages come from the shared index candle store with the
// same size and cursor format as Kiwoom, so ADR and breadth viewports behave as before.
function createChartReferenceService({ store }) {
 async function query({ mode = 'day', market = 'kospi', cursor = '' } = {}) {
  if (!['day', 'minute'].includes(mode) || !['kospi', 'kosdaq'].includes(market) || typeof cursor !== 'string' || cursor.length > 2048) throw Object.assign(new Error('잘못된 기준 캔들 조건'), { status: 400 });
  const { points, count, cursor: next, has_more } = await store.referencePage({ market, mode, cursor });
  return { points, count, cursor: next, has_more };
 }
 // 지난 구간 1분봉(날짜 범위). 지수 캔들 저장소의 range를 그대로 쓴다(2026-11-22).
 const range = options => store.range(options);
 return { query, range };
}
module.exports = { createChartReferenceService };
