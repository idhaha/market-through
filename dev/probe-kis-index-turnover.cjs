// Read-only KIS index turnover diagnostic. Credentials never enter the report.
require('dotenv').config({ quiet: true });
const axios = require('axios');
const fs = require('node:fs');
const path = require('node:path');
const pause = () => new Promise(r => setTimeout(r, 350));
async function main() {
  const domain = process.env.EFRIEND_DOMAIN?.trim();
  const appkey = process.env.EFRIEND_APPKEY?.trim();
  const appsecret = process.env.EFRIEND_SECRETKEY?.trim();
  if (!domain || !appkey || !appsecret) throw new Error('Missing EFRIEND configuration');
  const auth = await axios.post(`${domain}/oauth2/tokenP`, { grant_type: 'client_credentials', appkey, appsecret }, { timeout: 15000 });
  const token = auth.data.access_token;
  if (!token) throw new Error(auth.data.msg1 || auth.data.error_description || 'Token unavailable');
  const report = { observed_at: new Date().toISOString(), calls: [] };
  async function get(tr, endpoint, params) {
    await pause();
    try {
      const res = await axios.get(`${domain}/uapi/domestic-stock/v1/quotations/${endpoint}`, { params,
        headers: { authorization: `Bearer ${token}`, appkey, appsecret, tr_id: tr, custtype: 'P' }, timeout: 15000 });
      const entry = { tr, params, continuation: res.headers.tr_cont, data: res.data };
      report.calls.push(entry);
      console.log(JSON.stringify({ tr, params, rt_cd: res.data.rt_cd, msg: res.data.msg1,
        sizes: Object.fromEntries(Object.entries(res.data).filter(([k]) => k.startsWith('output')).map(([k,v]) => [k, Array.isArray(v) ? v.length : 1])) }));
      return res.data;
    } catch (e) {
      const error = { tr, params, error: e.response?.data?.msg1 || e.code || 'Request failed' };
      report.calls.push(error); console.log(JSON.stringify(error)); return {};
    }
  }
  for (const code of ['0001', '1001']) {
    await get('FHKUP03500200', 'inquire-time-indexchartprice', { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: code,
      FID_INPUT_HOUR_1: '3600', FID_PW_DATA_INCU_YN: 'Y', FID_ETC_CLS_CODE: '0' });
    for (const mode of ['0', '1']) {
      await get('FHKUP03500200', 'inquire-time-indexchartprice', { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: code,
        FID_INPUT_HOUR_1: '300', FID_PW_DATA_INCU_YN: 'Y', FID_ETC_CLS_CODE: mode });
    }
    await get('FHPUP02110200', 'inquire-index-timeprice', { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: code, FID_INPUT_HOUR_1: '300' });
    await get('FHKUP03500100', 'inquire-daily-indexchartprice', { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: code,
      FID_INPUT_DATE_1: '20261001', FID_INPUT_DATE_2: '20261023', FID_PERIOD_DIV_CODE: 'D' });
    await get('FHPUP02120000', 'inquire-index-daily-price', { FID_COND_MRKT_DIV_CODE: 'U', FID_INPUT_ISCD: code,
      FID_INPUT_DATE_1: '20261023', FID_PERIOD_DIV_CODE: 'D' });
  }
  const output = path.join(__dirname, '../logs/kis-index-turnover-probe-20261025.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`Saved ${output}`);
}
main().catch(e => { console.error(JSON.stringify({ error: e.response?.data?.msg1 || e.response?.data?.error_description || e.code || 'Diagnostic failed' })); process.exitCode = 1; });
