const fs = require('fs');
const path = require('path');

const koreaDay = t => new Date(t + 9 * 3600000).toISOString().slice(0, 10);

function createAdrMinuteStore({ directory, now = Date.now }) {
    const states = new Map();
    const validMarket = market => {
        if (!['kospi', 'kosdaq'].includes(market)) throw new Error('Invalid ADR market');
    };
    const normalize = point => {
        if (!point || point.adr == null || !Number.isFinite(Number(point.adr))) return null;
        let t = Number(point.t);
        if (t < 1e12) t *= 1000;
        if (!Number.isFinite(t) || t <= 0 || t > now()) return null;
        t = Math.floor(t / 60000) * 60000;
        const clock = new Date(t + 9 * 3600000);
        const minute = clock.getUTCHours() * 60 + clock.getUTCMinutes();
        if (minute < 540 || minute > 930 || [0, 6].includes(clock.getUTCDay())) return null;
        return { t, adr: Number(point.adr) };
    };
    const latestSession = points => {
        const normalized = points.map(normalize).filter(Boolean).sort((a, b) => a.t - b.t);
        const day = normalized.length ? koreaDay(normalized.at(-1).t) : null;
        return { day, points: [...new Map(normalized.filter(point => koreaDay(point.t) === day).map(point => [point.t, point])).values()] };
    };
    const read = market => {
        validMarket(market);
        if (!states.has(market)) {
            let state = { day: null, points: [] };
            const filename = path.join(directory, `${market}.json`);
            try {
                const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
                state = latestSession(Array.isArray(saved.points) ? saved.points : []);
            } catch (error) {
                if (error.code !== 'ENOENT') console.warn('[ADR] Could not read minute archive:', error.message);
            }
            states.set(market, state);
        }
        const state = states.get(market);
        return { day: state.day, points: state.points.map(point => ({ ...point })) };
    };
    const merge = (market, data) => {
        const previous = read(market);
        const incoming = Array.isArray(data.intraday) ? [...data.intraday] : [];
        if (data.adr != null && data.asOf != null) incoming.push({ t: data.asOf, adr: data.adr });
        const next = latestSession([...previous.points, ...incoming]);
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
            fs.mkdirSync(directory, { recursive: true });
            const filename = path.join(directory, `${market}.json`);
            const temporary = `${filename}.${process.pid}.tmp`;
            try {
                fs.writeFileSync(temporary, JSON.stringify(next), 'utf8');
                fs.renameSync(temporary, filename);
            } finally {
                if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
            }
            states.set(market, next);
        }
        return read(market);
    };
    return { read, merge };
}

module.exports = { createAdrMinuteStore };
