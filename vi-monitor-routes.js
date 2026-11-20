'use strict';
const crypto=require('node:crypto');
// The native app only accepts '#token=<hex>' URLs, so the main browser's zoom travels through the server stream.
const windowRoutes=new Set(['GET /vi-monitor/stream','POST /vi-monitor/flash-dismiss','GET /vi-monitor/history','GET /vi-monitor/chart','POST /vi-monitor/record-filter']);
const validScale=v=>{const n=Number(v);return n>=0.25&&n<=8?n:null;};
// 2026-11-20: 창 주소(#token=)의 값은 '여는 토큰'이다. 앱 실행 인자로 PC 안에 남으므로 5분 안에 한 번만 '창 토큰'으로 바꿔 주고
// (POST /api/vi-monitor/window-exchange, X-VI-Launch), VI 자료는 창 토큰(X-VI-Token)으로만 받는다. 메인 화면은 여는 토큰으로 상태 · 배율을 보고한다.
const LAUNCH_MS=5*60000;
function createViWindowAccess({session,now=Date.now}) {
    const grants=new Map(),launches=new Map();
    const exchangeRoute='POST /vi-monitor/window-exchange';
    const handles=req=>(req.method+' '+req.path===exchangeRoute&&!!req.headers['x-vi-launch'])||(windowRoutes.has(req.method+' '+req.path)&&!!req.headers['x-vi-token']);
    function authorize(req,res,next) {
        if(!handles(req))return next();
        if(req.method+' '+req.path===exchangeRoute){
            const launch=launches.get(String(req.headers['x-vi-launch']));
            if(!launch||launch.used||launch.openBy<=now()||!session({headers:{cookie:launch.cookie}}))
                return res.status(401).json({error:launch?.used?'이미 쓴 연결입니다. 메인 화면에서 VI 독립창을 다시 열어주세요.':launch&&launch.openBy<=now()?'창이 늦게 열려 연결 시간(5분)이 지났습니다. 메인 화면에서 VI 독립창을 다시 열어주세요.':'VI 독립창 연결 만료'});
            const token=crypto.randomBytes(32).toString('hex');
            grants.set(token,{cookie:launch.cookie,expiresAt:launch.expiresAt,email:launch.email,connected:true,scale:launch.scale,streams:new Set()});
            launch.used=true;launch.grant=token;
            return res.set('Cache-Control','no-store').json({token});
        }
        const token=req.headers['x-vi-token'],grant=grants.get(token);
        const user=grant&&grant.expiresAt>now()&&session({headers:{cookie:grant.cookie}});
        if(!user){grants.delete(token);return res.status(401).json({error:'VI 독립창 연결 만료'});}
        grant.connected=true;req.authUser=user;req.viAuthorized=true;next();
    }
    function mount(app,service) {
        app.post('/api/vi-monitor/window',(req,res)=>{
            for(const m of [grants,launches])for(const [key,g]of m)if(g.expiresAt<=now())m.delete(key);
            if(grants.size>=1000||launches.size>=1000)return res.status(429).json({error:'VI 독립창 연결 한도'});
            const token=crypto.randomBytes(32).toString('hex');
            launches.set(token,{cookie:req.headers.cookie,openBy:now()+LAUNCH_MS,expiresAt:now()+86400000,email:req.authUser.email,scale:validScale(req.body?.scale),used:false,grant:''});
            service.start();res.set('Cache-Control','no-store').json({token});
        });
        // 메인 화면은 여는 토큰만 안다: 그 토큰으로 바꿔 준 창 토큰을 찾는다
        const launchOf=req=>{const l=launches.get(req.body?.token);return l&&l.email===req.authUser.email&&l.expiresAt>now()?l:null;};
        app.post('/api/vi-monitor/window-status',(req,res)=>{
            const l=launchOf(req),g=l&&grants.get(l.grant);res.set('Cache-Control','no-store').json({connected:!!g&&g.expiresAt>now()&&g.connected});
        });
        // The main page reports zoom changes; open VI windows of that grant follow immediately.
        app.post('/api/vi-monitor/window-scale',(req,res)=>{
            const l=launchOf(req),scale=validScale(req.body?.scale);
            if(!l)return res.status(404).json({error:'VI 독립창 없음'});
            if(scale==null)return res.status(400).json({error:'잘못된 배율'});
            l.scale=scale;const g=grants.get(l.grant);if(g){g.scale=scale;for(const send of g.streams)send(scale);}
            res.set('Cache-Control','no-store').json({ok:true});
        });
        app.post('/api/vi-monitor/flash-dismiss',(req,res)=>{
            const {code,exchange,startedAt}=req.body||{};
            if(!/^[0-9A-Z]{6}$/.test(String(code))||!['KRX','NXT'].includes(exchange)||!Number.isFinite(startedAt))return res.status(400).json({error:'잘못된 요청'});
            res.set('Cache-Control','no-store').json({ok:service.dismissFlash(code,exchange,startedAt)});
        });
        // 날짜별 VI 창 기록(2026-11-14): 남은 날짜 목록과, date를 주면 그날 행(해제 때 값으로 고정된 화면 값).
        app.get('/api/vi-monitor/history',(req,res)=>{
            const date=String(req.query.date||'');
            if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'잘못된 날짜'});
            const saved=date?service.archivedDay(date):null;
            if(date&&!saved)return res.status(404).set('Cache-Control','no-store').json({error:'그날 VI 기록이 없습니다',days:service.archivedDays()});
            res.set('Cache-Control','no-store').json({days:service.archivedDays(),...(saved?{day:saved.day,rows:saved.rows,restored:saved.restored||null}:{})});
        });
        // 행 분석 차트(2026-11-14): key = 행 키, startedAt = 발동 시각(ms), day = 날짜(없으면 오늘).
        app.get('/api/vi-monitor/chart',async(req,res)=>{
            const key=String(req.query.key||''),startedAt=Number(req.query.startedAt),day=req.query.day?String(req.query.day):undefined;
            if(!/^[0-9A-Z]{6}:(KRX|NXT|FUT)(:[A-Z0-9]{8}(:(up|down)\d)?)?$/.test(key)||!Number.isFinite(startedAt)||day&&!/^\d{4}-\d{2}-\d{2}$/.test(day))return res.status(400).json({error:'잘못된 요청'});
            try{res.set('Cache-Control','no-store').json(await service.chartData({key,startedAt,...(day?{day}:{})}));}
            catch(error){res.status(error.status||502).set('Cache-Control','no-store').json({error:error.status?error.message:'차트 자료를 받지 못했습니다'});}
        });
        // 차트 기록 설정(2026-11-14): VI 창의 거래대금(전일기준) · 시가총액 드롭다운 값. 이 설정을 만족하는 행만 해제 + 1분 뒤 차트를 기록한다.
        app.post('/api/vi-monitor/record-filter',(req,res)=>{
            const prevAmount=Number(req.body?.prevAmount),marketCap=Number(req.body?.marketCap);
            if(!Number.isFinite(prevAmount)||!Number.isFinite(marketCap)||prevAmount<0||marketCap<0)return res.status(400).json({error:'잘못된 요청'});
            res.set('Cache-Control','no-store').json(service.setRecordFilter({prevAmount,marketCap}));
        });
        app.get('/api/vi-monitor/stream',(req,res)=>{
            service.start();res.set({'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
            let pending,timer,closed=false;
            const flush=()=>{timer=null;if(!closed&&pending){res.write('data: '+JSON.stringify(pending)+'\n\n');pending=null;}};
            const grant=req.viAuthorized&&grants.get(req.headers['x-vi-token']);
            const sendScale=scale=>{if(!closed)res.write('event: scale\ndata: '+JSON.stringify({scale})+'\n\n');};
            if(grant){grant.streams.add(sendScale);if(grant.scale)sendScale(grant.scale);}
            const unsubscribe=service.subscribe(snapshot=>{pending=snapshot;if(!timer)timer=setTimeout(flush,100);});
            const heartbeat=setInterval(()=>{
                // Validate the underlying login for long-lived streams as well.
                const g=req.viAuthorized&&grants.get(req.headers['x-vi-token']);
                if(req.viAuthorized&&(!g||g.expiresAt<=now()||!session({headers:{cookie:g.cookie}}))){res.end();return;}
                res.write(': heartbeat\n\n');
            },15000);heartbeat.unref?.();
            req.on('close',()=>{closed=true;grant?.streams.delete(sendScale);unsubscribe();clearTimeout(timer);clearInterval(heartbeat);});
        });
    }
    return {authorize,mount,handles};
}
module.exports={createViWindowAccess};
