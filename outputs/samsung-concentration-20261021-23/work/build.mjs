import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const req=createRequire('C:/Users/yg.gb5pro/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/runtime.cjs');
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(req.resolve('@oai/artifact-tool')).href);
const out='D:/Program/MarketThrough/outputs/samsung-concentration-20261021-23';
const source=JSON.parse(await fs.readFile('D:/Program/MarketThrough/logs/samsung-concentration-20261021-20261023-raw.json','utf8'));
const dates=['20261021','20261022','20261023'];
const maps=Object.fromEntries(['kwJ','kwUN','kwIndex','kisJ','kisUN','kisIndex'].map(k=>[k,new Map()]));
const conflicts=[];
function put(type,key,row){if(!dates.includes(key.slice(0,8)))return;const prev=maps[type].get(key);if(prev&&JSON.stringify(prev)!==JSON.stringify(row))conflicts.push({type,key});maps[type].set(key,row);}
for(const call of source.calls){
 if(call.provider==='Kiwoom'){
  const type=call.tr==='ka20005'?'kwIndex':call.params.stk_cd==='005930'?'kwJ':'kwUN';
  for(const r of call.data.inds_min_pole_qry||call.data.stk_min_pole_chart_qry||[])put(type,r.cntr_tm,r);
 }else if(call.tr==='FHKST03010230'){
  for(const r of call.data.output2||[])put(call.params.FID_COND_MRKT_DIV_CODE==='J'?'kisJ':'kisUN',r.stck_bsop_date+r.stck_cntg_hour,r);
 }else if(call.tr==='FHKUP03500200'){
  for(const r of call.data.output2||[])put('kisIndex',r.stck_bsop_date+r.stck_cntg_hour,r);
 }
}
const n=x=>x===undefined||x===null||x===''?null:Math.abs(Number(x));
const stamp=(d,m)=>d+String(Math.floor(m/60)).padStart(2,'0')+String(m%60).padStart(2,'0')+'00';
const label=k=>`${k.slice(0,4)}-${k.slice(4,6)}-${k.slice(6,8)} ${k.slice(8,10)}:${k.slice(10,12)}`;
const deltaMaps={};
for(const type of ['kisJ','kisUN','kisIndex']){
 const deltas=new Map();for(const d of dates){let prev=null;
 for(const [k,r] of [...maps[type]].filter(([k])=>k.startsWith(d)&&Number(k.slice(8,10))<24).sort(([a],[b])=>a.localeCompare(b))){
  const value=n(r.acml_tr_pbmn),clock=k.slice(8);let delta=null;
  if(prev)delta=value-prev.value;else if(clock===(type==='kisUN'?'080000':'090000'))delta=value;
  if(delta!==null&&delta<0)throw new Error(`Negative cumulative delta ${type} ${k}`);
  deltas.set(k,delta);prev={value,key:k};
 }}deltaMaps[type]=deltas;
}
const wb=Workbook.create();
const cmp=wb.worksheets.add('1분비교'),raw=wb.worksheets.add('원본'),notes=wb.worksheets.add('계산설명');
const head=(s,range)=>{s.getRange(range).format={fill:'#213B55',font:{name:'Arial',bold:true,color:'#FFFFFF'},wrapText:true,verticalAlignment:'center',horizontalAlignment:'center',rowHeight:42};};
const base=s=>{s.showGridLines=false;s.getRange('A1:V2200').format.font={name:'Arial',size:10};};
for(const s of [cmp,raw,notes])base(s);
const rawHeaders=['시각 KST','키움 J 종가 원','키움 J 거래량 주','키움 AL 종가 원','키움 AL 거래량 주','키움 업종지수 원본 ×100','키움 업종 거래량 원본','한투 J 종가 원','한투 J 거래량 주','한투 J 누적대금 원','한투 UN 종가 원','한투 UN 거래량 주','한투 UN 누적대금 원','한투 업종지수','한투 업종 거래량 원본','한투 업종 누적대금 백만원','한투 J 구간대금 원','한투 UN 구간대금 원','한투 업종 구간대금 원','한투 업종 누적 원본 존재','한투 J 원본 존재','한투 UN 원본 존재'];
raw.getRange('A1').values=[rawHeaders];head(raw,'A1:V1');
const rows=[],rawRowsByKey=new Map();
for(const d of dates)for(let m=480;m<1200;m++){
 const k=stamp(d,m),q=maps.kwJ.get(k),u=maps.kwUN.get(k),i=maps.kwIndex.get(k),s=maps.kisJ.get(k),t=maps.kisUN.get(k),j=maps.kisIndex.get(k);
 rawRowsByKey.set(k,rows.length+2);
 rows.push([new Date(label(k).replace(' ','T')+':00+09:00'),n(q?.cur_prc),n(q?.trde_qty),n(u?.cur_prc),n(u?.trde_qty),n(i?.cur_prc),n(i?.trde_qty),n(s?.stck_prpr),n(s?.cntg_vol),n(s?.acml_tr_pbmn),n(t?.stck_prpr),n(t?.cntg_vol),n(t?.acml_tr_pbmn),n(j?.bstp_nmix_prpr),n(j?.cntg_vol),n(j?.acml_tr_pbmn),deltaMaps.kisJ.get(k)??null,deltaMaps.kisUN.get(k)??null,deltaMaps.kisIndex.get(k)==null?null:deltaMaps.kisIndex.get(k)*1e6,j?1:0,s?1:0,t?1:0]);
}
// Store timestamps as Excel serials in KST wall time, avoiding machine timezone shifts.
for(const row of rows)row[0]=(row[0].getTime()+9*3600000)/86400000+25569;
raw.getRange(`A2:V${rows.length+1}`).values=rows;
raw.getRange(`A2:A${rows.length+1}`).setNumberFormat('mm/dd hh:mm');
raw.getRange(`B2:V${rows.length+1}`).setNumberFormat('#,##0');
raw.getRange(`N2:N${rows.length+1}`).setNumberFormat('0.00');
raw.getRange('A:A').format.columnWidth=17;raw.getRange('B:V').format.columnWidth=21;
raw.freezePanes.freezeRows(1);raw.freezePanes.freezeColumns(1);
cmp.getRange('A1').values=[['삼성전자 005930 쏠림율 비교 · 2026-10-21~23']];
cmp.getRange('A2').values=[['한투 업종 1분봉은 10/23 13:53~15:30만 확보. 13:54부터 차분 가능. 미확보 구간은 빈칸.']];
cmp.getRange('A3').values=[['J/AL/UN은 API 요청 시장 코드. AL·UN 종목 분자와 코스피 업종 분모의 시장 범위가 다를 수 있음.']];
cmp.getRange('A4').values=[['15:30 키움 업종 거래량은 한투와 집계 범위가 다름. 장 마감·시간외 특수행은 별도 보관.']];
cmp.getRange('A1').format.font={name:'Arial',size:15,bold:true};
const headers=['시각 KST','키움 J 쏠림율','한투 J 쏠림율','차이 한투−키움 %p','키움 AL 현재식','한투 UN 쏠림율','동일 키움J 분자/한투분모','키움 J 추정대금 원','키움 업종 추정대금 원','한투 J 실제 구간대금 원','한투 업종 실제 구간대금 원','키움 AL 추정대금 원','한투 UN 실제 구간대금 원','한투 계산 상태'];
cmp.getRange('A6:N6').values=[headers];head(cmp,'A6:N6');
const records=[],checks=[];
for(const d of dates)for(let m=540;m<=930;m++){
 const k=stamp(d,m),r=rawRowsByKey.get(k),row=records.length+7;
 if(!r)throw new Error(`No input row ${k}`);
 const src=c=>`'원본'!${c}${r}`;
 const numeric=(c)=>`ISNUMBER(${src(c)})`;
 const guardProduct=(a,b,f)=>`=IF(AND(${numeric(a)},${numeric(b)}),${f},"")`;
 const ratio=(a,b)=>`=IF(AND(ISNUMBER(${a}${row}),ISNUMBER(${b}${row}),${b}${row}>0),${a}${row}/${b}${row},"")`;
 const indexDelta=deltaMaps.kisIndex.get(k),stockDelta=deltaMaps.kisJ.get(k);
 const status=indexDelta==null?'업종 누적 미확보 또는 직전 누적 없음':indexDelta===0?'업종 구간 거래대금 0':stockDelta==null?'종목 원본 없음':'계산 가능';
 const f=[`=${src('A')}`,ratio('H','I'),ratio('J','K'),`=IF(AND(ISNUMBER(B${row}),ISNUMBER(C${row})),(C${row}-B${row})*100,"")`,ratio('L','I'),ratio('M','K'),ratio('H','K'),guardProduct('B','C',`${src('B')}*${src('C')}`),guardProduct('F','G',`(${src('F')}/100)*${src('G')}*10000`),`=IF(${numeric('Q')},${src('Q')},"")`,`=IF(${numeric('S')},${src('S')},"")`,guardProduct('D','E',`${src('D')}*${src('E')}`),`=IF(${numeric('R')},${src('R')},"")`,''];
 records.push(f);checks.push({key:k,kwJ:maps.kwJ.has(k)&&maps.kwIndex.has(k)&&n(maps.kwIndex.get(k).trde_qty)>0,kisJ:indexDelta>0&&stockDelta!==null&&stockDelta!==undefined,status});
}
const end=records.length+6;
cmp.getRange(`A7:N${end}`).formulas=records;
cmp.getRange(`N7:N${end}`).values=checks.map(x=>[x.status]);
cmp.getRange(`A7:A${end}`).setNumberFormat('mm/dd hh:mm');cmp.getRange(`B7:C${end}`).setNumberFormat('0.0000%');cmp.getRange(`D7:D${end}`).setNumberFormat('0.0000');cmp.getRange(`E7:G${end}`).setNumberFormat('0.0000%');cmp.getRange(`H7:M${end}`).setNumberFormat('#,##0');
cmp.getRange('A:A').format.columnWidth=17;cmp.getRange('B:G').format.columnWidth=23;cmp.getRange('H:M').format.columnWidth=25;cmp.getRange('N:N').format.columnWidth=43;cmp.freezePanes.freezeRows(6);cmp.freezePanes.freezeColumns(1);
cmp.tables.add(`A6:N${end}`,true,'SamsungConcentration');
const stats=dates.map(d=>({date:d,kw:checks.filter(x=>x.key.startsWith(d)&&x.kwJ).length,kis:checks.filter(x=>x.key.startsWith(d)&&x.kisJ).length}));
const text=[
 ['항목','내용'],['대상','삼성전자 005930 / 코스피 종합 업종. 2026-10-21~23, 한국시간. 비교 시각 09:00~15:30, 총 1,173행.'],
 ['키움 J','삼성전자 abs(cur_prc)×trde_qty ÷ {(코스피 abs(cur_prc)/100)×trde_qty×10000}. 현재 서비스 방식에서 종목만 005930으로 조회.'],
 ['키움 AL 현재식','현재 서비스와 같은 005930_AL 분자와 업종 001 분모. 각 분봉 종가×거래량에 기반한 추정 비중.'],
 ['한투 J','주식 FHKST03010230, 시장 J의 누적 거래대금 차분(원) ÷ 업종 FHKUP03500200의 누적 거래대금 차분×1,000,000(원).'],
 ['한투 UN','종목 시장 UN의 누적 거래대금 차분 ÷ 동일 코스피 업종 차분. 통합시장 종목/업종 범위 불일치 가능.'],
 ['동일 분자 비교','키움 J 종가×거래량을 동일하게 사용하고 분모만 한투 실제 업종 거래대금으로 변경. 분모 계산 방식 영향 확인용.'],
 ['쏠림율 표시','비율 값을 Excel 백분율 형식으로 표시. 차이 열만 퍼센트포인트. 비율을 합산하지 않음.'],
 ['확보 범위','한투 업종 1분봉은 10/23 13:53~15:30 확보. 첫 행은 직전 누적이 없어 구간대금 계산 불가. 10/21~22와 10/23 오전은 한투 쏠림율 미산출.'],
 ['연속조회 확인','FHPUP02110200 및 FHKUP03500200에 tr_cont=N을 보냈으나 같은 최신 행이 반환됨. 미확보 분모를 키움 값이나 보간값으로 채우지 않음.'],
 ['0과 결측','원본에 없는 종목 봉은 빈칸. 업종 구간대금 0이면 비율은 빈칸. 특수 시간값은 정상 1분봉으로 취급하지 않음.'],
 ['누적 차분','일자별 초기화. 첫 종목 행이 J=09:00 또는 UN=08:00이면 누적 기준 0. 그 외 시작 행은 직전 값이 없으면 빈칸.'],
 ['시간 정렬','API의 동일 HHMM 타임스탬프끼리 결합. 두 증권사의 같은 시각 종가·거래량 일치 여부를 원본 탭에서 확인 가능. 세션 전환 집계는 상이할 수 있음.'],
 ['장 마감','10/23 15:30 키움 업종 거래량 20,586, 한투 7,085. 한투 특수행 999999의 13,501과 합하면 키움 값과 같음. 두 15:30 비율은 동일 집계 범위 비교가 아님.'],
 ['원본 단위','키움 업종 지수는 100배 원본, 업종 거래량 환산은 현재 서비스 ×10000 유지. 한투 종목 누적대금은 원, 업종 누적대금은 백만원 스케일.'],
 ['원본 탭','08:00~19:59 중 하나 이상의 원천 행이 있는 시각 전부 보관. 거래대금 차분 Q~S는 수집한 누적 원본에서 계산한 값.'],
 ['키움 출처','https://api.kiwoom.com/api/dostk/chart · ka10080: 005930/005930_AL, 1분, 수정주가 0 · ka20005: 업종001, 1분'],
 ['한투 주식 출처','https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/domestic_stock/inquire_time_dailychartprice'],
 ['한투 업종 출처','https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/domestic_stock/inquire_time_indexchartprice'],
 ...stats.map(s=>[s.date,`키움 J 계산 가능 ${s.kw}개 / 한투 J 계산 가능 ${s.kis}개 (각 날짜 비교 시간축 391개)`]),
 ['중복 상충',`동일 원천·시각 중복 상충 ${conflicts.length}건`]
];
// Preserve special closing/after-hours rows outside the minute grid.
text.push(['특수행','날짜 / 시간코드 / 누적 업종 거래대금(백만원) / 거래량 원본']);
for(const [k,r]of maps.kisIndex)if(Number(k.slice(8,10))>=24)text.push([k,`${r.acml_tr_pbmn} / ${r.cntg_vol}`]);
notes.getRange(`A1:B${text.length}`).values=text;head(notes,'A1:B1');notes.getRange('A:A').format.columnWidth=23;notes.getRange('B:B').format.columnWidth=115;notes.getRange(`A2:B${text.length}`).format.wrapText=true;notes.getRange(`A2:B${text.length}`).format.rowHeight=40;
wb.recalculate();
console.log(JSON.stringify({stats,sourceRows:rows.length,conflicts,compareRows:records.length}));
console.log((await wb.inspect({kind:'region',sheetId:'1분비교',range:'A1080:N1083',maxChars:2200,tableMaxCols:14})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!',options:{useRegex:true,maxResults:10},maxChars:1500})).ndjson);
// Independent numeric spot-check against source JSON.
for(const idx of [0,391,1080,1172]){const f=checks[idx],r=rawRowsByKey.get(f.key),v=rows[r-2];const expected=v[1]!=null&&v[2]!=null&&v[5]!=null&&v[6]>0?v[1]*v[2]/((v[5]/100)*v[6]*10000):null;const actual=cmp.getRange(`B${idx+7}`).values[0][0];if(expected!==null&&Math.abs(expected-actual)>1e-10)throw new Error(`Formula check failed ${f.key}`);}
await (await SpreadsheetFile.exportXlsx(wb)).save(`${out}/삼성전자_1분봉_쏠림율_20261021-23.xlsx`);
const escape=x=>x==null?'':`"${String(x).replaceAll('"','""')}"`;
const values=cmp.getRange(`A6:N${end}`).values;
const csv=values.map((r,i)=>r.map((v,j)=>escape(i>0&&j===0?label(checks[i-1].key):v)).join(',')).join('\r\n');
await fs.writeFile(`${out}/삼성전자_1분봉_쏠림율_20261021-23.csv`,'\ufeff'+csv);
await fs.writeFile(`${out}/work/stats.json`,JSON.stringify(stats,null,2));
for(const [sheet,range,file]of [['1분비교','A1080:G1090','compare'],['원본','A2:H10','raw'],['계산설명','A1:B12','notes']]){
 const blob=await wb.render({sheetName:sheet,range,scale:1,format:'png'});await fs.writeFile(`${out}/work/${file}.png`,new Uint8Array(await blob.arrayBuffer()));
}
console.log('Exported workbook and CSV');

