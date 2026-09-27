// End-to-end check with real browsers against a running Worlds client+server.
//
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
//   TEST_URL=http://localhost:5174 ARTIFACTS=/tmp/worlds-e2e node test/e2e.mjs
//
// Playwright is not a dependency of Worlds; point PLAYWRIGHT_MODULE at any
// install. CHROMIUM_PATH optionally selects the browser binary.
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ?? 'playwright/index.mjs').href);
const url = process.env.TEST_URL ?? 'http://localhost:5174';
const artifacts = process.env.ARTIFACTS ?? '/tmp/worlds-e2e';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=swiftshader',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});
const errors = [];
let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

async function client(label, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    window.__messages = []; window.__latest = {}; window.__ws = null;
    window.WebSocket = class extends Native {
      constructor(u, p) {
        super(u, p); window.__ws = this;
        this.addEventListener('message', (e) => {
          try { const m = JSON.parse(e.data); window.__latest[m.t] = m; window.__messages.push(m); if (window.__messages.length > 3000) window.__messages.shift(); } catch { /* ignore */ }
        });
      }
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.stack ?? e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__latest.welcome, undefined, { timeout: 60000 });
  return { page, context };
}
const latest = (page, t) => page.evaluate((t) => window.__latest[t] ?? null, t);
const shot = (page, name) => page.screenshot({ path: `${artifacts}/${name}.png` });

