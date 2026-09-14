/**
 * scripts/debug-page.mjs — расширенная диагностика загрузки.
 */
import { chromium } from 'playwright-core';

const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({
  executablePath: EXE, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text().slice(0, 400)));
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 600)));
page.on('requestfailed', (r) => console.log('[requestfailed]', r.url(), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.log('[http', r.status() + ']', r.url()); });
await page.goto('http://127.0.0.1:5199/?debug=1', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 8000));
console.log('GK:', await page.evaluate(() => !!window.__GK));
console.log('resources:', await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name.split('/').slice(-2).join('/')).join('\n')));
console.log('body html head:', await page.evaluate(() => document.body.innerHTML.slice(0, 300)));
await page.screenshot({ path: 'shots/debug-page.png' });
await browser.close();
