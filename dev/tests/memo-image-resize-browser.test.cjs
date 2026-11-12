const assert=require('node:assert/strict'),express=require('express'),{chromium}=require('playwright');
// Note editor (Quill 1.3.6) picture resize (2026-11-12): a pasted picture is selected with a border and 8 handles at its
// corners and edge midpoints; dragging a handle changes the width (height follows), saved as the image width attribute.
const PNG='data:image/png;base64,'+Buffer.from('89504e470d0a1a0a0000000d49484452000000c8000000640806000000','hex').toString('base64');
(async()=>{
 const app=express();
 app.get('/harness.html',(req,res)=>res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.quilljs.com/1.3.6/quill.snow.css"><link rel="stylesheet" href="/style.css">
<script src="https://cdn.quilljs.com/1.3.6/quill.js"></script><script src="/memo-image-resize.js"></script></head>
<body><div id="ed" style="height:500px;width:800px"></div><button id="out">밖</button>
<script>window.q=new Quill('#ed',{theme:'snow'});MemoImageResize.attach(q);</script></body></html>`));
 app.use(express.static('public'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/harness.html');await page.waitForFunction(()=>window.q);
  // A canvas-made 200×100 picture, inserted as the user would paste it.
  await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=100;c.getContext('2d').fillRect(0,0,200,100);q.insertEmbed(0,'image',c.toDataURL(),'user');});
  await page.waitForSelector('.memo-image-overlay:not([hidden])');
  const geo=()=>page.evaluate(()=>{const i=document.querySelector('.ql-editor img').getBoundingClientRect(),o=document.querySelector('.memo-image-overlay').getBoundingClientRect();
   return {img:[i.left,i.top,i.width,i.height].map(Math.round),box:[o.left,o.top,o.width,o.height].map(Math.round),handles:[...document.querySelectorAll('.memo-image-handle')].map(h=>{const r=h.getBoundingClientRect();return [h.dataset.pos,Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)];})};});
  let g=await geo();
  assert.deepEqual(g.box,g.img,'the border sits on the picture');assert.equal(g.handles.length,8);
  const at=pos=>g.handles.find(h=>h[0]===pos);const [x,y,w,h]=g.img;
  assert.deepEqual([at('nw')[1],at('nw')[2]],[x,y]);assert.deepEqual([at('se')[1],at('se')[2]],[x+w,y+h]);assert.deepEqual([at('e')[1],at('e')[2]],[x+w,y+h/2]);
  // Drag the bottom-right handle 100px right: 300 wide, height follows (150), saved as width="300".
  const se=at('se');await page.mouse.move(se[1],se[2]);await page.mouse.down();await page.mouse.move(se[1]+50,se[2]+5,{steps:3});await page.mouse.move(se[1]+100,se[2]+10,{steps:3});await page.mouse.up();
  g=await geo();assert.deepEqual([g.img[2],g.img[3]],[300,150]);assert.deepEqual(g.box,g.img,'the border follows the new size');
  assert.equal(await page.evaluate(()=>q.getContents().ops[0].attributes?.width),'300','kept in the Quill contents (saved with the note)');
  // Left handle drags to the left to grow.
  const wl=g.handles.find(h=>h[0]==='w');await page.mouse.move(wl[1],wl[2]);await page.mouse.down();await page.mouse.move(wl[1]+60,wl[2],{steps:3});await page.mouse.up();
  assert.equal(await page.evaluate(()=>q.getContents().ops[0].attributes?.width),'240');
  // Clicking elsewhere hides it; clicking the picture shows it again; loading saved contents does not select.
  await page.click('#out');assert.equal(await page.locator('.memo-image-overlay').isHidden(),true);
  await page.click('.ql-editor img');assert.equal(await page.locator('.memo-image-overlay').isVisible(),true);
  await page.click('#out');await page.evaluate(()=>q.setContents(q.getContents(),'api'));await page.waitForTimeout(100);
  assert.equal(await page.locator('.memo-image-overlay').isHidden(),true,'a loaded note does not select its pictures');
  assert.deepEqual(errors,[]);console.log('memo image resize ok');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e.message);process.exit(1);});
