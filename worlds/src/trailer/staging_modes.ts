// Release-stage motion for the vanilla-engine games (Lucky Pillars, Disaster
// City, Party Games), the cape announcement and the RPG teaser. Same contract
// as staging.ts: every frame is a pure function of the shot clock.
import * as THREE from 'three';
import type { WorldGenerator, WorldKind } from '../multiverse';
import { TITLE_SEA } from '../title_terrain';
import { captureGround } from '../media/offline';
import '../disaster_city';
import { Block } from '../blocks';
import { LP, lpSeed } from '../pillars_rules';
import { lpArenaPillars } from '../pillars_geometry';
import { holeX, holeZ } from '../minigames/whack';
import { podiumStep } from '../minigames/podium';
import { BASE_Y } from '../minigames/arena';
import { worldSeed as mgWorldSeed } from '../minigames/arenas';
import { mgIndex, MG_PODIUM_INDEX } from '../minigames_rules';
import { mc } from '../vanilla/mc_materials';
import { VB } from '../vanilla/blocks';
import { VI } from '../vanilla/items';
import type { Shot } from './shots';
import type { CapeTier } from './cape';
import {
  type V3, type TrailerCamera, type StageFrame, type StageEdit, type StageEvent, type ActorPose,
  sm, lerp, mix3, face, vec, clamp01, stridePhase, swingOf, camOf, emptyFrame, gridLine,
} from './stage_types';

// ── worlds ──────────────────────────────────────────────────────────────────
export const LP_SEED = lpSeed('ring', 4, 96, false);
const PILLARS = lpArenaPillars(LP_SEED);
const TOP = LP.TOP_Y, STAND = TOP + 1;
const MG_SEED = { whack: mgWorldSeed(mgIndex('whack')), tnt: mgWorldSeed(mgIndex('tnt_run')), podium: mgWorldSeed(MG_PODIUM_INDEX) } as const;

/** The world kind and seed each new set is built from (shared with the audit). */
export function modeWorld(set: Shot['set']): { kind: WorldKind; seed: number } | null {
  if (set === 'pillars') return { kind: 'pillars', seed: LP_SEED };
  if (set === 'disaster') return { kind: 'disaster', seed: 0 };
  if (set === 'whack' || set === 'tnt' || set === 'podium') return { kind: 'minigames', seed: MG_SEED[set] };
  return null;
}

// ── Lucky Pillars geometry ───────────────────────────────────────────────────
const [PA, PB] = PILLARS;
/** Wool bridges from a pillar to the crown, ending beside the crown column. */
const bridgeA = gridLine(PA.x, PA.z, 0, 0).slice(0, -1);
const bridgeB = gridLine(PB.x, PB.z, 0, 0).slice(0, -1);
const cellPos = (cells: [number, number][], i: number, y = STAND): V3 => {
  const c = Math.max(0, Math.min(cells.length - 1, i));
  const a = cells[Math.floor(c)], b = cells[Math.min(cells.length - 1, Math.floor(c) + 1)], f = c - Math.floor(c);
  return [lerp(a[0], b[0], f) + .5, y, lerp(a[1], b[1], f) + .5];
};
/** Fractional index along `cells`, where -1 is the pillar top it starts from. */
const alongBridge = (from: { x: number; z: number }, cells: [number, number][], i: number): V3 =>
  i >= 0 ? cellPos(cells, i) : mix3([from.x + .5, STAND, from.z + .5], cellPos(cells, 0), 1 + i);
const LP_DIR = new THREE.Vector3(-PA.x, 0, -PA.z).normalize();
const LP_SIDE = new THREE.Vector3(-LP_DIR.z, 0, LP_DIR.x);
const BRIDGE_TIMES = [.4, .9, 1.4, 1.9, 2.4, 2.9, 3.4];
const LP_LOOT = [VI.diamond_sword, VI.bow, VB.tnt, VI.golden_apple];

// ── Disaster City geometry ───────────────────────────────────────────────────
const CITY_Y = 65;
const CRATER = { x: -16, z: -13 };
const IMPACT = 2.2;

// ── Party Games: Whack-a-Mole schedule ───────────────────────────────────────
type MoleKind = 'gold' | 'bomb' | 'brown';
/** [hole, kind, up, down]; punched moles go down at their punch time. */
const MOLES: [number, MoleKind, number, number][] = [
  [24, 'gold', .1, .85], [17, 'brown', 1.1, 2.25], [30, 'brown', .4, 1.55], [23, 'gold', 2.0, 2.95],
  [9, 'bomb', .3, 2.6], [38, 'brown', .6, 1.9], [12, 'brown', 1.0, 3.2], [33, 'gold', 1.7, 9], [5, 'brown', 2.3, 9],
  [40, 'brown', 0, 1.3], [15, 'bomb', 2.6, 9], [26, 'brown', 1.6, 3.6], [44, 'brown', .2, 2.0], [2, 'gold', 2.9, 9],
];
const WY = BASE_Y;
const moleCenter = (hole: number): V3 => [holeX(hole) + .5, WY + 1, holeZ(hole) + .5];
/** Where a puncher stands to hit the mole in `hole` (one block south-east of it). */
const punchSpot = (hole: number, side = 1): V3 => [holeX(hole) + .5 + 1.15 * side, WY + 1, holeZ(hole) + .5 + .75];

