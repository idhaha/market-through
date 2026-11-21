// 과거 분봉 구간 보기(2026-11-21): 일봉을 과거로 확대한 채 분봉을 누르면 일봉 화면 가운데 봉 기준 좌우 10거래일의 분봉을 보여 주고,
// 날짜 커서 카드(종목수급 · 시장수급 · 거래대금)는 오늘부터 하루씩 거슬러 오지 않고 구간 끝 날짜부터 받는다.
// 더 불러오기는 구간 왼쪽으로 잇고, 당일은 구간 보기를 끝낸다.
const fs=require('fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const iso=t=>new Date(t+9*3600000).toISOString();
const weekdays=(from,to)=>{const r=[];for(let t=Date.parse(from+'T00:00:00Z');t<=Date.parse(to+'T00:00:00Z');t+=86400000){const d=new Date(t);if(![0,6].includes(d.getUTCDay()))r.push(d.toISOString().slice(0,10));}return r;};
const DAYS=weekdays('2026-08-03','2026-10-23'),TODAY='2026-10-23';
const compact=d=>d.replaceAll('-',''),dashed=c=>c.slice(0,4)+'-'+c.slice(4,6)+'-'+c.slice(6,8);
const minutes=day=>Array.from({length:6},(_,i)=>Date.parse(day+'T09:00:00+09:00')+i*600000);
const bar=(t,i=0)=>({t,date:iso(t).slice(0,16).replace('T',' '),open:100+i,high:110+i,low:90+i,close:105+i,market_turnover:1e12});
const dayBar=day=>bar(Date.parse(day+'T00:00:00+09:00'));
const before=(day,cursor)=>DAYS.filter(d=>d<=day).at(-1);
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1900,height:1100}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date(TODAY+'T12:00:00+09:00')});
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
 await page.route('http://window.test/**',route=>{
  const u=new URL(route.request().url()),p=u.pathname,body=route.request().method()==='POST'?route.request().postDataJSON()||{}:{},q={...Object.fromEntries(u.searchParams),...body},minute=q.mode==='minute';
  if(!p.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:html});
  requests.push(p+u.search);
  // 날짜 커서(그날 포함): 그날의 분봉과 이전 거래일 커서.
  const dated=()=>{const day=before(q.date || (q.cursor?dashed(q.cursor):TODAY)),i=DAYS.indexOf(day),prev=DAYS[i-1];return {day,cursor:prev?compact(prev):null,has_more:!!prev};};
  let data;
  if(p==='/api/supply/watchlist')data={success:true,stocks:[{code:'005930',name:'삼성전자'}],archive:[{code:'005930',name:'삼성전자'}],revision:1};
  else if(minute && (p==='/api/kis-supply/chart' || p.endsWith('market-supply/chart') || p==='/api/ls-futures-test/chart')){
   const d=dated();data={success:true,date:d.day,points:minutes(d.day).map((t,i)=>({t,foreign:i,institution:-i,individual:i,program:i})),candles:minutes(d.day).map(bar),cursor:d.cursor,has_more:d.has_more,available_dates:DAYS,warnings:[]};
  }else if(minute && (p==='/api/ls-turnover/chart' || p==='/api/turnover/chart')){
   const d=dated();data={success:true,markets:{kospi:minutes(d.day).map(bar),kosdaq:minutes(d.day).map(bar)},cursor:d.cursor,has_more:d.has_more,warnings:[]};
  }else if(minute && p==='/api/risk/breadth'){
   // 신고·신저 · ADR 분봉(2026-11-21): 날짜 커서, 한 쪽 = 한 날.
   const d=dated(),rows=minutes(d.day).map((t,i)=>({date:iso(t).slice(0,16).replace('T',' '),value:90+i}));
   data={dates:rows.map(r=>r.date),series:{highs:{points:rows},lows:{points:rows.map(r=>({...r,value:-1}))},adr:{points:rows}},cursor:d.cursor,has_more:d.has_more,candles:[]};
  }else if(minute && (p==='/api/concentration-chart' || p==='/api/ls-concentration-chart')){
   // 쏠림율(2026-11-21): base_dt면 그날, 서버 세션 커서('C날짜')면 그 전 거래일.
   const day=q.cursor?DAYS[DAYS.indexOf(dashed(q.cursor.slice(1)))-1]:before(q.base_dt?dashed(q.base_dt):TODAY),prev=DAYS[DAYS.indexOf(day)-1];
   requests.push(p+'#'+JSON.stringify({base_dt:q.base_dt,cursor:q.cursor}));
   data={success:true,market:'K',mode:'minute',points:minutes(day).map((t,i)=>({time:iso(t).slice(0,19).replace(/[-:T]/g,''),value:10+i,stock_open:100,stock_high:110,stock_low:90,stock_price:105})),cursor:prev?'C'+compact(day):null,has_more:!!prev};
  }else if(minute && p==='/api/supply/candles'){const day=before(q.date || TODAY);data={success:true,points:minutes(day).map(bar),date:day,has_more:false};}
  else if(minute && (p==='/api/adr/candles' || p==='/api/ls-futures-test/candles')){data={success:true,points:DAYS.filter(d=>d>=dashed(q.from) && d<=dashed(q.to)).flatMap(minutes).map(bar),has_more:false};}
  else if(minute){data={success:true,market:'K',points:[],series:[],has_more:false};}
  else if(p==='/api/concentration-chart' || p==='/api/ls-concentration-chart'){data={success:true,market:'K',points:DAYS.map(d=>({time:compact(d),stock_open:100,stock_high:110,stock_low:90,stock_price:105,value:10})),has_more:false};}
  else if(p==='/api/chart-reference' || p==='/api/adr/candles' || p==='/api/supply/candles'){data={success:true,points:DAYS.map(dayBar),has_more:false};}
  else if(p.endsWith('/chart') && p.includes('supply')){data={success:true,points:DAYS.map(d=>({t:Date.parse(d+'T00:00:00+09:00'),foreign:1,institution:-1,individual:0,program:0})),candles:DAYS.map(dayBar),has_more:false,warnings:[]};}
  else if(p.endsWith('turnover/chart')){data={success:true,markets:{kospi:DAYS.map(dayBar),kosdaq:DAYS.map(dayBar)},has_more:false,warnings:[]};}
  else data={success:true,series:[],points:[],has_more:false};
  return route.fulfill({json:data});
 });
 await page.goto('http://window.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
 for(const f of ['rank-chart-axis.js','concentration-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js'])await page.addScriptTag({path:'public/'+f});
 await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
 await page.evaluate(()=>window.selectRankChartStock({code:'005930',name:'삼성전자'}));
 await page.locator('#rankTestMarketSupplyChartPanel .rank-market-choice input[value="kospi"]').check();
 await page.waitForTimeout(800);
 // 일봉을 과거로 확대: 2026-08-17 ~ 2026-09-25(30거래일), 가운데 2026-09-04 → 구간 08-21 ~ 09-18.
 const zoom={first:'2026-08-17',last:'2026-09-25'},inView=DAYS.filter(d=>d>=zoom.first && d<=zoom.last),center=inView[Math.floor((inView.length-1)/2)];
 const from=inView[inView.indexOf(center)-10],to=inView[inView.indexOf(center)+10];
 await page.evaluate(({first,last})=>{const d=window.RankChartAxis.dailyDomain(),n=d.days.length-1;window.RankChartAxis.selectViewport('combinedSupply',d.days.indexOf(first)/n,d.days.indexOf(last)/n);},zoom);
 assert.deepEqual(await page.evaluate(()=>{const d=window.RankChartAxis.dailyDomain();return [d.first,d.last];}),[zoom.first,zoom.last],'일봉 확대');
 const daily=await page.evaluate(()=>window.RankChartAxis.dailyWindow());
 assert.deepEqual(daily,{center,from,to},'일봉 화면 가운데 봉 기준 좌우 10거래일');
 requests.length=0;
 await page.locator('#rankCombinedSupplyChartPanel [data-mode="minute"]').click();
 await page.waitForFunction(()=>{const d=window.RankChartAxis.minuteDomain();return d.first && d.last;});
 const started=Date.now();
 await page.waitForFunction(from=>{const s=window.getRankCombinedSupplyState();return s.points.some(p=>new Date(p.t+9*3600000).toISOString().slice(0,10)<=from) && window.getRankCombinedTurnoverState().markets.kospi.some(p=>new Date(p.t+9*3600000).toISOString().slice(0,10)<=from);},from,{timeout:60000});
 // 신고·신저(ADR 포함) 카드가 날짜 커서로 구간 첫날까지 받는다.
 for(const until=Date.now()+60000;requests.filter(r=>r.startsWith('/api/risk/breadth') && r.includes('mode=minute') && r.includes('cursor='+compact(from))).length<1;){if(Date.now()>until)throw new Error('신고·신저 구간 첫날 요청 없음 '+requests.filter(r=>r.startsWith('/api/risk/breadth')));await page.waitForTimeout(100);}
 console.log('구간 채움 '+(Date.now()-started)+'ms');await page.waitForTimeout(500);
 const domain=await page.evaluate(()=>{const d=window.RankChartAxis.minuteDomain();return {first:d.first,last:d.last};});
 assert.equal(domain.first.slice(0,10)<=from,true,'구간 시작 '+JSON.stringify(domain));
 assert.equal(domain.last.slice(0,10),to,'구간 끝은 '+to+' '+JSON.stringify(domain));
 assert.equal(domain.first.slice(0,10)>=DAYS[DAYS.indexOf(from)-1],true,'구간 시작이 너무 이르지 않다 '+JSON.stringify(domain));
 // 날짜 커서 카드는 구간 끝 날짜로 바로 가고, 구간 끝과 오늘 사이의 날을 하루씩 받지 않는다.
 const cursors=path=>requests.filter(r=>r.startsWith(path) && r.includes('mode=minute') && /cursor=\d{8}/.test(r)).map(r=>r.match(/cursor=(\d{8})/)[1]);
 for(const path of ['/api/kis-supply/chart','/api/ls-turnover/chart','/api/risk/breadth']){
  const list=cursors(path);
  assert.ok(list.includes(compact(to)),path+' 구간 끝 날짜부터 '+list);
  assert.ok(list.includes(compact(from)),path+' 구간 시작까지 '+list);
  assert.ok(!list.some(c=>c>compact(to)),path+' 구간 뒤의 날은 받지 않는다 '+list);
 }
 // 쏠림율은 base_dt로 구간 끝 날짜부터 받는다(오늘부터 거슬러 오지 않는다).
 assert.ok(requests.some(r=>r.includes('concentration-chart#')&&r.includes('"base_dt":"'+compact(to)+'"')),'쏠림율 base_dt '+requests.filter(r=>r.includes('concentration-chart#')).slice(0,5));
 for(const until=Date.now()+30000;;){const c=await page.evaluate(()=>window.getCombinedRankChartState?.()||window.getRankChartState());const days=[...new Set(c.points.filter(p=>Number.isFinite(p.value)).map(p=>p.time.slice(0,8)))].sort();if(days[0]<=compact(from)&&days.at(-1)===compact(to))break;if(Date.now()>until)throw new Error('쏠림율 구간 '+days[0]+'~'+days.at(-1));await page.waitForTimeout(200);}
 const supply=await page.evaluate(()=>window.getRankCombinedSupplyState());
 const supplyDays=[...new Set(supply.points.map(p=>new Date(p.t+9*3600000).toISOString().slice(0,10)))].sort();
 assert.equal(supplyDays.at(-1),to,'종목수급 카드의 마지막 날');assert.ok(supplyDays[0]<=from,'종목수급 카드의 첫 날 '+supplyDays[0]);
 // 구간 보기 중 자동 갱신은 분봉 카드를 다시 받지 않는다.
 requests.length=0;await page.evaluate(()=>window.RankChartAxis.refreshCharts({automatic:true}));await page.waitForTimeout(300);
 assert.ok(!requests.some(r=>r.includes('mode=minute') && /kis-supply|ls-turnover|market-supply/.test(r)),'자동 갱신 생략 '+requests);
 // 더 불러오기: 구간 왼쪽(더 과거)으로 잇는다. 오른쪽 끝은 그대로.
 requests.length=0;await page.evaluate(()=>window.RankChartAxis.requestHistory('minute'));await page.waitForTimeout(1500);
 const more=await page.evaluate(()=>{const d=window.RankChartAxis.minuteDomain();return {first:d.first,last:d.last};});
 assert.ok(more.first<domain.first,'더 불러오기로 왼쪽이 넓어진다 '+JSON.stringify(more));assert.equal(more.last.slice(0,10),to);
 assert.ok(!cursors('/api/kis-supply/chart').some(c=>c>compact(from)),'더 불러오기는 구간 앞쪽만 '+cursors('/api/kis-supply/chart'));
 // 당일: 구간 보기를 끝내고 오늘을 다시 받는다.
 await page.locator('#rankCombinedSupplyChartPanel .chart-today-button').click();await page.waitForTimeout(1500);
 const today=await page.evaluate(()=>{const d=window.RankChartAxis.minuteDomain();return {first:d.first,last:d.last,window:window.RankChartAxis.minuteWindow()};});
 assert.equal(today.window,null);assert.equal(today.first.slice(0,10),TODAY);assert.equal(today.last.slice(0,10),TODAY);
 const after=await page.evaluate(()=>window.getRankCombinedSupplyState());
 assert.ok(after.points.some(p=>new Date(p.t+9*3600000).toISOString().slice(0,10)===TODAY),'당일 분봉을 다시 받았다');
 // 일봉을 확대하지 않았거나 최신 봉이 보이면 평소대로 당일.
 await page.locator('#rankCombinedSupplyChartPanel [data-mode="day"]').click();await page.waitForTimeout(800);
 assert.equal(await page.evaluate(()=>window.RankChartAxis.dailyWindow()),null);
 await page.locator('#rankCombinedSupplyChartPanel [data-mode="minute"]').click();await page.waitForTimeout(800);
 assert.equal(await page.evaluate(()=>window.RankChartAxis.minuteWindow()),null);
 assert.deepEqual(errors,[]);
 console.log('PASS 일봉 확대 → 분봉 구간 보기, 날짜 커서 카드 바로 이동, 자동 갱신 생략, 더 불러오기, 당일 복귀');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
