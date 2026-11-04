// Local-only check for 2026-11-03: does background refresh store the same data while no browser is connected?
// Opens and closes a dedicated, already signed-in Edge profile on a fixed schedule and records evidence.
// Never touches the Oracle server, credentials or auth files.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync,spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs','bg-onoff-20261103');
const profile=path.join(root,'outputs','bg-test-edge-profile');
const edge=['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(p=>fs.existsSync(p));
const at=s=>Date.parse('2026-11-03T'+s+':00+09:00');
// off = test browser closed (background should collect), on = test browser open (background should pause).
const phases=[['10:30','off'],['11:30','on'],['12:30','off'],['13:30','on'],['14:30','off'],['15:35','end']].map(([t,p])=>({start:at(t),phase:p,label:t.replace(':','')}));
const dayStart=at('00:00');
const kst=t=>new Date(t+9*3600000).toISOString().slice(0,19).replace('T',' ');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const log=(file,v)=>fs.appendFileSync(path.join(out,file),JSON.stringify(v)+'\n');

function edgePids(){
    try{
        const ps=`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*bg-test-edge-profile*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId }`;
        return execFileSync('powershell.exe',['-NoProfile','-Command',ps],{encoding:'utf8',timeout:30000}).split(/\s+/).filter(Boolean).map(Number);
    }catch{return [];}
}
function openEdge(){
    spawn(edge,['--user-data-dir='+profile,'--no-first-run','--hide-crash-restore-bubble','--new-window','http://localhost:3000/'],{detached:true,stdio:'ignore'}).unref();
}
function closeEdge(){for(const pid of edgePids()){try{execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{stdio:'ignore'});}catch{}}}

// Local server: start it (minimized console) when it is not answering.
function serverUp(){
    return new Promise(resolve=>{const req=require('node:http').get('http://localhost:3000/robots.txt',{timeout:5000},res=>{res.resume();resolve(res.statusCode<500);});req.on('error',()=>resolve(false));req.on('timeout',()=>{req.destroy();resolve(false);});});
}
async function ensureServer(){
    if(await serverUp())return true;
    spawn('cmd.exe',['/c',`start "MarketThrough server" /min "${process.execPath}" server.js`],{cwd:root,detached:true,stdio:'ignore',windowsVerbatimArguments:true}).unref();
    for(let i=0;i<60;i++){await wait(1000);if(await serverUp()){log('status.jsonl',{at:kst(Date.now()),state:'server_started'});return true;}}
    log('status.jsonl',{at:kst(Date.now()),state:'server_start_failed'});return false;
}
// Other programs connected to the local server (e.g. a localhost tab in the everyday browser).
// They would count as a connected browser and invalidate "off" phases, so they are recorded.
function otherClients(){
    try{
        const ps=`Get-NetTCPConnection -RemotePort 3000 -State Established -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"; if ($p -and $p.ProcessId -ne ${process.pid} -and $p.CommandLine -notlike '*bg-test-edge-profile*') { $p.Name } } | Sort-Object -Unique`;
        return execFileSync('powershell.exe',['-NoProfile','-Command',ps],{encoding:'utf8',timeout:30000}).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    }catch{return [];}
}

// Files written today under data/, excluding auth and session material.
function todayFiles(){
    const files=[];
    (function visit(dir,depth){
        if(depth>5)return;let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
        for(const e of entries){
            const p=path.join(dir,e.name),rel=path.relative(root,p).split(path.sep).join('/');
            if(/auth|session|authorized/i.test(rel))continue;
            if(e.isDirectory())visit(p,depth+1);
            else if(e.isFile()&&!p.endsWith('.tmp')){try{const s=fs.statSync(p);if(s.mtimeMs>=dayStart)files.push({rel,mtime:s.mtimeMs,size:s.size});}catch{}}
        }
    })(path.join(root,'data'),0);
    return files;
}
function backgroundJobs(){
    const dir=path.join(root,'data','background-refresh','snapshots'),jobs={};
    let names=[];try{names=fs.readdirSync(dir);}catch{}
    for(const id of names){try{const j=JSON.parse(fs.readFileSync(path.join(dir,id,'latest.json'),'utf8'));jobs[id]={name:j.name,at:j.at};}catch{}}
    return jobs;
}
function snapshot(label){
    const dest=path.join(out,'snap-'+label);
    for(const f of todayFiles()){const target=path.join(dest,f.rel);fs.mkdirSync(path.dirname(target),{recursive:true});try{fs.copyFileSync(path.join(root,f.rel),target);}catch{}}
}

async function main(){
    fs.mkdirSync(out,{recursive:true});
    if(!edge)throw Error('Edge not found');
    if(Date.now()>=phases.at(-1).start)throw Error('Window already ended');
    closeEdge();
    await ensureServer();
    log('status.jsonl',{at:kst(Date.now()),state:'started',otherClients:otherClients()});
    while(Date.now()<phases[0].start)await wait(Math.min(30000,phases[0].start-Date.now()));
    await ensureServer();
    let current=null;
    while(true){
        const now=Date.now(),phase=[...phases].reverse().find(p=>p.start<=now);
        if(phase.phase==='end')break;
        if(current!==phase){
            snapshot(phase.label+'-begin');
            if(phase.phase==='on')openEdge();else closeEdge();
            log('status.jsonl',{at:kst(now),state:'phase',phase:phase.phase,from:phase.label});
            current=phase;
        }
        // Reopen if the test browser was closed by accident during an "on" phase, and vice versa.
        const pids=edgePids();
        if(phase.phase==='on'&&!pids.length)openEdge();
        if(phase.phase==='off'&&pids.length)closeEdge();
        const server=await ensureServer();
        log('observations.jsonl',{at:now,kst:kst(now),phase:phase.phase,edge:pids.length,server,otherClients:otherClients(),background:backgroundJobs(),files:todayFiles()});
        // Record every 10 minutes, but wake at the next phase boundary so switching stays on time.
        const next=phases.find(p=>p.start>now).start;
        await wait(Math.max(1000,Math.min(now+600000,next)-Date.now()));
    }
    closeEdge();snapshot('1535-end');
    log('status.jsonl',{at:kst(Date.now()),state:'completed'});
}
main().catch(e=>{try{log('status.jsonl',{at:kst(Date.now()),state:'failed',error:String(e.message)});}catch{}process.exitCode=1;});
