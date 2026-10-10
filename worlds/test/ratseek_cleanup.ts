import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Block } from '../src/blocks';
import { Item } from '../src/items';
import { RatSeekMatch, type RsBody, type RsHost, type RsSetup } from '../src/ratseek';
import { RatSeekClient, pickSeeker } from '../src/ratseek_client';
import { RS_PODIUM, rsHouse } from '../src/ratseek_house';
import { rsMoveClear, rsSweepClear } from '../src/ratseek_movement';
import { navPassable, rsSeekerNav, seeThrough } from '../src/ratseek_nav';
import { createBeam, createCatModel, createChandelierModel, createCheeseModel, createRatModel, disposeRsProp,
  labelSprite } from '../src/ratseek_models';
import { glowOf } from '../src/model_primitives';
import { rayAabb } from '../src/ray_aabb';
import { Player } from '../src/player';
import { FROZEN_INPUT } from '../src/input';
import type { PartyState, ServerMsg } from '../src/net/protocol';
import type { RsSnapshot } from '../src/ratseek_rules';

const body = (x: number, y = 81, z = 0.5): RsBody => ({ x, y, z, yaw: 0, pitch: 0, sneaking: false });
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
class Fixture {
  readonly bodies = new Map<number, RsBody>();
  readonly edits = new Map<string, number>();
  readonly messages: { id: number; msg: ServerMsg }[] = [];
  sample: (x: number, y: number, z: number) => number = (_x, y) => y === 80 ? Block.Stone : Block.Air;
  drives = 0;
  private nextBot = 90;
  readonly host: RsHost = {
    nowMs: () => 0, name: (id) => `P${id}`, body: (id) => this.bodies.get(id),
    send: (id, msg) => { this.messages.push({ id, msg }); },
    teleport: (id, x, y, z, yaw = 0) => { this.bodies.set(id, { ...body(x, y, z), yaw }); },
    drive: (id, pose) => { this.drives++; this.bodies.set(id, { ...pose }); },
    getBlock: (x, y, z) => this.edits.get(key(x, y, z)) ?? this.sample(x, y, z),
    setBlock: (x, y, z, b) => { this.edits.set(key(x, y, z), b); },
    addBot: () => this.nextBot++, dropBot: (id) => { this.bodies.delete(id); },
  };
  readonly match: RatSeekMatch;
  constructor(setup: Partial<RsSetup> = {}, rng = () => 0) {
    this.match = new RatSeekMatch(this.host, rng, { humans: [9], bots: [], rats: [1, 2], classes: new Map(), skill: 1, leader: 1, ...setup });
    this.match.phase = 'hunting';
  }
  state(id = 1): RsSnapshot {
    (this.match as unknown as { broadcastState(): void }).broadcastState();
    return (this.messages.filter((m) => m.id === id && m.msg.t === 'rsState').pop()!.msg as Extract<ServerMsg, { t: 'rsState' }>).s;
  }
}

