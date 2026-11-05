// Passive Monday check. Does not change settings or initiate chart refreshes.
(() => {
 if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))return;
 const windows=[['2026-11-02T07:55:00+09:00','2026-11-02T10:15:00+09:00'],['2026-11-02T17:55:00+09:00','2026-11-02T22:00:00+09:00']].map(p=>p.map(Date.parse));
 if(Date.now()>windows.at(-1)[1])return;
 const active=()=>windows.some(([a,b])=>Date.now()>=a&&Date.now()<=b);
 const id=crypto.randomUUID(),requests=[];let errors=0,busy=false;
 const originalFetch=window.fetch;
 window.fetch=async function(...args){
  let pathname='';try{const u=new URL(args[0] instanceof Request?args[0].url:args[0],location.href);if(u.origin===location.origin)pathname=u.pathname;}catch{}
  const track=active()&&pathname.startsWith('/api/')&&!/browser-live-check|background-refresh\/presence/.test(pathname),start=performance.now();
  try{const response=await originalFetch.apply(this,args);if(track)requests.push({path:pathname,status:response.status,ms:Math.round(performance.now()-start)});return response;}
  catch(error){if(track)requests.push({path:pathname,status:0,ms:Math.round(performance.now()-start)});throw error;}
  finally{if(requests.length>200)requests.splice(0,requests.length-200);}
 };
 window.addEventListener('error',()=>{if(active())errors++;});
 window.addEventListener('unhandledrejection',()=>{if(active())errors++;});
 const specs=[['combinedConcentrationChartPanel','getCombinedRankChartState'],['rankCombinedSupplyChartPanel','getRankCombinedSupplyState'],['rankCombinedMarketSupplyChartPanel','getCombinedMarketSupplyCandleDiagnostics'],['rankCombinedMarketSupplySecondaryChartPanel','getCombinedMarketSupplySecondaryCandleDiagnostics'],['rankTestMarketSupplyChartPanel','getTestMarketSupplyCandleDiagnostics'],['rankTestMarketSupplySecondaryChartPanel','getTestMarketSupplySecondaryCandleDiagnostics'],['rankCombinedTurnoverChartPanel','getRankCombinedTurnoverState'],['rankAdrChartPanel','getAdrCandleDiagnostics'],['rankBreadthChartPanel','getRankBreadthDataState'],['rankVolatilityChartPanel','getRankVolatilityDataState'],['rankSentimentChartPanel','getRankSentimentDataState']];
 const timestamp=p=>{const v=p?.t??p?.time??p?.date;if(typeof v==='number')return v;const text=String(v||'');return /^\d{8}(\d{6})?$/.test(text)?Date.parse(text.slice(0,4)+'-'+text.slice(4,6)+'-'+text.slice(6,8)+'T'+(text.length===14?text.slice(8,10)+':'+text.slice(10,12)+':'+text.slice(12,14):'00:00:00')+'+09:00'):Date.parse(text.replace(' ','T')+(text.length===10?'T00:00:00+09:00':text.length===16?':00+09:00':''));};
 function chart([panelId,fn]){
  const panel=document.getElementById(panelId);if(!panel||typeof window[fn]!=='function')return null;
  const state=window[fn](),points=Array.isArray(state.points)?state.points:state.markets?.[state.selectedMarket||'kospi']||Object.values(state.data||{}).find(Array.isArray)||[];
  return {id:panelId,mode:state.mode,points:typeof state.points==='number'?state.points:points.length,valid:state.flowPoints??points.filter(p=>[p.value,p.foreign,p.market_turnover,p.adr].some(Number.isFinite)).length,candles:typeof state.candles==='number'?state.candles:state.candles?.length,first:state.first??timestamp(points[0]),last:state.last??timestamp(points.at(-1)),candleLast:state.candleLast,busy:state.busy||state.loading,canvases:[...panel.querySelectorAll('canvas')].slice(0,4).map(canvas=>{
   const visible=!!canvas.getClientRects().length;let checksum=null;
   if(visible&&canvas.width&&canvas.height)try{const tiny=document.createElement('canvas');tiny.width=32;tiny.height=16;const ctx=tiny.getContext('2d');ctx.drawImage(canvas,0,0,32,16);checksum=2166136261;for(const v of ctx.getImageData(0,0,32,16).data)checksum=Math.imul(checksum^v,16777619)>>>0;}catch{}
   return {visible,checksum};
  })};
 }
 async function sample(){
  if(Date.now()>windows.at(-1)[1]){clearInterval(timer);if(window.fetch===wrappedFetch)window.fetch=originalFetch;return;}
  if(!active()||busy||!window.BackgroundRefreshPresence?.active)return;
  busy=true;const batch=requests.splice(0);
  try{await originalFetch('/api/browser-live-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,hidden:document.hidden,interval:document.getElementById('refreshInterval')?.value,charts:specs.map(spec=>{try{return chart(spec);}catch{return null;}}).filter(Boolean),requests:batch,errors}),signal:AbortSignal.timeout(10000)});}catch{}finally{busy=false;}
 }
 const wrappedFetch=window.fetch,timer=setInterval(()=>void sample(),60000);
})();