// ── Party Games: TNT Run runners ─────────────────────────────────────────────
interface Runner { r: number; w: number; a0: number; past: number }
const TNT_RUNNERS: Runner[] = [
  { r: 10, w: .54, a0: 0, past: 2.5 }, { r: 7, w: -.74, a0: 2.2, past: 2 }, { r: 4, w: 1.2, a0: 4.0, past: .8 },
];
const tntPos = (runner: Runner, t: number): V3 => {
  const a = runner.a0 + runner.w * t;
  return [Math.cos(a) * runner.r, WY + 1, Math.sin(a) * runner.r];
};

// ── Lake: capes and the RPG ──────────────────────────────────────────────────
const HERO_XZ: [number, number] = [18.2, 25.3];
const LAKE_VIEW: V3 = [-30, TITLE_SEA + 8, -20];

// ── edits ────────────────────────────────────────────────────────────────────
export function modeEdits(s: Shot): StageEdit[] {
  const e: StageEdit[] = [];
  if (s.action === 'lp-bridge') {
    bridgeA.slice(0, 2).forEach(([x, z]) => e.push([x, TOP, z, VB.yellow_wool, 0]));
    BRIDGE_TIMES.forEach((at, i) => { const c = bridgeA[2 + i]; if (c) e.push([c[0], TOP, c[1], VB.yellow_wool, at]); });
    // The rival on pillar B is bridging too, a few blocks out already.
    bridgeB.slice(0, 3).forEach(([x, z]) => e.push([x, TOP, z, VB.light_blue_wool, 0]));
    [.7, 1.3, 1.9, 2.5, 3.1].forEach((at, i) => { const c = bridgeB[3 + i]; if (c) e.push([c[0], TOP, c[1], VB.light_blue_wool, at]); });
  }
  if (s.action === 'lp-fight') {
    bridgeA.forEach(([x, z]) => e.push([x, TOP, z, VB.yellow_wool, 0]));
    bridgeB.forEach(([x, z]) => e.push([x, TOP, z, VB.light_blue_wool, 0]));
  }
  if (s.action === 'dc-meteor') {
    const { x: cx, z: cz } = CRATER, gy = CITY_Y;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const d = Math.hypot(dx, dz);
      if (d > 3.2) continue;
      const depth = d < 1.5 ? 3 : d < 2.5 ? 2 : 1;
      for (let k = 0; k < depth; k++) e.push([cx + dx, gy - 1 - k, cz + dz, Block.Air, IMPACT]);
      e.push([cx + dx, gy - 1 - depth, cz + dz, d < 1.2 ? VB.magma_block : (dx * 7 + dz * 3) % 3 === 0 ? VB.netherrack : VB.blackstone, IMPACT]);
    }
    for (const [dx, dz, at] of [[-3, 1, IMPACT + .05], [2, -3, IMPACT + .15], [3, 2, IMPACT + .3], [-1, 3, IMPACT + .45], [4, -1, IMPACT + .6]]) e.push([cx + dx, gy, cz + dz, VB.fire, at]);
  }
  if (s.action === 'pg-whack') {
    for (const [hole, kind, up, down] of MOLES) {
      const x = holeX(hole), z = holeZ(hole);
      const body = mc(kind === 'gold' ? 'gold_block' : kind === 'bomb' ? 'black_concrete' : 'brown_terracotta');
      const head = mc(kind === 'gold' ? 'raw_gold_block' : kind === 'bomb' ? 'tnt' : 'brown_mushroom_block');
      e.push([x, WY + 1, z, body, up], [x, WY + 2, z, head, up + .06]);
      if (down < s.duration) e.push([x, WY + 2, z, Block.Air, down], [x, WY + 1, z, Block.Air, down + .06]);
    }
  }
  if (s.action === 'pg-tnt') {
    // Every step a runner takes crumbles the sand and the TNT under it shortly after.
    const doomed = new Map<string, StageEdit>();
    for (const runner of TNT_RUNNERS) {
      for (let t = -runner.past; t <= s.duration; t += 1 / 30) {
        const p = tntPos(runner, t);
        if (TNT_RUNNERS.indexOf(runner) === 0 && t > 3.1 && t < 3.75) continue; // the double jump
        for (const ox of [-.3, .3]) for (const oz of [-.3, .3]) {
          const x = Math.floor(p[0] + ox), z = Math.floor(p[2] + oz), key = `${x},${z}`;
          if (!doomed.has(key)) doomed.set(key, [x, WY, z, Block.Air, Math.max(0, t + .45)]);
        }
      }
    }
    for (const [x, , z, , at] of doomed.values()) if (at + .05 <= s.duration) e.push([x, WY, z, Block.Air, at], [x, WY - 1, z, Block.Air, at + .05]);
  }
  return e.sort((a, b) => a[4] - b[4]);
}

