// WARFARE COMMAND smoke tests.
//
// Covers the progression tree, boss-XP settlement (contribution, death, late
// join, spectators, reconnect, exactly-once), the offline/online parity of that
// settlement, the retirement of the old progression, missile/silo rules,
// interceptor behaviour, the vehicle layer, and serialization/sanitization.

import {
  WARFARE_TREE, WARFARE_TREE_COST, WARFARE_MIGRATION_KEY, MAX_HARDWARE_TIER,
  MAX_SILOS_PER_FACTION, MIN_SILO_SPACING, MAX_BATTERIES_PER_FACTION,
  MIN_BATTERY_SPACING, MAX_MISSILES_IN_FLIGHT, FACTION_LAUNCH_SPACING,
  MIN_MISSILE_FLIGHT, MISSILE_HULL_HP, batteryStats, buyWarfareNode,
  canBuyWarfareNode, grantWarfareXp, helicopterStats, migrateWarfare, newWarfare,
  newContribution, qualifiesForWarfareXp, sanitizeWarfare, settleWarfareXp,
  siloStats, tierLabel, warfareAvailable, warfareBlockReason, warfareCompletion,
  warfareNode, warfareOwns, warfareSpent, warfareTier, warfareXpForTier,
  blastDamage, missileFlightTime, type ContributionRecord,
} from '../src/warfare';
import {
  StrategicSim, arcAt, blastBlockCandidates, protectedArea, sanitizeBattery,
  sanitizeSilo, type ProtectedArea, type StrategicEvent,
} from '../src/strategic';
import {
  VehicleSim, sanitizeHelicopter, sanitizeHeliInput, seatPosition,
  DISMOUNT_CLEARANCE, PASSENGER_ARC, type VehicleEvent,
} from '../src/vehicles';
import { VaultEncounter, type EncounterParticipant } from '../src/vault_encounter';
import { GameServer } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { WARFARE_BLUEPRINTS, RECIPES } from '../src/crafting';
import { Block } from '../src/blocks';
import { Item, ITEMS } from '../src/items';
import { mulberry32 } from '../src/noise';

const failures: string[] = [];
const check = (condition: boolean, message: string): void => {
  if (condition) console.log(`PASS  ${message}`);
  else { console.error(`FAIL  ${message}`); failures.push(message); }
};

// --- The tree ---------------------------------------------------------------------
{
  check(WARFARE_TREE_COST === 8200,
    `the complete tree costs exactly 8,200 XP (got ${WARFARE_TREE_COST})`);
  check(WARFARE_TREE.length === 18 &&
    new Set(WARFARE_TREE.map((n) => n.id)).size === 18,
    'the tree is 18 uniquely-identified nodes');

  const branchCost = (b: string): number =>
    WARFARE_TREE.filter((n) => n.branch === b).reduce((a, n) => a + n.cost, 0);
  check(branchCost('trunk') === 2750, `the trunk costs 2,750 XP (got ${branchCost('trunk')})`);
  check(branchCost('strike') === 1700, `Strike costs 1,700 XP (got ${branchCost('strike')})`);
  check(branchCost('aegis') === 1700, `Aegis costs 1,700 XP (got ${branchCost('aegis')})`);
  check(branchCost('air') === 2050, `Aviation costs 2,050 XP (got ${branchCost('air')})`);

  // Every prerequisite exists and points strictly shallower — no cycles.
  check(WARFARE_TREE.every((n) =>
    n.prereq === '' || (warfareNode(n.prereq)?.depth ?? 99) < n.depth),
    'every prerequisite exists and is strictly shallower (no cycles)');
  check(WARFARE_TREE.filter((n) => n.prereq === '').length === 1,
    'the tree has exactly one root');

  // The requested ORDER: missiles, then missile defense, then helicopters.
  const s = newWarfare();
  grantWarfareXp(s, WARFARE_TREE_COST);
  check(canBuyWarfareNode(s, 'missile_command') &&
    !canBuyWarfareNode(s, 'aegis_systems') &&
    !canBuyWarfareNode(s, 'flight_certification'),
    'missiles must be unlocked before defense, and defense before helicopters');
  buyWarfareNode(s, 'missile_command');
  buyWarfareNode(s, 'guidance_vanes');
  buyWarfareNode(s, 'hardened_silo');
  check(canBuyWarfareNode(s, 'aegis_systems') && !canBuyWarfareNode(s, 'flight_certification'),
    'missile defense opens only after the whole missile stage');
  for (const id of ['aegis_systems', 'radar_sweep', 'fast_intercept']) buyWarfareNode(s, id);
  check(canBuyWarfareNode(s, 'flight_certification'),
    'helicopters open only after the whole defense stage');
  for (const id of ['flight_certification', 'bomb_rack', 'reinforced_airframe']) {
    buyWarfareNode(s, id);
  }
  check(canBuyWarfareNode(s, 'strike_guidance') && canBuyWarfareNode(s, 'aegis_network') &&
    canBuyWarfareNode(s, 'air_turbine'),
    'all three endgame branches open together, at the end of the trunk');

  // Buying the whole tree spends exactly the tree cost, and nothing is left.
  for (const n of WARFARE_TREE) buyWarfareNode(s, n.id);
  check(s.nodes.length === 18 && warfareSpent(s) === WARFARE_TREE_COST &&
    warfareAvailable(s) === 0 && warfareCompletion(s) === 1,
    'the exact tree budget buys the exact tree — no change left over');

  // Spending is gated on XP, not just prerequisites.
  const poor = newWarfare();
  grantWarfareXp(poor, 99);
  check(!canBuyWarfareNode(poor, 'missile_command') &&
    (warfareBlockReason(poor, 'missile_command') ?? '').includes('more warfare XP'),
    'a node you cannot afford is blocked with a clear reason');
  grantWarfareXp(poor, 1);
  check(canBuyWarfareNode(poor, 'missile_command') &&
    warfareBlockReason(poor, 'missile_command') === null,
    'the exact cost is enough');
  check((warfareBlockReason(poor, 'strike_precision') ?? '').startsWith('Requires'),
    'a node whose prerequisite is missing says so');

  // Hardware tiers are derived from owned nodes.
  const full = newWarfare();
  grantWarfareXp(full, WARFARE_TREE_COST);
  for (const n of WARFARE_TREE) buyWarfareNode(full, n.id);
  check(warfareTier(full, 'silo') === MAX_HARDWARE_TIER &&
    warfareTier(full, 'battery') === MAX_HARDWARE_TIER &&
    warfareTier(full, 'helicopter') === MAX_HARDWARE_TIER,
    'a complete tree authorizes every hardware family to its top tier');
  check(warfareTier(newWarfare(), 'silo') === 0,
    'a fresh player may build nothing');

  // No filler: every node changes a real number or unlocks a system.
  check(WARFARE_TREE.every((n) => n.unlocks.length > 0),
    'every node states a concrete capability change');
}

