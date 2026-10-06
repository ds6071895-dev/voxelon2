// Real browser + a socket peer. Plays a 1v1 through the actual websocket server:
// title, team dialog, sidebar, generator items into the hotbar, the centred shop,
// predicted bridging, crack-and-collect mining and the results card. Writes
// screenshots to ARTIFACTS (default: ./test-artifacts/bedwars).
//
//   npm run server &  npx vite --port 5174 &
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node test/bedwars_e2e.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE ?? '/home/aiscoding2022/aiverest/node_modules/playwright/index.mjs').href);
const url = process.env.TEST_URL ?? 'http://localhost:5174';
const artifacts = process.env.ARTIFACTS ?? 'test-artifacts/bedwars';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? '/home/aiscoding2022/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const errors = [];
const wait = async (predicate, timeout = 20000) => {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for socket state'); await new Promise(r => setTimeout(r, 40)); }
};
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    localStorage.setItem('worlds.accessibility', JSON.stringify({ graphicsQuality: 'medium' }));
    const Native = window.WebSocket; window.__latest = {};
    window.WebSocket = class extends Native {
      constructor(...a) { super(...a); this.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.t) window.__latest[m.t] = m; }); }
    };
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e.stack ?? e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__worlds && window.__latest.welcome, undefined, { timeout: 60000 });
  const shot = async name => page.screenshot({ path: `${artifacts}/${name}.png` });
  const slots = () => page.evaluate(() => window.__worlds.inventory.slots.slice(0, 9).map(s => s && { id: s.id, count: s.count }));
  const count = async id => (await slots()).reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);

  // Title screen: five modes, nothing scrolls at 1280x720.
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.w-card').count(), 5, 'five mode cards');
  assert.equal(await page.evaluate(() => document.querySelector('.w-home').scrollHeight <= innerHeight + 2), true, 'title fits without scrolling');
  await shot('01-title');

  // A second human joins a party; the leader chooses teams.
  const peer = new WebSocket(process.env.WS_URL ?? 'ws://localhost:8090'); const B = { latest: {} };
  peer.on('message', raw => { const m = JSON.parse(String(raw)); B.latest[m.t] = m; if (m.t === 'bwArena') peer.send(JSON.stringify({ t: 'worldReady', world: m.world.id })); });
  await new Promise(r => peer.once('open', r)); peer.send(JSON.stringify({ t: 'hello' })); await wait(() => B.latest.welcome);
  await page.locator('#w-party-btn').click(); await page.locator('[data-act="create"]').click();
  await page.waitForFunction(() => window.__latest.party?.party);
  peer.send(JSON.stringify({ t: 'partyJoin', code: await page.evaluate(() => window.__latest.party.party.code) }));
  await page.waitForFunction(() => window.__latest.party?.party?.members.length === 2);
  await page.keyboard.press('Escape');
  await page.locator('.w-card[data-mode="bedwars"]').click();
  await page.waitForFunction(() => window.__latest.party?.party?.bedwars);
  assert.equal(await page.locator('.bw-setup-card').isVisible(), true, 'team dialog opens');
  assert.ok((await page.locator('.bw-setup-card').boundingBox()).width < 520, 'team dialog is small');
  const aId = await page.evaluate(() => window.__latest.welcome.id), bId = B.latest.welcome.id;
  await page.evaluate(([a, b]) => window.__worlds.net.send({ t: 'bwSetup', teams: 2, assignments: { [a]: 0, [b]: 1 }, fill: false, revision: window.__latest.party.party.bedwars.revision }), [aId, bId]);
  await page.waitForFunction(id => window.__latest.party.party.bedwars.assignments[id] === 1, bId);
  await page.waitForTimeout(300); await shot('02-teams');
  await page.evaluate(() => window.__worlds.net.send({ t: 'play', mode: 'bedwars', setupRevision: window.__latest.party.party.bedwars.revision }));
  await page.waitForFunction(() => window.__latest.bwState?.s.phase === 'playing', undefined, { timeout: 90000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.getElementById('pause').style.display = 'none'; });

  // HUD: one small bar, no wallet, and the map name appears nowhere.
  assert.equal(await page.locator('.bw-side').isVisible(), true, 'sidebar visible');
  assert.equal(await page.locator('.bw-wallet, .bw-generator-status, .bw-break').count(), 0, 'the old resource strip and generator panel are gone');
  const text = await page.evaluate(() => document.body.innerText + document.title);
  assert.ok(!/skygarden|citadel|observatory/i.test(text), 'no map name in the UI');
  await shot('03-spawn');

  // Generators: items fall and walking over them fills the hotbar.
  const map = await page.evaluate(() => ({ bases: window.__worlds.bwClient.map.bases }));
  const base = map.bases[0];
  const walkTo = async t => {
    const from = await page.evaluate(() => ({ ...window.__worlds.player.pos }));
    const steps = Math.ceil(Math.hypot(t.x - from.x, t.z - from.z) / .35);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      await page.evaluate(({ x, y, z }) => { const w = window.__worlds; w.player.pos.set(x, y, z); w.player.vel.set(0, 0, 0); w.net.flushXform(x, y, z, w.player.yaw, w.player.pitch); },
        { x: from.x + (t.x - from.x) * k, y: t.y, z: from.z + (t.z - from.z) * k });
      await page.waitForTimeout(50);
    }
  };
  await walkTo({ x: base.forge.x + 3.5, y: 97, z: base.forge.z + 0.5 });
  await page.evaluate(() => { const w = window.__worlds; w.player.yaw = Math.PI / 2; w.player.pitch = -0.55; });
  await page.waitForTimeout(3000);
  assert.ok(await page.evaluate(() => window.__worlds.bwClient.scene3d.dropCount > 0), 'generator items exist in the world');
  await shot('04-generator-items');
  await walkTo({ x: base.forge.x + 0.5, y: 97, z: base.forge.z + 0.5 });
  await page.waitForTimeout(6000);
  const iron = await count(343);
  assert.ok(iron >= 4, `iron went into the hotbar (${iron})`);
  await shot('05-collected');

  // Shop: a docked panel, not a modal.
  await walkTo({ x: base.shop.x, y: 97, z: base.shop.z + 2.6 });
  await page.evaluate(() => window.__worlds.bwClient.interact());
  await page.waitForSelector('.bw-shop:not([hidden])');
  const box = await page.locator('.bw-shop').boundingBox();
  assert.ok(Math.abs(box.x + box.width / 2 - 640) < 4 && box.width <= 620, 'shop is a centred window');
  await shot('06-shop');
  await page.locator('.bw-row').first().click();
  await page.waitForFunction(() => window.__worlds.inventory.slots.some(s => s && (s.id === 242 || s.id === 243)), undefined, { timeout: 8000 });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__worlds.bwClient.shop.close());
  const wool = (await slots()).findIndex(s => s && (s.id === 242 || s.id === 243));
  await page.evaluate(i => window.__worlds.inventory.select(i), wool);

  // Bridging: blocks appear at once and every one is accepted by the server.
  const edge = await page.evaluate(() => { const w = window.__worlds.world; let e = -76; for (let x = -76; x < -40; x++) if (w.getBlock(x, 96, 5) !== 0) e = x; return e; });
  await walkTo({ x: edge + 0.5, y: 97, z: 5.5 });
  const before = await count(242);
  let placed = 0;
  for (let i = 0; i < 6; i++) {
    await page.evaluate(({ x }) => { const w = window.__worlds; w.player.pos.set(x + 0.5, 97, 5.5); w.net.flushXform(x + 0.5, 97, 5.5, w.player.yaw, w.player.pitch); }, { x: edge + i });
    placed += await page.evaluate(({ x }) => window.__worlds.bwClient.place({ x, y: 96, z: 5, nx: 1, ny: 0, nz: 0 }, window.__worlds.inventory.selected) ? 1 : 0, { x: edge + i });
    await page.waitForTimeout(110);
  }
  assert.equal(placed, 6, 'six blocks placed at the repeat rate');
  await page.waitForTimeout(500);
  assert.equal(await count(242), before - 6, 'wool was consumed exactly once per block');
  assert.equal(await page.evaluate(({ x }) => window.__worlds.world.getBlock(x, 96, 5), { x: edge + 6 }), 242, 'the last block is still there after the server echo');

  // Mining: a crack, then the block comes back into the hotbar.
  const target = { x: edge + 3, y: 96, z: 5 };
  await page.evaluate(({ x, y, z }) => {
    const w = window.__worlds, px = x + 2.5, py = 97, pz = z + 0.5;
    w.player.pos.set(px, py, pz); w.net.flushXform(px, py, pz, Math.PI / 2, -0.8);
    w.net.sendXform = () => {}; w.player.update = () => {};
    w.player.yaw = Math.PI / 2; w.player.pitch = Math.atan2(y + 0.5 - (py + 1.62), 3);
    window.__hold = null; const bw = w.bwClient, orig = bw.aimBreak.bind(bw);
    bw.aimBreak = (hit, slot, active) => orig(window.__hold ?? hit, slot, window.__hold ? true : active);
  }, target);
  const owned = await count(242);
  await page.evaluate(t => { window.__hold = t; }, target);
  await page.waitForTimeout(500); await shot('07-cracking');
  await page.waitForFunction(t => window.__worlds.world.getBlock(t.x, t.y, t.z) === 0, target, { timeout: 8000 });
  await page.evaluate(() => { window.__hold = null; });
  await page.waitForTimeout(600);
  assert.equal(await count(242), owned + 1, 'the broken block went into the hotbar');

  // Results card is small and light.
  await page.evaluate(() => {
    const w = window.__worlds, s = window.__latest.bwState.s;
    w.bwClient.setResult({ winner: 0, reason: 'Red team wins!', duration: 95, players: s.players });
  });
  await page.waitForSelector('.bw-result-card', { state: 'visible' });
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.bw-result-card').boundingBox()).width < 520, 'results card is small');
  console.log('results scrim', await page.evaluate(() => { const e = document.querySelector('.bw-results'); const c = getComputedStyle(e); return [e.className, c.display, c.zIndex, c.position, e.getBoundingClientRect().width].join(' | '); }));
  await shot('08-results');

  await page.evaluate(() => window.__worlds.net.send({ t: 'leaveMatch' }));
  peer.send(JSON.stringify({ t: 'leaveMatch' }));
  await page.waitForFunction(() => !window.__worlds.bwClient.active, undefined, { timeout: 10000 });
  peer.close();
  assert.deepEqual(errors, [], `Browser errors: ${errors.join('\n')}`);
  console.log('PASS: teams dialog, sidebar, generator items into the hotbar, centred shop, bridging, mining, results');
} finally {
  await browser.close();
}
