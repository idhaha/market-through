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
const ADR_TAB_ID = 'tab_adr';
const MEMO_TAB_ID = 'tab_memo';
const EARNINGS_TAB_ID = 'tab_earnings';
const US_TAB_ID = 'tab_us';
const BASE_INTEREST_TAB_ID = 'tab_base_interest';
const BASE_INTEREST_BANKS = [
    ['FED', '연방준비제도'], ['ECB', '유럽중앙은행'], ['BOE', '영국은행'], ['BOJ', '일본은행'],
    ['BOK', '한국은행'], ['RBA', '호주 연방준비은행'], ['BOC', '캐나다 은행'], ['SNB', '스위스 국립은행'],
    ['RBI', '인도 연방준비은행'], ['BCB', '브라질 중앙은행'], ['CBR', '러시아 중앙은행'], ['PBOC', '중국인민은행']
].map(([code, name]) => ({ code, name }));
let isInitializing = false; // Flag to prevent auto-save during startup
let isCapturing = false; // Flag to suppress all data-fetching during screenshot capture
let adrRenderPending = false;
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
let adrAutoRefreshInterval = null;
// Default to '2' (10 minutes) as requested
let lastSavedSettings = { rankInterval: '2', adrInterval: '2' };

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
async function loadTransactionRank() {
    if (isCapturing) { console.log('[Capture] loadTransactionRank() skipped (isCapturing)'); return; }
    const mrktTp = mrktTpSelect.value;
    const stexTp = stexTpSelect.value;

    console.log(`fetching Transaction Rank (mrkt=${mrktTp}, stex=${stexTp})...`);

    try {
        const response = await fetch(`/api/transaction_rank?mrkt_tp=${mrktTp}&stex_tp=${stexTp}`);
        const result = await response.json();

        console.log("Transaction Rank Raw Result:", result);

        if (result.success) {
            const items = result.items || [];
            console.log("Transaction Items:", items.length);

            if (items.length === 0) {
                transactionBody.innerHTML = `<tr><td colspan="6" class="align-center">데이터가 없습니다.</td></tr>`;
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

        } else {
            if (document.querySelector('.tab-content.active')?.id === PERM_TAB_ID) {
                console.error("Trans Rank Error:", result.error);
                transactionBody.innerHTML = `<tr><td colspan="6" class="align-center error">통신 오류</td></tr>`;
            } else {
                console.warn('[Rank] 거래대금 백그라운드 갱신 실패 (UI 억제됨):', result.error);
            }
        }
    } catch (e) {
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
        window.refreshConcentrationChart?.();
    }, intervalMs);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

function startAdrAutoRefresh() {
    if (adrAutoRefreshInterval) {
        clearInterval(adrAutoRefreshInterval);
    }

    const select = document.getElementById('adrRefreshInterval');
    if (!select) return;

    const selectedOption = select.options[select.selectedIndex];
    const intervalMs = parseInt(selectedOption.dataset.interval) || 30000;

    console.log(`[ADR] 🔄 자동 새로고침 시작 (간격: ${intervalMs}ms)`);

    adrAutoRefreshInterval = setInterval(() => {
        if (isCapturing) { console.log('[Capture] ADR auto-refresh skipped (isCapturing)'); return; }
        const now = new Date().toLocaleTimeString();
        console.log(`[ADR] ⚡ 자동 새로고침 실행 (${now})`);
        updateAdrFromSource();
    }, intervalMs);
}

function stopAdrAutoRefresh() {
    if (adrAutoRefreshInterval) {
        clearInterval(adrAutoRefreshInterval);
        adrAutoRefreshInterval = null;
    }
}

refreshIntervalSelect.addEventListener('change', (e) => {
    console.log('[Rank] 새로고침 설정 변경');
    lastSavedSettings.rankInterval = e.target.value;
    loadData();
    loadTransactionRank();
    loadWatchlistRank();
    window.refreshConcentrationChart?.();
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
window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
});

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
        btn.textContent = 'Rank';
        btn.draggable = false;
        btn.dataset.perm = 'true';
        btn.title = '고정 탭 (조회 순위)';

        if (tabsWrapper.firstChild) tabsWrapper.insertBefore(btn, tabsWrapper.firstChild);
        else tabsWrapper.appendChild(btn);
    }

    // ADR Tab
    if (!document.querySelector(`.tab-btn[data-tab="${ADR_TAB_ID}"]`)) {
        const btn = document.createElement('button');
        btn.className = 'tab-btn perm-tab';
        btn.dataset.tab = ADR_TAB_ID;
        btn.textContent = 'ADR';
        btn.draggable = false;
        btn.dataset.perm = 'true';
        btn.title = '고정 탭 (ADR 차트)';

        const rankBtn = document.querySelector(`.tab-btn[data-tab="${PERM_TAB_ID}"]`);
        if (rankBtn && rankBtn.nextSibling) tabsWrapper.insertBefore(btn, rankBtn.nextSibling);
        else tabsWrapper.appendChild(btn);

        createTabContentElement(ADR_TAB_ID);
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

        const adrBtn = document.querySelector(`.tab-btn[data-tab="${ADR_TAB_ID}"]`);
        if (adrBtn && adrBtn.nextSibling) tabsWrapper.insertBefore(btn, adrBtn.nextSibling);
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
    if (tabId === PERM_TAB_ID) return 'Rank';
    if (tabId === ADR_TAB_ID) return 'ADR';
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
        adrInterval: document.getElementById('adrRefreshInterval')?.value,
        watchlistGroupId: watchlistGroupId,
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
    if (!content || tabId === PERM_TAB_ID || tabId === ADR_TAB_ID || tabId === EARNINGS_TAB_ID || tabId === BASE_INTEREST_TAB_ID || tabId === US_TAB_ID || tabId === MEMO_TAB_ID) return;

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

function applyData(data) {
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

            if (t.id === PERM_TAB_ID || t.id === ADR_TAB_ID || t.id === EARNINGS_TAB_ID || t.id === BASE_INTEREST_TAB_ID || t.id === US_TAB_ID || t.id === MEMO_TAB_ID) {
                const btn = document.querySelector(`.tab-btn[data-tab="${t.id}"]`);
                if (btn) {
                    if (t.id === EARNINGS_TAB_ID) {
                        btn.textContent = '증시캘린더';
                        btn.title = '고정 탭 (증시 캘린더)';
                    } else {
                        btn.textContent = fixedName;
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
        if (data.adrInterval) {
            lastSavedSettings.adrInterval = data.adrInterval === '4' ? '5' : data.adrInterval;
        } else {
            lastSavedSettings.adrInterval = '2';
        }

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
    document.querySelectorAll('.tab-content:not(#tab_rank):not(#tab_adr):not(#tab_earnings):not(#tab_base_interest):not(#tab_us):not(#tab_memo)').forEach(c => c.remove());
}

function activateTab(tabId) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const content = document.getElementById(tabId);
    if (!btn || !content) return;

    // Background refresh allowed: Do NOT stop refreshes here

    document.querySelectorAll(".tab-content.active").forEach(tab => {
        if (tab.id !== tabId) {
            if (tab.id !== PERM_TAB_ID && tab.id !== ADR_TAB_ID && tab.id !== EARNINGS_TAB_ID && tab.id !== BASE_INTEREST_TAB_ID && tab.id !== US_TAB_ID && tab.id !== MEMO_TAB_ID) {
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

    if (tabId === ADR_TAB_ID) {
        const adrData = tabData[ADR_TAB_ID]?.adr;
        if (adrRenderPending && adrData) {
            renderAdr(adrData.kospi, adrData.kosdaq);
            adrRenderPending = false;
        }
        if (!isCapturing) startAdrAutoRefresh();
    } else if (tabId === MEMO_TAB_ID) {
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

    // 2. Attach specialized listeners (idempotent checks included)
    if (!isInitialized) {
        if (tabId === ADR_TAB_ID) {
            const adrSelect = document.getElementById('adrRefreshInterval');
            if (adrSelect && lastSavedSettings.adrInterval) {
                adrSelect.value = lastSavedSettings.adrInterval;
            }
        } else if (tabId === BASE_INTEREST_TAB_ID) {
            document.getElementById('refreshBaseInterest')?.addEventListener('click', () => loadBaseInterestCharts(true));
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
            if (tabId === ADR_TAB_ID) {
                setTimeout(() => updateAdrFromSource(), 100);
            } else if (tabData[tabId] && tabData[tabId].type === 'overseas_custom') {
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
    // 1. ADR Tab
    if (tabId === ADR_TAB_ID) {
        return `
            <div class="container" style="height: 100%; display: flex; flex-direction: column;">
                <header>
                    <div class="header-single-line">
                        <h1><strong>ADR Chart</strong></h1>
                        <div class="header-controls">
                            <div class="refresh-control">
                                <select id="adrRefreshInterval" class="interval-select">
                                    <option value="5" data-interval="30000" selected>30초 간격</option>
                                    <option value="1" data-interval="60000">1분 간격</option>
                                    <option value="2" data-interval="600000">10분 간격</option>
                                    <option value="3" data-interval="3600000">1시간 간격</option>
                                </select>
                            </div>
                            <button id="adrManualRefresh" class="btn-primary" style="height: 38px; padding: 0 15px;">조회</button>
                        </div>
                    </div>
                    <div class="status-info">
                        <span id="adrLastUpdate">-</span>
                        <span class="status-separator">|</span>
                        <span id="adrStatusText">대기 중...</span>
                    </div>
                </header>

                <div class="adr-chart-container" style="flex: 1; overflow: auto;">
                    <div class="adr-chart-wrapper">
                        <div class="adr-chart-header"><h3>K</h3></div>
                        <div class="adr-period-selector">
                            <button class="period-btn" data-period="6m">6m</button>
                            <button class="period-btn" data-period="1y">1y</button>
                            <button class="period-btn active" data-period="2y">2y</button>
                            <button class="period-btn" data-period="5y">5y</button>
                            <button class="period-btn" data-period="10y">10y</button>
                        </div>
                        <canvas id="adr_kospi" class="adr-canvas-new" width="500" height="300"></canvas>
                    </div>
                    <div class="adr-chart-wrapper">
                        <div class="adr-chart-header"><h3>Q</h3></div>
                        <div class="adr-period-selector">
                            <button class="period-btn" data-period="6m">6m</button>
                            <button class="period-btn" data-period="1y">1y</button>
                            <button class="period-btn active" data-period="2y">2y</button>
                            <button class="period-btn" data-period="5y">5y</button>
                            <button class="period-btn" data-period="10y">10y</button>
                        </div>
                        <canvas id="adr_kosdaq" class="adr-canvas-new" width="500" height="300"></canvas>
                    </div>
                </div>
            </div>`;
    }

    if (tabId === US_TAB_ID) return window.USLinks.layout();

    if (tabId === BASE_INTEREST_TAB_ID) {
        return `<div class="container overseas-container">
            <header><div class="header-single-line"><h1><strong>기준금리</strong></h1>
                <div class="header-controls"><button id="refreshBaseInterest" class="btn-primary" style="height:38px; padding:0 15px;">새로고침</button></div>
            </div><div class="status-info"><span id="baseInterestLastUpdate">-</span><span class="status-separator">|</span><span id="baseInterestStatus">대기 중...</span></div></header>
            <div class="base-interest-scroll"><div id="baseInterestGrid" class="base-interest-grid">
                ${BASE_INTEREST_BANKS.map(bank => `<article class="base-interest-card" data-bank-code="${bank.code}"><h2>${bank.code} (${bank.name})</h2><div class="base-interest-chart"><p role="status">화면 로딩 중...</p></div></article>`).join('')}
            </div></div></div>`;
    }

    // 2. Earnings Tab (증시캘린더)
    if (tabId === EARNINGS_TAB_ID) {
        const calendars = [
            { id: 'toss', label: '지표/실적 일정', url: '/calendar', externalUrl: 'https://www.tossinvest.com/calendar' },
            { id: 'seibro', label: '배당 일정', url: 'https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/company/BIP_CNTS01041V.xml&menuNo=285', externalUrl: 'https://seibro.or.kr/websquare/control.jsp?w2xPath=/IPORTAL/user/company/BIP_CNTS01041V.xml&menuNo=285' },
            { id: 'investing', label: '각국 금리 일정', url: 'about:blank', externalUrl: 'https://kr.investing.com/central-banks/' }
        ];
        const activeCalendarId = tabData[tabId]?.activeCalendarId || 'toss';
        const selectedCalendar = calendars.find(calendar => calendar.id === activeCalendarId) || calendars[0];
        return `
            <div class="container overseas-container">
                <header>
                    <div class="header-single-line">
                        <h1><strong>증시캘린더</strong></h1>
                        <div class="header-controls" style="display: flex; gap: 8px;">
                            <a id="earningsExternalLink_${tabId}" href="${selectedCalendar.externalUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="height: 38px; padding: 0 15px; display: inline-flex; align-items: center; text-decoration: none; font-weight: 500;">원본 사이트 ↗</a>
                            <button id="refreshEarnings_${tabId}" class="btn-primary" style="height: 38px; padding: 0 15px;">새로고침</button>
                        </div>
                    </div>
                    <div class="status-info">
                        <span id="earningsLastUpdate_${tabId}">-</span>
                        <span class="status-separator">|</span>
                        <span id="earningsStatusText_${tabId}">대기 중...</span>
                    </div>
                </header>
                <div class="calendar-source-tabs" role="tablist" aria-label="캘린더 종류">
                    ${calendars.map(calendar => `<button type="button" id="calendarSourceTab_${tabId}_${calendar.id}" class="calendar-source-tab${calendar.id === activeCalendarId ? ' active' : ''}" role="tab" aria-selected="${calendar.id === activeCalendarId}" aria-controls="calendarSourcePanel_${tabId}" data-calendar-source="${calendar.id}">${calendar.label}</button>`).join('')}
                </div>
                <div class="overseas-content-scroll calendar-source-panel" id="calendarSourcePanel_${tabId}" role="tabpanel" aria-labelledby="calendarSourceTab_${tabId}_${activeCalendarId}" style="flex:1; overflow:hidden;">
                    <iframe id="iframeEarnings_${tabId}" ${activeCalendarId !== 'toss' ? 'hidden' : ''} data-calendar-urls="${encodeURIComponent(JSON.stringify(calendars))}" data-calendar-source="${activeCalendarId}" class="embedded-iframe" style="width:100%; height:100%; border:none;" title="${selectedCalendar.label} 캘린더"></iframe>
                    <iframe id="iframeEarningsSeibro_${tabId}" ${activeCalendarId !== 'seibro' ? 'hidden' : ''} class="embedded-iframe" style="width:100%; height:100%; border:none;" title="배당 일정 캘린더"></iframe>
                    <div id="centralBanksFramePanel_${tabId}" ${activeCalendarId === 'investing' ? '' : 'hidden'} style="height:100%; position:relative; background:white;"><iframe id="centralBanksFrame_${tabId}" class="embedded-iframe" style="width:100%; height:100%; border:none;" title="각국 금리 일정 — Investing.com"></iframe><div id="centralBanksFrameLoading_${tabId}" class="central-banks-frame-loading" role="status" hidden style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:white; color:#333; font-size:18px;">화면 로딩 중...</div></div>
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
                                <button class="btn-section-edit" title="섹션 편집">⚙️</button>
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
                        <h1><strong>${titleText}</strong></h1>
                        <div class="status-info tab-heading-status">
                            <span id="${prefix}LastUpdate">-</span>
                            <span class="status-separator">|</span>
                            <span id="${prefix}StatusText">대기 중...</span>
                            <button class="btn-config status-btn config-trigger" data-tab="${tabId}">종목입력</button>
                        </div>
                        <div class="header-controls">
                            <button id="refreshOverlay_${tabId}" class="btn-primary" style="height: 38px; padding: 0 15px;">조회</button>
                        </div>
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
                                <button class="btn-section-edit" title="섹션 편집">⚙️</button>
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
                        <h1><strong>${titleText}</strong></h1>
                        <div class="status-info tab-heading-status">
                            <span id="${prefix}LastUpdate">-</span>
                            <span class="status-separator">|</span>
                            <span id="${prefix}StatusText">대기 중...</span>
                            <button class="btn-config status-btn config-trigger" data-tab="${tabId}">종목입력</button>
                        </div>
                        <div class="header-controls">
                            <button id="refreshExchangeRate_${tabId}" class="btn-primary" style="height: 38px; padding: 0 15px;">조회</button>
                        </div>
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
    if (container.id === ADR_TAB_ID) {
        const adrCache = (tabData[ADR_TAB_ID] && tabData[ADR_TAB_ID].adr) ? tabData[ADR_TAB_ID].adr : null;
        if (adrCache) {
            setTimeout(() => renderAdr(adrCache.kospi, adrCache.kosdaq), 100);
        } else {
            updateAdrFromSource();
        }
        return;
    }
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

// --- ADR Data & Drawing ---

async function updateAdrFromSource() {
    const url = `/api/adr?t=${Date.now()}`;
    console.log("🔄 [ADR] Step 1: Fetching from backend proxy:", url);
    const isAdrActive = () => {
        const currentTab = document.querySelector('.tab-content.active');
        return currentTab && currentTab.id === ADR_TAB_ID;
    };



    const adrStatusTextElem = document.getElementById('adrStatusText');
    const adrLastUpdateElem = document.getElementById('adrLastUpdate');
    if (adrStatusTextElem) adrStatusTextElem.textContent = "데이터 로딩 중...";

    try {
        const res = await fetch(url, { cache: 'no-store' });
        console.log("📥 [ADR] Step 2: Response received, status:", res.status, res.ok);
        if (!res.ok) throw new Error('네트워크 오류: ' + res.status);

        const text = await res.text();
        console.log("📄 [ADR] Step 3: HTML received, length:", text.length);
        if (!text || text.length < 100) throw new Error('응답 데이터가 너무 짧거나 비어있습니다.');

        const parsed = parseAdrHtml(text);

        const kLen = parsed.kospi.length;
        const qLen = parsed.kosdaq.length;
        if (kLen === 0 || qLen === 0) {
            throw new Error('KOSPI 또는 KOSDAQ ADR 데이터가 비어 있습니다.');
        }
        const kLastDate = kLen > 0 ? new Date(parsed.kospi[kLen - 1].date).toLocaleDateString() : 'N/A';
        const qLastDate = qLen > 0 ? new Date(parsed.kosdaq[qLen - 1].date).toLocaleDateString() : 'N/A';

        console.log(`✅ [ADR] Step 4: Parsed Data - KOSPI: ${kLen} (${kLastDate}), KOSDAQ: ${qLen} (${qLastDate})`);

        if (kLen !== qLen) {
            console.warn(`⚠️ [ADR] Data length mismatch! K:${kLen} vs Q:${qLen}`);
        }

        tabData[ADR_TAB_ID] = tabData[ADR_TAB_ID] || {};
        tabData[ADR_TAB_ID].adr = { kospi: parsed.kospi, kosdaq: parsed.kosdaq, updated: Date.now() };

        if (isAdrActive()) {
            console.log("🎨 [ADR] Step 5: Calling renderAdr...");
            renderAdr(parsed.kospi, parsed.kosdaq);
            adrRenderPending = false;
        } else {
            adrRenderPending = true;
            console.log('[ADR] 탭 비활성 상태라 데이터 저장 후 렌더링을 보류합니다.');
        }

        const last = new Date().toLocaleString();
        if (adrStatusTextElem) adrStatusTextElem.textContent = "업데이트 완료";
        if (adrLastUpdateElem) adrLastUpdateElem.textContent = last;

    } catch (e) {
        console.error('❌ [ADR] 업데이트 실패:', e);
        if (adrStatusTextElem) adrStatusTextElem.textContent = "업데이트 실패";
    } finally {
    }
}

function parseAdrHtml(html) {
    const out = { kospi: [], kosdaq: [] };
    try {
        const rawKospi = extractArrayFromHtml(html, "kospi_adr");
        const rawKosdaq = extractArrayFromHtml(html, "kosdaq_adr");

        out.kospi = rawKospi.filter(i => i && i[1] !== null).map(i => ({ date: i[0], value: i[1] }));
        out.kosdaq = rawKosdaq.filter(i => i && i[1] !== null).map(i => ({ date: i[0], value: i[1] }));

        if (out.kospi.length > 0) out.kospi.sort((a, b) => a.date - b.date);
        if (out.kosdaq.length > 0) out.kosdaq.sort((a, b) => a.date - b.date);

        console.log(`📊 [Parser] Extracted: KOSPI=${out.kospi.length}, KOSDAQ=${out.kosdaq.length}`);
    } catch (e) {
        console.error('❌ [Parser] Failed:', e);
    }
    return out;
}

function extractArrayFromHtml(html, name) {
    let startIdx = html.indexOf(`${name}=`);
    if (startIdx === -1) startIdx = html.indexOf(`${name} =`);
    if (startIdx === -1) return [];

    const contentStart = html.indexOf('[', startIdx);
    if (contentStart === -1) return [];

    let balance = 0;
    let endIdx = -1;
    for (let i = contentStart; i < html.length; i++) {
        if (html[i] === '[') balance++;
        else if (html[i] === ']') balance--;
        if (balance === 0) {
            endIdx = i;
            break;
        }
    }
    if (endIdx === -1) return [];

    const contentStr = html.substring(contentStart, endIdx + 1).trim();
    try {
        return JSON.parse(contentStr.replace(/,\s*\]$/, ']'));
    } catch (e) {
        console.warn(`[Parser] JSON.parse failed for ${name}, trying simple regex...`);
        // Fallback for extremely messy strings
        const items = [];
        const itemRegex = /\[\s*(\d+)\s*,\s*([-]?\d*\.?\d+)\s*\]/g;
        let m;
        while ((m = itemRegex.exec(contentStr)) !== null) {
            items.push([parseInt(m[1]), parseFloat(m[2])]);
        }
        return items;
    }
}

function renderAdr(kospi, kosdaq) {
    const c1 = document.getElementById('adr_kospi');
    const c2 = document.getElementById('adr_kosdaq');
    if (!c1 || !c2) return;

    // Common Range Calculator
    const getCombinedRange = (offset, count) => {
        const getVals = (arr) => {
            if (!arr || arr.length === 0) return [];
            const start = Math.max(0, Math.min(offset, arr.length - count));
            const end = Math.min(start + count, arr.length);
            return arr.slice(start, end).map(d => d.value);
        };
        const v1 = getVals(kospi);
        const v2 = getVals(kosdaq);
        const all = v1.concat(v2);
        if (all.length === 0) return null;
        return { min: Math.min(...all), max: Math.max(...all) };
    };

    const nearestIndexForDate = (series, dateValue) => {
        if (!series.length || dateValue == null) return -1;
        const targetTime = Number.isFinite(Number(dateValue)) ? Number(dateValue) : new Date(dateValue).getTime();
        if (!Number.isFinite(targetTime)) return -1;

        let low = 0;
        let high = series.length - 1;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            const midTime = new Date(series[mid].date).getTime();
            if (midTime < targetTime) low = mid + 1;
            else high = mid;
        }
        if (low > 0) {
            const beforeTime = new Date(series[low - 1].date).getTime();
            const afterTime = new Date(series[low].date).getTime();
            if (Math.abs(beforeTime - targetTime) <= Math.abs(afterTime - targetTime)) return low - 1;
        }
        return low;
    };

    const syncChartByDate = (targetCanvas, targetData, targetLabel, state) => {
        if (!targetCanvas.chartState || !targetData.length) return;
        const targetState = targetCanvas.chartState;
        const targetVisibleCount = Math.min(state.visibleCount, targetData.length);
        const targetStart = nearestIndexForDate(targetData, state.visibleStartDate);
        const maxOffset = Math.max(0, targetData.length - targetVisibleCount);

        targetState.visibleCount = targetVisibleCount;
        targetState.scrollOffset = Math.max(0, Math.min(targetStart >= 0 ? targetStart : state.scrollOffset, maxOffset));

        const targetHover = nearestIndexForDate(targetData, state.hoveredDate);
        const visibleStart = Math.floor(targetState.scrollOffset);
        targetState.hoveredIndex = targetHover >= visibleStart && targetHover < visibleStart + targetVisibleCount
            ? targetHover - visibleStart
            : null;

        requestAnimationFrame(() => drawLineChart(targetCanvas, targetData, targetLabel, targetVisibleCount));
    };

    const syncToKosdaq = state => syncChartByDate(c2, kosdaq, 'Q ADR', state);
    const syncToKospi = state => syncChartByDate(c1, kospi, 'K ADR', state);

    c1.rangeCalculator = getCombinedRange;
    c1.syncCallback = syncToKosdaq;
    c2.rangeCalculator = getCombinedRange;
    c2.syncCallback = syncToKospi;

    // Use current visibleCount if already set, else default to 2y (480 trading days).
    const currentCount = c1.chartState ? c1.chartState.visibleCount : 480;
    drawLineChart(c1, kospi, 'K ADR', currentCount);
    drawLineChart(c2, kosdaq, 'Q ADR', currentCount);
}
// function drawLineChart(canvas, data, label, visibleCount = 60) {
function drawLineChart(canvas, data, label, visibleCount = 60, syncCallback = null) {
    if (!canvas) return;
    if (data && data.length > 0) visibleCount = Math.max(1, Math.min(visibleCount, data.length));
    // Interaction listeners are installed once, so keep their data source current
    // when a later refresh replaces the ADR arrays.
    canvas.chartData = data;
    canvas.chartLabel = label;
    // Store sync callback for future use (e.g. by period buttons)
    if (syncCallback) canvas.syncCallback = syncCallback;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 400;
    const h = canvas.clientHeight || 300;

    const targetW = Math.floor(w * dpr);
    const targetH = Math.floor(h * dpr);

    // Optimize: Only resize if dimensions changed to avoid layout thrashing loop
    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
        // Just clear if size hasn't changed (re-use buffer)
        // Ensure transform is correct just in case context was reset elsewhere (unlikely but safe)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Context settings
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    if (!data || data.length === 0) {
        ctx.fillStyle = "#6c757d";
        ctx.font = "16px Arial";
        ctx.textAlign = "center";
        ctx.fillText("데이터 없음", w / 2, h / 2);
        return;
    }

    // Initialize interacting state if not present
    if (!canvas.chartState) {
        canvas.chartState = {
            scrollOffset: Math.max(0, data.length - visibleCount),
            isDragging: false,
            isScrollDragging: false,
            lastX: 0,
            hoveredIndex: null,
            visibleCount: visibleCount,
            pendingFrame: false // Thread locking for performance
        };
    } else {
        // Update visible count in state in case it changed via buttons
        canvas.chartState.visibleCount = visibleCount;
    }
    const state = canvas.chartState;
    // prevMaxOffset: The end position of the PREVIOUS data set
    const prevMaxOffset = Math.max(0, (canvas.lastDataLength || data.length) - visibleCount);
    // isAtEnd: Were we at the end of the previous data set?
    // Added !canvas.lastDataLength check to ensure we start at the end for fresh loads
    const isAtEnd = !canvas.lastDataLength || state.scrollOffset >= prevMaxOffset - 1.0;

    console.log(`📊 [Chart:${label}] Len: ${data.length}, Prev: ${canvas.lastDataLength}, Offset: ${state.scrollOffset.toFixed(2)}, isAtEnd: ${isAtEnd}`);

    // Adjust offset if visibleCount changes (e.g. period change)
    if (canvas.lastVisibleCount !== visibleCount) {
        state.scrollOffset = Math.max(0, data.length - visibleCount);
        canvas.lastVisibleCount = visibleCount;
    } else if (isAtEnd) {
        // Always follow to the end if we were at the end, 
        // especially if data length increased or if it's the first real data load
        const newMaxOffset = Math.max(0, data.length - visibleCount);
        if (state.scrollOffset !== newMaxOffset) {
            state.scrollOffset = newMaxOffset;
            console.log(`🚀 [Chart:${label}] Followed to end: ${state.scrollOffset}`);
        }
    }

    canvas.lastDataLength = data.length;

    // Ensure offset is valid
    state.scrollOffset = Math.max(0, Math.min(state.scrollOffset, data.length - visibleCount));

    const startIdx = Math.floor(state.scrollOffset);
    const endIdx = data.length; // Always slice to end, let visibleCount control the actual start if needed
    // But original logic used startIdx + visibleCount. Let's keep it consistent:
    const actualEndIdx = Math.min(startIdx + visibleCount, data.length);
    const visibleSeries = data.slice(startIdx, actualEndIdx);
    state.visibleStartDate = visibleSeries[0]?.date ?? null;
    state.visibleEndDate = visibleSeries[visibleSeries.length - 1]?.date ?? null;
    state.hoveredDate = state.hoveredIndex !== null ? visibleSeries[state.hoveredIndex]?.date ?? null : null;

    // Padding
    const padding = { top: 60, right: 100, bottom: 80, left: 60 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    // Y-Axis Range
    const values = visibleSeries.map(d => d.value);
    let minVal, maxVal;

    // Use shared calculator if available
    if (canvas.rangeCalculator) {
        const range = canvas.rangeCalculator(state.scrollOffset, visibleCount);
        if (range) {
            minVal = range.min;
            maxVal = range.max;
        }
    }

    // Fallback or default
    if (minVal === undefined) {
        if (values.length > 0) {
            minVal = Math.min(...values);
            maxVal = Math.max(...values);
        } else {
            minVal = 0; maxVal = 100;
        }
    }

    // Add small buffer if flat
    if (minVal === maxVal) { minVal -= 1; maxVal += 1; }

    const range = maxVal - minVal || 1;

    // --- Draw Areas (80-120) ---
    if (minVal < 120 && maxVal > 80) {
        const y80 = padding.top + plotH - ((Math.max(80, minVal) - minVal) / range) * plotH;
        const y120 = padding.top + plotH - ((Math.min(120, maxVal) - minVal) / range) * plotH;
        // Clamp Y coords to plot area
        const topY = Math.max(padding.top, y120);
        const bottomY = Math.min(padding.top + plotH, y80);

        if (bottomY > topY) {
            ctx.fillStyle = 'rgba(200, 200, 200, 0.2)';
            ctx.fillRect(padding.left, topY, plotW, bottomY - topY);
        }
    }

    // --- Reference Lines ---
    const drawRef = (val, color, dashed) => {
        if (val >= minVal && val <= maxVal) {
            const y = padding.top + plotH - ((val - minVal) / range) * plotH;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.setLineDash(dashed ? [5, 5] : []);
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + plotW, y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = color;
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'right';
            ctx.fillText(val, padding.left - 5, y + 3);
        }
    };
    drawRef(80, '#ffa94d', true);
    drawRef(100, '#ff6b6b', true);
    drawRef(120, '#51cf66', true);

    // --- Data Line ---
    ctx.strokeStyle = '#339af0';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    // Store point coordinates for interaction
    const points = [];

    visibleSeries.forEach((d, i) => {
        const x = padding.left + (i / (visibleCount - 1)) * plotW;
        const y = padding.top + plotH - ((d.value - minVal) / range) * plotH;

        points.push({ x, y, data: d, globalIdx: startIdx + i });
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Last Point Dot
    if (points.length > 0) {
        const lastP = points[points.length - 1];
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.arc(lastP.x, lastP.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // --- X-Axis Labels ---
    const tickCount = 6;
    for (let i = 0; i <= tickCount; i++) {
        const idx = Math.round((i / tickCount) * (visibleCount - 1));
        if (visibleSeries[idx]) {
            const dateObj = new Date(visibleSeries[idx].date);
            // Format: YY.MM (e.g. 24.12)
            const yy = String(dateObj.getFullYear()).slice(-2);
            const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
            const labelStr = `${yy}.${mm}`;

            const x = padding.left + (idx / (visibleCount - 1)) * plotW;
            ctx.fillStyle = '#666';
            ctx.textAlign = 'center';
            ctx.fillText(labelStr, x, h - padding.bottom + 20);

            // Grid line
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, h - padding.bottom);
            ctx.strokeStyle = '#e9ecef';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    // Draw Hover Tooltip and Crosshair
    if (state.hoveredIndex !== null && state.hoveredIndex >= 0 && state.hoveredIndex < values.length) {
        const hoverVal = values[state.hoveredIndex];
        const hoverDate = visibleSeries[state.hoveredIndex].date;
        const hX = padding.left + (state.hoveredIndex / (visibleCount - 1)) * plotW;
        const hY = padding.top + plotH - (hoverVal - minVal) / range * plotH;

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(hX, padding.top);
        ctx.lineTo(hX, h - padding.bottom);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        // Dot
        ctx.beginPath();
        ctx.arc(hX, hY, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ff0000';
        ctx.fill();

        // Tooltip
        const dateStr = new Date(hoverDate).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
        const tooltipText = `${dateStr}  ${hoverVal.toFixed(2)}%`;

        ctx.font = '12px Arial'; // Use Arial for better consistency
        const textWidth = ctx.measureText(tooltipText).width + 24; // More padding

        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'; // Slightly more transparent
        let tX = hX + 10;
        if (tX + textWidth > w) tX = hX - textWidth - 10;

        const tH = 26; // Slightly taller
        const tY = hY - tH - 10; // Position above the dot

        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(tX, tY, textWidth, tH, 4);
            ctx.fill();
        } else {
            ctx.fillRect(tX, tY, textWidth, tH);
        }

        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tooltipText, tX + 12, tY + tH / 2);

        // Reset for other drawings
        ctx.textBaseline = 'alphabetic';
    }

    // --- SCROLLBAR ---
    // Draw horizontal scrollbar at bottom
    const totalDataCount = data.length;
    if (totalDataCount > 0) {
        const barHeight = 6;
        const barY = h - barHeight - 2;
        const barAreaX = 0;
        const barAreaW = w;

        // Background
        ctx.fillStyle = 'rgba(200, 200, 200, 0.2)';
        ctx.fillRect(barAreaX, barY, barAreaW, barHeight);

        // Thumb
        const viewRatio = Math.min(visibleCount / totalDataCount, 1);
        const scrollRatio = state.scrollOffset / totalDataCount;

        let thumbW = Math.max(20, viewRatio * barAreaW);
        let thumbX = scrollRatio * barAreaW;

        // Clamp
        thumbX = Math.max(0, Math.min(thumbX, barAreaW - thumbW));

        ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
        ctx.beginPath();
        ctx.roundRect(thumbX, barY, thumbW, barHeight, 3);
        ctx.fill();

        // Check if mouse is hovering scrollbar to highlight? (Optional implementation)
        // Store scrollbar rect for hit testing
        state.scrollbar = {
            x: thumbX,
            y: barY,
            width: thumbW,
            height: barHeight,
            areaWidth: barAreaW
        };
    } else {
        state.scrollbar = null;
    }

    // --- Current Value / Header ---
    // Determine the item to display in header
    // If we are essentially at the end, we want the absolute LATEST.
    const currentMaxOffset = Math.max(0, data.length - visibleCount);
    const isCurrentlyAtEnd = state.scrollOffset >= currentMaxOffset - 1.0;

    let latestItem;
    // If hovered, show hovered item in header too
    if (state.hoveredIndex !== null && visibleSeries[state.hoveredIndex]) {
        latestItem = visibleSeries[state.hoveredIndex];
    } else if (isCurrentlyAtEnd || visibleSeries.length === 0) {
        latestItem = data[data.length - 1];
    } else {
        latestItem = visibleSeries[visibleSeries.length - 1];
    }

    if (latestItem) {
        const lastDateStr = new Date(latestItem.date).toLocaleDateString();
        const absLatestDateStr = new Date(data[data.length - 1].date).toLocaleDateString();
        // Use a hidden log or low-priority log to avoid spamming too much during drag
        // Only log if it's a "snap" change or every few updates?
        if (state.scrollOffset % 10 === 0) {
            console.log(`🏷️ [Header:${label}] Showing: ${lastDateStr}, AbsLatest: ${absLatestDateStr}, isAtEnd: ${isCurrentlyAtEnd}`);
        }
    }

    // Or just show Latest always in the corner, and Tooltip shows hovered?
    // User requested "mouse overlap data". Tooltip covers this.

    // Header
    ctx.textAlign = 'left';
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px Arial';
    ctx.fillText(`${label}`, padding.left, 30);

    // Latest Value
    let valColor = '#868e96';
    if (latestItem.value >= 120) valColor = '#51cf66';
    else if (latestItem.value >= 100) valColor = '#74c0fc';
    else if (latestItem.value >= 80) valColor = '#ffa94d';
    else valColor = '#ff6b6b';

    ctx.textAlign = 'right';
    ctx.fillStyle = valColor;
    ctx.font = 'bold 24px Arial';
    ctx.fillText(latestItem.value.toFixed(2), w - padding.right, 30);

    ctx.font = '12px Arial';
    ctx.fillStyle = '#666';
    const lastDate = new Date(latestItem.date);
    ctx.fillText(`${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}-${String(lastDate.getDate()).padStart(2, '0')}`, w - padding.right, 45);

    // --- Event Handlers (One-time) ---
    if (!canvas.hasInteraction) {
        canvas.hasInteraction = true;

        // Mouse Move (Hover + Drag)
        canvas.addEventListener('mousemove', e => {
            const rect = canvas.getBoundingClientRect();
            // Store raw event data for the RAF loop
            canvas.chartState.lastEvent = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
                rect: rect
            };

            if (canvas.chartState.pendingFrame) return;

            canvas.chartState.pendingFrame = true;
            requestAnimationFrame(() => {
                // Read LATEST state from shared variable
                const lastEv = canvas.chartState.lastEvent;
                if (!lastEv) {
                    canvas.chartState.pendingFrame = false;
                    return;
                }

                const x = lastEv.x;
                const rect = lastEv.rect;
                const activeData = canvas.chartData || data;
                const activeLabel = canvas.chartLabel || label;
                const currentVisibleCount = canvas.chartState.visibleCount;

                if (canvas.chartState.isScrollDragging) {
                    // --- Scrollbar Dragging ---
                    const dx = x - canvas.chartState.lastX;
                    canvas.chartState.lastX = x; // update for next delta

                    const totalDataCount = activeData.length;
                    const barAreaW = canvas.chartState.scrollbar ? canvas.chartState.scrollbar.areaWidth : w;

                    const scrollRatioChange = dx / barAreaW;
                    const offsetChange = scrollRatioChange * totalDataCount;

                    canvas.chartState.scrollOffset += offsetChange;
                    drawLineChart(canvas, activeData, activeLabel, currentVisibleCount);
                    if (canvas.syncCallback) canvas.syncCallback(canvas.chartState);

                } else if (canvas.chartState.isDragging) {
                    // --- Chart Panning ---
                    const dx = x - canvas.chartState.lastX;
                    canvas.chartState.lastX = x;

                    const moveCount = -dx / (plotW / currentVisibleCount);
                    canvas.chartState.scrollOffset += moveCount;
                    drawLineChart(canvas, activeData, activeLabel, currentVisibleCount);
                    if (canvas.syncCallback) canvas.syncCallback(canvas.chartState);

                } else {
                    // Hover calculation
                    if (canvas.chartState.scrollbar &&
                        x >= canvas.chartState.scrollbar.x && x <= canvas.chartState.scrollbar.x + canvas.chartState.scrollbar.width &&
                        (lastEv.y) >= canvas.chartState.scrollbar.y - 5) {
                        canvas.style.cursor = 'pointer';
                    } else {
                        canvas.style.cursor = 'default';
                    }

                    if (x >= padding.left && x <= w - padding.right) {
                        const ratio = (x - padding.left) / plotW;
                        const idx = Math.round(ratio * (currentVisibleCount - 1));
                        if (idx >= 0 && idx < currentVisibleCount) {
                            canvas.chartState.hoveredIndex = idx;
                            drawLineChart(canvas, activeData, activeLabel, currentVisibleCount);
                            if (canvas.syncCallback) canvas.syncCallback(canvas.chartState);
                        }
                    } else {
                        if (canvas.chartState.hoveredIndex !== null) {
                            canvas.chartState.hoveredIndex = null;
                            drawLineChart(canvas, activeData, activeLabel, currentVisibleCount);
                            if (canvas.syncCallback) canvas.syncCallback(canvas.chartState);
                        }
                    }
                }
                canvas.chartState.pendingFrame = false;
            });
        });

        // Mouse Down (Start Drag)
        canvas.addEventListener('mousedown', e => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // 1. Check Scrollbar Hit
            if (canvas.chartState.scrollbar) {
                const sb = canvas.chartState.scrollbar;
                // Add some padding to hit area (e.g. +/- 5px)
                if (x >= sb.x && x <= sb.x + sb.width && y >= sb.y - 5 && y <= sb.y + sb.height + 5) {
                    canvas.chartState.isScrollDragging = true;
                    canvas.chartState.lastX = x;
                    return; // Don't trigger chart drag
                }
            }

            // 2. Check Chart Area Hit (Panning)
            if (x >= padding.left && x <= w - padding.right) {
                canvas.chartState.isDragging = true;
                canvas.chartState.lastX = x;
                canvas.style.cursor = 'grabbing';
            }
        });

        // Mouse Up / Leave
        const stopDrag = () => {
            canvas.chartState.isDragging = false;
            canvas.chartState.isScrollDragging = false;
            canvas.style.cursor = 'default';
        };
        canvas.addEventListener('mouseup', stopDrag);
        canvas.addEventListener('mouseleave', stopDrag);

        // Wheel (Scroll)
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const activeData = canvas.chartData || data;
            const activeLabel = canvas.chartLabel || label;
            if (!activeData.length) return;
            const state = canvas.chartState;
            const rect = canvas.getBoundingClientRect();
            const localX = e.clientX - rect.left;
            const pointerRatio = Math.max(0, Math.min(1, (localX - padding.left) / plotW));
            const previousCount = state.visibleCount;
            const anchorIndex = Math.max(0, Math.min(activeData.length - 1,
                Math.round(state.scrollOffset + pointerRatio * (previousCount - 1))));
            const zoomFactor = e.deltaY > 0 ? 1.2 : 0.8;
            const nextCount = Math.max(30, Math.min(activeData.length, Math.round(previousCount * zoomFactor)));
            state.visibleCount = nextCount;
            state.scrollOffset = anchorIndex - pointerRatio * (nextCount - 1);
            state.hoveredIndex = null;
            requestAnimationFrame(() => {
                const latestData = canvas.chartData || activeData;
                const latestLabel = canvas.chartLabel || activeLabel;
                drawLineChart(canvas, latestData, latestLabel, nextCount);
                if (canvas.syncCallback) canvas.syncCallback(state);
            });
        }, { passive: false });
    }


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

    // --- ADR Period Buttons ---
    const periodBtn = e.target.closest('.period-btn');
    if (periodBtn) {
        const period = periodBtn.dataset.period;
        const fullData = tabData[ADR_TAB_ID]?.adr;
        if (!fullData) return;

        document.querySelectorAll('.adr-chart-wrapper').forEach(wrapper => {
            wrapper.querySelectorAll('.period-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.period === period);
            });
        });

        const days = { '6m': 120, '1y': 240, '2y': 480, '5y': 1200, '10y': 2400 }[period] || 240;
        const c1 = document.getElementById('adr_kospi');
        const c2 = document.getElementById('adr_kosdaq');

        if (c1 && fullData && fullData.kospi) {
            c1.chartState.scrollOffset = Math.max(0, fullData.kospi.length - days);
            drawLineChart(c1, fullData.kospi, 'K ADR', days);
        }
        if (c2 && fullData && fullData.kosdaq) {
            c2.chartState.scrollOffset = Math.max(0, fullData.kosdaq.length - days);
            drawLineChart(c2, fullData.kosdaq, 'Q ADR', days);
        }
        return;
    }

    // --- Manual Refresh Buttons ---
    const rankRefreshBtn = e.target.closest('#manualRefresh');
    if (rankRefreshBtn) {
        console.log('[Click] Rank 조회 버튼 클릭');
        loadData();
        loadTransactionRank();
        loadWatchlistRank();
        window.refreshConcentrationChart?.();
        return;
    }

    const adrRefreshBtn = e.target.closest('.adr-update-btn') || e.target.closest('#adrManualRefresh');
    if (adrRefreshBtn) {
        console.log('[Click] ADR 조회 버튼 클릭 감지');
        updateAdrFromSource();
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

document.body.addEventListener('change', function (e) {
    if (e.target.id === 'adrRefreshInterval') {
        console.log('[ADR] 새로고침 간격 변경');
        lastSavedSettings.adrInterval = e.target.value;
        updateAdrFromSource();
        startAdrAutoRefresh();
        saveAppData();
    }
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
        const offset = e.clientX - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) { return { offset: offset, element: child }; } else { return closest; }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
    if (afterElement == null) { tabsWrapper.appendChild(draggedItem); } else { tabsWrapper.insertBefore(draggedItem, afterElement); }
});

addTabBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    addTabMenu.style.display = "block";
    addTabMenu.style.left = e.pageX + "px";
    addTabMenu.style.top = e.pageY + "px";
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

    if (statusText) statusText.textContent = '데이터 로딩 중...';

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
            if (statusText) statusText.textContent = '데이터 로딩 완료';
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
    window.refreshConcentrationChart?.();

    // 2. ADR 탭
    updateAdrFromSource();

    // 4. 기타 동적 탭들
    Object.keys(tabData).forEach(tabId => {
        const wasEmpty = initializeTab(tabId);
        const type = tabData[tabId]?.type;

        // Custom/Exchange/ADR are already refreshed inside initializeTab(tabId) if wasEmpty.
        // For others (Earnings, Dynamic iframes), we proceed to refresh.
        if (wasEmpty && (tabId === ADR_TAB_ID || type === 'overseas_custom' || type === 'exchange_rate')) return;

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

    if (statusText) statusText.textContent = '데이터 로딩 중...';

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
            if (statusText) statusText.textContent = '데이터 로딩 완료';
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
    const today = centralBanksToday();
    if (!forceRefresh && frame.dataset.loadedDate === today) return;
    const loading = document.getElementById(`centralBanksFrameLoading_${tabId}`);
    const status = document.getElementById(`earningsStatusText_${tabId}`);
    const lastUpdate = document.getElementById(`earningsLastUpdate_${tabId}`);
    const isSelected = () => document.getElementById(`iframeEarnings_${tabId}`)?.dataset.calendarSource === 'investing';
    clearTimeout(frame.loadingTimer);
    if (loading) loading.hidden = false;
    if (isSelected() && status) status.textContent = 'Investing.com 페이지 접속 중…';
    frame.onload = () => {
        clearTimeout(frame.loadingTimer);
        if (loading) loading.hidden = true;
        // Cross-origin frames do not expose their HTTP status or page contents.
        if (isSelected() && status) status.textContent = 'iframe 표시 · 빈 화면이면 원본 사이트에서 확인해 주세요';
    };
    frame.dataset.loadedDate = today;
    frame.src = 'https://kr.investing.com/central-banks/';
    if (lastUpdate) lastUpdate.textContent = formatTime(new Date());
    frame.loadingTimer = setTimeout(() => {
        if (loading) loading.hidden = true;
        if (isSelected() && status) status.textContent = '응답 대기 중 · 표시되지 않으면 원본 사이트에서 확인해 주세요';
    }, 20000);
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
        if (status) status.textContent = '캘린더 표시 중 (당일 페이지 유지)';
        if (lastUpdate) lastUpdate.textContent = frame.dataset.requestedAt;
        return;
    }
    frame.dataset.loadedDate = centralBanksToday();
    frame.dataset.requestedAt = formatTime(new Date());
    frame.onload = () => {
        if (metadata.dataset.calendarSource === sourceId && status) status.textContent = '캘린더 표시 중';
    };
    if (status) status.textContent = '캘린더 접속 중…';
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
    iframe.hidden = sourceId !== 'toss';
    const seibroFrame = document.getElementById(`iframeEarningsSeibro_${tabId}`);
    if (seibroFrame) seibroFrame.hidden = sourceId !== 'seibro';
    const framePanel = document.getElementById(`centralBanksFramePanel_${tabId}`);
    if (framePanel) framePanel.hidden = sourceId !== 'investing';
    if (sourceId !== 'investing') {
        const status = document.getElementById(`earningsStatusText_${tabId}`);
        if (status) status.textContent = '캘린더 표시 중';
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
                if (file.filename !== 'autosaved_user_settings.json') row.append(deleteButton);
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
        if (id !== PERM_TAB_ID && id !== ADR_TAB_ID && id !== EARNINGS_TAB_ID && id !== BASE_INTEREST_TAB_ID && id !== US_TAB_ID && id !== MEMO_TAB_ID) {
            btn.remove();
            const content = document.getElementById(id);
            if (content) content.remove();
        }
    });

    // 3. 탭 버튼 및 컨텐츠 재생성 (JSON에 기록된 순서대로)
    if (data.tabs && Array.isArray(data.tabs)) {
        data.tabs.forEach(tab => {
            if (tab.id !== PERM_TAB_ID && tab.id !== ADR_TAB_ID && tab.id !== EARNINGS_TAB_ID && tab.id !== BASE_INTEREST_TAB_ID && tab.id !== US_TAB_ID && tab.id !== MEMO_TAB_ID) {
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
    }
    const adrSelect = document.getElementById('adrRefreshInterval');
    if (adrSelect && data.adrInterval) {
        adrSelect.value = data.adrInterval === '4' ? '5' : data.adrInterval;
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



// Base interest charts are held only in browser memory, never in settings JSON.
let baseInterestCache = null;
let baseInterestRequest = null;
function renderBaseInterestCharts(result) {
    const grid = document.getElementById('baseInterestGrid');
    if (!grid) return;
    const count = result.charts?.filter(chart => chart.image).length || 0;
    const stages = { waiting: '브라우저 실행 대기 중...', browser: '캡처 브라우저 시작 중...', navigation: 'Investing.com 접속 중...', section: '금리 차트 영역 확인 중...', chart: `${result.bank || ''} 차트 조회 중...`, closing: '캡처 마무리 중...' };
    grid.setAttribute('aria-busy', String(result.status === 'loading'));
    const status = document.getElementById('baseInterestStatus');
    if (status) status.textContent = result.refreshError || result.error || (result.status === 'loading' ? `${stages[result.stage] || '화면 로딩 중...'} (${count}/12)` : result.status === 'partial' ? `일부 조회 실패 (${count}/12) — 새로고침으로 다시 시도해 주세요.` : '조회 완료 (12/12)');
    const updated = document.getElementById('baseInterestLastUpdate');
    if (updated && result.capturedAt) updated.textContent = new Date(result.capturedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    BASE_INTEREST_BANKS.forEach(bank => {
        const chart = result.charts?.find(item => item.code === bank.code);
        const panel = grid.querySelector(`[data-bank-code="${bank.code}"] .base-interest-chart`);
        if (!panel) return;
        if (chart?.image && /^data:image\/png;base64,/.test(chart.image)) {
            if (panel.dataset.image === chart.image) return;
            const token = Symbol(); panel.renderToken = token;
            const image = new Image();
            image.alt = `${bank.code} (${bank.name}) 기준금리 차트`;
            image.src = chart.image;
            image.decode().then(() => {
                if (panel.isConnected && panel.renderToken === token) { panel.replaceChildren(image); panel.dataset.image = chart.image; }
            }).catch(() => {
                if (panel.renderToken !== token) return;
                panel.replaceChildren(Object.assign(document.createElement('p'), { textContent: '차트 이미지를 표시하지 못했습니다. 새로고침해 주세요.' }));
            });
        } else {
            panel.renderToken = null;
            delete panel.dataset.image;
            const message = document.createElement('p');
            message.setAttribute('role', 'status');
            message.textContent = chart?.error || result.error || '화면 로딩 중...';
            panel.replaceChildren(message);
        }
    });
}
async function loadBaseInterestCharts(forceRefresh = false) {
    if (isCapturing) return;
    if (baseInterestRequest) return baseInterestRequest;
    if (!forceRefresh && baseInterestCache?.date === centralBanksToday()) {
        renderBaseInterestCharts(baseInterestCache); return;
    }
    renderBaseInterestCharts({ status: 'loading', charts: [] });
    let lastProgress = null;
    baseInterestRequest = (async () => {
        let force = forceRefresh;
        let consecutiveFailures = 0;
        const deadline = Date.now() + 360000;
        while (Date.now() < deadline) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), Math.min(45000, Math.max(1, deadline - Date.now())));
            let response, result;
            const url = `/api/base-interest/charts${force ? '?force_refresh=true' : ''}`;
            // A lost response may still have started the job. Subsequent polls must not force a second run.
            force = false;
            try {
                response = await fetch(url, { cache: 'no-store', signal: controller.signal });
                result = await response.json().catch(error => {
                    if ([502, 503, 504].includes(response.status)) throw new TypeError('일시적인 서버 응답 오류');
                    throw error;
                });
                consecutiveFailures = 0;
            } catch (error) {
                if (controller.signal.aborted || error.name === 'AbortError' || error instanceof TypeError) {
                    if (++consecutiveFailures <= 3 && Date.now() < deadline) {
                        const status = document.getElementById('baseInterestStatus');
                        if (status) status.textContent = `서버 응답이 지연되어 다시 확인 중... (${consecutiveFailures}/3)`;
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        continue;
                    }
                    throw new Error('서버 응답이 지연되거나 연결이 끊겼습니다. 잠시 후 새로고침해 주세요.');
                }
                throw error;
            } finally { clearTimeout(timeout); }
            if (![200, 202, 502].includes(response.status) || !Array.isArray(result.charts)) throw new Error(result.error || `기준금리 조회 실패 (HTTP ${response.status})`);
            lastProgress = result;
            renderBaseInterestCharts(result);
            if (result.status !== 'loading') {
                if (result.status === 'error') throw new Error(result.error || '기준금리 차트 조회에 실패했습니다.');
                baseInterestCache = result; return;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        throw new Error('기준금리 차트 조회 시간이 초과되었습니다. 새로고침해 주세요.');
    })().catch(error => {
        console.error('[Base Interest]', error);
        if (baseInterestCache?.date === centralBanksToday()) renderBaseInterestCharts({ ...baseInterestCache, refreshError: error.message });
        else if (lastProgress?.charts?.some(chart => chart.image)) renderBaseInterestCharts({ ...lastProgress, status: 'partial', refreshError: error.message });
        else renderBaseInterestCharts({ status: 'error', error: error.message, charts: [] });
    }).finally(() => { baseInterestRequest = null; });
    return baseInterestRequest;
}
