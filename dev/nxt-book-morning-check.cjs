'use strict';
// NXT 매수 10호가 평균 오전 확인 (2026-11-13). 모델 없이 예약 작업으로 실행하고 결과를 파일에 덧붙인다.
//   probe: 한투 FHKST01010200을 시장 구분 J(KRX) · NX(NXT)로 한 번씩 조회해 KRX가 열리기 전 NXT 호가가 오는지 본다.
//   state: VI 창 state.json에서 08:50 전에 시작한 NXT 행과 그 행의 해제 때 호가 평균, server_debug의 [VI NXT 호가] 줄.
// 저장된 한투 토큰(data/kis-token)만 쓰고 새로 발급하지 않는다. 토큰 · 키는 출력하지 않는다.
// Usage: node dev/nxt-book-morning-check.cjs probe|state [YYYY-MM-DD] [--delete-task 작업이름]
// --delete-task: 일회성 예약 작업이 끝나면 그 작업을 지운다(.cmd를 거치지 않고 node.exe를 바로 실행하므로).
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path'), axios = require('axios');
const root = path.resolve(__dirname, '..'), mode = process.argv[2] || 'probe';
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const day = process.argv[3] || kst(Date.now()).slice(0, 10);
const out = path.join(root, 'outputs', 'scheduled', `nxt-book-check-${day.replaceAll('-', '')}.md`);
const lines = [`## ${mode === 'probe' ? '오전 조회' : 'VI 창 NXT 행'} (${kst(Date.now())} KST)`, ''];
async function probe() {
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kis-token', 'token.json'), 'utf8'));
    if (!(saved.expires > Date.now() + 60000)) { lines.push('- 저장된 한투 토큰이 만료돼 조회하지 않음 (새로 발급하지 않음)'); return; }
    const e = process.env, domain = (e.EFRIEND_DOMAIN || '').trim();
    for (const code of ['005930', '000660']) for (const m of ['J', 'NX']) {
        try {
            const r = await axios.get(domain + '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn', { params: { FID_COND_MRKT_DIV_CODE: m, FID_INPUT_ISCD: code }, timeout: 10000,
                headers: { authorization: 'Bearer ' + saved.token, appkey: (e.EFRIEND_APPKEY || '').trim(), appsecret: (e.EFRIEND_SECRETKEY || '').trim(), tr_id: 'FHKST01010200', custtype: 'P' } });
            const o = r.data?.output1 || {}, levels = Array.from({ length: 10 }, (_, i) => [Number(o['bidp' + (i + 1)]), Number(o['bidp_rsqn' + (i + 1)])]);
            const priced = levels.filter(([p]) => p > 0), avg = priced.length ? priced.reduce((s, [p, q]) => s + p * q, 0) / priced.length : null;
            lines.push(`- ${code} ${m === 'J' ? 'KRX' : 'NXT'}: 응답 ${r.data?.rt_cd} ${String(r.data?.msg1 || '').trim()} · 호가 시각 ${o.aspr_acpt_hour || '-'} · 가격 있는 단계 ${priced.length}/10 · 1호가 ${levels[0][0] || '-'}(${levels[0][1]}) · 평균 ${avg == null ? '-' : Math.round(avg).toLocaleString('ko-KR')}원`);
        } catch (x) { lines.push(`- ${code} ${m}: 조회 실패 ${x.response?.status || ''} ${String(x.message).slice(0, 80)}`); }
        await new Promise(r => setTimeout(r, 400));
    }
}
function state() {
    try {
        const s = JSON.parse(fs.readFileSync(path.join(root, 'data', 'vi-monitor', 'state.json'), 'utf8'));
        const cut = Date.parse(day + 'T08:50:00+09:00'), rows = (s.rows || []).filter(r => r.exchange === 'NXT' && r.startedAt < cut);
        const filled = rows.filter(r => Number.isFinite(r.atRelease?.bidAverage));
        lines.push(`- state.json 날짜 ${s.day} · 08:50 전에 시작한 NXT 행 ${rows.length}건 · 해제 때 호가 평균이 있는 행 ${filled.length}건`);
        for (const r of rows.slice(0, 30)) lines.push(`  - ${r.name}(${r.code}) 발동 ${kst(r.startedAt).slice(11)} ${r.active ? '발동 중' : '해제 ' + (r.releasedAt ? kst(r.releasedAt).slice(11) : '-')} · 호가 평균 ${Number.isFinite(r.atRelease?.bidAverage) ? Math.round(r.atRelease.bidAverage).toLocaleString('ko-KR') + '원' : '없음'}`);
    } catch (x) { lines.push('- state.json 읽기 실패: ' + x.message); }
    try {
        const log = fs.readFileSync(path.join(root, 'logs', `server_debug.${day}.log`), 'utf8').split('\n').filter(l => l.includes('[VI NXT 호가]'));
        lines.push(`- server_debug [VI NXT 호가] 줄 ${log.length}개 (조회 실패 · 회복 때만 남음)`, ...log.slice(0, 20).map(l => '    ' + l.slice(0, 200)));
    } catch (x) { lines.push('- 로그 읽기 실패: ' + x.message); }
}
(async () => {
    if (mode === 'probe') await probe(); else state();
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (!fs.existsSync(out)) fs.writeFileSync(out, `# NXT 매수 10호가 평균 오전 확인 ${day}\n\n`);
    fs.appendFileSync(out, lines.join('\n') + '\n\n');
    console.log(out);
})().finally(() => {
    const i = process.argv.indexOf('--delete-task'), name = i > 0 ? process.argv[i + 1] : '';
    if (/^MarketThrough-[\w-]+$/.test(name || '')) try { require('node:child_process').execFileSync('schtasks', ['/delete', '/tn', name, '/f'], { stdio: 'ignore' }); } catch {}
});
