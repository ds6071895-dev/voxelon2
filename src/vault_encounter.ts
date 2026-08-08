// Deterministic, transport-agnostic vault encounter simulation.
//
// This module deliberately has no DOM, WebAudio, Three.js, world or socket
// dependencies.  The browser's offline adapter and the authoritative server
// both feed it the same participant inputs at 20 Hz.

import type { VaultBossKind, VaultFamily, VaultTier } from './vaults';

export const ENCOUNTER_HZ = 20;
export const ENCOUNTER_SNAPSHOT_HZ = 10;
export const ENCOUNTER_INTRO_SECONDS = 11.5;
export const ENCOUNTER_PHASE_TRANSITION_SECONDS = 3.4;
export const ENCOUNTER_VICTORY_CINEMATIC_SECONDS = 7.2;
export const ENCOUNTER_RESET_GRACE_SECONDS = 15;
export const ENCOUNTER_ENRAGE_SECONDS = 360;
export const MAX_ENCOUNTER_PARTICIPANTS = 6;
export const MAX_ENCOUNTER_TRACKED_PARTICIPANTS = 64;
export const MAX_ENCOUNTER_ACTORS = 32;
export const MAX_ENCOUNTER_OBJECTS = 24;
export const MAX_ENCOUNTER_HAZARDS = 12;
export const MIN_MAJOR_TELEGRAPH = 0.8;

export type EncounterStatus =
  | 'idle'
  | 'intro'
  | 'active'
  | 'reset_grace'
  | 'victory'
  | 'cooldown';

export type EncounterAttackSource = 'melee' | 'bullet' | 'rocket' | 'gadget';

export interface VaultAttackIntent {
  encounterId: string;
  sequence: number;
  targetId: number;
  source: EncounterAttackSource;
  hit: Vec3;
  claimedDamage: number;
}

export interface Vec3 { x: number; y: number; z: number }

export type BossMoveKind =
  | 'strafe' | 'pursue' | 'retreat' | 'charge' | 'leap'
  | 'blink' | 'burrow' | 'socket' | 'target_swap' | 'center';

export interface EncounterSealGeometry {
  center: Vec3;
  axis: 'x' | 'z';
  halfWidth: number;
  height: number;
  inside: Vec3;
  outside: Vec3;
}

export interface BossMovementState {
  kind: BossMoveKind;
  from: Vec3;
  to: Vec3;
  startedAt: number;
  executeAt: number;
}

export interface EncounterHealingState {
  active: boolean;
  sources: number;
  rate: number;
  healed: number;
  cap: number;
}

export interface EncounterWaveState {
  number: number;
  alive: number;
  cap: number;
}

