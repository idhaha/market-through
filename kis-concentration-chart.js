const fs = require('node:fs');
const path = require('node:path');
const amount = value => value !== '' && value != null && /^\d+(\.\d+)?$/.test(String(value)) && Number.isFinite(Number(value)) ? Number(value) : null;
const beforeDay = day => new Date(Date.parse(`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T00:00:00Z`) - 86400000).toISOString().slice(0,10).replaceAll('-','');
const minute = key => Number(key.slice(8,10))*60 + Number(key.slice(10,12));
const clock = m => String(Math.floor(m/60)).padStart(2,'0') + String(m%60).padStart(2,'0') + '00';

// Never spread the difference across a missing time interval or fold special session rows into 15:30.
function differences(rows, opening, scale = 1) {
    const result = new Map();
    let previous;
    for (const [key, row] of [...rows].sort(([a],[b]) => a.localeCompare(b))) {
        if (!/^\d{14}$/.test(key) || minute(key) < 480 || minute(key) >= 1200) continue;
        const total = amount(row.acml_tr_pbmn);
        const contiguous = previous && key.slice(0,8) === previous.key.slice(0,8) && minute(key) === minute(previous.key) + 1;
        let value = contiguous && total != null && previous.total != null ? total - previous.total
            : key.slice(8) === opening && total != null ? total : null;
        // 15:20–15:29 is the closing auction: APIs may omit all of its no-trade rows.
        if (value == null && key.slice(8) === '153000' && ['151900','152000'].some(hour => previous?.key === key.slice(0,8)+hour)
            && total != null && previous.total != null) value = total - previous.total;
        result.set(key, value != null && value >= 0 ? value * scale : null);
        previous = { key, total };
    }
    return result;
}

