const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const intervals={'5':30000,'1':60000,'2':600000,'3':3600000,'4':30000};
const dateAt=t=>new Date(t+32400000).toISOString().slice(0,10);
const canonical=o=>JSON.stringify(Object.fromEntries(Object.entries(o||{}).map(([k,v])=>[k,String(v)]).sort(([a],[b])=>a.localeCompare(b))));
function requestKey(method,url,params){return method+':'+url+':'+canonical(params);}
function sourceDate(row){
 const value=row?.t??row?.time??row?.date;
 if(typeof value==='number'&&Number.isFinite(value))return dateAt(value);
 if(typeof value==='string'&&/^\d{8}/.test(value))return value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8);
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}/.test(value))return value.slice(0,10);
 return null;
}
function mergeSnapshot(old,next,date){
 if(Array.isArray(next)){
  if(!next.length&&Array.isArray(old)&&old.some(row=>sourceDate(row)))return old.filter(row=>sourceDate(row)===date);
  if(!next.some(row=>sourceDate(row)))return next;
  const rows=new Map();
  for(const row of [...(Array.isArray(old)?old:[]),...next])if(sourceDate(row)===date){
   const key=row.t??row.time??row.date,previous=rows.get(key)||{};
   rows.set(key,{...previous,...row,...Object.fromEntries(Object.entries(previous).filter(([k,v])=>v!=null && row[k]==null))});
  }
  return [...rows.values()].sort((a,b)=>String(a.t??a.time??a.date).localeCompare(String(b.t??b.time??b.date)));
 }
 if(next&&typeof next==='object')return Object.fromEntries(Object.entries(next).map(([key,value])=>[key,mergeSnapshot(old?.[key],value,date)]));
 return next;
}
function buildJobs(settings={},now=Date.now()){
 const display=settings.rankChartDisplay||{},mode=display.mode==='minute'?'minute':'day',jobs=new Map();
 const add=(name,url,params,market='spot',method='GET')=>{
  const key=requestKey(method,url,params),id=name+'-'+crypto.createHash('sha256').update(key).digest('hex').slice(0,16);
  if(!jobs.has(key))jobs.set(key,{id,name,url,params,market,method,key});
 };
 const valid=code=>typeof code==='string'&&/^[0-9A-Za-z]{6}$/.test(code);
 const stock=display.selection?.code,stocks=settings.backgroundSupply?.stocks||[];
 add('종목조회 순위','/api/stock',{qry_tp:Object.hasOwn(intervals,settings.rankInterval)?settings.rankInterval:'2'});
 add('거래대금 순위','/api/transaction_rank',{mrkt_tp:['000','001','101'].includes(settings.rankSources?.market)?settings.rankSources.market:'000',stex_tp:['1','2','3'].includes(settings.rankSources?.exchange)?settings.rankSources.exchange:'3'});
 add('관심종목 순위','/api/watchlist_rank',{grp_id:typeof settings.watchlistGroupId==='string'&&settings.watchlistGroupId.length<=80?settings.watchlistGroupId:'074'});
 if(valid(stock)){
  const params={code:stock,mode,interval:[1,3,5,10,15,30,45,60].includes(Number(display.interval))?Number(display.interval):1};
  add('쏠림율',mode==='minute'?'/api/ls-concentration-chart':'/api/concentration-chart',params,'spot','POST');
  add('종목 가격','/api/concentration-chart',{...params,prices_only:true},'spot','POST');
 }
 for(const [key,fallback]of [['combinedMarketSupply','kospi'],['combinedMarketSupplySecondary','kospi'],['testMarketSupply','futures']]){
  const state=display[key]||{},selected=['kospi','kosdaq','futures','futuresKosdaq'].includes(state.selected)?state.selected:fallback;
  const m=state.mode==='minute'?'minute':state.mode==='day'?'day':mode,future=selected.startsWith('futures');
  const url=key==='testMarketSupply'&&future?'/api/ls-futures-test/chart':m==='day'?'/api/ls-market-supply/chart':future?'/api/market-supply/chart':'/api/kiwoom-market-supply/chart';
  add(key==='testMarketSupply'?'시장수급 테스트':'시장수급',url,{code:selected,mode:m,...(m==='minute'&&future?{prices:'0'}:{})},future?'futures':'spot');
  if(future&&key==='testMarketSupply'&&m==='minute')add('선물 가격','/api/ls-futures-test/candles',{code:selected,from:dateAt(now).replaceAll('-',''),to:dateAt(now).replaceAll('-','')},'futures');
  else if(key==='testMarketSupply'&&future)add('선물 가격','/api/ls-futures-test/chart',{code:selected,mode:'day',prices_only:'1'},'futures');
 }
 const supply=display.combinedSupply||{},selected=valid(supply.selected)?supply.selected:stocks[0]?.code;
 if(valid(selected)&&stocks.some(s=>s.code===selected)){
  const m=supply.mode==='minute'?'minute':supply.mode==='day'?'day':mode;
  // Same source as the combined stock supply card: KIS minute, Kiwoom day.
  add('종목수급',m==='minute'?'/api/kis-supply/chart':'/api/supply/chart',{code:selected,mode:m});
  add('수급 종목 가격','/api/supply/candles',{code:selected,mode:m});
 }
 add('시장 거래대금',mode==='minute'?'/api/ls-turnover/chart':'/api/turnover/chart',{mode});
 const breadth=display.breadth||{};
 add('신고 신저','/api/risk/breadth',{market:breadth.market==='kospi'?'kospi':'kosdaq',mode:breadth.mode==='day'?'day':breadth.mode==='minute'?'minute':mode});
 for(const market of ['kospi','kosdaq']){
  add('시장 가격','/api/chart-reference',{market,mode});
  add('ADR',mode==='minute'?'/api/adr/today':'/api/adr/history',{market,...(mode==='day'?{range:'6m'}:{})});
 }
 add('변동성','/api/risk/volatility',{range:'all'},'external');
 add('심리','/api/risk/sentiment',{range:'all'},'external');
 return [...jobs.values()];
}
function createBackgroundRefresh({directory,readSettings,execute,policy,setStocks=()=>{},now=Date.now,schedule=setInterval,cancel=clearInterval}){
 const configFile=path.join(directory,'config.json'),states=new Map();let enabled=false,timer,lastSuccessAt=null,generation=0,lastPeriod,fallbackStock;
 const browsers=new Map();let resumeAt=0;
 function browserCount(){
  let expired=0;
  for(const [id,entry]of browsers)if(entry.until<=now()){browsers.delete(id);expired=Math.max(expired,entry.until);}
  if(expired&&!browsers.size)resumeAt=Math.max(resumeAt,expired+30000);
  return browsers.size;
 }
 function pauseForBrowser(id,until){
  const wasActive=browserCount()>0,entry={until};browsers.set(id,entry);
  if(!wasActive){generation++;setStocks([]);for(const state of states.values())state.next=0;}
  return ()=>{if(browsers.get(id)!==entry)return;browsers.delete(id);if(!browserCount())resumeAt=now()+30000;};
 }
 function connectBrowser(id){return pauseForBrowser(id,Infinity);}
 function touchBrowser(id,active=true,ttl=15000){
  if(active)pauseForBrowser(id,now()+ttl);
  else if(browsers.delete(id)&&!browserCount())resumeAt=now()+30000;
 }
 function paused(){return browserCount()>0||now()<resumeAt;}
 function waitForIdle(){return Promise.allSettled([...states.values()].filter(s=>s.running).map(s=>s.promise));}
 function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,file);}
 try{enabled=JSON.parse(fs.readFileSync(configFile,'utf8')).enabled===true;}catch(error){if(error.code!=='ENOENT')throw error;}
 function archive(job,result){
  const safe=JSON.parse(JSON.stringify(result,(key,value)=>/token|secret|authorization|appkey|cursor|next.key/i.test(key)?undefined:value));
  const folder=path.join(directory,'snapshots',job.id);
  write(path.join(folder,'latest.json'),{at:now(),name:job.name,params:job.params,data:safe});
  // Store a timestamped snapshot per source date. A new collection replaces
  // that day's snapshot without creating unbounded per-refresh files.
  const dates=new Set();
  function visit(value){if(!value||typeof value!=='object')return;const date=sourceDate(value);if(date)dates.add(date);for(const child of Object.values(value))if(child&&typeof child==='object')visit(child);}
  visit(safe);
  for(const date of (dates.size?[...dates].sort().slice(-3):[dateAt(now())])){
   const file=path.join(folder,date+'.json.gz'),temp=file+'.tmp';
   let previous;try{previous=JSON.parse(zlib.gunzipSync(fs.readFileSync(file))).data;}catch(error){if(error.code!=='ENOENT')throw error;}
   fs.writeFileSync(temp,zlib.gzipSync(JSON.stringify({at:now(),name:job.name,params:job.params,data:mergeSnapshot(previous,safe,date)})));
   fs.renameSync(temp,file);
  }
 }
 function status(){const count=browserCount();return {enabled,paused:count>0||now()<resumeAt,browserCount:count,resumeAt:count?null:resumeAt,running:[...states.values()].some(s=>s.running),lastSuccessAt,jobs:[...states.values()].map(s=>({id:s.job.id,name:s.job.name,params:s.job.params,lastSuccessAt:s.lastSuccessAt||null,error:s.error||null,running:s.running}))};}
 async function tick(){
  if(!enabled||paused()){setStocks([]);return;}
  const epoch=generation;
  return (async()=>{
   let settings=readSettings()||{};
   if(!settings.rankChartDisplay?.selection?.code && fallbackStock)settings={...settings,rankChartDisplay:{...settings.rankChartDisplay,selection:fallbackStock}};
   const jobs=buildJobs(settings,now()),period=intervals[settings.rankInterval]||600000;
   if(lastPeriod!==period)for(const state of states.values())state.next=Math.min(state.next,(state.at??now())+period);
   lastPeriod=period;
   const selection=settings.rankChartDisplay?.selection?.code;
   setStocks(/^[0-9A-Za-z]{6}$/.test(selection||'')?[selection]:[]);
   const active=new Set(jobs.map(j=>j.id));for(const id of states.keys())if(!active.has(id)&&!states.get(id).running)states.delete(id);
   await Promise.all(jobs.map(job=>{
    const s=states.get(job.id)||{job,next:0,running:false};states.set(job.id,s);
    if(s.running)return s.promise;
    if(!enabled||paused()||epoch!==generation||now()<s.next||job.market==='spot'&&!policy.spotAt()||job.market==='futures'&&!policy.futuresAt())return;
    s.running=true;
    s.promise=(async()=>{
    try{
     const result=await execute(job);
     if(result?.success===false||result?.error)throw Error('Source query failed');
     if(!enabled||paused()||epoch!==generation)return;
     archive(job,result);s.value=structuredClone(result);s.at=now();s.lastSuccessAt=now();lastSuccessAt=now();s.error=result.partial?'일부 데이터 조회 실패':null;
     if(job.url==='/api/transaction_rank'){
      const first=result.items?.[0],code=String(first?.stk_cd||first?.code||'').replace(/_(AL|NX)$/i,'');
      if(/^[0-9A-Za-z]{6}$/.test(code))fallbackStock={code,name:first.stk_nm||first.name||code};
     }
    }catch{s.error='조회 또는 저장 실패';}
    finally{s.running=false;s.next=epoch===generation?now()+period:0;}
    })();return s.promise;
   }));
  })();
 }
 function configure(value){
  if(typeof value!=='boolean')throw Object.assign(Error('enabled must be boolean'),{status:400});
  write(configFile,{enabled:value});enabled=value;generation++;
  for(const state of states.values())state.next=0;
  if(!enabled)setStocks([]);else void tick().catch(()=>{});
  return status();
 }
 function cached(method,url,params){
  if(!enabled||paused()||method!=='GET'||params.cursor||params.date)return null;
  const normalized={...params};delete normalized.progressive;delete normalized._t;
  const key=requestKey(method,url,normalized),period=lastPeriod||600000;
  for(const s of states.values())if(s.job.key===key&&s.value&&!s.error&&now()-s.at<period&&!s.value.partial)return structuredClone(s.value);
  return null;
 }
 return {status,configure,tick,cached,connectBrowser,touchBrowser,waitForIdle,start(){if(timer)return;resumeAt=Math.max(resumeAt,now()+30000);void tick().catch(()=>{});timer=schedule(()=>void tick().catch(()=>{}),1000);timer.unref?.();},stop(){if(timer)cancel(timer);timer=null;generation++;setStocks([]);}};
}
function mountBackgroundRoutes(app,service,validSession=()=>true){
 app.get('/api/background-refresh/presence',(req,res)=>{
  const disconnect=service.connectBrowser(crypto.randomUUID());
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.flushHeaders();let closed=false;
  const heartbeat=setInterval(()=>{if(closed||res.writableEnded)return;try{if(!validSession(req))return res.end();res.write(': keepalive\n\n');}catch{res.end();}},15000);heartbeat.unref?.();
  res.on('close',()=>{closed=true;clearInterval(heartbeat);disconnect();});
  res.write(': waiting\n\n');
  void service.waitForIdle().then(()=>{if(!closed)res.write('data: {"ready":true}\n\n');});
 });
 app.get('/api/background-refresh',(req,res)=>res.set('Cache-Control','no-store').json({...service.status(),editable:req.authUser?.isAdmin===true}));
 app.put('/api/background-refresh',(req,res)=>{
  if(!req.authUser?.isAdmin)return res.status(403).json({error:'설정 변경 권한이 없습니다.'});
  try{res.json({...service.configure(req.body.enabled),editable:true});}
  catch(error){res.status(error.status||500).json({error:'자동갱신 설정을 저장하지 못했습니다.'});}
 });
}
function createJobExecutor(app,authUser){
 return job=>new Promise((resolve,reject)=>{
  const layer=app._router.stack.find(layer=>layer.route?.path===job.url&&layer.route.methods[job.method.toLowerCase()]);
  if(!layer)return reject(Error('Unknown background source'));
  let code=200;const res={set(){return this;},status(value){code=value;return this;},json(value){if(code>=400)reject(Error('Background source failed'));else resolve(value);}};
  const req={query:job.method==='GET'?job.params:{},body:job.method==='POST'?job.params:{},authUser};
  try{Promise.resolve(layer.route.stack.at(-1).handle(req,res,reject)).catch(reject);}catch(error){reject(error);}
 });
}
module.exports={createBackgroundRefresh,buildJobs,requestKey,mountBackgroundRoutes,createJobExecutor};
