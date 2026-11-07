'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLsStockFutures}=require('../../ls-stock-futures');
const friday=Date.parse('2026-11-06T10:00:30+09:00');
function fakeLs(calls,{daily=179,previous='20261105'}={}){
 return {post:async(url,body,{headers})=>{
  const tr=headers.tr_cd,input=body[tr+'InBlock'];calls.push({tr,cont:headers.tr_cont,input});const data={rsp_cd:'00000'};
  if(tr==='t2522')data.t2522OutBlock1=[{bsc_asts_nm:'삼성전자',bsc_asts_is_cd:'005930',bsc_asts_id:'S11',nmc_is_shrt_cd:'A116B000'}];
  if(tr==='t8463')data.t8463OutBlock1=input.bgubun==='0'?[
   {date:'20261106',time:'100030',indmsvol:3,formsvol:2,sysmsvol:-5},{date:'20261106',time:'100000',indmsvol:1,formsvol:1,sysmsvol:-2},{date:'20261106',time:'095930',indmsvol:9,formsvol:9,sysmsvol:9}]
   :[{date:previous,time:'160650',indmsvol:-60046,formsvol:-758,sysmsvol:61394},{date:previous,time:'154530',indmsvol:-60046,formsvol:-1000,sysmsvol:61636}];
  if(tr==='t8406')data.t8406OutBlock1=[{chetime:'100100',price:188500,open:188000,high:189000,low:187500},{chetime:'100000',price:188000,open:187900,high:188100,low:187800}];
  if(tr==='t8462')data.t8462OutBlock1=Array.from({length:daily},(_,i)=>({date:new Date(Date.UTC(2026,10,6)-i*86400000).toISOString().slice(0,10).replaceAll('-',''),sv_08:-i,sv_17:i,sv_18:2*i})).filter(r=>r.date<=input.to_date&&r.date>='20260211');
  if(tr==='t8405'){const page=calls.filter(c=>c.tr==='t8405').length;data.t8405OutBlock={date:page===1?'20260611':page===2?'20260112':'20260112',cts_code:'A1166000',lastdate:'20260514'};
   data.t8405OutBlock1=page<=2?Array.from({length:100},(_,i)=>({date:String((page===1?20261106:20260611)-i),open:1,high:3,low:1,close:2})):[];}
  return {data};
 }};
}
const setup=(calls,options={})=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lsf-test-'));
 return {directory,svc:createLsStockFutures({http:fakeLs(calls,options),getToken:async()=>'t',directory,supply:{summary:()=>({stocks:[{code:'005930'},{code:'035720'}]})},now:()=>friday,policy:()=>({openDate:()=>true}),pause:async()=>{}})};};
