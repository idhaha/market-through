const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
async function main(){
  for(let i=0;i<160;i++){
    const file=path.join(__dirname,'meta.json');
    if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).finished_at){
      const r=spawnSync(process.execPath,[path.join(__dirname,'benchmark.cjs'),'cpu-ocr'],{stdio:'inherit'});
      process.exitCode=r.status||0;return;
    }
    await new Promise(r=>setTimeout(r,15000));
  }
  throw new Error('Native benchmark did not complete in 40 minutes');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
