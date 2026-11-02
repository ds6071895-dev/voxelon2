// Disaster City: timings, schedule, scaling and the city layout, ported from
// the plugin's DisasterRules and CityLayout exactly (ticks are 1/20 s).

export type DisasterKind =
  | 'meteors' | 'tornado' | 'flood' | 'tsunami' | 'acid_rain' | 'earthquake'
  | 'sinkholes' | 'wildfire' | 'zombies' | 'lightning' | 'blizzard' | 'gas_leak';

export const DISASTERS: { id: DisasterKind; label: string; tip: string; color: string; icon: string }[] = [
  { id: 'meteors', label: 'Meteor Shower', tip: 'Get underground or under a thick roof!', color: '#ffaa00', icon: '☄' },
  { id: 'tornado', label: 'Tornado', tip: 'Get indoors and stay out of its path!', color: '#aaaaaa', icon: '↺' },
  { id: 'flood', label: 'Flood', tip: 'The water is rising - get up high!', color: '#5555ff', icon: '≈' },
  { id: 'tsunami', label: 'Tsunami', tip: 'A giant wave is coming - climb, fast!', color: '#00aaaa', icon: '≋' },
  { id: 'acid_rain', label: 'Acid Rain', tip: 'Get under any roof!', color: '#55ff55', icon: '☂' },
  { id: 'earthquake', label: 'Earthquake', tip: 'Get out of the tall buildings!', color: '#ffff55', icon: '≡' },
  { id: 'sinkholes', label: 'Sinkholes', tip: 'The ground is opening - keep moving!', color: '#555555', icon: '◎' },
  { id: 'wildfire', label: 'Wildfire', tip: 'Get out of the burning buildings!', color: '#ff5555', icon: '♨' },
  { id: 'zombies', label: 'Zombie Horde', tip: 'Climb up or fight them off!', color: '#00aa00', icon: '☠' },
  { id: 'lightning', label: 'Lightning Storm', tip: 'Stay low and stay indoors!', color: '#55ffff', icon: '⚡' },
  { id: 'blizzard', label: 'Blizzard', tip: 'Get inside before you freeze!', color: '#ffffff', icon: '❄' },
  { id: 'gas_leak', label: 'Gas Leak', tip: 'Run from the hissing!', color: '#ff55ff', icon: '✹' },
];
export function disaster(id: DisasterKind) { return DISASTERS.find((d) => d.id === id)!; }

export const DR = {
  MAX_PLAYERS: 10,
  COUNTDOWN_TICKS: 5 * 20,
  MATCH_TICKS: 5 * 60 * 20,
  FINALE_AT: 4 * 60 * 20,
  WAVES: 11,
  FIRST_WAVE: 8 * 20,
  WAVE_EVERY: 20 * 20,
  WARN_TICKS: 3 * 20,
  OVER_TICKS: 8 * 20,
  OVERLAP_FROM: 2,
  TRIPLE_FROM: 5,
  RECENT_MEMORY: 4,
  FINALE_INTENSITY: 2.0,
  WAVE_RAMP: 0.08,
  SURVIVE_HEAL: 4.0,
  MAX_DEBRIS: 48,
  /** Who to blame for a death: the disaster that hurt you in the last 10 s. */
  BLAME_TICKS: 200,
} as const;
export const FINALE: DisasterKind[] = ['meteors', 'lightning', 'earthquake', 'sinkholes'];

