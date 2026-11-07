const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {createBackgroundRefresh,mountBackgroundRoutes}=require('../../background-refresh');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'background-refresh-'));let at=Date.parse('2026-11-02T18:00:00+09:00'),open=true,timer;
 let settings={rankInterval:'1',rankChartDisplay:{mode:'minute',selection:{code:'000660',name:'SK'},combinedSupply:{selected:'000660',mode:'minute'}},backgroundSupply:{stocks:[{code:'000660'}]}};
 const calls=[],watched=[];let rows=[{time:'20261102180000',value:10,stock_price:100}],block;
 const options={directory,now:()=>at,readSettings:()=>settings,policy:{spotAt:()=>open,futuresAt:()=>open},setStocks:codes=>watched.push(codes),schedule:fn=>{timer=fn;return {unref(){}};},cancel:()=>{},execute:async job=>{
  calls.push(job);if(block)await block(job);return {success:true,points:rows,cursor:'private-session',access_token:'must-not-persist'};
 }};
 const service=createBackgroundRefresh(options);t.after(()=>{service.stop();fs.rmSync(directory,{recursive:true,force:true});});
 return {service,options,calls,watched,directory,setClock:value=>at=value,advance:ms=>at+=ms,setOpen:value=>open=value,setSettings:value=>settings=value,getSettings:()=>settings,setRows:value=>rows=value,setBlock:fn=>block=fn,fire:()=>timer()};
}
test('default off makes no requests; enabled server collects without a browser and persists across restart',async t=>{
 const f=fixture(t);await f.service.tick();assert.equal(f.calls.length,0);
 f.service.configure(true);await f.service.tick();assert.ok(f.calls.some(j=>j.name==='쏠림율'));assert.deepEqual(f.watched.at(-1),['000660']);
 const job=f.calls.find(j=>j.name==='쏠림율'),file=path.join(f.directory,'snapshots',job.id,'2026-11-02.json.gz');
 const saved=zlib.gunzipSync(fs.readFileSync(file)).toString();assert.ok(saved.includes('20261102180000'));assert.ok(!saved.includes('must-not-persist'));assert.ok(!saved.includes('private-session'));
 assert.equal(f.service.status().lastSuccessAt,Date.parse('2026-11-02T18:00:00+09:00'));
 f.service.stop();const restarted=createBackgroundRefresh(f.options);t.after(()=>restarted.stop());assert.equal(restarted.status().enabled,true);
 const before=f.calls.length;restarted.start();await restarted.tick();assert.equal(f.calls.length,before,'Startup grace permits existing browsers to reconnect');
 f.advance(30000);await restarted.tick();assert.ok(f.calls.length>before,'No browser or login heartbeat is required after restart');
});
test('open browsers suspend replacement refresh; only the last disconnect resumes it after a reload grace period',async t=>{
 const f=fixture(t),first=f.service.connectBrowser('first'),second=f.service.connectBrowser('second');
 f.service.configure(true);await f.service.tick();assert.equal(f.calls.length,0);
 assert.equal(f.service.status().paused,true);assert.equal(f.service.status().browserCount,2);
 first();f.advance(60000);await f.service.tick();assert.equal(f.calls.length,0);
 second();await f.service.tick();assert.equal(f.calls.length,0);
 f.advance(30000);await f.service.tick();assert.ok(f.calls.length>0);
 const count=f.calls.length,returning=f.service.connectBrowser('returning');
 assert.equal(f.service.cached('GET',f.calls[0].url,f.calls[0].params),null,'A live browser bypasses a fresh replacement snapshot');
 f.advance(60000);await f.service.tick();assert.equal(f.calls.length,count);
 assert.equal(f.service.cached('GET',f.calls[0].url,f.calls[0].params),null,'An open browser must use its original request path');returning();
});
test('a returning browser stops new jobs and waits for the old server requests to drain without saving their result',async t=>{
 const f=fixture(t);let release;const gate=new Promise(resolve=>release=resolve);
 f.setBlock(()=>gate);f.service.configure(true);await new Promise(resolve=>setImmediate(resolve));
 const count=f.calls.length,disconnect=f.service.connectBrowser('returning');let idle=false;
 const handoff=f.service.waitForIdle().then(()=>idle=true);
 f.advance(60000);await f.service.tick();assert.equal(f.calls.length,count);assert.equal(idle,false);
 release();await handoff;assert.equal(idle,true);assert.equal(f.service.status().lastSuccessAt,null);
 assert.equal(fs.existsSync(path.join(f.directory,'snapshots')),false);disconnect();
});
test('independent-window presence leases suspend fallback and expire after an unclean close',async t=>{
 const f=fixture(t);f.service.touchBrowser('independent',true);f.service.configure(true);await f.service.tick();assert.equal(f.calls.length,0);
 f.advance(10000);f.service.touchBrowser('independent',true);f.advance(15000);await f.service.tick();assert.equal(f.calls.length,0);
 f.advance(30000);await f.service.tick();assert.ok(f.calls.length>0);
});
test('server honors saved cadence, picks up changed settings and disables without deleting archives',async t=>{
 const f=fixture(t);f.service.configure(true);await f.service.tick();const count=f.calls.length;
 f.advance(59000);await f.service.tick();assert.equal(f.calls.length,count);
 f.advance(1000);await f.service.tick();assert.equal(f.calls.length,count*2);
 f.setSettings({...f.getSettings(),rankInterval:'5',rankChartDisplay:{mode:'minute',selection:{code:'005930',name:'Samsung'}}});
 await f.service.tick();assert.ok(f.calls.some(j=>j.params.code==='005930'));assert.deepEqual(f.watched.at(-1),['005930']);
 f.service.configure(false);const stopped=f.calls.length;f.advance(60000);await f.service.tick();assert.equal(f.calls.length,stopped);assert.deepEqual(f.watched.at(-1),[]);
 assert.ok(fs.existsSync(path.join(f.directory,'snapshots')));
});
test('closed market skips broker requests, independent risk jobs remain available, failures do not block peers',async t=>{
 const f=fixture(t);f.setOpen(false);f.service.configure(true);await f.service.tick();assert.ok(f.calls.every(job=>job.market==='external'));
 f.setOpen(true);f.setBlock(async job=>{if(job.name==='쏠림율')throw Error('upstream');});f.advance(60000);await f.service.tick();
 assert.ok(f.service.status().jobs.some(j=>j.name==='쏠림율'&&j.error));assert.ok(f.service.status().jobs.some(j=>j.name==='시장수급'&&j.lastSuccessAt));
});
test('a blocked source does not delay another source next refresh or duplicate its own request',async t=>{
 const f=fixture(t);let release;const gate=new Promise(resolve=>release=resolve);
 f.setBlock(job=>job.name==='쏠림율'?gate:undefined);
 f.service.configure(true);await new Promise(resolve=>setImmediate(resolve));
 const first=f.calls.filter(j=>j.name==='시장수급').length;
 f.advance(60000);const second=f.service.tick();await new Promise(resolve=>setImmediate(resolve));
 assert.ok(f.calls.filter(j=>j.name==='시장수급').length>first);
 assert.equal(f.calls.filter(j=>j.name==='쏠림율').length,1);
 release();await second;
});
test('rolling source pages merge into saved daily history without losing earlier observations',async t=>{
 const f=fixture(t);f.service.configure(true);await f.service.tick();const job=f.calls.find(j=>j.name==='쏠림율');
 f.setRows([{time:'20261102180100',value:0,stock_price:101}]);f.advance(60000);await f.service.tick();
 const saved=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(f.directory,'snapshots',job.id,'2026-11-02.json.gz'))));
 assert.deepEqual(saved.data.points.map(p=>p.time),['20261102180000','20261102180100']);assert.equal(saved.data.points[1].value,0);
});
test('HTTP setting changes require admin; cached GETs retain pagination while POST owner sessions remain independent',async t=>{
 const f=fixture(t),app=require('express')();app.use(require('express').json());app.use((req,res,next)=>{req.authUser={isAdmin:req.headers['x-test-admin']==='yes'};next();});mountBackgroundRoutes(app,f.service);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const url='http://127.0.0.1:'+server.address().port+'/api/background-refresh';
 const denied=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"enabled":true}'});assert.equal(denied.status,403);assert.equal(f.calls.length,0);
 const changed=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json','x-test-admin':'yes'},body:'{"enabled":true}'});assert.equal(changed.status,200);await f.service.tick();
 const restored=await (await fetch(url)).json();assert.equal(restored.enabled,true);assert.equal(restored.editable,false);
 const job=f.calls.find(j=>j.method==='GET');assert.ok(f.service.cached('GET',job.url,job.params).cursor);assert.equal(f.service.cached('GET',job.url,{...job.params,cursor:'older'}),null);
 const post=f.calls.find(j=>j.method==='POST');assert.equal(f.service.cached('POST',post.url,post.params),null);
 const invalid=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json','x-test-admin':'yes'},body:'{"enabled":"yes"}'});assert.equal(invalid.status,400);
});
test('background stock supply uses the same source as the combined card: KIS minute, Kiwoom day',()=>{
 const {buildJobs}=require('../../background-refresh'),at=Date.parse('2026-11-06T10:00:00+09:00');
 const job=mode=>buildJobs({rankChartDisplay:{mode,combinedSupply:{selected:'000660',mode}},backgroundSupply:{stocks:[{code:'000660'}]}},at).find(j=>j.name==='종목수급');
 assert.equal(job('minute').url,'/api/kis-supply/chart');assert.deepEqual(job('minute').params,{code:'000660',mode:'minute'});
 assert.equal(job('day').url,'/api/supply/chart');
});
