console.log("🚀 [v7-Diagnostic] app.js with deep UI debugging loaded!");
window.onerror = function (msg, url, line, col, error) {
    alert("⚠️ 자바스크립트 에러 발생:\n" + msg + "\n위치: " + line + ":" + col);
    return false;
};

const API_URL = '/api/stock';

// --- Tab & State Constants ---
const STORAGE_KEY = 'MultiChart_State_v1';
const MEMO_PENDING_SYNC_KEY = 'memoPendingServerSyncV1';
const PERM_TAB_ID = 'tab_rank';
const MEMO_TAB_ID = 'tab_memo';
const EARNINGS_TAB_ID = 'tab_earnings';
const US_TAB_ID = 'tab_us';
const BASE_INTEREST_TAB_ID = 'tab_base_interest';
const BASE_INTEREST_SOURCES = [
    { id: 'cbrates', name: 'CBRates', url: 'https://www.cbrates.com/' },
    { id: 'te', name: 'Trading Economics', url: 'https://ko.tradingeconomics.com/country-list/interest-rate' }
];
const BASE_INTEREST_LINKS_VERSION = "csv-2026-10-18";
const BASE_INTEREST_DEFAULT_LINKS = [
    {
        "continent": "미주",
        "country": "미국",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.US",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.US",
            "https://www.federalreserve.gov/monetarypolicy/openmarket.htm",
            "https://fred.stlouisfed.org/series/EFFR",
            "https://fred.stlouisfed.org/series/FEDFUNDS"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 미국의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - FOMC가 결정하는 연방기금금리 목표범위",
            "추가지표 - 실제 거래를 바탕으로 산출되는 실효 연방기금금리",
            "추가지표 - 실효 연방기금금리의 월평균 시계열"
        ]
    },
    {
        "continent": "미주",
        "country": "캐나다",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.CA",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.CA",
            "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/",
            "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 캐나다의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 캐나다 중앙은행이 설정하는 익일물 금리 목표",
            "추가지표 - 은행금리(Bank Rate) 및 익일물 금리 목표 정보"
        ]
    },
    {
        "continent": "미주",
        "country": "멕시코",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.MX",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.MX",
            "https://www.banxico.org.mx/publicaciones-y-prensa/anuncios-de-las-decisiones-de-politica-monetaria/anuncios-politica-monetaria-t.html"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 멕시코의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 중앙은행이 결정하는 익일물 은행 간 금리 목표"
        ]
    },
    {
        "continent": "미주",
        "country": "브라질",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.BR",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.BR",
            "https://www.bcb.gov.br/controleinflacao/historicotaxasjuros",
            "https://www.bcb.gov.br/en/monetarypolicy/interestrates"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 브라질의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - COPOM이 결정하는 Selic 목표금리의 변경 이력",
            "추가지표 - Selic 관련 금리 자료. 목표금리와 실효금리를 구분"
        ]
    },
    {
        "continent": "미주",
        "country": "칠레",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.CL",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.CL",
            "https://www.bcentral.cl/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 칠레의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 칠레 중앙은행의 통화정책금리(TPM) 관련 자료"
        ]
    },
    {
        "continent": "남미",
        "country": "아르헨티나",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.AR",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.AR",
            "https://www.bcra.gob.ar/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 아르헨티나의 장기 정책금리. 최신 관측치 확인 필요",
            "공식 정책금리 - 아르헨티나 중앙은행의 통화정책 및 금리 관련 자료"
        ]
    },
    {
        "continent": "유럽",
        "country": "유로존",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.XM",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.XM",
            "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html",
            "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html",
            "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 유로존의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - ECB 주요 정책금리의 공식 자료",
            "추가지표 - 예금제도 금리(DFR). 은행이 ECB에 예치하는 자금에 적용되는 금리",
            "추가지표 - 주요 재융자금리(MRO)"
        ]
    },
    {
        "continent": "유럽",
        "country": "영국",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.GB",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.GB",
            "https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 영국의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 영란은행의 Bank Rate"
        ]
    },
    {
        "continent": "유럽",
        "country": "스위스",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.CH",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.CH",
            "https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 스위스의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - SNB Policy Rate 관련 공식 자료"
        ]
    },
    {
        "continent": "유럽",
        "country": "노르웨이",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.NO",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.NO",
            "https://www.norges-bank.no/en/topics/Monetary-policy/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 노르웨이의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 노르웨이 중앙은행의 정책금리 관련 자료"
        ]
    },
    {
        "continent": "유럽",
        "country": "덴마크",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.DK",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.DK",
            "https://www.nationalbanken.dk/en/what-we-do/stable-prices-monetary-policy-and-the-danish-economy"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 덴마크의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 덴마크 중앙은행의 통화정책 운용금리 관련 자료"
        ]
    },
    {
        "continent": "유럽",
        "country": "스웨덴",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.SE",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.SE",
            "https://www.riksbank.se/en-gb/monetary-policy/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 스웨덴의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 스웨덴 중앙은행의 Policy Rate"
        ]
    },
    {
        "continent": "유럽·유라시아",
        "country": "러시아",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.RU",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.RU",
            "https://www.cbr.ru/eng/hd_base/KeyRate/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 러시아의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 러시아 중앙은행 Key Rate 변경 이력"
        ]
    },
    {
        "continent": "유럽·유라시아",
        "country": "터키",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.TR",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.TR",
            "https://www.tcmb.gov.tr/wps/wcm/connect/EN/TCMB+EN/Main+Menu/Core+Functions/Monetary+Policy/Central+Bank+Interest+Rates/",
            "https://www.tcmb.gov.tr/wps/wcm/connect/EN/TCMB+EN/Main+Menu/Core+Functions/Monetary+Policy/Central+Bank+Interest+Rates/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 터키의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 터키 중앙은행의 정책금리 및 운용금리 자료",
            "추가지표 - 중앙은행 금리 통로의 익일물 차입금리 및 대출금리"
        ]
    },
    {
        "continent": "아시아",
        "country": "대한민국",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.KR",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.KR",
            "https://www.bok.or.kr/portal/singl/baseRate/list.do?menuNo=200761"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 대한민국의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 한국은행 기준금리 변경 이력"
        ]
    },
    {
        "continent": "아시아",
        "country": "일본",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.JP",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.JP",
            "https://www.boj.or.jp/en/mopo/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 일본의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 일본은행의 통화정책 결정 및 정책금리 자료"
        ]
    },
    {
        "continent": "아시아",
        "country": "중국",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.CN",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.CN",
            "https://www.pbc.gov.cn/en/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 중국의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 중국인민은행의 통화정책 및 정책금리 자료"
        ]
    },
    {
        "continent": "아시아",
        "country": "인도",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.IN",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.IN",
            "https://www.rbi.org.in/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 인도의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 인도중앙은행의 정책 레포금리 등 통화정책 자료"
        ]
    },
    {
        "continent": "오세아니아",
        "country": "호주",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.AU",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.AU",
            "https://www.rba.gov.au/statistics/cash-rate/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 호주의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 호주중앙은행의 Cash Rate Target 통계"
        ]
    },
    {
        "continent": "오세아니아",
        "country": "뉴질랜드",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.NZ",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.NZ",
            "https://www.rbnz.govt.nz/monetary-policy"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 뉴질랜드의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 뉴질랜드 중앙은행의 Official Cash Rate(OCR) 자료"
        ]
    },
    {
        "continent": "아시아",
        "country": "인도네시아",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.ID",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.ID",
            "https://www.bi.go.id/en/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 인도네시아의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 인도네시아 중앙은행의 BI-Rate 등 통화정책 자료"
        ]
    },
    {
        "continent": "아시아",
        "country": "말레이시아",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.MY",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.MY",
            "https://www.bnm.gov.my/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 말레이시아의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 말레이시아 중앙은행의 Overnight Policy Rate(OPR) 자료"
        ]
    },
    {
        "continent": "아시아",
        "country": "필리핀",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.PH",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.PH",
            "https://www.bsp.gov.ph/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 필리핀의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 필리핀 중앙은행의 통화정책 및 익일물 역레포 정책금리 자료"
        ]
    },
    {
        "continent": "아시아",
        "country": "태국",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.TH",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.TH",
            "https://www.bot.or.th/en/our-roles/monetary-policy.html"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 태국의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 태국 중앙은행의 1일물 환매조건부채권 정책금리 자료"
        ]
    },
    {
        "continent": "아시아",
        "country": "싱가포르",
        "url": "https://www.mas.gov.sg/monetary-policy",
        "urls": [
            "https://www.mas.gov.sg/monetary-policy",
            "https://eservices.mas.gov.sg/statistics/dir/DomesticInterestRates.aspx"
        ],
        "urlNotes": [
            "공식 정책금리 - 싱가포르 통화청의 환율 중심 통화정책 운용체계. 단일 정책금리와 구분",
            "추가지표 - SORA 등 싱가포르 국내 시장금리 통계"
        ]
    },
    {
        "continent": "아프리카",
        "country": "남아프리카공화국",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.ZA",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.ZA",
            "https://www.resbank.co.za/en/home/what-we-do/monetary-policy"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 남아프리카공화국의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 남아프리카공화국 중앙은행의 Repo Rate 자료"
        ]
    },
    {
        "continent": "중동",
        "country": "이스라엘",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.IL",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.IL",
            "https://www.boi.org.il/en/economic-roles/monetary-policy/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 이스라엘의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 이스라엘 중앙은행의 정책금리 자료"
        ]
    },
    {
        "continent": "중동",
        "country": "쿠웨이트",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.KW",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.KW",
            "https://www.cbk.gov.kw/en/"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 쿠웨이트의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 쿠웨이트 중앙은행의 할인율 등 통화정책 운용금리 자료"
        ]
    },
    {
        "continent": "중동",
        "country": "사우디아라비아",
        "url": "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.SA",
        "urls": [
            "https://data.bis.org/topics/CBPOL/BIS%2CWS_CBPOL%2C1.0/M.SA",
            "https://sama.gov.sa/en-US/MonetaryPolicy/MonetaryPolicyTools/Pages/RepoRate.aspx",
            "https://sama.gov.sa/en-US/MonetaryPolicy/MonetaryPolicyTools/pages/reversereporate.aspx"
        ],
        "urlNotes": [
            "BIS 장기 시계열 - 사우디아라비아의 장기 정책금리. 국가 간 장기 비교용",
            "공식 정책금리 - 사우디 중앙은행의 Repo Rate",
            "추가지표 - 사우디 중앙은행의 Reverse Repo Rate"
        ]
    }
];
let isInitializing = false; // Flag to prevent auto-save during startup
let isCapturing = false; // Flag to suppress all data-fetching during screenshot capture
let quillEditor; // Global Quill instance
let currentAuthUser = null;
// TradingEconomics 요청은 서버가 Chrome을 띄워 처리하므로, 한 번에 1개씩만 보낸다
let teRequestChain = Promise.resolve();
function queueTeRequest(task) {
    const result = teRequestChain.then(task);
    teRequestChain = result.catch(() => { });
    return result;
}

/**
 * ===== GOOGLE AUTHENTICATION & CALENDAR API =====
 */
const GOOGLE_CLIENT_ID = "218429663028-l66pfc3i804uec317arj717r1hrf519u.apps.googleusercontent.com";
const CALENDAR_SCOPE = "openid email https://www.googleapis.com/auth/calendar.events";
let tokenClient;
let accessToken = null;
let calendar = null;
let tokenErrorCallback = null;

async function acceptCalendarAccessToken(tokenResponse) {
    if (!tokenResponse?.access_token) throw new Error('Google Calendar 접근 토큰을 받지 못했습니다.');
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': `Bearer ${tokenResponse.access_token}` }
    });
    if (!profileResponse.ok) throw new Error('Google Calendar 계정을 확인하지 못했습니다.');
    const profile = await profileResponse.json();
    const calendarEmail = String(profile.email || '').trim().toLowerCase();
    const appEmail = String(currentAuthUser?.email || '').trim().toLowerCase();
    if (!profile.email_verified || !calendarEmail || (appEmail && calendarEmail !== appEmail)) {
        throw new Error('서비스 로그인에 사용한 Google 계정으로 캘린더 권한을 승인해 주세요.');
    }
    accessToken = tokenResponse.access_token;
}

window.handleCredentialResponse = async function (response) {
    const errorEl = document.getElementById('loginError');
    if (errorEl) errorEl.textContent = '';
    try {
        const loginResponse = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        });
        const result = await loginResponse.json();
        if (!loginResponse.ok || !result.success) throw new Error(result.error || 'Google 로그인에 실패했습니다.');
        localStorage.removeItem('user_session');
        location.reload();
    } catch (error) {
        console.error('[Auth] Sign-in rejected:', error);
        if (errorEl) errorEl.textContent = error.message;
    }
};

function initTokenClient() {
    if (typeof google === 'undefined') return;
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: CALENDAR_SCOPE,
        login_hint: currentAuthUser?.email,
        callback: async (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                try {
                    await acceptCalendarAccessToken(tokenResponse);
                    tokenErrorCallback = null;
                    console.log("🎟️ Calendar Access Token Acquired");
                    setCalendarSyncStatus('Google 캘린더 동기화 중…');
                    if (calendar) calendar.refetchEvents();
                } catch (error) {
                    accessToken = null;
                    const reject = tokenErrorCallback;
                    tokenErrorCallback = null;
                    if (reject) reject(error);
                    else console.error('[Calendar] Account verification failed:', error);
                }
            } else if (tokenErrorCallback) {
                const reject = tokenErrorCallback;
                tokenErrorCallback = null;
                reject(new Error(tokenResponse?.error_description || tokenResponse?.error || 'Google 인증이 완료되지 않았습니다.'));
            }
        },
        error_callback: (error) => {
            const reject = tokenErrorCallback;
            tokenErrorCallback = null;
            if (reject) reject(new Error(error?.message || error?.type || 'Google 인증 창을 열지 못했습니다.'));
            else console.error('❌ Google OAuth popup error:', error);
        },
    });
}

function requestCalendarAccess(callback, onError) {
    if (accessToken) {
        if (callback) callback();
        return;
    }

    // Check if library is loaded
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        console.warn("⏳ Google GIS library not ready, retrying in 500ms...");
        setTimeout(() => requestCalendarAccess(callback, onError), 500);
        return;
    }

    if (!tokenClient) initTokenClient();

    // Safety check after init attempt
    if (!tokenClient) {
        console.error("❌ Failed to initialize tokenClient");
        if (onError) onError(new Error('Google 인증을 초기화하지 못했습니다.'));
        return;
    }

    tokenClient.callback = async (resp) => {
        if (resp.access_token) {
            try {
                await acceptCalendarAccessToken(resp);
                tokenErrorCallback = null;
                console.log("🎟️ Calendar Access Token Acquired");
                if (callback) callback();
            } catch (error) {
                accessToken = null;
                tokenErrorCallback = null;
                if (onError) onError(error);
                else console.error('[Calendar] Account verification failed:', error);
            }
        } else if (onError) {
            tokenErrorCallback = null;
            onError(new Error(resp.error_description || resp.error || 'Google 인증이 완료되지 않았습니다.'));
        }
    };
    tokenErrorCallback = onError || null;
    try {
        // Ask for consent only when needed; do not force the consent dialog every login.
        tokenClient.requestAccessToken({ prompt: '', login_hint: currentAuthUser?.email });
    } catch (error) {
        tokenErrorCallback = null;
        if (onError) onError(error);
        else console.error('❌ Google Calendar authorization failed:', error);
    }
}

function requestCalendarAccessAsync() {
    return new Promise((resolve, reject) => requestCalendarAccess(resolve, reject));
}

async function requestCalendarWithReauth(request) {
    const response = await request();
    const responses = Array.isArray(response) ? response : [response];
    if (!responses.some(item => item && item.status === 401)) return response;

    accessToken = null;
    await requestCalendarAccessAsync();
    return request();
}

function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

function unlockApp(user = null) {
    const loginOverlay = document.getElementById('loginOverlay');
    const tabContainer = document.getElementById('tabContainer');
    const tabContents = document.getElementById('tabContents');

    if (user) currentAuthUser = user;
    if (loginOverlay) loginOverlay.style.display = 'none';
    if (tabContainer) tabContainer.style.display = 'flex';
    if (tabContents) tabContents.style.display = 'block';
    console.log("🚀 App Unlocked & Ready");
}

function setCalendarSyncStatus(message, isError = false) {
    const status = document.getElementById('calendarSyncStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
}

function startCalendarSyncAfterLogin() {
    if (!currentAuthUser) return;
    if (!calendar) initCalendar();
    setCalendarSyncStatus('Google 캘린더 동기화 중…');
    requestCalendarAccess(
        () => {
            setCalendarSyncStatus('Google 캘린더 동기화 중…');
            if (calendar) calendar.refetchEvents();
        },
        (error) => {
            console.warn('[Calendar] Automatic authorization did not complete:', error);
            setCalendarSyncStatus('캘린더 권한이 필요합니다. 동기화 버튼으로 다시 시도해 주세요.', true);
        }
    );
}

// Initialize Google Identity Services programmatically
window.onload = function () {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleCredentialResponse,
            auto_select: false,
            itp_support: true // Improved support for Intelligent Tracking Prevention
        });

        const loginBtnDiv = document.getElementById("g_id_signin_button");
        if (loginBtnDiv) {
            google.accounts.id.renderButton(
                loginBtnDiv,
                {
                    theme: "filled_blue",
                    size: "large",
                    shape: "rectangular",
                    text: "signin_with",
                    logo_alignment: "left"
                }
            );
        }
    }
};

/**
 * ===== FULLCALENDAR INITIALIZATION =====
 */
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl || calendar) return;

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek'
        },
        dayCellClassNames: function (arg) {
            const dateStr = arg.date.toISOString().split('T')[0];
            if (window.holidayDates && window.holidayDates.has(dateStr)) {
                return ['fc-day-holiday'];
            }
            return [];
        },
        dayCellContent: function (e) {
            return e.dayNumberText.replace('일', '');
        },
        displayEventTime: true,
        eventTimeFormat: {
            hour: '2-digit',
            minute: '2-digit',
            meridiem: false,
            hour12: false
        },
        locale: 'ko', // Korean orientation
        firstDay: 1, // Start on Monday
        themeSystem: 'standard',
        height: 'auto',
        contentHeight: 'auto',
        aspectRatio: 1.35,
        handleWindowResize: true,
        expandRows: true,
        stickyHeaderDates: true,
        editable: true,
        selectable: true,
        events: fetchCalendarEvents,
        dateClick: function (info) {
            openEventModal(info.dateStr);
        },
        eventClick: function (info) {
            openEventModal(null, info.event);
            info.jsEvent.preventDefault();
        }
    });

    calendar.render();
}

async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
    if (!accessToken) {
        successCallback([]);
        return;
    }

    try {
        const start = fetchInfo.start.toISOString();
        const end = fetchInfo.end.toISOString();

        // Fetch Primary Events
        const primaryUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${start}&timeMax=${end}&singleEvents=true`;
        // Fetch Korean Holidays
        const holidayUrl = `https://www.googleapis.com/calendar/v3/calendars/ko.south_korea%23holiday%40group.v.calendar.google.com/events?timeMin=${start}&timeMax=${end}&singleEvents=true`;

        const [primaryRes, holidayRes] = await requestCalendarWithReauth(() => Promise.all([
            fetch(primaryUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } }),
            fetch(holidayUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } })
        ]));

        if (!primaryRes.ok || !holidayRes.ok) {
            throw new Error(`Google Calendar 조회 실패 (primary=${primaryRes.status}, holiday=${holidayRes.status})`);
        }

        const [primaryData, holidayData] = await Promise.all([
            primaryRes.json(),
            holidayRes.json()
        ]);

        const primaryEvents = (primaryData.items || []).map(item => ({
            id: item.id,
            title: item.summary || '(제목 없음)',
            start: item.start.dateTime || item.start.date,
            end: item.end.dateTime || item.end.date,
            url: item.htmlLink,
            extendedProps: { description: item.description || '' },
            allDay: !item.start.dateTime,
            editable: true
        }));

        const holidayEvents = (holidayData.items || []).map(item => {
            const date = item.start.date;
            if (!window.holidayDates) window.holidayDates = new Set();
            window.holidayDates.add(date);

            return {
                id: item.id,
                title: `🚩 ${item.summary}`,
                start: date,
                end: item.end.date,
                allDay: true,
                display: 'block',
                backgroundColor: '#fee2e2',
                borderColor: '#ef4444',
                textColor: '#b91c1c',
                editable: false,
                extendedProps: { isHoliday: true }
            };
        });

        successCallback([...primaryEvents, ...holidayEvents]);
        setCalendarSyncStatus('동기화 완료');
    } catch (error) {
        console.error("❌ Calendar fetch error:", error);
        setCalendarSyncStatus('동기화에 실패했습니다. 동기화 버튼으로 다시 시도해 주세요.', true);
        failureCallback(error);
    }
}

/**
 * ===== EVENT MODAL LOGIC =====
 */