try {
  console.log('▸ two guests');
  const A = await client('A'), B = await client('B');
  const nameA = (await latest(A.page, 'welcome')).username, nameB = (await latest(B.page, 'welcome')).username;
  ok('each guest gets a generated name', /^[A-Z][a-z]+[A-Z][a-z]+\d+$/.test(nameA) && /^[A-Z][a-z]+[A-Z][a-z]+\d+$/.test(nameB));
  ok('the two names differ', nameA !== nameB, `${nameA} vs ${nameB}`);
  ok('the account chip shows the name', (await A.page.locator('#w-account-name').textContent()) === nameA);
  const bodyText = (await A.page.locator('#w-home').innerText()).toLowerCase();
  ok('the title never mentions ranked, bots or players online', !/rank|bot|online|leaderboard/.test(bodyText), bodyText.slice(0, 200));
  await shot(A.page, '01-title');

  console.log('▸ party of two plays The Bridge');
  await A.page.locator('#w-party-btn').click();
  await A.page.locator('[data-act="create"]').click();
  await A.page.waitForFunction(() => window.__latest.party?.party?.code);
  const code = (await latest(A.page, 'party')).party.code;
  ok('a party code is issued', /^[A-Z2-9]{6}$/.test(code), code);
  await shot(A.page, '02-party-created');
  await A.page.keyboard.press('Escape');
  await B.page.locator('#w-party-btn').click();
  await B.page.locator('#w-party-code').fill(code.toLowerCase());
  await B.page.locator('[data-act="join"]').click();
  await B.page.waitForFunction(() => window.__latest.party?.party?.members?.length === 2);
  ok('B joined by code (typed in lower case)', true);
  await shot(B.page, '03-party-joined');
  await B.page.keyboard.press('Escape');
  const bLabel = await B.page.locator('.w-card[data-mode="duels"] .w-card-label').textContent();
  ok('a member sees the leader pick', bLabel === 'Leader picks', bLabel);
  await A.page.locator('.w-card[data-mode="bridge"]').click();
  await Promise.all([A.page, B.page].map((p) => p.waitForFunction(() => window.__latest.pgState?.snapshot?.phase === 'running', undefined, { timeout: 90000 })));
  const worldA = (await latest(A.page, 'pgArena')).world, worldB = (await latest(B.page, 'pgArena')).world;
  ok('both are in the same Bridge world', worldA.id === worldB.id && worldA.kind === 'bridge');
  const teams = [(await latest(A.page, 'pgArena')).team, (await latest(B.page, 'pgArena')).team].sort().join(',');
  ok('on opposite teams', teams === '0,1', teams);
  await A.page.waitForTimeout(1500);
  await shot(A.page, '04-bridge');
  await A.page.locator('canvas.game').click({ position: { x: 720, y: 450 }, force: true });
  // Playwright's click drags the mouse across the page, which turns the head;
  // face down the span again before walking.
  const teamA = (await latest(A.page, 'pgArena')).team;
  await A.page.evaluate((team) => { window.__worlds.player.yaw = team === 0 ? Math.PI : 0; window.__worlds.player.pitch = 0; }, teamA);
  // Hold W until the body has moved: software-rendered headless Chrome can
  // run at a few frames per second, so a fixed hold proves nothing.
  const start = await A.page.evaluate(() => ({ ...window.__worlds.player.pos }));
  await A.page.keyboard.down('KeyW');
  await A.page.waitForFunction((s) => Math.hypot(window.__worlds.player.pos.x - s.x, window.__worlds.player.pos.z - s.z) > 1,
    start, { timeout: 10000 }).catch(() => {});
  await A.page.keyboard.up('KeyW');
  await A.page.waitForTimeout(400);
  await shot(A.page, '05-bridge-moved');
  const posA = await A.page.evaluate(() => ({ ...window.__worlds.player.pos }));
  ok('A can move in the world', Math.abs(posA.z - (await latest(A.page, 'pgArena')).spawn.z) > 0.5 || Math.abs(posA.x - (await latest(A.page, 'pgArena')).spawn.x) > 0.5,
    JSON.stringify(posA));
  const seesB = await A.page.evaluate(() => window.__worlds.net.remotes.size);
  ok('A sees exactly one other player (B)', seesB === 1, String(seesB));

  // Leaving puts both back on the menu (forfeit for the leaver).
  await A.page.keyboard.press('Escape');
  await A.page.waitForTimeout(300);
  await A.page.locator('#quit-btn').click();
  await A.page.waitForFunction(() => !document.getElementById('w-home').hidden, undefined, { timeout: 20000 });
  ok('leaving returns A to the title', true);
  await B.page.waitForFunction(() => window.__latest.pgResult, undefined, { timeout: 20000 });
  await shot(B.page, '06-bridge-result');
  const resultText = (await B.page.locator('.pg-card').innerText()).toLowerCase();
  ok('the result card has no ranked wording', !/rank/.test(resultText), resultText.slice(0, 160));
  await B.page.locator('.pg-result-btn:not(.primary)').click();
  await B.page.waitForFunction(() => !document.getElementById('w-home').hidden, undefined, { timeout: 20000 });
  ok('Menu returns B to the title', true);

  console.log('▸ solo queue fills after the wait, quietly');
  await B.page.locator('#w-party-btn').click();
  await B.page.locator('[data-act="leave"]').click();
  await B.page.keyboard.press('Escape');
  await B.page.locator('.w-card[data-mode="duels"]').click();
  await B.page.waitForTimeout(1200);
  const searching = await B.page.locator('.w-card[data-mode="duels"] .w-card-status-text').textContent();
  ok('the card says it is finding players', /^Finding players/.test(searching ?? ''), searching);
  await shot(B.page, '07-searching');
  await B.page.waitForFunction(() => window.__latest.duelState?.snapshot?.phase === 'running', undefined, { timeout: 60000 });
  const wire = await B.page.evaluate(() => JSON.stringify(window.__messages));
  ok('nothing on the wire says bot', !/"bot"|\[bot\]/i.test(wire));
  const myIdB = (await latest(B.page, 'welcome')).id;
  const opponent = (await latest(B.page, 'duelState')).snapshot.participants.find((p) => p.id !== myIdB);
  ok('the opponent has an ordinary generated name', !!opponent && /^[A-Z][a-z]+[A-Z][a-z]+\d+$/.test(opponent.username));
  await B.page.waitForTimeout(2500);
  await shot(B.page, '08-duel');
  const duelText = (await B.page.locator('body').innerText()).toLowerCase();
  ok('the Duels HUD never says bot or rank', !/\bbot\b|practice|ranked|\brp\b/.test(duelText));

  console.log('▸ accounts');
  await A.page.locator('#w-account-btn').click();
  await A.page.locator('[data-tab="create"]').click();
  await A.page.locator('#w-acct-pass').fill('hunter2hunter2');
  await A.page.locator('[data-act="create"]').click();
  await A.page.waitForFunction(() => window.__latest.identity?.account === true, undefined, { timeout: 20000 });
  ok('A keeps their temporary name as an account', (await latest(A.page, 'identity')).username === nameA);
  await A.page.reload({ waitUntil: 'domcontentloaded' });
  await A.page.waitForFunction(() => window.__latest.welcome, undefined, { timeout: 60000 });
  const back = await latest(A.page, 'welcome');
  ok('a reload resumes the signed-in account', back.account === true && back.username === nameA, JSON.stringify(back));
  await shot(A.page, '09-signed-in');

  console.log('▸ phones');
  const P = await client('phone', { width: 420, height: 820 });
  await P.page.waitForTimeout(1500);
  await shot(P.page, '10-phone');
  const overflow = await P.page.evaluate(() => document.getElementById('w-home').scrollWidth - document.getElementById('w-home').clientWidth);
  ok('no sideways scroll on a phone', overflow <= 1, String(overflow));
  const small = await client('small', { width: 1280, height: 620 });
  await small.page.waitForTimeout(1500);
  await shot(small.page, '11-short');
} catch (e) {
  failures++;
  console.log('ERROR', e);
} finally {
  if (errors.length) { console.log('Page errors:'); for (const e of errors.slice(0, 20)) console.log('  ', e); }
  await browser.close();
  console.log(failures || errors.length ? `FAILED (${failures} checks, ${errors.length} page errors)` : 'ALL PASSED');
  process.exit(failures || errors.length ? 1 : 0);
}
