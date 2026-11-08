const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Since 2026-10-23 the independent window queries its own charts, so only the table connection comes from the main window's snapshot.
const source=fs.readFileSync('public/rank-independent-client.js','utf8');
const code=source.slice(source.indexOf('            const applyConnection ='),source.indexOf('            lastSnapshot = snapshot;'));
function apply(snapshot){const values={};const context={snapshot,window:{setRankCardConnection:(target,ok,at)=>{values[target]={ok,at};}}};vm.runInNewContext(code,context);return values;}
let result=apply({tableConnection:{ok:true,at:1234},tableConnected:true,rows:'<tr></tr>',chartConnection:{ok:false,at:1}});
assert.deepEqual(result['#transactionTable'],{ok:true,at:1234},'Shared table status keeps the owner timestamp');
assert.deepEqual(Object.keys(result),['#transactionTable'],'Chart cards keep their own query status');
result=apply({rows:'<tr></tr>'});assert.equal(result['#transactionTable'].ok,true,'Legacy owner without connection fields is not assumed disconnected');
result=apply({tableConnected:false,rows:'<tr></tr>'});assert.equal(result['#transactionTable'].ok,false,'Explicit failure is respected');
result=apply({tableConnection:{ok:false,at:99},rows:''});assert.deepEqual(result['#transactionTable'],{ok:false,at:99});
console.log('PASS shared table connection status/timestamp, legacy owner, explicit failure; charts keep their own status');
