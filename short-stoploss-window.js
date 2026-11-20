'use strict';
// 대주 StopLoss 독립창(2026-11-20): 수급 · VI 창처럼 데스크톱 독립창 앱(marketthrough://)으로 연다.
// 앱 안의 화면은 브라우저 쿠키가 없으므로 메인 화면(로그인 상태)이 받은 토큰으로 로그인을 대신한다.
// 토큰은 두 단계다(2026-11-20 사용자 확인):
//  1) 여는 토큰: 메인 화면이 받아 창 주소(#token=)로 앱에 넘긴다. 앱 실행 인자로 PC 안에 남으므로 5분 안에 한 번만 쓸 수 있다.
//  2) 창 토큰: 대주창이 여는 토큰을 한 번 바꿔 받는다(window-exchange). 창 안에만 두고 X-SS-Token 머리글로 대주 API · 휴장일 달력을 부른다. 24시간.
// 둘 다 서버 메모리에만 있어 서버가 다시 켜지면 끝난다(메인 화면에서 버튼을 다시 누르면 열린 창이 새 토큰으로 이어 간다).
const crypto = require('node:crypto');
const LAUNCH_MS = 5 * 60000, GRANT_MS = 86400000;
const validScale = v => { const n = Number(v); return n >= 0.25 && n <= 8 ? n : null; };
const newToken = () => crypto.randomBytes(32).toString('hex');
function createShortStopLossWindowAccess({ session, allowed, now = Date.now }) {
    const launches = new Map(), grants = new Map();
    const expired = '대주창 연결이 끝났습니다(서버 재시작 등). 메인 화면에서 대주StopLoss 버튼을 다시 누르세요.';
    const tidy = () => { const t = now(); for (const m of [launches, grants]) for (const [k, g] of m) if (g.expiresAt <= t) m.delete(k); };
    const exchangePath = '/short-stoploss/window-exchange';
    // 창 토큰으로 쓸 수 있는 곳: 대주 API 전체(창 발급 · 상태 · 배율 보고 제외)와 휴장일 달력. 여는 토큰은 바꿔 받는 데만 쓴다
    const handles = req => (req.path === exchangePath && !!req.headers['x-ss-launch']) || (!!req.headers['x-ss-token'] && (req.path === '/trading-session/calendar'
        || (req.path.startsWith('/short-stoploss/') && ![exchangePath, '/short-stoploss/window', '/short-stoploss/window-status', '/short-stoploss/window-scale'].includes(req.path))));
    function authorize(req, res, next) {
        if (req.path === exchangePath) {
            if (req.method !== 'POST') return res.status(405).json({ error: '잘못된 요청' });
            const launch = launches.get(String(req.headers['x-ss-launch']));
            if (!launch || launch.used || launch.openBy <= now() || !session({ headers: { cookie: launch.cookie } })) {
                return res.status(401).json({ error: launch?.used ? '이미 쓴 연결입니다. 메인 화면에서 대주StopLoss 버튼을 다시 누르세요.' : launch && launch.openBy <= now() ? '창이 늦게 열려 연결 시간(5분)이 지났습니다. 메인 화면에서 대주StopLoss 버튼을 다시 누르세요.' : expired });
            }
            const token = newToken();
            grants.set(token, { cookie: launch.cookie, email: launch.email, expiresAt: now() + GRANT_MS, scale: launch.scale });
            launch.used = true; launch.grant = token;
            return res.set('Cache-Control', 'no-store').json({ token });
        }
        const token = String(req.headers['x-ss-token']), grant = grants.get(token);
        const user = grant && grant.expiresAt > now() && session({ headers: { cookie: grant.cookie } });
        if (!user) { grants.delete(token); return res.status(401).json({ error: expired }); }
        req.authUser = user; req.ssWindow = grant; next();
    }
    // 메인 화면은 여는 토큰만 안다: 상태 · 배율 보고는 여는 토큰으로 해당 창 토큰을 찾는다
    const launchOf = req => { const l = launches.get(String(req.body?.token || '')); return l && l.email === req.authUser?.email && l.expiresAt > now() ? l : null; };
    function mount(app) {
        app.post('/api/short-stoploss/window', (req, res) => {
            if (!allowed(req)) return res.status(403).json({ error: '대주 StopLoss는 관리자 계정만 쓸 수 있습니다.' });
            tidy();
            if (launches.size >= 200) return res.status(429).json({ error: '대주창 연결 한도' });
            const token = newToken();
            // openBy: 이때까지 한 번 바꿔 받아야 한다. expiresAt: 메인 화면이 이 값으로 상태 · 배율을 보고할 수 있는 기간(창 토큰과 같음)
            launches.set(token, { cookie: req.headers.cookie, email: req.authUser.email, openBy: now() + LAUNCH_MS, expiresAt: now() + GRANT_MS, scale: validScale(req.body?.scale), used: false, grant: '' });
            res.set('Cache-Control', 'no-store').json({ token });
        });
        app.post('/api/short-stoploss/window-status', (req, res) => {
            const l = launchOf(req); res.set('Cache-Control', 'no-store').json({ connected: !!(l && l.used && grants.has(l.grant)) });
        });
        // 메인 화면 확대 · 축소가 바뀌면 열린 대주창도 따라간다(VI 창과 같음)
        app.post('/api/short-stoploss/window-scale', (req, res) => {
            const l = launchOf(req), scale = validScale(req.body?.scale);
            if (!l) return res.status(404).json({ error: '대주창 없음' });
            if (scale == null) return res.status(400).json({ error: '잘못된 배율' });
            l.scale = scale; const g = grants.get(l.grant); if (g) g.scale = scale;
            res.set('Cache-Control', 'no-store').json({ ok: true });
        });
        app.get('/api/short-stoploss/window-info', (req, res) => {
            if (!req.ssWindow) return res.status(404).json({ error: '대주창 아님' });
            res.set('Cache-Control', 'no-store').json({ scale: req.ssWindow.scale });
        });
    }
    return { handles, authorize, mount };
}
module.exports = { createShortStopLossWindowAccess, LAUNCH_MS };
