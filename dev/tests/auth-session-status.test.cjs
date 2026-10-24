const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('countdown, Korean daily warning, reload deduplication and expiry',()=>{
 let at=Date.parse('2026-10-24T00:00:00+09:00'), alerts=[], reloads=0, tick;
 const storage=new Map(), output={};
 function boot(){
  const context={window:{},document:{visibilityState:'visible',getElementById:()=>output,addEventListener:()=>{}},Date:class extends Date{static now(){return at;}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},alert:s=>alerts.push(s),location:{reload:()=>reloads++},setInterval:fn=>{tick=fn;},fetch:async()=>({ok:false,status:503})};
  vm.runInNewContext(fs.readFileSync('public/auth-session-status.js','utf8'),context);return context.window;
 }
 const end=at+7*86400000;
 let win=boot();win.updateAuthSessionStatus({reauthenticateAt:end});assert.equal(output.textContent,'재인증 D-07일');assert.equal(alerts.length,1);
 tick();assert.equal(alerts.length,1);
 win=boot();win.updateAuthSessionStatus({reauthenticateAt:end});assert.equal(alerts.length,1);
 at+=86400000;tick();assert.equal(alerts.length,2);assert.equal(output.textContent,'재인증 D-06일');
 at=end;tick();assert.equal(reloads,1);
});
