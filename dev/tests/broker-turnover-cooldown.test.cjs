const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBrokerTurnoverData } = require('../../broker-turnover-data');
const { timestamp } = require('../../supply-service');
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const mode of ['day', 'minute']) for (const failure of [false, true]) {
    test(`LS ${mode}: ${failure ? 'failed' : 'successful'} response returns before cooldown, next request waits`, async t => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-cooldown-'));
        t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
        const waits = [], calls = [];
        let released = false, firstResult, secondResult;
        const data = createBrokerTurnoverData({
            broker: 'ls', directory, now: () => timestamp('20261101', '120000'),
            transport: { setStreams() {} }, getToken: async () => 'test',
            pause: ms => {
                assert.equal(ms, 1100);
                return released ? Promise.resolve() : new Promise(resolve => waits.push(resolve));
            },
            http: { post: async (url, body) => {
                const tr = Object.keys(body)[0].replace('InBlock', '');
                calls.push(tr);
                if (failure && calls.length === 1) throw new Error('simulated HTTP failure');
                return { data: { rsp_cd: '00000', [tr + 'OutBlock1']: [{ date: '20261030', time: '090100', value: '2' }],
                    [tr + 'OutBlock']: { cts_date: '', cts_time: '' } } };
            } }
        });
        const first = data.amounts('005930', mode, ['20261030']).then(result => { firstResult = result; });
        const second = data.amounts('kospi', mode, ['20261030']).then(result => { secondResult = result; });
        try {
            await tick();
            assert.ok(firstResult, 'The received response must reach the caller while cooldown is blocked');
            assert.equal(firstResult.warnings.length, failure ? 1 : 0);
            if (!failure) assert.equal([...firstResult.values.values()][0], 2000000);
            assert.equal(calls.length, 1, 'The queued request must not start during cooldown');
            assert.equal(secondResult, undefined);
            assert.equal(waits.length, 1);
            waits.shift()();
            await tick();
            assert.equal(calls.length, 2);
            assert.ok(secondResult, 'The next response also returns before its own cooldown');
            assert.equal([...secondResult.values.values()][0], 2000000);
            assert.equal(secondResult.warnings.length, 0);
        } finally {
            released = true;
            waits.splice(0).forEach(resolve => resolve());
            await Promise.all([first, second]);
            data.stop();
        }
    });
}
