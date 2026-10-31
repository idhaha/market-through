const {spawnSync} = require('node:child_process');
const path = require('node:path');
async function main() {
  for(let i=0;i<160;i++) {
    const r=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(15000)});
    const tags=await r.json();
    const ready=['qwen3-vl:8b-instruct','qwen3.5:9b'].every(m=>tags.models.some(x=>x.name===m));
    if(ready) {
      const run=spawnSync(process.execPath,[path.join(__dirname,'benchmark.cjs'),'run'],{stdio:'inherit'});
      if(run.status!==0) throw new Error('Benchmark failed: '+run.status);
      const report=spawnSync(process.execPath,[path.join(__dirname,'report.cjs')],{stdio:'inherit'});
      process.exitCode=report.status||0; return;
    }
    if(i%4===0) console.log(JSON.stringify({status:'waiting-for-downloads',time:new Date().toISOString()}));
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
  throw new Error('Model installation wait exceeded 40 minutes');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
