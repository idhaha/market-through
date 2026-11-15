'use strict';
// VI 창 행 분석 차트 (2026-11-14): 행 맨 오른쪽 버튼 → 발동부터 해제 + 1분까지(켜져 있으면 지금까지) 1초마다
// Base 등락률(왼쪽 축) · 괴리율(오른쪽 축) · 체결강도(정수, 마지막 값 표시). KRX · NXT: 한투 FHPST01060000(그 시각 이전 30건),
// 선물: LS t8404(30건씩 cts_time). 거래대금 · 시가총액 설정을 만족하는 행만 해제 + 1분 뒤 자동으로 기록한다.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('express'),{chromium}=require('playwright');
const {createViMonitor}=require('../../vi-monitor-service');
const {createViWindowAccess}=require('../../vi-monitor-routes');
const at=s=>Date.parse('2026-11-16T'+s+'+09:00');
const hms=t=>new Date(t+9*3600000).toISOString().slice(11,19).replaceAll(':','');
// Trades: KRX three per second from 10:02:00 (the VI ends 10:02:00; none during the VI), price 100,000 + n·10, 체결강도 120 + n/30.
// NXT every 5 s from 09:59:00, 101,000. Futures (A116C000) every 10 s from 09:59:30, 102,000 then 103,000 from 10:01:00.
const krx=[{t:at('09:59:58'),p:99000,r:5,c:118.4}];for(let n=0;n<=3*180;n++)krx.push({t:at('10:02:00')+Math.floor(n/3)*1000,p:100000+n*10,r:6+n/1000,c:120+n/30});
const nxt=[];for(let t=at('09:59:00');t<=at('10:05:00');t+=5000)nxt.push({t,p:101000,r:7,c:99});
const fut=[];for(let t=at('09:59:30');t<=at('10:05:00');t+=10000)fut.push({t,p:t>=at('10:01:00')?103000:102000,c:140});
function services(calls){
    const stockTrades=async({market,code,hour})=>{calls.push('KIS '+market+' '+hour);
        const list=(market==='J'?krx:nxt).map((x,i)=>({...x,i})).filter(x=>hms(x.t)<=hour).sort((a,b)=>b.t-a.t||b.i-a.i).slice(0,30);
        return list.map(x=>({stck_cntg_hour:hms(x.t),stck_prpr:String(x.p),prdy_vrss_sign:'2',prdy_ctrt:String(x.r),tday_rltv:String(x.c),acml_vol:String(x.i)}));};
    const http={post:async(url,body,{headers})=>{
        const tr=headers.tr_cd,i=body[tr+'InBlock']||{},ok=d=>({data:{rsp_cd:'00000',...d}});calls.push('LS '+tr+(headers.tr_cont==='Y'?' cont':''));
        if(tr==='t8436')return ok({t8436OutBlock:[{shcode:'005930',hname:'삼성전자',gubun:'1'}]});
        if(tr==='t8401')return ok({t8401OutBlock:[{basecode:'A005930',shcode:'A116C000',hname:'삼성전자 F 202612'},{basecode:'A005930',shcode:'A1171000',hname:'삼성전자 F 202701'}]});
        if(tr==='t8402')return ok({t8402OutBlock:{price:'102000',recprice:'100000',volume:'5',mulcnt:'10',lastmonth:i.focode==='A116C000'?'20261210':'20270114'}});
        if(tr==='t8404'){const before=i.cts_time?Number(i.cts_time):Infinity;const list=fut.filter(x=>x.t<before).sort((a,b)=>b.t-a.t).slice(0,30);
            return ok({t8404OutBlock:{cts_time:list.length===30?String(list.at(-1).t):''},t8404OutBlock1:list.map(x=>({chetime:hms(x.t)+'0000',price:x.p,chdegree:String(x.c)}))});}
        return ok({});}};
    return {stockTrades,http};
}
test('1-second series (as-of trades per market), integer 체결강도; only rows passing the 거래대금 · 시가총액 setting are recorded, automatically',async()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-chart-')),calls=[],clock={t:at('10:00:00')};
    const {stockTrades,http}=services(calls);
    const m=createViMonitor({directory,now:()=>clock.t,policy:()=>({openDate:()=>true,spotAt:()=>false}),enabled:()=>true,WebSocket:class{on(){}send(){}close(){}terminate(){}},http,getToken:async()=>'x',kiwoomToken:async()=>'x',stockTrades,restGapMs:1});
    m.start();
    const real=(time,release='000000')=>({trnm:'REAL',data:[{type:'1h',item:'005930',values:{'1223':time,'1224':release,'9068':'1','9069':'1','9008':'001'}}]});
    m.receive(real('100000'));clock.t=at('10:02:00');m.receive(real('100000','100200'));
    // While the window is still open (10:02:30): up to now, every 5 seconds.
    clock.t=at('10:02:30');
    let row=m.snapshot().rows[0];assert.equal(row.rowKey,'005930:KRX');
    let c=await m.chartData({key:'005930:KRX',startedAt:row.startedAt});
    assert.equal(c.complete,false);assert.equal(c.to,at('10:02:30'));assert.equal(c.stepMs,1000);assert.deepEqual(Object.keys(c.series.gaps).sort(),['FUT','NXT']);
    assert.deepEqual(c.series.rate.map(p=>p[0]),Array.from({length:151},(_,i)=>at('10:00:00')+i*1000),'10:00:00, 10:00:01 … 10:02:30');
    // Before the release KRX had no trade inside the window: the Base is the last trade before it (09:59:58, 99,000, +5%).
    assert.deepEqual(c.series.rate[0],[at('10:00:00'),5]);assert.deepEqual(c.series.strength[0],[at('10:00:00'),118],'체결강도 is a whole number');
    assert.deepEqual(c.series.gaps.NXT[0],[at('10:00:00'),Math.round((101000/99000-1)*10000)/100]);
    assert.equal(c.series.gaps.FUT.find(p=>p[0]===at('10:01:00'))[1],Math.round((103000/99000-1)*10000)/100,'futures changes at 10:01');
    // The quiet VI is skipped: one KRX query covers 10:00:00..10:01:55.
    assert.ok(calls.filter(x=>x.startsWith('KIS J')).length<=12,'KRX queries: '+calls.filter(x=>x.startsWith('KIS J')).length);
    assert.equal(c.recorded,false,'not finished');
    // The record setting: 전일 거래대금 2,000억 (unknown here) → the finished window is shown but not recorded.
    m.setRecordFilter({prevAmount:2e11,marketCap:0});
    clock.t=at('10:06:00');calls.length=0;
    c=await m.chartData({key:'005930:KRX',startedAt:row.startedAt});
    assert.equal(c.complete,true);assert.equal(c.end,at('10:03:00'));assert.equal(c.series.rate.at(-1)[0],at('10:03:00'));assert.equal(c.series.rate.length,181);
    assert.equal(c.series.rate.at(-1)[1],6.18,'the last KRX trade at 10:03:00 (n=182, the third of that second)');assert.equal(c.series.strength.at(-1)[1],126);
    assert.equal(c.recorded,false,'전일 거래대금 unknown: not recorded');assert.equal(fs.existsSync(path.join(directory,'charts')),false);
    // No setting: recorded automatically after the release + 1 minute (tick), then read from the file.
    m.setRecordFilter({prevAmount:0,marketCap:0});assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'record-filter.json'),'utf8')).prevAmount,0);
    m.tick();for(let i=0;i<200&&!fs.existsSync(path.join(directory,'charts','2026-11-16'));i++)await new Promise(r=>setTimeout(r,20));
    assert.equal(fs.readdirSync(path.join(directory,'charts','2026-11-16')).length,1,'recorded by the queue');
    calls.length=0;c=await m.chartData({key:'005930:KRX',startedAt:row.startedAt});assert.equal(c.recorded,true);
    calls.length=0;const again=await m.chartData({key:'005930:KRX',startedAt:row.startedAt});assert.deepEqual(calls,[],'a recorded window is read from the file');assert.deepEqual(again.series,c.series);
    await assert.rejects(m.chartData({key:'005930:NXT',startedAt:row.startedAt}),/행을 찾지 못했습니다/);
    // Window: the chart button (last column) opens the chart; 체결강도 is an integer in the label; the dropdowns send the record setting.
    const app=express();app.use(express.json());createViWindowAccess({session:()=>null}).mount(app,m);app.use(express.static(path.join(__dirname,'../../public')));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const browser=await chromium.launch({headless:true,channel:'msedge'});
    try{
        const page=await browser.newPage({viewport:{width:1700,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.clock.install({time:clock.t});await page.addInitScript(()=>{localStorage.setItem('viGapOnly','false');localStorage.setItem('viMarketCap','1e12');});
        await page.goto('http://127.0.0.1:'+server.address().port+'/vi-monitor.html');await page.waitForSelector('#viBody tr');
        for(let i=0;i<50&&m.recordFilter().marketCap!==1e12;i++)await page.waitForTimeout(20);
        assert.deepEqual(m.recordFilter(),{prevAmount:0,marketCap:1e12},'the saved dropdown is sent when the window opens');
        await page.selectOption('#viPrevAmount','5e10');for(let i=0;i<50&&m.recordFilter().prevAmount!==5e10;i++)await page.waitForTimeout(20);
        assert.equal(m.recordFilter().prevAmount,5e10,'and when it changes');
        await page.selectOption('#viMarketCap','0');await page.selectOption('#viPrevAmount','0');await page.waitForSelector('#viBody td.name');
        const lastCell=page.locator('#viBody tr').first().locator('td').last();
        assert.equal(await lastCell.locator('button.vi-chart-button svg path').count(),2,'a diagonal and its arrow head');
        await lastCell.locator('button').click();
        await page.waitForSelector('#viChart .vc-strength-label');
        assert.equal(await page.locator('#viChart .vc-strength-label').textContent(),'체결강도 126');
        assert.equal(await page.locator('#viChart path.vc-line').count(),4,'등락률 · NXT · 선물 괴리율 · 체결강도');
        assert.match(await page.locator('#viChart h2').textContent(),/삼성전자 · KRX Base · 정적 · 10:00:00 ~ 해제 10:02:00 \+ 1분/);
        assert.match(await page.locator('#viChart .vc-note').textContent(),/^1초 간격 181점 · 해제 \+ 1분까지 끝난 구간 · 기록됨/);
        assert.deepEqual(await page.locator('#viChart .vc-mark-label').allTextContents(),['발동','해제','해제+1분']);
        assert.ok((await page.locator('#viChart .vc-left').allTextContents()).every(t=>/^-?\d+\.\d%$/.test(t)));
        const box=await page.locator('#viChart svg').boundingBox();await page.mouse.move(box.x+box.width*0.9,box.y+box.height*0.5);
        assert.match(await page.locator('#viChart .vc-tip').textContent(),/등락률 \+6\.\d% {2}· {2}NXT 괴리율 .* 체결강도 \d+$/);
        // The table's 체결강도 cell is an integer too.
        fs.mkdirSync(path.join(__dirname,'../output/vi-chart'),{recursive:true});await page.locator('#viChart').screenshot({path:path.join(__dirname,'../output/vi-chart/chart.png')});
        assert.deepEqual(errors,[]);
    }finally{await browser.close();server.close();m.stop();}
});
