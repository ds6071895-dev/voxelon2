// Every Party Games arena and game class, and the `minigames` world kind.
// A world seed packs (course << 5 | catalog index); the podium is index
// MG_PODIUM_INDEX. Imported by the client (geometry) and the server (games).

import { VenueGenerator, registerWorldKind } from '../multiverse';
import { Canvas, type VenueStamp } from '../vanilla/stamp';
import { Deco, finishShapes } from '../vanilla/deco';
import { JavaRandom } from '../vanilla/java_random';
import { MG_GAMES, MG_PODIUM_INDEX, mgIndex } from '../minigames_rules';
import { ARENA_BOX, BASE_Y, arenaSeed, type ArenaDef } from './arena';
import { PODIUM } from './podium';
import type { Minigame } from './game';
import { WhackAMole, WHACK_ARENA } from './whack';
import { MemoryMosaic, MEMORY_ARENA } from './memory';
import { BrainRush, BRAIN_ARENA } from './brain';
import { TreasureCove, TREASURE_ARENA } from './treasure';

import { GlacierSpleef } from './spleef';
import { DiscoDash } from './disco';
import { AnvilPanic } from './anvil';
import { TntRun } from './tnt_run';
import { BowSpleef } from './bow_spleef';
import { MusicalMinecarts } from './minecarts';
import { GLACIERSPLEEF_ARENA, DISCODASH_ARENA, ANVILPANIC_ARENA, TNTRUN_ARENA, BOWSPLEEF_ARENA, MUSICALMINECARTS_ARENA } from './survival_arenas';

import { KingOfTheHill } from './hill';
import { KINGOFTHEHILL_ARENA,SHEEPHERD_ARENA } from './arena_d';
import { SheepHerd } from './sheep';
import { RooftopTag } from './rooftop';
import { CoinCanopy } from './canopy';
import { BoatRush } from './boat';
import { HedgeMaze } from './maze';
import { LavaClimb } from './lava';
import { RedLight } from './red_light';
import { REDLIGHT_ARENA } from './red_light_arena';
import { CrumblingRuins } from './crumble';
import { NeonBlink } from './neon';
import { LunarLeap } from './lunar';
const ARENAS: Record<string, ArenaDef> = {
  spleef: GLACIERSPLEEF_ARENA, disco: DISCODASH_ARENA, anvil: ANVILPANIC_ARENA, tnt_run: TNTRUN_ARENA, bow_spleef: BOWSPLEEF_ARENA, minecarts: MUSICALMINECARTS_ARENA,
  koth:KINGOFTHEHILL_ARENA,sheep:SHEEPHERD_ARENA,
  red_light: REDLIGHT_ARENA,
  whack: WHACK_ARENA, memory: MEMORY_ARENA,
  brain: BRAIN_ARENA, treasure: TREASURE_ARENA,
};
const FACTORIES: Record<string, (course: number) => Minigame> = {
  spleef: () => new GlacierSpleef(), disco: () => new DiscoDash(), anvil: () => new AnvilPanic(), tnt_run: () => new TntRun(), bow_spleef: () => new BowSpleef(), minecarts: () => new MusicalMinecarts(),
  koth:()=>new KingOfTheHill(),sheep:()=>new SheepHerd(),rooftop_tag:seed=>new RooftopTag(seed),canopy:seed=>new CoinCanopy(seed),boat_race:seed=>new BoatRush(seed),
  maze: seed => new HedgeMaze(seed), lava_climb: seed => new LavaClimb(seed),
  red_light: () => new RedLight(), crumble: seed => new CrumblingRuins(seed), blink: seed => new NeonBlink(seed), lunar: seed => new LunarLeap(seed),
  whack: () => new WhackAMole(), memory: () => new MemoryMosaic(),
  brain: () => new BrainRush(), treasure: () => new TreasureCove(),
};
export function createGame(id: string, course = 0): Minigame | null { return FACTORIES[id]?.(course) ?? null; }
export function arenaOf(id: string): ArenaDef | undefined { return ARENAS[id]; }

export function worldSeed(index: number, course = 0): number { return ((course & 0x3ffffff) << 5 | index) >>> 0; }
export function unseed(seed: number): { index: number; course: number } { return { index: seed & 31, course: seed >>> 5 }; }
export function arenaForSeed(seed: number): ArenaDef | undefined {
  const { index, course } = unseed(seed);
  const id=MG_GAMES[index]?.id ?? '';
  return index === MG_PODIUM_INDEX ? PODIUM : ARENAS[id] ?? createGame(id,course)?.arena;
}

const stamps = new Map<number, VenueStamp>();
/** The built arena (static build + fresh layer), cached per world seed. */
export function arenaStamp(seed: number): VenueStamp {
  const known = stamps.get(seed);
  if (known) return known;
  const def = arenaForSeed(seed);
  if (def?.stamp) {
    if (stamps.size >= 32) stamps.delete(stamps.keys().next().value!);
    stamps.set(seed, def.stamp);
    return def.stamp;
  }
  const b = def?.bounds ?? ARENA_BOX;
  const canvas = new Canvas({ minX: b.minX, maxX: b.maxX, minY: BASE_Y + b.minY, maxY: BASE_Y + b.maxY, minZ: b.minZ, maxZ: b.maxZ });
  if (def) {
    const { course } = unseed(seed);
    const base = arenaSeed(def);
    const d = new Deco(canvas, 0, BASE_Y, 0, course ? base * 31n + BigInt(course) : base);
    def.build(d);
    def.layer?.(new Deco(canvas, 0, BASE_Y, 0, course ? base * 31n + BigInt(course) : base));
    finishShapes(canvas);
  }
  const s = canvas.pack();
  if (stamps.size >= 32) stamps.delete(stamps.keys().next().value!);
  stamps.set(seed, s);
  return s;
}
void JavaRandom;

registerWorldKind('minigames', (seed) => {
  const s = arenaStamp(seed);
  const b = s.bounds;
  return new VenueGenerator(seed, { minX: b.minX, maxX: b.maxX + 1, minZ: b.minZ, maxZ: b.maxZ + 1 },
    b.minY, b.maxY, (x, y, z) => s.get(x, y, z),
    { grass: [.49, .74, .42], foliage: [.35, .68, .19], water: [.25, .46, .89] });
});

export { mgIndex };
