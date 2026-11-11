'use strict';
// 오라클에 저장된 VI 괴리율 기록(data/vi-monitor/gap-records/날짜.jsonl)을 로컬 outputs/vi-gap-records/로 복사한다(2026-11-09).
// 매일 저녁 Windows 작업 스케줄러(MarketThrough-daily-vi-gap-pull)가 실행한다. 오라클 파일은 읽기만 하고 지우지 않는다.
// 로컬에 없거나 크기가 다른 파일만 받는다(당일 파일은 저녁까지 늘어나므로 다시 받음). 결과는 outputs/scheduled/vi-gap-pull.log에 한 줄씩 남긴다.
// 사용: node dev/pull-vi-gap-records.cjs [--days 14]
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const HOST = 'ubuntu@134.185.111.202', REMOTE = 'market-through/data/vi-monitor/gap-records';
const target = path.join(root, 'outputs', 'vi-gap-records'), logFile = path.join(root, 'outputs', 'scheduled', 'vi-gap-pull.log');
const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 14;
const kst = t => new Date(t + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
const log = line => { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, `[${kst(Date.now())}] ${line}\n`); console.log(line); };
const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20'];
try {
    // name and size of each remote file (none yet is normal before the first flagged VI).
    const listing = execFileSync('ssh', [...ssh, HOST, `cd ${REMOTE} 2>/dev/null && for f in *.jsonl; do [ -f "$f" ] && echo "$f $(stat -c %s "$f")"; done; true`], { encoding: 'utf8', timeout: 60000 });
    const remote = listing.split('\n').map(l => l.trim().split(' ')).filter(([name, size]) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name || '') && /^\d+$/.test(size || ''));
    const since = new Date(Date.now() + 9 * 3600000 - days * 86400000).toISOString().slice(0, 10);
    fs.mkdirSync(target, { recursive: true });
    let copied = 0, same = 0;
    for (const [name, size] of remote) {
        if (name.slice(0, 10) < since) continue;
        const local = path.join(target, name);
        if (fs.existsSync(local) && fs.statSync(local).size === Number(size)) { same++; continue; }
        execFileSync('scp', [...ssh, '-q', `${HOST}:${REMOTE}/${name}`, local + '.part'], { timeout: 120000 });
        if (fs.statSync(local + '.part').size !== Number(size)) throw new Error(`${name} 크기 불일치`);
        fs.renameSync(local + '.part', local); copied++;
    }
    log(`완료 · 오라클 ${remote.length}개 파일 중 최근 ${days}일 · 새로 받음 ${copied} · 이미 같음 ${same} · 저장 위치 outputs/vi-gap-records`);
} catch (error) {
    log('실패 · ' + String(error.message || error).split('\n')[0].slice(0, 200));
    process.exitCode = 1;
}
