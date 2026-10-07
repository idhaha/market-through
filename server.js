require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { exec, execFile } = require('child_process');
const puppeteer = require('puppeteer');
const { createDailyCapture, captureCentralBanks } = require('./central-banks');
const { createInterestStore, captureInterestCharts } = require('./base-interest');
const crypto = require('crypto');
const { createConcentrationChartService } = require('./concentration-chart');

// 전역 시장구분 캐시 (종목코드: 'K'/'Q') - 429 에러 방지용
const marketCache = {};

function resolveKiwoomMarketType(basicInfo, fallback = 'Q') {
    const marketName = String(basicInfo?.marketName || basicInfo?.mkt_nm || '').toUpperCase();
    if (marketName.includes('KOSDAQ') || marketName.includes('KSQ') || marketName.includes('코스닥')) return 'Q';
    if (marketName.includes('거래소') || marketName.includes('KOSPI') || marketName.includes('KSP') || marketName.includes('코스피') || marketName.includes('유가증권')) return 'K';

    const marketCode = String(basicInfo?.marketCode || basicInfo?.mkt_cd || '');
    if (marketCode === '0') return 'K';
    if (marketCode === '10') return 'Q';
    return fallback;
}

async function addConcentrationRates(items, accessToken, amountField) {
    // 시장 전체 거래대금은 KOSPI/KOSDAQ별 1회씩 조회해 순위 종목에 배분한다.
    // ka20001: 업종현재거래량요청, trde_prica를 분모로 사용한다.
    const marketTurnover = {};
    for (const market of [
        { type: 'K', mrkt_tp: '0', inds_cd: '001' },
        { type: 'Q', mrkt_tp: '1', inds_cd: '101' },
    ]) {
        if (!items.some(item => item.mkt_type === market.type)) continue;
        try {
            const marketResponse = await axios.post(
                "https://api.kiwoom.com/api/dostk/sect",
                { mrkt_tp: market.mrkt_tp, inds_cd: market.inds_cd },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`,
                        "api-id": "ka20001",
                    },
                    timeout: 5000
                }
            );
            const rawTurnover = marketResponse.data?.trde_prica;
            const turnover = Number(String(rawTurnover ?? '').replace(/,/g, ''));
            if (Number.isFinite(turnover) && turnover > 0) {
                marketTurnover[market.type] = turnover;
            } else {
                console.warn(`⚠️ ka20001 ${market.type} 시장 거래대금 응답에 유효한 trde_prica가 없습니다.`);
            }
        } catch (marketError) {
            console.warn(`⚠️ ka20001 ${market.type} 시장 거래대금 조회 실패:`, marketError.response?.data || marketError.message);
        }
    }

    const dataWithConcentration = items.map(item => {
        const marketAmount = marketTurnover[item.mkt_type];
        const stockAmount = Number(String(item[amountField] ?? '').replace(/,/g, ''));
        const concentrationRate = Number.isFinite(stockAmount) && marketAmount > 0
            ? Math.round(stockAmount / marketAmount * 100)
            : null;
        return {
            ...item,
            market_trde_prica: marketAmount ?? null,
            concentration_rate: concentrationRate,
        };
    });

    return { items: dataWithConcentration, marketTurnover };
}

// 디버그 로그 파일 설정
const LOG_DIR = path.join(__dirname, 'dev_tools', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'server_debug.log');

function fileLog(message) {
    const logMessage = `[${new Date().toLocaleString()}] ${message}\n`;
    console.log(message);
    try {
        fs.appendFileSync(LOG_FILE, logMessage);
    } catch (e) {
        // ignore
    }
}

const app = express();
const PORT = process.env.PORT || 3001;
const SERVER_START_TIME = new Date().toLocaleString();
const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '218429663028-l66pfc3i804uec317arj717r1hrf519u.apps.googleusercontent.com';
const AUTH_ADMIN_EMAIL = 'azikanbal@gmail.com';
const AUTHORIZED_EMAILS_FILE = path.join(__dirname, 'authorized_emails.json');
const AUTH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const authSessions = new Map();

// 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use((req, res, next) => {
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    if (req.protocol === 'http' && ['localhost', '127.0.0.1'].includes(host)) {
        res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    }
    next();
});

// 모든 요청 로그 출력 (매우 잘 보이게)
app.use((req, res, next) => {
    console.log("=========================================");
    console.log(`[${new Date().toLocaleTimeString()}] 요청 발생: ${req.method} ${req.url}`);
    next();
});

// Protect every API route, including handlers registered earlier in this file.
// Only the Google sign-in handshake and session lifecycle endpoints are public.
app.use('/api', (req, res, next) => {
    if (req.method === 'OPTIONS' || ['/auth/login', '/auth/session', '/auth/logout'].includes(req.path)) return next();
    const session = getSessionFromRequest(req);
    if (!session) return res.status(401).json({ success: false, error: '로그인이 필요합니다.' });
    req.authUser = session;
    next();
});

const concentrationChartService = createConcentrationChartService({ axios, getAccessToken, marketCache });
app.post('/api/concentration-chart', async (req, res) => {
    try {
        res.json(await concentrationChartService.query(req.body, req.authUser.email));
    } catch (error) {
        console.warn('[ConcentrationChart]', error.message);
        res.status(error.status || 502).json({ success: false, error: error.message });
    }
});

// 1. API 경로를 static 보다 먼저 정의 (우선순위 확보)
async function acquireCaptureBrowserSlot() {
    const deadline = Date.now() + 45000;
    while (activeBrowsers >= MAX_BROWSERS && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
    if (activeBrowsers >= MAX_BROWSERS) throw new Error('브라우저 사용량이 많아 잠시 후 다시 시도해 주세요.');
    activeBrowsers++;
    return () => { activeBrowsers = Math.max(0, activeBrowsers - 1); };
}
const getCentralBanksCapture = createDailyCapture(async () => {
    const release = await acquireCaptureBrowserSlot();
    try { return await captureCentralBanks(); } finally { release(); }
});
const getInterestCharts = createInterestStore(async (onChart, onStage) => {
    const release = await acquireCaptureBrowserSlot();
    try { await captureInterestCharts(onChart, onStage); } finally { release(); }
});
app.get('/api/base-interest/charts', (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const result = getInterestCharts(req.query.force_refresh === 'true' || req.query.force_refresh === '1');
    res.status(result.status === 'loading' ? 202 : result.status === 'error' ? 502 : 200).json(result);
});
app.get('/api/central-banks/image', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
        const capture = await getCentralBanksCapture(req.query.force_refresh === 'true' || req.query.force_refresh === '1');
        res.setHeader('X-Capture-Date', capture.date);
        res.setHeader('X-Captured-At', capture.capturedAt);
        res.setHeader('Content-Disposition', 'inline; filename="world_central_banks.png"');
        res.type('png').send(capture.png);
    } catch (error) {
        const stage = error.captureStage || 'unknown';
        fileLog(`[Central Banks] stage=${stage}: ${error.message}`);
        const reasons = { browser: '캡처 브라우저를 실행하지 못했습니다.', navigation: 'Investing.com 페이지에 접속하지 못했습니다.', table: '중앙은행 금리 테이블을 찾지 못했습니다.', screenshot: '중앙은행 테이블 이미지 캡처에 실패했습니다.' };
        res.status(502).json({ success: false, stage, error: reasons[stage] || '중앙은행 금리 이미지를 불러오지 못했습니다.' });
    }
});

app.get('/ping', (req, res) => {
    res.send(`pong (Server Start: ${SERVER_START_TIME})`);
});

/**
 * 실시간 종목 순위 API 엔드포인트
 */
app.get('/api/stock', async (req, res) => {
    console.log("🚀 [API START] /api/stock 요청 처리 시작");

    // 환경변수에서 다시 가져오기 (매 요청마다 최신값 확인용)
    const appKey = (process.env.KIWOOM_APPKEY || "").trim();
    const secretKey = (process.env.KIWOOM_SECRETKEY || "").trim();
    const efriendAppKey = (process.env.EFRIEND_APPKEY || "").trim();
    const efriendSecretKey = (process.env.EFRIEND_SECRETKEY || "").trim();
    const efriendDomain = (process.env.EFRIEND_DOMAIN || "").trim();

    try {
        if (!appKey || !secretKey) {
            console.error("❌ 에러: API 키가 없습니다.");
            return res.status(500).json({
                error: "API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.",
            });
        }

        // 1. Access Token 발급
        fileLog("Step 1: 토큰 발급 시도...");
        let accessToken = null;
        let efriendToken = null;
        try {
            const tokenPromises = [];
            tokenPromises.push(
                getAccessToken(appKey, secretKey).then(t => accessToken = t)
            );
            if (efriendAppKey && efriendSecretKey && efriendDomain) {
                fileLog(`[eFriend] Attempting token issuance for domain: ${efriendDomain}`);
                tokenPromises.push(
                    getEfriendAccessToken(efriendDomain, efriendAppKey, efriendSecretKey)
                        .then(t => {
                            efriendToken = t;
                            fileLog("[eFriend] Token issuance successful");
                        })
                        .catch(err => {
                            fileLog(`[eFriend] Token issuance failed: ${err.message}`);
                            if (err.response) fileLog(`[eFriend] Token Error response: ${JSON.stringify(err.response.data)}`);
                        })
                );
            } else {
                fileLog("[eFriend] Missing environment variables. Skipping eFriend API.");
            }
            await Promise.all(tokenPromises);
            console.log("✅ 토큰 발급 성공");
        } catch (tokenError) {
            console.error("❌ 키움 토큰 발급 실패:", tokenError.message);
            return res.status(500).json({
                success: false,
                error: tokenError.message,
                phase: "token_issuance"
            });
        }

        // 1.1 토큰 유효성 체크 추가 (디버그용)
        if (!accessToken) {
            console.error("❌ 에러: 발급된 핵심 토큰이 null입니다.");
            return res.status(500).json({ success: false, error: "Token issuance returned null" });
        }

        // 2. 실시간종목조회순위 API 호출 (전체 순위를 먼저 가져옴) 및 eFriend 호출 병렬
        console.log("Step 2: 전체 종목 순위(Global Rank) 및 eFriend 조회 중...");

        const qryTp = req.query.qry_tp || "1";

        let totalResp = null;
        let efriendStocks = [];
        const dataPromises = [];

        dataPromises.push(
            axios.post(
                "https://api.kiwoom.com/api/dostk/stkinfo",
                {
                    "qry_tp": qryTp,
                    "mrkt_tp": "000",
                    "sort_tp": "1",
                    "trde_qty_tp": "0000",
                    "stk_cnd": "0",
                    "crd_cnd": "0",
                    "stex_tp": "1"
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${accessToken}`,
                        "api-id": "ka00198",
                    },
                    timeout: 5000
                }
            ).then(r => totalResp = r)
        );

        if (efriendToken) {
            fileLog("[eFriend] CTSC2702R 대주가능 종목 페이징 조회 시작...");
            const fetchAllLendable = async () => {
                const MAX_PAGES = 50;
                let allItems = [];
                let fk200 = "";
                let nk100 = "";
                let pageCount = 0;

                while (pageCount < MAX_PAGES) {
                    try {
                        const response = await axios.get(
                            `${efriendDomain}/uapi/domestic-stock/v1/quotations/lendable-by-company`,
                            {
                                headers: {
                                    "content-type": "application/json; charset=utf-8",
                                    "authorization": `Bearer ${efriendToken}`,
                                    "appkey": efriendAppKey,
                                    "appsecret": efriendSecretKey,
                                    "tr_id": "CTSC2702R",
                                    "custtype": "P",
                                    // KIS 표준: 첫 조회 공백, 이후 Y(또는 N) — "N"을 첫 요청에 쓰면 0건 응답 발생
                                    "tr_cont": pageCount === 0 ? "" : "Y"
                                },
                                params: {
                                    "EXCG_DVSN_CD": "00",
                                    "PDNO": "",
                                    "THCO_STLN_PSBL_YN": "Y",
                                    "INQR_DVSN_1": "0",
                                    "CTX_AREA_FK200": fk200,
                                    "CTX_AREA_NK100": nk100
                                },
                                timeout: 10000
                            }
                        );

                        const data = response.data;
                        if (pageCount === 0) {
                            fileLog(`[eFriend] API response: rt_cd=${data.rt_cd}, msg_cd=${data.msg_cd}, msg1=${(data.msg1 || '').trim()}`);
                        }

                        if (data.rt_cd && data.rt_cd !== "0") {
                            fileLog(`[eFriend] API error: rt_cd=${data.rt_cd}, msg1=${(data.msg1 || '').trim()}`);
                            break;
                        }

                        const pageItems = Array.isArray(data.output1)
                            ? data.output1
                            : (Array.isArray(data.output) ? data.output : []);
                        allItems = allItems.concat(pageItems);
                        pageCount++;

                        const h_tr_cont = (response.headers['tr_cont'] || response.headers['TR_CONT'] || '').toUpperCase();
                        const fk200Preview = (data.ctx_area_fk200 || "").substring(0, 30);
                        fileLog(`[eFriend] Page ${pageCount}: ${pageItems.length} items (total: ${allItems.length}), tr_cont=${h_tr_cont || 'N'}, fk200=${fk200Preview}...`);

                        fk200 = data.ctx_area_fk200 || "";
                        nk100 = data.ctx_area_nk100 || "";

                        // Y(사용자 명세) 또는 M(KIS 표준)이면 다음 페이지 존재
                        const hasMore = (h_tr_cont === 'Y' || h_tr_cont === 'M');
                        if (!hasMore || pageItems.length === 0) {
                            break;
                        }

                        await new Promise(r => setTimeout(r, 200));
                    } catch (e) {
                        const errBody = e.response?.data ? JSON.stringify(e.response.data).substring(0, 300) : '';
                        fileLog(`[eFriend] Pagination error at page ${pageCount + 1}: ${e.message} (collected: ${allItems.length} items) ${errBody}`);
                        break;
                    }
                }

                if (pageCount >= MAX_PAGES) {
                    fileLog(`[eFriend] Warning: reached max page limit (${MAX_PAGES}), collected ${allItems.length} items`);
                }

                return allItems;
            };

            dataPromises.push(
                fetchAllLendable().then(items => {
                    efriendStocks = items;
                    fileLog(`[eFriend] Final: ${efriendStocks.length} lendable stocks collected`);
                })
            );
        }

        await Promise.all(dataPromises);

        // --- 2.5 eFriend 현재가(등락률) 일괄 조회 ---
        if (efriendToken && efriendStocks.length > 0) {
            console.log(`Step 2.5: eFriend ${efriendStocks.length}개 종목 현재가(등락률) 조회 시작...`);
            const efriendChunkSize = 10; // 10개씩 병렬 처리하여 429 에러 방지

            for (let i = 0; i < efriendStocks.length; i += efriendChunkSize) {
                const chunk = efriendStocks.slice(i, i + efriendChunkSize);
                const pricePromises = chunk.map(async (stock) => {
                    if (!stock.pdno) return;

                    // J:KRX, NX:NXT 등 시장구분이 필요한데 기본값 J(KRX)로 처리
                    let iscd = stock.pdno.trim();
                    if (iscd.length === 6 && (iscd.startsWith('5') || iscd.startsWith('7'))) {
                        iscd = "Q" + iscd; // ETN 예외처리 (CSV 명세서 권장사항)
                    }

                    try {
                        const priceRes = await axios.get(
                            `${efriendDomain}/uapi/domestic-stock/v1/quotations/inquire-price`,
                            {
                                headers: {
                                    "content-type": "application/json; charset=utf-8",
                                    "authorization": `Bearer ${efriendToken}`,
                                    "appkey": efriendAppKey,
                                    "appsecret": efriendSecretKey,
                                    "tr_id": "FHKST01010100", // 현재가 시세 TR ID
                                    "custtype": "P"
                                },
                                params: {
                                    "FID_COND_MRKT_DIV_CODE": "J",
                                    "FID_INPUT_ISCD": iscd
                                },
                                timeout: 3000
                            }
                        );

                        if (priceRes.data && priceRes.data.output) {
                            stock.prdy_ctrt = priceRes.data.output.prdy_ctrt; // 전일 대비율 (등락률)
                            stock.stck_prpr = priceRes.data.output.stck_prpr; // 현재가
                            stock.rprs_mrkt_kor_name = priceRes.data.output.rprs_mrkt_kor_name; // 시장 정보 (KOSPI/KOSDAQ)
                            // log original response field to understand what is coming from API
                            console.log(`[Server] INQ PRICE for ${stock.pdno}: rprs_mrkt_kor_name = "${priceRes.data.output.rprs_mrkt_kor_name}", tr_mkt_name = "${priceRes.data.output.tr_mkt_name}", mrkt_div_code = "${priceRes.data.output.mrkt_div_code}", mkt_nm = "${priceRes.data.output.mkt_nm}"`);
                        } else {
                            stock.prdy_ctrt = "0.00";
                            stock.stck_prpr = stock.bfdy_clpr;
                            stock.rprs_mrkt_kor_name = "";
                        }
                    } catch (err) {
                        // 에러 로그는 생략 (과부하 방지)
                        stock.prdy_ctrt = "0.00";
                        stock.stck_prpr = stock.bfdy_clpr;
                    }
                });

                await Promise.all(pricePromises);
                // API 부하 조절을 위한 대기 시간 (50ms)
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            console.log("Step 2.5: eFriend 현재가 조회 완료. 등락률, 현재가 병합됨.");
        }

        // 상세 로그 추가: 응답 본문 전체 확인
        console.log("DEBUG: ka00198 Full Response Data:", JSON.stringify(totalResp.data, null, 2));

        const stocks = totalResp.data.item_inq_rank || [];
        fileLog(`[Rank] /api/stock ka00198 received ${stocks.length} items (return_code=${totalResp.data.return_code ?? 'n/a'})`);

        // 토큰 에러 발생 시 캐시 초기화
        if (totalResp.data.return_code === 3 || (totalResp.data.return_msg && totalResp.data.return_msg.includes("Token이 유효하지 않습니다"))) {
            console.warn("⚠️ 토큰 만료/유효하지 않음 감지. 캐시를 초기화합니다.");
            cachedToken = null;
            tokenExpiryTime = 0;
        }

        // 3. (삭제됨) 코스닥 상위 리스트 확보 로직 제거
        // 사용자가 marketName 기반 판별을 원함. 아래 loop 내부에서 ka10100 결과를 사용.

        console.log(`📊 수신된 전체 종목: ${stocks.length}개`);
        if (stocks.length > 0) {
            console.log("Ranking Item Sample (Global #1):", JSON.stringify(stocks[0], null, 2));
        }

        // ka10007 (시세표성정보요청) API를 사용하여 정확한 당일 누적 거래대금(trde_prica)을 가져옴
        console.log("Step 4: 종목별 상세 거래대금(ka10007) 조회 및 시장별 보정 시작...");
        const enrichedStocks = [];

        const chunkSize = 1; // 429 에러 방지를 위해 1로 하향 (사용자 확인 완료)
        for (let i = 0; i < stocks.length; i += chunkSize) {
            const chunk = stocks.slice(i, i + chunkSize);
            // console.log(`Processing chunk ${i / chunkSize + 1} / ${Math.ceil(stocks.length / chunkSize)}...`);

            const chunkPromises = chunk.map(async (stock) => {
                const cleanCd = (stock.stk_cd || "").replace(/[^0-9a-zA-Z]/g, '');
                let marketType = null; // 시장구분 조회 실패 시 쏠림율 계산 불가
                let trdeAmtMillion = 0;

                try {
                    // 0. 이름 기반 필터링 (최우선 및 비용 없음)
                    const isEtfName = (stock.stk_nm || "").startsWith("KODEX") || (stock.stk_nm || "").startsWith("TIGER");
                    if (isEtfName) {
                        return null;
                    }

                    // 1. 주식기본정보요청 (ka10100) - 시장구분 (marketName)
                    const cachedMarket = marketCache[stock.stk_cd];
                    if (cachedMarket && cachedMarket.code != null && String(cachedMarket.code) !== '') {
                        const cached = cachedMarket;
                        // 시장코드 필터링 (0, 10만 허용)
                        if (!['0', '10'].includes(String(cached.code))) {
                            return null;
                        }
                        marketType = ['K', 'Q'].includes(cached.type) ? cached.type : resolveKiwoomMarketType(cached, marketType);
                    } else {
                        try {
                            const basicInfoResponse = await axios.post(
                                "https://api.kiwoom.com/api/dostk/stkinfo",
                                { "stk_cd": stock.stk_cd },
                                {
                                    headers: {
                                        "Content-Type": "application/json",
                                        "Authorization": `Bearer ${accessToken}`,
                                        "api-id": "ka10100",
                                    },
                                    timeout: 3000
                                }
                            );
                            const basicInfo = basicInfoResponse.data;
                            const mktCode = String(basicInfo.marketCode || basicInfo.mkt_cd || "");

                            // marketCode 필터링 (0:KOSPI, 10:KOSDAQ)
                            if (!['0', '10'].includes(mktCode)) {
                                fileLog(`[Filter] Excluding ${stock.stk_nm} (${stock.stk_cd}) - marketCode: ${mktCode}`);
                                marketCache[stock.stk_cd] = { type: '?', code: mktCode };
                                return null;
                            }

                            marketType = resolveKiwoomMarketType(basicInfo, marketType);
                            marketCache[stock.stk_cd] = { type: marketType, code: mktCode };
                        } catch (e) {
                            fileLog(`[Warning] ka10100 failed for ${stock.stk_nm}: ${e.message}`);
                        }
                    }

                    // 2. 종목별상세거래대금 (ka10007)
                    try {
                        const detailResponse = await axios.post(
                            "https://api.kiwoom.com/api/dostk/mrkcond",
                            { "stk_cd": `${stock.stk_cd}_AL` },
                            {
                                headers: {
                                    "Content-Type": "application/json",
                                    "Authorization": `Bearer ${accessToken}`,
                                    "api-id": "ka10007",
                                },
                                timeout: 3000
                            }
                        );
                        const detail = detailResponse.data;
                        trdeAmtMillion = parseInt(detail.trde_prica) || 0;
                    } catch (e) {
                        // ignore
                    }

                    return {
                        ...stock,
                        bigd_rank: stock.bigd_rank || stock.rank || 0,
                        base_comp_chgr: stock.base_comp_chgr || stock.flu_rt || stock.fluc_rt || stock.prdy_ctrt || '0',
                        mkt_type: marketType, // Explicit market type from ka10100
                        trde_amt: trdeAmtMillion // 기존 로직 호환 (클라이언트가 /100 할수도, 확인 필요. 일단 ka10007은 백만단위 trde_prica 리턴함. 클라이언트에서 그대로 쓰도록 수정했으니 여기선 *100 안하고 그대로 줘야함? 아님 클라이언트가 백만단위 기대?)
                        // [Fix] 클라이언트 renderTable: const trdeAmtMillion = trdeAmtNum; (백만단위 그대로 사용)
                        // ka10007 trde_prica: "누적거래대금(백만)"
                        // 따라서 여기서 백만 단위 그대로 리턴.
                        // 하지만 기존 코드: `trde_amt` field used. `stock` object has `trde_amt`.
                        // We are overriding it. Let's just return trdeAmtMillion.
                    };
                } catch (err) {
                    return { ...stock, mkt_type: null };
                }
            });

            const processed = await Promise.all(chunkPromises);
            // null(필터링된 항목) 제외하고 추가
            enrichedStocks.push(...processed.filter(p => p !== null));

            // API 부하 조절을 위한 대기 시간 (100ms 지연)
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const { items: watchStocksWithConcentration } = await addConcentrationRates(enrichedStocks, accessToken, 'trde_amt');

        // 대주가능 목록의 종목 데이터는 eFriend에서 유지하고, 시장구분은
        // 거래대금 상위와 동일하게 Kiwoom ka10100 정보만 사용한다.
        let marketLookupCount = 0;
        for (const stock of efriendStocks) {
            const stockCode = String(stock.pdno || '').trim().replace(/[^0-9a-zA-Z]/g, '').replace(/_AL$/i, '');
            if (!stockCode) continue;

            const cachedMarket = marketCache[stockCode] || marketCache[`${stockCode}_AL`];
            if (cachedMarket && cachedMarket.code != null && ['0', '10'].includes(String(cachedMarket.code))) {
                stock.mkt_type = ['K', 'Q'].includes(cachedMarket.type)
                    ? cachedMarket.type
                    : resolveKiwoomMarketType(cachedMarket, String(cachedMarket.code) === '0' ? 'K' : 'Q');
                continue;
            }

            try {
                const basicInfoResponse = await axios.post(
                    'https://api.kiwoom.com/api/dostk/stkinfo',
                    { stk_cd: stockCode },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${accessToken}`,
                            'api-id': 'ka10100'
                        },
                        timeout: 3000
                    }
                );
                const basicInfo = basicInfoResponse.data || {};
                const marketCode = String(basicInfo.marketCode || basicInfo.mkt_cd || '');
                if (['0', '10'].includes(marketCode)) {
                    const marketType = resolveKiwoomMarketType(basicInfo, marketCode === '0' ? 'K' : 'Q');
                    stock.mkt_type = marketType;
                    marketCache[stockCode] = {
                        ...(marketCache[stockCode] || {}),
                        type: marketType,
                        code: marketCode
                    };
                    marketLookupCount++;
                }
            } catch (err) {
                fileLog(`[Warning] eFriend ka10100 failed for ${stockCode}: ${err.message}`);
            }

            // 종목 수가 많을 때 Kiwoom API 요청이 몰리지 않도록 간격을 둔다.
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log(`Step 4.5: eFriend 시장구분 조회 완료 (${marketLookupCount}개 ka10100 조회, KIS 시장명 미사용)`);

        console.log("Step 5: 데이터 보정 및 병합 완료");
        fileLog(`[Rank] /api/stock response counts: kiwoom=${enrichedStocks.length}, efriend=${efriendStocks.length}`);
        res.json({
            success: true,
            data: {
                kiwoom: watchStocksWithConcentration,
                efriend: efriendStocks
            },
            server_time: new Date().toISOString(),
            start_time: SERVER_START_TIME
        });

    } catch (error) {
        const errorData = error.response?.data;
        console.error("❌ 최종 에러 발생:", errorData || error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            details: errorData || null,
            phase: "data_fetching"
        });
    }
});

/**
 * 전일동시간대비 거래대금상위(ka10032) API 엔드포인트
 */
app.get('/api/transaction_rank', async (req, res) => {
    console.log("🚀 [API START] /api/transaction_rank 요청 처리 시작");

    const appKey = (process.env.KIWOOM_APPKEY || "").trim();
    const secretKey = (process.env.KIWOOM_SECRETKEY || "").trim();

    // 파라미터 추출 (기본값 설정)
    const mrkt_tp = req.query.mrkt_tp || "000"; // 000:전체, 001:코스피, 101:코스닥
    const stex_tp = req.query.stex_tp || "3";   // 1:KRX, 2:NXT, 3:통합

    try {
        if (!appKey || !secretKey) {
            return res.status(500).json({ error: "API 키 설정 필요" });
        }

        let accessToken = await getAccessToken(appKey, secretKey);

        console.log(`Step 2: 거래대금상위 조회 (mrkt_tp=${mrkt_tp}, stex_tp=${stex_tp})...`);
        const response = await axios.post(
            "https://api.kiwoom.com/api/dostk/rkinfo", // Correct URI for ka10032 based on user input
            {
                "mrkt_tp": mrkt_tp,
                "stex_tp": stex_tp,
                "mang_stk_incls": "0", // 고정값
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                    "api-id": "ka10032",
                },
                timeout: 5000
            }
        );

        // 상세 로그 추가: 응답 본문 전체 확인
        console.log("DEBUG: ka10032 Full Response Data:", JSON.stringify(response.data, null, 2));

        // ka10032 returns data in 'trde_prica_upper'
        const rawItems = response.data.trde_prica_upper || response.data.output || [];
        fileLog(`[Rank] /api/transaction_rank ka10032 received ${rawItems.length} items (return_code=${response.data.return_code ?? 'n/a'})`);

        // 토큰 에러 발생 시 캐시 초기화
        if (response.data.return_code === 3 || (response.data.return_msg && response.data.return_msg.includes("Token이 유효하지 않습니다"))) {
            console.warn("⚠️ 토큰 만료/유효하지 않음 감지. 캐시를 초기화합니다.");
            cachedToken = null;
            tokenExpiryTime = 0;
        }

        // 필터링 후 20개가 모일 때까지 순위 순서대로 후보를 확인한다.
        const targetCount = 20;
        const candidateItems = rawItems;
        // Market Enrichment
        console.log(`Step 3: 거래대금상위 시장구분(ka10100) 보정 시작 (${candidateItems.length}/${rawItems.length}개)...`);
        const enrichedItems = [];
        const chunkSize = 1; // 429 에러 방지를 위해 1로 하향

        for (let i = 0; i < candidateItems.length && enrichedItems.length < targetCount; i += chunkSize) {
            const chunk = candidateItems.slice(i, i + chunkSize);
            const chunkPromises = chunk.map(async (item) => {
                let marketType = null; // 시장구분 조회 실패 시 쏠림율 계산 불가
                const stockCode = (item.stk_cd || "").replace(/_AL$/, "");

                try {
                    // 0. 이름 기반 필터링 (최우선)
                    const isEtfName = (item.stk_nm || "").startsWith("KODEX") || (item.stk_nm || "").startsWith("TIGER");
                    if (isEtfName) return null;

                    // 1. 시장구분 및 marketCode 필터링 (캐시 확인)
                    const cachedMarket = marketCache[stockCode];
                    if (cachedMarket && cachedMarket.code != null && String(cachedMarket.code) !== '') {
                        const cached = cachedMarket;
                        if (!['0', '10'].includes(String(cached.code))) {
                            return null;
                        }
                        marketType = ['K', 'Q'].includes(cached.type) ? cached.type : resolveKiwoomMarketType(cached, marketType);
                    } else {
                        // 캐시에 없는 경우, 정확한 필터링을 위해 무조건 ka10100 호출
                        // (KODEX 등이 marketCode 0으로 들어오는 경우를 거르기 위함)
                        try {
                            const basicInfoResponse = await axios.post(
                                "https://api.kiwoom.com/api/dostk/stkinfo",
                                { "stk_cd": stockCode },
                                {
                                    headers: {
                                        "Content-Type": "application/json",
                                        "Authorization": `Bearer ${accessToken}`,
                                        "api-id": "ka10100",
                                    },
                                    timeout: 3000
                                }
                            );
                            const basicInfo = basicInfoResponse.data;
                            const mktCode = String(basicInfo.marketCode || basicInfo.mkt_cd || "");

                            // marketCode 필터링 (0: KOSPI, 10: KOSDAQ)
                            if (!['0', '10'].includes(mktCode)) {
                                marketCache[stockCode] = { type: '?', code: mktCode };
                                return null;
                            }

                            marketType = resolveKiwoomMarketType(basicInfo, marketType);
                            marketCache[stockCode] = { type: marketType, code: mktCode };
                        } catch (e) {
                            // API 실패 시엔 이름 필터링만 적용된 채로 진행 (최소한의 안전장치)
                        }
                    }

                    return {
                        ...item,
                        mkt_type: marketType,
                        fluc_rt: item.flu_rt,
                        trde_amt: item.trde_prica,
                    };
                } catch (err) {
                    return null;
                }
            });

            const processed = await Promise.all(chunkPromises);
            enrichedItems.push(...processed.filter(p => p !== null));

            // 모든 요청 사이에 미세 지연 추가
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const { items: dataWithConcentration, marketTurnover } = await addConcentrationRates(enrichedItems, accessToken, 'trde_amt');

        fileLog(`[Rank] /api/transaction_rank response counts: items=${dataWithConcentration.length}`);

        res.json({
            success: true,
            items: dataWithConcentration,
            market_turnover: marketTurnover,
            server_time: new Date().toISOString()
        });

    } catch (error) {
        console.error("❌ ka10032 에러:", error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data || null
        });
    }
});

/**
 * 관심종목 그룹 리스트(ka01300) API 엔드포인트
 */
app.get('/api/watchlist_groups', async (req, res) => {
    console.log("🚀 [API START] /api/watchlist_groups 요청 처리 시작");

    const appKey = (process.env.KIWOOM_APPKEY || "").trim();
    const secretKey = (process.env.KIWOOM_SECRETKEY || "").trim();

    try {
        if (!appKey || !secretKey) {
            return res.status(500).json({ error: "API 키 설정 필요" });
        }

        let accessToken = await getAccessToken(appKey, secretKey);

        const response = await axios.post(
            "https://api.kiwoom.com/api/dostk/watchlist",
            {},
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                    "api-id": "ka01300",
                    "cont-yn": "n",
                    "next-key": "n"
                },
                timeout: 5000
            }
        );

        console.log("DEBUG: ka01300 Full Response Data:", JSON.stringify(response.data, null, 2));

        if (response.data.return_code === 3 || (response.data.return_msg && response.data.return_msg.includes("Token이 유효하지 않습니다"))) {
            console.warn("⚠️ 토큰 만료/유효하지 않음 감지. 캐시를 초기화합니다.");
            cachedToken = null;
            tokenExpiryTime = 0;
        }

        if (response.data.return_code !== 0 && response.data.return_code !== undefined) {
            console.error(`❌ ka01300 에러 [${response.data.return_code}]: ${response.data.return_msg}`);
            return res.status(400).json({
                success: false,
                error: response.data.return_msg || `키움 그룹조회 실패 (${response.data.return_code})`,
                return_code: response.data.return_code
            });
        }

        let rawGroups = [];
        if (Array.isArray(response.data)) {
            rawGroups = response.data;
        } else if (Array.isArray(response.data.grp_list)) {
            rawGroups = response.data.grp_list;
        } else if (Array.isArray(response.data.item)) {
            rawGroups = response.data.item;
        } else if (Array.isArray(response.data.items)) {
            rawGroups = response.data.items;
        } else if (Array.isArray(response.data.data)) {
            rawGroups = response.data.data;
        } else if (Array.isArray(response.data.output)) {
            rawGroups = response.data.output;
        } else if (Array.isArray(response.data.output1)) {
            rawGroups = response.data.output1;
        } else {
            for (const key of Object.keys(response.data)) {
                if (Array.isArray(response.data[key])) {
                    rawGroups = response.data[key];
                    break;
                }
            }
        }

        const groups = rawGroups.map(g => ({
            grp_id: g.arn_grp_id || g.grp_id || g.group_id || g.id || '',
            grp_nm: g.arn_grp_nm || g.grp_nm || g.group_name || g.name || (g.arn_grp_id || g.grp_id || '')
        })).filter(g => g.grp_id);

        res.json({
            success: true,
            groups,
            server_time: new Date().toISOString()
        });
    } catch (error) {
        console.error("❌ ka01300 에러:", error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data || null
        });
    }
});

/**
 * 관심종목 그룹 상세조회(ka01301) 및 하락률 순위 엔드포인트
 */
app.get('/api/watchlist_rank', async (req, res) => {
    console.log("🚀 [API START] /api/watchlist_rank 요청 처리 시작");

    const appKey = (process.env.KIWOOM_APPKEY || "").trim();
    const secretKey = (process.env.KIWOOM_SECRETKEY || "").trim();
    const grpId = req.query.grp_id || "074";

    try {
        if (!appKey || !secretKey) {
            return res.status(500).json({ error: "API 키 설정 필요" });
        }

        let accessToken = await getAccessToken(appKey, secretKey);

        console.log(`Step 2: 관심종목 그룹 상세조회 (arn_grp_id=${grpId})...`);
        const response = await axios.post(
            "https://api.kiwoom.com/api/dostk/watchlist",
            {
                "arn_grp_id": grpId
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${accessToken}`,
                    "api-id": "ka01301",
                    "cont-yn": "n",
                    "next-key": "n"
                },
                timeout: 5000
            }
        );

        console.log("DEBUG: ka01301 Full Response Data:", JSON.stringify(response.data, null, 2));

        if (response.data.return_code === 3 || (response.data.return_msg && response.data.return_msg.includes("Token이 유효하지 않습니다"))) {
            console.warn("⚠️ 토큰 만료/유효하지 않음 감지. 캐시를 초기화합니다.");
            cachedToken = null;
            tokenExpiryTime = 0;
        }

        if (response.data.return_code !== 0 && response.data.return_code !== undefined) {
            console.error(`❌ ka01301 에러 [${response.data.return_code}]: ${response.data.return_msg}`);
            return res.status(400).json({
                success: false,
                error: response.data.return_msg || `키움 관심종목조회 실패 (${response.data.return_code})`,
                return_code: response.data.return_code
            });
        }

        let rawItems = [];
        if (Array.isArray(response.data)) {
            rawItems = response.data;
        } else if (Array.isArray(response.data.nofj)) {
            rawItems = response.data.nofj;
        } else if (Array.isArray(response.data.item_list)) {
            rawItems = response.data.item_list;
        } else if (Array.isArray(response.data.item)) {
            rawItems = response.data.item;
        } else if (Array.isArray(response.data.items)) {
            rawItems = response.data.items;
        } else if (Array.isArray(response.data.data)) {
            rawItems = response.data.data;
        } else if (Array.isArray(response.data.output)) {
            rawItems = response.data.output;
        } else if (Array.isArray(response.data.output1)) {
            rawItems = response.data.output1;
        } else if (Array.isArray(response.data.output2)) {
            rawItems = response.data.output2;
        } else if (Array.isArray(response.data.watchlist)) {
            rawItems = response.data.watchlist;
        } else if (Array.isArray(response.data.grp_list)) {
            rawItems = response.data.grp_list;
        } else {
            for (const key of Object.keys(response.data)) {
                if (Array.isArray(response.data[key])) {
                    rawItems = response.data[key];
                    break;
                }
            }
        }

        fileLog(`Step 3: 관심종목 종목별 데이터 보정 시작 (${rawItems.length}개)...`);
        
        // 1. 모든 종목 코드 추출
        const stockCodes = rawItems.map(item => (item.cod2 || item.stk_cd || item.isu_cd || item.item_cd || item.code || item.pdno || item.iscd || "").replace(/[^0-9a-zA-Z]/g, '').replace(/_AL$/, "")).filter(Boolean);

        // 2. ka10095 (관심종목정보요청)를 통한 일괄 시세/거래대금/종목명 조회 (한 번의 요청으로 최대 100개 종목 조회 가능)
        const batchMap = {};
        if (stockCodes.length > 0) {
            try {
                const batchCdString = stockCodes.map(c => `${c}_AL`).join('|');
                fileLog(`Step 3-A: ka10095 관심종목 일괄 조회 시도 (${stockCodes.length}개 종목)...`);
                const batchResponse = await axios.post(
                    "https://api.kiwoom.com/api/dostk/stkinfo",
                    { "stk_cd": batchCdString },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${accessToken}`,
                            "api-id": "ka10095",
                        },
                        timeout: 7000
                    }
                );

                const batchList = batchResponse.data?.atn_stk_infr || batchResponse.data?.data || batchResponse.data?.output || [];
                fileLog(`Step 3-A: ka10095 응답 수신 완료 (${batchList.length}개 종목 데이터 수신)`);

                for (const bItem of batchList) {
                    const bCode = (bItem.stk_cd || "").replace(/[^0-9a-zA-Z]/g, '').replace(/_AL$/, "");
                    if (bCode) {
                        batchMap[bCode] = {
                            stk_nm: bItem.stk_nm || '',
                            fluc_rt: bItem.flu_rt || bItem.fluc_rt || bItem.base_comp_chgr || '0',
                            trde_amt: parseInt(bItem.trde_prica || bItem.trde_amt || 0) || 0
                        };
                        // 이름 캐싱
                        if (bItem.stk_nm && (!marketCache[bCode] || !marketCache[bCode].name)) {
                            marketCache[bCode] = { ...(marketCache[bCode] || {}), name: bItem.stk_nm };
                        }
                    }
                }
            } catch (batchErr) {
                fileLog(`[Warning] ka10095 일괄 조회 실패, 개별 조회로 전환: ${batchErr.message}`);
            }
        }

        const enrichedItems = [];
        const chunkSize = 1;

        for (let i = 0; i < rawItems.length; i += chunkSize) {
            const chunk = rawItems.slice(i, i + chunkSize);
            const chunkPromises = chunk.map(async (item) => {
                const stockCode = (item.cod2 || item.stk_cd || item.isu_cd || item.item_cd || item.code || item.pdno || item.iscd || item.shcode || item.jong_cd || item.stck_shrn_iscd || item.arn_stk_cd || "").replace(/[^0-9a-zA-Z]/g, '').replace(/_AL$/, "");
                if (!stockCode) return null;

                let stockName = item.stk_nm || item.isu_nm || item.prdt_name || item.name || '';
                let marketType = null;
                let trdeAmtMillion = parseInt(item.trde_amt || item.trde_prica || item.acml_tr_pbmn || 0) || 0;
                let flucRt = item.fluc_rt || item.flu_rt || item.prdy_ctrt || item.base_comp_chgr || item.chg_rt || '0';

                // ka10095 일괄 데이터 우선 적용
                if (batchMap[stockCode]) {
                    const b = batchMap[stockCode];
                    if (b.stk_nm) stockName = b.stk_nm;
                    if (b.fluc_rt) flucRt = b.fluc_rt;
                    if (b.trde_amt !== undefined) trdeAmtMillion = b.trde_amt;
                }

                try {
                    // 1. 시장구분 및 종목명 (ka10100) - 캐시 우선 확인
                    const cachedMarket = marketCache[stockCode];
                    if (cachedMarket && cachedMarket.code != null && String(cachedMarket.code) !== '') {
                        const cached = cachedMarket;
                        if (cached.name && !stockName) stockName = cached.name;
                        marketType = ['K', 'Q'].includes(cached.type) ? cached.type : resolveKiwoomMarketType(cached, marketType);
                    } else {
                        try {
                            const basicInfoResponse = await axios.post(
                                "https://api.kiwoom.com/api/dostk/stkinfo",
                                { "stk_cd": stockCode },
                                {
                                    headers: {
                                        "Content-Type": "application/json",
                                        "Authorization": `Bearer ${accessToken}`,
                                        "api-id": "ka10100",
                                    },
                                    timeout: 3000
                                }
                            );
                            const basicInfo = basicInfoResponse.data;
                            const mktCode = String(basicInfo.marketCode || basicInfo.mkt_cd || "");
                            const fetchedName = basicInfo.stk_nm || basicInfo.name || basicInfo.isu_nm || basicInfo.item_nm || "";

                            if (fetchedName && !stockName) stockName = fetchedName;

                            marketType = resolveKiwoomMarketType(basicInfo, marketType);

                            marketCache[stockCode] = { name: stockName, type: marketType, code: mktCode };
                        } catch (e) {
                            fileLog(`[Warning] ka10100 failed for (${stockCode}): ${e.message}`);
                        }
                    }

                    // 0. 이름 기반 ETF 필터링
                    const isEtfName = (stockName || "").startsWith("KODEX") || (stockName || "").startsWith("TIGER");
                    if (isEtfName) return null;

                    // 2. 만약 batchMap에 없었던 경우만 개별 ka10007 호출 (시세표성정보요청)
                    if (!batchMap[stockCode] || (!trdeAmtMillion && flucRt === '0')) {
                        try {
                            const detailResponse = await axios.post(
                                "https://api.kiwoom.com/api/dostk/mrkcond",
                                { "stk_cd": `${stockCode}_AL` },
                                {
                                    headers: {
                                        "Content-Type": "application/json",
                                        "Authorization": `Bearer ${accessToken}`,
                                        "api-id": "ka10007",
                                    },
                                    timeout: 3000
                                }
                            );
                            const detail = detailResponse.data;
                            if (detail.trde_prica) {
                                trdeAmtMillion = parseInt(detail.trde_prica) || 0;
                            }
                            if (detail.flu_rt || detail.fluc_rt || detail.base_comp_chgr || detail.prdy_ctrt) {
                                flucRt = detail.flu_rt || detail.fluc_rt || detail.base_comp_chgr || detail.prdy_ctrt;
                            }
                            if (!stockName && (detail.stk_nm || detail.isu_nm || detail.name)) {
                                stockName = detail.stk_nm || detail.isu_nm || detail.name;
                            }
                        } catch (e) {
                            fileLog(`[Warning] ka10007 individual fallback failed for (${stockCode}): ${e.message}`);
                        }
                    }

                    return {
                        ...item,
                        stk_cd: stockCode,
                        stk_nm: stockName || stockCode,
                        mkt_type: marketType,
                        fluc_rt: flucRt,
                        trde_amt: trdeAmtMillion
                    };
                } catch (err) {
                    fileLog(`[Warning] Enrichment catch for ${stockCode}: ${err.message}`);
                    return {
                        ...item,
                        stk_cd: stockCode,
                        stk_nm: stockName || stockCode,
                        mkt_type: marketType,
                        fluc_rt: flucRt,
                        trde_amt: trdeAmtMillion
                    };
                }
            });

            const processed = await Promise.all(chunkPromises);
            enrichedItems.push(...processed.filter(p => p !== null));

            // ka10100 / ka10007 호출이 발생한 경우 레이트 리밋 방지 대기
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        fileLog(`Step 4: 관심종목 최종 보정 완료 (총 ${enrichedItems.length}개 반환)`);

        // API 계약에서도 하락률이 큰 종목부터 반환하도록 정렬한다.
        enrichedItems.sort((a, b) => {
            const rateA = Number.parseFloat(a.fluc_rt || a.flu_rt || a.base_comp_chgr || a.prdy_ctrt || 0) || 0;
            const rateB = Number.parseFloat(b.fluc_rt || b.flu_rt || b.base_comp_chgr || b.prdy_ctrt || 0) || 0;
            return rateA - rateB;
        });

        res.json({
            success: true,
            grp_id: grpId,
            items: enrichedItems,
            server_time: new Date().toISOString()
        });

    } catch (error) {
        fileLog(`❌ ka01301 에러: ${error.message}`);
        console.error("❌ ka01301 에러:", error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.response?.data || null
        });
    }
});

/**
 * 관심종목 전체 디버깅용 엔드포인트
 * 브라우저나 curl로 http://localhost:3001/api/watchlist_debug?grp_id=074 호출 시
 * 키움 API와의 원본 요청/응답 전체를 JSON으로 확인 가능
 */
app.get('/api/watchlist_debug', async (req, res) => {
    const appKey = (process.env.KIWOOM_APPKEY || "").trim();
    const secretKey = (process.env.KIWOOM_SECRETKEY || "").trim();
    const grpId = req.query.grp_id || "074";

    const debugLogs = [];
    const log = (msg) => {
        debugLogs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
        console.log(`[WatchlistDebug] ${msg}`);
    };

    try {
        log(`1. 토큰 발급 시작 (AppKey: ${appKey.substring(0, 8)}...)`);
        const tokenRes = await axios.post(
            "https://api.kiwoom.com/oauth2/token",
            {
                grant_type: "client_credentials",
                appkey: appKey,
                secretkey: secretKey
            },
            {
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            }
        );

        log(`Token 응답 return_code: ${tokenRes.data.return_code}, return_msg: ${tokenRes.data.return_msg || 'OK'}`);
        const token = tokenRes.data.token || tokenRes.data.access_token;

        if (!token) {
            return res.json({
                success: false,
                step: "token",
                tokenResponse: tokenRes.data,
                logs: debugLogs
            });
        }

        log("2. ka01300 (그룹 리스트) 호출...");
        let groupResData = null;
        try {
            const grpRes = await axios.post(
                "https://api.kiwoom.com/api/dostk/watchlist",
                {},
                {
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`,
                        "api-id": "ka01300",
                        "cont-yn": "n",
                        "next-key": "n"
                    },
                    timeout: 10000
                }
            );
            groupResData = grpRes.data;
            log(`ka01300 응답 수신 완료 (Status: ${grpRes.status})`);
        } catch (e) {
            groupResData = { error: e.message, response: e.response?.data };
            log(`ka01300 실패: ${e.message}`);
        }

        log(`3. ka01301 (그룹 ${grpId} 상세조회) 호출...`);
        let detailResData = null;
        try {
            const dRes = await axios.post(
                "https://api.kiwoom.com/api/dostk/watchlist",
                { "arn_grp_id": String(grpId) },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`,
                        "api-id": "ka01301",
                        "cont-yn": "n",
                        "next-key": "n"
                    },
                    timeout: 10000
                }
            );
            detailResData = dRes.data;
            log(`ka01301 응답 수신 완료 (Status: ${dRes.status})`);
        } catch (e) {
            detailResData = { error: e.message, response: e.response?.data };
            log(`ka01301 실패: ${e.message}`);
        }

        res.json({
            success: true,
            tested_grp_id: grpId,
            token_sample: token ? `${token.substring(0, 15)}...` : null,
            ka01300_groups_raw: groupResData,
            ka01301_detail_raw: detailResData,
            logs: debugLogs
        });
    } catch (e) {
        log(`전체 디버그 실패: ${e.message}`);
        res.status(500).json({
            success: false,
            error: e.message,
            response: e.response?.data,
            logs: debugLogs
        });
    }
});

/**
 * 토스증권 캘린더 프록시 엔드포인트 (X-Frame-Options 우회 및 임베드용)
 */
app.get(['/api/toss_calendar', '/calendar'], async (req, res) => {
    if (req.path === '/api/toss_calendar') {
        const session = getSessionFromRequest(req);
        if (!session) return res.status(401).json({ success: false, error: '로그인이 필요합니다.' });
    }
    try {
        const response = await axios.get('https://www.tossinvest.com/calendar', {
            headers: {
                // Toss checks the requesting browser version; forward the actual
                // browser UA instead of presenting the server as stale Chrome 120.
                'User-Agent': req.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
                'Accept': req.get('accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': req.get('accept-language') || 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 10000
        });
        let html = response.data;
        if (typeof html === 'string') {
            const calendarProxyBootstrap = `<base href="https://www.tossinvest.com/"><script>
                (() => {
                    const proxyPath = '/api/toss_calendar_proxy';
                    const proxyPrefix = window.location.origin + proxyPath + '?url=';
                    const originalFetch = window.fetch.bind(window);
                    const traceMonthlyRequest = (transport, originalUrl, rewrittenUrl) => {
                        try {
                            if (/calendar\\/monthly/i.test(String(originalUrl)) || /calendar\\/monthly/i.test(String(rewrittenUrl))) {
                                console.info('[TossCalendarTrace] monthly request', { transport, originalUrl: String(originalUrl), rewrittenUrl: String(rewrittenUrl) });
                            }
                        } catch (_) {}
                    };
                    const rewriteUrl = (value) => {
                        let url;
                        try { url = new URL(value, window.location.href); } catch (_) { return value; }
                        // The Toss <base> can resolve our relative proxy URL to Toss itself.
                        // Always pin existing proxy requests back to the dashboard origin.
                        if (url.pathname.startsWith(proxyPath)) {
                            return window.location.origin + url.pathname + url.search + url.hash;
                        }
                        if (url.origin === window.location.origin && !url.pathname.startsWith('/api/toss_calendar_proxy')) {
                            url = new URL(url.pathname + url.search + url.hash, 'https://www.tossinvest.com');
                        }
                        if (url.protocol === 'https:' && (/(^|\\.)tossinvest\\.com$/i.test(url.hostname) || /(^|\\.)toss\\.im$/i.test(url.hostname))) {
                            return proxyPrefix + encodeURIComponent(url.href);
                        }
                        return value;
                    };
                    const rewriteCalendarChunkUrl = (value) => {
                        try {
                            const url = new URL(value, document.baseURI);
                            const isTossHost = /(^|\\.)tossinvest\\.com$/i.test(url.hostname) || /(^|\\.)toss\\.im$/i.test(url.hostname);
                            if (isTossHost && /^\\/assets\\/v2\\/_next\\/static\\/chunks\\/.+\\.js$/i.test(url.pathname)) {
                                return window.location.origin + url.pathname + url.search + url.hash;
                            }
                        } catch (_) {}
                        return value;
                    };
                    const scriptSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
                    if (scriptSrcDescriptor && scriptSrcDescriptor.configurable && typeof scriptSrcDescriptor.set === 'function') {
                        Object.defineProperty(HTMLScriptElement.prototype, 'src', {
                            ...scriptSrcDescriptor,
                            set(value) { scriptSrcDescriptor.set.call(this, rewriteCalendarChunkUrl(value)); }
                        });
                    }
                    const linkHrefDescriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');
                    if (linkHrefDescriptor && linkHrefDescriptor.configurable && typeof linkHrefDescriptor.set === 'function') {
                        Object.defineProperty(HTMLLinkElement.prototype, 'href', {
                            ...linkHrefDescriptor,
                            set(value) { linkHrefDescriptor.set.call(this, rewriteCalendarChunkUrl(value)); }
                        });
                    }
                    window.fetch = (input, init) => {
                        if (input instanceof Request) {
                            const rewritten = rewriteUrl(input.url);
                            traceMonthlyRequest('fetch', input.url, rewritten);
                            return rewritten === input.url
                                ? originalFetch(input, init)
                                : originalFetch(new Request(rewritten, new Request(input, init)));
                        }
                        const rewritten = rewriteUrl(input);
                        traceMonthlyRequest('fetch', input, rewritten);
                        return originalFetch(rewritten, init);
                    };
                    if (window.SharedWorker) {
                        const NativeSharedWorker = window.SharedWorker;
                        window.SharedWorker = new Proxy(NativeSharedWorker, {
                            construct(target, args) {
                                const workerUrl = rewriteUrl(args[0]);
                                return Reflect.construct(target, [workerUrl, ...args.slice(1)]);
                            }
                        });
                    }
                    const wrapHistoryMethod = (method) => {
                        const original = method.bind(history);
                        return (state, unused, value) => {
                            if (value != null) {
                                try {
                                    const parsed = new URL(String(value), document.baseURI);
                                    // An absolute path is still resolved against the Toss <base>.
                                    // Pin History API updates to this iframe's actual origin.
                                    value = window.location.origin + parsed.pathname + parsed.search + parsed.hash;
                                } catch (_) {}
                            }
                            return original(state, unused, value);
                        };
                    };
                    history.pushState = wrapHistoryMethod(history.pushState);
                    history.replaceState = wrapHistoryMethod(history.replaceState);
                    const originalOpen = XMLHttpRequest.prototype.open;
                    XMLHttpRequest.prototype.open = function(method, url, ...args) {
                        const rewritten = rewriteUrl(url);
                        traceMonthlyRequest('xhr', url, rewritten);
                        return originalOpen.call(this, method, rewritten, ...args);
                    };
                    // Image hosts use same-site response headers, so browsers
                    // block their direct responses inside this cross-origin embed.
                    // Relay image URLs through the dashboard origin as well.
                    const rewriteImageUrl = value => {
                        if (value == null || String(value).trim() === '') return value;
                        const rewritten = rewriteUrl(value);
                        return typeof rewritten === 'string' ? rewritten : value;
                    };
                    for (const property of ['src', 'srcset']) {
                        const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, property);
                        if (!descriptor || typeof descriptor.set !== 'function' || !descriptor.configurable) continue;
                        Object.defineProperty(HTMLImageElement.prototype, property, {
                            ...descriptor,
                            set(value) {
                                if (property === 'src') {
                                    descriptor.set.call(this, rewriteImageUrl(value));
                                    return;
                                }
                                const rewritten = String(value).split(',').map(candidate => {
                                    const [url, ...size] = candidate.trim().split(/\\s+/);
                                    return [rewriteImageUrl(url), ...size].join(' ');
                                }).join(', ');
                                descriptor.set.call(this, rewritten);
                            }
                        });
                    }
                    const originalSetAttribute = Element.prototype.setAttribute;
                    Element.prototype.setAttribute = function(name, value) {
                        const attributeName = String(name).toLowerCase();
                        if (this instanceof HTMLScriptElement && attributeName === 'src') {
                            value = rewriteCalendarChunkUrl(value);
                        } else if (this instanceof HTMLLinkElement && attributeName === 'href') {
                            value = rewriteCalendarChunkUrl(value);
                        } else if (this instanceof HTMLImageElement && attributeName === 'src') {
                            value = rewriteImageUrl(value);
                        } else if (this instanceof HTMLImageElement && attributeName === 'srcset') {
                            value = String(value).split(',').map(candidate => {
                                const [url, ...size] = candidate.trim().split(/\\s+/);
                                return [rewriteImageUrl(url), ...size].join(' ');
                            }).join(', ');
                        }
                        return originalSetAttribute.call(this, name, value);
                    };
                    // Toss registers its service worker at /service-worker.js.
                    // Since this proxied document has the dashboard origin,
                    // register a same-origin relay URL instead of the Toss URL
                    // resolved through the <base> element.
                    if (navigator.serviceWorker && navigator.serviceWorker.register) {
                        const serviceWorkerContainer = navigator.serviceWorker;
                        const originalRegister = serviceWorkerContainer.register.bind(serviceWorkerContainer);
                        const registerTossWorkerLocally = (scriptURL, options = {}) => {
                            const requestedScriptURL = String(scriptURL);
                            let requestedScope = options.scope || '(default)';
                            try {
                                const workerUrl = new URL(String(scriptURL), document.baseURI);
                                if (workerUrl.hostname === 'www.tossinvest.com' && workerUrl.pathname === '/service-worker.js') {
                                    scriptURL = window.location.origin + workerUrl.pathname + workerUrl.search;
                                }
                                const rewrittenOptions = { ...options };
                                if (rewrittenOptions.scope) {
                                    const scopeUrl = new URL(rewrittenOptions.scope, document.baseURI);
                                    if (scopeUrl.hostname === 'www.tossinvest.com') {
                                        rewrittenOptions.scope = window.location.origin + scopeUrl.pathname + scopeUrl.search;
                                    }
                                }
                                options = rewrittenOptions;
                            } catch (_) {}
                            const registration = originalRegister(scriptURL, options);
                            if (/service-worker\.js/i.test(requestedScriptURL)) {
                                console.info('[TossCalendarTrace] service worker registration requested', {
                                    requestedScriptURL,
                                    requestedScope,
                                    rewrittenScriptURL: String(scriptURL),
                                    rewrittenScope: options.scope || '(default)'
                                });
                                registration.then(
                                    result => console.info('[TossCalendarTrace] service worker registered', result.scope),
                                    error => console.error('[TossCalendarTrace] service worker registration failed', error)
                                );
                            }
                            return registration;
                        };
                        try {
                            Object.defineProperty(serviceWorkerContainer, 'register', {
                                configurable: true,
                                value: registerTossWorkerLocally
                            });
                        } catch (_) {
                            serviceWorkerContainer.register = registerTossWorkerLocally;
                        }
                    }
                })();
            </script>`;
            // Resolve Toss's relative resources on Toss, and install same-origin
            // History wrappers before the Next.js router initializes.
            html = html.replace(
                /<head([^>]*)>/i,
                `<head$1><style id="kiwoom-calendar-view-toggle-fix">[role="radiogroup"]:has(button[value="MONTH"]){position:sticky!important;right:8px!important;z-index:20!important}</style>${calendarProxyBootstrap}`
            );
            // The PWA manifest is not needed in the embedded calendar. Removing
            // it avoids a cross-origin manifest fetch under the Toss <base> URL.
            html = html.replace(/<link\b(?=[^>]*\brel=["']manifest["'])[^>]*>/gi, '');
            // Route the calendar page and its shared chunks through this host
            // so diagnostics and the same-origin API proxy apply to the code
            // that actually owns the calendar filter state.
            const forwardedProto = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
            const forwardedHost = req.get('x-forwarded-host') || req.get('host');
            const publicOrigin = forwardedProto + '://' + forwardedHost;
            html = html.replace(
                /(src=["'])(\/assets\/v2\/_next\/static\/chunks\/[^"']+\.js)(["'])/gi,
                (_match, prefix, chunkPath, suffix) => prefix + publicOrigin + chunkPath + suffix
            );
        }
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.send(html);
    } catch (error) {
        console.error("❌ 토스 캘린더 프록시 에러:", error.message);
        res.status(500).send(`캘린더 로드 실패: ${error.message}`);
    }
});

// Relay Toss's root-scoped Service Worker from this origin so the proxied
// calendar can register it without violating the browser's same-origin rule.
app.get('/service-worker.js', async (req, res) => {
    try {
        const response = await axios.get('https://www.tossinvest.com/service-worker.js', {
            headers: {
                'User-Agent': req.get('user-agent') || 'Mozilla/5.0',
                'Accept': req.get('accept') || '*/*',
                'Accept-Language': req.get('accept-language') || 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.tossinvest.com/calendar'
            },
            responseType: 'arraybuffer',
            timeout: 15000,
            maxContentLength: 5 * 1024 * 1024,
            validateStatus: () => true
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'application/javascript; charset=utf-8');
        res.setHeader('Service-Worker-Allowed', '/');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.status(response.status).send(response.data);
    } catch (error) {
        console.error('[TossCalendar] service worker proxy error:', error.code || error.message);
        res.status(502).send('토스 캘린더 서비스 워커를 가져오지 못했습니다.');
    }
});

// 캘린더 앱의 비동기 API 요청을 같은 출처에서 전달한다. 대상 호스트를
// Toss 도메인으로 제한해 임의 URL 프록시로 사용되지 않도록 한다.
app.all('/api/toss_calendar_proxy', async (req, res) => {
    const session = getSessionFromRequest(req);
    if (!session) return res.status(401).json({ success: false, error: '로그인이 필요합니다.' });
    let targetUrl;
    try {
        targetUrl = new URL(req.query.url || '');
        const isTossHost = /(^|\.)tossinvest\.com$/i.test(targetUrl.hostname) || /(^|\.)toss\.im$/i.test(targetUrl.hostname);
        if (targetUrl.protocol !== 'https:' || !isTossHost) {
            return res.status(400).send('허용되지 않은 토스 캘린더 프록시 주소입니다.');
        }

        const forwardedHeaders = Object.fromEntries(
            Object.entries(req.headers).filter(([name]) => name.startsWith('x-') && name !== 'x-forwarded-for' && name !== 'x-forwarded-host' && name !== 'x-forwarded-proto')
        );
        const headers = {
            ...forwardedHeaders,
            'User-Agent': req.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': req.get('accept') || '*/*',
            'Accept-Language': req.get('accept-language') || 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
            'Origin': 'https://www.tossinvest.com',
            'Referer': 'https://www.tossinvest.com/calendar'
        };
        if (req.get('content-type')) headers['Content-Type'] = req.get('content-type');

        const response = await axios({
            url: targetUrl.href,
            method: req.method,
            headers,
            data: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
            responseType: 'arraybuffer',
            timeout: 15000,
            maxRedirects: 0,
            maxContentLength: 20 * 1024 * 1024,
            validateStatus: () => true
        });

        const contentType = response.headers['content-type'] || '';
        res.setHeader('X-Toss-Proxy-Status', String(response.status));
        res.setHeader('X-Toss-Proxy-Content-Type', contentType);
        console.log('[TossCalendar] ' + req.method + ' ' + targetUrl.hostname + targetUrl.pathname + ' -> ' + response.status + ' (' + (contentType || 'content-type 없음') + ')');
        if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
        if (response.headers['cache-control']) res.setHeader('Cache-Control', response.headers['cache-control']);
        if (response.headers['location']) res.setHeader('Location', response.headers['location']);
        res.status(response.status).send(response.data);
    } catch (error) {
        const reason = error.response?.status || error.code || error.message;
        console.error('[TossCalendar] proxy error:', targetUrl ? targetUrl.hostname + targetUrl.pathname : 'URL parsing failed', reason);
        res.setHeader('X-Toss-Proxy-Error', String(reason).replace(/[^a-zA-Z0-9_.:-]/g, ' ').slice(0, 160));
        res.status(502).send('토스 캘린더 데이터를 가져오지 못했습니다.');
    }
});

// Toss's SharedWorker imports sibling webpack chunks by absolute /assets path.
// The worker runs under the dashboard origin, so relay only those JS chunks here.
app.get('/assets/v2/_next/static/chunks/*', async (req, res) => {
    try {
        const targetUrl = new URL(req.originalUrl, 'https://www.tossinvest.com');
        if (!/^\/assets\/v2\/_next\/static\/chunks\/[a-z0-9._%/-]+\.js$/i.test(targetUrl.pathname)) {
            return res.status(404).send('Toss calendar asset not found.');
        }

        const response = await axios.get(targetUrl.href, {
            headers: {
                'User-Agent': req.get('user-agent') || 'Mozilla/5.0',
                'Accept': req.get('accept') || '*/*',
                'Accept-Language': req.get('accept-language') || 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Referer': 'https://www.tossinvest.com/calendar'
            },
            responseType: 'arraybuffer',
            timeout: 15000,
            maxContentLength: 10 * 1024 * 1024,
            validateStatus: () => true
        });

        let responseBody = response.data;
        const isCalendarPageChunk = /\/pages\/calendar-[^/]+\.js$/i.test(targetUrl.pathname);
        const isCalendarAppChunk = /\/pages\/_app-[^/]+\.js$/i.test(targetUrl.pathname);
        let isCalendarStateChunk = /\/9410-[^/]+\.js$/i.test(targetUrl.pathname);
        if (response.status === 200) {
            let script = Buffer.from(response.data).toString('utf8');
            const countryReducerMarker = 'case"SET_COUNTRY":return{...e,country:t.payload};case"SET_VIEW_TYPE"';
            const hasCalendarCountryReducer = script.includes(countryReducerMarker);
            if (hasCalendarCountryReducer) isCalendarStateChunk = true;
            if (isCalendarStateChunk || hasCalendarCountryReducer) {
                const countryReducerTrace = 'case"SET_COUNTRY":return(console.info("[TossCalendarTrace] SET_COUNTRY reducer",{previous:e.country,next:t.payload}),{...e,country:t.payload});case"SET_VIEW_TYPE"';
                const countrySetterMarker = 'o=(0,r.p)(e=>{t({type:"SET_COUNTRY",payload:e})})';
                const countrySetterTrace = 'o=(0,r.p)(e=>{console.info("[TossCalendarTrace] setCountry action",{value:e});t({type:"SET_COUNTRY",payload:e})})';
                const countryHookReturnMarker = 'return{category:e.category,country:e.country,viewType:e.viewType,stockCategory:e.stockCategory,setCategory:n,setCountry:o,setViewType:l,setStockCategory:c,resetFilters:u}';
                const countryHookReturnTrace = 'return((window.__tossCalendarCountryTrace!==e.country)&&(window.__tossCalendarCountryTrace=e.country,console.info("[TossCalendarTrace] country hook state",{country:e.country})),{category:e.category,country:e.country,viewType:e.viewType,stockCategory:e.stockCategory,setCategory:n,setCountry:o,setViewType:l,setStockCategory:c,resetFilters:u})';
                if (hasCalendarCountryReducer) {
                    script = script.replace(countryReducerMarker, countryReducerTrace);
                } else {
                    console.warn('[TossCalendarTrace] SET_COUNTRY reducer marker not found; Toss may have changed its bundle');
                }
                if (script.includes(countrySetterMarker)) {
                    script = script.replace(countrySetterMarker, countrySetterTrace);
                } else {
                    console.warn('[TossCalendarTrace] setCountry action marker not found; Toss may have changed its bundle');
                }
                if (script.includes(countryHookReturnMarker)) {
                    script = script.replace(countryHookReturnMarker, countryHookReturnTrace);
                } else {
                    console.warn('[TossCalendarTrace] country hook return marker not found; Toss may have changed its bundle');
                }
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                responseBody = script;
            }
            if (isCalendarPageChunk) {
            const hookMarker = 'ei=()=>{let{category';
            const queryMarker = 'queryFn:()=>X.FH.post(`${J.Q.CERT}${er(t,n)}`),refetchOnWindowFocus';
            const queryStatusMarker = 'i=(0,j.E)({queries:r}),s=i.map(e=>e.data);';
            const aiSummaryQueryMarker = 'queryFn:()=>X.FH.get(`${J.Q.CERT}${nD}`),...nk.us});nw.getKey';
            const countryFilterMarker = 'onValueChange:e=>{r(e),requestAnimationFrame(()=>{d(s)})},children:Object.entries(Q.TP)';
            if (script.includes(hookMarker) && script.includes(queryMarker) && script.includes(queryStatusMarker)) {
                script = script
                    .replace(hookMarker, 'ei=()=>{console.info("[TossCalendarTrace] monthly hook invoked");let{category')
                    .replace(
                        queryMarker,
                        'queryFn:()=>{const targetUrl=`${J.Q.CERT}${er(t,n)}`;const proxyUrl=`${window.location.origin}/api/toss_calendar_proxy?url=${encodeURIComponent(targetUrl)}`;console.info("[TossCalendarTrace] monthly proxy request",{year:t,month:n,targetUrl});let status;const request=window.fetch(proxyUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(async response=>{status=response.status;if(!response.ok)throw new Error(`Calendar proxy HTTP ${response.status}`);const payload=await response.json();return payload?.result??payload});request.then(result=>console.info("[TossCalendarTrace] monthly proxy resolved",{year:t,month:n,status,eventCount:result?.events?.length}),error=>console.error("[TossCalendarTrace] monthly proxy rejected",{year:t,month:n,message:error?.message}));return request},refetchOnWindowFocus'
                    )
                    .replace(
                        queryStatusMarker,
                        'i=(0,j.E)({queries:r}),s=(console.info("[TossCalendarTrace] monthly query states",i.map(query=>({status:query.status,fetchStatus:query.fetchStatus,error:query.error?.message}))),i.map(e=>e.data));'
                    )
                    .replace(
                        countryFilterMarker,
                        'onValueChange:e=>{const clickId=window.__tossCalendarClickId=(window.__tossCalendarClickId||0)+1;window.__tossCalendarPendingCountryClick={id:clickId,value:e};setTimeout(()=>{if(window.__tossCalendarPendingCountryClick?.id===clickId)window.__tossCalendarPendingCountryClick=null},1000);const getCountrySelection=()=>[...document.querySelectorAll(\'button[role="radio"][value="all"],button[role="radio"][value="kr"],button[role="radio"][value="us"]\')].filter(button=>button.getAttribute("aria-checked")==="true").map(button=>button.value);console.info("[TossCalendarTrace] country click",{clickId,value:e});try{r(e)}catch(error){console.error("[TossCalendarTrace] country click callback threw",{clickId,value:e,message:error?.message});throw error}requestAnimationFrame(()=>{console.info("[TossCalendarTrace] country click next frame",{clickId,value:e,selected:getCountrySelection()});d(s)});setTimeout(()=>console.info("[TossCalendarTrace] country click after 350ms",{clickId,value:e,selected:getCountrySelection()}),350)},children:Object.entries(Q.TP)'
                    )
                    .replace(
                        'size:"small",value:t,onValueChange:e=>{const getCountrySelection',
                        'size:"small",value:(window.__tossCalendarRadioTrace!==t&&(window.__tossCalendarRadioTrace=t,console.info("[TossCalendarTrace] country radio render",{value:t})),t),onValueChange:e=>{const getCountrySelection'
                    );
                if (!script.includes('[TossCalendarTrace] country click')) {
                    console.warn('[TossCalendarTrace] country filter marker not found; Toss may have changed its bundle');
                }
                if (script.includes(aiSummaryQueryMarker)) {
                    script = script.replace(
                        aiSummaryQueryMarker,
                        'queryFn:()=>{const targetUrl=`${J.Q.CERT}${nD}`;const proxyUrl=`${window.location.origin}/api/toss_calendar_proxy?url=${encodeURIComponent(targetUrl)}`;console.info("[TossCalendarTrace] weekly AI summary request",{targetUrl});let status;const request=window.fetch(proxyUrl).then(async response=>{status=response.status;if(!response.ok)throw new Error(`Calendar proxy HTTP ${response.status}`);const payload=await response.json();return payload?.result??payload});request.then(data=>console.info("[TossCalendarTrace] weekly AI summary resolved",{status,title:data?.title}),error=>console.error("[TossCalendarTrace] weekly AI summary rejected",{status,message:error?.message}));return request},...nk.us});nw.getKey'
                    );
                } else {
                    console.warn('[TossCalendarTrace] AI summary query marker not found; Toss may have changed its bundle');
                }
                responseBody = script;
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        } else {
                console.warn('[TossCalendarTrace] calendar bundle markers not found; Toss may have changed its bundle');
            }
            }
            if (isCalendarAppChunk) {
                const segmentedControlCommitMarker = 'return(0,u.jsx)(y,{value:{value:C,size:c,fit:f},children:';
                const segmentedControlCommitTrace = '(window.__tossCalendarPendingCountryClick&&window.__tossCalendarPendingCountryClick.value===d&&!window.__tossCalendarPendingCountryClick.controlRendered&&(window.__tossCalendarPendingCountryClick.controlRendered=true,console.info("[TossCalendarTrace] country click control render",{...window.__tossCalendarPendingCountryClick,prop:d,value:C})),(0,l.useEffect)(()=>{if("kr"===d||"kr"===C){const radios=[...document.querySelectorAll(\'button[role="radio"][value="kr"]\')].map(b=>({checked:b.getAttribute("aria-checked"),selected:b.getAttribute("data-seg-selected")}));console.info("[TossCalendarTrace] segmented control commit",{prop:d,value:C,radios})}},[d,C]));return(0,u.jsx)(y,{value:{value:C,size:c,fit:f},children:';
                if (script.includes(segmentedControlCommitMarker)) {
                    script = script.replace(segmentedControlCommitMarker, segmentedControlCommitTrace);
                    const segmentedItemMarker = 'return(0,u.jsx)(h.root,{ref:t,...c({value:d,disabled:a,className:x({fit:y,size:m}),...{[f]:d===p?"true":void 0}}),children:';
                    const segmentedItemTrace = '(window.__tossCalendarPendingCountryClick&&window.__tossCalendarPendingCountryClick.value===p&&d===p&&!window.__tossCalendarPendingCountryClick.itemRendered&&(window.__tossCalendarPendingCountryClick.itemRendered=true,console.info("[TossCalendarTrace] country click item render",{...window.__tossCalendarPendingCountryClick,item:d,groupValue:p,selected:d===p})));return(0,u.jsx)(h.root,{ref:t,...c({value:d,disabled:a,className:x({fit:y,size:m}),...{[f]:d===p?"true":void 0}}),children:';
                    if (script.includes(segmentedItemMarker)) {
                        script = script.replace(segmentedItemMarker, segmentedItemTrace);
                    } else {
                        console.warn('[TossCalendarTrace] segmented control item marker not found; Toss may have changed its bundle');
                    }
                    responseBody = script;
                    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                } else {
                    console.warn('[TossCalendarTrace] segmented control commit marker not found; Toss may have changed its bundle');
                }
            }
        }

        if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
        if (!isCalendarPageChunk && !isCalendarStateChunk && !isCalendarAppChunk && response.headers['cache-control']) res.setHeader('Cache-Control', response.headers['cache-control']);
        res.status(response.status).send(responseBody);
    } catch (error) {
        console.error('[TossCalendar] worker chunk proxy error:', error.code || error.message);
        res.status(502).send('토스 캘린더 워커 스크립트를 가져오지 못했습니다.');
    }
});

/**
 * ADR 데이터 프록시 API (CORS 방지용)
 */
app.get('/api/adr', async (req, res) => {
    console.log("🚀 [API START] /api/adr 요청 발생 (Cache-Busting 적용)");
    try {
        const timestamp = Date.now();
        const response = await axios.get(`http://adrinfo.kr/chart?t=${timestamp}`, {
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        console.log("✅ ADR 데이터 획득 성공 (길이:", response.data.length, ")");
        res.send(response.data);
    } catch (error) {
        console.error("❌ ADR 프록시 에러:", error.message);
        res.status(500).json({ error: "ADR 데이터를 가져오는데 실패했습니다.", details: error.message });
    }
});

