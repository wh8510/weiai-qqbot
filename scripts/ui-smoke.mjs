/**
 * Optional UI smoke test. Uses the system Chrome via playwright-core, so it
 * does not download a browser.
 *
 *   node scripts/ui-smoke.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.BASE ?? 'http://127.0.0.1:18080';
const password = process.env.PASSWORD ?? 'DemoAdmin456!';
const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const outDir = path.resolve('artifacts');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('401 (Unauthorized)')) errors.push(`console: ${msg.text()}`);
});

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(outDir, 'login.png'), fullPage: true });
console.log('login title:', await page.title());

const inputs = page.locator('input');
await inputs.nth(0).fill('admin');
await inputs.nth(1).fill(password);
await page.getByRole('button', { name: '登录' }).click();
await page.waitForTimeout(1200);

// First-run password change screen.
if (await page.getByText('先改个密码').count()) {
  const pw = page.locator('input');
  await pw.nth(0).fill('DemoAdmin456!');
  await pw.nth(1).fill('DemoAdmin789!');
  await pw.nth(2).fill('DemoAdmin789!');
  await page.getByRole('button', { name: '保存并进入' }).click();
  await page.waitForTimeout(1000);
}

const pages = [
  ['dashboard', '总览'],
  ['models', '模型与密钥'],
  ['persona', '人格'],
  ['policy', '名单'],
  ['sessions', '会话'],
  ['memory', '记忆'],
  ['stickers', '表情包'],
  ['proactive', '主动行为'],
  ['usage', '用量与预算'],
  ['debug', '调试台'],
  ['settings', '系统设置'],
];

for (const [slug, label] of pages) {
  await page.goto(`${base}/#/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const h1 = await page.locator('h1').first().textContent().catch(() => '');
  await page.screenshot({ path: path.join(outDir, `${slug}.png`), fullPage: true });
  console.log(`${slug}: h1="${h1?.trim()}"`);
}

// End-to-end debug chat: same runtime, mock model, no QQ.
await page.goto(`${base}/#/debug`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
await page.locator('textarea').last().fill('今天好累');
await page.getByRole('button', { name: '发送' }).click();
await page.waitForTimeout(2200);
await page.screenshot({ path: path.join(outDir, 'debug-chat.png'), fullPage: true });
const bodyText = await page.locator('body').innerText();
if (!bodyText.includes('怎么了') && !bodyText.includes('加班')) {
  errors.push('debug chat did not render a reply');
}
console.log('debug reply rendered:', bodyText.includes('怎么了') || bodyText.includes('加班'));

await browser.close();
if (errors.length) {
  console.error('UI errors:');
  for (const e of errors) console.error(' ', e);
  process.exit(1);
}
console.log('UI smoke OK, screenshots in', outDir);
