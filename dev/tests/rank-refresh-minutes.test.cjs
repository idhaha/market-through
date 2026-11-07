// Trading tab auto refresh (30초~1시간, 2~5분 included, no 당일누적) is separate from the 실시간 조회 순위 table,
// which has its own ka00198 choice (당일누적·30초·1분·10분·1시간) and refresh period.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { buildJobs } = require('../../background-refresh.js');
const select = (html, id) => [...html.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0].matchAll(/<option value="([^"]+)"(?: data-interval="(\d+)")?[^>]*>([^<]+)</g)]
    .map(([, value, interval, label]) => ({ value, interval: Number(interval), label }));
for (const file of ['public/index.html', 'public/rank-independent.html']) {
    const list = select(fs.readFileSync(file, 'utf8'), 'refreshInterval');
    assert.deepEqual(list.map(o => o.label), ['30초 간격', '1분 간격', '2분 간격', '3분 간격', '4분 간격', '5분 간격', '10분 간격', '1시간 간격'], file);
    for (const [minutes, value] of [[2, '2m'], [3, '3m'], [4, '4m'], [5, '5m']]) assert.equal(list.find(o => o.value === value).interval, minutes * 60000);
}
const html = fs.readFileSync('public/index.html', 'utf8'), app = fs.readFileSync('public/app.js', 'utf8');
assert.deepEqual(select(html, 'rankQueryTp').map(o => [o.value, o.label]), [['4', '당일누적'], ['5', '30초'], ['1', '1분'], ['2', '10분'], ['3', '1시간']]);
assert.match(html, /<option value="4" selected>당일누적<\/option>/, '당일누적 is the default');
assert.match(app, /: '4';\n\s*if \(rankQuerySelect\) rankQuerySelect\.value = query;/, 'no saved choice → 당일누적');
assert.ok(html.indexOf('id="rankQueryTp"') > html.indexOf('실시간 조회 순위 [키움]') && html.indexOf('id="rankQueryTp"') < html.indexOf('id="dataContainer"'), 'selector sits in the ranking table header');
// The page asks the ranking with its own choice; the tab refresh asks only the 대주가능 종목 [한투] table (kiwoom=0).
assert.match(app, /const rankingQuery = ranking \? `qry_tp=\$\{rankQueryValue\(\)\}` : 'kiwoom=0';/);
assert.match(app, /if\(session\.spot\)\{\n\s*loadData\(\{ ranking: false \}\);/);
// Saved settings: old '4' (당일누적 at 30 s) → tab 30초; the table uses its saved choice, else 당일누적.
const start = app.indexOf('const RANK_QUERY_PERIODS'), end = app.indexOf('\n}\n', app.indexOf('function applyRankRefreshSettings')) + 3;
const makeSelect = values => ({ value: values[0], options: values.map(value => ({ value })) });
for (const [saved, tab, query] of [[{ rankInterval: '4' }, '5', '4'], [{ rankInterval: '3' }, '3', '4'], [{ rankInterval: '3m' }, '3m', '4'], [{ rankInterval: '1', rankQueryTp: '1' }, '1', '1'], [{}, '2', '4']]) {
    const context = vm.createContext({ document: { getElementById: id => id === 'rankQueryTp' ? context.rq : null }, refreshIntervalSelect: makeSelect(['5', '1', '2m', '3m', '4m', '5m', '2', '3']),
        rq: makeSelect(['4', '5', '1', '2', '3']), lastSavedSettings: {} });
    vm.runInContext('const rankQuerySelect = rq;\n' + app.slice(start, end).replace(/^const rankQuerySelect.*$/m, ''), context);
    context.applyRankRefreshSettings(saved);
    assert.deepEqual([context.refreshIntervalSelect.value, context.rq.value], [tab, query], JSON.stringify(saved));
}
// Server: ranking qry_tp from the table, kiwoom=0 skips ka00198.
const server = fs.readFileSync('server.js', 'utf8');
assert.match(server, /const includeRanking = req\.query\.kiwoom !== '0';/);
assert.match(server, /if \(includeRanking\) dataPromises\.push\(/);
// Background refresh: the 실시간 조회 순위 job uses the table choice and its period; 대주가능 종목 follows the tab interval.
for (const [settings, qry, period] of [[{ rankInterval: '3m', rankQueryTp: '4' }, '4', 30000], [{ rankInterval: '5', rankQueryTp: '3' }, '3', 3600000], [{ rankInterval: '4' }, '4', 30000], [{ rankInterval: '2' }, '4', 30000], [{ rankInterval: '2m', rankQueryTp: '2' }, '2', 600000]]) {
    const jobs = [...buildJobs(settings).values()].filter(j => j.url === '/api/stock');
    const ranking = jobs.find(j => j.params.qry_tp), lendable = jobs.find(j => j.params.kiwoom === '0');
    assert.equal(ranking.params.qry_tp, qry, JSON.stringify(settings)); assert.equal(ranking.period, period); assert.equal(ranking.params.efriend_refresh, '0');
    assert.ok(lendable && !lendable.period, '대주가능 종목 job on the tab interval');
}
console.log('PASS refresh menu without 당일누적, ranking table selector with its own cycle, saved-setting migration, server and background split');