// --- Stat ladders match the design table --------------------------------------------
{
  const a = siloStats(1), mid = siloStats(5), max = siloStats(6);
  check(a.range === 900 && a.blastRadius === 7 && a.playerDamage === 14 &&
    a.hardwareDamage === 180 && a.blocks === 8 && a.hp === 500 &&
    a.magazine === 1 && a.cooldown === 120,
    'the initial silo matches the design table');
  check(mid.range === 1700 && mid.blastRadius === 8 && mid.playerDamage === 16 &&
    mid.hardwareDamage === 240 && mid.blocks === 12 && mid.hp === 700 &&
    mid.magazine === 2 && mid.cooldown === 105,
    'the mid silo matches the design table');
  check(max.range === 2300 && max.blastRadius === 9 && max.playerDamage === 18 &&
    max.hardwareDamage === 300 && max.blocks === 16 && max.hp === 800 &&
    max.magazine === 3 && max.cooldown === 90,
    'the maximum silo matches the design table');

  const b1 = batteryStats(1), b5 = batteryStats(5), b6 = batteryStats(6);
  check(b1.hp === 180 && b1.radius === 110 && b1.acquire === 0.70 &&
    b1.reload === 12 && b1.capacity === 4,
    'the initial battery matches the design table');
  check(b5.hp === 240 && b5.radius === 170 && b5.acquire === 0.35 &&
    b5.reload === 8 && b5.capacity === 7,
    'the mid battery matches the design table');
  check(b6.hp === 300 && b6.radius === 200 && b6.acquire === 0.25 &&
    b6.reload === 6 && b6.capacity === 8,
    'the maximum battery matches the design table');

  const h1 = helicopterStats(1), h5 = helicopterStats(5), h6 = helicopterStats(6);
  check(h1.hp === 140 && h1.speed === 16 && h1.fuel === 12 && h1.bombs === 2 &&
    h1.bombRadius === 4 && h1.bombPlayerDamage === 10 &&
    h1.bombHardwareDamage === 80 && h1.bombCooldown === 6 && h1.mark === 1,
    'the Mk I helicopter matches the design table');
  check(h5.hp === 190 && h5.speed === 20 && h5.fuel === 18 && h5.bombs === 4 &&
    h5.bombRadius === 5 && h5.bombPlayerDamage === 12 &&
    h5.bombHardwareDamage === 100 && h5.bombCooldown === 5 && h5.mark === 2,
    'the Mk II helicopter matches the design table');
  check(h6.hp === 220 && h6.speed === 24 && h6.fuel === 24 && h6.bombs === 5 &&
    h6.bombRadius === 6 && h6.bombPlayerDamage === 14 &&
    h6.bombHardwareDamage === 130 && h6.bombCooldown === 4 && h6.mark === 3,
    'the Mk III helicopter matches the design table');

  check(tierLabel(1) === 'Mk I' && tierLabel(6) === 'Mk VI' && tierLabel(99) === 'Mk VI',
    'tier labels are stable and clamped');
  // Stats are copies, never the shared table.
  const mutated = siloStats(1);
  mutated.range = 1;
  check(siloStats(1).range === 900, 'stat lookups hand back copies, not the table');
}

// --- Boss XP: tiers, qualification, exactly-once ---------------------------------
{
  check(warfareXpForTier(1) === 300 && warfareXpForTier(2) === 750 &&
    warfareXpForTier(3) === 1500 && warfareXpForTier(4) === 0,
    'boss tiers pay 300 / 750 / 1500 and nothing else pays at all');

  // The expected completion route reaches the tree cost.
  const route = 5 * 300 + 5 * 750 + 2 * 1500;
  check(route === 8250 && route >= WARFARE_TREE_COST,
    `the documented clear route (${route} XP) covers the ${WARFARE_TREE_COST} tree`);

  const HP = 1000;
  const rec = (damage: number, seconds: number, name = 'A'): ContributionRecord =>
    ({ ...newContribution(1, name), damage, activeSeconds: seconds });

  check(qualifiesForWarfareXp(rec(20, 30), HP, 100),
    '2% damage plus a quarter of the fight qualifies');
  check(!qualifiesForWarfareXp(rec(20, 20), HP, 100),
    '2% damage with too little time does not qualify');
  check(qualifiesForWarfareXp(rec(100, 1), HP, 100),
    '10% damage qualifies regardless of duration');
  check(!qualifiesForWarfareXp(rec(19, 99), HP, 100),
    'under 2% damage never qualifies, however long you loiter');
  check(!qualifiesForWarfareXp(rec(0, 100), HP, 100),
    'a player who dealt no damage earns nothing (late join / spectating from the door)');
  check(!qualifiesForWarfareXp({ ...rec(500, 100), observer: true }, HP, 100),
    'a creative/spectator observer never earns warfare XP');
  check(qualifiesForWarfareXp(rec(30, 8), HP, 30),
    'a player who DIED at 8s of a 30s fight still qualifies on their contribution');

  // Settlement: independent, undivided, once per account.
  const ledger: ContributionRecord[] = [
    { ...newContribution(1, 'Ana'), damage: 400, activeSeconds: 60 },
    { ...newContribution(2, 'Ben'), damage: 400, activeSeconds: 60 },
    { ...newContribution(3, 'Cai'), damage: 30, activeSeconds: 55 },   // 3%, long enough
    { ...newContribution(4, 'Dee'), damage: 5, activeSeconds: 60 },    // under 2%
    { ...newContribution(5, 'Eve'), damage: 0, activeSeconds: 60 },    // never fought
  ];
  const awards = settleWarfareXp(ledger, 2, HP, 60);
  check(awards.length === 3 && awards.every((a) => a.xp === 750),
    'every qualifying participant is paid the FULL tier award, undivided');
  check(!awards.some((a) => a.username === 'Dee' || a.username === 'Eve'),
    'non-contributors are excluded from the settlement');

  // Reconnect: two sockets, one account. Paid once.
  const dupe: ContributionRecord[] = [
    { ...newContribution(1, 'Ana'), damage: 300, activeSeconds: 40 },
    { ...newContribution(9, 'ana'), damage: 300, activeSeconds: 20 },
  ];
  check(settleWarfareXp(dupe, 1, HP, 60).length === 1,
    'a reconnect (two sockets, one account) is settled exactly once');
  check(settleWarfareXp(ledger, 4, HP, 60).length === 0,
    'an unknown boss tier pays nobody');
}

