const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1.5 });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
        await page.route('http://adr.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto('http://adr.test/');
        await page.evaluate(() => { document.getElementById('loginOverlay').style.display = 'none'; });
        await page.evaluate(() => { window.resizeErrors = []; window.addEventListener('error', event => window.resizeErrors.push(event.message)); });
        await page.addStyleTag({ content: fs.readFileSync('public/style.css', 'utf8') });
        await page.evaluate(() => {
            window.requests = [];
            window.markerColors = [];
            window.adrAxisLabels = [];
            window.concentrationAxisLabels = [];
            const originalText = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function(label,...args) {
                if (this.canvas.closest('#rankAdrChartPanel') && [80,100,120].includes(label)) window.adrAxisLabels.push({label,color:this.fillStyle,x:args[0],align:this.textAlign,width:this.canvas.clientWidth});
                if (this.canvas.id === 'concentrationCanvas' && /^\d+%$/.test(String(label))) window.concentrationAxisLabels.push({x:args[0],align:this.textAlign,width:this.canvas.clientWidth});
                return originalText.call(this,label,...args);
            };
            const originalFill = CanvasRenderingContext2D.prototype.fill;
            CanvasRenderingContext2D.prototype.fill = function(...args) { window.markerColors.push(this.fillStyle); return originalFill.apply(this,args); };
            const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
            const t = Date.parse(`${day}T09:01:10+09:00`);
            window.fetch = async url => {
                window.requests.push(url);
                return new Response(JSON.stringify({ marketStatus: 'open', adr: url.includes('kosdaq') ? 105 : 95, asOf: t + 10000,
                    intraday: [{ t, adr: 90 }, { t: t + 2000, adr: 92 }, { t: t - 86400000, adr: 200 }] }), { status: 200 });
            };
        });
        await page.addScriptTag({ content: fs.readFileSync('public/concentration-chart.js', 'utf8') });
        await page.addScriptTag({ content: fs.readFileSync('public/rank-adr-chart.js', 'utf8') });
        await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
        await page.waitForTimeout(100);
        await page.evaluate(() => { document.getElementById('tabContents').style.display = 'block'; });
        await page.waitForFunction(() => document.querySelector('.rank-adr-panel output').textContent === '95.00%');
        assert.equal(await page.evaluate(() => getConcentrationDisplaySettings().adrCandleOpen), false);
        await page.evaluate(() => document.querySelector('#rankAdrChartPanel .concentration-candle-toggle').click());
        assert.equal(await page.evaluate(() => getConcentrationDisplaySettings().adrCandleOpen), true);
        const savedDisplay = await page.evaluate(() => getConcentrationDisplaySettings());
        await page.evaluate(() => applyConcentrationDisplaySettings({ ...getConcentrationDisplaySettings(), adrCandleOpen: false }));
        assert.equal(await page.evaluate(() => getRankAdrCandleOpen()), false);
        await page.evaluate(settings => applyConcentrationDisplaySettings(settings), savedDisplay);
        assert.equal(await page.locator('#rankAdrChartPanel .concentration-candle-toggle').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.evaluate(() => getRankAdrCandleOpen()), true);
        await page.evaluate(() => applyConcentrationDisplaySettings({ ...getConcentrationDisplaySettings(), adrCandleOpen: false }));
        assert.ok(await page.evaluate(() => window.markerColors.includes('#f97316')), 'Today ADR has an orange marker');
        assert.ok(await page.evaluate(()=>[80,100,120].every(label=>window.adrAxisLabels.some(p=>p.label===label&&p.color==='#ff6b6b'))),'ADR reference labels share the same red');
        assert.ok(await page.evaluate(()=>{
            const label=window.adrAxisLabels.at(-1),canvas=document.querySelector('#rankAdrChartPanel .rank-adr-area canvas');
            const output=document.querySelector('#rankAdrChartPanel output');
            return label.align==='right'&&Math.abs(label.x-(label.width-36))<1&&Math.abs(canvas.getBoundingClientRect().left+label.x-output.getBoundingClientRect().right)<1;
        }),'ADR latest value ends at the right edge of its Y-axis labels');
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage)[0])).length), 1, 'One sample per minute; previous day excluded');
        await page.selectOption('.rank-adr-panel select', 'kosdaq');
        await page.waitForFunction(() => document.querySelector('.rank-adr-panel output').textContent === '105.00%');
        assert.ok(await page.evaluate(() => window.requests.at(-1).endsWith('market=kosdaq')));
        await page.waitForTimeout(100);
        const sizes = await page.evaluate(() => ['#concentrationChartPanel', '.rank-adr-panel'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.width, r.height]; }));
        assert.deepEqual(sizes[0], sizes[1], 'Chart panels have identical dimensions');
        assert.ok(await page.evaluate(()=>{
            const outputs=[document.getElementById('concentrationCurrentRate'),document.querySelector('#rankAdrChartPanel output')];
            const styles=outputs.map(el=>{const s=getComputedStyle(el);return [s.fontFamily,s.fontSize,s.fontWeight,s.color].join('|');});
            return styles[0]===styles[1]&&outputs.every(el=>el.getBoundingClientRect().right<=el.closest('.panel').getBoundingClientRect().right);
        }),'Latest values share ADR typography and stay within each panel');
        await page.evaluate(() => window.applyConcentrationDisplaySettings({ candleOpen: true }));
        await page.waitForTimeout(100);
        const expanded = await page.evaluate(() => ['#concentrationChartPanel', '.rank-adr-panel'].map(s => document.querySelector(s).getBoundingClientRect().height));
        assert.ok(expanded[0] > sizes[0][1], 'Candle chart expands concentration panel');
        assert.equal(expanded[1], sizes[1][1], 'ADR height stays unchanged when candle chart opens');
        await page.evaluate(() => window.applyConcentrationDisplaySettings({ candleOpen: false }));
        await page.waitForTimeout(100);
        assert.equal(await page.locator('.rank-adr-panel').evaluate(p => p.getBoundingClientRect().height), sizes[1][1]);
        assert.ok(await page.locator('.rank-adr-area canvas').evaluate(canvas => canvas.width > 0 && canvas.height >= 280), 'Canvas is visible with actual Rank markup');
        await page.setViewportSize({ width: 900, height: 700 });
        await page.waitForTimeout(200);
        await page.evaluate(() => { document.getElementById('tabContents').style.display = 'none'; });
        await page.waitForTimeout(100);
        await page.evaluate(() => { document.getElementById('tabContents').style.display = 'block'; });
        await page.waitForTimeout(200);
        assert.deepEqual(await page.evaluate(() => window.resizeErrors), [], 'Resize and hidden tab transitions do not produce observer loop errors');
        assert.deepEqual(errors, []);
        await page.evaluate(async () => {
            localStorage.clear();
            const nextDay = Date.now() + 86400000;
            Date.now = () => nextDay;
            const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
            const t = Date.parse(`${day}T09:01:00+09:00`) - 86400000;
            window.previousDay = new Date(t + 9 * 3600000).toISOString().slice(0, 10);
            window.fetch = async () => new Response(JSON.stringify({ marketStatus: 'closed', adr: null, asOf: null,
                intraday: [{ t, adr: 85 }, { t: t + 60000, adr: 86 }] }));
            await window.refreshRankAdrChart();
        });
        assert.equal(await page.locator('.rank-adr-panel output').textContent(), '86.00%');
        assert.ok((await page.locator('.rank-adr-status').textContent()).includes('직전 거래일'));
        assert.equal(await page.evaluate(() => localStorage.length), 0, 'Previous day history is fetched rather than persisted');
        await page.evaluate(async () => {
            window.fetch = async () => new Response(JSON.stringify({ marketStatus: 'closed', adr: null, intraday: [],
                lastClosed: { date: window.previousDay.replaceAll('-', ''), adr: 74.55 } }));
            await window.refreshRankAdrChart();
        });
        assert.equal(await page.locator('.rank-adr-panel output').textContent(), '86.00%');
        assert.ok((await page.locator('.rank-adr-status').textContent()).includes('직전 거래일'), 'Empty response preserves last received session');
        await page.evaluate(async () => {
            const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
            window.fetch = async () => new Response(JSON.stringify({ marketStatus: 'open', adr: 98, asOf: Date.parse(`${day}T09:00:10+09:00`), intraday: [] }));
            await window.refreshRankAdrChart();
        });
        assert.equal(await page.locator('.rank-adr-panel output').textContent(), '98.00%');
        assert.equal(await page.locator('.rank-adr-panel h2').textContent(), 'ADR');
        assert.equal(await page.locator('[data-adr-mode="minute"]').textContent(), '당일 1분');
        await page.evaluate(async () => {
            const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
            window.sessionDay = day;
            const beforeMidnight = Date.parse(`${day}T23:59:00+09:00`);
            Date.now = () => beforeMidnight;
            const t = Date.parse(`${day}T15:28:00+09:00`);
            window.fetch = async () => new Response(JSON.stringify({ marketStatus: 'closed', adr: 74.55,
                asOf: Date.parse(`${day}T20:05:40+09:00`), intraday: [{ t, adr: 75 }, { t: t + 60000, adr: 74.55 }],
                lastClosed: { date: day.replaceAll('-', ''), adr: 74.55 } }));
            await window.refreshRankAdrChart();
        });
        assert.equal(await page.locator('.rank-adr-panel output').textContent(), '74.55%');
        assert.ok((await page.locator('.rank-adr-area canvas').getAttribute('aria-label')).includes('분봉 차트'), 'After close, intraday takes priority over lastClosed');
        assert.ok(!(await page.locator('.rank-adr-status').textContent()).includes('분봉 기록 없음'));
        await page.evaluate(async () => {
            const afterMidnight = Date.parse(`${window.sessionDay}T23:59:00+09:00`) + 120000;
            Date.now = () => afterMidnight;
            await window.refreshRankAdrChart();
        });
        assert.ok((await page.locator('.rank-adr-area canvas').getAttribute('aria-label')).includes('분봉 차트'), 'Available API history still displays after midnight');
        assert.ok((await page.locator('.rank-adr-status').textContent()).includes('직전 거래일'));
        await page.evaluate(() => {
            window.fetch = async url => {
                window.requests.push(url);
                if (url.includes('/history')) return new Response(JSON.stringify({ series: [
                    { date:'2025-12-31', adr:95 }, { date:'2026-01-02', adr:105 }, { date:'2026-02-02', adr:85 }, { date:'2026-03-02', adr:110 }
                ] }));
                if (url.includes('/candles')) return new Response(JSON.stringify({ points: ['2025-12-31','2026-01-02','2026-02-02','2026-03-02'].map(date => ({
                    t:Date.parse(`${date}T09:00:00+09:00`), open:160000, high:3200000, low:150000, close:170000
                })) }));
                return new Response(JSON.stringify({ intraday:[], marketStatus:'closed' }));
            };
        });
        await page.click('[data-adr-mode="day"]');
        await page.waitForFunction(() => document.querySelector('.rank-adr-panel output').textContent === '110.00%');
        await page.evaluate(() => {
            window.candleBodies = []; window.candleAxisLabels = [];
            const fillRect = CanvasRenderingContext2D.prototype.fillRect;
            CanvasRenderingContext2D.prototype.fillRect = function(x,y,w,h) {
                if (this.canvas.closest('.rank-adr-candle-area') && ['#e11d48','#2563eb'].includes(this.fillStyle)) window.candleBodies.push({right:x+w});
                return fillRect.call(this,x,y,w,h);
            };
            const fillText = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function(label,x,y) {
                if (this.canvas.closest('.rank-adr-candle-area') && /^-?\d+\.\d{2}$/.test(String(label))) window.candleAxisLabels.push({left:x-this.measureText(label).width,value:Number(label)});
                return fillText.call(this,label,x,y);
            };
        });
        assert.ok(await page.locator('.rank-adr-ranges').isVisible());
        for (const range of ['6m','1y','3y','5y']) {
            await page.click(`[data-adr-range="${range}"]`);
            await page.waitForFunction(range => window.requests.at(-1).includes(`range=${range}`), range);
        }
        await page.click('.rank-adr-controls .concentration-candle-toggle');
        await page.waitForFunction(() => window.requests.at(-1).includes('/candles'));
        await page.waitForTimeout(150);
        assert.ok(await page.locator('.rank-adr-candle-area').isVisible());
        assert.ok(await page.evaluate(() => window.candleBodies.length && window.candleAxisLabels.length
            && Math.max(...window.candleBodies.map(p => p.right)) + 8 <= Math.min(...window.candleAxisLabels.map(p => p.left))),
        'ADR candles stay clear of the right price-axis labels');
        assert.ok(await page.evaluate(() => window.candleAxisLabels.length >= 5 && window.candleAxisLabels.every(p => p.value >= 0)),
        'ADR index candle axis does not display negative prices');
        const surface = page.locator('.rank-adr-area canvas');
        await surface.scrollIntoViewIfNeeded();
        const bounds = await surface.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 90);
        assert.ok(await page.locator('#rankAdrChartPanel > .chart-hover-info').isVisible());
        assert.ok(!(await page.locator('.rank-adr-candle-area .concentration-tooltip').isVisible()), 'Candle tooltip is suppressed');
        assert.ok(await page.locator('#rankAdrChartPanel > .chart-hover-info').evaluate(tip=>{
            const info=tip.getBoundingClientRect(),area=tip.nextElementSibling.getBoundingClientRect();
            return getComputedStyle(tip).position==='static'&&info.bottom<=area.top&&info.height===24;
        }),'ADR hover info occupies a reserved row above the plot');
        const rowTop=await page.locator('#rankAdrChartPanel > .chart-hover-info').evaluate(el=>el.getBoundingClientRect().top);
        await page.mouse.move(bounds.x+bounds.width*.7,bounds.y+90);
        assert.equal(await page.locator('#rankAdrChartPanel > .chart-hover-info').evaluate(el=>el.getBoundingClientRect().top),rowTop,'Info position remains fixed as the pointer moves');
        fs.mkdirSync('dev/output', { recursive: true });
        await page.screenshot({ path:'dev/output/rank-adr-daily-preview.png', fullPage:true });
        await page.evaluate(async () => {
            const previousFetch=window.fetch;
            window.fetch = async url => url.includes('/history') ? new Response(JSON.stringify({series:Array.from({length:120},(_,i) => ({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),adr:90+i%30}))})) : previousFetch(url);
            await window.refreshRankAdrChart();
        });
        await page.click('[aria-label="ADR 차트 확대"]');
        assert.equal(await page.locator('.rank-adr-zoom input').getAttribute('max'),'60');
        await page.evaluate(async () => window.refreshRankAdrChart());
        assert.equal(await page.locator('.rank-adr-zoom input').getAttribute('max'),'60','Refresh preserves zoom');
        await page.locator('.rank-adr-zoom input').evaluate(slider => { slider.value='0'; slider.dispatchEvent(new Event('input')); });
        await page.click('[aria-label="ADR 차트 축소"]');
        assert.equal(await page.locator('.rank-adr-zoom input').getAttribute('max'),'0');
        await surface.scrollIntoViewIfNeeded();
        const zoomBounds=await surface.boundingBox();
        await page.mouse.move(zoomBounds.x+90,zoomBounds.y+80); await page.mouse.down();
        await page.mouse.move(zoomBounds.x+zoomBounds.width*.6,zoomBounds.y+80,{steps:8}); await page.mouse.up();
        assert.ok(Number(await page.locator('.rank-adr-zoom input').getAttribute('max'))>0,'Forward drag zooms selected range');
        const candleSurface=page.locator('.rank-adr-candle-area canvas'); await candleSurface.scrollIntoViewIfNeeded();
        const candleBounds=await candleSurface.boundingBox();
        await page.mouse.move(candleBounds.x+candleBounds.width*.6,candleBounds.y+80);await page.mouse.down();
        await page.mouse.move(candleBounds.x+90,candleBounds.y+80,{steps:8});await page.mouse.up();
        assert.equal(await page.locator('.rank-adr-zoom input').getAttribute('max'),'0','Reverse candle drag restores entire range');
        await page.click('.rank-adr-controls .concentration-candle-toggle');
        assert.ok(!(await page.locator('.rank-adr-candle-area').isVisible()));
        await page.click('[data-adr-mode="minute"]');
        assert.ok(!(await page.locator('.rank-adr-ranges').isVisible()));
        await page.evaluate(()=>{
            const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
            window.fetch=async url=>new Response(JSON.stringify(url.includes('/history')?{series:[{date:'2020-01-02',adr:90},{date,adr:70}]}:{points:[]}));
        });
        await page.click('[data-adr-mode="day"]');
        await page.waitForFunction(()=>document.querySelector('#rankAdrChartPanel output').textContent==='70.00%');
        assert.ok(await page.locator('#rankAdrChartPanel .rank-adr-area canvas').evaluate(canvas=>{
            const w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio;
            const bottom=h-30,py=bottom-(70-55)/90*(bottom-10);
            const pixel=canvas.getContext('2d').getImageData(Math.round((w-70+2)*dpr),Math.round(py*dpr),1,1).data;
            return pixel[0]>220&&pixel[1]>60&&pixel[1]<160&&pixel[2]<80&&pixel[3]>200;
        }),'The orange endpoint remains visible beyond the plot clipping edge');
        await page.evaluate(() => {
            window.concentrationStrokes=[]; window.concentrationDots=[];window.concentrationBadges=[];
            const text=CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText=function(label,x,y,...args){if(this.canvas.id==='concentrationCanvas'&&this.fillStyle==='#ffffff')window.concentrationBadges.push({label,x,width:this.canvas.clientWidth});return text.call(this,label,x,y,...args);};
            const stroke=CanvasRenderingContext2D.prototype.stroke, arc=CanvasRenderingContext2D.prototype.arc;
            CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.id==='concentrationCanvas')window.concentrationStrokes.push({color:this.strokeStyle,width:this.lineWidth});return stroke.apply(this,args);};
            CanvasRenderingContext2D.prototype.arc=function(x,y,r,...args){if(this.canvas.id==='concentrationCanvas')window.concentrationDots.push({x,y,r,color:this.fillStyle});return arc.call(this,x,y,r,...args);};
            const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10).replaceAll('-','');
            window.applyRankChartState({selection:{code:'005930',name:'삼성전자'},mode:'day',interval:1,points:[{time:'20200102',value:12},{time:day,value:15}],market:'코스피'});
        });
        assert.ok(await page.evaluate(()=>window.concentrationStrokes.some(p=>p.color==='#339af0'&&p.width===2)),'Concentration line matches ADR');
        assert.ok(await page.evaluate(()=>{
            const label=window.concentrationAxisLabels.at(-1),canvas=document.getElementById('concentrationCanvas');
            const output=document.getElementById('concentrationCurrentRate');
            return label.align==='right'&&Math.abs(label.x-(label.width-36))<1&&Math.abs(canvas.getBoundingClientRect().left+label.x-output.getBoundingClientRect().right)<1;
        }),'Concentration latest value ends at the right edge of its Y-axis labels');
        assert.ok(await page.evaluate(()=>window.concentrationDots.some(p=>p.color==='#f97316'&&p.r===4)),'Today concentration has an orange marker');
        const concentrationSurface=page.locator('#concentrationCanvas');await concentrationSurface.scrollIntoViewIfNeeded();
        const concentrationBounds=await concentrationSurface.boundingBox();
        await page.mouse.move(concentrationBounds.x+20,concentrationBounds.y+80);
        await concentrationSurface.dispatchEvent('mousemove',{clientX:concentrationBounds.x+20,clientY:concentrationBounds.y+80});
        assert.ok(await page.evaluate(()=>window.concentrationDots.some(p=>p.color==='#339af0'&&p.r===4&&p.x<100)),'Concentration hover draws a marker at the hovered historical point');
        assert.ok(await page.evaluate(()=>window.concentrationBadges.some(p=>p.label==='12.00%'&&p.x>p.width/2)),'Concentration hover shows its value on the right axis');
        assert.ok((await page.locator('#concentrationTooltip').textContent()).startsWith('2020-01-02 · 쏠림율'));
        assert.ok(await page.locator('#concentrationTooltip').evaluate(tip=>tip.nextElementSibling.classList.contains('concentration-chart-area')&&tip.getBoundingClientRect().bottom<=tip.nextElementSibling.getBoundingClientRect().top),'Concentration info is above its plot');
        const heightBefore=await page.locator('#concentrationChartPanel').evaluate(el=>el.getBoundingClientRect().height);
        await concentrationSurface.dispatchEvent('mouseleave');
        assert.equal(await page.locator('#concentrationChartPanel').evaluate(el=>el.getBoundingClientRect().height),heightBefore,'Clearing hover does not resize the panel');
        await page.evaluate(() => {
            window.concentrationCandleBodies=[];window.concentrationCandleAxis=[];
            const rect=CanvasRenderingContext2D.prototype.fillRect;
            CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(this.canvas.id==='concentrationCandleCanvas'&&['#e11d48','#2563eb'].includes(this.fillStyle))window.concentrationCandleBodies.push({right:x+w});return rect.call(this,x,y,w,h);};
            const text=CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText=function(label,x,y){if(this.canvas.id==='concentrationCandleCanvas'&&/^-?\d[\d,]*$/.test(String(label))&&this.textAlign==='left')window.concentrationCandleAxis.push({left:x,value:Number(String(label).replaceAll(',',''))});return text.call(this,label,x,y);};
            window.applyRankChartState({selection:{code:'005930',name:'삼성전자'},mode:'day',interval:1,
                points:[{time:'20200102',value:12,stock_open:160000,stock_high:170000,stock_low:150000,stock_price:165000},
                    {time:'20200103',value:15,stock_open:1600000,stock_high:3200000,stock_low:1500000,stock_price:3150000}],market:'코스피'});
            window.applyConcentrationDisplaySettings({...window.getConcentrationDisplaySettings(),candleOpen:true});
        });
        assert.ok(await page.evaluate(()=>window.concentrationCandleBodies.length&&window.concentrationCandleAxis.length
            && Math.max(...window.concentrationCandleBodies.map(p=>p.right))+8<=Math.min(...window.concentrationCandleAxis.map(p=>p.left))),
        'Concentration candles stay clear of the right price-axis labels');
        assert.ok(await page.evaluate(()=>window.concentrationCandleAxis.length===5
            && window.concentrationCandleAxis.every(p=>p.value>=0)), 'Positive stock prices never produce a negative Y-axis tick');
        assert.deepEqual(await page.evaluate(() => window.resizeErrors), []);
        assert.deepEqual(errors, []);
        console.log('PASS ADR minute merge, day filtering, market selection and equal panel sizes');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
