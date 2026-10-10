// Exercise shared worlds/models and non-window capture sizing without replacing
// published cards or release media. Requires explicit Playwright/Chromium paths.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { artifactDirectory, browserSession, observeErrors, assertBrowserErrors } from '../scripts/browser_session.mjs';

const artifacts = await artifactDirectory('offline-render');
const session = await browserSession({ port: process.env.OFFLINE_PORT ?? 5189 });
const errors = [];
try {
  const page = await session.browser.newPage({ viewport: { width: 900, height: 700 } });
  page.setDefaultTimeout(180_000);
  observeErrors(page, errors);
  async function ready(url) {
    await page.goto(`${session.base}${url}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.dataset.ready === 'true' || document.body.dataset.error);
    assert.equal(await page.evaluate(() => document.body.dataset.error), undefined);
  }
  async function savePng(name, data, width, height) {
    assert.ok(data.startsWith('data:image/png;base64,'), 'stage returns PNG data');
    const bytes = Buffer.from(data.split(',')[1], 'base64');
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
    assert.ok(bytes.length > 4_000, `${name} contains scene detail`);
    await writeFile(`${artifacts}/${name}.png`, bytes);
  }

  await ready('/cardart.html?card=bedwars&w=360&h=240');
  const cards = await page.evaluate(() => window.__cards.cards);
  assert.deepEqual(cards, ['bedwars', 'duels', 'bridge', 'parkour', 'ratseek']);
  // One page prepares all five modes twice, including rat→person/gear rebuilds.
  for (const card of [...cards, ...cards]) {
    const png = await page.evaluate(async card => {
      await window.__cards.prepare(card, 360, 240, 0);
      return window.__cards.image('image/png');
    }, card);
    await savePng(`card-${card}`, png, 360, 240);
    assertBrowserErrors(errors);
    console.log(`✓ repeated offline card: ${card}`);
  }

  await ready('/trailer.html?capture&width=360&height=240&quality=balanced');
  const shots = await page.evaluate(() => window.__trailer.shots);
  assert.equal(shots.length, 17);
  assert.equal(await page.evaluate(() => window.__trailer.duration), 94);
  for (let index = 0; index < shots.length; index++) {
    const shot = shots[index];
    const capture = await page.evaluate(async ({ index, time }) => {
      const stage = window.__trailer;
      await stage.prepare(index);
      stage.render(time, true);
      stage.validateRig();
      return { png: stage.canvas.toDataURL('image/png'), info: stage.info() };
    }, { index, time: shot.duration / 2 });
    assert.equal(capture.info.shot, shot.id);
    assert.ok(capture.info.camera.every(Number.isFinite));
    await savePng(shot.id, capture.png, 360, 240);
    assertBrowserErrors(errors);
    console.log(`✓ offline trailer stage/rig: ${shot.id}`);
  }
  const resized = await page.evaluate(() => {
    const stage = window.__trailer;
    stage.resize(640, 360); stage.render(2, true);
    return stage.canvas.toDataURL('image/png');
  });
  await savePng('trailer-resized', resized, 640, 360);
  assertBrowserErrors(errors);
  console.log('Offline repeated-stage, rig and capture-sizing checks passed.');
} finally {
  await session.close();
}
