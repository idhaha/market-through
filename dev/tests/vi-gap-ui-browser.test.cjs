const assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
// VI 창 2026-11-11: 발동 거래소(KRX · NXT · 선물) 기준 Base 괴리율 세 칸, 시가총액 칸, 해제 때 값 고정, 괴리율 1% 이상 보기,
// 거래대금(전일기준) · 시가총액 드롭다운(괴리율 체크박스 왼쪽, 같은 글자 크기 · 세로 가운데), 미지원, 30초 전 깜박임.
// Columns: 0 순위 1 시장 2 종목명 3 등락률 4 시가총액 5 거래대금 6 발동 거래소 7 구분 8 발동 9 해제 10 해제까지 11 KRX 12 NXT 13 선물 14 호가.
(async()=>{
 const now=Date.now(),hit=(kind,value)=>({at:now-5000,kind,value});
 const row=(code,ago,extra={})=>({code,exchange:'KRX',name:'종목'+code,market:'K',kind:'1',direction:'up',active:true,startedAt:now-ago,lastEventAt:now-ago,durationMs:120000,
  rate:3.1,amount:100,marketCap:6e11,marketCapBasis:'KRX 현재가',prevAmount:8e10,prevAmountState:'ok',nxtSupported:true,futuresSupported:true,
  futures:{recent:{code:'A1',name:'선물 12월',expiry:'20261210'},next:null},gap:{KRX:'Base',NXT:0.4,FUT:{recent:0.2,next:null}},...extra});
 const rows=[
  row('000001',10000,{gapHit:hit('NXT',1.25),nxtSupported:false,futuresSupported:false,gap:{KRX:'Base',NXT:'미지원',FUT:'미지원'}}),
  row('000002',100000,{gapHit:hit('NXT',-1.4),direction:'down',marketCap:3e12,prevAmount:3e11}),
  row('000003',20000,{marketCap:2e13,prevAmount:1e12}),
  // NXT VI: NXT is the Base.
  row('000005',30000,{exchange:'NXT',gapHit:hit('KRX',-1.1),rate:4.4,amount:55,gap:{KRX:-1.1,NXT:'Base',FUT:{recent:0.5,next:null}},marketCap:9e12,prevAmount:2e12}),
  // Futures event (LS JX0): the contract is the Base, 5-minute countdown.
  row('000006',60000,{exchange:'FUT',contract:{code:'A116C000',name:'삼성전자 F 202612',month:'202612'},kind:'JX0',kindText:'제한폭 확대 1단계',durationMs:300000,rate:1.25,amount:null,atStart:{rate:0.5},
   gapHit:hit('KRX',-1.6),gap:{KRX:-1.6,NXT:-1.2,FUT:'Base'},marketCap:1.2e15,prevAmount:5e12}),
  // Released: the values at the release instead of "—".
  row('000004',300000,{active:false,releasedAt:now-180000,gapHit:hit('NXT',1.3),rate:null,amount:null,marketCap:null,gap:{KRX:'Base',NXT:null,FUT:{recent:null,next:null}},atStart:{rate:1.1},
   atRelease:{at:now-179000,basis:'해제 뒤 첫 KRX 체결',rate:2.75,amount:777,marketCap:1e12,gap:{KRX:'Base',NXT:-1.5,FUT:{recent:0.6,next:null}}},prevAmount:null,prevAmountState:'pending'})
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
  // Header: no 'KRX대비' group; three 괴리율 columns; 시가총액 left of 거래대금.
  const head=(await page.locator('.vi-panel table thead th').allTextContents()).map(t=>t.replace(/\s+/g,' ').trim());
  assert.deepEqual(head,['순위','시장','종목명','등락률','시가총액','거래대금(백만)','발동 거래소','구분','발동 시각','해제 시각','해제까지(예상)','KRX 괴리율','NXT 괴리율','선물 괴리율 최근월차기월','KRX 매수10호가평균']);
  assert.equal(await page.locator('.comparison-group').count(),0);
  // Default: only rows that reached 1%.
  assert.equal(await page.locator('#viGapOnly').isChecked(),true);
  assert.deepEqual(await codes(),['000001','000002','000004','000005','000006']);
  // KRX row: KRX Base; 미지원 only in its own column.
  let c=await cells('000001');assert.deepEqual([c[3],c[4],c[6],c[11],c[12],c[13]],['+3.10%','6,000억','KRX','Base','미지원','미지원']);
  // NXT row: NXT Base, KRX against NXT; 등락률 · 거래대금 from NXT; no KRX book.
  c=await cells('000005');assert.deepEqual([c[3],c[5],c[6],c[11],c[12],c[13],c[14]],['+4.40%','55','NXT','-1.10%','Base','+0.50%','—']);
  // Futures event row: live futures 등락률 (t8402 기준가), 선물 12월, 제한폭 확대, futures Base, 5-minute countdown.
  c=await cells('000006');assert.deepEqual([c[3],c[6],c[7],c[11],c[12],c[13]],['+1.25%','선물 12월','제한폭 확대 1단계','-1.60%','-1.20%','Base'],'선물 등락률은 지금 값');
  assert.match(c[10],/^03:5\d:\d{2}$/,'5 minutes from the event (it started 60 s ago)');
  // Released row keeps the release values (등락률, 시가총액, 거래대금, 괴리율).
  c=await cells('000004');assert.deepEqual([c[3],c[4],c[5],c[10],c[11],c[12],c[13]],['+2.75%','1조','777','해제','Base','-1.50%','+0.60%']);
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
  console.log('PASS VI window: Base columns by triggering exchange (KRX · NXT · 선물), 시가총액, release values, filters in the header, blink rule');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
