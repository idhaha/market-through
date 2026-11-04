'use strict';
// Local-only full-day VI comparison: Kiwoom realtime 1h vs LS VI_/NVI, plus NH current prices
// (KRX oc / NXT nc / stock futures vC) for stocks with an active VI. Never touches the Oracle server.
// Usage: node dev/vi-compare-live.cjs --until 20:00 --out outputs/vi-compare-20261104
// Credentials come from the project .env and are never printed or written.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { createNhQuoteFeed } = require('../nh-quote-feed');
const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1]; };
const kstDay = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const until = Date.parse(kstDay(Date.now()) + 'T' + arg('until', '20:00') + ':00+09:00');
const out = path.resolve(root, arg('out', 'outputs/vi-compare-' + kstDay(Date.now()).replaceAll('-', '')));
const releaseGraceMs = Number(arg('release-grace', '180')) * 1000;
const redact = s => String(s || '').replace(/[A-Za-z0-9_\-+\/=.]{24,}/g, '[redacted]').slice(0, 200);
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });
const write = (file, value) => fs.appendFileSync(path.join(out, file), JSON.stringify({ at: kst(Date.now()), ...value }) + '\n');
const status = (source, type, detail = {}) => write('status.jsonl', { source, type, ...detail });

// ---- LS REST (masters, futures expiry) and token
let lsToken = '', lsQueue = Promise.resolve();
async function lsAuth() {
    if (lsToken) return lsToken;
    const r = await fetch('https://openapi.ls-sec.co.kr:8080/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', appkey: process.env.LS_APPKEY || '', appsecretkey: process.env.LS_SECRETKEY || '', scope: 'oob' }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw Error('LS 토큰 발급 실패');
    return lsToken = j.access_token;
}
function lsRest(tr, endpoint, input) {
    const task = lsQueue.then(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt) await wait(1500 * attempt);
            const r = await fetch('https://openapi.ls-sec.co.kr:8080/' + endpoint, { method: 'POST', signal: AbortSignal.timeout(15000),
                headers: { authorization: 'Bearer ' + await lsAuth(), 'Content-Type': 'application/json; charset=utf-8', tr_cd: tr, tr_cont: 'N', tr_cont_key: '' },
                body: JSON.stringify({ [tr + 'InBlock']: input }) }).catch(() => null);
            const j = r && await r.json().catch(() => ({}));
            if (j?.rsp_cd === '00000') return j;
        }
        throw Error('LS ' + tr + ' 조회 실패');
    });
    lsQueue = task.catch(() => {}).then(() => wait(1100));
    return task;
}
let stockMaster = new Map(), futuresMaster = [];
async function loadMasters() {
    const s = await lsRest('t8436', 'stock/etc', { gubun: '0' });
    stockMaster = new Map(s.t8436OutBlock.map(r => [r.shcode, { name: r.hname, market: r.gubun === '1' ? 'KOSPI' : r.gubun === '2' ? 'KOSDAQ' : '-' }]));
    futuresMaster = (await lsRest('t8401', 'futureoption/market-data', { dummy: '' })).t8401OutBlock || [];
    status('LS', 'masters', { stocks: stockMaster.size, futures: futuresMaster.length });
}
const nearestFuture = new Map();
async function futureFor(code) {
    // Without the futures master (load failed or pending) do not cache the miss.
    if (!futuresMaster.length) return null;
    if (nearestFuture.has(code)) return nearestFuture.get(code);
    const task = (async () => {
        const today = kstDay(Date.now()).replaceAll('-', '');
        const candidates = futuresMaster.filter(f => String(f.basecode).trim().replace(/^A(?=[0-9A-Z]{6}$)/, '') === code && /^[A-Z0-9]{8}$/.test(f.shcode) && !/스프레드|\bSP\b|SPREAD/i.test(f.hname || ''))
            .sort((a, b) => String(a.hname?.match(/20\d{4}/)?.[0] || '9').localeCompare(String(b.hname?.match(/20\d{4}/)?.[0] || '9')));
        for (const f of candidates) {
            const d = (await lsRest('t8402', 'futureoption/market-data', { focode: f.shcode })).t8402OutBlock;
            const expiry = String(d?.lastmonth || '').replaceAll('-', '');
            if (/^\d{8}$/.test(expiry) && expiry >= today) return { code: f.shcode, expiry };
        }
        return null;
    })().catch(() => null);
    nearestFuture.set(code, task);
    return task;
}

