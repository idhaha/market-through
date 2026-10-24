const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DAY = 86400000;
function createSessionStore({ filename, now = Date.now, allowed, log = console.error }) {
    let sessions = new Map();
    const hash = token => crypto.createHash('sha256').update(token).digest('hex');
    const valid = s => s && typeof s.email === 'string' && Number.isFinite(s.createdAt) &&
        Number.isFinite(s.expiresAt) && Number.isFinite(s.renewedAt) &&
        s.reauthenticateAt === s.createdAt + 30 * DAY && s.expiresAt <= s.reauthenticateAt &&
        now() < s.expiresAt && now() < s.reauthenticateAt;
    try {
        const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (data.version !== 1 || !Array.isArray(data.sessions)) throw new Error('Invalid session file');
        sessions = new Map(data.sessions.filter(([key, s]) => /^[a-f0-9]{64}$/.test(key) && valid(s)));
    } catch (error) { if (error.code !== 'ENOENT') log('[Auth] Session restore failed: ' + error.message); }
    function commit(next) {
        const temporary = `${filename}.${process.pid}.tmp`;
        try {
            fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
            fs.writeFileSync(temporary, JSON.stringify({ version: 1, sessions: [...next].filter(([, s]) => valid(s)) }), { mode: 0o600 });
            fs.renameSync(temporary, filename);
            fs.chmodSync(filename, 0o600);
            sessions = next;
        } catch (error) {
            log('[Auth] Session save failed: ' + error.message);
            throw error;
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    return {
        create(user) {
            const token = crypto.randomBytes(32).toString('base64url'), at = now();
            const session = { ...user, createdAt: at, renewedAt: at, expiresAt: at + 7 * DAY, reauthenticateAt: at + 30 * DAY };
            const next = new Map(sessions); next.set(hash(token), session); commit(next);
            return { token, session };
        },
        get(token) {
            const key = hash(token), session = sessions.get(key);
            if (!valid(session) || !allowed(session.email)) return null;
            if (now() - session.renewedAt >= 3600000) {
                const renewed = { ...session, renewedAt: now(), expiresAt: Math.min(now() + 7 * DAY, session.reauthenticateAt) };
                const next = new Map(sessions); next.set(key, renewed);
                try { commit(next); return renewed; } catch { return session; }
            }
            return session;
        },
        remove(token) { const next = new Map(sessions); next.delete(hash(token)); commit(next); },
        revoke(email) { commit(new Map([...sessions].filter(([, s]) => s.email !== email))); }
    };
}
module.exports = { createSessionStore, DAY };