function openEventModal(dateStr, event = null) {
    const modal = document.getElementById('eventModal');
    const startInput = document.getElementById('eventStartDate');
    const titleInput = document.getElementById('eventTitle');
    const deleteBtn = document.getElementById('deleteEvent');

    if (!modal || !startInput) return;

    // Reset Modal State
    modal.dataset.eventId = event ? event.id : '';
    titleInput.value = event ? event.title : '';
    document.getElementById('eventDescription').value = event ? (event.extendedProps.description || '') : '';

    if (event) {
        // Edit Mode
        const start = event.start;
        const end = event.end || event.start;

        startInput.value = formatDateForInput(start);
        document.getElementById('eventStartTime').value = formatTimeForInput(start);
        document.getElementById('eventEndDate').value = formatDateForInput(end);
        document.getElementById('eventEndTime').value = formatTimeForInput(end || start);
        document.getElementById('eventAllDay').checked = event.allDay;

        deleteBtn.style.display = event.extendedProps.isHoliday ? 'none' : 'block';
        document.getElementById('saveEvent').style.display = event.extendedProps.isHoliday ? 'none' : 'block';
        document.getElementById('eventTitle').disabled = event.extendedProps.isHoliday;
    } else {
        // Create Mode
        startInput.value = dateStr;
        document.getElementById('eventStartTime').value = '09:00';
        document.getElementById('eventAllDay').checked = false;
        deleteBtn.style.display = 'none';
        document.getElementById('saveEvent').style.display = 'block';
        document.getElementById('eventTitle').disabled = false;
    }

    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

function formatDateForInput(date) {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
}

function formatTimeForInput(date) {
    const d = new Date(date);
    return d.toTimeString().split(' ')[0].slice(0, 5);
}

function closeEventModal() {
    const modal = document.getElementById('eventModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

async function saveGoogleEvent() {
    const modal = document.getElementById('eventModal');
    const eventId = modal.dataset.eventId;
    const title = document.getElementById('eventTitle').value;
    const description = document.getElementById('eventDescription').value;
    const startDate = document.getElementById('eventStartDate').value;
    const startTime = document.getElementById('eventStartTime').value;
    const isAllDay = document.getElementById('eventAllDay').checked;

    // Support for multiple days
    const endDate = document.getElementById('eventEndDate').value || startDate;
    const endTime = document.getElementById('eventEndTime').value || startTime;

    if (!title) {
        alert("일정 제목을 입력해주세요.");
        return;
    }

    if (!accessToken) {
        requestCalendarAccess(saveGoogleEvent);
        return;
    }

    const eventData = {
        summary: title,
        description: description,
        start: isAllDay ? { date: startDate } : { dateTime: `${startDate}T${startTime}:00`, timeZone: 'Asia/Seoul' },
        end: isAllDay ? { date: endDate } : { dateTime: `${endDate}T${endTime}:00`, timeZone: 'Asia/Seoul' }
    };

    try {
        const url = eventId
            ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`
            : 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
        const method = eventId ? 'PUT' : 'POST';

        const response = await requestCalendarWithReauth(() => fetch(url, {
            method: method,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(eventData)
        }));

        if (response.ok) {
            console.log(`✅ Event ${eventId ? 'updated' : 'created'} successfully`);
            closeEventModal();
            if (calendar) calendar.refetchEvents();
        } else {
            const err = await response.json();
            console.error("❌ Save error:", err);
            alert("일정 저장에 실패했습니다.");
        }
    } catch (error) {
        console.error("❌ Save error:", error);
    }
}

async function deleteGoogleEvent() {
    const modal = document.getElementById('eventModal');
    const eventId = modal.dataset.eventId;

    if (!eventId) return;
    if (!confirm("이 일정을 삭제하시겠습니까?")) return;

    if (!accessToken) {
        requestCalendarAccess(deleteGoogleEvent);
        return;
    }

    try {
        const response = await requestCalendarWithReauth(() => fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }));

        if (response.ok) {
            console.log("✅ Event deleted successfully");
            closeEventModal();
            if (calendar) calendar.refetchEvents();
        } else {
            console.error("❌ Delete error");
            alert("일정 삭제에 실패했습니다.");
        }
    } catch (error) {
        console.error("❌ Delete error:", error);
    }
}

// DOM Elements

const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const dataContainer = document.getElementById('dataContainer');
const tableBody = document.getElementById('tableBody');
const lastUpdate = document.getElementById('lastUpdate');
const statusText = document.getElementById('statusText');
const refreshIntervalSelect = document.getElementById('refreshInterval');
const manualRefreshBtn = document.getElementById('manualRefresh');
const globalRefreshBtn = document.getElementById('globalRefreshBtn');

const transactionBody = document.getElementById('transactionBody');
const mrktTpSelect = document.getElementById('mrktTp');
const stexTpSelect = document.getElementById('stexTp');

const watchlistBody = document.getElementById('watchlistBody');
const watchlistGroupSelect = document.getElementById('watchlistGroupSelect');
const watchlistGroupNameInput = document.getElementById('watchlistGroupNameInput');

// --- State Variables ---
let tabData = {};
let activeTabId = PERM_TAB_ID;

// --- Tab DOM Elements ---
const tabContainer = document.getElementById("tabContainer");
const tabsWrapper = document.getElementById("tabsWrapper"); // New wrapper for isolated scroll
const tabContents = document.getElementById("tabContents");
const addTabBtn = document.getElementById("addTabBtn");
// Sidebar preferences travel with the existing settings snapshot and backups.
let tabSidebarState = { collapsed: false, width: 220 };
const sidebarToggle = document.getElementById('sidebarToggle');
const tabSidebar = document.getElementById('tabSidebar');
const sidebarResize = document.getElementById('sidebarResize');
function applyTabSidebarSettings(settings) {
    const width = Number(settings?.width);
    tabSidebarState = {
        collapsed: settings?.collapsed === true,
        width: Number.isFinite(width) ? Math.min(480, Math.max(72, width)) : 220
    };
    document.documentElement.style.setProperty('--tab-sidebar-width', `${tabSidebarState.width}px`);
    document.body.classList.toggle('tab-sidebar-collapsed', tabSidebarState.collapsed);
    document.body.classList.toggle('tab-sidebar-compact', tabSidebarState.width < 140);
    tabSidebar.inert = tabSidebarState.collapsed;
    sidebarToggle.setAttribute('aria-expanded', String(!tabSidebarState.collapsed));
    sidebarToggle.title = tabSidebarState.collapsed ? '탭 사이드바 펼치기' : '탭 사이드바 접기';
    sidebarToggle.setAttribute('aria-label', sidebarToggle.title);
    sidebarResize.setAttribute('aria-valuenow', String(tabSidebarState.width));
    window.dispatchEvent(new Event('resize'));
}
sidebarToggle.addEventListener('click', () => {
    applyTabSidebarSettings({ ...tabSidebarState, collapsed: !tabSidebarState.collapsed });
    saveAppData();
});
let sidebarDrag = null;
sidebarResize.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    sidebarDrag = { x: event.clientX, width: tabSidebarState.width };
    sidebarResize.setPointerCapture(event.pointerId);
    document.body.classList.add('sidebar-resizing');
});
sidebarResize.addEventListener('pointermove', event => {
    if (!sidebarDrag) return;
    applyTabSidebarSettings({ ...tabSidebarState, width: sidebarDrag.width + event.clientX - sidebarDrag.x });
});
function finishSidebarResize() {
    if (!sidebarDrag) return;
    sidebarDrag = null;
    document.body.classList.remove('sidebar-resizing');
    saveAppData();
}
sidebarResize.addEventListener('pointerup', finishSidebarResize);
sidebarResize.addEventListener('pointercancel', finishSidebarResize);
sidebarResize.addEventListener('lostpointercapture', finishSidebarResize);
sidebarResize.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const width = event.key === 'Home' ? 72 : event.key === 'End' ? 480 : tabSidebarState.width + (event.key === 'ArrowLeft' ? -10 : 10);
    applyTabSidebarSettings({ ...tabSidebarState, width });
    saveAppData();
});
const captureAllBtn = document.getElementById("captureAllBtn");
if (captureAllBtn) {
    captureAllBtn.addEventListener('click', captureAllTabs);
}
const moreControlsBtn = document.getElementById("moreControlsBtn");
const contextMenu = document.getElementById("contextMenu");
const addTabMenu = document.getElementById("addTabMenu");

if (moreControlsBtn) {
    moreControlsBtn.addEventListener('click', (e) => {
        const controls = document.querySelector('.right-controls');
        if (controls) {
            controls.classList.toggle('show-all');
            e.stopPropagation();
        }
    });

    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
        const controls = document.querySelector('.right-controls');
        if (controls && controls.classList.contains('show-all') && !controls.contains(e.target)) {
            controls.classList.remove('show-all');
        }
    });
}

let currentConfigTabId = null; // Track which tab is being configured

let autoRefreshInterval = null;
// Default to '2' (10 minutes) as requested
let lastSavedSettings = { rankInterval: '2' };

/**
 * 상태 업데이트
 */
function updateStatus(status, message = '', data = {}) {
    const statusLabels = {
        waiting: '대기 중',
        loading: '로딩 중',
        success: '완료',
        error: '실패'
    };

    if (statusText) {
        statusText.textContent = statusLabels[status] || message || '대기 중';
    }

    if (data.start_time && statusText) {
        statusText.textContent += ` (Srv Start: ${data.start_time})`;
    }
}

/**
 * 시간 포맷팅
 */
function formatTime(date) {
    if (!date) return '-';
    const d = new Date(date);
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    return `${dateStr} ${timeStr}`;
}

/**
 * 숫자 포맷팅 (천 단위 콤마)
 */
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 등락률 포맷팅
 */
function formatChangeRate(rate) {
    const numRate = parseFloat(rate);
    if (isNaN(numRate)) return '-';

    const sign = numRate > 0 ? '+' : '';
    return `${sign}${numRate.toFixed(2)}%`;
}

/**
 * 등락률에 따른 CSS 클래스 반환
 */
function getPriceClass(rate) {
    const numRate = parseFloat(rate);
    if (isNaN(numRate) || numRate === 0) return 'price-neutral';
    return numRate > 0 ? 'price-up' : 'price-down';
}

/**
 * 테이블 렌더링
 */
function renderTable(data) {
    const stocks = Array.isArray(data) ? data : (data.data || data.output || []);

    if (!Array.isArray(stocks) || stocks.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                    데이터가 없습니다.
                </td>
            </tr>
        `;
        return;
    }

    console.log("📊 렌더링할 종목 데이터 예시:", stocks[0]);

    // 표시 항목 수를 20개로 제한하여 세로 길이 축소
    tableBody.innerHTML = stocks.slice(0, 20).map((stock, index) => {
        const changeRate = stock.base_comp_chgr || '0';
        let trdeAmtRaw = stock.trde_amt ? String(stock.trde_amt).replace(/[+,-]/g, '') : '0';
        let trdeAmtNum = parseInt(trdeAmtRaw) || 0;
        const trdeAmtMillion = trdeAmtNum;

        const marketLabel = stock.mkt_type || '-';

        return `
            <tr class="fade-in" ${window.rankChartRowAttributes(stock)}>
                <td class="align-right">${stock.bigd_rank || (index + 1)}</td>
                <td class="market-type">${marketLabel}</td>
                <td>
                    ${stock.stk_nm || '-'}
                </td>
                <td class="align-right num-cell ${getPriceClass(changeRate)}">
                    ${formatChangeRate(changeRate)}
                </td>
                <td class="align-right num-cell">${formatNumber(trdeAmtMillion)}</td>
                <td class="align-right num-cell">${stock.concentration_rate != null && Number.isFinite(Number(stock.concentration_rate)) ? `${Number(stock.concentration_rate)}%` : '-'}</td>
            </tr>
        `;
    }).join('');
}

/**
 * 한국투자증권(eFriend) 테이블 렌더링
 */
function renderEfriendTable(stocks) {
    const efriendTableBody = document.getElementById('efriendTableBody');
    if (!efriendTableBody) return;

    if (!Array.isArray(stocks) || stocks.length === 0) {
        efriendTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                    데이터가 없습니다.
                </td>
            </tr>
        `;
        return;
    }

    console.log("📊 eFriend 렌더링 데이터 예시:", stocks[0]);

    // 등락률 기준으로 내림차순 정렬 (prdy_ctrt)
    const sortedStocks = [...stocks].sort((a, b) => {
        const rateA = parseFloat(a.prdy_ctrt) || 0;
        const rateB = parseFloat(b.prdy_ctrt) || 0;
        return rateB - rateA;
    });

    efriendTableBody.innerHTML = sortedStocks.map((stock, index) => {
        const prdtName = stock.prdt_name || '-';
        const currentPrice = parseInt(stock.stck_prpr) || parseInt(stock.bfdy_clpr) || 0;
        const changeRate = stock.prdy_ctrt || '0.00';
        const tradActiveQty = parseInt(stock.trad_psbl_qty2) || 0;

        // 시장구분은 서버가 조회한 Kiwoom ka10100 결과만 표시한다.
        const marketLabel = stock.mkt_type || '-';

        // 매매가능금액 = 현재가 * 매매가능수량 (단위: 원)
        const tradActiveValue = currentPrice * tradActiveQty;

        return `
            <tr class="fade-in" ${window.rankChartRowAttributes(stock, true)}>
                <td class="align-right">${index + 1}</td>
                <td class="market-type align-center">${marketLabel}</td>
                <td>${prdtName}</td>
                <td class="align-right num-cell ${getPriceClass(changeRate)}">
                    ${formatChangeRate(changeRate)}
                </td>
                <td class="align-right num-cell ${tradActiveQty > 0 ? 'price-up' : ''}">${formatNumber(tradActiveQty)}</td>
                <td class="align-right num-cell">${formatNumber(tradActiveValue)}</td>
            </tr>
        `;
    }).join('');
}

/**
 * Transaction Rank 데이터 로드
 */
let transactionRankRequest = 0;
async function loadTransactionRank({ refreshMarketCharts = true, reportStatus = false } = {}) {
    if (isCapturing) { console.log('[Capture] loadTransactionRank() skipped (isCapturing)'); return; }
    if (refreshMarketCharts) {
        window.refreshRankAdrChart?.();
        window.refreshRankTurnoverChart?.();
    }
    if (reportStatus) updateStatus('loading', '거래대금 조회 중...');
    const mrktTp = mrktTpSelect.value;
    const stexTp = stexTpSelect.value;
    const request = ++transactionRankRequest;

    console.log(`fetching Transaction Rank (mrkt=${mrktTp}, stex=${stexTp})...`);

    try {
        const response = await fetch(`/api/transaction_rank?mrkt_tp=${mrktTp}&stex_tp=${stexTp}`);
        const result = await response.json();
        if (request !== transactionRankRequest) return;

        if (reportStatus) {
            if (result.success) {
                lastUpdate.textContent = formatTime(new Date());
                updateStatus('success', '거래대금 조회 완료');
            } else updateStatus('error', result.error || '거래대금 조회 실패');
        }

        console.log("Transaction Rank Raw Result:", result);

        if (result.success) {
            const items = result.items || [];
            console.log("Transaction Items:", items.length);

            if (items.length === 0) {
                transactionBody.innerHTML = `<tr><td colspan="6" class="align-center">데이터가 없습니다.</td></tr>`;
                window.refreshConcentrationChart?.();
                return;
            }

            // 표시 항목 수를 20개로 제한하여 세로 길이 축소
            transactionBody.innerHTML = items.slice(0, 20).map((stock, index) => {
                const changeRate = stock.fluc_rt || stock.base_comp_chgr || '0';
                const trdeAmtRaw = stock.trde_amt || stock.acml_tr_pbmn || '0';
                const trdeAmtNum = parseInt(String(trdeAmtRaw).replace(/[^0-9]/g, '')) || 0;
                const trdeAmtMillion = (trdeAmtNum > 100000000) ? Math.round(trdeAmtNum / 1000000) : trdeAmtNum;

                const marketLabel = stock.mkt_type || '-';

                return `
                    <tr class="fade-in" ${window.rankChartRowAttributes(stock)}>
                        <td class="align-right">${stock.rank || (index + 1)}</td>
                        <td class="market-type">${marketLabel}</td>
                        <td title="${stock.stk_nm || stock.isu_nm || '-'}">${stock.stk_nm || stock.isu_nm || '-'}</td>
                        <td class="align-right num-cell ${getPriceClass(changeRate)}">
                            ${formatChangeRate(changeRate)}
                        </td>
                        <td class="align-right num-cell">${formatNumber(trdeAmtMillion)}</td>
                        <td class="align-right num-cell">${stock.concentration_rate != null && Number.isFinite(Number(stock.concentration_rate)) ? `${Number(stock.concentration_rate)}%` : '-'}</td>
                    </tr>
                `;
            }).join('');

            const firstStock = items[0];
            const firstCode = String(firstStock.stk_cd || '').replace(/_(AL|NX)$/i, '');
            if (!window.getRankChartState?.()?.selection && /^[0-9A-Za-z]{6}$/.test(firstCode)) {
                window.selectRankChartStock?.({
                    code: firstCode,
                    name: firstStock.stk_nm || firstStock.isu_nm || firstCode,
                    market: firstStock.mkt_type
                });
            } else {
                window.refreshConcentrationChart?.();
            }

        } else {
            if (document.querySelector('.tab-content.active')?.id === PERM_TAB_ID) {
                console.error("Trans Rank Error:", result.error);
                transactionBody.innerHTML = `<tr><td colspan="6" class="align-center error">통신 오류</td></tr>`;
            } else {
                console.warn('[Rank] 거래대금 백그라운드 갱신 실패 (UI 억제됨):', result.error);
            }
        }
    } catch (e) {
        if (request !== transactionRankRequest) return;
        if (reportStatus) updateStatus('error', '거래대금 조회 실패');
        if (document.querySelector('.tab-content.active')?.id === PERM_TAB_ID) {
            console.error("Trans Rank Fetch Fail:", e);
            transactionBody.innerHTML = `<tr><td colspan="6" class="align-center error">통신 오류</td></tr>`;
        } else {
            console.warn('[Rank] 거래대금 백그라운드 갱신 실패 (UI 억제됨):', e.message);
        }
    }
}

/**
 * 관심종목 하락률 순위 테이블 렌더링
 */
function renderWatchlistTable(stocks) {
    const tbody = document.getElementById('watchlistBody');
    if (!tbody) return;

    if (!Array.isArray(stocks) || stocks.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                    데이터가 없습니다.
                </td>
            </tr>
        `;
        return;
    }

    // 2. 하락등락률이 큰 순서대로 보여줘 (오름차순: 가장 큰 마이너스 등락률부터)
    const sortedStocks = [...stocks].sort((a, b) => {
        const rateA = parseFloat(a.fluc_rt || a.flu_rt || a.base_comp_chgr || a.prdy_ctrt || 0);
        const rateB = parseFloat(b.fluc_rt || b.flu_rt || b.base_comp_chgr || b.prdy_ctrt || 0);
        return rateA - rateB;
    });

    tbody.innerHTML = sortedStocks.slice(0, 20).map((stock, index) => {
        const changeRate = stock.fluc_rt || stock.flu_rt || stock.base_comp_chgr || stock.prdy_ctrt || '0';
        let trdeAmtRaw = stock.trde_amt || stock.trde_prica || stock.acml_tr_pbmn || '0';
        let trdeAmtNum = parseInt(String(trdeAmtRaw).replace(/[^0-9]/g, '')) || 0;
        const trdeAmtMillion = (trdeAmtNum > 100000000) ? Math.round(trdeAmtNum / 1000000) : trdeAmtNum;

        const marketLabel = stock.mkt_type || '-';

        return `
            <tr class="fade-in">
                <td class="align-right">${index + 1}</td>
                <td class="market-type">${marketLabel}</td>
                <td>${stock.stk_nm || stock.isu_nm || '-'}</td>
                <td class="align-right num-cell ${getPriceClass(changeRate)}">
                    ${formatChangeRate(changeRate)}
                </td>
                <td class="align-right num-cell">${formatNumber(trdeAmtMillion)}</td>
            </tr>
        `;
    }).join('');
}

/**
 * 관심종목 그룹 목록 로드
 */
async function loadWatchlistGroups() {
    try {
        const response = await fetch('/api/watchlist_groups');
        const result = await response.json();
        const select = document.getElementById('watchlistGroupSelect');
        const input = document.getElementById('watchlistGroupNameInput');

        const savedGrp = localStorage.getItem('watchlist_selected_group') || (input ? input.value.trim() : '') || '074';

        const groups = result.groups || [];
        if (result.success && Array.isArray(groups) && groups.length > 0) {
            const matched = groups.find(g => String(g.grp_id) === String(savedGrp) || String(g.grp_nm) === String(savedGrp));
            const selectedVal = matched ? matched.grp_id : savedGrp;

            if (select) {
                select.innerHTML = groups.map(g => `
                    <option value="${g.grp_id}" ${String(g.grp_id) === String(selectedVal) ? 'selected' : ''}>
                        ${g.grp_nm ? `${g.grp_nm} (${g.grp_id})` : g.grp_id}
                    </option>
                `).join('');

                if (!matched && savedGrp) {
                    const customOpt = document.createElement('option');
                    customOpt.value = savedGrp;
                    customOpt.textContent = `${savedGrp} (직접입력)`;
                    customOpt.selected = true;
                    customOpt.dataset.custom = 'true';
                    select.appendChild(customOpt);
                }
            }
            if (input && savedGrp) {
                input.value = savedGrp;
            }
        }
    } catch (e) {
        console.warn("[Watchlist] Failed to fetch groups:", e.message);
    }
}

/**
 * 관심종목 하락률 순위 데이터 로드
 */
async function loadWatchlistRank() {
    if (isCapturing) { console.log('[Capture] loadWatchlistRank() skipped (isCapturing)'); return; }

    const input = document.getElementById('watchlistGroupNameInput');
    const select = document.getElementById('watchlistGroupSelect');
    const tbody = document.getElementById('watchlistBody');
    if (!tbody) return;

    let grpId = (input && input.value.trim()) || (select && select.value) || '074';
    console.log(`[Watchlist] Fetching Watchlist Rank (grp_id=${grpId})...`);

    try {
        const response = await fetch(`/api/watchlist_rank?grp_id=${encodeURIComponent(grpId)}`);
        
        if (!response.ok) {
            let errorMsg = `HTTP ${response.status}`;
            try {
                const errJson = await response.json();
                if (errJson.error) errorMsg = errJson.error;
            } catch (e) {}
            if (document.querySelector('.tab-content.active')?.id === PERM_TAB_ID) {
                tbody.innerHTML = `<tr><td colspan="5" class="align-center error" style="padding: 2rem; color: #e74c3c;">조회 실패: ${errorMsg}</td></tr>`;
            } else {
                console.warn('[Rank] 관심종목 백그라운드 갱신 실패 (UI 억제됨):', errorMsg);
            }
            return;
        }

        const result = await response.json();

        if (result.success) {
            const items = result.items || [];
            console.log(`[Watchlist] Items loaded: ${items.length}`);
            renderWatchlistTable(items);
        } else {
            if (document.querySelector('.tab-content.active')?.id === PERM_TAB_ID) {
                console.error("[Watchlist] API Error:", result.error);
                tbody.innerHTML = `<tr><td colspan="5" class="align-center error" style="padding: 2rem; color: #e74c3c;">조회 실패: ${result.error || '통신 오류'}</td></tr>`;
            } else {
                console.warn('[Rank] 관심종목 백그라운드 갱신 실패 (UI 억제됨):', result.error || '통신 오류');
            }
        }
    } catch (e) {
        if (document.querySelector('.tab-content.active')?.id === PERM_TAB_ID) {
            console.error("[Watchlist] Fetch Fail:", e);
            tbody.innerHTML = `<tr><td colspan="5" class="align-center error" style="padding: 2rem; color: #e74c3c;">통신 오류: ${e.message}</td></tr>`;
        } else {
            console.warn('[Rank] 관심종목 백그라운드 갱신 실패 (UI 억제됨):', e.message);
        }
    }
}

/**
 * 데이터 로드
 */
async function loadData() {
    console.log('[TEST] loadData() 시작');    //Andrew
    if (isCapturing) { console.log('[Capture] loadData() skipped (isCapturing)'); return; }

    try {
        const activeTab = document.querySelector('.tab-content.active');
        const isRankActive = activeTab && activeTab.id === PERM_TAB_ID;

        if (errorMessage) errorMessage.style.display = 'none';
        updateStatus('loading', '데이터 로딩 중...');

        const selectedOption = refreshIntervalSelect.options[refreshIntervalSelect.selectedIndex];
        const qryTp = selectedOption.value;

console.log('[TEST] /api/stock 호출 직전:', `${API_URL}?qry_tp=${qryTp}`); //Andrew

        const response = await fetch(`${API_URL}?qry_tp=${qryTp}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            let errorMessageText = `HTTP ${response.status}: ${response.statusText}`;
            try {
                const errorJson = await response.json();
                if (errorJson.error) {
                    errorMessageText += ` (${errorJson.error})`;
                    if (errorJson.details) {
                        errorMessageText += ` - Details: ${JSON.stringify(errorJson.details)}`;
                    }
                }
            } catch (e) {
            }
            throw new Error(errorMessageText);
        }

        const result = await response.json();

console.log('[TEST] /api/stock 응답 완료:', response.status); //Andrew

        if (!result.success) {
            throw new Error(result.error || '알 수 없는 오류가 발생했습니다');
        }

        // result.data now contains { kiwoom: [], efriend: [] }
        if (result.data && typeof result.data === 'object' && result.data.kiwoom) {
            renderTable(result.data.kiwoom);
            renderEfriendTable(result.data.efriend || []);
        } else {
            // Fallback for older format just in case
            renderTable(result.data);
            renderEfriendTable([]);
        }

        dataContainer.style.display = 'block';
        const efriendDataContainer = document.getElementById('efriendDataContainer');
        if (efriendDataContainer) efriendDataContainer.style.display = 'block';
console.log('[TEST] lastUpdate 갱신:', formatTime(new Date()));//Andrew
        lastUpdate.textContent = formatTime(new Date());
        updateStatus('success', '데이터 로딩 완료');

    } catch (error) {
        console.error('데이터 로딩 실패:', error);

        const activeTab = document.querySelector('.tab-content.active');
        const isRankActive = activeTab && activeTab.id === PERM_TAB_ID;

        if (isRankActive) {
            if (errorMessage) errorMessage.style.display = 'flex';
            if (errorText) errorText.textContent = error.message;
            updateStatus('error', '데이터 로딩 실패');
        } else {
            console.warn('[Rank] 백그라운드 갱신 실패 (UI 억제됨):', error.message);
        }
    } finally {
    }
}

function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }

    const selectedOption = refreshIntervalSelect.options[refreshIntervalSelect.selectedIndex];
    const intervalMs = parseInt(selectedOption.dataset.interval) || 30000;

    console.log(`[Rank] 🔄 자동 새로고침 시작 (간격: ${intervalMs}ms, qry_tp: ${selectedOption.value})`);

    autoRefreshInterval = setInterval(() => {
        if (isCapturing) { console.log('[Capture] Auto-refresh skipped (isCapturing)'); return; }
        const now = new Date().toLocaleTimeString();
        console.log(`[Rank] ⚡ 자동 새로고침 실행 (${now})`);
        loadData();
        loadTransactionRank();
        loadWatchlistRank();
    }, intervalMs);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

refreshIntervalSelect.addEventListener('change', (e) => {
    console.log('[Rank] 새로고침 설정 변경');
    lastSavedSettings.rankInterval = e.target.value;
    loadData();
    loadTransactionRank();
    loadWatchlistRank();
    startAutoRefresh();
    saveAppData();
});

// manualRefreshBtn.addEventListener('click', () => {
//     console.log('수동 새로고침 실행');
//     loadData();
//     loadTransactionRank();
//     loadWatchlistRank();
// });

if (watchlistGroupSelect) {
    watchlistGroupSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (watchlistGroupNameInput) watchlistGroupNameInput.value = val;
        localStorage.setItem('watchlist_selected_group', val);
        saveAppData();
        loadWatchlistRank();
    });
}

if (watchlistGroupNameInput) {
    const handleWatchlistInputChange = () => {
        const val = watchlistGroupNameInput.value.trim();
        if (val) {
            localStorage.setItem('watchlist_selected_group', val);
            if (watchlistGroupSelect) {
                const opt = Array.from(watchlistGroupSelect.options).find(o => o.value === val);
                if (opt) {
                    watchlistGroupSelect.value = val;
                } else {
                    let customOpt = Array.from(watchlistGroupSelect.options).find(o => o.dataset.custom === 'true');
                    if (!customOpt) {
                        customOpt = document.createElement('option');
                        customOpt.dataset.custom = 'true';
                        watchlistGroupSelect.appendChild(customOpt);
                    }
                    customOpt.value = val;
                    customOpt.textContent = `${val} (직접입력)`;
                    watchlistGroupSelect.value = val;
                }
            }
            saveAppData();
            loadWatchlistRank();
        }
    };

    watchlistGroupNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleWatchlistInputChange();
            watchlistGroupNameInput.blur();
        }
    });
    watchlistGroupNameInput.addEventListener('change', handleWatchlistInputChange);
    watchlistGroupNameInput.addEventListener('blur', handleWatchlistInputChange);
}

if (globalRefreshBtn) {
    globalRefreshBtn.addEventListener('click', () => {
        refreshAllTabs();
    });
}

// 페이지 언로드 시 정리
window.addEventListener('pagehide', () => {
    stopAutoRefresh();
});
window.addEventListener('pageshow', event => { if (event.persisted) startAutoRefresh(); });

// ==========================================================
// Tab Management Logic
// ==========================================================

function ensurePermanentTabs() {
    if (!tabsWrapper) return;

    // Rank Tab
    if (!document.querySelector(`.tab-btn[data-tab="${PERM_TAB_ID}"]`)) {
        const btn = document.createElement('button');
        btn.className = 'tab-btn perm-tab';
        btn.dataset.tab = PERM_TAB_ID;
        btn.textContent = '트레이딩';
        btn.draggable = false;
        btn.dataset.perm = 'true';
        btn.title = '고정 탭 (조회 순위)';

        if (tabsWrapper.firstChild) tabsWrapper.insertBefore(btn, tabsWrapper.firstChild);
        else tabsWrapper.appendChild(btn);
    }

    // Memo Tab
    if (!document.querySelector(`.tab-btn[data-tab="${MEMO_TAB_ID}"]`)) {
        const btn = document.createElement('button');
        btn.className = 'tab-btn perm-tab';
        btn.dataset.tab = MEMO_TAB_ID;
        btn.textContent = '메모';
        btn.draggable = false;
        btn.dataset.perm = 'true';
        btn.title = '고정 탭 (메모)';
        btn.style.fontWeight = 'bold';

        const rankBtn = document.querySelector(`.tab-btn[data-tab="${PERM_TAB_ID}"]`);
        if (rankBtn && rankBtn.nextSibling) tabsWrapper.insertBefore(btn, rankBtn.nextSibling);
        else tabsWrapper.appendChild(btn);

        createTabContentElement(MEMO_TAB_ID);
    }
    // Earnings (증시캘린더) Tab
    let earningsBtn = document.querySelector(`.tab-btn[data-tab="${EARNINGS_TAB_ID}"]`);
    if (!earningsBtn) {
        earningsBtn = document.createElement('button');
        earningsBtn.className = 'tab-btn perm-tab';
        earningsBtn.dataset.tab = EARNINGS_TAB_ID;
        earningsBtn.draggable = false;
        earningsBtn.dataset.perm = 'true';

        const memoBtn = document.querySelector(`.tab-btn[data-tab="${MEMO_TAB_ID}"]`);
        if (memoBtn && memoBtn.nextSibling) tabsWrapper.insertBefore(earningsBtn, memoBtn.nextSibling);
        else tabsWrapper.appendChild(earningsBtn);

        createTabContentElement(EARNINGS_TAB_ID);
    }
    earningsBtn.textContent = '증시캘린더';
    earningsBtn.title = '고정 탭 (증시 캘린더)';
    let usBtn = document.querySelector(`.tab-btn[data-tab="${US_TAB_ID}"]`);
    if (!usBtn) {
        usBtn = document.createElement('button');
        usBtn.className = 'tab-btn perm-tab';
        usBtn.dataset.tab = US_TAB_ID;
        usBtn.dataset.perm = 'true';
        usBtn.draggable = false;
    }
    usBtn.textContent = '자본동향';
    usBtn.title = '고정 탭 (자본동향)';
    tabsWrapper.insertBefore(usBtn, earningsBtn.nextSibling);
    createTabContentElement(US_TAB_ID);
    let interestBtn = document.querySelector(`.tab-btn[data-tab="${BASE_INTEREST_TAB_ID}"]`);
    if (!interestBtn) {
        interestBtn = document.createElement('button');
        interestBtn.className = 'tab-btn perm-tab';
        interestBtn.dataset.tab = BASE_INTEREST_TAB_ID;
        interestBtn.dataset.perm = 'true';
        interestBtn.draggable = false;
    }
    interestBtn.textContent = '기준금리';
    interestBtn.title = '고정 탭 (기준금리)';
    tabsWrapper.insertBefore(interestBtn, usBtn.nextSibling);
    createTabContentElement(BASE_INTEREST_TAB_ID);
}

/**
 * 탭 이름 해석 및 안전 처리 함수
 * candidateName 또는 tabData[tabId].name을 기반으로 올바른 탭 이름을 반환
 */
function resolveTabName(tabId, candidateName = null, tabObj = null) {
    if (tabId === PERM_TAB_ID) return '트레이딩';
    if (tabId === MEMO_TAB_ID) {
        const memoName = (candidateName && typeof candidateName === 'string') ? candidateName.trim() : '';
        if (memoName && !memoName.includes('(복구)')) return memoName;
        const memoItem = tabObj || (typeof tabData !== 'undefined' ? tabData[tabId] : null);
        if (memoItem && typeof memoItem.name === 'string' && memoItem.name.trim() && !memoItem.name.includes('(복구)')) return memoItem.name.trim();
        return '메모';
    }
    if (tabId === BASE_INTEREST_TAB_ID) return '기준금리';
    if (tabId === EARNINGS_TAB_ID) return '증시캘린더';
    if (tabId === US_TAB_ID) return '자본동향';

    // 1. 이미 유효하고 '(복구)'가 없는 후보 이름인 경우
    if (candidateName && typeof candidateName === 'string' && !candidateName.includes("(복구)") && candidateName.trim() !== "") {
        return candidateName.trim();
    }

    // 2. tabObj 또는 tabData[tabId]에 유효한 name 속성이 있는 경우
    const item = tabObj || (typeof tabData !== 'undefined' ? tabData[tabId] : null);
    if (item && item.name && typeof item.name === 'string' && !item.name.includes("(복구)") && item.name.trim() !== "") {
        return item.name.trim();
    }

    // 3. item.config에서 첫 번째 섹션 헤더 <섹션명> 추출 시도 (예: <반도체>, <금리> 등)
    if (item && item.config) {
        const match = item.config.match(/<([^,>\n\r]+)(?:,[^>]+)?>/);
        if (match && match[1].trim()) {
            return match[1].trim();
        }
    }

    // 4. DOM 버튼 텍스트 확인 (단, '(복구)'가 없는 경우)
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (btn && btn.textContent && !btn.textContent.includes("(복구)") && btn.textContent.trim() !== "") {
        return btn.textContent.trim();
    }

    // 5. 차트 그리드 탭인 경우
    if (tabId && tabId.startsWith('tab_grid_')) {
        return "차트";
    }

    // 6. 최후 기본값 ('(복구)'라는 접미사는 절대 사용하지 않음)
    const type = item?.type;
    if (type === 'exchange_rate') return "금리/환율";
    if (type === 'overseas_custom') return "해외종목";

    if (candidateName && typeof candidateName === 'string') {
        const cleaned = candidateName.replace(/\(복구\)/g, '').trim();
        if (cleaned) return cleaned;
    }

    return "해외종목";
}

// Remove a legacy leading icon from the saved Memo tab title once. The marker
// is persisted with settings so later user renames (including emoji titles)
// remain unchanged on subsequent launches.
function migrateMemoTabIconOnce(data) {
    if (!data || data.memoTabIconMigrationV1) return false;

    const memoTab = Array.isArray(data.tabs) ? data.tabs.find(tab => tab.id === MEMO_TAB_ID) : null;
    const memoContent = data.contents && data.contents[MEMO_TAB_ID];
    const savedName = (memoTab && memoTab.name) || (memoContent && memoContent.name);
    if (typeof savedName === 'string' && savedName.trim()) {
        const cleanedName = savedName.trim().replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '');
        if (memoTab) memoTab.name = cleanedName;
        if (memoContent && typeof memoContent === 'object' && !Array.isArray(memoContent)) {
            memoContent.name = cleanedName;
        }
    }

    data.memoTabIconMigrationV1 = true;
    return true;
}

/**
 * 현재 애플리케이션의 전체 상태를 객체로 반환 (저장 및 내보내기용)
 */
function getSerializedState(sourceData = null) {
    const dataToSerialize = sourceData || tabData;
    const capturedTabs = [];
    document.querySelectorAll('.tab-btn:not(.add-tab-btn)').forEach(btn => {
        const id = btn.dataset.tab;
        const name = resolveTabName(id, btn.textContent, dataToSerialize[id]);
        capturedTabs.push({ id: id, name: name });
        if (dataToSerialize[id] && typeof dataToSerialize[id] === 'object' && !Array.isArray(dataToSerialize[id])) {
            dataToSerialize[id].name = name;
        }
    });

    // Fallback/Recover dynamic tabs from tabData
    Object.keys(dataToSerialize).forEach(key => {
        const item = dataToSerialize[key];
        const isDynamic = item && (item.type === 'overseas_custom' || item.type === 'exchange_rate' || Array.isArray(item));
        if (isDynamic && !capturedTabs.find(t => t.id === key)) {
            const name = resolveTabName(key, item?.name, item);
            capturedTabs.push({ id: key, name: name });
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                item.name = name;
            }
        }
    });

    const activeContent = document.querySelector('.tab-content.active');
    const activeTabId = activeContent ? activeContent.id : (capturedTabs.length > 0 ? capturedTabs[0].id : PERM_TAB_ID);

    // General application saves must use the last explicitly saved memo,
    // never the editor's potentially unsaved draft.
    const memoHtml = localStorage.getItem('memoContent_html') || '';
    let memoDelta = null;
    const savedDelta = localStorage.getItem('memoContent_delta');
    if (savedDelta) {
        try {
            memoDelta = JSON.parse(savedDelta);
        } catch (error) {
            console.warn('[Memo] Ignoring invalid locally saved Delta:', error);
        }
    }

    const watchlistInput = document.getElementById('watchlistGroupNameInput');
    const watchlistSelect = document.getElementById('watchlistGroupSelect');
    const watchlistGroupId = (watchlistInput && watchlistInput.value.trim()) || (watchlistSelect && watchlistSelect.value) || localStorage.getItem('watchlist_selected_group') || '074';

    return {
        activeTabId: activeTabId,
        tabs: capturedTabs,
        contents: dataToSerialize,
        rankInterval: refreshIntervalSelect ? refreshIntervalSelect.value : "2",
        watchlistGroupId: watchlistGroupId,
        tabSidebar: { ...tabSidebarState },
        rankChartDisplay: window.getConcentrationDisplaySettings?.() || { debugOpen: false, candleOpen: false, mode: 'day', interval: 1 },
        memoHtml: memoHtml,
        memoDelta: memoDelta,
        memoUpdatedAt: Number(localStorage.getItem('memoContent_updatedAt')) || 0,
        memoTabIconMigrationV1: true,
        updatedAt: Date.now()
    };
}

function saveAppData(overrideTabData = null) {
    if (isInitializing) return Promise.resolve(false);

    const storageData = getSerializedState(overrideTabData);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storageData));

    console.log("💾 데이터 로컬 저장 완료. updatedAt:", new Date(storageData.updatedAt).toLocaleString());

    // Sync to server (Return promise)
    return syncSettingsToServer(storageData);
}

async function syncSettingsToServer(data) {
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            throw new Error(`Server responded with ${response.status} ${response.statusText}`);
        }

        const resData = await response.json();
        if (resData.success) {
            console.log("☁️ 데이터 서버 동기화 완료");
            return true;
        } else {
            console.error("❌ 서버 동기화 실패 (Response false):", resData);
            alert("서버 저장 실패: " + (resData.error || "알 수 없는 오류"));
            return false;
        }
    } catch (e) {
        console.error("❌ 서버 동기화 실패:", e);
        alert("서버 저장 중 오류 발생: " + e.message);
        return false;
    }
}

function saveTabState(tabId) {
    const content = document.getElementById(tabId);
    if (!content || tabId === PERM_TAB_ID || tabId === EARNINGS_TAB_ID || tabId === BASE_INTEREST_TAB_ID || tabId === US_TAB_ID || tabId === MEMO_TAB_ID) return;

    // Special handling for dynamic overseas/exchange tabs: they don't use standard grid saving
    const type = tabData[tabId]?.type;
    if (type === 'overseas_custom' || type === 'exchange_rate') return;

    const boxes = content.querySelectorAll('.chart-box');
    const state = [];
    boxes.forEach(box => {
        const input = box.querySelector('.chart-input');
        const mainIframe = box.querySelector('.iframe-main');
        const subIframe = box.querySelector('.iframe-sub');
        const isSubMode = subIframe ? (window.getComputedStyle(subIframe).display !== 'none') : false;

        let currentMainSrc = (mainIframe && mainIframe.src) ? mainIframe.src : '';
        if (currentMainSrc === 'about:blank' || currentMainSrc === window.location.href) currentMainSrc = '';

        state.push({
            symbol: (input && input.value) ? input.value.trim() : 'KRX:KOSPI',
            lastSymbol: box.dataset.lastSymbol,
            mode: isSubMode ? 'sub' : 'main',
            mainSrc: currentMainSrc,
            subSrc: (subIframe && subIframe.src) ? subIframe.src : ''
        });
    });
    tabData[tabId] = state;
}

function loadFromLocalStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
        const data = JSON.parse(raw);
        if (!data.tabs || data.tabs.length === 0) return null;
        return data;
    } catch (e) {
        console.error("로컬 스토리지 로딩 실패:", e);
        return null;
    }
}

function loadFromSyncData(data) {
    if (!data || !data.tabs || data.tabs.length === 0) return false;
    applyData(data);
    return true;
}

async function loadAppDataFromServer() {
    try {
        console.log("☁️ 서버에서 설정 불러오는 중...");
        const response = await fetch(`/api/settings?_t=${Date.now()}`);
        const resData = await response.json();

        if (resData.success && resData.data) {
            console.log("✅ 서버 설정 로드 성공 (updatedAt):", resData.data.updatedAt);
            return resData.data;
        }
        return null;
    } catch (e) {
        console.error("❌ 서버 설정 로드 실패:", e);
        return null;
    }
}

// Ignore retired ADR tab settings in local, server and imported backups.
function removeRetiredAdrState(data) {
    if (!data || typeof data !== 'object') return data;
    const cleaned = { ...data };
    if (Array.isArray(data.tabs)) cleaned.tabs = data.tabs.filter(tab => tab.id !== 'tab_adr');
    if (data.contents) {
        cleaned.contents = { ...data.contents };
        delete cleaned.contents.tab_adr;
    }
    delete cleaned.adrInterval;
    if (cleaned.activeTabId === 'tab_adr') cleaned.activeTabId = PERM_TAB_ID;
    return cleaned;
}

function applyData(data) {
    applyTabSidebarSettings(data?.tabSidebar);
    data = removeRetiredAdrState(data);
    if (!data || !data.tabs) return;

    isInitializing = true; // Block auto-save during application
    const memoNameMigrationNeeded = migrateMemoTabIconOnce(data);
    try {
        window.applyConcentrationDisplaySettings?.(data.rankChartDisplay);
        ensurePermanentTabs(); // Always ensure permanent tabs first
        resetDynamicTabs();
        tabData = data.contents || {};
        window.USLinks.refresh();

        data.tabs.forEach(t => {
            const fixedName = resolveTabName(t.id, t.name, tabData[t.id]);
            t.name = fixedName;
            if (tabData[t.id] && typeof tabData[t.id] === 'object' && !Array.isArray(tabData[t.id])) {
                tabData[t.id].name = fixedName;
            }

            if (t.id === PERM_TAB_ID || t.id === EARNINGS_TAB_ID || t.id === BASE_INTEREST_TAB_ID || t.id === US_TAB_ID || t.id === MEMO_TAB_ID) {
                const btn = document.querySelector(`.tab-btn[data-tab="${t.id}"]`);
                if (btn) {
                    if (t.id === EARNINGS_TAB_ID) {
                        btn.textContent = '증시캘린더';
                        btn.title = '고정 탭 (증시 캘린더)';
                    } else {
                        btn.textContent = fixedName;
    btn.title = fixedName;
                    }
                }
                return;
            }
            createTabButtonElement(t.id, fixedName);
            createTabContentElement(t.id);
        });

        if (data.rankInterval) {
            lastSavedSettings.rankInterval = data.rankInterval;
            refreshIntervalSelect.value = data.rankInterval;
        } else {
            // Enforce default 10 min if not saved
            refreshIntervalSelect.value = '2';
            lastSavedSettings.rankInterval = '2';
        }
        startAutoRefresh();
        // Only switch tabs IF this is the INITIAL local load (when we don't have a specific trigger)
        // Manual refresh/sync should stay on the current tab (activeContent exists).
        const activeContent = document.querySelector('.tab-content.active');
        if (!activeContent) {
            const targetId = (data.activeTabId && document.getElementById(data.activeTabId)) ? data.activeTabId : PERM_TAB_ID;
            activateTab(targetId);
        }

        applyMemoState(data);

        // Restore Watchlist Group ID
        if (data.watchlistGroupId) {
            localStorage.setItem('watchlist_selected_group', data.watchlistGroupId);
            const input = document.getElementById('watchlistGroupNameInput');
            const select = document.getElementById('watchlistGroupSelect');
            if (input) input.value = data.watchlistGroupId;
            if (select) {
                const opt = Array.from(select.options).find(o => o.value === data.watchlistGroupId);
                if (opt) {
                    select.value = data.watchlistGroupId;
                } else {
                    let customOpt = Array.from(select.options).find(o => o.dataset.custom === 'true');
                    if (!customOpt) {
                        customOpt = document.createElement('option');
                        customOpt.dataset.custom = 'true';
                        select.appendChild(customOpt);
                    }
                    customOpt.value = data.watchlistGroupId;
                    customOpt.textContent = `${data.watchlistGroupId} (직접입력)`;
                    select.value = data.watchlistGroupId;
                }
            }
        }
    } finally {
        // Delay unblocking a bit to ensure all internal activateTab calls finished
        setTimeout(() => {
            isInitializing = false;
            console.log("🔓 [InitialLoad] System ready. Auto-save enabled.");
            if (memoNameMigrationNeeded) {
                console.log("🧹 [Migration] Memo tab title migration completed.");
                saveAppData();
            }
        }, 500);
    }
}

function applyMemoState(data) {
    if (!data) return false;

    // A failed save is still a valid local memo, even if this server snapshot has no memo keys.
    const pending = getPendingMemoSync();
    const hasIncomingMemo = Object.prototype.hasOwnProperty.call(data, 'memoHtml') || Object.prototype.hasOwnProperty.call(data, 'memoDelta');
    if (!hasIncomingMemo) {
        if (!pending) return false;
        writeLocalMemo(pending.memoHtml, pending.memoDelta);
        if (quillEditor) {
            if (pending.memoDelta) quillEditor.setContents(pending.memoDelta);
            else if (pending.memoHtml) quillEditor.root.innerHTML = pending.memoHtml;
            else quillEditor.setText('');
        }
        return true;
    }

    const html = typeof data.memoHtml === 'string' ? data.memoHtml : '';
    let delta = data.memoDelta;
    if (typeof delta === 'string') {
        try { delta = JSON.parse(delta); } catch { delta = null; }
    }
    if (!delta || !Array.isArray(delta.ops)) delta = null;

    // Preserve a newer explicit save that failed to reach the server.
    const incomingUpdatedAt = Number(data.memoUpdatedAt) || 0;
    if (pending && pending.memoUpdatedAt > incomingUpdatedAt) {
        writeLocalMemo(pending.memoHtml, pending.memoDelta);
        if (quillEditor) {
            if (pending.memoDelta) quillEditor.setContents(pending.memoDelta);
            else if (pending.memoHtml) quillEditor.root.innerHTML = pending.memoHtml;
            else quillEditor.setText('');
        }
        return true;
    }
    if (pending && incomingUpdatedAt >= pending.memoUpdatedAt) {
        localStorage.removeItem(MEMO_PENDING_SYNC_KEY);
    }

    writeLocalMemo(html, delta);
    if (incomingUpdatedAt > 0) localStorage.setItem('memoContent_updatedAt', String(incomingUpdatedAt));

    if (quillEditor) {
        if (delta) quillEditor.setContents(delta);
        else if (html) quillEditor.root.innerHTML = html;
        else quillEditor.setText('');
    }
    return true;
}

function writeLocalMemo(memoHtml, memoDelta) {
    localStorage.setItem('memoContent_html', memoHtml);
    if (memoDelta) localStorage.setItem('memoContent_delta', JSON.stringify(memoDelta));
    else localStorage.removeItem('memoContent_delta');
}

function getPendingMemoSync() {
    try {
        const pending = JSON.parse(localStorage.getItem(MEMO_PENDING_SYNC_KEY) || 'null');
        if (!pending || typeof pending.memoHtml !== 'string' || !Number.isFinite(Number(pending.memoUpdatedAt))) return null;
        let delta = pending.memoDelta;
        if (typeof delta === 'string') delta = JSON.parse(delta);
        if (!delta || !Array.isArray(delta.ops)) delta = null;
        return { memoHtml: pending.memoHtml, memoDelta: delta, memoUpdatedAt: Number(pending.memoUpdatedAt) };
    } catch {
        return null;
    }
}

async function saveMemoToServer(memoHtml, memoDelta, memoUpdatedAt = Date.now()) {
    // Direct callers (for example, restoring a backup) get the same recoverable retry state.
    const currentPending = getPendingMemoSync();
    if (!currentPending || currentPending.memoUpdatedAt <= memoUpdatedAt) {
        localStorage.setItem(MEMO_PENDING_SYNC_KEY, JSON.stringify({ memoHtml, memoDelta, memoUpdatedAt }));
    }
    const snapshot = getSerializedState();
    snapshot.memoHtml = memoHtml;
    snapshot.memoDelta = memoDelta;
    snapshot.memoUpdatedAt = memoUpdatedAt;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));

    const response = await fetch('/api/settings/memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoHtml, memoDelta, memoUpdatedAt, initialSettings: snapshot })
    });
    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Server responded with ${response.status}`);
    }
    const result = await response.json();
    if (!result.success) throw new Error(result.error || '메모 저장에 실패했습니다.');
    localStorage.setItem('memoContent_updatedAt', String(memoUpdatedAt));
    const pending = getPendingMemoSync();
    if (pending && pending.memoUpdatedAt <= memoUpdatedAt) {
        localStorage.removeItem(MEMO_PENDING_SYNC_KEY);
    }
}

function resetDynamicTabs() {
    document.querySelectorAll('.tab-btn:not(.add-tab-btn):not([data-perm])').forEach(b => b.remove());
    document.querySelectorAll('.tab-content:not(#tab_rank):not(#tab_earnings):not(#tab_base_interest):not(#tab_us):not(#tab_memo)').forEach(c => c.remove());
}

function activateTab(tabId) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const content = document.getElementById(tabId);
    if (!btn || !content) return;

    // Background refresh allowed: Do NOT stop refreshes here

    document.querySelectorAll(".tab-content.active").forEach(tab => {
        if (tab.id !== tabId) {
            if (tab.id !== PERM_TAB_ID && tab.id !== EARNINGS_TAB_ID && tab.id !== BASE_INTEREST_TAB_ID && tab.id !== US_TAB_ID && tab.id !== MEMO_TAB_ID) {
                saveTabState(tab.id);
                // tab.innerHTML = ''; // Removed to persist content and prevent reload
            }
            tab.classList.remove("active");
        }
    });

    document.querySelectorAll(".tab-btn.active").forEach(b => {
        if (b.dataset.tab !== tabId) b.classList.remove("active");
    });

    btn.classList.add("active");
    content.classList.add("active");

    // Initialize tab if empty, or just ensure intervals/listeners are active
    const wasEmpty = initializeTab(tabId);

    if (tabId === MEMO_TAB_ID) {
        // Initialize FullCalendar when memo tab is active
        setTimeout(() => {
            if (!calendar) initCalendar();
            else calendar.updateSize();

            // Try to sync calendar proactively if we have a session
            // [Fix] Removed automatic requestCalendarAccess to prevent browser popup blocking.
            // Sync now relies on the manual sync button (syncCalBtn) or existing accessToken.
            if (calendar && accessToken && !isCapturing) {
                calendar.refetchEvents();
            }
        }, 100);
    } else if (tabId === US_TAB_ID) {
        // The paired links table is initialized by initializeTab.
    } else if (tabId === BASE_INTEREST_TAB_ID) {
        loadBaseInterestCharts();
    } else if (tabId === EARNINGS_TAB_ID || (tabData[tabId] && (tabData[tabId].type === 'overseas_custom' || tabData[tabId].type === 'exchange_rate'))) {
        if (!wasEmpty) {
            redrawTabCharts(tabId);
        }
    } else if (tabId !== PERM_TAB_ID && wasEmpty && !isCapturing) {
        loadChartsSequentially(content);
    }
}

function initializeTab(tabId) {
    const content = document.getElementById(tabId);
    if (!content) return false;

    const isInitialized = content.getAttribute('data-tab-initialized') === 'true';

    // 1. Render layout if truly empty (no innerHTML at all)
    if (content.innerHTML.trim().length === 0) {
        console.log(`🏗️ [InitTab] Rendering initial layout for ${tabId}`);
        content.innerHTML = createChartGrid(tabId);
    }

    if (tabId === US_TAB_ID) window.USLinks.mount(content, () => {
        if (!tabData[US_TAB_ID]) tabData[US_TAB_ID] = { name: '자본동향', items: [] };
        return tabData[US_TAB_ID];
    }, saveAppData);
    if (tabId === EARNINGS_TAB_ID) loadEarningsCalendarFrame(tabId);
    if (tabId === BASE_INTEREST_TAB_ID) mountBaseInterestLinks(content);

    // 2. Attach specialized listeners (idempotent checks included)
    if (!isInitialized) {
        if (tabId === BASE_INTEREST_TAB_ID) {
            document.getElementById('refreshBaseInterest')?.addEventListener('click', () => loadBaseInterestCharts(true));
            content.querySelectorAll('[data-interest-view]').forEach(button => {
                button.addEventListener('click', () => {
                    content.querySelector('.base-interest-sources').dataset.view = button.dataset.interestView;
                    content.querySelectorAll('[data-interest-view]').forEach(item => {
                        const selected = item === button;
                        item.classList.toggle('active', selected);
                        item.setAttribute('aria-pressed', String(selected));
                    });
                });
            });
        } else if (tabId === EARNINGS_TAB_ID) {
            const refreshBtn = document.getElementById(`refreshEarnings_${tabId}`);
            if (refreshBtn && !refreshBtn.hasAttribute('data-listener-attached')) {
                refreshBtn.addEventListener('click', () => refreshEarningsTab(tabId, true));
                refreshBtn.setAttribute('data-listener-attached', 'true');
            }
            content.querySelectorAll('.calendar-source-tab').forEach(sourceTab => {
                if (!sourceTab.hasAttribute('data-listener-attached')) {
                    sourceTab.addEventListener('click', () => selectEarningsCalendar(tabId, sourceTab.dataset.calendarSource));
                    sourceTab.setAttribute('data-listener-attached', 'true');
                }
            });
        } else if (tabData[tabId] && tabData[tabId].type === 'overseas_custom') {
            const prefix = `overseasCustom_${tabId}`;
            const refreshBtn = document.getElementById(`refreshOverlay_${tabId}`);
            if (refreshBtn && !refreshBtn.hasAttribute('data-listener-attached')) {
                refreshBtn.addEventListener('click', () => refreshOverseasCustomCharts(tabId));
                refreshBtn.setAttribute('data-listener-attached', 'true');
            }
            setupOverseasCursorSync();
            setupSectorGroupListeners(tabId);
        } else if (tabData[tabId] && tabData[tabId].type === 'exchange_rate') {
            const refreshBtn = document.getElementById(`refreshExchangeRate_${tabId}`);
            if (refreshBtn && !refreshBtn.hasAttribute('data-listener-attached')) {
                refreshBtn.addEventListener('click', () => refreshExchangeRateCharts(tabId));
                refreshBtn.setAttribute('data-listener-attached', 'true');
            }
            setupSectorGroupListeners(tabId);
        } else if (tabId === MEMO_TAB_ID) {
            // Even if content was in HTML, we need to init Quill and Calendar
            setTimeout(() => {
                if (!quillEditor) initMemoEditor();
                if (!calendar) initCalendar();
            }, 100);
        }
        content.setAttribute('data-tab-initialized', 'true');
    }
    // Already initialized, but might need resizing
    if (calendar) {
        setTimeout(() => {
            calendar.updateSize();
            console.log("🔄 [activateTab] Calendar size updated");
        }, 300);
    }

    // 3. Trigger initial load if it was empty
    if (!isInitialized) {
        if (!isCapturing) {
            if (tabData[tabId] && tabData[tabId].type === 'overseas_custom') {
                refreshOverseasCustomCharts(tabId);
            } else if (tabData[tabId] && tabData[tabId].type === 'exchange_rate') {
                refreshExchangeRateCharts(tabId);
            }
        } else {
            console.log(`[Capture] initializeTab(${tabId}) data load skipped (isCapturing)`);
        }
        return true;
    }

    return false;
}




function createTabButtonElement(id, name) {
    const fixedName = resolveTabName(id, name, typeof tabData !== 'undefined' ? tabData[id] : null);
    const btn = document.createElement("button");
    btn.className = "tab-btn";
    btn.dataset.tab = id;
    btn.textContent = fixedName;
    btn.title = fixedName;
    btn.draggable = true;
    if (typeof tabData !== 'undefined' && tabData[id] && typeof tabData[id] === 'object' && !Array.isArray(tabData[id])) {
        tabData[id].name = fixedName;
    }
    // Always append to tabsWrapper now
    if (tabsWrapper) tabsWrapper.appendChild(btn);
    return btn;
}

function createTabContentElement(id) {
    if (document.getElementById(id)) return document.getElementById(id);
    const div = document.createElement("div");
    div.className = "tab-content";
    if (id === EARNINGS_TAB_ID || id === BASE_INTEREST_TAB_ID) div.classList.add("full-tab");
    div.id = id;
    tabContents.appendChild(div);
    return div;
}

// --- Charting Logic ---

const commonStudies = [
    { "id": "MASimple@tv-basicstudies", "inputs": { "length": 5 } },
    { "id": "MASimple@tv-basicstudies", "inputs": { "length": 10 } },
    { "id": "MASimple@tv-basicstudies", "inputs": { "length": 20 } },
    { "id": "MASimple@tv-basicstudies", "inputs": { "length": 60 } },
    { "id": "MASimple@tv-basicstudies", "inputs": { "length": 120 } }
];

function getDirectTradingViewUrl(symbol) {
    const studiesStr = encodeURIComponent(JSON.stringify(commonStudies));
    return `https://s.tradingview.com/widgetembed/?symbol=${symbol}&interval=D&hidesidetoolbar=1&hidetoptoolbar=0&symboledit=1&saveimage=1&toolbarbg=F1F3F6&studies=${studiesStr}&hideideas=1&theme=Light&style=1&timezone=Etc%2FUTC&withdateranges=1&showpopupbutton=1&locale=kr&hide_volume=1`;
}

function getTradingViewDataUrl(symbol) {
    const htmlContent = `
        <html>
        <head><style>body { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; }</style></head>
        <body>
            <div id="tradingview_widget" style="height:100%;width:100%"></div>
            <script type="text/javascript" src="https://s3.tradingview.com/tv.js"><\/script>
            <script type="text/javascript">
            new TradingView.widget({
                "autosize": true, "symbol": "${symbol}", "interval": "D", "timezone": "Etc/UTC", "theme": "light", "style": "1", "locale": "kr", "hide_volume": true, "container_id": "tradingview_widget",
                "studies": ${JSON.stringify(commonStudies)}
            });
            <\/script>
        </body></html>`;
    return "data:text/html;charset=utf-8," + encodeURIComponent(htmlContent);
}

function getInvestingUrl() {
    return "https://ssltvc.investing.com/?pair_ID=1&lang_ID=18&timezone_ID=8&width=100%&height=100%&interval=86400";
}


function createChartGrid(tabId) {
    if (tabId === US_TAB_ID) return window.USLinks.layout();

    if (tabId === BASE_INTEREST_TAB_ID) {
        return `<div class="container overseas-container">
            <header><div class="header-single-line"><h1><strong>기준금리</strong></h1>
                <div class="header-controls"><button id="refreshBaseInterest" class="btn-primary" style="height:38px; padding:0 15px;">새로고침</button></div>
            </div></header>
            <div class="calendar-source-tabs base-interest-view-controls" role="group" aria-label="기준금리 보기">
                <button type="button" class="calendar-source-tab active" data-interest-view="split" aria-pressed="true">CBRates | Trading Economics</button>
                <button type="button" class="calendar-source-tab" data-interest-view="charts" aria-pressed="false">차트</button>
            </div>
            <div class="base-interest-sources" data-view="split">
                ${BASE_INTEREST_SOURCES.map(source => `<section class="base-interest-source" data-interest-source="${source.id}" aria-label="${source.name}">
                    <div class="base-interest-source-heading"><h2>${source.name}</h2><a href="${source.url}" target="_blank" rel="noopener noreferrer">원본 열기 ↗</a></div>
                    <iframe data-interest-url="${source.url}" title="${source.name} 국가별 기준금리"></iframe>
                </section>`).join('')}
                <section class="base-interest-fred" aria-label="국가별 금리 차트 및 정책금리 자료">
                    <div class="base-interest-fred-table-wrap"><table class="base-interest-fred-table">
                        <thead><tr><th scope="col">대륙</th><th scope="col">국가/지역</th><th scope="col">URL링크</th><th scope="col">비고</th></tr></thead>

                    </table></div>
                </section>
            </div></div>`;
    }

    // 2. Earnings Tab (증시캘린더)
    if (tabId === EARNINGS_TAB_ID) {
        const calendars = [
            { id: 'toss', label: '지표/실적 일정', url: '/calendar', externalUrl: 'https://www.tossinvest.com/calendar' },
            { id: 'seibro', label: '배당 일정', url: 'https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/company/BIP_CNTS01041V.xml&menuNo=285', externalUrl: 'https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/company/BIP_CNTS01041V.xml&menuNo=285' },
            { id: 'investing', label: '각국 금리 일정', url: 'https://www.cbrates.com/meetings.htm', externalUrl: 'https://www.cbrates.com/meetings.htm' }
        ];
        const activeCalendarId = tabData[tabId]?.activeCalendarId || 'toss';
        const selectedCalendar = calendars.find(calendar => calendar.id === activeCalendarId) || calendars[0];
        return `
            <div class="container overseas-container">
                <header>
                    <div class="header-single-line">
                        <h1><strong>증시캘린더</strong></h1>
                        <div class="header-controls" style="display: flex; gap: 8px;">
                            <button id="refreshEarnings_${tabId}" class="btn-primary" style="height: 38px; padding: 0 15px;">새로고침</button>
                        </div>
                    </div>
                    <div class="status-info">
                        <span id="earningsStatusText_${tabId}">대기 중</span>
                        <span class="status-separator">|</span>
                        <span id="earningsLastUpdate_${tabId}">-</span>
                    </div>
                </header>
                <div class="calendar-source-tabs" role="tablist" aria-label="캘린더 종류">
                    ${calendars.map(calendar => `<button type="button" id="calendarSourceTab_${tabId}_${calendar.id}" class="calendar-source-tab${calendar.id === activeCalendarId ? ' active' : ''}" role="tab" aria-selected="${calendar.id === activeCalendarId}" aria-controls="calendarSourcePanel_${tabId}" data-calendar-source="${calendar.id}">${calendar.label}</button>`).join('')}
                </div>
                <div class="base-interest-source-heading calendar-source-heading"><h2 id="earningsSourceTitle_${tabId}">${selectedCalendar.label}</h2><a id="earningsExternalLink_${tabId}" href="${selectedCalendar.externalUrl}" target="_blank" rel="noopener noreferrer">원본 열기 ↗</a></div>
                <div class="overseas-content-scroll calendar-source-panel" id="calendarSourcePanel_${tabId}" role="tabpanel" aria-labelledby="calendarSourceTab_${tabId}_${activeCalendarId}" style="flex:1; overflow:hidden;">
                    <iframe id="iframeEarnings_${tabId}" ${activeCalendarId !== 'toss' ? 'hidden' : ''} data-calendar-urls="${encodeURIComponent(JSON.stringify(calendars))}" data-calendar-source="${activeCalendarId}" class="embedded-iframe" style="width:100%; height:100%; border:none;" title="${selectedCalendar.label} 캘린더"></iframe>
                    <iframe id="iframeEarningsSeibro_${tabId}" ${activeCalendarId !== 'seibro' ? 'hidden' : ''} class="embedded-iframe" style="width:100%; height:100%; border:none;" title="배당 일정 캘린더"></iframe>
                    <div id="centralBanksFramePanel_${tabId}" ${activeCalendarId === 'investing' ? '' : 'hidden'} style="height:100%; position:relative; background:white;"><iframe id="centralBanksFrame_${tabId}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" class="embedded-iframe" style="width:100%; height:100%; border:none;" title="CBRates 중앙은행 회의 일정 · 원문 날짜순"></iframe><div id="centralBanksFrameLoading_${tabId}" class="central-banks-frame-loading" role="status" hidden style="position:absolute; top:12px; right:12px; padding:8px 12px; background:rgba(255,255,255,.9); pointer-events:none;">페이지 연결 중...</div></div>
                </div>
            </div>`;
    }

    // 3. Custom Overseas Tab
    if (tabData[tabId] && tabData[tabId].type === 'overseas_custom') {
        const prefix = `overseasCustom_${tabId}`;
        let titleText = '해외종목';
        const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (btn) titleText = btn.textContent;

        let charts = [];
        if (tabData[tabId].config) {
            charts = parseCustomCharts(tabData[tabId].config);
        }

        let gridContent = '';
        if (charts.length === 0) {
            gridContent = `<div class="empty-custom-charts" style="padding: 50px; text-align: center; color: var(--text-muted);"><p>등록된 차트가 없습니다. [종목입력] 버튼을 눌러 차트를 추가하세요.</p></div>`;
        } else {
            const sectorColors = tabData[tabId].sectorColors || {};
            let currentItemColor = '';
            let colorIdx = 0;

            const renderedItems = charts.map((item, idx) => {
                if (item.type === 'comment') return '';
                if (item.type === 'divider') {
                    currentItemColor = item.color || sectorColors[item.title] || SECTOR_COLORS[colorIdx++ % SECTOR_COLORS.length];
                    return `
                        <div class="finviz-divider" data-index="${idx}" style="--section-color: ${currentItemColor}">
                            <div class="divider-title"><span class="title-text">${item.title}</span></div>
                            <div class="divider-line"></div>
                            <div class="divider-controls">
                                <button class="btn-section-edit" type="button" title="제목·색상 편집" aria-label="제목·색상 편집"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 3-.6 2.4-2 .9-2.2-.7-2.5 4.3 1.7 1.7v2.3l-1.7 1.7 2.5 4.3 2.2-.7 2 .9.6 2.4h5l.6-2.4 2-.9 2.2.7 2.5-4.3-1.7-1.7v-2.3l1.7-1.7-2.5-4.3-2.2.7-2-.9L14.5 3z"/><circle cx="12" cy="12.5" r="3"/></svg></button>
                                <div class="section-edit-popup">
                                    <div class="edit-group">
                                        <label>제목</label>
                                        <input type="text" class="edit-section-title" value="${item.title}">
                                    </div>
                                    <div class="edit-group">
                                        <label>색상</label>
                                        <div class="color-presets">
                                            ${SECTOR_COLORS.map(c => `<div class="color-swatch" style="background:${c}" data-color="${c}"></div>`).join('')}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
                } else {
                    return renderCustomChartItem(item, currentItemColor, tabId, idx);
                }
            }).join('');
            gridContent = `<div class="finviz-container">${renderedItems}</div>`;
        }

        return `
            <div class="container overseas-container">
                <header>
                    <div class="header-single-line">
                        <div class="tab-title-group">
                            <h1><strong>${titleText}</strong></h1>
                            <button class="btn-config config-trigger" data-tab="${tabId}">종목입력</button>
                        </div>
                        <div class="header-controls">
                            <button id="refreshOverlay_${tabId}" class="btn-primary" style="height: 38px; padding: 0 15px;">조회</button>
                        </div>
                    </div>
                    <div class="status-info">
                            <span id="${prefix}StatusText">대기 중</span>
                            <span class="status-separator">|</span>
                            <span id="${prefix}LastUpdate">-</span>
                    </div>
                </header>
                <div class="overseas-content-scroll" style="flex:1; overflow:auto;">
                    ${gridContent}
                </div>
            </div>`;
    }

    // 4. Exchange Rate Tab
    if (tabData[tabId] && tabData[tabId].type === 'exchange_rate') {
        const prefix = `exchangeRate_${tabId}`;
        let titleText = '환율/금리';
        const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (btn) titleText = btn.textContent;

        let charts = [];
        if (tabData[tabId].config) {
            charts = parseCustomCharts(tabData[tabId].config);
        }

        let gridContent = '';
        if (charts.length === 0) {
            gridContent = `<div class="empty-custom-charts" style="padding: 50px; text-align: center; color: var(--text-muted);"><p>등록된 차트가 없습니다. [종목입력] 버튼을 눌러 TradingEconomics 차트를 추가하세요.</p></div>`;
        } else {
            const sectorColors = tabData[tabId].sectorColors || {};
            let currentItemColor = '';
            let colorIdx = 0;

            const renderedItems = charts.map((item, idx) => {
                if (item.type === 'comment') return '';
                if (item.type === 'divider') {
                    currentItemColor = item.color || sectorColors[item.title] || SECTOR_COLORS[colorIdx++ % SECTOR_COLORS.length];
                    return `
                        <div class="finviz-divider" data-index="${idx}" style="--section-color: ${currentItemColor}">
                            <div class="divider-title"><span class="title-text">${item.title}</span></div>
                            <div class="divider-line"></div>
                            <div class="divider-controls">
                                <button class="btn-section-edit" type="button" title="제목·색상 편집" aria-label="제목·색상 편집"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 3-.6 2.4-2 .9-2.2-.7-2.5 4.3 1.7 1.7v2.3l-1.7 1.7 2.5 4.3 2.2-.7 2 .9.6 2.4h5l.6-2.4 2-.9 2.2.7 2.5-4.3-1.7-1.7v-2.3l1.7-1.7-2.5-4.3-2.2.7-2-.9L14.5 3z"/><circle cx="12" cy="12.5" r="3"/></svg></button>
                                <div class="section-edit-popup">
                                    <div class="edit-group">
                                        <label>제목</label>
                                        <input type="text" class="edit-section-title" value="${item.title}">
                                    </div>
                                    <div class="edit-group">
                                        <label>색상</label>
                                        <div class="color-presets">
                                            ${SECTOR_COLORS.map(c => `<div class="color-swatch" style="background:${c}" data-color="${c}"></div>`).join('')}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>`;
                } else {
                    const isMulti = item.urls && item.urls.length > 1;
                    const isFred = item.urls && item.urls.some(url => url.toLowerCase().includes('fred('));
                    if (isMulti || isFred) return renderCustomChartItem(item, currentItemColor, tabId, idx);
                    else return renderTradingEconomicsChartItem(item, currentItemColor, tabId, idx);
                }
            }).join('');
            gridContent = `<div class="finviz-container te-container">${renderedItems}</div>`;
        }

        return `
            <div class="container overseas-container">
                <header>
                    <div class="header-single-line">
                        <div class="tab-title-group">
                            <h1><strong>${titleText}</strong></h1>
                            <button class="btn-config config-trigger" data-tab="${tabId}">종목입력</button>
                        </div>
                        <div class="header-controls">
                            <button id="refreshExchangeRate_${tabId}" class="btn-primary" style="height: 38px; padding: 0 15px;">조회</button>
                        </div>
                    </div>
                    <div class="status-info">
                            <span id="${prefix}StatusText">대기 중</span>
                            <span class="status-separator">|</span>
                            <span id="${prefix}LastUpdate">-</span>
                    </div>
                </header>
                <div class="overseas-content-scroll" style="flex:1; overflow:auto;">
                    ${gridContent}
                </div>
            </div>`;
    }

    // 5. Default Dynamic Charts Tab (Multiple Iframes)
    if (!tabData[tabId]) {
        const defaults = ["FX_IDC:USDKRW", "KRX:KOSPI", "KRX:KOSDAQ", "BINANCE:BTCUSDT"];
        tabData[tabId] = defaults.map(sym => ({ symbol: sym, lastSymbol: sym, mode: 'main', mainSrc: '', subSrc: '' }));
    }

    let states = tabData[tabId];
    let html = '<div class="chart-grid">';
    const perm = "clipboard-write; autoplay; fullscreen; encrypted-media; picture-in-picture; web-share";
    const sand = "allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads allow-presentation";

    states.forEach((state, i) => {
        const symbol = state.symbol;
        const lastSymbol = state.lastSymbol || symbol;
        let mainSrcAttr = '', mainSrcVal = 'about:blank';
        if (state.mode === 'main') {
            if (!state.mainSrc || state.mainSrc === 'about:blank' || state.mainSrc.includes('tradingview.com') || state.mainSrc.startsWith('data:')) {
                mainSrcAttr = `data-src="${getDirectTradingViewUrl(lastSymbol)}"`;
            } else {
                mainSrcVal = state.mainSrc;
                mainSrcAttr = `data-src="${state.mainSrc}"`;
            }
        }
        const subSrc = state.subSrc || getInvestingUrl();
        const mainStyle = state.mode === 'sub' ? 'display:none;' : 'display:block;';
        const subStyle = state.mode === 'sub' ? 'display:block;' : 'display:none;';
        html += `
            <div class="chart-box" data-last-symbol="${lastSymbol}">
                <div class="chart-header">
                    <input type="text" class="chart-title-input" value="Chart ${i + 1}" readonly>
                    <input type="text" class="chart-input" value="${symbol}" placeholder="심볼 또는 URL">
                    <button class="chart-go-btn">이동</button>
                    <img src="https://www.google.com/s2/favicons?domain=tradingview.com&sz=32" class="chart-control-icon chart-t-btn" title="TradingView">
                    <img src="https://www.google.com/s2/favicons?domain=investing.com&sz=32" class="chart-control-icon chart-i-btn" title="Investing.com">
                    <img src="https://www.google.com/s2/favicons?domain=alphasquare.co.kr&sz=32" class="chart-control-icon chart-a-btn" title="AlphaSquare">
                </div>
                <iframe class="iframe-main" ${mainSrcAttr} src="${mainSrcVal}" style="${mainStyle}" allow="${perm}" sandbox="${sand}"></iframe>
                <iframe class="iframe-sub" src="${subSrc}" style="${subStyle}" allow="${perm}" sandbox="${sand}"></iframe>
            </div>`;
    });
    html += '</div>';
    return html;
}

function loadChartsSequentially(container) {
    const iframes = container.querySelectorAll('iframe[data-src]');
    iframes.forEach((iframe, index) => {
        const chartBox = iframe.closest('.chart-box');
        setTimeout(() => {
            if (document.body.contains(iframe) && iframe.dataset.src) {
                iframe.src = iframe.dataset.src;
                iframe.removeAttribute('data-src');
            }
        }, index * 800);

        setTimeout(() => {
            if (!container.classList.contains('active')) return;
            if (document.body.contains(iframe) && iframe.src && iframe.src.includes('s.tradingview.com/widgetembed')) {
                iframe.src = getTradingViewDataUrl(chartBox.dataset.lastSymbol);
            }
        }, index * 800 + 10000);
    });
}

function loadChartFromInput(inputElement) {
    const chartBox = inputElement.closest('.chart-box');
    const iframeMain = chartBox.querySelector('.iframe-main');
    const iframeSub = chartBox.querySelector('.iframe-sub');
    let val = inputElement.value.trim();
    if (!val) return;
    iframeMain.style.display = 'block';
    iframeSub.style.display = 'none';
    if (val.startsWith('http://') || val.startsWith('https://')) {
        iframeMain.src = val;
    } else {
        val = val.toUpperCase();
        chartBox.dataset.lastSymbol = val;
        iframeMain.src = getDirectTradingViewUrl(val);
        setTimeout(() => {
            if (document.body.contains(iframeMain) && iframeMain.src.includes('s.tradingview.com/widgetembed'))
                iframeMain.src = getTradingViewDataUrl(val);
        }, 5000);
    }
    saveAppData();
}

// ==========================================================
// Event Listeners for Tabs & Charts
// ==========================================================

document.body.addEventListener('click', function (e) {
    // --- Tab Switching ---
    const tabBtn = e.target.closest('.tab-btn');
    if (tabBtn && !tabBtn.classList.contains('add-tab-btn') && !e.target.closest('.capture-btn')) {
        if (!tabBtn.querySelector("input")) activateTab(tabBtn.dataset.tab);
        return;
    }

    // --- Manual Refresh Buttons ---
    const rankRefreshBtn = e.target.closest('#manualRefresh');
    if (rankRefreshBtn) {
        console.log('[Click] Rank 조회 버튼 클릭');
        loadData();
        loadTransactionRank();
        loadWatchlistRank();
        return;
    }

    // --- Chart Input Go Button ---
    const goBtn = e.target.closest('.chart-go-btn');
    if (goBtn) {
        console.log('[Click] 차트 이동 버튼 클릭');
        loadChartFromInput(goBtn.previousElementSibling);
        return;
    }

    // --- Dynamic Finviz Config Trigger ---
    const configTrigger = e.target.closest('.config-trigger');
    if (configTrigger) {
        currentConfigTabId = configTrigger.dataset.tab;
        openCustomChartModal();
        return;
    }
    if (e.target.classList.contains('chart-t-btn')) {
        const chartBox = e.target.closest('.chart-box');
        const iframeMain = chartBox.querySelector('.iframe-main');
        const iframeSub = chartBox.querySelector('.iframe-sub');
        const lastSymbol = chartBox.dataset.lastSymbol;
        iframeMain.style.display = 'block'; iframeSub.style.display = 'none';
        if (lastSymbol) {
            chartBox.querySelector('.chart-input').value = lastSymbol;
            iframeMain.src = getDirectTradingViewUrl(lastSymbol);
            setTimeout(() => { if (document.body.contains(iframeMain) && iframeMain.src.includes('s.tradingview.com/widgetembed')) iframeMain.src = getTradingViewDataUrl(lastSymbol); }, 5000);
        }
        saveAppData();
    }
    if (e.target.classList.contains('chart-a-btn')) {
        const chartBox = e.target.closest('.chart-box');
        const iframeMain = chartBox.querySelector('.iframe-main');
        const iframeSub = chartBox.querySelector('.iframe-sub');
        let symbol = chartBox.dataset.lastSymbol;
        if (symbol && symbol.includes(':')) symbol = symbol.split(':')[1];
        iframeMain.style.display = 'block'; iframeSub.style.display = 'none';
        if (symbol) {
            iframeMain.src = `https://alphasquare.co.kr/home/stock-chart?code=${symbol}&_t=${Date.now()}`;
        }
        saveAppData();
    }
    if (e.target.classList.contains('chart-i-btn')) {
        const chartBox = e.target.closest('.chart-box');
        chartBox.querySelector('.iframe-main').style.display = 'none';
        const iframeSub = chartBox.querySelector('.iframe-sub');
        iframeSub.style.display = 'block';
        if (!iframeSub.getAttribute('src')) iframeSub.src = getInvestingUrl();
        saveAppData();
    }
    if (!contextMenu.contains(e.target) && contextMenu.style.display === 'block') contextMenu.style.display = 'none';
});

document.body.addEventListener('keypress', function (e) {
    if (e.target.classList.contains('chart-input') && e.key === 'Enter') loadChartFromInput(e.target);
    if (e.target.classList.contains('chart-title-input') && e.key === 'Enter') { e.target.blur(); saveAppData(); }
});

document.body.addEventListener('dblclick', function (e) {
    if (e.target.classList.contains('chart-title-input')) { e.target.readOnly = false; e.target.select(); }
});

document.body.addEventListener('focusout', function (e) {
    if (e.target.classList.contains('chart-title-input')) { e.target.readOnly = true; saveAppData(); }
});

tabContainer.addEventListener("contextmenu", e => {
    e.preventDefault();
    const btn = e.target.closest(".tab-btn");
    if (btn && !btn.classList.contains("add-tab-btn") && !btn.querySelector("input") && !btn.dataset.perm) {
        targetTabBtn = btn;
        contextMenu.style.display = "block";
        contextMenu.style.left = e.pageX + "px";
        contextMenu.style.top = e.pageY + "px";
    }
});

contextMenu.addEventListener("click", (e) => {
    if (!targetTabBtn || targetTabBtn.dataset.perm) { contextMenu.style.display = "none"; targetTabBtn = null; return; }

    // Check if the clicked item is 'deleteTab'
    if (e.target.id === 'deleteTab') {
        const confirmed = confirm("정말로 이 탭을 삭제하시겠습니까?");
        if (!confirmed) {
            contextMenu.style.display = "none";
            targetTabBtn = null;
            return;
        }

        const tabId = targetTabBtn.dataset.tab;
        const content = document.getElementById(tabId);
        targetTabBtn.remove();
        if (content) content.remove();
        delete tabData[tabId];
        saveAppData();
        const remainingTabs = document.querySelectorAll(".tab-btn:not(.add-tab-btn)");
        if (remainingTabs.length > 0) {
            if (!document.querySelector(".tab-btn.active")) activateTab(remainingTabs[0].dataset.tab);
        }
    }
    targetTabBtn = null;
    contextMenu.style.display = "none";
});

tabContainer.addEventListener("dblclick", function (e) {
    const btn = e.target.closest(".tab-btn");
    if (!btn || btn.classList.contains("add-tab-btn") || btn.querySelector("input") || btn.closest('.right-controls')) return;
    const originalName = btn.textContent;
    const input = document.createElement("input");
    input.type = "text"; input.value = originalName; input.className = "tab-rename-input";
    btn.textContent = ""; btn.appendChild(input); input.focus(); input.select();
    const finishEditing = () => {
        const newName = input.value.trim() || originalName;
        btn.textContent = newName;
        btn.title = newName;
        const tabId = btn.dataset.tab;
        if (typeof tabData !== 'undefined' && tabData[tabId] && typeof tabData[tabId] === 'object' && !Array.isArray(tabData[tabId])) {
            tabData[tabId].name = newName;
        }
        saveAppData();
    };
    input.addEventListener("blur", finishEditing);
    input.addEventListener("keypress", (ev) => { if (ev.key === "Enter") input.blur(); });
});

let draggedItem = null;
tabsWrapper.addEventListener('dragstart', function (e) {
    if (e.target.classList.contains('tab-btn') && !e.target.classList.contains('add-tab-btn') && !e.target.dataset.perm) {
        draggedItem = e.target; e.target.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
    } else { e.preventDefault(); }
});
tabsWrapper.addEventListener('dragend', function (e) {
    if (e.target.classList.contains('tab-btn')) { e.target.classList.remove('dragging'); draggedItem = null; saveAppData(); }
});
tabsWrapper.addEventListener('dragover', function (e) {
    e.preventDefault(); if (!draggedItem) return;
    const draggableElements = [...tabsWrapper.querySelectorAll('.tab-btn:not(.dragging):not(.add-tab-btn):not([data-perm])')];
    const afterElement = draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = e.clientY - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; } else { return closest; }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
    if (afterElement == null) { tabsWrapper.appendChild(draggedItem); } else { tabsWrapper.insertBefore(draggedItem, afterElement); }
});

addTabBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    addTabMenu.style.display = "block";
    const rect = addTabBtn.getBoundingClientRect();
    addTabMenu.style.left = Math.max(0, Math.min(rect.left, window.innerWidth - addTabMenu.offsetWidth)) + window.scrollX + "px";
    addTabMenu.style.top = Math.max(0, Math.min(rect.bottom, window.innerHeight - addTabMenu.offsetHeight)) + window.scrollY + "px";
});

// Close menus when clicking elsewhere
window.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
    if (addTabMenu) addTabMenu.style.display = 'none';
});

