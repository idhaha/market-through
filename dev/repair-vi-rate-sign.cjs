'use strict';
// VI 창 등락률 부호 복구 (2026-11-16). NH 현재가 조회(currentPrice)가 prdy_ctrt를 부호 없이 주고 prdy_vrss_sign을 빈 값으로 줘서
// 하락 종목의 발동 · 해제 때 등락률이 +로 저장됐다(nh-quote-feed.js restRate로 수정). 이미 남은 기록을 고친다.
//   대상: data/vi-monitor/days/<날짜>.json 의 atStart.rate · atRelease.rate,
//         data/vi-monitor/gap-records/<날짜>.jsonl 의 atStart · atRelease, columns 등락률, 초 단위 'Base 등락률'.
//   부호: 그 값의 가격(atStart.price, 해제 때 basePrice)과 전일 종가를 비교한다.
//         전일 종가는 한투 FHKST01010400(주식현재가 일자별, 원주가)의 그날 전 마지막 종가. 선물 행은 건드리지 않는다.
//   columns · 초 단위 값은 고치기 전 발동 · 해제 때 값과 크기가 같고 부호만 다른 값만 바꾼다(그 뒤 실시간 체결 값은 원래 맞다).
// 저장된 한투 토큰(data/kis-token)만 쓰고 새로 발급하지 않는다. 원본은 *-backup-rate-sign/ 에 먼저 복사한다.
// Usage: node dev/repair-vi-rate-sign.cjs <YYYY-MM-DD> [--dry] [--delete-task 작업이름]
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path'), axios = require('axios');
const root = path.resolve(__dirname, '..'), vi = path.join(root, 'data', 'vi-monitor');
const day = process.argv[2], dry = process.argv.includes('--dry');
const report = path.join(root, 'outputs', 'scheduled', `vi-rate-sign-repair-${String(day).replaceAll('-', '')}.md`);
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const lines = [`## 등락률 부호 복구 ${day} (${kst(Date.now())} KST${dry ? ', 미리 보기' : ''})`, ''];
const round2 = v => Math.round(v * 100) / 100;
const fixSign = (rate, price, prev) => !Number.isFinite(rate) || !(price > 0) || !(prev > 0) || price === prev ? rate : (price < prev ? -1 : 1) * Math.abs(rate);

async function prevCloses(codes) {
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kis-token', 'token.json'), 'utf8'));
    const token = saved.token || saved.access_token, exp = saved.expiresAt || saved.expiry || saved.expiryTime;
    if (!token || exp && exp < Date.now() + 300000) throw Error('저장된 한투 토큰이 없거나 만료됨(새로 발급하지 않음)');
    const domain = process.env.EFRIEND_DOMAIN.trim(), appkey = process.env.EFRIEND_APPKEY.trim(), appsecret = process.env.EFRIEND_SECRETKEY.trim();
    const out = new Map(), ymd = day.replaceAll('-', '');
    for (const code of codes) {
        try {
            const r = await axios.get(domain + '/uapi/domestic-stock/v1/quotations/inquire-daily-price', { timeout: 8000,
                params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code, FID_PERIOD_DIV_CODE: 'D', FID_ORG_ADJ_PRC: '1' },
                headers: { authorization: 'Bearer ' + token, appkey, appsecret, tr_id: 'FHKST01010400', custtype: 'P' } });
            const before = (r.data?.output || []).filter(x => x.stck_bsop_date < ymd).sort((a, b) => b.stck_bsop_date.localeCompare(a.stck_bsop_date))[0];
            if (before && Number(before.stck_clpr) > 0) out.set(code, Number(before.stck_clpr));
        } catch (e) { lines.push(`- ${code} 전일 종가 조회 실패: ${e.response?.status || ''} ${String(e.response?.data?.msg1 || e.message).slice(0, 60)}`); }
        await new Promise(r => setTimeout(r, 300));
    }
    return out;
}
// Fix one row's release-time values; returns the old → new pairs (for columns and seconds).
function fixRow(r, prev, changed) {
    const pairs = [];
    const set = (obj, key, price, label) => {
        const old = obj?.[key], next = fixSign(old, price, prev);
        if (Number.isFinite(old) && next !== old) { obj[key] = next; pairs.push([old, next]); changed.push(`${r.name}(${r.code}) ${r.exchange} ${label} ${old} → ${next}`); }
    };
    set(r.atStart, 'rate', r.atStart?.price, '발동 때');
    const a = r.atRelease;
    // atRelease.nxtRate는 이름과 달리 NXT 괴리율(gap.NXT)이라 고치지 않는다.
    if (a) set(a, 'rate', a.basePrice, '해제 때');
    return pairs;
}
const swap = (v, pairs) => { if (!Number.isFinite(v)) return v; const p = pairs.find(([o]) => Math.abs(Math.abs(v) - Math.abs(o)) < 0.005 && Math.sign(v) === Math.sign(o)); return p ? round2(Math.sign(p[1]) * Math.abs(v)) : v; };