function movementTests(): void {
  const f = new Fixture();
  f.sample = (x, y) => y === 80 || (x === 0 && y >= 81 && y <= 84) ? Block.Stone : Block.Air;
  assert.equal(f.match.acceptMove(1, body(-0.5), body(1.5), 0.1), false, 'endpoint-clear report cannot tunnel through a wall');
  f.match.handleUse(1, 1);
  assert.equal(f.match.acceptMove(1, body(-0.5), body(1.5), 0.1), false, 'authorized scamper still cannot tunnel through a wall');
  assert.equal(f.match.acceptMove(1, body(-0.5), body(NaN), 0.1), false);
  assert.equal(f.match.acceptMove(999, body(-0.5), body(-0.4), 0.1), false);
  const thin = (x: number, y: number): number => x === 0 && y === 81 ? Block.ManorLantern : Block.Air;
  assert.equal(rsMoveClear(body(-0.5), body(1.5), 0.5, thin), false, 'continuous sweep hits narrow lantern shape');
  assert.equal(rsMoveClear(body(-0.5, 81, 0.1), body(1.5, 81, 0.1), 0.5, thin), true, 'shape sweep allows the empty side of a lantern cell');
  const hole = (x: number, y: number): number => y === 80 || (x === 0 && y >= 82 && y <= 84) ? Block.Stone : Block.Air;
  assert.equal(rsMoveClear(body(-0.5), body(1.5), 0.5, hole), true, 'rat fits one-block mousehole');
  assert.equal(rsMoveClear(body(-0.5), body(1.5), 1, hole), false, 'seeker does not fit mousehole');
  const slab = (x: number, y: number): number => y === 80 ? Block.Stone : x === 0 && y === 81 ? Block.ManorMarbleSlab : Block.Air;
  assert.equal(rsMoveClear(body(-0.5), body(0.5, 81.5), 0.5, slab), true, 'auto-step may lift before moving across slab edge');
  assert.equal(rsMoveClear(body(-0.5), body(0.5, 81), 0.5, slab), false, 'flat move does not invent a jump');
  f.sample = slab;
  f.match.addEffect(1, 'jump', 200, 2);
  assert.equal(f.match.acceptMove(1, body(-0.5), body(-0.4, 83.5), 0.1), true, 'bouncy-house rise remains allowed');
  f.match.addEffect(1, 'slow', 80, 6);
  assert.equal(f.match.acceptMove(1, body(-0.5), body(-0.4), 0.05), true, 'pinned correction jitter remains allowed');

  // Real client physics packets through actual manor stairs and mouseholes.
  const trace = (scale: number, spawn: RsBody, steps: number): Player => {
    const t = new Fixture({ rats: scale === 0.5 ? [1, 2] : [2], humans: scale === 1 ? [1] : [9] });
    t.sample = (x, y, z) => rsHouse().at(x, y, z);
    const p = new Player(spawn); p.setBodyScale(scale); p.yaw = spawn.yaw; p.speedMult = t.match.speedOf(1);
    const world = { getBlock: t.sample };
    for (let i = 0; i < steps; i++) {
      const before = { ...body(p.pos.x, p.pos.y, p.pos.z), yaw: p.yaw };
      p.update(0.05, { ...FROZEN_INPUT, forward: true }, world);
      assert.equal(t.match.acceptMove(1, before, p.pos, 0.05), true, `real Player move accepted (${scale}, frame ${i})`);
    }
    return p;
  };
  const rat = trace(0.5, { ...body(-2.5, 81, -8.5), yaw: Math.PI / 2 }, 30);
  assert.ok(rat.pos.x < -4.4, 'validated physics actually crossed mousehole');
  const stairClimb = trace(1, body(1.5, 81, 14.5), 30);
  assert.ok(stairClimb.pos.y > 84, 'validated physics actually climbed the manor stairs');
  const ratStairClimb = trace(0.5, body(1.5, 81, 14.5), 40);
  assert.ok(ratStairClimb.pos.y > 84, 'rat retains unscaled stair step allowance');

  const corner = new Fixture(); corner.sample = (x, y, z) => rsHouse().at(x, y, z);
  const a = body(7.151000000000001, 75.001, -8.035005337322389);
  const b = body(7.151000000000001, 75.001, -8.21190586493665);
  const c = body(7.001974612353537, 75.001, -8.388806392550912);
  corner.match.handleUse(1, 1);
  assert.ok(rsMoveClear(a, b, 0.5, corner.sample) && rsMoveClear(b, c, 0.5, corner.sample));
  assert.equal(rsSweepClear(a, c, 0.3 * 0.5 * 0.85, 1.8 * 0.5 * 0.9, corner.sample), false, 'critic fixture chord intersects the manor corner');
  assert.ok(corner.match.acceptMove(1, a, c, 1 / 30), 'two legitimate corner-slide frames fit a 30 Hz transform');
  const sliding = new Player(a); sliding.setBodyScale(0.5); sliding.onGround = true;
  sliding.yaw = 0.7000797847673755; sliding.speedMult = corner.match.speedOf(1);
  let halfway: RsBody | undefined;
  for (let i = 0; i < 2; i++) {
    // The actual client's ground scamper reapplies its heading each frame.
    sliding.vel.set(-Math.sin(sliding.yaw) * 16, 0, -Math.cos(sliding.yaw) * 16);
    sliding.update(1 / 60, { ...FROZEN_INPUT, forward: true }, { getBlock: corner.sample });
    if (i === 0) halfway = body(sliding.pos.x, sliding.pos.y, sliding.pos.z);
  }
  assert.ok(Math.abs(halfway!.x - a.x) < 1e-5 && sliding.pos.x < a.x, 'real Player slides before clearing the corner');
  assert.ok(corner.match.acceptMove(1, a, sliding.pos, 1 / 30), 'actual aggregated Player scamper packet is accepted');
  const ground = rsSeekerNav().nearest(0.5, 81, 18.5, 2)!;
  const p = new Player({ x: ground.x + 0.5, y: ground.y, z: ground.z + 0.5 });
  p.onGround = true;
  const t = new Fixture(); t.sample = (x, y, z) => rsHouse().at(x, y, z);
  for (let i = 0; i < 25; i++) {
    const before = body(p.pos.x, p.pos.y, p.pos.z);
    p.update(0.05, { ...FROZEN_INPUT, jump: i === 0, forward: true }, { getBlock: t.sample });
    assert.ok(t.match.acceptMove(9, before, p.pos, 0.05), `real jump packet ${i} accepted`);
  }
}