// ── particle events ──────────────────────────────────────────────────────────
export function modeEvents(s: Shot): StageEvent[] {
  const ev: StageEvent[] = [];
  if (s.action === 'lp-arena') {
    PILLARS.forEach((p, i) => ev.push({ at: 1.5 + i * .12, kind: 'sparkle', pos: [p.x + .5, STAND + 2.3, p.z + .5], color: 0xfff1a8 }));
  }
  if (s.action === 'lp-fight') {
    const hits = [.7, 1.5, 2.3];
    hits.forEach((at, i) => { const p = lpFightBlue(at); ev.push({ at, kind: 'burst', pos: [p[0], p[1] + 1.3, p[2]], color: i === 2 ? 0xffffff : 0xffd0d0 }); });
  }
  if (s.action === 'dc-city') {
    ev.push({ at: 2.0, kind: 'blast', pos: [-1, 93, -33], color: 0xff9030 }, { at: 2.05, kind: 'smoke', pos: [-1, 94, -33], color: 0x4a4a4a });
  }
  if (s.action === 'dc-meteor') {
    const p: V3 = [CRATER.x + .5, CITY_Y + .3, CRATER.z + .5];
    ev.push({ at: IMPACT, kind: 'blast', pos: p, color: 0xff8a2a }, { at: IMPACT, kind: 'debris', pos: p, color: 0x2b2b2e },
      { at: IMPACT + .02, kind: 'ring', pos: p, color: 0xffb060 }, { at: IMPACT + .08, kind: 'smoke', pos: p, color: 0x55524f },
      { at: IMPACT + .6, kind: 'smoke', pos: [p[0], p[1] + 1.5, p[2]], color: 0x3e3c3a });
  }
  if (s.action === 'dc-zombies') {
    ev.push({ at: 1.35, kind: 'burst', pos: [-.6, CITY_Y + 1.3, -15.4], color: 0xa83232 }, { at: 2.55, kind: 'burst', pos: [.1, CITY_Y + 1.3, -16.8], color: 0xa83232 });
  }
  if (s.action === 'pg-whack') {
    const punch = (at: number, hole: number, gold: boolean) => {
      const [x, y, z] = moleCenter(hole);
      ev.push({ at, kind: 'burst', pos: [x, y + 1.3, z], color: gold ? 0xffd34d : 0x9a6a3a }, { at, kind: 'sparkle', pos: [x, y + 1.6, z], color: gold ? 0xfff1a8 : 0xffffff });
    };
    punch(.8, 24, true); punch(1.5, 30, false); punch(2.2, 17, false); punch(2.9, 23, true);
  }
  if (s.action === 'pg-podium') {
    const shells: [number, number, number, number][] = [[.6, -6, 116, 0xff5577], [1.0, 7, 117, 0x55d6ff], [1.5, 0, 119, 0xffd34d], [1.9, -9, 115, 0x9dff7a], [2.4, 4, 118, 0xc58cff], [2.9, -3, 117, 0xff9d3d], [3.3, 9, 116, 0xffffff]];
    for (const [at, x, y, color] of shells) ev.push({ at, kind: 'firework', pos: [x + .5, y, -9.5], color });
  }
  if (s.action === 'cape-tiers') {
    capeLine().forEach((p, i) => ev.push({ at: .5 + i * .6, kind: 'sparkle', pos: [p[0], p[1] + 2.4, p[2]], color: [0xdfe6ee, 0x7fb6ff, 0xc59bff, 0xffd86b][i] }));
  }
  if (s.action === 'rpg-rise') {
    const { p, fwd, right } = rpgRig();
    const blade: V3 = [p[0] + fwd.x * .3 + right.x * .45, p[1] + 1.0, p[2] + fwd.z * .3 + right.z * .45];
    ev.push({ at: 1.05, kind: 'sparkle', pos: blade, color: 0x9fd8ff });
    ev.push({ at: 3.62, kind: 'sparkle', pos: [p[0], p[1] + 2.9, p[2]], color: 0xfff1c0 }, { at: 3.66, kind: 'burst', pos: [p[0], p[1] + 2.9, p[2]], color: 0xbfe6ff });
  }
  if (s.action === 'cape-reveal') {
    const p = heroPos();
    ev.push({ at: 2.0, kind: 'sparkle', pos: [p[0], p[1] + 1.4, p[2]], color: 0xffd86b });
  }
  return ev;
}

interface ModeEnv { generator: WorldGenerator }

