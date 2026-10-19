const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/rank-independent-client.js','utf8');
const code=source.slice(source.indexOf('            const applyConnection ='),source.indexOf('            lastSnapshot = snapshot;'));
function apply(snapshot,pinned=false){const values={};const context={snapshot,pin:{checked:pinned},window:{getRankChartState:()=>({selection:{code:'A'}}),setRankCardConnection:(target,ok,at)=>{values[target]={ok,at};}}};vm.runInNewContext(code,context);return values;}
let result=apply({chartConnection:{ok:true,at:1234},chartConnected:true,chart:{selection:{code:'A'},points:[{}]}});assert.equal(result['#concentrationChartPanel'].ok,true);assert.equal(result['#concentrationChartPanel'].at,1234);
result=apply({chart:{selection:{code:'A'},points:[{}],status:''}});assert.equal(result['#concentrationChartPanel'].ok,true,'Legacy owner without connection fields is not assumed disconnected');
result=apply({chartConnected:false,chart:{points:[{}]}});assert.equal(result['#concentrationChartPanel'].ok,false,'Explicit failure is respected');
result=apply({chartConnected:false,chart:{selection:{code:'B'},points:[{}]}},true);assert.equal(result['#concentrationChartPanel'],undefined,'Different pinned selection keeps independent query status');
console.log('PASS shared connection status/timestamp, legacy owner, explicit failure and pinned selection');
