// 2026-11-17: NXT 09:00:30 쓸림 기록(dev/nxt-open-sweep.cjs). 한투를 흉내 낸 응답과 가짜 시계로 하루 흐름을 돌린다.
//  - 토큰 파일이 없으면 새로 발급해 서버와 같은 형식으로 저장하고 기록에 남긴다. 다음 실행은 그 파일을 다시 쓴다.
//  - 08:48 조회 결과(KRX 예상체결 · NXT 프리마켓)로 후보를 고르고, 휴장 중 호가의 같은 가격 잔량을 내 앞 순서로 본다.
//  - 08:50 전에 이미 그 가격에 체결된 주문 · 사후 기준(KRX 시가)은 "실제로는 불가", 매도 쪽은 "보유자만 가능".
//  - 11/17 시험: 08:48에는 KRX 예상체결이 비어(예상 수량 0) 전일 종가가 예상가로 쓰였다. 이제 예상가 없음으로 보고 전일 종가 기준임을
//    밝히며, 08:30부터 예상체결 공개 시각을 재고, 08:59 예상가로 괴리 큰 종목을 참고 후보로 더하고, 시가는 09:00:00 첫 체결을 쓴다.
//  - 11/18 시험: NXT가 KRX 시가를 지나쳐 쓸리지 않았다 → 09:00:30 뒤 KRX · NXT 현재가를 다섯 번 찍어 수렴을 기록하고, 첫 괴리 큰 종목을
//    체결 조회 후보로 더한다. KRX 시가는 09:00 이후 첫 체결(09:00:01~09:00:30에 흩어져 나옴).
//  - 체결강도(11/18 요청): 09:01:00 KRX 추세(시가 대비)와 그때 체결강도로 09:03 · 09:05에 추세를 이어갔는지 묶어 센다. 시가는 시세의 시가를 쓴다
//    (11/18 두산은 시가 체결이 체결 목록에서 빠졌다).
//  - 11/19 수능일: 프리마켓 없이 모든 장이 1시간 늦게 연다 → --shift 60으로 단계를 늦추고, 프리 후보 없이 수렴만 기록한다.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const S = require('../nxt-open-sweep.cjs');

assert.equal(S.roundTick(1999.6, 'buy'), 1999);
assert.equal(S.roundTick(2003, 'buy'), 2000);
assert.equal(S.roundTick(49960, 'sell'), 50000);
assert.equal(S.roundTick(200050, 'buy'), 200000);
assert.equal(S.roundTick(19995, 'sell'), 20000);
assert.equal(S.shiftHms('09:00:30', 60), '10:00:30'); assert.equal(S.shiftHms('085000', 60), '095000'); assert.equal(S.shiftHms('08:48:00'), '08:48:00');
assert.equal(S.quoteOf({ inter_shrn_iscd: 'X', inter2_prdy_clpr: '10000', intr_antc_cntg_vrss: '300', intr_antc_cntg_vrss_sign: '5', intr_antc_cntg_prdy_ctrt: '3.00', intr_antc_vol: '100' }, 'J', 0).exp, 9700);
// 11/17 08:48 응답 모양(예상 대비 0, 부호 3, 예상 수량 0): 예상가가 아니다.
assert.equal(S.quoteOf({ inter_shrn_iscd: 'X', inter2_prdy_clpr: '196800', inter2_prpr: '196800', intr_antc_cntg_vrss: '0', intr_antc_cntg_vrss_sign: '3', intr_antc_cntg_prdy_ctrt: '0.00', intr_antc_vol: '0', hour_cls_code: '0' }, 'J', 0).exp, null);

