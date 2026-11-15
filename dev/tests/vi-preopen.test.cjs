'use strict';
// 2026-11-15: a market that has not opened yet only has the previous close. The 괴리율 against it stays a number (and counts
// for the 1% judgment, as asked), with gapState '장 전' so the window shows it smaller and dimmer with "장 전" beside it.
// A KRX Base without a trade that day (거래대금 0, e.g. the 11/12 JYP Ent. KRX 09:00:05 opening VI) is "Base 체결 전".
// Opening: KRX 09:00, stock futures 08:45, NXT 08:00; 수능일 (2026-11-19) one hour later.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('express'),{chromium}=require('playwright');
const {createViMonitor}=require('../../vi-monitor-service');
const at=(d,s)=>Date.parse(d+'T'+s+'+09:00');
function monitor(clock){
    const ok=d=>({data:{rsp_cd:'00000',...d}});
    const http={post:async(url,body,{headers})=>{const tr=headers.tr_cd,i=body[tr+'InBlock']||{};
        if(tr==='t8436')return ok({t8436OutBlock:[{shcode:'035900',hname:'JYP Ent.',gubun:'2'}]});
        if(tr==='t8401')return ok({t8401OutBlock:[{basecode:'A035900',shcode:'A1KBB000',hname:'JYP Ent. F 202611'},{basecode:'A035900',shcode:'A1KBC000',hname:'JYP Ent. F 202612'}]});
        if(tr==='t8402')return ok({t8402OutBlock:{price:'38700',recprice:'38700',volume:'0',mulcnt:'10',lastmonth:i.focode==='A1KBB000'?'20261112':'20261210'}});
        return ok({});}};
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-preopen-'));
    const m=createViMonitor({directory,now:()=>clock.t,policy:()=>({openDate:()=>true,spotAt:()=>true}),enabled:()=>true,WebSocket:class{on(){}send(){}close(){}terminate(){}},http,getToken:async()=>'x',kiwoomToken:async()=>'x',restGapMs:1,releaseWaitMs:50});
    m.start();return m;
}
const real=(item,time,release='000000')=>({trnm:'REAL',data:[{type:'1h',item,values:{'1223':time,'1224':release,'9068':'1','9069':'1','9008':'101'}}]});
async function row(day,time,item,clock){
    clock.t=at(day,time);const m=monitor(clock);
    m.receive(real(item,time.replaceAll(':','')));
    for(let i=0;i<50&&!m.snapshot().rows[0]?.futuresChecked;i++)await new Promise(r=>setTimeout(r,10));
    const q=(exchange,key,price,via='REST',amount)=>m.onQuote({exchange,key,price,via,receivedAt:clock.t,rate:exchange==='KRX'?0:10.21,...(amount!=null?{amount}:{})});
    return {m,q};
}
test('NXT pre-market row: KRX before 09:00 and futures before 08:45 keep the previous-close 괴리율, marked 장 전, and count for 1%',async()=>{
    const clock={t:0},{m,q}=await row('2026-11-12','08:03:13','035900_NX',clock);
    try{
        q('KRX','035900',38700);q('NXT','035900',42650,'WS');q('FUT','A1KBC000',38700);q('FUT','A1KBB000',38700);
        let r=m.snapshot().rows[0];assert.equal(r.exchange,'NXT');
        assert.equal(Math.round(r.gap.KRX*100)/100,-9.26);assert.deepEqual(r.gapState,{KRX:'장 전',NXT:null,FUT:'장 전'});
        assert.equal(r.gapHit?.kind,'KRX','the previous-close 괴리율 counts for 1% (no trade needed)');
        clock.t=at('2026-11-12','08:45:00');q('FUT','A1KBC000',42000,'WS');q('FUT','A1KBB000',42000,'WS');
        r=m.snapshot().rows[0];assert.deepEqual(r.gapState,{KRX:'장 전',NXT:null,FUT:null},'futures open at 08:45');
        clock.t=at('2026-11-12','09:00:00');q('KRX','035900',42000,'WS',1500);
        assert.deepEqual(m.snapshot().rows[0].gapState,{KRX:null,NXT:null,FUT:null},'KRX opens at 09:00');
    }finally{m.stop();}
});
test('수능일 2026-11-19: KRX 10:00, futures 09:45, NXT 10:00 (no pre-market)',async()=>{
    const clock={t:0},{m}=await row('2026-11-19','08:03:13','035900_NX',clock);
    try{
        clock.t=at('2026-11-19','09:50:00');assert.deepEqual(m.snapshot().rows[0].gapState,{KRX:'장 전',NXT:'장 전',FUT:null});
        clock.t=at('2026-11-19','09:44:00');assert.equal(m.snapshot().rows[0].gapState.FUT,'장 전');
    }finally{m.stop();}
});
test('KRX opening VI without a KRX trade (거래대금 0): Base 체결 전, kept in the release values; the window shows both marks',async()=>{
    const clock={t:0},{m,q}=await row('2026-11-12','09:00:05','035900',clock);
    try{
        q('KRX','035900',38700,'REST',0);q('NXT','035900',43650,'WS');
        let r=m.snapshot().rows[0];assert.equal(r.gap.KRX,'Base');assert.equal(r.gapState.KRX,'체결 전');assert.equal(r.gapHit?.kind,'NXT');
        clock.t=at('2026-11-12','09:02:28');m.receive(real('035900','090005','090228'));
        for(let i=0;i<100&&!m.snapshot().rows[0].atRelease;i++){clock.t+=1000;await new Promise(r=>setTimeout(r,10));}
        r=m.snapshot().rows[0];
        // The release values are settled after the wait (no KRX trade) and keep the state.
        assert.ok(r.atRelease,'released');assert.equal(r.atRelease.gapState?.KRX,'체결 전');
    }finally{m.stop();}
    // Window: smaller, dimmer cell with the mark beside the value.
    const now=Date.now(),rows=[
        {code:'035900',name:'JYP Ent.',market:'Q',exchange:'NXT',kind:'1',active:true,startedAt:now-30000,durationMs:120000,gap:{KRX:-9.26,NXT:'Base',FUT:-9.38},gapState:{KRX:'장 전',NXT:null,FUT:'장 전'},futuresBase:{code:'A1KBC000',name:'JYP Ent. F 202611',month:'202611'},gapHit:{at:now,kind:'KRX',value:-9.26}},
        {code:'035900',name:'JYP Ent.',market:'Q',exchange:'KRX',kind:'1',active:false,startedAt:now-600000,releasedAt:now-450000,atRelease:{at:now-450000,basis:'해제 이벤트 시점',rate:0,gap:{KRX:'Base',NXT:12.79,FUT:null},gapState:{KRX:'체결 전',NXT:null,FUT:null}},gapHit:{at:now,kind:'NXT',value:14.34}}];
    const app=express();app.get('/api/vi-monitor/stream',(req,res)=>{res.set({'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({rows,connection:'ok'})+'\n\n');});
    app.use(express.static(path.join(__dirname,'../../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const browser=await chromium.launch({headless:true,channel:'msedge'});
    try{
        const page=await browser.newPage({viewport:{width:1700,height:400}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.goto('http://127.0.0.1:'+server.address().port+'/vi-monitor.html');await page.waitForSelector('#viBody td.name');
        const cells=ex=>page.locator(`#viBody tr[data-exchange="${ex}"] td`).evaluateAll(tds=>tds.slice(12,15).map(td=>({text:td.textContent,pre:td.classList.contains('vi-pre'),opacity:getComputedStyle(td).opacity,title:td.title})));
        const n=await cells('NXT');
        assert.deepEqual(n.map(c=>[c.text,c.pre]),[['-9.3%장 전',true],['Base',false],['-9.4%장 전 11월',true]]);
        assert.equal(n[0].opacity,'0.6');assert.match(n[0].title,/장 전: .*전일 종가/);
        const k=await cells('KRX');
        assert.deepEqual(k.map(c=>[c.text,c.pre]),[['Base체결 전',true],['+12.8%',false],['—',false]]);assert.match(k[0].title,/체결 전: .*Base 가격이 전일 종가/);
        fs.mkdirSync(path.join(__dirname,'../output/vi-preopen'),{recursive:true});await page.locator('#viBody').screenshot({path:path.join(__dirname,'../output/vi-preopen/rows.png')});
        assert.deepEqual(errors,[]);
    }finally{await browser.close();server.close();}
});
