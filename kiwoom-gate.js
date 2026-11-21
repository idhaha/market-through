'use strict';
// 키움 호출 관문(2026-11-21). 앱키마다 관문을 하나씩 두고, 각 관문은 자기 앱키의 호출만 세어 순서를 조절한다.
// 키움은 호출 한도를 앱키 × API(api-id)별로 센다(2026-11-21 로컬 시험: 한 키 ka10001 20건 동시 → 10건 거절
// "[1700] 허용된 API 요청 개수를 초과하였습니다. 유량=5", 두 키에 10건씩 → 거의 모두 성공). 오류 목록에는 앱키 전체 한도(1701)도 있다.
// 그래서 관문마다
//   - API별 칸: 1초에 perApi건(기본 4)까지
//   - 앱키 전체: 1초에 total건(기본 12, 수치를 모르는 1701 대비 여유)까지
//   - 주문(kt로 시작하는 api-id)은 기다리는 조회보다 먼저 보낸다
//   - 429 · 1700 · 1701 · 1702를 받으면 그 칸(1701은 앱키 전체)을 cooldownMs 동안 쉬게 한다(재시도는 하지 않는다: 재시도가 한도를 더 태운다)
// 호출은 axios 기본 인스턴스의 요청 · 응답 가로채기로 지난다(키움 REST는 모두 axios 기본 인스턴스를 쓴다). 어느 앱키인지는 Authorization 토큰으로 안다:
// 앱키마다 토큰을 등록(register)하고, 등록되지 않은 토큰은 기본 앱키(main)로 본다. 웹소켓 실시간은 지나지 않는다.
const WINDOW = 1000;

function createKiwoomGate({ key, perApi = 4, total = 12, cooldownMs = 1000, now = Date.now, setTimer = setTimeout } = {}) {
    const sent = new Map(), sentAll = [], paused = new Map(); let pausedAll = 0;
    const queue = []; let timer = null;
    const stats = { sent: 0, waited: 0, waitMs: 0, limited: 0, byApi: {} };
    const recent = (list, t) => { while (list.length && list[0] <= t - WINDOW) list.shift(); return list; };
    // 지금 보낼 수 있으면 0, 아니면 기다릴 ms.
    function delay(api, t) {
        const own = recent(sent.get(api) || [], t), all = recent(sentAll, t);
        let wait = 0;
        if (own.length >= perApi) wait = Math.max(wait, own[0] + WINDOW - t);
        if (all.length >= total) wait = Math.max(wait, all[0] + WINDOW - t);
        wait = Math.max(wait, (paused.get(api) || 0) - t, pausedAll - t);
        return Math.max(0, wait);
    }
    function mark(api, t) {
        if (!sent.has(api)) sent.set(api, []);
        sent.get(api).push(t); sentAll.push(t); stats.sent++;
        (stats.byApi[api] ||= { sent: 0, waited: 0, limited: 0 }).sent++;
    }
    function pump(fromTimer = false) {
        if (fromTimer) timer = null;
        const t = now();
        // 주문 먼저, 그다음 들어온 순서. 칸이 찬 API는 건너뛰고 다른 API를 보낸다.
        queue.sort((a, b) => (b.order - a.order) || (a.at - b.at));
        let soonest = Infinity;
        for (let i = 0; i < queue.length;) {
            const job = queue[i], wait = delay(job.api, t);
            if (wait === 0) { queue.splice(i, 1); mark(job.api, t); const waited = t - job.at; if (waited > 0) { stats.waited++; stats.waitMs += waited; stats.byApi[job.api].waited++; } job.resolve(); continue; }
            soonest = Math.min(soonest, wait); i++;
        }
        if (queue.length && !timer) timer = setTimer(() => pump(true), Math.max(1, Math.min(soonest, WINDOW)));
    }
    // 보낼 차례가 되면 끝나는 Promise.
    function acquire(api) {
        api = String(api || '-');
        const t = now();
        if (!queue.length && delay(api, t) === 0) { mark(api, t); return Promise.resolve(); }
        // 줄이 있어도 자기 칸이 비었으면 바로 나간다(다른 API 때문에 기다리지 않는다).
        return new Promise(resolve => { queue.push({ api, order: /^kt/i.test(api) ? 1 : 0, at: t, resolve }); pump(); });
    }
    // 응답을 보고 한도 초과면 그 칸을 쉬게 한다.
    function report(api, { status, code } = {}) {
        api = String(api || '-');
        const c = String(code ?? '');
        if (!(status === 429 || /^(1700|1701|1702)$/.test(c))) return false;
        stats.limited++; (stats.byApi[api] ||= { sent: 0, waited: 0, limited: 0 }).limited++;
        const until = now() + cooldownMs;
        if (c === '1701') pausedAll = Math.max(pausedAll, until); else paused.set(api, Math.max(paused.get(api) || 0, until));
        return true;
    }
    return { key, acquire, report, stats: () => ({ key, queued: queue.length, ...JSON.parse(JSON.stringify(stats)) }) };
}

// 앱키별 관문 모음 + axios 가로채기.
function createKiwoomGates({ options = {}, log = () => {}, now = Date.now } = {}) {
    const gates = new Map(), tokens = new Map();
    const gate = key => { if (!gates.has(key)) gates.set(key, createKiwoomGate({ key, now, ...options })); return gates.get(key); };
    gate('main');
    const keyOf = authorization => tokens.get(String(authorization || '').replace(/^Bearer\s+/i, '').trim()) || 'main';
    const header = (headers, name) => {
        if (!headers) return '';
        if (typeof headers.get === 'function') { const v = headers.get(name); if (v != null) return String(v); }
        const k = Object.keys(headers).find(x => x.toLowerCase() === name); return k ? String(headers[k] ?? '') : '';
    };
    const isKiwoom = url => /^https:\/\/(api|mockapi)\.kiwoom\.com\//i.test(String(url || ''));
    // 키움 한도 오류 코드: 본문 return_msg의 [1700:…] 또는 return_code.
    const limitCode = data => { const m = /\[(17\d\d)\s*:/.exec(String(data?.return_msg || '')); return m ? m[1] : ''; };
    function install(axios) {
        if (axios.kiwoomGateInstalled) return api;
        axios.kiwoomGateInstalled = true;
        axios.interceptors.request.use(async config => {
            const url = config.baseURL && !/^https?:/i.test(config.url || '') ? config.baseURL + config.url : config.url;
            if (!isKiwoom(url) || /\/oauth2\//i.test(url)) return config;
            const apiId = header(config.headers, 'api-id'), key = keyOf(header(config.headers, 'authorization'));
            await gate(key).acquire(apiId);
            config.kiwoomGate = { key, api: apiId };
            return config;
        });
        const check = (config, status, data) => {
            const g = config?.kiwoomGate; if (!g) return;
            if (gate(g.key).report(g.api, { status, code: limitCode(data) })) log(`[키움 관문] ${g.key} 앱키 ${g.api} 한도 초과(${status}${limitCode(data) ? ' ' + limitCode(data) : ''}) · 그 칸을 잠깐 쉼`);
        };
        axios.interceptors.response.use(response => { check(response.config, response.status, response.data); return response; },
            error => { check(error.config, error.response?.status, error.response?.data); return Promise.reject(error); });
        return api;
    }
    const api = {
        install, gate, keyOf,
        // 앱키의 토큰을 알려 준다(토큰으로 어느 앱키 관문인지 안다).
        register(key, token) { if (token) tokens.set(String(token), key); gate(key); },
        stats: () => [...gates.values()].map(g => g.stats())
    };
    return api;
}
module.exports = { createKiwoomGate, createKiwoomGates };
