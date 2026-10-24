const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createSessionStore}=require('../../auth-session-store');
test('failed persistence does not create a usable session',()=>{
 const dir=fs.mkdtempSync(path.join(__dirname,'../output/auth-failure-'));
 try {
  const filename=path.join(dir,'sessions.json');
  const messages=[];
  const store=createSessionStore({filename,allowed:()=>true,log:m=>messages.push(m)});
  fs.mkdirSync(filename);
  assert.throws(()=>store.create({email:'a@example.com'}));
  assert.ok(messages.some(m=>m.includes('save failed')));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
