'use strict';
// 날짜별 VI 창 기록 (2026-11-14): 휴일에 VI 창이 비어 있던 문제.
//  - 날이 바뀌면 그날 행을 days/날짜.json에 남기고, 휴일 · 장 시작 전(08:00 전)에는 직전 장 기록을 보여 준다.
//  - 서버가 꺼진 채 날이 바뀌어도(state.json에 지난 날 행) 시작할 때 그날 기록을 남긴다.
//  - 날짜 선택으로 남은 날짜의 기록을 볼 수 있다.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('express'),{chromium}=require('playwright');
const {createViMonitor}=require('../../vi-monitor-service');
const {createViWindowAccess}=require('../../vi-monitor-routes');
const at=s=>Date.parse(s+'+09:00');
const vi=(code,start,release='000000',exchange='')=>JSON.stringify({trnm:'REAL',data:[{type:'1h',item:code+exchange,values:{'1223':start,'1224':release,'9068':'1','9069':'1','9008':'001','1221':'1000','1236':'900','1237':'0'}}]});
const options=(directory,clock,open)=>({directory,now:()=>clock.t,policy:()=>({openDate:d=>open(d),spotAt:()=>false}),enabled:()=>false,http:{post:async()=>{throw Error('offline');}},getToken:async()=>'x',kiwoomToken:async()=>'x',releaseWaitMs:5});
(async()=>{
    // 2026-11-16 (월) 휴장으로 가정해 이틀 넘는 휴일도 확인한다.
    const open=d=>!['2026-11-14','2026-11-15','2026-11-16'].includes(d);
    // 1) The server runs across midnight: Friday's rows (one still active at midnight) become the record.
    const dir1=fs.mkdtempSync(path.join(os.tmpdir(),'vi-history-')),clock={t:at('2026-11-13T10:00:00')};
    const a=createViMonitor(options(dir1,clock,open));
    a.receive(vi('005930','095000'));a.receive(vi('005930','095000','095210'));a.receive(vi('000660','095500'));
    await new Promise(r=>setTimeout(r,50));
    assert.equal(a.snapshot().previousSession,false);assert.equal(a.snapshot().rows.length,2);
    clock.t=at('2026-11-14T00:00:30');
    let s=a.snapshot();
    assert.equal(s.previousSession,true,'holiday: the last session is shown');assert.equal(s.shownDay,'2026-11-13');assert.equal(s.rows.length,2);
    const stuck=s.rows.find(r=>r.code==='000660');
    assert.equal(stuck.active,false,'a row still active at the day end is shown as ended');assert.equal(stuck.atRelease.basis,'해제 수신 없이 장 종료');
    assert.equal(s.rows.find(r=>r.code==='005930').releasedAt,at('2026-11-13T09:52:10'));
    assert.ok(fs.existsSync(path.join(dir1,'days','2026-11-13.json')));
    // Holiday weekday (11/16) after 08:00: still the last session. Next trading day 11/17 07:59 still; 08:00 the live (empty) day.
    clock.t=at('2026-11-16T09:30:00');s=a.snapshot();assert.equal(s.previousSession,true);assert.equal(s.shownDay,'2026-11-13');
    clock.t=at('2026-11-17T07:59:00');assert.equal(a.snapshot().previousSession,true);
    clock.t=at('2026-11-17T08:00:00');s=a.snapshot();assert.equal(s.previousSession,false);assert.equal(s.rows.length,0);
    // The archived 11/13 record is not overwritten by the empty holidays.
    assert.deepEqual(a.archivedDays(),['2026-11-13']);
    // A VI on the new day replaces the record view at once (before 08:00 too, e.g. NXT 08:00:00 edge).
    clock.t=at('2026-11-17T08:00:05');a.receive(vi('005930','080001','000000','_NX'));s=a.snapshot();assert.equal(s.previousSession,false);assert.equal(s.rows.length,1);
    a.stop();
    // 2) The server was off at midnight (Oracle-free local PC turned on on Saturday): state.json still holds Friday.
    const dir2=fs.mkdtempSync(path.join(os.tmpdir(),'vi-history-')),clock2={t:at('2026-11-13T10:00:00')};
    const b=createViMonitor(options(dir2,clock2,open));b.receive(vi('035420','091000'));b.receive(vi('035420','091000','091210'));
    await new Promise(r=>setTimeout(r,300));b.stop();
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir2,'state.json'),'utf8')).day,'2026-11-13');
    clock2.t=at('2026-11-14T11:00:00');
    const c=createViMonitor(options(dir2,clock2,open));s=c.snapshot();
    assert.equal(s.previousSession,true,'restart on a holiday shows Friday');assert.equal(s.rows.length,1);assert.equal(s.rows[0].code,'035420');
    assert.ok(fs.existsSync(path.join(dir2,'days','2026-11-13.json')));
    // 3) Route + window: the date picker reads a saved day; '실시간으로' goes back.
    const app=express();createViWindowAccess({session:()=>null}).mount(app,a);app.use(express.static(path.join(__dirname,'../../public')));
    clock.t=at('2026-11-14T11:00:00');
    const a2=createViMonitor(options(dir1,clock,open));
    const app2=express();createViWindowAccess({session:()=>null}).mount(app2,a2);app2.use(express.static(path.join(__dirname,'../../public')));
    const server=app2.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
    let r=await fetch(origin+'/api/vi-monitor/history');assert.deepEqual((await r.json()).days,['2026-11-13']);
    r=await fetch(origin+'/api/vi-monitor/history?date=2026-11-12');assert.equal(r.status,404);
    r=await fetch(origin+'/api/vi-monitor/history?date=../x');assert.equal(r.status,400);
    const browser=await chromium.launch({headless:true,channel:'msedge'});
    try{
        const page=await browser.newPage({viewport:{width:1700,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>localStorage.setItem('viGapOnly','false'));
        await page.goto(origin+'/vi-monitor.html');await page.waitForSelector('#viBody td.name');
        assert.equal(await page.locator('#viBody tr[data-code]').count(),2,'holiday window shows the last session');
        assert.match(await page.locator('#viStatus').textContent(),/직전 장\(2026-11-13\) 기록/);
        assert.match(await page.locator('#viSummary').textContent(),/^직전 장 2026-11-13 기록/);
        assert.equal(await page.locator('#viDate').inputValue(),'2026-11-13');
        // A day without a record.
        await page.locator('#viDate').fill('2026-11-12');await page.locator('#viDate').dispatchEvent('change');
        await page.waitForFunction(()=>/2026-11-12 VI 기록이 없습니다/.test(document.querySelector('#viBody').textContent));
        assert.equal(await page.locator('#viLive').isVisible(),true);
        // '실시간으로' goes back to the stream (here the last session again).
        await page.locator('#viLive').click();assert.equal(await page.locator('#viLive').isVisible(),false);
        await page.waitForFunction(()=>document.querySelectorAll('#viBody tr[data-code]').length===2);
        // Picking the day the live view already shows (11/13) stays on the stream.
        await page.locator('#viDate').fill('2026-11-13');await page.locator('#viDate').dispatchEvent('change');
        assert.equal(await page.locator('#viLive').isVisible(),false);assert.equal(await page.locator('#viBody tr[data-code]').count(),2);
        // Header order still: 날짜 · 거래대금 · 시가총액 · 괴리율 · 항상 위, one font size, centered.
        const g=await page.evaluate(()=>{const r=el=>el.getBoundingClientRect(),mid=el=>Math.round(r(el).top+r(el).height/2);const d=document.getElementById('viDate'),p=document.getElementById('viPrevAmount');
            return {order:r(d).right<=r(p).left,font:getComputedStyle(d).fontSize,dy:Math.abs(mid(d)-mid(p))};});
        assert.equal(g.order,true);assert.equal(g.font,'12px');assert.ok(g.dy<=1,'date input centered with the filters: '+g.dy);
        assert.deepEqual(errors,[]);
    }finally{await browser.close();server.close();a2.stop();c.stop();}
    // 4) Restoring days before the records existed from the 1% gap records (2026-11-12 · 11-13).
    const {restoreDay}=require('../restore-vi-days-from-gap-records.cjs');
    const gapDir=fs.mkdtempSync(path.join(os.tmpdir(),'vi-gap-')),dayDir=fs.mkdtempSync(path.join(os.tmpdir(),'vi-days-'));
    const t0=at('2026-11-12T11:05:19');
    const recs=[
        {code:'030530',exchange:'FUT',contract:{code:'ACM6C000',name:'원익홀딩스 F 202612',month:'202612'},name:'원익홀딩스',market:'Q',kind:'JX0',kindText:'상한 2단계 확대 (±20%)',direction:'up',startedAt:t0,releasedAt:null,gapHit:{at:t0+1000,kind:'KRX',value:1.06},contracts:[{code:'ACM6C000'}],
         atRelease:null,columns:{'1% 도달 때':{'전일 거래대금(원)':5e10},'해제 때':null,'4분 끝':{'등락률':9.05,'시가총액(원)':2.5e12,'거래대금(백만)':null,'KRX 괴리율':0.76,'NXT 괴리율':'미지원','선물 괴리율(최근월)':'Base','선물 괴리율(차기월)':'Base','선물 매수10호가평균(원)':6182450,'전일 거래대금(원)':5e10}}},
        {code:'000990',exchange:'FUT',contract:{code:'AEK6B000'},name:'DB하이텍',kind:'JD0',startedAt:t0,gapHit:{kind:'NXT',value:-1},columns:{}},
        {code:'084850',exchange:'KRX',name:'아이티엠반도체',market:'Q',kind:'1',direction:'up',startedAt:t0,releasedAt:t0+134000,gapHit:{kind:'NXT',value:-3},contracts:[],
         atRelease:{at:t0+134000,basis:'해제 뒤 첫 KRX 체결',rate:8.54,amount:216,marketCap:1.2e11,gap:{KRX:'Base',NXT:-3,FUT:'미지원'}},columns:{'해제 때':{'전일 거래대금(원)':169000000}}}];
    fs.writeFileSync(path.join(gapDir,'2026-11-12.jsonl'),recs.map(r=>JSON.stringify(r)).join(String.fromCharCode(10))+String.fromCharCode(10));
    assert.deepEqual(restoreDay('2026-11-12',{from:gapDir,to:dayDir}),{day:'2026-11-12',rows:2,excludedJd0:1},'the fake JD0 row is left out');
    assert.equal(restoreDay('2026-11-12',{from:gapDir,to:dayDir}).skipped,'이미 기록 있음');
    const restored=JSON.parse(fs.readFileSync(path.join(dayDir,'2026-11-12.json'),'utf8'));
    const fut=restored.rows.find(r=>r.exchange==='FUT'),krx=restored.rows.find(r=>r.exchange==='KRX');
    assert.equal(fut.releasedAt,t0+300000,'futures rows end 5 minutes after the event');assert.equal(fut.atRelease.rate,9.05);assert.equal(fut.atRelease.gap.KRX,0.76);assert.match(fut.atRelease.basis,/4분 뒤 값/);
    assert.equal(fut.prevAmount,5e10);assert.equal(krx.atRelease.basis,'해제 뒤 첫 KRX 체결');assert.equal(krx.prevAmount,169000000);assert.equal(krx.futuresSupported,false);
    assert.match(restored.restored.note,/1% 이상/);
    // 5) Oracle keeps only the newest saved day (historyDays 1); the local server keeps all.
    const dir3=fs.mkdtempSync(path.join(os.tmpdir(),'vi-history-')),clock3={t:at('2026-11-12T10:00:00')};
    const o=createViMonitor({...options(dir3,clock3,open),historyDays:1});
    o.receive(vi('005930','095000'));clock3.t=at('2026-11-13T10:00:00');o.snapshot();o.receive(vi('000660','095000'));clock3.t=at('2026-11-14T10:00:00');
    assert.deepEqual(o.snapshot().shownDay,'2026-11-13');assert.deepEqual(o.archivedDays(),['2026-11-13'],'Oracle: only the last session');o.stop();
    assert.equal(require('../../vi-alerts-host').viHistoryDays({},'linux'),1);assert.equal(require('../../vi-alerts-host').viHistoryDays({},'win32'),Infinity);
    console.log('PASS VI history: day records on rollover and on a late restart, last session on holidays until 08:00 of the next trading day, date picker');
})().catch(e=>{console.error(e);process.exitCode=1;});
