const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const root='/home/ubuntu/market-through/data/market-supply',batch=__dirname;
const payload=JSON.parse(fs.readFileSync(path.join(batch,'payload.json'),'utf8'));
const mode=process.argv[2]||'plan',planFile=path.join(batch,'plan.json');
const fields=['individual','foreign','institution'];
const day=t=>new Date(t+32400000).toISOString().slice(0,10);
const clock=t=>new Date(t+32400000).toISOString().slice(11,16);
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const hash=file=>fs.existsSync(file)?digest(fs.readFileSync(file)):null;
const read=file=>JSON.parse((file.endsWith('.gz')?zlib.gunzipSync(fs.readFileSync(file)):fs.readFileSync(file)).toString('utf8'));
function assert(ok,message){if(!ok)throw Error(message);}
function build(){
 assert(payload.version===1 && payload.unit==='million KRW','Unexpected payload');
 const targets=[],baseline={};
 for(const code of ['FUTURE','FUTKQ0']){
  assert(Array.isArray(payload.markets[code])&&payload.markets[code].length>0,'Missing market');
  const directory=path.join(root,code);
  for(const name of fs.readdirSync(directory).filter(n=>/^\d{4}-\d{2}-\d{2}\.json(\.gz)?$/.test(n)))baseline[path.join(directory,name)]=hash(path.join(directory,name));
  const grouped=new Map();
  for(const p of payload.markets[code]){
   assert(Number.isSafeInteger(p.t)&&p.t%60000===0&&p.t<Math.floor(Date.now()/60000)*60000&&p.t>=payload.collectedAt-10*86400000,'Invalid minute');
   assert(p.source==='LS'&&p.session==='N'&&(clock(p.t)>='18:00'||clock(p.t)<='06:01'),'Not night supply');
   for(const f of fields)if(p[f]!=null)assert(Number.isSafeInteger(p[f])&&Number.isSafeInteger(p[f+'_at'])&&p[f+'_at']>=p.t&&p[f+'_at']<p.t+60000,'Invalid source amount/time');
   if(!grouped.has(day(p.t)))grouped.set(day(p.t),[]);grouped.get(day(p.t)).push(p);
  }
  for(const [date,incoming]of grouped){
   const plain=path.join(directory,date+'.json'),file=fs.existsSync(plain)?plain:fs.existsSync(plain+'.gz')?plain+'.gz':plain;
   const before=fs.existsSync(file)?read(file):[],rows=new Map(before.map(p=>[p.t,p]));let added=0,updated=0;
   assert(Array.isArray(before),'Bad stored format');
   for(const p of incoming){
    const old=rows.get(p.t),next={...old,t:p.t};let accepted=false;
    for(const f of fields)if(Number.isSafeInteger(p[f])&&(!Number.isFinite(old?.[f+'_at'])||p[f+'_at']>=old[f+'_at'])){next[f]=p[f];next[f+'_at']=p[f+'_at'];accepted=true;}
    if(!accepted)continue;next.source='LS';next.session='N';
    if(!old)added++;else if(JSON.stringify(old)!==JSON.stringify(next))updated++;
    rows.set(p.t,next);
   }
   const next=[...rows.values()].sort((a,b)=>a.t-b.t);
   for(const p of before.filter(p=>clock(p.t)>='08:00'&&clock(p.t)<='15:46'))assert(JSON.stringify(rows.get(p.t))===JSON.stringify(p),'Daytime changed');
   targets.push({code,date,file,oldHash:hash(file),before,rows:next,added,updated,incoming:incoming.length});
  }
 }
 return {createdAt:Date.now(),payloadHash:hash(path.join(batch,'payload.json')),baseline,targets};
}
function verify(plan){
 const targets=new Set(plan.targets.map(t=>t.file));
 for(const [file,sha]of Object.entries(plan.baseline))if(!targets.has(file))assert(hash(file)===sha,'Unrelated supply file changed: '+file);
 const report=[];
 for(const target of plan.targets){
  const rows=read(target.file),map=new Map(rows.map(p=>[p.t,p]));
  assert(map.size===rows.length,'Duplicate minutes');
  for(const p of target.rows)assert(JSON.stringify(map.get(p.t))===JSON.stringify(p),'Persisted row mismatch');
  for(const p of target.before.filter(p=>clock(p.t)>='08:00'&&clock(p.t)<='15:46'))assert(JSON.stringify(map.get(p.t))===JSON.stringify(p),'Persisted daytime changed');
  report.push({code:target.code,date:target.date,before:target.before.length,after:rows.length,added:target.added,updated:target.updated,incoming:target.incoming,daytimePreserved:target.before.filter(p=>clock(p.t)>='08:00'&&clock(p.t)<='15:46').length,format:target.file.endsWith('.gz')?'gzip':'json'});
 }
 return report;
}
try{
 if(mode==='plan'){
  const plan=build();fs.writeFileSync(planFile,JSON.stringify(plan));
  console.log(JSON.stringify({mode,targets:plan.targets.map(t=>({code:t.code,date:t.date,before:t.before.length,after:t.rows.length,added:t.added,updated:t.updated}))}));
 }else{
  const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
  assert(plan.payloadHash===hash(path.join(batch,'payload.json')),'Payload changed');
  if(mode==='apply'){
   for(const [file,sha]of Object.entries(plan.baseline))assert(hash(file)===sha,'Supply changed since plan');
   for(const target of plan.targets)assert(hash(target.file)===target.oldHash,'Target changed since plan');
   const backup=path.join(batch,'backup');fs.mkdirSync(backup,{recursive:true});
   for(const target of plan.targets)if(target.oldHash){const dest=path.join(backup,target.code,path.basename(target.file));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(target.file,dest);}
   for(const target of plan.targets){const bytes=Buffer.from(JSON.stringify(target.rows));const temp=target.file+'.night-import-'+process.pid+'.tmp';fs.writeFileSync(temp,target.file.endsWith('.gz')?zlib.gzipSync(bytes):bytes);fs.renameSync(temp,target.file);}
  }else assert(mode==='verify','Unknown mode');
  const report=verify(plan);fs.writeFileSync(path.join(batch,'verified.json'),JSON.stringify({at:Date.now(),report},null,2));
  console.log(JSON.stringify({mode,backup:path.join(batch,'backup'),report}));
 }
}catch(error){console.error(error.message);process.exitCode=1;}