function readAuthorizedEmails() {
    try {
        const parsed = JSON.parse(fs.readFileSync(AUTHORIZED_EMAILS_FILE, 'utf8'));
        if (Array.isArray(parsed)) return parsed.map(email => String(email).trim().toLowerCase()).filter(Boolean);
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('[Auth] Could not read authorized email list:', error.message);
    }
    return [];
}

function writeAuthorizedEmails(emails) {
    const uniqueEmails = [...new Set(emails.map(email => String(email).trim().toLowerCase()).filter(Boolean))];
    const tempFile = `${AUTHORIZED_EMAILS_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(uniqueEmails, null, 2), 'utf8');
    fs.renameSync(tempFile, AUTHORIZED_EMAILS_FILE);
}

function getSessionFromRequest(req) {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith('azikanbal_session='));
    if (!sessionCookie) return null;
    const sessionId = decodeURIComponent(sessionCookie.slice('azikanbal_session='.length));
    const session = authSessions.get(sessionId);
    if (!session) return null;
    if (Date.now() >= session.expiresAt) {
        authSessions.delete(sessionId);
        return null;
    }
    if (session.email !== AUTH_ADMIN_EMAIL && !readAuthorizedEmails().includes(session.email)) {
        authSessions.delete(sessionId);
        return null;
    }
    return { ...session, isAdmin: Boolean(AUTH_ADMIN_EMAIL && session.email === AUTH_ADMIN_EMAIL) };
}

function setAuthCookie(req, res, sessionId) {
    const secure = req.secure || req.get('x-forwarded-proto') === 'https';
    res.setHeader('Set-Cookie', `azikanbal_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(AUTH_SESSION_TTL_MS / 1000)}${secure ? '; Secure' : ''}`);
}

app.post('/api/auth/login', async (req, res) => {
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || !credential) {
        return res.status(400).json({ success: false, error: 'Google 로그인 자격 증명이 필요합니다.' });
    }
    try {
        const tokenResponse = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
            params: { id_token: credential },
            timeout: 8000
        });
        const claims = tokenResponse.data;
        const email = String(claims.email || '').trim().toLowerCase();
        const verified = claims.email_verified === true || claims.email_verified === 'true';
        const expiresAt = Number(claims.exp) * 1000;
        if (claims.aud !== GOOGLE_OAUTH_CLIENT_ID || !email || !verified || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
            return res.status(401).json({ success: false, error: 'Google 계정 인증을 확인할 수 없습니다.' });
        }
        const isAdmin = email === AUTH_ADMIN_EMAIL;
        if (!isAdmin && !readAuthorizedEmails().includes(email)) {
            return res.status(403).json({ success: false, error: '이 Google 이메일은 서비스 로그인 허용 목록에 없습니다.' });
        }
        const sessionId = crypto.randomBytes(32).toString('base64url');
        const session = { email, name: String(claims.name || ''), picture: String(claims.picture || ''), expiresAt: Date.now() + AUTH_SESSION_TTL_MS };
        authSessions.set(sessionId, session);
        setAuthCookie(req, res, sessionId);
        res.set('Cache-Control', 'no-store');
        return res.json({ success: true, user: { email, name: session.name, picture: session.picture, isAdmin } });
    } catch (error) {
        console.error('[Auth] Google ID token verification failed:', error.response?.data || error.message);
        return res.status(401).json({ success: false, error: 'Google 계정 확인에 실패했습니다. 다시 로그인해 주세요.' });
    }
});

app.get('/api/auth/session', (req, res) => {
    const session = getSessionFromRequest(req);
    if (!session) return res.status(401).json({ authenticated: false });
    res.set('Cache-Control', 'no-store');
    res.json({
        authenticated: true,
        user: { email: session.email, name: session.name, picture: session.picture, isAdmin: session.isAdmin }
    });
});

app.post('/api/auth/logout', (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith('azikanbal_session='));
    if (sessionCookie) authSessions.delete(decodeURIComponent(sessionCookie.slice('azikanbal_session='.length)));
    res.setHeader('Set-Cookie', 'azikanbal_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ success: true });
});

function requireAdmin(req, res, next) {
    if (!req.authUser?.isAdmin) return res.status(403).json({ success: false, error: '허용 이메일 관리 권한이 없습니다.' });
    next();
}

app.get('/api/auth/users', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, emails: [...new Set([AUTH_ADMIN_EMAIL, ...readAuthorizedEmails()])].filter(Boolean) });
});

app.post('/api/auth/users', requireAdmin, (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ success: false, error: '유효한 이메일 주소를 입력해 주세요.' });
    }
    if (email === AUTH_ADMIN_EMAIL || readAuthorizedEmails().includes(email)) {
        return res.status(409).json({ success: false, error: '이미 등록된 이메일입니다.' });
    }
    writeAuthorizedEmails([...readAuthorizedEmails(), email]);
    res.json({ success: true, emails: [...new Set([AUTH_ADMIN_EMAIL, ...readAuthorizedEmails()])].filter(Boolean) });
});

app.delete('/api/auth/users/:email', requireAdmin, (req, res) => {
    const email = decodeURIComponent(req.params.email).trim().toLowerCase();
    if (email === AUTH_ADMIN_EMAIL) return res.status(400).json({ success: false, error: '초기 관리자 계정은 이 화면에서 삭제할 수 없습니다.' });
    const emails = readAuthorizedEmails();
    if (!emails.includes(email)) return res.status(404).json({ success: false, error: '등록된 이메일을 찾을 수 없습니다.' });
    writeAuthorizedEmails(emails.filter(item => item !== email));
    for (const [sessionId, session] of authSessions) {
        if (session.email === email) authSessions.delete(sessionId);
    }
    res.json({ success: true, emails: [...new Set([AUTH_ADMIN_EMAIL, ...readAuthorizedEmails()])].filter(Boolean) });
});


/**
 * Finviz 이미지 프록시 API (CORS 방지용)
 */
app.get('/api/finviz-image', async (req, res) => {
    console.log("🚀 [API START] /api/finviz-image 요청 발생");
    try {
        const imageUrl = req.query.url;
        if (!imageUrl) {
            return res.status(400).json({ error: "URL 파라미터가 필요합니다." });
        }

        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://finviz.com/'
            }
        });

        // 이미지 타입 설정
        const contentType = response.headers['content-type'] || 'image/png';
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=300'); // 5분 캐시
        res.send(response.data);

        console.log("✅ Finviz 이미지 획득 성공");
    } catch (error) {
        console.error("❌ Finviz 이미지 프록시 에러:", error.message);
        res.status(500).json({ error: "이미지를 가져오는데 실패했습니다.", details: error.message });
    }
});

/**
 * TradingEconomics API 프록시 (CORS 방지용)
 * 환율, 금리 등 경제 지표 데이터 제공
 */
let activeBrowsers = 0; // 동시에 실행 중인 브라우저 수
const MAX_BROWSERS = 1; // 1GB Oracle Cloud에서는 Chrome 1개만 허용

// v30.9.11: Memory Cache for TradingEconomics
const teCache = {};
// 1시간 타이머 제거: 사용자가 수동 새로고침하기 전까지 영구 캐시 유지 (서버 재시작 전까지)

app.get('/api/trading-economics', async (req, res) => {
    let originalUrl = req.query.url;
    const duration = req.query.duration || ''; // e.g., '10년'
    const forceRefresh = req.query.force_refresh === 'true' || req.query.force_refresh === '1'; // 강제 새로고침 플래그
    if (!originalUrl) return res.status(400).json({ error: "URL 파라미터가 필요합니다." });

    originalUrl = originalUrl.replace(/([^:]\/)\/+/g, '$1');
    console.log(`📡 [TE Proxy] Request: ${originalUrl}, Duration: ${duration || 'default'}, Force: ${forceRefresh}`);

    const cacheKey = `${originalUrl}_${duration}`;
    const cached = teCache[cacheKey];

    // 강제 새로고침이 아닐 때만 캐시를 반환 (시간 제한 없음)
    if (!forceRefresh && cached) {
        console.log(`   🧊 [TE] Serving from Cache: ${originalUrl}`);
        return res.json({ success: true, data: cached.data });
    }

    try {
        const targetUrl = originalUrl;
        if (targetUrl.includes('tradingeconomics.com') && !targetUrl.includes('api.tradingeconomics.com')) {
            console.log(`   -> Scraping Mode (v28): ${originalUrl}`);

            let browser = null;
            let browserSlotTaken = false;
            try {
                // Semaphore for active browsers
                // 대기 한도(45초)를 넘으면 Chrome을 추가로 띄우지 않고 실패 처리 (nginx 60초 제한보다 짧게)
                let waitCount = 0;
                while (activeBrowsers >= MAX_BROWSERS && waitCount < 45) {
                    await new Promise(r => setTimeout(r, 1000));
                    waitCount++;
                }
                if (activeBrowsers >= MAX_BROWSERS) {
                    throw new Error('브라우저 사용량이 많아 잠시 후 다시 시도해 주세요.');
                }
                activeBrowsers++;
                browserSlotTaken = true;

                browser = await puppeteer.launch({
                    headless: "new",
                    timeout: 60000,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-blink-features=AutomationControlled',
                        '--window-size=1920,1080'
                    ]
                });

                const page = await browser.newPage();
                page.setDefaultTimeout(60000); // v30.9.10: Set explicit 60s timeout for Puppeteer
                await page.setViewport({ width: 1920, height: 1080 });

                // Stealth
                await page.evaluateOnNewDocument(() => {
                    Object.defineProperty(navigator, 'webdriver', { get: () => false });
                });

                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

                // 0. Block Ads and Analytics for stability
                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    const url = request.url();
                    if (url.includes('google-analytics') || url.includes('googletagmanager') || url.includes('doubleclick') || url.includes('ads') || url.includes('tracker')) {
                        request.abort();
                    } else {
                        request.continue();
                    }
                });

                // 1. Initial Load (Use 'commit' for speed and resilience to frame detachment)
                let retryCount = 0;
                while (retryCount < 2) {
                    try {
                        console.log(`   🌐 Navigating... (Attempt ${retryCount + 1})`);
                        await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }); // v30.9.12: Increased to 60s
                        break;
                    } catch (e) {
                        retryCount++;
                        if (retryCount >= 2) throw e;
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }

                // 2. Wait for chart container
                await page.waitForSelector('.highcharts-container', { timeout: 30000 });
                await new Promise(r => setTimeout(r, 1000)); // v30.9.15: Reduced from 2s

                const extractPoints = () => {
                    const map = new Map();
                    if (!window.Highcharts || !window.Highcharts.charts || window.Highcharts.charts.length === 0) return null;
                    const tomorrow = Date.now() + 3600000;

                    // v30.22: Target only the primary chart to avoid collision with related/crosses charts
                    // Usually the main chart is in #chart, .chart, or .iChart-container
                    let primaryChart = null;
                    
                    // Try to guess the ticker from the URL or page meta/title for more accurate targeting
                    const url = window.location.href;
                    let ticker = "";
                    if (url.includes("2-year-note-yield")) ticker = "gjgb2y";
                    else if (url.includes("government-bond-yield")) ticker = "gjgb10";
                    
                    const mainContainers = document.querySelectorAll('#chart, .chart, .iChart-container, .table-unit');
                    
                    if (mainContainers.length > 0) {
                        for (const container of mainContainers) {
                            // Check if this container has a chart
                            const chart = window.Highcharts.charts.find(c => c && c.renderTo && container.contains(c.renderTo));
                            if (chart) {
                                // If we have a ticker, check if any series name contains it (TE often uses stickers in hidden fields or names)
                                if (ticker) {
                                    const hasTicker = chart.series.some(s => 
                                        (s.name && s.name.toLowerCase().includes(ticker)) || 
                                        (chart.renderTo && chart.renderTo.className && chart.renderTo.className.includes(ticker))
                                    );
                                    if (hasTicker) {
                                        primaryChart = chart;
                                        break;
                                    }
                                }
                                if (!primaryChart) primaryChart = chart; 
                                // Don't break yet if we are looking for a ticker match
                                if (!ticker) break;
                            }
                        }
                    }

                    // Fallback: pick the chart with most series/points if no container match
                    if (!primaryChart) {
                        primaryChart = window.Highcharts.charts.reduce((prev, curr) => {
                            const prevPoints = prev ? (prev.series ? prev.series.reduce((s, ser) => s + (ser.data ? ser.data.length : 0), 0) : 0) : 0;
                            const currPoints = curr ? (curr.series ? curr.series.reduce((s, ser) => s + (ser.data ? ser.data.length : 0), 0) : 0) : 0;
                            return (currPoints > prevPoints) ? curr : prev;
                        }, window.Highcharts.charts[0]);
                    }

                    if (!primaryChart || !primaryChart.series) return null;

                    primaryChart.series.forEach(series => {
                        const isProjection = (series.name && series.name.toLowerCase().includes('projection')) ||
                            (series.options.dashStyle && series.options.dashStyle !== 'Solid');

                        if (isProjection) return;
                        if (!series.data) return;

                        series.data.forEach(p => {
                            let x, y;
                            if (Array.isArray(p)) { x = p[0]; y = p[1]; }
                            else if (p && typeof p === 'object') { x = p.x; y = p.y; }

                            if (x !== undefined && y !== null && y !== undefined) {
                                if (x > tomorrow) return;
                                map.set(x, y);
                            }
                        });
                    });

                    return Array.from(map.entries()).map(([x, y]) => ({ x, y }));
                };

                // Add Step: Capture "Live" point from the page DOM (often more fresh than Highcharts)
                const extractLivePoint = () => {
                    try {
                        // v30.22: Target only the main price element, avoiding "Related" or "Crosses" tables
                        // Typically, the main price is in the header or has a specific ticker-based class
                        const url = window.location.href;
                        let ticker = "";
                        if (url.includes("2-year-note-yield")) ticker = "gjgb2y";
                        else if (url.includes("government-bond-yield")) ticker = "gjgb10";

                        if (ticker) {
                            // High priority: ticker-specific label in legend area
                            const tickerLabel = document.querySelector(`div.${ticker}\\:ind span.closeLabel, #Label-${ticker}`);
                            if (tickerLabel) {
                                const val = parseFloat(tickerLabel.textContent.replace(/,/g, ''));
                                if (!isNaN(val)) return { x: Date.now(), y: val };
                            }
                        }

                        // Medium priority: main header elements
                        const priceEl = document.querySelector('.table-unit .actual, .header-pricing #p, #last_value, .i-price-value');
                        if (priceEl) {
                            const val = parseFloat(priceEl.textContent.replace(/,/g, ''));
                            if (!isNaN(val)) return { x: Date.now(), y: val };
                        }
                    } catch (e) { }
                    return null;
                };

                let masterMap = new Map();

                // 2.5 Scroll to make sure the chart is initialized
                await page.evaluate(() => {
                    const chart = document.querySelector('#chart, .iChart-container');
                    if (chart) chart.scrollIntoView();
                });
                await new Promise(r => setTimeout(r, 2000));

                const robustClick = async (t) => {
                    return await page.evaluate((text) => {
                        const buttons = Array.from(document.querySelectorAll('button, a, span, div'))
                            .filter(el => {
                                const tr = el.textContent.trim();
                                return tr === text || tr === text.replace('Y', ' Y') || tr === text.replace('Y', ' Year');
                            });
                        if (buttons.length > 0) {
                            buttons[0].click();
                            return true;
                        }
                        return false;
                    }, t);
                };

                // 3. Stage 1: Historical Duration (e.g. 5Y, 10Y)
                if (duration && !duration.includes('1년')) {
                    let targetBtn = '5Y';
                    const yMatch = duration.match(/(\d+)\s*년/);
                    if (yMatch) {
                        const count = parseInt(yMatch[1]);
                        if (count >= 10) targetBtn = '10Y';
                        else if (count >= 5) targetBtn = '5Y';
                    } else if (duration.toLowerCase().includes('max') || duration.toLowerCase().includes('전체')) {
                        targetBtn = 'MAX';
                    }

                    console.log(`   🎯 Stage 1: History (${targetBtn})...`);
                    const clicked = await robustClick(targetBtn);
                    if (clicked) {
                        await new Promise(r => setTimeout(r, 7000)); // v30.9.15: Reduced from 8s
                        const history = await page.evaluate(extractPoints);
                        if (history && history.length > 0) {
                            console.log(`   📊 Captured ${history.length} points (History Stage)`);
                            history.forEach(p => masterMap.set(p.x, p.y));
                        }
                    }
                }

                // 4. Stage 2: Daily (1Y) Resolution
                console.log('   📡 Stage 2: Daily (1Y) Resolution...');
                const clicked1Y = await robustClick('1Y');
                if (clicked1Y) {
                    await page.evaluate(() => {
                        if (window.Highcharts && window.Highcharts.charts) {
                            window.Highcharts.charts.forEach(c => {
                                if (c.series) c.series.forEach(s => s.update({ dataGrouping: { enabled: false } }, false));
                                c.redraw();
                            });
                        }
                    });
                    await new Promise(r => setTimeout(r, 4000)); // v30.9.15: Reduced from 6s
                    const daily = await page.evaluate(extractPoints);
                    if (daily && daily.length > 0) {
                        console.log(`   📊 Captured ${daily.length} points (Daily Stage)`);
                        daily.forEach(p => masterMap.set(p.x, p.y));
                    }
                }

                // 5. Stage 3: Live Point (Freshest)
                const live = await page.evaluate(extractLivePoint);
                if (live) {
                    masterMap.set(live.x, live.y);
                }

                if (masterMap.size === 0) throw new Error('데이터 획득 실패');

                const finalData = Array.from(masterMap.entries())
                    .sort((a, b) => a[0] - b[0])
                    .map(([x, y]) => ({ DateTime: new Date(x).toISOString(), Value: y }));

                console.log(`   ✅ Success: Merged total ${masterMap.size} points.`);

                // v30.9.11: Store in cache
                teCache[cacheKey] = {
                    timestamp: Date.now(),
                    data: finalData
                };

                res.set('Cache-Control', 'public, max-age=300');
                return res.json({ success: true, data: finalData });

            } catch (e) {
                console.error(`   ❌ Scraping error: ${e.message}`);
                fs.appendFileSync(path.join(LOG_DIR, 'puppeteer_debug.log'), `   ❌ ${e.message}\n`);
                throw e;
            } finally {
                if (browser) {
                    await Promise.race([
                        browser.close().catch(() => { }),
                        new Promise(r => setTimeout(r, 10000))
                    ]);
                    try { browser.process()?.kill('SIGKILL'); } catch (e) { /* 이미 종료됨 */ }
                }
                if (browserSlotTaken) activeBrowsers = Math.max(0, activeBrowsers - 1);
            }
        }

        // --- Fallback (API Mode) ---
        const response = await axios.get(originalUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Referer': 'https://tradingeconomics.com/'
            }
        });

        let data = response.data; // v30.9.11: RESTORED definition
        if (typeof data === 'string') {
            try { data = JSON.parse(data.trim()); } catch (e) { }
        }

        // v30.9.11: Save to Cache
        if (Array.isArray(data) && data.length > 0) {
            teCache[cacheKey] = {
                timestamp: Date.now(),
                data: data
            };
            console.log(`[TE] ✅ Cache Updated: ${originalUrl}`);
        }

        res.set('Cache-Control', 'public, max-age=300');
        res.json({ success: true, data: data });

    } catch (error) {
        console.error(`   ❌ TE Proxy Error: ${error.message}`);
        res.status(500).json({ success: false, error: "데이터 획득 실패", details: error.message });
    }
});

