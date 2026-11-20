'use strict';
// NXT 09:00:30 쓸림 기록 (2026-11-17 정책). 주문은 내지 않고 기록 · 가상 체결만 계산한다.
//   NXT는 08:50~09:00:30 휴장 동안 취소만 받는다(신한 · 미래에셋 NXT 안내). 그래서 09:00:30 쓸림에 걸리는 주문은
//   08:50 전(프리마켓)에 넣은 일반 지정가뿐이다(GTP가 아니면 메인마켓으로 이월). 가상 주문은 08:48 조회 결과로 정한다.
// 단계 (KST)
//   08:48:00 ① 배치 전 조회: 순위(KRX 예상체결 상승 · 하락, NXT 등락률 상승 · 하락, NXT 거래대금) + 전 거래일 VI 종목,
//            --full이면 08:46:30에 KIS 종목 마스터 전 종목을 NX로 훑어 NXT 거래 종목을 더한다. 멀티종목 시세(FHKST11300006) J = KRX 예상체결, NX = NXT 프리마켓 현재가.
//            괴리 |NXT ÷ KRX 예상 − 1| ≥ 1.5%인 종목(최대 40) = 후보. 후보의 NXT 10호가(FHKST01010200 NX)를 08:49:50까지.
//   08:30~08:59 KRX 예상체결 공개 시각 조회(30종목, 20초마다; 11/17 08:48에는 비어 있었다).
//   08:59:10 ② 휴장 중 조회: 프리마켓 거래 종목의 KRX 예상가(08:59 괴리 큰 종목을 참고 후보로 추가) · 후보 NXT 10호가.
//   09:00:03 ③ KRX 시세 기록(시가는 ④의 09:00:00 첫 체결을 쓴다).
//   09:05:30 ④ 체결 조회(FHPST01060000): 후보 NX 08:48~08:50 · 09:00:30~09:01:30, 09:01 · 09:03 · 09:05 가격,
//            KRX 09:00~09:01:30. 대조군 20종목(괴리 작은 NXT 종목)은 NX 09:00:30~09:01:30만.
//   그 뒤 VI 창 기록(data/vi-monitor/state.json) · 분석 · outputs/nxt-open-sweep/<날짜>/summary.md
// 조회는 초당 3건 이하. 한투 토큰은 data/kis-token/token.json(서버와 같은 파일)을 쓰고, 없거나 만료면 새로 발급해 그 파일에
// 저장한다(발급하면 log.txt에 남긴다). NH는 쓰지 않는다.
// Usage: node dev/nxt-open-sweep.cjs run <YYYY-MM-DD> [--full] [--shift 60] [--delete-task 작업이름]   (--shift: 수능일처럼 장이 늦게 여는 날)
//        node dev/nxt-open-sweep.cjs analyze <YYYY-MM-DD>     (저장된 raw.json으로 분석만 다시)
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');

const num = v => v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const kstClock = t => new Date(t + 9 * 3600000).toISOString().slice(11, 19);
const kstAt = (day, hms) => Date.parse(`${day}T${hms}+09:00`);
const hhmmss = t => kstClock(t).replaceAll(':', '');
// 수능일처럼 장이 늦게 열리는 날: 평소 기준 시각(HH:MM:SS 또는 HHMMSS)을 min분 늦춘다.
const shiftHms = (hms, min = 0) => {
    if (!min) return hms;
    const d = hms.replaceAll(':', ''), s = +d.slice(0, 2) * 3600 + +d.slice(2, 4) * 60 + +d.slice(4, 6) + min * 60;
    const o = [s / 3600 | 0, (s / 60 | 0) % 60, s % 60].map(x => String(x).padStart(2, '0'));
    return hms.includes(':') ? o.join(':') : o.join('');
};
const pct = v => v == null ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
// KRX · NXT 주식 호가 단위(2023-01-25~, 코스피 · 코스닥 같음).
function tick(p) { return p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000; }
// 매수는 내림, 매도는 올림. 가격 구간 경계에서는 그 가격의 단위로 다시 맞춘다.
function roundTick(p, side) {
    let t = tick(p), v = side === 'buy' ? Math.floor(p / t) * t : Math.ceil(p / t) * t;
    if (tick(v) !== t) { t = tick(v); v = side === 'buy' ? Math.floor(v / t) * t : Math.ceil(v / t) * t; }
    return v;
}
const signed = (v, sign) => { const n = num(v); if (n == null) return null; const s = String(sign ?? '').trim(); return ['4', '5'].includes(s) ? -Math.abs(n) : ['1', '2'].includes(s) ? Math.abs(n) : s === '3' ? 0 : n; };
// 멀티종목 시세 한 줄 → KRX 예상체결(J) 또는 NXT 현재가(NX).
function quoteOf(o, market, at) {
    const prev = num(o.inter2_prdy_clpr), price = num(o.inter2_prpr), vol = num(o.acml_vol);
    const q = { code: String(o.inter_shrn_iscd || '').trim(), name: String(o.inter_kor_isnm || '').trim(), prev, price, rate: num(o.prdy_ctrt), vol,
        amount: num(o.acml_tr_pbmn), upper: num(o.inter2_mxpr), lower: num(o.inter2_llam), open: num(o.inter2_oprc), at, hourCls: o.hour_cls_code };
    if (market === 'J') {
        q.expVol = num(o.intr_antc_vol);
        // 장 전 예상체결: 전일 종가 + 부호 붙은 예상 대비. 예상 대비가 없으면 예상 등락률로.
        const d = signed(o.intr_antc_cntg_vrss, o.intr_antc_cntg_vrss_sign), r = signed(o.intr_antc_cntg_prdy_ctrt, o.intr_antc_cntg_vrss_sign);
        // 11/17 시험: 08:48에는 예상 수량 0 · 대비 0으로 와서 전일 종가가 예상가로 잘못 쓰였다. 예상 수량이 있어야 예상가로 본다.
        q.exp = !(q.expVol > 0) ? null : prev > 0 && d != null && (d !== 0 || r === 0) ? prev + d : prev > 0 && r != null ? Math.round(prev * (1 + r / 100)) : null;
        q.raw = { vrss: o.intr_antc_cntg_vrss, sign: o.intr_antc_cntg_vrss_sign, rate: o.intr_antc_cntg_prdy_ctrt, vol: o.intr_antc_vol, prpr: o.inter2_prpr };
    }
    return q;
}
const lastAt = (trades, t) => { let v = null; for (const x of trades) if (x.t <= t) v = x; else break; return v; };

