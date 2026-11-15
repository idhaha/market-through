'use strict';
// 날짜별 VI 창 기록(data/vi-monitor/days)이 생기기 전 날짜를 괴리율 1% 이상 기록(gap-records)으로 복원한다(2026-11-14).
// - 복원되는 행은 괴리율이 1% 이상이었던 VI · 선물 행뿐이다(VI 창의 기본 보기 '괴리율 1% 이상 보기'와 같은 범위).
// - 값은 기록에 남은 해제 때 값(atRelease)을 쓰고, 없으면(선물 행은 5분 해제 전에 4분 기록이 끝남) '4분 끝' 표 값을 쓴다.
// - 2026-11-12 선물 행 중 JD0(실시간 상·하한가)으로 만든 행은 뺀다: 첫 메시지를 평상시로 본 이전 규칙이 만든 가짜 행이다
//   (docs/VI_MONITOR.md, 같은 날 JD0을 뺐다).
// - 이미 그 날짜 기록이 있으면 건너뛴다(--force면 덮어씀).
// 사용: node dev/restore-vi-days-from-gap-records.cjs 2026-11-12 2026-11-13 [--force]
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'data', 'vi-monitor', 'gap-records'), target = path.join(root, 'data', 'vi-monitor', 'days');
const FUTURES_MS = 300000, VI_MS = 120000;
const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const gapValue = v => typeof v === 'string' ? v : num(v);
// '4분 끝' / '1% 도달 때' table values → the row's release values.
function fromColumns(c, basis, exchange) {
    if (!c) return null;
    const fut = c['선물 괴리율(최근월)'], futNext = c['선물 괴리율(차기월)'];
    return { at: null, basis, rate: num(c['등락률']), amount: num(c['거래대금(백만)']), marketCap: num(c['시가총액(원)']),
        bidAverage: num(exchange === 'FUT' ? c['선물 매수10호가평균(원)'] : exchange === 'NXT' ? c['NXT 매수10호가평균(원)'] : c['KRX 매수10호가평균(원)']),
        gap: { KRX: gapValue(c['KRX 괴리율']), NXT: gapValue(c['NXT 괴리율']),
            FUT: exchange === 'FUT' ? 'Base' : typeof fut === 'string' && fut === futNext ? fut : { recent: gapValue(fut), next: gapValue(futNext) } } };
}
function restoreRecord(l) {
    const columns = l.columns || {}, any = columns['해제 때'] || columns['4분 끝'] || columns['1% 도달 때'] || {};
    const fut = l.exchange === 'FUT', releasedAt = num(l.releasedAt) ?? (fut && num(l.startedAt) != null ? l.startedAt + FUTURES_MS : null);
    let atRelease = l.atRelease && typeof l.atRelease === 'object' ? { ...l.atRelease } : null;
    if (!atRelease) atRelease = columns['해제 때'] ? fromColumns(columns['해제 때'], '해제 때 값(기록 표)', l.exchange)
        : fromColumns(columns['4분 끝'], '발동 4분 뒤 값 (해제 때 값 없음 · 괴리율 기록으로 복원)', l.exchange);
    const contracts = Array.isArray(l.contracts) ? l.contracts : [];
    const gap = atRelease?.gap || {};
    const prev = num(any['전일 거래대금(원)']);
    return {
        code: l.code, exchange: l.exchange, ...(fut ? { contract: l.contract } : {}), name: l.name || l.code, market: l.market || '-',
        kind: l.kind ?? null, ...(l.kindText ? { kindText: l.kindText } : {}), direction: l.direction ?? null,
        startedAt: num(l.startedAt), lastEventAt: releasedAt ?? num(l.startedAt), releasedAt, active: false,
        contracts, futuresChecked: true, count: 1, atStart: l.atStart || null, atRelease, gapHit: l.gapHit || null, gapMax: l.gapMax || null,
        futures: { recent: contracts[0] ? { ...contracts[0] } : null, next: contracts[1] ? { ...contracts[1] } : null },
        nxtSupported: gap.NXT === '미지원' ? false : true, futuresSupported: fut ? true : contracts.length > 0,
        prevAmount: prev, prevAmountState: prev != null ? 'ok' : 'none',
        marketCap: atRelease?.marketCap ?? null, marketCapBasis: '해제 때', durationMs: fut ? FUTURES_MS : VI_MS,
        restored: '괴리율 1% 이상 기록(gap-records)으로 복원'
    };
}
function restoreDay(day, { force = false, from = source, to = target, now = Date.now() } = {}) {
    const file = path.join(from, day + '.jsonl'), out = path.join(to, day + '.json');
    if (!fs.existsSync(file)) return { day, skipped: '괴리율 기록 없음' };
    if (fs.existsSync(out) && !force) return { day, skipped: '이미 기록 있음' };
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const fake = lines.filter(l => l.exchange === 'FUT' && l.kind === 'JD0');
    const rows = lines.filter(l => !fake.includes(l) && /^[0-9A-Z]{6}$/.test(l.code || '') && ['KRX', 'NXT', 'FUT'].includes(l.exchange)).map(restoreRecord);
    const saved = { day, savedAt: now, rows, restored: { from: 'gap-records', note: '괴리율 1% 이상이었던 행만 복원', excludedJd0: fake.length } };
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(out + '.tmp', JSON.stringify(saved)); fs.renameSync(out + '.tmp', out);
    return { day, rows: rows.length, excludedJd0: fake.length };
}
module.exports = { restoreDay, restoreRecord };
if (require.main === module) {
    const days = process.argv.slice(2).filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
    for (const day of days) console.log(JSON.stringify(restoreDay(day, { force: process.argv.includes('--force') })));
}
