const assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
// VI 창 2026-11-11: 발동 거래소(KRX · NXT · 선물) 기준 Base 괴리율 세 칸, 시가총액 칸, 해제 때 값 고정, 괴리율 1% 이상 보기,
// 거래대금(전일기준) · 시가총액 드롭다운(괴리율 체크박스 왼쪽, 같은 글자 크기 · 세로 가운데), 미지원, 30초 전 깜박임.
// 2026-11-14: 체결강도 칸(등락률 오른쪽), 선물 칸은 월물 선택 없이 감시 월물 하나 + 월물 표시, 선물 행은 "+10% 도달", 해제된 행도 흐리게 하지 않음.
// Columns: 0 순위 1 시장 2 종목명 3 등락률 4 체결강도 5 시가총액 6 거래대금 7 발동 거래소 8 구분 9 발동 10 해제 11 해제까지 12 KRX 13 NXT 14 선물 15 호가.
(async()=>{
 const now=Date.now(),hit=(kind,value)=>({at:now-5000,kind,value});
 const fb={code:'A1',name:'선물 12월',month:'202612',expiry:'20261210'};
 const row=(code,ago,extra={})=>({code,exchange:'KRX',name:'종목'+code,market:'K',kind:'1',direction:'up',active:true,startedAt:now-ago,lastEventAt:now-ago,durationMs:120000,
  rate:3.1,amount:100,marketCap:6e11,marketCapBasis:'KRX 현재가',prevAmount:8e10,prevAmountState:'ok',nxtSupported:true,futuresSupported:true,cpower:{value:112.34,at:now-ago,source:'한투 KRX 체결강도'},
  futuresBase:fb,gap:{KRX:'Base',NXT:0.4,FUT:0.2},tradeAge:{KRX:1000,NXT:1000,FUT:1000},...extra});
 const rows=[
  row('000001',10000,{gapHit:hit('NXT',1.25),nxtSupported:false,futuresSupported:false,futuresBase:null,gap:{KRX:'Base',NXT:'미지원',FUT:'미지원'}}),
  // The futures month has not traded today (LS t8402 거래량 0, 2026-11-13).
  row('000002',100000,{gapHit:hit('NXT',-1.4),direction:'down',marketCap:3e12,prevAmount:3e11,
   futuresBase:{...fb,volume:0,tradeCheckedAt:now-60000},gap:{KRX:'Base',NXT:-1.4,FUT:'체결 없음'}}),
  row('000003',20000,{marketCap:2e13,prevAmount:1e12}),
  // NXT VI: NXT is the Base; its KRX trade is 3 minutes old (shown, excluded from the 1% check).
  row('000005',30000,{exchange:'NXT',gapHit:hit('KRX',-1.1),rate:4.4,amount:55,gap:{KRX:-1.1,NXT:'Base',FUT:0.5},tradeAge:{KRX:180000,NXT:1000,FUT:1000},marketCap:9e12,prevAmount:2e12}),
  // Futures limit row: the watched month is the Base, 5-minute countdown.
  row('000006',60000,{exchange:'FUT',contract:{code:'A116C000',name:'삼성전자 F 202612',month:'202612'},kind:'LIMIT',kindText:'+10% 도달',limit:{side:'up',stage:1,price:110000},durationMs:300000,rate:10,amount:null,atStart:{rate:10},
   futuresBase:null,gapHit:hit('KRX',-1.6),gap:{KRX:-1.6,NXT:-1.2,FUT:'Base'},marketCap:1.2e15,prevAmount:5e12,cpower:{value:131.2,at:now-60000,source:'LS JC0'}}),
  // Released: the values at the release instead of "—".
  row('000004',300000,{active:false,releasedAt:now-180000,gapHit:hit('NXT',1.3),rate:null,amount:null,marketCap:null,gap:{KRX:'Base',NXT:null,FUT:null},atStart:{rate:1.1},
   atRelease:{at:now-179000,basis:'해제 뒤 첫 KRX 체결',rate:2.75,amount:777,marketCap:1e12,gap:{KRX:'Base',NXT:-1.5,FUT:0.6},futuresBase:fb},prevAmount:null,prevAmountState:'pending'})
 ];
 const app=express();
 app.get('/api/vi-monitor/stream',(req,res)=>{res.set({'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({rows,connection:'ok',futuresConnection:'선물 이벤트 꺼짐'})+'\n\n');});
 app.use(express.static('public'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1700,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/vi-monitor.html');await page.waitForSelector('#viBody td.name');
  const codes=()=>page.evaluate(()=>[...document.querySelectorAll('#viBody tr[data-code]')].map(tr=>tr.dataset.code).sort());
  const cells=code=>page.locator(`#viBody tr[data-code="${code}"] td`).allTextContents();
  // Header: one '괴리율' heading over KRX · NXT · 선물 (2026-11-12); 체결강도 right of 등락률; no month selector (2026-11-14).
  const head=(await page.locator('.vi-panel table thead th').allTextContents()).map(t=>t.replace(/\s+/g,' ').trim());
  assert.deepEqual(head,['순위','시장','종목명','Base등락률','Base체결강도','시가총액','거래대금(백만)','발동 거래소','구분','발동 시각','해제 시각','해제까지(예상)','괴리율','매수10호가평균','분석 차트','KRX','NXT','선물']);
  assert.equal(await page.locator('.comparison-group').count(),1);assert.equal(await page.locator('.comparison-group').getAttribute('colspan'),'3');
  assert.equal(await page.locator('#viFutureMonth').count(),0);
  // Default: only rows that reached 1%.
  assert.equal(await page.locator('#viGapOnly').isChecked(),true);
  assert.deepEqual(await codes(),['000001','000002','000004','000005','000006']);
  // KRX row: KRX Base; 미지원 only in its own column; 체결강도 at the activation.
  let c=await cells('000001');assert.deepEqual([c[3],c[4],c[5],c[7],c[12],c[13],c[14]],['+3.1%','112','6,000억','KRX','Base','미지원','미지원']);
  // NXT row: NXT Base, KRX against NXT; 등락률 · 거래대금 from NXT; no KRX book; the futures cell names its month.
  c=await cells('000005');assert.deepEqual([c[3],c[6],c[7],c[12],c[13],c[14],c[15]],['+4.4%','55','NXT','-1.1%','Base','+0.5% 12월','—']);
  assert.match(await page.locator('#viBody tr[data-code="000005"] td').nth(12).getAttribute('title'),/체결 3분 전 · 1% 판정 제외/);
  assert.match(await page.locator('#viBody tr[data-code="000005"] td').nth(14).getAttribute('title'),/선물 12월 ÷ NXT − 1 · 감시 월물/);
  // Futures limit row: futures 등락률, 선물 12월, +10% 도달, futures Base, 5-minute countdown.
  c=await cells('000006');assert.deepEqual([c[3],c[4],c[7],c[8],c[12],c[13],c[14]],['+10.0%','131','선물 12월','+10% 도달','-1.6%','-1.2%','Base'],'선물 등락률은 지금 값');
  assert.match(c[11],/^03:5\d:\d{2}$/,'5 minutes from the hit (it started 60 s ago)');
  assert.match(await page.locator('#viBody tr[data-code="000006"] td').nth(8).getAttribute('title'),/상한가 110,000원에 도달 \(1단계 ±10%\)/);
  // Released row keeps the release values (등락률, 시가총액, 거래대금, 괴리율) and is not dimmed.
  c=await cells('000004');assert.deepEqual([c[3],c[5],c[6],c[11],c[12],c[13],c[14]],['+2.8%','1조','777','해제','Base','-1.5%','+0.6% 12월']);
  assert.equal(await page.locator('#viBody tr[data-code="000004"] td').nth(2).evaluate(el=>getComputedStyle(el).opacity),'1');
  // A month without trades today says so instead of "—".
  const idle=page.locator('#viBody tr[data-code="000002"] td').nth(14);
  assert.equal(await idle.textContent(),'체결 없음 12월','which month did not trade');assert.equal(await idle.getAttribute('class'),'muted');assert.equal(await idle.getAttribute('title'),'선물 12월 오늘 체결 없음 (LS t8402 거래량 0)');
  // Colors: steady before the last 30 seconds, blinking within them (000002 has 20 s left).
  await page.waitForTimeout(100);
  const state=code=>page.locator(`#viBody tr[data-code="${code}"]`).evaluate(el=>({blink:el.classList.contains('vi-blink'),animation:getComputedStyle(el.cells[0]).animationName}));
  assert.deepEqual(await state('000001'),{blink:false,animation:'none'});assert.deepEqual(await state('000002'),{blink:true,animation:'vi-row-background'});
  // Filters: 시가총액 uses the shown (release) value; unknown values are counted.
  await page.selectOption('#viPrevAmount','1e12');assert.deepEqual(await codes(),['000005','000006']);
  assert.equal(await page.locator('#viFilterNote').textContent(),'값 확인 전이라 빠진 행 1건');
  await page.selectOption('#viMarketCap','1e13');assert.deepEqual(await codes(),['000006']);
  await page.selectOption('#viPrevAmount','0');await page.selectOption('#viMarketCap','1e12');assert.deepEqual(await codes(),['000002','000004','000005','000006'],'released 000004 counts with its release 시가총액 (1조)');
  await page.reload();await page.waitForSelector('#viBody td.name');
  assert.deepEqual([await page.locator('#viPrevAmount').inputValue(),await page.locator('#viMarketCap').inputValue()],['0','1e12'],'remembered');
  await page.selectOption('#viMarketCap','0');
  // Header controls: dropdowns left of 괴리율 1% 이상 보기, same 12px font, vertically centered with it.
  const geometry=await page.evaluate(()=>{
   const r=el=>el.getBoundingClientRect(),mid=el=>{const b=r(el);return b.top+b.height/2;};
   const prev=document.getElementById('viPrevAmount'),cap=document.getElementById('viMarketCap'),gap=document.getElementById('viGapOnly').closest('label'),top=document.getElementById('viTopmost').closest('label');
   return {order:r(prev).right<=r(cap).left&&r(cap).right<=r(gap).left&&r(gap).right<=r(top).left,
    fonts:[prev,cap,prev.closest('label'),gap].map(el=>getComputedStyle(el).fontSize),
    centers:[prev,cap,gap,top].map(el=>Math.round(mid(el)))};
  });
  assert.equal(geometry.order,true,'거래대금 · 시가총액 · 괴리율 1% 이상 보기 · 항상 위');
  assert.deepEqual([...new Set(geometry.fonts)],['12px']);
  assert.ok(Math.max(...geometry.centers)-Math.min(...geometry.centers)<=1,'vertical centers '+geometry.centers);
  assert.match(await page.locator('#viStatus').textContent(),/선물 이벤트 꺼짐/);
  assert.deepEqual(errors,[]);
  console.log('PASS VI window: Base columns by triggering exchange (KRX · NXT · 선물), 체결강도, watched futures month, +10% 도달 rows, release values, filters in the header, blink rule');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
