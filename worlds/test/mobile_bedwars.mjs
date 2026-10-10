// Bedwars touch flow on a real public four-island fixture. Only locomotion and
// initial block placement use the same deterministic seams as desktop E2E;
// shop, mining, charged bow and results use real touch events and server state.
export async function mobileBedwars(page, matchPeers, check, artifacts) {
  await page.waitForFunction(() => window.__latest.bwState?.s.phase === 'playing', null, { timeout: 120000 });
  const data = await page.evaluate(async () => {
    const { Item } = await import('/src/items.ts');
    const w = window.__worlds, team = w.bwClient.snap.players.find(p => p.id === w.net.myId).team;
    return { base: w.bwClient.map.bases[team], Item, team };
  });
  const { base, Item, team } = data, y = base.spawns[0].y;
  check('Bedwars has four ready human participants', await page.evaluate(() => window.__latest.bwState.s.players.length === 4 && window.__latest.bwState.s.players.every(p => !p.bot)));
  const walkTo = async target => {
    const from = await page.evaluate(() => ({ ...window.__worlds.player.pos }));
    const steps = Math.max(1, Math.ceil(Math.hypot(target.x - from.x, target.z - from.z) / .25));
    for (let i = 1; i <= steps; i++) {
      await page.evaluate(p => { const w = window.__worlds; w.player.pos.set(p.x, p.y, p.z); w.player.vel.set(0, 0, 0); w.net.flushXform(p.x, p.y, p.z, w.player.yaw, w.player.pitch); },
        { x: from.x + (target.x - from.x) * i / steps, y: target.y, z: from.z + (target.z - from.z) * i / steps });
      await page.waitForTimeout(60);
    }
    await page.waitForFunction(target => {
      const w = window.__worlds, p = window.__latest.snapshot?.players.find(p => p.id === w.net.myId);
      return p && Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z) < .2;
    }, target, { timeout: 5000 });
  };
  const count = item => page.evaluate(item => window.__worlds.inventory.slots.reduce((n, s) => n + (s?.id === item ? s.count : 0), 0), item);
  await walkTo({ x: base.forge.x + .5, y, z: base.forge.z + .5 });
  await page.waitForFunction(({ gold, iron }) => { const inv = window.__worlds.inventory; return inv.countItem(gold) >= 14 && inv.countItem(iron) >= 4; }, { gold: Item.GoldIngot, iron: Item.IronIngot }, { timeout: 180000 });
  check('forge resources arrive through authoritative inventory', await count(Item.GoldIngot) >= 14);
  // Cross the services along local u=0, outside the front pillars at u=-2,
  // w=±4. Both the corridor and merchant approach rotate with the island.
  const forgeAisle = { x: base.forge.x + base.inward.x * 7, y, z: base.forge.z + base.inward.z * 7 };
  const shopAisle = { x: base.shop.x + base.inward.x * 5, y, z: base.shop.z + base.inward.z * 5 };
  await walkTo(forgeAisle);
  await walkTo(shopAisle);
  await walkTo({ x: base.shop.x + base.inward.x * 2.6, y, z: base.shop.z + base.inward.z * 2.6 });
  await page.locator('.t-primary').tap();
  await page.waitForSelector('.bw-shop:not([hidden])');
  await page.waitForFunction(() => document.querySelector('.t-pads').hidden);
  check('touch opens shop and releases gameplay actions', await page.evaluate(() => !window.__worlds.input.rightDown && !window.__worlds.input.leftDown && document.querySelector('.t-pads').hidden));
  await page.locator('.bw-row').filter({ has: page.locator('b', { hasText: /^Wool$/ }) }).tap();
  await page.waitForFunction(() => window.__worlds.inventory.slots.some(s => s && (s.id === 242 || s.id === 243)));
  await page.getByRole('tab', { name: 'Combat', exact: true }).tap();
  await page.locator('.bw-row').filter({ has: page.locator('b', { hasText: /^Bow$/ }) }).tap();
  await page.waitForFunction(item => window.__worlds.inventory.slots.some(s => s?.id === item), Item.BridgeBow);
  await page.locator('.bw-row').filter({ has: page.locator('b', { hasText: /^Arrows$/ }) }).tap();
  await page.waitForFunction(item => window.__worlds.inventory.countItem(item) >= 8, Item.BridgeArrow);
  await page.locator('.bw-shop .bw-x').tap();
  await page.waitForFunction(() => !document.querySelector('.t-pads').hidden);
  check('touch purchases wool, bow and arrows; close restores controls', true);
  await page.screenshot({ path: `${artifacts}/bedwars-shop-purchases.png` });

  await walkTo(shopAisle);
  const chestAisle = { x: base.chest.x + base.inward.x * 4, y, z: base.chest.z + base.inward.z * 4 };
  await walkTo(chestAisle);
  await walkTo({ x: base.chest.x + base.inward.x * 2.6, y, z: base.chest.z + base.inward.z * 2.6 });
  await page.locator('.t-primary').tap();
  await page.locator('.bw-chest').waitFor({ state: 'visible' });
  const ironBefore = await count(Item.IronIngot);
  if (ironBefore <= 0) throw new Error('Chest fixture needs collected iron after purchases');
  const ironRow = page.locator('.bw-chest-row').filter({ has: page.locator('b', { hasText: /^Iron$/ }) });
  await ironRow.getByRole('button', { name: 'Put', exact: true }).tap();
  await page.waitForFunction(({ team, item, before }) => window.__latest.bwState.s.teams[team].chest.iron === before
    && window.__worlds.inventory.countItem(item) === 0, { team, item: Item.IronIngot, before: ironBefore });
  await ironRow.getByRole('button', { name: 'Take', exact: true }).tap();
  const withdrawn = Math.min(16, ironBefore);
  await page.waitForFunction(({ team, item, before, withdrawn }) => window.__latest.bwState.s.teams[team].chest.iron === before - withdrawn
    && window.__worlds.inventory.countItem(item) === withdrawn, { team, item: Item.IronIngot, before: ironBefore, withdrawn });
  check('touch team chest deposits and withdraws with authoritative conservation', true);
  await page.locator('.bw-shop .bw-x').tap();
  await page.waitForFunction(() => !document.querySelector('.t-pads').hidden);
  await walkTo(chestAisle);
  await walkTo(forgeAisle);
  await walkTo({ x: base.forge.x + .5, y, z: base.forge.z + .5 });
  const target = await page.evaluate(async ({ forge, y }) => {
    const { bwLine } = await import('/src/bedwars_nav.ts');
    const w = window.__worlds, candidates = [];
    const eye = { x: w.player.pos.x, y: w.player.pos.y + 1.62, z: w.player.pos.z };
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const x = Math.floor(forge.x) + dx, z = Math.floor(forge.z) + dz;
      if (Math.hypot(x + .5 - w.player.pos.x, z + .5 - w.player.pos.z) <= 4
          && !w.bwClient.map.isProtected(x, y, z) && w.bwClient.map.bedAt(x, y, z) === null
          && w.world.getBlock(x, y - 1, z) !== 0 && w.world.getBlock(x, y, z) === 0
          && bwLine((x, y, z) => w.world.getBlock(x, y, z), eye, { x: x + .5, y: y + .5, z: z + .5 }))
        candidates.push({ x, y, z });
    }
    candidates.sort((a, b) => Math.hypot(a.x + .5 - eye.x, a.z + .5 - eye.z) - Math.hypot(b.x + .5 - eye.x, b.z + .5 - eye.z));
    return candidates[0];
  }, { forge: base.forge, y: Math.floor(y) });
  if (!target) throw new Error('No unprotected supported mining fixture cell within reach of the forge');
  const placed = await page.evaluate(target => {
    const w = window.__worlds, slot = w.inventory.slots.findIndex(s => s && (s.id === 242 || s.id === 243));
    w.inventory.select(slot);
    return w.bwClient.place({ x: target.x, y: target.y - 1, z: target.z, nx: 0, ny: 1, nz: 0 }, slot);
  }, target);
  check('mining fixture block is placed through the normal prediction path', placed);
  if (!placed) throw new Error('Could not place the Bedwars mining fixture block');
  await page.waitForFunction(target => {
    const edit = window.__latest.edit;
    return edit && edit.x === target.x && edit.y === target.y && edit.z === target.z && edit.block !== 0;
  }, target);
  await page.evaluate(target => {
    const p = window.__worlds.player, dx = target.x + .5 - p.pos.x, dz = target.z + .5 - p.pos.z;
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(target.y + .5 - (p.pos.y + 1.62), Math.hypot(dx, dz));
  }, target);
  await page.waitForFunction(target => { const t = window.__worlds.interaction.target; return t && t.x === target.x && t.y === target.y && t.z === target.z; }, target);
  const cdp = await page.context().newCDPSession(page);
  const center = async selector => { const r = await page.locator(selector).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const mining = await center('.t-secondary');
  await page.evaluate(() => { window.__sent = []; });
  await touch('touchStart', [{ ...mining, id: 1 }]);
  await page.waitForFunction(() => window.__sent.some(m => m.t === 'bwAction' && m.action.kind === 'break'));
  await touch('touchCancel', []);
  await page.waitForFunction(() => window.__sent.some(m => m.t === 'bwAction' && m.action.kind === 'stopBreak'));
  check('touch cancellation releases mining and sends stopBreak', await page.evaluate(() => !window.__worlds.input.leftDown));
  await touch('touchStart', [{ ...mining, id: 2 }]);
  await page.waitForFunction(target => window.__worlds.world.getBlock(target.x, target.y, target.z) === 0, target, { timeout: 20000 });
  await touch('touchEnd', []);
  check('held touch mining removes the server-confirmed block', true);

  const bowSlot = await page.evaluate(item => window.__worlds.inventory.slots.findIndex(s => s?.id === item), Item.BridgeBow);
  await page.locator(`.slot[data-slot="${bowSlot}"]`).tap();
  await page.waitForFunction(item => window.__worlds.inventory.selectedStack?.id === item, Item.BridgeBow);
  await page.evaluate(() => { window.__sent = []; window.__worlds.player.pitch = .2; });
  const arrows = await count(Item.BridgeArrow), bow = await center('.t-primary');
  await touch('touchStart', [{ ...bow, id: 3 }]);
  await page.waitForFunction(() => window.__worlds.input.rightDown);
  await page.waitForTimeout(1000);
  check('bow charges while held without firing early', await page.evaluate(() => !window.__sent.some(m => m.t === 'bwAction' && m.action.kind === 'shoot')));
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__sent.some(m => m.t === 'bwAction' && m.action.kind === 'shoot' && m.action.power > 0));
  await page.waitForFunction(({ item, before }) => window.__worlds.inventory.countItem(item) === before - 1, { item: Item.BridgeArrow, before: arrows });
  check('release sends a charged bow shot and consumes one authoritative arrow', await page.evaluate(() => !window.__worlds.input.rightDown));
  for (const peer of matchPeers) peer.send(JSON.stringify({ t: 'leaveMatch' }));
  await page.waitForSelector('.bw-result-card', { state: 'visible', timeout: 20000 });
  await page.waitForFunction(() => window.__latest.bwState.s.phase === 'results' && document.querySelector('.t-pads').hidden);
  check('peer forfeits produce real Bedwars results and hide touch controls', await page.evaluate(() => window.__latest.bwState.s.phase === 'results' && document.querySelector('.t-pads').hidden));
  await page.screenshot({ path: `${artifacts}/bedwars-result.png` });
  await page.locator('.bw-result-card button').filter({ hasText: /^Leave$/ }).tap();
  await page.waitForFunction(() => !window.__worlds.bwClient.active);
  check('touch result return leaves Bedwars and clears held inputs', await page.evaluate(() => !window.__worlds.input.leftDown && !window.__worlds.input.rightDown));
}