/**
 * FRED disk cache: first request each month fetches the requested full period.
 * Other requests fetch from 30 days before the latest cached observation and
 * merge by date, allowing recent revisions to replace prior values.
 */
const FRED_CACHE_DIR = path.join(__dirname, 'data', 'fred-cache');
const FRED_CACHE_FILE = path.join(FRED_CACHE_DIR, 'cache.json');
const FRED_CACHE_UNUSED_DAYS = 365;
const FRED_OVERLAP_DAYS = 30;
const fredInFlight = new Map();
let fredCache = {};

function loadFredCache() {
    try {
        if (!fs.existsSync(FRED_CACHE_FILE)) return {};
        const saved = JSON.parse(fs.readFileSync(FRED_CACHE_FILE, 'utf8'));
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
        return saved;
    } catch (error) {
        console.error('[FRED] Cache file could not be loaded: ' + error.message);
        return {};
    }
}

function persistFredCache() {
    fs.mkdirSync(FRED_CACHE_DIR, { recursive: true });
    writeJsonAtomically(FRED_CACHE_FILE, fredCache);
}

function fredPeriodStartDate(period, endDate = new Date()) {
    const daysByPeriod = { '10y': 3650, '5y': 1825, '2y': 730, '1y': 365, '6m': 180 };
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - (daysByPeriod[period] || 365));
    return startDate.toISOString().slice(0, 10);
}