(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw Error('날짜(YYYY-MM-DD)를 주세요');
    const dayFile = path.join(vi, 'days', day + '.json'), gapFile = path.join(vi, 'gap-records', day + '.jsonl');
    const dayData = fs.existsSync(dayFile) ? JSON.parse(fs.readFileSync(dayFile, 'utf8')) : null;
    const gapRows = fs.existsSync(gapFile) ? fs.readFileSync(gapFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    if (!dayData) lines.push(`- ${path.relative(root, dayFile)} 없음 (서버가 자정에 그날 기록을 남기지 않았거나 아직 날이 안 바뀜)`);
    const codes = [...new Set([...(dayData?.rows || []), ...gapRows].filter(r => r.exchange !== 'FUT' && /^[0-9A-Z]{6}$/.test(r.code)).map(r => r.code))];
    const prev = codes.length ? await prevCloses(codes) : new Map();
    lines.push(`- 종목 ${codes.length}개 · 전일 종가 받은 종목 ${prev.size}개`);
    const changed = [], pairsById = new Map();
    for (const r of dayData?.rows || []) if (r.exchange !== 'FUT' && prev.has(r.code)) pairsById.set(r.code + ':' + r.exchange + ':' + r.startedAt, fixRow(r, prev.get(r.code), changed));
    const gapChanged = [];
    for (const g of gapRows) {
        if (g.exchange === 'FUT' || !prev.has(g.code)) continue;
        const pairs = fixRow(g, prev.get(g.code), gapChanged).concat(pairsById.get(g.code + ':' + g.exchange + ':' + g.startedAt) || []);
        if (!pairs.length) continue;
        for (const c of Object.values(g.columns || {})) if (c && '등락률' in c) c['등락률'] = swap(c['등락률'], pairs);
        const i = (g.secondsFields || []).indexOf('Base 등락률');
        if (i >= 0) for (const s of g.seconds || []) s[i] = swap(s[i], pairs);
    }
    lines.push(`- 날짜별 기록: 고친 값 ${changed.length}개`, ...changed.slice(0, 400).map(x => '  - ' + x));
    lines.push(`- 괴리율 기록: 발동 · 해제 때 값 ${gapChanged.length}개 고침(같은 크기의 columns 등락률 · 초 단위 Base 등락률도 함께)`);
    if (!dry) {
        if (dayData && changed.length) {
            const b = path.join(vi, 'days-backup-rate-sign'); fs.mkdirSync(b, { recursive: true });
            if (!fs.existsSync(path.join(b, day + '.json'))) fs.copyFileSync(dayFile, path.join(b, day + '.json'));
            fs.writeFileSync(dayFile + '.tmp', JSON.stringify(dayData)); fs.renameSync(dayFile + '.tmp', dayFile);
        }
        if (gapRows.length && gapChanged.length) {
            const b = path.join(vi, 'gap-records-backup-rate-sign'); fs.mkdirSync(b, { recursive: true });
            if (!fs.existsSync(path.join(b, day + '.jsonl'))) fs.copyFileSync(gapFile, path.join(b, day + '.jsonl'));
            fs.writeFileSync(gapFile + '.tmp', gapRows.map(g => JSON.stringify(g)).join('\n') + '\n'); fs.renameSync(gapFile + '.tmp', gapFile);
        }
        lines.push('- 저장함 (원본: data/vi-monitor/days-backup-rate-sign/, gap-records-backup-rate-sign/)');
    }
})().catch(e => lines.push('- 실패: ' + e.message)).finally(() => {
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.appendFileSync(report, lines.join('\n') + '\n\n'); console.log(report);
    const i = process.argv.indexOf('--delete-task'), name = i > 0 ? process.argv[i + 1] : '';
    if (/^MarketThrough-[\w-]+$/.test(name || '')) try { require('node:child_process').execFileSync('schtasks', ['/delete', '/tn', name, '/f'], { stdio: 'ignore' }); } catch {}
});
