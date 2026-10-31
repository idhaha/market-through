const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const context={window:{}};vm.runInNewContext(fs.readFileSync('public/rank-chart-axis.js','utf8'),context);const {ticks}=context.window.RankChartAxis;
const ctx={measureText:label=>({width:label.length*7})};
test('08:00 separators follow elapsed time, including empty days, and stay inside the viewport',()=>{
 const api=context.window.RankChartAxis;
 const origin=Date.parse('2026-10-26T10:56:00+09:00');
 const domain={days:['2026-10-26','2026-10-27','2026-10-28','2026-10-29'],span:3*1440,position:value=>(Date.parse(value.replace(' ','T')+':00+09:00')-origin)/60000};
 const boundaries=api.dayBoundaryPositions(20,740,domain);
 assert.deepEqual(Array.from(boundaries,p=>p.date),['2026-10-27','2026-10-28','2026-10-29']);
 assert.ok(Math.abs(boundaries[1].x-boundaries[0].x-240)<1e-9);
 assert.ok(Math.abs(boundaries[2].x-boundaries[1].x-240)<1e-9);
 assert.equal(boundaries[0].x,20+(1440-176)/4320*720);
});
for(const width of [100,280,570])for(const mode of ['day','minute'])test(`${mode} ${width}px has consistent labels and no overlaps after edge clamping`,()=>{
 const values=Array.from({length:600},(_,i)=>Date.UTC(2024,4,3)+i*(mode==='day'?86400000:60000));
 const labels=ticks(ctx,values,v=>v,(_,i)=>16+i/(values.length-1)*(width-16),16,width,mode);
 assert.ok(labels.length);
 labels.forEach((p,i)=>{const half=ctx.measureText(p.label).width/2;assert.ok(p.labelX-half>=16);assert.ok(p.labelX+half<=width);if(i){const old=labels[i-1];assert.ok(p.labelX-half>=old.labelX+ctx.measureText(old.label).width/2+16);}assert.match(p.label,mode==='day'?/^\d{2}\/\d{2}$/:/^\d{2}:\d{2}$/);});
});
test('multiple-day minutes include date and main/candle reuse exact positions',()=>{
 const values=['20261022090000','20261023090000'];const result=ticks(ctx,values,v=>v,(_,i)=>20+i*300,16,570,'minute');assert.equal(result[0].label,'10/22 08:00');assert.ok(result.some(t=>t.label.startsWith('10/23 ')));
});

test('daily and minute candles share geometry across stock and index field formats',()=>{
 const api=context.window.RankChartAxis;
 const rows=[{low:90,high:120},{low:100,high:130}];
 const stock=rows.map(p=>({stock_low:p.low,stock_high:p.high}));
 const a=api.candleLayout(rows,p=>p.low,p=>p.high,(_,i)=>30+i*10,280,16,500);
 const b=api.candleLayout(stock,p=>p.stock_low,p=>p.stock_high,(_,i)=>30+i*10,280,16,500);
 assert.equal(a.width,7);assert.equal(a.top,10);assert.equal(a.bottom,250);
 for(const value of [90,100,120,130])assert.equal(a.y(value),b.y(value));
 assert.equal(a.minimum,b.minimum);assert.equal(a.maximum,b.maximum);
 const extreme=api.candleLayout([{low:1,high:1000000}],p=>p.low,p=>p.high,()=>30,280,16,500);
 assert.equal(extreme.minimum,0);assert.ok(Number.isFinite(extreme.y(1)));
});

test('shared hover normalizes timestamps, preserves modes, clears peers and never echoes into source',()=>{
 const api=context.window.RankChartAxis,received=[];
 api.registerHover('source',()=> 'minute',()=>Date.parse('2026-10-23T09:12:35+09:00'),()=>assert.fail('source echo'));
 api.registerHover('peer',()=> 'minute',()=>null,key=>received.push(['minute',key]));
 api.registerHover('daily',()=> 'day',()=>null,key=>received.push(['day',key]));
 api.synchronizeHover('source');
 assert.deepEqual(received,[['minute','2026-10-23 09:12'],['day',null]]);
 assert.equal(api.matchesHover('20261023091200',received[0][1],'minute'),true);
 assert.equal(api.matchesHover('20261023091300',received[0][1],'minute'),false);
 api.synchronizeHover('source',true);assert.deepEqual(received.slice(-2),[['minute',null],['day',null]]);
});
