// The Lucky Pillars practice opponent. It plays through exactly the same
// action gate as a human (sim.handle: place, attack, use, release) and moves
// with the same Player physics, so it bridges, sprints, takes knockback and
// falls into the void like anyone else.
//
// Skill (0.2..1.35) sets bridging speed, clutches, item use and planning; the
// sword runs on a lower `pvp` share so it stays beatable. It starts from what
// the last bot learned about these players and adapts during the match:
// up when a human is winning, gently down when it is running away with it.

import { BLOCKS, isSolid } from './blocks';
import { Player } from './player';
import { FROZEN_INPUT, type PlayerInput } from './input';
import { VMETA } from './vanilla/blocks';
import { VITEM, VI } from './vanilla/items';
import { ARMOR0, OFFHAND } from './vanilla/inventory_model';
import { cooldownScale, attackStats } from './vanilla/combat';
import { enchLevel, type VStack } from './vanilla/stack';
import type { MAction } from './vanilla/messages';
import type { VPlayer } from './vanilla/sim';
import { BOW, THROWN } from './vanilla/ranged';
import { LP } from './pillars_rules';
import { CROWN_Y } from './pillars_geometry';
import type { PillarsMatch } from './pillars';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angleTo = (from: number, to: number) => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const SKILL_MIN = .2, SKILL_MAX = 1.35, START = .5;
type Plan = 'rush' | 'crown' | 'sniper';
const BLOCK_PREF = ['cobblestone', 'oak_planks', 'sandstone', 'end_stone', 'white_wool', 'glass', 'sand', 'hay_block'];

export class PillarsBot {
  skill: number;
  readonly body: Player;
  private readonly baseline: number;
  private input: PlayerInput = { ...FROZEN_INPUT };
  private pitch = 0;
  private noiseYaw = 0; private noisePitch = 0;
  private plan: Plan;
  private foe: number | null = null;
  private time = 0;
  private thinkAt = 0; private adaptAt = 6; private organiseAt = 0;
  private placeAt = 0; private clickAt = 0; private useAt = 0;
  private drawing = -1; private eating = -1;
  private strafe = 1; private strafeUntil = 0;
  private ghostAt = 0;
  private wasAlive = true;
  private lastKills = 0; private lastHumanKills = 0;
  private stuckAt = 0; private stuckPos = { x: 0, z: 0 };
  /** Debug: the last decisions (only filled when globalThis.__lpTrace is set). */
  readonly trace: string[] = [];
  private mode = '';
  private axis: 'x' | 'z' | null = null;
  private planAt = 60; private crownSince = -1;
  private dropping = false;

  constructor(readonly match: PillarsMatch, readonly id: number, learned: number | undefined, private readonly rng: () => number) {
    this.baseline = clamp(learned ?? START, SKILL_MIN, SKILL_MAX);
    this.skill = this.baseline;
    const at = match.host.body(id);
    this.body = new Player(at ? { x: at.x, y: at.y, z: at.z } : { x: 0, y: LP.TOP_Y + 1, z: 0 });
    this.body.energyDrainMult = 0;
    this.body.damageSink = () => {};
    this.body.moveKindAt = (x, y, z) => VMETA[match.host.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]?.move;
    const r = rng();
    this.plan = r < .5 ? 'rush' : r < .8 ? 'crown' : 'sniper';
  }

  get rating(): number { return clamp(this.baseline * .35 + this.skill * .65, SKILL_MIN, SKILL_MAX); }
  /** Fighting share of skill: an adapted bot bridges and plans well but fights like a decent player. */
  private get pvp(): number { return Math.min(1, this.skill) * .55; }
  private get reaction(): number { return lerp(.6, .2, this.pvp / .55); }
  private get turnRate(): number { return lerp(5, 22, Math.min(1, this.skill)); }
  private get hitChance(): number { return lerp(.28, .62, this.pvp / .55); }

  knockback(x: number, y: number, z: number): void { this.body.applyKnockback(x, y, z); }

  private get world() { return { getBlock: (x: number, y: number, z: number) => this.match.host.getBlock(x, y, z), isLoaded: () => true }; }
  private me(): VPlayer | undefined { return this.match.sim.players.get(this.id); }
  private act(a: MAction): void { this.match.handle(this.id, a); }

