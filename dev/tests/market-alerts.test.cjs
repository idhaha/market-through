const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createMarketAlerts } = require('../../market-alert-service');
const packet = (status, market = '1') => JSON.stringify({ header: { tr_cd: 'JIF' }, body: { jangubun: market, jstatus: status } });
const initial = Date.parse('2026-10-30T10:00:00+09:00');

test('new circuit stages rearm after acknowledgement; repeated same stage does not', () => {
    let clock = initial;
    const service = createMarketAlerts({ now: () => clock });
    service.receive(packet('61'));
    const first = service.snapshot('owner').events[0];
    service.acknowledge('owner', [first.id]);
    const confirmedVersion = service.snapshot('owner').version;
    service.acknowledge('owner', []); service.acknowledge('owner', [first.id, 'unknown']);
    assert.equal(service.snapshot('owner').version, confirmedVersion, 'Empty peer polls and repeated acknowledgements must not write state');
    clock += 60000; service.receive(packet('61'));
    assert.equal(service.snapshot('owner').events.length, 1);
    assert.equal(service.snapshot('owner').events[0].acknowledged, true);
    service.receive(packet('68'));
    let events = service.snapshot('owner').events;
    assert.equal(events[0].active, false);
    assert.equal(events[1].stage, 2); assert.equal(events[1].acknowledged, false);
    service.acknowledge('owner', events.map(e => e.id));
    service.receive(packet('69')); events = service.snapshot('owner').events;
    assert.equal(events[2].stage, 3); assert.equal(events[2].acknowledged, false);
    assert.equal(events[2].visible, true); assert.equal(events[2].active, true);
    assert.equal(service.snapshot('another-user').events[0].acknowledged, false);
});

test('official release and resume keep event history and original receipt time', () => {
    let clock = initial;
    const service = createMarketAlerts({ now: () => clock });
    service.receive(packet('61')); clock += 1200000; service.receive(packet('62'));
    const release = clock;
    clock += 600000; service.receive(packet('63'));
    const event = service.snapshot('a').events[0];
    assert.equal(event.occurredAt, initial); assert.equal(event.releasedAt, release); assert.equal(event.resumedAt, clock);
    assert.equal(event.active, false); assert.equal(event.visible, true);
    clock += 1000; service.receive(packet('62'));
    assert.equal(service.snapshot('a').events[0].releasedAt, release);
    service.receive(packet('41', '2')); assert.equal(service.snapshot('a').events[0].visible, true);
    service.receive(packet('41')); assert.equal(service.snapshot('a').events[0].visible, false);
});

test('sidecar directions and markets are independent; foreign and unknown statuses never trigger', () => {
    const service = createMarketAlerts({ now: () => initial });
    service.receive(packet('61', '5')); service.receive(packet('99')); service.receive('invalid');
    assert.equal(service.snapshot('a').events.length, 0);
    service.receive(packet('64')); service.receive(packet('66', '2'));
    let events = service.snapshot('a').events;
    assert.deepEqual(events.map(e => [e.market, e.stage, e.active]), [['1', 'sell', true], ['2', 'buy', true]]);
    service.receive(packet('65')); service.receive(packet('67', '2'));
    events = service.snapshot('a').events; assert.ok(events.every(e => !e.active && e.releasedAt === initial));
});