// Add Overseas Stocks Tab
document.getElementById('addOverseasTab').addEventListener('click', () => {
    const uniqueId = Date.now();
    const newTabId = "tab_custom_" + uniqueId;
    const currentTabs = Array.from(document.querySelectorAll(".tab-btn"));
    const overseasCount = currentTabs.filter(btn => btn.textContent.startsWith("해외종목")).length + 1;

    // Initialize tabData for this tab as a custom overseas type
    tabData[newTabId] = { type: 'overseas_custom', config: '' };

    createTabButtonElement(newTabId, "해외종목 " + overseasCount);
    createTabContentElement(newTabId);
    activateTab(newTabId);
    addTabMenu.style.display = "none";
    saveAppData();
});

// Add a dedicated exchange-rate and interest-rate custom tab.
document.getElementById('addExchangeRateTab').addEventListener('click', () => {
    const uniqueId = Date.now();
    const newTabId = "tab_exchange_" + uniqueId;
    const currentTabs = Array.from(document.querySelectorAll(".tab-btn"));
    const exchangeCount = currentTabs.filter(btn => btn.textContent.startsWith("금리/환율")).length + 1;

    tabData[newTabId] = { type: 'exchange_rate', config: '', sectorColors: {} };
    createTabButtonElement(newTabId, "금리/환율 " + exchangeCount);
    createTabContentElement(newTabId);
    activateTab(newTabId);
    addTabMenu.style.display = "none";
    saveAppData();
});

