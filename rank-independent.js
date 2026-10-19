'use strict';
const crypto = require('crypto');

// Short-lived capability channel. No market credentials or disk persistence.
function createRankIndependentRelay({ now = Date.now, refresh, request, schedule = setInterval } = {}) {
    const channels = new Map();
    const ttl = 120000;
    const hash = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
    function prune() {
        for (const [id, channel] of channels) if (now() - Math.max(channel.ownerSeen, channel.peerSeen) > ttl) channels.delete(id);
    }
    function owner(req, res) {
        prune();
        const channel = channels.get(req.params.id);
        if (!channel || channel.owner !== req.authUser.email || channel.ownerKey !== hash(req.get('X-Rank-Owner'))) {
            res.status(404).json({ error: '독립창 연결이 종료되었습니다.' }); return null;
        }
        channel.ownerSeen = now(); return channel;
    }
    function peer(req, res) {
        prune();
        const channel = channels.get(req.params.id);
        const token = hash((req.get('Authorization') || '').replace(/^Bearer /, ''));
        if (!channel || !crypto.timingSafeEqual(Buffer.from(channel.token), Buffer.from(token))) {
            res.status(401).json({ error: '독립창 연결이 만료되었습니다.' }); return null;
        }
        channel.peerSeen = now(); return channel;
    }
    const intervals = { '5': 30000, '1': 60000, '2': 600000, '3': 3600000, '4': 30000 };
    const intervalFor = channel => intervals[channel.snapshot?.conditions?.refreshInterval] || 600000;
    async function update(channel) {
        if (!refresh || !channel.snapshot || channel.refreshing || channel.closed) return;
        channel.refreshing = true;
        const generation = channel.generation;
        try {
            const data = await refresh({ ...channel.snapshot, peerChart: channel.peerChart }, channel.owner);
            if (generation === channel.generation) {
                channel.data = { ...data, at: now() }; channel.error = false; channel.version++;
            }
        } catch { channel.error = true; }
        finally { channel.refreshing = false; channel.nextRefresh = generation === channel.generation ? now() + intervalFor(channel) : 0; }
    }
    if (refresh) {
        const timer = schedule(() => {
            prune();
            for (const channel of channels.values()) if (channel.peerSeen && now() - channel.peerSeen < ttl && now() >= channel.nextRefresh) update(channel);
        }, 1000);
        timer.unref?.();
    }
    async function executeRequest(channel, command) {
        channel.requests = (channel.requests || 0) + 1;
        try {
            const result = await request(command, channel.owner);
            if (command.path === '/api/concentration-chart' && !command.body?.cursor && !command.body?.debug_five && result.success && channel.snapshot) {
                const chart = { ...channel.snapshot.chart, selection: command.pinned ? channel.snapshot.chart?.selection : command.selection,
                    mode: command.body.mode, interval: command.body.interval };
                if (!command.pinned) {
                    Object.assign(chart, { points: result.points, cursor: result.cursor, hasMore: result.has_more, busy: false, status: '조회 완료' });
                    channel.snapshot.chart = chart; channel.pendingChart = chart;
                    channel.generation++; channel.nextRefresh = 0;
                    if (channel.data) channel.data.chart = chart;
                    channel.version++;
                    channel.commands.push({ id: crypto.randomUUID(), type: 'server-chart', chart });
                }
            }
            channel.replies[command.id] = { id: command.id, status: 200, body: JSON.stringify(result) };
        } catch (error) { channel.replies[command.id] = { id: command.id, status: 502, body: JSON.stringify({ success: false, error: error.message }) }; }
        finally {
            channel.requests--;
            while (Object.keys(channel.replies).length > 32 || Buffer.byteLength(JSON.stringify(channel.replies)) > 4000000) delete channel.replies[Object.keys(channel.replies)[0]];
        }
    }
    function mount(app) {
        app.use('/api/rank-independent', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
        app.post('/api/rank-independent', (req, res) => {
            prune();
            if (channels.size >= 8 || [...channels.values()].filter(channel => channel.owner === req.authUser.email).length >= 2) return res.status(503).json({ error: '열린 독립창을 닫고 다시 실행하세요.' });
            const id = crypto.randomBytes(16).toString('hex');
            const token = crypto.randomBytes(32).toString('hex');
            const ownerKey = crypto.randomBytes(32).toString('hex');
            channels.set(id, { owner: req.authUser.email, ownerKey: hash(ownerKey), token: hash(token),
                generation: 0, nextRefresh: 0, refreshing: false, data: null, error: false, overrides: {}, ownerSeen: now(), peerSeen: 0, snapshot: null, version: 0, commands: [], commandIds: new Set(), replies: {}, closed: false });
            res.json({ id, token, ownerKey });
        });
        app.post('/api/rank-independent/:id/owner', (req, res) => {
            const channel = owner(req, res); if (!channel) return;
            const acknowledgements = new Set((req.body.acks || []).slice(0, 32));
            channel.commands = channel.commands.filter(command => !acknowledgements.has(command.id));
            if (req.body.snapshot) {
                if (Buffer.byteLength(JSON.stringify(req.body.snapshot)) > 2000000) return res.status(413).json({ error: '데이터가 너무 큽니다.' });
                const incoming = req.body.snapshot;
                if (channel.pendingChart) {
                    const key = chart => JSON.stringify([chart?.selection?.code, chart?.mode, chart?.interval]);
                    if (key(incoming.chart) === key(channel.pendingChart)) channel.pendingChart = null;
                    else incoming.chart = channel.pendingChart;
                }
                for (const [key, value] of Object.entries(channel.overrides)) if (incoming.conditions?.[key] === value) delete channel.overrides[key];
                incoming.conditions = { ...incoming.conditions, ...channel.overrides };
                const key = value => JSON.stringify([value?.conditions, value?.chart?.selection?.code, value?.chart?.mode, value?.chart?.interval]);
                if (key(incoming) !== key(channel.snapshot)) { channel.generation++; channel.nextRefresh = 0; channel.data = null; }
                channel.snapshot = incoming; channel.version++;
            }
            for (const reply of (req.body.replies || []).slice(0, 32)) {
                if (typeof reply.id === 'string' && /^[a-f0-9-]{36}$/.test(reply.id) && Buffer.byteLength(JSON.stringify(reply)) <= 2000000) channel.replies[reply.id] = reply;
            }
            const replies = Object.keys(channel.replies);
            for (const key of replies.slice(0, Math.max(0, replies.length - 32))) delete channel.replies[key];
            while (Buffer.byteLength(JSON.stringify(channel.replies)) > 4000000) delete channel.replies[Object.keys(channel.replies)[0]];
            res.json({ commands: channel.commands.slice(), connected: channel.peerSeen > 0 && now() - channel.peerSeen < ttl, closed: channel.closed });
        });
        app.delete('/api/rank-independent/:id/owner', (req, res) => {
            if (!owner(req, res)) return; channels.delete(req.params.id); res.json({ success: true });
        });
        app.post('/api/rank-independent/peer/:id', (req, res) => {
            const channel = peer(req, res); if (!channel) return;
            if (req.body.pinned === false) channel.peerChart = null;
            for (const id of (req.body.acks || []).slice(0, 32)) delete channel.replies[id];
            if (req.body.close) channel.closed = true;
            if (req.body.command) {
                const id = req.body.command.id;
                if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return res.status(400).json({ error: '잘못된 명령 ID입니다.' });
                if (channel.commands.length >= 32 || (channel.requests || 0) >= 4 || Buffer.byteLength(JSON.stringify(req.body.command)) > 8192) return res.status(429).json({ error: '요청이 너무 많습니다.' });
                if (!channel.commandIds.has(id)) {
                    const command = req.body.command;
                    if (command.type === 'request' && command.path === '/api/concentration-chart' && command.pinned && !command.body?.cursor && !command.body?.debug_five) {
                        channel.peerChart = { selection: command.selection, mode: command.body?.mode, interval: command.body?.interval };
                    }
                    if (command.type === 'conditions') {
                        for (const [key, value] of Object.entries(command.values || {})) {
                            const allowed = { mrktTp: ['000', '001', '101'], stexTp: ['1', '2', '3'], refreshInterval: Object.keys(intervals) };
                            if (allowed[key]?.includes(value)) channel.overrides[key] = value;
                        }
                        if (channel.snapshot) channel.snapshot.conditions = { ...channel.snapshot.conditions, ...channel.overrides };
                        channel.generation++; channel.nextRefresh = 0; channel.version++;
                    }
                    if (command.type === 'refresh') { channel.generation++; channel.nextRefresh = 0; }
                    if (command.type === 'request' && request && /^\/api\/concentration-(chart|stock|stocks)(\?|$)/.test(command.path || '')) executeRequest(channel, command);
                    else channel.commands.push(command);
                    channel.commandIds.add(id);
                    while (channel.commandIds.size > 128) channel.commandIds.delete(channel.commandIds.values().next().value);
                }
            }
            const replies = Object.values(channel.replies);
            res.json({ version: channel.version, snapshot: Number(req.body.version) === channel.version ? null : channel.snapshot, replies, serverRefresh: refresh ? { data: channel.data, interval: intervalFor(channel), error: channel.error, serverNow: now() } : null });
        });
    }
    return { mount };
}
module.exports = { createRankIndependentRelay };