test('late release does not invent onset; persisted events and per-user acknowledgements survive restart', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-alerts-'));
    try {
        let clock = initial;
        let service = createMarketAlerts({ directory, now: () => clock });
        service.receive(packet('70'));
        const event = service.snapshot('a').events[0];
        assert.equal(event.occurredAt, null); assert.equal(event.stage, 2);
        service.acknowledge('a', [event.id]);
        clock += 60000; service = createMarketAlerts({ directory, now: () => clock });
        assert.equal(service.snapshot('a').events[0].acknowledged, true);
        assert.equal(service.snapshot('b').events[0].acknowledged, false);
        assert.match(service.snapshot('a').historyWarning, /미확인/);
        const saved = fs.readFileSync(path.join(directory, 'state.json'), 'utf8');
        assert.ok(!saved.includes('token')); assert.ok(!saved.includes('"a"'));
        clock += 86400000; assert.equal(service.snapshot('a').events.length, 0);
        assert.throws(() => service.acknowledge('a', 'bad'), /잘못된/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('diagnostics are bounded and whitelist fields', () => {
    const service = createMarketAlerts({ now: () => initial });
    for (let i = 0; i < 205; i++) service.receive(JSON.stringify({ header: { tr_cd: 'JIF', token: 'private' }, body: { jangubun: '1', jstatus: '21', secret: 'private' } }));
    assert.equal(service.diagnostics().samples.length, 200);
    assert.ok(!JSON.stringify(service.diagnostics()).includes('private'));
});

test('transport subscribes using official key and leaves credentials out of snapshots', async () => {
    let ws;
    class FakeSocket extends EventEmitter {
        constructor(url) { super(); this.url = url; ws = this; }
        send(value) { this.sent = JSON.parse(value); }
        terminate() { this.emit('close'); }
        close() { this.emit('close'); }
        ping() {}
    }
    const service = createMarketAlerts({ WebSocket: FakeSocket, getToken: async () => 'private', now: () => initial });
    service.start(); await new Promise(resolve => setImmediate(resolve));
    ws.emit('open'); assert.equal(ws.sent.body.tr_key, '0'); assert.equal(ws.sent.body.tr_cd, 'JIF');
    ws.emit('message', JSON.stringify({ header: { tr_cd: 'JIF', rsp_cd: '00000' } }));
    assert.equal(service.snapshot('a').connection, 'JIF 구독 중');
    ws.emit('message', packet('61')); assert.equal(service.snapshot('a').events[0].stage, 1);
    assert.ok(!JSON.stringify(service.snapshot('a')).includes('private'));
    service.stop(); assert.equal(service.snapshot('a').connection, '수신 중지');
});

test('independent peer reads owner acknowledgement but cannot acknowledge alerts', () => {
    const service = createMarketAlerts({ now: () => initial }); service.receive(packet('61'));
    const routes = new Map();
    const app = { use() {}, post(p, f) { routes.set('POST ' + p, f); }, delete(p, f) { routes.set('DELETE ' + p, f); } };
    require('../../rank-independent').createRankIndependentRelay({ now: () => initial, marketAlerts: service }).mount(app);
    function call(route, ticket = {}, body = {}, token = ticket.token) {
        let result, status = 200;
        routes.get('POST ' + route)({ params: { id: ticket.id }, authUser: { email: 'owner' }, body,
            get: name => name === 'Authorization' ? 'Bearer ' + token : ticket.ownerKey },
        { set() { return this; }, status(value) { status = value; return this; }, json(value) { result = value; } });
        return { status, result };
    }
    const ticket = call('/api/rank-independent').result;
    const id = service.snapshot('owner').events[0].id;
    assert.equal(call('/api/rank-independent/peer/:id', ticket, { marketAlertAck: [id] }, 'wrong').status, 401);
    assert.equal(service.snapshot('owner').events[0].acknowledged, false);
    assert.equal(call('/api/rank-independent/peer/:id', ticket, { marketAlertAck: [id] }).status, 403);
    assert.equal(service.snapshot('owner').events[0].acknowledged, false);
    service.acknowledge('owner', [id]);
    assert.equal(call('/api/rank-independent/peer/:id', ticket).result.marketAlerts.events[0].acknowledged, true);
    service.receive(packet('68'));
    assert.equal(call('/api/rank-independent/peer/:id', ticket).result.marketAlerts.events[1].acknowledged, false);
    assert.equal(call('/api/rank-independent/peer/:id', ticket, { marketAlertAck: 'bad' }).status, 403);
});