function engineTests(): void {
  const f = new Fixture();
  f.bodies.set(9, body(0.5));
  const top = (x: number, y = 80) => ({ x, y, z: 0, nx: 0, ny: 1, nz: 0 });
  const initial = f.match.kit(9).traps;
  f.match.handleUse(9, 4, top(15));
  f.match.handleUse(9, 4, top(0.25));
  f.match.handleUse(9, 4, { ...top(0), nx: 1 });
  f.match.handleUse(9, 4.5, top(0));
  assert.equal(f.match.kit(9).traps, initial, 'remote, fractional, malformed-face and fractional-slot targets spend no charge');
  f.match.handleUse(9, 4, top(0));
  assert.equal(f.host.getBlock(0, 81, 0), Block.ManorMousetrap, 'near integer top target places trap');
  assert.equal(f.match.canPlaceAt({ x: 4.25, y: 81, z: 0 }, true), false);
  f.edits.set(key(5, 80, 0), Block.ManorMarbleSlab);
  assert.equal(f.match.canPlaceAt({ x: 5, y: 81, z: 0 }, false), false, 'slab below does not support a gadget floating half a block above');
  assert.ok(seeThrough(Block.ManorCageBars) && !navPassable(Block.ManorCageBars), 'visibility and body walkability stay distinct');
  f.edits.set(key(6, 80, 0), Block.ManorCageBars);
  assert.equal(f.match.canPlaceAt({ x: 6, y: 81, z: 0 }, false), true, 'gadget support uses physical top shape independently of ray visibility/nav exclusions');

  const free = f.match.freeRats();
  assert.equal(f.match.freeRats(), free, 'free-rat view reused');
  f.match.cageRat(2, 9);
  assert.deepEqual(f.match.freeRats(), [1]);
  assert.notEqual(f.match.freeRats(), free);
  const internals = f.match as unknown as { rescueRat(id: number): void };
  internals.rescueRat(1);
  assert.deepEqual(f.match.freeRats(), [1, 2], 'rescue invalidates cached membership');
  f.match.rats.set(2, 'caged');
  assert.deepEqual(f.match.freeRats(), [1], 'public fixture edits also invalidate cache');
  f.match.rats.set(2, 'free');
  f.match.leave(2);
  assert.deepEqual(f.match.freeRats(), [1], 'departure invalidates cache');
  const s = f.state();
  assert.ok(!('exchangeLabel' in s) && !('ratCount' in s) && !('seekers' in s), 'unconsumed snapshot fields are absent');

  // Role round trips must not resurrect the previous class cooldowns, inventory,
  // compass locks, score, effects or cached synchronization keys.
  const r = new Fixture(); r.match.phase = 'hiding';
  r.match.handleClass(1, 'scout'); r.match.addPoints(1, 8); r.match.addEffect(1, 'glow', 200, 0);
  r.match.chooseSeeker(1, 1);
  assert.equal(r.match.roleOf(1), 'human');
  assert.equal(r.state().me.cls, null); assert.equal(r.state().me.points, 0);
  r.match.chooseSeeker(1, 9);
  assert.equal(r.match.roleOf(1), 'rat');
  assert.equal(r.state().me.cls, null); assert.equal(r.match.hasEffect(1, 'blind'), false);
  assert.equal(r.match.hasEffect(1, 'glow'), false);
  assert.equal(r.match.slotOf(1, 6)?.id, Item.ClassPicker);
  assert.ok(r.messages.some((m) => m.id === 1 && m.msg.t === 'rsKit' && m.msg.selected === 0), 'role transition forces fresh kit synchronization');
  r.match.leave(1); r.match.chooseSeeker(1, 0);
  assert.equal(r.match.botIds.size, 0, 'departed leader cannot choose a new seeker');

  // Baseline policy: a shrinking cap does not evict earlier class choices.
  const cap = new Fixture({ rats: [1, 2, 3, 4] }); cap.match.phase = 'hiding';
  cap.match.handleClass(1, 'scout'); cap.match.handleClass(2, 'scout'); cap.match.leave(4); cap.match.leave(3);
  assert.equal(cap.match.classes.get(1), 'scout'); assert.equal(cap.match.classes.get(2), 'scout');
  assert.equal(cap.state().classCap, 1);

  // Final bot catch is exercised through its actual tick, including the old
  // post-behave drive that used to overwrite the winner's podium teleport.
  const end = new Fixture({ humans: [], bots: [90], rats: [1], skill: 1.35 });
  const bot = end.match.seekerBots[0];
  end.bodies.set(90, body(0.5)); end.bodies.set(1, body(0.5, 81, -0.5)); bot.syncFromBody();
  Object.assign(bot, { target: { id: 1, decoy: false, x: 0.5, y: 81, z: -0.5, height: 0.9 }, goal: 'chase', decideAt: 100 });
  end.match.addEffect(1, 'invis', 200, 0); end.match.addEffect(1, 'glow', 200, 0);
  end.match.kit(90).lightOn = true;
  bot.tick();
  assert.equal(end.match.phase, 'results');
  assert.equal(end.drives, 0, 'final catch sends no stale bot drive');
  assert.deepEqual({ x: bot.x, y: bot.y, z: bot.z }, RS_PODIUM[0], 'bot state reconciles to podium');
  assert.equal(end.match.result?.podium[0].score, '1 catch');
  assert.ok(!('awards' in end.match.result!), 'unrendered awards contract removed');
  const ended = end.state();
  assert.equal(ended.players.find((p) => p.id === 1)?.hidden, false);
  assert.equal(ended.players.find((p) => p.id === 90)?.light, false);
  assert.equal(ended.me.tauntCd, 0); assert.equal(ended.me.dashCd, 0);
  assert.ok(end.match.kitOf(1).every((slot) => slot === null));
  bot.tick(); assert.equal(end.drives, 0, 'ended bot remains quiescent');
  assert.equal(end.match.botCatch(90, 1), false, 'already caged rat is not another catch');

  // Baseline cadence: direct hit reports have no extra cooldown; swats keep
  // their existing 12-tick cooldown. Cleanup must not silently redesign combat.
  const hits = new Fixture({ rats: [1, 2, 3] }); hits.bodies.set(9, body(0.5));
  for (const id of [1, 2]) hits.bodies.set(id, body(0.5, 81, -0.5));
  hits.match.handleHit(9, 1, false); hits.match.handleHit(9, 2, false);
  assert.equal(hits.state().caged, 2, 'direct hit baseline retains same-tick reports');
  const swats = new Fixture({ rats: [1, 2, 3] }); swats.bodies.set(9, { ...body(0.5), pitch: -0.8 });
  swats.bodies.set(1, body(0.5, 81, -0.5)); swats.bodies.set(2, body(0.5, 81, -0.5));
  swats.match.handleUse(9, 0); swats.match.handleUse(9, 0);
  assert.equal(swats.state().caged, 1, 'swat retains same-tick cooldown');
  swats.match.ticks += 12; swats.match.handleUse(9, 0);
  assert.equal(swats.state().caged, 2, 'swat cooldown remains twelve ticks');

  // Bait feedback credits the authored site, even after a magnet relocates it.
  const bait = new Fixture({ humans: [], bots: [90], rats: [1, 2] });
  const site = { x: 0, y: 81, z: 0 };
  let learned: { x: number; y: number; z: number } | undefined;
  bait.match.seekerBots[0].baitBitten = (_owner, _at, _rat, at) => { learned = at; };
  assert.ok(bait.match.placeBait(90, site));
  bait.match.classes.set(1, 'thief'); bait.bodies.set(1, body(4.5));
  const abilities = bait.match as unknown as { useAbility(id: number): void; tickCheese(): void };
  abilities.useAbility(1); abilities.tickCheese();
  assert.deepEqual(learned, site, 'bait feedback learns the original placement cell');
}

