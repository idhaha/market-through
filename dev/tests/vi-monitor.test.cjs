'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const express=require('express');
const {chromium}=require('playwright');
const {createViMonitor,parseKiwoomVi}=require('../../vi-monitor-service');
const {createViWindowAccess}=require('../../vi-monitor-routes');
const {createQuoteCadence}=require('../../quote-cadence');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
class FakeSocket extends EventEmitter {
    static OPEN=1; static instances=[];
    constructor(){super();this.readyState=1;this.sent=[];FakeSocket.instances.push(this);setImmediate(()=>this.emit('open'));}
    // Kiwoom websocket: LOGIN and REG are answered with return_code 0.
    send(raw){const m=JSON.parse(raw);this.sent.push(m);if(['LOGIN','REG'].includes(m.trnm))setImmediate(()=>this.emit('message',JSON.stringify({trnm:m.trnm,return_code:0})));}
    ping(){this.emit('pong');}
    terminate(){if(this.readyState===3)return;this.readyState=3;this.emit('close');}
    close(){this.terminate();}
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
    const cadence=createQuoteCadence();
    assert.equal(cadence.receive('S3_',{rsp_cd:'00000'},0),false);
    assert.equal(cadence.receive('VI_',{price:100,chetime:'090000',shcode:'005930'},0),false);
    for(const [at,price,chetime]of [[0,100,'090000'],[100,100,'090000'],[400,101,'090000'],[1000,101,'090001']])cadence.receive('S3_',{price,chetime,shcode:'005930'},at);
    const measured=cadence.snapshot()[0];assert.equal(measured.messages,4);assert.equal(measured.priceChanges,1);assert.equal(measured.sameSecondMessages,2);assert.equal(measured.meanMs,1000/3);assert.equal(measured.medianMs,300);assert.equal(measured.p95Ms,600);
    // Real Kiwoom 1h records from 2026-11-05 (outputs/vi-compare-20261105): a release repeats 1223 and 9068 and fills 1224.
    const real=(item,time,release)=>({type:'1h',item,values:{'1223':time,'1224':release,'9068':'1','9069':'1','9008':'001','1221':'265000','1236':'218000','1237':'0'}});
    assert.deepEqual(parseKiwoomVi(real('005930_NX','080000','000000')),{code:'005930',exchange:'NXT',kind:'1',clock:'080000',direction:'up',market:'K'});
    assert.deepEqual(parseKiwoomVi(real('005930_NX','080000','080200')),{code:'005930',exchange:'NXT',kind:'0',clock:'080200',direction:'up',market:'K'},'A Kiwoom release uses 1224 as its time');
    assert.equal(parseKiwoomVi(real('005930_AL','080000','000000')),null,'SOR copies are skipped');
    assert.equal(parseKiwoomVi(real('005930','080000','000000')).exchange,'KRX');
    const extension=real('005930','080000','000000');extension.values['9068']='4';
    assert.equal(parseKiwoomVi(extension),null,'VI 연장 is not a new activation');
    let clock=Date.parse('2026-11-02T09:05:00+09:00');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vi-monitor-'));
    const http={post:async(url,body,{headers})=>{
        const tr=headers.tr_cd;const data={rsp_cd:'00000'};
        if(tr==='t8436')data.t8436OutBlock=[{shcode:'005930',hname:'삼성전자',gubun:'1'},{shcode:'000660',hname:'SK하이닉스',gubun:'1'}];
        if(tr==='t8401')data.t8401OutBlock=[{basecode:'A005930',shcode:'111V2000',hname:'삼성전자 F 202701'},{basecode:'A005930',shcode:'D116B6CS',hname:'삼성전자 SP 2611-2'},{basecode:'A005930',shcode:'111V1000',hname:'삼성전자 F 202612'}];
        if(tr==='t8402')data.t8402OutBlock={price:body.t8402InBlock.focode==='111V1000'?103:104,lastmonth:body.t8402InBlock.focode==='111V1000'?'20261210':'20270114'};
        return {data};
    }};
    const feed={watched:new Map(),unwatched:[],started:0,watch(code,{futures=[]}={}){this.watched.set(code,futures);},unwatch(code){this.watched.delete(code);this.unwatched.push(code);},start(){this.started++;},stop(){},state(){return {wanted:this.watched.size,subscribed:this.watched.size,rest:0};}};
    // A server with VI_MONITOR_REALTIME=false never opens the Kiwoom socket, even when a VI window starts it.
    const off=createViMonitor({now:()=>clock,policy:()=>null,http,getToken:async()=>'x',kiwoomToken:async()=>'x',WebSocket:FakeSocket,enabled:()=>false,quoteFeed:feed});
    off.start();assert.equal(FakeSocket.instances.length,0);assert.equal(feed.started,0);assert.match(off.snapshot().connection,/꺼 두었습니다/);
    const service=createViMonitor({now:()=>clock,policy:()=>null,directory,http,getToken:async()=>'ls-test',kiwoomToken:async()=>'test-secret',WebSocket:FakeSocket,quoteFeed:feed,releaseGraceMs:50});
    const app=express();app.use(express.json());let sessionValid=true;
    const session=req=>sessionValid&&req.headers.cookie==='login=valid'?{email:'user@test'}:null;
    const access=createViWindowAccess({session,now:()=>clock});
    app.use('/api',(req,res,next)=>{
        if(access.handles(req))return access.authorize(req,res,next);
        const user=session(req);if(!user)return res.sendStatus(401);req.authUser=user;next();
    });access.mount(app,service);
    // Launcher page: capture the protocol launch instead of opening the external app.
    app.get('/launcher',(req,res)=>res.type('html').send('<div id="rankIndependentControls"><button data-independent="rank">수급</button></div><script src="/launch.js"></script>'));
    app.get('/launch.js',(req,res)=>res.type('js').send(fs.readFileSync(path.resolve(__dirname,'../../public/vi-monitor-launch.js'),'utf8').replace("location.href='marketthrough://","window.testLaunchUrl='marketthrough://")));
    app.use(express.static(path.resolve(__dirname,'../../public')));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
    let browser;
    try{
        assert.equal((await fetch(origin+'/api/vi-monitor/stream')).status,401);
        // The VI button's launch URL must pass the native app's own fragment check (read from the C# source).
        {
            const launcher=await (browser=await chromium.launch({headless:true,channel:'msedge'})).newPage();
            await launcher.context().addCookies([{name:'login',value:'valid',url:origin}]);
            await launcher.goto(origin+'/launcher');await launcher.getByRole('button',{name:'VI',exact:true}).click();
            const launched=await launcher.waitForFunction(()=>window.testLaunchUrl,null,{timeout:5000}).then(h=>h.jsonValue()).catch(async e=>{throw Error('launcher: '+await launcher.locator('body').textContent());});
            const target=new URL(decodeURIComponent(launched.split('url=')[1]));
            const nativeRule=/note || vi ? "([^"]+)"/.exec(fs.readFileSync(path.resolve(__dirname,'../../desktop/IndependentWindow.cs'),'utf8'))[1];
            assert.equal(target.pathname,'/vi-monitor.html');assert.match(target.hash,new RegExp(nativeRule),'Native app would reject this VI window URL');
            // Changing the main browser zoom reports the new ratio for the open VI window.
            const reported=launcher.waitForRequest(r=>r.url().endsWith('/api/vi-monitor/window-scale'));
            const cdp=await launcher.context().newCDPSession(launcher);
            await cdp.send('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:1.5,mobile:false});
            assert.equal(JSON.parse((await reported).postData()).scale,1.5);
            await launcher.close();
        }
        const grant=await fetch(origin+'/api/vi-monitor/window',{method:'POST',headers:{cookie:'login=valid','Content-Type':'application/json'},body:JSON.stringify({scale:0.8})}).then(r=>r.json());assert.match(grant.token,/^[a-f0-9]{64}$/);
        const page=await browser.newPage({viewport:{width:1500,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(t=>{Date.now=()=>t;window.__native=[];window.chrome={webview:{postMessage:m=>window.__native.push(m)}};},clock);
        // The launcher passes the main browser's pixel ratio; the window asks the native host to match it once.
        // The URL must stay '#token=<hex>' only: the native app rejects any other fragment.
        await page.goto(origin+'/vi-monitor.html#token='+grant.token);
        await page.waitForFunction(()=>window.__native.some(m=>m.startsWith('page-scale:')));
        assert.deepEqual(await page.evaluate(()=>window.__native.filter(m=>m.startsWith('page-scale:'))),['page-scale:0.8']);
        // A later zoom change pushes through the stream to the open window right away.
        assert.equal((await fetch(origin+'/api/vi-monitor/window-scale',{method:'POST',headers:{cookie:'login=valid','Content-Type':'application/json'},body:JSON.stringify({token:grant.token,scale:1.25})})).status,200);
        await page.waitForFunction(()=>window.__native.includes('page-scale:1.25'));
        assert.equal((await fetch(origin+'/api/vi-monitor/window-scale',{method:'POST',headers:{cookie:'login=valid','Content-Type':'application/json'},body:JSON.stringify({token:'0'.repeat(64),scale:1})})).status,404);
        assert.equal((await fetch(origin+'/api/vi-monitor/window-scale',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:grant.token,scale:1})})).status,401);await page.waitForFunction(()=>document.getElementById('viStatus').textContent.includes('VI 실시간 수신 중'));
        const socket=FakeSocket.instances[0];
        assert.deepEqual(socket.sent.map(m=>m.trnm+':'+(m.data?m.data[0].item[0]:m.token)),['LOGIN:test-secret','REG:','REG:_NX']);
        // Kiwoom 1h: item suffix _NX = NXT, _AL = SOR copy; 1224 is 000000 until the release.
        const event=(item,kind,time,release='000000')=>socket.emit('message',JSON.stringify({trnm:'REAL',data:[{type:'1h',item,values:{'1223':time,'1224':release,'9068':kind,'9069':item.startsWith('000660')?'2':'1','9008':'001','1221':item.startsWith('000660')?'90':'120','1236':'100','1237':'100'}}]}));
        event('005930','1','090000');event('000660','2','090100');event('005930_NX','3','090200');event('005930_AL','3','090200');
        await page.waitForFunction(()=>document.querySelectorAll('#viBody tr[data-code]').length===3);
        assert.equal(await page.locator('#viBody tr').first().getAttribute('data-exchange'),'NXT');
        assert.equal(await page.locator('#viBody tr').first().locator('td').nth(6).textContent(),'동적,정적');
        assert.equal(await page.locator('#viBody tr[data-code="000660"]').getAttribute('class'),'vi-flash-down');
        assert.equal(await page.locator('#viBody tr').first().getAttribute('class'),'vi-flash-up');
        assert.equal(await page.locator('#viBody tr').first().locator('td').first().evaluate(el=>getComputedStyle(el).animationName),'vi-row-background');
        const flashVar=(sel,name)=>page.locator(sel).first().evaluate((el,n)=>getComputedStyle(el).getPropertyValue(n).trim(),name);
        assert.equal(await flashVar('#viBody tr','--vi-dark'),'#c90000');assert.equal(await flashVar('#viBody tr[data-code="000660"]','--vi-dark'),'#2563eb');
        // Clicking a blinking row stops only that row.
        await page.locator('#viBody tr[data-code="000660"]').click();
        for(let i=0;i<50&&!service.snapshot().rows.find(r=>r.code==='000660').flashDismissed;i++)await pause(20);
        assert.equal(service.snapshot().rows.find(r=>r.code==='000660').flashDismissed,true,'Dismissal must be stored on the server');
        // Another independent window receives the dismissal through the server.
        const other=await browser.newPage();await other.addInitScript(t=>{Date.now=()=>t;},clock);
        await other.goto(origin+'/vi-monitor.html#token='+grant.token);await other.waitForFunction(()=>document.querySelectorAll('#viBody tr[data-code]').length===3);
        assert.equal(await other.locator('#viBody tr[data-code="000660"]').evaluate(el=>el.classList.contains('vi-flash-down')),false);
        assert.equal(await other.locator('#viBody tr[data-code="005930"][data-exchange="KRX"]').evaluate(el=>el.classList.contains('vi-flash-up')),true);await other.close();
        assert.equal((await fetch(origin+'/api/vi-monitor/flash-dismiss',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'005930',exchange:'KRX',startedAt:0})})).status,401);
        assert.equal(await page.locator('#viBody tr[data-code="000660"] td').first().evaluate(el=>getComputedStyle(el).animationName),'none');
        assert.equal(await page.locator('#viBody tr').first().evaluate(el=>el.classList.contains('vi-flash-up')),true);
        // Shared table style: tinted header and solid row lines.
        assert.equal(await page.locator('thead th').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(234, 240, 249)');
        // The row line is an inset shadow (style.css) so it adds no row height.
        assert.equal(await page.locator('#viBody td').first().evaluate(el=>getComputedStyle(el).boxShadow),'rgb(217, 226, 240) 0px -1px 0px 0px inset');
        assert.deepEqual(await page.locator('thead tr').first().locator('th').allTextContents(),['순위','시장','종목명','등락률','거래대금(백만)','거래소','구분','발동 시각','해제 시각','해제까지(예상)','KRX대비']);
        // Default (발동 시각 newest first): every sortable column shows arrows, none shows a dot.
        const sortIcons=()=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('[data-sort]')].map(b=>[b.dataset.sort,(b.querySelector('circle')?'dot':'arrows')+':'+b.closest('th').getAttribute('aria-sort')])));
        assert.deepEqual(await sortIcons(),{rate:'arrows:none',amount:'arrows:none',startedAt:'arrows:descending',nxtRate:'arrows:none',futureRate:'arrows:none'});
        // Activation time is already beyond 2 minutes: do not falsely release a VI on a timer.
        assert.equal(await page.locator('#viBody tr').first().locator('td').nth(9).textContent(),'해제 수신 대기');
        // The release repeats the activation time (1223 = 09:02:00); the shown release time must be 1224.
        event('005930_NX','3','090200','090400');await page.waitForFunction(()=>document.querySelector('#viBody tr[data-exchange="NXT"]').classList.contains('released'));
        assert.equal(await page.locator('#viBody tr').count(),3);assert.equal(await page.locator('#viBody tr[data-exchange="NXT"] td').nth(8).textContent(),'09:04:00');
        assert.equal(await page.locator('#viBody tr[data-exchange="NXT"]').getAttribute('class'),'released');
        assert.equal(await page.locator('#viBody tr[data-exchange="NXT"] td').first().evaluate(el=>getComputedStyle(el).animationName),'none');
        // An older activation must not revive a released event.
        event('005930_NX','2','090300');assert.equal(service.snapshot().rows.find(r=>r.exchange==='NXT').active,false);
        // NH prices arrive through the quote feed; the monitor asked it for the stock and both futures months.
        for(let i=0;i<500&&feed.watched.get('005930')?.length!==2;i++)await pause(20);
        assert.deepEqual(feed.watched.get('005930'),['111V1000','111V2000']);assert.ok(feed.watched.has('000660'));
        const quote=q=>service.onQuote({via:'WS',receivedAt:clock,...q});
        quote({exchange:'KRX',key:'005930',price:100,rate:1.25,amount:123456});quote({exchange:'NXT',key:'005930',price:102,rate:2,amount:55});quote({exchange:'FUT',key:'111V1000',price:103});quote({exchange:'FUT',key:'111V2000',price:104});
        await page.waitForFunction(()=>[...document.querySelectorAll('#viBody tr[data-code="005930"]')].some(tr=>tr.cells[10].textContent==='+2.00%'));
        // Wait for the actual REST enrichment path to assign the current/next contracts.
        await page.waitForFunction(()=>[...document.querySelectorAll('#viBody tr[data-code="005930"]')].some(tr=>tr.cells[11].textContent==='+3.00%'),null,{timeout:20000});
        await page.selectOption('#viFutureMonth','next');assert.equal(await page.locator('#viBody tr[data-code="005930"]').first().locator('td').nth(11).textContent(),'+4.00%');
        // Choosing a column: it shows arrows, all other sortable columns show a dot. Third click returns to default.
        await page.getByRole('button',{name:'등락률',exact:true}).click();
        assert.deepEqual(await sortIcons(),{rate:'arrows:descending',amount:'dot:none',startedAt:'dot:none',nxtRate:'dot:none',futureRate:'dot:none'});
        await page.getByRole('button',{name:'등락률',exact:true}).click();assert.equal((await sortIcons()).rate,'arrows:ascending');
        await page.getByRole('button',{name:'등락률',exact:true}).click();assert.equal((await sortIcons()).amount,'arrows:none');assert.equal((await sortIcons()).startedAt,'arrows:descending');
        await page.getByRole('button',{name:'등락률',exact:true}).click();
        await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#viBody tr[data-code]').length===3);
        await page.evaluate(t=>window.refreshNativeViCredentials(t),grant.token);await page.waitForFunction(()=>document.querySelectorAll('#viBody tr[data-code]').length===3);
        // Dismissal survives reload and SSE re-render; a later activation of the same stock blinks again.
        assert.equal(await page.locator('#viBody tr[data-code="000660"]').evaluate(el=>el.classList.contains('vi-flash-down')),false);
        assert.equal(await page.locator('#viBody tr[data-code="005930"][data-exchange="KRX"]').evaluate(el=>el.classList.contains('vi-flash-up')),true);
        await pause(150);const beforeRestart=createViMonitor({directory,now:()=>clock,policy:()=>null});assert.equal(beforeRestart.snapshot().rows.find(r=>r.code==='000660').flashDismissed,true,'Dismissal survives a server restart');beforeRestart.stop();
        event('000660','2','090450');await page.waitForFunction(()=>document.querySelector('#viBody tr[data-code="000660"]')?.classList.contains('vi-flash-down'));
        const releasedColor=await page.locator('#viBody tr.released td').first().evaluate(el=>getComputedStyle(el).color);assert.equal(releasedColor,'rgb(100, 116, 139)');
        const boxes=await page.locator('.panel').count();assert.equal(boxes,1);
        const aligned=await page.evaluate(()=>{
            const row=document.querySelector('#viBody tr'),headers=[...document.querySelector('thead tr').cells].slice(0,10).concat([...document.querySelectorAll('thead tr:nth-child(2) th')]);
            return headers.every((th,i)=>Math.abs(th.getBoundingClientRect().left-row.cells[i].getBoundingClientRect().left)<1 && Math.abs(th.getBoundingClientRect().width-row.cells[i].getBoundingClientRect().width)<1);
        });assert.equal(aligned,true,'Grouped headings and rows must share the same column boundaries');
        fs.mkdirSync(path.resolve(__dirname,'../output/vi-monitor'),{recursive:true});await page.screenshot({path:path.resolve(__dirname,'../output/vi-monitor/desktop.png'),fullPage:true});
        await page.setViewportSize({width:500,height:700});
        assert.equal(await page.evaluate(()=>{const el=document.querySelector('.table-wrapper');return el.scrollWidth>el.clientWidth && document.documentElement.scrollWidth<=innerWidth;}),true,'Narrow independent windows must scroll the table inside the panel');
        if(process.argv.includes('--native')) {
            const result=await promisify(execFile)(path.resolve(__dirname,'../../desktop/build/ViNativeSmoke.exe'),[origin+'/vi-monitor.html#token='+grant.token],{cwd:path.resolve(__dirname,'../../desktop/build'),timeout:45000});process.stdout.write(result.stdout);
        }
        // Prices stop a grace period after the stock's last VI ends, and not while one is active.
        await pause(120);assert.equal(feed.unwatched.length,0);
        event('005930','1','090000','090410');await pause(150);assert.deepEqual(feed.unwatched,['005930']);
        await pause(150);const restored=createViMonitor({directory,now:()=>clock,policy:()=>null});assert.equal(restored.snapshot().rows.length,3);assert.equal(restored.snapshot().rows.find(r=>r.exchange==='NXT').active,false);assert.equal(restored.snapshot().rows.find(r=>r.code==='000660').flashDismissed,undefined,'A later activation resets the dismissal');restored.stop();
        clock+=86400000;assert.equal(service.snapshot().rows.length,0);
        sessionValid=false;assert.equal((await fetch(origin+'/api/vi-monitor/stream',{headers:{'X-VI-Token':grant.token}})).status,401);
        assert.deepEqual(errors,[]);
        console.log('PASS VI upstream → event state → SSE → independent view, retention, dimming, type, sorting, KRX comparisons, month switch, reconnect, restore, day rollover, scoped access; cadence ignores acknowledgements');
    } finally {service.stop();await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
