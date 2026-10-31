const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLsFuturesTest, nightPriceTime, investorTime } = require('../../ls-futures-test');
const { timestamp } = require('../../supply-service');
const fixedNow = timestamp('20261031', '090000');
test('stored-only test flow never waits for or calls futures price TRs',async()=>{
    const {service,calls}=fixture({reply:async(tr,p)=>{
        if(tr==='t8463')return {rsp_cd:'00000',t8463OutBlock1:[{date:'20261030',time:p.tm_rng==='D'?'154500':'180000',indmsamt:'1',formsamt:'-1',sysmsamt:'0'}]};
        assert.fail('flow-only request called price/master TR '+tr);
    }});
    const result=await service.query({mode:'minute',prices:'0'});
    assert.equal(result.points.length,2);assert.equal(result.candles.length,0);
    assert.ok(calls.every(c=>c.tr==='t8463'));
});
for(const code of ['futures','futuresKosdaq'])test(`${code} daily uses the main card day history and fills the same night range`,async()=>{
    const baselineCalls=[];
    const baseline={points:[
        {t:timestamp('20250106'),individual:100,foreign:0,institution:-100},
        {t:timestamp('20261029'),individual:200,foreign:-50,institution:-150},
        {t:timestamp('20261030'),individual:300,foreign:-100,institution:-200}
    ],has_more:true,cursor:'20250105',warnings:[]};
    const {service,calls}=fixture({dailyProvider:{daily:async(...args)=>{baselineCalls.push(args);return baseline;}},reply:async(tr,p)=>{
        if(tr==='t8462'){
            assert.equal(p.tm_rng,'N');assert.equal(p.from_date,'20250106');
            return {rsp_cd:'00000',t8462OutBlock1:p.to_date==='20261031'
                ?[{date:'20261030',sa_08:'1',sa_17:'-1',sa_18:'0'}]
                :p.to_date==='20261029'?[{date:'20261029',sa_08:'2',sa_17:'-2',sa_18:'0'}]:[]};
        }
        if(tr==='t8467'||tr==='t8455')return {rsp_cd:'00000',[tr+'OutBlock']:[{hname:'F 2612',shcode:'A016C000'}]};
        return {rsp_cd:'00000',[tr+'OutBlock1']:[{date:'20240102',open:100,high:110,low:90,close:105}]};
    }});
    const result=await service.query({code,mode:'day'});
    assert.equal(baselineCalls.length,1);
    assert.equal(baselineCalls[0][0],code);
    assert.deepEqual(result.points.filter(p=>Number.isFinite(p.individual)).map(p=>[p.t,p.individual,p.foreign,p.institution]),[
        [timestamp('20250106'),100,0,-100],
        [timestamp('20261029'),400,-250,-150],
        [timestamp('20261030'),400,-200,-200]
    ]);
    assert.equal(result.cursor,'20250105');assert.equal(result.has_more,true);
    assert.deepEqual(calls.filter(c=>c.tr==='t8462').map(c=>c.p.to_date),['20261031','20261029','20261028']);
    const past=await service.query({code,mode:'day',cursor:result.cursor});
    assert.equal(baselineCalls[1][1],'20250105');
});
test('daily investor cursor never skips to the earlier independent price page',async()=>{
    const {service}=fixture({reply:async(tr)=>{
        if(tr==='t8462')return {rsp_cd:'00000',t8462OutBlock1:[{date:'20260701',sa_08:'3'}]};
        if(tr==='t8467'||tr==='t8455')return {rsp_cd:'00000',[tr+'OutBlock']:[{hname:'F 2612',shcode:'A016C000'}]};
        return {rsp_cd:'00000',[tr+'OutBlock1']:[{date:'20260102',open:100,high:110,low:90,close:105}]};
    }});
    const result=await service.query({mode:'day'});
    assert.equal(result.cursor,'20260630');assert.equal(result.price_cursor,undefined);
    assert.equal(result.candles[0].t,timestamp('20260102'));
});
for(const scenario of [
    {name:'day only',day:{sa_08:'10',sa_17:'0',sa_18:'-3'},night:null,expected:[1000,0,-300]},
    {name:'both sessions',day:{sa_08:'10',sa_17:'-5',sa_18:'-5'},night:{sa_08:'-2',sa_17:'3',sa_18:'-1'},expected:[800,-200,-600]},
    {name:'missing night fields and valid zero',day:{sa_08:'10',sa_17:'0',sa_18:'-3'},night:{sa_08:'',sa_17:'2',sa_18:'0'},expected:[1000,200,-300]},
    {name:'failed night request',day:{sa_08:'10',sa_17:'0',sa_18:'-3'},night:'fail',expected:[1000,0,-300]},
    {name:'night only still needs a day baseline',day:null,night:{sa_08:'2',sa_17:'0',sa_18:'-2'},expected:[undefined,undefined,undefined]}
])test(`combined daily flow: ${scenario.name}`,async()=>{
    const {service}=fixture({reply:async(tr,p)=>{
        if(tr==='t8462'){
            const row=p.tm_rng==='D'?scenario.day:scenario.night;
            if(row==='fail')throw Error('upstream unavailable');
            return {rsp_cd:'00000',t8462OutBlock1:row?[{date:'20261030',...row}]:[]};
        }
        if(tr==='t8467'||tr==='t8455')return {rsp_cd:'00000',[tr+'OutBlock']:[{hname:'F 2612',shcode:'A016C000'}]};
        return {rsp_cd:'00000',[tr+'OutBlock1']:[{date:'20261030',open:100,high:110,low:90,close:105}]};
    }});
    const result=await service.query({code:'futures',mode:'day'}),point=result.points.find(p=>p.t===timestamp('20261030'));
    assert.deepEqual(['individual','foreign','institution'].map(f=>point?.[f]),scenario.expected);
});
test('test futures daily candles query both price sessions without investor TRs',async()=>{
    const {service,calls}=fixture();
    const result=await service.query({code:'futures',mode:'day',prices_only:'1'});
    assert.ok(result.candles.length>0);
    assert.ok(!calls.some(c=>c.tr==='t8462'||c.tr==='t8463'));
    assert.ok(calls.some(c=>c.tr==='t8466')&&calls.some(c=>c.tr==='t8459'));
});
test('historical futures prices follow both continuation keys and reuse a completed past range',async()=>{
    const calls=[];
    const service=createLsFuturesTest({now:()=>fixedNow,pause:async()=>{},getToken:async()=>'',http:{post:async(url,body,{headers})=>{
        const tr=headers.tr_cd,p=body[tr+'InBlock'];calls.push({tr,p,headers});
        if(tr==='t8467')return {data:{rsp_cd:'00000',t8467OutBlock:[{hname:'F 2612',shcode:'A016C000'}]}};
        return {headers:{tr_cont:p.cts_date?'N':'Y',tr_cont_key:'0'},data:{rsp_cd:'00000',t8465OutBlock:p.cts_date?{}:{cts_date:'20261027',cts_time:'090000'},t8465OutBlock1:[{date:p.cts_date?'20261026':'20261027',time:'090000',open:900,high:902,low:898,close:901}]}};
    }}});
    const range={code:'futures',from:'20261026',to:'20261030'};
    const result=await service.priceRange(range);
    assert.deepEqual(result.points.map(p=>p.t),[timestamp('20261026','090000'),timestamp('20261027','090000')]);
    assert.equal(calls[2].p.cts_date,'20261027');assert.equal(calls[2].p.cts_time,'090000');
    assert.equal(calls[2].headers.tr_cont,'Y');assert.equal(calls[2].headers.tr_cont_key,'0');
    await service.priceRange(range);assert.equal(calls.length,3);
});
function fixture(override = {}) {
    const calls = [];
    const service = createLsFuturesTest({ now: () => fixedNow, pause: async () => {}, getToken: async () => 'private-token', ...override,
        http: { post: async (url, body, { headers }) => {
            const tr = headers.tr_cd, p = body[tr + 'InBlock']; calls.push({ tr, p, url });
            if (override.reply) return { data: await override.reply(tr, p) };
            const out = { rsp_cd: '00000' };
            if (tr === 't8455' || tr === 't8467') out[tr + 'OutBlock'] = [{ hname: 'F SP 12-2703', shcode: '4016C73S' }, { hname: 'F 2703', shcode: 'A0173000' }, { hname: 'F 2612', shcode: 'A016C000' }];
            else if (tr === 't8462') out.t8462OutBlock1 = [{ date: '20261030', sa_08: '-3', sa_17: '0', sa_18: '2', sv_08: 888 }];
            else if (tr === 't8463') out.t8463OutBlock1 = [
                { date: '20261031', time: '060030', datetime: '20261031', indmsamt: '4', formsamt: '0', sysmsamt: '-4' },
                { date: '20261031', time: '060000', indmsamt: '3', formsamt: '0', sysmsamt: '-3' },
                { date: '20261030', time: '235930', indmsamt: '1', formsamt: '0', sysmsamt: '-1' },
                { date: '20261030', time: '180000', indmsamt: '0', formsamt: '0', sysmsamt: '0' }
            ];
            else out[tr + 'OutBlock1'] = tr === 't8461'
                ? ['060000','235900','180000'].map(chetime => ({ chetime, open: '100', high: '102', low: '99', price: '101' }))
                : [{ date: '20261030', open: '100', high: '102', low: '99', close: '101' }];
            return { data: out };
        } }
    });
    return { service, calls };
}
for (const [code, asset] of [['futures', 'K2I'], ['futuresKosdaq', 'KQI']]) {
    for (const session of ['D', 'N']) test(`${code} ${session} daily joins LS price and amount with explicit session`, async () => {
        const { service, calls } = fixture();
        const result = await service.query({ code, session });
        assert.equal(calls[0].p.bsc_asts_id, asset); assert.equal(calls[0].p.tm_rng, session);
        assert.equal(result.points.find(p => p.individual != null).individual, -300);
        assert.equal(result.points.find(p => p.foreign != null).foreign, 0);
        assert.equal(result.candles[0].close, 101); assert.equal(result.contract.code, 'A016C000');
        assert.equal(result.partial, false); assert.ok(result.points.every(p => p.program === undefined));
        assert.deepEqual(calls.map(c => c.tr), ['t8462', session === 'N' ? 't8455' : 't8467', session === 'N' ? 't8459' : 't8466']);
        const length = calls.length; await service.query({ code, session }); assert.equal(calls.length, length);
    });
}
test('night minute dates survive midnight and use last observation, not malformed datetime', async () => {
    const { service } = fixture(); const r = await service.query({ code: 'futures', mode: 'minute', session: 'N' });
    assert.deepEqual(r.points.map(p => p.t), ['20261030180000','20261030235900','20261031060000'].map(d => timestamp(d.slice(0,8),d.slice(8))));
    assert.equal(r.points.at(-1).individual, 400); assert.equal(r.points.at(-1).foreign, 0);
    assert.deepEqual(r.candles.map(p => p.t), r.points.map(p => p.t));
    assert.equal(r.has_more, true);assert.equal(r.cursor,'20261029');
});
test('price failures preserve flow and expose no credential or axios error', async () => {
    const { service } = fixture({ reply: async tr => {
        if (tr === 't8462') return { rsp_cd: '00000', t8462OutBlock1: [{date:'20261030',sa_08:'3'}] };
        throw Error('private-token upstream credential');
    } });
    const r = await service.query({session:'D'}); assert.equal(r.partial, true); assert.equal(r.points[0].individual, 300);
    assert.deepEqual(r.candles, []); assert.doesNotMatch(JSON.stringify(r), /private-token|credential/);
});
test('undated prices are omitted when there is no dated night investor anchor', async () => {
    const { service, calls } = fixture({reply:async tr => tr === 't8463' ? {rsp_cd:'00000',t8463OutBlock1:[]} : {rsp_cd:'00000',t8455OutBlock:[{hname:'F 2612',shcode:'A016C000'}]}});
    const r = await service.query({ mode:'minute', session:'N' }); assert.equal(r.partial,true); assert.deepEqual(r.candles,[]);
    assert.ok(!calls.some(c=>c.tr==='t8461'));
});
test('validates query and timestamp; night clock is anchored to dated source', () => {
    const { service }=fixture();
    for(const q of [{code:'../../secret'},{code:'toString'},{session:'X'},{mode:'invalid'},{cursor:'20260230'},{cursor:[]}]) assert.throws(()=>service.query(q));
    assert.ok(Number.isNaN(investorTime({date:'20260230',time:'060000'})));
    assert.equal(nightPriceTime('235900',timestamp('20261031','060100')),timestamp('20261030','235900'));
    assert.ok(Number.isNaN(nightPriceTime('100000',timestamp('20261031','060100'))));
});
test('investor failure still shows independently available day prices', async () => {
    const {service}=fixture({reply:async tr=>{
        if(tr==='t8463')throw Error('private-token');
        if(tr==='t8467')return {rsp_cd:'00000',t8467OutBlock:[{hname:'F 2612',shcode:'A016C000'}]};
        return {rsp_cd:'00000',t8465OutBlock1:[{date:'20261030',time:'150000',open:'100',high:'102',low:'99',close:'101'}]};
    }});
    const r=await service.query({mode:'minute'});
    assert.equal(r.partial,true);assert.equal(r.candles.length,1);assert.equal(r.candles[0].close,101);
    assert.equal(r.points[0].individual,undefined);assert.doesNotMatch(JSON.stringify(r),/private-token/);
});
test('saved night observations survive restarts without being restamped as current data', async t => {
    const fs=require('fs'),os=require('os'),path=require('path');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ls-test-history-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const first=fixture({directory});const saved=await first.service.query({mode:'minute',session:'N'});
    const second=fixture({directory,reply:async tr=>tr==='t8463'?{rsp_cd:'00000',t8463OutBlock1:[]}:{rsp_cd:'00000',t8455OutBlock:[{hname:'F 2612',shcode:'A016C000'}]}});
    const restored=await second.service.query({mode:'minute',session:'N'});
    assert.deepEqual(restored.points,saved.points);assert.deepEqual(restored.candles,[]);
    assert.ok(restored.points.every(p=>p.t<fixedNow));
});
test('default query combines both sessions in calendar time without synthetic gap rows',async()=>{
    const {service,calls}=fixture({reply:async(tr,p)=>{
        if(tr==='t8463')return {rsp_cd:'00000',t8463OutBlock1:p.tm_rng==='D'
            ? [{date:'20261030',time:'154500',indmsamt:'2',formsamt:'-2',sysmsamt:'0'}]
            : [{date:'20261030',time:'180000',indmsamt:'3',formsamt:'-3',sysmsamt:'0'},{date:'20261031',time:'060000',indmsamt:'4',formsamt:'-4',sysmsamt:'0'}]};
        if(tr==='t8455'||tr==='t8467')return {rsp_cd:'00000',[tr+'OutBlock']:[{hname:'F 2612',shcode:'A016C000'}]};
        return {rsp_cd:'00000',[tr+'OutBlock1']:tr==='t8465'?[{date:'20261030',time:'154500',open:'100',high:'102',low:'99',close:'101'}]:['180000','060000'].map(chetime=>({chetime,open:'100',high:'102',low:'99',price:'101'}))};
    }});
    const r=await service.query({mode:'minute'});
    assert.equal(r.session,'U');assert.deepEqual(calls.filter(c=>c.tr==='t8463').map(c=>c.p.tm_rng),['N','D']);
    assert.deepEqual(r.points.map(p=>p.t),[timestamp('20261030','154500'),timestamp('20261030','180000'),timestamp('20261031','060000')]);
    assert.deepEqual(r.points.map(p=>p.individual),[200,300,400]);assert.equal(r.candles.length,3);
});
test('overnight common axis keeps empty clock time and aligns peers across midnight',()=>{
    const fs=require('fs'),vm=require('vm'),window={};
    vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),{window,queueMicrotask:()=>{}});
    const axis=window.RankChartAxis,rows=['20261030154500','20261030180000','20261031060000'].map(d=>({t:timestamp(d.slice(0,8),d.slice(8))}));
    axis.sharedRange('testMarketSupply',rows,p=>p.t,'minute',0,null,()=>{});
    axis.sharedRange('combinedMarketSupply',rows.slice(0,1),p=>p.t,'minute',0,null,()=>{});
    const domain=axis.minuteDomain(),x=axis.sessionX(rows,p=>p.t,0,855,true),peer=axis.sessionX(rows.slice(0,1),p=>p.t,0,855,true);
    assert.equal(domain.span,855);assert.equal(domain.position('2026-10-30 16:00'),15);
    assert.equal(domain.position('2026-10-30 18:00'),135);assert.equal(domain.position('2026-10-31 06:00'),855);
    assert.equal(x(rows[0].t),peer(rows[0].t));assert.equal(x(rows[1].t)-x(rows[0].t),135);
    axis.selectViewport('testMarketSupply',0.2,0.8);
    assert.equal(axis.minuteDomain().span,513);assert.equal(axis.minuteDomain().first,'2026-10-30 18:36');
});
test('interactive night flow renders before blocked day and price requests, polling reuses the job',async()=>{
    let releaseDay,releasePrice;
    const day=new Promise(r=>{releaseDay=r;}),price=new Promise(r=>{releasePrice=r;});
    const {service,calls}=fixture({reply:async(tr,p)=>{
        if(tr==='t8463'){
            if(p.tm_rng==='D')await day;
            return {rsp_cd:'00000',t8463OutBlock1:[{date:p.tm_rng==='N'?'20261031':'20261030',time:p.tm_rng==='N'?'060000':'154500',indmsamt:'3',formsamt:'-3',sysmsamt:'0'}]};
        }
        if(tr==='t8455'||tr==='t8467')return {rsp_cd:'00000',[tr+'OutBlock']:[{hname:'F 2612',shcode:'A016C000'}]};
        await price;return {rsp_cd:'00000',[tr+'OutBlock1']:[]};
    }});
    try{
        const first=await service.query({mode:'minute',progressive:'1'});
        assert.equal(first.pending,true);assert.equal(first.points.length,1);assert.equal(first.points[0].individual,300);
        const again=await service.query({mode:'minute',progressive:'1'});
        assert.equal(again.pending,true);assert.equal(calls.filter(c=>c.tr==='t8463' && c.p.tm_rng==='N').length,1);
        releaseDay();releasePrice();
        const final=await service.query({mode:'minute'});assert.equal(final.points.length,2);
        const settled=await service.query({mode:'minute',progressive:'1'});assert.equal(settled.pending,false);
        assert.equal(calls.filter(c=>c.tr==='t8463').length,2);
    }finally{releaseDay();releasePrice();}
});
test('a completed TR returns without waiting for its next-request cooldown',async()=>{
    let release;const cooldown=new Promise(r=>{release=r;});
    const {service}=fixture({pause:()=>cooldown});
    try{const result=await service.query({mode:'minute',session:'N'});assert.equal(result.points.length,3);}
    finally{release();}
});
test('more loads the actual previous night and stops instead of relabelling it for older dates',async()=>{
    const {service,calls}=fixture({reply:async(tr,p)=>{
        if(tr==='t8463')return {rsp_cd:'00000',t8463OutBlock1:[{date:p.bgubun==='1'?'20261030':'20261031',time:'060000',indmsamt:'3',formsamt:'-3',sysmsamt:'0'}]};
        if(tr==='t8455')return {rsp_cd:'00000',t8455OutBlock:[{hname:'F 2612',shcode:'A016C000'}]};
        return {rsp_cd:'00000',t8461OutBlock1:[]};
    }});
    const latest=await service.query({mode:'minute',session:'N'});assert.equal(latest.cursor,'20261029');
    const past=await service.query({mode:'minute',session:'N',cursor:latest.cursor});
    assert.equal(past.points[0].t,timestamp('20261030','060000'));assert.equal(past.has_more,false);assert.equal(past.cursor,null);
    const older=await service.query({mode:'minute',session:'N',cursor:'20261028'});
    assert.deepEqual(older.points,[]);assert.equal(older.has_more,false);
    assert.equal(calls.filter(c=>c.tr==='t8463' && c.p.bgubun==='1').length,1);
});
test('existing KIS daytime storage fills missing LS day flow with original amounts and timestamps',async()=>{
    const daytimeStore={dates:()=>['2026-10-26','2026-10-29'],points:(code,date)=>{
        assert.equal(code,'FUTURE');return [{t:timestamp(date.replaceAll('-',''),'150000'),individual:12345,foreign:-12345,institution:0,program:999},
            {t:timestamp(date.replaceAll('-',''),'190000'),individual:999}];
    }};
    const {service}=fixture({daytimeStore,reply:async tr=>{
        if(tr==='t8463')return {rsp_cd:'00000',t8463OutBlock1:[]};
        throw Error('price unavailable');
    }});
    const r=await service.query({mode:'minute',session:'D'});
    assert.equal(r.points.length,1);assert.equal(r.points[0].individual,12345);assert.equal(r.points[0].source,'KIS');
    assert.equal(r.points[0].program,undefined);assert.equal(r.cursor,'20261028');
    const older=await service.query({mode:'minute',session:'D',cursor:'20261028'});
    assert.equal(older.points[0].t,timestamp('20261026','150000'));assert.equal(older.points[0].individual,12345);
    assert.equal(older.has_more,false);
});