// ---- VI state shared by both sources, drives NH watching
const active = new Map(); // code -> Set of 'source:exchange'
const releaseTimers = new Map();
const summary = { startedAt: kst(Date.now()), until: kst(until), events: {}, stocks: {}, acks: {}, closes: {}, nhEvents: {}, crossChecks: [] };
const count = (bucket, key) => { bucket[key] = (bucket[key] || 0) + 1; };
let nh;
async function onVi(source, exchange, code, kind, fields) {
    const key = source + ':' + exchange;
    count(summary.events, key + ':' + kind);
    (summary.stocks[key] ||= new Set()).add(code);
    write('vi-events.jsonl', { source, exchange, code, name: stockMaster.get(code)?.name, kind, ...fields });
    const set = active.get(code) || new Set();
    if (kind === '해제') set.delete(key); else set.add(key);
    active.set(code, set);
    clearTimeout(releaseTimers.get(code));
    if (!nh) return;
    if (set.size) { const future = await futureFor(code); nh.watch(code, { future: future?.code }); }
    else releaseTimers.set(code, setTimeout(() => { if (!active.get(code)?.size) nh.unwatch(code); }, releaseGraceMs));
}

// ---- LS VI_ / NVI
const lsKinds = { '0': '해제', '1': '정적', '2': '동적', '3': '동적,정적' };
function lsVi() {
    let failures = 0;
    const connect = async () => {
        if (Date.now() >= until) return;
        let auth; try { auth = await lsAuth(); } catch (e) { status('LS', 'auth_failed', { message: e.message }); return setTimeout(connect, 30000); }
        const ws = new WebSocket('wss://openapi.ls-sec.co.kr:9443/websocket', { handshakeTimeout: 10000 });
        ws.on('open', () => { status('LS', 'open'); [['VI_', '000000'], ['NVI', 'N000000   ']].forEach(([tr, key], i) => setTimeout(() => ws.send(JSON.stringify({ header: { token: auth, tr_type: '3' }, body: { tr_cd: tr, tr_key: key } })), i * 500)); });
        ws.on('message', raw => {
            let m; try { m = JSON.parse(String(raw)); } catch { return; }
            const h = m.header || {}, b = m.body || {};
            if (h.rsp_cd != null) { summary.acks['LS:' + h.tr_cd] = h.rsp_cd; status('LS', 'ack', { tr: h.tr_cd, code: h.rsp_cd, message: redact(h.rsp_msg) }); if (h.rsp_cd === '00000') failures = 0; return; }
            if (!['VI_', 'NVI'].includes(h.tr_cd) || !Object.keys(b).length) return;
            const code = String(b.ref_shcode || b.shcode || '').trim().replace(/^N/, '');
            void onVi('LS', h.tr_cd === 'VI_' ? 'KRX' : 'NXT', code, lsKinds[String(b.vi_gubun)] || String(b.vi_gubun),
                { time: b.time, trigger: b.vi_trgprice, staticRef: b.svi_recprice, dynamicRef: b.dvi_recprice });
        });
        ws.on('error', e => status('LS', 'error', { message: redact(e.message) }));
        ws.on('close', (code, reason) => {
            count(summary.closes, 'LS:' + code); status('LS', 'close', { code, reason: redact(reason) });
            if (Date.now() < until) setTimeout(connect, Math.min(60000, 3000 * 2 ** Math.min(failures++, 4)));
        });
        setTimeout(() => ws.close(), Math.max(0, until - Date.now())).unref?.();
    };
    void connect();
}

