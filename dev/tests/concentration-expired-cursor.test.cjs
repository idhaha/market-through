// 2026-11-16: 쏠림율 1분봉 사라짐. The chart cache kept the first concentration page in memory (up to 16 h) together with
// its server history cursor, but the server forgets that cursor after 30 minutes or a restart. Switching 삼성전자 →
// SK하이닉스 → 삼성전자 then served the cached first page with a dead cursor, the history read got 410 "과거 조회가 만료",
// and only today's minutes were left. Now a 410 drops cached pages with that cursor and the card starts a new session.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{const page=await browser.newPage({viewport:{width:2400,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
const t=Date.parse('2026-10-23T09:00:00+09:00'),p={t,open:2500,high:2510,low:2490,close:2505};
// Concentration server: first page = 10/23, history cursor → 10/22. Sessions are forgotten on "restart".
let sessions=new Map(),serial=0;const calls=[];
const point=(time,value)=>({time,value,stock_price:100,stock_open:99,stock_high:101,stock_low:98});
await page.route('https://market-page.test/**',route=>{const url=new URL(route.request().url());
if(url.pathname==='/api/auth/session')return route.fulfill({json:{authenticated:true,user:{email:'chart-test@example.test'}}});
if(['/api/concentration-chart','/api/kis-concentration-chart','/api/ls-concentration-chart'].includes(url.pathname)){
 const input=route.request().postDataJSON();calls.push(url.pathname+':'+input.code+':'+(input.cursor||'-'));
 if(input.mode!=='minute'||input.prices_only)return route.fulfill({json:{success:true,mode:input.mode,market:'K',points:[point(input.mode==='minute'?'20261023090000':'20261023',10)],warnings:[],has_more:false}});
 if(input.cursor){
  const s=sessions.get(input.cursor);
  if(!s||s.code!==input.code)return route.fulfill({status:410,json:{success:false,error:'과거 조회가 만료되었습니다. 일/분 버튼을 눌러 다시 조회해 주세요.'}});
  sessions.delete(input.cursor);
  return route.fulfill({json:{success:true,mode:'minute',market:'K',points:[point('20261022090000',30),point('20261022090100',31)],warnings:[],has_more:false}});
 }
 const cursor='c'+(++serial);sessions.set(cursor,{code:input.code});
 return route.fulfill({json:{success:true,mode:'minute',market:'K',cursor,has_more:true,points:[point('20261023090000',input.code==='005930'?20:40),point('20261023090100',21)],warnings:[]}});
}
if(['/api/kis-turnover/chart','/api/ls-turnover/chart'].includes(url.pathname))return route.fulfill({json:{success:true,markets:{kospi:[{...p,market_turnover:3e12}],kosdaq:[{...p,market_turnover:1e12}]},warnings:[],has_more:false}});
if(['/api/market-supply/chart','/api/ls-market-supply/chart','/api/kiwoom-market-supply/chart'].includes(url.pathname))return route.fulfill({json:{success:true,points:[{t,foreign:100,program:-50,institution:40,individual:-90}],candles:[p],warnings:[],has_more:false}});
if(['/api/kis-supply/chart','/api/ls-supply/chart'].includes(url.pathname))return route.fulfill({json:{success:true,points:[{t,foreign:100,institution:-30,program:200}],candles:[p],warnings:[],has_more:false,date:'2026-10-23',available_dates:['2026-10-23']}});
if(url.pathname==='/api/supply/watchlist')return route.fulfill({json:{success:true,stocks:[{code:'005930',name:'삼성전자'}],archive:[{code:'005930',name:'삼성전자'}],revision:1}});
if(url.pathname==='/api/chart-reference')return route.fulfill({json:{points:[p],has_more:false}});
if(url.pathname.startsWith('/api/'))return route.fulfill({json:{success:true,points:[p],markets:{kospi:[p],kosdaq:[p]},dates:['2026-10-23'],series:{highs:{points:[]},lows:{points:[]},vix:{points:[]},vkospi:{points:[]},'fear-greed':{points:[]},'high-yield-spread':{points:[]}},warnings:[],has_more:false}});
return route.fulfill({contentType:'text/html',body:html});});
await page.goto('https://market-page.test/');await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')+'#loginOverlay{display:none!important}#tabContents,#tab_rank{display:block!important}'});
// After the close (the user's case): the cache does not refresh in the background, so the cached cursor is served as is.
await page.evaluate(()=>{const closed=Date.now()-6*3600000;window.TradingRefresh={allows:()=>false,allowsUrl:()=>false,closedAt:()=>closed,closedAtUrl:()=>closed};});
for(const file of ['rank-chart-cache.js','rank-chart-axis.js','rank-supply-guide.js','concentration-chart.js','rank-turnover-chart.js','rank-volatility-chart.js','rank-supply-chart.js','rank-market-supply-chart.js','rank-connection-status.js'])await page.addScriptTag({path:'public/'+file});
await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));await page.waitForFunction(()=>document.getElementById('combinedConcentrationChartPanel'));
const st=()=>page.evaluate(()=>{const s=getCombinedRankChartState();return {code:s.selection?.code,mode:s.mode,busy:s.busy,times:s.points.map(p=>p.time),status:s.status};});
const idle=async code=>{await page.waitForFunction(c=>{const s=getCombinedRankChartState();return s.selection?.code===c&&s.mode==='minute'&&!s.busy&&s.points.length;},code);await page.waitForTimeout(300);};
await page.evaluate(()=>selectRankChartStock({code:'005930',name:'삼성전자',market:'K'}));
await page.locator('#combinedConcentrationChartPanel [data-chart-mode="minute"]').click();await idle('005930');
await page.evaluate(()=>selectRankChartStock({code:'000660',name:'SK하이닉스',market:'K'}));await idle('000660');
// Local server restart (or 30 minutes): every history cursor is gone.
sessions=new Map();
await page.evaluate(()=>selectRankChartStock({code:'005930',name:'삼성전자',market:'K'}));await idle('005930');
await page.evaluate(()=>RankChartAxis.requestHistory('minute'));
await page.waitForFunction(()=>getCombinedRankChartState().points.some(p=>p.time.startsWith('20261022'))||/만료/.test(getCombinedRankChartState().status),null,{timeout:15000}).catch(()=>{});
await page.waitForTimeout(500);
const s=await st();
assert.ok(s.times.some(x=>x.startsWith('20261022')),'older minutes load after the server forgot the cursor: '+JSON.stringify(s)+' calls '+calls.filter(c=>c.includes('ls-')).join(' '));
assert.doesNotMatch(s.status,/만료/);
assert.deepEqual(errors,[]);
console.log('Expired concentration cursor: cached page refreshed, history loaded');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
