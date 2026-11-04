'use strict';
// Receive intervals use a monotonic clock; upstream HHMMSS is only second precision.
function createQuoteCadence() {
    const channels = new Map();
    function receive(tr, body, at) {
        if (!['S3_', 'K3_', 'NS3', 'JC0'].includes(tr) || !body || !/^\d{6}$/.test(String(body.chetime || '')) || !(Number(body.price) > 0)) return false;
        const code = String(body.futcode || body.ex_shcode || body.shcode || '').trim();
        if (!code) return false;
        const key = `${tr}:${code}`;
        let s = channels.get(key);
        if (!s) { s = { tr, code, messages:0, changes:0, intervals:[], first:at, last:null, price:null, clock:null, sameSecond:0 }; channels.set(key,s); }
        if (s.last !== null && at >= s.last) s.intervals.push(at-s.last);
        if (s.price !== null && Number(body.price) !== s.price) s.changes++;
        if (s.clock === body.chetime) s.sameSecond++;
        s.price = Number(body.price); s.clock = body.chetime; s.last = at; s.messages++;
        return true;
    }
    function snapshot() {
        return [...channels.values()].map(s=>{
            const intervals = [...s.intervals].sort((a,b)=>a-b);
            const percentile = p => intervals.length ? intervals[Math.max(0,Math.ceil(intervals.length*p)-1)] : null;
            return { tr:s.tr, code:s.code, messages:s.messages, priceChanges:s.changes, sameSecondMessages:s.sameSecond,
                firstReceiveMs:s.first, lastReceiveMs:s.last, meanMs:intervals.length?intervals.reduce((a,b)=>a+b,0)/intervals.length:null,
                medianMs:percentile(.5), p95Ms:percentile(.95), maxMs:percentile(1), minMs:percentile(0),
                messagesPerSecond:s.last>s.first?(s.messages-1)*1000/(s.last-s.first):null };
        });
    }
    return { receive, snapshot };
}
module.exports = { createQuoteCadence };
