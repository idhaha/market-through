const fs = require('node:fs');
const path = require('node:path');

const DAY = 24 * 60 * 60 * 1000;
const koreaDate = time => new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

function createRetainedLogs({ directory, names, now = Date.now }) {
    fs.mkdirSync(directory, { recursive: true });
    const allowed = new Set(names);
    let cleanedDate, timer;
    const datedName = (name, day) => {
        if (!allowed.has(name)) throw new Error('Unknown log file');
        return `${path.parse(name).name}.${day}.log`;
    };
    function prune() {
        const time = now(), today = koreaDate(time), yesterday = koreaDate(time - DAY);
        try {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                if (!entry.isFile()) continue;
                const match = /^(.*)\.(\d{4}-\d{2}-\d{2})\.log$/.exec(entry.name);
                if (!match || !allowed.has(`${match[1]}.log`)) continue;
                // Leave the old, undated files and unrelated files untouched.
                if (match[2] < yesterday) fs.unlinkSync(path.join(directory, entry.name));
            }
            cleanedDate = today;
        } catch (error) { console.error(`[Log retention] ${error.message}`); }
    }
    function scheduleMidnight() {
        const time = now();
        const nextMidnight = Date.parse(`${koreaDate(time + DAY)}T00:00:00+09:00`);
        timer = setTimeout(() => { prune(); scheduleMidnight(); }, Math.max(1, nextMidnight - time));
        timer.unref();
    }
    prune();
    scheduleMidnight();
    return {
        append(name, message) {
            const time = now(), day = koreaDate(time);
            const file = path.join(directory, datedName(name, day));
            if (cleanedDate !== day) prune();
            try { fs.appendFileSync(file, `[${new Date(time).toISOString()}] ${String(message)}\n`, 'utf8'); }
            catch (error) { console.error(`[Log write] ${name}: ${error.message}`); }
        },
        prune,
        close() { clearTimeout(timer); }
    };
}

module.exports = { createRetainedLogs };
