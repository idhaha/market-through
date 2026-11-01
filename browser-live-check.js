// Temporary, passive verification: never initiates market-data queries.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const windows=[['2026-11-02T07:55:00+09:00','2026-11-02T10:15:00+09:00'],['2026-11-02T17:55:00+09:00','2026-11-02T22:00:00+09:00']].map(pair=>pair.map(Date.parse));
const inWindow=at=>windows.some(([from,to])=>at>=from&&at<=to);
function mountBrowserLiveCheck(app,{directory,background,now=Date.now}){
 const seen=new Map();
 app.post('/api/browser-live-check',(req,res)=>{
  if(req.hostname!=='localhost'&&req.hostname!=='127.0.0.1'&&req.hostname!=='[::1]')return res.status(204).end();
  if(!inWindow(now()))return res.status(204).end();
  const body=req.body;
  if(!body||!(/^[a-f0-9-]{36}$/i.test(body.id))||JSON.stringify(body).length>64000)return res.status(400).end();
  const last=seen.get(body.id);if(last!=null&&now()-last<30000)return res.status(429).end();
  for(const [id,at]of seen)if(now()-at>600000)seen.delete(id);
  if(seen.size>=200&&!seen.has(body.id))return res.status(429).end();
  seen.set(body.id,now());
  // A whitelist keeps request bodies, tokens, selections and account details out.
  const numeric=value=>Number.isFinite(value)?value:null;
  const charts=(Array.isArray(body.charts)?body.charts:[]).slice(0,20).map(c=>({
   id:String(c.id||'').replace(/[^a-z0-9_-]/gi,'').slice(0,80),mode:['day','minute'].includes(c.mode)?c.mode:null,
   points:numeric(c.points),valid:numeric(c.valid),candles:numeric(c.candles),first:numeric(c.first),last:numeric(c.last),candleLast:numeric(c.candleLast),busy:c.busy===true,
   canvases:(Array.isArray(c.canvases)?c.canvases:[]).slice(0,4).map(v=>({visible:v.visible===true,checksum:numeric(v.checksum)}))
  }));
  const requests=(Array.isArray(body.requests)?body.requests:[]).slice(-200).map(r=>({path:String(r.path||'').split('?')[0].replace(/[^a-z0-9_/-]/gi,'').slice(0,100),status:numeric(r.status),ms:numeric(r.ms)}));
  const state=background.status();
  const record={at:now(),browser:body.id,hidden:body.hidden===true,interval:['0','1','2','3','4','5'].includes(body.interval)?body.interval:null,charts,requests,errors:Math.max(0,Math.min(10000,Number(body.errors)||0)),background:{enabled:state.enabled,paused:state.paused,browserCount:state.browserCount,running:state.running,lastSuccessAt:state.lastSuccessAt}};
  try{fs.mkdirSync(directory,{recursive:true});fs.appendFileSync(path.join(directory,'observations.jsonl'),JSON.stringify(record)+'\n');res.status(204).end();}
  catch{res.status(503).end();}
 });
}
module.exports={inWindow,mountBrowserLiveCheck};