// ---- 분석 (raw.json → 결과). 가상 주문은 100만원어치.
const LEVELS = [0.01, 0.02, 0.03, 0.05], FEE = 0.002, NOTIONAL = 1e6;
function analyze(raw) {
    const day = raw.day, A = hms => kstAt(day, shiftHms(hms, raw.shiftMin));
    const open = A('09:00:30'), sweepEnd = A('09:01:30'), preEnd = A('08:50:00');
    const out = [];
    for (const c of raw.candidates) {
        const tr = raw.trades[c.code] || {}, nx = (tr.NX || []), krx = (tr.J || []);
        // KRX 시가 = 09:00 이후 첫 체결. 11/17 · 11/18 모두 첫 체결이 09:00:01~09:00:30에 흩어져 나왔다(09:00:00~01 전용 조회는 2/47만 맞음).
        const s3 = raw.s3?.J?.[c.code];
        const openTrade = krx.find(x => x.t >= A('09:00:00'));
        // 11/18 재조회: 두산은 09:00:25 시가 체결(4,840주, 585,000)이 체결 목록에 없었다(같은 초 체결이 30건을 넘으면 그 초를 다 못 받는다).
        // 그래서 시가는 멀티종목 시세의 시가(inter2_oprc)를 먼저 쓰고, 체결 목록 첫 줄의 누적 거래량이 그 체결량보다 크면 시가 체결이 빠진 것으로 본다.
        const krxOpen = s3?.open > 0 ? s3.open : tr.open ?? openTrade?.p ?? (s3?.price && s3.price !== s3.prev ? s3.price : null), krxOpenAt = openTrade?.t ?? null;
        const openMissing = !!openTrade && openTrade.v > openTrade.q;
        const exp0859 = raw.s2?.J?.[c.code]?.exp ?? null;
        const sweep = nx.filter(x => x.t >= open && x.t <= sweepEnd);
        // 수렴: NXT 본장 체결마다 그 순간 KRX 직전 체결가와의 괴리(NXT ÷ KRX − 1).
        const conv = sweep.map(x => { const k = lastAt(krx, x.t); return k ? { t: x.t, g: x.p / k.p - 1 } : null; }).filter(Boolean);
        const maxConv = conv.reduce((m, x) => !m || Math.abs(x.g) > Math.abs(m.g) ? x : m, null);
        const inBand = conv.find(x => Math.abs(x.g) <= 0.005);
        const converge = { firstNxAt: sweep[0]?.t ?? null, firstGap: conv[0]?.g ?? null, maxGap: maxConv?.g ?? null, maxAt: maxConv?.t ?? null,
            sec05: inBand && sweep[0] ? Math.round((inBand.t - sweep[0].t) / 1000) : null, n: conv.length };
        // 실제 쓸림 방향: NXT 프리 가격이 KRX 시가보다 높으면 NXT 매도 쓸림(매수 기회). 프리 가격이 없으면(09:00:31 수렴 후보 · 프리마켓 없는 날) 첫 괴리 방향.
        const sideRef = krxOpen || exp0859 || c.krxExp || c.prev;
        const side = c.nxtPre > 0 ? (c.nxtPre > sideRef ? 'buy' : 'sell') : (converge.firstGap ?? c.convGap ?? 0) > 0 ? 'buy' : 'sell';
        const low = sweep.length ? Math.min(...sweep.map(x => x.p)) : null, high = sweep.length ? Math.max(...sweep.map(x => x.p)) : null;
        const extreme = side === 'buy' ? low : high;
        const depth = extreme && krxOpen ? extreme / krxOpen - 1 : null;
        // 회복: 쓸림 최저(최고) 뒤 NXT 가격이 KRX 직전 체결가의 1% 안으로 돌아온 첫 시각.
        let recoverSec = null;
        if (extreme && krx.length) {
            const tx = sweep.find(x => x.p === extreme).t;
            const back = nx.find(x => x.t >= tx && (() => { const k = lastAt(krx, x.t); return k && Math.abs(x.p / k.p - 1) <= 0.01; })());
            if (back) recoverSec = Math.round((back.t - tx) / 1000);
        }
        const vi = (raw.vi || []).filter(v => v.code === c.code);
        const book = raw.s2?.books?.[c.code], placeBook = raw.s1?.books?.[c.code];
        const levels = [];
        const bases = [c.krxExp > 0 ? ['08:48 예상가', c.krxExp] : ['08:48 전일 종가(예상가 없음)', c.prev], ['08:59 예상가(참고)', exp0859], ['KRX 시가(사후)', krxOpen]];
        for (const [basis, ref] of bases) {
            if (!(ref > 0) || !(c.nxtPre > 0) || c.nxtPre === ref) continue;
            const side = c.nxtPre > ref ? 'buy' : 'sell';
            for (const k of LEVELS) {
                const price = roundTick(ref * (side === 'buy' ? 1 - k : 1 + k), side), qty = Math.max(1, Math.floor(NOTIONAL / price));
                const why = [];
                if (basis === 'KRX 시가(사후)') why.push('사후 기준(09:00 시가는 08:50 전에 알 수 없음)');
                if (basis === '08:59 예상가(참고)') why.push('08:50 뒤 기준(휴장 중 신규 주문 불가)');
                if (basis.startsWith('08:48') && !(c.krxAt < A('08:49:50'))) why.push('08:49:50 전에 KRX 시세를 못 받음');
                const lim = raw.s1?.NX?.[c.code] || raw.s1?.J?.[c.code];
                if (lim?.lower && price < lim.lower || lim?.upper && price > lim.upper) why.push('가격제한폭 밖');
                // 08:50 전에 이미 그 가격에 체결됐으면 의도한 09:00:30 주문이 아니다.
                const placedAt = (c.krxAt || 0) + 5000;
                const early = nx.find(x => x.t >= placedAt && x.t < preEnd && (side === 'buy' ? x.p <= price : x.p >= price));
                if (early) why.push('프리마켓 ' + kstClock(early.t) + '에 먼저 체결');
                // 내 앞 순서: 휴장 중 호가(②)에서 같은 가격 잔량(뒤에 들어온 주문도 포함 = 보수적). 더 좋은 가격 잔량은 체결로 먼저 소진된다.
                const lv = book?.[side === 'buy' ? 'bids' : 'asks'] || [];
                const same = lv.find(l => l.p === price), deepest = lv.length ? lv[lv.length - 1].p : null;
                const visible = same || deepest != null && (side === 'buy' ? price > deepest : price < deepest);
                const ahead = same ? same.q : visible ? 0 : null;
                let filledAt = null, cum = 0;
                for (const x of nx.filter(x => x.t >= open && x.t <= A('09:05:00'))) {
                    if (side === 'buy' ? x.p < price : x.p > price) { filledAt = x.t; break; }
                    if (x.p === price && ahead != null) { cum += x.q; if (cum - ahead >= qty) { filledAt = x.t; break; } }
                }
                const queue = ahead == null ? '순서 미확인(10호가 밖)' : same ? `앞 잔량 ${same.q.toLocaleString()}주` : '앞 잔량 없음';
                const r = { basis, k, side, price, qty, filled: !!filledAt, filledAt, queue, why };
                if (filledAt) {
                    // 위험 묶기: 체결 뒤 3초 안 KRX 반대 매매(첫 체결가, 그 3초 체결 수량 ≥ 내 수량).
                    const w = krx.filter(x => x.t > filledAt - 1000 && x.t <= filledAt + 3000);
                    const hedgeVol = w.reduce((s, x) => s + x.q, 0);
                    r.hedge = w.length ? { p: w[0].p, at: w[0].t, vol: hedgeVol, enough: hedgeVol >= qty,
                        pnl: (side === 'buy' ? w[0].p / price : price / w[0].p) - 1 - FEE } : null;
                    if (!w.length) why.push('체결 뒤 3초 안 KRX 체결 없음(묶기 확인 못 함)');
                    else if (hedgeVol < qty) why.push('KRX 3초 체결량이 내 수량보다 적음');
                    r.hold = {};
                    for (const hm of ['09:01:00', '09:03:00', '09:05:00']) {
                        const p = (tr.at?.[hm]) ?? lastAt(nx, A(hm))?.p;
                        r.hold[hm] = p ? (side === 'buy' ? p / price : price / p) - 1 - FEE : null;
                    }
                }
                r.verdict = !filledAt ? '체결 안 됨' : why.length ? '실제로는 불가 · ' + why.join(' · ') : ahead == null ? '가능(순서 미확인 · 최저가가 주문가보다 낮아 전량 체결로 봄)' : '가능';
                if (side === 'sell' && filledAt) r.verdict += ' · 보유자만 가능';
                levels.push(r);
            }
        }
        out.push({ code: c.code, name: c.name, side, basis: !(c.nxtPre > 0) ? '09:00:31 수렴' : c.krxExp > 0 ? '예상가' : '전일 종가', gap: c.nxtPre > 0 ? c.gap : c.convGap ?? null, gap0859: exp0859 && c.nxtPre > 0 ? c.nxtPre / exp0859 - 1 : null, nxtPre: c.nxtPre,
            krxExp: c.krxExp, krxExp0859: exp0859, krxOpen, krxOpenAt, openMissing, converge, convGap: c.convGap ?? null, low, high, depth, recoverSec, sweepTrades: sweep.length, inRank: c.inRank, inPrevVi: c.inPrevVi, from: c.from,
            vi, levels, placeBook: !!placeBook });
    }
    // 대조군: 괴리가 작은 종목에서도 09:00:30에 1% 넘게 쓸리는지.
    const controls = (raw.controls || []).map(c => {
        const nx = (raw.trades[c.code]?.NX || []).filter(x => x.t >= open && x.t <= sweepEnd);
        const lo = nx.length ? Math.min(...nx.map(x => x.p)) : null, hi = nx.length ? Math.max(...nx.map(x => x.p)) : null;
        return { code: c.code, name: c.name, gap: c.gap, pre: c.nxtPre, lowVsPre: lo && c.nxtPre ? lo / c.nxtPre - 1 : null, highVsPre: hi && c.nxtPre ? hi / c.nxtPre - 1 : null };
    });
    // 수렴 기록(전체): NXT 본장 뒤 몇 번 찍은 KRX · NXT 현재가. 두 곳 모두 그날 체결이 있는 종목만 비교한다.
    const gapOf = r => r && r.j > 0 && r.n > 0 && r.jv > 0 && r.nv > 0 ? r.n / r.j - 1 : null;
    const snaps = (raw.snaps || []).map(s => {
        const gs = Object.values(s.rows).map(gapOf).filter(g => g != null).map(Math.abs).sort((a, b) => a - b);
        return { label: s.label, at: s.at, end: s.end, n: gs.length, median: gs.length ? gs[gs.length >> 1] : null, over1: gs.filter(g => g >= 0.01).length, over2: gs.filter(g => g >= 0.02).length };
    });
    const first = raw.snaps?.[0];
    const top = first ? Object.entries(first.rows).map(([code, r]) => ({ code, name: r.name, g: gapOf(r) })).filter(x => x.g != null)
        .sort((a, b) => Math.abs(b.g) - Math.abs(a.g)).slice(0, 15).map(x => ({ ...x, path: raw.snaps.map(s => gapOf(s.rows[x.code])) })) : [];
    return { rows: out, controls, snaps, top, strength: strengthStats(raw) };
}

