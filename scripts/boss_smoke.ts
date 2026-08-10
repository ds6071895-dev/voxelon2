import {
  BOSS_DEFINITIONS, ENCOUNTER_HURT_SECONDS, ENCOUNTER_INTRO_SECONDS,
  ENCOUNTER_PHASE_TRANSITION_SECONDS,
  ENCOUNTER_RESET_GRACE_SECONDS, MAX_ENCOUNTER_ACTORS, MAX_ENCOUNTER_HAZARDS,
  MAX_ENCOUNTER_OBJECTS, VaultEncounter, bossHitContains, hazardContains,
  participantHpMultiplier, sanitizeEncounterSnapshot, sealContains,
  type EncounterParticipant, type EncounterConfig,
} from '../src/vault_encounter';
import { bossMaxHp, encounterBaseHp } from '../src/vault_encounter';
import { VAULT_BOSS_HITBOX, type VaultBossKind, type VaultTier } from '../src/vaults';
import { Item, ITEMS, gunVolley } from '../src/items';
import { encounterCoach, hazardAdvice } from '../src/vault_presentation';

const kinds = Object.keys(BOSS_DEFINITIONS) as VaultBossKind[];
const failures: string[] = [];
const check = (condition: boolean, message: string): void => {
  if (condition) console.log(`PASS  ${message}`);
  else { console.error(`FAIL  ${message}`); failures.push(message); }
};

for (const [index, kind] of kinds.entries()) {
  const def = BOSS_DEFINITIONS[kind];
  const center = { x: 0, y: 10, z: 0 };
  const participant: EncounterParticipant = {
    id: 1, position: { ...center }, alive: true, inside: true,
  };
  const encounter = new VaultEncounter({
    encounterId: `boss-smoke:${kind}`,
    seed: 1000 + index,
    tier: 2,
    kind,
    family: def.family,
    center,
    bounds: { minX: -20, minY: 5, minZ: -20, maxX: 20, maxY: 20, maxZ: 20 },
    sockets: [
      { x: -7, y: 10, z: -7 }, { x: 7, y: 10, z: -7 },
      { x: 7, y: 10, z: 7 }, { x: -7, y: 10, z: 7 },
    ],
    cameraAnchors: [{ x: 0, y: 14, z: 12 }],
    seal: { center: { x: -10, y: 10, z: 0 }, axis: 'x', halfWidth: 1.6, height: 4,
      inside: { x: -8, y: 10, z: 0 }, outside: { x: -12, y: 10, z: 0 } },
    startTime: 0,
  });
  encounter.start(1, 0);
  for (let i = 0; i < Math.ceil((ENCOUNTER_INTRO_SECONDS + 0.5) / 0.25); i++) {
    encounter.tick(0.25, [participant]);
  }
  check(encounter.status === 'active', `${def.name}: cinematic intro enters combat`);
  check(encounter.snapshot().seal.sealed, `${def.name}: boss room seals during combat`);
  let moveEvent = false;
  for (let i = 0; i < 32; i++) {
    const events = encounter.tick(0.25, [participant]);
    if (events.some((event) => event.type === 'move')) moveEvent = true;
  }
  check(moveEvent, `${def.name}: locomotion director schedules a relocation`);
  check(def.phaseTitles.length === 3 && !!def.introLine && !!def.victoryLine,
    `${def.name}: dramatic copy covers intro, three phases and victory`);
  check(def.phases.every((phase) => phase.length >= 5),
    `${def.name}: every phase has at least five distinct abilities`);

  const phaseHit = encounter.attack({
    encounterId: encounter.config.encounterId,
    sequence: 1,
    targetId: 0,
    source: 'melee',
    hit: { ...encounter.bossPosition },
    claimedDamage: Math.ceil(encounter.maxHp * 0.31),
  }, participant, {
    heldSource: 'melee', maxDamage: encounter.maxHp, range: 30,
    cadence: 0, now: encounter.now,
  });
  check(phaseHit.accepted && encounter.phase === 2,
    `${def.name}: phase two triggers at 70% health`);
  check(encounter.actors.length === 0,
    `${def.name}: phase two starts without a mandatory army`);
  check(encounter.actors.length <= MAX_ENCOUNTER_ACTORS &&
    encounter.objects.length <= MAX_ENCOUNTER_OBJECTS &&
    encounter.hazards.length <= MAX_ENCOUNTER_HAZARDS,
    `${def.name}: encounter entities stay inside hard performance caps`);
  const hpBeforeHeal = encounter.hp;
  for (let i = 0; i < Math.ceil((ENCOUNTER_PHASE_TRANSITION_SECONDS + 0.75) / 0.25); i++) {
    encounter.tick(0.25, [participant]);
  }
  check(encounter.hp === hpBeforeHeal && !encounter.snapshot().healing.active,
    `${def.name}: phase two never heals or gates damage behind an objective`);
  check(encounter.objects.every((object) => !object.critical) &&
    encounter.snapshot().criticalObjects === 0,
    `${def.name}: phase two creates no mandatory breakable objects`);

  let sequence = 1;
  const phaseThreeHit = encounter.attack({
    encounterId: encounter.config.encounterId,
    sequence: ++sequence,
    targetId: 0,
    source: 'melee',
    hit: { ...encounter.bossPosition },
    claimedDamage: encounter.maxHp,
  }, participant, {
    heldSource: 'melee', maxDamage: encounter.maxHp, range: 30,
    cadence: 0, now: encounter.now,
  });
  check(phaseThreeHit.accepted && encounter.phase === 3 &&
    Math.abs(encounter.hp - encounter.maxHp * 0.35) < 0.01,
    `${def.name}: direct boss damage advances phase and cannot skip its final form`);
  for (let i = 0; i < Math.ceil((ENCOUNTER_PHASE_TRANSITION_SECONDS + 0.25) / 0.25); i++) {
    encounter.tick(0.25, [participant]);
  }
  const kill = encounter.attack({
    encounterId: encounter.config.encounterId,
    sequence: ++sequence,
    targetId: 0,
    source: 'melee',
    hit: { ...encounter.bossPosition },
    claimedDamage: encounter.maxHp,
  }, participant, {
    heldSource: 'melee', maxDamage: encounter.maxHp, range: 30,
    cadence: 0, now: encounter.now,
  });
  check(kill.accepted && kill.killed && encounter.status === 'victory',
    `${def.name}: defeat reaches a stable victory state`);
  for (let i = 0; i < 80; i++) encounter.tick(0.25, [participant]);
  check(encounter.status === 'victory' && encounter.hp === 0,
    `${def.name}: defeated boss cannot respawn itself`);
  check(!encounter.snapshot().seal.sealed, `${def.name}: victory opens the boss room`);
}

