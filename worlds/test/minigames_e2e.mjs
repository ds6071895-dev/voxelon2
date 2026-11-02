// Real browser + a socket peer: Party Games through the actual websocket
// server. A party of two opens the host sheet, builds a playlist in the
// editor, saves & plays it, sees the briefing card, Brain Rush's board, the
// results card, the arena swap to the next game and the podium's final card.
// Screenshots go to ARTIFACTS (default ./node_modules/.tmp/browser-check/minigames).
//
//   npm run server &  npx vite --port 5174 &
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node test/minigames_e2e.mjs
// WS_URL points the page (via ?ws=<port>) and the peer at another game server (default ws://localhost:8090).
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { artifactDirectory, browserSession, observeErrors, assertBrowserErrors } from '../scripts/browser_session.mjs';

const WS = process.env.WS_URL ?? 'ws://localhost:8090';
const artifacts = await artifactDirectory('minigames');
const session = await browserSession({ base: process.env.TEST_URL ?? 'http://localhost:5174' });
const { browser, base: url } = session;
const errors = [];
let peer;
const wait = async (predicate, timeout = 20000) => {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for socket state'); await new Promise(r => setTimeout(r, 40)); }
};
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: .5 });
  await context.addInitScript(() => {
    localStorage.setItem('worlds.accessibility', JSON.stringify({ graphicsQuality: 'medium' }));
    const Native = window.WebSocket; window.__latest = {}; window.__seen = {};
    window.WebSocket = class extends Native {
      constructor(...a) {
        super(...a);
        this.addEventListener('message', e => {
          const m = JSON.parse(e.data);
          if (!m.t) return;
          window.__latest[m.t] = m;
          if (m.t === 'm' && m.d.k === 'state') { window.__mg = m.d.s; window.__seen[`${m.d.s.phase}:${m.d.s.game}`] = true; }
        });
      }
    };
  });
  const page = await context.newPage();
  observeErrors(page, errors);
  const wsPort = new URL(WS).port;
  await page.goto(wsPort && wsPort !== '8090' ? `${url}/?ws=${wsPort}` : url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__worlds && window.__latest.welcome, undefined, { timeout: 60000 });
  const shot = async name => page.screenshot({ path: `${artifacts}/${name}.png` });

  // A second human joins the party.
  peer = new WebSocket(WS); const B = { latest: {}, seed: -1 };
  peer.on('message', raw => {
    const m = JSON.parse(String(raw)); B.latest[m.t] = m;
    if (m.t === 'mArena' && m.world.seed !== B.seed) { B.seed = m.world.seed; peer.send(JSON.stringify({ t: 'worldReady', world: m.world.id })); }
  });
  await new Promise(r => peer.once('open', r)); peer.send(JSON.stringify({ t: 'hello' })); await wait(() => B.latest.welcome);
  await page.locator('#w-party-btn').click(); await page.locator('[data-act="create"]').click();
  await page.waitForFunction(() => window.__latest.party?.party);
  peer.send(JSON.stringify({ t: 'partyJoin', code: await page.evaluate(() => window.__latest.party.party.code) }));
  await page.waitForFunction(() => window.__latest.party?.party?.members.length === 2).catch((e) => { console.log('peer', JSON.stringify(B.latest.partyErr ?? B.latest.party), 'page', JSON.stringify(B.latest.welcome)); throw e; });
  await page.keyboard.press('Escape');

  // The host sheet: setup page with lengths and game toggles.
  await page.evaluate(() => document.querySelector('.w-card[data-mode="minigames"]').click());
  await page.locator('.mg-card').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.mg-game').count(), 24, 'all shipped games to toggle');
  await page.locator('.game-format', { hasText: /^5$/ }).click();
  await page.waitForFunction(() => window.__latest.party.party.minigames?.length === 5).catch(async (e) => {
    await shot('00-fail');
    console.log(await page.evaluate(() => JSON.stringify({ party: window.__latest.party, err: window.__latest.partyErr, html: document.querySelector('.mg-card')?.outerHTML.slice(0, 1500) })));
    throw e;
  });
  await page.locator('.mg-game', { hasText: 'Treasure Cove' }).click();
  await page.waitForFunction(() => window.__latest.party.party.minigames?.banned.includes('treasure'));
  await shot('01-setup');

  // Playlists → New → editor: Brain Rush then Whack-a-Mole, Save & play.
  await page.locator('.game-setup-foot .w-btn', { hasText: 'Playlists' }).click();
  await page.locator('.w-btn', { hasText: 'New playlist' }).click();
  await page.locator('.mg-name').fill('Quick pair');
  await page.locator('.mg-games .mg-game', { hasText: 'Brain Rush' }).click();
  await page.locator('.mg-games .mg-game', { hasText: 'Whack-a-Mole' }).click();
  assert.equal(await page.locator('.mg-order li').count(), 2);
  assert.equal(await page.locator('.mg-final').count(), 1, 'the last entry says double points');
  await shot('02-editor');
  await page.locator('.w-btn', { hasText: 'Save & play' }).click();
  await page.waitForFunction(() => window.__latest.mgPlaylists?.playlists.some((p) => p.name === 'Quick pair'));

  // Brain Rush: briefing card, then the question board.
  await page.waitForFunction(() => window.__mg?.game === 'brain', undefined, { timeout: 30000 }).catch(async (e) => { console.log('DBG', await page.evaluate(() => JSON.stringify({ err: window.__latest.partyErr, arena: window.__latest.mArena, mg: window.__mg, keys: Object.keys(window.__latest), notice: window.__latest.notice, sheet: !!document.querySelector('.mg-card'), queue: window.__latest.queue, setup: window.__latest.party?.party?.minigames }))); throw e; });
  await page.locator('.mg-brief').waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await page.locator('.mg-brief h2').innerText(), /Brain Rush/);
  await page.waitForTimeout(2500); await shot('03-brief');
  await page.waitForFunction(() => window.__mg?.phase === 'round', undefined, { timeout: 20000 });
  await page.locator('.mg-board').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await page.locator('.mg-opt').count(), 4, 'four answers on the board');
  await page.waitForTimeout(1500); await shot('04-brain-board');
  // Walk onto platform A (north) for the first question.
  await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW');
  await page.waitForFunction(() => window.__mg?.phase === 'results', undefined, { timeout: 200000 });
  await page.locator('.mg-results').waitFor({ state: 'visible' });
  await page.waitForTimeout(800); await shot('05-results');
  const firstSeed = await page.evaluate(() => window.__latest.mArena.world.seed);

  // The arena swaps to Whack-a-Mole (double points).
  await page.waitForFunction((s) => window.__latest.mArena.world.seed !== s, firstSeed, { timeout: 30000 });
  await page.waitForFunction(() => window.__mg?.game === 'whack' && window.__mg.doubled, undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__mg?.phase === 'round', undefined, { timeout: 30000 });
  await page.waitForTimeout(4000); await shot('06-whack');
  await page.waitForFunction(() => window.__mg?.phase === 'podium', undefined, { timeout: 120000 });
  await page.waitForTimeout(3000); await shot('07-podium');
  await page.locator('.v-results', { hasText: 'Party Champion' }).waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await page.locator('.mg-award').count() >= 2, true, 'awards on the final card');
  await shot('08-final');
  assert.ok(!JSON.stringify(await page.evaluate(() => window.__latest)).includes('"bot"'), 'nothing on the wire says bot');
  await page.locator('.v-results .w-btn', { hasText: 'Leave' }).click();
  await page.waitForFunction(() => document.querySelector('.w-home') && getComputedStyle(document.querySelector('.w-home')).display !== 'none', undefined, { timeout: 20000 });
  assertBrowserErrors(errors);
  console.log(`Party Games e2e passed. Screenshots in ${artifacts}`);
} finally {
  peer?.close();
  await session.close();
}
