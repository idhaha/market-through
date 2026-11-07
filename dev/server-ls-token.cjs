'use strict';
// Local scheduled scripts use the LS token the running local server already holds
// (data/ls-token/token.json, written by ls-market-supply.js) and never issue their own.
// Issuing another token with the same app key may replace the one the servers use (2026-11-06 outage).
const fs = require('node:fs');
const path = require('node:path');
const defaultFile = path.join(__dirname, '..', 'data', 'ls-token', 'token.json');
function readServerLsToken(file = defaultFile, now = Date.now()) {
    try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        return typeof saved.token === 'string' && saved.token && saved.expires > now + 60000 ? saved.token : '';
    } catch { return ''; }
}
// Waits for the server to write a valid token (it does on its first LS call); fails instead of issuing one.
async function serverLsToken({ file = defaultFile, waitMs = 10 * 60000, pollMs = 15000, now = Date.now, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    const until = now() + waitMs;
    for (;;) {
        const token = readServerLsToken(file, now());
        if (token) return token;
        if (now() >= until) throw Error('로컬 서버의 LS 토큰 없음 (서버 실행 확인 필요, 직접 발급하지 않음)');
        await pause(pollMs);
    }
}
module.exports = { serverLsToken, readServerLsToken, defaultFile };
