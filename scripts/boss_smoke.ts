import {
  BOSS_DEFINITIONS, ENCOUNTER_INTRO_SECONDS, ENCOUNTER_PHASE_TRANSITION_SECONDS,
  VaultEncounter, type EncounterParticipant,
} from '../src/vault_encounter';
import type { VaultBossKind } from '../src/vaults';

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
    startTime: 0,
  });
  encounter.start(1, 0);
  for (let i = 0; i < Math.ceil((ENCOUNTER_INTRO_SECONDS + 0.5) / 0.25); i++) {
    encounter.tick(0.25, [participant]);
  }
  check(encounter.status === 'active', `${def.name}: cinematic intro enters combat`);
  check(def.phaseTitles.length === 3 && !!def.introLine && !!def.victoryLine,
    `${def.name}: dramatic copy covers intro, three phases and victory`);

  const phaseHit = encounter.attack({
    encounterId: encounter.config.encounterId,
    sequence: 1,
    targetId: 0,
    source: 'melee',
    hit: { ...center },
    claimedDamage: Math.ceil(encounter.maxHp * 0.31),
  }, participant, {
    heldSource: 'melee', maxDamage: encounter.maxHp, range: 30,
    cadence: 0, now: encounter.now,
  });
  check(phaseHit.accepted && encounter.phase === 2,
    `${def.name}: phase two triggers at 70% health`);
  check(encounter.actors.length >= 2,
    `${def.name}: phase two summons its themed mob wave`);
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
}

check(kinds.length === 5, 'all five dungeon boss families are covered');
if (failures.length) throw new Error(`${failures.length} boss smoke check(s) failed`);