test('minute flow keeps the last 30 s row of each minute; day files keep flow only',async()=>{
 const calls=[],{svc,directory}=setup(calls);
 const m=await svc.query({code:'005930',mode:'minute'});
 assert.equal(m.date,'2026-11-06');
 assert.deepEqual(m.points.map(p=>[new Date(p.t+9*3600000).toISOString().slice(11,16),p.individual,p.foreign,p.institution]),[['09:59',9,9,9]],'the current minute (10:00) is not shown until it ends');
 const saved=JSON.parse(fs.readFileSync(path.join(directory,'005930','2026-11-06.json'),'utf8'));
 assert.deepEqual(saved.points.map(p=>p.individual),[9,3],'10:00 keeps its 10:00:30 row');
 assert.equal(saved.candles,undefined,'price bars are not stored (KIS is asked when shown)');assert.equal(calls.filter(c=>c.tr==='t8406').length,0);
 assert.deepEqual(calls.find(c=>c.tr==='t8463').input,{tm_rng:'D',fot_clsf_cd:'F',bsc_asts_id:'S11',cnt:900,bgubun:'0'});
});
test('day flow maps 개인/외국인/기관 contracts and loads every LS page at once',async()=>{
 const calls=[],{svc}=setup(calls);
 const d=await svc.query({code:'005930',mode:'day'});
 assert.equal(d.points.length,179);assert.deepEqual([d.points.at(-1).individual,d.points.at(-1).foreign,d.points.at(-1).institution],[-0,0,0]);
 const pages=calls.filter(c=>c.tr==='t8462');assert.equal(pages.length,2,'a full page asks once more for older days');assert.equal(pages[1].input.to_date,'20260511');
 assert.equal(d.has_more,false,'every page is already loaded (LS starts 2026-02-11), so 더 불러오기 is not offered');assert.equal(d.cursor,null);assert.equal(d.oldest,'2026-05-12');
 const short=setup([], {daily:20}).svc;assert.equal((await short.query({code:'005930',mode:'day'})).has_more,false,'a short answer is the oldest LS serves');
 await assert.rejects(svc.query({code:'035720',mode:'day'}),e=>e.status===404&&/주식선물이 없는/.test(e.message));
});
test('연결선물 day candles page with tr_cont Y and load only what the range needs',async()=>{
 const calls=[],{svc}=setup(calls);
 const first=await svc.candles({code:'005930',mode:'day',count:'100'});
 assert.equal(first.points.length,100);assert.equal(calls.filter(c=>c.tr==='t8405').length,1);
 assert.equal(calls.find(c=>c.tr==='t8405').input.futcheck,'1');
 const more=await svc.candles({code:'005930',mode:'day',count:'150'});
 assert.equal(more.points.length,150);const pages=calls.filter(c=>c.tr==='t8405');
 assert.equal(pages.length,2);assert.equal(pages[1].cont,'Y');assert.equal(pages[1].input.date,'20260611');
 const all=await svc.candles({code:'005930',mode:'day',from:'20000101'});assert.equal(all.exhausted,true);assert.equal(all.partial,false);
});
test('collection runs only in the futures day session for registered stocks with futures',async()=>{
 const calls=[],{svc,directory}=setup(calls);
 await svc.collect();
 assert.deepEqual(calls.filter(c=>['t8463','t8406'].includes(c.tr)).map(c=>c.tr),['t8463'],'035720 has no futures and is skipped; no t8406');
 const run=JSON.parse(fs.readFileSync(path.join(directory,'collect-2026-11-06.jsonl'),'utf8').trim());
 assert.deepEqual(run.results,[{code:'005930',contract:'A116B000'}],'each run is recorded for the scheduled collection check');
 assert.equal(svc.collectingAt(Date.parse('2026-11-06T08:44:00+09:00')),false);assert.equal(svc.collectingAt(Date.parse('2026-11-06T08:45:00+09:00')),true);
 assert.equal(svc.collectingAt(Date.parse('2026-11-06T16:20:00+09:00')),true);assert.equal(svc.collectingAt(Date.parse('2026-11-06T16:21:00+09:00')),false);
 assert.equal(svc.collectingAt(Date.parse('2026-11-07T10:00:00+09:00')),false,'Saturday');
});
test('minute queries off-session read stored days and call t8463 (about 10 s) only for a session LS still serves',async()=>{
 const saturday=Date.parse('2026-11-07T21:00:00+09:00'),calls=[],directory=fs.mkdtempSync(path.join(os.tmpdir(),'lsf-test-'));
 const svc=createLsStockFutures({http:fakeLs(calls,{previous:'20261106'}),getToken:async()=>'t',directory,supply:{summary:()=>({stocks:[{code:'005930'}]})},now:()=>saturday,policy:()=>({openDate:()=>null}),pause:async()=>{}});
 const flow=()=>calls.filter(c=>c.tr==='t8463');
 // Nothing stored yet: the latest session (Friday 11/6) is fetched once with bgubun 1, not today's empty list first.
 const first=await svc.query({code:'005930',mode:'minute'});
 assert.equal(first.date,'2026-11-06');assert.deepEqual(flow().map(c=>c.input.bgubun),['1']);
 assert.ok(fs.existsSync(path.join(directory,'005930','2026-11-06.json')));
 // Saturday itself, days LS no longer serves, and the stored final day: no t8463 at all.
 for(const date of ['2026-11-07','2026-11-05','2026-11-03','2026-11-06'])assert.equal((await svc.query({code:'005930',mode:'minute',date})).date,date);
 await svc.candles({code:'005930',mode:'minute',date:'2026-11-05'});await svc.candles({code:'005930',mode:'minute',date:'2026-11-07'});
 assert.equal((await svc.candles({code:'005930',mode:'minute'})).date,'2026-11-06','candles without a date use the latest session, not Saturday');
 assert.equal(flow().length,1,'only the first query called t8463');
 assert.equal(calls.filter(c=>c.tr==='t8406').length,0,'LS t8406 is no longer used');
});
test('LS calls of the same TR start 1.1 s apart but overlap, so collection does not wait 10 s per stock',async()=>{
 const calls=[],started=[],release=[];let clock=0;
 const http={post:async(url,body,{headers})=>{const tr=headers.tr_cd;calls.push(tr);
  if(tr==='t2522')return {data:{rsp_cd:'00000',t2522OutBlock1:[{bsc_asts_is_cd:'005930',bsc_asts_id:'S11',nmc_is_shrt_cd:'A116B000'},{bsc_asts_is_cd:'000660',bsc_asts_id:'S50',nmc_is_shrt_cd:'A506B000'}]}};
  if(tr==='t8463'){started.push(clock);await new Promise(r=>release.push(r));return {data:{rsp_cd:'00000',t8463OutBlock1:[{date:'20261106',time:'100000',indmsvol:1,formsvol:1,sysmsvol:1}]}};}
  return {data:{rsp_cd:'00000',t8406OutBlock1:[]}};}};
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lsf-test-'));
 const svc=createLsStockFutures({http,getToken:async()=>'t',directory,supply:{summary:()=>({stocks:[{code:'005930'},{code:'000660'}]})},now:()=>friday,policy:()=>({openDate:()=>true}),pause:async ms=>{clock+=ms;}});
 const run=svc.collect();
 for(let i=0;i<50&&started.length<2;i++)await new Promise(r=>setImmediate(r));
 assert.equal(started.length,2,'the second t8463 starts while the first is still waiting for LS');
 assert.equal(started[1]-started[0],1100,'starts of one TR are spaced 1.1 s');
 release.forEach(r=>r());await run;
 assert.equal(fs.readdirSync(directory).filter(f=>/^\d{6}$/.test(f)).length,2);
});
test('minute bars come from KIS only, for any open day with or without flow, kept in memory and never written',async()=>{
 const saturday=Date.parse('2026-11-07T21:00:00+09:00'),calls=[],kis=[],directory=fs.mkdtempSync(path.join(os.tmpdir(),'lsf-test-'));
 fs.mkdirSync(path.join(directory,'005930'));fs.writeFileSync(path.join(directory,'005930','2026-11-04.json'),JSON.stringify({day:'2026-11-04',points:[{t:Date.parse('2026-11-04T09:00:00+09:00'),individual:1,foreign:1,institution:1,source_time:'160946'}]}));
 // Fake KIS: 102 bars per page ending at the asked hour, newest first, crossing into the previous day before 08:45.
 const kisMinute=async({code,date,hour})=>{kis.push({code,date,hour});const d=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6),end=Math.min(Date.parse(d+'T'+hour.slice(0,2)+':'+hour.slice(2,4)+':00+09:00'),Date.parse(d+'T15:45:00+09:00')),rows=[];
  for(let i=0;i<102;i++){const t=end-i*60000,k=new Date(t+9*3600000),hh=k.toISOString().slice(11,16).replace(':','');
   rows.push(hh<'0845'?{stck_bsop_date:'20000101',stck_cntg_hour:'150000',futs_oprc:1,futs_hgpr:1,futs_lwpr:1,futs_prpr:1}:{stck_bsop_date:date,stck_cntg_hour:hh+'00',futs_oprc:200000,futs_hgpr:200500,futs_lwpr:199500,futs_prpr:200100});}
  return rows;};
 const svc=createLsStockFutures({http:fakeLs(calls,{previous:'20261106'}),getToken:async()=>'t',directory,supply:{summary:()=>({stocks:[]})},now:()=>saturday,policy:()=>({openDate:()=>null}),pause:async()=>{},kisMinute});
 const r=await svc.candles({code:'005930',mode:'minute',date:'2026-11-04'});
 assert.equal(kis[0].code,'A11611');assert.equal(kis[0].hour,'154600');
 assert.equal(r.points.length,421,'08:45~15:45');assert.equal(new Date(r.points[0].t+9*3600000).toISOString().slice(11,16),'08:45');
 assert.match(r.source,/KIS FHKIF03020200 A11611/);assert.equal(r.cursor,'20261103');
 const pages=kis.length;await svc.candles({code:'005930',mode:'minute',date:'2026-11-04'});assert.equal(kis.length,pages,'a finished day is asked once (memory)');
 assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'005930','2026-11-04.json'),'utf8')).candles,undefined,'nothing written');
 // 11/5 has no flow file: its bars are still served, and paging goes 11/6 → 11/5 → 11/4 over open days.
 const latest=await svc.candles({code:'005930',mode:'minute'});assert.equal(latest.date,'2026-11-06');assert.equal(latest.cursor,'20261105');
 const noFlow=await svc.candles({code:'005930',mode:'minute',date:'2026-11-05'});assert.equal(noFlow.points.length,421);assert.equal(noFlow.cursor,'20261104');
 assert.ok(!fs.existsSync(path.join(directory,'005930','2026-11-05.json')));
 // Saturday and days before KIS's first day give nothing; paging stops at 2025-10-29.
 assert.equal((await svc.candles({code:'005930',mode:'minute',date:'2026-11-07'})).points.length,0);
 const first=await svc.candles({code:'005930',mode:'minute',date:'2025-10-29'});assert.equal(first.has_more,false);assert.equal(kis.at(-1).code,'111W11','2025 contracts use the old code form');
 const calls8406=calls.filter(c=>c.tr==='t8406').length;assert.equal(calls8406,0);
 assert.deepEqual([svc.kisContract({id:'S11'},'2026-11-12'),svc.kisContract({id:'S11'},'2026-11-13'),svc.kisContract({id:'S50'},'2026-12-31'),svc.kisContract({id:'S50'},'2025-12-30')],['A11611','A11612','A50701','A50601'],'expiry 2nd Thursday rolls to the next month');
});
test('today\'s bars during the session refresh every 20 s with only the newest KIS page',async()=>{
 let clock=Date.parse('2026-11-09T10:00:30+09:00');const kis=[],directory=fs.mkdtempSync(path.join(os.tmpdir(),'lsf-test-'));
 const kisMinute=async({code,date,hour})=>{kis.push(hour);const last=Math.floor((clock-60000)/60000)*60000,rows=[];
  for(let i=0;i<102;i++){const t=last-i*60000,hh=new Date(t+9*3600000).toISOString().slice(11,16).replace(':','');if(hh<'0845')break;rows.push({stck_bsop_date:date,stck_cntg_hour:hh+'00',futs_oprc:1,futs_hgpr:2,futs_lwpr:1,futs_prpr:2});}
  if(rows.length<102)rows.push({stck_bsop_date:'20261106',stck_cntg_hour:'154500',futs_oprc:1,futs_hgpr:1,futs_lwpr:1,futs_prpr:1});return rows;};
 const svc=createLsStockFutures({http:fakeLs([]),getToken:async()=>'t',directory,supply:{summary:()=>({stocks:[]})},now:()=>clock,policy:()=>({openDate:()=>true}),pause:async()=>{},kisMinute});
 const a=await svc.candles({code:'005930',mode:'minute'});assert.equal(a.date,'2026-11-09');const firstCalls=kis.length;
 clock+=10000;await svc.candles({code:'005930',mode:'minute'});assert.equal(kis.length,firstCalls,'within 20 s from memory');
 clock+=60000;const b=await svc.candles({code:'005930',mode:'minute'});assert.equal(kis.length,firstCalls+1,'one newest page');assert.equal(b.points.length,a.points.length+1);
 assert.deepEqual(fs.readdirSync(directory).filter(f=>f!=='master.json'),[],'no bar files written');
});
