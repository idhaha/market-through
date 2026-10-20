const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRankIndependentRelay}=require('../../rank-independent');
let clock=1000000;const routes=new Map();const app={use(){},post(path,fn){routes.set('POST '+path,fn);},delete(path,fn){routes.set('DELETE '+path,fn);}};
createRankIndependentRelay({now:()=>clock}).mount(app);
function call(path,{id,ownerKey,token,body={}}={}){let status=200,result;routes.get('POST '+path)({params:{id},body,authUser:{email:'owner@test'},get(name){return name==='X-Rank-Owner'?ownerKey:name==='Authorization'?'Bearer '+token:undefined;}},{set(){return this;},status(value){status=value;return this;},json(value){result=value;return this;}});return{status,result};}
const ticket=call('/api/rank-independent').result;
for(let i=0;i<10;i++){clock+=60000;assert.equal(call('/api/rank-independent/peer/:id',ticket).status,200,'Active independent window must keep relay alive while owner is suspended');}
assert.equal(call('/api/rank-independent/:id/owner',ticket).status,200,'Owner resumes existing relay');
clock+=120001;assert.equal(call('/api/rank-independent/peer/:id',ticket).status,401,'Both idle peers still expire');
const client=fs.readFileSync('public/rank-independent-client.js','utf8');assert.ok(!client.includes("postMessage('connection-ended')"),'Expired relay must not close native window');
console.log('PASS suspended owner survives active peer, abandoned relay expires, expired connection leaves native window open');
const synced = call('/api/rank-independent').result;
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
