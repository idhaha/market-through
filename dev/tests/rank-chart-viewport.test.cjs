const vm=require('node:vm'),fs=require('node:fs'),test=require('node:test'),assert=require('node:assert/strict');
function setup(){const listeners={};const sandbox={window:{},queueMicrotask:()=>{},Date:class extends Date{static now(){return Date.parse('2026-10-23T10:00:00+09:00')}},document:{addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn)}}};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),sandbox);return {api:sandbox.window.RankChartAxis,listeners};}
for(const mode of ['day','minute'])test(`${mode}: zoom and scroll share timestamps even with missing records`,()=>{
 const {api,listeners}=setup();const dates=Array.from({length:30},(_,i)=>mode==='day'?`2026-10-${String(i+1).padStart(2,'0')}`:`2026-10-23 09:${String(i).padStart(2,'0')}`),sparse=dates.filter((_,i)=>i%3===0);
 const range=(id,values,start,count)=>api.sharedRange(id,values,v=>v,mode,start,count,()=>{});
 range('concentration',dates,0,null);range('supply',sparse,0,null);
 // Simulate capture, then the local zoom handler's draw.
 listeners.input[0]({target:{matches:()=>true,closest:s=>s==='#concentrationChartPanel'?{}:null}});
 range('concentration',dates,10,10);api.synchronizeViewport('concentration');
 let view=range('supply',sparse,0,null);assert.equal(sparse[view.start],dates[12]);assert.equal(view.count,3);
 const domain=mode==='day'?api.dailyDomain():api.minuteDomain();assert.equal(domain.first,dates[10]);assert.equal(domain.last,dates[19]);
 range('concentration',dates,15,10);api.synchronizeViewport('concentration');view=range('supply',sparse,0,null);assert.equal(sparse[view.start],dates[15]);assert.equal(view.count,4);
 const empty=range('adr',[],0,null);assert.equal(empty.count,0);
 if(mode==='minute'){api.showToday();assert.equal(api.minuteDomain().first,'2026-10-23 08:00');}
});

test('daily drag viewport uses identical tick dates across different price-axis gutter widths',()=>{
 const {api,listeners}=setup(),dates=Array.from({length:200},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
 api.sharedRange('concentration',dates,v=>v,'day',0,null,()=>{});
 listeners.input[0]({target:{matches:()=>true,closest:s=>s==='#concentrationChartPanel'?{}:null}});
 api.sharedRange('concentration',dates,v=>v,'day',50,100,()=>{});api.synchronizeViewport('concentration');
 const ctx={measureText:s=>({width:s.length*7})};
 const labels=right=>api.ticks(ctx,dates,v=>v,()=>0,16,right,'day').map(t=>t.label);
 assert.deepEqual(labels(730),labels(750));assert.deepEqual(labels(730),labels(680));
});

test('minute sliders share position and scrolling across different pages and missing observations',()=>{
 const {api,listeners}=setup();
 const dates=Array.from({length:301},(_,i)=>new Date(Date.parse('2026-10-23T08:00:00+09:00')+i*60000).toISOString().slice(0,16).replace('T',' '));
 // Use Korean local date strings, with an older page present only in the stock chart.
 const local=dates.map(d=>{const t=new Date(Date.parse(d+'Z')+9*3600000);return t.toISOString().slice(0,16).replace('T',' ')});
 const stock=['2026-10-22 19:00',...local],flow=local.filter((_,i)=>i>=60 && i%3===0);
 api.sharedRange('concentration',stock,v=>v,'minute',0,null,()=>{});api.sharedRange('supply',flow,v=>v,'minute',0,null,()=>{});
 listeners.input[0]({target:{matches:()=>true,closest:s=>s==='#concentrationChartPanel'?{}:null}});
 api.sharedRange('concentration',stock,v=>v,'minute',241,61,()=>{});api.synchronizeViewport('concentration');
 const a={dataset:{}},b={dataset:{}};api.updateSlider('concentration',a);api.updateSlider('supply',b);
 assert.equal(a.value,b.value);assert.equal(a.value,'10000');assert.equal(a.disabled,false);
 api.scrollViewport('supply',0);assert.equal(api.minuteDomain().first,'2026-10-23 08:00');
 api.updateSlider('concentration',a);api.updateSlider('supply',b);assert.equal(a.value,'0');assert.equal(a.value,b.value);
 api.scrollViewport('concentration',10000);assert.equal(api.minuteDomain().last,'2026-10-23 13:00');
 api.updateSlider('concentration',a);api.updateSlider('supply',b);assert.equal(a.value,b.value);assert.equal(a.value,'10000');
});
