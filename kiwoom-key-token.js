'use strict';
// 키움 접근 토큰(앱키 하나당 하나, 2026-11-21): 대주 StopLoss 추가 계좌(KIWOOM_APPKEY_28 등)용.
// 기본 앱키 토큰(server.js getAccessToken)과 캐시를 섞지 않는다. 파일에 남겨 서버 재시작 때 다시 발급하지 않는다(권한 600).
const fs = require('node:fs');
const path = require('node:path');

// onToken: 토큰을 얻을 때마다 알린다(키움 관문이 토큰으로 어느 앱키인지 안다).
function createKiwoomKeyToken({ appKey, secretKey, file, http = require('axios'), now = Date.now, log = () => {}, onToken = () => {} }) {
    let token = null, expires = 0, fileRead = false, pending = null;
    async function issue() {
        log('키움 토큰 발급 시도(' + path.basename(file) + ')');
        const r = await http.post('https://api.kiwoom.com/oauth2/token', { appkey: appKey, secretkey: secretKey, grant_type: 'client_credentials' },
            { headers: { 'Content-Type': 'application/json' }, timeout: 5000 });
        const d = r.data || {};
        if (d.return_code !== undefined && Number(d.return_code) !== 0) throw Error(d.return_msg || `키움 인증 실패 (코드: ${d.return_code})`);
        const t = d.token || d.access_token; if (!t) throw Error('키움 토큰 응답에 토큰이 없습니다');
        // expires_dt: yyyyMMddHHmmss(KST). 없거나 못 읽으면 24시간.
        const m = String(d.expires_dt || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
        const at = m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`) : NaN;
        token = t; expires = Number.isFinite(at) ? at : now() + 86400000; onToken(token);
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify({ token, expires, issuedAt: now() }), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); } catch {}
        return token;
    }
    async function get() {
        if (token && now() < expires - 300000) return token;
        if (!fileRead) {
            fileRead = true;
            try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (typeof s.token === 'string' && s.token && s.expires > now() + 300000) { token = s.token; expires = s.expires; onToken(token); return token; } } catch {}
        }
        if (!pending) pending = issue().finally(() => { pending = null; });
        return pending;
    }
    function reject() { token = null; expires = 0; }
    return { get, reject };
}

module.exports = { createKiwoomKeyToken };