const day = '2026-11-18', at = hms => Date.parse(`${day}T${hms}+09:00`);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));
fs.mkdirSync(path.join(data, 'vi-monitor', 'days'), { recursive: true });
// 전 종목 조회일에 저장된 NXT 거래 종목 목록(순위 방식 · 프리마켓 없는 날의 수렴 기록에 쓴다).
const universeFile = path.join(data, 'universe.json');
fs.writeFileSync(universeFile, JSON.stringify({ day: '2026-11-17', codes: ['666666', '777777'] }));
fs.writeFileSync(path.join(data, 'vi-monitor', 'days', '2026-11-17.json'), JSON.stringify({ rows: [{ code: '333333', exchange: 'NXT' }, { code: 'A1234F', exchange: 'FUT' }] }));
fs.writeFileSync(path.join(data, 'vi-monitor', 'state.json'), JSON.stringify({ day, rows: [{ code: '111111', exchange: 'NXT', kind: '1', direction: 'down', startedAt: at('09:00:31'), releasedAt: at('09:02:31'), atRelease: { basePrice: 9950 } }] }));
// 종목: 111111 매수 쪽(쓸림 −2.5%), 222222 매수 쪽이지만 08:49:40에 이미 −2% 가격 체결, 333333 매도 쪽(전일 VI), 444444 괴리 없음(대조군).
// 666666: 프리 괴리 +0.8%(후보 · 대조군 아님), 09:00:30 NXT +2% → 09:00:45 +1% → 09:01:10 +0.29%로 KRX 7,000에 수렴.
const J = { 111111: [10000, '0', '3'], 222222: [20000, '400', '5'], 333333: [5000, '0', '3'], 444444: [8000, '0', '3'], 555555: [3000, '0', '3'], 666666: [7000, '0', '3'], 777777: [5000, '0', '3'] };
const NX = { 111111: 10300, 222222: 20200, 333333: 4850, 444444: 8010, 555555: 0, 666666: 7056, 777777: 5040 };
// 777777: 시가 5,000 → 09:00:50 5,100(KRX 체결강도 150, NXT 130) → 09:02:50 5,200 → 09:04:50 5,250. 상승 추세 + 강한 체결강도 → 이어감.
const T = {
    'NX:111111': [['084700', 10300, 5], ['090030', 9900, 20], ['090030', 9800, 50], ['090031', 9750, 10], ['090035', 10000, 30]],
    'J:111111': [['090000', 10000, 500], ['090031', 10000, 1000]],
    'NX:222222': [['084940', 19200, 3], ['090030', 19100, 5]], 'J:222222': [['090031', 19600, 100]],
    'NX:333333': [['090030', 5150, 10], ['090031', 5200, 10]], 'J:333333': [['090031', 5000, 1000]],
    'NX:444444': [['090030', 8000, 1]],
    'NX:666666': [['090030', 7140, 10], ['090045', 7070, 10], ['090110', 7020, 10]], 'J:666666': [['090000', 7000, 100]],
    'J:777777': [['090000', 5000, 100, 100], ['090050', 5100, 10, 150], ['090250', 5200, 10, 160], ['090450', 5250, 10, 170]],
    'NX:777777': [['084700', 5040, 5, 100], ['090030', 5000, 5, 90], ['090050', 5100, 10, 130], ['090450', 5260, 10, 140]]
};
let posts = 0, clock = 0, failedOnce = false;
// 흉내 낸 하루: D 날짜, SH분 늦게 열고, noPre면 프리마켓이 없다. 체결 시각 T는 평소 기준으로 적었다.
let D = day, SH = 0, noPre = false;
const mt = hms => Date.parse(`${D}T${hms}+09:00`) + SH * 60000;
const stdNow = () => new Date(clock - SH * 60000 + 9 * 3600000).toISOString().slice(11, 19).replaceAll(':', '');
const lastT = key => { const r = (T[key] || []).filter(([h]) => h <= stdNow() && !(noPre && key.startsWith('NX') && h < '090030')); return r.length ? r[r.length - 1][1] : null; };
const http = {
    async post(url, body) { posts++; assert.match(url, /\/oauth2\/tokenP$/); assert.equal(body.grant_type, 'client_credentials'); return { data: { access_token: 'tok-new', expires_in: 86400 } }; },
    async get(url, { params, headers }) {
        assert.equal(headers.authorization, 'Bearer tok-new');
        const ok = (extra) => ({ data: { rt_cd: '0', ...extra }, headers: {} });
        switch (headers.tr_id) {
            case 'FHPST01820000': return ok({ output: params.fid_rank_sort_cls_code === '0' ? [{ stck_shrn_iscd: '111111', hts_kor_isnm: '가' }] : [] });
            case 'FHPST01700000': return ok({ output: params.fid_rank_sort_cls_code === '0' ? [{ stck_shrn_iscd: '444444', hts_kor_isnm: '라' }] : [] });
            case 'FHPST01710000': return ok({ output: [{ mksc_shrn_iscd: '222222', hts_kor_isnm: '나' }] });
            case 'FHKST11300006': {
                // 08:48 NX 시세 첫 호출은 연결이 끊긴다(11/17 socket hang up) → 1초 뒤 다시.
                if (!failedOnce && params.FID_COND_MRKT_DIV_CODE_1 === 'NX' && clock >= mt('08:48:00')) { failedOnce = true; throw Object.assign(Error('socket hang up'), { code: 'ECONNRESET' }); }
                const out = [];
                // KRX 예상체결은 08:50부터 나온다(11/17: 08:48 없음, 08:59 있음).
                const open = clock >= mt('08:50:00'), std = stdNow();
                for (let n = 1; params['FID_INPUT_ISCD_' + n]; n++) {
                    const code = params['FID_INPUT_ISCD_' + n], m = params['FID_COND_MRKT_DIV_CODE_' + n];
                    if (!J[code]) continue;
                    const [prev, vrss, sign] = J[code];
                    // 장 중 현재가 = 그 시각까지 마지막 체결(KRX 09:00부터, NXT 본장 09:00:30부터).
                    const jp = std >= '090000' ? lastT('J:' + code) : null, np = std >= '090030' ? lastT('NX:' + code) : null;
                    const nxPrice = np ?? (noPre ? 0 : NX[code]);
                    const firstJ = (T['J:' + code] || [])[0], jOpen = firstJ && std >= firstJ[0] ? firstJ[1] : 0;
                    out.push(m === 'J' ? { inter_shrn_iscd: code, inter_kor_isnm: code, inter2_prdy_clpr: String(prev), inter2_prpr: String(jp ?? prev), intr_antc_cntg_vrss: open ? vrss : '0', intr_antc_cntg_vrss_sign: open ? sign : '3', intr_antc_cntg_prdy_ctrt: '0', intr_antc_vol: open ? '100' : '0', acml_vol: jp ? '1000' : '0', inter2_oprc: String(jOpen) }
                        : { inter_shrn_iscd: code, inter_kor_isnm: code, inter2_prdy_clpr: String(prev), inter2_prpr: String(nxPrice), prdy_ctrt: '0', acml_vol: nxPrice ? '500' : '0', inter2_mxpr: String(prev * 1.3), inter2_llam: String(prev * 0.7) });
                }
                return ok({ output: out });
            }
            case 'FHKST01010200': {
                const o = { aspr_acpt_hour: '085930' };
                const bids = params.FID_INPUT_ISCD === '111111' ? [[10000, 10], [9900, 10], [9800, 30], [9700, 5], [9600, 5]] : [[4800, 100], [4700, 100]];
                const asks = params.FID_INPUT_ISCD === '333333' ? [[4900, 100], [5000, 100]] : [[10300, 10]];
                bids.forEach(([p, q], i) => { o['bidp' + (i + 1)] = String(p); o['bidp_rsqn' + (i + 1)] = String(q); });
                asks.forEach(([p, q], i) => { o['askp' + (i + 1)] = String(p); o['askp_rsqn' + (i + 1)] = String(q); });
                return ok({ output1: o });
            }
            case 'FHPST01060000': {
                let v = 0;
                const rows = (T[params.FID_COND_MRKT_DIV_CODE + ':' + params.FID_INPUT_ISCD] || []).filter(([h]) => !(noPre && params.FID_COND_MRKT_DIV_CODE === 'NX' && h < '090030'))
                    .map(([h, p, q, st]) => ({ stck_cntg_hour: S.shiftHms(h, SH), stck_prpr: String(p), cnqn: String(q), acml_vol: String(v += q), tday_rltv: st == null ? '' : String(st) }));
                return ok({ output2: rows.filter(r => r.stck_cntg_hour <= params.FID_INPUT_HOUR_1).reverse().slice(0, 30) });
            }
        }
        throw Error('unexpected ' + headers.tr_id);
    }
};
(async () => {
    clock = at('08:46:00');
    const opts = { day, http, dataRoot: data, universeFile, env: { EFRIEND_DOMAIN: 'https://kis.test', EFRIEND_APPKEY: 'k', EFRIEND_SECRETKEY: 's' }, now: () => clock, sleep: async ms => { clock += ms; } };
    const raw = await S.createRunner(opts).run();
    // 토큰: 없어서 새로 발급 → 서버와 같은 형식으로 저장, 기록에 남김.
    assert.equal(posts, 1);
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'kis-token', 'token.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved).sort(), ['expires', 'issuedAt', 'owner', 'token']);
    assert.equal(saved.token, 'tok-new');
    assert.ok(raw.log.some(l => /토큰 새로 발급/.test(l)), raw.log.join('\n'));
    // 단계 시각: 08:48 조회가 08:49:50 전에 끝나고, 휴장 중 호가는 09:00:28 전.
    assert.ok(raw.candidates.filter(c => c.from !== '09:00:31').every(c => c.krxAt >= at('08:48:00') && c.krxAt < at('08:49:50')));
    assert.ok(Object.values(raw.s2.books).every(b => b.at >= at('08:59:10') && b.at < at('09:00:28')));
    // 08:48: 예상가 없음 → 전일 종가 기준(111111 +3%, 333333 −3%). 222222(전일 종가 대비 +1%)는 08:59 예상가(19,600 대비 +3.06%)로 추가.
    assert.ok(raw.log.some(l => /NXT 거래 종목 목록 2종목\(2026-11-17 전 종목 조회\) 사용/.test(l)), raw.log.join(' / '));
    assert.ok(raw.log.some(l => /08:48 KRX 예상체결 있는 종목 0\/6 → 전일 종가 기준/.test(l)), raw.log.join(' / '));
    // 09:00:31 수렴 첫 조회에서 괴리 큰 666666(+2%)이 체결 조회 후보로 더해진다(444444는 KRX 체결이 없어 비교 안 함).
    assert.deepEqual(raw.candidates.map(c => c.code + '@' + c.from), ['111111@08:48', '333333@08:48', '222222@08:59', '666666@09:00:31']);
    assert.equal(raw.snaps.length, 5);
    assert.ok(raw.snaps[0].at >= at('09:00:31') && raw.snaps[0].end < at('09:01:00') && raw.snaps[4].at >= at('09:05:00'));
    // 예상체결 공개 시각: 08:50 전 조회는 모두 0, 처음 나온 시각이 기록된다.
    assert.ok(raw.probe.length > 20 && raw.probe.filter(x => x.at < at('08:50:00')).every(x => x.withExp === 0));
    assert.ok(raw.probe.some(x => x.withExp > 0) && raw.log.some(l => /KRX 예상체결 처음 나옴 08:5/.test(l)));
    // 연결 끊김은 1초 뒤 다시 불러 시세가 빠지지 않는다.
    assert.ok(raw.log.some(l => /FHKST11300006 1초 뒤 다시 조회/.test(l)) && raw.s1.NX['111111']?.price === 10300);
    assert.deepEqual(raw.controls.map(c => c.code), ['444444']);
    assert.ok(raw.prevVi.codes.includes('333333') && !raw.prevVi.codes.includes('A1234F'));
    const res = S.analyze(raw), row = code => res.rows.find(r => r.code === code);
    const lv = (code, basis, k) => row(code).levels.find(l => l.basis.startsWith(basis) && l.k === k);
    // 111111: −1% 9,900(앞 잔량 10, 체결 20 → 내 99주 중 10주만 → 9,800 체결에서 전량), −2% 9,800(앞 30, 같은 가격 50 → 20주뿐 → 9,750에서 전량), −3% 9,700 안 됨.
    const a1 = lv('111111', '08:48', 0.01), a2 = lv('111111', '08:48', 0.02), a3 = lv('111111', '08:48', 0.03);
    assert.equal(a1.price, 9900); assert.equal(a1.filledAt, at('09:00:30')); assert.equal(a1.queue, '앞 잔량 10주'); assert.equal(a1.verdict, '가능');
    assert.equal(a2.price, 9800); assert.equal(a2.filledAt, at('09:00:31')); assert.equal(a2.queue, '앞 잔량 30주');
    assert.ok(Math.abs(a2.hedge.pnl - (10000 / 9800 - 1 - 0.002)) < 1e-9 && a2.hedge.enough);
    assert.equal(a3.filled, false);
    assert.equal(row('111111').depth, 9750 / 10000 - 1);
    assert.equal(row('111111').krxOpen, 10000); assert.equal(row('111111').krxOpenAt, at('09:00:00'));
    // 수렴: 666666 첫 괴리 +2%(09:00:30), 0.5% 안은 09:01:10 = 40초. 프리 가격이 없어 가상 주문은 만들지 않는다.
    const r6 = row('666666');
    assert.ok(Math.abs(r6.converge.firstGap - 0.02) < 1e-9 && Math.abs(r6.converge.maxGap - 0.02) < 1e-9);
    assert.equal(r6.converge.sec05, 40); assert.equal(r6.levels.length, 0);
    const t6 = res.top.find(t => t.code === '666666');
    assert.deepEqual(t6.path.map(g => g == null ? null : Math.round(g * 10000)), [200, 100, 29, 29, 29]);
    assert.equal(res.snaps[0].over2, 4);
    // 체결강도: 표본 = 후보 4 + 09:01 KRX가 시가 대비 0.3% 이상 움직인 777777(+2%).
    assert.ok(raw.log.some(l => /체결강도 표본 5종목 \(후보 \+ 09:01 KRX 시가 대비 0\.3% 이상 움직인 종목 1\)/.test(l)), raw.log.join(' / '));
    assert.deepEqual(raw.strength['777777'].J, { p: 5100, s: 150, t: at('09:00:50') });
    assert.equal(raw.strength['777777'].NX.s, 130);
    const sk = res.strength.KRX.find(g => g.group === '동조'), sn = res.strength.NXT.find(g => g.group === '동조');
    assert.equal(res.strength.trended, 1); assert.equal(sk.n, 1); assert.equal(sk.keep5, 1);
    assert.ok(Math.abs(sk.avg3 - (5200 / 5100 - 1)) < 1e-9 && Math.abs(sk.avg5 - (5250 / 5100 - 1)) < 1e-9);
    assert.ok(sn.n === 1 && Math.abs(sn.avg5 - (5260 / 5100 - 1)) < 1e-9 && Math.abs(sn.avg3) < 1e-9);
    assert.equal(res.strength.buckets.find(b => b.lo === 150).n, 1); // 111111 −2.5%, 222222 −2.55%, 333333 +4%, 666666 +2%
    assert.equal(row('111111').basis, '전일 종가');
    assert.equal(row('111111').vi[0].releasePrice, 9950);
    assert.match(lv('111111', 'KRX 시가(사후)', 0.01).verdict, /^실제로는 불가 · 사후 기준/);
    // 222222: 08:49:40에 이미 19,200 체결 → 의도한 09:00:30 주문이 아님.
    assert.match(lv('222222', '08:48', 0.02).verdict, /프리마켓 08:49:40에 먼저 체결/);
    // 08:59 예상가 기준은 휴장 중이라 주문할 수 없다.
    assert.match(lv('222222', '08:59 예상가', 0.01).verdict, /^실제로는 불가 · .*08:50 뒤 기준/);
    // 333333: 매도 쪽, +3% 5,150은 10호가 밖(순서 미확인) → 5,200 체결로 전량, 보유자만 가능.
    const c3 = lv('333333', '08:48', 0.03);
    assert.equal(row('333333').side, 'sell'); assert.equal(c3.price, 5150); assert.equal(c3.queue, '순서 미확인(10호가 밖)');
    assert.match(c3.verdict, /^가능\(순서 미확인.*보유자만 가능$/);
    assert.equal(lv('333333', '08:48', 0.05).filled, false);
    const md = S.summary(raw, res);
    assert.match(md, /보유자만 가능/); assert.match(md, /앞 잔량 30주/);
    assert.match(md, /## 수렴 기록/); assert.match(md, /## 체결강도와 추세/); assert.match(md, /\| 동조 \| 1 \| 100% \| 0% \| \+1\.96% \| \+2\.94% \|/); assert.match(md, /\| 666666\(666666\) \| 09:00:31 \| 7,000\(09:00:00\) \| 09:00:30 \| \+2\.00% \| \+2\.00%\(09:00:30\) \| 40 \|/);
    assert.match(md, /KRX 첫 체결\(시가\)이 NXT 본장 시작 전에 나온 종목 2\/4/); // 222222 · 333333은 KRX 첫 체결이 09:00:31
    assert.match(md, /\| 666666\(666666\) \| 09:00:31 \| NXT 매도 쓸림 → 매수 \| \+2\.00%\(09:00:31 수렴\) \| — \|/);
    // 두 번째 실행은 저장된 토큰을 다시 쓴다.
    clock = at('08:46:00'); failedOnce = true;
    await S.createRunner(opts).run();
    assert.equal(posts, 1);
    // 전 종목 조회일: 08:46:30에 마스터를 NX로 훑어 NXT 거래 종목(현재가 > 0)만 08:48 조회에 더한다.
    clock = at('08:45:00'); failedOnce = true;
    const f = await S.createRunner({ ...opts, full: true, loadCodes: async () => ['111111', '555555'] }).run();
    assert.ok(f.log.some(l => /마스터 2종목 중 NXT 거래 1종목/.test(l)), f.log.join(' / '));
    assert.ok(!('555555' in f.s1.J));
    assert.deepEqual(f.fullStats, { basis: '08:59 예상가', gapCount: 3, inRank: 2, inRankOrVi: 3, compared: 4 });
    assert.match(S.summary(f, S.analyze(f)), /처음 값이 나온 시각: 08:5/);
    // 수능일(11/19): 프리마켓 없이 모든 장이 60분 늦게 연다. 단계 · 체결 구간을 60분 늦추고, 프리 후보 없이 수렴만 기록한다.
    D = '2026-11-19'; SH = 60; noPre = true; clock = mt('08:28:00'); failedOnce = true;
    const k = await S.createRunner({ ...opts, day: D, shift: 60 }).run();
    assert.ok(k.log.some(l => /모든 단계 60분 늦춤/.test(l)) && k.log.some(l => /프리마켓 체결 종목 없음/.test(l)), k.log.join(' / '));
    assert.ok(!k.log.some(l => /늦음:/.test(l)), k.log.join(' / '));
    assert.ok(k.probe[0].at >= mt('08:30:00') && k.probe.filter(x => x.at < mt('08:50:00')).every(x => x.withExp === 0));
    assert.ok(k.snaps[0].at >= Date.parse('2026-11-19T10:00:31+09:00'));
    assert.deepEqual(k.candidates.map(c => c.code + '@' + c.from), ['333333@09:00:31', '222222@09:00:31', '111111@09:00:31', '666666@09:00:31']);
    const kr = S.analyze(k), k6 = kr.rows.find(r => r.code === '666666');
    assert.equal(k6.krxOpenAt, Date.parse('2026-11-19T10:00:00+09:00')); assert.equal(k6.converge.sec05, 40);
    assert.equal(kr.rows.find(r => r.code === '111111').converge.firstNxAt, Date.parse('2026-11-19T10:00:30+09:00'));
    assert.ok(kr.rows.every(r => r.levels.length === 0));
    assert.match(S.summary(k, kr), /60분 늦춰 돌렸다/);
    fs.rmSync(data, { recursive: true, force: true });
    console.log('NXT open sweep: token reuse, schedule, queue, early fill, sell side, convergence, exam-day shift');
})().catch(e => { console.error(e); process.exitCode = 1; });
