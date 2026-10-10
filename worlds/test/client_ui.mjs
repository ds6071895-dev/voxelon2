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

  await page.locator('#w-settings-btn').click();
  await page.locator('#pause-controls-btn').click();
  assert.equal(await page.locator('#pause').isVisible(), false, 'the parent pauses behind the child sheet');
  await page.getByRole('dialog', { name: 'Controls', exact: true }).waitFor({ state: 'visible' });
  assert.match(await page.locator('.sheet-body').innerText(), /Bedwars: hold to draw, release to fire/);
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
  assertBrowserErrors(errors);
  console.log('Client UI computed cascade, nested sheets, fresh-title editor, wardrobe and OS comfort checks passed.');
} finally { await session.close(); }
