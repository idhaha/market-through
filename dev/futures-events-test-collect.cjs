'use strict';
// 선물 이벤트(LS JD0 · JX0) 장중 수신 시험 결과 모으기 (2026-11-12). 모델 없이 예약 작업으로 실행한다.
// - 로컬: data/vi-monitor/futures-events/날짜.jsonl(받은 원문) 건수 · TR별 · 칸 이름 · 값 종류, 선물 행(state.json),
//   logs/server_debug.날짜.log의 [선물 이벤트] 줄.
// - 오라클: 같은 날 server_debug에서 LS 연결 · 등록 관련 줄(시험이 오라클 LS 연결에 영향을 줬는지). 읽기만 한다.
// 결과: outputs/scheduled/futures-events-test-날짜.md
// Usage: node dev/futures-events-test-collect.cjs [YYYY-MM-DD]
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const day = process.argv[2] || new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const out = path.join(root, 'outputs', 'scheduled', `futures-events-test-${day.replaceAll('-', '')}.md`);
const lines = [`# 선물 이벤트 수신 시험 결과 ${day}`, '', `모은 시각: ${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ')} (KST)`, ''];
const redact = s => String(s).replace(/[A-Za-z0-9_+\/=.~-]{40,}/g, '[redacted]');
// 1. 받은 원문
const rawFile = path.join(root, 'data', 'vi-monitor', 'futures-events', day + '.jsonl');
lines.push('## 1. 받은 원문 (로컬)', '');
if (!fs.existsSync(rawFile)) lines.push(`- 파일 없음: ${path.relative(root, rawFile)} (받은 메시지 0건)`);
else {
    const rows = fs.readFileSync(rawFile, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const byTr = {}, fields = {}, values = {}, keys = new Set();
    for (const r of rows) {
        byTr[r.tr] = (byTr[r.tr] || 0) + 1; keys.add(r.key ?? r.body?.futcode);
        for (const [k, v] of Object.entries(r.body || {})) {
            (fields[r.tr] ||= new Set()).add(k);
            // Value kinds for the state fields (meaning still to be confirmed).
            if (['dy_gubun', 'gubun', 'upstep', 'dnstep'].includes(k)) { const id = r.tr + '.' + k; (values[id] ||= new Map()).set(String(v), ((values[id].get(String(v))) || 0) + 1); }
        }
    }
    lines.push(`- 전체 ${rows.length}건, 월물 ${keys.size}개, 처음 ${rows[0]?.at || '-'} · 마지막 ${rows.at(-1)?.at || '-'}`);
    for (const [tr, n] of Object.entries(byTr)) lines.push(`- ${tr}: ${n}건, 칸: ${[...(fields[tr] || [])].join(', ')}`);
    for (const [id, m] of Object.entries(values)) lines.push(`- ${id} 값: ${[...m].map(([v, n]) => `${v}(${n})`).join(', ')}`);
    lines.push('', '처음 메시지 5건:', '');
    for (const r of rows.slice(0, 5)) lines.push('    ' + JSON.stringify(r).slice(0, 400));
}
// 2. 선물 행
lines.push('', '## 2. VI 창 선물 행 (로컬 state.json)', '');
try {
    const state = JSON.parse(fs.readFileSync(path.join(root, 'data', 'vi-monitor', 'state.json'), 'utf8'));
    const fut = (state.rows || []).filter(r => r.exchange === 'FUT');
    const t = v => Number.isFinite(v) ? new Date(v + 9 * 3600000).toISOString().slice(11, 19) : '-';
    lines.push(`- 선물 행 ${fut.length}건 (state.json 날짜 ${state.day})`);
    for (const r of fut.slice(0, 40)) lines.push(`- ${r.name}(${r.code}) ${r.contract?.code} ${r.kindText} 발동 ${t(r.startedAt)} 해제 ${t(r.releasedAt)} ${r.atRelease?.basis || ''}`);
} catch (e) { lines.push('- state.json 읽기 실패: ' + e.message); }
// 3. 로컬 로그
lines.push('', '## 3. 로컬 server_debug [선물 이벤트] 줄', '');
try {
    const log = fs.readFileSync(path.join(root, 'logs', `server_debug.${day}.log`), 'utf8').split('\n').filter(l => l.includes('[선물 이벤트]'));
    lines.push(`- ${log.length}줄`, ...log.slice(0, 60).map(l => '    ' + redact(l).slice(0, 300)));
} catch (e) { lines.push('- 로그 읽기 실패: ' + e.message); }
// 4. 오라클 LS 연결 줄 (읽기만)
lines.push('', '## 4. 오라클 server_debug의 LS 관련 줄', '');
try {
    const text = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', 'ubuntu@134.185.111.202',
        `grep -E "LS|장운영|사이드카|JIF|시장 수급|종목 수급" ~/market-through/logs/server_debug.${day}.log 2>/dev/null | grep -iE "끊|거부|실패|오류|close|error|reject|연결|등록|수신" | tail -n 120; true`], { encoding: 'utf8', timeout: 60000 });
    const got = text.split('\n').filter(Boolean);
    lines.push(`- ${got.length}줄 (끊김 · 거부 · 실패 · 연결 · 등록 단어가 있는 줄, 마지막 120줄까지)`, ...got.map(l => '    ' + redact(l).slice(0, 300)));
} catch (e) { lines.push('- 오라클 로그 읽기 실패: ' + String(e.message).slice(0, 200)); }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(out);
