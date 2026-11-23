'use strict';
// 종목 선물 수급 card (LS, stock futures of the registered stocks). Contracts, not amounts.
//  - Investor flow: t8463 (30 s cumulative rows, today bgubun 0 / previous session bgubun 1), collected every
//    minute during the futures day session and kept per day; t8462 (daily net) for the day chart.
//    bsc_asts_id and the nearest contract come from t2522 (e.g. 005930 → S11, A116B000).
//  - Price candles: 1-minute bars from KIS FHKIF03020200 (the day's nearest contract, back to 2025-10-29), asked when
//    shown; finished days are saved once under candles/<code>/ (2026-11-22); t8405 daily bars with futcheck 1 (nearest months joined = 연결선물) for the day chart.
// Fields: ind/for/sys msvol = 개인/외국인/기관계 net contracts; t8462 sv_08/sv_17/sv_18 the same per day.
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
const dayKey = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
const compact = day => day.replaceAll('-', '');
const dashed = ymd => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
const at = (ymd, hhmmss = '000000') => Date.parse(`${dashed(ymd)}T${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}+09:00`);
const num = v => v == null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const validCode = code => /^[0-9A-Z]{6}$/.test(String(code || ''));

function createLsStockFutures({ http, getToken, directory, supply, now = Date.now, policy = () => require('./trading-session').current(),
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)), log = () => {}, kisMinute = null, collects = () => true }) {
    let master = null, masterTask = null, timer = null, running = null;
    const dailyCandles = new Map(), dailyFlow = new Map(), status = new Map(), starts = new Map(), probed = new Map(), minuteBars = new Map(), minuteFailureLogged = new Map();
    // LS allows one call per second per TR (shared app key), so starts of the same TR are 1.1 s apart. Calls may overlap:
    // t8463 takes about 10 s on the LS side whatever the count (2026-11-07), and overlapping calls were all answered.
    // cont: continuation request (tr_cont Y); t8405 needs it for older pages.
    // t8463 often took more than 20 s on a trading day (2026-11-09: 424 timeouts at 20 s, 270 of 456 runs failed);
    // collection runs once a minute and never overlaps itself, so 45 s still fits.
    const T8463_TIMEOUT = 45000;
    function rest(tr, endpoint, input, cont = false) {
        const turn = (starts.get(tr) || Promise.resolve()).then(() => undefined);
        starts.set(tr, turn.then(() => pause(1100)));
        const task = turn.then(async () => {
            const response = await http.post(`https://openapi.ls-sec.co.kr:8080/futureoption/${endpoint}`, { [tr + 'InBlock']: input },
                { headers: { authorization: 'Bearer ' + await getToken(), 'Content-Type': 'application/json; charset=utf-8', tr_cd: tr, tr_cont: cont ? 'Y' : 'N', tr_cont_key: '' }, timeout: tr === 't8463' ? T8463_TIMEOUT : 20000 });
            if (String(response.data?.rsp_cd) !== '00000') throw failure(`LS ${tr} 조회 실패 (${response.data?.rsp_cd || response.status})`, 502);
            return response.data;
        });
        return task;
    }
    // ---- t2522: underlying → bsc_asts_id and nearest contract, once a day
    // Right after midnight on the day after an expiry, t2522 may still name the expired month as the nearest
    // (Oracle 2026-11-13 00:01: A116B000, the 11/12 expiry; the 11/14 00:01 list had A116C000). Such a list is asked
    // again, at most every 30 minutes, until LS names the month that the expiry calendar gives for today.
    const MASTER_RETRY_MS = 30 * 60000, MONTH_CHARS = '123456789ABC';
    function staleMaster(map, day) {
        const expected = kisContract({ id: 'S00' }, day), year = expected.startsWith('A') ? expected[3] : null, month = MONTH_CHARS[Number(expected.slice(-2)) - 1];
        if (!year) return false;
        const codes = [...map.values()].map(item => item.nearest).filter(code => /^A[0-9A-Z]{2}[0-9][1-9A-C]/.test(code));
        return codes.length > 0 && codes.filter(code => code[3] !== year || code[4] !== month).length * 2 > codes.length;
    }
    async function contracts() {
        const today = dayKey(now());
        if (master?.day === today && !(master.stale && now() - master.fetchedAt >= MASTER_RETRY_MS)) return master.map;
        if (masterTask) return masterTask;
        masterTask = (async () => {
            const file = path.join(directory, 'master.json');
            if (master?.day !== today) try {
                const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (saved.day === today) {
                    const map = new Map(saved.rows), fetchedAt = Number(saved.fetchedAt) || 0;
                    master = { day: today, map, fetchedAt, stale: staleMaster(map, today) };
                    if (!master.stale || now() - fetchedAt < MASTER_RETRY_MS) return map;
                }
            } catch {}
            let rows;
            try { rows = (await rest('t2522', 'market-data', { dummy: '' })).t2522OutBlock1 || []; }
            catch (error) { if (master?.day === today) { master.fetchedAt = now(); return master.map; } throw error; }
            const map = new Map(rows.filter(r => validCode(r.bsc_asts_is_cd) && /^S[0-9A-Z]{2}$/.test(String(r.bsc_asts_id || '').trim()))
                .map(r => [r.bsc_asts_is_cd, { id: String(r.bsc_asts_id).trim(), nearest: String(r.nmc_is_shrt_cd || '').trim(), name: String(r.bsc_asts_nm || '').trim() }]));
            if (!map.size) { if (master?.day === today) { master.fetchedAt = now(); return master.map; } throw failure('LS 주식선물 기초자산 목록이 비어 있습니다.', 502); }
            const fetchedAt = now(), stale = staleMaster(map, today);
            if (stale) log(`[종목 선물 수급] LS t2522 최근월물이 아직 만기 지난 월물이라 30분 뒤 다시 받습니다 (${today})`);
            master = { day: today, map, fetchedAt, stale };
            try { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify({ day: today, fetchedAt, rows: [...map] })); fs.renameSync(file + '.tmp', file); } catch {}
            return map;
        })().finally(() => { masterTask = null; });
        return masterTask;
    }
    // Contract multiplier (shares per contract), rounded: 10 for stocks (10.08 for adjusted contracts), 100 for ETF
    // futures (t8402 mulcnt, 2026-11-08). The card multiplies net contracts by it to compare with 종목 수급 shares.
    const multipliers = new Map();
    async function multiplierOf(code, item) {
        const today = dayKey(now()), cached = multipliers.get(code);
        if (cached && (cached.day === today || now() - cached.at < 600000)) return cached.value;
        let value = null;
        try { const n = Number((await rest('t8402', 'market-data', { focode: item.nearest })).t8402OutBlock?.mulcnt); if (n > 0) value = Math.round(n); } catch {}
        // Fallback when t8402 fails: ETF names → 100, others 10; retried after 10 minutes.
        const estimated = !value;
        if (estimated) value = /^(KODEX|TIGER|PLUS|SOL|ACE|RISE|KBSTAR|HANARO|ARIRANG|KOSEF|KIWOOM|TIMEFOLIO|1Q)\b/i.test(item.name || '') ? 100 : 10;
        multipliers.set(code, { day: estimated ? '' : today, at: now(), value });
        return value;
    }
    async function contractOf(code) {
        if (!validCode(code)) throw failure('잘못된 종목 코드입니다.');
        const item = (await contracts()).get(code);
        if (!item) throw failure('주식선물이 없는 종목입니다.', 404);
        return item;
    }
    // ---- trading days (futures day session 08:45~): the latest session and the one before are what LS t8463 serves
    const isOpen = day => policy()?.openDate?.(day) !== false && ![0, 6].includes(new Date(day + 'T00:00:00Z').getUTCDay());
    function openBefore(day) {
        let t = Date.parse(day + 'T00:00:00Z');
        for (let i = 0; i < 20; i++) { t -= 86400000; const d = new Date(t).toISOString().slice(0, 10); if (isOpen(d)) return d; }
        return null;
    }
    function sessions(t = now()) {
        const today = dayKey(t), clock = new Date(t + 9 * 3600000), started = isOpen(today) && clock.getUTCHours() * 60 + clock.getUTCMinutes() >= 525;
        return { today, started, latest: started ? today : openBefore(today), previous: started ? openBefore(today) : null };
    }
    // ---- per-day minute files
    const dayFile = (code, day) => path.join(directory, code, `${day}.json`);
    function readDay(code, day) { try { return JSON.parse(fs.readFileSync(dayFile(code, day), 'utf8')); } catch { return null; } }
    function writeDay(code, day, value) {
        fs.mkdirSync(path.join(directory, code), { recursive: true });
        const file = dayFile(code, day); fs.writeFileSync(file + '.tmp', JSON.stringify(value)); fs.renameSync(file + '.tmp', file);
    }
    const storedDays = code => { try { return fs.readdirSync(path.join(directory, code)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort(); } catch { return []; } };
    // 30 s rows → one point per minute (the last row of each minute), cumulative net contracts.
    function minutePoints(rows) {
        const byMinute = new Map();
        for (const r of rows) {
            const date = String(r.date || ''), time = String(r.time || '').padStart(6, '0');
            if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time)) continue;
            const t = Math.floor(at(date, time) / 60000) * 60000;
            const point = { t, individual: num(r.indmsvol), foreign: num(r.formsvol), institution: num(r.sysmsvol), source_time: time };
            const old = byMinute.get(t);
            if (!old || old.source_time <= time) byMinute.set(t, point);
        }
        return [...byMinute.values()].sort((a, b) => a.t - b.t);
    }
    async function fetchFlow(item, previous) {
        const d = await rest('t8463', 'investor', { tm_rng: 'D', fot_clsf_cd: 'F', bsc_asts_id: item.id, cnt: 900, bgubun: previous ? '1' : '0' });
        return d.t8463OutBlock1 || [];
    }
    // Store one session's flow rows (price bars are not stored; they come from KIS when shown).
    async function refreshDay(code, item, { previous = false } = {}) {
        const rows = await fetchFlow(item, previous);
        const date = rows.map(r => String(r.date || '')).find(d => /^\d{8}$/.test(d));
        if (!date) return null;
        const day = dashed(date), saved = readDay(code, day) || { day, points: [] };
        saved.points = minutePoints(rows.filter(r => String(r.date) === date));
        delete saved.candles; delete saved.candleSource;
        saved.contract = item.nearest; saved.updatedAt = now();
        writeDay(code, day, saved);
        return saved;
    }
    // ---- collection: registered stocks, futures day session 08:45~15:46 and the after-close row (~16:10)
    function collectingAt(t) {
        const clock = new Date(t + 9 * 3600000), minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
        const open = policy()?.openDate?.(dayKey(t));
        return open !== false && ![0, 6].includes(clock.getUTCDay()) && minute >= 525 && minute <= 980;
    }
    async function collect() {
        if (running) return running;
        running = (async () => {
            if (!collectingAt(now())) return;
            const started = now(), stocks = supply.summary().stocks || [], map = await contracts(), today = dayKey(started), results = [];
            // Stocks overlap (starts spaced by rest()), so five stocks take about 15 s instead of about 55 s.
            await Promise.all(stocks.map(async stock => {
                const item = map.get(stock.code);
                if (!item) { status.set(stock.code, { checked_at: now(), error: '주식선물 없음' }); return; }
                try { await refreshDay(stock.code, item); status.set(stock.code, { checked_at: now(), error: '' }); results.push({ code: stock.code, contract: item.nearest }); }
                catch (error) { status.set(stock.code, { checked_at: now(), error: error.message }); results.push({ code: stock.code, error: error.message }); }
            }));
            // One line per run (time taken, failures such as LS call limits) for the scheduled collection check.
            try { fs.mkdirSync(directory, { recursive: true }); fs.appendFileSync(path.join(directory, `collect-${today}.jsonl`), JSON.stringify({ t: started, ms: now() - started, results }) + '\n'); } catch {}
        })().catch(error => log('[LS stock futures] ' + error.message)).finally(() => { running = null; });
        return running;
    }
    // collects(): false on servers that leave the 1-minute collection to Oracle (vi-alerts-host.js stockFuturesCollect, 2026-11-12).
    function start() { if (timer || !collects()) return; timer = setInterval(() => void collect(), 60000); timer.unref?.(); void collect(); }
    function stop() { clearInterval(timer); timer = null; }

    // ---- minute query: a stored day, today on demand, the previous session on demand (t8463 bgubun 1)
    // Stored files first; t8463 (about 10 s) only for a session LS still serves that is missing or not final.
    // Registered stocks are refreshed every minute by collect(), so a file up to 3 min old is used as is.
    // Outside the session LS answers the latest session with bgubun 1 (bgubun 0 is empty on a closed day).
    const final = saved => (saved?.points || []).some(p => String(p.source_time) >= '160000');
    async function minute(code, input) {
        const item = await contractOf(code), today = dayKey(now()), session = sessions();
        let date = input.date || (input.cursor ? dashed(input.cursor) : '') || session.latest || today;
        let saved = readDay(code, date);
        const registered = (supply.summary().stocks || []).some(s => s.code === code);
        // 2026-11-23: 장이 끝난 밤에 오늘을 물으면 t8463(bgubun 0)이 빈 목록을 주어 refreshDay가 null을 돌려주고, 저장해 둔
        // 오늘 분봉(08:45~16:11)을 버린 빈 응답이 나갔다(화면에 오늘 종목 선물 수급이 안 그려짐). 받은 것이 오늘이 아니면 저장분을 쓰고,
        // 수집이 끝난 뒤 마감 행까지 저장된 날은 LS를 다시 부르지 않는다.
        if (date === today && session.started && !(final(saved) && !collectingAt(now()))) {
            if (!saved || now() - (saved.updatedAt || 0) > (registered && collects() && collectingAt(now()) ? 180000 : 60000)) {
                const fetched = await refreshDay(code, item).catch(() => null);
                if (fetched?.day === date) saved = fetched;
            }
        } else if ((date === session.latest || date === session.previous) && !final(saved)) {
            // One try per day and 10 min: LS answers an empty or other day when it no longer serves this one.
            const key = code + ':' + date;
            if (!(now() - (probed.get(key) || 0) < 600000)) {
                probed.set(key, now()); if (probed.size > 200) probed.delete(probed.keys().next().value);
                const fetched = await refreshDay(code, item, { previous: true }).catch(() => null);
                if (fetched?.day === date) saved = fetched;
            }
        }
        const dates = storedDays(code), earlier = dates.filter(d => d < date).at(-1), multiplier = await multiplierOf(code, item);
        return { success: true, mode: 'minute', date, multiplier, available_dates: dates, points: (saved?.points || []).filter(p => p.t < Math.floor(now() / 60000) * 60000 || date !== today),
            has_more: !!earlier, cursor: earlier ? compact(earlier) : null, contract: saved?.contract || item.nearest,
            warnings: [], // How the values are collected is in the card's i guide, not the status line (it overflowed the card).
            status: { error: status.get(code)?.error || '' }, collecting: collects() && collectingAt(now()) };
    }
    // ---- 지난날 일봉 저장(2026-11-22, docs/CHART_DATA_STORAGE.md "지난날 일봉 저장"): <directory>/daily/<code>-flow.json.gz(t8462 수급),
    // <code>-candles.json.gz(t8405 연결선물 가격). 끝난 날만 두고 오늘(수급은 최근 이틀 포함)은 늘 LS에서 받는다.
    const dailyFile = (code, kind) => path.join(directory, 'daily', `${code}-${kind}.json.gz`);
    function readDaily(code, kind) {
        try { const v = JSON.parse(zlib.gunzipSync(fs.readFileSync(dailyFile(code, kind)))); return v?.v === 1 && Array.isArray(v.rows) ? v : null; }
        catch (error) { if (error.code !== 'ENOENT') log(`[종목 선물 일봉] ${code} ${kind} 파일 읽기 실패: ${error.message}`); return null; }
    }
    function writeDaily(code, kind, value) {
        const file = dailyFile(code, kind), json = JSON.stringify({ v: 1, ...value }), packed = zlib.gzipSync(json);
        if (zlib.gunzipSync(packed).toString() !== json) return;
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, packed); fs.renameSync(temp, file); }
        catch (error) { log(`[종목 선물 일봉] ${code} ${kind} 저장 실패: ${error.message}`); }
    }
    // 저장본을 버린 기록(chart-revisions가 보고 브라우저 저장분을 한 번 버리게 한다).
    function markReset(code) {
        const file = path.join(directory, 'daily', 'resets.json');
        let value = { count: 0, recent: [] };
        try { const saved = JSON.parse(fs.readFileSync(file, 'utf8')); if (Number.isFinite(saved?.count)) value = { count: saved.count, recent: Array.isArray(saved.recent) ? saved.recent : [] }; } catch {}
        value.count++; value.recent = [...value.recent, { at: new Date(now()).toISOString(), code }].slice(-50);
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, file); }
        catch (error) { log(`[종목 선물 일봉] 초기화 기록 실패: ${error.message}`); }
    }
    // ---- day query: t8462, up to 179 days per call, newest first; the cursor is the day before the oldest row
    // 끝난 날(사흘 전까지, 확정치)은 파일에 두고, 저장된 마지막 날 다음 날부터만 LS에 묻는다(from_date).
    async function day(code, input) {
        const item = await contractOf(code);
        const to = input.cursor && /^\d{8}$/.test(input.cursor) ? input.cursor : compact(dayKey(now()));
        const key = `${code}:${to}`, cached = dailyFlow.get(key);
        if (cached && (input.cursor || now() - cached.at < 60000)) return cached.result;
        // Every page at once (t8462 answers fast). LS serves stock futures days only from 2026-02-11 (day, week and
        // month units alike, 2026-11-07), so a "더 불러오기" offer would only return nothing.
        const stored = readDaily(code, 'flow'), lastFinal = compact(dayKey(now() - 3 * 86400000));
        const rows = stored ? stored.rows.filter(r => String(r.date) <= to) : [];
        const from = stored ? compact(dayKey(at(stored.through) + 86400000)) : '19900101';
        let complete = false;
        if (!stored || to > stored.through) for (let page = 0, until = to; page < 20; page++) {
            const part = (await rest('t8462', 'investor', { tm_rng: 'D', fot_clsf_cd: 'F', bsc_asts_id: item.id, gubun2: '1', gubun3: '1', from_date: from, to_date: until })).t8462OutBlock1 || [];
            const dates = part.map(r => String(r.date)).filter(d => /^\d{8}$/.test(d)).sort();
            const fresh = part.filter(r => String(r.date) >= from && !rows.some(old => String(old.date) === String(r.date)));
            rows.push(...fresh);
            if (part.length < 150 || !fresh.length || !dates.length) { complete = true; break; }
            until = compact(dayKey(at(dates[0]) - 86400000));
        }
        // 처음부터(또는 저장된 날 다음부터) 끝까지 받았으면 끝난 날을 저장한다.
        const through = to < lastFinal ? to : lastFinal;
        if (complete && through > (stored?.through || '')) writeDaily(code, 'flow', { through,
            rows: rows.filter(r => /^\d{8}$/.test(String(r.date)) && String(r.date) <= through).map(r => ({ date: String(r.date), sv_08: r.sv_08, sv_17: r.sv_17, sv_18: r.sv_18 })).sort((a, b) => a.date.localeCompare(b.date)) });
        const points = rows.filter(r => /^\d{8}$/.test(String(r.date))).map(r => ({ t: at(String(r.date)), individual: num(r.sv_08), foreign: num(r.sv_17), institution: num(r.sv_18) })).sort((a, b) => a.t - b.t);
        const oldest = points[0] ? compact(dayKey(points[0].t - 86400000)) : null;
        const result = { success: true, mode: 'day', multiplier: await multiplierOf(code, item), points, has_more: false, cursor: null, oldest: points[0] ? dayKey(points[0].t) : null,
            warnings: [] };
        dailyFlow.set(key, { at: now(), result }); if (dailyFlow.size > 60) dailyFlow.delete(dailyFlow.keys().next().value);
        return result;
    }
    async function query(input = {}) {
        const code = String(input.code || ''), mode = input.mode || 'day';
        if (!['day', 'minute'].includes(mode) || input.cursor && !/^\d{8}$/.test(input.cursor) || input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw failure('잘못된 선물 수급 조회 조건입니다.');
        return mode === 'minute' ? minute(code, input) : day(code, input);
    }
    // ---- minute bars from KIS FHKIF03020200 (market JF, 2026-11-07). Up to 102 bars per call, newest first, from the
    // given time back; expired contracts are served too, from 2025-10-29 08:45 (earlier days answer nothing).
    // KIS codes: from 2026 'A' + underlying (S11 → 11) + year digit + month (A11611 = 삼성전자 2026-11, as in the KIS
    // stock futures master); 2025 contracts use the old form '1' + underlying + year letter + month (111W11).
    // Bars are labelled by their start minute (KIS 10:05 = LS t8406 10:06, same OHLC).
    const KIS_MINUTE_FIRST = '2025-10-29', YEAR_LETTERS = { 2021: 'R', 2022: 'S', 2023: 'T', 2024: 'V', 2025: 'W' };
    // The nearest contract of a day: the first month whose expiry (2nd Thursday, or the open day before) is on or after it.
    function expiryOf(year, month) {
        const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(), thursday = 1 + (4 - first + 7) % 7 + 7;
        let day = new Date(Date.UTC(year, month - 1, thursday)).toISOString().slice(0, 10);
        for (let i = 0; i < 7 && !isOpen(day); i++) day = new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
        return day;
    }
    function kisContract(item, day, after = 0) {
        let year = Number(day.slice(0, 4)), month = Number(day.slice(5, 7));
        if (day > expiryOf(year, month)) month += 1;
        month += after; while (month > 12) { month -= 12; year += 1; }
        const underlying = item.id.slice(1), mm = String(month).padStart(2, '0');
        return year >= 2026 ? 'A' + underlying + String(year % 10) + mm : '1' + underlying + (YEAR_LETTERS[year] || '?') + mm;
    }
    // On an expiry day the expiring month stops trading at 15:20 (its last bar is 15:19) while the flow runs to 15:45
    // (2026-11-12: A11611 last bar 15:19, A11612 bars to 15:45). The bars from 15:20 come from the next month.
    const ROLL_TIME = '152000';
    const isExpiryDay = day => isOpen(day) && day === expiryOf(Number(day.slice(0, 4)), Number(day.slice(5, 7)));
    // 한투에서 새 분봉을 받을 때 잠깐 끊기면 다시 묻는다(2026-11-22: 지난날 조회 중 socket hang up · 502가 가끔 났다).
    // 연결 끊김 · 시간 초과 · 한투 서버 오류(5xx) · 초당 건수 초과(EGW00201)만 1초, 2초 쉬고 두 번 더. 저장 파일에서 읽을 때는 해당 없음.
    const transient = error => /socket hang up|ECONNRESET|ETIMEDOUT|ECONNABORTED|EAI_AGAIN|timeout|EGW00201/i.test(`${error?.code || ''} ${error?.message || ''}`)
        || error?.response?.status >= 500;
    async function askKis(args) {
        for (let attempt = 0; ; attempt++) {
            try { return await kisMinute(args); }
            catch (error) { if (attempt >= 2 || !transient(error)) throw error; await pause(1000 * (attempt + 1)); }
        }
    }
    // Bars of one day from 'hour' back (all pages down to 08:45, or only the newest page to top up today's bars).
    async function fetchKisDay(item, day, { hour = '154600', pages = 8 } = {}) {
        const contract = kisContract(item, day), ymd = compact(day), bars = new Map();
        for (let page = 0; page < pages; page++) {
            const rows = await askKis({ code: contract, date: ymd, hour });
            const same = rows.filter(r => String(r.stck_bsop_date) === ymd);
            for (const r of same) {
                const time = String(r.stck_cntg_hour || '').padStart(6, '0'), t = at(ymd, time.slice(0, 4) + '00');
                const bar = { t, open: Math.abs(num(r.futs_oprc)), high: Math.abs(num(r.futs_hgpr)), low: Math.abs(num(r.futs_lwpr)), close: Math.abs(num(r.futs_prpr)) };
                if (Number.isFinite(t) && [bar.open, bar.high, bar.low, bar.close].every(v => v > 0)) bars.set(t, bar);
            }
            if (!same.length || same.length < rows.length) break;
            const earliest = same.map(r => String(r.stck_cntg_hour).padStart(6, '0')).sort()[0];
            if (earliest <= '084500') break;
            const previous = new Date(at(ymd, earliest) - 60000 + 9 * 3600000).toISOString().slice(11, 19).replaceAll(':', '');
            hour = previous;
            await pause(300);
        }
        let next = null;
        // Today before 15:20 there is nothing to add yet, so the next month is not asked.
        if (isExpiryDay(day) && !(day === dayKey(now()) && now() < at(ymd, ROLL_TIME))) {
            next = kisContract(item, day, 1);
            const rows = await askKis({ code: next, date: ymd, hour: '154600' });
            for (const r of rows) {
                const time = String(r.stck_cntg_hour || '').padStart(6, '0'); if (String(r.stck_bsop_date) !== ymd || time < ROLL_TIME) continue;
                const t = at(ymd, time.slice(0, 4) + '00'), bar = { t, open: Math.abs(num(r.futs_oprc)), high: Math.abs(num(r.futs_hgpr)), low: Math.abs(num(r.futs_lwpr)), close: Math.abs(num(r.futs_prpr)) };
                if (Number.isFinite(t) && [bar.open, bar.high, bar.low, bar.close].every(v => v > 0)) bars.set(t, bar);
            }
        }
        return { contract, next, candles: [...bars.values()].sort((a, b) => a.t - b.t) };
    }
    // ---- candles: minute from KIS (memory only), day from t8405 연결선물 back to the oldest day served
    // t8405 pages (100 days each, newest first) are kept per code for the day; older pages load on demand.
    // 지난날 가격은 <code>-candles.json.gz에 둔다. t8405는 최신 쪽부터만 이어 받을 수 있어, 새로 받은 쪽이 저장된 마지막 날에
    // 닿으면(linked) 저장본을 붙이고 그보다 옛날은 다시 묻지 않는다. 겹치는 날 종가가 다르면(수정) 저장본을 버린다.
    function dailyEntry(code) {
        let entry = dailyCandles.get(code);
        if (!entry || entry.day !== dayKey(now())) {
            const saved = readDaily(code, 'candles'), stored = saved?.rows.length ? { rows: new Map(saved.rows.map(r => [r.date, { t: r.t, open: r.open, high: r.high, low: r.low, close: r.close }])), exhausted: !!saved.exhausted } : null;
            entry = { day: dayKey(now()), code, rows: new Map(), next: null, exhausted: false, stored, linked: !stored }; dailyCandles.set(code, entry);
        }
        return entry;
    }
    function linkDaily(entry) {
        if (!entry.linked) {
            const newest = [...entry.stored.rows.keys()].sort().at(-1);
            if (!entry.exhausted && !(oldestDay(entry) <= newest)) return; // 아직 저장된 날까지 닿지 않음
            const changed = [...entry.rows].some(([d, v]) => entry.stored.rows.has(d) && entry.stored.rows.get(d).close !== v.close);
            if (changed) { log(`[종목 선물 일봉] ${entry.code} 지난 가격이 바뀌어 저장본을 새로 받습니다.`); markReset(entry.code); }
            else { for (const [d, v] of entry.stored.rows) if (!entry.rows.has(d)) entry.rows.set(d, v); if (entry.stored.exhausted) entry.exhausted = true; }
            entry.stored = null; entry.linked = true;
        }
        const today = compact(dayKey(now()));
        writeDaily(entry.code, 'candles', { exhausted: entry.exhausted, rows: [...entry.rows].filter(([d]) => d < today).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })) });
    }
    async function dailyPage(entry, item) {
        const input = { shcode: item.nearest, futcheck: '1', date: entry.next?.date || '', cts_code: entry.next?.cts_code || '', lastdate: entry.next?.lastdate || '', cnt: 100 };
        const d = await rest('t8405', 'market-data', input, !!entry.next);
        const rows = d.t8405OutBlock1 || [], header = d.t8405OutBlock || {};
        for (const r of rows) if (/^\d{8}$/.test(String(r.date))) entry.rows.set(String(r.date), { t: at(String(r.date)), open: Math.abs(num(r.open)), high: Math.abs(num(r.high)), low: Math.abs(num(r.low)), close: Math.abs(num(r.close)) });
        const next = { date: String(header.date || '').trim(), cts_code: String(header.cts_code || '').trim(), lastdate: String(header.lastdate || '').trim() };
        if (!rows.length || !next.date || next.date === entry.next?.date) entry.exhausted = true; else entry.next = next;
        linkDaily(entry);
    }
    const oldestDay = entry => [...entry.rows.keys()].sort()[0] || null;
    // 지난날 분봉 파일(2026-11-22): <directory>/candles/<code>/<YYYY-MM-DD>.json.gz. 한투 FHKIF03020200은 하루에 여러 쪽(한 쪽 102봉)이라
    // 지난날 하나에 7~20초 걸리고 끊기기도 해(socket hang up) 끝난 날은 한 번 받아 둔다. 다시 쓰지 않는다(한 벌).
    // 저장 조건: 오늘보다 이전, 08:45~09:00 사이에 시작해 15:19 이후까지 이어진 날(한투가 그날을 다 준 날).
    const candleFile = (code, date) => path.join(directory, 'candles', code, `${date}.json.gz`);
    function readCandleDay(code, date) {
        try { const v = JSON.parse(zlib.gunzipSync(fs.readFileSync(candleFile(code, date)))); return v?.v === 1 && Array.isArray(v.candles) ? v : null; }
        catch (error) { if (error.code !== 'ENOENT') log(`[종목 선물 분봉] ${code} ${date} 파일 읽기 실패: ${error.message}`); return null; }
    }
    function saveCandleDay(code, date, value) {
        const file = candleFile(code, date), bars = value.candles, clock = t => new Date(t + 9 * 3600000).toISOString().slice(11, 16);
        if (fs.existsSync(file) || !bars.length || clock(bars[0].t) > '09:00' || clock(bars.at(-1).t) < '15:19') return;
        const json = JSON.stringify({ v: 1, contract: value.contract, next: value.next || null, candles: bars }), packed = zlib.gzipSync(json);
        if (zlib.gunzipSync(packed).toString() !== json) return;
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; fs.writeFileSync(temp, packed); if (fs.existsSync(file)) fs.rmSync(temp, { force: true }); else fs.renameSync(temp, file); }
        catch (error) { log(`[종목 선물 분봉] ${code} ${date} 저장 실패: ${error.message}`); }
    }
    // Minute bars: a finished day from its file (or KIS once, then saved); today's open session every 20 s, topping up the newest page.
    async function minuteCandlesOf(code, item, date) {
        const contract = kisContract(item, date), key = code + ':' + date, cached = minuteBars.get(key), session = sessions();
        const live = date === session.today && session.started && collectingAt(now());
        if (!kisMinute || date < KIS_MINUTE_FIRST || !isOpen(date) || date > session.today) return { contract, candles: [] };
        if (cached && (!live && cached.final || live && now() - cached.at < 20000)) return cached;
        if (date < dayKey(now())) { const stored = readCandleDay(code, date); if (stored) return { contract: stored.contract, next: stored.next, candles: stored.candles, at: now(), final: true }; }
        let top;
        try { top = live && cached?.candles.length ? await fetchKisDay(item, date, { hour: '154600', pages: 1 }) : await fetchKisDay(item, date); }
        catch (error) {
            // KIS minute bars are not stored, so failures were invisible in the logs (2026-11-09 check). One line per stock-day per minute.
            const last = minuteFailureLogged.get(key) || 0;
            if (now() - last >= 60000) { minuteFailureLogged.set(key, now()); log(`[종목 선물 분봉] 한투 FHKIF03020200 조회 실패 ${code} ${contract} ${date}: ${String(error.message || error).slice(0, 120)}`); }
            throw error;
        }
        const merged = new Map((live && cached ? cached.candles : []).map(c => [c.t, c]));
        for (const c of top.candles) merged.set(c.t, c);
        const value = { contract, next: top.next, candles: [...merged.values()].sort((a, b) => a.t - b.t), at: now(), final: !live };
        if (date < dayKey(now())) saveCandleDay(code, date, value);
        minuteBars.delete(key); minuteBars.set(key, value); if (minuteBars.size > 120) minuteBars.delete(minuteBars.keys().next().value);
        return value;
    }
    async function candles(input = {}) {
        const code = String(input.code || ''), mode = input.mode || 'day', item = await contractOf(code);
        if (mode === 'minute') {
            const date = input.date || sessions().latest || dayKey(now());
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw failure('잘못된 날짜입니다.');
            const bars = await minuteCandlesOf(code, item, date);
            // Bars exist for every open day back to KIS_MINUTE_FIRST, with or without stored flow, so 더 불러오기 steps open days.
            const earlier = date > KIS_MINUTE_FIRST ? openBefore(date) : null, more = !!earlier && earlier >= KIS_MINUTE_FIRST;
            return { success: true, mode, date, points: bars.candles, has_more: more, cursor: more ? compact(earlier) : null, contract: bars.contract, ...(bars.next ? { next_contract: bars.next, roll_time: '15:20' } : {}),
                source: 'KIS FHKIF03020200 ' + bars.contract + (bars.next ? ' (만기일 15:20부터 ' + bars.next + ')' : '') };
        }
        const to = /^\d{8}$/.test(String(input.to || '')) ? input.to : compact(dayKey(now()));
        const from = /^\d{8}$/.test(String(input.from || '')) ? input.from : null, count = Math.min(5000, Number(input.count) || 600);
        const entry = dailyEntry(code), upTo = () => [...entry.rows.entries()].filter(([d]) => d <= to).sort(([a], [b]) => a.localeCompare(b));
        for (let page = 0; page < 80 && !entry.exhausted; page++) {
            if (entry.rows.size && (from ? oldestDay(entry) <= from : upTo().length >= count)) break;
            await dailyPage(entry, item);
        }
        const rows = from ? upTo().filter(([d]) => d >= from) : upTo().slice(-count);
        return { success: true, mode: 'day', points: rows.map(([, v]) => v), partial: !!from && !entry.exhausted && (oldestDay(entry) || '99999999') > from,
            source: 'LS t8405 연결선물(최근월물만 연결)', oldest: oldestDay(entry), exhausted: entry.exhausted };
    }
    return { query, candles, collect, start, stop, contracts, minutePoints, collectingAt, kisContract };
}
module.exports = { createLsStockFutures };
