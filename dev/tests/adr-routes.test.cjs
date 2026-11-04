const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
    const source = fs.readFileSync('server.js','utf8');
    const routes = new Map(), calls = [];
    const context = { dailyTurnover: require('../../concentration-chart').dailyTurnover, app: { get: (path, handler) => routes.set(path,handler) }, process: { env: { KIWOOM_APPKEY:'key', KIWOOM_SECRETKEY:'secret' } },
        getAccessToken: async (key,secret) => { assert.equal(key,'key'); assert.equal(secret,'secret'); return 'token'; }, setTimeout: fn => fn(),
        axios: { get: async (url,options) => { calls.push({url,options}); return {data:{series:[]}}; }, post: async (url,body,options) => {
            calls.push({url,body,options});
            const next = options.headers['next-key'];
            // Minute pages are newest-first: page 1 ends in the afternoon of the oldest requested day,
            // page 2 holds that day's morning followed by an earlier day.
            if (body.tic_scope) return next
                ? { data: { inds_min_pole_qry:[{cntr_tm:'20261029090000',open_pric:'100000',high_pric:'100000',low_pric:'100000',cur_prc:'100000',trde_qty:'1'},{cntr_tm:'20261028153000',open_pric:'100000',high_pric:'100000',low_pric:'100000',cur_prc:'100000',trde_qty:'1'}] }, headers: {} }
                : { data: { inds_min_pole_qry:[{cntr_tm:'20261030090000',open_pric:'100000',high_pric:'100000',low_pric:'100000',cur_prc:'100000',trde_qty:'1'},{cntr_tm:'20261029131000',open_pric:'100000',high_pric:'100000',low_pric:'100000',cur_prc:'100000',trde_qty:'1'}] }, headers: {'cont-yn':'Y','next-key':'minute-2'} };
            return { data: { inds_dt_pole_qry:[{dt: next ? '20260102' : '20260302',open_pric:'300000',high_pric:'+305000',low_pric:'-295000',cur_prc:'302000', ...(next ? {} : {trde_prica:'10,000,000'})}] },
                headers: next ? {} : {'cont-yn':'Y','next-key':'second'} };
        } } };
    context.indexHttp = context.axios; // server.js routes index charts through a shared index client
    // server.js creates the shared index store near the turnover service; the route slice only uses it.
    context.indexCandleStore = require('../../index-candle-store').createIndexCandleStore({ http: context.axios, getToken: () => context.getAccessToken('key','secret'), pause: async () => {}, log: () => {} });
    vm.runInNewContext(source.slice(source.indexOf("app.get('/api/adr/history'"),source.indexOf("app.get('/api/adr/today'")),context);
    const res = { status(n) {this.code=n;return this;}, set(){return this;}, json(data){this.data=data;return this;} };
    await routes.get('/api/adr/history')({query:{market:'kosdaq',range:'5y'}},res);
    assert.equal(calls[0].options.params.range,'5y'); assert.equal(calls[0].options.params.market,'kosdaq');
    await routes.get('/api/adr/candles')({query:{market:'kosdaq',mode:'day',from:'20260102',to:'20260302'}},res);
    assert.equal(res.data.points.length,2); assert.equal(res.data.points[0].open,3000); assert.equal(res.data.points[0].low,2950);
    assert.equal(res.data.points[1].market_turnover,10e12); assert.equal(res.data.points[0].market_turnover,null);
    const { calculatePoints } = require('../../concentration-chart');
    const row = {dt:'20260302',cur_prc:'302000',open_pric:'300000',high_pric:'305000',low_pric:'295000',trde_qty:'100',trde_prica:'10,000,000'};
    const concentration = calculatePoints(new Map([[row.dt,row]]),new Map([[row.dt,row]]),'day',1);
    assert.equal(res.data.points[1].market_turnover,concentration[0].market_turnover,'Both charts use identical reported market turnover');
    assert.equal(calls[1].body.inds_cd,'101'); assert.equal(calls[2].options.headers['next-key'],'second'); assert.equal(res.data.partial,false);
    // Regression: reaching the oldest requested day must not stop paging before that day's morning.
    await routes.get('/api/adr/candles')({query:{market:'kosdaq',mode:'minute',from:'20261029',to:'20261030'}},res);
    const minuteTimes = res.data.points.map(p => new Date(p.t + 9*3600000).toISOString().slice(0,16));
    assert.deepEqual([...minuteTimes],['2026-10-29T09:00','2026-10-29T13:10','2026-10-30T09:00'],'Oldest day keeps its morning minutes');
    assert.equal(res.data.partial,false);
    await routes.get('/api/adr/candles')({query:{market:'bad',mode:'day',from:'20260102',to:'20260302'}},res);
    assert.equal(res.code,400);
    console.log('PASS ADR history forwarding, candle pagination, price scale and query validation');
})().catch(e => {console.error(e);process.exitCode=1;});
