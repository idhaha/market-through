const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createBrokerStockSupply,programRecords,lsInvestors}=require('../../broker-stock-supply');
const instant=Date.parse('2026-10-26T10:05:20+09:00');
function frame(code,time,value){return `0|H0UNPGM0|1|${[code,time,'999','888','777','666',value,'555','444','333','222'].join('^')}`;}
test('websocket parsing selects net shares, rejects amounts, unknown markets and malformed frames',()=>{
 assert.deepEqual(programRecords('kis',frame('005930','100520','-123')),[{code:'005930',time:'100520',value:-123}]);
 const two=frame('005930','100520','0').replace('|1|','|2|')+'^'+frame('000660','100519','456').split('|')[3];
 assert.equal(programRecords('kis',two)[1].value,456);
 assert.equal(programRecords('kis',two.replace('H0UNPGM0','H0STPGM0')).length,0);
 assert.equal(programRecords('kis',frame('005930','100520','2').replace('|1|','|2|')).length,0);
 assert.equal(programRecords('ls',JSON.stringify({header:{tr_cd:'UPH',tr_key:'U005930   '},body:{time:'100520',tvol:0,tval:99999}}))[0].value,0);
 assert.equal(programRecords('ls',JSON.stringify({header:{tr_cd:'UPH',tr_key:'K005930   '},body:{time:'100520',tvol:1}})).length,0);
 assert.deepEqual(lsInvestors({tjj0008_vol:0,tjj0016_vol:-100,tjj0018_vol:''}),{individual:0,foreign:-100,institution:null});
});
function fixture(t,broker='kis'){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'broker-stock-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let at=instant,watch=[{code:'005930'}];const sockets=[],calls=[];
 class Socket extends EventEmitter{constructor(){super();this.readyState=0;this.sent=[];sockets.push(this);}send(raw){this.sent.push(JSON.parse(raw));}terminate(){this.readyState=3;}ping(){}open(){this.readyState=1;this.emit('open');}ack(ok=true){const m=broker==='kis'?{header:{tr_id:'H0UNPGM0'},body:{rt_cd:ok?'0':'1'}}:{header:{tr_cd:'UPH',rsp_cd:ok?'00000':'99999'},body:{}};this.emit('message',JSON.stringify(m));}}
 const http={post:async(url,body)=>{calls.push({url,body});if(url.endsWith('/Approval'))return{data:{approval_key:'private'}};if(body.t1717InBlock)return{data:{rsp_cd:'00000',t1717OutBlock:[{date:'20261026',tjj0008_vol:0,tjj0016_vol:-2,tjj0018_vol:3}]}};return {data:{rsp_cd:'00000',t1637OutBlock1:[]}};},get:async(url)=>{calls.push({url});if(url.endsWith('investor-trend-estimate'))return{data:{rt_cd:'0',output2:[{bsop_hour_gb:'2',frgn_fake_ntby_qty:'12',orgn_fake_ntby_qty:'0'},{bsop_hour_gb:'1',frgn_fake_ntby_qty:'8',orgn_fake_ntby_qty:'5'}]}};if(url.endsWith('investor-trade-by-stock-daily'))return{data:{rt_cd:'0',output2:[{stck_bsop_date:'20261023',prsn_ntby_qty:1,frgn_ntby_qty:2,orgn_ntby_qty:3}]}};return{data:{rt_cd:'0',output:[{stck_bsop_date:'20261023',whol_smtn_ntby_qty:'-40'}]}};}};
 const supply={summary:()=>({stocks:watch,archive:[{code:'005930'},{code:'000660'}]}),confirmMarket:async()=>true,candles:async()=>({points:[{t:Date.parse('2026-10-23T00:00:00+09:00'),close:100}],has_more:false})};
 const service=createBrokerStockSupply({broker,directory:dir,http,credentials:()=>({domain:'https://broker.test',appKey:'private',secretKey:'private'}),getToken:async()=>'private',supply,now:()=>at,Socket,pause:async()=>{}});
 t.after(()=>service.stop());return{service,sockets,calls,http,setTime:x=>at=x,setWatch:x=>watch=x};
}
test('completed minute, actual zero, out of order/future/stale data and unregistered code stay distinct',async t=>{
 const f=fixture(t);f.service.start();await f.service.collect();const s=f.sockets[0];s.open();s.ack();
 s.emit('message',frame('005930','100518','123'));s.emit('message',frame('005930','100519','0'));s.emit('message',frame('005930','100517','555'));
 s.emit('message',frame('000660','100519','999'));s.emit('message',frame('005930','100521','999'));s.emit('message',frame('005930','100000','999'));
 assert.equal((await f.service.query({code:'005930',mode:'minute'})).points.length,0);
 f.setTime(instant+60000);f.service.flush();const p=(await f.service.query({code:'005930',mode:'minute'})).points[0];
 assert.equal(p.program,0);assert.equal(p.foreign,12);assert.equal(p.institution,0);assert.equal(p.individual,undefined);
 assert.equal(p.program_at,Date.parse('2026-10-26T10:05:19+09:00'));
});
test('shared watchlist removal unsubscribes even when empty, reconnect restores subscriptions',async t=>{
 const f=fixture(t,'ls');f.service.start();await f.service.collect();let s=f.sockets[0];s.open();s.ack();
 assert.equal(s.sent[0].body.tr_key,'U005930   ');
 f.setWatch([]);await f.service.collect();assert.equal(s.sent[1].header.tr_type,'4');s.ack();
 f.setWatch([{code:'000660'}]);await f.service.collect();assert.equal(s.sent[2].body.tr_key,'U000660   ');s.ack();
 s.emit('close');f.setTime(instant+65000);await f.service.collect();assert.equal(f.sockets.length,2);s=f.sockets[1];s.open();s.ack();assert.equal(s.sent[0].body.tr_key,'U000660   ');
});
test('daily flows come from the requested broker and only prices use the shared source',async t=>{
 const f=fixture(t);const d=await f.service.query({code:'005930',mode:'day'});
 assert.equal(d.points[0].individual,1);assert.equal(d.points[0].program,-40);assert.equal(d.candles[0].close,100);
 assert.ok(f.calls.some(c=>c.url.endsWith('/investor-trade-by-stock-daily')));assert.ok(f.calls.some(c=>c.url.endsWith('/program-trade-by-stock-daily')));
 await assert.rejects(f.service.query({code:'../bad',mode:'minute'}));
});
test('additional quote subscriptions share the program socket and rejection preserves the existing stream',async t=>{
 const f=fixture(t);let received=0;
 f.service.setStreams('quotes',[{tr:'H0UPCNT0',key:'0001',onData:()=>{received++;return true;}}]);
 f.service.start();await f.service.collect();const s=f.sockets[0];s.open();s.ack();
 assert.equal(s.sent[1].body.input.tr_id,'H0UPCNT0');
 s.emit('message',JSON.stringify({header:{tr_id:'H0UPCNT0',tr_key:'0001'},body:{rt_cd:'0'}}));
 s.emit('message','0|H0UPCNT0|1|data');assert.equal(received,1);assert.equal(f.sockets.length,1);
 f.service.setStreams('quotes',[{tr:'H0UPCNT0',key:'0001',onData:()=>true},{tr:'H0UPCNT0',key:'1001',onData:()=>true}]);
 s.emit('message',JSON.stringify({header:{tr_id:'H0UPCNT0',tr_key:'1001'},body:{rt_cd:'1'}}));
 assert.equal(s.readyState,1);assert.match(f.service.streamStatus('H0UPCNT0','1001').error,/REST/);
 assert.equal(f.service.streamStatus('H0UPCNT0','0001').subscribed,true);
});
test('progressive daily shares one job and exposes prices and investors while program is pending',async t=>{
 const f=fixture(t),original=f.http.get;let release;
 f.http.get=async(...args)=>{
  if(args[0].endsWith('/program-trade-by-stock-daily'))await new Promise(resolve=>{release=resolve;});
  return original(...args);
 };
 const first=await f.service.query({code:'005930',mode:'day',progressive:'1'});
 assert.equal(first.pending,true);assert.equal(first.candles[0].close,100);
 for(let i=0;i<20&&!release;i++)await new Promise(resolve=>setImmediate(resolve));
 const partial=await f.service.query({code:'005930',mode:'day',progressive:'1'});
 assert.equal(partial.points[0].foreign,2);assert.equal(partial.points[0].program,undefined);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/investor-trade-by-stock-daily')).length,1);
 release();const done=await f.service.query({code:'005930',mode:'day'});
 assert.equal(done.points[0].program,-40);
});