function botAndNavTests(): void {
  const f = new Fixture({ humans: [], bots: [90] }); const bot = f.match.seekerBots[0];
  const passage = rsHouse().passages[0];
  const predictor = bot as unknown as { lastSeenMotion: { x: number; z: number }; predictExit(at: RsBody): { z: number } };
  predictor.lastSeenMotion = { x: 0, z: 0 };
  const at = body(passage.x + 0.5, passage.y, passage.exitA.z + 0.5);
  for (let i = 0; i < 40; i++) bot.tunnelExit(passage.name, true, 1);
  for (let i = 0; i < 300; i++) bot.tunnelExit(passage.name, false, 1);
  assert.equal(predictor.predictExit(at).z, passage.exitB.z + 0.5, 'saturated learning can reverse a formerly strong A bias');

  // Existing observation policy: glow wins over invisibility for bot awareness,
  // even though the client hides invisible bodies; live refresh lasts four ticks.
  f.bodies.set(90, body(0.5)); f.bodies.set(1, body(0.5, 81, -2.5)); bot.syncFromBody();
  f.match.addEffect(1, 'glow', 200, 0); f.match.addEffect(1, 'invis', 200, 0);
  const senses = bot as unknown as { perceive(): void; awareness: Map<string, number>; target: unknown;
    spotted(c: { id: number; decoy: boolean; x: number; y: number; z: number; height: number }): void;
    chaseSpot(): { x: number }; lastSeenTick: number };
  senses.perceive(); senses.perceive();
  assert.ok((senses.awareness.get('r1') ?? 0) >= 1, 'glow/invisibility bot baseline retained');
  senses.spotted({ id: 1, decoy: false, x: 0.5, y: 81, z: -2.5, height: 0.9 });
  f.bodies.set(1, body(1.5, 81, -2.5)); f.match.ticks = senses.lastSeenTick + 4;
  assert.equal(senses.chaseSpot().x, 1.5, 'four-tick live-refresh baseline retained');
  f.match.ticks++; assert.equal(senses.chaseSpot().x, 0.5, 'older unseen target uses last observation');

  const nav = rsSeekerNav() as unknown as { walkable(x: number, y: number, z: number): boolean;
    onStairs(x: number, y: number, z: number): boolean; heuristic(a: number, b: number): number };
  // Nav bounds/index are part of the published grid contract.
  const index = (x: number, y: number, z: number): number => ((y - 74) * 56 + (z + 21)) * 60 + x + 25;
  assert.ok(nav.heuristic(index(0, 81, 0), index(1, 81, 1)) <= 1.414 + 1e-9, 'diagonal heuristic never exceeds diagonal edge cost');
  assert.ok(nav.heuristic(index(0, 81, 0), index(1, 82, 0)) <= 1.4 + 1e-9, 'stair heuristic never exceeds cheapest uphill edge cost');
  assert.ok(nav.heuristic(index(0, 84, 0), index(1, 81, 0)) <= 2.2 + 1e-9, 'drop heuristic never exceeds cheapest downhill edge cost');
}