// ---- Kiwoom realtime 1h (VI 발동/해제). 9068: 1 정적, 2 동적, 3 동적+정적, 4 VI 연장
const kiwoomKinds = { '1': '정적', '2': '동적', '3': '동적,정적', '4': '연장' };
let kiwoomToken = '';
async function kiwoomAuth() {
    if (kiwoomToken) return kiwoomToken;
    const r = await fetch('https://api.kiwoom.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: process.env.KIWOOM_APPKEY || '', secretkey: process.env.KIWOOM_SECRETKEY || '' }) });
    const j = await r.json().catch(() => ({}));
    if (!j.token) throw Error('키움 토큰 발급 실패');
    return kiwoomToken = j.token;
}
function kiwoomVi() {
    let failures = 0;
    const connect = async () => {
        if (Date.now() >= until) return;
        let auth; try { auth = await kiwoomAuth(); } catch (e) { status('Kiwoom', 'auth_failed', { message: e.message }); return setTimeout(connect, 30000); }
        const ws = new WebSocket('wss://api.kiwoom.com:10000/api/dostk/websocket', { handshakeTimeout: 10000 });
        ws.on('open', () => { status('Kiwoom', 'open'); ws.send(JSON.stringify({ trnm: 'LOGIN', token: auth })); });
        ws.on('message', raw => {
            let m; try { m = JSON.parse(String(raw)); } catch { return; }
            if (m.trnm === 'PING') return ws.send(String(raw));
            if (m.trnm === 'LOGIN') {
                status('Kiwoom', 'login', { code: m.return_code, message: redact(m.return_msg) });
                if (String(m.return_code) !== '0') { kiwoomToken = ''; return ws.close(); }
                failures = 0;
                // Group 1: whole market (empty item). Group 2: NXT suffix probe; its result is only recorded.
                ws.send(JSON.stringify({ trnm: 'REG', grp_no: '1', refresh: '1', data: [{ item: [''], type: ['1h'] }] }));
                setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ trnm: 'REG', grp_no: '2', refresh: '1', data: [{ item: ['_NX'], type: ['1h'] }] })), 1000);
                return;
            }
            if (m.trnm === 'REG' || m.trnm === 'REMOVE') { count(summary.acks, 'Kiwoom:REG:' + m.return_code); return status('Kiwoom', 'reg', { code: m.return_code, message: redact(m.return_msg) }); }
            if (m.trnm !== 'REAL' || !Array.isArray(m.data)) return;
            for (const d of m.data) {
                if (d.type !== '1h') continue;
                const v = d.values || {}, item = String(d.item || v['9001'] || '');
                const exchange = /_NX$/.test(item) ? 'NXT' : /_AL$/.test(item) ? 'SOR' : 'KRX';
                const code = item.replace(/^A/, '').replace(/_(NX|AL)$/, '');
                // Observed 2026-11-04: a release repeats the trigger's 9068 (1~3) and fills 1224 (해제시각);
                // a trigger has 1224 = 000000. Any other 9068 value is also recorded as 해제.
                const released = /[1-9]/.test(String(v['1224'] || ''));
                const kind = released ? '해제' : kiwoomKinds[String(v['9068']).trim()] || '해제';
                void onVi('Kiwoom', exchange, code, kind,
                    { item, time: v['1223'], releaseTime: v['1224'], kindRaw: v['9068'], applied: v['1225'], trigger: v['1221'], staticRef: v['1236'], dynamicRef: v['1237'], direction: v['9069'], market: v['9008'], count: v['1490'] });
            }
        });
        ws.on('error', e => status('Kiwoom', 'error', { message: redact(e.message) }));
        ws.on('close', (code, reason) => {
            count(summary.closes, 'Kiwoom:' + code); status('Kiwoom', 'close', { code, reason: redact(reason) });
            if (Date.now() < until) setTimeout(connect, Math.min(60000, 3000 * 2 ** Math.min(failures++, 4)));
        });
        setTimeout(() => ws.close(), Math.max(0, until - Date.now())).unref?.();
    };
    void connect();
}