function createKisConcentrationChartService({ reference, http, credentials, getToken, directory, now = Date.now,
    pause = ms => new Promise(resolve => setTimeout(resolve, ms)), schedule = setInterval, cancel = clearInterval,
    log = message => console.warn(message) }) {
    const cache = new Map(), stockDays = new Map(), dailySeries = new Map();
    let queue = Promise.resolve(), timer = null, collecting = null;
    const indexParams = code => ({ FID_COND_MRKT_DIV_CODE:'U', FID_INPUT_ISCD:code,
        FID_INPUT_HOUR_1:'60', FID_PW_DATA_INCU_YN:'Y', FID_ETC_CLS_CODE:'0' });
    async function get(tr, endpoint, params) {
        const key = JSON.stringify([tr, params]);
        const old = cache.get(key);
        if (old && (old.pending || old.until > now())) return old.promise;
        const entry = { pending: true };
        entry.promise = queue.then(async () => {
            const { domain, appKey, secretKey } = credentials();
            if (!domain || !appKey || !secretKey) throw new Error('한국투자증권 API 설정이 필요합니다.');
            try {
                for(let attempt=0; ;attempt++){
                const response = await http.get(`${domain}/uapi/domestic-stock/v1/quotations/${endpoint}`, {
                    params, headers: { authorization: `Bearer ${await getToken()}`, appkey: appKey, appsecret: secretKey,
                        tr_id: tr, custtype: 'P', 'Content-Type': 'application/json; charset=utf-8' }, timeout: 10000 });
                if (String(response.data.rt_cd) !== '0') {
                    const message=response.data.msg1 || '한투 차트 조회 실패';
                    if(attempt<2 && (response.data.msg_cd==='EGW00201' || /초당.*거래|거래.*초과/.test(message))){await pause((attempt+1)*1000);continue;}
                    throw new Error(message);
                }
                if (!Array.isArray(response.data.output2)) throw new Error('한투 차트 응답 형식 오류');
                return response.data.output2;
                }
            } catch (error) {
                // Axios error.config contains secrets. Only propagate a sanitized message.
                throw new Error(error.response?.data?.msg1 || (error.isAxiosError ? `${tr} 통신 오류` : error.message));
            } finally { await pause(350); }
        }).then(rows => { entry.pending = false; entry.until = now() + 10000; return rows; }, error => { cache.delete(key); throw error; });
        queue = entry.promise.catch(() => {}); cache.set(key, entry);
        for (const [key, value] of cache) if (!value.pending && value.until <= now()) cache.delete(key);
        return entry.promise;
    }
    function readIndex(code, dates) {
        const rows = new Map();
        if (!directory) return rows;
        for (const date of dates) {
            try {
                const saved = JSON.parse(fs.readFileSync(path.join(directory, code, `${date}.json`), 'utf8'));
                for (const row of saved) rows.set(row.stck_bsop_date + row.stck_cntg_hour, row);
            } catch (error) { if (error.code !== 'ENOENT') throw new Error('한투 업종 저장 자료를 읽을 수 없습니다.'); }
        }
        return rows;
    }
    function saveIndex(code, rows) {
        if (!directory) return;
        const days = new Map();
        for (const row of rows) {
            if (!/^\d{8}$/.test(row.stck_bsop_date) || !/^\d{6}$/.test(row.stck_cntg_hour)) continue;
            if (!days.has(row.stck_bsop_date)) days.set(row.stck_bsop_date, []);
            days.get(row.stck_bsop_date).push(row);
        }
        for (const [day, fresh] of days) {
            const merged = readIndex(code, [day]);
            for (const row of fresh) merged.set(row.stck_bsop_date+row.stck_cntg_hour,row);
            const file = path.join(directory, code, `${day}.json`), temp = `${file}.${process.pid}.tmp`;
            fs.mkdirSync(path.dirname(file), { recursive: true });
            try { fs.writeFileSync(temp, JSON.stringify([...merged.values()].sort((a,b)=>a.stck_cntg_hour.localeCompare(b.stck_cntg_hour)))); fs.renameSync(temp,file); }
            finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
        }
    }
    function collectionWindow() {
        const korean = new Date(now() + 9 * 3600000), weekday = korean.getUTCDay();
        const minutes = korean.getUTCHours() * 60 + korean.getUTCMinutes();
        return weekday >= 1 && weekday <= 5 && minutes >= 480 && minutes <= 1202
            ? korean.toISOString().slice(0,10).replaceAll('-','') : null;
    }
    function collect() {
        if (collecting) return collecting;
        const day = collectionWindow();
        if (!day) return Promise.resolve();
        collecting = (async () => {
            // Both market denominators are collected without a browser, selected symbol or Kiwoom query.
            for (const code of ['0001','1001']) {
                try {
                    const rows = await get('FHKUP03500200','inquire-time-indexchartprice',indexParams(code));
                    if (collectionWindow() !== day) continue;
                    const fresh = rows.filter(row => {
                        const hour=String(row.stck_cntg_hour || '');
                        if (row.stck_bsop_date !== day || amount(row.acml_tr_pbmn) == null) return false;
                        if (hour === '888888' || hour === '999999') return true;
                        if (!/^\d{6}$/.test(hour) || Number(hour.slice(2,4)) >= 60 || Number(hour.slice(4)) >= 60) return false;
                        const time=Date.parse(`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T${hour.slice(0,2)}:${hour.slice(2,4)}:${hour.slice(4)}+09:00`);
                        return hour >= '080000' && hour < '200000' && time <= now();
                    });
                    // Holidays may return the previous trading day. Never relabel those rows as today.
                    if (fresh.length) saveIndex(code,fresh);
                } catch (error) { log(`[KisConcentration] ${code} 수집 실패: ${error.message}`); }
            }
        })().finally(() => { collecting = null; });
        return collecting;
    }
    function start() {
        if (timer !== null) return;
        timer = schedule(() => { void collect(); },60000);
        timer.unref?.();
        void collect();
    }
    function stop() { if (timer !== null) cancel(timer); timer = null; }
    async function loadStockDay(code, day, first, last) {
        const id = `${code}:${day}`;
        let saved = stockDays.get(id);
        if (!saved) { saved = { rows: new Map(), earliest: null, at: now() }; stockDays.set(id, saved); }
        let cursor = last;
        for (let page=0;page<10;page++) {
            const rows = await get('FHKST03010230', 'inquire-time-dailychartprice', {
                FID_COND_MRKT_DIV_CODE:'UN', FID_INPUT_ISCD:code, FID_INPUT_DATE_1:day, FID_INPUT_HOUR_1:cursor,
                FID_PW_DATA_INCU_YN:'N', FID_FAKE_TICK_INCU_YN:'N' });
            const valid = rows.filter(r=>r.stck_bsop_date===day && /^\d{6}$/.test(r.stck_cntg_hour) && r.stck_cntg_hour<='195900');
            for (const row of valid) saved.rows.set(day+row.stck_cntg_hour,row);
            if (!valid.length) break;
            const earliest = valid.map(r=>r.stck_cntg_hour).sort()[0];
            if (saved.earliest && saved.earliest<=first && earliest>=saved.earliest) break;
            saved.earliest = saved.earliest && saved.earliest<earliest?saved.earliest:earliest;
            if (earliest<=first || earliest<='080000') break;
            const next = clock(minute(day+earliest)-1);
            if (next>=cursor) break;
            cursor=next;
        }
        saved.at=now();
        // Evict idle symbol caches; the upstream retains historical stock minutes.
        for (const [key,value] of stockDays) if (now()-value.at>30*60000) stockDays.delete(key);
        return saved.rows;
    }
    async function daily(tr, endpoint, code, first, last, stock) {
        const id=`${tr}:${code}`;
        const rows = dailySeries.get(id) || new Map(); dailySeries.set(id,rows);
        let end=last;
        for (let page=0;page<500 && end>=first;page++) {
            const result = await get(tr,endpoint,{
                FID_COND_MRKT_DIV_CODE:stock?'UN':'U',FID_INPUT_ISCD:code,FID_INPUT_DATE_1:first,FID_INPUT_DATE_2:end,
                FID_PERIOD_DIV_CODE:'D',...(stock?{FID_ORG_ADJ_PRC:'1'}:{}) });
            const valid=result.filter(r=>/^\d{8}$/.test(r.stck_bsop_date) && r.stck_bsop_date<=end);
            for (const row of valid) rows.set(row.stck_bsop_date,row);
            if (!valid.length) break;
            // Every earlier page was filled contiguously; only fetch the as-yet-unseen older tail.
            const earliest=[...rows.keys()].sort()[0];
            if (earliest<=first) break;
            end=beforeDay(earliest);
        }
        return rows;
    }
    async function query(input, owner) {
        if (input.debug_five || (input.mode !== 'day' && Number(input.interval ?? 1) !== 1))
            throw Object.assign(new Error('한투 비교 차트는 일봉과 1분봉을 지원합니다.'), { status:400 });
        // Reference owns selection validation, user-bound history cursors and identical candles/time grid.
        const base = await reference.query(input, owner);
        if (!base.success || !base.points?.length) return base;
        const code=String(input.code).replace(/_(AL|NX)$/i,''), industry=base.market==='K'?'0001':'1001';
        const dates=[...new Set(base.points.map(p=>p.time.slice(0,8)))].sort();
        let stocks, indices;
        try {
        if (base.mode==='day') {
            stocks=await daily('FHKST03010100','inquire-daily-itemchartprice',code,dates[0],dates.at(-1),true);
            indices=await daily('FHKUP03500100','inquire-daily-indexchartprice',industry,dates[0],dates.at(-1),false);
        } else {
            const fresh=await get('FHKUP03500200','inquire-time-indexchartprice',indexParams(industry));
            saveIndex(industry,fresh);
            indices=readIndex(industry,dates);
            for (const row of fresh) indices.set(row.stck_bsop_date+row.stck_cntg_hour,row);
            stocks=new Map();
            for (const day of dates) {
                const keys=base.points.filter(p=>p.time.startsWith(day)).map(p=>p.time).sort();
                // Load one predecessor for a valid first visible interval delta.
                const first=clock(Math.max(480,minute(keys[0])-1)), last=keys.at(-1).slice(8);
                for (const [key,row] of await loadStockDay(code,day,first,last)) stocks.set(key,row);
            }
        }
        } catch(error) {
            // Price candles belong to the successful reference query and survive a KIS amount failure.
            return {...base,source:'한투',partial:true,
                points:base.points.map(point=>({...point,value:null,stock_turnover:null,market_turnover:null,stock_turnover_million:null,market_turnover_million:null})),
                notice:`한투 거래대금 조회 실패: ${error.message} · 가격 캔들은 표시합니다.`,warnings:[error.message]};
        }
        const stockAmounts=base.mode==='day'?null:differences(stocks,'080000');
        const indexAmounts=base.mode==='day'?null:differences(indices,'090000',1000000);
        let missing=0;
        const points=base.points.map(point=>{
            const numerator=base.mode==='day'?amount(stocks.get(point.time)?.acml_tr_pbmn):stockAmounts.get(point.time)??null;
            const rawMarket=base.mode==='day'?amount(indices.get(point.time)?.acml_tr_pbmn):null;
            const denominator=base.mode==='day'?(rawMarket==null?null:rawMarket*1000000):indexAmounts.get(point.time)??null;
            const valid=numerator!=null && denominator>0;
            if(!valid)missing++;
            return {...point,stock_turnover:numerator,market_turnover:denominator,
                stock_turnover_million:numerator==null?null:numerator/1000000,market_turnover_million:denominator==null?null:denominator/1000000,
                value:valid?numerator/denominator*100:null};
        });
        return {...base,points,source:'한투',calculation:base.mode==='day'?'KIS stock acml_tr_pbmn / (KIS index acml_tr_pbmn * 1000000) * 100'
            :'delta(KIS UN stock acml_tr_pbmn) / (delta(KIS index acml_tr_pbmn) * 1000000) * 100',
            notice:missing?'한투 거래대금 미제공 구간은 결측으로 표시합니다.':'',
            warnings:['종목은 통합시장(UN), 업종의 통합 집계 범위는 미확인입니다.']};
    }
    return {query,collect,start,stop};
}
module.exports={createKisConcentrationChartService,differences};