// Add Chart Tab
document.getElementById('addChartTab').addEventListener('click', () => {
    const uniqueId = Date.now();
    const newTabId = "tab_grid_" + uniqueId;
    const currentTabs = Array.from(document.querySelectorAll(".tab-btn"));
    const chartCount = currentTabs.filter(btn => btn.textContent.startsWith("차트")).length + 1;

    // Default 4-grid behavior
    const defaults = ["FX_IDC:USDKRW", "KRX:KOSPI", "KRX:KOSDAQ", "BINANCE:BTCUSDT"];
    tabData[newTabId] = defaults.map(sym => ({ symbol: sym, lastSymbol: sym, mode: 'main', mainSrc: '', subSrc: '' }));

    createTabButtonElement(newTabId, "차트 " + chartCount);
    createTabContentElement(newTabId);
    activateTab(newTabId);
    addTabMenu.style.display = "none";
    saveAppData();
});




// ==========================================================
// Overseas Tab Refresh Function
// ==========================================================



/**
 * 해외동향 차트 커서 동기화 설정
 */
function setupOverseasCursorSync() {
    const activeContent = document.querySelector('.tab-content.active');
    if (!activeContent) return;

    const isOverseas = (tabData[activeContent.id] && tabData[activeContent.id].type === 'overseas_custom');

    if (!isOverseas) return;

    // Use delegation - only attach once per DOM life of the tab content
    if (activeContent.dataset.cursorSyncAttached === 'true') return;

    const handleMouseMove = (e) => {
        const wrapper = e.target.closest('.finviz-img-wrapper');
        const lines = activeContent.querySelectorAll('.finviz-cursor-line');

        if (!wrapper) {
            lines.forEach(l => l.style.visibility = 'hidden');
            return;
        }

        const rect = wrapper.getBoundingClientRect();
        const offsetRight = rect.right - e.clientX;

        lines.forEach((line) => {
            line.style.right = `${offsetRight}px`;
            line.style.visibility = 'visible';
        });
    };

    const handleMouseLeave = () => {
        const lines = activeContent.querySelectorAll('.finviz-cursor-line');
        lines.forEach(line => line.style.visibility = 'hidden');
    };

    activeContent.addEventListener('mousemove', handleMouseMove);
    activeContent.addEventListener('mouseleave', handleMouseLeave);
    activeContent.dataset.cursorSyncAttached = 'true';
    console.log(`[CursorSync] Delegation attached to ${activeContent.id}`);
}

/**
 * 해외 차트 렌더링 도우미
 */
const SECTOR_COLORS = [
    '#1864ab', '#2b8a3e', '#e67700', '#5f3dc4', '#c2255c',
    '#0b7285', '#5c940d', '#d9480f', '#862e9c', '#a61e4d'
];

