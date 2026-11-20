const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRankIndependentRelay}=require('../../rank-independent');
let clock=1000000;const routes=new Map();const app={use(){},post(path,fn){routes.set('POST '+path,fn);},delete(path,fn){routes.set('DELETE '+path,fn);}};
createRankIndependentRelay({now:()=>clock}).mount(app);
function call(path,{id,ownerKey,token,body={}}={}){let status=200,result;routes.get('POST '+path)({params:{id},body,authUser:{email:'owner@test'},get(name){return name==='X-Rank-Owner'?ownerKey:name==='Authorization'?'Bearer '+token:undefined;}},{set(){return this;},status(value){status=value;return this;},json(value){result=value;return this;}});return{status,result};}
const ticket=call('/api/rank-independent').result;
// 2026-11-20: 주소의 여는 토큰은 peer에 바로 쓸 수 없고, 5분 안에 한 번만 창 토큰으로 바꿀 수 있다
assert.equal(call('/api/rank-independent/peer/:id',ticket).status,401,'Launch token cannot be used as the peer token');
const launch=ticket.token;ticket.token=call('/api/rank-independent/peer/:id/exchange',ticket).result.token;assert.match(ticket.token,/^[a-f0-9]{64}$/);assert.notEqual(ticket.token,launch);
assert.equal(call('/api/rank-independent/peer/:id/exchange',{...ticket,token:launch}).status,401,'Launch token works only once');
assert.equal(call('/api/rank-independent/:id/owner',ticket).result.peerToken,ticket.token,'Owner learns the peer token for recovery');
for(let i=0;i<10;i++){clock+=60000;assert.equal(call('/api/rank-independent/peer/:id',ticket).status,200,'Active independent window must keep relay alive while owner is suspended');}
assert.equal(call('/api/rank-independent/:id/owner',ticket).status,200,'Owner resumes existing relay');
clock+=120001;assert.equal(call('/api/rank-independent/peer/:id',ticket).status,401,'Both idle peers still expire');
const client=fs.readFileSync('public/rank-independent-client.js','utf8');assert.ok(!client.includes("postMessage('connection-ended')"),'Expired relay must not close native window');
console.log('PASS suspended owner survives active peer, abandoned relay expires, expired connection leaves native window open');
const synced = call('/api/rank-independent').result;synced.token = call('/api/rank-independent/peer/:id/exchange', synced).result.token;
call('/api/rank-independent/:id/owner', { ...synced, body: { snapshot: { supply: { selected: '005930', mode: 'day' } } } });
const supplyCommand = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', type: 'supply-display', pinned: false, settings: { selected: '000660', mode: 'day' } };
call('/api/rank-independent/peer/:id', { ...synced, body: { command: supplyCommand } });
call('/api/rank-independent/:id/owner', { ...synced, body: { acks: [supplyCommand.id], snapshot: { supply: { selected: '035420', mode: 'day' } } } });
assert.equal(call('/api/rank-independent/peer/:id', synced).result.snapshot.supply.selected, '035420', 'Acknowledged older supply selection cannot overwrite the next owner selection');
console.log('PASS newer main-window supply selection survives acknowledgement of the previous independent command');
call('/api/rank-independent/peer/:id', { ...synced, body: { command: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', type: 'supply-display', settings: { selected: '005930', mode: 'day', showCandles: true }, changed: ['showCandles'], pinned: false } } });
const changedSupply = call('/api/rank-independent/peer/:id', synced).result.snapshot.supply;
assert.equal(changedSupply.selected, '035420', 'Delayed candle setting cannot overwrite a newer stock selection');
assert.equal(changedSupply.showCandles, undefined, 'Candle visibility is local to each window');
console.log('PASS supply setting updates only the fields changed by the independent window');

const compactTicket=call('/api/rank-independent').result;compactTicket.token=call('/api/rank-independent/peer/:id/exchange',compactTicket).result.token;
call('/api/rank-independent/:id/owner',{...compactTicket,body:{snapshot:{rows:'table-data',chart:{selection:{code:'005930'},mode:'minute',points:Array.from({length:3600},(_,i)=>({time:i,value:i}))},supply:{selected:'005930',mode:'minute',points:[{t:1,individual:1}],candles:[{t:1,close:10}]}}}});
const full=call('/api/rank-independent/peer/:id',{...compactTicket}).result;
const compact=call('/api/rank-independent/peer/:id',{...compactTicket,body:{compact:true}}).result;
assert.equal(full.snapshot.chart.points.length,3600);assert.equal(compact.snapshot.chart.points,undefined);assert.equal(compact.snapshot.supply.candles,undefined);assert.equal(compact.snapshot.chart.selection.code,'005930');assert.equal(compact.snapshot.rows,'table-data');
assert.ok(JSON.stringify(compact).length<JSON.stringify(full).length/10);assert.match(compact.cacheScope,/^[a-f0-9]{64}$/);assert.ok(!compact.cacheScope.includes('owner@test'));
console.log('PASS compact native snapshots retain metadata and omit unused chart history');
// 다른 연결을 모두 정리한 뒤 확인(사용자당 연결 2개 한도)
clock+=600000;
// 메인 페이지가 연결을 붙잡고 있어도 여는 토큰은 5분이 지나면 바꿔 주지 않는다(4분 59초는 됨)
{const late=call('/api/rank-independent').result,ok=call('/api/rank-independent').result;for(let i=0;i<5;i++){clock+=59800;call('/api/rank-independent/:id/owner',late);call('/api/rank-independent/:id/owner',ok);}
assert.equal(call('/api/rank-independent/peer/:id/exchange',ok).status,200,'Launch token still works just before 5 minutes');
clock+=1001;call('/api/rank-independent/:id/owner',late);assert.equal(call('/api/rank-independent/peer/:id/exchange',late).status,401,'Launch token expires after 5 minutes');}
console.log('PASS launch token is exchanged once within 5 minutes');