export function waveStart(wave: number): number { return DR.FIRST_WAVE + wave * DR.WAVE_EVERY; }
export function waveDuration(wave: number): number { return wave < DR.OVERLAP_FROM ? 16 * 20 : wave < DR.TRIPLE_FROM ? 36 * 20 : 56 * 20; }
function pair(a: DisasterKind, b: DisasterKind, x: DisasterKind, y: DisasterKind) { return (a === x && b === y) || (a === y && b === x); }
export function conflicts(a: DisasterKind, b: DisasterKind): boolean {
  return a === b || pair(a, b, 'flood', 'tsunami') || pair(a, b, 'blizzard', 'wildfire') || pair(a, b, 'blizzard', 'acid_rain');
}
/** Not one of the recent ones, never one that clashes with what's running; recency relaxes first. */
export function pickDisaster(rng: () => number, recent: DisasterKind[], active: DisasterKind[]): DisasterKind {
  const fresh: DisasterKind[] = [], allowed: DisasterKind[] = [];
  for (const { id } of DISASTERS) {
    if (active.some((r) => conflicts(id, r))) continue;
    allowed.push(id);
    if (!recent.includes(id)) fresh.push(id);
  }
  const from = fresh.length ? fresh : allowed;
  return from.length ? from[Math.floor(rng() * from.length)] : 'meteors';
}
const jround = (v: number) => Math.floor(v + .5);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function scale(alive: number): number { return 1 + .06 * clamp(alive, 1, DR.MAX_PLAYERS); }
export function meteorEvery(alive: number, k: number): number { return clamp(jround(9 / (scale(alive) * k)), 3, 14); }
export function zombieCount(alive: number): number { return clamp(4 * alive, 8, 30); }
export function sinkholeEvery(alive: number): number { return clamp(jround(38 / scale(alive)), 18, 50); }
export function lightningEvery(alive: number, k: number): number { return clamp(jround(13 / (scale(alive) * k)), 4, 18); }
export function gasLeaks(alive: number): number { return clamp(4 + Math.trunc(alive / 2), 4, 9); }
export function crackEvery(alive: number, k: number): number { return clamp(jround(26 / (scale(alive) * k)), 8, 36); }
export function fireStarts(alive: number): number { return clamp(2 + Math.trunc(alive / 3), 3, 5); }

// ── City layout (CityLayout.java) ───────────────────────────────────────────

export const CITY = {
  GROUND: 64, BASE_BOTTOM: 62, MIN: -48, MAX: 47, LOT: 24,
  LOT_MIN: [-43, -12, 19], ROAD_CENTRES: [-16, 15], RING_LOW: -46, RING_HIGH: 45, VOID_Y: 40,
  SUBWAY_X1: -38, SUBWAY_X2: 38, SUBWAY_Z1: 13, SUBWAY_Z2: 17, SUBWAY_FLOOR: 56, SUBWAY_TOP: 61,
  FLOOD_TOP: 64 + 9, WAVE_TOP: 64 + 12,
  CANOPY_X1: -33, CANOPY_Z1: 21, CANOPY_X2: -22, CANOPY_Z2: 29, CANOPY_Y: 64 + 6,
  TOWER_X: 26, TOWER_Z: 24, TOWER_FLOOR: 64 + 13, TOWER_ROOF: 64 + 18,
  MAST_X: 0, MAST_Z: -33, PLAZA_X: 0, PLAZA_Z: 0,
  SUBWAY_STAIRS: [[-38, -36], [36, 38]] as [number, number][], STAIR_TOP_Z: 26,
  /** The box players may break and build in (DisasterSurvival). */
  BUILD_MIN_Y: 50, BUILD_MAX_Y: 130,
  /** Spectator spot. */
  SPECTATE: { x: 63.5, y: 102, z: 63.5, yaw: 135, pitch: 32 },
} as const;

