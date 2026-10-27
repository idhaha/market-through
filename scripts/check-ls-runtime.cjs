// Read-only LS deployment diagnostics. Never prints credentials, tokens, or raw request errors.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');require('dotenv').config({path:path.join(root,'.env'),quiet:true});
const checks={cwd_matches_project:path.resolve(process.cwd())===root,env_file_present:fs.existsSync(path.join(root,'.env')),
 LS_APPKEY_present:!!process.env.LS_APPKEY?.trim(),LS_SECRETKEY_present:!!process.env.LS_SECRETKEY?.trim()};
for(const file of ['broker-stock-supply.js','ls-market-supply.js','ls-market-daily.js','ls-market-validation.js'])checks[file+'_present']=fs.existsSync(path.join(root,file));
const privateChecks=path.join(root,'data/ls-market-supply/validation.json');checks.private_validation_present=fs.existsSync(privateChecks);
let defaults={};try{defaults=require(path.join(root,'ls-market-validation'));}catch{}
let overrides={};try{overrides=JSON.parse(fs.readFileSync(privateChecks,'utf8'));}catch{}
checks.cash_validation={};for(const key of ['UBT:U001','UBT:U301','UPM:U0','UPM:U1']){const value=({...defaults,...overrides})[key];checks.cash_validation[key]=!!(value?.cumulative&&value.toMillionWon>0&&value.evidence);}
try{const source=fs.readFileSync(path.join(root,'server.js'),'utf8');checks.validation_defaults_wired=source.includes("validationDefaults: require('./ls-market-validation')");const start=source.indexOf("app.get('/api/ls-market-supply/chart'");const end=source.indexOf("app.get('/api/market-supply/chart'",start);checks.ls_http_route_uses_own_daily_source=start>=0&&!source.slice(start,end).includes('await marketSupplyService.query');}catch{}
try{checks.revision=require('node:child_process').execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
(async()=>{if(process.argv.includes('--probe')&&checks.LS_APPKEY_present&&checks.LS_SECRETKEY_present){try{const r=await require('axios').post('https://openapi.ls-sec.co.kr:8080/oauth2/token',new URLSearchParams({grant_type:'client_credentials',appkey:process.env.LS_APPKEY.trim(),appsecretkey:process.env.LS_SECRETKEY.trim(),scope:'oob'}).toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:10000});checks.ls_auth_ok=!!r.data?.access_token;if(!checks.ls_auth_ok)checks.ls_auth_error_code=String(r.data?.error_code||'unknown');}catch(e){checks.ls_auth_ok=false;checks.ls_auth_http_status=e.response?.status||null;checks.ls_auth_error_code=String(e.response?.data?.error_code||e.code||'request failed');}}
console.log(JSON.stringify(checks,null,2));})();
