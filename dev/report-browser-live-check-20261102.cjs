// Scheduled read-only evidence report. Does not open a browser or query brokers.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'outputs','browser-live-check-20261102');
function readEvidence(base){
 const fs=require('node:fs'),path=require('node:path');
 const file=path.join(base,'outputs','browser-live-check-20261102','observations.jsonl');
 let records=[];try{records=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code!=='ENOENT')return {error:'Evidence unreadable'};}
 const sources=['adr-minutes','breadth','kis-concentration','kis-supply','kiwoom-market-supply','ls-futures-test','ls-market-supply','ls-supply','ls-turnover','market-supply','supply','volatility'];
 const files=[];let scanned=0;
 function visit(folder,depth){if(depth>4||scanned>30000)return;let entries;try{entries=fs.readdirSync(folder,{withFileTypes:true});}catch{return;}
  for(const entry of entries){if(++scanned>30000)return;const name=path.join(folder,entry.name);if(entry.isDirectory())visit(name,depth+1);else if(entry.isFile()){let stat;try{stat=fs.statSync(name);}catch{continue;}if(stat.mtimeMs>=Date.parse('2026-11-02T07:55:00+09:00'))files.push({path:path.relative(base,name).replaceAll('\\','/'),mtime:stat.mtimeMs,bytes:stat.size});}}
 }
 for(const source of sources)visit(path.join(base,'data',source),0);
 return {records,files:files.sort((a,b)=>b.mtime-a.mtime).slice(0,500),scanLimitReached:scanned>30000};
}
function summarize(evidence,session){
 if(evidence.error)return evidence;
 const from=Date.parse('2026-11-02T'+(session==='spot'?'07:55':'17:55')+':00+09:00'),to=Date.parse('2026-11-02T'+(session==='spot'?'10:15':'22:00')+':00+09:00');
 const records=evidence.records.filter(r=>r.at>=from&&r.at<=to),issues=[];
 if(!records.length)issues.push('No authenticated browser evidence: do not treat this as a successful check.');
 if(records.some(r=>r.background.browserCount<1))issues.push('A reporting browser was not counted as connected.');
 const overlap=records.filter(r=>r.background.browserCount>0&&(!r.background.paused||r.background.running));
 if(overlap.length)issues.push('Background fallback was active or draining while a browser was connected; inspect timing.');
 const errors=records.filter(r=>r.errors>0),failed=records.flatMap(r=>r.requests.filter(q=>q.status===0||q.status>=400).map(q=>({at:r.at,...q})));
 if(errors.length)issues.push('Browser errors observed.');if(failed.length)issues.push('Failed browser API requests observed.');
 const charts={};for(const r of records)for(const c of r.charts){const s=charts[c.id]||={samples:0,pointCounts:[],lastDataAt:[],bitmapChanges:0,lastBitmap:null,busySamples:0};s.samples++;s.pointCounts.push(c.points);if(c.last!=null)s.lastDataAt.push(c.last);if(c.busy)s.busySamples++;const bitmap=JSON.stringify(c.canvases);if(s.lastBitmap!=null&&s.lastBitmap!==bitmap)s.bitmapChanges++;s.lastBitmap=bitmap;}
 for(const s of Object.values(charts)){s.pointCounts=[...new Set(s.pointCounts)];s.lastDataAt=[...new Set(s.lastDataAt)];delete s.lastBitmap;}
 return {session,samples:records.length,browsers:new Set(records.map(r=>r.browser)).size,first:records[0]?.at,last:records.at(-1)?.at,issues,failedRequests:failed.slice(0,100),charts,changedSourceFiles:evidence.files.filter(f=>f.mtime>=from&&f.mtime<=to),scanLimitReached:evidence.scanLimitReached,conclusion:'Evidence only: missing data, unchanged candles, closed sessions and configured refresh intervals require review; this report does not assert all features passed.'};
}
function main(){
 const session=process.argv[2];if(!['spot','night'].includes(session))throw Error('Use spot or night');
 const result={at:Date.now(),scope:'local-only',local:summarize(readEvidence(root),session)};
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,session+'-report.json'),JSON.stringify(result,null,2));console.log('Evidence report saved for '+session);
}
if(require.main===module)main();module.exports={readEvidence,summarize};