function heroPos(): V3 {
  return [HERO_XZ[0], 0, HERO_XZ[1]];
}
let lakeGen: WorldGenerator | null = null;
/** The title valley the cape and RPG shots stand in (set once by the stage and the audit). */
export function useTrailerLake(g: WorldGenerator): void { lakeGen = g; }
const lakeGround = (x: number, z: number): number => lakeGen ? captureGround(lakeGen, x, z, 140, 40) : TITLE_SEA + 7;
const heroFacing = (): number => face(heroPos(), LAKE_VIEW);
/** Four capes in a row along the shore, facing the lake (common → legendary). */
function capeLine(): V3[] {
  const yaw = heroFacing(), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  return [-2.4, -.8, .8, 2.4].map(o => {
    const x = HERO_XZ[0] + right.x * o, z = HERO_XZ[1] + right.z * o;
    return [x, lakeGround(x, z), z];
  });
}

const UP = new THREE.Vector3(0, 1, 0);
/** The RPG hero's mark on the shore, facing the last of the sunset (west). */
function rpgRig(): { p: V3; yaw: number; fwd: THREE.Vector3; right: THREE.Vector3 } {
  const p = heroPos(); p[1] = lakeGround(p[0], p[2]);
  const yaw = face(p, [-60, p[1], p[2] - 6]);
  return { p, yaw, fwd: new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)) };
}
const rpgHero = (p: V3, yaw: number, t: number): ActorPose =>
  ({ slot: 7, pos: p, yaw: yaw + Math.sin(t * .5) * .04, item: VI.diamond_sword, walk: 0, speed: 0, cape: 'epic', wind: .9, pitch: .1 });
const DUSK_FROM: V3 = [16, TITLE_SEA + 15, 29];
const DUSK_TO: V3 = [2, TITLE_SEA + 21, 27];
const DUSK_LOOK: V3 = [-70, TITLE_SEA + 27, 34];
/** Cut points of the rising montage (seconds into the shot). */
const RISE_CUTS = [0, 1, 2, 2.5, 3, 3.25, 3.5];

/** Blue's position through the Lucky Pillars fight (shared with the events). */
function lpFightBlue(t: number): V3 {
  const knock = (c: number) => t >= c ? 1 - Math.exp(-(t - c) * 7) : 0;
  const i = lerp(13.2, 11.6, sm(t / .55)) + knock(.7) * .35 + knock(1.5) * .45;
  const base = cellPos(bridgeA, i);
  if (t < 2.3) return base;
  const u = t - 2.3;
  return [base[0] + LP_SIDE.x * 3.1 * u + LP_DIR.x * .8 * u, base[1] + 4.2 * u - 13 * u * u, base[2] + LP_SIDE.z * 3.1 * u + LP_DIR.z * .8 * u];
}

/** Chunk-loading centre and radius for a new shot. */
export function modeFocus(s: Shot): { center: THREE.Vector3; radius: number } | null {
  switch (s.set) {
    case 'pillars': return { center: new THREE.Vector3(0, 0, 0), radius: 3 };
    case 'disaster': return { center: new THREE.Vector3(-8, 0, -14), radius: s.action === 'dc-city' ? 6 : 4 };
    case 'whack': case 'tnt': case 'podium': return { center: new THREE.Vector3(0, 0, 0), radius: 3 };
    case 'rpg': return { center: new THREE.Vector3(HERO_XZ[0], 0, HERO_XZ[1]), radius: 8 };
  }
  if (s.action === 'cape-reveal' || s.action === 'cape-tiers') return { center: new THREE.Vector3(HERO_XZ[0] - 20, 0, HERO_XZ[1] - 20), radius: 8 };
  return null;
}