function dateDaysBefore(isoDate, days) {
    const date = new Date(isoDate + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
}

fredCache = loadFredCache();
function purgeUnusedFredCacheEntries(now = new Date()) {
    const cutoff = now.getTime() - FRED_CACHE_UNUSED_DAYS * 24 * 60 * 60 * 1000;
    const seriesLastUsedAt = new Map();
    const seriesForKey = key => {
        const entry = fredCache[key];
        return entry && entry.seriesId ? entry.seriesId : key.replace(/_(10y|5y|2y|1y|6m)$/, '');
    };
    for (const [key, entry] of Object.entries(fredCache)) {
        const seriesId = seriesForKey(key);
        const lastUsedAt = Date.parse(entry && entry.lastUsedAt);
        const previous = seriesLastUsedAt.get(seriesId) || 0;
        if (Number.isFinite(lastUsedAt) && lastUsedAt > previous) seriesLastUsedAt.set(seriesId, lastUsedAt);
        else if (!seriesLastUsedAt.has(seriesId)) seriesLastUsedAt.set(seriesId, 0);
    }

    let removed = 0;
    for (const [key, entry] of Object.entries(fredCache)) {
        if ((seriesLastUsedAt.get(seriesForKey(key)) || 0) < cutoff) {
            delete fredCache[key];
            removed++;
        }
    }
    if (removed) {
        try { persistFredCache(); }
        catch (error) { fileLog('[FRED] Could not persist inactive-cache cleanup: ' + error.message); }
        console.log('[FRED] Removed ' + removed + ' series cache entries unused for one year');
    }
}
purgeUnusedFredCacheEntries();
const fredCacheCleanupTimer = setInterval(() => purgeUnusedFredCacheEntries(), 24 * 60 * 60 * 1000);
if (typeof fredCacheCleanupTimer.unref === 'function') fredCacheCleanupTimer.unref();

const FRED_MAX_CONCURRENT = 2;
let fredRunning = 0;
async function acquireFredSlot() {
    while (fredRunning >= FRED_MAX_CONCURRENT) {
        await new Promise(r => setTimeout(r, 200));
    }
    fredRunning++;
}
function releaseFredSlot() { fredRunning = Math.max(0, fredRunning - 1); }

let fredUsageDirty = false;
function markFredCacheUsed(cacheKey, now = new Date()) {
    const entry = fredCache[cacheKey];
    if (!entry) return;
    entry.lastUsedAt = now.toISOString();
    fredUsageDirty = true; // 디스크 저장은 아래 타이머가 5분마다 한 번만 수행
}
const fredUsageFlushTimer = setInterval(() => {
    if (!fredUsageDirty) return;
    fredUsageDirty = false;
    try { persistFredCache(); }
    catch (error) { fileLog('[FRED] Could not persist cache usage time: ' + error.message); }
}, 5 * 60 * 1000);
if (typeof fredUsageFlushTimer.unref === 'function') fredUsageFlushTimer.unref();

app.get('/api/fred', async (req, res) => {
    const seriesId = String(req.query.series_id || '');
    const periodAliases = { '10년': '10y', '5년': '5y', '2년': '2y', '1년': '1y', '6개월': '6m' };
    const rawPeriod = String(req.query.period || '1y').toLowerCase();
    const period = periodAliases[rawPeriod] || (['10y', '5y', '2y', '1y', '6m'].includes(rawPeriod) ? rawPeriod : '1y');
    if (!/^[A-Za-z0-9_.-]+$/.test(seriesId)) {
        return res.status(400).json({ success: false, error: 'A valid series_id is required' });
    }

    const cacheKey = seriesId + '_' + period;
    if (fredInFlight.has(cacheKey)) {
        markFredCacheUsed(cacheKey);
        try { return res.json(await fredInFlight.get(cacheKey)); }
        catch (error) { return res.status(500).json({ success: false, error: error.message }); }
    }

    markFredCacheUsed(cacheKey);
    const refreshPromise = (async () => {
        const now = new Date();
        const monthKey = now.toISOString().slice(0, 7);
        const cached = fredCache[cacheKey];
        const fullRefresh = !cached || cached.lastFullRefreshMonth !== monthKey || !Array.isArray(cached.data);
        const latestDate = (cached && Array.isArray(cached.data) ? cached.data : [])
            .reduce((latest, row) => row.date > latest ? row.date : latest, '');
        const startDate = fullRefresh || !latestDate
            ? fredPeriodStartDate(period, now)
            : dateDaysBefore(latestDate, FRED_OVERLAP_DAYS);

        const runPython = command => new Promise((resolve, reject) => {
            const args = ['fred_api.py', seriesId, period, startDate];
            console.log('[FRED] ' + (fullRefresh ? 'Monthly full refresh' : 'Incremental refresh')
                + ': ' + seriesId + ' (' + period + ') from ' + startDate + ' using ' + command);
            execFile(command, args, { cwd: __dirname, maxBuffer: 1024 * 1024, timeout: 120000 }, (error, stdout, stderr) => {
                if (error) return reject(Object.assign(error, { stderr, command }));
                if (stderr && !stderr.includes('Warning')) fileLog('[FRED] Stderr: ' + stderr);
                try {
                    const jsonStart = stdout.indexOf('{');
                    const jsonEnd = stdout.lastIndexOf('}');
                    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON object found in stdout');
                    resolve(JSON.parse(stdout.substring(jsonStart, jsonEnd + 1)));
                } catch (parseError) {
                    reject(new Error('Invalid output from FRED script: ' + parseError.message));
                }
            });
        });
        const executePython = async command => {
            await acquireFredSlot();
            try { return await runPython(command); }
            finally { releaseFredSlot(); }
        };

        let result;
        try {
            result = await executePython('python');
        } catch (firstError) {
            console.warn('[FRED] python failed, retrying with python3: ' + firstError.message);
            try { result = await executePython('python3'); }
            catch (error) {
                fileLog('[FRED] Fetch failed for ' + cacheKey + ': ' + error.message + '; stderr: ' + (error.stderr || ''));
                if (cached && cached.data && cached.data.length) {
                    return { success: true, data: cached.data, cacheStatus: 'stale', refreshError: error.message };
                }
                throw error;
            }
        }
        if (!result.success || !Array.isArray(result.data)) {
            const error = new Error(result.error || 'FRED returned an invalid response');
            if (cached && cached.data && cached.data.length) {
                return { success: true, data: cached.data, cacheStatus: 'stale', refreshError: error.message };
            }
            throw error;
        }

        const priorRows = !fullRefresh && cached && cached.data ? cached.data : [];
        const mergedByDate = new Map(priorRows.map(row => [row.date, row]));
        for (const row of result.data) {
            if (row && typeof row.date === 'string' && Number.isFinite(Number(row.value))) {
                mergedByDate.set(row.date, { date: row.date, value: Number(row.value) });
            }
        }
        const mergedData = [...mergedByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
        fredCache = {
            ...fredCache,
            [cacheKey]: {
                seriesId: seriesId,
                data: mergedData,
                lastFullRefreshMonth: fullRefresh ? monthKey : cached.lastFullRefreshMonth,
                lastUsedAt: now.toISOString(),
                updatedAt: now.toISOString()
            }
        };
        try { persistFredCache(); }
        catch (error) { fileLog('[FRED] Could not persist cache file: ' + error.message); }
        console.log('[FRED] Updated ' + cacheKey + ': ' + result.data.length + ' fetched, '
            + mergedData.length + ' cached observations');
        return { success: true, data: mergedData, cacheStatus: fullRefresh ? 'monthly-full' : 'incremental' };
    })();

    fredInFlight.set(cacheKey, refreshPromise);
    try { res.json(await refreshPromise); }
    catch (error) { res.status(500).json({ success: false, error: error.message }); }
    finally { fredInFlight.delete(cacheKey); }
});

/**
 * 사용자 설정 저장 및 불러오기 API
 */
const SETTINGS_FILE = path.join(__dirname, 'autosaved_user_settings.json');
const MEMO_BACKUP_FILE = path.join(__dirname, 'user_settings.memo-backup.json');
const BACKUP_NAME_PATTERN = /^(manualsaved_user_settings|full_backup)_\d{8}_\d{6}_\d{3}\.json$/;

function getBackupPath(filename) {
    if (typeof filename !== 'string' || (filename !== 'autosaved_user_settings.json' && !BACKUP_NAME_PATTERN.test(filename))) return null;
    const resolved = path.resolve(__dirname, filename);
    return path.dirname(resolved) === path.resolve(__dirname) ? resolved : null;
}

app.get('/api/settings/backups', (req, res) => {
    try {
        const files = fs.readdirSync(__dirname)
            .filter(filename => filename === 'autosaved_user_settings.json' || BACKUP_NAME_PATTERN.test(filename))
            .map(filename => {
                const stat = fs.statSync(path.join(__dirname, filename));
                return { filename, bytes: stat.size, updatedAt: stat.mtimeMs };
            })
            .sort((a, b) => b.updatedAt - a.updatedAt);
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, files });
    } catch (error) {
        res.status(500).json({ success: false, error: '백업 목록을 불러오지 못했습니다.' });
    }
});