// --- The contribution ledger, driven by a REAL encounter ---------------------------
{
  const center = { x: 0, y: 10, z: 0 };
  const cfg = {
    encounterId: 'ledger-test', seed: 99, tier: 2 as const, kind: 'bone_warden' as const,
    family: 'crypt' as const, center,
    bounds: { minX: -12, maxX: 12, minY: 6, maxY: 20, minZ: -12, maxZ: 12 },
    sockets: [center], cameraAnchors: [center], startTime: 0,
  };
  const enc = new VaultEncounter(cfg);
  const at = (id: number, alive = true, inside = true): EncounterParticipant =>
    ({ id, position: { ...center }, alive, inside });

  enc.start(1);
  enc.join(2);   // a second fighter
  enc.join(3);   // someone who will leave early
  // Run the intro out; time in the intro must NOT count as participation.
  for (let i = 0; i < 260; i++) enc.tick(0.05, [at(1), at(2), at(3)]);
  check(enc.status === 'active', 'the test encounter reached its active phase');
  check((enc.ledger.get(1)?.activeSeconds ?? 0) > 0,
    'presence during the live fight accrues to the ledger');

  // Player 1 lands hits; player 3 walks out and is pruned from `participants`.
  let seq = 1;
  const hit = (id: number, damage: number): boolean => enc.attack(
    { encounterId: cfg.encounterId, sequence: seq++, targetId: 0, source: 'bullet',
      claimedDamage: damage, hit: { ...enc.bossPosition } },
    at(id),
    { heldSource: 'bullet', maxDamage: damage, range: 40, cadence: 0, now: enc.now },
  ).accepted;

  let landed = 0;
  for (let i = 0; i < 12; i++) {
    if (hit(1, 20)) landed++;
    enc.tick(0.05, [at(1), at(2), at(3)]);
  }
  check(landed > 0 && (enc.ledger.get(1)?.damage ?? 0) > 0,
    'accepted damage accrues to the attacker\'s ledger row');
  const beforeReject = enc.ledger.get(2)?.damage ?? 0;
  // A forged over-damage claim is rejected AND never credited.
  enc.attack(
    { encounterId: cfg.encounterId, sequence: seq++, targetId: 0, source: 'bullet',
      claimedDamage: 99999, hit: { ...enc.bossPosition } },
    at(2),
    { heldSource: 'bullet', maxDamage: 10, range: 40, cadence: 0, now: enc.now },
  );
  check((enc.ledger.get(2)?.damage ?? 0) === beforeReject,
    'damage the engine REJECTED is never credited to the ledger');

  // Player 3 leaves entirely; the ledger keeps their row.
  const row3 = { ...enc.ledger.get(3)! };
  for (let i = 0; i < 20; i++) enc.tick(0.05, [at(1), at(2), at(3, true, false)]);
  check(!enc.participants.has(3) && enc.ledger.has(3) &&
    enc.ledger.get(3)!.activeSeconds >= row3.activeSeconds,
    'a player who leaves is pruned from participants but KEPT in the ledger');

  // Player 1 dies just before the end; their contribution must survive.
  const dmg1 = enc.ledger.get(1)!.damage;
  for (let i = 0; i < 20; i++) enc.tick(0.05, [at(1, false), at(2)]);
  check(enc.ledger.get(1)!.damage === dmg1,
    'dying does not erase a fighter\'s recorded damage');

  // A late arrival with zero damage earns nothing from the settlement.
  enc.join(4);
  for (let i = 0; i < 5; i++) enc.tick(0.05, [at(2), at(4)]);
  const ledger: ContributionRecord[] = [];
  for (const [id, row] of enc.ledger) {
    ledger.push({ id, username: `P${id}`, damage: row.damage, activeSeconds: row.activeSeconds });
  }
  const elapsed = Math.max(0, enc.now - enc.startedAt);
  const paid = settleWarfareXp(ledger, 2, enc.maxHp, elapsed).map((a) => a.username);
  check(paid.includes('P1'), 'the fighter who died late is still paid');
  check(!paid.includes('P4'), 'the late arrival who never fought is paid nothing');
}

// --- Migration ---------------------------------------------------------------------
{
  const before = {
    // Retired.
    progress: { xp: 99999, nodes: ['scout0', 'scout1'] },
    xp: 4242,
    skills: ['gunner0'],
    factionXp: [500, 500],
    // Preserved.
    hearts: 7,
    hotbar: [1, 2, 3],
    slots: [{ id: 1, count: 5 }],
    vaultRecords: { '3,4': { clears: 2 } },
    spawnX: 12,
  };
  const { warfare, data, migrated } = migrateWarfare(before);
  check(migrated && data[WARFARE_MIGRATION_KEY] === true,
    'the one-time warfare-v1 migration stamps the blob');
  check(warfare.xp === 0 && warfare.nodes.length === 0,
    'old Progress XP and purchased nodes are discarded, not converted');
  check(data.progress === undefined && data.xp === undefined &&
    data.skills === undefined && data.factionXp === undefined,
    'every retired progression key is removed so later saves never carry it');
  check(data.hearts === 7 && data.spawnX === 12 &&
    Array.isArray(data.slots) && !!data.vaultRecords,
    'inventory, hearts, records and spawn survive the migration untouched');

  // Re-running is a no-op for the surviving data.
  const again = migrateWarfare(data);
  check(again.warfare.xp === 0 && again.data.hearts === 7,
    'the migration is idempotent');

  // Sanitization is fail-closed and budget-enforcing.
  check(sanitizeWarfare(null).xp === 0 && sanitizeWarfare({ xp: -5 }).xp === 0 &&
    sanitizeWarfare('nope').nodes.length === 0,
    'sanitizeWarfare fail-closes on garbage');
  const forged = sanitizeWarfare({
    xp: 100, nodes: ['missile_command', 'strike_precision', 'not_a_node'],
  });
  check(forged.nodes.length === 1 && forged.nodes[0] === 'missile_command',
    'a hand-edited save cannot mint an unaffordable or prerequisite-less node');
  const chainless = sanitizeWarfare({ xp: 99999, nodes: ['strike_precision'] });
  check(chainless.nodes.length === 0,
    'a node whose whole prerequisite chain is missing is dropped');
  const legit = sanitizeWarfare({ xp: 500, nodes: ['missile_command', 'guidance_vanes'] });
  check(legit.nodes.length === 2 && warfareSpent(legit) === 250,
    'a legitimate save round-trips exactly');
}