  tick(dt: number): void {
    this.time += dt;
    const m = this.match, hb = m.host.body(this.id), p = this.me();
    if (!hb || !p) return;
    if (!m.alive.has(this.id)) { this.ghost(); this.wasAlive = false; return; }
    const b = this.body;
    if (!this.wasAlive || Math.hypot(hb.x - b.pos.x, hb.y - b.pos.y, hb.z - b.pos.z) > .8) {
      b.pos.set(hb.x, hb.y, hb.z); b.vel.set(0, 0, 0); b.yaw = hb.yaw; b.gliding = false;
    }
    this.wasAlive = true;
    const prof = m.sim.profileOf(p);
    b.vanilla = { gravity: prof.gravity, slowFall: prof.slowFall, levitation: prof.levitation, frozen: prof.frozen, canSprint: prof.canSprint };
    b.speedMult = prof.speed; b.jumpBoost = prof.jump; b.setBodyScale(prof.scale);
    this.input = { ...FROZEN_INPUT };
    this.dropping = false;
    let held = p.inv.slots[p.selected]?.id ?? 0;
    const actions: (() => void)[] = [];
    if (m.phase === 'main' || m.phase === 'deathmatch') {
      this.adapt();
      if (this.time >= this.organiseAt) { this.organiseAt = this.time + 1; this.organise(p); }
      this.decide(p, actions);
      held = p.inv.slots[p.selected]?.id ?? 0;
    }
    if ((globalThis as { __lpTrace?: boolean }).__lpTrace) {
      const i = this.input;
      this.trace.push(`${this.time.toFixed(2)} ${this.mode} pos=${b.pos.x.toFixed(2)},${b.pos.y.toFixed(2)},${b.pos.z.toFixed(2)} v=${b.vel.y.toFixed(1)} g=${b.onGround ? 1 : 0} in=${i.forward ? 'F' : ''}${i.back ? 'B' : ''}${i.left ? 'L' : ''}${i.right ? 'R' : ''}${i.sneak ? 'S' : ''}${i.jump ? 'J' : ''}${i.sprintKey ? '+' : ''} yaw=${b.yaw.toFixed(2)}`);
      if (this.trace.length > 40) this.trace.shift();
    }
    // Edge guard: about to leave the block underfoot without meaning to? Sneak
    // (sneaking never walks off an edge), unless deliberately dropping.
    if (b.onGround && !this.input.jump && !this.dropping) {
      const ahead = (k: number) => this.floor(b.pos.x + b.vel.x * k, b.pos.y, b.pos.z + b.vel.z * k);
      if (!ahead(.12) || !ahead(.25)) { this.input.sneak = true; this.input.sprintKey = false; }
    }
    b.update(dt, this.input, this.world);
    m.host.drive(this.id, { x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: b.yaw, pitch: this.pitch, held, sneaking: b.sneaking });
    for (const a of actions) a();
  }

  // ── Skill ────────────────────────────────────────────────────────────────

  private adapt(): void {
    if (this.time < this.adaptAt) return;
    this.adaptAt = this.time + 5;
    const m = this.match;
    const humans = [...m.roster.keys()].filter((id) => !m.host.body(id)?.bot);
    if (!humans.length) return;
    const myKills = m.kills.get(this.id) ?? 0;
    const theirKills = humans.reduce((n, h) => n + (m.kills.get(h) ?? 0), 0);
    const humansAlive = humans.filter((h) => m.alive.has(h)).length;
    let lead = theirKills - myKills + (humansAlive ? 0 : -2);
    const myHp = this.me()?.hp ?? 20;
    const theirHp = humans.filter((h) => m.alive.has(h)).reduce((n, h) => Math.max(n, m.sim.players.get(h)?.hp ?? 0), 0);
    lead += (theirHp - myHp) / 8;
    const step = lead > 0 ? clamp(lead * .03, 0, .08) : clamp(lead * .02, -.05, 0);
    this.skill = clamp(this.skill + step, SKILL_MIN, SKILL_MAX);
    if (theirKills > this.lastHumanKills) { this.skill = clamp(this.skill + .04 * (theirKills - this.lastHumanKills), SKILL_MIN, SKILL_MAX); this.lastHumanKills = theirKills; }
    if (myKills > this.lastKills) { this.skill = clamp(this.skill - .02 * (myKills - this.lastKills), SKILL_MIN, SKILL_MAX); this.lastKills = myKills; }
  }

