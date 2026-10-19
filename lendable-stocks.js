const { inflateRawSync } = require('node:zlib');

// Official KIS master ZIPs contain one .mst file. Read through the central
// directory so ZIP data descriptors do not affect the compressed size.
function readMasterZip(input, filename) {
    const zip = Buffer.from(input);
    let end = zip.length - 22;
    const minimum = Math.max(0, end - 65535);
    while (end >= minimum && zip.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < minimum) throw new Error('Invalid master ZIP');
    let offset = zip.readUInt32LE(end + 16);
    const count = zip.readUInt16LE(end + 10);
    for (let i = 0; i < count; i++) {
        if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory');
        const method = zip.readUInt16LE(offset + 10);
        const size = zip.readUInt32LE(offset + 20);
        const nameSize = zip.readUInt16LE(offset + 28);
        const name = zip.subarray(offset + 46, offset + 46 + nameSize).toString();
        if (name === filename) {
            const local = zip.readUInt32LE(offset + 42);
            const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
            const data = zip.subarray(dataStart, dataStart + size);
            if (method === 0) return data;
            if (method === 8) return inflateRawSync(data, { maxOutputLength: 16 * 1024 * 1024 });
            throw new Error('Unsupported master ZIP compression');
        }
        offset += 46 + nameSize + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
    }
    throw new Error('Master file missing from ZIP');
}

async function loadStockCodes(http) {
    const codes = new Set();
    for (const market of ['kospi', 'kosdaq']) {
        const filename = `${market}_code.mst`;
        const response = await http.get(`https://new.real.download.dws.co.kr/common/master/${filename}.zip`, {
            responseType: 'arraybuffer', timeout: 15000, maxContentLength: 8 * 1024 * 1024,
            params: { _t: Date.now() }, headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
        });
        // Codes occupy the first nine ASCII bytes. Korean names need no decoding.
        const lines = readMasterZip(response.data, filename).toString('latin1').split('\n');
        // The final fixed-width field is the official lendable flag. This
        // selects candidates only; live quantities still come from CTSC2702R.
        const validLines = lines.map(line => line.replace(/\r$/, '')).filter(line => /^[0-9A-Z]{6}$/.test(line.slice(0, 9).trim()));
        const flagged = validLines.filter(line => line.endsWith('Y'));
        // A missing/unrecognized flag must not silently empty the universe.
        const marketCodes = (flagged.length ? flagged : validLines).map(line => line.slice(0, 9).trim());
        if (!marketCodes.length) throw new Error(`Empty ${market} master`);
        marketCodes.forEach(code => codes.add(code));
    }
    return [...codes];
}

