const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const { createSupplyStore, setReport }=require('../../supply-store');
// 11/4 a local KOSPI0 day file became 32 KB of NUL bytes (interrupted write). Compression threw on it every minute,
// so later days stayed uncompressed and the error never reached logs/server_debug. Now the broken file is skipped,
// left untouched, and reported once to the log function.
test('compression skips a broken day file, keeps it, compresses the rest and reports it once',()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'supply-archive-')),code=path.join(dir,'KOSPI0');fs.mkdirSync(code);
    const broken=path.join(code,'2026-11-04.json'),good=path.join(code,'2026-11-05.json'),text=path.join(code,'2026-11-03.json');
    fs.writeFileSync(broken,Buffer.alloc(32220));fs.writeFileSync(good,JSON.stringify([{t:1,individual:1}]));fs.writeFileSync(text,'{not json');
    const messages=[];setReport(message=>messages.push(message));
    try{
        const store=createSupplyStore({directory:dir,now:()=>Date.parse('2026-11-08T03:00:00Z')});
        assert.equal(store.archiveCompleted(),1);
        assert.equal(fs.existsSync(good),false);assert.deepEqual(JSON.parse(zlib.gunzipSync(fs.readFileSync(good+'.gz'))),[{t:1,individual:1}]);
        assert.equal(fs.readFileSync(broken).length,32220,'The broken file is kept as it is');
        assert.equal(messages.length,2);
        assert.match(messages.find(m=>m.includes('2026-11-04')),/수급 압축.*KOSPI0.2026-11-04\.json \(32220바이트, 내용이 모두 빈 문자\(NUL\)\)/);
        assert.match(messages.find(m=>m.includes('2026-11-03')),/JSON 아님/);
        store.archiveCompleted();assert.equal(messages.length,2,'Not repeated every minute');
        fs.writeFileSync(broken,Buffer.alloc(10));store.archiveCompleted();assert.equal(messages.length,3,'Reported again when the file changes');
    }finally{setReport(null);fs.rmSync(dir,{recursive:true,force:true});}
});
