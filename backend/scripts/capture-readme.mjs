import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch(process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1, timezoneId: 'UTC' });
  await page.goto('http://127.0.0.1:48763/research-deadlines/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => [...document.querySelectorAll('.timer')].every(el => el.textContent.trim()));
  await page.screenshot({ path: fileURLToPath(new URL('../../docs/images/tracker.png', import.meta.url)) });
} finally {
  await browser.close();
}
