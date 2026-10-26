const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createBrokerStockSupply}=require('../../broker-stock-supply');const {timestamp}=require('../../supply-service');
for(const broker of ['kis','ls'])test(`${broker} investor and program daily history fills 600 dates, including more than 12 program pages`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stock-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const dates=Array.from({length:600},(_,i)=>new Date(Date.UTC(2026,9,26)-(599-i)*86400000).toISOString().slice(0,10).replaceAll('-',''));const calls=[];
 const row=dt=>broker==='ls'?{date:dt,tjj0008_vol:1,tjj0016_vol:2,tjj0018_vol:3,svolume:4}:{stck_bsop_date:dt,prsn_ntby_qty:1,frgn_ntby_qty:2,orgn_ntby_qty:3,whol_smtn_ntby_qty:4};
 const http={get:async(url,{params,headers})=>{calls.push({url,params});const rows=dates.filter(d=>d<=params.FID_INPUT_DATE_1).slice(-30).reverse().map(row);return {data:{rt_cd:'0',[headers.tr_id==='FHPTJ04160001'?'output2':'output']:rows}};},post:async(url,body,{headers})=>{
 const tr=headers.tr_cd,p=body[tr+'InBlock'];calls.push({url,p,headers});let available=dates.filter(d=>d<=(p.todt||p.date));
 if(tr==='t1637'&&headers.tr_cont==='Y'){assert.equal(headers.tr_cont_key,'page-key');available=available.filter(d=>d<p.date);}
 const rows=available.slice(-(tr==='t1717'?250:21)).reverse().map(row);
 return {headers:{tr_cont:'Y',tr_cont_key:'page-key'},data:{rsp_cd:'00000',[tr==='t1717'?'t1717OutBlock':'t1637OutBlock1']:rows}};
 }};
 const service=createBrokerStockSupply({broker,directory:dir,http,credentials:()=>({domain:'https://kis.example'}),getToken:async()=>'hidden',pause:async()=>{},now:()=>timestamp('20261026','210000'),supply:{summary:()=>({archive:[{code:'005930'}],stocks:[]}),candles:async()=>({points:dates.map(d=>({t:timestamp(d),close:10})),has_more:false})}});
 const result=await service.query({code:'005930',mode:'day'});assert.equal(result.points.length,600);assert.ok(result.points.every(p=>p.individual===1&&p.foreign===2&&p.institution===3&&p.program===4));
 const programs=calls.filter(c=>c.url.endsWith(broker==='ls'?'/program':'/program-trade-by-stock-daily'));assert.ok(programs.length>12);const n=calls.length;await service.query({code:'005930',mode:'day'});assert.equal(calls.length,n);
});


test('KIS leading zero-response warning uses source dates even if candle pages arrive out of order',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stock-zero-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const dates=Array.from({length:30},(_,i)=>new Date(Date.UTC(2026,9,26)-(29-i)*86400000).toISOString().slice(0,10).replaceAll('-',''));
 const service=createBrokerStockSupply({broker:'kis',directory:dir,getToken:async()=>'hidden',credentials:()=>({domain:'https://kis.example'}),pause:async()=>{},now:()=>timestamp('20261026','220000'),supply:{summary:()=>({archive:[{code:'005930'}]}),candles:async()=>({points:dates.slice().reverse().map(d=>({t:timestamp(d),close:1}))})},http:{get:async(url)=>({data:{rt_cd:'0',[url.endsWith('/investor-trade-by-stock-daily')?'output2':'output']:dates.slice().reverse().map(dt=>({stck_bsop_date:dt,prsn_ntby_qty:1,frgn_ntby_qty:2,orgn_ntby_qty:3,whol_smtn_ntby_qty:dates.indexOf(dt)<25?0:4}))}})}});
 const r=await service.query({code:'005930',mode:'day'});assert.ok(r.warnings.some(w=>w.includes('과거 25일 원천 0 응답')));assert.equal(r.points.filter(p=>p.program===0).length,25);
});