export function modeFrame(s: Shot, t: number, env: ModeEnv): StageFrame | null {
  const k = t / s.duration;
  void env;
  switch (s.action) {
    // ── Lucky Pillars ────────────────────────────────────────────────────
    case 'lp-arena': {
      // Crane reveal: tight on the player atop pillar A, rising and pulling back
      // until all four pillars stand over the void around the golden crown.
      const out = new THREE.Vector3(PA.x, 0, PA.z).normalize(), side = new THREE.Vector3(-out.z, 0, out.x);
      const top = new THREE.Vector3(PA.x + .5, STAND, PA.z + .5);
      const c = sm(clamp01((t - .2) / 3.6));
      const near = top.clone().addScaledVector(out, 2.6).addScaledVector(side, 1.3).add(new THREE.Vector3(0, .9, 0));
      const far = new THREE.Vector3(.5, 0, .5).addScaledVector(out, 31).addScaledVector(side, 6).add(new THREE.Vector3(0, 115, 0));
      const position = near.clone().lerp(far, c);
      const target = top.clone().add(new THREE.Vector3(0, 1.5, 0)).lerp(new THREE.Vector3(.5, 99.5, .5), sm(clamp01((t - .2) / 3.0)));
      const f = emptyFrame({ position, target, fov: lerp(50, 60, c) });
      PILLARS.forEach((p, i) => {
        const pos: V3 = [p.x + .5, p.topY + 1, p.z + .5];
        const grab = 1.5 + i * .12 + .95;
        const item = t >= grab ? LP_LOOT[i] : i === 0 ? VB.yellow_wool : 0;
        f.actors.push({ slot: [2, 1, 6, 0][i], pos, yaw: face(pos, [.5, STAND, .5]) + Math.sin(t * .8 + i) * .2, item, walk: 0, speed: 0,
          attack: t >= grab ? swingOf(t, [grab + .05], .35) * .5 : 0 });
        const pop = t - (1.5 + i * .12);
        if (pop >= 0 && t < grab) {
          const rise = sm(pop / .3), shrink = 1 - sm((pop - .75) / .2);
          f.drops.push({ item: LP_LOOT[i], pos: [pos[0], pos[1] + 2.1 + Math.sin(pop * 6) * .06 - (1 - rise) * .6, pos[2]], scale: rise * shrink });
        }
      });
      return f;
    }
    case 'lp-bridge': {
      const along = -1 + clamp01((t - .15) / 3.5) * 7.6;
      const pos = alongBridge(PA, bridgeA, along);
      const f = emptyFrame({
        position: vec(pos).addScaledVector(LP_SIDE, 5.4).addScaledVector(LP_DIR, -2.2).add(new THREE.Vector3(0, 2.1, 0)),
        target: vec(pos).addScaledVector(LP_DIR, 1.6).add(new THREE.Vector3(0, .6, 0)), fov: 54,
      });
      f.actors.push({ slot: 2, pos, yaw: face(pos, [.5, STAND, .5]), item: VB.yellow_wool, walk: stridePhase(t, 2), speed: 2, pitch: -.55, attack: swingOf(t, BRIDGE_TIMES.map(c => c - .08), .25) * .8 });
      const rivalAlong = 1.4 + clamp01((t - .45) / 3) * 5;
      const rp = alongBridge(PB, bridgeB, rivalAlong);
      f.actors.push({ slot: 1, pos: rp, yaw: face(rp, [.5, STAND, .5]), item: VB.light_blue_wool, walk: stridePhase(t + 1, 1.7), speed: 1.7, pitch: -.5, attack: swingOf(t, [.62, 1.22, 1.82, 2.42, 3.02], .25) * .8 });
      return f;
    }
    case 'lp-fight': {
      const red = cellPos(bridgeA, 10.2 - (t >= 1.5 && t < 2 ? .2 : 0));
      const blue = lpFightBlue(t);
      const behind = vec(red).addScaledVector(LP_DIR, -3.8).addScaledVector(LP_SIDE, -2.6).add(new THREE.Vector3(0, 2.0, 0));
      const look = vec(mix3(red, blue, .6)).add(new THREE.Vector3(0, 1.2, 0));
      const fallTarget = vec(blue).add(new THREE.Vector3(0, .6, 0));
      const f = emptyFrame({ position: behind.add(new THREE.Vector3(0, sm((t - 2.4) / 1.2) * .6, 0)), target: look.lerp(fallTarget, sm((t - 2.4) / 1.0) * .55), fov: 58 });
      f.actors.push({ slot: 2, pos: red, yaw: face(red, blue[1] > STAND - 3 ? blue : cellPos(bridgeA, 12)), item: VI.diamond_sword, walk: stridePhase(t, 1.5), speed: t < .5 ? 1.5 : .6, attack: swingOf(t, [.5, 1.3, 2.1], .32) });
      const falling = t >= 2.3;
      const u = t - 2.3;
      f.actors.push({ slot: 1, pos: blue, yaw: face(blue, red), item: VI.iron_sword, walk: stridePhase(t, 2), speed: falling ? 0 : t < .55 ? 3 : .8,
        attack: swingOf(t, [1.0], .3), tilt: falling ? [-u * 2.6, 0, u * 1.9] : undefined });
      if (t >= 2.3 && t < 2.45) f.shake = .05;
      return f;
    }

    // ── Disaster City ────────────────────────────────────────────────────
    case 'dc-city': {
      const f = emptyFrame(camOf([38, 101, 37], [27, 93, 28], [-20, 84, -24], 62, k));
      const m1 = clamp01(t / 2.0);
      if (t < 2.0) f.meteors.push({ pos: mix3([72, 178, -66], [-1, 93, -33], m1 * m1), dir: [-73, -85, 33], size: 1.6 });
      if (t > 1.7) { const m2 = (t - 1.7) / 2.8; f.meteors.push({ pos: mix3([92, 196, -6], [-30, 109, -31], m2 * m2), dir: [-122, -87, -25], size: 1.9 }); }
      if (t > 3.1) { const m3 = (t - 3.1) / 2.2; f.meteors.push({ pos: mix3([40, 200, 60], [-40, 100, -10], m3), dir: [-80, -100, -70], size: 1.2 }); }
      f.flash = t >= .6 ? Math.exp(-(t - .6) * 9) * (t < .66 || t > .78 ? 1 : .35) : 0;
      if (t >= 2.0) f.shake = .05 * Math.exp(-(t - 2.0) * 3);
      return f;
    }
    case 'dc-meteor': {
      const camK = sm(k);
      const f = emptyFrame({ position: vec([lerp(-13.0, -13.5, camK), lerp(66.1, 66.7, camK), lerp(5.5, 12.5, camK)]), target: vec([-15.8, lerp(67.6, 66.9, camK), -8]), fov: 60 });
      const runA: V3 = [-15.2, CITY_Y, -16 + 5.2 * t], runB: V3 = [-16.9, CITY_Y, -18.5 + 5.4 * t];
      const stumble = t >= IMPACT ? Math.exp(-(t - IMPACT) * 5) * .22 : 0;
      f.actors.push({ slot: 3, pos: runA, yaw: Math.PI, item: 0, walk: stridePhase(t, 5.6) * 1.15, speed: 5.6, tilt: [-stumble, 0, 0] });
      f.actors.push({ slot: 4, pos: runB, yaw: Math.PI + .08, item: VI.iron_pickaxe, walk: stridePhase(t, 5.6) * 1.15 + 2, speed: 5.6, tilt: [-stumble * .8, 0, 0] });
      if (t >= .4 && t < IMPACT) {
        const m = (t - .4) / (IMPACT - .4);
        f.meteors.push({ pos: mix3([-2, 112, -48], [CRATER.x + .5, CITY_Y + .6, CRATER.z + .5], m * m), dir: [-13.5, -47, 35], size: 2.0 });
      }
      if (t >= IMPACT) f.shake = .32 * Math.exp(-(t - IMPACT) * 3.2);
      return f;
    }
    case 'dc-zombies': {
      const f = emptyFrame(camOf([5.6, 66.75, -11.1], [4.5, 66.35, -12.1], [-2.6, 65.8, -16.2], 58, k));
      const p3: V3 = [1.5 - .35 * t, CITY_Y, -15.5], p4: V3 = [2.6 - .4 * t, CITY_Y, -16.9];
      f.actors.push({ slot: 3, pos: p3, yaw: face(p3, [-3, CITY_Y, -15.5]), item: VI.iron_sword, walk: stridePhase(t, .8), speed: .8, attack: swingOf(t, [1.2], .3) });
      f.actors.push({ slot: 4, pos: p4, yaw: face(p4, [-3, CITY_Y, -17]), item: VI.diamond_sword, walk: stridePhase(t + 1, .8), speed: .8, attack: swingOf(t, [2.4], .3) });
      const horde: [number, number, number, number?][] = [
        [-2.0, -15.4, 1.0, 1.35], [-3.2, -16.8, 1.3, 2.55], [-6.4, -14.6, 1.0], [-7.6, -17.3, .9], [-9.0, -15.6, 1.1], [-10.6, -16.9, .95], [-11.8, -14.9, 1.05], [-13.4, -16.1, 1.0],
      ];
      horde.forEach(([x0, z, v, dies], i) => {
        const dead = dies !== undefined && t >= dies;
        const tt = dead ? dies! : t;
        const knock = dead ? (1 - Math.exp(-(t - dies!) * 6)) * .7 : 0;
        const pos: V3 = [x0 + v * tt - knock, CITY_Y, z + Math.sin(tt * 1.3 + i) * .15];
        if (dead && t - dies! > 1.6) return;
        f.zombies.push({ pos, yaw: face(pos, [6, CITY_Y, z]), speed: dead ? 0 : v, phase: tt * v * 2.6 + i, dying: dead ? t - dies! : undefined, swingAgo: i < 2 && !dead && t > .9 ? (t - .9) % 1.1 : undefined });
      });
      return f;
    }

    // ── Party Games ──────────────────────────────────────────────────────
    case 'pg-whack': {
      const f = emptyFrame(camOf([5.9, WY + 3.3, 6.6], [4.4, WY + 2.7, 4.6], [-.8, WY + 1.4, -.6], 56, k));
      // Yellow: punch the gold mole in the middle, then dash to the next.
      const ya = t < 1.0 ? punchSpot(24) : t < 1.9 ? mix3(punchSpot(24), punchSpot(17), sm((t - 1.0) / .9)) : punchSpot(17);
      const yTarget = t < 1.45 ? moleCenter(24) : moleCenter(17);
      f.actors.push({ slot: 2, pos: ya, yaw: face(ya, yTarget), item: 0, walk: stridePhase(t, 4), speed: t > 1.0 && t < 1.9 ? 4 : 0, attack: swingOf(t, [.7, 2.1], .25), pitch: -.35 });
      // Blue works the left side.
      const ba = t < 1.9 ? punchSpot(30, -1) : t < 2.6 ? mix3(punchSpot(30, -1), punchSpot(23, -1), sm((t - 1.9) / .7)) : punchSpot(23, -1);
      const bTarget = t < 2.25 ? moleCenter(30) : moleCenter(23);
      f.actors.push({ slot: 1, pos: ba, yaw: face(ba, bTarget), item: 0, walk: stridePhase(t + 2, 4), speed: t > 1.9 && t < 2.6 ? 4 : 0, attack: swingOf(t, [1.4, 2.8], .25), pitch: -.35 });
      const pop = (at: number, hole: number, text: string, color: string) => {
        if (t >= at && t < at + 1.1) { const c = moleCenter(hole); f.popups.push({ pos: [c[0], c[1] + 2.0 + (t - at) * .9, c[2]], text, color, k: (t - at) / 1.1 }); }
      };
      pop(.8, 24, '+3', '#ffd34d'); pop(1.5, 30, '+1', '#ffffff'); pop(2.2, 17, '+1', '#ffffff'); pop(2.9, 23, '+3', '#ffd34d');
      return f;
    }
    case 'pg-tnt': {
      const a = lerp(.15, .62, sm(k));
      const f = emptyFrame({ position: new THREE.Vector3(Math.sin(a) * 14.6, lerp(110, 108.6, sm(k)), Math.cos(a) * 14.6), target: vec([0, WY - .5, 0]), fov: 60 });
      TNT_RUNNERS.forEach((runner, i) => {
        const p = tntPos(runner, t), ahead = tntPos(runner, t + .1);
        if (i === 0 && t > 3.1 && t < 3.75) p[1] += Math.sin((t - 3.1) / .65 * Math.PI) * 1.6;
        f.actors.push({ slot: [0, 1, 6][i], pos: p, yaw: face(p, ahead), item: 0, walk: stridePhase(t + i, 5.4) * 1.1, speed: 5.4 });
      });
      return f;
    }
    case 'pg-podium': {
      const f = emptyFrame(camOf([.5, 104.3, 10.5], [.5, 104.9, 6.2], [.5, 105.2, -5.5], 56, k));
      [0, 1, 2].forEach(place => {
        const s0 = podiumStep(place);
        const cheer = sm((t - .3 - place * .2) / .5);
        const bounce = Math.abs(Math.sin((t - place * .3) * 6)) * .16 * cheer * (place === 0 ? 1.4 : 1);
        f.actors.push({ slot: [2, 1, 6][place], pos: [s0.x, s0.y + bounce, s0.z], yaw: 0, item: 0, walk: 0, speed: 0, cheer: place === 0 ? cheer : cheer * .8 });
      });
      // The rest of the lobby, applauding from the carpet.
      [[-2.4, 2.2], [2.9, 2.6], [-4.6, 3.4]].forEach(([x, z], i) => {
        const pos: V3 = [x + .5, WY + 1, z + .5];
        f.actors.push({ slot: [3, 4, 5][i], pos, yaw: face(pos, [.5, WY + 4, -5.5]), item: 0, walk: 0, speed: 0, cheer: .45 + Math.abs(Math.sin(t * 7 + i)) * .3 });
      });
      return f;
    }

    // ── Capes ────────────────────────────────────────────────────────────
    case 'cape-reveal': {
      const p = heroPos(); p[1] = lakeGround(p[0], p[2]);
      const yaw = heroFacing();
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      // From tight on the cape behind the hero, swing round to a profile with the lake beyond.
      const orbit = lerp(-.25, .7, sm(k)), dist = lerp(1.9, 4.4, sm(k)), h = lerp(1.35, 1.8, sm(k));
      const dir = fwd.clone().negate().applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit);
      const pos = vec(p).addScaledVector(dir, dist).add(new THREE.Vector3(0, h, 0));
      const target = vec(p).add(new THREE.Vector3(0, lerp(1.25, 1.15, k), 0)).addScaledVector(fwd, lerp(1.2, .2, sm(k)));
      const f = emptyFrame({ position: pos, target, fov: lerp(48, 52, k) });
      f.actors.push({ slot: 7, pos: p, yaw: yaw + Math.sin(t * .6) * .05, item: 0, walk: 0, speed: 0, cape: 'legendary', wind: .85 });
      return f;
    }
    case 'cape-tiers': {
      const line = capeLine();
      const yaw = heroFacing();
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const mid = vec(line[1]).lerp(vec(line[2]), .5);
      const slide = lerp(-1.3, 1.3, sm(k));
      const pos = mid.clone().addScaledVector(fwd, -7.2).addScaledVector(right, slide).add(new THREE.Vector3(0, 1.6, 0));
      const target = mid.clone().addScaledVector(right, slide * .45).add(new THREE.Vector3(0, 1.15, 0));
      const f = emptyFrame({ position: pos, target, fov: 46 });
      const tiers: CapeTier[] = ['common', 'rare', 'epic', 'legendary'];
      line.forEach((p, i) => f.actors.push({ slot: 8 + i, pos: p, yaw: yaw + Math.sin(t * .7 + i) * .06, item: 0, walk: 0, speed: 0, cape: tiers[i], wind: .55 + i * .12 }));
      return f;
    }

    // ── RPG teaser: its own act, after the Worlds release card ─────────────
    case 'rpg-dark':
      // Black: the frame is painted over. A valid camera keeps the audit honest.
      return emptyFrame(camOf(DUSK_FROM, DUSK_FROM, DUSK_LOOK, 50, 0));
    case 'rpg-dusk': {
      // The sun goes down behind the far mountains as we rise out over the valley.
      return emptyFrame(camOf(DUSK_FROM, DUSK_TO, DUSK_LOOK, lerp(56, 50, k), k));
    }
    case 'rpg-hero': {
      // He walks out towards the last light; the camera starts behind him with the
      // afterglow ahead and swings round to a low front three-quarter.
      const r = rpgRig();
      const walk = sm(clamp01(t / 3.6));
      const from = vec(r.p).addScaledVector(r.fwd, -3.4);
      const at = from.clone().lerp(vec(r.p), walk);
      const p: V3 = [at.x, lakeGround(at.x, at.z), at.z];
      const moving = t < 3.6 ? Math.sin(Math.PI * clamp01(t / 3.6)) : 0;
      const c = sm(k);
      const orbit = lerp(-.3, 2.35, c), dist = lerp(4.6, 3.0, c), h = lerp(1.7, .55, c);
      const dir = r.fwd.clone().negate().applyAxisAngle(UP, orbit);
      const pos = vec(p).addScaledVector(dir, dist).add(new THREE.Vector3(0, h, 0));
      const ahead = lerp(6, 0, sm(clamp01(k * 1.6)));
      const target = vec(p).addScaledVector(r.fwd, ahead).add(new THREE.Vector3(0, lerp(2.2, 1.5, c), 0));
      const f = emptyFrame({ position: pos, target, fov: lerp(50, 40, c) });
      const hero = rpgHero(p, r.yaw, t);
      hero.walk = stridePhase(t, 1.1); hero.speed = 1.1 * moving;
      f.actors.push(hero);
      return f;
    }
    case 'rpg-rise': {
      // The rising cut: shorter and shorter shots, each on a lightning strike,
      // until he lifts the blade to the sky.
      const r = rpgRig(), p = r.p, P = vec(p), fwd = r.fwd, right = r.right;
      const cut = RISE_CUTS.reduce((last, c, i) => t >= c ? i : last, 0);
      const lt = t - RISE_CUTS[cut], len = (RISE_CUTS[cut + 1] ?? s.duration) - RISE_CUTS[cut], lk = lt / len;
      const at = (f: number, rgt: number, up: number) => P.clone().addScaledVector(fwd, f).addScaledVector(right, rgt).add(new THREE.Vector3(0, up, 0));
      let cam: TrailerCamera;
      switch (cut) {
        case 0: cam = { position: at(1.7, .9, lerp(.25, .2, lk)), target: at(0, 0, 2.5), fov: lerp(62, 56, lk) }; break;
        case 1: cam = { position: at(lerp(1.9, 1.6, lk), -.9, 1.35), target: at(.2, .4, 1.0), fov: 40 }; break;
        case 2: cam = { position: at(15, -5, lerp(3.4, 3.0, lk)), target: at(0, 0, 1.4), fov: 38 }; break;
        case 3: cam = { position: at(.35, lerp(1.35, 1.2, lk), 1.62), target: at(.35, 0, 1.55), fov: 42 }; break;
        case 4: cam = { position: at(-1.7, .35, 1.45), target: at(4, -.4, 1.5), fov: 50, roll: -.08 }; break;
        case 5: cam = { position: at(2.2, -.4, .35), target: at(0, 0, 1.7), fov: 56, roll: .06 }; break;
        default: cam = { position: at(lerp(2.2, 5.5, sm(lk)), lerp(.4, 1.2, sm(lk)), lerp(.45, 3.2, sm(lk))), target: at(0, 0, lerp(1.9, 2.4, lk)), fov: lerp(54, 60, lk) };
      }
      cam.cut = cut > 0 && lt < 1 / 120;
      const f = emptyFrame(cam);
      const hero = rpgHero(p, r.yaw, t);
      hero.wind = 1;
      if (cut >= 6) { hero.cheer = sm(lt / .22); hero.pitch = -.35 * sm(lt / .3); }
      else if (cut === 1) hero.attack = 0;
      f.actors.push(hero);
      // Lightning on every cut, and the screen burns white into the title.
      f.flash = Math.max(...RISE_CUTS.slice(0, 5).map(c => t >= c ? Math.exp(-(t - c) * 9) : 0), sm((t - 3.82) / .18) * 1.25);
      f.shake = cut >= 6 ? .02 : lt < .12 ? .05 : 0;
      return f;
    }
    case 'rpg': {
      // The title stands over the hero's silhouette: low behind his shoulder,
      // looking out across the night lake under the aurora.
      const r = rpgRig(), P = vec(r.p);
      const pos = P.clone().addScaledVector(r.fwd, lerp(-4.4, -4.0, k)).addScaledVector(r.right, -1.2).add(new THREE.Vector3(0, lerp(.8, .9, k), 0));
      const target = P.clone().addScaledVector(r.fwd, 12).addScaledVector(r.right, -5.2).add(new THREE.Vector3(0, lerp(4.4, 4.0, k), 0));
      const f = emptyFrame({ position: pos, target, fov: lerp(46, 42, k) });
      f.actors.push(rpgHero(r.p, r.yaw, t));
      return f;
    }
  }
  return null;
}
