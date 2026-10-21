const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const routes = [];
let upstream;
vm.runInNewContext(source.slice(source.indexOf("app.get(['/api/toss_calendar'"), source.indexOf("app.get('/api/risk/volatility'")), {
    app: { get: (route, handler) => routes.push({ route, handler }), all() {} },
    axios: { get: async () => upstream },
    URL, Buffer, console
});

async function request(route, body) {
    upstream = { status: 200, data: body, headers: { 'content-type': 'application/javascript' } };
    const headers = {};
    const res = {
        setHeader: (key, value) => { headers[key] = value; }, removeHeader() {},
        status(code) { assert.equal(code, 200); return this; },
        send(value) { this.body = value; }
    };
    const req = { path: '/calendar', originalUrl: route, protocol: 'http', get: name => name === 'host' ? 'localhost:3000' : undefined };
    const handler = routes.find(item => Array.isArray(item.route) ? item.route.includes(route) : typeof item.route !== 'string' && item.route.test(route));
    assert.ok(handler, `Missing route: ${route}`);
    await handler.handler(req, res);
    return res.body;
}

test('calendar HTML and bootstrap relay both v2 and v3 chunks', async () => {
    for (const version of ['v2', 'v3']) {
        const asset = `/assets/${version}/_next/static/chunks/pages/calendar-test.js`;
        const html = await request('/calendar', `<html><head></head><script src="${asset}"></script></html>`);
        assert.ok(html.includes(`src="http://localhost:3000${asset}"`));
        const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)[1];
        new vm.Script(bootstrap);
        assert.ok(bootstrap.includes('v\\d+'));
    }
});

test('monthly and renamed weekly summary queries use the authenticated same-origin proxy', async () => {
    for (const [version, endpoint, hook] of [['v2', 'nD', 'nw'], ['v3', 'nw', 'nD']]) {
        const script = `let ei=()=>{let{category:e}={};let r=[],i=(0,j.E)({queries:r}),s=i.map(e=>e.data);return {queryFn:()=>X.FH.post(\`\${J.Q.CERT}\${er(t,n)}\`),refetchOnWindowFocus:false}};let ${hook}=()=>({queryFn:()=>X.FH.get(\`\${J.Q.CERT}\${${endpoint}}\`),...nk.us});${hook}.getKey=()=>[];`;
        const result = await request(`/assets/${version}/_next/static/chunks/pages/calendar-test.js`, Buffer.from(script));
        new vm.Script(result);
        assert.ok(result.includes('monthly proxy request'));
        assert.ok(result.includes('weekly AI summary request'));
        assert.ok(result.includes(`const targetUrl=\`\${J.Q.CERT}\${${endpoint}}\``));
        assert.ok(result.includes(`${hook}.getKey`));
    }
});

test('one country click updates state directly, including nested label clicks', async () => {
    for (const scroll of ['d', 'o']) {
        const original = `onValueChange:e=>{r(e),requestAnimationFrame(()=>{${scroll}(s)})},children:Object.entries(Q.TP)`;
        const result = await request('/assets/v3/_next/static/chunks/pages/calendar-test.js', Buffer.from(`({${original}})`));
        let selected = 'all', updates = 0, scrolls = 0;
        const control = vm.runInNewContext(result, {
            r: value => { selected = value; updates++; },
            [scroll]: () => { scrolls++; }, s: '2026-10',
            requestAnimationFrame: fn => fn(), Q: { TP: {} }
        });
        assert.equal(typeof control.customProps.root.onClickCapture, 'function');
        for (const value of ['kr', 'us', 'all']) {
            const button = { value, disabled: false, getAttribute: () => selected === value ? 'true' : 'false' };
            let stopped = false;
            const event = {
                target: { closest: () => button }, currentTarget: { contains: () => true },
                preventDefault() {}, stopPropagation() { stopped = true; }
            };
            control.customProps.root.onClickCapture(event);
            assert.equal(selected, value);
            assert.equal(stopped, true);
            const count = updates;
            control.customProps.root.onClickCapture(event);
            assert.equal(updates, count, 'selected country must not dispatch twice');
        }
        assert.equal(updates, 3);
        assert.equal(scrolls, 3);
        control.onValueChange('kr');
        assert.equal(selected, 'kr', 'keyboard navigation still uses onValueChange');
    }
});