// Minimal deterministic DOM/timer ports for lifecycle contracts; no browser or
// renderer is needed to verify teardown ownership and pending picker callbacks.
class Element {
  className = ''; textContent = ''; innerHTML = ''; hidden = false;
  parent: Element | null = null; children: Element[] = []; dataset: Record<string, string> = {};
  attrs = new Map<string, string>(); listeners = new Map<string, Set<(event: unknown) => void>>();
  classes = new Set<string>(); focused = 0;
  style: Record<string, unknown> & { setProperty(name: string, value: string): void } = { setProperty(name, value) { this[name] = value; } };
  classList = { add: (s: string) => this.classes.add(s), remove: (s: string) => this.classes.delete(s),
    toggle: (s: string, on: boolean) => on ? this.classes.add(s) : this.classes.delete(s) };
  appendChild(e: Element): void { e.parent = this; this.children.push(e); }
  replaceChildren(): void { for (const c of this.children) c.parent = null; this.children = []; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((e) => e !== this); this.parent = null; }
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (event: unknown) => void): void { this.listeners.get(type)?.delete(fn); }
  querySelector(selector: string): Element | null {
    for (const c of this.children) { if (c.className.split(' ').includes(selector.slice(1))) return c; const found = c.querySelector(selector); if (found) return found; }
    return null;
  }
  querySelectorAll(): Element[] { return []; }
  focus(): void { this.focused++; }
  getContext(): unknown {
    return new Proxy({ measureText: (s: string) => ({ width: s.length * 10 }) }, { get: (target, name) => name in target ? target[name as keyof typeof target] : () => {} });
  }
}

