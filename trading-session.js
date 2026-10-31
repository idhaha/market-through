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
    function nextWeekday(d){let t=dateTime(d)+86400000;while([0,6].includes(new Date(t+9*3600000).getUTCDay()))t+=86400000;return day(t);}
    const fresh=()=>saved.validatedDay===day(now());
    function spotAt(t=now()){const d=new Date(t+9*3600000),m=d.getUTCHours()*60+d.getUTCMinutes();return fresh() && m>=480 && m<1200 && openDate(day(t))===true;}
    function nightAt(t=now()){
        const d=new Date(t+9*3600000),m=d.getUTCHours()*60+d.getUTCMinutes();
        if(!fresh() || m>=360 && m<1080)return false;
        const date=nightDay(t);return openDate(date)===true && openDate(nextWeekday(date))===true;
    }
    function futuresAt(t=now()){const d=new Date(t+9*3600000),m=d.getUTCHours()*60+d.getUTCMinutes();return fresh() && m>=525 && m<945 && openDate(day(t))===true || nightAt(t);}
    function snapshot(){return {date:day(now()),spot:spotAt(),futures:futuresAt(),night:nightAt(),calendarKnown:openDate(day(now()))===false || fresh() && openDate(day(now()))!==null,checkedDay:saved.checkedDay,calendarFresh:fresh()};}
    async function refresh(){
        if(pending)return pending;
        const today=day(now());if(fresh() || lastFailure && now()-lastFailure<15*60000)return snapshot();
        const weekday=new Date(now()+9*3600000).getUTCDay(),hour=new Date(now()+9*3600000).getUTCHours();
        if((weekday===0 || weekday===6 && hour>=6))return snapshot();
        saved.checkedDay=today;
        pending=(async()=>{
            try{
                const rows=await loadCalendar(day(now()-86400000).replaceAll('-',''));
                if(!Array.isArray(rows))throw Error();
                for(const r of rows){const raw=String(r.bass_dt||'');if(/^\d{8}$/.test(raw)&&['Y','N'].includes(r.opnd_yn))saved.days[`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6)}`]=r.opnd_yn==='Y';}
                if(openDate(today)===null)throw Error();
                saved.validatedDay=today;lastFailure=0;
                fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(saved));fs.renameSync(file+'.tmp',file);
            }catch{lastFailure=now(); /* Do not open from stale holiday data after a failed refresh. */ }
            return snapshot();
        })().finally(()=>{pending=null;});return pending;
    }
    return {spotAt,nightAt,futuresAt,openDate,snapshot,refresh,start(){if(timer)return;void refresh();timer=setInterval(()=>void refresh(),60000);timer.unref?.();},stop(){clearInterval(timer);timer=null;}};
}
module.exports={createTradingSession,install,current};
