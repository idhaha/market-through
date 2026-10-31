const {dayKey}=require('./supply-store');
const {quantity,timestamp}=require('./supply-service');
const markets={futures:{code:'FUTURE',asset:'K2I'},futuresKosdaq:{code:'FUTKQ0',asset:'KQI'}};
const fields={individual:'indmsamt',foreign:'formsamt',institution:'sysmsamt'};
function nightTime(t){const s=new Date(t+9*3600000).toISOString().slice(11,16);return s>='18:00'||s<='06:01';}
function active(t){
    const policy=require('./trading-session').current();if(policy)return policy.nightAt(t);
    const d=new Date(t+9*3600000),h=d.getUTCHours()*60+d.getUTCMinutes();
    const start=new Date(t+9*3600000-(h<=363?86400000:0));
    return (h>=1080||h<=363)&&![0,6].includes(start.getUTCDay());
}
function createLsNightSupply({store,rest,now=Date.now,onUpdate=()=>{},log=()=>{}}){
    let running,timer;const recovered=new Map();
    function ingest(code,rows){
        const cfg=markets[code];if(!cfg)return 0;
        const oldByDay=new Map(),byMinute=new Map();
        for(const row of rows.slice().sort((a,b)=>(a.observed_at||a.t)-(b.observed_at||b.t))){
            const at=row.observed_at || row.t,t=Math.floor(at/60000)*60000;
            if(!Number.isFinite(at)||!Number.isFinite(t)||t<=0||t>=Math.floor(now()/60000)*60000||!nightTime(t))continue;
            if(!oldByDay.has(dayKey(t)))oldByDay.set(dayKey(t),new Map(store.points(cfg.code,dayKey(t)).map(p=>[p.t,p])));
            const old=byMinute.get(t)||oldByDay.get(dayKey(t)).get(t)||{};
            const point={t,source:'LS',session:'N'};let changed=false;
            for(const field of Object.keys(fields))if(Number.isSafeInteger(row[field]) && (!Number.isFinite(old[field+'_at'])||at>=old[field+'_at'])){
                point[field]=row[field];point[field+'_at']=at;
                if(old[field]!==row[field]||old[field+'_at']!==at||old.source!=='LS')changed=true;
            }
            if(changed)byMinute.set(t,{...old,...point});
        }
        if(byMinute.size){store.mergeMany(cfg.code,[...byMinute.values()]);onUpdate();}
        return byMinute.size;
    }
    async function collect({recover=false}={}){
        if(running)return running;
        running=(async()=>{
            const result=[];
            for(const [code,cfg] of Object.entries(markets))for(const bgubun of recover?['0','1']:['0']){
                const key=code+':'+dayKey(now())+':'+bgubun;
                if(bgubun==='1' && recovered.has(key))continue;
                try{
                    const d=await rest('t8463','investor',{tm_rng:'N',fot_clsf_cd:'F',bsc_asts_id:cfg.asset,cnt:999,bgubun});
                    if(!Array.isArray(d.t8463OutBlock1))throw Error('LS night response format');
                    const rows=[];
                    for(const r of d.t8463OutBlock1){
                        if(!/^\d{8}$/.test(String(r.date))||!/^([01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(String(r.time)))continue;
                        const at=timestamp(String(r.date),String(r.time));
                        if(!Number.isFinite(at)||dayKey(at).replaceAll('-','')!==r.date||at>now()||at<now()-10*86400000)continue;
                        const p={t:Math.floor(at/60000)*60000,observed_at:at};
                        for(const [field,input]of Object.entries(fields)){const n=quantity(r[input]);if(n!==null&&Number.isSafeInteger(n*100))p[field]=n*100;}
                        rows.push(p);
                    }
                    result.push({code,bgubun,saved:ingest(code,rows)});
                    if(bgubun==='1'){recovered.set(key,true);while(recovered.size>16)recovered.delete(recovered.keys().next().value);}
                }catch{result.push({code,bgubun,error:'LS 야간 수급 수집 실패'});log('[LS night] collection failed');}
            }
            return result;
        })().finally(()=>{running=null;});return running;
    }
    function start(){
        if(timer)return;
        if(!require('./trading-session').current() || active(now()))void collect({recover:true});
        timer=setInterval(()=>{if(active(now()))void collect({recover:true});},60000);timer.unref?.();
    }
    return {ingest,collect,start,stop(){clearInterval(timer);timer=null;}};
}
module.exports={createLsNightSupply,active};