  // ── Inventory ────────────────────────────────────────────────────────────

  /** Wear the best armour; keep weapon, blocks, bow, food in fixed hotbar slots. */
  private organise(p: VPlayer): void {
    const inv = p.inv.slots;
    const armorScore = (s: VStack | null) => { const a = s ? VITEM[s.id]?.armor : undefined; return a ? a.points * 10 + a.toughness * 4 + enchLevel(s, 'protection') * 3 : -1; };
    for (let i = 0; i < 36; i++) {
      const s = inv[i]; const a = s ? VITEM[s.id]?.armor : undefined;
      if (!a || VITEM[s!.id]?.key === 'elytra') continue;
      const slot = ARMOR0 + ['head', 'chest', 'legs', 'feet'].indexOf(a.slot);
      if (armorScore(s) > armorScore(inv[slot])) { const worn = inv[slot]; inv[slot] = s; inv[i] = worn; p.invDirty = true; }
    }
    const weaponScore = (s: VStack | null) => {
      if (!s) return 0;
      const st = attackStats(s);
      return (st.damage + enchLevel(s, 'sharpness') * .6 + enchLevel(s, 'knockback') * 1.2) * Math.min(1, st.speed / 1.4) + (VITEM[s.id]?.key === 'mace' ? 1 : 0);
    };
    const place = (want: (s: VStack) => boolean, slot: number, better?: (a: VStack, b: VStack) => boolean) => {
      let best = -1;
      for (let i = 0; i < 36; i++) { const s = inv[i]; if (s && want(s) && (best < 0 || (better && better(s, inv[best]!)))) best = i; }
      if (best >= 0 && best !== slot && !(inv[slot] && want(inv[slot]!) && (!better || !better(inv[best]!, inv[slot]!)))) {
        const t = inv[slot]; inv[slot] = inv[best]; inv[best] = t; p.invDirty = true;
      }
    };
    place((s) => weaponScore(s) > 1.1, 0, (a, b) => weaponScore(a) > weaponScore(b));
    place((s) => this.isBlock(s), 1, (a, b) => a.count > b.count);
    place((s) => s.id === VI.bow || s.id === VI.crossbow, 2);
    place((s) => !!VITEM[s.id]?.food, 3, (a, b) => (VITEM[a.id]!.food!.saturation) > (VITEM[b.id]!.food!.saturation));
    place((s) => s.id === VI.ender_pearl || s.id === VI.wind_charge || s.id === VI.snowball || s.id === VI.egg, 4);
    place((s) => s.id === VI.water_bucket, 5);
    place((s) => s.id === VI.splash_potion || s.id === VI.potion, 6);
    if (inv[OFFHAND] === null) { const t = inv.findIndex((s, i) => i < 36 && s?.id === VI.totem_of_undying); if (t >= 0) { inv[OFFHAND] = inv[t]; inv[t] = null; p.invDirty = true; } }
  }
  private isBlock(s: VStack): boolean {
    const d = VITEM[s.id];
    if (!d?.block) return false;
    const f = VMETA[d.block]?.family ?? '';
    return BLOCK_PREF.includes(f) || /_wool$/.test(f);
  }
  private select(slot: number): void {
    const p = this.me();
    if (p && p.selected !== slot) this.act({ k: 'select', slot });
  }

  // ── Decisions ────────────────────────────────────────────────────────────

