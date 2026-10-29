const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chromium } = require('playwright');

function api() {
    const handlers = {}, files = new Map();
    const source = fs.readFileSync('server.js', 'utf8');
    const context = {
        __dirname: '/test', path: require('node:path'),
        fs: { existsSync: p => files.has(p), readFileSync: p => files.get(p) },
        writeJsonAtomically: (p, data) => files.set(p, JSON.stringify(data)),
        app: { get: (p, fn) => handlers.GET = fn, post: (p, fn) => handlers.POST = fn }
    };
    vm.runInNewContext(source.slice(source.indexOf('const QUICK_NOTE_FILE'), source.indexOf('const BACKUP_NAME_PATTERN')), context);
    return (method, body) => {
        let status = 200, data;
        const res = { set() {}, status(code) { status = code; return this; }, json(value) { data = value; } };
        handlers[method]({ body }, res);
        return { status, data: JSON.parse(JSON.stringify(data)) };
    };
}

test('note API persists edits and empty text, rejects stale writes and invalid input', () => {
    const request = api();
    assert.deepEqual(request('GET').data, { success: true, text: null, revision: 0 });
    assert.equal(request('POST', { text: 'note', revision: 0 }).status, 200);
    assert.equal(request('GET').data.text, 'note');
    assert.equal(request('POST', { text: 'stale', revision: 0 }).status, 409);
    assert.equal(request('GET').data.text, 'note');
    assert.equal(request('POST', { text: '', revision: 1 }).status, 200);
    assert.equal(request('GET').data.text, '');
    assert.equal(request('POST', { text: 123, revision: 2 }).status, 400);
    assert.equal(request('POST', { text: 'image', revision: 2, delta: { ops: [{ insert: { image: 'javascript:alert(1)' } }] } }).status, 400);
});

test('native credential is scoped to note and stops working with the issuing login session', () => {
    const source = fs.readFileSync('server.js', 'utf8');
    let middleware, sessionValid = true;
    const grants = new Map([['note-token', { cookie: 'session-cookie', expiresAt: Date.now() + 10000 }]]);
    vm.runInNewContext(source.slice(source.indexOf("app.use('/api',"), source.indexOf("app.get('/api/server/storage'")), {
        app: { use: (path, fn) => middleware = fn }, quickNoteGrants: grants,
        getSessionFromRequest: req => sessionValid && req.headers.cookie === 'session-cookie' ? { email: 'test' } : null
    });
    const invoke = path => {
        let status, passed = false;
        middleware({ path, method: 'GET', headers: { 'x-note-token': 'note-token' } }, {
            status(code) { status = code; return this; }, json() {}
        }, () => { passed = true; });
        return { status, passed };
    };
    assert.equal(invoke('/quick-note').passed, true);
    assert.equal(invoke('/settings').status, 401);
    sessionValid = false;
    assert.equal(invoke('/quick-note').status, 401);
});

test('native note edits with Quill, saves explicitly, cancels, restores formats and toggles topmost', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage();
        const request = api();
        let fail = false;
        await page.route('http://note.test/**', async route => {
            const req = route.request();
            if (new URL(req.url()).pathname === '/api/quick-note') {
                if (req.method() === 'POST') await new Promise(resolve => setTimeout(resolve, 150));
                const result = fail ? { status: 500, data: { success: false } } : request(req.method(), req.postDataJSON());
                return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.data) });
            }
            return route.fulfill({ contentType: 'text/html', body: '<body class="quick-note-native"><div id="rankIndependentControls" hidden></div></body>' });
        });
        const start = async () => {
            await page.goto('http://note.test/');
            await page.evaluate(() => { window.noteMessages = []; window.chrome.webview = { postMessage: message => window.noteMessages.push(message) }; });
            await page.addStyleTag({ path: 'public/style.css' });
            await page.addStyleTag(fs.existsSync('dev/output/quill.snow.css') ? { path: 'dev/output/quill.snow.css' } : { url: 'https://cdn.quilljs.com/1.3.6/quill.snow.css' });
            await page.addStyleTag({ path: 'public/quick-note.css' });
            await page.addScriptTag(fs.existsSync('dev/output/quill.js') ? { path: 'dev/output/quill.js' } : { url: 'https://cdn.quilljs.com/1.3.6/quill.js' });
            await page.addScriptTag({ path: 'public/quick-note.js' });
            await page.waitForFunction(() => document.querySelector('.ql-editor')?.getAttribute('contenteditable') === 'true');
        };
        await start();
        await page.locator('.ql-bold').click();
        await page.locator('.ql-editor').pressSequentially('Formatted note');
        assert.equal(request('GET').data.text, null);
        await page.locator('.quick-note-save').click();
        await page.waitForFunction(() => document.querySelector('.quick-note-status').textContent === '\uC11C\uBC84\uC5D0 \uC800\uC7A5\uB428');
        assert.equal(request('GET').data.delta.ops[0].attributes.bold, true);
        await page.locator('.ql-editor').fill('Discard me');
        await page.locator('.quick-note-cancel').click();
        assert.equal(await page.locator('.ql-editor').innerText(), 'Formatted note');
        assert.equal(await page.evaluate(() => window.noteMessages.at(-1)), 'note-close');
        await start();
        assert.equal(await page.locator('.ql-editor strong').innerText(), 'Formatted note');
        await page.locator('#quickNoteTopmost').check();
        assert.equal(await page.evaluate(() => window.noteMessages.at(-1)), 'topmost:true');
        await page.locator('#quickNoteTopmost').uncheck();
        assert.equal(await page.evaluate(() => window.noteMessages.at(-1)), 'topmost:false');
        fail = true;
        await page.locator('.ql-editor').fill('unsaved edit');
        await page.locator('.quick-note-save').click();
        await page.waitForFunction(() => document.querySelector('.quick-note-status').textContent.includes('\uC800\uC7A5\uD558\uC9C0 \uBABB'));
        assert.equal(request('GET').data.text.trim(), 'Formatted note');
        fail = false;
        await page.locator('.quick-note-save').click();
        await page.waitForFunction(() => document.querySelector('.quick-note-status').textContent === '\uC11C\uBC84\uC5D0 \uC800\uC7A5\uB428');
        assert.equal(request('GET').data.text.trim(), 'unsaved edit');
        await page.setViewportSize({ width: 360, height: 640 });
        const bounds = await page.locator('#quickNotePanel').boundingBox();
        assert.equal(bounds.width, 360); assert.equal(bounds.height, 640);
    } finally { await browser.close(); }
});
