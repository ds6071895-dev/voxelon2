// The Disaster City practice opponent. It moves with the same Player physics
// and acts through the same gate as a human. It reads the warnings everyone
// sees and runs for the best shelter it can judge: underground or under a
// roof from meteors, acid, lightning and snow; high ground from floods and
// waves; out of wooden buildings in a fire; away from tornadoes and hissing
// gas; it fights or flees zombies and eats when hungry.
//
// Skill (0.2..1.35) sets how fast it reacts, how well it picks shelter (a
// weaker bot misjudges more and sometimes stays put) and how it fights. It
// adapts toward a close finish against the humans and is remembered.

import { BLOCKS, isSolid } from './blocks';
import { Player } from './player';
import { FROZEN_INPUT, type PlayerInput } from './input';
import { VMETA } from './vanilla/blocks';
import { VITEM } from './vanilla/items';
import { findPath } from './vanilla/mobs';
import { KINDS } from './vanilla/entity';
import type { MAction } from './vanilla/messages';
import { BUILDINGS, CITY, bcx, bcz, buildingAt, type DisasterKind } from './disaster_rules';
import type { DisasterMatch } from './disaster';
import { cityStamp } from './disaster_city';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angleTo = (a: number, b: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

interface Spot {
  name: string; x: number; y: number; z: number; covered: boolean; under: boolean; wooden: boolean; tall: boolean; inside: boolean;
  /** Only reachable by ladder: zombies can't follow. */
  ladder?: boolean;
  /** Big open area: each bot stands a little apart. */
  spread?: boolean;
}
const G = CITY.GROUND + 1;
export const SPOTS: Spot[] = [
  { name: 'subway', x: .5, y: CITY.SUBWAY_FLOOR + 1, z: 15.5, covered: true, under: true, wooden: false, tall: false, inside: true },
  { name: 'subway west', x: -24.5, y: CITY.SUBWAY_FLOOR + 1, z: 15.5, covered: true, under: true, wooden: false, tall: false, inside: true },
  { name: 'garage', x: 30.5, y: G, z: 2.5, covered: true, under: false, wooden: false, tall: false, inside: true, spread: true },
  { name: 'garage top', x: 31.5, y: CITY.GROUND + 13, z: 2.5, covered: false, under: false, wooden: false, tall: false, inside: false, spread: true },
  { name: 'office', x: 2.5, y: G, z: -36.5, covered: true, under: false, wooden: false, tall: true, inside: true },
  { name: 'skyscraper', x: -31.5, y: G, z: -28.5, covered: true, under: false, wooden: false, tall: true, inside: true },
  { name: 'shops', x: -27.5, y: G, z: -1.5, covered: true, under: false, wooden: true, tall: false, inside: true },
  { name: 'fire station', x: -1.5, y: G, z: 33.5, covered: true, under: false, wooden: true, tall: false, inside: true },
  { name: 'diner', x: 25.5, y: G, z: 35.5, covered: true, under: false, wooden: true, tall: false, inside: true },
  { name: 'apartments', x: 31.5, y: G, z: -31.5, covered: true, under: false, wooden: true, tall: true, inside: true },
  { name: 'plaza', x: 5.5, y: G, z: 5.5, covered: false, under: false, wooden: false, tall: false, inside: false, spread: true },
];

const solidAt = (get: (x: number, y: number, z: number) => number, x: number, y: number, z: number) => !!BLOCKS[get(x, y, z)]?.solid;
const ladderAt = (get: (x: number, y: number, z: number) => number, x: number, y: number, z: number) => VMETA[get(x, y, z)]?.move === 'ladder';
const canStand = (get: (x: number, y: number, z: number) => number, x: number, y: number, z: number) =>
  solidAt(get, x, y - 1, z) && !solidAt(get, x, y, z) && !solidAt(get, x, y + 1, z) && !ladderAt(get, x, y, z) && !BLOCKS[get(x, y, z)]?.fluid;

/** The fixed spots plus a roof at the top of every ladder in the city
 *  (found once per process): the horde can't climb after you. */
let allSpots: Spot[] | null = null;
export function spotList(): Spot[] {
  if (allSpots) return allSpots;
  const st = cityStamp();
  const get = (x: number, y: number, z: number) => st.get(x, y, z);
  allSpots = [...SPOTS];
  for (let x = CITY.MIN; x <= CITY.MAX; x++) for (let z = CITY.MIN; z <= CITY.MAX; z++) {
    if (!ladderAt(get, x, G, z)) continue;
    let top = G;
    while (ladderAt(get, x, top + 1, z)) top++;
    const b = buildingAt(x, z) ?? BUILDINGS.find((q) => x >= q.x1 - 1 && x <= q.x2 + 1 && z >= q.z1 - 1 && z <= q.z2 + 1) ?? null;
    const cx = b ? bcx(b) : x, cz = b ? bcz(b) : z;
    // A roof cell next to the ladder top, toward the building's middle.
    let best: [number, number, number] | null = null, bd = Infinity;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (const y of [top + 1, top + 2]) {
      const sx = x + dx, sz = z + dz;
      if (!canStand(get, sx, y, sz)) continue;
      const d = Math.hypot(dx, dz) * 2 + Math.hypot(sx - cx, sz - cz) * .5 + (y - top - 1) * 3;
      if (d < bd) { bd = d; best = [sx, y, sz]; }
    }
    if (!best) continue;
    allSpots.push({
      name: `${b?.name ?? 'ladder'} roof`, x: best[0] + .5, y: best[1], z: best[2] + .5,
      covered: false, under: false, wooden: !!b?.wooden, tall: best[1] > CITY.GROUND + 20, inside: false, ladder: true,
    });
  }
  return allSpots;
}

/** Waypoints from the plaza to each spot, found once per process on the
 *  pristine city with a big search budget (the city is fixed). Bots then
 *  path cheaply from waypoint to waypoint. */
const routes = new Map<string, [number, number, number][]>();
/** Found the first time any bot heads for the spot (once per process). */
function spotRoute(sp: Spot): [number, number, number][] {
  const known = routes.get(sp.name);
  if (known) return known;
  const s = cityStamp();
  const get = (x: number, y: number, z: number) => s.get(x, y, z);
  const path = findPath(get, CITY.PLAZA_X + 7, G, CITY.PLAZA_Z, Math.floor(sp.x), Math.floor(sp.y), Math.floor(sp.z), 2, 30000, true) ?? [];
  const via: [number, number, number][] = [];
  for (let i = 10; i < path.length - 4; i += 10) via.push(path[i]);
  routes.set(sp.name, via);
  return via;
}

export class DisasterBot {
  skill: number;
  readonly body: Player;
  private readonly baseline: number;
  private input: PlayerInput = { ...FROZEN_INPUT };
  private pitch = 0;
  private time = 0;
  private target: Spot | null = null;
  private path: [number, number, number][] = [];
  /** Waypoints left on the way to `target`. */
  private via: [number, number, number][] = [];
  private pathAt = -9;
  private thinkAt = 0;
  private seenKinds = '';
  private reactAt = 0;
  private clickAt = 0;
  private eatAt = 0;
  private stuckAt = 0; private stuckPos = { x: 0, z: 0 };
  private wasAlive = true;
  private adaptAt = 20;
  private readonly noise = new Map<string, number>();

  constructor(readonly match: DisasterMatch, readonly id: number, learned: number | undefined, private readonly rng: () => number) {
    this.baseline = clamp(learned ?? .5, .2, 1.35);
    this.skill = this.baseline;
    const at = match.host.body(id);
    this.body = new Player(at ? { x: at.x, y: at.y, z: at.z } : { x: 0, y: G, z: 7 });
    this.body.energyDrainMult = 0;
    this.body.damageSink = () => {};
    this.body.moveKindAt = (x, y, z) => VMETA[match.host.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]?.move;
  }
  get rating(): number { return clamp(this.baseline * .35 + this.skill * .65, .2, 1.35); }
  knockback(x: number, y: number, z: number): void { this.body.applyKnockback(x, y, z); }
  setVelocity(vx: number, vy: number, vz: number, add: boolean): void {
    if (add) this.body.vel.set(this.body.vel.x + vx, this.body.vel.y + vy, this.body.vel.z + vz);
    else this.body.vel.set(vx, vy, vz);
    this.body.onGround = false;
    this.body.momentumTime = Math.max(this.body.momentumTime, .6);
  }
  private act(a: MAction): void { this.match.handle(this.id, a); }

  tick(dt: number): void {
    this.time += dt;
    const m = this.match, hb = m.host.body(this.id), p = m.sim.players.get(this.id);
    if (!hb || !p) return;
    if (!m.alive.has(this.id)) { this.wasAlive = false; return; }
    const b = this.body;
    if (!this.wasAlive || Math.hypot(hb.x - b.pos.x, hb.y - b.pos.y, hb.z - b.pos.z) > .8) { b.pos.set(hb.x, hb.y, hb.z); b.vel.set(0, 0, 0); }
    const prof = m.sim.profileOf(p);
    b.vanilla = { gravity: prof.gravity, slowFall: prof.slowFall, levitation: prof.levitation, frozen: prof.frozen, canSprint: prof.canSprint };
    b.speedMult = prof.speed;
    this.input = { ...FROZEN_INPUT };
    const actions: (() => void)[] = [];
    if (m.phase === 'waves' || m.phase === 'finale') { this.adapt(); this.decide(actions); }
    b.update(dt, this.input, { getBlock: (x, y, z) => m.host.getBlock(x, y, z), isLoaded: () => true });
    m.host.drive(this.id, { x: b.pos.x, y: b.pos.y, z: b.pos.z, yaw: b.yaw, pitch: this.pitch, held: p.inv.slots[p.selected]?.id ?? 0, sneaking: b.sneaking });
    for (const a of actions) a();
  }

  private adapt(): void {
    if (this.time < this.adaptAt) return;
    this.adaptAt = this.time + 10;
    const m = this.match;
    const humans = [...m.roster.keys()].filter((id) => !m.host.body(id)?.bot);
    if (!humans.length) return;
    const humanAlive = humans.some((h) => m.alive.has(h));
    // A human out early: ease off. Still alive and doing well: keep up.
    const lead = humanAlive ? 1 : -2;
    this.skill = clamp(this.skill + (lead > 0 ? .02 : -.04), .2, 1.35);
  }

  /** What's running, plus the one everyone's just been warned about. */
  private threats(): DisasterKind[] {
    const m = this.match;
    const out = m.active.filter((d) => !d.stopping).map((d) => d.kind);
    if (m.next && !out.includes(m.next)) out.push(m.next);
    return out;
  }

  /** Is there a roof over this spot right now (meteors drill through)? */
  private coverAt(x: number, y: number, z: number): boolean {
    for (let k = Math.floor(y) + 2; k < CITY.BUILD_MAX_Y; k++) if (isSolid(this.match.host.getBlock(Math.floor(x), k, Math.floor(z)))) return true;
    return false;
  }
  private score(spot: Spot, kinds: DisasterKind[]): number {
    const b = this.body.pos;
    const weather = kinds.some((k) => k === 'meteors' || k === 'lightning' || k === 'acid_rain' || k === 'blizzard');
    const [sx, sy, sz] = this.standAt(spot);
    const s = weather && spot.covered && !this.coverAt(sx, sy, sz) ? { ...spot, covered: false, under: false } : spot;
    let v = 0;
    for (const k of kinds) {
      switch (k) {
        case 'meteors': v += s.under ? 3 : s.covered ? 1.5 : -2; break;
        case 'lightning': v += s.covered ? 2 : s.y > CITY.GROUND + 6 ? -3 : -1; break;
        case 'acid_rain': case 'blizzard': v += s.covered ? 2.5 : -2.5; break;
        case 'tornado': v += s.covered ? 2 : -2; break;
        case 'flood': v += s.y >= CITY.FLOOD_TOP + 1 ? 5 : s.under ? -8 : -3; break;
        case 'tsunami': v += s.y >= CITY.WAVE_TOP + 1 ? 5 : s.inside ? -1 : -3; break;
        case 'earthquake': v += s.tall ? -2.5 : s.inside ? 1.5 : s.under ? 0 : s.ladder ? .5 : -1.5; break;
        case 'sinkholes': v += s.inside ? 2 : s.under ? 1 : s.y > CITY.GROUND + 3 ? 1.5 : -2; break;
        case 'wildfire': v += s.wooden ? -4 : 0; break;
        case 'zombies': v += s.ladder ? 5 : s.y > CITY.GROUND + 8 ? 1 : s.under ? -1 : 0; break;
        case 'gas_leak': v += s.name === 'subway' || s.name === 'subway west' ? 1.5 : s.inside ? -1 : 0; break;
      }
    }
    v -= Math.hypot(s.x - b.x, s.z - b.z) * .06;
    // Weaker bots misjudge shelter (one misjudgement per new threat, not a dice roll every second).
    return v + (this.noise.get(s.name) ?? 0);
  }

  private decide(actions: (() => void)[]): void {
    const m = this.match, b = this.body, p = m.sim.players.get(this.id)!;
    const kinds = this.threats();
    const key = kinds.slice().sort().join(',');
    if (key !== this.seenKinds) {
      this.seenKinds = key;
      this.reactAt = this.time + lerp(3, .4, Math.min(1, this.skill)) * (.7 + this.rng() * .6);
      for (const s of spotList()) this.noise.set(s.name, (this.rng() - .5) * lerp(3.5, .3, Math.min(1, this.skill)));
    }
    if (this.time >= this.reactAt && this.time >= this.thinkAt) {
      this.thinkAt = this.time + lerp(4, 1.5, Math.min(1, this.skill));
      if (!kinds.length && !this.target) { this.target = SPOTS[2]; this.via = this.routeTo(SPOTS[2]); }
      else {
        let best = SPOTS[0], bv = -Infinity;
        for (const s of spotList()) { const v = this.score(s, kinds); if (v > bv) { bv = v; best = s; } }
        // Only move on when the new shelter is clearly better than where we're headed.
        const cur = this.target ? this.score(this.target, kinds) : -Infinity;
        if (best !== this.target && bv > cur + 1.5) { this.target = best; this.path = []; this.via = this.routeTo(best); }
      }
    }
    // Hunger and bandages.
    if (p.hunger.food < 14 && this.time >= this.eatAt) {
      const food = p.inv.slots.findIndex((s, i) => i < 9 && s && VITEM[s.id]?.food);
      if (food >= 0) { this.eatAt = this.time + 2.2; if (p.selected !== food) actions.push(() => this.act({ k: 'select', slot: food })); actions.push(() => this.act({ k: 'use', slot: food, yaw: b.yaw, pitch: 0 })); return; }
    }
    // Zombies: keep heading for shelter and swing at whatever's in the way;
    // stand and fight only once there (or with nowhere to go).
    const zombie = [...m.sim.ents.all.values()].find((e) => KINDS[e.kind].mob && (e.kind === 'zombie' || e.kind === 'husk') && Math.hypot(e.x - b.pos.x, e.z - b.pos.z) < 3.2 && Math.abs(e.y - b.pos.y) < 2);
    if (zombie && this.skill > .3) {
      const weapon = p.inv.slots.findIndex((s, i) => i < 9 && s && (s.tag === 'crowbar' || VITEM[s.id]?.tool?.kind === 'axe'));
      if (weapon >= 0 && p.selected !== weapon) actions.push(() => this.act({ k: 'select', slot: weapon }));
      const dist = Math.hypot(zombie.x - b.pos.x, zombie.z - b.pos.z);
      const settled = !this.target || this.arrived(this.target);
      const ahead = Math.abs(angleTo(b.yaw, Math.atan2(-(zombie.x - b.pos.x), -(zombie.z - b.pos.z)))) < .9;
      if (settled) this.face(zombie.x, zombie.y + 1.2, zombie.z, lerp(4, 12, Math.min(1, this.skill)));
      if ((settled || (ahead && dist < 2.6)) && this.time >= this.clickAt) {
        this.clickAt = this.time + lerp(.9, .55, Math.min(1, this.skill));
        if (this.rng() < lerp(.4, .8, Math.min(1, this.skill))) actions.push(() => this.act({ k: 'attack', ent: zombie.id }));
      }
      if (settled) { if (dist < 1.2) this.input.back = true; return; }
    }
    // Step out of a meteor's ring of flame (reaction gated by skill).
    if (this.skill > .25) for (const e of m.sim.ents.all.values()) {
      if (e.kind !== 'display' || e.data.variant !== 'meteor' || typeof e.data.tx !== 'number') continue;
      const d = Math.hypot((e.data.tx as number) - b.pos.x, (e.data.tz as number) - b.pos.z);
      const eta = (e.y - (e.data.ty as number)) / 1.5;
      if (d < (e.data.r as number) + 2.5 && Math.abs((e.data.ty as number) - b.pos.y) < 8 && eta < lerp(10, 30, Math.min(1, this.skill))) {
        this.flee(e.data.tx as number, e.data.tz as number); return;
      }
    }
    // Run from the tornado and hissing gas regardless of shelter.
    for (const e of m.sim.ents.all.values()) {
      if (e.kind !== 'display' || e.data.variant !== 'tornado') continue;
      const d = Math.hypot(e.x - b.pos.x, e.z - b.pos.z);
      if (d < 12 && !this.covered()) { this.flee(e.x, e.z); return; }
    }
    if (this.target) this.walkTo(this.target);
  }

  private covered(): boolean {
    const b = this.body.pos;
    for (let y = CITY.BUILD_MAX_Y; y > Math.floor(b.y + 1.62); y--) if (isSolid(this.match.host.getBlock(Math.floor(b.x), y, Math.floor(b.z)))) return true;
    return false;
  }
  private flee(x: number, z: number): void {
    const b = this.body;
    const yaw = Math.atan2(-(b.pos.x - x), -(b.pos.z - z));
    this.turn(yaw, 0, lerp(5, 14, Math.min(1, this.skill)));
    this.input.forward = true; this.input.sprintKey = true;
    this.hop();
  }

  /** Where in a spot this bot stands: big open spots get a per-bot offset. */
  private standAt(s: Spot): [number, number, number] {
    if (!s.spread) return [s.x, s.y, s.z];
    const get = (x: number, y: number, z: number) => this.match.host.getBlock(x, y, z);
    const k = this.id * 2654435761 >>> 0;
    const ox = (k % 11) - 5, oz = ((k >>> 8) % 11) - 5;
    const x = Math.floor(s.x) + ox, z = Math.floor(s.z) + oz;
    return canStand(get, x, s.y, z) ? [x + .5, s.y, z + .5] : [s.x, s.y, s.z];
  }
  private arrived(s: Spot): boolean {
    const pos = this.body.pos, [x, y, z] = this.standAt(s);
    return Math.hypot(x - pos.x, z - pos.z) < 1.2 && Math.abs(y - pos.y) < 2;
  }
  /** The stored route to a spot, joined at the waypoint nearest to us. */
  private routeTo(s: Spot): [number, number, number][] {
    const via = spotRoute(s);
    const pos = this.body.pos;
    let best = via.length, bd = Math.hypot(s.x - pos.x, (s.y - pos.y) * 2, s.z - pos.z);
    via.forEach((w, i) => { const d = Math.hypot(w[0] - pos.x, (w[1] - pos.y) * 2, w[2] - pos.z); if (d < bd) { bd = d; best = i; } });
    return via.slice(best);
  }

  private walkTo(s: Spot): void {
    const b = this.body, m = this.match, pos = b.pos;
    if (this.arrived(s)) return;
    // Next waypoint once we're close to this one.
    while (this.via.length && Math.hypot(this.via[0][0] - pos.x, this.via[0][2] - pos.z) < 2 && Math.abs(this.via[0][1] - pos.y) < 2) { this.via.shift(); this.path = []; }
    const goal = this.via[0] ?? this.standAt(s);
    if ((!this.path.length && this.time - this.pathAt > .6) || this.time - this.pathAt > 2.5) {
      this.pathAt = this.time;
      const get = (x: number, y: number, z: number) => m.host.getBlock(x, y, z);
      this.path = findPath(get, Math.floor(pos.x), Math.floor(pos.y + .01), Math.floor(pos.z), Math.floor(goal[0]), Math.floor(goal[1]), Math.floor(goal[2]), 2, 1400, true) ?? [];
    }
    while (this.path.length && Math.hypot(this.path[0][0] - pos.x, this.path[0][2] - pos.z) < .45 && Math.abs(this.path[0][1] - pos.y) < 1.2) this.path.shift();
    const next = this.path[0] ?? goal;
    const flat = Math.hypot(next[0] - pos.x, next[2] - pos.z);
    const yaw = flat > .25 ? Math.atan2(-(next[0] - pos.x), -(next[2] - pos.z)) : b.yaw;
    this.turn(yaw, 0, lerp(6, 18, Math.min(1, this.skill)));
    this.input.forward = flat > .25 && Math.abs(angleTo(b.yaw, yaw)) < .7;
    this.input.sprintKey = this.input.forward && this.path.length > 4 && this.skill > .35;
    if (next[1] > pos.y + .5 && b.onGround) this.input.jump = true;
    // Swimming: hold jump to stay up and to climb out over a ledge.
    if (b.inWater && next[1] >= pos.y - .2) this.input.jump = true;
    if (b.climbing) this.input.jump = true;
    this.hop();
    if (Math.hypot(pos.x - this.stuckPos.x, pos.z - this.stuckPos.z) > .5) { this.stuckAt = this.time; this.stuckPos = { x: pos.x, z: pos.z }; }
    else if (this.time - this.stuckAt > 1.6) { this.input.jump = true; this.path = []; this.stuckAt = this.time; }
  }
  private hop(): void {
    const b = this.body, pos = b.pos;
    const fx = pos.x - Math.sin(b.yaw) * .6, fz = pos.z - Math.cos(b.yaw) * .6;
    const ahead = this.match.host.getBlock(Math.floor(fx), Math.floor(pos.y + .1), Math.floor(fz));
    if (b.onGround && isSolid(ahead) && !isSolid(this.match.host.getBlock(Math.floor(fx), Math.floor(pos.y + 1.1), Math.floor(fz)))) this.input.jump = true;
    // Never walk into an open hole to the void.
    let floor = false;
    for (let y = Math.floor(pos.y) - 1; y >= Math.floor(pos.y) - 6; y--) if (BLOCKS[this.match.host.getBlock(Math.floor(fx), y, Math.floor(fz))]?.solid || BLOCKS[this.match.host.getBlock(Math.floor(fx), y, Math.floor(fz))]?.fluid) { floor = true; break; }
    if (!floor && b.onGround) { this.input.forward = false; this.input.sneak = true; this.path = []; }
  }
  private face(x: number, y: number, z: number, rate: number): void {
    const b = this.body;
    this.turn(Math.atan2(-(x - b.pos.x), -(z - b.pos.z)), Math.atan2(y - (b.pos.y + 1.62), Math.hypot(x - b.pos.x, z - b.pos.z)), rate);
  }
  private turn(yaw: number, pitch: number, rate: number): void {
    const step = rate * .05;
    this.body.yaw += clamp(angleTo(this.body.yaw, yaw), -step, step);
    this.pitch += clamp(pitch - this.pitch, -step, step);
  }
}
