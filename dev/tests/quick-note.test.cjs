const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chromium } = require('playwright');

function api() {
    const handlers = {}, files = new Map();
    const source = fs.readFileSync('server.js', 'utf8');
    const context = {
        __dirname: '/test', path: require('node:path'), Buffer,
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
    assert.deepEqual(request('GET').data, { success: true, text: null, revision: 0, limitBytes: 10 * 1024 * 1024 });
    assert.equal(request('POST', { text: 'note', revision: 0 }).status, 200);
    assert.equal(request('GET').data.text, 'note');
    assert.equal(request('POST', { text: 'stale', revision: 0 }).status, 409);
    assert.equal(request('GET').data.text, 'note');
    assert.equal(request('POST', { text: '', revision: 1 }).status, 200);
    assert.equal(request('GET').data.text, '');
    assert.equal(request('POST', { text: 123, revision: 2 }).status, 400);
    assert.equal(request('POST', { text: 'image', revision: 2, delta: { ops: [{ insert: { image: 'javascript:alert(1)' } }] } }).status, 400);
    // 10 MiB limit on the whole save body (text + delta with pasted images), answered as JSON 413 with a Korean message.
    const picture = 'data:image/png;base64,' + 'A'.repeat(10 * 1024 * 1024);
    const tooBig = request('POST', { text: '\n', revision: 2, delta: { ops: [{ insert: { image: picture } }] } });
    assert.equal(tooBig.status, 413); assert.match(tooBig.data.error, /10 MB/);
    const fits = 'data:image/png;base64,' + 'A'.repeat(9 * 1024 * 1024);
    assert.equal(request('POST', { text: '\n', revision: 2, delta: { ops: [{ insert: { image: fits } }] } }).status, 200);
});

test('native credential is scoped to note and stops working with the issuing login session', () => {
    const source = fs.readFileSync('server.js', 'utf8');
    let middleware, sessionValid = true;
    const grants = new Map([['note-token', { cookie: 'session-cookie', expiresAt: Date.now() + 10000 }]]);
    // Only the first /api middleware is the auth gate; later ones (chart revisions, background cache) are separate.
    const authStart = source.indexOf("app.use('/api',");
    const authEnd = source.indexOf('\n});', authStart) + 4;
    vm.runInNewContext(source.slice(authStart, authEnd), {
        app: { use: (path, fn) => middleware = fn }, quickNoteGrants: grants, viWindowAccess: { handles: () => false },
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
                if (fail === 'nginx413' && req.method() === 'POST') return route.fulfill({ status: 413, contentType: 'text/html', body: '<html><head><title>413 Request Entity Too Large</title></head></html>' });
                const result = fail === true ? { status: 500, data: { success: false } } : request(req.method(), req.postDataJSON());
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
        // Oracle nginx answers an oversized note (pasted images) with an HTML 413 page, not JSON.
        fail = 'nginx413';
        await page.locator('.quick-note-save').click();
        await page.waitForFunction(() => document.querySelector('.quick-note-status').textContent.includes('(413)'));
        assert.doesNotMatch(await page.locator('.quick-note-status').innerText(), /Unexpected token|JSON/);
        fail = false;
        await page.locator('.quick-note-save').click();
        await page.waitForFunction(() => document.querySelector('.quick-note-status').textContent === '\uC11C\uBC84\uC5D0 \uC800\uC7A5\uB428');
        assert.equal(request('GET').data.text.trim(), 'unsaved edit');
        await page.setViewportSize({ width: 360, height: 640 });
        const bounds = await page.locator('#quickNotePanel').boundingBox();
        assert.equal(bounds.width, 360); assert.equal(bounds.height, 640);
        await page.setViewportSize({ width: 800, height: 640 });
        // Usage in the header, same format as the trading tab's server usage; over 10 MB blocks saving.
        assert.match(await page.locator('.quick-note-usage').innerText(), /^노트 사용 0% \(0 \/ 10 MB\)$/);
        const head = await page.locator('.quick-note-header').boundingBox(), use = await page.locator('.quick-note-usage').boundingBox();
        assert.ok(use.x > head.x + head.width / 2, 'usage sits on the right side of the header');
        await page.evaluate(() => { const q = Quill.find(document.querySelector('#quickNoteText')); q.insertText(0, 'x'.repeat(3 * 1024 * 1024), 'user'); });
        assert.match(await page.locator('.quick-note-usage').innerText(), /^노트 사용 60% \(6 \/ 10 MB\)$/);
        assert.equal(await page.locator('.quick-note-save').isDisabled(), false);
        await page.evaluate(() => { const q = Quill.find(document.querySelector('#quickNoteText')); q.insertText(0, 'x'.repeat(3 * 1024 * 1024), 'user'); });
        assert.match(await page.locator('.quick-note-usage').innerText(), /^노트 사용 1\d\d% /);
        assert.equal(await page.locator('.quick-note-usage.over').count(), 1);
        assert.equal(await page.locator('.quick-note-save').isDisabled(), true);
        assert.match(await page.locator('.quick-note-status').innerText(), /10 MB를 넘어/);
    } finally { await browser.close(); }
});

test('right-clicking a note picture leaves the default context menu (Copy image) alone', async () => {
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    try {
        const page = await browser.newPage();
        await page.route('http://localhost/**', route => route.fulfill({ contentType: 'text/html', body: '<body><div id="ed"></div></body>' }));
        await page.goto('http://localhost/');
        await page.addStyleTag({ path: 'public/style.css' });
        await page.addScriptTag(fs.existsSync('dev/output/quill.js') ? { path: 'dev/output/quill.js' } : { url: 'https://cdn.quilljs.com/1.3.6/quill.js' });
        await page.addScriptTag({ path: 'public/memo-image-resize.js' });
        await page.evaluate(() => new Promise(resolve => {
            const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 30;
            const q = new Quill('#ed'); window.MemoImageResize.attach(q);
            q.setContents({ ops: [{ insert: { image: canvas.toDataURL('image/png') } }, { insert: '\n' }] });
            const img = document.querySelector('#ed img'); if (img.complete) resolve(); else img.onload = resolve;
            window.menuPrevented = null; document.addEventListener('contextmenu', e => { window.menuPrevented = e.defaultPrevented; });
        }));
        await page.locator('#ed img').click({ button: 'right' });
        assert.equal(await page.evaluate(() => window.menuPrevented), false);
        assert.equal(await page.locator('.memo-image-menu').count(), 0);
    } finally { await browser.close(); }
});
