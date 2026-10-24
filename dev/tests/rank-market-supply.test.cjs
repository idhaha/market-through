const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
    const browser=await chromium.launch({headless:true,channel:'msedge'});
    try {
        const page=await browser.newPage({viewport:{width:1800,height:1100}}), errors=[], calls=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.addInitScript(()=>{
            window.barDraws=[];window.lineDraws=0;
            const fill=CanvasRenderingContext2D.prototype.fillRect,stroke=CanvasRenderingContext2D.prototype.stroke;
            CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(this.canvas.closest('#rankMarketSupplyChartPanel .rank-adr-area')&&['#e11d48','#2563eb'].includes(this.fillStyle))window.barDraws.push({x,y,w,h,color:this.fillStyle});return fill.call(this,x,y,w,h);};
            CanvasRenderingContext2D.prototype.stroke=function(){if(this.canvas.closest('#rankMarketSupplyChartPanel')&&this.lineWidth===2)window.lineDraws++;return stroke.call(this);};
        });
        const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
        const rows=Array.from({length:50},(_,i)=>({t:Date.parse(`${day}T09:00:00+09:00`)-(49-i)*86400000,foreign:(i%2?1:-1)*(i+1)*10,program:(i%3?1:-1)*(i+1)*5,institution:80-i*3,individual:i*4-80}));
        const candles=rows=>rows.map(p=>({t:p.t,open:2500,high:2515,low:2490,close:2508}));
        let fail=false;
        await page.route('http://market-flow.test/**',async route=>{
            const url=new URL(route.request().url());
            if(url.pathname==='/style.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync('public/style.css','utf8')});
            if(url.pathname==='/api/market-supply/chart'){
                calls.push(Object.fromEntries(url.searchParams));
                if(fail)return route.fulfill({status:502,json:{success:false,error:'테스트 조회 실패'}});
                const minute=url.searchParams.get('mode')==='minute',future=url.searchParams.get('code').startsWith('futures');
                const points=minute?rows.map((p,i)=>({...p,t:Date.parse(`${day}T09:00:00+09:00`)+i*60000,...(future?{program:undefined}:{})})):rows;
                return route.fulfill({json:{success:true,points,candles:candles(points),has_more:!url.searchParams.has('cursor'),cursor:minute?'20261022':'opaque:key',date:day,warnings:future?['선물 프로그램 수급 미제공']:[]}});
            }
            return route.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><link rel="stylesheet" href="/style.css"><style>body{margin:20px}.rank-chart-row>.panel{height:450px;padding:14px}.rank-chart-row>.panel:not(#rankMarketSupplyChartPanel){display:block}</style><div id="tab_rank"><div class="rank-chart-row"><section id="concentrationChartPanel" class="panel concentration-chart-panel"><h2>쏠림율</h2></section><section id="rankSupplyChartPanel" class="panel rank-supply-panel"><h2>수급</h2></section><section id="rankBreadthChartPanel" class="panel rank-volatility-panel rank-breadth-panel"><h2>신고가·신저가</h2></section><section id="rankTurnoverChartPanel" class="panel rank-turnover-panel"><h2>거래대금</h2></section><section id="rankVolatilityChartPanel" class="panel rank-volatility-panel"><h2>변동성</h2></section><section id="rankSentimentChartPanel" class="panel rank-volatility-panel rank-sentiment-panel"><h2>CNN</h2></section><section id="rankAdrChartPanel" class="panel"><h2>ADR</h2></section></div></div>`});
        });
        await page.goto('http://market-flow.test/');
        for(const file of ['rank-chart-axis.js','rank-connection-status.js','rank-market-supply-chart.js'])await page.addScriptTag({path:`public/${file}`});
        const panel=page.locator('#rankMarketSupplyChartPanel');
        await page.waitForFunction(()=>document.querySelector('#rankMarketSupplyChartPanel [role="status"]').textContent.includes('일별 순매수대금'));
        assert.equal(await panel.getByText('+ 종목 추가',{exact:true}).count(),0);
        assert.deepEqual(await panel.locator('select option').allTextContents(),['코스피','코스닥']);
        const bars=await page.evaluate(()=>window.barDraws);assert.ok(bars.some(b=>b.color==='#e11d48'));assert.ok(bars.some(b=>b.color==='#2563eb'));
        const layout=await page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('.rank-chart-row>.panel')].map(p=>[p.id,{x:p.offsetLeft,y:p.offsetTop,column:getComputedStyle(p).gridColumnStart,row:getComputedStyle(p).gridRowStart}])));
        assert.equal(layout.rankMarketSupplyChartPanel.column,'3');assert.equal(layout.rankMarketSupplyChartPanel.row,'1');
        assert.equal(layout.rankBreadthChartPanel.column,'1');assert.equal(layout.rankBreadthChartPanel.row,'2');assert.equal(layout.rankTurnoverChartPanel.column,'2');
        assert.equal(layout.rankVolatilityChartPanel.column,'3');assert.equal(layout.rankSentimentChartPanel.row,'3');assert.equal(layout.rankAdrChartPanel.column,'2');
        assert.deepEqual(await panel.locator('[data-series]').evaluateAll(nodes=>nodes.map(n=>n.dataset.series)),['program','foreign','institution','individual']);
        await panel.locator('[data-mode="minute"]').click();await page.waitForFunction(()=>document.querySelector('#rankMarketSupplyChartPanel').dataset.chartMode==='minute');
        assert.deepEqual(await panel.locator('select option').allTextContents(),['코스피','코스닥','코스피 선물','코스닥 선물']);
        await panel.locator('select').selectOption('futures');await page.waitForFunction(()=>document.querySelector('#rankMarketSupplyChartPanel').dataset.market==='futures');
        await page.waitForFunction(()=>document.querySelector('#rankMarketSupplyChartPanel [data-series="program"] output').textContent==='미제공');
        assert.equal(await panel.locator('[data-series="program"]').isDisabled(),true);
        assert.ok(await page.evaluate(()=>window.lineDraws>0));
        await panel.locator('select').selectOption('futuresKosdaq');
        await page.waitForFunction(()=>document.querySelector('#rankMarketSupplyChartPanel').dataset.market==='futuresKosdaq');
        await panel.locator('.concentration-candle-toggle').click();
        assert.equal(await panel.locator('.market-candle-label').textContent(),'코스닥 현물지수');
        assert.equal(await panel.locator('.rank-adr-candle-area canvas').getAttribute('aria-label'),'코스닥 현물지수 캔들차트');
        assert.equal(await panel.locator('[data-series="program"]').isDisabled(),true);

        await page.evaluate(day=>{
            const rows=Array.from({length:50},(_,i)=>({t:Date.parse(`${day}T09:00:00+09:00`)+i*60000}));
            window.marketPeer={start:0,count:null};
            window.drawMarketPeer=()=>{Object.assign(window.marketPeer,window.RankChartAxis.sharedRange('supply',rows,p=>p.t,'minute',window.marketPeer.start,window.marketPeer.count,window.drawMarketPeer));};
            window.drawMarketPeer();
        },day);
        await panel.getByRole('button',{name:'시장 수급 차트 확대',exact:true}).click();
        await page.waitForFunction(()=>window.marketPeer.count===25);
        await panel.locator('input[type="range"]').fill('10000');
        await panel.locator('input[type="range"]').dispatchEvent('input');
        await page.waitForFunction(()=>window.marketPeer.start===25);
        await panel.locator('[data-mode="day"]').click();await page.waitForFunction(()=>document.querySelector('#rankMarketSupplyChartPanel').dataset.chartMode==='day');
        assert.equal(await panel.locator('select').inputValue(),'kosdaq');
        await panel.locator('[data-action="more"]').click();await page.waitForFunction(()=>document.querySelector('#rankMarketSupplyChartPanel .rank-adr-status').textContent.includes('과거 수급 조회 중')===false);
        await page.waitForTimeout(100);assert.ok(calls.some(c=>c.cursor==='opaque:key'));
        fail=true;await page.evaluate(()=>window.refreshRankMarketSupplyChart());
        assert.match(await panel.locator('.rank-adr-status').textContent(),/이전 데이터 표시/);
        fail=false;await page.evaluate(()=>window.refreshRankMarketSupplyChart());
        fs.mkdirSync('dev/output',{recursive:true});await page.screenshot({path:path.resolve('dev/output/market-supply-layout.png'),fullPage:true});await panel.screenshot({path:path.resolve('dev/output/market-supply-card.png')});
        assert.deepEqual(errors,[]);console.log('Market supply browser checks passed: daily bars, minute lines, selector, futures missing program, layout, cursor, error retention.');
    } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
