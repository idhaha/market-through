const fs=require('node:fs'),assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
(async()=>{
 const app=express(),source=fs.readFileSync('public/index.html','utf8');
 const sections=['concentrationChartPanel','rankAdrChartPanel'].map(id=>source.match(new RegExp('<section[^>]*id="'+id+'"[\\s\\S]*?</section>'))[0]).join('');
 let session='2026-10-15',empty=false;
 const timestamp=(day,time)=>Date.parse(`${day}T${time}:00+09:00`);
 app.get('/fixture',(req,res)=>res.send('<link rel="stylesheet" href="/style.css"><style>.rank-chart-row{display:flex}.rank-chart-row>.panel{width:520px!important;flex:0 0 520px!important}</style><main id="tab_rank"><div class="rank-chart-row">'+sections+'</div></main><script src="/rank-chart-axis.js"></script><script src="/concentration-chart.js"></script><script src="/rank-adr-chart.js"></script>'));
 app.get('/api/adr/today',(req,res)=>res.json({intraday:empty?[]:[{t:timestamp(session,'09:00'),adr:70},{t:timestamp(session,'15:30'),adr:80}],marketStatus:'closed'}));
 app.get('/api/adr/candles',(req,res)=>{
  const points=req.query.mode==='day'?['2026-10-14','2026-10-15'].map(day=>({t:timestamp(day,'09:00'),market_turnover:10e12})):empty?[]:[{t:timestamp(session,'09:00'),open:3000,high:3100,low:2900,close:3050,market_turnover_estimate:1e12},{t:timestamp(session,session==='2026-10-15'?'15:30':'09:01'),open:3050,high:3200,low:3000,close:3100,market_turnover_estimate:2e12}];
  res.json({points});
 });
 // Turnover minute sessions are kept on the server now (LS turnover API), so only ADR keeps a browser session copy. app.get('/api/chart-reference',(req,res)=>res.json({points:[],cursor:null}));app.get('/api/adr/history',(req,res)=>res.json({series:[]}));
 app.use(express.static('public'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1650,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.testNow=Date.parse('2026-10-15T15:35:00+09:00');Date.now=()=>window.testNow;});
  const origin='http://127.0.0.1:'+server.address().port;
  const minute=async()=>{await page.locator('#rankAdrChartPanel [data-adr-mode="minute"]').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('rank-adr-session:kospi')||'null')?.points?.length===2);};
  const refresh=()=>page.evaluate(async()=>{await refreshRankAdrChart();});
  const canvases=()=>page.evaluate(()=>['rankAdrChartPanel'].map(id=>document.querySelector('#'+id+' .rank-adr-area canvas').toDataURL()));
  await page.goto(origin+'/fixture');await minute();await refresh();const original=await canvases();
  for(const time of ['2026-10-16T00:05:00+09:00','2026-10-16T08:59:00+09:00']){
   empty=true;await page.evaluate(time=>window.testNow=Date.parse(time),time);await refresh();const current=await canvases();assert.ok(current.every((value,i)=>value===original[i]),'Graphs must remain identical');
  }
  // Restore the prior session even after a page reload with empty upstream data.
  await page.reload();await page.evaluate(()=>window.testNow=Date.parse('2026-10-16T08:59:00+09:00'));await minute();await refresh();assert.deepEqual(await canvases(),original);
  empty=false;session='2026-10-16';await page.evaluate(()=>window.testNow=Date.parse('2026-10-16T09:01:00+09:00'));await refresh();
  const sessions=await page.evaluate(()=>['rank-adr-session:kospi'].map(key=>JSON.parse(localStorage.getItem(key)).points));
  assert.ok(sessions.every(points=>points.length===2&&points.every(point=>new Date(point.t+9*3600000).toISOString().startsWith('2026-10-16'))));
  assert.deepEqual(errors,[]);console.log('PASS ADR minute chart retains identical prior session after midnight, before open and reload, then switch on new-session data');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
