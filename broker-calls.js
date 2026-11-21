'use strict';
// 증권사 호출 스위치(2026-11-21). 로컬 PC와 오라클이 같은 앱키를 쓰므로, 로컬 호출이 오라클의 호출 한도를 깎지 않게
// 로컬에서는 기본으로 증권사 호출(REST · 웹소켓 · 토큰 발급)을 모두 막는다. 시험할 때만 필요한 것만 켠다.
//
// BROKER_CALLS (.env)
//   on                        모두 허용(오라클 기본값). 정기 수집도 시작한다.
//   off                       모두 막음(로컬 PC 기본값). 정기 수집도 시작하지 않는다.
//   kiwoom,ls:t8463,kiwoom:ka10001 …  적은 것만 허용. 증권사만 적으면 그 증권사 전체, 증권사:API면 그 API만.
//                             토큰 발급은 그 증권사에 허용이 하나라도 있으면 허용, 웹소켓은 증권사 전체 허용(또는 증권사:websocket)일 때만.
//                             이때 정기 수집은 시작하지 않는다(화면 조회 · 시험 스크립트용).
// 증권사: kiwoom(api.kiwoom.com) · ls(openapi.ls-sec.co.kr) · kis(*.koreainvestment.com) · nh(api.nhplug.com)
// API 이름: 키움 api-id, LS tr_cd, 한투 tr_id 헤더.
//
// 막는 곳은 Node의 http.request · https.request(axios · ws가 이걸 쓴다)와 전역 fetch(NH)다.
const http = require('node:http');
const https = require('node:https');

const BROKERS = [
    ['kiwoom', host => host === 'api.kiwoom.com' || host === 'mockapi.kiwoom.com'],
    ['ls', host => host === 'openapi.ls-sec.co.kr'],
    ['kis', host => host === 'koreainvestment.com' || host.endsWith('.koreainvestment.com')],
    ['nh', host => host === 'api.nhplug.com']
];
const API_HEADER = { kiwoom: 'api-id', ls: 'tr_cd', kis: 'tr_id' };

