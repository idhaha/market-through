const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const dayKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const validCode = code => /^[0-9A-Za-z]{6}$/.test(code);
const fields = ['individual', 'foreign', 'institution', 'program'];
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

function createSupplyStore({ directory, now = Date.now, fields: valueFields = fields }) {
    const configFile = path.join(directory, 'watchlist.json');
    function atomicBytes(filename, bytes) {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        const temporary = `${filename}.${process.pid}.tmp`;
        try {
            fs.writeFileSync(temporary, bytes);
            fs.renameSync(temporary, filename);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    const atomic = (filename, value) => atomicBytes(filename, JSON.stringify(value));
    function read(filename, fallback) {
        try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
    }
    function config() {
        const saved = read(configFile, { revision: 0, stocks: [], archive: [] });
        if (!Array.isArray(saved.stocks) || !Array.isArray(saved.archive) || saved.stocks.length > 5
            || [...saved.stocks, ...saved.archive].some(stock => !validCode(stock.code))) throw failure('수급 종목 설정 파일을 확인해 주세요.', 500);
        return saved;
    }
    function configure(stocks, revision) {
        const previous = config();
        if (revision !== previous.revision) throw failure('다른 창에서 종목이 변경되었습니다. 다시 불러온 뒤 저장하세요.', 409);
        if (!Array.isArray(stocks) || stocks.length > 5 || stocks.some(stock => !validCode(stock.code))
            || new Set(stocks.map(stock => stock.code)).size !== stocks.length) throw failure('중복 없이 최대 5종목까지 지정할 수 있습니다.');
        const active = stocks.map(stock => ({ code: stock.code, name: stock.name,
            added_at: previous.stocks.find(item => item.code === stock.code)?.added_at || now() }));
        const archive = new Map([...previous.archive, ...previous.stocks, ...active].map(stock => [stock.code, stock]));
        const next = { revision: previous.revision + 1, stocks: active, archive: [...archive.values()] };
        atomic(configFile, next);
        return next;
    }
    function stockDirectory(code) {
        if (!validCode(code)) throw failure('잘못된 종목코드입니다.');
        return path.join(directory, code);
    }
    function dates(code) {
        try { return [...new Set(fs.readdirSync(stockDirectory(code)).filter(name => /^\d{4}-\d{2}-\d{2}\.json(\.gz)?$/.test(name)).map(name => name.slice(0, 10)))].sort(); }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    }
    function points(code, day) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw failure('잘못된 날짜입니다.');
        const filename = path.join(stockDirectory(code), `${day}.json`);
        // A leftover plain file takes precedence after an interrupted archive operation.
        let rows;
        try { rows = JSON.parse(fs.readFileSync(filename, 'utf8')); }
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            try { rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${filename}.gz`)).toString('utf8')); }
            catch (compressedError) { if (compressedError.code === 'ENOENT') return []; throw compressedError; }
        }
        if (!Array.isArray(rows)) throw failure('수급 분봉 파일 형식 오류', 500);
        return rows;
    }
    function merge(code, point) {
        const t = Math.floor(point.t / 60000) * 60000;
        if (!Number.isFinite(t) || t <= 0 || t > now()) throw failure('잘못된 수집 시각입니다.');
        const day = dayKey(t), rows = points(code, day), byTime = new Map(rows.map(row => [row.t, row]));
        const next = { ...(byTime.get(t) || {}), t };
        for (const field of valueFields) {
            if (Number.isSafeInteger(point[field])) {
                next[field] = point[field];
                next[`${field}_at`] = point[`${field}_at`] ?? point.t;
            }
        }
        if (!valueFields.some(field => Number.isSafeInteger(next[field]))) return;
        byTime.set(t, next);
        const filename = path.join(stockDirectory(code), `${day}.json`);
        const data = [...byTime.values()].sort((a, b) => a.t - b.t);
        if (!fs.existsSync(filename) && fs.existsSync(`${filename}.gz`))
            atomicBytes(`${filename}.gz`, zlib.gzipSync(JSON.stringify(data), { level: 9 }));
        else atomic(filename, data);
    }
    function archiveCompleted() {
        const current = now(), today = dayKey(current), korean = new Date(current + 9 * 3600000);
        const closed = korean.getUTCHours() * 60 + korean.getUTCMinutes() >= 1202;
        let folders;
        try { folders = fs.readdirSync(directory, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
        let count = 0;
        for (const folder of folders) {
            if (!folder.isDirectory() || !validCode(folder.name)) continue;
            const target = stockDirectory(folder.name);
            for (const name of fs.readdirSync(target)) {
                if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
                const day = name.slice(0, 10);
                if (day > today || day === today && !closed) continue;
                const filename = path.join(target, name), bytes = fs.readFileSync(filename);
                if (!Array.isArray(JSON.parse(bytes.toString('utf8')))) throw failure('수급 분봉 파일 형식 오류', 500);
                atomicBytes(`${filename}.gz`, zlib.gzipSync(bytes, { level: 9 }));
                // Read back and verify before removing the uncompressed source.
                if (!zlib.gunzipSync(fs.readFileSync(`${filename}.gz`)).equals(bytes)) throw failure('수급 압축 검증 실패', 500);
                fs.unlinkSync(filename); count++;
            }
        }
        return count;
    }
    function marketDay() { return read(path.join(directory, 'market-day.json'), null); }
    function confirmMarketDay(day, confirmedAt) { atomic(path.join(directory, 'market-day.json'), { day, confirmed_at: confirmedAt }); }
    return { config, configure, dates, points, merge, archiveCompleted, marketDay, confirmMarketDay };
}
module.exports = { createSupplyStore, dayKey, validCode, fields, failure };