for (const kind of kinds) {
  const def = BOSS_DEFINITIONS[kind];
  const bounds = VAULT_BOSS_HITBOX[kind];
  check(bossHitContains(kind, { x: 0, y: 0, z: 0 },
    { x: 0, y: bounds.height - 0.1, z: 0 }) &&
    !bossHitContains(kind, { x: 0, y: 0, z: 0 },
      { x: bounds.halfWidth + 1, y: 1, z: 0 }),
  `${def.name}: shared hit profile covers the full body without infinite reach`);
  check(def.phases.every((phase) => phase.every((ability) =>
    ability.telegraph >= 1 && ability.radius <= 14 && ability.object === undefined)),
  `${def.name}: every attack has a readable warning, arena-bounded reach and no breakable objective`);
}
for (const tier of [1, 2, 3] as VaultTier[]) {
  check(new Set(kinds.map((kind) => bossMaxHp(tier, kind))).size === 1,
    `Tier ${tier}: all bosses start from one fair HP budget`);
}
check(participantHpMultiplier(1) === 1 && participantHpMultiplier(6) === 4.5,
  'participant scaling keeps groups faster without trivializing six-player bosses');

{
  const center = { x: 0, y: 10, z: 0 };
  const participant: EncounterParticipant = { id: 1, position: center, alive: true, inside: true };
  const overlap = new VaultEncounter({
    encounterId: 'hazard-iframe', seed: 77, tier: 2, kind: 'bone_warden', family: 'crypt',
    center, bounds: { minX: -8, minY: 5, minZ: -8, maxX: 8, maxY: 20, maxZ: 8 },
    sockets: [], cameraAnchors: [], startTime: 0,
  });
  overlap.start(1, 0);
  for (let i = 0; i < Math.ceil((ENCOUNTER_INTRO_SECONDS + 0.1) / 0.1); i++) {
    overlap.tick(0.1, [participant]);
  }
  overlap.hazards.length = 0;
  const hazard = { id: 900, shape: 'circle' as const, origin: center, radius: 4,
    width: 1, angle: Math.PI * 2, telegraphAt: overlap.now - 1,
    executeAt: overlap.now, expiresAt: overlap.now + 1, damage: 8,
    attack: 'overlap', hitParticipants: [] as number[] };
  overlap.hazards.push(hazard, { ...hazard, id: 901, hitParticipants: [] });
  const first = overlap.hitByHazard(900, participant);
  const second = overlap.hitByHazard(901, participant);
  check(first === 8 && second === 0 && ENCOUNTER_HURT_SECONDS === 0.5,
    'overlapping online hazards share the same half-second hurt protection as offline play');
  const ring = { ...hazard, shape: 'ring' as const, radius: 5, width: 1 };
  const quadrant = { ...hazard, shape: 'quadrant' as const, radius: 5 };
  check(hazardContains(ring, { x: 5, y: 10, z: 0 }) &&
    !hazardContains(ring, center) &&
    !hazardContains(quadrant, { x: 7, y: 10, z: 0 }),
  'ring width and quadrant radius are authoritative collision geometry');
}