// 체결강도와 추세(11/18 사용자 요청: "체결강도가 강하면 추세를 따라갈 확률이 높으니까 같이 분석해봐").
//  판단 09:01:00(NXT 본장 30초 뒤): 추세 = 그때 KRX 가격 ÷ KRX 시가 − 1(0.3% 미만은 추세 없음), 체결강도 = 그때까지 마지막 체결의 당일 체결강도(tday_rltv).
//  결과: 09:03 · 09:05 가격 ÷ 09:01 가격 − 1에 추세 방향을 곱한 값(양수 = 추세를 이어감). KRX는 KRX 체결강도 · 가격, NXT는 NXT 체결강도 · 가격.
//  묶음: 동조(상승 추세에 120 이상, 하락 추세에 80 이하) · 중간(80~120) · 역행(상승 추세에 80 이하, 하락 추세에 120 이상).
const STRONG = 120, WEAK = 80;
function strengthStats(raw) {
    const rows = Object.entries(raw.strength || {}).map(([code, x]) => {
        const trend = x.open > 0 && x.J?.p > 0 ? x.J.p / x.open - 1 : null, d = trend == null || Math.abs(trend) < 0.003 ? 0 : Math.sign(trend);
        const ret = (a, b) => a > 0 && b > 0 ? b / a - 1 : null;
        return { code, name: x.name, trend, d, sK: x.J?.s ?? null, sN: x.NX?.s ?? null,
            K3: ret(x.J?.p, x.J3), K5: ret(x.J?.p, x.J5), N3: ret(x.NX?.p, x.NX3), N5: ret(x.NX?.p, x.NX5) };
    });
    const group = (d, s) => s == null ? null : s > WEAK && s < STRONG ? '중간' : (d > 0) === (s >= STRONG) ? '동조' : '역행';
    const table = market => ['동조', '중간', '역행'].map(g => {
        const xs = rows.filter(r => r.d && group(r.d, market === 'KRX' ? r.sK : r.sN) === g && (market === 'KRX' ? r.K5 : r.N5) != null);
        const f3 = xs.map(r => r.d * (market === 'KRX' ? r.K3 : r.N3)).filter(v => v != null), f5 = xs.map(r => r.d * (market === 'KRX' ? r.K5 : r.N5));
        const avg = a => a.length ? a.reduce((p, v) => p + v, 0) / a.length : null;
        return { group: g, n: xs.length, keep5: xs.length ? f5.filter(v => v > 0).length / xs.length : null, back5: xs.length ? f5.filter(v => v < 0).length / xs.length : null, avg3: avg(f3), avg5: avg(f5) };
    });
    // 추세와 상관없이 KRX 체결강도 구간별 09:01→09:05 KRX 등락.
    const buckets = [[0, 80], [80, 100], [100, 120], [120, 150], [150, Infinity]].map(([lo, hi]) => {
        const xs = rows.filter(r => r.sK != null && r.sK >= lo && r.sK < hi && r.K5 != null);
        return { lo, hi, n: xs.length, up: xs.length ? xs.filter(r => r.K5 > 0).length / xs.length : null, avg5: xs.length ? xs.reduce((p, r) => p + r.K5, 0) / xs.length : null };
    });
    return { n: rows.length, trended: rows.filter(r => r.d).length, KRX: table('KRX'), NXT: table('NXT'), buckets, rows };
}