function renderFinvizChartItem(chart, color = '') {
    const proxyUrl = `/api/finviz-image?url=${encodeURIComponent(chart.url)}`;
    const isFuture = chart.url.includes('fut_chart.ashx');

    // Safety check: ensure title is clean of accidental leading/trailing quotes
    const cleanTitle = (chart.title || '').replace(/^[ "'“‘”’]+|[ "'“‘”’]+$/g, '').trim();

    // Convert hex to semi-transparent version for background
    let style = '';
    if (color) {
        style = `--section-color: ${color}; --section-color-alpha: ${color}22;`;
    }

    return `
        <div class="finviz-chart-box" style="${style}">
            <div class="finviz-chart-title ${color ? 'colorful' : ''}">${cleanTitle}</div>
            <div class="finviz-img-wrapper ${isFuture ? 'is-future' : ''}">
                <img src="${proxyUrl}" class="finviz-chart-img ${isFuture ? 'future' : 'stock'}" alt="${cleanTitle}" data-chart-url="${chart.url}">
                <div class="finviz-cursor-line"></div>
            </div>
        </div>
    `;
}

/**
 * 커스텀 차트 아이템 렌더링 (이미지 vs 캔버스)
 */
function renderCustomChartItem(item, color = '', tabId, idx) {
    const isMulti = item.urls && item.urls.length > 1;
    const isFred = item.urls && item.urls.some(url => url.toLowerCase().includes('fred('));
    const isEcos = item.urls && item.urls.some(url => url.toLowerCase().includes('ecos('));
    // Also treat single TradingEconomics URL as canvas chart, not image
    const isTE = item.urls && item.urls.some(url => url.toLowerCase().includes('tradingeconomics.com'));

    if (isMulti || isFred || isEcos || isTE) {
        const cleanTitle = (item.title || '').replace(/^[ "'“‘”’]+|[ "'“‘”’]+$/g, '').trim();
        let style = '';
        if (color) {
            style = `--section-color: ${color}; --section-color-alpha: ${color}22;`;
        }
        const canvasId = `multi_chart_${tabId}_${idx}`;
        // Use encodeURIComponent to be 100% safe against all quotes
        const safeUrls = encodeURIComponent(JSON.stringify(item.urls));
        return `
            <div class="finviz-chart-box multi-chart-box" style="${style}" data-series="${encodeURIComponent(JSON.stringify(item.series || []))}" data-urls="${safeUrls}" data-idx="${idx}">
                <div class="finviz-chart-title ${color ? 'colorful' : ''}">${cleanTitle}</div>
                <div class="te-chart-wrapper" style="background: white;">
                    <canvas id="${canvasId}" class="multi-chart-canvas" width="400" height="200" style="width:100%; height:100%;"></canvas>
                    <div class="te-chart-loading">데이터 로딩 중...</div>
                </div>
            </div>
        `;
    } else {
        // 단일 URL인 경우 기존 방식 유지 (이미지 위주)
        return renderFinvizChartItem({ url: item.urls[0], title: item.title }, color);
    }
}

/**
 * TradingEconomics 차트 아이템 렌더링
 */
function renderTradingEconomicsChartItem(chart, color = '', tabId, idx) {
    // Safety check: ensure title is clean of accidental leading/trailing quotes
    const cleanTitle = (chart.title || '').replace(/^[ "'“‘”’]+|[ "'“‘”’]+$/g, '').trim();

    // Convert hex to semi-transparent version for background
    let style = '';
    if (color) {
        style = `--section-color: ${color}; --section-color-alpha: ${color}22;`;
    }

    const canvasId = `te_chart_${tabId}_${idx}`;

    // Fix: Use series or urls array if top-level url is missing
    const url = chart.url || (chart.series && chart.series[0] ? chart.series[0].url : (chart.urls ? chart.urls[0] : ''));
    const duration = (chart.series && chart.series[0]) ? (chart.series[0].duration || '') : '';

    return `
        <div class="finviz-chart-box te-chart-box" style="${style}" data-te-url="${url}" data-te-duration="${duration}" data-te-idx="${idx}">
            <div class="finviz-chart-title ${color ? 'colorful' : ''}">${cleanTitle}</div>
            <div class="te-chart-wrapper">
                <canvas id="${canvasId}" class="te-chart-canvas" width="400" height="200"></canvas>
                <div class="te-chart-loading">데이터 로딩 중...</div>
            </div>
        </div>
    `;
}

/**
 * TradingEconomics 차트 데이터 로드 및 렌더링
 */
async function loadTradingEconomicsChart(canvas, url, title, duration = '', force = false) {
    const wrapper = canvas.closest('.te-chart-wrapper');
    const loadingEl = wrapper?.querySelector('.te-chart-loading');

    if (loadingEl) loadingEl.style.display = 'block';

    try {
        let proxyUrl = `/api/trading-economics?url=${encodeURIComponent(url)}`;
        if (duration) proxyUrl += `&duration=${encodeURIComponent(duration)}`;
        if (force) proxyUrl += `&force_refresh=true`;


        if (loadingEl) {
            loadingEl.style.display = 'block';
            loadingEl.textContent = '브라우저 시동 중...';
        }

        const response = await queueTeRequest(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                console.warn(`[TradingEconomics] Timeout (120s) for ${url}`);
            }, 120000);
            try { return await fetch(proxyUrl, { signal: controller.signal }); }
            finally { clearTimeout(timeoutId); }
        });

        // v30.9.10: Handle non-JSON (HTML) responses from Gateway/Proxy
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('text/html')) {
            const htmlText = await response.text();
            if (htmlText.includes('504') || htmlText.includes('Time-out')) throw new Error('서버 타임아웃 (Proxy 504). 데이터가 많거나 서버가 느립니다.');
            if (htmlText.includes('502')) throw new Error('서버 연결 오류 (Proxy 502).');
            throw new Error('서버가 JSON 대신 HTML을 반환했습니다. (Proxy Error)');
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.details || result.error || '서버에서 데이터를 가져오는데 실패했습니다.');
        }

        if (!result.data || !Array.isArray(result.data)) {
            let errorMsg = 'Invalid data format';
            if (result.data === null) {
                errorMsg = '데이터 없음 (Guest 계정 제한 또는 URL 오류)';
            } else if (result.data !== undefined) {
                errorMsg = `Invalid data format: Expected array but got ${typeof result.data}`;
            }
            throw new Error(errorMsg);
        }

        const rawData = result.data;
        if (rawData.length > 0) {
            console.log('[TradingEconomics] Data sample:', rawData[0]);
        }

        // Parse data: find date and value fields dynamically
        const chartData = rawData.map(item => {
            const dateStr = item.DateTime || item.Date || item.date || item.last_update;
            const val = item.Value !== undefined ? item.Value :
                (item.Close !== undefined ? item.Close :
                    (item.Actual !== undefined ? item.Actual :
                        (item.actual !== undefined ? item.actual :
                            (item.LatestValue !== undefined ? item.LatestValue :
                                (item.latest_value !== undefined ? item.latest_value :
                                    (item.PreviousValue !== undefined ? item.PreviousValue : item.previous_value))))));

            const dt = new Date(dateStr);
            // v15: Standardize to local midnight to match MultiSeries logic
            const localDate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
            return { date: localDate, value: parseFloat(val) };
        }).filter(d => d.date instanceof Date && !isNaN(d.date.getTime()) && !isNaN(d.value))
            .sort((a, b) => a.date - b.date);

        // Save URL for timezone detection in draw function
        canvas.dataset.chartUrl = url;

        if (chartData.length === 0) {
            const keys = rawData.length > 0 ? Object.keys(rawData[0]).join(', ') : 'none';
            throw new Error(`데이터 파싱 실패 (구성 항목: ${keys})`);
        }

        if (loadingEl) loadingEl.style.display = 'none';

        // Draw the chart
        drawTradingEconomicsLineChart(canvas, chartData, title);

    } catch (error) {
        console.error('[TradingEconomics] Chart load error:', error);
        if (loadingEl) {
            loadingEl.textContent = '로드 실패: ' + error.message;
            loadingEl.style.color = '#e74c3c';
        }
    }
}

/**
 * TradingEconomics 라인 차트 그리기
 */
function drawTradingEconomicsLineChart(canvas, data, title) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    const targetW = Math.floor(w * dpr);
    const targetH = Math.floor(h * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Clear
    ctx.clearRect(0, 0, w, h);

    const padding = { top: 20, right: 50, bottom: 45, left: 10 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Calculate min/max values
    // v18: Use source-aware filter limit (36h buffer to allow international 'today')
    const now = new Date();
    const todayFilterLimit = new Date(now.getTime() + 1 * 3600000); // v30.15: Strictly limit to 1h buffer to prevent projection leaking

    // v30.7: Diagnostic Log
    console.log(`[Diagnostic] drawTradingEconomicsLineChart RAW (${canvas.dataset.chartUrl || 'unknown'}): Array length = ${data.length}, Last Items =`, data.slice(-5).map(d => ({ date: d.date.toISOString(), value: d.value })));

    const validData = data.filter(d => d.value !== null && !isNaN(d.value) && d.date <= todayFilterLimit);

    // v30.7: Diagnostic Log
    console.log(`[Diagnostic] drawTradingEconomicsLineChart VALID (${canvas.dataset.chartUrl || 'unknown'}): Filter Limit = ${todayFilterLimit.toISOString()}, Array length = ${validData.length}, Last Items =`, validData.slice(-5).map(d => ({ date: d.date.toISOString(), value: d.value })));

    if (validData.length === 0) return;

    // v18: Deduplicate by date (take last point per day for daily charts)
    const dailyMap = new Map();
    validData.forEach(d => {
        const key = `${d.date.getFullYear()}-${d.date.getMonth()}-${d.date.getDate()}`;
        dailyMap.set(key, d);
    });

    // Sort and re-standardize to local midnight
    data = Array.from(dailyMap.values()).map(d => ({
        date: new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate()),
        value: d.value
    })).sort((a, b) => a.date - b.date);

    // Zoom state override
    let currentMinDate;
    let currentMaxDate;
    
    // Always calculate original bounds from the dataset provided (if it's the full one) or fallback to cached
    const calcMinDate = data[0].date;
    const calcMaxDate = data[data.length - 1].date;
    
    // If the passed in data already has bounds cached, use those as the absolute "original"
    const originalMinDate = (canvas.chartData && canvas.chartData.originalMinDate) ? canvas.chartData.originalMinDate : calcMinDate;
    const originalMaxDate = (canvas.chartData && canvas.chartData.originalMaxDate) ? canvas.chartData.originalMaxDate : calcMaxDate;
    // v30.22: Preserve the full original data if we already have it, otherwise use the current dataset
    const originalFullData = (canvas.chartData && canvas.chartData.originalData) ? canvas.chartData.originalData : data;

    if (canvas.zoomState && canvas.zoomState.active) {
        currentMinDate = canvas.zoomState.minDate;
        currentMaxDate = canvas.zoomState.maxDate;
    } else {
        // Reset zoom state to the absolute original bounds
        currentMinDate = originalMinDate;
        currentMaxDate = originalMaxDate;
        canvas.zoomState = { active: false, minDate: currentMinDate, maxDate: currentMaxDate };
    }

    // Filter data for the current view to recalculate Y min/max based on visible data
    const visibleData = data.filter(d => d.date >= currentMinDate && d.date <= currentMaxDate);
    const renderData = visibleData.length > 0 ? visibleData : data; // Fallback entirely to original if Zoom is empty

    const values = renderData.map(d => d.value);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    const buffer = range * 0.1;

    const yMin = minVal - buffer;
    const yMax = maxVal + buffer;

    // Font settings
    const axisFont = '11px sans-serif';
    const headerFont = 'bold 12px sans-serif';
    const dateFont = '10px sans-serif';
    const legendFont = 'bold 12px sans-serif'; // v15: Fix ReferenceError

    // Cache data for redraw
    canvas.chartData = {
        data: renderData, // Data visible in the current zoomed range
        originalData: originalFullData, // Keep the full dataset for zoom reset
        title: title,
        minDate: currentMinDate,
        maxDate: currentMaxDate,
        originalMinDate: originalMinDate,
        originalMaxDate: originalMaxDate,
        yMin: yMin,
        yMax: yMax,
        padding: padding,
        chartW: chartW,
        chartH: chartH,
        w: w,
        h: h
    };
    canvas.setAttribute('data-chart-type', 'te-single');

    // Draw grid lines
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
        const y = padding.top + (chartH / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(w - padding.right, y);
        ctx.stroke();

        // Y-axis labels
        const val = yMax - ((yMax - yMin) / gridLines) * i;
        ctx.fillStyle = '#666';
        ctx.font = axisFont;
        ctx.textAlign = 'left';
        ctx.fillText(val.toFixed(2), w - padding.right + 5, y + 3);
    }

    let minDate = data[0].date;
    let maxDate = data[data.length - 1].date;

    // Safety: if only one point or same dates, create a 1-day range to avoid division by zero
    if (minDate.getTime() === maxDate.getTime()) {
        minDate = new Date(minDate.getTime() - 12 * 60 * 60 * 1000);
        maxDate = new Date(maxDate.getTime() + 12 * 60 * 60 * 1000);
    }

    // Draw line
    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    renderData.forEach((point, i) => {
        const x = padding.left + ((point.date - currentMinDate) / (currentMaxDate - currentMinDate)) * chartW;
        const y = padding.top + (1 - (point.value - yMin) / (yMax - yMin)) * chartH;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();

    // Draw data points
    ctx.fillStyle = '#3498db';
    if (renderData.length <= 60) {
        renderData.forEach((point, i) => {
            const x = padding.left + ((point.date - currentMinDate) / (currentMaxDate - currentMinDate)) * chartW;
            const y = padding.top + (1 - (point.value - yMin) / (yMax - yMin)) * chartH;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    // Standardized X-Axis Labels
    ctx.fillStyle = '#999';
    ctx.font = axisFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const dateRange = currentMaxDate - currentMinDate;
    const daysDiff = dateRange / (1000 * 60 * 60 * 24);

    let numLabels = 5;
    if (daysDiff > 3650) numLabels = 8;
    else if (daysDiff > 1825) numLabels = 6;

    for (let i = 0; i <= numLabels; i++) {
        const ratio = i / numLabels;
        const date = new Date(currentMinDate.getTime() + dateRange * ratio);
        const x = padding.left + chartW * ratio;

        let dateLabel;
        if (daysDiff > 730) {
            dateLabel = date.getFullYear().toString();
        } else if (daysDiff > 180) {
            dateLabel = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
        } else {
            dateLabel = `${date.getMonth() + 1}/${date.getDate()}`;
        }
        ctx.fillText(dateLabel, x, h - 30);
    }

    // Standardized Legend (Single Line top-right)
    const latestItem = renderData[renderData.length - 1] || data[data.length - 1];
    const mm = String(latestItem.date.getMonth() + 1).padStart(2, '0');
    const dd = String(latestItem.date.getDate()).padStart(2, '0');
    const dateStr = `${mm}/${dd}`;

    // Get timezone label from URL (this is te-single, so dataSource='te')
    const tzLabel = getTimezoneForUrl(canvas.dataset.chartUrl || '', 'te');

    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#2c3e50';
    ctx.font = legendFont;
    ctx.fillText(`${title} (${dateStr}${tzLabel}): ${latestItem.value.toFixed(2)}`, w - padding.right, 10);

    // Mouse interactive events
    if (!canvas.hasInteractiveEvents) {
        canvas.hasInteractiveEvents = true;

        canvas.addEventListener('mousedown', (e) => {
            if (!canvas.chartData) return;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const { padding, chartW } = canvas.chartData;
            
            if (mouseX >= padding.left && mouseX <= padding.left + chartW) {
                canvas.isDragging = true;
                canvas.dragStartX = mouseX;
                canvas.dragEndX = mouseX;
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!canvas.chartData) return;
            const rect = canvas.getBoundingClientRect();
            let mouseX = e.clientX - rect.left;
            const { padding, chartW, minDate, maxDate, data } = canvas.chartData;

            // Clamp mouseX to chart area
            mouseX = Math.max(padding.left, Math.min(mouseX, padding.left + chartW));

            if (canvas.isDragging) {
                canvas.dragEndX = mouseX;
                // Redraw with the drag selection overlay
                drawTradingEconomicsWithCursor(canvas, mouseX, [], true);
                return;
            }

            if (mouseX < padding.left || mouseX > padding.left + chartW) return;

            const ratio = (mouseX - padding.left) / chartW;
            const hoveredDate = new Date(minDate.getTime() + (maxDate - minDate) * ratio);

            // Find closest index
            const closest = data.reduce((prev, curr) => {
                return Math.abs(curr.date - hoveredDate) < Math.abs(prev.date - hoveredDate) ? curr : prev;
            });

            const hoveredValues = [{ label: canvas.chartData.title, value: closest.value, date: closest.date }];

            drawTradingEconomicsWithCursor(canvas, mouseX, hoveredValues);
            syncCursorToOtherCharts(canvas, hoveredDate);
        });

        canvas.addEventListener('mouseup', (e) => {
            if (!canvas.isDragging || !canvas.chartData) return;
            canvas.isDragging = false;
            
            const { padding, chartW, minDate, maxDate, originalData, title } = canvas.chartData;
            
            // Allow minimum 10px drag to consider it a zoom selection, avoiding normal clicks
            if (Math.abs(canvas.dragEndX - canvas.dragStartX) > 10) {
                if (canvas.dragEndX > canvas.dragStartX) {
                    // Left to Right Drag -> Zoom In
                    const startRatio = (canvas.dragStartX - padding.left) / chartW;
                    const endRatio = (canvas.dragEndX - padding.left) / chartW;
                    const newMinDate = new Date(minDate.getTime() + (maxDate - minDate) * startRatio);
                    const newMaxDate = new Date(minDate.getTime() + (maxDate - minDate) * endRatio);
                    
                    canvas.zoomState = {
                        active: true,
                        minDate: newMinDate,
                        maxDate: newMaxDate
                    };
                } else {
                    // Right to Left Drag -> Zoom Out (Reset)
                    canvas.zoomState = { active: false };
                }
                
                // Redraw with the new zoom state using the original full data
                const fullData = canvas.chartData.originalData || originalData;
                drawTradingEconomicsLineChart(canvas, fullData, title);
                syncZoomToOtherCharts(canvas, canvas.zoomState);
            } else {
                // Was just a click, redraw normally
                drawTradingEconomicsLineChart(canvas, originalData, title);
            }
        });

        canvas.addEventListener('mouseleave', () => {
            canvas.isDragging = false; // Cancel drag on leave
            if (canvas.chartData) {
                // Redraw with the current zoom state using the original full data
                drawTradingEconomicsLineChart(canvas, canvas.chartData.originalData, canvas.chartData.title);
            }
            clearCursorFromOtherCharts(canvas);
        });
    }
}

/**
 * 커서와 툴팁이 포함된 TradingEconomics 차트 그리기
 */
function drawTradingEconomicsWithCursor(canvas, mouseX, hoveredValues, isDraggingOverlay = false) {
    if (!canvas.chartData) return;

    const { data, title, minDate, maxDate, yMin, yMax, padding, chartW, chartH, w, h } = canvas.chartData;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const targetW = Math.floor(w * dpr);


    const targetH = Math.floor(h * dpr);



    if (canvas.width !== targetW || canvas.height !== targetH) {


        canvas.width = targetW;


        canvas.height = targetH;


        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);


    } else {


        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);


    }
    ctx.clearRect(0, 0, w, h);

    const axisFont = '11px sans-serif';
    const headerFont = 'bold 12px sans-serif';

    // 그리드
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartH / 5) * i;
        ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(w - padding.right, y); ctx.stroke();
        const val = yMax - ((yMax - yMin) / 5) * i;
        ctx.fillStyle = '#666'; ctx.font = axisFont; ctx.textAlign = 'left';
        ctx.fillText(val.toFixed(2), w - padding.right + 5, y + 3);
    }

    // 데이터 라인
    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    data.forEach((point, i) => {
        const x = padding.left + ((point.date - minDate) / (maxDate - minDate)) * chartW;
        const y = padding.top + (1 - (point.value - yMin) / (yMax - yMin)) * chartH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // X축 라벨 (Standardized)
    ctx.fillStyle = '#999';
    ctx.font = axisFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const dateRange = maxDate - minDate;
    const daysDiff = dateRange / (1000 * 60 * 60 * 24);
    let numLabels = 5;
    if (daysDiff > 3650) numLabels = 8;
    else if (daysDiff > 1825) numLabels = 6;

    for (let i = 0; i <= numLabels; i++) {
        const ratio = i / numLabels;
        const date = new Date(minDate.getTime() + dateRange * ratio);
        const x = padding.left + chartW * ratio;
        let dateLabel;
        if (daysDiff > 730) dateLabel = date.getFullYear().toString();
        else if (daysDiff > 180) dateLabel = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
        else dateLabel = `${date.getMonth() + 1}/${date.getDate()}`;
        ctx.fillText(dateLabel, x, h - 30);
    }

    // 수직 커서선 또는 드래그 오버레이
    if (isDraggingOverlay && canvas.isDragging) {
        const startX = Math.min(canvas.dragStartX, canvas.dragEndX);
        const width = Math.abs(canvas.dragEndX - canvas.dragStartX);
        
        ctx.fillStyle = 'rgba(52, 152, 219, 0.2)'; // Light blue translucent
        ctx.fillRect(startX, padding.top, width, chartH);
        
        ctx.strokeStyle = 'rgba(52, 152, 219, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX, padding.top, width, chartH);
    } else {
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(mouseX, padding.top);
        ctx.lineTo(mouseX, padding.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 툴팁 및 포인트 마커
    if (hoveredValues && hoveredValues.length > 0) {
        const v = hoveredValues[0];
        const pointX = padding.left + ((v.date - minDate) / (maxDate - minDate)) * chartW;
        const pointY = padding.top + (1 - (v.value - yMin) / (yMax - yMin)) * chartH;

        // 마커
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(pointX, pointY, 5, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = '#ff6b6b';
        ctx.beginPath(); ctx.arc(pointX, pointY, 4, 0, 2 * Math.PI); ctx.fill();

        // 툴팁 박스
        const tooltipW = 140;
        const tooltipH = 40;
        let tx = mouseX + 10;
        if (tx + tooltipW > w - padding.right) tx = mouseX - tooltipW - 10;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.fillRect(tx, padding.top + 10, tooltipW, tooltipH);
        ctx.strokeRect(tx, padding.top + 10, tooltipW, tooltipH);

        ctx.fillStyle = '#333';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const dStr = `${v.date.getFullYear()}/${String(v.date.getMonth() + 1).padStart(2, '0')}/${String(v.date.getDate()).padStart(2, '0')}`;
        ctx.fillText(dStr, tx + 8, padding.top + 15);
        ctx.fillText(`${title}: ${v.value.toFixed(2)}`, tx + 8, padding.top + 30);
    }

    // Standardized Legend (Single Line top-right) - v16: match idle state
    const latestItem = data[data.length - 1];
    const mm = String(latestItem.date.getMonth() + 1).padStart(2, '0');
    const dd = String(latestItem.date.getDate()).padStart(2, '0');
    const dateStr = `${mm}/${dd}`;
    const tzLabel = getTimezoneForUrl(canvas.dataset.chartUrl || '', 'te');

    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`${title} (${dateStr}${tzLabel}): ${latestItem.value.toFixed(2)}`, w - padding.right, 10);
}

/**
 * 다중 시리즈 차트 데이터 로드 및 렌더링
 */
async function loadMultiSeriesChart(canvas, urls, title, force = false) {
    const loadingEl = canvas.nextElementSibling;
    if (loadingEl) {
        loadingEl.style.display = 'flex';
        loadingEl.style.color = 'var(--text-muted)';
        loadingEl.textContent = '데이터 로딩 중...';
    }

    try {
        let seriesConfig = [];
        if (Array.isArray(urls)) {
            const allStrings = urls.every(u => typeof u === 'string');
            if (urls.length > 0 && urls.length % 3 === 0 && allStrings &&
                (urls[0].includes('http') || urls[0].includes('tradingeconomics'))) {
                for (let i = 0; i < urls.length; i += 3) {
                    seriesConfig.push({
                        url: urls[i],
                        label: urls[i + 1],
                        duration: urls[i + 2]
                    });
                }
            } else {
                seriesConfig = urls.map(u => {
                    if (typeof u === 'string') return { url: u, label: '' };
                    if (Array.isArray(u)) return { url: u[0], label: u[1], duration: u[2] };
                    return u;
                });
            }
        }

        // v30.16: ASCII Normalization for FRED/ECOS periods
        const normalizePeriod = (p) => {
            if (!p) return '1y';
            p = p.toLowerCase();
            if (p.includes('10년') || p.includes('10y')) return '10y';
            if (p.includes('5년') || p.includes('5y')) return '5y';
            if (p.includes('2년') || p.includes('2y')) return '2y';
            if (p.includes('1년') || p.includes('1y')) return '1y';
            if (p.includes('6개월') || p.includes('6m')) return '6m';
            return p;
        };

        const results = [];
        for (const item of seriesConfig) {
            const res = await (async (item) => {
                try {
                    const { url, label } = item;
                    let data = null;
                    let dataSource = '';
                    const lowerUrl = url.toLowerCase();
                    if (lowerUrl.startsWith('fred(') || lowerUrl.indexOf('stlouisfed.org') !== -1) dataSource = 'fred';
                    else if (lowerUrl.startsWith('ecos(') || lowerUrl.indexOf('ecos.bok') !== -1) dataSource = 'ecos';
                    else if (lowerUrl.indexOf('tradingeconomics.com') !== -1 || lowerUrl.indexOf('tradingeconomics') !== -1) dataSource = 'te';

                    let retryCount = 0;
                    const MAX_RETRIES = 1;

                    while (retryCount <= MAX_RETRIES) {
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s

                            let fetchUrl = "";
                            if (dataSource === 'fred') {
                                const fredMatch = url.match(/fred\s*\(\s*([^,)]+)(?:,\s*([^)]+))?\s*\)/i);
                                if (fredMatch) {
                                    const sid = fredMatch[1].replace(/['"“”‘’]/g, '').trim();
                                    const per = fredMatch[2] ? fredMatch[2].replace(/['"“”‘’]/g, '').trim() : '1y';
                                    fetchUrl = `/api/fred?series_id=${encodeURIComponent(sid)}&period=${encodeURIComponent(normalizePeriod(per))}`;
                                }
                            } else if (dataSource === 'ecos') {
                                const innerResult = url.match(/ecos\s*\(([^)]+)\)/i);
                                if (innerResult) {
                                    const args = innerResult[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
                                    let tbl = '817Y002';
                                    let itm = '';
                                    let per = '';
                                    if (args.length === 3) { tbl = args[0]; itm = args[1]; per = args[2]; }
                                    else if (args.length === 2) { itm = args[0]; per = args[1]; }

                                    const localNow = new Date();
                                    const formatLocalYMD = (d) => {
                                        const y = d.getFullYear();
                                        const m = String(d.getMonth() + 1).padStart(2, '0');
                                        const day = String(d.getDate()).padStart(2, '0');
                                        return `${y}${m}${day}`;
                                    };
                                    const endDate = formatLocalYMD(localNow);
                                    let startDateObj = new Date(localNow);
                                    const normalizedPer = normalizePeriod(per);
                                    if (normalizedPer.includes('y')) startDateObj.setFullYear(localNow.getFullYear() - (parseInt(normalizedPer) || 1));
                                    else if (normalizedPer.includes('m')) startDateObj.setMonth(localNow.getMonth() - (parseInt(normalizedPer) || 1));
                                    else startDateObj.setFullYear(localNow.getFullYear() - 1);
                                    const startDate = formatLocalYMD(startDateObj);
                                    fetchUrl = `/api/ecos?table=${encodeURIComponent(tbl)}&item=${encodeURIComponent(itm)}&start=${startDate}&end=${endDate}`;
                                }
                            } else if (dataSource === 'te') {
                                const period = item.duration || '';
                                fetchUrl = `/api/trading-economics?url=${encodeURIComponent(url)}${period ? `&duration=${encodeURIComponent(period)}` : ''}`;
                                if (force) fetchUrl += `&force_refresh=true`;
                            }

                            if (!fetchUrl) break;

                            let resp;
                            if (dataSource === 'te') {
                                clearTimeout(timeoutId); // 대기열에서 차례를 기다리는 동안에는 타임아웃을 걸지 않음
                                resp = await queueTeRequest(async () => {
                                    const teController = new AbortController();
                                    const teTimeoutId = setTimeout(() => teController.abort(), 120000);
                                    try { return await fetch(fetchUrl, { signal: teController.signal }); }
                                    finally { clearTimeout(teTimeoutId); }
                                });
                            } else {
                                resp = await fetch(fetchUrl, { signal: controller.signal });
                                clearTimeout(timeoutId);
                            }

                            if (!resp.ok) {
                                const ct = resp.headers.get('content-type');
                                if (resp.status === 504 && retryCount < MAX_RETRIES) {
                                    console.warn(`[MultiSeries] 504 detected for ${url}. Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
                                    retryCount++;
                                    await new Promise(r => setTimeout(r, 2000)); // Wait before retry
                                    continue;
                                }
                                if (ct && ct.includes('text/html')) throw new Error(`서버 타임아웃/오류 (HTTP ${resp.status})`);
                                throw new Error(`서버 오류 (${resp.status})`);
                            }

                            const ct = resp.headers.get('content-type');
                            if (ct && ct.includes('text/html')) throw new Error('서버가 HTML을 반환했습니다. (Timeout 가능성)');

                            const resJson = await resp.json();
                            if (resJson.success) {
                                if (dataSource === 'fred') {
                                    data = resJson.data.map(d => {
                                        const dt = new Date(d.date);
                                        if (isNaN(dt.getTime())) return null;
                                        return { date: new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()), value: d.value };
                                    }).filter(x => x !== null);
                                } else if (dataSource === 'ecos' && resJson.data) {
                                    data = resJson.data.map(r => {
                                        const dStr = r.TIME;
                                        if (dStr.length === 8) {
                                            return { date: new Date(parseInt(dStr.substring(0, 4)), parseInt(dStr.substring(4, 6)) - 1, parseInt(dStr.substring(6, 8))), value: parseFloat(r.DATA_VALUE) };
                                        }
                                        return null;
                                    }).filter(x => x !== null).sort((a, b) => a.date - b.date);
                                } else if (dataSource === 'te' && Array.isArray(resJson.data) && resJson.data.length > 0) {
                                    const todayFilterLimit = new Date(new Date().getTime() + 1 * 3600000);
                                    const validData = resJson.data.map(i => {
                                        const dStr = i.DateTime || i.Date || i.date || i.last_update;
                                        const val = i.Value !== undefined ? i.Value : (i.Close !== undefined ? i.Close : (i.Actual !== undefined ? i.Actual : i.actual));
                                        return { date: new Date(dStr), value: parseFloat(val) };
                                    }).filter(d => !isNaN(d.date.getTime()) && !isNaN(d.value) && d.date <= todayFilterLimit)
                                        .sort((a, b) => a.date - b.date);

                                    const dailyMap = new Map();
                                    validData.forEach(d => { dailyMap.set(`${d.date.getFullYear()}-${d.date.getMonth()}-${d.date.getDate()}`, d); });
                                    data = Array.from(dailyMap.values()).map(d => ({
                                        date: new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate()),
                                        value: d.value
                                    })).sort((a, b) => a.date - b.date);
                                }
                            } else {
                                throw new Error(resJson.error || 'Unknown Error');
                            }
                            break; // Success
                        } catch (err) {
                            if (retryCount < MAX_RETRIES && (err.name === 'AbortError' || err.message.includes('504') || err.message.includes('fetch'))) {
                                console.warn(`[MultiSeries] Retryable error for ${url}: ${err.message}. Retrying...`);
                                retryCount++;
                                await new Promise(r => setTimeout(r, 2000));
                                continue;
                            }
                            throw err;
                        }
                    }

                    if (data && data.length > 0) {
                        let finalSource = dataSource || 'te';
                        if (url.includes('stlouisfed.org') || url.includes('fred')) finalSource = 'fred';
                        if (url.includes('ecos.bok')) finalSource = 'ecos';
                        return { url, label: label || url.split('/').pop().split('?')[0], dataSource: finalSource, data };
                    }
                    return null;
                } catch (err) {
                    console.warn("[MultiSeries] Failed to load individual series:", err);
                    return null;
                }
            })(item);
            results.push(res);
        }
        const validResults = results.filter(r => r && r.data.length > 0);
        if (validResults.length === 0) throw new Error("유효한 데이터가 없습니다.");

        drawMultiSeriesLineChart(canvas, validResults, title);
        if (loadingEl) loadingEl.style.display = 'none';

    } catch (e) {
        console.error("[MultiSeries] Error loading chart:", e);
        if (loadingEl) {
            loadingEl.textContent = `오류: ${e.message}`;
            loadingEl.style.color = '#e74c3c';
        }
    }
}

/**
 * URL이나 데이터 소스에 따른 시간대(Timezone) 표시 반환
 */
function getTimezoneForUrl(url, dataSource) {
    const lowerUrl = (url || '').toLowerCase();

    // Country detection should come FIRST
    if (lowerUrl.includes('south-korea') || lowerUrl.includes('korea') || lowerUrl.includes('krw')) return ' (KST)';
    if (lowerUrl.includes('japan') || lowerUrl.includes('jpy')) return ' (JST)';
    if (lowerUrl.includes('china') || lowerUrl.includes('cny') || lowerUrl.includes('cnh') || lowerUrl.includes('rmb')) return ' (CST)';
    if (lowerUrl.includes('euro-area') || lowerUrl.includes('germany') || lowerUrl.includes('eur')) return ' (CET)';
    if (lowerUrl.includes('united-kingdom') || lowerUrl.includes('uk/') || lowerUrl.includes('gbp')) return ' (GMT)';

    if (dataSource === 'ecos') return ' (KST)';
    if (dataSource === 'fred' || lowerUrl.includes('fred') || lowerUrl.includes('stlouisfed')) return ' (EST)';

    // Default TE or generic
    if (dataSource === 'te' || lowerUrl.includes('tradingeconomics')) return ' (Local)';
    return '';
}

/**
 * 다중 선 차트 그리기
 */
function drawMultiSeriesLineChart(canvas, allSeries, title) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // Font settings - consistent across all redraws
    const axisFont = '11px sans-serif'; // for X/Y axis
    const legendFont = 'bold 12px sans-serif'; // for legend
    const dateFont = '10px sans-serif'; // for latest date

    const targetW = Math.floor(w * dpr);


    const targetH = Math.floor(h * dpr);



    if (canvas.width !== targetW || canvas.height !== targetH) {


        canvas.width = targetW;


        canvas.height = targetH;


        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);


    } else {


        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);


    }
    ctx.clearRect(0, 0, w, h);

    const padding = { top: 50, right: 60, bottom: 50, left: 10 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // 공통 X축(날짜) 범위 및 Y축 범위 계산
    let allValues = [];
    let minDate = new Date(8640000000000000);
    let maxDate = new Date(-8640000000000000);

    allSeries.forEach(s => {
        if (!s.data || s.data.length === 0) return;

        // v30.9.2: Data is already filtered in loadMultiSeriesChart.
        // v30.13: Safety re-filter for common range calculation
        const now = new Date();
        const tomorrowEnd = new Date(now.getTime() + 1 * 3600000); // v30.15: 1h buffer

        s.data.forEach(d => {
            if (d.value === null || isNaN(d.value)) return;
            if (d.date > tomorrowEnd) return; // Ignore future projections in range calculation

            allValues.push(d.value);
            if (d.date < minDate) minDate = d.date;
            // Ensure maxDate strictly captures the absolute latest point across ALL series
            if (d.date > maxDate) maxDate = d.date;
        });
    });

    // v30.8: Diagnostic Log
    console.log(`[Diagnostic] drawMultiSeriesLineChart START: minDate = ${minDate.toISOString()}, maxDate = ${maxDate.toISOString()}`);
    allSeries.forEach(s => {
        if (s.data && s.data.length > 0) {
            console.log(`[Diagnostic] Series ${s.label || s.url} Final Items:`, s.data.slice(-3).map(d => ({ date: d.date.toISOString(), value: d.value })));
        }
    });

    if (allValues.length === 0) return;

    // Zoom state override
    let currentMinDate;
    let currentMaxDate;

    // Use cached original bounds if available, else use calculated
    const originalMinDate = (canvas.chartData && canvas.chartData.originalMinDate) ? canvas.chartData.originalMinDate : minDate;
    const originalMaxDate = (canvas.chartData && canvas.chartData.originalMaxDate) ? canvas.chartData.originalMaxDate : maxDate;

    if (canvas.zoomState && canvas.zoomState.active) {
        currentMinDate = canvas.zoomState.minDate;
        currentMaxDate = canvas.zoomState.maxDate;
    } else {
        // Reset zoom state to absolute true bounds
        currentMinDate = originalMinDate;
        currentMaxDate = originalMaxDate;
        canvas.zoomState = { active: false, minDate: currentMinDate, maxDate: currentMaxDate };
    }

    // Filter data for the current view to recalculate Y min/max based on visible data
    let visibleValues = [];
    allSeries.forEach(s => {
        if (!s.data || s.data.length === 0) return;
        s.data.forEach(d => {
            if (d.value !== null && !isNaN(d.value) && d.date >= currentMinDate && d.date <= currentMaxDate) {
                visibleValues.push(d.value);
            }
        });
    });

    const renderValues = visibleValues.length > 0 ? visibleValues : allValues;

    const minVal = Math.min(...renderValues);
    const maxVal = Math.max(...renderValues);
    const range = maxVal - minVal || 1;
    const buffer = range * 0.1;

    const yMin = minVal - buffer;
    const yMax = maxVal + buffer;

    // 차트 데이터를 canvas에 저장 (마우스 이벤트에서 사용)
    canvas.chartData = {
        allSeries: allSeries,
        minDate: currentMinDate,
        maxDate: currentMaxDate,
        originalMinDate: originalMinDate,
        originalMaxDate: originalMaxDate,
        yMin: yMin,
        yMax: yMax,
        padding: padding,
        chartW: chartW,
        chartH: chartH,
        w: w,
        h: h,
        title: title
    };
    canvas.setAttribute('data-chart-type', 'multi-series');

    // 그리드
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartH / 5) * i;
        ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(w - padding.right, y); ctx.stroke();
        const val = yMax - ((yMax - yMin) / 5) * i;
        ctx.fillStyle = '#999'; ctx.font = axisFont; ctx.textAlign = 'left';
        ctx.fillText(val.toFixed(2), w - padding.right + 5, y + 3);
    }

    // 데이터 그리기
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    allSeries.forEach((s, sIdx) => {
        const color = colors[sIdx % colors.length];
        const dataSource = s.dataSource || '';
        // Use helper to get correct timezone label
        const tzLabel = getTimezoneForUrl(s.url || '', dataSource);

        ctx.save();
        ctx.beginPath();
        ctx.rect(padding.left, padding.top, chartW, chartH);
        ctx.clip(); // Clip the drawing to the chart area so lines don't overflow the padding

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        // Re-iterate without skipping to let canvas handle lines going off-screen
        let firstPoint = true;
        s.data.forEach((d, i) => {
             const x = padding.left + ((d.date - currentMinDate) / (currentMaxDate - currentMinDate)) * chartW;
             const y = padding.top + (1 - (d.value - yMin) / (yMax - yMin)) * chartH;
             if (firstPoint) { ctx.moveTo(x, y); firstPoint = false; } else ctx.lineTo(x, y);
        });
        
        ctx.stroke();
        ctx.restore();

        // 범례 표시 (우측 상단)
        ctx.fillStyle = color;
        ctx.font = legendFont;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        const lastItem = s.data[s.data.length - 1];
        // Use local date methods to avoid UTC shift in legend
        const mm = String(lastItem.date.getMonth() + 1).padStart(2, '0');
        const dd = String(lastItem.date.getDate()).padStart(2, '0');
        const dateStr = `${mm}/${dd}`;
        ctx.fillText(`${s.label} (${dateStr}${tzLabel}): ${lastItem.value.toFixed(2)}`, w - padding.right, 10 + (sIdx * 15)); // increased spacing
    });

    // X축 라벨 (여러 개의 중간 날짜 표시)
    ctx.fillStyle = '#999';
    ctx.font = axisFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // 날짜 범위에 따라 적절한 간격으로 레이블 표시
    let minDateOverall = null;
    let maxDateOverall = null;
    allSeries.forEach(s => {
        if (s.data && s.data.length > 0) {
            // Find min/max of the visible subset of this series
            const visibleSeries = s.data.filter(d => d.date >= currentMinDate && d.date <= currentMaxDate);
            if (visibleSeries.length > 0) {
                const sMin = visibleSeries[0].date;
                const sMax = visibleSeries[visibleSeries.length - 1].date;
                if (minDateOverall === null || sMin < minDateOverall) minDateOverall = sMin;
                if (maxDateOverall === null || sMax > maxDateOverall) maxDateOverall = sMax;
            }
        }
    });

    if (!minDateOverall || !maxDateOverall) {
        // Fallback to currentMinDate/currentMaxDate if no individual series points perfectly land inside the bounds
        minDateOverall = currentMinDate;
        maxDateOverall = currentMaxDate;
    }

    const dateRange = currentMaxDate - currentMinDate;
    const daysDiff = dateRange / (1000 * 60 * 60 * 24);

    let numLabels = 5;
    if (daysDiff > 3650) numLabels = 8;
    else if (daysDiff > 1825) numLabels = 6;

    for (let i = 0; i <= numLabels; i++) {
        const ratio = i / numLabels;
        const date = new Date(currentMinDate.getTime() + dateRange * ratio);
        const x = padding.left + chartW * ratio;

        // 날짜 포맷 (년도만 또는 년-월)
        let dateLabel;
        if (daysDiff > 730) { // 2년 이상이면 년도만
            dateLabel = date.getFullYear().toString();
        } else if (daysDiff > 180) { // 6개월 이상이면 년-월
            dateLabel = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
        } else { // 6개월 미만이면 월-일
            dateLabel = `${date.getMonth() + 1}/${date.getDate()}`;
        }

        ctx.fillText(dateLabel, x, h - 30);
    }

    // 마우스 이벤트 리스너 추가 (한 번만)
    if (!canvas.hasInteractiveEvents) {
        canvas.hasInteractiveEvents = true;

        canvas.addEventListener('mousedown', (e) => {
            if (!canvas.chartData) return;
            const rect = canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const { padding, chartW } = canvas.chartData;
            
            if (mouseX >= padding.left && mouseX <= padding.left + chartW) {
                canvas.isDragging = true;
                canvas.dragStartX = mouseX;
                canvas.dragEndX = mouseX;
            }
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!canvas.chartData) return;

            const rect = canvas.getBoundingClientRect();
            let mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const { padding, chartW, minDate, maxDate, allSeries } = canvas.chartData;

            // Clamp mouseX to chart area
            mouseX = Math.max(padding.left, Math.min(mouseX, padding.left + chartW));

            if (canvas.isDragging) {
                canvas.dragEndX = mouseX;
                // Redraw with the drag selection overlay
                drawMultiSeriesWithCursor(canvas, mouseX, [], true);
                return;
            }

            // 차트 영역 내에 있는지 확인
            if (mouseX < padding.left || mouseX > padding.left + chartW) {
                return;
            }

            // 마우스 X 위치를 날짜로 변환
            const ratio = (mouseX - padding.left) / chartW;
            const hoveredDate = new Date(minDate.getTime() + (maxDate - minDate) * ratio);

            // 각 시리즈에서 가장 가까운 데이터 포인트 찾기
            const hoveredValues = allSeries.map(s => {
                if (!s.data || s.data.length === 0) return null;
                const closest = s.data.reduce((prev, curr) => {
                    return Math.abs(curr.date - hoveredDate) < Math.abs(prev.date - hoveredDate) ? curr : prev;
                });
                return { label: s.label, value: closest.value, date: closest.date };
            }).filter(v => v !== null);

            // 차트 다시 그리기 (수직선 + 툴팁 포함)
            drawMultiSeriesWithCursor(canvas, mouseX, hoveredValues);

            // 같은 탭의 다른 차트에 동기화
            syncCursorToOtherCharts(canvas, hoveredDate);
        });

        canvas.addEventListener('mouseup', (e) => {
            if (!canvas.isDragging || !canvas.chartData) return;
            canvas.isDragging = false;
            
            const { padding, chartW, minDate, maxDate, allSeries, title } = canvas.chartData;
            
            // Allow minimum 10px drag to consider it a zoom selection, avoiding normal clicks
            if (Math.abs(canvas.dragEndX - canvas.dragStartX) > 10) {
                if (canvas.dragEndX > canvas.dragStartX) {
                    // Left to Right Drag -> Zoom In
                    const startRatio = (canvas.dragStartX - padding.left) / chartW;
                    const endRatio = (canvas.dragEndX - padding.left) / chartW;
                    const newMinDate = new Date(minDate.getTime() + (maxDate - minDate) * startRatio);
                    const newMaxDate = new Date(minDate.getTime() + (maxDate - minDate) * endRatio);
                    
                    canvas.zoomState = {
                        active: true,
                        minDate: newMinDate,
                        maxDate: newMaxDate
                    };
                } else {
                    // Right to Left Drag -> Zoom Out (Reset)
                    canvas.zoomState = { active: false };
                }
                
                // Redraw with the new zoom state using the original full data
                drawMultiSeriesLineChart(canvas, allSeries, title);
                syncZoomToOtherCharts(canvas, canvas.zoomState);
            } else {
                // Was just a click, redraw normally
                drawMultiSeriesLineChart(canvas, allSeries, title);
            }
        });

        canvas.addEventListener('mouseleave', () => {
            canvas.isDragging = false; // Cancel drag on leave
            // 커서 제거하고 원래 차트 다시 그리기
            if (canvas.chartData) {
                drawMultiSeriesLineChart(canvas, canvas.chartData.allSeries, canvas.chartData.title);
            }
            // 다른 차트의 커서도 제거
            clearCursorFromOtherCharts(canvas);
        });
    }
}

/**
 * 커서와 툴팁이 포함된 차트 그리기
 */
function drawMultiSeriesWithCursor(canvas, mouseX, hoveredValues, isDraggingOverlay = false) {
    if (!canvas.chartData) return;

    const { allSeries, minDate, maxDate, yMin, yMax, padding, chartW, chartH, w, h, title } = canvas.chartData;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // 캔버스 초기화
    const targetW = Math.floor(w * dpr);

    const targetH = Math.floor(h * dpr);


    if (canvas.width !== targetW || canvas.height !== targetH) {

        canvas.width = targetW;

        canvas.height = targetH;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    } else {

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    }
    ctx.clearRect(0, 0, w, h);

    // Font settings
    const axisFont = '11px sans-serif';
    const legendFont = 'bold 12px sans-serif';

    // 그리드
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartH / 5) * i;
        ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(w - padding.right, y); ctx.stroke();
        const val = yMax - ((yMax - yMin) / 5) * i;
        ctx.fillStyle = '#999'; ctx.font = axisFont; ctx.textAlign = 'left';
        ctx.fillText(val.toFixed(2), w - padding.right + 5, y + 3);
    }

    // 데이터 그리기
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

    allSeries.forEach((s, sIdx) => {
        const color = colors[sIdx % colors.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        s.data.forEach((d, i) => {
            const x = padding.left + ((d.date - minDate) / (maxDate - minDate)) * chartW;
            const y = padding.top + (1 - (d.value - yMin) / (yMax - yMin)) * chartH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // v16: Standardized Legend (Single Line top-right)
        ctx.fillStyle = color;
        ctx.font = legendFont;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        const lastItem = s.data[s.data.length - 1];
        const mm = String(lastItem.date.getMonth() + 1).padStart(2, '0');
        const dd = String(lastItem.date.getDate()).padStart(2, '0');
        const dateStr = `${mm}/${dd}`;
        const tzLabel = getTimezoneForUrl(s.url || '', s.dataSource || '');
        ctx.fillText(`${s.label} (${dateStr}${tzLabel}): ${lastItem.value.toFixed(2)}`, w - padding.right, 10 + (sIdx * 15));
    });

    // X축 라벨
    ctx.fillStyle = '#999';
    ctx.font = axisFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const dateRange = maxDate - minDate;
    const daysDiff = dateRange / (1000 * 60 * 60 * 24);
    let numLabels = 5;
    if (daysDiff > 3650) numLabels = 8;
    else if (daysDiff > 1825) numLabels = 6;

    for (let i = 0; i <= numLabels; i++) {
        const ratio = i / numLabels;
        const date = new Date(minDate.getTime() + dateRange * ratio);
        const x = padding.left + chartW * ratio;

        let dateLabel;
        if (daysDiff > 730) {
            dateLabel = date.getFullYear().toString();
        } else if (daysDiff > 180) {
            dateLabel = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
        } else {
            dateLabel = `${date.getMonth() + 1}/${date.getDate()}`;
        }

        ctx.fillText(dateLabel, x, h - 30);
    }

    // 수직 커서 라인 또는 드래그 오버레이
    if (isDraggingOverlay && canvas.isDragging) {
        const startX = Math.min(canvas.dragStartX, canvas.dragEndX);
        const width = Math.abs(canvas.dragEndX - canvas.dragStartX);
        
        ctx.fillStyle = 'rgba(52, 152, 219, 0.2)'; // Light blue translucent
        ctx.fillRect(startX, padding.top, width, chartH);
        
        ctx.strokeStyle = 'rgba(52, 152, 219, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX, padding.top, width, chartH);
    } else {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(mouseX, padding.top);
        ctx.lineTo(mouseX, padding.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 툴팁
    if (hoveredValues && hoveredValues.length > 0) {
        const tooltipWidth = 150;
        const tooltipHeight = 20 + hoveredValues.length * 15;
        let tooltipX = mouseX + 10;
        const tooltipY = padding.top + 10;

        // 툴팁이 화면 밖으로 나가지 않도록 조정
        if (tooltipX + tooltipWidth > w - padding.right) {
            tooltipX = mouseX - tooltipWidth - 10;
        }

        // 툴팁 배경
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
        ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);

        // 날짜
        ctx.fillStyle = '#333';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const tDate = hoveredValues[0].date;
        const dTooltipStr = `${tDate.getFullYear()}/${String(tDate.getMonth() + 1).padStart(2, '0')}/${String(tDate.getDate()).padStart(2, '0')}`;
        ctx.fillText(dTooltipStr, tooltipX + 5, tooltipY + 5);

        // 각 시리즈 값
        hoveredValues.forEach((v, i) => {
            ctx.fillStyle = colors[i % colors.length];
            ctx.font = '10px sans-serif';
            ctx.fillText(`${v.label}: ${v.value.toFixed(2)}`, tooltipX + 5, tooltipY + 20 + i * 15);
        });

        // 호버된 데이터 포인트에 붉은색 원형 마커 표시
        hoveredValues.forEach((v) => {
            const x = padding.left + ((v.date - minDate) / (maxDate - minDate)) * chartW;
            const y = padding.top + (1 - (v.value - yMin) / (yMax - yMin)) * chartH;

            // 외곽선 (흰색)
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, 2 * Math.PI);
            ctx.fill();

            // 내부 원 (붉은색)
            ctx.fillStyle = '#ff6b6b';
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, 2 * Math.PI);
            ctx.fill();
        });
    }
}

/**
 * 같은 탭의 다른 차트에 커서 동기화
 */
function syncCursorToOtherCharts(sourceCanvas, hoveredDate) {
    const activeContent = document.querySelector('.tab-content.active');
    if (!activeContent) return;

    const allCanvases = activeContent.querySelectorAll('canvas[data-chart-type="multi-series"], canvas[data-chart-type="te-single"]');

    allCanvases.forEach(canvas => {
        if (canvas === sourceCanvas) return;
        if (!canvas.chartData) return;

        const { minDate, maxDate, padding, chartW } = canvas.chartData;
        const chartType = canvas.getAttribute('data-chart-type');

        // 날짜 범위 내에 있는지 확인
        if (hoveredDate < minDate || hoveredDate > maxDate) return;

        // 해당 날짜에 가장 가까운 X 위치 계산
        const ratio = (hoveredDate - minDate) / (maxDate - minDate);
        const mouseX = padding.left + chartW * ratio;

        // 해당 위치의 값 찾기
        let hoveredValues = [];
        if (chartType === 'multi-series') {
            const { allSeries } = canvas.chartData;
            hoveredValues = allSeries.map(s => {
                if (!s.data || s.data.length === 0) return null;
                const closest = s.data.reduce((prev, curr) => {
                    return Math.abs(curr.date - hoveredDate) < Math.abs(prev.date - hoveredDate) ? curr : prev;
                });
                return { label: s.label, value: closest.value, date: closest.date };
            }).filter(v => v !== null);
            drawMultiSeriesWithCursor(canvas, mouseX, hoveredValues);
        } else if (chartType === 'te-single') {
            const { data, title } = canvas.chartData;
            const closest = data.reduce((prev, curr) => {
                return Math.abs(curr.date - hoveredDate) < Math.abs(prev.date - hoveredDate) ? curr : prev;
            });
            hoveredValues = [{ label: title, value: closest.value, date: closest.date }];
            drawTradingEconomicsWithCursor(canvas, mouseX, hoveredValues);
        }
    });
}

/**
 * 다른 차트의 커서 제거
 */
function clearCursorFromOtherCharts(sourceCanvas) {
    const activeContent = document.querySelector('.tab-content.active');
    if (!activeContent) return;

    const allCanvases = activeContent.querySelectorAll('canvas[data-chart-type="multi-series"], canvas[data-chart-type="te-single"]');

    allCanvases.forEach(canvas => {
        if (canvas === sourceCanvas) return;
        if (!canvas.chartData) return;

        const chartType = canvas.getAttribute('data-chart-type');
        if (chartType === 'multi-series') {
            drawMultiSeriesLineChart(canvas, canvas.chartData.allSeries, canvas.chartData.title);
        } else if (chartType === 'te-single') {
            drawTradingEconomicsLineChart(canvas, canvas.chartData.data, canvas.chartData.title);
        }
    });
}


/**
 * 환율/금리 탭의 다른 차트에 줌(Zoom) 상태 동기화
 */
function syncZoomToOtherCharts(sourceCanvas, zoomStateParams) {
    const activeContent = document.querySelector('.tab-content.active');
    if (!activeContent) return;

    const allCanvases = activeContent.querySelectorAll('canvas[data-chart-type="multi-series"], canvas[data-chart-type="te-single"]');

    allCanvases.forEach(canvas => {
        if (canvas === sourceCanvas) return;
        if (!canvas.chartData) return;

        // Apply global zoom constraint (clamped to the target chart's full bounds if necessary, 
        // but typically TE charts share the exact same dates when aligned).
        if (zoomStateParams && zoomStateParams.active) {
            canvas.zoomState = {
                active: true,
                minDate: zoomStateParams.minDate,
                maxDate: zoomStateParams.maxDate
            };
        } else {
            canvas.zoomState = { active: false };
        }

        const chartType = canvas.getAttribute('data-chart-type');
        if (chartType === 'multi-series') {
            drawMultiSeriesLineChart(canvas, canvas.chartData.allSeries, canvas.chartData.title);
        } else if (chartType === 'te-single') {
            // Revert or apply zoom and trigger redraw based on original full data cache
            const fullData = canvas.chartData.originalData || canvas.chartData.data;
            drawTradingEconomicsLineChart(canvas, fullData, canvas.chartData.title);
        }
    });
}

/**
 * 환율/금리 탭 차트 새로고침
 */
async function refreshExchangeRateCharts(tabId) {
    if (isCapturing) { console.log('[Capture] refreshExchangeRateCharts() skipped (isCapturing)'); return; }
    const content = document.getElementById(tabId);
    if (!content) return;

    const prefix = `exchangeRate_${tabId}`;
    const statusText = document.getElementById(`${prefix}StatusText`);
    const lastUpdate = document.getElementById(`${prefix}LastUpdate`);

    if (statusText) statusText.textContent = '로딩 중';

    const chartBoxes = content.querySelectorAll('.te-chart-box');
    const multiCanvases = content.querySelectorAll('.multi-chart-canvas');

    let loadedCount = 0;
    const totalCount = chartBoxes.length + multiCanvases.length;

    if (totalCount === 0) {
        if (statusText) statusText.textContent = '차트 없음';
        return;
    }

    const checkComplete = () => {
        if (++loadedCount >= totalCount) {
            if (statusText) statusText.textContent = '완료';
            if (lastUpdate) lastUpdate.textContent = formatTime(new Date());
        }
    };

    // 1. Prepare and Run Sequential Loading (v30.9.13: To avoid 504 Gateway Timeout)
    const runSequential = async () => {
        // TradingEconomics Charts
        for (const box of chartBoxes) {
            const url = box.dataset.teUrl;
            const duration = box.dataset.teDuration || '';
            const canvas = box.querySelector('.te-chart-canvas');
            const title = box.querySelector('.finviz-chart-title')?.textContent || '';

            if (url && canvas) {
                // refresh 버튼 클릭 시 호출되므로 force=true 전달
                await loadTradingEconomicsChart(canvas, url, title, duration, true).finally(checkComplete);
            } else {
                checkComplete();
            }
        }

        // Multi-Series / FRED Charts
        for (const canvas of multiCanvases) {
            const box = canvas.closest('.multi-chart-box');
            if (box) {
                let seriesConfig = [];
                if (box.dataset.series) {
                    try { seriesConfig = JSON.parse(decodeURIComponent(box.dataset.series)); } catch (e) { }
                }
                if (seriesConfig.length === 0 && box.dataset.urls) {
                    try {
                        const urls = JSON.parse(decodeURIComponent(box.dataset.urls));
                        seriesConfig = urls.map(u => ({ url: u, label: '' }));
                    } catch (e) { }
                }

                if (seriesConfig.length > 0) {
                    const title = box.querySelector('.finviz-chart-title')?.textContent || '';
                    // 새로고침 버튼으로부터 호출되었으므로 force=true 전달
                    await loadMultiSeriesChart(canvas, seriesConfig, title, true).finally(checkComplete);
                    await new Promise(r => setTimeout(r, 500)); // v30.9.15: Small rest between heavy charts
                } else {
                    checkComplete();
                }
            } else {
                checkComplete();
            }
        }
    };

    await runSequential();
}

/**
 * 실적 탭 새로고침
 */
function refreshEarningsTab(tabId, forceRefresh = false) {
    if (isCapturing && document.getElementById(`iframeEarnings_${tabId}`)?.dataset.calendarSource !== 'investing') { console.log('[Capture] refreshEarningsTab() skipped (isCapturing)'); return; }
    loadEarningsCalendarFrame(tabId, forceRefresh);
}

/**
 * 일반 동적 차트 탭 (6개 iframe) 새로고침
 */
function refreshDynamicChartsTab(tabId) {
    if (isCapturing) { console.log('[Capture] refreshDynamicChartsTab() skipped (isCapturing)'); return; }
    const content = document.getElementById(tabId);
    if (!content) return;

    console.log(`🔄 [Refresh] Reloading dynamic iframes for tab: ${tabId}`);
    const iframes = content.querySelectorAll('iframe');
    iframes.forEach((iframe, index) => {
        const currentSrc = iframe.src;
        if (currentSrc && currentSrc !== 'about:blank') {
            // 부하 방지를 위해 순차적 재로드
            setTimeout(() => {
                iframe.src = 'about:blank';
                setTimeout(() => {
                    iframe.src = currentSrc;
                }, 100);
            }, index * 800);
        }
    });
}


/**
 * 모든 탭 전체 새로고침 (백그라운드 포함)
 */
async function refreshAllTabs() {
    console.log("🔄 전체조회 시작...");
    if (globalRefreshBtn) {
        const originalText = globalRefreshBtn.textContent;
        globalRefreshBtn.textContent = "갱신 중...";
        globalRefreshBtn.disabled = true;
        updateStatus('loading');
        setTimeout(() => {
            globalRefreshBtn.textContent = originalText;
            globalRefreshBtn.disabled = false;
        }, 2000);
    }

    // 1. 순위 탭
    loadData();
    loadTransactionRank();
    loadWatchlistRank();

    // 4. 기타 동적 탭들
    Object.keys(tabData).forEach(tabId => {
        const wasEmpty = initializeTab(tabId);
        const type = tabData[tabId]?.type;

        // Custom/Exchange are already refreshed inside initializeTab(tabId) if wasEmpty.
        // For others (Earnings, Dynamic iframes), we proceed to refresh.
        if (wasEmpty && (type === 'overseas_custom' || type === 'exchange_rate')) return;

        if (tabId === EARNINGS_TAB_ID) {
            refreshEarningsTab(tabId);
        } else if (type === 'exchange_rate') {
            refreshExchangeRateCharts(tabId);
        } else if (type === 'overseas_custom') {
            refreshOverseasCustomCharts(tabId);
        } else if (!type && Array.isArray(tabData[tabId])) {
            refreshDynamicChartsTab(tabId);
        }
    });

    updateStatus('success');
//    if (statusText) statusText.textContent = "전체 탭 갱신 명령 전송됨";
//    if (lastUpdate) lastUpdate.textContent = formatTime(new Date());
}

/**
 * 콤마로 분리하되 따옴표 안의 콤마는 무시
 */
function splitByCommaIgnoringQuotes(str) {
    const parts = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    let parenDepth = 0;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (inQuote) {
            current += char;
            if (char === quoteChar) inQuote = false;
        } else {
            if (char === '"' || char === "'" || char === '“' || char === '”') {
                inQuote = true;
                quoteChar = char;
                current += char;
            } else if (char === '(') {
                parenDepth++;
                current += char;
            } else if (char === ')') {
                if (parenDepth > 0) parenDepth--;
                current += char;
            } else if (char === ',' && parenDepth === 0) {
                parts.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
    }
    if (current) parts.push(current.trim());
    return parts;
}

/**
 * 사용자 정의 해외 차트 데이터 파싱
 */
function parseCustomCharts(input) {
    const items = [];
    const lines = input.split('\n');
    let inBlockComment = false; // Block comment state tracker

    lines.forEach(line => {
        let trimmed = line.trim();

        // Block comment handling
        if (inBlockComment) {
            // Check if block comment ends on this line
            const endIdx = trimmed.indexOf('*/');
            if (endIdx !== -1) {
                inBlockComment = false;
                // Process any content after */ on the same line
                const afterComment = trimmed.substring(endIdx + 2).trim();
                if (!afterComment) {
                    items.push({ type: 'comment', content: line }); // Keep the original line for display
                    return;
                }
                // Re-parse the remaining content (recursive single-line check)
                line = afterComment;
                trimmed = line.trim(); // Update trimmed for the rest of the parsing
            } else {
                // Still inside block comment, skip this line
                items.push({
                    type: 'comment',
                    content: line
                });
                return;
            }
        }

        // Check for block comment start
        const startIdx = trimmed.indexOf('/*');
        if (startIdx !== -1) {
            // Check if it also ends on the same line
            const endIdx = trimmed.indexOf('*/', startIdx + 2);
            if (endIdx !== -1) {
                // Single line block comment - remove it and continue parsing
                const beforeComment = trimmed.substring(0, startIdx);
                const afterComment = trimmed.substring(endIdx + 2);
                const remaining = (beforeComment + afterComment).trim();
                if (!remaining) {
                    items.push({ type: 'comment', content: line }); // Keep the original line for display
                    return;
                }
                // Continue with remaining content
                line = remaining;
                trimmed = line.trim(); // Update trimmed for the rest of the parsing
            } else {
                // Block comment starts but doesn't end on this line
                inBlockComment = true;
                items.push({
                    type: 'comment',
                    content: line
                });
                return;
            }
        }

        // Skip empty lines after processing
        const processedTrimmed = trimmed; // Use the potentially modified 'trimmed'
        if (!processedTrimmed) {
            return;
        }

        // Comment Check: //
        if (processedTrimmed.startsWith('//')) {
            items.push({
                type: 'comment',
                content: line // keep original line with indentation
            });
            return;
        }

        // Divider Check: <Title, Color>
        if (processedTrimmed.startsWith('<') && processedTrimmed.endsWith('>')) {
            const content = processedTrimmed.substring(1, processedTrimmed.length - 1);
            const parts = content.split(',').map(s => s.trim());
            items.push({
                type: 'divider',
                title: parts[0],
                color: parts[1] || '' // Fallback to auto-assigning later
            });
            return;
        }

        // Chart Check: (url1, title1) pairs OR (url1, url2, ..., title) legacy
        // 괄호 안의 내용을 콤마로 분리
        const contentMatch = processedTrimmed.match(/\((.*)\)/);
        if (contentMatch) {
            // Use smart splitter to handle commas inside quotes
            const rawParts = splitByCommaIgnoringQuotes(contentMatch[1]);
            const parts = rawParts.map(s => {
                return s.trim().replace(/^[ "'“‘”’]+|[ "'“‘”’]+$/g, '');
            });

            if (parts.length >= 2) {
                let series = [];
                let boxTitle = '';
                let urls = [];

                // New Format Check: ("url1", "title1", "url2", "title2")
                // Heuristic: Length is even, and length >= 2.
                // To be safe, we can assume if it's even, it's pairs.
                // Legacy was (u1, u2, title) -> odd (3)
                // Legacy (u1, title) -> even (2). This matches pair (u, t). OK.
                // Legacy (u1, u2, u3, title) -> even (4). Wait.
                // If user does (u1, u2, u3, title), that is 4 parts.
                // Pair logic would see (u1, u2) and (u3, title).
                // This is ambiguous.
                // However, user explicitly requested ("url1","title1","url2","title2") format.
                // Let's check if the odd positions look like titles (not URLs).
                // Hard to distinguish.
                // But standard "title" is usually not a URL.
                // Let's prioritize the new requested format for even lengths > 2.
                // For length 2 (u1, title), it works for both.

                if (parts.length >= 3 && parts.length % 3 === 0 &&
                    (parts[0].includes('http') || parts[0].includes('tradingeconomics'))) {
                    // Assume TRIPLETS: (url, label, duration)
                    for (let i = 0; i < parts.length; i += 3) {
                        series.push({
                            url: parts[i],
                            label: parts[i + 1],
                            duration: parts[i + 2]
                        });
                        // For backward compat urls array, we can just push the url.
                        // However, loadMultiSeriesChart now expects objects if complex.
                        // But let's keep urls as just urls for now, app logic handles seriesConfig.
                        urls.push(parts[i]);
                    }
                    boxTitle = series.map(s => s.label).join(' / ');
                    console.log('[Parse] Detected Triplets:', series);
                } else if (parts.length >= 2 && parts.length % 2 === 0) {
                    // Assume PAIRS
                    for (let i = 0; i < parts.length; i += 2) {
                        series.push({ url: parts[i], label: parts[i + 1] });
                        urls.push(parts[i]);
                    }
                    boxTitle = series.map(s => s.label).join(' / ');
                } else {
                    // Assume Odd -> Legacy (u1, ..., title)
                    boxTitle = parts.pop(); // Last is title
                    urls = parts;
                    series = urls.map(u => ({ url: u, label: '' })); // No explicit labels per series
                }

                items.push({
                    type: 'chart',
                    urls: urls, // Keep for backward compat
                    series: series, // New detailed structure
                    title: boxTitle
                });
            }
        }
    });

    return items;
}

/**
 * 섹터 그룹 편집 리스너 설정
 */
function setupSectorGroupListeners(tabId) {
    const content = document.getElementById(tabId);
    if (!content) return;

    const dividers = content.querySelectorAll('.finviz-divider');
    dividers.forEach(divider => {
        const btn = divider.querySelector('.btn-section-edit');
        const popup = divider.querySelector('.section-edit-popup');
        const titleInput = divider.querySelector('.edit-section-title');
        const swatches = divider.querySelectorAll('.color-swatch');
        const index = parseInt(divider.dataset.index);

        // Toggle popup
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close other popups first
            document.querySelectorAll('.section-edit-popup.active').forEach(p => {
                if (p !== popup) p.classList.remove('active');
            });
            popup.classList.toggle('active');
        });

        // Prevent closing when clicking inside the popup (including text selection)
        popup.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Update Title
        titleInput.addEventListener('input', () => {
            const newTitle = titleInput.value.trim() || 'No Title';
            divider.querySelector('.title-text').textContent = newTitle;
            updateConfigString(tabId, index, { title: newTitle });
        });

        // Update Color
        swatches.forEach(swatch => {
            swatch.addEventListener('click', () => {
                const newColor = swatch.dataset.color;
                divider.style.setProperty('--section-color', newColor);

                // Update following charts' background
                let next = divider.nextElementSibling;
                while (next && !next.classList.contains('finviz-divider')) {
                    if (next.classList.contains('finviz-chart-box')) {
                        next.style.setProperty('--section-color', newColor);
                        next.style.setProperty('--section-color-alpha', newColor + '22');
                        next.querySelector('.finviz-chart-title').classList.add('colorful');
                    }
                    next = next.nextElementSibling;
                }

                updateConfigString(tabId, index, { color: newColor });
                popup.classList.remove('active');
            });
        });
    });
}

/**
 * 섹션 데이터 변경 시 config 문자열 동기화
 */
function updateConfigString(tabId, index, updates) {
    if (!tabData[tabId] || !tabData[tabId].config) return;

    const items = parseCustomCharts(tabData[tabId].config);
    if (items[index] && items[index].type === 'divider') {
        if (updates.title !== undefined) {
            // If title changed, migrate the color to the new title key if it exists
            const oldTitle = items[index].title;
            const currentColors = tabData[tabId].sectorColors || {};
            if (currentColors[oldTitle]) {
                currentColors[updates.title] = currentColors[oldTitle];
                // Optional: delete currentColors[oldTitle];
            }
            items[index].title = updates.title;
        }
        if (updates.color !== undefined) {
            tabData[tabId].sectorColors = tabData[tabId].sectorColors || {};
            tabData[tabId].sectorColors[items[index].title] = updates.color;
        }
    }

    // JSON-like array objects back to config string (WITHOUT colors, preserving comments)
    const newConfig = items.map(item => {
        if (item.type === 'comment') {
            return item.content;
        } else if (item.type === 'divider') {
            return `<${item.title}>`;
        } else {
            // Reconstruct chart config
            if (item.series && item.series.length > 0 && item.series.some(s => s.label)) {
                // New format: ("url1", "title1", "url2", "title2")
                const inside = item.series.map(s => `"${s.url}", "${s.label}"`).join(', ');
                return `(${inside})`;
            } else {
                // Legacy format
                const urls = item.urls.join(', ');
                return `(${urls}, "${item.title}")`;
            }
        }
    }).join('\n');

    tabData[tabId].config = newConfig;

    // Sync to Modal if open
    const textarea = document.getElementById('customChartInput');
    if (textarea && currentConfigTabId === tabId) {
        textarea.value = newConfig;
    }

    saveAppData(); // Auto-save & Sync

    // Refresh highlight if editor is open
    updateSyntaxHighlighting();
}

/**
 * 탭 내의 모든 캔버스 차트를 캐시된 데이터로 다시 그리기 (서버 요청 없음)
 */
function redrawTabCharts(tabId) {
    const content = document.getElementById(tabId);
    if (!content) return;

    console.log(`🎨 [Redraw] Restoring charts for tab: ${tabId}`);

    if (tabId === EARNINGS_TAB_ID) {
        const activeCalendarId = tabData[tabId]?.activeCalendarId || 'toss';
        selectEarningsCalendar(tabId, activeCalendarId);
        return;
    }

    // multi-series 차트 복구
    const multiCanvases = content.querySelectorAll('canvas[data-chart-type="multi-series"]');
    multiCanvases.forEach(canvas => {
        if (canvas.chartData && canvas.chartData.allSeries) {
            drawMultiSeriesLineChart(canvas, canvas.chartData.allSeries, canvas.chartData.title);
        }
    });

    // TradingEconomics 단일 차트 복구
    const teCanvases = content.querySelectorAll('canvas[data-chart-type="te-single"]');
    teCanvases.forEach(canvas => {
        if (canvas.chartData && canvas.chartData.data) {
            drawTradingEconomicsLineChart(canvas, canvas.chartData.data, canvas.chartData.title);
        }
    });
}

/**
 * 주석 구문 강조 (녹색 처리) - 라인 주석(//) 및 블록 주석 지원
 */
function updateSyntaxHighlighting() {
    const textarea = document.getElementById('customChartInput');
    const backdrop = document.getElementById('highlightBackdrop');
    if (!textarea || !backdrop) return;

    const text = textarea.value;
    const lines = text.split('\n');
    let inBlockComment = false;

    const highlighted = lines.map(line => {
        const trimmed = line.trim();
        // HTML escape
        const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // If we're inside a block comment
        if (inBlockComment) {
            if (trimmed.includes('*/')) {
                inBlockComment = false;
            }
            return `<span class="syntax-comment">${escaped}</span>`;
        }

        // Check for block comment start
        if (trimmed.includes('/*')) {
            if (!trimmed.includes('*/')) {
                inBlockComment = true;
            }
            return `<span class="syntax-comment">${escaped}</span>`;
        }

        // Line comment check: //
        if (trimmed.startsWith('//')) {
            return `<span class="syntax-comment">${escaped}</span>`;
        }
        return escaped;
    }).join('\n');

    // Add a trailing newline to avoid height mismatch at end of content
    backdrop.innerHTML = highlighted + (text.endsWith('\n') ? '\n ' : '');
}

/**
 * 커스텀 차트 설정 모달 열기
 */
function openCustomChartModal() {
    const modal = document.getElementById('customChartModal');
    if (!modal) return;
    const textarea = document.getElementById('customChartInput');
    if (textarea) {
        if (currentConfigTabId && tabData[currentConfigTabId]) {
            textarea.value = tabData[currentConfigTabId].config || '';
        } else {
            textarea.value = '';
        }
    }
    modal.style.display = 'flex';

    // Auto-focus and highlight
    setTimeout(() => {
        if (textarea) textarea.focus();
        updateSyntaxHighlighting();
    }, 10);
}

/**
 * 해외 커스텀 차트 새로고침
 */
function refreshOverseasCustomCharts(tabId) {
    if (isCapturing) { console.log('[Capture] refreshOverseasCustomCharts() skipped (isCapturing)'); return; }
    // alert(`[DEBUG] Refreshing tab: ${tabId}`);
    const content = document.getElementById(tabId);
    if (!content) return;
    const prefix = `overseasCustom_${tabId}`;
    const statusText = document.getElementById(`${prefix}StatusText`);
    const lastUpdate = document.getElementById(`${prefix}LastUpdate`);

    if (statusText) statusText.textContent = '로딩 중';

    const images = content.querySelectorAll('.finviz-chart-img');
    const canvases = content.querySelectorAll('.multi-chart-canvas');

    // [DEBUG] Diagnosing counts
    // alert(`[DEBUG] Found ${images.length} images, ${canvases.length} canvases`);

    let loadedCount = 0;
    const totalCount = images.length + canvases.length; // Count both

    if (totalCount === 0) {
        if (statusText) statusText.textContent = '데이터 없음';
        return;
    }

    const checkComplete = () => {
        if (++loadedCount >= totalCount) { // Use >= for safety
            if (statusText) statusText.textContent = '완료';
            if (lastUpdate) lastUpdate.textContent = formatTime(new Date());
            setupOverseasCursorSync();
        }
    };

    // 1. Process Images
    if (images.length > 0) {
        images.forEach(img => {
            const proxyUrl = `/api/finviz-image?url=${encodeURIComponent(img.dataset.chartUrl)}&_t=${Date.now()}`;
            img.onload = checkComplete;
            img.onerror = () => {
                console.warn('[RefreshCustom] Image load failed:', img.dataset.chartUrl);
                checkComplete();
            };
            img.src = proxyUrl;
        });
    }

    // 2. Process Canvases (FRED/Multi)
    if (canvases.length > 0) {
        canvases.forEach(canvas => {
            const box = canvas.closest('.multi-chart-box');
            if (box) {
                try {
                    let seriesConfig = [];
                    // Try data-series
                    if (box.dataset.series) {
                        try {
                            seriesConfig = JSON.parse(decodeURIComponent(box.dataset.series));
                        } catch (e) { }
                    }
                    // Fallback data-urls
                    if (seriesConfig.length === 0 && box.dataset.urls) {
                        let rawUrls = box.dataset.urls;
                        try { rawUrls = decodeURIComponent(rawUrls); } catch (e) { }
                        const urls = JSON.parse(rawUrls);
                        // Pass raw array to allow loadMultiSeriesChart to detect flat format
                        seriesConfig = urls;
                    }

                    if (seriesConfig.length > 0) {
                        const title = box.querySelector('.finviz-chart-title')?.textContent || '';
                        loadMultiSeriesChart(canvas, seriesConfig, title, true).then(checkComplete);
                    } else {
                        checkComplete();
                    }
                } catch (e) {
                    console.error('[RefreshCustom] Canvas data error:', e);
                    checkComplete();
                }
            } else {
                checkComplete();
            }
        });
    }
}

// ==========================================================
// Bulk Settings (Export/Import All Tabs)
// ==========================================================

function setupBulkSettingsHandlers() {
    const bulkUploadBtn = document.getElementById('bulkUpload');
    const bulkDownloadBtn = document.getElementById('bulkDownload');

    if (bulkDownloadBtn) {
        bulkDownloadBtn.addEventListener('click', bulkExportSettings);
    }

    if (bulkUploadBtn) {
        bulkUploadBtn.addEventListener('click', restoreServerBackup);
    }
}

function bulkExportSettings() {
    // One full-state JSON file covers custom tabs and all other app settings.
    const fullState = getSerializedState();
    fetch('/api/settings/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: JSON.stringify(fullState) })
    })
        .then(async response => {
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
            alert(`전체 설정 JSON을 프로젝트 폴더에 백업했습니다.\n${result.filename}`);
        })
        .catch(error => {
            console.error('❌ [bulkExportSettings] Server backup failed:', error);
            alert(`전체 설정 JSON 백업에 실패했습니다.\n${error.message}`);
    });
}

function centralBanksToday() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}
function loadCentralBanksFrame(tabId, forceRefresh = false) {
    const frame = document.getElementById(`centralBanksFrame_${tabId}`);
    if (!frame) return;
    const status = document.getElementById(`earningsStatusText_${tabId}`);
    const lastUpdate = document.getElementById(`earningsLastUpdate_${tabId}`);
    const loading = document.getElementById(`centralBanksFrameLoading_${tabId}`);
    const isSelected = () => document.getElementById(`iframeEarnings_${tabId}`)?.dataset.calendarSource === 'investing';
    if (!forceRefresh && frame.dataset.loadState === 'loading') return;
    if (!forceRefresh && frame.dataset.loadedDate === centralBanksToday()) {
        if (isSelected() && status) status.textContent = 'CBRates · 원문 날짜순 · 시각 미제공';
        if (isSelected() && lastUpdate) lastUpdate.textContent = frame.dataset.requestedAt;
        return;
    }
    clearTimeout(frame.loadingTimer);
    frame.dataset.loadState = 'loading';
    frame.dataset.requestedAt = formatTime(new Date());
    if (loading) loading.hidden = false;
    if (isSelected() && status) { status.textContent = 'CBRates 연결 중'; status.title = ''; }
    const finish = (message, state) => {
        clearTimeout(frame.loadingTimer);
        frame.dataset.loadState = state;
        if (loading) loading.hidden = true;
        if (isSelected() && status) status.textContent = message;
    };
    frame.onload = () => {
        frame.dataset.loadedDate = centralBanksToday();
        finish('CBRates · 원문 날짜순 · 시각 미제공', 'loaded');
        if (isSelected() && status) status.title = '외부 페이지의 실제 내용은 확인할 수 없습니다. 빈 화면이면 새로고침하거나 원본 사이트에서 확인해 주세요.';
    };
    frame.onerror = () => finish('연결 실패 · 새로고침하거나 원본 사이트에서 확인해 주세요', 'error');
    frame.loadingTimer = setTimeout(() => finish('응답 대기 · 원본 사이트에서 확인해 주세요', 'timeout'), 20000);
    frame.src = 'https://www.cbrates.com/meetings.htm';
    if (isSelected() && lastUpdate) lastUpdate.textContent = frame.dataset.requestedAt;
}

function loadEarningsCalendarFrame(tabId, forceRefresh = false) {
    const metadata = document.getElementById(`iframeEarnings_${tabId}`);
    if (!metadata) return;
    const sourceId = metadata.dataset.calendarSource;
    if (sourceId === 'investing') {
        loadCentralBanksFrame(tabId, forceRefresh);
        return;
    }
    const frame = sourceId === 'seibro' ? document.getElementById(`iframeEarningsSeibro_${tabId}`) : metadata;
    const calendars = JSON.parse(decodeURIComponent(metadata.dataset.calendarUrls || '[]'));
    const selected = calendars.find(calendar => calendar.id === sourceId);
    if (!frame || !selected) return;
    const status = document.getElementById(`earningsStatusText_${tabId}`);
    const lastUpdate = document.getElementById(`earningsLastUpdate_${tabId}`);
    if (!forceRefresh && frame.dataset.loadedDate === centralBanksToday()) {
        if (status) status.textContent = '완료';
        if (lastUpdate) lastUpdate.textContent = frame.dataset.requestedAt;
        return;
    }
    frame.dataset.loadedDate = centralBanksToday();
    frame.dataset.requestedAt = formatTime(new Date());
    frame.onload = () => {
        if (metadata.dataset.calendarSource === sourceId && status) status.textContent = '완료';
    };
    if (status) status.textContent = '로딩 중';
    if (lastUpdate) lastUpdate.textContent = frame.dataset.requestedAt;
    frame.src = selected.url;
}

function selectEarningsCalendar(tabId, sourceId) {
    const iframe = document.getElementById(`iframeEarnings_${tabId}`);
    if (!iframe) return;

    let calendars;
    try {
        calendars = JSON.parse(decodeURIComponent(iframe.dataset.calendarUrls || '[]'));
    } catch (error) {
        console.error('[Calendar] Could not read calendar source URLs', error);
        return;
    }
    const selected = calendars.find(calendar => calendar.id === sourceId);
    if (!selected) return;

    document.querySelectorAll(`#${tabId} .calendar-source-tab`).forEach(button => {
        const active = button.dataset.calendarSource === sourceId;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
    });
    const panel = document.getElementById(`calendarSourcePanel_${tabId}`);
    if (panel) panel.setAttribute('aria-labelledby', `calendarSourceTab_${tabId}_${sourceId}`);
    const externalLink = document.getElementById(`earningsExternalLink_${tabId}`);
    if (externalLink) externalLink.href = selected.externalUrl;
    const sourceTitle = document.getElementById(`earningsSourceTitle_${tabId}`);
    if (sourceTitle) sourceTitle.textContent = selected.label;
    iframe.hidden = sourceId !== 'toss';
    const seibroFrame = document.getElementById(`iframeEarningsSeibro_${tabId}`);
    if (seibroFrame) seibroFrame.hidden = sourceId !== 'seibro';
    const framePanel = document.getElementById(`centralBanksFramePanel_${tabId}`);
    if (framePanel) framePanel.hidden = sourceId !== 'investing';
    if (sourceId !== 'investing') {
        const status = document.getElementById(`earningsStatusText_${tabId}`);
        if (status) status.textContent = '완료';
    }
    iframe.title = `${selected.label} 캘린더`;
    if (iframe.dataset.calendarSource !== sourceId) {
        iframe.dataset.calendarSource = sourceId;
    }
    loadEarningsCalendarFrame(tabId);
    if (tabData[tabId]) {
        tabData[tabId].activeCalendarId = sourceId;
        saveAppData();
    }
}

function chooseServerBackup(files) {
    const modal = document.getElementById('backupPickerModal');
    const searchInput = document.getElementById('backupPickerSearch');
    const list = document.getElementById('backupPickerList');
    const summary = document.getElementById('backupPickerSummary');
    const emptyState = document.getElementById('backupPickerEmpty');
    const restoreButton = document.getElementById('restoreSelectedBackup');
    const closeButton = document.getElementById('closeBackupPicker');
    const cancelButton = document.getElementById('cancelBackupPicker');
    if (!modal || !searchInput || !list || !summary || !emptyState || !restoreButton || !closeButton || !cancelButton) {
        return Promise.resolve(null);
    }

    const sortedFiles = [...files].sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    const previousFocus = document.activeElement;
    let selectedFilename = null;
    let visibleFiles = [];

    const formatBytes = (value) => {
        const bytes = Number(value);
        if (!Number.isFinite(bytes) || bytes < 0) return '크기 정보 없음';
        if (bytes < 1024) return `${bytes} B`;
        const units = ['KB', 'MB', 'GB'];
        let size = bytes / 1024;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
    };

    return new Promise(resolve => {
        let finished = false;
        let deleting = false;
        const selectFile = (filename, moveFocus = false) => {
            selectedFilename = filename;
            list.querySelectorAll('.backup-picker-item').forEach(item => {
                const selected = item.dataset.filename === filename;
                item.setAttribute('aria-selected', String(selected));
                if (selected && moveFocus) item.focus();
            });
            restoreButton.disabled = deleting || !selectedFilename;
        };

        const renderFiles = () => {
            const query = searchInput.value.trim().toLocaleLowerCase();
            visibleFiles = sortedFiles.filter(file => String(file.filename || '').toLocaleLowerCase().includes(query));
            if (selectedFilename && !visibleFiles.some(file => file.filename === selectedFilename)) {
                selectFile(null);
            }

            list.replaceChildren();
            visibleFiles.forEach(file => {
                const row = document.createElement('div');
                row.className = 'backup-picker-row';
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'backup-picker-item';
                item.setAttribute('role', 'option');
                item.setAttribute('aria-selected', String(file.filename === selectedFilename));
                item.dataset.filename = file.filename;

                const filename = document.createElement('span');
                filename.className = 'backup-picker-filename';
                filename.textContent = file.filename;

                const meta = document.createElement('span');
                meta.className = 'backup-picker-meta';
                const updatedAt = new Date(Number(file.updatedAt));
                const date = document.createElement('span');
                date.textContent = Number.isNaN(updatedAt.getTime()) ? '수정 시각 정보 없음' : updatedAt.toLocaleString();
                const size = document.createElement('span');
                size.textContent = formatBytes(file.bytes);
                meta.append(date, size);
                item.append(filename, meta);
                item.addEventListener('click', () => selectFile(file.filename));
                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.className = 'backup-picker-delete';
                deleteButton.textContent = 'X';
                deleteButton.title = `${file.filename} 삭제`;
                deleteButton.setAttribute('aria-label', `${file.filename} 삭제`);
                deleteButton.disabled = deleting;
                deleteButton.addEventListener('click', async () => {
                    if (deleting) return;
                    if (!confirm(`“${file.filename}” 파일을 서버에서 삭제하시겠습니까?`)) return;
                    deleting = true;
                    restoreButton.disabled = true;
                    list.querySelectorAll('.backup-picker-delete').forEach(button => { button.disabled = true; });
                    try {
                        const response = await fetch(`/api/settings/backups/${encodeURIComponent(file.filename)}`, { method: 'DELETE' });
                        const result = await response.json();
                        if (!response.ok || !result.success) throw new Error(result.error || '백업 삭제에 실패했습니다.');
                        const index = sortedFiles.findIndex(entry => entry.filename === file.filename);
                        if (index >= 0) sortedFiles.splice(index, 1);
                        if (selectedFilename === file.filename) selectedFilename = null;
                    } catch (error) {
                        if (!finished) alert(error.message);
                    } finally {
                        deleting = false;
                        if (!finished) {
                            renderFiles();
                            restoreButton.disabled = !selectedFilename;
                            searchInput.focus();
                        }
                    }
                });
                row.append(item);
                if (!['user_settings_autosaved.json', 'autosaved_user_settings.json'].includes(file.filename)) row.append(deleteButton);
                list.appendChild(row);
            });

            summary.textContent = query
                ? `검색 결과 ${visibleFiles.length}개 / 전체 ${sortedFiles.length}개`
                : `총 ${sortedFiles.length}개 JSON 파일`;
            emptyState.hidden = visibleFiles.length > 0;
            emptyState.textContent = query ? '검색 조건과 일치하는 파일이 없습니다.' : '표시할 JSON 파일이 없습니다.';
            list.hidden = visibleFiles.length === 0;
        };

        const cleanup = () => {
            searchInput.removeEventListener('input', renderFiles);
            closeButton.removeEventListener('click', cancel);
            cancelButton.removeEventListener('click', cancel);
            restoreButton.removeEventListener('click', restore);
            modal.removeEventListener('click', onBackdropClick);
            document.removeEventListener('keydown', onKeyDown);
        };
        const finish = value => {
            if (finished) return;
            finished = true;
            cleanup();
            modal.style.display = 'none';
            document.body.classList.remove('modal-open');
            searchInput.value = '';
            list.replaceChildren();
            if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
            resolve(value);
        };
        const cancel = () => finish(null);
        const restore = () => {
            if (!selectedFilename || deleting) return;
            finish(sortedFiles.find(file => file.filename === selectedFilename) || null);
        };
        const onBackdropClick = event => {
            if (event.target === modal) cancel();
        };
        const onKeyDown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
                return;
            }

            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const items = Array.from(list.querySelectorAll('.backup-picker-item'));
                if (!items.length) return;
                event.preventDefault();
                const currentIndex = items.findIndex(item => item.dataset.filename === selectedFilename);
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                const nextIndex = currentIndex < 0
                    ? (direction > 0 ? 0 : items.length - 1)
                    : Math.max(0, Math.min(items.length - 1, currentIndex + direction));
                selectFile(items[nextIndex].dataset.filename, true);
            } else if (event.key === 'Enter' && document.activeElement?.classList.contains('backup-picker-item') && selectedFilename) {
                event.preventDefault();
                restore();
            } else if (event.key === 'Tab') {
                const focusable = Array.from(modal.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };

        searchInput.addEventListener('input', renderFiles);
        closeButton.addEventListener('click', cancel);
        cancelButton.addEventListener('click', cancel);
        restoreButton.addEventListener('click', restore);
        modal.addEventListener('click', onBackdropClick);
        document.addEventListener('keydown', onKeyDown);
        restoreButton.disabled = true;
        renderFiles();
        modal.style.display = 'flex';
        document.body.classList.add('modal-open');
        searchInput.focus();
    });
}

async function restoreServerBackup() {
    try {
        const response = await fetch('/api/settings/backups', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
        const backups = result.files || [];
        if (!backups.length) {
            alert('프로젝트 폴더에 복원 가능한 JSON 설정이 없습니다.');
            return;
        }
        const selected = await chooseServerBackup(backups);
        if (!selected) return;
        const backupResponse = await fetch(`/api/settings/backups/${encodeURIComponent(selected.filename)}`, { cache: 'no-store' });
        const backup = await backupResponse.json();
        if (!backupResponse.ok || !backup.success) throw new Error(backup.error || `HTTP ${backupResponse.status}`);
        let data;
        try {
            data = JSON.parse(backup.content);
        } catch {
            throw new Error('선택한 파일이 올바른 JSON이 아닙니다.');
        }
        if (!data || !Array.isArray(data.tabs) || !data.contents || typeof data.contents !== 'object') {
            throw new Error('전체 설정 스냅샷 형식의 JSON 파일이 아닙니다.');
        }
        if (!confirm('JSON 파일의 전체 설정으로 현재 설정을 교체하시겠습니까?')) return;
        applyFullStateBackup(data);
    } catch (error) {
        console.error('❌ [restoreServerBackup] Failed:', error);
        alert(`프로젝트 폴더 JSON을 불러오지 못했습니다.\n${error.message}`);
    }
}

/**
 * JSON 백업 데이터를 사용하여 전체 애플리케이션 상태 복구
 */
function applyFullStateBackup(data) {
    applyTabSidebarSettings(data?.tabSidebar);
    data = removeRetiredAdrState(data);
    window.applyConcentrationDisplaySettings?.(data.rankChartDisplay);
    console.log("🔄 [Restore] Full state restoration started...");
    migrateMemoTabIconOnce(data);

    // 1. 데이터 교체 (Contents)
    tabData = data.contents || {};

    window.USLinks.refresh();

    // 2. 기존 커스텀 탭 UI 제거 (영구 탭 제외)
    const allTabBtns = document.querySelectorAll('.tab-btn:not(.add-tab-btn)');
    allTabBtns.forEach(btn => {
        const id = btn.dataset.tab;
        if (id !== PERM_TAB_ID && id !== EARNINGS_TAB_ID && id !== BASE_INTEREST_TAB_ID && id !== US_TAB_ID && id !== MEMO_TAB_ID) {
            btn.remove();
            const content = document.getElementById(id);
            if (content) content.remove();
        }
    });

    // 3. 탭 버튼 및 컨텐츠 재생성 (JSON에 기록된 순서대로)
    if (data.tabs && Array.isArray(data.tabs)) {
        data.tabs.forEach(tab => {
            if (tab.id !== PERM_TAB_ID && tab.id !== EARNINGS_TAB_ID && tab.id !== BASE_INTEREST_TAB_ID && tab.id !== US_TAB_ID && tab.id !== MEMO_TAB_ID) {
                const fixedName = resolveTabName(tab.id, tab.name, tabData[tab.id]);
                tab.name = fixedName;
                createTabButtonElement(tab.id, fixedName);
                createTabContentElement(tab.id);
            }
        });
    }

    // 4. 전역 설정 복구
    if (data.rankInterval && refreshIntervalSelect) {
        refreshIntervalSelect.value = data.rankInterval;
        startAutoRefresh();
    }
    // 5. 메모 복구
    const backupHasMemo = Object.prototype.hasOwnProperty.call(data, 'memoHtml') || Object.prototype.hasOwnProperty.call(data, 'memoDelta');
    if (backupHasMemo) applyMemoState(data);

    // 5.1 관심종목 그룹 복구
    if (data.watchlistGroupId) {
        localStorage.setItem('watchlist_selected_group', data.watchlistGroupId);
        const input = document.getElementById('watchlistGroupNameInput');
        const select = document.getElementById('watchlistGroupSelect');
        if (input) input.value = data.watchlistGroupId;
        if (select) {
            const opt = Array.from(select.options).find(o => o.value === data.watchlistGroupId);
            if (opt) {
                select.value = data.watchlistGroupId;
            } else {
                let customOpt = Array.from(select.options).find(o => o.dataset.custom === 'true');
                if (!customOpt) {
                    customOpt = document.createElement('option');
                    customOpt.dataset.custom = 'true';
                    select.appendChild(customOpt);
                }
                customOpt.value = data.watchlistGroupId;
                customOpt.textContent = `${data.watchlistGroupId} (직접입력)`;
                select.value = data.watchlistGroupId;
            }
        }
    }

    // 6. 복원된 활성 탭을 먼저 적용해야 저장 스냅샷에도 백업의 activeTabId가 기록된다.
    const targetTabId = data.activeTabId || PERM_TAB_ID;
    activateTab(targetTabId);

    // 설정 저장과 메모 저장은 서버에서 별도 경로로 처리
    saveAppData();
    if (backupHasMemo) {
        let restoredDelta = data.memoDelta;
        if (typeof restoredDelta === 'string') {
            try { restoredDelta = JSON.parse(restoredDelta); } catch { restoredDelta = null; }
        }
        const restoredHtml = typeof data.memoHtml === 'string'
            ? data.memoHtml
            : (localStorage.getItem('memoContent_html') || '');
        saveMemoToServer(restoredHtml, restoredDelta)
            .catch(error => console.error('❌ [Restore] Memo server save failed:', error));
    }

    alert("✅ 전체 환경 복구가 완료되었습니다.");
    console.log("✅ [Restore] Success. Activated tab:", targetTabId);
}


// ==========================================================
// Initialization
// ==========================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('앱 초기화...');

    // Do not load dashboard data until the server confirms an allowed Google session.
    try {
        const authResponse = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!authResponse.ok) return;
        const authState = await authResponse.json();
        if (!authState.authenticated) return;
        unlockApp(authState.user);
    } catch (error) {
        console.error('[Auth] Could not verify the current session:', error);
        return;
    }

    // Try server sync and localStorage, then compare timestamps
    const serverData = await loadAppDataFromServer();
    const localData = loadFromLocalStorage();

    let finalData = null;
    if (serverData && serverData.tabs && serverData.tabs.length > 0) {
        // [v28] Prioritize server data ALWAYS for consistency across PCs
        console.log("☁️ 서버 데이터를 우선적으로 사용합니다.");
        finalData = serverData;
    } else {
        finalData = localData;
    }

    if (finalData) {
        // index.html starts with Rank active; clear that default so applyData can
        // restore the snapshot's activeTabId during the initial load.
        document.querySelectorAll('.tab-content.active').forEach(tab => tab.classList.remove('active'));
        applyData(finalData);
        // 서버 데이터를 성공적으로 적용한 경우 로컬스토리지에도 보관 (서버로 역전송 방지)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(finalData));
    } else {
        ensurePermanentTabs();
        activateTab(PERM_TAB_ID);

        const savedWatchlistGrp = localStorage.getItem('watchlist_selected_group');
        if (savedWatchlistGrp) {
            const input = document.getElementById('watchlistGroupNameInput');
            const select = document.getElementById('watchlistGroupSelect');
            if (input) input.value = savedWatchlistGrp;
            if (select) {
                const opt = Array.from(select.options).find(o => o.value === savedWatchlistGrp);
                if (opt) select.value = savedWatchlistGrp;
            }
        }
    }

    loadData();
    loadTransactionRank();
    loadWatchlistGroups();
    loadWatchlistRank();
    startAutoRefresh();
    setupBulkSettingsHandlers();

    // The app session and Google Calendar scope are separate grants. Once an
    // allowed app session is confirmed, request Calendar access and load events.
    startCalendarSyncAfterLogin();

    // Global listener for closing sector popups (Improved to handle text selection)
    let isSectorPopupClick = false;
    document.addEventListener('mousedown', (e) => {
        isSectorPopupClick = !!e.target.closest('.divider-controls');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.divider-controls') && !isSectorPopupClick) {
            document.querySelectorAll('.section-edit-popup.active').forEach(p => {
                p.classList.remove('active');
            });
        }
    });

    if (mrktTpSelect) mrktTpSelect.addEventListener('change', loadTransactionRank);
    if (stexTpSelect) stexTpSelect.addEventListener('change', loadTransactionRank);

    // --- Custom Chart Modal Handlers ---
    const modal = document.getElementById('customChartModal');
    if (modal) {
        const saveBtn = document.getElementById('saveCustomCharts');
        const cancelBtn = document.getElementById('cancelCustomCharts');
        const closeX = modal.querySelector('.close-modal');

        const closeModal = () => { modal.style.display = 'none'; };

        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const textarea = document.getElementById('customChartInput');
                const input = textarea ? textarea.value : '';

                if (currentConfigTabId && tabData[currentConfigTabId]) {
                    tabData[currentConfigTabId].config = input;
                    saveAppData();
                }
                console.log('[Modal] Saved custom charts for:', currentConfigTabId);

                const content = document.getElementById(currentConfigTabId);
                if (content && content.classList.contains('active')) {
                    content.innerHTML = createChartGrid(currentConfigTabId);

                    const type = tabData[currentConfigTabId]?.type;
                    if (type === 'exchange_rate') {
                        refreshExchangeRateCharts(currentConfigTabId);
                    } else {
                        refreshOverseasCustomCharts(currentConfigTabId);
                    }

                    // Re-setup listeners for dividers
                    if (type === 'overseas_custom' || type === 'exchange_rate') {
                        setupSectorGroupListeners(currentConfigTabId);
                    }
                }
                closeModal();
            });
        }
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
        if (closeX) closeX.addEventListener('click', closeModal);

        // Improved click-outside logic: only close if both mousedown and click targets are the modal backdrop
        let isBackdropClick = false;
        modal.addEventListener('mousedown', (e) => {
            isBackdropClick = (e.target === modal);
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal && isBackdropClick) closeModal();
        });

        // Add input & scroll listener for syntax highlighting
        const textarea = document.getElementById('customChartInput');
        const backdrop = document.getElementById('highlightBackdrop');
        if (textarea && backdrop) {
            textarea.addEventListener('input', updateSyntaxHighlighting);
            textarea.addEventListener('scroll', () => {
                backdrop.scrollTop = textarea.scrollTop;
                backdrop.scrollLeft = textarea.scrollLeft;
            });
        }

        // --- Config Download Handler ---
        const downloadBtn = document.getElementById('downloadConfig');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                const text = textarea ? textarea.value : '';
                if (!text.trim()) {
                    alert('다운로드할 내용이 없습니다.');
                    return;
                }

                const blob = new Blob([text], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');

                // Use current tab name or generic filename
                const tabBtn = document.querySelector(`.tab-btn[data-tab="${currentConfigTabId}"]`);
                const filename = (tabBtn ? tabBtn.textContent.trim() : 'overseas_config') + '.txt';

                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });
        }

        // --- Config Upload Handler ---
        const uploadBtn = document.getElementById('uploadConfig');
        const fileInput = document.getElementById('configFileInput');
        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', () => {
                fileInput.value = ''; // Reset to allow re-upload of same file
                fileInput.click();
            });

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    const content = event.target.result;
                    if (textarea) {
                        textarea.value = content;
                        updateSyntaxHighlighting();
                    }
                };
                reader.readAsText(file);
            });
        }
    }
});