function parse(env = process.env, platform = process.platform) {
    const raw = String(env.BROKER_CALLS ?? '').trim().toLowerCase();
    if (!raw) return platform === 'win32' ? { mode: 'off', rules: [] } : { mode: 'on', rules: [] };
    if (raw === 'on' || raw === 'all') return { mode: 'on', rules: [] };
    if (raw === 'off' || raw === 'none') return { mode: 'off', rules: [] };
    const rules = raw.split(',').map(s => s.trim()).filter(Boolean).map(s => { const [broker, api = ''] = s.split(':').map(x => x.trim()); return { broker, api }; })
        .filter(r => BROKERS.some(([name]) => name === r.broker));
    return { mode: rules.length ? 'some' : 'off', rules };
}
function brokerOf(host) {
    const name = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    return BROKERS.find(([, match]) => match(name))?.[0] || null;
}
function header(headers, name) {
    if (!headers || !name) return '';
    if (typeof headers.get === 'function') return String(headers.get(name) || '');
    const key = Object.keys(headers).find(k => k.toLowerCase() === name);
    return key ? String(headers[key] ?? '') : '';
}
function createBrokerCalls({ env = process.env, platform = process.platform, log = () => {} } = {}) {
    const policy = parse(env, platform);
    const blocked = new Map();
    // { broker, api, path, websocket } → true(허용) / false(막음)
    function allows({ broker, api = '', path = '', websocket = false }) {
        if (!broker || policy.mode === 'on') return true;
        if (policy.mode === 'off') return false;
        const mine = policy.rules.filter(r => r.broker === broker);
        if (!mine.length) return false;
        if (mine.some(r => !r.api)) return true;
        if (websocket) return mine.some(r => r.api === 'websocket');
        if (/oauth2\/(token|tokenp|revoke)|\/oauth2\//i.test(path)) return true;
        return !!api && mine.some(r => r.api === api.toLowerCase());
    }
    function note(broker, api) {
        const key = broker + ':' + (api || '-'), count = (blocked.get(key) || 0) + 1;
        blocked.set(key, count);
        if (count === 1) log(`[증권사 호출 꺼짐] ${broker}${api ? ' ' + api : ''} 호출을 막았습니다 (BROKER_CALLS=${policy.mode === 'some' ? env.BROKER_CALLS : policy.mode}). 같은 호출은 다시 적지 않습니다.`);
    }
    const blockedError = (broker, api) => Object.assign(new Error(`이 서버에서는 증권사 호출이 꺼져 있습니다(${broker}${api ? ' ' + api : ''}, BROKER_CALLS)`), { code: 'BROKER_CALLS_OFF', brokerCallsOff: true });
    // http(s).request(url?, options?, callback?)의 대상 · 헤더를 읽는다.
    function target(args) {
        let url = null, options = {};
        if (typeof args[0] === 'string' || args[0] instanceof URL) { url = new URL(String(args[0])); if (args[1] && typeof args[1] === 'object') options = args[1]; }
        else if (args[0] && typeof args[0] === 'object') options = args[0];
        const host = options.hostname || options.host?.replace(/:\d+$/, '') || url?.hostname || '';
        const path = options.path || (url ? url.pathname + url.search : '');
        const headers = options.headers || {};
        return { host, path, headers };
    }
    function guard(module) {
        for (const name of ['request', 'get']) {
            const original = module[name];
            if (original.brokerCallsGuard) continue;
            const wrapped = function (...args) {
                const { host, path, headers } = target(args), broker = brokerOf(host);
                if (!broker) return original.apply(this, args);
                const api = header(headers, API_HEADER[broker]), websocket = /websocket/i.test(header(headers, 'upgrade'));
                if (allows({ broker, api, path, websocket })) return original.apply(this, args);
                note(broker, websocket ? 'websocket' : api);
                // 실제로 나가지 않도록 존재하지 않는 주소로 바꾼 요청을 만들고 바로 오류로 끝낸다(axios · ws는 error 이벤트로 받는다).
                const safe = { protocol: module === https ? 'https:' : 'http:', hostname: 'broker-calls-off.invalid', port: 9, path: '/', method: 'GET', headers: {} };
                const req = original.call(this, safe);
                process.nextTick(() => req.destroy(blockedError(broker, websocket ? 'websocket' : api)));
                return req;
            };
            wrapped.brokerCallsGuard = true;
            module[name] = wrapped;
        }
    }
    function install() {
        guard(http); guard(https);
        const fetch = globalThis.fetch;
        if (typeof fetch === 'function' && !fetch.brokerCallsGuard) {
            const wrapped = async (input, init = {}) => {
                const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
                const broker = brokerOf(url.hostname);
                if (!broker) return fetch(input, init);
                const api = header(init.headers || input.headers, API_HEADER[broker]);
                if (allows({ broker, api, path: url.pathname })) return fetch(input, init);
                note(broker, api); throw blockedError(broker, api);
            };
            wrapped.brokerCallsGuard = true;
            globalThis.fetch = wrapped;
        }
        return api;
    }
    const api = {
        policy, allows, install, brokerOf,
        // 정기 수집(주기 조회 · 웹소켓 상시 연결)은 BROKER_CALLS=on일 때만 시작한다.
        collects: () => policy.mode === 'on',
        blocked: () => Object.fromEntries(blocked),
        startupLine: () => policy.mode === 'on' ? '[증권사 호출] 모두 허용 · 정기 수집 시작' + (String(env.BROKER_CALLS ?? '').trim() ? ' (BROKER_CALLS=on)' : ` (기본값: 오라클 · 여기는 ${platform === 'win32' ? '로컬 PC' : '오라클'})`)
            : policy.mode === 'off' ? '[증권사 호출] 모두 막음 · 정기 수집 안 함' + (String(env.BROKER_CALLS ?? '').trim() ? ' (BROKER_CALLS=off)' : ' (기본값: 로컬 PC는 끔)')
            : `[증권사 호출] 일부만 허용: ${policy.rules.map(r => r.broker + (r.api ? ':' + r.api : '')).join(', ')} · 정기 수집 안 함`
    };
    return api;
}
module.exports = { createBrokerCalls, parse, brokerOf };
