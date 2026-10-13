// Renders the title screen's game-card art (src/cardart) into public/cards/.
// Requires Playwright/Chromium; they may live outside the project.
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome npm run cards
// Options: --only=bedwars,duels  (default: every card)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root, browserSession, observeErrors, assertBrowserErrors, selection } from './browser_session.mjs';

const args = process.argv.slice(2);
if (args.some(a => !/^--(only|output)=.+$/.test(a)) || new Set(args.map(a => a.split('=')[0])).size !== args.length) throw new Error('Options: --only=bedwars,duels --output=<directory>');
const out = path.resolve(root, args.find(a => a.startsWith('--output='))?.slice(9) ?? 'public/cards');
/** [width, height, below]: Bedwars is the wide hero tile; the rest are 4:5
 *  portraits whose bottom fifth is extra ground under the title. */
const SIZE = { bedwars: [1800, 720, 0], duels: [800, 1000, 200], bridge: [800, 1000, 200], parkour: [800, 1000, 200], ratseek: [800, 1000, 200] };
const onlyArg = args.find(a => a.startsWith('--only='));
const only = onlyArg ? selection('only', onlyArg.slice(7), Object.keys(SIZE)) : Object.keys(SIZE);

await mkdir(out, { recursive: true });
const session = await browserSession({ port: process.env.CARDS_PORT ?? 5185 });
const { browser, base } = session;
const errors = [];
try {
  for (const [card, [w, h, below]] of Object.entries(SIZE)) {
    if (only && !only.includes(card)) continue;
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.setDefaultTimeout(240000);
    observeErrors(page, errors, `${card}: `);
    await page.goto(`${base}/cardart.html?card=${card}&w=${w}&h=${h}&below=${below}&shaders=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.ready === 'true' || document.body.dataset.error);
    const error = await page.evaluate(() => document.body.dataset.error);
    if (error) throw new Error(`${card}: ${error}`);
    const url = await page.evaluate(() => window.__cards.image('image/webp', .86));
    if (!url.startsWith('data:image/webp')) throw new Error(`${card}: browser could not encode WebP`);
    assertBrowserErrors(errors);
    const file = path.join(out, `${card}.webp`);
    await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${path.relative(root, file)}  ${w}x${h}`);
    await page.close();
  }
  assertBrowserErrors(errors);
} finally {
  await session.close();
}
