// Deterministic, transport-agnostic vault encounter simulation.
//
// This module deliberately has no DOM, WebAudio, Three.js, world or socket
// dependencies.  The browser's offline adapter and the authoritative server
// both feed it the same participant inputs at 20 Hz.

import { VAULT_BOSS_HITBOX } from './vaults';
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
export const ENCOUNTER_HURT_SECONDS = 0.5;

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
  /** One plain-language instruction per phase: what to actually do right now. */
  phaseBriefs: readonly [string, string, string];
  moveStyle: readonly BossMoveKind[];
  moveCadence: number;
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
): AttackDefinition => ({ name, shape, telegraph: Math.max(1, telegraph), cooldown, damage, radius,
  recovery: 0.9, ...extra });

export const BOSS_DEFINITIONS: Record<VaultBossKind, BossDefinition> = {
  bone_warden: {
    kind: 'bone_warden', family: 'crypt', name: 'Bone Warden',
    title: 'Keeper of the Restless', hpModifier: 1, color: '#aa72ff',
    introLine: 'The seals crack. Every grave answers.',
    victoryLine: 'The dead fall silent at last.',
    phaseTitles: ['The Sealed Tomb', 'The Graves Open', 'Last Rites'],
    phaseBriefs: [
      'Keep damaging the Warden. Step around chain sweeps, leave grave marks, and cross each clearly marked toll ring.',
      'The funeral procession begins. Find the open lane, thin the optional pallbearers, and keep pressure on the Warden.',
      'Last Rites begins. Read the condemned quarter and execution lane, then finish the Warden itself.',
    ],
    moveStyle: ['socket', 'blink', 'charge', 'target_swap'], moveCadence: 5.2,
    army: ['skeleton', 'zombie', 'bone_knight'],
    phases: [
      [
        attack('Chain Reap', 'cone', 1.1, 3.4, 6, 6, { angle: Math.PI * 0.62 }),
        attack('Funeral Toll', 'ring', 1.25, 4.8, 6, 6.5, { width: 1 }),
        attack('Grave Mark', 'rain', 1.15, 4.2, 6, 1.7, { count: 4 }),
        attack('Processional Rush', 'line', 1.15, 4.9, 7, 12, { width: 2 }),
        attack('Bellfall', 'circle', 1.2, 4.3, 6, 3.2),
      ],
      [
        attack('Three-Lane Procession', 'line', 1.25, 5.2, 8, 14,
          { width: 1.8, count: 3 }),
        attack('Double Toll', 'ring', 1.2, 4.8, 7, 8, { width: 0.9, count: 2 }),
        attack('Call the Pallbearers', 'rain', 1.25, 8, 6, 1.8,
          { summons: 'skeleton', count: 2 }),
        attack('Chain Reap', 'cone', 1.05, 3.4, 7, 6, { angle: Math.PI * 0.68 }),
        attack('Falling Ossuary', 'rain', 1.15, 4.7, 8, 1.9, { count: 5 }),
      ],
      [
        attack('Last Rites', 'quadrant', 1.35, 5.2, 10, 11),
        attack('Execution Charge', 'line', 1.2, 5.4, 10, 12, { width: 2.4 }),
        attack('Final Toll', 'ring', 1.3, 5.6, 9, 8.5, { width: 1, count: 3 }),
        attack('Chain Cross', 'line', 1.15, 5, 9, 14, { width: 1.7, count: 2 }),
        attack('Mass Grave Mark', 'rain', 1.1, 4.6, 8, 1.8, { count: 6 }),
      ],
    ],
  },
  mire_queen: {
    kind: 'mire_queen', family: 'mire', name: 'Mire Queen',
    title: 'Mother Beneath the Reeds', hpModifier: 1, color: '#42e2bd',
    introLine: 'Something ancient stirs below the black water.',
    victoryLine: 'The brood sinks back into the mire.',
    phaseTitles: ['Venom Crown', 'The Brood Awakens', 'Drowning Court'],
    phaseBriefs: [
      'Keep damaging the Queen. Leave each sinkhole, cross the tail wake, and move around the venom bloom.',
      'The tide is rising. Use the open side of each sweep while the optional brood pressures the room.',
      'Follow the rotating clear quarter, cross each spiral ring, and punish the Queen after her serpent charge.',
    ],
    moveStyle: ['burrow', 'target_swap', 'retreat', 'pursue'], moveCadence: 4.4,
    army: ['mireling', 'spitter', 'skitter', 'bog_brute'],
    phases: [
      [
        attack('Venom Bloom', 'cone', 1.1, 3.2, 5, 9, { angle: Math.PI * 0.62 }),
        attack('Locking Sinkhole', 'circle', 1.15, 4.1, 6, 2.7),
        attack('Tail Wake', 'line', 1.15, 4.3, 6, 12, { width: 1.7, count: 2 }),
        attack('Festering Rain', 'rain', 1.15, 4, 5, 1.7, { count: 4 }),
        attack('Crown Snap', 'cone', 1.05, 3.8, 7, 6, { angle: Math.PI * 0.48 }),
      ],
      [
        attack('High Tide', 'line', 1.35, 5.4, 8, 14, { width: 4 }),
        attack('Brood Drift', 'rain', 1.3, 8, 6, 1.8,
          { summons: 'mireling', count: 2 }),
        attack('Lotus Rings', 'ring', 1.2, 5, 8, 8, { width: 0.9, count: 3 }),
        attack('Undertow', 'circle', 1.2, 4.5, 7, 4),
        attack('Venom Bloom', 'cone', 1.05, 3.2, 7, 9, { angle: Math.PI * 0.68 }),
      ],
      [
        attack('Rotating Lotus', 'quadrant', 1.35, 5.7, 9, 11),
        attack('Drowning Spiral', 'ring', 1.2, 4.9, 9, 8.5, { width: 0.9, count: 3 }),
        attack('Serpent Charge', 'line', 1.2, 5.2, 9, 13, { width: 2.8 }),
        attack('Poison Monsoon', 'rain', 1.1, 4.1, 8, 1.7, { count: 6 }),
        attack("Queen's Maw", 'cone', 1.1, 4, 9, 8, { angle: Math.PI * 0.7 }),
      ],
    ],
  },
  ember_colossus: {
    kind: 'ember_colossus', family: 'ember', name: 'Ember Colossus',
    title: 'The Furnace Unbound', hpModifier: 1, color: '#ff6b32',
    introLine: 'The forge has found a heartbeat.',
    victoryLine: 'The furnace gutters into ash.',
    phaseTitles: ['Cold Iron', 'Furnace Heart', 'Worldfire'],
    phaseBriefs: [
      'Keep damaging the Colossus. Leave crater stomps, sidestep molten trails, and circle around the furnace roar.',
      'The caldera opens. Read the vent sequence, keep moving through meteors, and ignore or thin the ember herd.',
      'Worldfire begins. Alternate between the clear center and clear edge, then end the walking volcano.',
    ],
    moveStyle: ['leap', 'charge', 'center', 'pursue'], moveCadence: 5.6,
    army: ['emberling', 'emberling', 'magma_brute'],
    phases: [
      [
        attack('Crater Stomp', 'circle', 1.25, 4.3, 8, 3.8),
        attack('Molten Trail', 'line', 1.2, 4.7, 7, 13, { width: 1.7 }),
        attack('Furnace Roar', 'cone', 1.25, 5.2, 9, 7, { angle: Math.PI * 0.55 }),
        attack('Cinderfall', 'rain', 1.15, 4.2, 6, 1.7, { count: 5 }),
        attack('Tail Quake', 'ring', 1.2, 4.8, 8, 6.5, { width: 1.1 }),
      ],
      [
        attack('Vent Cycle', 'line', 1.3, 5.4, 9, 14, { width: 1.8, count: 3 }),
        attack('Meteor Cycle', 'rain', 1.2, 4.3, 8, 1.9, { count: 5 }),
        attack('Ember Herd', 'circle', 1.3, 8.2, 6, 3,
          { summons: 'emberling', count: 2 }),
        attack('Caldera Pulse', 'ring', 1.25, 5.1, 9, 8, { width: 1, count: 2 }),
        attack('Basalt Charge', 'line', 1.25, 5.2, 9, 13, { width: 2.5 }),
      ],
      [
        attack('Worldfire Rim', 'ring', 1.4, 5.5, 10, 7.5, { width: 2.1 }),
        attack('Crucible Cross', 'line', 1.3, 5.4, 10, 14, { width: 1.8, count: 2 }),
        attack('Caldera Eruption', 'rain', 1.2, 4.4, 9, 1.8, { count: 6 }),
        attack('Ashen Charge', 'line', 1.2, 4.8, 9, 13, { width: 2.2 }),
        attack('Worldfire Core', 'circle', 1.45, 6.4, 11, 5.2),
      ],
    ],
  },
  crystal_seer: {
    kind: 'crystal_seer', family: 'crystal', name: 'Crystal Seer',
    title: 'Eye Beyond the Prism', hpModifier: 1, color: '#65b9ff',
    introLine: 'It has already seen how you die.',
    victoryLine: 'A thousand doomed futures shatter.',
    phaseTitles: ['Foreseen', 'Hall of Mirrors', 'Final Prophecy'],
    phaseBriefs: [
      'The Seer previews every strike. Leave the predicted beam, evade the wing prism, and move before each marked future.',
      'Delayed echoes repeat the first attack. Remember the old lane while reading the new one; no clone needs to be shot.',
      'The final prophecy is a sequence. Follow the previewed clear space through crossed beams and falling shards.',
    ],
    moveStyle: ['blink', 'target_swap', 'socket', 'retreat'], moveCadence: 3.9,
    army: ['mirror_clone', 'shardling', 'mirror_clone'],
    phases: [
      [
        attack('Predicted Beam', 'line', 1.4, 4.1, 7, 14, { width: 1.4 }),
        attack('Prism Wing', 'cone', 1.2, 3.8, 6, 10, { angle: Math.PI * 0.72 }),
        attack('Foreseen Mark', 'rain', 1.25, 4.2, 6, 1.6, { count: 5 }),
        attack('Lens Arrival', 'circle', 1.2, 4.6, 6, 3),
        attack('Split Future', 'line', 1.3, 4.8, 7, 14, { width: 1.2, count: 3 }),
      ],
      [
        attack('Delayed Echo', 'line', 1.4, 4.8, 7, 14, { width: 1.3, count: 2 }),
        attack('Rotating Refraction', 'line', 1.35, 5, 8, 14, { width: 1.2 }),
        attack('Shattered Timeline', 'rain', 1.2, 4.3, 7, 1.7, { count: 6 }),
        attack('Paradox Rings', 'ring', 1.3, 5.1, 8, 8, { width: 0.9, count: 3 }),
        attack('Many-Eyed Gaze', 'cone', 1.2, 4.1, 8, 10, { angle: Math.PI * 0.9 }),
      ],
      [
        attack('Crossed Prophecy', 'line', 1.45, 5.2, 9, 14,
          { width: 1.5, count: 2 }),
        attack('Falling Futures', 'rain', 1.2, 4.1, 8, 1.7, { count: 6 }),
        attack('Final Arrival', 'circle', 1.2, 4.4, 8, 3.2),
        attack('End of One Path', 'quadrant', 1.45, 5.5, 10, 11),
        attack('Prophecy Sequence', 'line', 1.3, 5, 9, 14, { width: 1.3, count: 4 }),
      ],
    ],
  },
  gilded_artificer: {
    kind: 'gilded_artificer', family: 'gilded', name: 'Gilded Artificer',
    title: 'Architect of Avarice', hpModifier: 1, color: '#f1bd42',
    introLine: 'The vault itself takes up arms.',
    victoryLine: 'The golden engine grinds to a halt.',
    phaseTitles: ['Calculated Defense', 'War Machine', 'Total Lockdown'],
    phaseBriefs: [
      'Keep damaging the Artificer. Timed mine cells expire on their own; leave them and sidestep each previewed dash.',
      'The mechanism accelerates. Use the open suppression lanes while optional guards and rotating tools add pressure.',
      'Total lockdown begins. Follow the crusher gap and previewed golden grid; the machine is still the only objective.',
    ],
    moveStyle: ['strafe', 'charge', 'socket', 'target_swap'], moveCadence: 4.3,
    army: ['clockwork_guard', 'clockwork_drone', 'clockwork_guard'],
    phases: [
      [
        attack('Timed Mine Cells', 'rain', 1.25, 4.5, 7, 1.6, { count: 4 }),
        attack('Preview Dash', 'line', 1.2, 4.7, 7, 11, { width: 2 }),
        attack('Clock Hand', 'cone', 1.15, 3.8, 6, 9, { angle: Math.PI * 0.58 }),
        attack('Coinshot Lanes', 'line', 1.15, 4.1, 6, 14, { width: 1.1, count: 3 }),
        attack('Audit Wheel', 'ring', 1.2, 4.7, 7, 7, { width: 1 }),
      ],
      [
        attack('Guard Deployment', 'circle', 1.3, 8.2, 6, 3,
          { summons: 'clockwork_guard', count: 2 }),
        attack('Suppression Lanes', 'line', 1.25, 4.9, 8, 14, { width: 1.3, count: 3 }),
        attack('Clockwork Wheel', 'ring', 1.25, 5.1, 8, 8, { width: 0.9, count: 3 }),
        attack('Conveyor Sweep', 'line', 1.3, 5.2, 7, 13, { width: 3 }),
        attack('Tool Blitz', 'cone', 1.15, 4.2, 8, 9, { angle: Math.PI * 0.72 }),
      ],
      [
        attack('Crusher Gap', 'line', 1.45, 5.6, 9, 14, { width: 3.4, count: 2 }),
        attack('Coin Storm', 'rain', 1.2, 4.1, 7, 1.7, { count: 6 }),
        attack('Overclock Wheel', 'ring', 1.35, 5.8, 10, 8, { width: 1.2 }),
        attack('Golden Grid', 'line', 1.3, 5.1, 9, 14, { width: 1.5, count: 4 }),
        attack('Final Calculation', 'quadrant', 1.5, 5.8, 11, 11),
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
  return 1 + 0.7 * (n - 1);
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

export function bossHitContains(kind: VaultBossKind, boss: Vec3, hit: Vec3): boolean {
  const bounds = VAULT_BOSS_HITBOX[kind];
  const dx = hit.x - boss.x, dz = hit.z - boss.z;
  return Math.hypot(dx, dz) <= bounds.halfWidth + 0.2 &&
    hit.y >= boss.y - 0.25 && hit.y <= boss.y + bounds.height + 0.25;
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
  private readonly lastHazardHit = new Map<number, number>();
  private readonly eventQueue: EncounterEvent[] = [];
  private eventNo = 0;
  private entityNo = 1;
  private nextAttackAt = 0;
  private pendingMove: (BossMovementState & { position: Vec3; at: number }) | null = null;
  private nextMoveAt = 0;
  private waveNo = 0;
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
    const choices = attacks;
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

  private spawnPattern(a: AttackDefinition, target: Vec3, targetIds: number[]): void {
    const count = Math.max(1, a.count ?? 1);
    const executeAt = this.now + Math.max(MIN_MAJOR_TELEGRAPH, a.telegraph);
    const hazardCount = a.shape === 'cone' || a.shape === 'quadrant' ? 1 : count;
    const aim = Math.atan2(target.z - this.bossPosition.z, target.x - this.bossPosition.x);
    for (let i = 0; i < hazardCount && this.hazards.length < MAX_ENCOUNTER_HAZARDS; i++) {
      const angle = count === 1 ? 0 : i * Math.PI * 2 / count;
      const spread = a.shape === 'rain' ? 2 + this.rng() * 6
        : a.shape === 'circle' && count > 1 ? 3 : 0;
      const origin = a.shape === 'rain' || (a.shape === 'circle' && count > 1)
        ? { x: target.x + Math.cos(angle) * spread, y: this.config.center.y,
          z: target.z + Math.sin(angle) * spread }
        : copyVec(this.bossPosition);
      const lineSpread = (i - (hazardCount - 1) / 2) * Math.PI / 8;
      const hazardTarget = a.shape === 'line' && hazardCount > 1
        ? { x: origin.x + Math.cos(aim + lineSpread) * a.radius, y: target.y,
          z: origin.z + Math.sin(aim + lineSpread) * a.radius }
        : copyVec(target);
      const ringScale = a.shape === 'ring' && hazardCount > 1
        ? 0.55 + 0.45 * (i + 1) / hazardCount : 1;
      const stagger = a.shape === 'ring' && hazardCount > 1 ? i * 0.22 : 0;
      const h: EncounterHazard = {
        id: this.entityNo++, shape: a.shape, origin, target: hazardTarget,
        radius: a.radius * ringScale, width: a.width ?? 1.5, angle: a.angle ?? Math.PI * 2,
        telegraphAt: this.now, executeAt: executeAt + stagger,
        expiresAt: executeAt + stagger + 0.35,
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
    }
    if (a.summons) {
      const pressure = Math.ceil((this.peakParticipants - 1) / 2);
      const actorBudget = Math.min(10, 4 + Math.ceil((this.peakParticipants - 1) * 1.2));
      const total = Math.max(0, Math.min(actorBudget - this.actors.length, count + pressure));
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
    const o: EncounterObject = {
      id: this.entityNo++, kind, position: copyVec(p), hp, maxHp: hp, socket,
      expiresAt: this.now + 18, critical: false,
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
  }

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
    const lastHit = this.lastHazardHit.get(participant.id) ?? -Infinity;
    if (this.now - lastHit + 1e-6 < ENCOUNTER_HURT_SECONDS) return 0;
    h.hitParticipants.push(participant.id);
    this.lastHazardHit.set(participant.id, this.now);
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
      if (!targetActor) return reject('target');
    }
    if (distance(attacker.position, intent.hit) > validation.range) return reject('range');
    const targetPos = intent.targetId === 0 ? this.bossPosition
      : this.actors.find((a) => a.id === intent.targetId)?.position
      ;
    if (!targetPos || (intent.targetId === 0
      ? !bossHitContains(this.config.kind, targetPos, intent.hit)
      : distance(targetPos, intent.hit) > 2.1)) {
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
    return reject('target');
  }

  private bossInvulnerable(): boolean {
    return this.now < this.phaseInvulnerableUntil;
  }

  private damageBoss(damage: number): void {
    const floor = this.phase === 1 ? this.maxHp * 0.7 : this.phase === 2 ? this.maxHp * 0.35 : 0;
    this.hp = Math.max(floor, this.hp - damage);
    if (this.phase === 1 && this.hp <= floor) this.changePhase(2);
    else if (this.phase === 2 && this.hp <= floor) this.changePhase(3);
    if (this.hp === 0) this.victory();
  }

  private changePhase(phase: 2 | 3): void {
    this.phase = phase;
    this.comboQueue.length = 0;
    this.nextMoveAt = this.now + 2;
    this.cast = null;
    this.pendingMove = null;
    this.hazards.length = 0;
    this.phaseInvulnerableUntil = this.now + ENCOUNTER_PHASE_TRANSITION_SECONDS;
    this.nextAttackAt = this.phaseInvulnerableUntil + 0.2;
    this.emit('phase', this.now, [], `phase_${phase}`);
    const opener = this.definition.phases[phase - 1].slice(0, 3);
    this.comboQueue.splice(0, this.comboQueue.length, ...opener);
    if (opener.length > 1) this.emit('combo', this.now, [...this.participants], 'phase_combo');
  }

  private removeActor(id: number): void {
    const i = this.actors.findIndex((a) => a.id === id);
    if (i >= 0) this.actors.splice(i, 1);
    this.emit('death', this.now, [], 'summon_down', undefined, id);
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
    this.cast = null;
    this.pendingMove = null;
    this.nextMoveAt = 0;
    this.waveNo = 0;
    this.comboQueue.length = 0;
    this.attackNo = 0;
    this.lastAttackName = '';
    this.actors.length = 0;
    this.objects.length = 0;
    this.hazards.length = 0;
    this.participants.clear();
    this.sequence.clear();
    this.lastAttack.clear();
    this.lastHazardHit.clear();
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
      criticalObjects: 0,
      movement: this.pendingMove ? { kind: this.pendingMove.kind,
        from: copyVec(this.pendingMove.from), to: copyVec(this.pendingMove.to),
        startedAt: this.pendingMove.startedAt, executeAt: this.pendingMove.executeAt } : null,
      healing: { active: false, sources: 0, rate: 0, healed: 0, cap: 0 },
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
    if (d > h.radius) return false;
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