export interface Building { name: string; x1: number; z1: number; x2: number; z2: number; roof: number; wooden: boolean; tall: boolean }
const B = (name: string, x1: number, z1: number, x2: number, z2: number, roof: number, wooden: boolean, tall: boolean): Building => ({ name, x1, z1, x2, z2, roof, wooden, tall });
export const SKYSCRAPER = B('Skyscraper', -39, -39, -24, -24, 64 + 44, false, true);
export const OFFICE = B('Office Tower', -10, -41, 9, -26, 64 + 28, false, true);
export const APARTMENTS = B('Apartments', 21, -41, 40, -26, 64 + 16, true, true);
export const SHOPS = B('Shops', -41, -8, -22, 5, 64 + 10, true, false);
export const GARAGE = B('Parking Garage', 21, -10, 40, 9, 64 + 12, false, false);
export const GAS_STORE = B('Gas Station', -41, 33, -32, 40, 64 + 5, true, false);
export const FIRE_STATION = B('Fire Station', -9, 25, 6, 38, 64 + 10, true, false);
export const HOSE_TOWER = B('Hose Tower', 3, 21, 6, 24, 64 + 22, false, true);
export const DINER = B('Diner', 21, 33, 30, 40, 64 + 5, true, false);
export const HOUSE = B('House', 33, 30, 40, 37, 64 + 5, true, false);
export const BUILDINGS = [SKYSCRAPER, OFFICE, APARTMENTS, SHOPS, GARAGE, GAS_STORE, FIRE_STATION, HOSE_TOWER, DINER, HOUSE];
export const MAST_TOP = OFFICE.roof + 12;
export const bcx = (b: Building) => Math.trunc((b.x1 + b.x2) / 2);
export const bcz = (b: Building) => Math.trunc((b.z1 + b.z2) / 2);
export const contains = (b: Building, x: number, z: number) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2;

export function citySpawns(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < DR.MAX_PLAYERS; i++) {
    const a = Math.PI * 2 * i / DR.MAX_PLAYERS;
    out.push([CITY.PLAZA_X + jround(Math.cos(a) * 7), CITY.GROUND, CITY.PLAZA_Z + jround(Math.sin(a) * 7)]);
  }
  return out;
}
export function manholes(): [number, number][] {
  const h: [number, number][] = [];
  for (const x of CITY.ROAD_CENTRES) for (const z of CITY.ROAD_CENTRES) h.push([x, z]);
  h.push([CITY.RING_LOW, 0], [CITY.RING_HIGH, 0], [0, CITY.RING_LOW], [0, CITY.RING_HIGH], [CITY.RING_LOW, CITY.RING_LOW + 2], [CITY.RING_HIGH, CITY.RING_HIGH - 2]);
  return h;
}
export function inCity(x: number, z: number): boolean { return x >= CITY.MIN && x <= CITY.MAX && z >= CITY.MIN && z <= CITY.MAX; }
export function lotIndex(v: number): number {
  for (let i = 0; i < CITY.LOT_MIN.length; i++) if (v >= CITY.LOT_MIN[i] && v < CITY.LOT_MIN[i] + CITY.LOT) return i;
  return -1;
}
export function isRoad(x: number, z: number): boolean { return inCity(x, z) && (lotIndex(x) < 0 || lotIndex(z) < 0); }
export function buildingAt(x: number, z: number): Building | null { return BUILDINGS.find((b) => contains(b, x, z)) ?? null; }
export function overSubway(x: number, z: number): boolean {
  if (x >= CITY.SUBWAY_X1 - 1 && x <= CITY.SUBWAY_X2 + 1 && z >= CITY.SUBWAY_Z1 - 1 && z <= CITY.SUBWAY_Z2 + 1) return true;
  for (const [a, b] of CITY.SUBWAY_STAIRS) if (x >= a - 1 && x <= b + 1 && z >= CITY.SUBWAY_Z2 + 1 && z <= CITY.STAIR_TOP_Z + 1) return true;
  return false;
}

// ── Client-visible state ────────────────────────────────────────────────────

export type DisasterPhase = 'countdown' | 'waves' | 'finale' | 'over';
export interface DisasterState {
  mode: 'disaster';
  /** Server ms when this snapshot was sent (the client's clock anchor). */
  serverNow: number;
  phase: DisasterPhase;
  /** Server ms the match (or the countdown) ends. */
  endsAt: number;
  /** Next wave (or the apocalypse) at, server ms; null when none is left. */
  nextAt: number | null;
  nextLabel: string;
  wave: number;
  active: { id: DisasterKind; endsAt: number }[];
  weather: 'clear' | 'storm' | 'thunder' | 'snow' | 'acid';
  dusk: boolean;
  players: { id: number; name: string; alive: boolean; disasters: number }[];
  result?: DisasterResult;
}
export interface DisasterResult {
  winners: number[];
  rows: { id: number; name: string; place: number; survived: boolean; seconds: number; cause: string; disasters: number }[];
}