// ---- NH prices: sample ticks (every 10 s per key) and cross-check WS against REST every 5 minutes
const lastSample = new Map(), lastWs = new Map();
function startNh() {
    if (!process.env.NAMU_APPKEY || !process.env.NAMU_SECRETKEY) { status('NH', 'disabled', { reason: 'NAMU_APPKEY/NAMU_SECRETKEY 없음' }); return; }
    nh = createNhQuoteFeed({ credentials: () => ({ appKey: process.env.NAMU_APPKEY.trim(), secretKey: process.env.NAMU_SECRETKEY.trim() }),
        tokenFile: path.join(root, 'data', 'nh-plug', 'token.json'),
        onEvent: ({ at, type, ...detail }) => { count(summary.nhEvents, type); status('NH', type, detail); },
        onQuote: q => {
            const id = q.exchange + ':' + q.key;
            if (q.via === 'WS') lastWs.set(id, q);
            if ((lastSample.get(id) || 0) + 10000 > q.receivedAt) return;
            lastSample.set(id, q.receivedAt);
            write('nh-samples.jsonl', { key: id, price: q.price, sourceTime: q.sourceTime, via: q.via });
        } });
    nh.start();
    setInterval(async () => {
        const recent = [...lastWs.values()].filter(q => q.exchange !== 'FUT' && Date.now() - q.receivedAt < 60000).sort((a, b) => b.receivedAt - a.receivedAt)[0];
        if (!recent) return;
        try {
            const o = await nh.rest('/krstock/quote/v1/currentPrice', { market_cd: recent.exchange, iem_cd: recent.key });
            const check = { key: recent.exchange + ':' + recent.key, ws: lastWs.get(recent.exchange + ':' + recent.key).price, rest: Number(o.stck_prpr), wsAgeMs: Date.now() - lastWs.get(recent.exchange + ':' + recent.key).receivedAt };
            summary.crossChecks.push(check); write('nh-crosscheck.jsonl', check);
        } catch (e) { status('NH', 'crosscheck_failed', { message: redact(e.message) }); }
    }, 300000).unref?.();
}

function writeSummary(final) {
    const result = { ...summary, writtenAt: kst(Date.now()), final, stocks: Object.fromEntries(Object.entries(summary.stocks).map(([k, v]) => [k, v.size])),
        nh: nh ? { state: nh.state(), keys: nh.summary() } : null, crossChecks: summary.crossChecks.slice(-50) };
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result, null, 2));
}
async function main() {
    if (Date.now() >= until) throw Error('종료 시각이 이미 지났습니다.');
    status('runner', 'started', { pid: process.pid });
    // Retry the masters in the background (2026-11-04 10:03 t8436 failed once and was never retried).
    const loadWithRetry = () => loadMasters().catch(e => { status('LS', 'masters_failed', { message: e.message }); if (Date.now() < until) setTimeout(loadWithRetry, 60000).unref?.(); });
    await loadWithRetry();
    // --no-ls: LS realtime shares the appkey's session limit with the Oracle server; skip it so production keeps its sessions.
    startNh(); if (process.argv.includes('--no-ls')) status('LS', 'disabled', {}); else lsVi(); kiwoomVi();
    // --watch 005930 subscribes NH prices without a VI (connectivity checks outside market hours).
    if (nh && arg('watch')) for (const code of arg('watch').split(',')) nh.watch(code, { future: (await futureFor(code))?.code });
    const timer = setInterval(() => writeSummary(false), 300000);
    await wait(until - Date.now() + 5000);
    clearInterval(timer); nh?.stop(); writeSummary(true); status('runner', 'completed');
    setTimeout(() => process.exit(0), 2000);
}
main().catch(e => { status('runner', 'failed', { message: redact(e.message) }); process.exitCode = 1; });
