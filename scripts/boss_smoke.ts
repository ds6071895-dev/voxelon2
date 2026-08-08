import {
  BOSS_DEFINITIONS, ENCOUNTER_INTRO_SECONDS, ENCOUNTER_PHASE_TRANSITION_SECONDS,
  ENCOUNTER_RESET_GRACE_SECONDS, MAX_ENCOUNTER_ACTORS, MAX_ENCOUNTER_HAZARDS,
  MAX_ENCOUNTER_OBJECTS, VaultEncounter, sanitizeEncounterSnapshot, sealContains,
  type EncounterParticipant, type EncounterConfig,
} from '../src/vault_encounter';
import { bossMaxHp, encounterBaseHp } from '../src/vault_encounter';
import type { VaultBossKind, VaultTier } from '../src/vaults';
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
  check(encounter.actors.length >= 5,
    `${def.name}: phase two summons a themed army`);
  check(encounter.actors.length <= MAX_ENCOUNTER_ACTORS &&
    encounter.objects.length <= MAX_ENCOUNTER_OBJECTS &&
    encounter.hazards.length <= MAX_ENCOUNTER_HAZARDS,
    `${def.name}: encounter entities stay inside hard performance caps`);
  const hpBeforeHeal = encounter.hp;
  for (let i = 0; i < Math.ceil((ENCOUNTER_PHASE_TRANSITION_SECONDS + 0.75) / 0.25); i++) {
    encounter.tick(0.25, [participant]);
  }
  check(encounter.hp > hpBeforeHeal && encounter.snapshot().healing.active,
    `${def.name}: active objectives restore boss health`);
  check(encounter.objects.filter((object) => object.critical).length === def.criticalCount,
    `${def.name}: phase two creates every breakable ward`);

  let sequence = 1;
  for (const object of [...encounter.objects]) {
    encounter.attack({
      encounterId: encounter.config.encounterId,
      sequence: ++sequence,
      targetId: object.id,
      source: 'melee',
      hit: { ...object.position },
      claimedDamage: object.maxHp,
    }, participant, {
      heldSource: 'melee', maxDamage: object.maxHp, range: 30,
      cadence: 0, now: encounter.now,
    });
  }
  const healedAtBreak = encounter.hp;
  encounter.tick(1, [participant]);
  check(encounter.hp <= healedAtBreak + 0.01 && !encounter.snapshot().healing.active,
    `${def.name}: destroying sources interrupts healing`);
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
  lateSnapshot.wave.number > 0 && lateSnapshot.healing.sources > 0,
  'late join snapshot carries the live seal, wave and healing-objective state');

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
  // half the fight is spent moving, reloading, breaking objectives and waiting
  // out phase transitions, and that the boss heals its full 35% cap.
  const UPTIME = 0.5, HEAL_CAP = 1.35, ENRAGE = 360;
  const primaries = [Item.Pistol, Item.Rifle, Item.Shotgun, Item.SMG,
    Item.Sniper, Item.BurstRifle, Item.RocketLauncher];
  let hardest = 0, hardestLabel = '';
  let allClearable = true, anyTrivial = false;
  for (const tier of [1, 2, 3] as VaultTier[]) {
    for (const kind of kinds) {
      const hp = bossMaxHp(tier, kind) * HEAL_CAP;
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
// A boss that stops taking damage without saying why is the single most common
// way a player bounces off this content, so the explanation is tested like a
// mechanic: every boss must own one, and it must change with the fight.
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
    check(def.objectName.length > 0 && def.objectPlural.length > 0 &&
      def.wardEffect.length > 0,
      `${def.name}: its wards are named and their protection is spelled out`);
  }
  const warded = encounterCoach({ ...base, criticalObjects: 3 });
  check(/PRISMS/.test(warded.text) && /QUARTER/i.test(warded.text),
    'a warded boss tells you to break the wards and why the boss will not die');
  const incoming = encounterCoach({
    ...base,
    hazards: [{ id: 1, shape: 'line', origin: { x: 0, y: 0, z: 0 },
      radius: 18, width: 1.4, angle: 0, telegraphAt: 99, executeAt: 101,
      expiresAt: 102, damage: 7, attack: 'Fate Beam', hitParticipants: [] }],
    criticalObjects: 3,
  });
  check(/FATE BEAM/.test(incoming.text) && incoming.tone === 'danger',
    'an incoming telegraph outranks every other instruction');
  check(incoming.text.includes(hazardAdvice('line')),
    'the dodge advice matches the hazard shape that is about to land');
  const exposed = encounterCoach({ ...base, exposedUntil: 3.2 });
  check(exposed.tone === 'good' && /EXPOSED/.test(exposed.text),
    'the damage window is called out as the moment to push');
  check(encounterCoach({ ...base, status: 'intro' }).text ===
    BOSS_DEFINITIONS.crystal_seer.phaseBriefs[0],
    'the intro briefs you before the first hit lands');
}

check(kinds.length === 5, 'all five dungeon boss families are covered');
if (failures.length) throw new Error(`${failures.length} boss smoke check(s) failed`);
