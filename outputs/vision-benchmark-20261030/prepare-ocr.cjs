const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const references = [
  ['경보 배너 / 흰 글자·붉은 배경', '코스피 서킷브레이커 1단계 · 상위 단계 발동 · 확인됨\n조건: 지수가 전일 종가 대비 8% 이상 하락하여 1분간 지속\n조치: 20분간 매매 중단 → 이후 10분간 단일가 매매 후 재개\n발생 10시 0분 0초 | 해제 미확인 · 수신시각 기준'],
  ['조건표 / 좁은 화면 줄바꿈', '단계/ 시장 조건\n1단계 지수가 전일 종가 대비 8% 이상 하락하여 1분간 지속\n2단계 지수가 전일 종가 대비 15% 이상 하락하고 1단계 발동 지수보다 낮은 상태가 1분간 지속\n3단계 지수가 전일 종가 대비 20% 이상 하락하고 2단계 발동 지수보다 낮은 상태가 1분간 지속'],
  ['시장 수급 / 작은 글자·대금 단위', '2026-10-23\n외 +3억원 기 +0억원\n프 -1억원 개 -1억원'],
  ['종목 수급 / 작은 글자·수량 단위', '2026-10-23\n외 +111주 기 +222주\n프 +444주 개 +333주'],
  ['거래대금 / 영문·소수·한글 단위', '2026-10-23\nKOSPI 3.0조원\nKOSDAQ 1.0조원'],
];
const cases = references.map(([title, reference], i) => {
  const file = `screens/ko-0${i+1}.png`;
  const bytes = fs.readFileSync(path.join(__dirname, file));
  return {id: `ko-${i+1}`, title, file, reference, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), source: 'Existing synthetic application test screenshots under dev/output; cropped without resizing. Reference manually transcribed before inference.'};
});
fs.writeFileSync(path.join(__dirname, 'ocr-cases.json'), JSON.stringify(cases, null, 2));
console.log('Prepared', cases.length, 'Korean OCR cases');