const deterministicConfig: EncounterConfig = {
  encounterId: 'deterministic-replay', seed: 424242, tier: 3,
  kind: 'crystal_seer', family: 'crystal', center: { x: 0, y: 10, z: 0 },
  bounds: { minX: -20, minY: 5, minZ: -20, maxX: 20, maxY: 20, maxZ: 20 },
  sockets: [{ x: -7, y: 10, z: -7 }, { x: 7, y: 10, z: -7 },
    { x: 7, y: 10, z: 7 }, { x: -7, y: 10, z: 7 }],
  cameraAnchors: [{ x: 0, y: 14, z: 12 }],
  seal: { center: { x: -10, y: 10, z: 0 }, axis: 'x', halfWidth: 1.6, height: 4,
    inside: { x: -8, y: 10, z: 0 }, outside: { x: -12, y: 10, z: 0 } },
  startTime: 0,
};
const replayParticipant: EncounterParticipant = {
  id: 7, position: { x: 2, y: 10, z: 3 }, alive: true, inside: true,
};
const replayA = new VaultEncounter(deterministicConfig);
const replayB = new VaultEncounter(deterministicConfig);
replayA.start(7, 0); replayB.start(7, 0);
let replayEventsA: unknown[] = [], replayEventsB: unknown[] = [];
for (let i = 0; i < 120; i++) {
  replayEventsA = replayEventsA.concat(replayA.tick(0.25, [replayParticipant]));
  replayEventsB = replayEventsB.concat(replayB.tick(0.25, [replayParticipant]));
}
check(JSON.stringify(replayA.snapshot()) === JSON.stringify(replayB.snapshot()) &&
  JSON.stringify(replayEventsA) === JSON.stringify(replayEventsB),
  'same seed and participant inputs produce identical movement, attacks and events');
check(replayEventsA.some((event) => (event as { type?: string }).type === 'combo'),
  'combo director schedules sequential signature chains without repeating one cast');
const cleanSnapshot = replayA.snapshot();
check(sanitizeEncounterSnapshot(cleanSnapshot) !== null,
  'expanded movement/healing/wave/seal snapshot survives network sanitization');
check(sanitizeEncounterSnapshot({ ...cleanSnapshot,
  seal: { sealed: true, geometry: { ...cleanSnapshot.seal.geometry!, axis: 'bad' } } }) === null &&
  sanitizeEncounterSnapshot({ ...cleanSnapshot, movement: { ...cleanSnapshot.movement!,
    executeAt: Number.NaN } }) === null,
  'snapshot sanitizer rejects malformed seal and movement state');
check(sealContains(deterministicConfig.seal!, { x: -10, y: 12, z: 0 }) &&
  !sealContains(deterministicConfig.seal!, { x: -8, y: 12, z: 0 }),
  'temporary seal collision is exact to the boss-room doorway plane');

const stressConfig: EncounterConfig = { ...deterministicConfig,
  encounterId: 'maximum-load-stress', kind: 'gilded_artificer', family: 'gilded' };
