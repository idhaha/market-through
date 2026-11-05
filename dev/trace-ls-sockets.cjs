'use strict';
// Preload for diagnosing extra LS websocket connections (node --require dev/trace-ls-sockets.cjs server.js).
// Logs every TLS connection to port 9443: who opened it (project stack frames), when it connected, what it
// registered (tr_cd/tr_key sent through ws), bytes received and when/why it closed. Does not change behaviour.
// Output: LS_SOCKET_TRACE_OUT (default outputs/ls-socket-trace/trace.jsonl)
const fs = require('node:fs'), path = require('node:path'), tls = require('node:tls');
const root = path.resolve(__dirname, '..');
const file = path.resolve(root, process.env.LS_SOCKET_TRACE_OUT || 'outputs/ls-socket-trace/trace.jsonl');
fs.mkdirSync(path.dirname(file), { recursive: true });
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 23).replace('T', ' ');
const write = value => { try { fs.appendFileSync(file, JSON.stringify({ at: kst(Date.now()), pid: process.pid, ...value }) + '\n'); } catch {} };
// Only frames from this project (not node_modules / node internals) identify the opener.
const opener = () => String(new Error().stack).split('\n').slice(2).map(s => s.trim())
    .filter(s => s.includes(root) && !s.includes('node_modules') && !s.includes('trace-ls-sockets')).slice(0, 6)
    .map(s => s.replace(root + path.sep, ''));
let next = 1;
const originalConnect = tls.connect;
tls.connect = function (...args) {
    const socket = originalConnect.apply(this, args);
    const opts = args.find(a => a && typeof a === 'object') || {};
    const port = Number(opts.port ?? (typeof args[0] === 'number' ? args[0] : 0));
    if (port !== 9443) return socket;
    const id = next++, started = Date.now();
    socket.__lsTraceId = id;
    write({ type: 'connect', id, host: opts.host || opts.servername, stack: opener() });
    socket.once('secureConnect', () => write({ type: 'connected', id, localPort: socket.localPort, remote: socket.remoteAddress }));
    socket.once('close', hadError => write({ type: 'close', id, localPort: socket.localPort, hadError, aliveSec: Math.round((Date.now() - started) / 1000), bytesRead: socket.bytesRead, closeStack: opener() }));
    return socket;
};
// Which subscriptions each socket carries (ws send of LS JSON bodies), and who closes/terminates it.
try {
    const WS = require(require.resolve('ws', { paths: [root] }));
    const sendOriginal = WS.prototype.send, closeOriginal = WS.prototype.close, terminateOriginal = WS.prototype.terminate;
    const idOf = ws => ws._socket?.__lsTraceId ?? null;
    WS.prototype.send = function (data, ...rest) {
        if (idOf(this) != null) { try { const b = JSON.parse(String(data)).body || {}; write({ type: 'send', id: idOf(this), tr_cd: b.tr_cd, tr_key: b.tr_key }); } catch {} }
        return sendOriginal.call(this, data, ...rest);
    };
    WS.prototype.close = function (...a) { if (idOf(this) != null) write({ type: 'ws_close_call', id: idOf(this), stack: opener() }); return closeOriginal.apply(this, a); };
    WS.prototype.terminate = function (...a) { if (idOf(this) != null) write({ type: 'ws_terminate_call', id: idOf(this), stack: opener() }); return terminateOriginal.apply(this, a); };
} catch (e) { write({ type: 'ws_patch_failed', message: String(e.message).slice(0, 120) }); }
// Periodic snapshot of open traced sockets.
setInterval(() => {
    const open = (process._getActiveHandles?.() || []).filter(h => h && h.__lsTraceId).map(h => ({ id: h.__lsTraceId, localPort: h.localPort, bytesRead: h.bytesRead, destroyed: h.destroyed }));
    write({ type: 'snapshot', open });
}, 60000).unref();
write({ type: 'trace_started' });