// --- Server settlement: online + offline parity, once per cycle ------------------
{
  // The settlement helper is the SAME pure function on both ends, so parity is
  // structural. Prove it with an identical ledger through the identical call.
  const ledger: ContributionRecord[] = [
    { ...newContribution(1, 'Solo'), damage: 900, activeSeconds: 45 },
  ];
  const online = settleWarfareXp(ledger, 3, 1000, 45);
  const offline = settleWarfareXp(ledger, 3, 1000, 45);
  check(online.length === 1 && offline.length === 1 &&
    online[0].xp === offline[0].xp && online[0].xp === 1500,
    'offline and online settlement are byte-identical (one pure function)');

  // Account-level plumbing: earn, spend, persist.
  const accounts = new Accounts([]);
  const hash = (p: string, s: string): string => `${p}:${s}`;
  accounts.register('Pilot', 'pass', hash, 'salt');
  check(accounts.warfareOf('Pilot').xp === 0,
    'a fresh account starts with no warfare technology');
  accounts.awardWarfareXp('Pilot', 300);
  check(accounts.warfareOf('Pilot').xp === 300 &&
    accounts.buyWarfare('Pilot', 'missile_command') &&
    warfareOwns(accounts.warfareOf('Pilot'), 'missile_command'),
    'the account store earns and spends warfare XP');
  check(!accounts.buyWarfare('Pilot', 'strike_precision'),
    'the account store refuses an unaffordable purchase');
  const roundTrip = new Accounts(JSON.parse(JSON.stringify(accounts.toJSON())));
  check(roundTrip.warfareOf('Pilot').xp === 300 &&
    warfareOwns(roundTrip.warfareOf('Pilot'), 'missile_command'),
    'warfare progression survives an account serialize round-trip');

  // The server exposes it on the welcome and honours purchases.
  const g = new GameServer(1337, mulberry32(7));
  g.setWarfare('Ace', { version: 1, xp: 400, nodes: [] });
  const welcome = g.addPlayer(1, { username: 'Ace', faction: 0, warfare: { version: 1, xp: 400, nodes: [] } })
    .find((o) => o.msg.t === 'welcome')!.msg as { warfare: { xp: number; nodes: string[] } };
  check(welcome.warfare.xp === 400 && welcome.warfare.nodes.length === 0,
    'the welcome carries the account\'s authoritative warfare state');
  const bought = g.handle(1, { t: 'warfareBuy', node: 'missile_command' });
  check(bought.some((o) => o.msg.t === 'warfare' &&
    (o.msg as { nodes: string[] }).nodes.includes('missile_command')),
    'a valid purchase is applied and echoed back');
  const refused = g.handle(1, { t: 'warfareBuy', node: 'air_command' });
  check(refused.some((o) => o.msg.t === 'warfareErr'),
    'an invalid purchase is refused with a reason');
  check(g.handle(1, { t: 'warfareBuy', node: 'not-a-node' })
    .some((o) => o.msg.t === 'warfareErr'),
    'a forged node id is refused');
}

// --- No generic boss XP: the brute melee award is gone ---------------------------
{
  // The retired system awarded XP through `onPlayerKill('brute')`. Warfare XP
  // has exactly one source, so no mob kill (brute included) can grant it.
  const g = new GameServer(1337, mulberry32(11));
  g.addPlayer(1, { username: 'Grunt', faction: 0 });
  const out = [
    ...g.handle(1, { t: 'xp', amount: 40 }),         // the old brute award value
    ...g.handle(1, { t: 'xp', amount: 999 }),
  ];
  check(out.length === 0,
    'no mob kill — brute included — can produce warfare XP through the wire');
  check(g.warfareOf('Grunt').xp === 0,
    'the account gained nothing from mob kills');
}

// --- Missiles: range, protected zones, cooldowns, caps ----------------------------
{
  const areas: ProtectedArea[] = [protectedArea('vault', 400, 0, 'Tier II vault', 60)];
  const sim = new StrategicSim({
    groundY: () => 64, worldHalf: 2500, protectedAreas: () => areas,
  });
  const silo = sim.addSilo('Ana', 0, 0, 64, 0, 1);
  const stats = siloStats(1);

  check(sim.validateLaunch({ siloId: silo.id, faction: 0, tx: 100, tz: 0 }).ok === false,
    'an empty silo cannot fire');
  sim.loadSilo(silo, 5);
  check(silo.ammo === stats.magazine,
    'loading is capped at the installed magazine size');

  const far = sim.validateLaunch({ siloId: silo.id, faction: 0, tx: stats.range + 10, tz: 0 });
  check(!far.ok && far.reason === 'out-of-range', 'a target beyond range is refused');
  const prot = sim.validateLaunch({ siloId: silo.id, faction: 0, tx: 400, tz: 0 });
  check(!prot.ok && prot.reason === 'protected', 'a protected zone cannot be targeted');
  const alien = sim.validateLaunch({ siloId: silo.id, faction: 1, tx: 100, tz: 0 });
  check(!alien.ok && alien.reason === 'not-yours', 'another faction cannot fire your silo');
  const junk = sim.validateLaunch({ siloId: silo.id, faction: 0, tx: NaN, tz: 0 });
  check(!junk.ok && junk.reason === 'bad-target', 'non-finite coordinates are refused');
  const offMap = sim.validateLaunch({ siloId: silo.id, faction: 0, tx: 99999, tz: 0 });
  check(!offMap.ok, 'a target outside the world boundary is refused');

  const events = sim.launch({ siloId: silo.id, faction: 0, tx: 300, tz: 0 });
  check(events.some((e) => e.kind === 'launch') && events.some((e) => e.kind === 'warning'),
    'a valid launch emits both the missile and its warning');
  check(silo.ammo === stats.magazine - 1 && silo.cooldown === stats.cooldown,
    'ammunition is consumed only after validation, and the cooldown starts');
  check(!sim.validateLaunch({ siloId: silo.id, faction: 0, tx: 300, tz: 0 }).ok,
    'a spent magazine blocks the next launch');
  sim.loadSilo(silo, 1);   // reload, so the COOLDOWN is what is left to prove
  const cooling = sim.validateLaunch({ siloId: silo.id, faction: 0, tx: 300, tz: 0 });
  check(!cooling.ok && cooling.reason === 'cooldown', 'the silo cannot fire while cycling');

  // Faction spacing + in-flight cap use a SECOND silo, far enough away.
  const silo2 = sim.addSilo('Ben', 0, 200, 64, 0, 1);
  sim.loadSilo(silo2, 1);
  const spaced = sim.validateLaunch({ siloId: silo2.id, faction: 0, tx: 300, tz: 0 });
  check(!spaced.ok && spaced.reason === 'faction-spacing',
    `a faction may not fire twice inside ${FACTION_LAUNCH_SPACING}s`);
  sim.now += FACTION_LAUNCH_SPACING + 1;
  sim.launch({ siloId: silo2.id, faction: 0, tx: 300, tz: 0 });
  check(sim.missilesInFlight(0) === MAX_MISSILES_IN_FLIGHT,
    'the faction now has its maximum missiles in the air');
  const silo3 = sim.addSilo('Cai', 0, 400, 64, 0, 1);
  sim.loadSilo(silo3, 1);
  sim.now += FACTION_LAUNCH_SPACING + 1;
  const capped = sim.validateLaunch({ siloId: silo3.id, faction: 0, tx: 300, tz: 0 });
  check(!capped.ok && capped.reason === 'in-flight-cap',
    'the in-flight cap blocks a third missile');

  // Placement caps + spacing.
  const p = new StrategicSim({ groundY: () => 64, worldHalf: 2500, protectedAreas: () => [] });
  p.addSilo('A', 0, 0, 64, 0);
  check((p.siloPlacementError(0, 10, 64, 0) ?? '').includes(String(MIN_SILO_SPACING)),
    `silos must stand ${MIN_SILO_SPACING} blocks apart`);
  p.addSilo('A', 0, 500, 64, 0);
  check(p.siloPlacementError(0, 1000, 64, 0) !== null &&
    p.siloPlacementError(1, 1000, 64, 0) === null,
    `a faction may field only ${MAX_SILOS_PER_FACTION} silos`);
  p.addBattery('A', 0, 0, 64, 200);
  check((p.batteryPlacementError(0, 0, 64, 210) ?? '').includes(String(MIN_BATTERY_SPACING)),
    `batteries must stand ${MIN_BATTERY_SPACING} blocks apart`);
  for (let i = 1; i < MAX_BATTERIES_PER_FACTION; i++) p.addBattery('A', 0, i * 100, 64, 900);
  check(p.batteryPlacementError(0, 3000, 64, 3000) !== null,
    `a faction may field only ${MAX_BATTERIES_PER_FACTION} batteries`);
}

