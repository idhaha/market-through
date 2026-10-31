const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=__dirname,models=['qwen3-vl:8b-instruct','qwen3.5:9b'];
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
const gui=read('cpu-gui-results.json'),ocr=read('cpu-ocr-results.json');
for(const model of models){
 const g=gui.filter(r=>r.model===model),o=ocr.filter(r=>r.model===model);
 assert.equal(g.length,10);assert.equal(new Set(g.map(r=>r.case_id)).size,10);
 assert.equal(o.length,5);assert.equal(new Set(o.map(r=>r.case_id)).size,5);
 for(const r of [...g,...o]){assert.ok(!r.error,r.error);assert.ok(r.wall_seconds>0);assert.ok(r.prompt_tokens>0);assert.ok(r.output_tokens>0);}
 for(const r of o)assert.equal(typeof r.text,'string');
}
for(const file of ['cases.json','cpu-gui-cases.json','ocr-cases.json'])for(const c of read(file)){
 const bytes=fs.readFileSync(path.join(root,c.file));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),c.sha256);
}
for(const file of ['cpu-gui-meta.json','cpu-ocr-meta.json']){
 const m=read(file);assert.ok(m.finished_at);
 for(const b of m.blocks)for(const a of b.allocation)assert.equal(a.size_vram,0);
}
const html=fs.readFileSync(path.join(root,'report.html'),'utf8');
for(const [,target] of html.matchAll(/(?:href|src)="([^"]+)"/g))if(!/^https?:/i.test(target))assert.ok(fs.existsSync(path.join(root,target)),target);
assert.ok(html.includes('GUI 20/20회, OCR 10/10회'));
assert.ok(!html.includes('미실행</p>'));
const verification={verified_at:new Date().toISOString(),gui_requests:gui.length,ocr_requests:ocr.length,model_pairs_unique:true,image_hashes_preserved:true,cpu_vram_bytes:0,report_relative_assets_present:true};
fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(verification,null,2));console.log(JSON.stringify(verification,null,2));