app.get('/api/settings/backups/:filename', (req, res) => {
    const backupPath = getBackupPath(req.params.filename);
    if (!backupPath || !fs.existsSync(backupPath)) {
        return res.status(404).json({ success: false, error: '백업 파일을 찾을 수 없습니다.' });
    }
    try {
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, filename: req.params.filename, content: fs.readFileSync(backupPath, 'utf8') });
    } catch (error) {
        res.status(500).json({ success: false, error: '백업 파일을 읽지 못했습니다.' });
    }
});

app.post('/api/settings/backups', (req, res) => {
    try {
        const { json } = req.body || {};
        if (typeof json !== 'string') {
            return res.status(400).json({ success: false, error: '전체 설정 JSON 백업 내용이 필요합니다.' });
        }
        const fullState = JSON.parse(json);
        if (!fullState || !Array.isArray(fullState.tabs) || !fullState.contents || typeof fullState.contents !== 'object') {
            return res.status(400).json({ success: false, error: '올바른 전체 설정 JSON 백업이 아닙니다.' });
        }
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})\.(\d{3})Z$/, '$1_$2_$3');
        const jsonFilename = `manualsaved_user_settings_${stamp}.json`;
        const jsonPath = getBackupPath(jsonFilename);
        fs.writeFileSync(jsonPath, JSON.stringify(fullState, null, 2), { encoding: 'utf8', flag: 'wx' });
        res.json({ success: true, filename: jsonFilename });
    } catch (error) {
        console.error('❌ 백업 파일 저장 에러:', error.message);
        res.status(500).json({ success: false, error: '프로젝트 폴더에 백업 파일을 저장하지 못했습니다.' });
    }
});

