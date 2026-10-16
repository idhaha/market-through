const { chromium } = require('playwright');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
 // Evaluate the real route with a fake filesystem so no user backups are removed.
 const source = fs.readFileSync('server.js','utf8');
 const helper = source.slice(source.indexOf('const BACKUP_NAME_PATTERN'),source.indexOf("app.get('/api/settings/backups',"));
 const route = source.slice(source.indexOf("app.delete('/api/settings/backups/:filename'"),source.indexOf("app.post('/api/settings/backups',"));
 let handler, removed=[], failure=null;
 vm.runInNewContext(helper+route,{__dirname:path.resolve('.'),path,fs:{unlinkSync:p=>{if(failure) throw failure;removed.push(p);}},app:{delete:(_,fn)=>{handler=fn;}}});
 const request = filename => {let status=200,body;handler({params:{filename}},{status:n=>{status=n;return {json:v=>{body=v;}};},json:v=>{body=v;}});return {status,body};};
 assert.equal(request('../.env').status,400); assert.equal(removed.length,0);
 assert.equal(request('manualsaved_user_settings_20261010_010101_001.json').body.success,true);
 assert.equal(request('autosaved_user_settings.json').status,403); assert.equal(removed.length,1);
 failure=Object.assign(new Error(),{code:'ENOENT'});assert.equal(request('full_backup_20261010_010101_001.json').status,404);
 failure=Object.assign(new Error(),{code:'EACCES'});assert.equal(request('full_backup_20261010_010101_001.json').status,500);
 const browser = await chromium.launch({headless:true,channel:'msedge'});
 try {
 const page = await browser.newPage();
 await page.route('http://market.test/**',route=>route.fulfill({contentType:'text/html',body:fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'')}));
 await page.goto('http://market.test/');await page.addScriptTag({content:fs.readFileSync('public/app.js','utf8')});
 await page.addStyleTag({content:fs.readFileSync('public/style.css','utf8')});
 await page.evaluate(()=>{
  document.getElementById('loginOverlay').style.display='none';
  window.deleted=[];window.fail=false;
  window.fetch=async (url,options)=>{deleted.push({url,method:options.method});return {ok:!window.fail,json:async()=>({success:!window.fail,error:'삭제 실패 테스트'})};};
  window.choice=null;
  chooseServerBackup([{filename:'autosaved_user_settings.json',bytes:100,updatedAt:1},{filename:'full_backup_20261010_010101_001.json',bytes:200,updatedAt:2}]).then(value=>{window.choice=value;});
 });
 const remove=page.getByRole('button',{name:'full_backup_20261010_010101_001.json 삭제',exact:true});
 await page.locator('.backup-picker-item').first().click();
 page.once('dialog',d=>d.dismiss());await remove.click();assert.equal(await page.locator('.backup-picker-row').count(),2);assert.equal(await page.evaluate(()=>deleted.length),0);
 await remove.focus();page.once('dialog',d=>d.accept());await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelectorAll('.backup-picker-row').length===1);
 assert.equal(await page.getByRole('button',{name:'선택한 설정 복원',exact:true}).isDisabled(),true);
 assert.equal(await page.evaluate(()=>deleted[0].method),'DELETE');
 assert.equal(await page.getByRole('button',{name:'autosaved_user_settings.json 삭제',exact:true}).count(),0);
 await page.locator('#cancelBackupPicker').click();
 await page.evaluate(()=>{ chooseServerBackup([{filename:'full_backup_20261010_010101_001.json',bytes:200,updatedAt:2}]); });
 await page.evaluate(()=>{window.fail=true;});
 page.on('dialog',d=>d.accept());
 await page.getByRole('button',{name:'full_backup_20261010_010101_001.json 삭제',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.backup-picker-delete').disabled);
 assert.equal(await page.locator('.backup-picker-row').count(),1);
 await page.locator('#cancelBackupPicker').click();
 console.log('PASS: restricted delete path, success/404/500, delete cancellation, keyboard X deletion without restore, count/selection update, failed deletion retains file');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