function summary(raw, res) {
    const L = [`# NXT 09:00:30 쓸림 · 수렴 기록 ${raw.day}${raw.full ? ' (전 종목 조회일)' : ''}`, ''];
    if (raw.shiftMin) L.push(`> 장이 ${raw.shiftMin}분 늦게 열린 날이라 모든 단계를 ${raw.shiftMin}분 늦춰 돌렸다. 아래 표 제목의 시각은 평소 기준이고, 기록 줄과 체결 시각은 실제 시각이다.`, '');
    L.push('## 실행', ...raw.log.filter(l => /단계|토큰|실패|늦음|후보|조회 수|예상체결|다시/.test(l)).map(l => '- ' + l), '');
    if (raw.probe?.length) {
        const first = raw.probe.find(x => x.withExp > 0), before = raw.probe.filter(p => p.at < kstAt(raw.day, shiftHms('08:50:00', raw.shiftMin))).pop();
        L.push('## KRX 예상체결 공개 시각 (30종목을 20초마다)', `- 처음 값이 나온 시각: ${first ? kstClock(first.at) + ` (${first.withExp}/${first.n}종목)` : '08:59까지 안 나옴'}`,
            `- 08:50 전 마지막 조회: ${before ? kstClock(before.at) + ` ${before.withExp}/${before.n}종목` : '—'}`, '');
    }
    if (raw.full && raw.fullStats) {
        const f = raw.fullStats;
        L.push(`## 순위 방식이 놓친 비율 (전 종목 조회일, ${f.basis} 기준)`,
            `- 괴리 1.5% 이상 종목 ${f.gapCount}개 중 순위에 든 종목 ${f.inRank}개, 순위 또는 전일 NXT VI에 든 종목 ${f.inRankOrVi}개`);
        const swept = res.rows.filter(r => r.levels.some(l => !l.basis.startsWith('KRX') && l.k >= 0.02 && l.filled));
        L.push(`- 2% 이상 가상 체결이 난 종목 ${swept.length}개 중 순위에 든 종목 ${swept.filter(r => r.inRank).length}개`, '');
    }
    if (res.snaps?.length) {
        L.push('## 수렴 기록 (NXT 본장 09:00:30 뒤, |NXT ÷ KRX − 1|, 두 시장 모두 체결 있는 종목)', '', '| 찍은 때 | 조회 시각 | 비교 종목 | 중앙값 | 1% 이상 | 2% 이상 |', '|---|---|---|---|---|---|');
        for (const s of res.snaps) L.push(`| ${s.label} | ${kstClock(s.at)}~${kstClock(s.end)} | ${s.n} | ${pct(s.median)} | ${s.over1} | ${s.over2} |`);
        if (res.top.length) {
            L.push('', `### ${res.snaps[0].label} 괴리 큰 종목의 변화 (NXT ÷ KRX − 1)`, '', '| 종목 | ' + res.snaps.map(s => s.label).join(' | ') + ' |', '|---|' + res.snaps.map(() => '---|').join(''));
            for (const t of res.top) L.push(`| ${t.name}(${t.code}) | ${t.path.map(pct).join(' | ')} |`);
        }
        L.push('');
    }
    const withOpen = res.rows.filter(r => r.krxOpenAt);
    if (withOpen.length) {
        const openRef = kstAt(raw.day, shiftHms('09:00:30', raw.shiftMin));
        L.push('## 후보별 수렴 (09:00:30~09:01:30 NXT 체결마다 KRX 직전 체결과 비교)', '',
            `- KRX 첫 체결(시가)이 NXT 본장 시작 전에 나온 종목 ${withOpen.filter(r => r.krxOpenAt < openRef).length}/${withOpen.length}` +
            ` · 시가 체결이 체결 목록에서 빠진 종목 ${withOpen.filter(r => r.openMissing).length}(시가는 시세의 시가를 씀)`, '',
            '| 종목 | 뽑힌 때 | KRX 시가(시각) | NXT 첫 체결 | 첫 괴리 | 최대 괴리(시각) | 0.5% 안까지(초) |', '|---|---|---|---|---|---|---|');
        for (const r of res.rows) { const v = r.converge || {}; L.push(`| ${r.name}(${r.code}) | ${r.from || '08:48'} | ${r.krxOpen?.toLocaleString() ?? '—'}${r.krxOpenAt ? '(' + kstClock(r.krxOpenAt) + ')' : ''} | ${v.firstNxAt ? kstClock(v.firstNxAt) : '—'} | ${pct(v.firstGap)} | ${pct(v.maxGap)}${v.maxAt ? '(' + kstClock(v.maxAt) + ')' : ''} | ${v.sec05 ?? (v.n ? '1분 안에 못 들어옴' : '—')} |`); }
        L.push('');
    }
    const st = res.strength;
    if (st?.n) {
        const ratio = v => v == null ? '—' : Math.round(v * 100) + '%';
        L.push('## 체결강도와 추세 (판단 09:01:00, 결과 09:03 · 09:05)', '',
            `- 표본 ${st.n}종목 중 추세(KRX 시가 대비 0.3% 이상)가 있던 종목 ${st.trended}개. 이어감 = 09:01 뒤 가격이 추세 방향으로 더 간 비율, 수익 = 추세 방향으로 잰 평균 등락.`,
            `- 동조 = 상승 추세에 체결강도 ${STRONG} 이상 · 하락 추세에 ${WEAK} 이하, 중간 = ${WEAK}~${STRONG}, 역행 = 그 반대.`, '');
        for (const m of ['KRX', 'NXT']) {
            L.push(`| ${m} 체결강도 | 종목 | 이어감(09:05) | 되돌림(09:05) | 평균 09:03 | 평균 09:05 |`, '|---|---|---|---|---|---|');
            for (const g of st[m]) L.push(`| ${g.group} | ${g.n} | ${ratio(g.keep5)} | ${ratio(g.back5)} | ${pct(g.avg3)} | ${pct(g.avg5)} |`);
            L.push('');
        }
        L.push('| KRX 체결강도(09:01) | 종목 | 09:05까지 오른 비율 | 평균 09:01→09:05 |', '|---|---|---|---|');
        for (const b of st.buckets) L.push(`| ${b.lo}${b.hi === Infinity ? ' 이상' : '~' + b.hi} | ${b.n} | ${ratio(b.up)} | ${pct(b.avg5)} |`);
        L.push('');
    }
    L.push('## 후보별 결과', '', '| 종목 | 뽑힌 때 | 방향(시가 기준) | 08:48 괴리(기준) | 08:59 괴리 | NXT 프리 | KRX 예상(08:48→08:59) | KRX 시가 | 쓸림 깊이(시가 대비) | 회복(초) | VI | 순위 |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of res.rows) L.push(`| ${r.name}(${r.code}) | ${r.from || '08:48'} | ${r.side === 'buy' ? 'NXT 매도 쓸림 → 매수' : 'NXT 매수 쓸림 → 매도'} | ${pct(r.gap)}(${r.basis}) | ${pct(r.gap0859)} | ${r.nxtPre?.toLocaleString() ?? '—'} | ${r.krxExp?.toLocaleString() ?? '—'}→${r.krxExp0859?.toLocaleString() ?? '—'} | ${r.krxOpen?.toLocaleString() ?? '—'} | ${pct(r.depth)} | ${r.recoverSec ?? '—'} | ${r.vi.map(v => v.exchange + ' ' + kstClock(v.startedAt || v.releasedAt) + (v.releasedAt ? '~' + kstClock(v.releasedAt) : '') + (v.releasePrice ? ' 해제가 ' + v.releasePrice.toLocaleString() : '')).join(', ') || '—'} | ${r.inRank ? '○' : '×'} |`);
    L.push('', '- 쓸림 깊이 = 쓸린 쪽 NXT 최저(매수) · 최고(매도) ÷ KRX 시가 − 1. 매수 쪽 양수 · 매도 쪽 음수는 NXT가 KRX 시가까지 오지 않았다는 뜻이다.');
    L.push('', '## 가상 체결 (100만원, 수수료 · 세금 0.2% 뺌)', '', '| 종목 | 기준 | 폭 | 주문가 | 체결 | 순서 | 즉시 KRX 묶기 | 09:01 | 09:03 | 09:05 | 판정 |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of res.rows) for (const l of r.levels.filter(l => l.filled)) L.push(`| ${r.name} | ${l.basis} | ${l.side === 'buy' ? '−' : '+'}${l.k * 100}% | ${l.price.toLocaleString()} | ${kstClock(l.filledAt)} | ${l.queue} | ${l.hedge ? pct(l.hedge.pnl) + (l.hedge.enough ? '' : ' (수량 부족)') : '—'} | ${pct(l.hold?.['09:01:00'])} | ${pct(l.hold?.['09:03:00'])} | ${pct(l.hold?.['09:05:00'])} | ${l.verdict} |`);
    const feasible = res.rows.flatMap(r => r.levels.filter(l => l.basis.startsWith('08:48') && l.filled && l.verdict.startsWith('가능')).map(l => ({ r, l })));
    L.push('', `- 08:48 기준으로 실제 가능했던 가상 체결 ${feasible.length}건` + (feasible.length ? ', 즉시 묶기 평균 ' + pct(feasible.filter(x => x.l.hedge).reduce((s, x, _, a) => s + x.l.hedge.pnl / a.length, 0)) : ''));
    L.push('', '## 대조군 (괴리 작은 NXT 종목의 09:00:30~09:01:30 프리 대비 최저 · 최고)', '', '| 종목 | 괴리 | 최저 | 최고 |', '|---|---|---|---|');
    for (const c of res.controls) L.push(`| ${c.name}(${c.code}) | ${pct(c.gap)} | ${pct(c.lowVsPre)} | ${pct(c.highVsPre)} |`);
    return L.join('\n') + '\n';
}

// ---- 실행
function createRunner({ day, full = false, http, env = process.env, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), schedule = true, dir, gapMs = 340, loadCodes, dataRoot = path.join(root, 'data'), shift = 0,
    universeFile = path.join(root, 'outputs', 'nxt-open-sweep', 'universe.json') } = {}) {
    // 모든 단계 시각은 평소 기준으로 적고 shift분 늦춘다(수능일 60).
    const A = hms => kstAt(day, shiftHms(hms, shift)), H = hms => shiftHms(hms, shift);
    const raw = { day, full, shiftMin: shift, log: [], s1: { J: {}, NX: {}, books: {} }, s2: { J: {}, books: {} }, s3: { J: {}, NX: {} }, trades: {}, candidates: [], controls: [], vi: [] };
    const log = msg => { const line = `${kstClock(now())} ${msg}`; raw.log.push(line); if (dir) fs.appendFileSync(path.join(dir, 'log.txt'), line + '\n'); };
    const domain = String(env.EFRIEND_DOMAIN || '').trim(), appkey = String(env.EFRIEND_APPKEY || '').trim(), appsecret = String(env.EFRIEND_SECRETKEY || '').trim();
    const tokenFile = path.join(dataRoot, 'kis-token', 'token.json');
    const owner = crypto.createHash('sha256').update(domain + '|' + appkey).digest('hex').slice(0, 16);
    let token = null, issued = false, calls = 0, last = 0;
    async function issue(reason) {
        const r = await http.post(domain + '/oauth2/tokenP', { grant_type: 'client_credentials', appkey, appsecret }, { headers: { 'Content-Type': 'application/json; charset=UTF-8' }, timeout: 8000 });
        if (!r.data?.access_token) throw Error('한투 토큰 발급 응답에 access_token 없음');
        const at = now(), expires = at + (Number(r.data.expires_in) || 86400) * 1000;
        token = r.data.access_token; issued = true;
        // 서버와 같은 형식 · 파일이라 로컬 서버도 이 토큰을 다시 쓴다.
        fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
        fs.writeFileSync(tokenFile + '.tmp', JSON.stringify({ owner, token, expires, issuedAt: at }), { mode: 0o600 }); fs.renameSync(tokenFile + '.tmp', tokenFile);
        log(`토큰 새로 발급 (${reason}) · data/kis-token/token.json에 저장`);
    }
    async function getToken() {
        if (token) return token;
        try { const s = JSON.parse(fs.readFileSync(tokenFile, 'utf8')); if (s.owner === owner && s.token && s.expires > now() + 300000) return token = s.token; } catch {}
        await issue('저장된 토큰 없음 또는 만료'); return token;
    }
    async function get(p, tr, params) {
        const wait = last + gapMs - now(); if (wait > 0) await sleep(wait);
        last = now(); calls++;
        const call = async () => http.get(domain + p, { params, headers: { authorization: 'Bearer ' + await getToken(), appkey, appsecret, tr_id: tr, custtype: 'P' }, timeout: 8000 });
        let r;
        try { r = await call(); } catch (e) {
            const code = e.response?.data?.msg_cd;
            if (!issued && ['EGW00121', 'EGW00123'].includes(code)) { token = null; await issue('토큰 거부 ' + code); r = await call(); }
            // 연결 끊김 · 초당 건수 초과(11/17 각 1번): 1초 뒤 한 번만 다시.
            else if (!e.response || code === 'EGW00201' || /초당/.test(String(e.response?.data?.msg1 || ''))) {
                log(`${tr} 1초 뒤 다시 조회 (${e.response?.status || ''} ${String(e.response?.data?.msg1 || e.message).slice(0, 40)})`);
                await sleep(1000); last = now(); calls++; r = await call();
            } else throw e;
        }
        if (String(r.data?.rt_cd) !== '0') throw Error(`${tr} ${r.data?.msg_cd || ''} ${String(r.data?.msg1 || '').slice(0, 60)}`);
        return { data: r.data, headers: r.headers };
    }
    const safe = async (label, f) => { try { return await f(); } catch (e) { log(`${label} 실패: ${e.response?.status || ''} ${String(e.response?.data?.msg1 || e.message).slice(0, 80)}`); return null; } };
    async function until(hms, label) {
        const t = A(hms);
        if (!schedule) return true;
        if (now() > t + 20000) { log(`${label} 늦음: 예정 ${H(hms)}, 지금 ${kstClock(now())}`); }
        while (now() < t) await sleep(Math.min(1000, t - now()));
        return true;
    }
    async function multi(market, codes, into) {
        for (let i = 0; i < codes.length; i += 30) {
            const params = {};
            codes.slice(i, i + 30).forEach((c, n) => { params['FID_COND_MRKT_DIV_CODE_' + (n + 1)] = market; params['FID_INPUT_ISCD_' + (n + 1)] = c; });
            const r = await safe(`멀티 시세 ${market} ${i}`, () => get('/uapi/domestic-stock/v1/quotations/intstock-multprice', 'FHKST11300006', params));
            const at = now();
            for (const o of r?.data?.output || []) { const q = quoteOf(o, market, at); if (q.code) into[q.code] = q; }
        }
    }
    async function bookOf(code) {
        const r = await safe(`NX 호가 ${code}`, () => get('/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn', 'FHKST01010200', { FID_COND_MRKT_DIV_CODE: 'NX', FID_INPUT_ISCD: code }));
        const o = r?.data?.output1; if (!o) return null;
        const lv = s => Array.from({ length: 10 }, (_, i) => ({ p: num(o[s + 'p' + (i + 1)]), q: num(o[s + 'p_rsqn' + (i + 1)]) })).filter(l => l.p > 0);
        return { at: now(), hour: o.aspr_acpt_hour, bids: lv('bid'), asks: lv('ask') };
    }
    // 그 시각 이전 체결 30건씩 거꾸로. from~to(HHMMSS) 안만 남긴다.
    // 구간을 나눠 받은 체결을 합친다(acml_vol이 같은 초 안의 순서).
    const merge = (...lists) => [...new Map(lists.flat().map(x => [x.v + ':' + x.t + ':' + x.p, x])).values()].sort((a, b) => a.v - b.v);
    async function trades(market, code, from, to, maxPages) {
        const rows = new Map(); let hour = to, truncated = false;
        for (let k = 0; k < maxPages; k++) {
            const r = await safe(`체결 ${market} ${code}`, () => get('/uapi/domestic-stock/v1/quotations/inquire-time-itemconclusion', 'FHPST01060000', { FID_COND_MRKT_DIV_CODE: market, FID_INPUT_ISCD: code, FID_INPUT_HOUR_1: hour }));
            const list = r?.data?.output2 || []; const before = rows.size;
            list.forEach(x => rows.set(x.stck_cntg_hour + ':' + x.stck_prpr + ':' + x.cnqn + ':' + x.acml_vol, x));
            if (!list.length) break;
            const min = list.map(x => x.stck_cntg_hour).sort()[0];
            if (min < from || list.length < 30) break;
            if (k === maxPages - 1) truncated = true;
            const s = +min.slice(0, 2) * 3600 + +min.slice(2, 4) * 60 + +min.slice(4, 6) - 1;
            hour = rows.size === before || hour === min ? [s / 3600 | 0, (s / 60 | 0) % 60, s % 60].map(x => String(x).padStart(2, '0')).join('') : min;
        }
        const list = [...rows.values()].filter(x => x.stck_cntg_hour >= from && x.stck_cntg_hour <= to)
            .map(x => ({ t: kstAt(day, `${x.stck_cntg_hour.slice(0, 2)}:${x.stck_cntg_hour.slice(2, 4)}:${x.stck_cntg_hour.slice(4, 6)}`), p: num(x.stck_prpr), q: num(x.cnqn), v: num(x.acml_vol), s: num(x.tday_rltv) }))
            .sort((a, b) => a.v - b.v);
        if (truncated && maxPages > 1) log(`체결 ${market} ${code} ${from}~${to} 조회 수 한도(${maxPages}쪽)로 앞부분 빠짐`);
        return list;
    }
    const rankParams = {
        expUp: ['/uapi/domestic-stock/v1/ranking/exp-trans-updown', 'FHPST01820000', { fid_rank_sort_cls_code: '0', fid_cond_mrkt_div_code: 'J', fid_cond_scr_div_code: '20182', fid_input_iscd: '0000', fid_div_cls_code: '0', fid_aply_rang_prc_1: '', fid_vol_cnt: '', fid_pbmn: '', fid_blng_cls_code: '0', fid_mkop_cls_code: '0' }],
        nxtUp: ['/uapi/domestic-stock/v1/ranking/fluctuation', 'FHPST01700000', { fid_cond_mrkt_div_code: 'NX', fid_cond_scr_div_code: '20170', fid_input_iscd: '0000', fid_rank_sort_cls_code: '0', fid_input_cnt_1: '0', fid_prc_cls_code: '1', fid_input_price_1: '', fid_input_price_2: '', fid_vol_cnt: '', fid_trgt_cls_code: '0', fid_trgt_exls_cls_code: '0', fid_div_cls_code: '0', fid_rsfl_rate1: '', fid_rsfl_rate2: '' }],
        nxtAmount: ['/uapi/domestic-stock/v1/quotations/volume-rank', 'FHPST01710000', { FID_COND_MRKT_DIV_CODE: 'NX', FID_COND_SCR_DIV_CODE: '20171', FID_INPUT_ISCD: '0000', FID_DIV_CLS_CODE: '0', FID_BLNG_CLS_CODE: '3', FID_TRGT_CLS_CODE: '111111111', FID_TRGT_EXLS_CLS_CODE: '0000000000', FID_INPUT_PRICE_1: '', FID_INPUT_PRICE_2: '', FID_VOL_CNT: '', FID_INPUT_DATE_1: '' }]
    };
    rankParams.expDown = [rankParams.expUp[0], rankParams.expUp[1], { ...rankParams.expUp[2], fid_rank_sort_cls_code: '3' }];
    rankParams.nxtDown = [rankParams.nxtUp[0], rankParams.nxtUp[1], { ...rankParams.nxtUp[2], fid_rank_sort_cls_code: '1' }];
    function prevViCodes() {
        const dirDays = path.join(dataRoot, 'vi-monitor', 'days');
        try {
            const f = fs.readdirSync(dirDays).filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n) && n < day + '.json').sort().pop();
            if (!f) return { day: null, codes: [] };
            const rows = JSON.parse(fs.readFileSync(path.join(dirDays, f), 'utf8')).rows || [];
            // NXT에서 발동한 종목만(11/17: 주식 전체 827종목이라 조회가 무거웠다).
            return { day: f.slice(0, 10), codes: [...new Set(rows.filter(r => r.exchange === 'NXT' && /^[0-9A-Z]{6}$/.test(r.code)).map(r => r.code))] };
        } catch { return { day: null, codes: [] }; }
    }
    async function run() {
        log(`시작 (${full ? '전 종목 조회일' : '순위 방식'}${shift ? `, 모든 단계 ${shift}분 늦춤` : ''})`);
        if (!domain || !appkey || !appsecret) { log('실패: 한투 키 없음'); return raw; }
        await safe('토큰', getToken);
        const master = full ? await safe('종목 마스터', () => loadCodes()) : null;
        const prev = prevViCodes();
        // 전 종목(약 4,000)을 08:48에 J · NX로 다 부르면 270건 · 90초가 걸려 08:50 전에 못 끝난다(11/17 시험).
        // 그래서 08:46:30에 NX만 한 번 불러 NXT에서 거래하는 종목(현재가 > 0)만 남긴다.
        // KRX 예상체결이 몇 시부터 나오는지(11/17 08:48에는 비어 있었고 08:59에는 있었다). 08:30부터 20초마다 30종목.
        const probeCodes = [...new Set(['005930', '000660', '373220', '207940', '005380', '000270', '068270', '105560', '035420', '012450', ...prev.codes])].slice(0, 30);
        raw.probe = [];
        const probe = async endHms => {
            const end = A(endHms);
            while (schedule && now() < end) {
                if (now() >= A('08:30:00')) {
                    const got = {}; await multi('J', probeCodes, got);
                    const list = Object.values(got), withExp = list.filter(q => q.exp > 0).length;
                    raw.probe.push({ at: now(), n: list.length, withExp, hourCls: [...new Set(list.map(q => q.hourCls))].join('') });
                    if (withExp && raw.probe.filter(x => x.withExp).length === 1) log(`KRX 예상체결 처음 나옴 ${kstClock(now())} (${withExp}/${list.length}종목)`);
                }
                const nextAt = Math.min(end, now() + 20000); while (now() < nextAt) await sleep(Math.min(1000, nextAt - now()));
            }
        };
        let universe = null;
        if (master?.length) {
            await probe('08:46:20');
            await until('08:46:30', '전 종목 NXT 거래 여부 조회');
            const t0 = now(), c0 = calls, nx = {};
            await multi('NX', master, nx);
            universe = Object.values(nx).filter(q => q.price > 0).map(q => q.code);
            log(`전 종목 NXT 거래 여부 조회: 마스터 ${master.length}종목 중 NXT 거래 ${universe.length}종목 (${((now() - t0) / 1000).toFixed(1)}초, 조회 수 ${calls - c0})`);
            // 다른 날(순위 방식 · 프리마켓 없는 날)의 수렴 기록에 쓴다.
            if (universe.length > 100 && universeFile) try { fs.mkdirSync(path.dirname(universeFile), { recursive: true }); fs.writeFileSync(universeFile, JSON.stringify({ day, codes: universe })); } catch (e) { log('NXT 거래 종목 목록 저장 실패: ' + e.message); }
        } else if (universeFile) {
            try { const u = JSON.parse(fs.readFileSync(universeFile, 'utf8')); if (u.day < day && u.codes?.length) { universe = u.codes; log(`NXT 거래 종목 목록 ${u.codes.length}종목(${u.day} 전 종목 조회) 사용`); } } catch {}
        }
        await probe('08:47:45');
        await until('08:48:00', '① 배치 전 조회');
        const t1 = now(), callsAt1 = calls;
        log('① 배치 전 조회 단계 시작');
        const rank = {};
        for (const [k, [p, tr, params]] of Object.entries(rankParams)) {
            const r = await safe('순위 ' + k, () => get(p, tr, params));
            rank[k] = (r?.data?.output || []).map(o => ({ code: String(o.stck_shrn_iscd || o.mksc_shrn_iscd || '').trim(), name: o.hts_kor_isnm, price: num(o.stck_prpr), rate: num(o.prdy_ctrt), amount: num(o.acml_tr_pbmn) })).filter(x => x.code);
        }
        raw.rank = rank; raw.prevVi = prev;
        // 놓친 비율은 순위만으로 잰다. 전일 NXT VI 종목은 조회에는 넣고 따로 센다.
        const rankSet = new Set(Object.values(rank).flat().map(x => x.code)), viSet = new Set(prev.codes);
        const codes = [...new Set([...(universe || []), ...rankSet, ...viSet])];
        log(`① 조회 대상 ${codes.length}종목 (순위 ${rankSet.size}, 전일 NXT VI ${viSet.size}${universe ? ', NXT 거래 전 종목 ' + universe.length : ''})`);
        await multi('J', codes, raw.s1.J);
        await multi('NX', codes, raw.s1.NX);
        // KRX 예상가가 없으면(08:48에 아직 안 나옴) 전일 종가와 비교한다(요약에 기준을 함께 적는다).
        const gaps = codes.map(code => {
            const j = raw.s1.J[code], n = raw.s1.NX[code], ref = j?.exp > 0 ? j.exp : j?.prev;
            if (!(ref > 0) || !(n?.price > 0) || !(n.vol > 0)) return null;
            return { code, name: n.name || j.name, krxExp: j.exp, prev: j.prev, krxAt: j.at, nxtPre: n.price, nxtVol: n.vol, nxtAmount: n.amount, gap: n.price / ref - 1,
                inRank: rankSet.has(code), inPrevVi: viSet.has(code), from: '08:48' };
        }).filter(Boolean);
        const withExp = gaps.filter(g => g.krxExp > 0).length;
        if (!gaps.length) log('프리마켓 체결 종목 없음(프리마켓을 열지 않은 날) → 쓸림 후보 없이 수렴만 기록');
        else log(`08:48 KRX 예상체결 있는 종목 ${withExp}/${gaps.length}` + (withExp ? '' : ' → 전일 종가 기준으로 후보를 고름'));
        const big = gaps.filter(g => Math.abs(g.gap) >= 0.015).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
        raw.candidates = big.slice(0, 25);
        log(`후보 ${raw.candidates.length}개 (괴리 1.5% 이상 ${big.length}개, 비교 가능 ${gaps.length}개) · 시세 조회 끝 ${kstClock(now())} (${((now() - t1) / 1000).toFixed(1)}초, 조회 수 ${calls - callsAt1})`);
        // 대조군: 괴리 0.5% 미만, NXT 거래 있는 종목 중 20개(날짜로 고정한 무작위).
        const seed = [...day].reduce((s, c) => s * 31 + c.charCodeAt(0) >>> 0, 7);
        raw.controls = gaps.filter(g => Math.abs(g.gap) < 0.005).map(g => ({ ...g, h: crypto.createHash('md5').update(seed + g.code).digest('hex') })).sort((a, b) => a.h.localeCompare(b.h)).slice(0, 20);
        for (const c of raw.candidates) { if (now() >= A('08:49:50') && schedule) { log('① 호가 조회 08:49:50에 멈춤'); break; } const b = await bookOf(c.code); if (b) raw.s1.books[c.code] = b; }
        log(`① 배치 전 조회 단계 끝 ${kstClock(now())} · NXT 호가 ${Object.keys(raw.s1.books).length}종목`);
        save();
        await probe('08:59:00');
        await until('08:59:10', '② 휴장 중 조회');
        log('② 휴장 중 조회 단계 시작');
        // 프리마켓에서 거래된 종목 전부의 KRX 예상가(08:59)로 실제 괴리가 큰 종목을 후보에 더한다(최대 25, 주문은 못 하는 참고용).
        await multi('J', gaps.map(g => g.code), raw.s2.J);
        const gaps2 = gaps.map(g => ({ ...g, gap2: raw.s2.J[g.code]?.exp > 0 ? g.nxtPre / raw.s2.J[g.code].exp - 1 : null })).filter(g => g.gap2 != null);
        const big2 = gaps2.filter(g => Math.abs(g.gap2) >= 0.015).sort((a, b) => Math.abs(b.gap2) - Math.abs(a.gap2));
        const have = new Set(raw.candidates.map(c => c.code));
        const added = big2.filter(g => !have.has(g.code)).slice(0, 25).map(({ gap2, ...g }) => ({ ...g, from: '08:59' }));
        raw.candidates.push(...added);
        if (full) raw.fullStats = { basis: '08:59 예상가', gapCount: big2.length, inRank: big2.filter(g => g.inRank).length, inRankOrVi: big2.filter(g => g.inRank || g.inPrevVi).length, compared: gaps2.length };
        log(`08:59 예상가로 괴리 1.5% 이상 ${big2.length}개 (예상가 있는 종목 ${gaps2.length}/${gaps.length}), 후보에 ${added.length}개 더함`);
        const cand = raw.candidates.map(c => c.code);
        for (const code of cand) { if (now() >= A('09:00:28') && schedule) { log('② 호가 조회 09:00:28에 멈춤'); break; } const b = await bookOf(code); if (b) raw.s2.books[code] = b; }
        log(`② 휴장 중 조회 단계 끝 ${kstClock(now())} · NXT 호가 ${Object.keys(raw.s2.books).length}종목`);
        // ③ 수렴 기록: NXT 본장(09:00:30) 뒤 KRX · NXT 현재가를 30종목씩 번갈아 받는다(같은 종목은 1초 안).
        // 11/18: 09:00:30에 NXT가 KRX 시가를 지나쳐 쓸리지 않고 프리 가격과 KRX 시가 사이에 머물렀다 → 따라가는 폭 · 시간을 잰다.
        raw.snaps = [];
        for (const hms of ['09:00:31', '09:01:00', '09:01:30', '09:03:00', '09:05:00']) {
            await until(hms, '③ 수렴 기록 ' + hms);
            const snap = { label: hms, at: now(), rows: {} };
            for (let i = 0; i < codes.length; i += 30) {
                const part = codes.slice(i, i + 30), j = {}, n = {};
                await multi('J', part, j); await multi('NX', part, n);
                for (const c of part) if (j[c] || n[c]) snap.rows[c] = { name: j[c]?.name || n[c]?.name, prev: j[c]?.prev ?? null, o: j[c]?.open ?? null, j: j[c]?.price ?? null, jv: j[c]?.vol ?? null, n: n[c]?.price ?? null, nv: n[c]?.vol ?? null };
            }
            snap.end = now();
            raw.snaps.push(snap);
            if (hms === '09:00:31') {
                // 첫 괴리가 큰 종목(두 시장 모두 체결)을 체결 조회 후보로 더한다(최대 15).
                const have = new Set(raw.candidates.map(c => c.code));
                const conv = Object.entries(snap.rows).filter(([c, r]) => !have.has(c) && r.j > 0 && r.n > 0 && r.jv > 0 && r.nv > 0).map(([code, r]) => ({ code, name: r.name, prev: r.prev, convGap: r.n / r.j - 1, from: '09:00:31' }))
                    .filter(x => Math.abs(x.convGap) >= 0.005).sort((a, b) => Math.abs(b.convGap) - Math.abs(a.convGap)).slice(0, 15);
                raw.candidates.push(...conv);
                for (const { code: c } of raw.candidates) if (snap.rows[c]) raw.s3.J[c] = { price: snap.rows[c].j, prev: snap.rows[c].prev, open: snap.rows[c].o };
                log(`③ 수렴 첫 조회 ${kstClock(snap.at)}~${kstClock(snap.end)} ${Object.keys(snap.rows).length}종목, 괴리 0.5% 이상 후보 ${conv.length}개 더함`);
            }
            save();
        }
        log(`③ 수렴 기록 단계 끝 ${kstClock(now())}`);
        await until('09:05:30', '④ 체결 조회');
        log('④ 체결 조회 단계 시작');
        for (const c of raw.candidates) {
            const t = raw.trades[c.code] = { at: {} };
            // 거꾸로 받으므로 체결이 몰리는 09:00:30~09:00:40을 따로 먼저 받는다(한도에 걸려도 쓸림 순간은 남는다).
            // 11/18: 거래 많은 종목은 09:00:40~09:01:30 20쪽 한도에 걸려 나눠 받는다. 프리마켓 가격이 없는 후보는 프리 구간을 건너뛴다.
            t.NX = merge(c.nxtPre > 0 ? await trades('NX', c.code, H('084800'), H('085000'), 10) : [], await trades('NX', c.code, H('090030'), H('090040'), 20),
                await trades('NX', c.code, H('090040'), H('090100'), 20), await trades('NX', c.code, H('090100'), H('090130'), 20));
            for (const hm of ['09:01:00', '09:03:00', '09:05:00']) { const x = await trades('NX', c.code, H('085000'), H(hm.replaceAll(':', '')), 1); t.at[hm] = x.length ? x[x.length - 1].p : null; }
            // KRX 시가 = 09:00 이후 첫 체결(분석에서 고른다). 09:00:00~01 전용 조회는 11/18에 2/47만 맞아 뺐다.
            t.J = merge(await trades('J', c.code, H('090000'), H('090045'), 25), await trades('J', c.code, H('090045'), H('090130'), 15));
        }
        for (const c of raw.controls) raw.trades[c.code] = { NX: await trades('NX', c.code, H('090030'), H('090130'), 10) };
        // 체결강도 표본: 후보 + 09:01 수렴 기록에서 KRX가 시가 대비 0.3% 이상 움직인 종목 중 큰 순 200. 종목당 KRX · NXT 1번씩(09:01:00 전 마지막 체결).
        const sn1 = raw.snaps?.[1], sn3 = raw.snaps?.[3], sn4 = raw.snaps?.[4];
        if (sn1) {
            const pick = Object.entries(sn1.rows).map(([code, r]) => ({ code, tr: r.o > 0 && r.j > 0 && r.jv > 0 ? r.j / r.o - 1 : null }))
                .filter(x => x.tr != null && Math.abs(x.tr) >= 0.003).sort((a, b) => Math.abs(b.tr) - Math.abs(a.tr)).slice(0, 200).map(x => x.code);
            const list = [...new Set([...raw.candidates.map(c => c.code), ...pick])];
            raw.strength = {};
            const lastBefore = async (m, code) => { const l = await trades(m, code, H('085000'), H('090100'), 1); const x = l[l.length - 1]; return x ? { p: x.p, s: x.s, t: x.t } : null; };
            for (const code of list) {
                const r1 = sn1.rows[code] || raw.snaps[0].rows[code] || {};
                raw.strength[code] = { name: r1.name, open: r1.o ?? null, J: await lastBefore('J', code), NX: await lastBefore('NX', code),
                    J3: sn3?.rows[code]?.j ?? null, J5: sn4?.rows[code]?.j ?? null, NX3: sn3?.rows[code]?.n ?? null, NX5: sn4?.rows[code]?.n ?? null };
            }
            log(`체결강도 표본 ${list.length}종목 (후보 + 09:01 KRX 시가 대비 0.3% 이상 움직인 종목 ${pick.length}) · 끝 ${kstClock(now())}`);
        }
        log(`④ 체결 조회 단계 끝 ${kstClock(now())} · 총 조회 수 ${calls}`);
        // VI 창 기록(로컬 서버가 그날 쓴 state.json).
        try {
            const s = JSON.parse(fs.readFileSync(path.join(dataRoot, 'vi-monitor', 'state.json'), 'utf8'));
            const from = A('09:00:00'), to = A('09:06:00'), want = new Set(raw.candidates.map(c => c.code));
            if (s.day !== day) log(`VI 기록 없음 (state.json 날짜 ${s.day})`);
            else raw.vi = (s.rows || []).filter(r => want.has(r.code) && r.exchange !== 'FUT' && ((r.startedAt ?? r.releasedAt) >= from && (r.startedAt ?? r.releasedAt) <= to))
                .map(r => ({ code: r.code, exchange: r.exchange, kind: r.kind, direction: r.direction, startedAt: r.startedAt, releasedAt: r.releasedAt, releasePrice: r.atRelease?.basePrice ?? null }));
        } catch (e) { log('VI 기록 읽기 실패: ' + e.message); }
        save();
        return raw;
    }
    function save() { if (dir) { fs.writeFileSync(path.join(dir, 'raw.json.tmp'), JSON.stringify(raw)); fs.renameSync(path.join(dir, 'raw.json.tmp'), path.join(dir, 'raw.json')); } }
    return { run, raw, trades, merge, multi, bookOf, getToken };
}