  private decide(p: VPlayer, actions: (() => void)[]): void {
    const m = this.match, b = this.body;
    // Finish what's in progress: eating, drawing a bow.
    if (this.eating >= 0) {
      if (this.time - this.eating < 1.7 && p.using) { this.input.sneak = true; return; }
      this.eating = -1;
    }
    this.mode = 'clutch';
    if (this.clutch(p, actions)) return;
    this.mode = 'lava';
    if (this.lavaEscape(p, actions)) return;
    this.mode = 'heal';
    if (this.heal(p, actions)) return;
    this.mode = 'ranged';
    // Pick a foe (nearest alive, sometimes the leader).
    if (this.time >= this.thinkAt) {
      this.thinkAt = this.time + lerp(1.2, .4, Math.min(1, this.skill));
      let best: number | null = null, bd = Infinity;
      for (const id of m.alive) {
        if (id === this.id) continue;
        const ob = m.host.body(id);
        if (!ob) continue;
        const d = Math.hypot(ob.x - b.pos.x, ob.z - b.pos.z) + Math.abs(ob.y - b.pos.y) * 2;
        if (d < bd) { bd = d; best = id; }
      }
      this.foe = best;
    }
    const fb = this.foe !== null ? m.host.body(this.foe) : undefined;
    const dm = m.phase === 'deathmatch';
    if (fb) {
      const d = Math.hypot(fb.x - b.pos.x, fb.z - b.pos.z), dy = fb.y - b.pos.y;
      if (d < 4 && Math.abs(dy) < 2.5) { this.mode = 'melee'; this.melee(p, fb, d, actions); return; }
      if (this.ranged(p, fb, d, actions)) return;
    }
    // Move: deathmatch to the platform, crown players to the crown, else at the foe.
    // Re-think the plan every minute; a crown stint lasts 30-45 s, then hunt.
    if (this.time >= this.planAt) { this.planAt = this.time + 60; const r = this.rng(); this.plan = r < .55 ? 'rush' : r < .85 ? 'crown' : 'sniper'; this.crownSince = -1; }
    const onCrown = Math.floor(b.pos.x) === 0 && Math.floor(b.pos.z) === 0 && b.pos.y > CROWN_Y + .5;
    if (onCrown && this.crownSince < 0) this.crownSince = this.time;
    if (this.plan === 'crown' && this.crownSince >= 0 && this.time - this.crownSince > 30 + this.rng() * 15) this.plan = 'rush';
    const goal = dm ? { x: .5, y: LP.TOP_Y + 1, z: .5 }
      : this.plan === 'crown' && m.mainElapsed > 200 && m.alive.size > 2 && (!fb || Math.hypot(fb.x - b.pos.x, fb.z - b.pos.z) > 10) ? { x: .5, y: CROWN_Y + 1, z: .5 }
        : fb ? { x: fb.x, y: fb.y, z: fb.z } : null;
    if (this.plan === 'sniper' && fb && !dm && Math.hypot(fb.x - b.pos.x, fb.z - b.pos.z) > 8 && this.hasBow(p) && this.time - this.planAt + 60 < 40) return;
    if (goal) { this.mode = 'bridge'; this.bridgeTo(p, goal, actions); }
  }

  private melee(p: VPlayer, fb: { x: number; y: number; z: number }, d: number, actions: (() => void)[]): void {
    const b = this.body;
    this.select(0);
    this.aimAt({ x: fb.x, y: fb.y + 1.2, z: fb.z }, .12, lerp(4, 10, this.pvp / .55));
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    const edgeAhead = !this.floor(b.pos.x + fx * .9, b.pos.y, b.pos.z + fz * .9);
    const reachNow = 3 + (this.match.sim.attr(this.id).reach ?? 0) - .3;
    // Out of reach with a gap between us: bridge in rather than wait at the edge.
    if (edgeAhead && d > reachNow - .2) { this.bridgeTo(p, fb, actions); this.aimAt({ x: fb.x, y: fb.y + 1.2, z: fb.z }, .12); return; }
    this.input.forward = d > 2.4 && !edgeAhead;
    this.input.sprintKey = this.input.forward;
    if (d < 1.4) this.input.back = true;
    if (this.pvp > .2) {
      if (this.time >= this.strafeUntil) { this.strafe = this.rng() < .5 ? -1 : 1; this.strafeUntil = this.time + .8 + this.rng() * .7; }
      const rx = Math.cos(b.yaw) * this.strafe, rz = -Math.sin(b.yaw) * this.strafe;
      if (this.floor(b.pos.x + rx * 1.1, b.pos.y, b.pos.z + rz * 1.1)) { if (this.strafe > 0) this.input.right = true; else this.input.left = true; }
      else this.strafe = -this.strafe;
    }
    // Swing on a charged cooldown, sometimes jumping for a crit.
    const held = p.inv.slots[p.selected];
    const ready = cooldownScale(p.attackTicks, attackStats(held).speed) >= lerp(.6, .95, this.pvp / .55) - this.rng() * .1;
    if (this.pvp > .3 && ready && b.onGround && d < 3 && this.rng() < this.pvp * .25) this.input.jump = true;
    const reach = 3 + (this.match.sim.attr(this.id).reach ?? 0) - .3;
    if (d <= reach && ready && this.time >= this.clickAt && (b.onGround || b.vel.y < 0 || this.pvp < .3)) {
      this.clickAt = this.time + this.reaction * .4;
      if (this.rng() > this.hitChance) { p.attackTicks = 0; return; }
      const target = this.foe!;
      actions.push(() => this.act({ k: 'attack', target }));
    }
  }