function writeJsonAtomically(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
        fs.renameSync(tempPath, filePath);
    } catch (error) {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* best effort cleanup */ }
        throw error;
    }
}

app.get('/api/settings', (req, res) => {
    console.log("📥 GET /api/settings 요청됨");
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            res.json({ success: true, data: JSON.parse(data) });
            console.log("✅ 설정 불러오기 성공");
        } else {
            res.json({ success: true, data: null });
            console.log("ℹ️ 설정 파일 없음");
        }
    } catch (error) {
        console.error("❌ 설정 불러오기 에러:", error.message);
        res.status(500).json({ error: "설정을 불러오는데 실패했습니다." });
    }
});

app.post('/api/settings', (req, res) => {
    console.log(`📤 POST /api/settings 요청됨 (Body Size: ${JSON.stringify(req.body).length})`);
    try {
        const settings = { ...(req.body || {}) };
        let savedSettings = null;
        if (fs.existsSync(SETTINGS_FILE)) {
            savedSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }

        // Routine settings saves must never replace the last explicitly saved memo.
        for (const key of ['memoHtml', 'memoDelta', 'memoUpdatedAt']) {
            if (savedSettings && Object.prototype.hasOwnProperty.call(savedSettings, key)) {
                settings[key] = savedSettings[key];
            } else {
                delete settings[key];
            }
        }
        writeJsonAtomically(SETTINGS_FILE, settings);
        res.json({ success: true });
        console.log("✅ 설정 저장 완료");
    } catch (error) {
        console.error("❌ 설정 저장 에러:", error.message);
        res.status(500).json({ error: "설정을 저장하는데 실패했습니다." });
    }
});

