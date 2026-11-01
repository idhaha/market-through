// Read-only LS source check; never print credentials, tokens or raw HTTP errors.
const fs=require('node:fs'),path=require('node:path'),axios=require('axios');
require('dotenv').config({quiet:true});
const {createBrokerTurnoverData}=require('../broker-turnover-data');
async function run(){
 const date=process.argv[2]||'20261030';if(!/^\d{8}$/.test(date))throw Error('Use YYYYMMDD');
 const auth=await axios.post('https://openapi.ls-sec.co.kr:8080/oauth2/token',new URLSearchParams({grant_type:'client_credentials',appkey:process.env.LS_APPKEY||'',appsecretkey:process.env.LS_SECRETKEY||'',scope:'oob'}).toString(),{timeout:15000,headers:{'Content-Type':'application/x-www-form-urlencoded'}});
 const token=auth.data?.access_token;if(!token)throw Error('LS authentication unavailable');
 const data=createBrokerTurnoverData({broker:'ls',directory:path.resolve('outputs/cumulative-probe-20261101/cache'),transport:{setStreams(){},streamStatus(){}},http:axios,getToken:async()=>token});
 const format=t=>t==null?null:new Date(t+32400000).toISOString().slice(0,19);
 const report={date,at:new Date().toISOString(),sources:[]};
 for(const [code,name]of [['353200','대덕전자'],['005930','삼성전자'],['kospi','KOSPI']]){
  const cumulative=await data.amounts(code,'minute',[date],true),regular=await data.amounts(code,'minute',[date]),daily=await data.amounts(code,'day',[date]);
  const values=[...cumulative.values].filter(([,v])=>Number.isFinite(v));
  const minuteTotal=[...regular.values.values()].reduce((sum,v)=>sum+v,0),dailyTotal=[...daily.values.values()][0];
  report.sources.push({code,name,minutes:regular.values.size,first:format([...regular.values.keys()][0]),last:format([...regular.values.keys()].at(-1)),cumulativeMinutes:values.length,cumulativeFirst:format(values[0]?.[0]),cumulativeLast:format(values.at(-1)?.[0]),minuteTotal,dailyTotal,totalsMatch:minuteTotal===dailyTotal,warnings:[...cumulative.warnings,...daily.warnings]});
 }
 fs.mkdirSync('outputs/cumulative-probe-20261101',{recursive:true});fs.writeFileSync('outputs/cumulative-probe-20261101/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
run().catch(()=>{console.error('Read-only LS cumulative probe failed; no credentials or HTTP details logged.');process.exitCode=1;});
