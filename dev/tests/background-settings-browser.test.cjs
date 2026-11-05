const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright'),express=require('express');
const {createBackgroundRefresh,buildJobs,mountBackgroundRoutes,createJobExecutor}=require('../../background-refresh');
test('settings gear, account box, persisted toggle and collection survive browser closure; failed save rolls back',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'background-ui-')),app=express();app.use(express.json());
 let at=Date.parse('2026-11-02T10:00:00+09:00'),calls=0,fail=false;
 const settings={rankInterval:'1',rankChartDisplay:{mode:'minute',selection:{code:'000660',name:'SK하이닉스'}}};
 app.use((req,res,next)=>{req.authUser={email:'owner@example.test',isAdmin:(req.headers.cookie||'').includes('admin=1')};if(fail&&req.method==='PUT')return res.status(500).json({error:'save failed'});next();});
 const registered=new Set();for(const job of buildJobs(settings,at)){
  const key=job.method+job.url;if(registered.has(key))continue;registered.add(key);
  app[job.method.toLowerCase()](job.url,(req,res)=>{calls++;res.json({success:true,points:[{time:'20261102100000',value:10,stock_price:100}],items:[{stk_cd:'000660',stk_nm:'SK하이닉스'}],cursor:'server-session',has_more:true});});
 }
 const service=createBackgroundRefresh({directory,now:()=>at,readSettings:()=>settings,policy:{spotAt:()=>true,futuresAt:()=>true},execute:createJobExecutor(app,{email:'owner@example.test',isAdmin:true})});
 mountBackgroundRoutes(app,service);let emails=['owner@example.test','reader@example.test'];
 app.get('/api/auth/users',(req,res)=>res.json({emails}));app.post('/api/auth/users',(req,res)=>{emails.push(req.body.email);res.json({emails});});
 app.delete('/api/auth/users/:email',(req,res)=>{emails=emails.filter(e=>e!==req.params.email);res.json({emails});});
 const html=fs.readFileSync('public/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 app.get('/',(req,res)=>res.type('html').send(html));app.use(express.static(path.resolve('public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 t.after(async()=>{service.stop();await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const source=fs.readFileSync('public/app.js','utf8').replace(/\r\n/g,'\n'),begin=source.indexOf("document.addEventListener('DOMContentLoaded', () => {\n    const profileModal"),end=source.indexOf('\n});',begin)+4;
 assert.ok(begin>=0&&end>begin);
 async function open(admin=true,width=1280){
  const context=await browser.newContext({viewport:{width,height:850}});await context.addCookies([{name:'admin',value:admin?'1':'0',url:base}]);
  const page=await context.newPage();await page.route('https://**',route=>route.abort());await page.goto(base);
  await page.addStyleTag({content:'#loginOverlay{display:none!important}#tabContainer{display:flex!important}'});
  await page.evaluate(admin=>{window.currentAuthUser={email:'owner@example.test',isAdmin:admin};window.saveAppData=async()=>true;},admin);
  await page.addScriptTag({path:'public/background-presence.js'});await page.evaluate(()=>BackgroundRefreshPresence.start());
  await page.addScriptTag({content:source.slice(begin,end)});await page.addScriptTag({path:'public/background-settings.js'});
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.getByRole('button',{name:'설정',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('backgroundRefreshEnabled').disabled||document.getElementById('backgroundRefreshMessage').textContent.includes('관리자만'));
  return {context,page};
 }
 const first=await open(),page=first.page;
 assert.equal(await page.locator('#profileTitle').innerText(),'설정');assert.equal(await page.locator('#profileBtn .profile-avatar').count(),0);
 assert.ok(await page.locator('#authorizedAccountsSection').isVisible());
 assert.equal(await page.locator('#authorizedAccountsSection').evaluate(el=>getComputedStyle(el).borderTopStyle),'solid');
 await page.locator('#authorizedEmailInput').fill('new@example.test');await page.locator('#addAuthorizedEmailForm button').click();await page.waitForFunction(()=>document.getElementById('authorizedEmailList').textContent.includes('new@example.test'));
 await page.locator('#backgroundRefreshEnabled').check();await page.waitForFunction(()=>!document.getElementById('backgroundRefreshEnabled').disabled);await service.tick();assert.equal(service.status().enabled,true);
 assert.equal(calls,0,'The replacement must not query while the real browser is connected');
 await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));at+=60000;await service.tick();assert.equal(calls,0,'A hidden tab is still an open browser');
 // Screenshots are for manual review only; keep them outside the repository.
 const shots=path.join(os.tmpdir(),'market-through-tests','background-settings');fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,'desktop.png')});
 const otherComputer=await open();assert.equal(service.status().browserCount,2);
 await first.context.close();at+=60000;await service.tick();assert.equal(calls,0,'Another computer still has Market Through open');
 await otherComputer.context.close();await new Promise(resolve=>setImmediate(resolve));const before=calls;await service.tick();assert.equal(calls,before,'The last disconnect starts a reload grace period');
 at+=60000;await service.tick();assert.ok(calls>before,'Server must collect while no browser context exists');
 const reopened=await open(true,390);await reopened.page.waitForFunction(()=>document.getElementById('backgroundRefreshEnabled').checked);
 const section=await reopened.page.locator('.background-refresh-section').boundingBox();assert.ok(section.x>=0&&section.x+section.width<=390);
 await reopened.page.screenshot({path:path.join(shots,'mobile.png')});
 fail=true;await reopened.page.locator('#backgroundRefreshEnabled').uncheck();await reopened.page.waitForFunction(()=>document.getElementById('backgroundRefreshMessage').classList.contains('is-error'));
 assert.equal(await reopened.page.locator('#backgroundRefreshEnabled').isChecked(),true);assert.equal(service.status().enabled,true);fail=false;
 await reopened.context.close();const reader=await open(false);assert.equal(await reader.page.locator('#authorizedAccountsSection').isVisible(),false);assert.equal(await reader.page.locator('#backgroundRefreshEnabled').isDisabled(),true);await reader.context.close();
});