app.post('/api/settings/memo', (req, res) => {
    try {
        const { memoHtml, memoDelta, memoUpdatedAt, initialSettings } = req.body || {};
        if (typeof memoHtml !== 'string' || (memoDelta !== null && typeof memoDelta !== 'object')) {
            return res.status(400).json({ success: false, error: 'memoHtml 문자열과 memoDelta 객체가 필요합니다.' });
        }

        let settings = null;
        if (fs.existsSync(SETTINGS_FILE)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        } else if (initialSettings && typeof initialSettings === 'object' && !Array.isArray(initialSettings)) {
            // Seed the first server snapshot so the memo is available on other devices too.
            settings = { ...initialSettings };
        } else {
            settings = {};
        }

        // Keep the last non-empty memo that was replaced so an accidental blank save is recoverable.
        const hasPreviousMemo = typeof settings.memoHtml === 'string' && settings.memoHtml.length > 0;
        const memoChanged = settings.memoHtml !== memoHtml || JSON.stringify(settings.memoDelta ?? null) !== JSON.stringify(memoDelta ?? null);
        if (hasPreviousMemo && memoChanged) {
            writeJsonAtomically(MEMO_BACKUP_FILE, {
                memoHtml: settings.memoHtml,
                memoDelta: settings.memoDelta ?? null,
                memoUpdatedAt: settings.memoUpdatedAt ?? settings.updatedAt ?? null,
                backedUpAt: Date.now()
            });
        }

        settings.memoHtml = memoHtml;
        settings.memoDelta = memoDelta;
        settings.memoUpdatedAt = Number.isFinite(Number(memoUpdatedAt)) ? Number(memoUpdatedAt) : Date.now();
        writeJsonAtomically(SETTINGS_FILE, settings);
        console.log('✅ 메모 서버 저장 완료');
        res.json({ success: true });
    } catch (error) {
        console.error('❌ 메모 서버 저장 에러:', error.message);
        res.status(500).json({ success: false, error: '메모를 서버에 저장하지 못했습니다.' });
    }
});