const stress = new VaultEncounter(stressConfig);
const stressParticipants: EncounterParticipant[] = Array.from({ length: 6 }, (_, id) => ({
  id, position: { x: (id % 3 - 1) * 3, y: 10, z: (Math.floor(id / 3) * 2 - 1) * 3 },
  alive: true, inside: true,
}));
stress.start(0, 0);
for (let id = 1; id < stressParticipants.length; id++) stress.join(id);
for (let i = 0; i < Math.ceil((ENCOUNTER_INTRO_SECONDS + 0.5) / 0.25); i++) {
  stress.tick(0.25, stressParticipants);
}
stress.attack({ encounterId: stress.config.encounterId, sequence: 1, targetId: 0,
  source: 'melee', hit: { ...stress.bossPosition },
  claimedDamage: Math.ceil(stress.maxHp * 0.31) }, stressParticipants[0], {
  heldSource: 'melee', maxDamage: stress.maxHp, range: 30, cadence: 0, now: stress.now,
});
let stressSafe = true;
for (let i = 0; i < 480; i++) {
  stress.tick(0.25, stressParticipants);
  const snap = stress.snapshot();
  stressSafe = stressSafe && snap.actors.length <= MAX_ENCOUNTER_ACTORS &&
    snap.objects.length <= MAX_ENCOUNTER_OBJECTS &&
    snap.hazards.length <= MAX_ENCOUNTER_HAZARDS &&
    JSON.stringify(snap).length < 50000 && Number.isFinite(snap.hp);
}
stress.join(99);
const lateSnapshot = stress.snapshot();
check(stressSafe, 'six-player maximum-load simulation stays capped and snapshot-bounded');
check(lateSnapshot.participants.includes(99) && lateSnapshot.seal.sealed &&
  lateSnapshot.wave.number > 0 && lateSnapshot.healing.sources === 0 &&
  lateSnapshot.criticalObjects === 0,
  'late join snapshot carries the live seal and wave without mandatory objectives');

const resetEncounter = new VaultEncounter({ ...deterministicConfig,
  encounterId: 'reset-seal-test' });
resetEncounter.start(7, 0);
for (let i = 0; i < Math.ceil((ENCOUNTER_INTRO_SECONDS + 0.5) / 0.25); i++) {
  resetEncounter.tick(0.25, [replayParticipant]);
}
for (let i = 0; i < Math.ceil((ENCOUNTER_RESET_GRACE_SECONDS + 0.5) / 0.25); i++) {
  resetEncounter.tick(0.25, []);
}
check(resetEncounter.status === 'idle' && !resetEncounter.snapshot().seal.sealed,
  'empty arena resets cleanly and fails open after the grace period');

