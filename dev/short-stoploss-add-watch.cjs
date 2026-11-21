'use strict';
// 대주 StopLoss 시험용 감시 건 등록(2026-11-20): 로그인 없이 화면을 쓸 수 없는 에이전트 시험용.
// 로컬 서버를 멈춘 상태에서 data/short-stoploss/state.json에 감시 건을 넣고 서버를 다시 띄운다(dev/restart-local-server.cjs).
// 사용: node dev/short-stoploss-add-watch.cjs --code 004980 --ticks-above 3 --shares 1 [--no-cancel-pending]
//  - 대주 잔고에서 그 종목의 대출일 행을 찾고, 기준가 = 현재가(KRX) + N틱으로 정한다. 실제 화면 등록과 같은 검증(validate)을 거친다.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('node:fs'), path = require('node:path'), axios = require('axios');
const { execFileSync } = require('node:child_process');
const { createShortStopLoss, addTicks } = require('../short-stoploss-service');
const root = path.join(__dirname, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const code = arg('code'), above = Number(arg('ticks-above', 3)), shares = Number(arg('shares', 1));
if (!/^[0-9A-Z]{6}$/.test(code || '')) { console.error('--code 필요'); process.exit(2); }
(async () => {
    const token = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kiwoom-token', 'token.json'), 'utf8')).token;
    const dir = path.join(root, 'data', 'short-stoploss');
    // 서버를 멈추고(파일을 서버가 덮어쓰지 않게) 같은 저장소에 등록한 뒤 다시 띄운다.
    const pids = execFileSync('powershell.exe', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'server\\.js' -and $_.CommandLine -notmatch 'restart' }).ProcessId"], { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
    for (const pid of pids) try { execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' }); } catch {}
    const s = createShortStopLoss({ directory: dir, http: axios, getToken: async () => token, enabled: () => false });
    await s.loadLots();
    const lot = s.snapshot().lots.filter(l => l.code === code && l.able >= shares).sort((a, b) => b.able - a.able)[0];
    if (!lot) { console.error('대주 잔고에 그 종목(가능수량 ' + shares + '주 이상)이 없습니다'); }
    else {
        const trigger = addTicks(lot.price, above);
        const w = await s.create({ lotKey: lot.key, trigger, ticks: 10, upperLimit: false, fix: true, chasePct: 10, qtyMode: 'shares', qtyValue: shares, allLots: false, cancelPending: !process.argv.includes('--no-cancel-pending') });
        console.log('등록:', JSON.stringify({ id: w.id, name: w.name, loanDt: w.loanDt, 현재가: lot.price, 기준가: w.trigger, 수량: shares, until: w.until }));
    }
    s.stop();
    execFileSync(process.execPath, [path.join(__dirname, 'restart-local-server.cjs'), '--log', path.join('outputs', 'scheduled', 'restart-' + new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, '') + '-short-stoploss.log')], { cwd: root, stdio: 'inherit' });
})().catch(e => { console.error(e); process.exit(1); });
