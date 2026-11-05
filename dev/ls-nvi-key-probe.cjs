'use strict';
// Which LS tr_key format delivers NXT VI events? (2026-11-06 morning, local only, uses 1 LS websocket session)
// Background: on 11/4 and 11/5, NVI with 'N000000   ' acked 00000 but sent 0 events while Kiwoom got many NXT VIs.
// The official spec (tr-guides.json) lists NVI key as 'N' + 6-digit code + 3 spaces and no all-stocks key.
// This probe registers, on one socket:
//   NVI 'N000000   '   (current key, baseline)
//   UVI 'U000000   '   (integrated VI, all-stocks guess)
//   DVI '000000'       (after-hours VI, the only VI TR documented with an all-stocks key)
//   NVI 'N<code>   '   and UVI 'U<code>   ' per stock, for the stocks with the most Kiwoom NXT VIs on --from-day
// and records acks per key and every event with its raw key fields. Compare with Kiwoom NXT VIs in the same window.
// Usage: node dev/ls-nvi-key-probe.cjs --until 08:06 --from-day 20261105 --count 40 --out outputs/nvi-probe-20261106
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const until = Date.parse(today + 'T' + arg('until', '08:06') + ':00+09:00');
const out = path.resolve(root, arg('out', 'outputs/nvi-probe-' + today.replaceAll('-', '')));
fs.mkdirSync(out, { recursive: true });
const write = (file, value) => fs.appendFileSync(path.join(out, file), JSON.stringify({ at: kst(Date.now()), ...value }) + '\n');

// Stocks with the most Kiwoom NXT VIs on the source day (more likely to trigger again).
function topNxtCodes() {
    const file = path.join(root, 'outputs', 'vi-compare-' + arg('from-day', '20261105'), 'vi-events.jsonl');
    const counts = new Map();
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        let r; try { r = JSON.parse(line); } catch { continue; }
        if (r.source === 'Kiwoom' && r.exchange === 'NXT' && /^[0-9A-Z]{6}$/.test(String(r.code))) counts.set(r.code, (counts.get(r.code) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(arg('count', '40'))).map(([code]) => code);
}

(async () => {
    const codes = topNxtCodes();
    const subs = [['NVI', 'N000000   '], ['UVI', 'U000000   '], ['DVI', '000000'],
        ...codes.map(c => ['NVI', 'N' + c + '   ']), ...codes.map(c => ['UVI', 'U' + c + '   '])];
    write('runner.jsonl', { state: 'started', codes, subscriptions: subs.length, until: kst(until) });
    const r = await fetch('https://openapi.ls-sec.co.kr:8080/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15000),
        body: new URLSearchParams({ grant_type: 'client_credentials', appkey: process.env.LS_APPKEY || '', appsecretkey: process.env.LS_SECRETKEY || '', scope: 'oob' }) });
    const token = (await r.json()).access_token;
    if (!token) { write('runner.jsonl', { state: 'auth_failed' }); process.exit(1); }
    const summary = { acks: {}, events: {}, codes: {}, closes: [] };
    const ws = new WebSocket('wss://openapi.ls-sec.co.kr:9443/websocket');
    ws.addEventListener('open', () => {
        write('runner.jsonl', { state: 'open' });
        // 150 ms apart so the registrations do not burst.
        subs.forEach(([tr, key], i) => setTimeout(() => ws.send(JSON.stringify({ header: { token, tr_type: '3' }, body: { tr_cd: tr, tr_key: key } })), i * 150));
    });
    ws.addEventListener('message', ev => {
        let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
        const h = m.header || {}, b = m.body || {};
        if (h.rsp_cd != null) {
            const k = h.tr_cd + ':' + (h.tr_key ?? '?') + ':' + h.rsp_cd; summary.acks[k] = (summary.acks[k] || 0) + 1;
            write('acks.jsonl', { tr: h.tr_cd, key: h.tr_key ?? null, code: h.rsp_cd, message: String(h.rsp_msg || '').slice(0, 60) });
            return;
        }
        if (!b || !Object.keys(b).length) return;
        const tr = h.tr_cd, key = String(h.tr_key ?? ''), code = String(b.ref_shcode || b.shcode || '').trim();
        summary.events[tr] = (summary.events[tr] || 0) + 1;
        (summary.codes[tr] ||= new Set()).add(code);
        write('events.jsonl', { tr, key, code, vi_gubun: b.vi_gubun, time: b.time, shcode: b.shcode, ref_shcode: b.ref_shcode, exchname: b.exchname });
    });
    ws.addEventListener('close', e => { summary.closes.push(e.code); write('runner.jsonl', { state: 'close', code: e.code }); });
    ws.addEventListener('error', () => write('runner.jsonl', { state: 'error' }));
    setTimeout(() => {
        try { ws.close(); } catch {}
        const result = { finishedAt: kst(Date.now()), probedCodes: codes, acks: summary.acks, events: summary.events,
            codes: Object.fromEntries(Object.entries(summary.codes).map(([k, v]) => [k, [...v]])), closes: summary.closes };
        fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result, null, 2));
        write('runner.jsonl', { state: 'finished' });
        setTimeout(() => process.exit(0), 500);
    }, Math.max(0, until - Date.now()));
})().catch(e => { write('runner.jsonl', { state: 'failed', message: String(e.message).slice(0, 120) }); process.exit(1); });
