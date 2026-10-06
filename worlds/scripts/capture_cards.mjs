// Renders the title screen's game-card art (src/cardart) into public/cards/.
// Requires Playwright/Chromium; they may live outside the project.
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome npm run cards
// Options: --only=bedwars,duels  (default: every card)
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public/cards');
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
/** [width, height, below]: Bedwars is the wide hero tile; the rest are 4:5
 *  portraits whose bottom fifth is extra ground under the title. */
const SIZE = { bedwars: [1800, 720, 0], duels: [800, 1000, 200], bridge: [800, 1000, 200], parkour: [800, 1000, 200], ratseek: [800, 1000, 200] };

const moduleURL = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright';
const { chromium } = await import(moduleURL);
await mkdir(out, { recursive: true });
let server, browser;
try {
  let base = process.env.TEST_URL;
  if (!base) {
    server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: Number(process.env.CARDS_PORT ?? 5185), strictPort: true } });
    await server.listen();
    base = `http://127.0.0.1:${server.config.server.port}`;
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  for (const [card, [w, h, below]] of Object.entries(SIZE)) {
    if (only && !only.includes(card)) continue;
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.setDefaultTimeout(240000);
    page.on('pageerror', e => console.error(e));
    await page.goto(`${base}/cardart.html?card=${card}&w=${w}&h=${h}&below=${below}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.ready === 'true' || document.body.dataset.error);
    const error = await page.evaluate(() => document.body.dataset.error);
    if (error) throw new Error(`${card}: ${error}`);
    const url = await page.evaluate(() => window.__cards.image('image/webp', .86));
    if (!url.startsWith('data:image/webp')) throw new Error(`${card}: browser could not encode WebP`);
    const file = path.join(out, `${card}.webp`);
    await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${path.relative(root, file)}  ${w}x${h}`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server?.close();
}