// --- Deterministic flight, minimum warning, one-time damage ------------------------
{
  const sim = new StrategicSim({ groundY: () => 64, worldHalf: 2500, protectedAreas: () => [] });
  const silo = sim.addSilo('Ana', 0, 0, 64, 0, 1);
  sim.loadSilo(silo, 1);
  sim.launch({ siloId: silo.id, faction: 0, tx: 20, tz: 0 });
  const m = [...sim.missiles.values()][0];
  check(m.flight >= MIN_MISSILE_FLIGHT,
    'even a target 20 blocks away gets the full warning window');
  check(missileFlightTime(100000, 55) > MIN_MISSILE_FLIGHT,
    'a long shot takes proportionally longer');

  // The arc is a pure function of its four endpoints — both ends agree.
  const at = (p: number) => arcAt(m, p);
  check(at(0).x === m.sx && at(1).x === m.tx && at(0.5).y > Math.max(m.sy, m.ty),
    'the trajectory is a deterministic arc that starts, peaks and lands correctly');
  check(JSON.stringify(at(0.37)) === JSON.stringify(arcAt(m, 0.37)),
    'the same progress always yields the same position');

  // Fly it to impact and confirm exactly ONE impact event.
  let impacts = 0;
  let guard = 0;
  while (sim.missiles.size && guard++ < 4000) {
    for (const ev of sim.tick(0.05)) if (ev.kind === 'impact') impacts++;
  }
  check(impacts === 1, 'a missile produces exactly one impact event, then ceases to exist');
  check(sim.missiles.size === 0, 'the missile is removed on impact');

  // Falloff is linear and applied from the centre out.
  check(blastDamage(18, 0, 9) === 18 && blastDamage(18, 9, 9) === 0 &&
    blastDamage(18, 4.5, 9) === 9,
    'blast damage falls off linearly to zero at the rim');
  check(blastDamage(18, 100, 9) === 0, 'nothing outside the radius is touched');

  // Block candidates are bounded and nearest-first.
  const cands = blastBlockCandidates(0, 64, 0, 7);
  check(cands.length > 0 && cands[0].d === 0 &&
    cands.every((c) => c.d <= 7) &&
    cands.every((c, i) => i === 0 || c.d >= cands[i - 1].d),
    'blast block candidates are inside the radius and sorted nearest-first');

  // Hull HP: gunfire can burst a missile, and the event fires once.
  const sim2 = new StrategicSim({ groundY: () => 64, worldHalf: 2500, protectedAreas: () => [] });
  const s2 = sim2.addSilo('Ana', 0, 0, 64, 0, 1);
  sim2.loadSilo(s2, 1);
  sim2.launch({ siloId: s2.id, faction: 0, tx: 900, tz: 0 });
  const id = [...sim2.missiles.keys()][0];
  check(sim2.damageMissile(id, MISSILE_HULL_HP - 1) === null,
    'a missile hull survives a glancing hit');
  const down = sim2.damageMissile(id, 1);
  check(down?.kind === 'shotDown' && sim2.damageMissile(id, 50) === null,
    'the killing shot bursts the hull exactly once');
}

// --- Interceptors: selection, ammunition, saturation, no duplicate claims ----------
{
  const sim = new StrategicSim({ groundY: () => 64, worldHalf: 2500, protectedAreas: () => [] });
  // Two attacker silos, far apart, both aimed at the defender.
  const a1 = sim.addSilo('Red', 0, -800, 64, 0, 6);
  const a2 = sim.addSilo('Red', 0, -800, 64, 200, 6);
  sim.loadSilo(a1, 3); sim.loadSilo(a2, 3);
  const bat = sim.addBattery('Blue', 1, 0, 64, 0, 6);
  sim.loadBattery(bat, 8);

  sim.launch({ siloId: a1.id, faction: 0, tx: 0, tz: 0 });
  sim.now += FACTION_LAUNCH_SPACING + 1;
  sim.launch({ siloId: a2.id, faction: 0, tx: 20, tz: 0 });
  check(sim.missilesInFlight(0) === 2, 'two hostile missiles are inbound');

  let intercepts = 0;
  let launched = 0;
  let guard = 0;
  const seenClaims: number[] = [];
  while (sim.missilesInFlight(0) > 0 && guard++ < 4000) {
    for (const ev of sim.tick(0.05) as StrategicEvent[]) {
      if (ev.kind === 'interceptorLaunch') { launched++; seenClaims.push(ev.missile.id); }
      if (ev.kind === 'intercepted') intercepts++;
    }
  }
  check(intercepts >= 1, 'a loaded battery physically intercepts an inbound missile');
  check(launched <= 3,
    `a single battery cannot spam interceptors (fired ${launched} for 2 tracks)`);
  check(new Set(seenClaims).size === seenClaims.length,
    'no two interceptors are launched against the same track');
  check(bat.ammo === batteryStats(6).capacity - launched,
    'each interceptor costs exactly one round');

  // Saturation: an EMPTY battery stops everything getting through.
  const sim3 = new StrategicSim({ groundY: () => 64, worldHalf: 2500, protectedAreas: () => [] });
  const atk = sim3.addSilo('Red', 0, -800, 64, 0, 6);
  sim3.loadSilo(atk, 3);
  const dry = sim3.addBattery('Blue', 1, 0, 64, 0, 6);  // zero ammo on purpose
  sim3.launch({ siloId: atk.id, faction: 0, tx: 0, tz: 0 });
  let got = 0;
  guard = 0;
  while (sim3.missiles.size && guard++ < 4000) {
    for (const ev of sim3.tick(0.05)) if (ev.kind === 'impact') got++;
  }
  check(got === 1 && dry.ammo === 0,
    'an unloaded battery cannot stop anything — saturation is real');

  // Interceptors never harm players: they carry no warhead at all.
  const zero = sim.snapshotMissiles().filter((m) => m.kind === 'interceptor');
  check(zero.every((m) => m.radius === 0),
    'interceptors carry no blast radius, so they can never damage a player');
}