// --- Every weapon must be able to finish every tier -----------------------------
// A "shot" is not always one projectile. Validating one hit per gun cooldown
// silently threw away 6 of a shotgun's 7 pellets, so it did a seventh of its
// intended damage to a boss. These checks pin the volley budget and then prove
// each gun can actually clear each tier inside the enrage timer.
{
  const shotgun = ITEMS[Item.Shotgun].gun!;
  const burst = ITEMS[Item.BurstRifle].gun!;
  const rifle = ITEMS[Item.Rifle].gun!;
  check(gunVolley(shotgun).shots === 7 && gunVolley(burst).shots === 3 &&
    gunVolley(rifle).shots === 1,
    'a volley counts every pellet and every burst round as its own hit');
  check(Math.abs(gunVolley(shotgun).cadence * 7 - shotgun.cooldown) < 1e-9 &&
    Math.abs(gunVolley(burst).cadence * 3 - burst.cooldown) < 1e-9,
    'the gun cooldown is budgeted across the volley, never multiplied by it');
  check(gunVolley(shotgun).perHit === shotgun.damage &&
    gunVolley(burst).perHit === burst.damage,
    'each accepted hit is still capped at ONE projectile of damage');

  // Sustained damage per second must be unchanged by the fix — the ceiling is
  // the same, it is just no longer thrown away.
  const dps = (id: number): number => {
    const g = ITEMS[id].gun!;
    const v = gunVolley(g);
    return v.perHit / v.cadence;
  };
  check(Math.abs(dps(Item.Shotgun) - shotgun.damage * 7 / shotgun.cooldown) < 1e-9,
    'shotgun sustained damage matches its full pellet spread');

  // Clearing budget: every tier, every boss, with each primary weapon. Assumes
  // substantial downtime for movement, reloading, summons and transitions.
  const UPTIME = 0.55, ENRAGE = 360;
  const primaries = [Item.Pistol, Item.Rifle, Item.Shotgun, Item.SMG,
    Item.Sniper, Item.BurstRifle, Item.RocketLauncher];
  let hardest = 0, hardestLabel = '';
  let allClearable = true, anyTrivial = false;
  for (const tier of [1, 2, 3] as VaultTier[]) {
    for (const kind of kinds) {
      const hp = bossMaxHp(tier, kind);
      // Best weapon must comfortably clear; worst must still be viable.
      const times = primaries.map((id) => hp / (dps(id) * UPTIME));
      const best = Math.min(...times), worst = Math.max(...times);
      if (worst > hardest) { hardest = worst; hardestLabel = `${kind} T${tier}`; }
      if (worst >= ENRAGE) allClearable = false;
      if (best < 12) anyTrivial = true; // a boss that dies in under 12s is a mob
    }
  }
  check(allClearable,
    `every boss is clearable before enrage with any primary (worst: ${hardestLabel} ` +
    `${hardest.toFixed(0)}s vs ${ENRAGE}s)`);
  check(!anyTrivial, 'no boss melts fast enough to be a mere mob');
  check(encounterBaseHp(1) < encounterBaseHp(2) && encounterBaseHp(2) < encounterBaseHp(3),
    'boss health still climbs with tier');
}

// --- In-fight coaching -------------------------------------------------------
// Coaching is tested like a mechanic: every phase must explain its threats and
// an imminent ability must always take priority.
{
  const base = {
    encounterId: 'coach', tick: 0, time: 100, family: 'crystal' as const,
    kind: 'crystal_seer' as VaultBossKind, tier: 2 as VaultTier, phase: 2 as const,
    hp: 400, maxHp: 800, hpPercent: 0.5, poise: 100, maxPoise: 100,
    exposedUntil: 0, enrage: false, elapsed: 60, cast: null,
    boss: { id: 0, position: { x: 0, y: 0, z: 0 } },
    actors: [], objects: [], hazards: [], participants: [1], peakParticipants: 1,
    criticalObjects: 0, movement: null,
    healing: { active: false, sources: 0, rate: 0, healed: 0, cap: 0 },
    wave: { number: 1, alive: 0, cap: 32 },
    seal: { sealed: true, geometry: null },
    status: 'active' as const,
  };
  for (const kind of kinds) {
    const def = BOSS_DEFINITIONS[kind];
    check(def.phaseBriefs.length === 3 && def.phaseBriefs.every((b) => b.length > 40),
      `${def.name}: every phase explains itself in plain language`);
    check(def.phases.every((phase) => new Set(phase.map((ability) => ability.name)).size >= 5),
      `${def.name}: phase ability names are varied and non-repeating`);
  }
  const active = encounterCoach({ ...base, criticalObjects: 0 });
  check(active.text === BOSS_DEFINITIONS.crystal_seer.phaseBriefs[1],
    'an open damage phase explains its ability set instead of a breakable gate');
  const incoming = encounterCoach({
    ...base,
    hazards: [{ id: 1, shape: 'line', origin: { x: 0, y: 0, z: 0 },
      radius: 18, width: 1.4, angle: 0, telegraphAt: 99, executeAt: 101,
      expiresAt: 102, damage: 7, attack: 'Fate Beam', hitParticipants: [] }],
    criticalObjects: 0,
  });
  check(/FATE BEAM/.test(incoming.text) && incoming.tone === 'danger',
    'an incoming telegraph outranks every other instruction');
  check(incoming.text.includes(hazardAdvice('line')),
    'the dodge advice matches the hazard shape that is about to land');
  check(encounterCoach({ ...base, status: 'intro' }).text ===
    BOSS_DEFINITIONS.crystal_seer.phaseBriefs[0],
    'the intro briefs you before the first hit lands');
}

check(kinds.length === 5, 'all five dungeon boss families are covered');
if (failures.length) throw new Error(`${failures.length} boss smoke check(s) failed`);