async function clientAndModelsTests(): Promise<void> {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'), oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const doc = new Element(); const timers = new Map<number, () => void>(); let nextTimer = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(doc, { createElement: () => new Element() }) });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout: (fn: () => void) => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: (id: number) => timers.delete(id),
  } });
  try {
    const group = new THREE.Group(), geo = new THREE.BoxGeometry(), mat = new THREE.MeshBasicMaterial(); group.add(new THREE.Mesh(geo, mat));
    let freedGeo = 0, freedMat = 0, freedGlow = 0;
    geo.addEventListener('dispose', () => freedGeo++); mat.addEventListener('dispose', () => freedMat++);
    const glowListener = () => freedGlow++;
    const glow = glowOf(group); glow.set(true); assert.equal(group.children.length, 3);
    const glowMaterials = new Set(group.children.slice(1).map((m) => (m as THREE.Mesh).material as THREE.Material));
    for (const m of glowMaterials) m.addEventListener('dispose', glowListener);
    glow.dispose(); glow.dispose(); glow.set(true);
    assert.equal(group.children.length, 1); assert.equal(freedGeo + freedMat + freedGlow, 0, 'glow teardown only removes borrowed copies');
    for (const m of glowMaterials) m.removeEventListener('dispose', glowListener);
    geo.dispose(); mat.dispose();

    const cheese = createCheeseModel(), sharedMesh = cheese.children[0] as THREE.Mesh;
    const sharedGeo = sharedMesh.geometry, sharedMat = sharedMesh.material as THREE.Material;
    let sharedFrees = 0;
    const sharedListener = () => sharedFrees++;
    sharedGeo.addEventListener('dispose', sharedListener); sharedMat.addEventListener('dispose', sharedListener);
    const watch = (root: THREE.Object3D): Map<THREE.BufferGeometry | THREE.Material | THREE.Texture, number> => {
      const counts = new Map<THREE.BufferGeometry | THREE.Material | THREE.Texture, number>();
      const add = (r: THREE.BufferGeometry | THREE.Material | THREE.Texture): void => {
        if (counts.has(r)) return;
        counts.set(r, 0);
        const events: { addEventListener(type: 'dispose', listener: () => void): void } = r;
        events.addEventListener('dispose', () => counts.set(r, counts.get(r)! + 1));
      };
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          if (o.geometry !== sharedGeo) add(o.geometry);
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m !== sharedMat && !glowMaterials.has(m)) add(m);
        } else if (o instanceof THREE.Sprite) { add(o.material); if (o.material.map) add(o.material.map); }
      });
      return counts;
    };
    const rat = createRatModel(); rat.setGlow(true); const ratOwned = watch(rat.group); rat.dispose(); rat.dispose();
    assert.ok([...ratOwned.values()].every((n) => n === 1), 'rat frees every unique owned geometry/material exactly once');
    const cat = createCatModel(), chandelier = createChandelierModel(), beam = createBeam(), label = labelSprite('Test');
    for (const [root, dispose] of [[cheese, () => disposeRsProp(cheese)], [cat.group, () => cat.dispose()],
      [chandelier, () => disposeRsProp(chandelier)], [beam, () => disposeRsProp(beam)], [label, () => disposeRsProp(label)]] as const) {
      const resources = watch(root); dispose(); dispose();
      assert.ok(resources.size > 0 && [...resources.values()].every((n) => n === 1), 'prop teardown frees owned resources exactly once');
    }
    assert.equal(sharedFrees, 0, 'prop teardown never frees shared cheese geometry/body material');
    sharedGeo.removeEventListener('dispose', sharedListener); sharedMat.removeEventListener('dispose', sharedListener);

    const app = new Element(); const scene = new THREE.Scene();
    const client = new RatSeekClient({ app, scene, atlasCanvas: new Element(), net: { myId: 1, remotes: new Map(), sendRsClass: () => {} },
      audio: { rsCue: () => {} }, particles: { burst: () => {} }, player: { setBodyScale: () => {}, speedMult: 1, jumpBoost: 0 },
      world: { setArenaRenderBounds: () => {} }, remotePlayers: { styleOf: null }, onPanel: () => {} } as never);
    const f = new Fixture(); f.match.phase = 'hiding';
    client.enter('rat'); client.onState(f.state()); client.openPicker(); client.message('hello', '#fff');
    const liveResources = watch(scene);
    assert.equal(client.pickerOpen, true); assert.ok(timers.size >= 3);
    f.match.phase = 'results'; client.onState(f.state()); assert.equal(client.pickerOpen, false, 'results state closes class picker without needing result message');
    client.exit(); assert.equal(timers.size, 0, 'exit cancels delayed focus/feed callbacks');
    assert.ok(liveResources.size > 0 && [...liveResources.values()].every((n) => n === 1), 'client exit actually disposes every live prop resource once');
    const stale = f.state(); client.onState(stale); assert.equal(client.snap, null, 'late state cannot revive exited visuals');
    client.enter('human'); assert.equal(client.role, 'human'); client.exit();

    const party = { members: [{ id: 1, username: 'One' }], leader: 1 } as unknown as PartyState;
    const pre = new AbortController(); pre.abort();
    assert.equal(await pickSeeker(app as unknown as HTMLElement, party, 1, 0, pre.signal), null);
    assert.equal(app.querySelector('.rs-seeker-pick'), null, 'pre-aborted picker creates no DOM');
    const mid = new AbortController(); const pending = pickSeeker(app as unknown as HTMLElement, party, 1, 0, mid.signal);
    assert.ok(app.querySelector('.rs-seeker-pick')); mid.abort();
    assert.equal(await pending, null); assert.equal(app.querySelector('.rs-seeker-pick'), null);
    assert.equal(doc.listeners.get('keydown')?.size ?? 0, 0, 'aborted picker removes document listener');
    assert.equal(timers.size, 0, 'aborted picker cancels pending focus');
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
}

/** Parent suite entry point; await it so asynchronous picker abort checks finish. */
export async function runRatseekCleanupTests(): Promise<void> {
  const min = { x: -1, y: -1, z: -1 }, max = { x: 1, y: 1, z: 1 };
  assert.equal(rayAabb({ x: 0, y: 0, z: -3 }, { x: 0, y: 0, z: 1 }, min, max), 2, 'shared ray-AABB gives forward entry');
  assert.equal(rayAabb({ x: 2, y: 0, z: -3 }, { x: 0, y: 0, z: 1 }, min, max), null, 'parallel ray outside slab misses');
  assert.equal(rayAabb({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, min, max), 0, 'inside-box ray preserves zero-distance entry');
  movementTests(); engineTests(); botAndNavTests(); await clientAndModelsTests();
}