/**
 * ECOS (한국은행 경제통계시스템) API 프록시
 */
app.get('/api/ecos', async (req, res) => {
    const table = req.query.table || '817Y002'; // 기본값: 817Y002 (일일 금리)
    const item = req.query.item;
    const start = req.query.start;
    const end = req.query.end;

    if (!item || !start || !end) {
        return res.status(400).json({ success: false, error: 'item, start, end 파라미터가 필요합니다.' });
    }

    const apiKey = process.env.ECOS_APIKEY;
    if (!apiKey) {
        return res.status(500).json({ success: false, error: 'ECOS_APIKEY가 설정되지 않았습니다.' });
    }

    // URL Construction: https://ecos.bok.or.kr/api/StatisticSearch/KEY/json/kr/1/100000/TABLE/D/START/END/ITEM
    // numOfdata is set to 100000 to fetch all data in range as requested ("불러온 데이터를 모두 보여주도록 계산해")
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${apiKey}/json/kr/1/100000/${table}/D/${start}/${end}/${item}`;

    console.log(`[ECOS] 🔄 Requesting: ${table}/${item} (${start} ~ ${end})`);

    try {
        const response = await axios.get(url, { timeout: 30000 }); // Increased timeout to 30s
        const result = response.data;

        if (result.StatisticSearch && result.StatisticSearch.row) {
            const rowCount = result.StatisticSearch.row.length;
            console.log(`[ECOS] ✅ Success: ${item} (${rowCount} items)`);
            res.json({
                success: true,
                data: result.StatisticSearch.row
            });
        } else {
            const errorCode = result.RESULT ? result.RESULT.CODE : (result.StatisticSearch ? result.StatisticSearch.RESULT.CODE : 'Unknown');
            const errorMsg = result.RESULT ? result.RESULT.MESSAGE : (result.StatisticSearch ? result.StatisticSearch.RESULT.MESSAGE : '해당하는 데이터가 없습니다.');

            console.warn(`[ECOS] ⚠️ Response: ${errorCode} - ${errorMsg}`);

            res.json({
                success: false,
                error: errorMsg,
                code: errorCode,
                raw: result
            });
        }
    } catch (error) {
        console.error(`[ECOS] ❌ Fetch Error: ${error.message} (URL: ${url})`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. 그 다음 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 토큰 캐싱을 위한 전역 변수
let cachedToken = null;
let tokenExpiryTime = 0;

/**
 * Access Token 발급 함수 (캐싱 포함)
 */
async function getAccessToken(appKey, secretKey) {
    // 1. 캐시된 토큰이 있고, 만료시간이 5분 이상 남았으면 캐시 반환
    if (cachedToken && Date.now() < (tokenExpiryTime - 300000)) {
        return cachedToken;
    }

    fileLog("새로운 Access Token 발급 시도...");
    const response = await axios.post(
        "https://api.kiwoom.com/oauth2/token",
        {
            appkey: appKey,
            secretkey: secretKey,
            grant_type: "client_credentials",
        },
        {
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0"
            },
            timeout: 5000
        }
    );

    if (response.data.return_code !== undefined && response.data.return_code !== 0) {
        const errMsg = response.data.return_msg || `키움 인증 실패 (코드: ${response.data.return_code})`;
        fileLog(`❌ 키움 토큰 발급 실패: ${errMsg}`);
        throw new Error(errMsg);
    }

    const token = response.data.token || response.data.access_token;
    if (!token) {
        throw new Error(`토큰 필드가 없습니다. 응답: ${JSON.stringify(response.data)}`);
    }

    console.log(`DEBUG: New token issued. Length: ${token.length}, First 10 chars: ${token.substring(0, 10)}...`);

    // 2. 토큰 및 만료 시간 캐싱 (기본 만료시간이 없을 경우 24시간으로 설정)
    const expiresIn = response.data.expires_in || 86400; // 초 단위
    cachedToken = token;
    tokenExpiryTime = Date.now() + (expiresIn * 1000);

    fileLog(`토큰 발급 완료 (만료: ${new Date(tokenExpiryTime).toLocaleString()})`);
    return token;
}

// eFriend 토큰 캐싱을 위한 전역 변수
let efriendCachedToken = null;
let efriendTokenExpiryTime = 0;

/**
 * 한국투자증권(eFriend) Access Token 발급
 */
async function getEfriendAccessToken(domain, appKey, secretKey) {
    if (efriendCachedToken && Date.now() < (efriendTokenExpiryTime - 300000)) {
        return efriendCachedToken;
    }

    fileLog("eFriend 새로운 Access Token 발급 시도...");
    try {
        const response = await axios.post(
            `${domain}/oauth2/tokenP`,
            {
                grant_type: "client_credentials",
                appkey: appKey,
                appsecret: secretKey,
            },
            {
                headers: {
                    "Content-Type": "application/json; charset=UTF-8"
                },
                timeout: 5000
            }
        );

        const token = response.data.access_token;
        if (token) {
            const expiresIn = response.data.expires_in || 86400; // 초 단위
            efriendCachedToken = token;
            efriendTokenExpiryTime = Date.now() + (expiresIn * 1000);
            fileLog(`eFriend 토큰 발급 완료`);
            return token;
        } else {
            const bodyStr = JSON.stringify(response.data);
            throw new Error(`한국투자증권 토큰 발급 실패: 응답에 access_token 필드가 없습니다. Body: ${bodyStr}`);
        }
    } catch (error) {
        const errorData = error.response?.data;
        console.error("한국투자증권 토큰 발급 에러:", errorData || error.message);
        throw error;
    }
}

app.listen(PORT, () => {
    console.log("\n" + "=".repeat(50));
    console.log(`🚀 서버 구동 완료! (VERSION: SET EXTREMES)`);
    console.log(`링크: http://localhost:${PORT}`);
    console.log(`서버 시작 시간: ${SERVER_START_TIME}`);
    console.log("=".repeat(50) + "\n");

    // 로그 버퍼링 방지를 위한 주기적 점검 (옵션)
    setInterval(() => {
        // keep-alive logging
        // console.log(`[Heartbeat] Server is running... ${new Date().toLocaleTimeString()}`);
    }, 60000);
});
