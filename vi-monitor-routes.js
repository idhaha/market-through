'use strict';
const crypto=require('node:crypto');
// The native app only accepts '#token=<hex>' URLs, so the main browser's zoom travels through the server stream.
const windowRoutes=new Set(['GET /vi-monitor/stream','POST /vi-monitor/flash-dismiss','GET /vi-monitor/history','GET /vi-monitor/chart','POST /vi-monitor/record-filter']);
const validScale=v=>{const n=Number(v);return n>=0.25&&n<=8?n:null;};
function createViWindowAccess({session,now=Date.now}) {
    const grants=new Map();
    const handles=req=>windowRoutes.has(req.method+' '+req.path)&&!!req.headers['x-vi-token'];
    function authorize(req,res,next) {
        if(!handles(req))return next();
        const token=req.headers['x-vi-token'],grant=grants.get(token);
        const user=grant&&grant.expiresAt>now()&&session({headers:{cookie:grant.cookie}});
        if(!user){grants.delete(token);return res.status(401).json({error:'VI 독립창 연결 만료'});}
        grant.connected=true;req.authUser=user;req.viAuthorized=true;next();
    }
    function mount(app,service) {
        app.post('/api/vi-monitor/window',(req,res)=>{
            for(const [key,g]of grants)if(g.expiresAt<=now())grants.delete(key);
            if(grants.size>=1000)return res.status(429).json({error:'VI 독립창 연결 한도'});
            const token=crypto.randomBytes(32).toString('hex');
            grants.set(token,{cookie:req.headers.cookie,expiresAt:now()+86400000,email:req.authUser.email,connected:false,scale:validScale(req.body?.scale),streams:new Set()});
            service.start();res.set('Cache-Control','no-store').json({token});
        });
        app.post('/api/vi-monitor/window-status',(req,res)=>{
            const g=grants.get(req.body?.token);res.set('Cache-Control','no-store').json({connected:!!g&&g.email===req.authUser.email&&g.expiresAt>now()&&g.connected});
        });
        // The main page reports zoom changes; open VI windows of that grant follow immediately.
        app.post('/api/vi-monitor/window-scale',(req,res)=>{
            const g=grants.get(req.body?.token),scale=validScale(req.body?.scale);
            if(!g||g.email!==req.authUser.email||g.expiresAt<=now())return res.status(404).json({error:'VI 독립창 없음'});
            if(scale==null)return res.status(400).json({error:'잘못된 배율'});
            g.scale=scale;for(const send of g.streams)send(scale);
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