export interface ArenaBounds {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export interface EncounterParticipant {
  id: number;
  position: Vec3;
  alive: boolean;
  inside: boolean;
}

export type EncounterActorKind =
  | 'zombie' | 'skeleton' | 'bone_knight' | 'skitter' | 'spitter' | 'mireling'
  | 'bog_brute' | 'emberling' | 'magma_brute' | 'shardling' | 'mirror_clone'
  | 'clockwork_guard' | 'clockwork_drone';
export type EncounterObjectKind =
  | 'sarcophagus' | 'brood_pool' | 'brazier' | 'prism' | 'turret'
  | 'bone_pillar' | 'safe_island' | 'cover' | 'mine' | 'crusher_wall';

export interface EncounterActor {
  id: number;
  kind: EncounterActorKind;
  position: Vec3;
  hp: number;
  maxHp: number;
  targetId: number;
  nextActionAt: number;
}

export interface EncounterObject {
  id: number;
  kind: EncounterObjectKind;
  position: Vec3;
  hp: number;
  maxHp: number;
  socket: number;
  expiresAt: number;
  critical: boolean;
}

export type HazardShape = 'circle' | 'ring' | 'line' | 'cone' | 'quadrant' | 'rain';
export interface EncounterHazard {
  id: number;
  shape: HazardShape;
  origin: Vec3;
  target?: Vec3;
  radius: number;
  width: number;
  angle: number;
  telegraphAt: number;
  executeAt: number;
  expiresAt: number;
  damage: number;
  attack: string;
  safeLanes?: number[];
  hitParticipants: number[];
}

export interface EncounterEvent {
  id: string;
  type: 'start' | 'cast' | 'attack' | 'phase' | 'spawn' | 'death'
    | 'move' | 'heal' | 'seal' | 'wave' | 'combo'
    | 'poise_break' | 'enrage' | 'victory' | 'reset';
  executeAt: number;
  sourceId: number;
  targets: number[];
  geometry?: EncounterHazard;
  theme: VaultFamily;
  audio: string;
}

export interface BossDefinition {
  kind: VaultBossKind;
  family: VaultFamily;
  name: string;
  title: string;
  introLine: string;
  victoryLine: string;
  phaseTitles: readonly [string, string, string];
  hpModifier: number;
  color: string;
  phases: readonly [
    readonly AttackDefinition[],
    readonly AttackDefinition[],
    readonly AttackDefinition[],
  ];
  criticalObject: EncounterObjectKind;
  criticalCount: number;
  poiseObjects?: number;
  // --- In-fight coaching -----------------------------------------------------
  // Every boss protects itself in a DIFFERENT way (some are shielded by their
  // wards, some are healed by them), and a player who does not know which one
  // they are looking at just shoots a boss whose health bar refuses to move.
  // These strings let the HUD explain the mechanic in the fight itself instead
  // of expecting the fight to be read about beforehand.
  /** What one critical object is called, singular then plural. */
  objectName: string;
  objectPlural: string;
  /** What the wards do for the boss while they still stand (HUD-sized clause). */
  wardEffect: string;
  /** One plain-language instruction per phase: what to actually do right now. */
  phaseBriefs: readonly [string, string, string];
  moveStyle: readonly BossMoveKind[];
  moveCadence: number;
  healingPerSource: number;
  army: readonly EncounterActorKind[];
}

export interface AttackDefinition {
  name: string;
  telegraph: number;
  recovery: number;
  cooldown: number;
  damage: number;
  shape: HazardShape;
  radius: number;
  width?: number;
  angle?: number;
  count?: number;
  summons?: EncounterActorKind;
  object?: EncounterObjectKind;
}

const attack = (
  name: string, shape: HazardShape, telegraph: number, cooldown: number,
  damage: number, radius: number, extra: Partial<AttackDefinition> = {},
): AttackDefinition => ({ name, shape, telegraph, cooldown, damage, radius,
  recovery: 0.9, ...extra });

export const BOSS_DEFINITIONS: Record<VaultBossKind, BossDefinition> = {
  bone_warden: {
    kind: 'bone_warden', family: 'crypt', name: 'Bone Warden',
    title: 'Keeper of the Restless', hpModifier: 0.9, color: '#aa72ff',
    introLine: 'The seals crack. Every grave answers.',
    victoryLine: 'The dead fall silent at last.',
    phaseTitles: ['The Sealed Tomb', 'The Graves Open', 'Last Rites'],
    criticalObject: 'sarcophagus', criticalCount: 4, poiseObjects: 2,
    objectName: 'Sarcophagus', objectPlural: 'Sarcophagi',
    wardEffect: 'while 2 or more still stand the Warden takes HALF damage',
    phaseBriefs: [
      'Straight fight: stay out of its cone swings and leave the shockwave ring — then hit the Warden.',
      'It raises 4 Sarcophagi. Break them — with 2+ standing the Warden takes HALF damage, and every one you break staggers it.',
      'No more coffins. Dodge the falling bone pillars and its charge lane, and finish it.',
    ],
    moveStyle: ['socket', 'blink', 'charge', 'target_swap'], moveCadence: 5.2,
    healingPerSource: 1.25, army: ['skeleton', 'zombie', 'bone_knight'],
    phases: [
      [
        attack('Warden Cleave', 'cone', 0.9, 3.2, 6, 5, { angle: Math.PI * 0.7 }),
        attack('Shield Bash', 'cone', 0.8, 3.6, 4, 3, { angle: Math.PI * 0.45 }),
        attack('Soul Shockwave', 'ring', 1.1, 4.5, 6, 7),
      ],
      [
        attack('Raise Sarcophagi', 'circle', 1, 8, 0, 2,
          { object: 'sarcophagus', summons: 'zombie', count: 4 }),
        attack('Twin Soul Shockwave', 'ring', 1, 4.2, 7, 8, { count: 2 }),
        attack('Warden Cleave', 'cone', 0.85, 3, 7, 5, { angle: Math.PI * 0.7 }),
      ],
      [
        attack('Bone Pillars', 'rain', 1, 4.6, 8, 2,
          { object: 'bone_pillar', count: 5 }),
        attack('Bone Storm', 'ring', 1.1, 5.2, 8, 7),
        attack('Grave Charge', 'line', 1, 5.5, 10, 11, { width: 2.3 }),
      ],
    ],
  },
  mire_queen: {
    kind: 'mire_queen', family: 'mire', name: 'Mire Queen',
    title: 'Mother Beneath the Reeds', hpModifier: 1, color: '#42e2bd',
    introLine: 'Something ancient stirs below the black water.',
    victoryLine: 'The brood sinks back into the mire.',
    phaseTitles: ['Venom Crown', 'The Brood Awakens', 'Drowning Court'],
    criticalObject: 'brood_pool', criticalCount: 3,
    objectName: 'Brood Pool', objectPlural: 'Brood Pools',
    wardEffect: 'each pool still bubbling heals her back up',
    phaseBriefs: [
      'Straight fight: sidestep the venom cones and keep moving off the falling mud — then hit the Queen.',
      'She wakes 3 Brood Pools that HEAL her. Smash the pools first or her health will not move.',
      'Pools are done. Ride the safe islands, dodge the tidal lane, and finish her.',
    ],
    moveStyle: ['burrow', 'target_swap', 'retreat', 'pursue'], moveCadence: 4.4,
    healingPerSource: 1.55, army: ['mireling', 'spitter', 'skitter', 'bog_brute'],
    phases: [
      [
        attack('Poison Spit', 'cone', 0.8, 2.8, 5, 9,
          { angle: Math.PI * 0.6, count: 3 }),
        attack('Festering Mud', 'rain', 1, 3.8, 5, 2, { count: 3 }),
        attack('Burrow', 'circle', 0.9, 4.5, 4, 2),
      ],
      [
        attack('Awaken Brood Pools', 'circle', 1, 8, 0, 2,
          { object: 'brood_pool', summons: 'mireling', count: 3 }),
        attack('Sanctum Wave', 'line', 1.2, 5.2, 8, 17, { width: 5 }),
        attack('Poison Spit', 'cone', 0.8, 2.6, 6, 9,
          { angle: Math.PI * 0.65, count: 3 }),
      ],
      [
        attack('Poison Rain', 'rain', 0.9, 3.4, 7, 1.8, { count: 5 }),
        attack('Tidal Charge', 'line', 1, 5, 9, 14, { width: 3 }),
        attack('Rotating Islands', 'quadrant', 1.2, 6, 8, 12,
          { object: 'safe_island', count: 4 }),
      ],
    ],
  },
  ember_colossus: {
    kind: 'ember_colossus', family: 'ember', name: 'Ember Colossus',
    title: 'The Furnace Unbound', hpModifier: 1.2, color: '#ff6b32',
    introLine: 'The forge has found a heartbeat.',
    victoryLine: 'The furnace gutters into ash.',
    phaseTitles: ['Cold Iron', 'Furnace Heart', 'Worldfire'],
    criticalObject: 'brazier', criticalCount: 4,
    objectName: 'Brazier', objectPlural: 'Braziers',
    wardEffect: 'every lit brazier pours heat back into the Colossus and heals it',
    phaseBriefs: [
      'Straight fight: stay off the lava fissures and out of its grasp cone — then hit the Colossus.',
      'It lights 4 Braziers that HEAL it. Put the braziers out first — damage on the Colossus is wasted while they burn.',
      'Braziers are out. Watch which quarter of the floor lights up, cross the shockwaves, and finish it.',
    ],
    moveStyle: ['leap', 'charge', 'center', 'pursue'], moveCadence: 5.6,
    healingPerSource: 1.35, army: ['emberling', 'emberling', 'magma_brute'],
    phases: [
      [
        attack('Hammer Fist', 'circle', 1.1, 4, 8, 4),
        attack('Lava Fissure', 'line', 1, 4.5, 7, 13, { width: 1.6 }),
        attack('Furnace Grasp', 'cone', 1.1, 5.4, 10, 5, { angle: Math.PI * 0.4 }),
      ],
      [
        attack('Ignite Braziers', 'circle', 1.1, 8, 0, 2,
          { object: 'brazier', summons: 'emberling', count: 4 }),
        attack('Meteor Forge', 'rain', 1, 3.8, 8, 2.2, { count: 4 }),
        attack('Hammer Fist', 'circle', 1, 3.8, 9, 4.5),
      ],
      [
        attack('Forge Quadrants', 'quadrant', 1.2, 4.8, 9, 12),
        attack('Crossing Shockwaves', 'line', 1, 5.2, 10, 17,
          { width: 1.8, count: 2 }),
        attack('Last Fissure', 'line', 0.9, 4, 9, 15, { width: 2 }),
      ],
    ],
  },
  crystal_seer: {
    kind: 'crystal_seer', family: 'crystal', name: 'Crystal Seer',
    title: 'Eye Beyond the Prism', hpModifier: 0.95, color: '#65b9ff',
    introLine: 'It has already seen how you die.',
    victoryLine: 'A thousand doomed futures shatter.',
    phaseTitles: ['Foreseen', 'Hall of Mirrors', 'Final Prophecy'],
    criticalObject: 'prism', criticalCount: 3,
    objectName: 'Prism', objectPlural: 'Prisms',
    wardEffect: 'while ANY prism floats the Seer only takes a QUARTER of your damage',
    phaseBriefs: [
      'Straight fight: step out of the beam lanes and the prism fan — then hit the Seer.',
      'HALL OF MIRRORS: it conjures 3 Prisms. Shoot the PRISMS, not the Seer — while even one floats it only takes a QUARTER of your damage. Break all three and it is exposed.',
      'Prisms are gone. Cross the twin prophecy beams, keep moving under the falling shards, and finish it.',
    ],
    moveStyle: ['blink', 'target_swap', 'socket', 'retreat'], moveCadence: 3.9,
    healingPerSource: 1.45, army: ['mirror_clone', 'shardling', 'mirror_clone'],
    phases: [
      [
        attack('Fate Beam', 'line', 1.1, 3.8, 7, 18, { width: 1.4 }),
        attack('Prism Fan', 'cone', 0.9, 3.2, 6, 12,
          { angle: Math.PI * 0.9, count: 5 }),
        attack('Astral Arrival', 'circle', 0.9, 4.5, 6, 3),
      ],
      [
        attack('Conjure Prisms', 'circle', 1, 8, 0, 2,
          { object: 'prism', count: 3 }),
        attack('Mirror Echo', 'line', 1, 4.4, 6, 18,
          { summons: 'mirror_clone', count: 2, width: 1.2 }),
        attack('Rotating Refraction', 'line', 1.1, 4.8, 8, 18, { width: 1.2 }),
      ],
      [
        attack('Crossed Prophecy', 'line', 1.1, 5, 9, 18,
          { width: 1.6, count: 2 }),
        attack('Falling Shards', 'rain', 0.9, 3.6, 7, 1.8, { count: 6 }),
        attack('Astral Arrival', 'circle', 0.8, 3.8, 7, 3),
      ],
    ],
  },
  gilded_artificer: {
    kind: 'gilded_artificer', family: 'gilded', name: 'Gilded Artificer',
    title: 'Architect of Avarice', hpModifier: 1.05, color: '#f1bd42',
    introLine: 'The vault itself takes up arms.',
    victoryLine: 'The golden engine grinds to a halt.',
    phaseTitles: ['Calculated Defense', 'War Machine', 'Total Lockdown'],
    criticalObject: 'turret', criticalCount: 2,
    objectName: 'Turret', objectPlural: 'Turrets',
    wardEffect: 'each live turret repairs the Artificer FAST',
    phaseBriefs: [
      'Straight fight: dodge the golden blade fan, avoid the mines it scatters, and hit the Artificer.',
      'It deploys 2 Turrets that REPAIR it faster than you can hurt it. Wreck the turrets first.',
      'Turrets are scrap. Get out from between the crusher walls, dodge the coin storm, and finish it.',
    ],
    moveStyle: ['strafe', 'charge', 'socket', 'target_swap'], moveCadence: 4.3,
    healingPerSource: 2.1, army: ['clockwork_guard', 'clockwork_drone', 'clockwork_guard'],
    phases: [
      [
        attack('Golden Blades', 'cone', 0.85, 3, 6, 10,
          { angle: Math.PI * 0.7, count: 5 }),
        attack('Proximity Mines', 'rain', 1, 4.2, 7, 2,
          { object: 'mine', count: 3 }),
        attack('Preview Dash', 'line', 0.9, 4.4, 7, 10, { width: 2 }),
      ],
      [
        attack('Deploy Turrets', 'circle', 1, 8, 0, 2,
          { object: 'turret', summons: 'clockwork_guard', count: 2 }),
        attack('Raise Cover', 'line', 1, 5, 0, 8, { object: 'cover', count: 4 }),
        attack('Field Repair', 'circle', 1.2, 5.2, 5, 4),
      ],
      [
        attack('Crusher Walls', 'line', 1.2, 5.2, 9, 17,
          { object: 'crusher_wall', count: 2, width: 4 }),
        attack('Coin Storm', 'rain', 0.9, 3.4, 7, 1.8, { count: 6 }),
        attack('Overclock', 'ring', 1.1, 5.8, 10, 8),
      ],
    ],
  },
};

export function encounterBaseHp(tier: VaultTier): number {
  return tier === 1 ? 320 : tier === 2 ? 720 : 1200;
}

export function encounterDamageMultiplier(tier: VaultTier): number {
  return tier === 1 ? 1 : tier === 2 ? 1.3 : 1.65;
}

export function participantHpMultiplier(peakParticipants: number): number {
  const n = Math.max(1, Math.min(MAX_ENCOUNTER_PARTICIPANTS,
    Math.floor(peakParticipants)));
  return 1 + 0.6 * (n - 1);
}

export function bossMaxHp(
  tier: VaultTier, kind: VaultBossKind, peakParticipants = 1,
): number {
  return Math.round(encounterBaseHp(tier) * BOSS_DEFINITIONS[kind].hpModifier *
    participantHpMultiplier(peakParticipants));
}

export interface EncounterConfig {
  encounterId: string;
  seed: number;
  tier: VaultTier;
  kind: VaultBossKind;
  family: VaultFamily;
  center: Vec3;
  bounds: ArenaBounds;
  sockets: readonly Vec3[];
  cameraAnchors: readonly Vec3[];
  seal?: EncounterSealGeometry;
  startTime: number;
}

export interface AttackValidation {
  heldSource: EncounterAttackSource | null;
  maxDamage: number;
  range: number;
  cadence: number;
  now: number;
}

export interface AttackResult {
  accepted: boolean;
  reason?: 'attempt' | 'sequence' | 'state' | 'participant' | 'weapon'
    | 'cadence' | 'damage' | 'range' | 'target' | 'invulnerable';
  damage: number;
  killed: boolean;
}

export interface EncounterSnapshot {
  encounterId: string;
  tick: number;
  /** Encounter clock used by renderers to animate telegraph countdowns. */
  time: number;
  status: EncounterStatus;
  family: VaultFamily;
  kind: VaultBossKind;
  tier: VaultTier;
  phase: 1 | 2 | 3;
  hp: number;
  maxHp: number;
  hpPercent: number;
  poise: number;
  maxPoise: number;
  exposedUntil: number;
  enrage: boolean;
  elapsed: number;
  cast: { name: string; endsAt: number } | null;
  boss: { id: number; position: Vec3 };
  actors: EncounterActor[];
  objects: EncounterObject[];
  hazards: EncounterHazard[];
  participants: number[];
  peakParticipants: number;
  criticalObjects: number;
  movement: BossMovementState | null;
  healing: EncounterHealingState;
  wave: EncounterWaveState;
  seal: { sealed: boolean; geometry: EncounterSealGeometry | null };
}

function hash32(x: number): number {
  x |= 0; x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

function rngFrom(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function copyVec(v: Vec3): Vec3 { return { x: v.x, y: v.y, z: v.z }; }
function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export class VaultEncounter {
  readonly config: EncounterConfig;
  readonly definition: BossDefinition;
  status: EncounterStatus = 'idle';
  phase: 1 | 2 | 3 = 1;
  hp: number;
  maxHp: number;
  poise = 100;
  readonly maxPoise = 100;
  exposedUntil = 0;
  phaseInvulnerableUntil = 0;
  enrage = false;
  tickCount = 0;
  now: number;
  startedAt = 0;
  resetAt = 0;
  cast: { attack: AttackDefinition; endsAt: number } | null = null;
  bossPosition: Vec3;
  readonly actors: EncounterActor[] = [];
  readonly objects: EncounterObject[] = [];
  readonly hazards: EncounterHazard[] = [];
  readonly participants = new Set<number>();
  peakParticipants = 1;

  private readonly rng: () => number;
  private readonly sequence = new Map<number, number>();
  private readonly lastAttack = new Map<number, number>();
  private readonly eventQueue: EncounterEvent[] = [];
  private eventNo = 0;
  private entityNo = 1;
  private nextAttackAt = 0;
  private phaseObjectsSpawned = false;
  private pendingMove: (BossMovementState & { position: Vec3; at: number }) | null = null;
  private nextMoveAt = 0;
  private waveNo = 0;
  private healedTotal = 0;
  private healingActive = false;
  private readonly comboQueue: AttackDefinition[] = [];
  private attackNo = 0;
  private lastAttackName = '';
  private enrageEmitted = false;
  private victoryEmitted = false;

  constructor(config: EncounterConfig) {
    this.config = { ...config, center: copyVec(config.center),
      bounds: { ...config.bounds },
      sockets: config.sockets.map(copyVec),
      cameraAnchors: config.cameraAnchors.map(copyVec),
      seal: config.seal ? { ...config.seal, center: copyVec(config.seal.center),
        inside: copyVec(config.seal.inside), outside: copyVec(config.seal.outside) } : undefined };
    this.definition = BOSS_DEFINITIONS[config.kind];
    if (!this.definition || this.definition.family !== config.family) {
      throw new Error('vault encounter family/boss mismatch');
    }
    this.rng = rngFrom(hash32(config.seed ^ hash32(config.encounterId.length)));
    this.now = config.startTime;
    this.bossPosition = copyVec(config.center);
    this.maxHp = bossMaxHp(config.tier, config.kind, 1);
    this.hp = this.maxHp;
  }

  /** Start is idempotent; joining an already-running attempt only scales it. */
  start(participantId: number, now = this.now): void {
    this.now = Math.max(this.now, now);
    this.join(participantId);
    if (this.status !== 'idle') return;
    this.status = 'intro';
    this.startedAt = this.now + ENCOUNTER_INTRO_SECONDS;
    this.nextAttackAt = this.startedAt + 0.8;
    this.nextMoveAt = this.startedAt + 2.2;
    this.emit('seal', this.now, [], 'door_seal');
    this.emit('start', this.startedAt, [], 'intro');
  }

  join(participantId: number): void {
    if (!Number.isSafeInteger(participantId) || participantId < 0) return;
    this.participants.add(participantId);
    const nextPeak = Math.min(MAX_ENCOUNTER_PARTICIPANTS, this.participants.size);
    if (nextPeak <= this.peakParticipants) return;
    const pct = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    this.peakParticipants = nextPeak;
    this.maxHp = bossMaxHp(this.config.tier, this.config.kind, nextPeak);
    this.hp = Math.max(1, Math.round(this.maxHp * pct));
  }

  leave(participantId: number): void { this.participants.delete(participantId); }

  /**
   * Advance by one fixed step. Adapters may pass a larger dt; it is split into
   * 20 Hz steps so attack selection and threshold behavior stay deterministic.
   */
  tick(dt: number, participantInputs: readonly EncounterParticipant[]): EncounterEvent[] {
    if (!Number.isFinite(dt) || dt <= 0) return this.drainEvents();
    const byId = new Map(participantInputs.map((p) => [p.id, p]));
    let left = Math.min(dt, 1);
    const step = 1 / ENCOUNTER_HZ;
    while (left > 1e-8) {
      const d = Math.min(step, left);
      this.step(d, byId);
      left -= d;
    }
    return this.drainEvents();
  }

  private step(dt: number, input: ReadonlyMap<number, EncounterParticipant>): void {
    this.now += dt;
    this.tickCount++;
    for (const id of [...this.participants]) {
      const p = input.get(id);
      if (!p || !p.alive || !p.inside || !this.inside(p.position)) this.participants.delete(id);
    }
    for (const p of input.values()) {
      if (p.alive && p.inside && this.inside(p.position)) this.join(p.id);
    }
    const livingInside = [...this.participants].filter((id) => {
      const p = input.get(id);
      return !!p && p.alive && p.inside && this.inside(p.position);
    });

    if (this.status === 'intro' && this.now >= this.startedAt) this.status = 'active';
    if (this.status === 'active' && livingInside.length === 0) {
      this.status = 'reset_grace';
      this.resetAt = this.now + ENCOUNTER_RESET_GRACE_SECONDS;
    } else if (this.status === 'reset_grace') {
      if (livingInside.length > 0) this.status = 'active';
      else if (this.now >= this.resetAt) { this.reset(); return; }
    }
    if (this.status !== 'active') return;
    // Phase cinematics are authoritative safe windows: no boss pattern, summon
    // movement or hazard resolution can run while player control is suppressed.
    if (this.now < this.phaseInvulnerableUntil) return;

    const elapsed = this.now - this.startedAt;
    if (!this.enrage && elapsed >= ENCOUNTER_ENRAGE_SECONDS) {
      this.enrage = true;
      if (!this.enrageEmitted) {
        this.enrageEmitted = true;
        this.emit('enrage', this.now, livingInside, 'enrage');
      }
    }

    this.expireEntities();
    this.tickHealing(dt);
    if (this.pendingMove && this.now >= this.pendingMove.at) {
      this.bossPosition = copyVec(this.pendingMove.position);
      this.pendingMove = null;
    }
    if (!this.cast && !this.pendingMove && this.now >= this.nextMoveAt && livingInside.length) {
      this.beginMove(livingInside, input);
    }
    this.resolveHazards();
    if (!this.cast && this.now >= this.nextAttackAt && livingInside.length) {
      this.beginAttack(livingInside, input);
    } else if (this.cast && this.now >= this.cast.endsAt) {
      this.cast = null;
    }
    this.tickSummoners(livingInside, input, dt);
  }

  private beginAttack(targetIds: number[], input: ReadonlyMap<number, EncounterParticipant>): void {
    const attacks = this.definition.phases[this.phase - 1];
    let choices = attacks;
    if (this.phase >= 2 && this.phaseObjectsSpawned) {
      choices = attacks.filter((a) => !a.object || a.object !== this.definition.criticalObject);
      if (!choices.length) choices = attacks;
    }
    let chosen = this.comboQueue.shift();
    if (!chosen) {
      const fresh = choices.filter((a) => a.name !== this.lastAttackName);
      const pool = fresh.length ? fresh : choices;
      chosen = pool[Math.floor(this.rng() * pool.length)];
      this.attackNo++;
      if (this.attackNo % 4 === 0) {
        const follow = choices.filter((a) => a.name !== chosen!.name);
        if (follow.length) {
          this.comboQueue.push(follow[Math.floor(this.rng() * follow.length)]);
          this.emit('combo', this.now, targetIds, 'major_combo');
        }
      }
    }
    this.lastAttackName = chosen.name;
    const targetId = targetIds[Math.floor(this.rng() * targetIds.length)];
    const target = input.get(targetId)?.position ?? this.config.center;
    this.cast = { attack: chosen, endsAt: this.now + chosen.telegraph + chosen.recovery };
    const comboDelay = chosen.telegraph + chosen.recovery + 0.25;
    this.nextAttackAt = this.now + (this.comboQueue.length ? comboDelay
      : chosen.cooldown * (this.enrage ? 0.75 : 1));
    this.emit('cast', this.now, [targetId], chosen.name);
    this.spawnPattern(chosen, target, targetIds);
    if (chosen.name === 'Burrow' || chosen.name === 'Astral Arrival') {
      const p = this.config.sockets[Math.floor(this.rng() *
        Math.max(1, this.config.sockets.length))] ?? this.config.center;
      this.scheduleMove(chosen.name === 'Burrow' ? 'burrow' : 'blink', p, chosen.telegraph);
    } else if (chosen.name.includes('Charge') || chosen.name === 'Preview Dash') {
      this.scheduleMove('charge', target, chosen.telegraph);
    }
  }

  private beginMove(targetIds: number[], input: ReadonlyMap<number, EncounterParticipant>): void {
    const styles = this.definition.moveStyle;
    const kind = styles[Math.floor(this.rng() * styles.length)] ?? 'socket';
    const targetId = targetIds[Math.floor(this.rng() * targetIds.length)];
    const target = input.get(targetId)?.position ?? this.config.center;
    const sockets = this.config.sockets.length ? this.config.sockets : [this.config.center];
    let destination = copyVec(sockets[Math.floor(this.rng() * sockets.length)] ?? this.config.center);
    if (kind === 'center') destination = copyVec(this.config.center);
    else if (kind === 'charge' || kind === 'leap' || kind === 'pursue' || kind === 'target_swap') {
      const dx = target.x - this.config.center.x, dz = target.z - this.config.center.z;
      const rawLen = Math.hypot(dx, dz);
      if (rawLen < 0.5) {
        destination = copyVec(sockets[Math.floor(this.rng() * sockets.length)] ?? this.config.center);
      } else {
        const offset = kind === 'pursue' ? -2.5 : -1.8;
        destination = { x: target.x + dx / rawLen * offset, y: this.config.center.y,
          z: target.z + dz / rawLen * offset };
      }
    } else if (kind === 'retreat') {
      const dx = this.bossPosition.x - target.x, dz = this.bossPosition.z - target.z;
      const len = Math.max(0.001, Math.hypot(dx, dz));
      destination = { x: this.bossPosition.x + dx / len * 6, y: this.config.center.y,
        z: this.bossPosition.z + dz / len * 6 };
    } else if (kind === 'strafe') {
      const angle = Math.atan2(target.z - this.config.center.z, target.x - this.config.center.x) +
        (this.rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      destination = { x: target.x + Math.cos(angle) * 5, y: this.config.center.y,
        z: target.z + Math.sin(angle) * 5 };
    }
    destination.x = Math.max(this.config.bounds.minX + 1.2,
      Math.min(this.config.bounds.maxX - 1.2, destination.x));
    destination.z = Math.max(this.config.bounds.minZ + 1.2,
      Math.min(this.config.bounds.maxZ - 1.2, destination.z));
    destination.y = this.config.center.y;
    const telegraph = kind === 'charge' || kind === 'leap' ? 1.05
      : kind === 'burrow' || kind === 'blink' || kind === 'target_swap' ? 0.8 : 0.55;
    this.scheduleMove(kind, destination, telegraph);
    const pressure = Math.max(0, this.phase - 1) + (this.enrage ? 1 : 0);
    this.nextMoveAt = this.now + Math.max(2.4,
      this.definition.moveCadence - pressure * 0.65) * (this.enrage ? 0.8 : 1);
  }

  private scheduleMove(kind: BossMoveKind, destination: Vec3, telegraph: number): void {
    const executeAt = this.now + Math.max(0.45, telegraph);
    this.pendingMove = {
      kind, from: copyVec(this.bossPosition), to: copyVec(destination),
      startedAt: this.now, executeAt, at: executeAt, position: copyVec(destination),
    };
    this.emit('move', this.now, [], `move_${kind}`);
  }

  private healingRate(): number {
    if (this.phase < 2 || this.status !== 'active') return 0;
    const sources = this.objects.filter((o) => o.critical && o.hp > 0).length;
    if (!sources || this.hp >= this.maxHp * 0.9 || this.healedTotal >= this.maxHp * 0.35) return 0;
    return sources * this.definition.healingPerSource * (1 + (this.config.tier - 1) * 0.2);
  }

  private tickHealing(dt: number): void {
    const rate = this.healingRate();
    if (rate <= 0) {
      this.healingActive = false;
      return;
    }
    if (!this.healingActive) {
      this.healingActive = true;
      this.emit('heal', this.now, [], 'healing_channel');
    }
    const capLeft = this.maxHp * 0.35 - this.healedTotal;
    const healthLeft = this.maxHp * 0.9 - this.hp;
    const amount = Math.max(0, Math.min(rate * dt, capLeft, healthLeft));
    this.hp += amount;
    this.healedTotal += amount;
  }

  private spawnPattern(a: AttackDefinition, target: Vec3, targetIds: number[]): void {
    const count = Math.max(1, a.count ?? 1);
    const executeAt = this.now + Math.max(MIN_MAJOR_TELEGRAPH, a.telegraph);
    for (let i = 0; i < count && this.hazards.length < MAX_ENCOUNTER_HAZARDS; i++) {
      const angle = count === 1 ? 0 : i * Math.PI * 2 / count;
      const spread = a.shape === 'rain' ? 2 + this.rng() * 6 : 0;
      const origin = a.shape === 'rain'
        ? { x: target.x + Math.cos(angle) * spread, y: this.config.center.y,
          z: target.z + Math.sin(angle) * spread }
        : copyVec(this.bossPosition);
      const h: EncounterHazard = {
        id: this.entityNo++, shape: a.shape, origin, target: copyVec(target),
        radius: a.radius, width: a.width ?? 1.5, angle: a.angle ?? Math.PI * 2,
        telegraphAt: this.now, executeAt, expiresAt: executeAt + 0.35,
        damage: Math.round(a.damage * encounterDamageMultiplier(this.config.tier)),
        attack: a.name, hitParticipants: [],
      };
      if (a.name === 'Sanctum Wave') h.safeLanes = [-5, 5];
      this.hazards.push(h);
      this.emit('attack', executeAt, targetIds, a.name, h);
    }
    if (a.object) {
      const objectCount = Math.min(count, this.config.sockets.length);
      for (let i = 0; i < objectCount; i++) this.spawnObject(a.object, i);
      if (a.object === this.definition.criticalObject) this.phaseObjectsSpawned = true;
    }
    if (a.summons) {
      const pressure = Math.ceil((this.peakParticipants - 1) / 2);
      const total = Math.min(MAX_ENCOUNTER_ACTORS - this.actors.length,
        count + pressure + this.phase + this.config.tier);
      if (total > 0) {
        this.waveNo++;
        this.emit('wave', this.now, targetIds, `army_${this.waveNo}`);
      }
      for (let i = 0; i < total; i++) {
        const kind = i === 0 ? a.summons : this.definition.army[i % this.definition.army.length];
        this.spawnActor(kind, targetIds);
      }
    }
  }

  private spawnObject(kind: EncounterObjectKind, socket: number): void {
    if (this.objects.length >= MAX_ENCOUNTER_OBJECTS) return;
    const p = this.config.sockets[socket % Math.max(1, this.config.sockets.length)]
      ?? this.config.center;
    const hp = 30 + this.config.tier * 20;
    const critical = kind === this.definition.criticalObject;
    const o: EncounterObject = {
      id: this.entityNo++, kind, position: copyVec(p), hp, maxHp: hp, socket,
      expiresAt: critical ? Infinity : this.now + 18, critical,
    };
    this.objects.push(o);
    this.emit('spawn', this.now, [], kind);
  }

  private spawnActor(kind: EncounterActorKind, targets: number[]): void {
    if (this.actors.length >= MAX_ENCOUNTER_ACTORS) return;
    const socket = this.config.sockets[this.actors.length % Math.max(1, this.config.sockets.length)]
      ?? this.config.center;
    const elite = kind === 'bone_knight' || kind === 'bog_brute' || kind === 'magma_brute' ||
      kind === 'clockwork_guard';
    const hp = (elite ? 24 : 14) + this.config.tier * (elite ? 12 : 9);
    const a: EncounterActor = {
      id: this.entityNo++, kind, position: copyVec(socket), hp, maxHp: hp,
      targetId: targets[Math.floor(this.rng() * Math.max(1, targets.length))] ?? -1,
      nextActionAt: this.now + 1.5,
    };
    this.actors.push(a);
    this.emit('spawn', this.now, a.targetId >= 0 ? [a.targetId] : [], kind);
  }

  private tickSummoners(
    targets: number[], input: ReadonlyMap<number, EncounterParticipant>, dt: number,
  ): void {
    if (!targets.length) return;
    // Summons are simple authoritative arena actors: drift toward their target
    // and emit a small readable strike. They never drop loot or cross bounds.
    for (const actor of this.actors) {
      const target = input.get(actor.targetId) ?? input.get(targets[0]);
      if (!target) continue;
      const dx = target.position.x - actor.position.x;
      const dz = target.position.z - actor.position.z;
      const len = Math.max(0.001, Math.hypot(dx, dz));
      const fast = actor.kind === 'mireling' || actor.kind === 'skitter' ||
        actor.kind === 'clockwork_drone' || actor.kind === 'shardling';
      const heavy = actor.kind === 'bone_knight' || actor.kind === 'bog_brute' ||
        actor.kind === 'magma_brute';
      const speed = fast ? 2.8 : heavy ? 1.25 : actor.kind === 'clockwork_guard' ? 2.1 : 1.7;
      const nx = actor.position.x + dx / len * Math.min(len, speed * dt);
      const nz = actor.position.z + dz / len * Math.min(len, speed * dt);
      actor.position.x = Math.max(this.config.bounds.minX,
        Math.min(this.config.bounds.maxX, nx));
      actor.position.z = Math.max(this.config.bounds.minZ,
        Math.min(this.config.bounds.maxZ, nz));
      if (this.now >= actor.nextActionAt && this.hazards.length < MAX_ENCOUNTER_HAZARDS) {
        const ranged = actor.kind === 'spitter' || actor.kind === 'mirror_clone' ||
          actor.kind === 'shardling' || actor.kind === 'clockwork_drone' || actor.kind === 'skeleton';
        actor.nextActionAt = this.now + (ranged ? 3 : heavy ? 3.2 : 2.4);
        const executeAt = this.now + (ranged ? 0.95 : MIN_MAJOR_TELEGRAPH);
        const h: EncounterHazard = {
          id: this.entityNo++, shape: ranged ? 'line' : 'circle',
          origin: ranged ? copyVec(actor.position) : copyVec(target.position),
          target: ranged ? copyVec(target.position) : undefined,
          radius: ranged ? Math.min(14, Math.max(3, len)) : heavy ? 1.8 : 1.25,
          width: ranged ? 1.1 : 0.4, angle: Math.PI * 2,
          telegraphAt: this.now, executeAt, expiresAt: executeAt + 0.3,
          damage: Math.max(2, Math.round((heavy ? 5 : ranged ? 4 : 3) *
            encounterDamageMultiplier(this.config.tier))),
          attack: `${actor.kind} ${ranged ? 'volley' : 'strike'}`, hitParticipants: [],
        };
        this.hazards.push(h);
        this.emit('attack', executeAt, [target.id], h.attack, h, actor.id);
      }
    }
    if (this.actors.length >= MAX_ENCOUNTER_ACTORS) return;
    const critical = this.objects.filter((o) => o.critical && o.hp > 0);
    for (const o of critical) {
      if (this.actors.length >= MAX_ENCOUNTER_ACTORS) break;
      if (!Number.isFinite(o.expiresAt)) {
        // Use a stable per-object cadence without adding persistent timer state.
        const cadence = 7 - Math.min(2, this.tierPressure());
        if ((this.tickCount + o.id * 17) % Math.round(cadence * ENCOUNTER_HZ) === 0) {
          const kind = o.kind === 'sarcophagus' ? 'zombie'
            : o.kind === 'brood_pool' ? (this.rng() < 0.5 ? 'spitter' : 'mireling')
            : o.kind === 'brazier' ? 'emberling'
            : o.kind === 'prism' ? 'mirror_clone' : 'clockwork_guard';
          this.spawnActor(kind, targets);
        }
      }
    }
  }

  private tierPressure(): number { return this.config.tier + Math.floor(this.peakParticipants / 2); }

  private resolveHazards(): void {
    // Geometry is resolved by adapters against authoritative participant
    // positions.  The pure engine marks execution; adapters call hitByHazard.
  }

  /** True once per participant/hazard and only during its execution window. */
  hitByHazard(hazardId: number, participant: EncounterParticipant): number {
    if (this.status !== 'active' || this.now < this.phaseInvulnerableUntil ||
        !participant.alive || !this.participants.has(participant.id)) return 0;
    const h = this.hazards.find((x) => x.id === hazardId);
    if (!h || this.now < h.executeAt || this.now > h.expiresAt ||
        h.hitParticipants.includes(participant.id)) return 0;
    if (!hazardContains(h, participant.position)) return 0;
    h.hitParticipants.push(participant.id);
    return h.damage;
  }

  attack(intent: VaultAttackIntent, attacker: EncounterParticipant,
    validation: AttackValidation): AttackResult {
    const reject = (reason: NonNullable<AttackResult['reason']>): AttackResult =>
      ({ accepted: false, reason, damage: 0, killed: false });
    if (!intent || typeof intent !== 'object' || !intent.hit ||
        typeof intent.hit !== 'object') return reject('target');
    if (intent.encounterId !== this.config.encounterId) return reject('attempt');
    if (!Number.isSafeInteger(intent.sequence) ||
        intent.sequence <= (this.sequence.get(attacker.id) ?? -1)) return reject('sequence');
    // Consume a well-formed sequence even if later validation fails, preventing
    // retries from probing cadence/range with one sequence number.
    this.sequence.set(attacker.id, intent.sequence);
    if (this.status !== 'active' || this.hp <= 0 || !attacker.alive) return reject('state');
    if (!this.participants.has(attacker.id) || !attacker.inside ||
        !this.inside(attacker.position)) return reject('participant');
    if (validation.heldSource !== intent.source) return reject('weapon');
    if (![validation.now, validation.maxDamage, validation.range,
      validation.cadence, intent.claimedDamage, intent.hit.x, intent.hit.y,
      intent.hit.z].every(Number.isFinite)) {
      return reject('damage');
    }
    const previous = this.lastAttack.get(attacker.id) ?? -Infinity;
    if (validation.now - previous + 1e-6 < validation.cadence) return reject('cadence');
    if (intent.claimedDamage <= 0 || intent.claimedDamage > validation.maxDamage) return reject('damage');
    if (intent.targetId !== 0) {
      const targetActor = this.actors.find((a) => a.id === intent.targetId);
      const targetObject = this.objects.find((o) => o.id === intent.targetId);
      if (!targetActor && !targetObject) return reject('target');
    }
    if (distance(attacker.position, intent.hit) > validation.range) return reject('range');
    const targetPos = intent.targetId === 0 ? this.bossPosition
      : this.actors.find((a) => a.id === intent.targetId)?.position
      ?? this.objects.find((o) => o.id === intent.targetId)?.position;
    if (!targetPos || distance(targetPos, intent.hit) > (intent.targetId === 0 ? 3.2 : 2.1)) {
      return reject('target');
    }
    if (intent.targetId === 0 && this.bossInvulnerable()) return reject('invulnerable');
    this.lastAttack.set(attacker.id, validation.now);
    const dmg = Math.max(1, Math.round(intent.claimedDamage));
    if (intent.targetId === 0) {
      this.damageBoss(dmg);
      return { accepted: true, damage: dmg, killed: this.hp <= 0 };
    }
    const actor = this.actors.find((a) => a.id === intent.targetId);
    if (actor) {
      actor.hp = Math.max(0, actor.hp - dmg);
      if (actor.hp === 0) this.removeActor(actor.id);
      return { accepted: true, damage: dmg, killed: actor.hp === 0 };
    }
    const object = this.objects.find((o) => o.id === intent.targetId)!;
    object.hp = Math.max(0, object.hp - dmg);
    if (object.hp === 0) this.destroyObject(object.id);
    return { accepted: true, damage: dmg, killed: object.hp === 0 };
  }

  private bossInvulnerable(): boolean {
    return this.now < this.phaseInvulnerableUntil;
  }

  private damageBoss(damage: number): void {
    let amount = this.now < this.exposedUntil ? Math.round(damage * 1.35) : damage;
    if (this.definition.kind === 'bone_warden' &&
        this.objects.filter((o) => o.kind === 'sarcophagus' && o.hp > 0).length >= 2) {
      amount = Math.max(1, Math.round(amount * 0.5));
    }
    if (this.definition.kind === 'crystal_seer' &&
        this.objects.some((o) => o.kind === 'prism' && o.hp > 0)) {
      amount = Math.max(1, Math.round(amount * 0.25));
    }
    this.hp = Math.max(0, this.hp - amount);
    // Burst damage can cross both thresholds. Move one phase at a time, emit
    // each exactly once, and let the next fixed step expose the new mechanics.
    if (this.phase === 1 && this.hp <= this.maxHp * 0.7) this.changePhase(2);
    if (this.phase === 2 && this.hp <= this.maxHp * 0.35) this.changePhase(3);
    if (this.hp === 0) this.victory();
  }

  private changePhase(phase: 2 | 3): void {
    this.phase = phase;
    this.phaseObjectsSpawned = false;
    this.comboQueue.length = 0;
    this.nextMoveAt = this.now + 2;
    this.healingActive = false;
    this.cast = null;
    this.pendingMove = null;
    this.hazards.length = 0;
    this.phaseInvulnerableUntil = this.now + ENCOUNTER_PHASE_TRANSITION_SECONDS;
    this.nextAttackAt = this.phaseInvulnerableUntil + 0.2;
    this.emit('phase', this.now, [], `phase_${phase}`);
    const opener = this.definition.phases[phase - 1].filter((a) =>
      !a.object || a.object !== this.definition.criticalObject).slice(0, 2);
    this.comboQueue.splice(0, this.comboQueue.length, ...opener);
    if (opener.length > 1) this.emit('combo', this.now, [...this.participants], 'phase_combo');
    if (phase === 2) {
      for (let i = 0; i < this.definition.criticalCount; i++) {
        this.spawnObject(this.definition.criticalObject, i);
      }
      this.phaseObjectsSpawned = true;
      const summon: Record<VaultBossKind, EncounterActorKind> = {
        bone_warden: 'zombie', mire_queen: 'mireling',
        ember_colossus: 'emberling', crystal_seer: 'mirror_clone',
        gilded_artificer: 'clockwork_guard',
      };
      const targets = [...this.participants];
      const count = Math.min(5 + this.config.tier + Math.ceil((this.peakParticipants - 1) * 1.5),
        MAX_ENCOUNTER_ACTORS);
      this.waveNo++;
      this.emit('wave', this.now, targets, `phase_army_${this.waveNo}`);
      for (let i = 0; i < count; i++) {
        this.spawnActor(i === 0 ? summon[this.config.kind]
          : this.definition.army[i % this.definition.army.length], targets);
      }
    } else if (phase === 3) {
      const targets = [...this.participants];
      const count = Math.min(4 + this.config.tier + this.peakParticipants,
        MAX_ENCOUNTER_ACTORS - this.actors.length);
      if (count > 0) {
        this.waveNo++;
        this.emit('wave', this.now, targets, `final_army_${this.waveNo}`);
      }
      for (let i = 0; i < count; i++) {
        this.spawnActor(this.definition.army[i % this.definition.army.length], targets);
      }
    }
  }

  private removeActor(id: number): void {
    const i = this.actors.findIndex((a) => a.id === id);
    if (i >= 0) this.actors.splice(i, 1);
    this.emit('death', this.now, [], 'summon_down', undefined, id);
  }

  private destroyObject(id: number): void {
    const i = this.objects.findIndex((o) => o.id === id);
    if (i < 0) return;
    const [o] = this.objects.splice(i, 1);
    if (o.critical) {
      if (this.healingActive && !this.objects.some((x) => x.critical && x.hp > 0)) {
        this.healingActive = false;
        this.emit('heal', this.now, [], 'healing_interrupt');
      }
      this.poise = Math.max(0, this.poise - 100 /
        Math.max(1, this.definition.poiseObjects ?? this.definition.criticalCount));
      if (this.poise <= 0) {
        this.exposedUntil = this.now + 5;
        this.poise = this.maxPoise;
        this.emit('poise_break', this.now, [], 'poise_break');
      }
    }
    this.emit('death', this.now, [], `${o.kind}_down`, undefined, id);
  }

  private expireEntities(): void {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      if (this.objects[i].expiresAt <= this.now) this.objects.splice(i, 1);
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      if (this.hazards[i].expiresAt <= this.now) this.hazards.splice(i, 1);
    }
  }

  victory(): void {
    if (this.victoryEmitted) return;
    this.victoryEmitted = true;
    this.status = 'victory';
    this.hp = 0;
    this.actors.length = 0;
    this.objects.length = 0;
    this.hazards.length = 0;
    this.cast = null;
    this.pendingMove = null;
    this.emit('victory', this.now, [...this.participants], 'victory');
  }

  reset(): void {
    this.status = 'idle';
    this.phase = 1;
    this.peakParticipants = 1;
    this.maxHp = bossMaxHp(this.config.tier, this.config.kind, 1);
    this.hp = this.maxHp;
    this.poise = this.maxPoise;
    this.exposedUntil = 0;
    this.phaseInvulnerableUntil = 0;
    this.enrage = false;
    this.enrageEmitted = false;
    this.victoryEmitted = false;
    this.phaseObjectsSpawned = false;
    this.cast = null;
    this.pendingMove = null;
    this.nextMoveAt = 0;
    this.waveNo = 0;
    this.healedTotal = 0;
    this.healingActive = false;
    this.comboQueue.length = 0;
    this.attackNo = 0;
    this.lastAttackName = '';
    this.actors.length = 0;
    this.objects.length = 0;
    this.hazards.length = 0;
    this.participants.clear();
    this.sequence.clear();
    this.lastAttack.clear();
    this.bossPosition = copyVec(this.config.center);
    this.emit('reset', this.now, [], 'reset');
  }

  setCooldown(): void {
    this.status = 'cooldown';
    this.actors.length = 0;
    this.objects.length = 0;
    this.hazards.length = 0;
  }

  snapshot(): EncounterSnapshot {
    return {
      encounterId: this.config.encounterId, tick: this.tickCount, time: this.now,
      status: this.status, family: this.config.family, kind: this.config.kind,
      tier: this.config.tier, phase: this.phase, hp: this.hp, maxHp: this.maxHp,
      hpPercent: this.maxHp > 0 ? this.hp / this.maxHp : 0,
      poise: this.poise, maxPoise: this.maxPoise,
      exposedUntil: Math.max(0, this.exposedUntil - this.now),
      enrage: this.enrage, elapsed: Math.max(0, this.now - this.startedAt),
      cast: this.cast ? { name: this.cast.attack.name, endsAt: this.cast.endsAt } : null,
      boss: { id: 0, position: copyVec(this.bossPosition) },
      actors: this.actors.map((a) => ({ ...a, position: copyVec(a.position) })),
      objects: this.objects.map((o) => ({ ...o, position: copyVec(o.position) })),
      hazards: this.hazards.map((h) => ({ ...h, origin: copyVec(h.origin),
        target: h.target && copyVec(h.target), hitParticipants: [...h.hitParticipants],
        safeLanes: h.safeLanes && [...h.safeLanes] })),
      participants: [...this.participants], peakParticipants: this.peakParticipants,
      criticalObjects: this.objects.filter((o) => o.critical && o.hp > 0).length,
      movement: this.pendingMove ? { kind: this.pendingMove.kind,
        from: copyVec(this.pendingMove.from), to: copyVec(this.pendingMove.to),
        startedAt: this.pendingMove.startedAt, executeAt: this.pendingMove.executeAt } : null,
      healing: { active: this.healingRate() > 0,
        sources: this.objects.filter((o) => o.critical && o.hp > 0).length,
        rate: this.healingRate(), healed: this.healedTotal, cap: this.maxHp * 0.35 },
      wave: { number: this.waveNo, alive: this.actors.length, cap: MAX_ENCOUNTER_ACTORS },
      seal: { sealed: this.status === 'intro' || this.status === 'active' ||
        this.status === 'reset_grace', geometry: this.config.seal ? { ...this.config.seal,
          center: copyVec(this.config.seal.center), inside: copyVec(this.config.seal.inside),
          outside: copyVec(this.config.seal.outside) } : null },
    };
  }

  private inside(p: Vec3): boolean {
    const b = this.config.bounds;
    return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY &&
      p.z >= b.minZ && p.z <= b.maxZ;
  }

  private emit(type: EncounterEvent['type'], executeAt: number, targets: number[],
    audio: string, geometry?: EncounterHazard, sourceId = 0): void {
    this.eventQueue.push({
      id: `${this.config.encounterId}:${++this.eventNo}`, type, executeAt,
      sourceId, targets: [...targets], geometry, theme: this.config.family, audio,
    });
  }

  private drainEvents(): EncounterEvent[] {
    const out = this.eventQueue.slice();
    this.eventQueue.length = 0;
    return out;
  }
}

/** Geometry-only test used identically by server and offline adapters. */
export function hazardContains(h: EncounterHazard, p: Vec3): boolean {
  const dx = p.x - h.origin.x, dz = p.z - h.origin.z;
  const d = Math.hypot(dx, dz);
  if (h.shape === 'circle' || h.shape === 'rain') return d <= h.radius;
  if (h.shape === 'ring') return Math.abs(d - h.radius) <= h.width;
  if (h.shape === 'quadrant') {
    const a = (Math.atan2(dz, dx) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor(a / (Math.PI / 2)) === (h.id & 3);
  }
  const target = h.target ?? { x: h.origin.x + 1, y: h.origin.y, z: h.origin.z };
  const vx = target.x - h.origin.x, vz = target.z - h.origin.z;
  const len = Math.max(1e-6, Math.hypot(vx, vz));
  const along = (dx * vx + dz * vz) / len;
  const side = Math.abs(dx * vz - dz * vx) / len;
  if (h.shape === 'line') return along >= 0 && along <= h.radius && side <= h.width / 2;
  if (h.shape === 'cone') {
    if (d > h.radius || d < 1e-6) return false;
    const dot = (dx * vx + dz * vz) / (d * len);
    return dot >= Math.cos(h.angle / 2);
  }
  return false;
}

/** Point test for the temporary boss-room barrier. `axis` is the corridor
 * direction, so the barrier plane is perpendicular to it. */
export function sealContains(
  seal: EncounterSealGeometry, point: Vec3, padding = 0,
): boolean {
  if (point.y < seal.center.y - padding ||
      point.y > seal.center.y + seal.height + padding) return false;
  const forward = seal.axis === 'x'
    ? Math.abs(point.x - seal.center.x)
    : Math.abs(point.z - seal.center.z);
  const across = seal.axis === 'x'
    ? Math.abs(point.z - seal.center.z)
    : Math.abs(point.x - seal.center.x);
  return forward <= 0.28 + padding && across <= seal.halfWidth + padding;
}

/** Fail-closed network/save sanitizer. Active attempts themselves are never saved. */
export function sanitizeEncounterSnapshot(raw: unknown): EncounterSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<EncounterSnapshot>;
  if (typeof o.encounterId !== 'string' || o.encounterId.length < 1 ||
      o.encounterId.length > 160 || !Number.isSafeInteger(o.tick) ||
      !['idle', 'intro', 'active', 'reset_grace', 'victory', 'cooldown'].includes(o.status ?? '') ||
      !['crypt', 'mire', 'ember', 'crystal', 'gilded'].includes(o.family ?? '') ||
      !Object.prototype.hasOwnProperty.call(BOSS_DEFINITIONS, o.kind ?? '') ||
      (o.tier !== 1 && o.tier !== 2 && o.tier !== 3) ||
      (o.phase !== 1 && o.phase !== 2 && o.phase !== 3)) return null;
  const nums = [o.time, o.hp, o.maxHp, o.poise, o.maxPoise, o.exposedUntil, o.elapsed,
    o.peakParticipants];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (!o.boss || !validVec(o.boss.position) || !Array.isArray(o.actors) ||
      !Array.isArray(o.objects) || !Array.isArray(o.hazards) ||
      !Array.isArray(o.participants) || o.actors.length > MAX_ENCOUNTER_ACTORS ||
      o.objects.length > MAX_ENCOUNTER_OBJECTS || o.hazards.length > MAX_ENCOUNTER_HAZARDS ||
      o.participants.length > MAX_ENCOUNTER_TRACKED_PARTICIPANTS) return null;
  if (o.movement && (!validVec(o.movement.from) || !validVec(o.movement.to) ||
      !Number.isFinite(o.movement.startedAt) || !Number.isFinite(o.movement.executeAt))) return null;
  if (o.seal?.geometry && (!validVec(o.seal.geometry.center) ||
      !validVec(o.seal.geometry.inside) || !validVec(o.seal.geometry.outside) ||
      (o.seal.geometry.axis !== 'x' && o.seal.geometry.axis !== 'z') ||
      !Number.isFinite(o.seal.geometry.halfWidth) || !Number.isFinite(o.seal.geometry.height))) return null;
  if (!o.actors.every((a) => a && validVec(a.position) && Number.isFinite(a.hp) &&
       Number.isFinite(a.maxHp)) ||
      !o.objects.every((x) => x && validVec(x.position) && Number.isFinite(x.hp) &&
        Number.isFinite(x.maxHp)) ||
      !o.hazards.every((h) => h && validVec(h.origin) && Number.isFinite(h.executeAt) &&
        Number.isFinite(h.expiresAt) && Number.isFinite(h.damage))) return null;
  // Return a detached, normalized snapshot so caller mutation cannot poison
  // idempotency or a later interpolation frame.
  return {
    ...(o as EncounterSnapshot),
    hp: Math.max(0, Math.min(o.maxHp!, o.hp!)),
    hpPercent: Math.max(0, Math.min(1, o.maxHp! > 0 ? o.hp! / o.maxHp! : 0)),
    actors: o.actors.slice(0, MAX_ENCOUNTER_ACTORS).map((a) => ({ ...a, position: copyVec(a.position) })),
    objects: o.objects.slice(0, MAX_ENCOUNTER_OBJECTS).map((x) => ({ ...x, position: copyVec(x.position) })),
    hazards: o.hazards.slice(0, MAX_ENCOUNTER_HAZARDS).map((h) => ({
      ...h, origin: copyVec(h.origin), target: h.target && copyVec(h.target),
      hitParticipants: Array.isArray(h.hitParticipants) ? h.hitParticipants.slice(0, 6) : [],
    })),
    participants: o.participants.filter(Number.isSafeInteger)
      .slice(0, MAX_ENCOUNTER_TRACKED_PARTICIPANTS),
    peakParticipants: Math.max(1, Math.min(6, Math.floor(o.peakParticipants!))),
    movement: o.movement ? { ...o.movement, from: copyVec(o.movement.from),
      to: copyVec(o.movement.to) } : null,
    healing: o.healing && Number.isFinite(o.healing.rate) ? {
      active: o.healing.active === true,
      sources: Math.max(0, Math.min(24, Math.floor(o.healing.sources ?? 0))),
      rate: Math.max(0, Math.min(1000, o.healing.rate)),
      healed: Math.max(0, Number.isFinite(o.healing.healed) ? o.healing.healed : 0),
      cap: Math.max(0, Number.isFinite(o.healing.cap) ? o.healing.cap : 0),
    } : { active: false, sources: 0, rate: 0, healed: 0, cap: 0 },
    wave: o.wave && Number.isFinite(o.wave.number) ? {
      number: Math.max(0, Math.floor(o.wave.number)),
      alive: Math.max(0, Math.min(MAX_ENCOUNTER_ACTORS, Math.floor(o.wave.alive ?? 0))),
      cap: MAX_ENCOUNTER_ACTORS,
    } : { number: 0, alive: o.actors.length, cap: MAX_ENCOUNTER_ACTORS },
    seal: { sealed: o.seal?.sealed === true, geometry: o.seal?.geometry ? {
      ...o.seal.geometry, center: copyVec(o.seal.geometry.center),
      inside: copyVec(o.seal.geometry.inside), outside: copyVec(o.seal.geometry.outside),
      halfWidth: Math.max(0.5, Math.min(8, o.seal.geometry.halfWidth)),
      height: Math.max(1, Math.min(12, o.seal.geometry.height)),
    } : null },
  };
}

function validVec(v: unknown): v is Vec3 {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<Vec3>;
  return typeof p.x === 'number' && Number.isFinite(p.x) &&
    typeof p.y === 'number' && Number.isFinite(p.y) &&
    typeof p.z === 'number' && Number.isFinite(p.z) &&
    Math.abs(p.x) <= 1e7 && Math.abs(p.y) <= 1e7 && Math.abs(p.z) <= 1e7;
}
