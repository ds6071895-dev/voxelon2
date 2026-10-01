// Real touch events against the dev client and local game server.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chrome node test/mobile.mjs
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const artifacts = process.env.ARTIFACTS ?? '/tmp/worlds-mobile';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=swiftshader'] });
let failures = 0;
const check = (name, pass, detail = '') => { console.log(`${pass ? '✓' : '✗'} ${name} ${pass ? '' : detail}`); if (!pass) failures++; };
const errors = [];
const peers = [];
let currentPage;
try {
  for (const mode of (process.env.MODES ?? 'duels,bridge,parkour,ratseek').split(',').filter(Boolean)) {
    console.log(`▸ ${mode}`);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await context.addInitScript(() => {
      localStorage.setItem('worlds.accessibility', JSON.stringify({ graphicsQuality: 'low' }));
      const Native = WebSocket;
      window.__latest = {}; window.__sent = [];
      window.WebSocket = class extends Native {
        constructor(...args) { super(...args); this.addEventListener('message', e => { const m = JSON.parse(e.data); window.__latest[m.t] = m; }); }
        send(m) { window.__sent.push(JSON.parse(m)); super.send(m); }
      };
    });
    const page = await context.newPage();
    currentPage = page;
    page.on('pageerror', e => errors.push(`${mode}: ${e.message}`));
    await page.goto(process.env.TEST_URL ?? 'http://localhost:5174');
    await page.waitForFunction(() => window.__worlds?.net.connected);
    // A stationary peer keeps combat bots from resetting the loadout halfway
    // through a touch gesture while slow software-rendered screenshots run.
    const peer = new WebSocket(process.env.WS_URL ?? 'ws://localhost:8090');
    peers.push(peer);
    await new Promise((resolve, reject) => {
      peer.addEventListener('open', () => peer.send(JSON.stringify({ t: 'hello' })));
      peer.addEventListener('error', reject, { once: true });
      peer.addEventListener('message', e => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') resolve();
        if (['duelArena', 'pgArena', 'rsArena'].includes(m.t))
          peer.send(JSON.stringify({ t: 'worldReady', world: m.world.id, revision: m.revision }));
      });
    });
    peer.send(JSON.stringify({ t: 'play', mode }));
    await page.locator(`.w-card[data-mode="${mode}"]`).tap();
    await page.waitForFunction(() => document.querySelector('.t-pads')?.hidden === false, null, { timeout: 120000 });
    check('touch control is active', await page.evaluate(() => window.__worlds.input.touchMode));
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 568, height: 320 }, { width: 844, height: 390 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll('#touch button, #hotbar .slot:not(.empty)')].filter(n => n.getClientRects().length);
        const hotbar = document.querySelector('#hotbar').getBoundingClientRect();
        const buttons = nodes.filter(n => n.closest('#touch')).map(n => ({ label: n.getAttribute('aria-label'), r: n.getBoundingClientRect().toJSON() }));
        return {
          small: nodes.filter(n => { const r = n.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(n => n.outerHTML),
          outside: buttons.filter(({ r }) => r.x < 0 || r.y < 0 || r.right > innerWidth || r.bottom > innerHeight),
          overlap: buttons.flatMap((a, i) => buttons.slice(i + 1).filter(b => a.r.x < b.r.right && a.r.right > b.r.x && a.r.y < b.r.bottom && a.r.bottom > b.r.y).map(b => `${a.label}/${b.label}`)),
          covered: buttons.filter(({r}) => r.x < hotbar.right && r.right > hotbar.x && r.y < hotbar.bottom && r.bottom > hotbar.y),
          width: document.documentElement.scrollWidth,
        };
      });
      check(`${viewport.width}×${viewport.height}: controls ≥44px, in bounds, no overlaps`, !layout.small.length && !layout.outside.length && !layout.overlap.length && !layout.covered.length && layout.width <= viewport.width, JSON.stringify(layout));
      await page.screenshot({ path: `${artifacts}/${mode}-${viewport.width}.png` });
    }
    await page.setViewportSize({ width: 844, height: 390 });
    const cdp = await context.newCDPSession(page);
    const center = async selector => { const r = await page.locator(selector).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const stick = await center('.t-stick'), jump = await center('.t-jump');
    await send('touchStart', [{ ...stick, y: stick.y - 52, id: 1 }, { ...jump, id: 2 }]);
    check('move, sprint and jump work together', await page.evaluate(() => { const i = window.__worlds.input; return i.forward && i.sprintHeld && i.jump; }));
    await send('touchCancel', []);
    check('cancel releases movement and jump', await page.evaluate(() => { const i = window.__worlds.input; return !i.forward && !i.jump && !i.leftDown; }));
    if (mode === 'duels' || mode === 'bridge') {
      if (mode === 'bridge') await page.locator('.slot[data-slot="2"]').tap();
      await page.waitForFunction(label => !document.querySelector('.t-pads').hidden && document.querySelector('.t-primary').textContent === label, mode === 'duels' ? 'FIRE' : 'SHOOT');
      const startYaw = await page.evaluate(() => window.__worlds.player.yaw);
      const action = await center('.t-primary');
      await send('touchStart', [{ ...action, id: 3 }]);
      await send('touchMove', [{ ...action, x: action.x + 25, id: 3 }]);
      await page.waitForFunction(yaw => window.__worlds.player.yaw !== yaw, startYaw);
      await send('touchEnd', []);
      check('action button drags to aim', true);
      const packet = mode === 'duels' ? 'shot' : 'pgShoot';
      await page.waitForFunction(t => window.__sent.some(m => m.t === t), packet);
      check('touch fires the selected weapon', true);
      if (mode === 'duels') {
        await page.locator('.t-aim').tap();
        check('ADS toggles on', await page.evaluate(() => window.__worlds.input.rightDown));
        await page.locator('.slot[data-slot="1"]').tap();
        await page.waitForFunction(() => !window.__worlds.input.rightDown);
        check('switching to blocks clears ADS', true);
        await page.waitForFunction(() => document.querySelector('.t-primary').textContent === 'PLACE');
        check('building has place and break buttons', await page.locator('.t-secondary').isVisible());
      }
    }
    if (mode === 'parkour') check('there is no checkpoint retry button (Dragon Chase has lives)', !(await page.locator('.t-retry').count()));
    if (mode === 'ratseek') {
      await page.locator('.t-primary').tap();
      await page.waitForFunction(() => window.__sent.some(m => m.t === 'rsUse') || document.querySelector('.rs-picker.open'));
      check('rat items can be used by touch', true);
    }
    await page.locator('.t-pause').tap();
    await page.waitForFunction(() => document.querySelector('.t-pads').hidden);
    check('pause hides gameplay controls and clears inputs', await page.evaluate(() => { const i = window.__worlds.input; return !i.leftDown && !i.rightDown && !i.jump && !i.forward; }));
    await context.close();
    peer.close();
  }
  console.log('▸ isolated touch input regressions');
  const fixture = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });
  const page = await fixture.newPage(); currentPage = page;
  await page.route('**/touch-fixture', route => route.fulfill({ contentType: 'text/html', body:
    '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"><canvas></canvas><div id="hotbar"></div></div>' }));
  await page.goto(`${process.env.TEST_URL ?? 'http://localhost:5174'}/touch-fixture`);
  await page.evaluate(async () => {
    await import('/src/styles/hud.css'); await import('/src/styles/mobile.css');
    const { Input } = await import('/src/input.ts');
    const { TouchControls } = await import('/src/touch.ts');
    const input = new Input(document.querySelector('canvas'));
    const state = { shown: true, playing: true, gun: false, action: 'interact', context: 'seeker' };
    const controls = new TouchControls(input, { onPause() { controls.update({ ...state, playing: false }); } });
    controls.update(state);
    for (let i = 0; i < 9; i++) {
      const slot = document.createElement('div'); slot.className = `slot${i === 1 || i === 8 ? '' : ' empty'}`;
      slot.dataset.slot = String(i); slot.textContent = String(i + 1); document.querySelector('#hotbar').appendChild(slot);
    }
    window.__fixture = { input, controls, state };
  });
  await page.locator('.slot[data-slot="8"]').tap();
  check('sparse hotbar taps keep the original slot number', await page.evaluate(() => window.__fixture.input.hotbarKey === 8));
  await page.evaluate(() => {
    document.querySelectorAll('.slot').forEach(n => n.classList.remove('empty'));
    window.__fixture.input.endFrame();
  });
  const cdp = await fixture.newCDPSession(page);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await send('touchStart', [{ x: 260, y: 530, id: 1 }]);
  for (let x = 240; x >= 80; x -= 20) await send('touchMove', [{ x, y: 530, id: 1 }]);
  await send('touchEnd', []);
  check('long loadouts scroll without selecting an item or moving the camera', await page.evaluate(() =>
    document.querySelector('#hotbar').scrollLeft > 0 && window.__fixture.input.hotbarKey === -1 && window.__fixture.input.mouseDX === 0));
  const center = async selector => { const r = await page.locator(selector).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const use = await center('.t-primary'), hit = await center('.t-secondary');
  await send('touchStart', [{ ...use, id: 2 }, { ...hit, id: 3 }]);
  check('seeker can use a gadget and attack with separate controls', await page.evaluate(() => {
    const i = window.__fixture.input; return i.leftDown && i.rightDown && i.leftClicked && i.rightClicked;
  }));
  await send('touchCancel', []);
  check('cancel clears both action sources', await page.evaluate(() => !window.__fixture.input.leftDown && !window.__fixture.input.rightDown));
  const stick = await center('.t-stick');
  await send('touchStart', [{ ...stick, y: stick.y - 52, id: 4 }, { ...use, id: 5 }]);
  await page.evaluate(() => { const f = window.__fixture; f.controls.update({ ...f.state, context: 'new-slot', action: 'use' }); });
  check('changing items releases the old action while preserving movement', await page.evaluate(() => {
    const i = window.__fixture.input; return i.forward && !i.rightDown && !i.leftDown;
  }));
  await send('touchCancel', []);
  await send('touchStart', [{ ...use, id: 6 }]);
  await page.evaluate(() => { const f = window.__fixture; f.controls.update({ ...f.state, playing: false }); });
  check('opening a panel releases held actions immediately', await page.evaluate(() => !window.__fixture.input.leftDown && !window.__fixture.input.rightDown));
  await send('touchEnd', []);
  await fixture.close();
} catch (e) {
  failures++; console.error(e);
  if (currentPage && !currentPage.isClosed() && await currentPage.evaluate(() => !!window.__worlds)) {
    await currentPage.screenshot({ path: `${artifacts}/failure.png` });
    console.log(await currentPage.evaluate(() => ({ latest: window.__latest.pgState ?? window.__latest.rsState,
      yaw: window.__worlds.player.yaw, input: window.__worlds.input, sent: window.__sent.slice(-8),
      primary: document.querySelector('.t-primary').outerHTML,
      pads: document.querySelector('.t-pads').hidden })));
  }
}
finally { for (const peer of peers) peer.close(); await browser.close(); }
check('no browser errors', errors.length === 0, errors.join('\n'));
process.exitCode = failures ? 1 : 0;
