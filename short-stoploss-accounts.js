'use strict';
// 대주 StopLoss 여러 계좌(2026-11-21): 계좌(앱키)마다 short-stoploss-service 하나를 두고, 대주창에는 한 화면으로 합쳐 보여 준다.
//  - 잔고 행 key와 감시 건 id 앞에 계좌 id를 붙인다("28|004980:20261124"). 조회 · 등록 · 주문은 그 행 · 건의 계좌 서비스가 그 계좌 앱키로 한다.
//  - 계좌가 하나뿐이어도 같은 형식을 쓴다.
const SEP = '|';

function createShortStopLossAccounts(accounts) {
    const byId = new Map(accounts.map(a => [a.id, a]));
    const split = value => {
        const s = String(value || ''), i = s.indexOf(SEP);
        const a = i > 0 && byId.get(s.slice(0, i));
        if (!a) throw Object.assign(Error('계좌를 찾지 못했습니다. 새로고침한 뒤 다시 고르세요.'), { status: 404 });
        return [a, s.slice(i + 1)];
    };
    const tag = (a, s) => s?.account || a.id;
    const watchOut = (a, w, account) => w && { ...w, id: a.id + SEP + w.id, lotKey: a.id + SEP + w.lotKey, acct: a.id, account };

    async function state() {
        const snaps = [];
        for (const a of accounts) {
            try { await a.svc.ensure(); } catch (error) { snaps.push([a, { ...a.svc.snapshot(), lotsError: String(error.message || error) }]); continue; }
            snaps.push([a, a.svc.snapshot()]);
        }
        const first = snaps[0][1];
        const halted = snaps.filter(([, s]) => s.halted);
        const rts = snaps.filter(([, s]) => s.realtime).map(([a, s]) => [tag(a, s), s.realtime]);
        return {
            // 실시간: 계좌마다 자기 앱키 웹소켓(기본 계좌는 VI 공용 연결). 하나라도 끊기면 끊김으로 보이고, 풍선에 계좌별 상태
            realtime: rts.length ? { connected: rts.every(([, r]) => r.connected), state: rts.map(([a, r]) => (snaps.length > 1 ? a + ' ' : '') + (r.state || (r.connected ? '연결' : '끊김'))).join(' · ') } : null,
            // 자동 주문 켜짐(2026-11-26 사용자 지적): 계좌를 합친 상태에 enabled가 빠져 오라클(SHORT_STOPLOSS=on)에서도 늘 '자동 주문 꺼짐'이었고
            // 감시 건 판정 칸도 '자동 주문 꺼짐 · 판정 안 함'으로 보였다(11/21 추가 계좌부터, 실제 판정은 돌고 있었음). 한 계좌라도 켜져 있으면 켜짐, 계좌별 값은 accounts[].enabled.
            enabled: snaps.some(([, s]) => s.enabled), segment: first.segment, now: first.now,
            accounts: snaps.map(([a, s]) => ({ id: a.id, account: tag(a, s), enabled: !!s.enabled, lotsAt: s.lotsAt, lotsError: s.lotsError, halted: s.halted, realtime: s.realtime })),
            account: snaps.map(([a, s]) => tag(a, s)).join(' · '),
            halted: halted.length > 0, haltedReason: halted.map(([a, s]) => (snaps.length > 1 ? tag(a, s) + ': ' : '') + s.haltedReason).join(' / '), haltedAt: Math.max(0, ...halted.map(([, s]) => s.haltedAt || 0)),
            lotsAt: Math.min(...snaps.map(([, s]) => s.lotsAt || 0)) || 0,
            lotsError: snaps.filter(([, s]) => s.lotsError).map(([a, s]) => (snaps.length > 1 ? tag(a, s) + ' ' : '') + s.lotsError).join(' / '),
            lots: snaps.flatMap(([a, s]) => s.lots.map(l => ({ ...l, key: a.id + SEP + l.key, acct: a.id, account: tag(a, s) }))),
            watches: snaps.flatMap(([a, s]) => s.watches.map(w => watchOut(a, w, tag(a, s))))
        };
    }
    const accountOf = a => a.svc.snapshot().account || a.id;

    function mount(app, { allowed }) {
        const guard = (req, res, next) => allowed(req) ? next() : res.status(403).json({ error: '대주 StopLoss는 관리자 계정만 쓸 수 있습니다' });
        const send = (res, fn) => Promise.resolve().then(fn).then(v => res.set('Cache-Control', 'no-store').json(v ?? { ok: true }))
            .catch(error => res.status(error.status || 502).set('Cache-Control', 'no-store').json({ error: error.status ? error.message : '키움 조회에 실패했습니다: ' + (error.message || error) }));
        const base = '/api/short-stoploss';
        const one = (id, fn) => { const [a, rest] = split(id); return Promise.resolve(fn(a.svc, rest)).then(w => w && w.id ? watchOut(a, w, accountOf(a)) : w); };
        app.get(base + '/state', guard, (req, res) => send(res, state));
        app.post(base + '/refresh', guard, (req, res) => send(res, async () => { for (const a of accounts) await a.svc.loadLots(); return state(); }));
        app.post(base + '/watches', guard, (req, res) => send(res, () => one(req.body?.lotKey, (svc, lotKey) => svc.create({ ...req.body, lotKey }))));
        app.put(base + '/watches/:id', guard, (req, res) => send(res, () => one(req.params.id, (svc, id) => svc.update(id, req.body || {}))));
        app.post(base + '/watches/:id/enabled', guard, (req, res) => send(res, () => one(req.params.id, (svc, id) => svc.setEnabled(id, !!req.body?.enabled))));
        app.delete(base + '/watches/:id', guard, (req, res) => send(res, () => one(req.params.id, (svc, id) => { svc.remove(id); return { ok: true }; })));
        app.get(base + '/watches/:id/log', guard, (req, res) => send(res, () => { const [a, id] = split(req.params.id); const h = a.svc.history(id); return { watch: watchOut(a, h.watch, accountOf(a)), log: h.log }; }));
        // 전체 감시: 대주창에서 계좌를 골라 보고 있으면 그 계좌만(acct), 아니면 모든 계좌
        app.post(base + '/watch-all', guard, (req, res) => send(res, () => { for (const a of accounts) if (!req.body?.acct || req.body.acct === a.id) a.svc.setAll(!!req.body?.enabled); return state(); }));
        app.post(base + '/resume', guard, (req, res) => send(res, () => { for (const a of accounts) if (a.svc.snapshot().halted) a.svc.resume(); return state(); }));
    }
    function start() { for (const a of accounts) a.svc.start(); }
    return { mount, start, state, accounts: () => accounts.map(a => a.id) };
}

module.exports = { createShortStopLossAccounts, SEP };