// 전 종목: KIS 종목 마스터(코스피 · 코스닥) 전체 코드(대주 표시와 관계없이).
async function loadAllCodes(http) {
    const { readMasterZip } = require(path.join(root, 'lendable-stocks.js'));
    const codes = [];
    for (const market of ['kospi', 'kosdaq']) {
        const r = await http.get(`https://new.real.download.dws.co.kr/common/master/${market}_code.mst.zip`, { responseType: 'arraybuffer', timeout: 15000, params: { _t: Date.now() } });
        for (const line of readMasterZip(r.data, `${market}_code.mst`).toString('latin1').split('\n')) { const c = line.slice(0, 9).trim(); if (/^[0-9A-Z]{6}$/.test(c)) codes.push(c); }
    }
    return codes;
}

module.exports = { tick, roundTick, quoteOf, analyze, summary, createRunner, shiftHms };

if (require.main === module) {
    require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
    const [cmd, day] = process.argv.slice(2), full = process.argv.includes('--full');
    const si = process.argv.indexOf('--shift'), shift = si > 0 ? Number(process.argv[si + 1]) || 0 : 0;
    const dir = path.join(root, 'outputs', 'nxt-open-sweep', day || 'x');
    const finish = () => {
        const i = process.argv.indexOf('--delete-task'), name = i > 0 ? process.argv[i + 1] : '';
        if (/^MarketThrough-[\w-]+$/.test(name || '')) try { require('node:child_process').execFileSync('schtasks', ['/delete', '/tn', name, '/f'], { stdio: 'ignore' }); } catch {}
    };
    (async () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !['run', 'analyze'].includes(cmd)) throw Error('사용법: node dev/nxt-open-sweep.cjs run|analyze YYYY-MM-DD [--full] [--shift 분]');
        fs.mkdirSync(dir, { recursive: true });
        let raw;
        if (cmd === 'run') {
            const axios = require('axios');
            raw = await createRunner({ day, full, shift, http: axios, dir, loadCodes: () => loadAllCodes(axios) }).run();
        } else raw = JSON.parse(fs.readFileSync(path.join(dir, 'raw.json'), 'utf8'));
        const res = analyze(raw);
        fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(res, null, 1));
        fs.writeFileSync(path.join(dir, 'summary.md'), summary(raw, res));
        console.log(path.join(dir, 'summary.md'));
    })().catch(e => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'log.txt'), `${kstClock(Date.now())} 실패: ${e.stack || e.message}\n`); console.error(e); process.exitCode = 1; }).finally(finish);
}
