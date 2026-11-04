// LS t1637 (stock program by time) call limit probe.
// Sends calls at fixed rates and records the response code and latency of each call, so the
// number of stocks one appkey can poll once a minute can be estimated. Usage:
//   node dev/ls-t1637-rate-probe.cjs [outDir]
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path');
const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'outputs', 't1637-rate-probe'));
fs.mkdirSync(out, { recursive: true });
const codes = ['005930', '000660', '373220', '207940', '005380', '000270', '068270', '035420', '105560', '055550',
    '012330', '005490', '028260', '035720', '051910', '006400', '032830', '086790', '003670', '066570'];
const rates = [1, 1.25, 1.5, 2, 3], callsPerRate = 20, restBetweenRatesMs = 5000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const kst = t => new Date(t + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 23);
async function token() {
    const r = await fetch('https://openapi.ls-sec.co.kr:8080/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', appkey: process.env.LS_APPKEY || '', appsecretkey: process.env.LS_SECRETKEY || '', scope: 'oob' }), signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (!j.access_token) throw Error('LS 토큰 발급 실패');
    return j.access_token;
}
async function call(auth, code, date) {
    const started = Date.now();
    try {
        const r = await fetch('https://openapi.ls-sec.co.kr:8080/stock/program', { method: 'POST', signal: AbortSignal.timeout(15000),
            headers: { authorization: 'Bearer ' + auth, 'Content-Type': 'application/json; charset=utf-8', tr_cd: 't1637', tr_cont: 'N', tr_cont_key: '' },
            body: JSON.stringify({ t1637InBlock: { gubun1: '0', gubun2: '0', shcode: code, date, time: '', cts_idx: 9999, exchgubun: 'U' } }) });
        const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
        return { http: r.status, code: String(j.rsp_cd ?? j.error_code ?? ''), msg: String(j.rsp_msg ?? j.error_msg ?? '').slice(0, 60),
            rows: Array.isArray(j.t1637OutBlock1) ? j.t1637OutBlock1.length : null, ms: Date.now() - started };
    } catch (e) { return { http: 0, code: 'ERR', msg: e.message.slice(0, 60), rows: null, ms: Date.now() - started }; }
}
(async () => {
    const auth = await token(), date = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
    const log = fs.createWriteStream(path.join(out, 'calls.jsonl')), summary = [];
    for (const rate of rates) {
        const gap = 1000 / rate, base = Date.now(), pending = [];
        for (let i = 0; i < callsPerRate; i++) {
            await sleep(Math.max(0, base + i * gap - Date.now()));
            const code = codes[i % codes.length], sentAt = Date.now();
            // Fire on schedule without waiting for the previous answer, as a poller with a fixed pace would.
            pending.push(call(auth, code, date).then(res => { const row = { rate, i, code, sent: kst(sentAt), ...res }; log.write(JSON.stringify(row) + '\n'); return row; }));
        }
        const rows = await Promise.all(pending), ok = rows.filter(r => r.code === '00000');
        const ms = ok.map(r => r.ms).sort((a, b) => a - b);
        const codesSeen = {}; for (const r of rows) codesSeen[r.code + (r.code === '00000' ? '' : ' ' + r.msg)] = (codesSeen[r.code + (r.code === '00000' ? '' : ' ' + r.msg)] || 0) + 1;
        summary.push({ rate, calls: rows.length, ok: ok.length, rejected: rows.length - ok.length, codes: codesSeen, msMedian: ms[ms.length >> 1] ?? null, msMax: ms.at(-1) ?? null });
        console.log(JSON.stringify(summary.at(-1)));
        await sleep(restBetweenRatesMs);
    }
    log.end();
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ at: kst(Date.now()), date, rates: summary }, null, 2));
})().catch(e => { console.error(e.message); process.exit(1); });
