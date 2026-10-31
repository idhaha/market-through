'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createEngine, safePath } = require('../../scripts/ollama-coder/engine.cjs');
function workspace() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'marketthrough-coder-test-'));
    fs.mkdirSync(path.join(directory, 'public')); fs.writeFileSync(path.join(directory, 'public/demo.js'), 'function add(a, b) { return a - b; }\n');
    return { directory, close() {
        const absolute = path.resolve(directory), base = path.resolve(os.tmpdir());
        assert.ok(absolute.startsWith(base + path.sep + 'marketthrough-coder-test-')); fs.rmSync(absolute, { recursive: true, force: true });
    } };
}
const responses = actions => async () => ({ action: actions.shift() || { action: 'finish', summary: 'done' }, promptTokens: 1, outputTokens: 1 });
const args = { instruction: 'Change subtraction to addition', files: ['public/demo.js'] };
const edits = () => [{ action: 'read_file', path: 'public/demo.js' }, { action: 'replace_text', path: 'public/demo.js', old_text: 'a - b', new_text: 'a + b' }, { action: 'run_check', path: 'public/demo.js' }, { action: 'finish', summary: 'Changed addition' }];

test('local action loop reads, edits, runs parser, stages only, then host applies reviewed content', async () => {
    const w = workspace();
    try {
        const engine = createEngine({ root: w.directory, chat: responses(edits()) });
        const task = engine.start(args); await engine.wait(task.task_id);
        assert.match(fs.readFileSync(path.join(w.directory, 'public/demo.js'), 'utf8'), /a - b/);
        const review = engine.review(task.task_id);
        assert.equal(review.state, 'ready_for_review'); assert.match(review.diffs[0].added, /a \+ b/);
        assert.ok(review.checks.every(check => check.exit_code === 0));
        assert.equal(engine.status(task.task_id).diffs, undefined, 'Status must not return source');
        assert.throws(() => engine.apply(task.task_id, 'wrong'), /review again/);
        assert.equal(engine.apply(task.task_id, review.review_token).state, 'applied');
        assert.match(fs.readFileSync(path.join(w.directory, 'public/demo.js'), 'utf8'), /a \+ b/);
    } finally { w.close(); }
});

test('source conflicts reject all writes and stale review tokens reject modified stage', async () => {
    const w = workspace();
    try {
        const engine = createEngine({ root: w.directory, chat: responses(edits()) });
        const task = engine.start(args); await engine.wait(task.task_id); const review = engine.review(task.task_id);
        fs.writeFileSync(path.join(w.directory, 'public/demo.js'), '// user edit\n');
        assert.throws(() => engine.apply(task.task_id, review.review_token), /Source changed/);
        fs.writeFileSync(path.join(review.staged_directory, 'public/demo.js'), 'function nope( {');
        assert.throws(() => engine.apply(task.task_id, review.review_token), /review again/);
        const updated = engine.review(task.task_id);
        assert.throws(() => engine.apply(task.task_id, updated.review_token), /Source changed/);
    } finally { w.close(); }
});

test('secrets, traversal, instruction files, shell commands and unsupported models are denied', async () => {
    const w = workspace();
    try {
        const engine = createEngine({ root: w.directory, chat: responses([]) });
        for (const file of ['../outside.js', '.env', 'public/../secret.js', 'public/.env.js', 'public/AGENTS.md', 'docs/tokens.txt', 'scripts/ollama-coder/engine.cjs', 'public/a:stream.js', 'public/NUL.js']) {
            assert.throws(() => engine.start({ ...args, files: [file] }), /path|policy/i, file);
        }
        assert.throws(() => engine.start({ ...args, model: 'remote-model' }), /Model/);
        const actions = [{ action: 'run_check', path: '../outside.js' }, { action: 'shell', path: 'public/demo.js', content: 'whoami' }, { action: 'finish' }];
        const safe = createEngine({ root: w.directory, chat: responses(actions) });
        const task = safe.start(args); const result = await safe.wait(task.task_id);
        assert.deepEqual(result.changed_files, []); assert.equal(result.checks.length, 0);
    } finally { w.close(); }
});

test('read-only file cannot be modified and syntax failure prevents integration', async () => {
    const w = workspace();
    try {
        const engine = createEngine({ root: w.directory, chat: responses(edits()) });
        const task = engine.start({ ...args, writable_files: [] }); await engine.wait(task.task_id);
        assert.deepEqual(engine.review(task.task_id).changed_files, []);
        const invalid = createEngine({ root: w.directory, chat: responses([{ action: 'write_file', path: 'public/demo.js', content: 'function broken( {' }, { action: 'finish' }]) });
        const broken = invalid.start(args); assert.equal((await invalid.wait(broken.task_id)).state, 'checks_failed');
        assert.throws(() => invalid.review(broken.task_id), /not ready/);
    } finally { w.close(); }
});

test('syntax checks do not execute staged code, even with NODE_OPTIONS in host', async () => {
    const w = workspace();
    try {
        const marker = path.join(w.directory, 'should-not-exist');
        const source = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');\n`;
        const engine = createEngine({ root: w.directory, chat: responses([{ action: 'write_file', path: 'public/demo.js', content: source }, { action: 'finish' }]) });
        const task = engine.start(args); assert.equal((await engine.wait(task.task_id)).state, 'ready_for_review');
        assert.equal(fs.existsSync(marker), false);
    } finally { w.close(); }
});

test('directory junctions cannot escape the explicit file policy', () => {
    const w = workspace(), outside = workspace();
    try {
        const link = path.join(w.directory, 'public/link');
        fs.symlinkSync(path.join(outside.directory, 'public'), link, process.platform === 'win32' ? 'junction' : 'dir');
        assert.throws(() => safePath(fs.realpathSync(w.directory), 'public/link/demo.js'), /Links/);
    } finally { w.close(); outside.close(); }
});

test('cancel aborts a request without changing original files', async () => {
    const w = workspace();
    try {
        const engine = createEngine({ root: w.directory, chat: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })) });
        const task = engine.start(args); assert.throws(() => engine.start(args), /already running/);
        engine.cancel(task.task_id); assert.equal((await engine.wait(task.task_id)).state, 'cancelled');
        assert.match(fs.readFileSync(path.join(w.directory, 'public/demo.js'), 'utf8'), /a - b/);
    } finally { w.close(); }
});

test('MCP stdio initializes and exposes local coding tools without stdout pollution', async () => {
    const child = spawn(process.execPath, ['scripts/ollama-coder/server.cjs'], { cwd: path.resolve(__dirname, '../..'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => error += data);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    child.stdin.end(); await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    const messages = output.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(error, ''); assert.equal(messages[0].result.serverInfo.name, 'marketthrough-ollama-coder');
    assert.deepEqual(messages[1].result.tools.map(tool => tool.name), ['start_task', 'task_status', 'review_task', 'apply_task', 'cancel_task']);
});
