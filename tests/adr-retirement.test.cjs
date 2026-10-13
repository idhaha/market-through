const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/app.js', 'utf8');
const start = source.indexOf('function removeRetiredAdrState(data)');
const end = source.indexOf('function applyData(data)', start);
const context = { PERM_TAB_ID: 'tab_rank' };
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
test('legacy ADR backup is retired without changing other settings or input', () => {
 const input = { tabs: [{id:'tab_rank'}, {id:'tab_adr'}, {id:'custom'}], contents: {tab_adr:{adr:{}}, custom:{symbol:'A'}}, activeTabId:'tab_adr', adrInterval:'5', rankInterval:'2', memoHtml:'memo' };
 const before = JSON.stringify(input);
 const output = JSON.parse(JSON.stringify(context.removeRetiredAdrState(input)));
 assert.deepEqual(output, {tabs:[{id:'tab_rank'},{id:'custom'}],contents:{custom:{symbol:'A'}},activeTabId:'tab_rank',rankInterval:'2',memoHtml:'memo'});
 assert.equal(JSON.stringify(input),before);
 const clean={tabs:[],activeTabId:'custom'};
 assert.deepEqual(JSON.parse(JSON.stringify(context.removeRetiredAdrState(clean))),clean);
 assert.equal(context.removeRetiredAdrState(null),null);
});
test('both restoration paths normalize retired settings and Rank APIs remain', () => {
 for (const name of ['applyData', 'applyFullStateBackup']) assert.ok(source.includes('function '+name+'(data) {\n    data = removeRetiredAdrState(data);'));
 assert.ok(!source.includes('ADR_TAB_ID'));
 assert.ok(!source.includes('updateAdrFromSource'));
 const server=fs.readFileSync('server.js','utf8');
 assert.ok(!server.includes("app.get('/api/adr',"));
 for (const path of ['today','history','candles']) assert.ok(server.includes("app.get('/api/adr/"+path+"',"));
});
