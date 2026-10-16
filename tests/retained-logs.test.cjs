const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRetainedLogs } = require('../retained-logs');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-through-log-test-'));
const names = ['server_debug.log', 'puppeteer_debug.log'];
const file = name => path.join(directory, name);
const read = name => fs.readFileSync(file(name), 'utf8');
let logger;
try {
    let now = Date.parse('2026-10-16T23:59:59+09:00');
    for (const name of ['server_debug.2026-10-14.log', 'puppeteer_debug.2026-10-14.log',
        'server_debug.2026-10-15.log', 'puppeteer_debug.2026-10-15.log',
        'server_debug.log', 'puppeteer_debug.log', 'unrelated.2026-10-01.log']) fs.writeFileSync(file(name), 'existing data');
    logger = createRetainedLogs({ directory, names, now: () => now });
    assert.equal(fs.existsSync(file('server_debug.2026-10-14.log')), false);
    assert.equal(fs.existsSync(file('puppeteer_debug.2026-10-14.log')), false);
    assert.equal(read('server_debug.2026-10-15.log'), 'existing data');
    logger.append(names[0], 'before midnight\nstack trace');
    logger.append(names[1], 'browser error');
    assert.match(read('server_debug.2026-10-16.log'), /\[2026-10-16T14:59:59.000Z\] before midnight\nstack trace/);
    now += 1000;
    logger.append(names[0], 'after midnight');
    assert.equal(fs.existsSync(file('server_debug.2026-10-15.log')), false);
    assert.equal(fs.existsSync(file('puppeteer_debug.2026-10-15.log')), false);
    assert.match(read('server_debug.2026-10-16.log'), /before midnight/);
    assert.match(read('server_debug.2026-10-17.log'), /\[2026-10-16T15:00:00.000Z\] after midnight/);
    logger.close();
    now = Date.parse('2026-10-20T09:00:00+09:00');
    logger = createRetainedLogs({ directory, names, now: () => now });
    assert.equal(fs.existsSync(file('server_debug.2026-10-16.log')), false);
    assert.equal(fs.existsSync(file('server_debug.2026-10-17.log')), false);
    for (const name of ['server_debug.log', 'puppeteer_debug.log', 'unrelated.2026-10-01.log']) assert.equal(read(name), 'existing data');
    logger.append(names[0], 'resumed');
    assert.match(read('server_debug.2026-10-20.log'), /resumed/);
    assert.throws(() => logger.append('../other.log', 'bad'), /Unknown log file/);
    console.log('PASS Korean-date files, midnight rollover, today/yesterday retention, startup cleanup and untouched legacy/unrelated files');
} finally {
    logger?.close();
    for (const name of fs.readdirSync(directory)) fs.unlinkSync(file(name));
    fs.rmdirSync(directory);
}
