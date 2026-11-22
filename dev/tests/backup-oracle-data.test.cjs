const { test } = require('node:test');
const assert = require('node:assert/strict');
const { excluded } = require('../backup-oracle-data.cjs');

test('오라클 백업은 인증 정보 · 토큰 · VI · 대주 30초 기록 · 임시 파일을 받지 않고 차트 자료는 받는다', () => {
    for (const rel of ['auth-private/users.json', 'kiwoom-token/token-28.json', 'kis-token/token.json', 'ls-token/token.json', 'nh-plug/token.json',
        'vi-monitor/charts/2026-11-21/005930.json', 'short-stoploss/realtime-2026-11-21.jsonl', 'short-stoploss-28/realtime-2026-11-21.jsonl',
        'supply/a.json.tmp', 'background-refresh/token-cache.json', '../etc/passwd', 'supply/../auth-private/x'])
        assert.equal(excluded(rel), true, rel);
    for (const rel of ['supply/005930/2026-11-20.json.gz', 'breadth/markets/daily.json', 'kis-supply/005930/2026-11-20.json.gz',
        'chart-revisions/state.json', 'short-stoploss/state.json', 'trading-session/calendar.json', 'volatility/vix.json'])
        assert.equal(excluded(rel), false, rel);
});
