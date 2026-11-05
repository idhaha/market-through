const fs=require('fs'),path=require('path');
const day=t=>new Date(t+9*3600000).toISOString().slice(0,10);
const dateTime=d=>Date.parse(d+'T00:00:00+09:00');
let installed=null;
function install(policy){installed=policy;}
function current(){return installed;}
function createTradingSession({directory,loadCalendar,now=Date.now}){
    const file=path.join(directory,'calendar.json');let saved={days:{},checkedDay:'',validatedDay:''},pending,timer,lastFailure=0;
    try{const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.days && typeof value.days==='object')saved=value;}catch{}
    function openDate(date){
        if([0,6].includes(new Date(dateTime(date)+9*3600000).getUTCDay()))return false;
        return typeof saved.days[date]==='boolean'?saved.days[date]:null;
    }
    function nightDay(t){const m=new Date(t+9*3600000).getUTCHours()*60+new Date(t+9*3600000).getUTCMinutes();return day(t-(m<360?86400000:0));}
    const fresh=()=>saved.validatedDay===day(now());
    function spotAt(t=now()){const d=new Date(t+9*3600000),m=d.getUTCHours()*60+d.getUTCMinutes();return fresh() && m>=480 && m<1200 && openDate(day(t))===true;}
    function nightAt(t=now()){
        const d=new Date(t+9*3600000),m=d.getUTCHours()*60+d.getUTCMinutes();
        if(!fresh() || m>=360 && m<1080)return false;
        const date=nightDay(t);return openDate(date)===true;
    }
    function futuresAt(t=now()){const d=new Date(t+9*3600000),m=d.getUTCHours()*60+d.getUTCMinutes();return fresh() && m>=525 && m<945 && openDate(day(t))===true || nightAt(t);}
    // Latest session end at or before now (ms), so clients can tell whether a saved
    // response predates it. Futures close twice: day 15:45 and night 06:00 next day.
    // Uses saved calendar days even when today is not yet validated (weekends skip validation);
    // past open days are settled, and a wrong guess only costs or skips one refetch.
    function closedAt(t=now()){
        let spot=null,futures=null;
        for(let i=0;i<=14;i++){
            const date=day(t-i*86400000);if(openDate(date)!==true)continue;
            const base=dateTime(date),ends={spot:[base+1200*60000],futures:[base+945*60000,base+1800*60000]};
            for(const v of ends.spot)if(v<=t&&(spot===null||v>spot))spot=v;
            for(const v of ends.futures)if(v<=t&&(futures===null||v>futures))futures=v;
            if(spot!==null&&futures!==null&&i>0)break;
        }
        return {spot,futures};
    }
    function snapshot(){return {date:day(now()),spot:spotAt(),futures:futuresAt(),night:nightAt(),closedAt:closedAt(),calendarKnown:openDate(day(now()))===false || fresh() && openDate(day(now()))!==null,checkedDay:saved.checkedDay,calendarFresh:fresh(),days:{...saved.days}};}
    function persist(){fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(saved));fs.renameSync(file+'.tmp',file);}
    function merge(rows){
        if(!Array.isArray(rows))throw Error('Invalid market calendar');
        for(const r of rows){const raw=String(r.bass_dt||'');if(/^\d{8}$/.test(raw)&&['Y','N'].includes(r.opnd_yn))saved.days[`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`]=r.opnd_yn==='Y';}
    }
    const rangeJobs=new Map();
    async function calendarRange(from,to){
        const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(dateTime(d)) && day(dateTime(d))===d;
        if(!valid(from)||!valid(to)||from>to||dateTime(to)-dateTime(from)>3660*86400000)throw Object.assign(Error('Invalid calendar range'),{status:400});
        const jobs=[];
        for(let t=dateTime(from);t<=dateTime(to);t+=28*86400000){
            const end=Math.min(t+27*86400000,dateTime(to));let missing=false;
            for(let at=t;at<=end;at+=86400000)if(openDate(day(at))===null){missing=true;break;}
            if(!missing)continue;
            const key=day(t),old=rangeJobs.get(key);
            if(old && now()-old.at<6*3600000){jobs.push(old.promise);continue;}
            const entry={at:now(),promise:null};
            entry.promise=Promise.resolve().then(()=>loadCalendar(key.replaceAll('-',''))).then(rows=>{merge(rows);persist();}).catch(()=>{entry.at=now()-6*3600000+15*60000;});
            rangeJobs.set(key,entry);jobs.push(entry.promise);
        }
        await Promise.all(jobs);
        return {days:Object.fromEntries(Object.entries(saved.days).filter(([date])=>date>=from&&date<=to))};
    }
    async function refresh(){
        if(pending)return pending;
        const today=day(now());if(fresh() || lastFailure && now()-lastFailure<15*60000)return snapshot();
        const weekday=new Date(now()+9*3600000).getUTCDay(),hour=new Date(now()+9*3600000).getUTCHours();
        if((weekday===0 || weekday===6 && hour>=6))return snapshot();
        saved.checkedDay=today;
        pending=(async()=>{
            try{
                const rows=await loadCalendar(day(now()-86400000).replaceAll('-',''));
                merge(rows);
                if(openDate(today)===null)throw Error();
                saved.validatedDay=today;lastFailure=0;
                persist();
            }catch{lastFailure=now(); /* Do not open from stale holiday data after a failed refresh. */ }
            return snapshot();
        })().finally(()=>{pending=null;});return pending;
    }
    return {spotAt,nightAt,futuresAt,closedAt,openDate,snapshot,calendarRange,refresh,start(){if(timer)return;void refresh();timer=setInterval(()=>void refresh(),60000);timer.unref?.();},stop(){clearInterval(timer);timer=null;}};
}
module.exports={createTradingSession,install,current};
