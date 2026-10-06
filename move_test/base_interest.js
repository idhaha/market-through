const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const URL = 'https://kr.investing.com/central-banks/';

    const banks = [
        'BOK',
        'FED',
        'ECB',
        'BOE',
        'SNB',
        'RBA',
        'BOC',
        'BOJ',
        'CBR',
        'RBI',
        'PBOC',
        'BCB'
    ];

    const browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--no-sandbox'
        ]
    });

    const context = await browser.newContext({
        viewport: {
            width: 1400,
            height: 1200
        },
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/154.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // --------------------------------------------------
    // 팝업 닫기
    // --------------------------------------------------
    async function closePopup() {
        const selectors = [
            '[aria-label="Close"]',
            '[aria-label="닫기"]',
            'button[title="Close"]',
            'button[title="닫기"]',
            '.popupCloseIcon',
            '.closeIcon'
        ];

        for (const selector of selectors) {
            try {
                const elements = page.locator(selector);
                const count = await elements.count();

                for (let i = 0; i < count; i++) {
                    try {
                        if (await elements.nth(i).isVisible()) {
                            await elements.nth(i).click({
                                force: true,
                                timeout: 1000
                            });
                            await page.waitForTimeout(300);
                        }
                    } catch (e) {
                    }
                }
            } catch (e) {
            }
        }
    }

    // --------------------------------------------------
    // Highcharts 데이터 가져오기
    // --------------------------------------------------
    async function getChartData() {
        return await page.evaluate(() => {
            if (!window.Highcharts || !window.Highcharts.charts) {
                return null;
            }

            const result = [];

            for (const chart of window.Highcharts.charts) {
                if (!chart || !chart.series) {
                    continue;
                }

                const chartData = [];

                for (const series of chart.series) {
                    const points = [];

                    if (series.points) {
                        for (const point of series.points) {
                            points.push({
                                x: point.x,
                                y: point.y
                            });
                        }
                    }

                    chartData.push({
                        name: series.name,
                        points: points
                    });
                }

                result.push(chartData);
            }

            return result;
        });
    }

    // --------------------------------------------------
    // 현재 선택된 탭 확인
    // --------------------------------------------------
    async function getSelectedTab(interestSection) {
        try {
            const selected = interestSection
                .locator('ul.tabsForBox li.selected a')
                .first();

            if (await selected.count() === 0) {
                return '';
            }

            return (await selected.innerText()).trim();
        } catch (e) {
            return '';
        }
    }

    // --------------------------------------------------
    // 차트 변경 대기
    // --------------------------------------------------
    async function waitForChartChange(oldData, interestSection, bankCode) {
        const start = Date.now();

        while (Date.now() - start < 15000) {
            await page.waitForTimeout(300);

            const selected = await getSelectedTab(interestSection);

            if (selected !== bankCode) {
                continue;
            }

            const newData = await getChartData();

            if (!newData) {
                continue;
            }

            if (JSON.stringify(newData) !== JSON.stringify(oldData)) {
                return true;
            }
        }

        return false;
    }

    // --------------------------------------------------
    // 페이지 접속
    // --------------------------------------------------
    console.log('');
    console.log('======================================');
    console.log(' Investing.com 중앙은행 금리 차트 캡처');
    console.log('======================================');
    console.log('');

    console.log('[1] Investing.com 접속 중...');

    const response = await page.goto(URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
    });

    if (!response) {
        throw new Error('페이지 응답을 받지 못했습니다.');
    }

    console.log('    HTTP 상태:', response.status());

    if (response.status() >= 400) {
        throw new Error(
            '페이지 접속 실패. HTTP 상태 코드: ' +
            response.status()
        );
    }

    console.log('    접속 완료');
    console.log('');

    console.log('[2] 페이지 로딩 대기 중...');

    await page.waitForTimeout(5000);

    console.log('    로딩 완료');
    console.log('');

    // --------------------------------------------------
    // 금리 섹션 찾기
    // --------------------------------------------------
    const interestSection = page
        .locator('section#leftColumn')
        .first();

    if (await interestSection.count() === 0) {
        throw new Error('금리 섹션을 찾을 수 없습니다.');
    }

    // --------------------------------------------------
    // BOK 초기 상태 확인
    // --------------------------------------------------
    console.log('[3] 금리 차트 확인 중...');

    let chart = interestSection
        .locator('svg')
        .first();

    if (await chart.count() === 0) {
        throw new Error('차트 SVG를 찾을 수 없습니다.');
    }

    console.log('    차트 확인 완료');
    console.log('');

    // --------------------------------------------------
    // 각 중앙은행 캡처
    // --------------------------------------------------
    console.log('[4] 중앙은행별 차트 캡처 시작');
    console.log('');

    for (const bankCode of banks) {
        console.log('--------------------------------------');
        console.log(bankCode + ' 처리 중...');

        // 현재 Highcharts 데이터 저장
        const oldData = await getChartData();

        // 해당 섹션 안의 탭만 찾음
        const tab = interestSection
            .getByText(bankCode, {
                exact: true
            })
            .first();

        if (await tab.count() === 0) {
            console.log('    [실패] 탭을 찾을 수 없습니다.');
            continue;
        }

        // 클릭
        try {
            await tab.scrollIntoViewIfNeeded();

            await tab.click({
                force: true,
                timeout: 10000
            });
        } catch (e) {
            console.log('    [실패] 클릭 실패');
            console.log('    ' + e.message);
            continue;
        }

        // 차트 변경 대기
        const changed = await waitForChartChange(
            oldData,
            interestSection,
            bankCode
        );

        if (!changed) {
            console.log('    [경고] 차트 변경 확인 시간 초과');
        } else {
            console.log('    차트 변경 확인');
        }

        // 팝업이 나타났다면 닫기
        await closePopup();

        // 잠시 안정화
        await page.waitForTimeout(500);

        // SVG 다시 찾기
        chart = interestSection
            .locator('svg')
            .first();

        if (await chart.count() === 0) {
            console.log('    [실패] SVG 차트를 찾을 수 없습니다.');
            continue;
        }

        // SVG가 실제로 보이는지 확인
        try {
            await chart.waitFor({
                state: 'visible',
                timeout: 5000
            });
        } catch (e) {
            console.log('    [실패] 차트가 표시되지 않았습니다.');
            continue;
        }

        // 파일명
        const fileName = bankCode + '.png';

        // 캡처
        try {
            await chart.screenshot({
                path: fileName,
                animations: 'disabled'
            });

            console.log('    저장 완료: ' + fileName);
        } catch (e) {
            console.log('    [실패] 캡처 실패');
            console.log('    ' + e.message);
        }

        // 다음 차트 전 잠시 대기
        await page.waitForTimeout(500);
    }

    // --------------------------------------------------
    // 종료
    // --------------------------------------------------
    console.log('');
    console.log('======================================');
    console.log(' 모든 차트 캡처 완료');
    console.log('======================================');
    console.log('');

    console.log('생성된 파일:');

    for (const bankCode of banks) {
        if (fs.existsSync(bankCode + '.png')) {
            const size = fs.statSync(bankCode + '.png').size;

            console.log(
                '  ' +
                bankCode +
                '.png  (' +
                size +
                ' bytes)'
            );
        }
    }

    console.log('');

    await browser.close();
})();