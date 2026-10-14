const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const start = source.indexOf('<h2>거래대금 상위 [키움]</h2>');
const tableStart = source.lastIndexOf('<div class="panel">', start);
const tableEnd = source.indexOf('\n                    <div class="panel">', start);
const chartStart = source.indexOf('<section class="panel concentration-chart-panel');
const chartEnd = source.indexOf('</section>', chartStart) + '</section>'.length;
const refreshStart = source.lastIndexOf('<select', source.indexOf('id="refreshInterval"'));
const refresh = source.slice(refreshStart, source.indexOf('</select>', refreshStart) + 9);
if (start < 0 || chartStart < 0 || tableEnd < 0) throw new Error('Rank template not found');
fs.writeFileSync(path.join(root, 'public/rank-independent.html'), `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>[독립창]</title><link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="style.css?v=20261013_v72">
<link rel="stylesheet" href="rank-independent.css?v=17">
<script src="rank-independent-client.js?v=17" defer></script>
<script src="concentration-chart.js?v=20261013_v47" defer></script></head>
<body class="rank-independent"><div class="independent-toolbar">
<label><input id="rankStockPinned" type="checkbox"> 트레이딩 탭 종목동기화 해제</label>
<span id="rankConnectionStatus" role="status">메인 페이지 연결 중</span>
<span id="rankRefreshStatus" role="status"><span id="independentLastUpdate">-</span> | <span id="independentStatusText">대기 중</span></span>
<div class="independent-refresh-controls">
<label class="independent-topmost"><input id="independentAlwaysOnTop" type="checkbox"> 항상 위</label>
<label>갱신 ${refresh}</label>
<button type="button" id="rankIndependentRefresh" class="btn-primary">조회</button>
</div></div>
<main id="tab_rank">${source.slice(tableStart, tableEnd)}${source.slice(chartStart, chartEnd)}</main></body></html>\n`);

