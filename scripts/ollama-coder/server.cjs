'use strict';
// Dependency-free MCP stdio transport. stdout is reserved for JSON-RPC frames.
const readline = require('node:readline');
const path = require('node:path');
const { createEngine } = require('./engine.cjs');
const engine = createEngine({ root: path.resolve(__dirname, '../..') });
const idSchema = { task_id: { type: 'string', description: 'ID returned by start_task' } };
const tools = [
    { name: 'start_task', description: 'SIMPLE coding only: HTML/CSS, boilerplate, naming or a bounded single-function refactor as defined in AGENTS.md. Codex must handle complex coding; this tool does not expand delegation scope. Works ONLY on listed file copies. Returns immediately; poll task_status, review_task, then apply_task. No shell; only node --check.',
        inputSchema: { type: 'object', properties: { instruction: { type: 'string' }, files: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
            writable_files: { type: 'array', items: { type: 'string' } }, model: { type: 'string', enum: ['qwen2.5-coder:7b', 'qwen2.5:14b'], default: 'qwen2.5-coder:7b' }, max_turns: { type: 'integer', minimum: 2, maximum: 24, default: 12 } }, required: ['instruction', 'files'], additionalProperties: false } },
    { name: 'task_status', description: 'Compact task state, changed paths and syntax check results. Does not return source text.', inputSchema: { type: 'object', properties: idSchema, required: ['task_id'], additionalProperties: false } },
    { name: 'review_task', description: 'Get changed-line windows and review token. Inspect staged files directly if a window is truncated. Required before applying.', inputSchema: { type: 'object', properties: idSchema, required: ['task_id'], additionalProperties: false } },
    { name: 'apply_task', description: 'Codex-only integration step after reviewing changes. Requires review token; rejects source conflicts or changed staged content. Not available to the local model.', inputSchema: { type: 'object', properties: { ...idSchema, review_token: { type: 'string' } }, required: ['task_id', 'review_token'], additionalProperties: false } },
    { name: 'cancel_task', description: 'Stop a running task without applying changes.', inputSchema: { type: 'object', properties: idSchema, required: ['task_id'], additionalProperties: false } }
];
const send = object => process.stdout.write(JSON.stringify(object) + '\n');
async function dispatch(message) {
    if (!Object.hasOwn(message, 'id')) return;
    const reply = result => send({ jsonrpc: '2.0', id: message.id, result });
    if (message.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'marketthrough-ollama-coder', version: '1.0.0' } });
    if (message.method === 'ping') return reply({});
    if (message.method === 'tools/list') return reply({ tools });
    if (message.method === 'tools/call') {
        const { name, arguments: args = {} } = message.params || {};
        try {
            let value;
            if (name === 'start_task') value = engine.start(args);
            else if (name === 'task_status') value = engine.status(args.task_id);
            else if (name === 'review_task') value = engine.review(args.task_id);
            else if (name === 'apply_task') value = engine.apply(args.task_id, args.review_token);
            else if (name === 'cancel_task') value = engine.cancel(args.task_id);
            else throw new Error('Unknown tool');
            return reply({ content: [{ type: 'text', text: JSON.stringify(value) }] });
        } catch (error) { return reply({ isError: true, content: [{ type: 'text', text: error.message }] }); }
    }
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
    try { if (Buffer.byteLength(line) > 128 * 1024) throw new Error('Request too large'); void dispatch(JSON.parse(line)).catch(() => {}); }
    catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON-RPC request' } }); }
});
input.on('close', () => process.exit(0));
