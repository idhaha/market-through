const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('public/app.js', 'utf8');
const helper = source.slice(source.indexOf('function installEconomicChartWheelZoom('), source.indexOf('function drawTradingEconomicsLineChart('));
const day = 86400000;
for (const type of ['multi-series', 'te-single']) {
    let listener, redraws = 0, syncs = 0;
    const context = { drawMultiSeriesLineChart: () => redraws++, drawTradingEconomicsLineChart: () => redraws++, syncZoomToOtherCharts: () => syncs++ };
    vm.createContext(context); vm.runInContext(helper, context);
    const canvas = { clientHeight: 300, chartData: { padding: { left: 10, top: 20, bottom: 40 }, chartW: 400, minDate: new Date(0), maxDate: new Date(100 * day), originalMinDate: new Date(0), originalMaxDate: new Date(100 * day), allSeries: [], originalData: [] }, getBoundingClientRect: () => ({ left: 0, top: 0 }), getAttribute: () => type, addEventListener: (name, handler) => { assert.equal(name, 'wheel'); listener = handler; } };
    context.installEconomicChartWheelZoom(canvas);
    const scroll = deltaY => listener({ clientX: 110, clientY: 100, deltaY, preventDefault() {} });
    scroll(-100);
    assert.equal(+canvas.zoomState.minDate, 5 * day);
    assert.equal(+canvas.zoomState.maxDate, 85 * day);
    assert.equal(+canvas.zoomState.minDate + .25 * (canvas.zoomState.maxDate - canvas.zoomState.minDate), 25 * day);
    canvas.chartData.minDate = canvas.zoomState.minDate; canvas.chartData.maxDate = canvas.zoomState.maxDate;
    scroll(100); assert.equal(canvas.zoomState.active, false);
    assert.equal(redraws, 2); assert.equal(syncs, 2);
}
console.log('PASS economic chart wheel anchor, zoom out bounds and synchronized redraw');
