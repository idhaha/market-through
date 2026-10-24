const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
fs.mkdirSync(path.join(__dirname, '../output'), { recursive: true });
const { createSessionStore, DAY } = require('../../auth-session-store');
test('hashed persistence, hourly sliding renewal, fixed deadline and revocation', () => {
    const dir = fs.mkdtempSync(path.join(path.join(__dirname, '../output'), 'market-auth-'));
    try {
        const filename = path.join(dir, 'sessions.json');
        let at = 1800000000000;
        const options = { filename, now: () => at, allowed: () => true };
        let store = createSessionStore(options);
        const a = store.create({ email: 'a@example.com' });
        const b = store.create({ email: 'a@example.com' });
        assert.notEqual(a.token, b.token);
        assert.ok(!fs.readFileSync(filename, 'utf8').includes(a.token));
        store = createSessionStore(options);
        assert.equal(store.get(a.token).createdAt, at);
        const original = fs.readFileSync(filename, 'utf8');
        at += 1000; store.get(a.token);
        assert.equal(fs.readFileSync(filename, 'utf8'), original);
        at += 3600000;
        assert.equal(store.get(a.token).expiresAt, at + 7 * DAY);
        store.remove(b.token); assert.equal(store.get(b.token), null);
        for (let day = 1; day < 30; day++) { at = a.session.createdAt + day * DAY; assert.ok(store.get(a.token)); }
        assert.equal(store.get(a.token).expiresAt, a.session.reauthenticateAt);
        at = a.session.reauthenticateAt; assert.equal(store.get(a.token), null);
        const c = store.create({ email: 'a@example.com' });
        store.revoke('a@example.com');
        assert.equal(createSessionStore(options).get(c.token), null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('idle expiry, removed account and damaged file fail closed', () => {
    const dir = fs.mkdtempSync(path.join(path.join(__dirname, '../output'), 'market-auth-'));
    try {
        const filename = path.join(dir, 'sessions.json'); let at = Date.now(), allow = true;
        const options = { filename, now: () => at, allowed: () => allow, log: () => {} };
        const store = createSessionStore(options), a = store.create({ email: 'a@example.com' });
        allow = false; assert.equal(store.get(a.token), null); allow = true;
        at += 7 * DAY; assert.equal(store.get(a.token), null);
        fs.writeFileSync(filename, '{'); assert.equal(createSessionStore(options).get(a.token), null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
