// Reference candle pages for chart axes. Pages come from the shared index candle store with the
// same size and cursor format as Kiwoom, so ADR and breadth viewports behave as before.
function createChartReferenceService({ store }) {
 async function query({ mode = 'day', market = 'kospi', cursor = '' } = {}) {
  if (!['day', 'minute'].includes(mode) || !['kospi', 'kosdaq'].includes(market) || typeof cursor !== 'string' || cursor.length > 2048) throw Object.assign(new Error('잘못된 기준 캔들 조건'), { status: 400 });
  const { points, count, cursor: next, has_more } = await store.referencePage({ market, mode, cursor });
  return { points, count, cursor: next, has_more };
 }
 return { query };
}
module.exports = { createChartReferenceService };