/**
 * ===== QUILL MEMO EDITOR INITIALIZATION =====
 */
function initMemoEditor() {
    console.log("🖋️ [initMemoEditor] Attempting to initialize Quill...");
    const editorEl = document.getElementById('quillEditor');
    if (!editorEl) {
        console.error("❌ [initMemoEditor] #quillEditor element NOT found in DOM!");
        return;
    }

    try {
        // Custom 'Today' Button Logic
        // Custom 'Today' Button Logic
        const todayHandler = function () {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hour = String(now.getHours()).padStart(2, '0');
            const minute = String(now.getMinutes()).padStart(2, '0');
            const second = String(now.getSeconds()).padStart(2, '0');
            const dateStr = `[${year}-${month}-${day} ${hour}:${minute}:${second}]`;

            const range = this.quill.getSelection(true); // true = focus if needed
            let index = range ? range.index : this.quill.getLength();

            // 1. Insert Newline before (if not at start) to ensure it's on a new line
            if (index > 0) {
                this.quill.insertText(index, '\n', Quill.sources.USER);
                index++;
            }

            // 2. Insert Date with BOLD
            this.quill.insertText(index, dateStr, { 'bold': true }, Quill.sources.USER);
            index += dateStr.length;

            // 3. Insert Newline after (Normal text)
            this.quill.insertText(index, '\n', { 'bold': false }, Quill.sources.USER);
            index++;

            // 4. Move cursor to the new empty line
            this.quill.setSelection(index, Quill.sources.USER);
        };

        // Inject custom style for the button (simplest way without touching style.css)
        const style = document.createElement('style');
        style.innerHTML = `
            .ql-today:after {
                content: "Today";
                font-size: 11px;
                padding-top: 2px;
                font-weight: bold;
            }
            .ql-today {
                width: auto !important;
                padding-left: 5px !important; 
                padding-right: 5px !important;
            }
        `;
        document.head.appendChild(style);

        quillEditor = new Quill('#quillEditor', {
            theme: 'snow',
            modules: {
                toolbar: {
                    container: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                        [{ 'color': [] }, { 'background': [] }],
                        ['blockquote', 'code-block'],
                        ['link', 'image'],
                        ['clean'],
                        ['today'] // Custom button
                    ],
                    handlers: {
                        'today': todayHandler
                    }
                }
            },
            placeholder: '메모를 작성하세요...'
        });
        console.log("✅ [initMemoEditor] Quill successfully initialized");
        loadMemo();

        // [v28] Auto-save disabled per user request. Use manual 'Save' button.
        /*
        let saveTimeout;
        quillEditor.on('text-change', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(saveMemoAuto, 1000);
        });
        */

        // Wire Manual Save Button
        const saveBtn = document.getElementById('memoSaveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                console.log("💾 [Memo] Manual save triggered");
                saveMemo();
            });
        }

        // Load only the saved memo from the server; do not re-apply all app settings.
        const refreshBtn = document.getElementById('memoRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                const statusEl = document.getElementById('memoStatus');
                if (statusEl) statusEl.textContent = '서버에서 불러오는 중...';
                refreshBtn.disabled = true;
                try {
                    const serverData = await loadAppDataFromServer();
                    if (applyMemoState(serverData)) {
                        if (statusEl) statusEl.textContent = '서버에서 불러오기 완료 ✓';
                        console.log("📥 [Memo] Loaded saved memo from server");
                    } else {
                        if (statusEl) statusEl.textContent = '서버에 저장된 메모가 없습니다.';
                    }
                } catch (e) {
                    if (statusEl) statusEl.textContent = '서버에서 불러오기 실패 ✗';
                    console.error("❌ [Memo] Server load failed:", e);
                } finally {
                    refreshBtn.disabled = false;
                    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
                }
            });
        }
    } catch (e) {
        console.error("❌ [initMemoEditor] Quill init failed:", e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const profileModal = document.getElementById('profileModal');
    const profileBtn = document.getElementById('profileBtn');
    const closeProfileBtn = document.getElementById('closeProfileModal');
    const userEmailEl = document.getElementById('profileCurrentUser');
    const accountsSection = document.getElementById('authorizedAccountsSection');
    const emailList = document.getElementById('authorizedEmailList');
    const addEmailForm = document.getElementById('addAuthorizedEmailForm');
    const emailInput = document.getElementById('authorizedEmailInput');
    const accountsMessage = document.getElementById('authorizedAccountsMessage');

    const closeProfile = () => { if (profileModal) profileModal.style.display = 'none'; };
    const showAccountsMessage = (message, isError = false) => {
        if (!accountsMessage) return;
        accountsMessage.textContent = message;
        accountsMessage.classList.toggle('is-error', isError);
    };
    const renderAuthorizedEmails = (emails) => {
        if (!emailList) return;
        emailList.replaceChildren();
        emails.forEach(email => {
            const item = document.createElement('li');
            const label = document.createElement('span');
            label.textContent = email;
            item.appendChild(label);
            if (email.toLowerCase() !== 'azikanbal@gmail.com') {
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'authorized-email-remove';
                removeBtn.textContent = '삭제';
                removeBtn.addEventListener('click', async () => {
                    try {
                        const response = await fetch(`/api/auth/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.error || '이메일을 삭제하지 못했습니다.');
                        renderAuthorizedEmails(result.emails);
                        showAccountsMessage('허용 이메일을 삭제했습니다.');
                    } catch (error) { showAccountsMessage(error.message, true); }
                });
                item.appendChild(removeBtn);
            }
            emailList.appendChild(item);
        });
    };
    const loadAuthorizedEmails = async () => {
        try {
            const response = await fetch('/api/auth/users', { cache: 'no-store' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || '허용 이메일 목록을 불러오지 못했습니다.');
            renderAuthorizedEmails(result.emails || []);
        } catch (error) { showAccountsMessage(error.message, true); }
    };

    if (profileBtn) profileBtn.addEventListener('click', () => {
        if (!profileModal) return;
        if (userEmailEl) userEmailEl.textContent = currentAuthUser?.email || '로그인 상태를 확인할 수 없습니다.';
        const isAdmin = Boolean(currentAuthUser?.isAdmin);
        if (accountsSection) accountsSection.hidden = !isAdmin;
        showAccountsMessage('');
        profileModal.style.display = 'flex';
        if (isAdmin) loadAuthorizedEmails();
    });
    if (closeProfileBtn) closeProfileBtn.addEventListener('click', closeProfile);
    if (profileModal) {
        profileModal.addEventListener('click', event => { if (event.target === profileModal) closeProfile(); });
        document.addEventListener('keydown', event => { if (event.key === 'Escape') closeProfile(); });
    }
    if (addEmailForm) addEmailForm.addEventListener('submit', async event => {
        event.preventDefault();
        const email = emailInput?.value.trim();
        if (!email) return;
        try {
            const response = await fetch('/api/auth/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || '이메일을 등록하지 못했습니다.');
            renderAuthorizedEmails(result.emails || []);
            emailInput.value = '';
            showAccountsMessage('허용 이메일을 등록했습니다.');
        } catch (error) { showAccountsMessage(error.message, true); }
    });

    const profileLogoutBtn = document.getElementById('profileLogoutBtn');
    if (profileLogoutBtn) profileLogoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } finally {
            localStorage.removeItem('user_session');
            location.reload();
        }
    });

    // Sync Calendar Button
    document.addEventListener('click', (e) => {
        if (e.target.id === 'syncCalBtn') {
            setCalendarSyncStatus('Google 캘린더 동기화 중…');
            requestCalendarAccess(() => {
                if (calendar) calendar.refetchEvents();
            }, (error) => {
                console.warn('[Calendar] Manual authorization did not complete:', error);
                setCalendarSyncStatus('캘린더 권한을 확인하지 못했습니다.', true);
            });
        }
    });

    // Event Modal Buttons
    const saveEventBtn = document.getElementById('saveEvent');
    if (saveEventBtn) saveEventBtn.addEventListener('click', saveGoogleEvent);

    const cancelEventBtn = document.getElementById('cancelEvent');
    if (cancelEventBtn) cancelEventBtn.addEventListener('click', closeEventModal);

    const deleteEventBtn = document.getElementById('deleteEvent');
    if (deleteEventBtn) deleteEventBtn.addEventListener('click', deleteGoogleEvent);

    const closeEventModalX = document.getElementById('closeEventModal');
    if (closeEventModalX) closeEventModalX.addEventListener('click', closeEventModal);

    const allDayCheck = document.getElementById('eventAllDay');
    if (allDayCheck) {
        allDayCheck.addEventListener('change', (e) => {
            const timeInput = document.getElementById('eventStartTime');
            if (timeInput) timeInput.disabled = e.target.checked;
        });
    }
});

async function saveMemo() {
    if (!quillEditor) return;
    const content = quillEditor.getContents();
    const html = quillEditor.root.innerHTML;

    const memoUpdatedAt = Date.now();
    writeLocalMemo(html, content);
    localStorage.setItem(MEMO_PENDING_SYNC_KEY, JSON.stringify({ memoHtml: html, memoDelta: content, memoUpdatedAt }));

    const status = document.getElementById('memoStatus');
    const saveBtn = document.getElementById('memoSaveBtn');
    if (saveBtn) saveBtn.disabled = true;
    if (status) status.textContent = '서버로 저장 중...';

    try {
        await saveMemoToServer(html, content, memoUpdatedAt);
        if (status) status.textContent = '서버 저장 완료 ✓';
        console.log('💾 [Memo] Explicit server save completed');
    } catch (error) {
        if (status) status.textContent = '서버 저장 실패 ✗';
        console.error('❌ [Memo] Server save failed; local copy retained:', error);
        alert(`메모를 서버에 저장하지 못했습니다. 이 브라우저에는 임시 보관했습니다.\n${error.message}`);
    } finally {
        if (saveBtn) saveBtn.disabled = false;
        setTimeout(() => {
            if (status) status.textContent = '';
        }, 3000);
    }
}

function saveMemoAuto() {
    saveMemo();
}

function loadMemo() {
    if (!quillEditor) return;

    const savedDelta = localStorage.getItem('memoContent_delta');
    const savedHtml = localStorage.getItem('memoContent_html');

    if (savedDelta) {
        try {
            const delta = JSON.parse(savedDelta);
            quillEditor.setContents(delta);
        } catch (e) {
            if (savedHtml) {
                quillEditor.root.innerHTML = savedHtml;
            }
        }
    }

    console.log('📖 메모 로드됨');
}

/**
 * 캔버스 하단 공백(배경색만 있는 행) 제거
 */
function trimCanvasBottom(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // 하단부터 위로 스캔하며 배경색(白)이 아닌 행을 찾음
    let bottomY = h;
    for (let y = h - 1; y >= 0; y--) {
        let isBlank = true;
        for (let x = 0; x < w; x += 4) { // 4px 간격으로 샘플링 (성능)
            const idx = (y * w + x) * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            // 흰색(255,255,255) 또는 거의 흰색이 아닌 픽셀 발견
            if (r < 250 || g < 250 || b < 250) {
                isBlank = false;
                break;
            }
        }
        if (!isBlank) {
            bottomY = Math.min(h, y + 20); // 약간의 여백(20px) 추가
            break;
        }
    }

    if (bottomY >= h) return canvas; // 잘라낼 것 없음

    const trimmed = document.createElement('canvas');
    trimmed.width = w;
    trimmed.height = bottomY;
    const tctx = trimmed.getContext('2d');
    tctx.drawImage(canvas, 0, 0, w, bottomY, 0, 0, w, bottomY);
    return trimmed;
}

/**
 * 탭별 캡처 함수 (스크롤 영역 확장 포함)
 */
async function captureTabContent(tabContent, tabName) {
    if (!tabContent) return;
    tabName = tabName || 'Capture';

    // 캡처 대상: .container 또는 탭 전체
    const target = tabContent.querySelector('.container') ||
        tabContent.querySelector('.overseas-container') ||
        tabContent;

    // 스크롤 영역 확장
    const scrollSelectors = '.overseas-content-scroll, .table-wrapper, .table-wrapper tbody, .grid-container, .adr-chart-container, #quillEditor, .chart-grid';
    const scrollTargets = target.querySelectorAll(scrollSelectors);
    const saved = [];
    scrollTargets.forEach(el => {
        saved.push({ el, h: el.style.height, mh: el.style.maxHeight, ov: el.style.overflow, ovy: el.style.overflowY });
        el.style.height = 'auto';
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
        el.style.overflowY = 'visible';
    });

    // 랭크 페이지만 테이블 행수 제한 (20개 초과 행 숨김 처리)
    const hiddenRows = [];
    if (tabContent.id === 'tab-transaction_rank' || tabName.toLowerCase().includes('rank')) {
        const tables = target.querySelectorAll('table tbody');
        tables.forEach(tbody => {
            const rows = Array.from(tbody.querySelectorAll('tr'));
            if (rows.length > 20) {
                for (let i = 20; i < rows.length; i++) {
                    if (rows[i].style.display !== 'none') {
                        hiddenRows.push(rows[i]);
                        rows[i].style.display = 'none';
                    }
                }
            }
        });
    }

    try {
        await new Promise(r => setTimeout(r, 200));

        const rawCanvas = await html2canvas(target, {
            scale: 2,
            useCORS: true,
            logging: false,
            allowTaint: true,
            backgroundColor: '#ffffff',
            windowHeight: target.scrollHeight + 100
        });

        // 하단 공백 제거: 실제 콘텐츠 영역만 잘라냄
        const trimmed = trimCanvasBottom(rawCanvas);

        const image = trimmed.toDataURL('image/png');
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.href = image;
        link.download = `${tabName}_${timestamp}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log(`✅ [Capture] ${tabName} done.`);

    } catch (err) {
        console.error('❌ [Capture] Failed:', err);
        alert(`캡처 실패 (${tabName}): ` + err.message);
    } finally {
        // 스타일 복원
        saved.forEach(s => {
            s.el.style.height = s.h;
            s.el.style.maxHeight = s.mh;
            s.el.style.overflow = s.ov;
            s.el.style.overflowY = s.ovy;
        });

        // 숨겼던 테이블 행 복원
        hiddenRows.forEach(row => {
            row.style.display = '';
        });
    }
}

/**
 * 전체 탭 순차 캡처
 */
async function captureAllTabs() {
    console.log('📸 [CaptureAll] Starting...');
    const originalActiveBtn = document.querySelector('.tab-btn.active');
    const allTabBtns = Array.from(document.querySelectorAll('.tab-btn:not(.add-tab-btn)'));
    if (!allTabBtns.length) return;

    const btn = document.getElementById('captureAllBtn');
    if (btn) btn.disabled = true;

    isCapturing = true;
    console.log('[Capture] isCapturing = true');

    try {
        for (const tabBtn of allTabBtns) {
            const tabId = tabBtn.dataset.tab;
            const tabName = tabBtn.textContent.trim();
            activateTab(tabId);
            await new Promise(r => setTimeout(r, 1000));
            const content = document.getElementById(tabId);
            if (content) await captureTabContent(content, tabName);
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (e) {
        console.error('❌ [CaptureAll] Error:', e);
    } finally {
        isCapturing = false;
        console.log('[Capture] isCapturing = false');
        if (originalActiveBtn) activateTab(originalActiveBtn.dataset.tab);
        if (btn) btn.disabled = false;
        alert('전체 탭 캡처 완료');
    }
}

/**
 * 탭 헤더 .header-controls에 📸 캡처 버튼 삽입
 */
function injectCaptureButtons() {
    const captureSVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';

    document.querySelectorAll('.tab-content').forEach(tabContent => {
        const headerControls = tabContent.querySelector('.header-controls');
        if (!headerControls) return;
        if (headerControls.querySelector('.capture-btn-small')) return;

        const btn = document.createElement('button');
        btn.className = 'capture-btn-small btn-icon header-icon capture-camera-icon';
        btn.title = '이 탭 캡처';
        btn.innerHTML = captureSVG;
        headerControls.insertBefore(btn, headerControls.firstChild);
    });
}

// 위임 이벤트: .capture-btn-small 클릭 시 해당 탭 캡처
const _captureSVGIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';

document.body.addEventListener('click', function (e) {
    const btn = e.target.closest('.capture-btn-small');
    if (!btn) return;
    const tabContent = btn.closest('.tab-content');
    if (!tabContent) return;
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabContent.id}"]`);
    const tabName = tabBtn ? tabBtn.textContent.trim() : 'Capture';
    btn.innerHTML = '⏳';
    isCapturing = true;
    console.log('[Capture] isCapturing = true (small btn)');
    captureTabContent(tabContent, tabName).then(() => {
        btn.innerHTML = '✅';
        setTimeout(() => { btn.innerHTML = _captureSVGIcon; }, 1000);
    }).catch(() => {
        btn.innerHTML = _captureSVGIcon;
    }).finally(() => {
        isCapturing = false;
        console.log('[Capture] isCapturing = false (small btn)');
    });
});

// activateTab 래핑: 탭 전환 후 캡처 버튼 자동 주입
(function () {
    const _origActivate = activateTab;
    activateTab = function () {
        _origActivate.apply(this, arguments);
        setTimeout(injectCaptureButtons, 300);
    };
})();

// 초기 로드 시 주입
document.addEventListener('DOMContentLoaded', () => setTimeout(injectCaptureButtons, 1000));
setTimeout(injectCaptureButtons, 2000); // defer 로드 fallback



// Load each source once when the fixed tab is first activated.
function loadBaseInterestCharts(forceRefresh = false) {
    if (isCapturing) return;
    const content = document.getElementById(BASE_INTEREST_TAB_ID);
    if (!content) return;
    content.querySelectorAll('iframe[data-interest-url]').forEach(frame => {
        if (forceRefresh || !frame.hasAttribute('src')) frame.src = frame.dataset.interestUrl;
    });
}

// Delay opening to distinguish a single click from inline editing, as in USLinks.
function mountBaseInterestLinks(content) {
    const table = content.querySelector('.base-interest-fred-table');
    if (!table || table.querySelector('input')) return;
    if (!tabData[BASE_INTEREST_TAB_ID]) tabData[BASE_INTEREST_TAB_ID] = { name: '기준금리' };
    const data = tabData[BASE_INTEREST_TAB_ID];
    if (!Array.isArray(data.fredLinks) || data.fredLinksVersion !== BASE_INTEREST_LINKS_VERSION) {
        data.fredLinks = structuredClone(BASE_INTEREST_DEFAULT_LINKS);
        data.fredLinksVersion = BASE_INTEREST_LINKS_VERSION;
    }
    // Keep each continent contiguous and combine repeated countries without
    // dropping any of their URLs or per-link notes.
    const continents = new Map();
    data.fredLinks.forEach(item => {
        if (!continents.has(item.continent)) continents.set(item.continent, new Map());
        const countries = continents.get(item.continent);
        if (!countries.has(item.country)) countries.set(item.country, { ...item, urls: [], urlNotes: [] });
        const country = countries.get(item.country);
        const urls = Array.isArray(item.urls) && item.urls.length ? item.urls : [item.url];
        urls.forEach((url, index) => { country.urls.push(url); country.urlNotes.push((item.urlNotes?.[index] || '').replace(/[\u2013\u2014]/g, '-')); });
        country.url = country.urls[0];
    });
    data.fredLinks = [...continents.values()].flatMap(countries => [...countries.values()]);
    mountBaseInterestColumnResize(table);
    clearTimeout(table.clickTimer);
    table.editObserver?.disconnect();
    table.editKeyController?.abort();
    table.parentElement.querySelector('.base-interest-fred-actions')?.remove();
    table.parentElement.classList.remove('is-editing');
    table.querySelectorAll('tbody').forEach(body => body.remove());
    const body = document.createElement('tbody');
    const continentCells = [];
    const seenContinents = new Set();
    data.fredLinks.forEach(item => {
        const urls = Array.isArray(item.urls) && item.urls.length ? item.urls : [item.url];
        const row = document.createElement('tr');
        const countryRows = [row];
        const continent = document.createElement('td'); continent.textContent = item.continent;
        continent.className = 'base-interest-continent-cell';
        continentCells.push({ row, cell: continent, span: urls.length });
        if (!seenContinents.has(item.continent)) {
            continent.rowSpan = [...continents.get(item.continent).values()].reduce((sum, country) => sum + country.urls.length, 0);
            row.append(continent);
            seenContinents.add(item.continent);
        }
        const country = document.createElement('th'); country.scope = 'row'; country.textContent = item.country;
        country.rowSpan = urls.length;
        row.append(country);
        const cell = document.createElement('td');
        const notesCell = document.createElement('td'); notesCell.className = 'base-interest-fred-notes';
        const links = urls.map((url, index) => {
            const displayRow = index === 0 ? row : document.createElement('tr');
            if (index > 0) countryRows.push(displayRow);
            const urlCell = index === 0 ? cell : document.createElement('td');
            const noteCell = index === 0 ? notesCell : document.createElement('td');
            noteCell.className = 'base-interest-fred-notes';
            const link = document.createElement('a'); link.textContent = `${url} ↗`;
            try { if (['http:', 'https:'].includes(new URL(url).protocol)) link.href = url; } catch {}
            link.target = '_blank'; link.rel = 'noopener noreferrer';
            link.dataset.url = url;
            link.title = '클릭: 새 탭 열기 · 더블클릭 또는 F2: 편집';
            noteCell.textContent = item.urlNotes?.[index] || '';
            urlCell.append(link); displayRow.append(urlCell, noteCell); body.append(displayRow);
            return link;
        });
        const open = (url = urls[0]) => {
            try {
                if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error();
                window.open(url, '_blank', 'noopener,noreferrer');
            } catch { alert('URL을 확인한 뒤 편집해 주세요.'); }
        };
        const edit = () => {
            clearTimeout(table.clickTimer);
            if (table.querySelector('input')) return;
            continentCells.forEach(({ row, cell, span }) => {
                cell.rowSpan = span;
                if (!cell.isConnected) row.prepend(cell);
            });
            countryRows.slice(1).forEach(extraRow => extraRow.remove());
            country.rowSpan = 1;
            continent.rowSpan = 1;
            const inputs = {};
            for (const [field, target, label] of [['continent', continent, '대륙'], ['country', country, '국가/지역']]) {
                const input = document.createElement('input'); input.value = item[field];
                input.type = field === 'url' ? 'url' : 'text'; input.setAttribute('aria-label', label);
                inputs[field] = input; target.replaceChildren(input);
            }
            cell.replaceChildren();
            notesCell.replaceChildren();
            const urlInputs = [];
            const updateUrlControls = () => {
                urlInputs.forEach((input, index) => {
                    input.setAttribute('aria-label', `URL ${index + 1}`);
                    input.noteInput.setAttribute('aria-label', `비고 ${index + 1}`);
                    const remove = input.parentElement.querySelector('button');
                    remove.setAttribute('aria-label', `URL ${index + 1} 삭제`);
                    remove.disabled = urlInputs.length === 1;
                    remove.title = remove.disabled ? 'URL은 하나 이상 있어야 합니다' : '이 URL 삭제';
                });
            };
            const addUrl = (value = '', note = '') => {
                const entry = document.createElement('div'); entry.className = 'base-interest-fred-url-entry';
                const input = document.createElement('input'); input.type = 'url'; input.value = value;
                const noteInput = document.createElement('textarea'); noteInput.value = note;
                noteInput.rows = 2; input.noteInput = noteInput;
                const remove = document.createElement('button'); remove.type = 'button';
                remove.className = 'base-interest-fred-remove-url'; remove.textContent = '−';
                remove.addEventListener('click', () => {
                    if (urlInputs.length === 1) return;
                    const index = urlInputs.indexOf(input);
                    urlInputs.splice(index, 1); entry.remove(); noteInput.remove(); updateUrlControls();
                    urlInputs[Math.min(index, urlInputs.length - 1)].focus();
                });
                entry.append(input, remove);
                urlInputs.push(input); cell.insertBefore(entry, cell.querySelector('.base-interest-fred-url-add-row, [role="status"]'));
                notesCell.append(noteInput);
                updateUrlControls();
                return input;
            };
            urls.forEach((url, index) => addUrl(url, item.urlNotes?.[index] || ''));
            const actions = document.createElement('div'); actions.className = 'base-interest-fred-actions';
            const wrap = table.parentElement;
            wrap.classList.add('is-editing');
            wrap.append(actions);
            const positionActions = () => {
                actions.style.top = `${row.getBoundingClientRect().top - wrap.getBoundingClientRect().top + row.getBoundingClientRect().height / 2}px`;
            };
            const error = document.createElement('span'); error.setAttribute('role', 'status');
            const cancel = () => { row.querySelectorAll('input').forEach(input => input.remove()); mountBaseInterestLinks(content); };
            const save = async () => {
                const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
                try {
                    const entries = urlInputs.filter(input => input.value.trim());
                    values.urls = entries.map(input => input.value.trim());
                    values.urlNotes = entries.map(input => input.noteInput.value.trim().replace(/[\u2013\u2014]/g, '-'));
                    if (!values.continent || !values.country || !values.urls.length || values.urls.some(url => !['https:', 'http:'].includes(new URL(url).protocol))) throw new Error();
                    values.url = values.urls[0];
                } catch { error.textContent = '대륙·국가와 http(s) URL을 확인해 주세요.'; return; }
                Object.assign(item, values);
                cancel();
                try {
                    const ok = await saveAppData();
                    if (ok === false) alert('서버 저장에 실패했습니다. 저장 상태를 확인해 주세요.');
                } catch { alert('저장에 실패했습니다. 다시 시도해 주세요.'); }
            };
            const addButton = document.createElement('button'); addButton.type = 'button';
            addButton.className = 'base-interest-fred-add-url'; addButton.textContent = '+';
            addButton.setAttribute('aria-label', 'URL 추가'); addButton.title = 'URL 추가';
            addButton.addEventListener('click', () => { addUrl().focus(); positionActions(); });
            const addRow = document.createElement('div'); addRow.className = 'base-interest-fred-url-add-row';
            addRow.append(addButton); cell.append(addRow);
            for (const [label, action] of [['저장', save], ['취소', cancel]]) {
                const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
                button.addEventListener('click', action); actions.append(button);
            }
            cell.append(error);
            table.editObserver = new ResizeObserver(positionActions);
            table.editObserver.observe(table);
            positionActions();
            row.addEventListener('keydown', event => {
                if (event.isComposing || !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
                if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); save(); }
                if (event.key === 'Escape') { event.preventDefault(); cancel(); }
            }, { signal: (table.editKeyController = new AbortController()).signal });
            urlInputs[0].focus();
        };
        countryRows.forEach((displayRow, index) => {
        displayRow.addEventListener('click', event => {
            if (table.querySelector('input')) return;
            if (event.target.closest('a') && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return;
            event.preventDefault(); clearTimeout(table.clickTimer);
            if (event.detail >= 2) { edit(); return; }
            const url = event.target.closest('a')?.dataset.url || urls[index];
            table.clickTimer = setTimeout(() => open(url), 650);
        });
        displayRow.addEventListener('dblclick', event => {
            if (table.querySelector('input')) return;
            event.preventDefault(); edit();
        });
        });
        links.forEach(link => link.addEventListener('keydown', event => {
            if (event.key === 'F2') { event.preventDefault(); edit(); }
            if (event.key === 'Enter') { event.preventDefault(); clearTimeout(table.clickTimer); open(link.dataset.url); }
        }));
    });
    table.append(body);
}

function mountBaseInterestColumnResize(table) {
    const headers = [...table.querySelectorAll('thead th')];
    const minimums = [64, 80, 160, 160];
    const apply = widths => {
        table.classList.add('has-column-widths');
        table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
        [...table.querySelectorAll('col')].forEach((col, index) => { col.style.width = `${widths[index]}px`; });
    };
    const saved = tabData[BASE_INTEREST_TAB_ID]?.chartColumnWidths;
    if (!table.querySelector('colgroup')) {
        const group = document.createElement('colgroup');
        headers.forEach(() => group.append(document.createElement('col')));
        table.prepend(group);
    }
    if (Array.isArray(saved) && saved.length === headers.length && saved.every(Number.isFinite)) {
        apply(saved.map((width, index) => Math.max(minimums[index], width)));
    }
    if (table.dataset.resizeMounted) return;
    table.dataset.resizeMounted = 'true';
    const persist = widths => {
        tabData[BASE_INTEREST_TAB_ID].chartColumnWidths = widths;
        saveAppData().catch(error => console.error('[Base Interest] Column width save failed', error));
    };
    headers.forEach((header, index) => {
        const handle = document.createElement('span');
        handle.className = 'base-interest-column-resize';
        handle.tabIndex = 0; handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', `${header.textContent} 열 너비 조절`);
        handle.title = '드래그 또는 좌우 방향키로 열 너비 조절';
        let drag = null;
        const measure = () => headers.map((item, i) => Math.max(minimums[i], item.getBoundingClientRect().width));
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.stopPropagation();
            clearTimeout(table.clickTimer);
            drag = { x: event.clientX, original: measure(), widths: measure() };
            apply(drag.widths);
            handle.setPointerCapture(event.pointerId);
            table.classList.add('is-resizing-columns');
        });
        handle.addEventListener('pointermove', event => {
            if (!drag) return;
            drag.widths[index] = Math.max(minimums[index], drag.original[index] + event.clientX - drag.x);
            apply(drag.widths);
            handle.setAttribute('aria-valuenow', String(Math.round(drag.widths[index])));
        });
        const finish = event => {
            if (!drag) return;
            const current = drag; drag = null;
            table.classList.remove('is-resizing-columns');
            if (event.type === 'pointerup') persist(current.widths);
            else apply(current.original);
            if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        };
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
        handle.addEventListener('lostpointercapture', finish);
        handle.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const widths = measure();
            widths[index] = Math.max(minimums[index], widths[index] + (event.key === 'ArrowRight' ? 10 : -10));
            apply(widths); persist(widths);
            handle.setAttribute('aria-valuenow', String(Math.round(widths[index])));
        });
        header.append(handle);
    });
}
