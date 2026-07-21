const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const url = 'https://m.place.naver.com/hospital/13258169/home';
  const outDir = path.join(process.cwd(), 'logs', 'manual-probe');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  });
  const started = Date.now();
  const result = { url, ok: false };
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    result.httpStatus = response && response.status();
    result.finalUrl = page.url();
    result.title = await page.title().catch(() => null);
    result.ok = true;
    result.elapsedMs = Date.now() - started;
    result.bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 1000);
    result.isLimited = /서비스 이용이 제한|과도한 접근|제한되었습니다/.test(result.bodyText);

    const selectors = {
      bookingHrefAny: 'a[href*="booking"]',
      bookingHrefSlash: 'a[href*="/booking"]',
      bookingButton: 'a[role="button"]:has-text("예약"), button:has-text("예약"), a.D_Xqt:has-text("예약")',
      anyReserveText: 'text=예약',
      placeName: 'text=대추밭백한의원',
    };
    result.counts = {};
    for (const [name, selector] of Object.entries(selectors)) {
      result.counts[name] = await page.locator(selector).count().catch(e => `ERR:${e.message}`);
    }
    await page.screenshot({ path: path.join(outDir, 'naver-place-home.png'), fullPage: true }).catch(e => { result.screenshotError = e.message; });
  } catch (e) {
    result.error = e && e.stack || String(e);
  } finally {
    await browser.close().catch(() => {});
  }
  fs.writeFileSync(path.join(outDir, 'probe-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    ok: result.ok,
    httpStatus: result.httpStatus,
    finalUrl: result.finalUrl,
    title: result.title,
    elapsedMs: result.elapsedMs,
    isLimited: result.isLimited,
    counts: result.counts,
    bodyText: result.bodyText,
    error: result.error,
    screenshot: path.join(outDir, 'naver-place-home.png'),
    resultFile: path.join(outDir, 'probe-result.json'),
  }, null, 2));
})();
