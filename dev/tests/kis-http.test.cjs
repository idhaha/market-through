const {test}=require('node:test'),assert=require('node:assert/strict');
const {createKisHttp}=require('../../kis-http');
test('shared KIS gate serializes independent callers, cools down errors and passes other URLs through',async()=>{
 const events=[];let release;
 const http=createKisHttp({pause:async ms=>events.push('wait:'+ms),http:{get:async url=>{events.push(url);if(url.endsWith('one'))return new Promise(r=>release=r);if(url.endsWith('bad'))throw new Error('offline');return url;}}});
 const one=http.get('https://openapi.test/uapi/one');const two=http.get('https://openapi.test/uapi/two');
 await new Promise(r=>setImmediate(r));assert.deepEqual(events,['https://openapi.test/uapi/one']);release('first');await Promise.all([one,two]);
 assert.deepEqual(events,['https://openapi.test/uapi/one','wait:550','https://openapi.test/uapi/two','wait:550']);
 await assert.rejects(http.get('https://openapi.test/uapi/bad'));await http.get('https://openapivts.test/uapi/good');
 assert.ok(events.includes('wait:550'));await http.get('https://master.test/file.zip');assert.equal(events.at(-1),'https://master.test/file.zip');
});