function createLendableService({ http, log = () => {}, now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    loadCodes = () => loadStockCodes(http), ttl = 0 } = {}) {
    let identity = '';
    let state;
    function reset() {
        state = { items: new Map(), task: null, seed: null, batchSeed: new Map(), retryAt: 0, completedAt: 0, total: 0, checked: 0, errors: 0, pending: null, draft: null };
    }
    reset();

    async function query(config, code) {
        const response = await http.get(`${config.domain}/uapi/domestic-stock/v1/quotations/lendable-by-company`, {
            headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${await config.getToken()}`,
                appkey: config.appkey, appsecret: config.appsecret, tr_id: 'CTSC2702R', custtype: 'P', tr_cont: '' },
            params: { EXCG_DVSN_CD: '00', PDNO: code, THCO_STLN_PSBL_YN: 'Y', INQR_DVSN_1: '0', CTX_AREA_FK200: '', CTX_AREA_NK100: '' },
            timeout: 10000
        });
        const data = response.data || {};
        if (data.rt_cd != null && String(data.rt_cd) !== '0') throw new Error(`${data.msg_cd || data.rt_cd}: ${(data.msg1 || '').trim()}`);
        const rows = Array.isArray(data.output1) ? data.output1 : (Array.isArray(data.output) ? data.output : []);
        return rows.filter(item => {
            const pdno = String(item.pdno || '').trim();
            return /^[0-9A-Z]{6}$/.test(pdno) && (!code || pdno === code);
        });
    }

    async function scan(config, current) {
        try {
            // Include previously returned symbols even if the daily master
            // flag has not caught up with live availability yet.
            let codes = current.pending;
            if (!codes) {
                const universe = [...new Set([...(await loadCodes()), ...current.items.keys(), ...current.batchSeed.keys()])];
                current.total = universe.length;
                codes = universe.filter(code => !current.batchSeed.has(code));
            }
            current.checked = current.total - codes.length;
            current.errors = 0;
            const next = current.draft || new Map(current.batchSeed);
            const failed = [];
            log(`[eFriend] Individual lendable scan started: ${codes.length} codes`);
            for (const [index, code] of codes.entries()) {
                if (current !== state) return;
                await sleep(200);
                try {
                    let rows;
                    for (let attempt = 0; ; attempt++) {
                        try {
                            rows = await query(config, code);
                            break;
                        } catch (error) {
                            if (attempt >= 3) throw error;
                            log(`[eFriend] Retrying ${code} (${attempt + 1}/3): ${error.message}`);
                            await sleep(2000 * (attempt + 1));
                        }
                    }
                    next.delete(code);
                    for (const row of rows) {
                        const pdno = row.pdno.trim();
                        next.set(pdno, row);
                    }
                } catch (error) {
                    current.errors++;
                    failed.push(code);
                    log(`[eFriend] Individual lookup failed for ${code}: ${error.message}`);
                    await sleep(1000);
                    if (current.errors >= 20) {
                        current.pending = failed.concat(codes.slice(index + 1));
                        current.draft = next;
                        throw new Error('Pausing scan after 20 lookup failures; remaining codes will resume');
                    }
                }
                current.checked = current.total - (codes.length - index - 1) - failed.length;
                if (current.checked % 100 === 0) log(`[eFriend] Scan ${current.checked}/${current.total}, collected=${next.size}, errors=${current.errors}`);
            }
            // Keep previous entries when there were failures; only a clean scan
            // may replace the full snapshot and remove delisted instruments.
            if (!current.errors) current.items = next;
            if (!current.errors) current.completedAt = now();
            current.pending = failed.length ? failed : null;
            current.draft = failed.length ? next : null;
            current.retryAt = now() + (current.errors ? 60000 : ttl);
            log(`[eFriend] Scan finished: ${current.items.size} stocks, ${current.errors} errors`);
        } catch (error) {
            current.retryAt = now() + 60000;
            log(`[eFriend] Scan interrupted: ${error.message}`);
        }
    }

    async function getStocks(config, { refresh = true } = {}) {
        const key = JSON.stringify([config.domain, config.appkey, config.appsecret]);
        if (identity !== key) { identity = key; reset(); }
        const current = state;
        if (refresh && !current.task && now() >= current.retryAt) {
            current.seed = (async () => {
                if (!current.pending) {
                    // Reuse only this collection's fresh bulk result, never
                    // quantities left over from an earlier refresh.
                    current.batchSeed = new Map();
                    try {
                        for (const row of await query(config, '')) current.batchSeed.set(row.pdno.trim(), row);
                        if (!current.items.size) current.items = new Map(current.batchSeed);
                    } catch (error) { log(`[eFriend] Initial lookup failed: ${error.message}`); }
                }
            })();
            current.task = current.seed.then(() => scan(config, current)).finally(() => { current.task = null; });
            // Initial display uses the ordinary 100-row query without waiting
            // for thousands of individual lookups.
        }
        if (current.seed) await current.seed;
        return [...current.items.values()].map(item => ({ ...item }));
    }
    return { getStocks, query, getStatus: () => ({ total: state.total, checked: state.checked, errors: state.errors,
        count: state.items.size, running: !!state.task, completedAt: state.completedAt }), waitForIdle: () => state.task };
}

function createLendableViewCache({ now = Date.now, ttl = 30000 } = {}) {
    const states = new Map();
    return async function getView({ key, stocks, scan, enrich }) {
        let cached = states.get(key);
        if (!cached) {
            cached = { items: null, completedAt: null, updatedAt: 0, task: null };
            states.set(key, cached);
        }
        const copy = items => items.map(item => ({ ...item }));
        // Never issue quote/market requests alongside the full symbol scan.
        if (scan?.running || scan?.errors || !scan?.completedAt) return copy(cached.items || stocks);
        if (cached.task) return copy(await cached.task);
        if (cached.items && cached.completedAt === scan.completedAt && now() - cached.updatedAt < ttl) return copy(cached.items);
        cached.task = (async () => {
            const items = copy(stocks);
            await enrich(items);
            cached.items = copy(items);
            cached.completedAt = scan.completedAt;
            cached.updatedAt = now();
            return cached.items;
        })().finally(() => { cached.task = null; });
        return copy(await cached.task);
    };
}

module.exports = { createLendableService, createLendableViewCache, loadStockCodes, readMasterZip };