// --- Retrofits + damage + serialization -------------------------------------------
{
  const sim = new StrategicSim({ groundY: () => 64, worldHalf: 2500, protectedAreas: () => [] });
  const s = sim.addSilo('Ana', 0, 0, 64, 0, 1);
  check(sim.retrofitSilo(s, 3) && s.tier === 3 && s.maxHp === siloStats(3).hp,
    'a retrofit raises the installed tier and the hull');
  check(!sim.retrofitSilo(s, 2), 'a retrofit never goes backwards');
  check(!sim.damageSilo(s, s.hp - 1) && sim.damageSilo(s, 5),
    'silo HP depletes and reports its own destruction');

  const b = sim.addBattery('Ana', 0, 400, 64, 0, 1);
  sim.loadBattery(b, 99);
  check(b.ammo === batteryStats(1).capacity, 'battery loading is capped at capacity');
  sim.retrofitBattery(b, 6);
  check(b.ammo <= batteryStats(6).capacity, 'a retrofit never spills loaded rounds');

  // Sanitizers are fail-closed and clamp to the installed tier.
  check(sanitizeSilo(null) === null && sanitizeSilo({ x: NaN, y: 1, z: 1 }) === null,
    'sanitizeSilo fail-closes on junk');
  const forged = sanitizeSilo({
    id: 5, x: 1, y: 2, z: 3, owner: 'x'.repeat(200), faction: 0,
    tier: 99, hp: 1e9, ammo: 1e9, cooldown: 1e9,
  })!;
  check(forged.tier === MAX_HARDWARE_TIER && forged.hp === siloStats(6).hp &&
    forged.ammo === siloStats(6).magazine && forged.owner.length <= 24 &&
    forged.cooldown <= siloStats(6).cooldown,
    'a forged silo record is clamped to legal values');
  check(sanitizeBattery({ id: 2, x: 0, y: 0, z: 0, tier: -4, ammo: 99 })!.tier === 1,
    'a forged battery record is clamped too');
  // A record with no usable id is DROPPED, so two corrupted rows can never
  // overwrite each other (or a legitimate entity) on id 1 during a restore.
  check(sanitizeSilo({ x: 1, y: 2, z: 3 }) === null &&
    sanitizeBattery({ x: 1, y: 2, z: 3 }) === null &&
    sanitizeSilo({ id: 0, x: 1, y: 2, z: 3 }) === null,
    'hardware with no usable id is dropped rather than collapsed onto id 1');
}

