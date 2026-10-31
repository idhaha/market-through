'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/,''));
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact = s => [...String(s).normalize('NFC').replace(/\s/gu, '')];
function distance(a, b) {
  let row = Array.from({length:b.length+1}, (_,i)=>i);
  for(let i=0;i<a.length;i++) { const next=[i+1]; for(let j=0;j<b.length;j++) next[j+1]=Math.min(next[j]+1,row[j+1]+1,row[j]+(a[i]===b[j]?0:1)); row=next; }
  return row[b.length];
}
const median = list => {const a=list.filter(Number.isFinite).sort((a,b)=>a-b);return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2 : null;};
const hasCpuGui=fs.existsSync(path.join(root,'cpu-gui-results.json'));
const cases = read(hasCpuGui?'cpu-gui-cases.json':'cases.json'), ocr = read('ocr-cases.json'), nativeResults = read('results.json'), meta = read('meta.json');
const hasCpu = fs.existsSync(path.join(root,'cpu-ocr-results.json'));
const guiResults=hasCpuGui?read('cpu-gui-results.json'):nativeResults.filter(r=>r.task==='gui');
const results = hasCpu ? [...guiResults, ...read('cpu-ocr-results.json')] : nativeResults;
if(hasCpu) meta.cpu_ocr=read('cpu-ocr-meta.json');
if(hasCpuGui) meta.cpu_gui=read('cpu-gui-meta.json');
const models = ['qwen3-vl:8b-instruct','qwen3.5:9b'];
const summaries = models.map(model => {
  const rows=results.filter(r=>r.model===model), gui=rows.filter(r=>r.task==='gui'), texts=rows.filter(r=>r.task==='ocr');
  let errors=0, chars=0, hangulErrors=0, hangulChars=0, numericCorrect=0, numericTotal=0;
  for(const row of texts) {
    if(row.error || typeof row.text !== 'string') continue;
    const item=ocr.find(c=>c.id===row.case_id), ref=compact(item.reference), actual=compact(row.text||'');
    const refKo=ref.filter(c=>/[가-힣]/u.test(c)), actualKo=actual.filter(c=>/[가-힣]/u.test(c));
    row.ocr_errors=distance(ref,actual);row.ocr_chars=ref.length;row.cer=row.ocr_errors/ref.length;
    errors+=row.ocr_errors;chars+=ref.length;hangulErrors+=distance(refKo,actualKo);hangulChars+=refKo.length;
    const numberTokens = text => (String(text).match(/[+-]?\d+(?:[.-]\d+)*(?:\s*(?:%|주|억원|조원))?/g)||[]).map(x=>x.replace(/\s/gu,''));
    const nums=numberTokens(item.reference);
    const available=numberTokens(row.text||'');
    for(const num of nums){numericTotal++;const i=available.indexOf(num);if(i>=0){numericCorrect++;available.splice(i,1);}}
  }
  return {model,gui_cases:gui.length,gui_hits:gui.filter(r=>r.hit).length,gui_median_seconds:median(gui.map(r=>r.wall_seconds)),ocr_cases:texts.length,ocr_errors:errors,ocr_characters:chars,ocr_cer:chars?errors/chars:null,hangul_cer:hangulChars?hangulErrors/hangulChars:null,numeric_correct:numericCorrect,numeric_total:numericTotal,ocr_median_seconds:median(texts.map(r=>r.wall_seconds)),failures:rows.filter(r=>r.error).length};
});
fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify({summaries,scored_results:results},null,2));
const f = n => n == null ? '—' : n.toFixed(2);
const pct = n => n == null ? '—' : (n*100).toFixed(1)+'%';
const img = item => `<img src="${escape(item.file)}" alt="${escape(item.title||item.instruction)}" loading="lazy">`;
const by = (model,id) => results.find(r=>r.model===model&&r.case_id===id);
let html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>로컬 비전 모델 비교 — 한글 OCR 포함</title><style>
/* Initial layout/CSS draft delegated to local qwen2.5-coder:7b; reviewed and extended by Codex. */
body{max-width:1200px;margin:0 auto;font-family:system-ui,'Malgun Gothic',sans-serif;background:#f4f4f4;color:#222;line-height:1.6}main{padding:24px}header h1{font-size:24px}h2{font-size:20px;margin-top:32px}h3{font-size:17px}.paired{display:flex;gap:16px}.paired>div{flex:1;min-width:0}section.case{border-top:1px solid #ccc;padding:18px 0}.instruction{color:#555}.screen{position:relative;display:inline-block;max-width:100%}.screen img{display:block;width:100%;height:auto;max-height:650px;object-fit:contain;object-position:left top}.gui-image{max-width:800px}.gui-image img{max-height:none}.target{position:absolute;box-sizing:border-box;border:2px dashed #111;background:#fff3}.point{position:absolute;width:12px;height:12px;border-radius:50%;transform:translate(-50%,-50%);border:2px solid white}.m0{background:#003b89}.m1{background:#a53000}table{width:100%;border-collapse:collapse;background:white;font-size:14px}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;padding:12px;border:1px solid #ddd;font-family:inherit;font-size:14px}details{margin-top:12px}code{overflow-wrap:anywhere}.scroll{overflow:auto}.note{color:#555;font-size:14px}@media(max-width:700px){main{padding:12px}.paired{flex-direction:column}table{font-size:12px}}
</style><main><header><h1>8B Instruct와 9B 실제 비교</h1><p>동일 이미지 · 로컬 Ollama · GUI 10장 + 한글 OCR 5장</p><p class="note">실행 시작 ${escape(meta.started_at)} / 종료 ${escape(meta.finished_at||'진행 중')} · Ollama ${escape(meta.ollama?.version)}</p></header>
<h2>결과</h2><div class="scroll"><table><thead><tr><th>모델</th><th>위치 찾기 성공</th><th>위치 찾기 중앙값</th><th>OCR 글자 오류율 ↓</th><th>한글만 오류율 ↓</th><th>숫자·단위 토큰 일치</th><th>OCR 중앙값</th><th>호출 실패</th></tr></thead><tbody>${summaries.map(s=>`<tr><th>${escape(s.model)}</th><td>${s.gui_hits}/${s.gui_cases}</td><td>${f(s.gui_median_seconds)}초</td><td>${pct(s.ocr_cer)} (${s.ocr_errors}/${s.ocr_characters})</td><td>${pct(s.hangul_cer)}</td><td>${s.numeric_correct}/${s.numeric_total}</td><td>${f(s.ocr_median_seconds)}초</td><td>${s.failures}</td></tr>`).join('')}</tbody></table></div>
<p class="note">OCR 오류율(CER)은 NFC 정규화 후 공백·줄바꿈을 제거한 문자열의 편집거리/정답 글자 수입니다. 숫자·문장부호는 유지합니다. 한글만 오류율은 다른 문자를 제거한 보조 지표입니다. 숫자 토큰 일치는 부호·단위를 포함하며 위치를 평가하지 않는 보조 지표입니다. 시간은 워밍업 이후 요청 왕복 시간이고, 입력 이미지 처리와 출력 생성 모두 포함합니다.</p>
<h2>한글 OCR: 원본과 전사 비교</h2>${ocr.map(item=>`<section class="case"><h3>${escape(item.id)} · ${escape(item.title)}</h3>${img(item)}<details open><summary>사전에 확정한 정답</summary><pre>${escape(item.reference)}</pre></details><div class="paired">${models.map(m=>{const r=by(m,item.id);return `<div><h4>${escape(m)}</h4><p>CER ${pct(r?.cer)} · ${f(r?.wall_seconds)}초</p><pre>${escape(r?.text||r?.error||'미실행')}</pre></div>`}).join('')}</div></section>`).join('')}
<h2>화면 위치 찾기</h2><p>점선: 정답 영역 · 파랑: 8B · 주황: 9B. 예측 지점이 정답 영역 안에 있으면 성공입니다.</p>${cases.map(item=>{const [x1,y1,x2,y2]=item.target_bbox;return `<section class="case"><h3>${item.id}. ${escape(item.instruction)}</h3><p class="instruction">${escape(item.platform)} · ${item.width}×${item.height}</p><div class="screen gui-image">${img(item)}<span class="target" style="left:${x1*100}%;top:${y1*100}%;width:${(x2-x1)*100}%;height:${(y2-y1)*100}%"></span>${models.map((m,i)=>{const r=by(m,item.id);return r?.point?`<span class="point m${i}" title="${escape(m)}" style="left:${r.point.x/10}%;top:${r.point.y/10}%"></span>`:''}).join('')}</div><div class="paired">${models.map(m=>{const r=by(m,item.id);return `<div><b>${escape(m)}</b><p>${r?(r.hit?'성공':'실패'):'미실행'} · ${f(r?.wall_seconds)}초 · ${escape(JSON.stringify(r?.point||null))}${r?.error?' · '+escape(r.error):''}</p></div>`}).join('')}</div></section>`}).join('')}
<h2>방법과 한계</h2><p>GUI 표본은 <a href="https://huggingface.co/datasets/bevaya/ScreenSpot">ScreenSpot 공개 미러</a> test 1,272개 중 균등 간격 10개를 결과 확인 전에 고정했습니다. 한글 OCR은 기존 앱 테스트 화면 5개 영역을 원래 해상도로 잘라 사용했으며 실사용 개인정보는 포함하지 않았습니다. 두 모델에 동일한 바이트와 과제별 동일 프롬프트·JSON 형식을 전달했습니다. temperature=0, seed=42, context=8192, think=false. GUI 출력 한도 128, OCR 1024 토큰입니다. 모델 자체의 이미지 처리 방식은 다를 수 있습니다.</p><p>실행 순서는 8B 전반 GUI 5개/OCR 2개 → 9B 전체 → 8B 나머지입니다. 블록마다 이전 모델을 내리고 별도 워밍업했습니다. 반복 재시도나 결과를 보고 프롬프트를 수정하지 않았습니다. 표본이 작고 OCR은 같은 앱의 제한된 글꼴·디자인이므로 일반 문서, 손글씨, 사진 또는 모든 한글 화면에 일반화할 수 없습니다. 글자 크기별 결과와 숫자·단위 오류를 함께 확인하세요.</p>
<details><summary>모델 파일 정보·GPU 할당·실행 메타데이터</summary><pre>${escape(JSON.stringify(meta,null,2))}</pre></details><p><a href="results.json">원시 결과</a> · <a href="summary.json">계산 결과</a> · <a href="ocr-cases.json">OCR 정답·해시</a> · <a href="benchmark.cjs">실행 스크립트</a></p></main></html>`;
html = html.replace('<h2>결과</h2>', '<h2>현재 판단</h2><p><strong>GPU 비교는 반복된 Vulkan device lost 오류로 조기 중단했습니다. 준비한 GUI 10장 전체에 대한 정확도·속도 우열은 판단할 수 없습니다.</strong> 아래 GUI 수치는 실제 시도한 일부 사례이며 미실행 사례는 분모에 포함하지 않습니다. 실행 오류는 모델의 인식 오답과 다릅니다.</p><p>한글 OCR은 별도 CPU 전용(num_gpu=0) 실행 결과입니다. 두 모델 모두 같은 정답·이미지·프롬프트로 평가하며, GPU 측정 시간과 비교하지 않습니다. OCR 호출 실패는 CER에서 제외하고 원문에 표시합니다.</p><h2>부분 GUI 결과와 CPU 한글 OCR 결과</h2>')
  .replace('동일 이미지 · 로컬 Ollama · GUI 10장 + 한글 OCR 5장','동일 이미지 · GUI 10장 준비 / GPU 비교 조기 중단 · CPU 한글 OCR 5장')
  .replace('<th>위치 찾기 성공</th>','<th>GPU 위치 찾기 성공/시도</th>')
  .replace('<th>위치 찾기 중앙값</th>','<th>GPU 정상 응답 중앙값</th>')
  .replace('<th>OCR 중앙값</th>','<th>CPU OCR 중앙값</th>')
  .replace('<h2>한글 OCR: 원본과 전사 비교</h2>','<h2>CPU 한글 OCR: 원본과 전사 비교</h2>')
  .replace(/<p>실행 순서는 8B 전반 GUI[\s\S]*?<\/p>/,'<p>당초 GPU 실행은 8B 전반 → 9B 전체 → 8B 후반 순서였으나 두 모델에서 반복되는 이미지 인코더 Vulkan device lost 오류로 중단했습니다. 실행한 기록은 보존하고 미실행 사례를 오답으로 채우지 않았습니다. 이후 CPU에서 8B 한글 OCR 5개 → 9B 한글 OCR 5개를 별도로 실행했습니다. 프롬프트와 정답은 변경하지 않았습니다. 표본이 작고 같은 앱의 제한된 글꼴·디자인이므로 일반 문서, 손글씨, 사진 또는 모든 한글 화면에 일반화할 수 없습니다.</p>')
  .replace('<a href="results.json">원시 결과</a>','<a href="results.json">GPU 원시 결과</a> · <a href="cpu-ocr-results.json">CPU OCR 원시 결과</a>')
  .replace('</style>','section.case>img{max-width:100%;height:auto}</style>');
html=html.replace('<h2>방법과 한계</h2>','<h2>방법과 한계</h2><p>CPU 최종 비교에서는 presence_penalty=0, frequency_penalty=0, repeat_penalty=1을 맞췄습니다. 최초 8B 실행 로그가 이 값임을 확인했습니다. 9B 태그는 presence_penalty=1.5가 기본이므로 최초 결과를 보존하고 0으로 명시한 9B 추가 실행을 최종 비교에 사용했습니다. <a href="cpu-ocr-default-results.json">최초 기본값 실행</a> · <a href="model-defaults.json">모델 기본 설정</a>. CER은 글자 누락·오독뿐 아니라 지정한 행 순서와 다른 전사 순서도 오류로 계산합니다. 숫자 토큰은 공백을 제거한 뒤 대조합니다.</p>');
if(hasCpuGui) {
 html=html.replace(/<h2>현재 판단<\/h2>[\s\S]*?<h2>부분 GUI 결과와 CPU 한글 OCR 결과<\/h2>/,`<h2>현재 판단</h2><p>원본 GPU 실행은 두 모델에서 Vulkan device lost 오류가 반복돼 중단했습니다. 아래는 이를 분리한 <strong>CPU 전용 비교</strong>입니다. GUI ${guiResults.length}/20회, OCR ${results.filter(r=>r.task==='ocr').length}/10회 결과가 기록됐습니다.</p><p>GUI는 같은 10장 각각의 긴 변을 최대 1,280픽셀로 동일하게 축소한 PNG를 사용했습니다. OCR 5장은 원본 크기의 잘라낸 영역을 사용했습니다. 두 과제의 점수와 시간을 나누어 보세요. GPU 정상 작동 시의 속도·정확도를 의미하지 않습니다.</p><h2>CPU 화면 위치 찾기와 한글 OCR 결과</h2>`)
 .replace('동일 이미지 · GUI 10장 준비 / GPU 비교 조기 중단 · CPU 한글 OCR 5장','동일 이미지 · CPU 화면 위치 찾기 10장 + CPU 한글 OCR 5장 · GPU 오류 기록 별도 보존')
 .replace('<th>GPU 위치 찾기 성공/시도</th>','<th>CPU 위치 찾기 성공/시도</th>')
 .replace('<th>GPU 정상 응답 중앙값</th>','<th>CPU 위치 찾기 중앙값</th>')
 .replace('<h2>화면 위치 찾기</h2>','<h2>CPU 화면 위치 찾기 (긴 변 최대 1,280px)</h2>')
 .replace('<h2>방법과 한계</h2>','<h2>방법과 한계</h2><p>GUI CPU 비교는 별도 단일 실행입니다. System.Drawing HighQualityBicubic으로 긴 변이 1,280px를 넘는 이미지만 축소했고 원본의 정답 영역 정규화 좌표는 유지했습니다. 8B 전반 5개 → 9B 10개 → 8B 후반 5개 순서로 모델을 번갈아 실행했습니다. 블록별 워밍업은 평가하지 않는 OCR 이미지로 수행해 채점 이미지 캐시를 피했습니다. 작은 글자는 축소로 가독성이 떨어질 수 있습니다. CPU GUI와 OCR 실행 메타데이터를 아래에서 확인할 수 있습니다.</p>')
 .replace('<a href="results.json">GPU 원시 결과</a>','<a href="cpu-gui-results.json">CPU GUI 원시 결과</a> · <a href="results.json">GPU 중단 기록</a>');
}
const finishedAt=meta.cpu_gui?.finished_at||meta.cpu_ocr?.finished_at||meta.finished_at;
html=html.replace(/ \/ 종료 [^<]*? · Ollama/,` / 종료 ${escape(finishedAt||'진행 중')} · Ollama`);
if(fs.existsSync(path.join(root,'codex-reinspection.json'))) {
 const inspection=read('codex-reinspection.json');
 const rows=inspection.records.map(r=>{const c=ocr.find(c=>c.id===r.case_id);const reference=compact(c.reference);return {...r,characters:reference.length,errors:distance(reference,compact(r.text))};});
 const score={workflow_median_seconds:median(rows.map(r=>r.workflow_seconds)),workflow_min_seconds:Math.min(...rows.map(r=>r.workflow_seconds)),workflow_max_seconds:Math.max(...rows.map(r=>r.workflow_seconds)),errors:rows.reduce((n,r)=>n+r.errors,0),characters:rows.reduce((n,r)=>n+r.characters,0),method:inspection.method,records:rows};
 fs.writeFileSync(path.join(root,'codex-reinspection-summary.json'),JSON.stringify(score,null,2));
 const section=`<h2>현재 Codex 세션의 같은 이미지 재판독</h2><p>이미지를 불러오기 직전부터 전사문을 다음 도구 호출에 기록하기 직전까지의 작업 흐름 시간입니다. 도구·왕복·진행 처리 시간이 포함되며, 직접 모델 API 응답 시간 측정이 아닙니다. 앞서 이 이미지와 정답을 본 세션이므로 독립적인 정확도 평가로 볼 수 없습니다. 로컬 Ollama 시간과 측정 경계도 달라 속도 배율을 계산하지 않습니다.</p><p>5장 중앙값 <strong>${f(score.workflow_median_seconds)}초</strong>, 범위 ${f(score.workflow_min_seconds)}~${f(score.workflow_max_seconds)}초. 정답 ${score.characters}자 대비 편집 오류 ${score.errors}자.</p><table><thead><tr><th>이미지</th><th>재판독 작업 시간</th><th>편집 오류/정답 글자</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escape(r.case_id)}</td><td>${f(r.workflow_seconds)}초</td><td>${r.errors}/${r.characters}</td></tr>`).join('')}</tbody></table><details><summary>전사문·측정 기록</summary><pre>${escape(JSON.stringify(score,null,2))}</pre></details><p><a href="codex-reinspection.json">재판독 원시 기록</a> · <a href="codex-reinspection-summary.json">재판독 계산 결과</a></p>`;
 html=html.replace('<h2>CPU 한글 OCR: 원본과 전사 비교</h2>',section+'<h2>CPU 한글 OCR: 원본과 전사 비교</h2>');
 console.log(JSON.stringify({codex_reinspection:score},null,2));
}
fs.writeFileSync(path.join(root,'report.html'),html);
console.log(JSON.stringify(summaries,null,2));
