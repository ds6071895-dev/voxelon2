// Real computed-cascade and nested-screen checks for the extracted client UI.
import assert from 'node:assert/strict';
import { artifactDirectory, browserSession, observeErrors, assertBrowserErrors } from '../scripts/browser_session.mjs';

const artifacts = await artifactDirectory('client-ui');
const session = await browserSession({ capture: true });
const errors = [];
try {
  const context = await session.browser.newContext({ viewport: { width: 1000, height: 720 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    localStorage.setItem('worlds.accessibility', JSON.stringify({ graphicsQuality: 'low', reducedMotion: false }));
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  observeErrors(page, errors);
  await page.goto(process.env.TEST_URL ?? 'http://localhost:5174', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__worlds?.net.connected);
  await page.waitForFunction(() => document.body.classList.contains('reduced-motion'));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('worlds.accessibility')).reducedMotion), false,
    'OS motion preference is effective without rewriting the saved preference');

  assert.equal(await page.locator('.w-card').count(), 7, 'seven playable modes remain');
  assert.equal(await page.locator('.w-card-art img').count(), 7, 'game pictures remain');
  assert.equal(await page.locator('.w-card-sub').count(), 0, 'title descriptions are removed');
  assert.equal(await page.locator('[data-mode="bedwars"]').count(), 0, 'retired mode is absent');
  await page.screenshot({ path: `${artifacts}/title.png` });

  await page.locator('#w-settings-btn').click();
  await page.locator('#pause-controls-btn').click();
  assert.equal(await page.locator('#pause').isVisible(), false, 'the parent pauses behind the child sheet');
  await page.getByRole('dialog', { name: 'Controls', exact: true }).waitFor({ state: 'visible' });
  assert.match(await page.locator('.sheet-body').innerText(), /The Bridge: click to shoot/);
  const topIsControls = await page.evaluate(() => {
    const button = document.querySelector('.sheet-close'), r = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  assert.ok(topIsControls, 'the extracted Controls cascade remains above the parent');
  await page.keyboard.press('Escape');
  await page.locator('#pause').waitFor({ state: 'visible' });

  await page.locator('#hud-settings-btn').click();
  await page.getByRole('dialog', { name: 'HUD settings', exact: true }).waitFor({ state: 'visible' });
  await page.locator('.hs-tab').filter({ hasText: 'HUD Layout' }).click();
  await page.locator('.hs-dragcard .hs-btn').click();
  await page.locator('.hm-bar').waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('.hm')].every(node => node.textContent.trim().length > 0));
  assert.equal(await page.locator('.hm').count(), 12, 'fresh-title editor populates all twelve modules');
  await page.screenshot({ path: `${artifacts}/title-hud-editor.png` });
  await page.locator('.hm-bar .primary').click();
  await page.getByRole('dialog', { name: 'HUD settings', exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Close HUD settings', exact: true }).click();
  await page.locator('#pause').waitFor({ state: 'visible' });
  await page.locator('#resume-btn').click();
  assert.equal(await page.locator('#pause').isVisible(), false);

  await page.locator('#w-wardrobe-btn').click();
  await page.getByRole('dialog', { name: 'Wardrobe', exact: true }).waitFor({ state: 'visible' });
  await page.screenshot({ path: `${artifacts}/wardrobe.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Wardrobe', exact: true }).waitFor({ state: 'hidden' });
  const setupLayout = await page.evaluate(async () => {
    const { MinigamesSetupSheet } = await import('/src/ui/minigames_setup.ts');
    const setup = new MinigamesSetupSheet(document.querySelector('#app'), { onChange() {}, onPlaylists() {}, onStart() {} });
    setup.update({ code: 'ABCDEF', leader: 1, members: [1, 2].map(id => ({ id, username: `Player${id}`, skin: id, status: 'menu' })) }, 1);
    setup.show();
    const group = document.querySelector('.game-formats');
    const result = { display: getComputedStyle(group).display, height: group.querySelector('button').getBoundingClientRect().height,
      footer: getComputedStyle(document.querySelector('.game-setup-foot')).display };
    setup.close();
    return result;
  });
  assert.equal(setupLayout.display, 'flex', 'Party Games match-length controls retain their layout');
  assert.ok(setupLayout.height >= 38, 'match-length controls retain their usable target size');
  assert.equal(setupLayout.footer, 'flex', 'Party Games actions retain their layout');

  for (const [width, height, touch] of [[1280, 720, false], [390, 844, true], [844, 390, true]]) {
    await page.setViewportSize({ width, height });
    const bounds = await page.evaluate(async touch => {
      const { VanillaHud } = await import('/src/vanilla/client/vanilla_hud.ts');
      const app = document.querySelector('#app');
      const hud = new VanillaHud(app);
      const name = document.querySelector('.item-name');
      document.documentElement.classList.toggle('touch-ui', touch);
      document.body.classList.add('in-game', 'vanilla-active');
      document.querySelector('#w-home').hidden = true;
      name.textContent = 'Enchanted Diamond Sword of the Lucky Pillars';
      name.style.opacity = '1';
      document.documentElement.style.setProperty('--hud-scale', '1.6');
      document.documentElement.style.setProperty('--safe-bottom', '34px');
      hud.show(true);
      const results = [];
      for (const [maxHp, absorption, armor] of [[20, 0, 0], [40, 20, 20], [60, 40, 20]]) {
        hud.setSelf({ hp: maxHp, maxHp, absorption, armor, food: 20, air: 100, maxAir: 300,
          effects: [], freeze: 0, bar: .5, barLevel: 2 });
        const label = name.getBoundingClientRect(), bars = hud.root.querySelector('.v-bars').getBoundingClientRect();
        results.push({ labelBottom: label.bottom, barsTop: bars.top, canvasHeight: hud.root.querySelector('.v-bars').height });
      }
      hud.dispose();
      document.body.classList.remove('in-game', 'vanilla-active');
      document.querySelector('#w-home').hidden = false;
      name.style.opacity = '0';
      return results;
    }, touch);
    for (const b of bounds) assert.ok(b.labelBottom <= b.barsTop - 7,
      `item name clears survival bars at ${width}×${height}: ${JSON.stringify(b)}`);
    assert.equal(bounds.at(-1).canvasHeight, 96, 'extra health/absorption/armour rows fit the canvas');
    await page.screenshot({ path: `${artifacts}/title-${width}x${height}.png` });
  }
  assertBrowserErrors(errors);
  console.log('Client UI computed cascade, nested sheets, fresh-title editor, wardrobe and OS comfort checks passed.');
} finally { await session.close(); }