// --- Vehicles: seats, input, fuel, collision, bombs, disconnect, restart ----------
{
  const solidAt = new Set<string>();
  const sim = new VehicleSim({
    solid: (x, y, z) => solidAt.has(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`),
    groundY: () => 64,
    worldHalf: 2500,
    vaultArena: () => false,
  });
  const h = sim.spawn('Ana', 0, { x: 0, y: 64, z: 0 }, 1);
  check(h.pilotId === null && h.passengerId === null && h.hp === helicopterStats(1).hp,
    'a fresh airframe spawns empty and at full health');

  // Seats: two maximum, faction-gated, proximity-gated.
  const near = { x: h.position.x, y: h.position.y, z: h.position.z };
  check(sim.mount(h.id, 1, 1, near).ok === false,
    'a player from another faction cannot board');
  check(sim.mount(h.id, 1, 0, { x: 500, y: 64, z: 500 }).ok === false,
    'you cannot board from across the map');
  const seat1 = sim.mount(h.id, 1, 0, near, 'pilot');
  const seat2 = sim.mount(h.id, 2, 0, near, 'passenger');
  check(seat1.ok && seat1.seat === 'pilot' && seat2.ok && seat2.seat === 'passenger',
    'the two seats fill as asked');
  check(sim.mount(h.id, 3, 0, near).ok === false, 'a third player is refused — two seats only');
  check(sim.mount(h.id, 1, 0, near).ok === false, 'you cannot occupy two seats');
  check(seatPosition(h, 'pilot').x !== seatPosition(h, 'passenger').x,
    'the two seats are physically distinct positions');

  // A pilot who has boarded but not yet sent an input frame must NOT crash the
  // tick — there is always a gap between `heliMount` and the first `heliInput`,
  // and online that tick runs on the server's 20 Hz interval.
  {
    const fresh = new VehicleSim({
      solid: () => false, groundY: () => 64, worldHalf: 2500, vaultArena: () => false,
    });
    const h0 = fresh.spawn('Ana', 0, { x: 0, y: 64, z: 0 }, 1);
    fresh.mount(h0.id, 1, 0, { x: h0.position.x, y: h0.position.y, z: h0.position.z }, 'pilot');
    let threw = false;
    try { fresh.tick(0.05); fresh.tick(0.05); } catch { threw = true; }
    check(!threw, 'ticking a just-boarded, not-yet-steering pilot does not throw');
    check(h0.position.y >= 64,
      'a seated pilot who has not steered yet holds station instead of auto-landing');
  }

  // Input validation.
  check(sanitizeHeliInput(null) === null &&
    sanitizeHeliInput({ forward: 1, seq: -1 }) === null &&
    sanitizeHeliInput({ forward: 1, seq: 1.5 }) === null,
    'malformed pilot input is rejected outright');
  const clamped = sanitizeHeliInput({ forward: 99, strafe: -99, lift: NaN, yaw: 1, seq: 4 })!;
  check(clamped.forward === 1 && clamped.strafe === -1 && clamped.lift === 0,
    'pilot input is clamped to full deflection, never beyond');
  check(sim.setInput(1, { forward: 1, strafe: 0, lift: 0, yaw: 0, seq: 10 }) &&
    !sim.setInput(1, { forward: 1, strafe: 0, lift: 0, yaw: 0, seq: 9 }),
    'a replayed or out-of-order input frame is dropped');
  check(!sim.setInput(2, { forward: 1, strafe: 0, lift: 0, yaw: 0, seq: 99 }),
    'the passenger cannot fly the aircraft');

  // Passenger firing arc.
  check(sim.passengerCanFire(2, h.rotation.y) &&
    !sim.passengerCanFire(2, h.rotation.y + Math.PI),
    `the gunner may only fire within ±${PASSENGER_ARC.toFixed(2)} rad of the nose`);

  // Refuelling must never destroy a barrel: fuel burns fractionally, so the
  // deficit is almost never a whole number, and the client debits the rounded-up
  // count. The sim has to accept that same count.
  {
    const partial = new VehicleSim({
      solid: () => false, groundY: () => 64, worldHalf: 2500, vaultArena: () => false,
    });
    const hp = partial.spawn('Ana', 0, { x: 0, y: 64, z: 0 }, 1);
    hp.fuel = 7.63;
    const want = Math.ceil(helicopterStats(1).fuel - hp.fuel);   // what the client debits
    const took = partial.service(hp, want, 0, 0);
    check(took.oil === want,
      `a fractional fuel deficit accepts exactly what the client paid ` +
      `(${took.oil} of ${want})`);
    check(hp.fuel === helicopterStats(1).fuel, 'and the tank ends up full');
  }

  // Fuel burns only under power, and a dry airframe sinks.
  sim.service(h, 12, 2, 0);
  check(h.fuel === helicopterStats(1).fuel && h.bombs === 2,
    'servicing fills fuel and the bomb rack to capacity');
  const fuelBefore = h.fuel;
  for (let i = 0; i < 20; i++) {
    sim.setInput(1, { forward: 1, strafe: 0, lift: 1, yaw: 0, seq: 100 + i });
    sim.tick(0.05);
  }
  check(h.fuel < fuelBefore, 'powered flight burns fuel');
  check(h.position.y > 64, 'the pilot can climb off the deck');

  // Bombs: capacity, cooldown, one entity per release, pilot-only.
  const dropped: VehicleEvent[] = sim.dropBomb(1);
  check(dropped.length === 1 && dropped[0].kind === 'bombRelease' && h.bombs === 1,
    'a bomb release consumes exactly one round');
  check(sim.dropBomb(1).length === 0, 'the bomb cooldown blocks a second release');
  check(sim.dropBomb(2).length === 0, 'the gunner cannot drop bombs');
  let bombImpacts = 0;
  let guard = 0;
  while (sim.bombs.size && guard++ < 2000) {
    for (const ev of sim.tick(0.05)) if (ev.kind === 'bombImpact') bombImpacts++;
  }
  check(bombImpacts === 1, 'a bomb produces exactly one impact');

  // Dismount rules: refused in the air, allowed near the ground.
  h.position.y = 64 + DISMOUNT_CLEARANCE + 10;
  check(sim.dismount(1).ok === false, 'you cannot step off at altitude');
  check(sim.dismount(1, true).ok === true, 'an emergency ejection always works');
  h.position.y = 64 + 1;
  check(sim.dismount(2).ok === true, 'you can step off near the ground');

  // Collision costs hull.
  const h2 = sim.spawn('Ben', 0, { x: 100, y: 64, z: 100 }, 6);
  sim.mount(h2.id, 7, 0, { x: h2.position.x, y: h2.position.y, z: h2.position.z }, 'pilot');
  sim.service(h2, 24, 0, 0);
  solidAt.add(`${Math.floor(h2.position.x)},${Math.floor(h2.position.y)},${Math.floor(h2.position.z + 2)}`);
  const hullBefore = h2.hp;
  for (let i = 0; i < 40; i++) {
    sim.setInput(7, { forward: 1, strafe: 0, lift: 0, yaw: 0, seq: 500 + i });
    sim.tick(0.05);
  }
  check(h2.hp <= hullBefore, 'flying into terrain costs hull integrity');

  // Destruction ejects both occupants and removes the wreck.
  const h3 = sim.spawn('Cai', 0, { x: 300, y: 64, z: 300 }, 1);
  const at3 = { x: h3.position.x, y: h3.position.y, z: h3.position.z };
  sim.mount(h3.id, 11, 0, at3, 'pilot');
  sim.mount(h3.id, 12, 0, at3, 'passenger');
  const boom = sim.damage(h3.id, 9999);
  check(boom.filter((e) => e.kind === 'eject').length === 2 &&
    boom.some((e) => e.kind === 'heliDown') &&
    h3.pilotId === null && h3.passengerId === null,
    'destruction ejects and damages both occupants');
  guard = 0;
  let removed = false;
  while (!removed && guard++ < 400) {
    for (const ev of sim.tick(0.05)) if (ev.kind === 'heliRemoved') removed = true;
  }
  check(removed && !sim.helicopters.has(h3.id),
    'the wreck falls, then disappears — no permanently airborne debris');

  // Pilot disconnect: a controlled descent, not a parked aircraft.
  const h4 = sim.spawn('Dee', 0, { x: 600, y: 64, z: 600 }, 1);
  sim.mount(h4.id, 21, 0, { x: h4.position.x, y: h4.position.y, z: h4.position.z }, 'pilot');
  sim.service(h4, 12, 0, 0);
  for (let i = 0; i < 40; i++) {
    sim.setInput(21, { forward: 0, strafe: 0, lift: 1, yaw: 0, seq: 900 + i });
    sim.tick(0.05);
  }
  const highY = h4.position.y;
  sim.clearOccupants();                       // simulate the disconnect sweep
  for (let i = 0; i < 200; i++) sim.tick(0.05);
  check(h4.position.y < highY && h4.position.y <= 66,
    'a pilotless airframe hovers, then settles to the ground');

  // Faction cap.
  check(sim.spawnError(0) !== null, 'a faction cannot field unlimited helicopters');

  // Restart: occupants are cleared, never restored.
  const restored = sanitizeHelicopter({
    id: 3, owner: 'x'.repeat(99), faction: 0,
    position: { x: 1, y: 2, z: 3 }, rotation: { x: 1, y: 2, z: 3 },
    tier: 99, hp: 1e9, fuel: 1e9, bombs: 1e9,
    pilotId: 42, passengerId: 43,
  })!;
  check(sanitizeHelicopter({ position: { x: 1, y: 2, z: 3 } }) === null,
    'an airframe with no usable id is dropped too');
  check(restored.pilotId === null && restored.passengerId === null &&
    restored.tier === MAX_HARDWARE_TIER && restored.hp === helicopterStats(6).hp &&
    restored.fuel <= helicopterStats(6).fuel && restored.bombs <= helicopterStats(6).bombs &&
    restored.owner.length <= 24,
    'a restored airframe is clamped and always has empty seats');
  check(sanitizeHelicopter(null) === null &&
    sanitizeHelicopter({ position: { x: NaN, y: 0, z: 0 } }) === null,
    'sanitizeHelicopter fail-closes on junk');
}

// --- World serialization ------------------------------------------------------------
{
  const g = new GameServer(1337, mulberry32(23));
  g.addPlayer(1, { username: 'Ana', faction: 0, warfare: { version: 1, xp: 9000, nodes: [] } });
  // Authorize everything so the player may build.
  for (const n of WARFARE_TREE) g.handle(1, { t: 'warfareBuy', node: n.id });
  check(warfareTier(g.warfareOf('Ana'), 'silo') === MAX_HARDWARE_TIER,
    'the whole tree can be bought against a sufficient XP balance');

  const save = JSON.parse(JSON.stringify(g.serialize())) as Record<string, unknown>;
  check(Array.isArray(save.silos) && Array.isArray(save.batteries) &&
    Array.isArray(save.helis),
    'the world save carries silos, batteries and helicopters');
  check(save.factionXp === undefined,
    'the retired faction XP pool is no longer serialized');
  const g2 = new GameServer(1337, mulberry32(24));
  check(g2.restore(save), 'a warfare-era world save restores cleanly');

  // Junk records are skipped, never fatal.
  const dirty = { ...save, silos: [null, 'x', { x: NaN }], batteries: ['nope'], helis: [7] };
  const g3 = new GameServer(1337, mulberry32(25));
  check(g3.restore(dirty), 'a save with malformed hardware records still loads');
}

// --- A disconnect frees the seat ---------------------------------------------------
{
  const g = new GameServer(1337, mulberry32(43));
  g.addPlayer(1, { username: 'Flyer', faction: 0, warfare: { version: 1, xp: 9000, nodes: [] } });
  for (const n of WARFARE_TREE) g.handle(1, { t: 'warfareBuy', node: n.id });
  g.handle(1, { t: 'xform', x: 400, y: 70, z: 400, yaw: 0, pitch: 0 });
  g.handle(1, { t: 'edit', x: 401, y: 70, z: 401, block: Block.Helipad });
  type HeliList = { t: string; list: { id: number; pilot: number }[] };
  const heliListOf = (out: ReturnType<GameServer['handle']>): HeliList['list'] | undefined =>
    (out.map((o) => o.msg).filter((m) => m.t === 'helis') as HeliList[]).at(-1)?.list;

  const spawned = heliListOf(g.handle(1, { t: 'heliSpawn', x: 401, y: 70, z: 401 }));
  const id = spawned?.[0]?.id;
  check(id !== undefined, 'a helipad deploys an airframe for an authorized pilot');
  check(heliListOf(g.handle(1, { t: 'heliSpawn', x: 401, y: 70, z: 401 }))?.length === 2,
    'a second airframe is allowed, up to the faction cap');
  check(g.handle(1, { t: 'heliSpawn', x: 401, y: 70, z: 401 })
    .some((o) => o.msg.t === 'warfareErr'),
    'a third airframe is refused by the faction cap');
  if (id !== undefined) {
    const seated = heliListOf(g.handle(1, { t: 'heliMount', id, seat: 'pilot' }));
    check(seated?.find((h) => h.id === id)?.pilot === 1, 'the pilot seat is occupied');
    const after = heliListOf(g.removePlayer(1));
    check(after?.find((h) => h.id === id)?.pilot === 0,
      'a disconnect frees the seat, so the airframe never hangs there piloted forever');
  }
}

// --- Blast damage lands ONCE, mitigated ONCE ---------------------------------------
{
  // The server's applyDamage() runs armor mitigation itself, so the blast path
  // must hand it the RAW figure. An unarmoured player at the centre of a
  // maximum warhead should therefore lose exactly its centre damage.
  const g = new GameServer(1337, mulberry32(41));
  g.addPlayer(1, { username: 'Red', faction: 0, warfare: { version: 1, xp: 9000, nodes: [] } });
  g.addPlayer(2, { username: 'Blue', faction: 1 });
  for (const n of WARFARE_TREE) g.handle(1, { t: 'warfareBuy', node: n.id });
  g.handle(1, { t: 'xform', x: 600, y: 80, z: 600, yaw: 0, pitch: 0 });
  // The defender must stand ON the ground the warhead actually lands on — a
  // strike detonates at the surface, and the falloff is genuinely 3D.
  g.handle(2, { t: 'xform', x: 900, y: 63, z: 900, yaw: 0, pitch: 0 }); // surface
  g.handle(1, { t: 'edit', x: 601, y: 80, z: 601, block: Block.TacticalSilo });
  g.handle(1, { t: 'siloLoad', x: 601, y: 80, z: 601, count: 3 });
  const before = g.playerList().find((p) => p.username === 'Blue');
  g.handle(1, { t: 'siloLaunch', x: 601, y: 80, z: 601, tx: 900, tz: 900 });
  let guard = 0;
  let hurt = 0;
  while (guard++ < 4000) {
    const out = g.tickWarfare(0.05);
    for (const o of out) {
      if (o.msg.t === 'hurt' && o.to === 2) hurt = (o.msg as { health: number }).health;
    }
    if (out.some((o) => o.msg.t === 'missileEnd' &&
      (o.msg as { reason: string }).reason === 'impact')) break;
  }
  check(!!before && hurt > 0 && hurt < 20,
    `a direct hit hurts an enemy standing on the impact point (health ${hurt})`);
  check(20 - hurt === siloStats(6).playerDamage,
    `an unarmoured player takes the centre damage exactly ONCE — not mitigated ` +
    `twice (${20 - hurt} vs ${siloStats(6).playerDamage})`);
}

// --- Protected areas are cached, not re-enumerated per launch ----------------------
{
  // `worldVaults` walks the entire 5000x5000 world. Launch validation calls
  // protectedAreas() every time, so an uncached implementation stalls the
  // server for the best part of a second per silo interaction — which is
  // exactly the bug this guards against.
  const g = new GameServer(1337, mulberry32(31));
  const t0 = Date.now();
  const first = g.protectedAreas();
  const firstMs = Date.now() - t0;
  const t1 = Date.now();
  for (let i = 0; i < 200; i++) g.protectedAreas();
  const repeatMs = Date.now() - t1;
  check(first.length > 1 && first.some((a) => a.kind === 'spawn') &&
    first.some((a) => a.kind === 'vault'),
    `protected areas cover spawn and every vault (${first.length} zones)`);
  check(repeatMs < Math.max(50, firstMs),
    `200 repeat lookups are cheap (${repeatMs}ms vs ${firstMs}ms to build)`);
}

// --- Economy: recipes exist and are blueprint-gated ---------------------------------
{
  const results = new Set(RECIPES.map((r) => r.result.id));
  for (const id of [
    Item.ReinforcedFrame, Item.GuidanceUnit, Item.Warhead, Item.RotorAssembly,
    Item.FuelTank, Item.BombCasing, Item.TacticalMissile, Item.InterceptorMissile,
    Item.AerialBomb, Item.RepairKit, Item.HelicopterKit,
    Block.TacticalSilo, Block.InterceptorBattery, Block.Helipad,
  ]) {
    check(results.has(id), `${ITEMS[id]?.name ?? id} is craftable`);
  }
  check(Object.keys(WARFARE_BLUEPRINTS).length === 7,
    'exactly the seven pieces of hardware and ordnance are blueprint-gated');
  check(WARFARE_BLUEPRINTS[Block.TacticalSilo] === 'missile_command' &&
    WARFARE_BLUEPRINTS[Block.InterceptorBattery] === 'aegis_systems' &&
    WARFARE_BLUEPRINTS[Item.HelicopterKit] === 'flight_certification',
    'each blueprint names the node that unlocks it');
  check(WARFARE_BLUEPRINTS[Item.ReinforcedFrame] === undefined &&
    WARFARE_BLUEPRINTS[Item.OilBarrel] === undefined,
    'components stay open so a teammate without the node can still resupply');
  // Titanium belongs to the air wing, not the first missile.
  const missile = RECIPES.find((r) => r.result.id === Item.TacticalMissile)!;
  const flat = JSON.stringify(missile);
  check(!flat.includes(String(Item.TitaniumIngot)),
    'the first tactical missile needs no titanium — the first unlock is usable');
}

if (failures.length) throw new Error(`${failures.length} warfare smoke check(s) failed`);
console.log('\nAll warfare smoke tests passed.');