  private hasBow(p: VPlayer): boolean {
    return p.inv.slots.some((s, i) => i < 36 && (s?.id === VI.bow || s?.id === VI.crossbow)) && p.inv.slots.some((s, i) => i < 41 && (s?.id === VI.arrow || s?.id === VI.spectral_arrow));
  }

  /** Bow at range, throwables at bridgers, pearls to close a long gap. */
  private ranged(p: VPlayer, fb: { x: number; y: number; z: number }, d: number, actions: (() => void)[]): boolean {
    const b = this.body, inv = p.inv.slots;
    const eye = { x: b.pos.x, y: b.pos.y + 1.62, z: b.pos.z };
    const ballistic = (speed: number, gravity: number) => {
      const dy = fb.y + 1.1 - eye.y, v2 = speed * speed, g = gravity;
      const disc = v2 * v2 - g * (g * d * d + 2 * dy * v2);
      return disc < 0 ? null : Math.atan((v2 - Math.sqrt(disc)) / (g * d));
    };
    const yaw = Math.atan2(-(fb.x - eye.x), -(fb.z - eye.z));
    if (this.drawing >= 0) {
      const pitch = (ballistic(BOW.speed * 20, 20) ?? .3) - BOW.lift;
      this.turnTo(yaw, pitch, .08);
      if (this.time - this.drawing >= lerp(1.3, 1.02, Math.min(1, this.skill))) {
        this.drawing = -1;
        actions.push(() => this.act({ k: 'useEnd', slot: p.selected, yaw: this.body.yaw, pitch: this.pitch }));
      }
      return true;
    }
    if (this.pvp < .2 || this.time < this.useAt) return false;
    const bow = inv.findIndex((s, i) => i < 9 && s?.id === VI.bow);
    if (bow >= 0 && d > 7 && d < 35 && this.hasBow(p) && b.onGround) {
      this.select(bow);
      this.drawing = this.time;
      this.useAt = this.time + 2;
      actions.push(() => this.act({ k: 'use', slot: bow, yaw: this.body.yaw, pitch: this.pitch }));
      return true;
    }
    const throwable = inv.findIndex((s, i) => i < 9 && (s?.id === VI.snowball || s?.id === VI.egg || (s?.id === VI.wind_charge && d < 7)));
    if (throwable >= 0 && d > 3 && d < 14 && this.rng() < .5) {
      const t = THROWN[VITEM[inv[throwable]!.id]?.key ?? ''] ?? THROWN.snowball;
      const pitch = (ballistic(t.speed * 20, 12) ?? .2) - t.lift;
      this.select(throwable);
      this.turnTo(yaw, pitch, .1);
      this.useAt = this.time + lerp(1.4, .5, Math.min(1, this.skill));
      if (Math.abs(angleTo(b.yaw, yaw)) < .25) actions.push(() => this.act({ k: 'use', slot: throwable, yaw: this.body.yaw, pitch: this.pitch }));
      return true;
    }
    const pearl = inv.findIndex((s, i) => i < 9 && s?.id === VI.ender_pearl);
    if (pearl >= 0 && d > 18 && this.skill > .5 && this.rng() < .3) {
      const aim = ballistic(THROWN.ender_pearl.speed * 20, 12);
      const pitch = aim === null ? null : aim - THROWN.ender_pearl.lift;
      if (pitch !== null) {
        this.select(pearl);
        this.turnTo(yaw, pitch, .04);
        this.useAt = this.time + 3;
        if (Math.abs(angleTo(b.yaw, yaw)) < .15) actions.push(() => this.act({ k: 'use', slot: pearl, yaw: this.body.yaw, pitch: this.pitch }));
        return true;
      }
    }
    return false;
  }

