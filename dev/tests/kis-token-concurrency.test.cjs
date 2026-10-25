const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('concurrent server collectors share one KIS token request and retry after a failed request',async()=>{
 const server=fs.readFileSync(require('node:path').resolve(__dirname,'../../server.js'),'utf8');
 const region=server.slice(server.indexOf('// eFriend 토큰 캐싱을 위한 전역 변수'),server.indexOf('app.listen(PORT'));
 let calls=0,release,fail=false;
 const context={Date,Promise,fileLog:()=>{},console:{error:()=>{}},axios:{post:async()=>{calls++;await new Promise(resolve=>{release=resolve;});if(fail)throw new Error('auth failed');return{data:{access_token:'test-token',expires_in:1}};}}};
 vm.createContext(context);vm.runInContext(region+'\nthis.getToken=getEfriendAccessToken;',context);
 const a=context.getToken('test','key','secret'),b=context.getToken('test','key','secret');
 assert.equal(calls,1);release();assert.deepEqual(await Promise.all([a,b]),['test-token','test-token']);
 fail=true;const failed=context.getToken('test','key','secret');assert.equal(calls,2);release();await assert.rejects(failed,/auth failed/);
 fail=false;const retry=context.getToken('test','key','secret');assert.equal(calls,3);release();assert.equal(await retry,'test-token');
});