test('KIS appkey duplicate rejection without subscription TR is surfaced and retries slowly',async t=>{
 const f=fixture(t);f.service.start();await f.service.collect();const socket=f.sockets[0];socket.open();
 socket.emit('message',JSON.stringify({header:{tr_id:'(null)'},body:{rt_cd:'9',msg1:'ALREADY IN USE appkey'}}));
 assert.match(f.service.status.error,/앱키.*중복/);assert.equal(socket.readyState,3);
 f.setTime(instant+5000);await f.service.collect();assert.equal(f.sockets.length,1);
 f.setTime(instant+61000);await f.service.collect();assert.equal(f.sockets.length,2);
});

test('Oracle-priority setting disables local KIS socket while REST collection remains enabled',async t=>{
 const previous=process.env.KIS_STOCK_REALTIME_ENABLED;process.env.KIS_STOCK_REALTIME_ENABLED='false';
 try{const f=fixture(t);f.service.start();await f.service.collect();assert.equal(f.sockets.length,0);assert.ok(f.calls.some(c=>c.url.endsWith('investor-trend-estimate')));assert.match(f.service.status.websocket,/중지/);}
 finally{if(previous===undefined)delete process.env.KIS_STOCK_REALTIME_ENABLED;else process.env.KIS_STOCK_REALTIME_ENABLED=previous;}
});