  /** Walk toward a goal on our own level, placing blocks over the void. */
  private bridgeTo(p: VPlayer, goal: { x: number; y: number; z: number }, actions: (() => void)[]): void {
    const b = this.body, pos = b.pos;
    const dx = goal.x - pos.x, dz = goal.z - pos.z;
    // Never steer off an edge mid-air: bridging decisions are made on the ground.
    if (!b.onGround && !b.climbing) { this.input.sneak = true; return; }
    // Close below a higher goal: tower up first.
    if (goal.y > pos.y + 1.5 && Math.hypot(dx, dz) < 3.2) { this.pillarUp(p, actions); return; }
    // Right over a lower target: step off and drop onto it.
    const len = Math.hypot(dx, dz) || 1;
    const landing = (() => {
      const lx = Math.floor(pos.x + dx / len * Math.min(1, len)), lz = Math.floor(pos.z + dz / len * Math.min(1, len));
      for (let y = Math.floor(pos.y) - 1; y >= Math.floor(pos.y) - 10; y--) if (isSolid(this.match.host.getBlock(lx, y, lz))) return y;
      return null;
    })();
    if (Math.hypot(dx, dz) < 2.2 && goal.y < pos.y - 1.5 && landing !== null && landing >= goal.y - 2) {
      this.dropping = true;
      this.turnTo(Math.atan2(-dx, -dz), 0, 0);
      this.input.forward = true;
      return;
    }
    if (Math.hypot(dx, dz) < .8) {
      if (goal.y > pos.y + .5 && b.onGround) this.pillarUp(p, actions);
      return;
    }
    // Axis-aligned bridges: keep the current axis until we are lined up on it
    // (hysteresis), then turn onto the other.
    if (this.axis === 'x' && Math.abs(dx) < .6) this.axis = 'z';
    else if (this.axis === 'z' && Math.abs(dz) < .6) this.axis = 'x';
    else if (this.axis === null) this.axis = Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
    const ax = this.axis === 'x' ? Math.sign(dx) || 1 : 0;
    const az = this.axis === 'z' ? Math.sign(dz) || 1 : 0;
    const yaw = Math.atan2(-ax, -az);
    const fy = Math.floor(pos.y - .05);
    // The block we actually stand on (on a rim the centre can be over air):
    // the one furthest along the way we are going.
    let cx = Math.floor(pos.x), cz = Math.floor(pos.z), best = -Infinity;
    for (const ox of [-.29, 0, .29]) for (const oz of [-.29, 0, .29]) {
      const sx = Math.floor(pos.x + ox), sz = Math.floor(pos.z + oz);
      if (!isSolid(this.match.host.getBlock(sx, fy, sz))) continue;
      const along = (sx + .5) * ax + (sz + .5) * az;
      if (along > best) { best = along; cx = sx; cz = sz; }
    }
    const ahead = { x: cx + ax, y: fy, z: cz + az };
    const need = !isSolid(this.match.host.getBlock(ahead.x, ahead.y, ahead.z));
    if (need) this.turnTo(yaw, .55, 0);
    if (need) {
      const slot = this.blockSlot(p);
      if (slot < 0) { this.input.forward = false; return; }
      this.select(slot);
      // Sneak to the edge, then place against the block we stand on.
      this.input.sneak = this.skill < .9 || Math.hypot(pos.x - (cx + .5), pos.z - (cz + .5)) > .3;
      this.input.forward = true;
      if (this.time >= this.placeAt && isSolid(this.match.host.getBlock(cx, fy, cz))) {
        this.placeAt = this.time + lerp(.45, .12, Math.min(1, this.skill)) * (.85 + this.rng() * .3);
        const hit = { x: cx, y: fy, z: cz, nx: ax, ny: 0, nz: az, hitY: .5 };
        actions.push(() => this.act({ k: 'use', slot, block: hit, yaw: this.body.yaw, pitch: this.pitch }));
      }
      return;
    }
    // Stay on the centreline of a narrow bridge: steer across the travel axis.
    const lateral = ax !== 0 ? (Math.floor(pos.z) + .5) - pos.z : (Math.floor(pos.x) + .5) - pos.x;
    const centre = ax !== 0 ? { x: pos.x + ax, z: Math.floor(pos.z) + .5 } : { x: Math.floor(pos.x) + .5, z: pos.z + az };
    const steer = Math.atan2(-(centre.x - pos.x), -(centre.z - pos.z));
    this.turnTo(Math.abs(lateral) > .15 ? steer : yaw, 0, 0);
    const narrow = !this.floor(pos.x + (az !== 0 ? 1 : 0), pos.y, pos.z + (ax !== 0 ? 1 : 0)) || !this.floor(pos.x - (az !== 0 ? 1 : 0), pos.y, pos.z - (ax !== 0 ? 1 : 0));
    this.input.forward = Math.abs(angleTo(b.yaw, yaw)) < .5;
    this.input.sprintKey = this.input.forward && Math.hypot(dx, dz) > 4 && !narrow;
    this.input.sneak = narrow && this.skill < .7;
    // Hop up single steps; stuck detection.
    const fx = pos.x - Math.sin(b.yaw) * .6, fz = pos.z - Math.cos(b.yaw) * .6;
    if (b.onGround && isSolid(this.match.host.getBlock(Math.floor(fx), Math.floor(pos.y + .1), Math.floor(fz)))) this.input.jump = true;
    if (Math.hypot(pos.x - this.stuckPos.x, pos.z - this.stuckPos.z) > .5) { this.stuckAt = this.time; this.stuckPos = { x: pos.x, z: pos.z }; }
    else if (this.time - this.stuckAt > 2) { if (b.onGround) this.input.jump = true; this.stuckAt = this.time; }
  }
  private pillarUp(p: VPlayer, actions: (() => void)[]): void {
    const slot = this.blockSlot(p);
    if (slot < 0) return;
    this.select(slot);
    this.turnTo(this.body.yaw, -1.5, 0);
    const b = this.body;
    if (b.onGround) this.input.jump = true;
    const cx = Math.floor(b.pos.x), cz = Math.floor(b.pos.z), fy = Math.floor(b.pos.y - .05);
    if (b.vel.y < 1 && b.pos.y - (fy + 1) > .9 && this.time >= this.placeAt && isSolid(this.match.host.getBlock(cx, fy, cz))) {
      this.placeAt = this.time + .25;
      actions.push(() => this.act({ k: 'use', slot, block: { x: cx, y: fy, z: cz, nx: 0, ny: 1, nz: 0, hitY: 1 }, yaw: this.body.yaw, pitch: this.pitch }));
    }
  }
  private blockSlot(p: VPlayer): number {
    return p.inv.slots.findIndex((s, i) => i < 9 && !!s && this.isBlock(s));
  }

  /** Knocked off: a block under our feet, or water before landing. */
  private clutch(p: VPlayer, actions: (() => void)[]): boolean {
    const b = this.body;
    if (b.onGround || b.vel.y > -2 || this.skill < .55) return false;
    const cx = Math.floor(b.pos.x), cz = Math.floor(b.pos.z), y = Math.floor(b.pos.y - .5);
    const slot = this.blockSlot(p);
    if (slot >= 0) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!isSolid(this.match.host.getBlock(cx + dx, y, cz + dz))) continue;
        this.select(slot);
        this.turnTo(Math.atan2(dx, dz), -1.3, 0);
        if (this.time >= this.placeAt) {
          this.placeAt = this.time + .06;
          actions.push(() => this.act({ k: 'use', slot, block: { x: cx + dx, y, z: cz + dz, nx: -dx, ny: 0, nz: -dz, hitY: .5 }, yaw: this.body.yaw, pitch: this.pitch }));
        }
        return true;
      }
    }
    // Water bucket: land in it, then pick it back up.
    const water = p.inv.slots.findIndex((s, i) => i < 9 && s?.id === VI.water_bucket);
    if (water >= 0 && this.skill > .8) {
      for (let dy = 1; dy <= 5; dy++) {
        const gy = Math.floor(b.pos.y) - dy;
        if (!isSolid(this.match.host.getBlock(cx, gy, cz))) continue;
        if (dy > 3) return false;
        this.select(water);
        this.turnTo(this.body.yaw, -1.5, 0);
        actions.push(() => this.act({ k: 'use', slot: water, block: { x: cx, y: gy, z: cz, nx: 0, ny: 1, nz: 0, hitY: 1 }, yaw: this.body.yaw, pitch: this.pitch }));
        return true;
      }
    }
    return false;
  }

  private lavaEscape(p: VPlayer, actions: (() => void)[]): boolean {
    const m = this.match;
    if (m.lavaY < 0 || this.body.pos.y - m.lavaY > 4 || !this.body.onGround) return false;
    this.pillarUp(p, actions);
    return true;
  }

  private heal(p: VPlayer, actions: (() => void)[]): boolean {
    const inv = p.inv.slots;
    const maxHp = this.match.sim.maxHp(this.id);
    const low = p.hp < maxHp * .55;
    const gap = inv.findIndex((s, i) => i < 9 && (s?.id === VI.golden_apple || s?.id === VI.enchanted_golden_apple));
    const food = inv.findIndex((s, i) => i < 9 && !!s && !!VITEM[s.id]?.food && s.id !== VI.chorus_fruit);
    const slot = low && gap >= 0 ? gap : p.hunger.food < 15 && food >= 0 && (!this.foe || this.distToFoe() > 7) ? food : -1;
    if (slot >= 0 && this.skill > .3 && this.time >= this.useAt) {
      this.select(slot);
      this.eating = this.time;
      this.useAt = this.time + 2.2;
      actions.push(() => this.act({ k: 'use', slot, yaw: this.body.yaw, pitch: this.pitch }));
      return true;
    }
    const splash = inv.findIndex((s, i) => i < 9 && s?.id === VI.splash_potion && s.potion?.effects.some(([e]) => e === 'instant_health'));
    if (low && splash >= 0 && this.time >= this.useAt) {
      this.select(splash);
      this.turnTo(this.body.yaw, -1.5, 0);
      this.useAt = this.time + 1;
      actions.push(() => this.act({ k: 'use', slot: splash, yaw: this.body.yaw, pitch: -1.5 }));
      return true;
    }
    return false;
  }
  private distToFoe(): number {
    const fb = this.foe !== null ? this.match.host.body(this.foe) : undefined;
    return fb ? Math.hypot(fb.x - this.body.pos.x, fb.z - this.body.pos.z) : Infinity;
  }

  /** Out of the match: an occasional cheer or boo, like a human ghost. */
  private ghost(): void {
    const m = this.match;
    if (m.phase !== 'main' && m.phase !== 'deathmatch' || this.time < this.ghostAt) return;
    this.ghostAt = this.time + 26 + this.rng() * 20;
    const targets = [...m.alive];
    if (!targets.length) return;
    const t = targets[Math.floor(this.rng() * targets.length)];
    this.act({ k: 'menu', menu: 'ghost', id: `${this.rng() < .5 ? 'cheer' : 'boo'}:${t}` });
  }

  // ── Aim and queries ──────────────────────────────────────────────────────

  private aimAt(t: { x: number; y: number; z: number }, noise: number, rate = this.turnRate): void {
    const b = this.body, eye = { x: b.pos.x, y: b.pos.y + 1.62, z: b.pos.z };
    this.turnTo(Math.atan2(-(t.x - eye.x), -(t.z - eye.z)), Math.atan2(t.y - eye.y, Math.hypot(t.x - eye.x, t.z - eye.z)), noise, rate);
  }
  private turnTo(yaw: number, pitch: number, noise: number, rate = this.turnRate): void {
    const err = noise * lerp(4, .35, Math.min(1, this.skill));
    this.noiseYaw += ((this.rng() - .5) * 2 * err - this.noiseYaw) * .15;
    this.noisePitch += ((this.rng() - .5) * err - this.noisePitch) * .15;
    const step = rate * .05;
    this.body.yaw += clamp(angleTo(this.body.yaw, yaw + this.noiseYaw), -step, step);
    this.pitch = clamp(this.pitch + clamp(pitch + this.noisePitch - this.pitch, -step, step), -1.55, 1.55);
  }
  private floor(x: number, y: number, z: number): boolean {
    return !!BLOCKS[this.match.host.getBlock(Math.floor(x), Math.floor(y - .05), Math.floor(z))]?.solid;
  }
}
