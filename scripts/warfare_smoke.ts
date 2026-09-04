// WARFARE COMMAND smoke tests.
//
// Covers the progression tree, boss-XP settlement (contribution, death, late
// join, spectators, reconnect, exactly-once), the offline/online parity of that
// settlement, the retirement of the old progression, the vehicle layer, and
// serialization/sanitization.

import {
  WARFARE_TREE, WARFARE_TREE_COST, WARFARE_MIGRATION_KEY, MAX_HARDWARE_TIER,
  buyWarfareNode,
  canBuyWarfareNode, grantWarfareXp, helicopterStats, migrateWarfare, newWarfare,
  newContribution, qualifiesForWarfareXp, sanitizeWarfare, settleWarfareXp,
  tierLabel, warfareAvailable, warfareBlockReason, warfareCompletion,
  warfareNode, warfareOwns, warfareSpent, warfareTier, warfareXpForTier,
  blastDamage, blastBlockCandidates, type ContributionRecord,
} from '../src/warfare';
import {
  VehicleSim, sanitizeHelicopter, sanitizeHeliInput, seatPosition, viewYawToHeliYaw,
  DISMOUNT_CLEARANCE, EJECT_DAMAGE, FAST_ROPE_LENGTH, HELI_FUEL_BURN, HELI_FUEL_IDLE, PASSENGER_ARC,
  fastRopeProgressDelta,
  SEAT_OFFSETS, type VehicleEvent,
} from '../src/vehicles';
import { VaultEncounter, type EncounterParticipant } from '../src/vault_encounter';
import { GameServer } from '../src/net/server_core';
import { Accounts } from '../src/net/accounts';
import { WARFARE_BLUEPRINTS, RECIPES } from '../src/crafting';
import { Block } from '../src/blocks';
import { Item, ITEMS } from '../src/items';
import { mulberry32 } from '../src/noise';
import { branchIconName, nodeIconName, warfareIconNames } from '../src/warfare_ui';

const failures: string[] = [];
const check = (condition: boolean, message: string): void => {
  if (condition) console.log(`PASS  ${message}`);
  else { console.error(`FAIL  ${message}`); failures.push(message); }
};

// --- The tree ---------------------------------------------------------------------
{
  check(WARFARE_TREE_COST === 3900,
    `the complete tree costs exactly 3,900 XP (got ${WARFARE_TREE_COST})`);
  check(WARFARE_TREE.length === 9 &&
    new Set(WARFARE_TREE.map((n) => n.id)).size === 9,
    'the tree is 9 uniquely-identified nodes');

  const branchCost = (b: string): number =>
    WARFARE_TREE.filter((n) => n.branch === b).reduce((a, n) => a + n.cost, 0);
  check(branchCost('trunk') === 600, `the trunk costs 600 XP (got ${branchCost('trunk')})`);
  check(branchCost('air') === 3300, `Aviation costs 3,300 XP (got ${branchCost('air')})`);

  // Every prerequisite exists and points strictly shallower — no cycles.
  check(WARFARE_TREE.every((n) =>
    n.prereq === '' || (warfareNode(n.prereq)?.depth ?? 99) < n.depth),
    'every prerequisite exists and is strictly shallower (no cycles)');
  check(WARFARE_TREE.filter((n) => n.prereq === '').length === 1,
    'the tree has exactly one root');

  // The certification ladder runs airframe, then ordnance, then armour.
  const s = newWarfare();
  grantWarfareXp(s, WARFARE_TREE_COST);
  check(canBuyWarfareNode(s, 'flight_certification') &&
    !canBuyWarfareNode(s, 'bomb_rack') &&
    !canBuyWarfareNode(s, 'air_turbine'),
    'the airframe must be certified before anything hangs off it');
  buyWarfareNode(s, 'flight_certification');
  check(canBuyWarfareNode(s, 'bomb_rack') && !canBuyWarfareNode(s, 'air_turbine'),
    'the bomb rack opens next, and the branch stays shut');
  for (const id of ['bomb_rack', 'reinforced_airframe']) buyWarfareNode(s, id);
  check(canBuyWarfareNode(s, 'air_turbine'),
    'the Aviation branch opens at the end of the trunk');

  // Buying the whole tree spends exactly the tree cost, and nothing is left.
  for (const n of WARFARE_TREE) buyWarfareNode(s, n.id);
  check(s.nodes.length === 9 && warfareSpent(s) === WARFARE_TREE_COST &&
    warfareAvailable(s) === 0 && warfareCompletion(s) === 1,
    'the exact tree budget buys the exact tree — no change left over');

  // Spending is gated on XP, not just prerequisites.
  const poor = newWarfare();
  grantWarfareXp(poor, 99);
  check(!canBuyWarfareNode(poor, 'flight_certification') &&
    (warfareBlockReason(poor, 'flight_certification') ?? '').includes('more warfare XP'),
    'a node you cannot afford is blocked with a clear reason');
  grantWarfareXp(poor, 1);
  check(canBuyWarfareNode(poor, 'flight_certification') &&
    warfareBlockReason(poor, 'flight_certification') === null,
    'the exact cost is enough');
  check((warfareBlockReason(poor, 'air_command') ?? '').startsWith('Requires'),
    'a node whose prerequisite is missing says so');

  // Hardware tiers are derived from owned nodes.
  const full = newWarfare();
  grantWarfareXp(full, WARFARE_TREE_COST);
  for (const n of WARFARE_TREE) buyWarfareNode(full, n.id);
  check(warfareTier(full, 'helicopter') === MAX_HARDWARE_TIER,
    'a complete tree authorizes the airframe to its top tier');
  check(warfareTier(newWarfare(), 'helicopter') === 0,
    'a fresh player may build nothing');

  // No filler: every node changes a real number or unlocks a system.
  check(WARFARE_TREE.every((n) => n.unlocks.length > 0),
    'every node states a concrete capability change');
}

// --- Stat ladders match the design table --------------------------------------------
{
  const h1 = helicopterStats(1), h5 = helicopterStats(5), h6 = helicopterStats(6);
  check(h1.hp === 140 && h1.speed === 16 && h1.fuel === 48 && h1.bombs === 2 &&
    h1.bombRadius === 7 && h1.bombBlocks === 40 && h1.bombPlayerDamage === 30 &&
    h1.bombHardwareDamage === 140 && h1.bombCooldown === 6 && h1.mark === 1,
    'the Mk I helicopter matches the design table');
  check(h5.hp === 190 && h5.speed === 20 && h5.fuel === 72 && h5.bombs === 4 &&
    h5.bombRadius === 9 && h5.bombBlocks === 80 && h5.bombPlayerDamage === 36 &&
    h5.bombHardwareDamage === 180 && h5.bombCooldown === 5 && h5.mark === 2,
    'the Mk II helicopter matches the design table');
  check(h6.hp === 220 && h6.speed === 24 && h6.fuel === 96 && h6.bombs === 5 &&
    h6.bombRadius === 11 && h6.bombBlocks === 140 && h6.bombPlayerDamage === 44 &&
    h6.bombHardwareDamage === 240 && h6.bombCooldown === 4 && h6.mark === 3,
    'the Mk III helicopter matches the design table');

  check(tierLabel(1) === 'Mk I' && tierLabel(6) === 'Mk VI' && tierLabel(99) === 'Mk VI',
    'tier labels are stable and clamped');
  // Stats are copies, never the shared table.
  const mutated = helicopterStats(1);
  mutated.hp = 1;
  check(helicopterStats(1).hp === 140, 'stat lookups hand back copies, not the table');
}

// --- Boss XP: tiers, qualification, exactly-once ---------------------------------
{
  check(warfareXpForTier(1) === 300 && warfareXpForTier(2) === 750 &&
    warfareXpForTier(3) === 1500 && warfareXpForTier(4) === 0,
    'boss tiers pay 300 / 750 / 1500 and nothing else pays at all');

  // The expected completion route reaches the tree cost.
  const route = 5 * 300 + 7 * 750 + 3 * 1500;
  check(route === 11250 && route >= WARFARE_TREE_COST,
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
    xp: 100, nodes: ['flight_certification', 'air_command', 'not_a_node'],
  });
  check(forged.nodes.length === 1 && forged.nodes[0] === 'flight_certification',
    'a hand-edited save cannot mint an unaffordable or prerequisite-less node');
  const chainless = sanitizeWarfare({ xp: 99999, nodes: ['air_command'] });
  check(chainless.nodes.length === 0,
    'a node whose whole prerequisite chain is missing is dropped');
  const legit = sanitizeWarfare({ xp: 500, nodes: ['flight_certification', 'bomb_rack'] });
  check(legit.nodes.length === 2 && warfareSpent(legit) === 300,
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
    accounts.buyWarfare('Pilot', 'flight_certification') &&
    warfareOwns(accounts.warfareOf('Pilot'), 'flight_certification'),
    'the account store earns and spends warfare XP');
  check(!accounts.buyWarfare('Pilot', 'air_command'),
    'the account store refuses an unaffordable purchase');
  const roundTrip = new Accounts(JSON.parse(JSON.stringify(accounts.toJSON())));
  check(roundTrip.warfareOf('Pilot').xp === 300 &&
    warfareOwns(roundTrip.warfareOf('Pilot'), 'flight_certification'),
    'warfare progression survives an account serialize round-trip');

  // The server exposes it on the welcome and honours purchases.
  const g = new GameServer(1337, mulberry32(7));
  g.setWarfare('Ace', { version: 1, xp: 400, nodes: [] });
  const welcome = g.addPlayer(1, { username: 'Ace', faction: 0, warfare: { version: 1, xp: 400, nodes: [] } })
    .find((o) => o.msg.t === 'welcome')!.msg as { warfare: { xp: number; nodes: string[] } };
  check(welcome.warfare.xp === 400 && welcome.warfare.nodes.length === 0,
    'the welcome carries the account\'s authoritative warfare state');
  const bought = g.handle(1, { t: 'warfareBuy', node: 'flight_certification' });
  check(bought.some((o) => o.msg.t === 'warfare' &&
    (o.msg as { nodes: string[] }).nodes.includes('flight_certification')),
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
  check(sim.passengerCanFire(2, h.rotation.y - Math.PI) &&
    !sim.passengerCanFire(2, h.rotation.y),
    `the gunner may only fire within ±${PASSENGER_ARC.toFixed(2)} rad of the nose`);
  check(viewYawToHeliYaw(0) === Math.PI,
    'helicopter steering rotates camera yaw 180 degrees to match the authored nose');

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
  sim.service(h, helicopterStats(1).fuel, 2, 0);
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

  // Dismount is always available; jumping out at altitude leaves the fall to physics.
  h.position.y = 64 + DISMOUNT_CLEARANCE + 10;
  check(sim.dismount(1).ok === true, 'you can step off at altitude and fall');
  h.position.y = 64 + 1;
  check(sim.dismount(2).ok === true, 'you can step off near the ground');

  // Collision costs hull.
  const h2 = sim.spawn('Ben', 0, { x: 100, y: 64, z: 100 }, 6);
  sim.mount(h2.id, 7, 0, { x: h2.position.x, y: h2.position.y, z: h2.position.z }, 'pilot');
  sim.service(h2, helicopterStats(6).fuel, 0, 0);
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
  const boom: VehicleEvent[] = [];
  while (h3.hp > 0) boom.push(...sim.damage(h3.id, 5, 'shot'));
  check(boom.filter((e) => e.kind === 'eject').length === 2 &&
    boom.some((e) => e.kind === 'heliDown') &&
    h3.pilotId === null && h3.passengerId === null,
    'repeated gunshots destroy a helicopter and eject/damage both occupants');
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
  sim.service(h4, helicopterStats(1).fuel, 0, 0);
  for (let i = 0; i < 40; i++) {
    sim.setInput(21, { forward: 0, strafe: 0, lift: 1, yaw: 0, seq: 900 + i });
    sim.tick(0.05);
  }
  const highY = h4.position.y;
  sim.clearOccupants();                       // simulate the disconnect sweep
  for (let i = 0; i < 200; i++) sim.tick(0.05);
  check(h4.position.y < highY && h4.position.y <= 66,
    'a pilotless airframe hovers, then settles to the ground');

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
  g.addPlayer(1, { username: 'Ana', faction: 0,
    warfare: { version: 1, xp: WARFARE_TREE_COST, nodes: [] } });
  // Authorize everything so the player may build.
  for (const n of WARFARE_TREE) g.handle(1, { t: 'warfareBuy', node: n.id });
  check(warfareTier(g.warfareOf('Ana'), 'helicopter') === MAX_HARDWARE_TIER,
    'the whole tree can be bought against a sufficient XP balance');

  const save = JSON.parse(JSON.stringify(g.serialize())) as Record<string, unknown>;
  check(Array.isArray(save.helis), 'the world save carries helicopters');
  check(save.factionXp === undefined,
    'the retired faction XP pool is no longer serialized');
  const g2 = new GameServer(1337, mulberry32(24));
  check(g2.restore(save), 'a warfare-era world save restores cleanly');

  // Junk records are skipped, never fatal.
  const dirty = { ...save, helis: [7, null, 'x', { x: NaN }] };
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
  type HeliList = { t: string; list: { id: number; pilot: number; passenger: number }[] };
  const heliListOf = (out: ReturnType<GameServer['handle']>): HeliList['list'] | undefined =>
    (out.map((o) => o.msg).filter((m) => m.t === 'helis') as HeliList[]).at(-1)?.list;

  const spawned = heliListOf(g.handle(1, { t: 'heliSpawn', x: 401, y: 70, z: 401 }));
  const id = spawned?.[0]?.id;
  check(id !== undefined, 'a helipad deploys an airframe for an authorized pilot');
  check(heliListOf(g.handle(1, { t: 'heliSpawn', x: 401, y: 70, z: 401 }))?.length === 2,
    'a second airframe is allowed');
  check(heliListOf(g.handle(1, { t: 'heliSpawn', x: 401, y: 70, z: 401 }))?.length === 3,
    'a faction may deploy more than two airframes');
  if (id !== undefined) {
    const seated = heliListOf(g.handle(1, { t: 'heliMount', id, seat: 'pilot' }));
    check(seated?.find((h) => h.id === id)?.pilot === 1, 'the pilot seat is occupied');
    // Simulate legacy/corrupt restored state that has duplicated the player in
    // another seat. Disconnect cleanup must be a sweep, not a first-match exit.
    const other = [...g.vehicles.helicopters.values()].find((h) => h.id !== id);
    if (other) other.passengerId = 1;
    const after = heliListOf(g.removePlayer(1));
    check(after?.find((h) => h.id === id)?.pilot === 0,
      'a disconnect frees the seat, so the airframe never hangs there piloted forever');
    check(!after?.some((h) => h.pilot === 1 || h.passenger === 1),
      'a disconnect removes every stale helicopter occupant reference');
  }
}

// --- Aircraft are broadcast on EVERY flight tick ------------------------------------
{
  // A helicopter carries the camera of whoever is flying it, so its snapshot
  // rate IS that player's frame rate as far as the ride feels. Anything slower
  // than the 20 Hz flight tick leaves the client inventing motion between
  // packets, which is what made flying feel like a slideshow — so every tick
  // with an airframe in the world must carry a pose for it.
  const g = new GameServer(1337, mulberry32(47));
  g.addPlayer(1, { username: 'Flyer', faction: 0, warfare: { version: 1, xp: 9000, nodes: [] } });
  for (const n of WARFARE_TREE) g.handle(1, { t: 'warfareBuy', node: n.id });
  g.handle(1, { t: 'xform', x: 400, y: 70, z: 400, yaw: 0, pitch: 0 });
  g.handle(1, { t: 'edit', x: 401, y: 70, z: 401, block: Block.Helipad });
  g.handle(1, { t: 'heliSpawn', x: 401, y: 70, z: 401 });
  let ticks = 0;
  let carried = 0;
  for (let i = 0; i < 20; i++) {
    ticks++;
    if (g.tickWarfare(0.05).some((o) => o.msg.t === 'helis')) carried++;
  }
  check(carried === ticks,
    `every flight tick carries an aircraft pose (${carried}/${ticks})`);

  // …and an empty sky costs nothing: no airframes, no snapshot traffic.
  const quiet = new GameServer(1337, mulberry32(48));
  check(!quiet.tickWarfare(0.05).some((o) => o.msg.t === 'helis'),
    'but a sky with nothing in it broadcasts no aircraft at all');
}

// --- Blast damage lands ONCE, mitigated ONCE ---------------------------------------
{
  // The server's applyDamage() runs armor mitigation itself, so the blast path
  // must hand it the RAW figure. An unarmoured player at the centre of a
  // maximum bomb should therefore lose exactly its centre damage.
  const max = helicopterStats(MAX_HARDWARE_TIER);
  check(blastDamage(max.bombPlayerDamage, 0, max.bombRadius) === max.bombPlayerDamage,
    'a target at the exact centre takes the full centre damage');
  check(blastDamage(max.bombPlayerDamage, max.bombRadius, max.bombRadius) === 0,
    'a target on the rim takes nothing');
  check(blastDamage(max.bombPlayerDamage, max.bombRadius / 2, max.bombRadius) ===
    Math.round(max.bombPlayerDamage / 2),
    'falloff from the centre is linear');
  check(blastDamage(max.bombPlayerDamage, 500, max.bombRadius) === 0,
    'nothing outside the radius is touched');

  // The candidate sphere is ordered nearest-first and never leaves the radius,
  // so a bounded block cap always removes the blocks closest to the impact.
  const cands = blastBlockCandidates(0, 64, 0, 7);
  check(cands.length > 0 && cands.every((c) => c.d <= 7),
    'every blast candidate lies inside the radius');
  check(cands.every((c, i) => i === 0 || c.d >= cands[i - 1].d),
    'blast candidates come back nearest-first, so the cap bites at the rim');
}

// --- Economy: recipes exist and are blueprint-gated ---------------------------------
{
  const results = new Set(RECIPES.map((r) => r.result.id));
  for (const id of [
    Item.ReinforcedFrame, Item.GuidanceUnit, Item.RotorAssembly,
    Item.FuelTank, Item.BombCasing,
    Item.AerialBomb, Item.RepairKit, Item.HelicopterKit,
    Item.RopeWinch, Item.AuxiliaryTank, Item.LongRangeTank,
    Block.Helipad,
  ]) {
    check(results.has(id), `${ITEMS[id]?.name ?? id} is craftable`);
  }
  check(Object.keys(WARFARE_BLUEPRINTS).length === 6,
    'exactly six pieces of hardware, modules and ordnance are blueprint-gated');
  check(WARFARE_BLUEPRINTS[Block.Helipad] === 'flight_certification' &&
    WARFARE_BLUEPRINTS[Item.HelicopterKit] === 'flight_certification' &&
    WARFARE_BLUEPRINTS[Item.AerialBomb] === 'flight_certification',
    'each blueprint names the node that unlocks it');
  check(WARFARE_BLUEPRINTS[Item.ReinforcedFrame] === undefined &&
    WARFARE_BLUEPRINTS[Item.OilBarrel] === undefined,
    'components stay open so a teammate without the node can still resupply');
  // Titanium belongs to the airframe itself, not to its consumable ordnance.
  const bomb = RECIPES.find((r) => r.result.id === Item.AerialBomb)!;
  check(!JSON.stringify(bomb).includes(String(Item.TitaniumIngot)),
    'an aerial bomb needs no titanium — resupply never waits on a titanium run');
}

// --- Presentation: the tree screen is emoji-free and fully iconed ------------------
// The Warfare Command panel draws every glyph as an inline SVG, so a node that
// pointed at a mark the set doesn't define would render as a blank chip on the
// player's screen — and the fallback would hide it from a visual check.
{
  const known = new Set(warfareIconNames());
  check(known.size >= 14, 'the icon set defines a mark for every kind of hardware');
  for (const node of WARFARE_TREE) {
    check(known.has(nodeIconName(node)), `${node.name} draws a defined SVG icon`);
  }
  for (const branch of ['trunk', 'air'] as const) {
    check(known.has(branchIconName(branch)), `the ${branch} branch draws a defined SVG icon`);
  }
  // Distinct marks: two technologies wearing the same icon is a design bug, not
  // a crash, so nothing else would ever catch it.
  const marks = WARFARE_TREE.map(nodeIconName);
  check(new Set(marks).size === marks.length,
    'every technology in the tree wears a distinct icon');
  // Chrome the panel needs by name — a rename would silently blank a button.
  for (const name of ['close', 'recenter', 'plus', 'minus', 'check', 'lock', 'spark', 'chevron']) {
    check(known.has(name), `panel chrome icon "${name}" exists`);
  }
}


// --- Helicopter overhaul: controls, thirst, collision, crashes, seats ------------
{
  const freeSim = (): VehicleSim => new VehicleSim({
    solid: () => false, groundY: () => 64, worldHalf: 2500, vaultArena: () => false,
  });

  // STRAFE DIRECTION. The authored airframe faces local +Z, so with Y up its own
  // starboard side is local −X. Pressing D (strafe +1) must move the aircraft to
  // the PILOT'S RIGHT, which for a nose pointing down world −Z is world −X.
  {
    const sim = freeSim();
    const h = sim.spawn('Ana', 0, { x: 0, y: 64, z: 0 }, 1);
    sim.mount(h.id, 1, 0, { x: h.position.x, y: h.position.y, z: h.position.z }, 'pilot');
    sim.service(h, helicopterStats(1).fuel, 0, 0);
    // Camera yaw 0 faces world −Z; viewYawToHeliYaw turns that into the airframe
    // heading that points the nose the same way. Set it directly: the sim SLEWS
    // heading at 2.6 rad/s, and this test is about the strafe axis, not the turn.
    const heading = viewYawToHeliYaw(0);
    h.rotation.y = heading;
    const startX = h.position.x;
    for (let i = 0; i < 30; i++) {
      sim.setInput(1, { forward: 0, strafe: 1, lift: 0, yaw: heading, seq: 1 + i });
      sim.tick(0.05);
    }
    // Facing world −Z, the pilot's right hand points at world +X
    // (right = forward × up = (0,0,−1) × (0,1,0) = (1,0,0)).
    check(h.position.x > startX + 1,
      'pressing D with the nose down −Z slides the aircraft to the pilot\'s right (+X)');
    check(h.rotation.z > 0.05,
      'and it banks INTO that slide rather than away from it');
  }

  // A LEFT strafe must be the exact mirror — the fix is one sign, not a fudge.
  {
    const sim = freeSim();
    const h = sim.spawn('Ana', 0, { x: 0, y: 64, z: 0 }, 1);
    sim.mount(h.id, 1, 0, { x: h.position.x, y: h.position.y, z: h.position.z }, 'pilot');
    sim.service(h, helicopterStats(1).fuel, 0, 0);
    const heading = viewYawToHeliYaw(0);
    h.rotation.y = heading;
    for (let i = 0; i < 30; i++) {
      sim.setInput(1, { forward: 0, strafe: -1, lift: 0, yaw: heading, seq: 1 + i });
      sim.tick(0.05);
    }
    check(h.position.x < -1, 'and A slides it to the pilot\'s left (−X)');
  }

  // OIL HUNGER. Hovering costs fuel even with the stick centred, and full
  // deflection costs much more.
  {
    const idle = freeSim();
    const a = idle.spawn('Ana', 0, { x: 0, y: 64, z: 0 }, 1);
    idle.mount(a.id, 1, 0, { x: a.position.x, y: a.position.y, z: a.position.z }, 'pilot');
    idle.service(a, helicopterStats(1).fuel, 0, 0);
    for (let i = 0; i < 20; i++) {
      idle.setInput(1, { forward: 0, strafe: 0, lift: 0, yaw: 0, seq: 1 + i });
      idle.tick(0.05);
    }
    const idleBurn = helicopterStats(1).fuel - a.fuel;

    const hard = freeSim();
    const b = hard.spawn('Ben', 0, { x: 0, y: 64, z: 0 }, 1);
    hard.mount(b.id, 1, 0, { x: b.position.x, y: b.position.y, z: b.position.z }, 'pilot');
    hard.service(b, helicopterStats(1).fuel, 0, 0);
    for (let i = 0; i < 20; i++) {
      hard.setInput(1, { forward: 1, strafe: 1, lift: 1, yaw: 0, seq: 1 + i });
      hard.tick(0.05);
    }
    const hardBurn = helicopterStats(1).fuel - b.fuel;
    check(idleBurn > 0, 'simply hovering burns oil — the turbine is running either way');
    check(hardBurn > idleBurn * 1.8,
      `full deflection is far thirstier than a hover (${hardBurn.toFixed(2)} vs ${idleBurn.toFixed(2)})`);
    // A full Mk I tank should be minutes, not hours: the whole point is that a
    // sortie has to be planned around the return leg.
    const endurance = helicopterStats(1).fuel / (HELI_FUEL_IDLE + HELI_FUEL_BURN);
    check(endurance > 20 && endurance < 120,
      `a full Mk I tank is ${Math.round(endurance)}s of hard flying — thirsty but flyable`);
  }

  // FLAMEOUT. Run the tank dry in the air and the crew is thrown clear while the
  // airframe falls; nobody is left flying an aircraft with no fuel in it.
  {
    const sim = freeSim();
    const h = sim.spawn('Ana', 0, { x: 0, y: 140, z: 0 }, 1);
    sim.mount(h.id, 1, 0, { x: h.position.x, y: h.position.y, z: h.position.z }, 'pilot');
    sim.mount(h.id, 2, 0, { x: h.position.x, y: h.position.y, z: h.position.z }, 'passenger');
    h.fuel = 0.3;
    let ejects = 0;
    let downReason = '';
    let guard = 0;
    while (guard++ < 200 && !downReason) {
      sim.setInput(1, { forward: 1, strafe: 0, lift: 1, yaw: 0, seq: guard });
      for (const ev of sim.tick(0.05)) {
        if (ev.kind === 'eject') ejects++;
        if (ev.kind === 'heliDown') downReason = ev.reason;
      }
    }
    check(downReason === 'flameout', 'running the tank dry reports a flameout, not a shootdown');
    check(ejects === 2, 'and throws BOTH crew members clear');
    check(h.pilotId === null && h.passengerId === null && h.dying > 0,
      'leaving an empty airframe falling out of the sky');
  }

  // COLLISION. The whole box is sampled, so an airframe cannot sit inside a wall
  // its own cabin overlaps. The old single-point test at the hub passed straight
  // through this.
  {
    const wall = new Set<string>();
    // A slab of solid cells the airframe would have to eat its nose into.
    for (let y = 60; y < 70; y++) {
      for (let x = -6; x <= 6; x++) {
        for (let z = -14; z >= -16; z--) wall.add(`${x},${y},${z}`);
      }
    }
    const sim = new VehicleSim({
      solid: (x, y, z) => wall.has(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`),
      groundY: () => 50, worldHalf: 2500, vaultArena: () => false,
    });
    const h = sim.spawn('Ana', 0, { x: 0, y: 63, z: 0 }, 6);
    sim.mount(h.id, 1, 0, { x: h.position.x, y: h.position.y, z: h.position.z }, 'pilot');
    sim.service(h, helicopterStats(6).fuel, 0, 0);
    const heading = viewYawToHeliYaw(0);   // nose down −Z, straight at the wall
    h.rotation.y = heading;
    let guard = 0;
    while (guard++ < 200 && h.dying <= 0 && h.position.z > -12) {
      sim.setInput(1, { forward: 1, strafe: 0, lift: 0, yaw: heading, seq: guard });
      sim.tick(0.05);
    }
    // Whatever happened (stopped short or exploded), it must never have ended a
    // tick with its hull buried in the slab.
    check(h.position.z > -13.9,
      `the airframe never penetrates the wall (stopped at z=${h.position.z.toFixed(2)})`);
  }

  // CRASHING. Cruising into a cliff destroys the aircraft and LAUNCHES the crew.
  {
    const wall = new Set<string>();
    for (let y = 55; y < 80; y++) {
      for (let x = -8; x <= 8; x++) {
        for (let z = -20; z >= -24; z--) wall.add(`${x},${y},${z}`);
      }
    }
    const sim = new VehicleSim({
      solid: (x, y, z) => wall.has(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`),
      groundY: () => 50, worldHalf: 2500, vaultArena: () => false,
    });
    const h = sim.spawn('Ana', 0, { x: 0, y: 64, z: 0 }, 1);
    sim.mount(h.id, 1, 0, { x: h.position.x, y: h.position.y, z: h.position.z }, 'pilot');
    sim.service(h, helicopterStats(1).fuel, 0, 0);
    const heading = viewYawToHeliYaw(0);
    h.rotation.y = heading;
    let crash: VehicleEvent | undefined;
    let eject: VehicleEvent | undefined;
    let guard = 0;
    while (guard++ < 400 && !crash) {
      sim.setInput(1, { forward: 1, strafe: 0, lift: 0, yaw: heading, seq: guard });
      for (const ev of sim.tick(0.05)) {
        if (ev.kind === 'heliDown' && ev.reason === 'crash') crash = ev;
        if (ev.kind === 'eject') eject = ev;
      }
    }
    check(!!crash, 'flying a Mk I into a cliff face at cruise destroys the airframe');
    check(!!eject && eject.kind === 'eject' &&
      Math.hypot(eject.vx, eject.vy, eject.vz) > 9,
      'and physically launches the pilot rather than setting them down');
    check(!!eject && eject.kind === 'eject' && eject.damage > EJECT_DAMAGE,
      'a crash hurts more than a routine ejection — bad gear will not survive it');
  }

  // …but SETTING DOWN is landing, not crashing. A descent at the airframe's own
  // climb rate must not cost the hull.
  {
    const sim = freeSim();
    const h = sim.spawn('Ana', 0, { x: 0, y: 90, z: 0 }, 1);
    sim.mount(h.id, 1, 0, { x: h.position.x, y: h.position.y, z: h.position.z }, 'pilot');
    sim.service(h, helicopterStats(1).fuel, 0, 0);
    const full = h.hp;
    for (let i = 0; i < 400 && h.position.y > 65.3; i++) {
      sim.setInput(1, { forward: 0, strafe: 0, lift: -1, yaw: 0, seq: 1 + i });
      sim.tick(0.05);
    }
    check(h.hp === full && h.dying <= 0,
      'descending at full rate onto the ground is a landing, and costs nothing');
    check(sim.landed(h), 'and the sim agrees the airframe is parked');
  }

  // SERVICING no longer needs a helipad — just the ground, and a full stop.
  {
    const sim = freeSim();
    const h = sim.spawn('Ana', 0, { x: 0, y: 64, z: 0 }, 1);   // pad at the origin
    h.position = { x: 900, y: 65.25, z: 900 };   // flown a long way from it
    h.velocity = { x: 0, y: 0, z: 0 };
    check(!sim.atPad(h), 'an airframe flown away from its pad is not at its pad');
    check(sim.canService(h),
      'but it can still be refuelled where it stands, because it is on the ground');
    h.velocity = { x: 9, y: 0, z: 0 };
    check(!sim.canService(h), 'a moving airframe cannot be serviced');
    h.velocity = { x: 0, y: 0, z: 0 };
    h.position = { x: 900, y: 120, z: 900 };
    check(!sim.canService(h), 'and neither can one that is still in the air');
  }

  // SEATS: side by side at the front, so both crew see out of the windscreen,
  // and the PILOT sits on the port side (local +X on a +Z-forward model).
  {
    check(SEAT_OFFSETS.pilot.x > 0 && SEAT_OFFSETS.passenger.x < 0,
      'the pilot sits to port and the gunner to starboard');
    check(Math.abs(SEAT_OFFSETS.pilot.z - SEAT_OFFSETS.passenger.z) < 1e-6 &&
      SEAT_OFFSETS.pilot.z > 0,
      'both seats are level with each other at the front of the cabin');
    check(SEAT_OFFSETS.pilot.y < 0,
      'and the seat pan sits below the rotor hub, inside the cabin');
  }

  // CREW ROLES: the gunner shoots inside the forward arc; the pilot never does.
  {
    const sim = freeSim();
    const h = sim.spawn('Ana', 0, { x: 0, y: 64, z: 0 }, 1);
    const at = { x: h.position.x, y: h.position.y, z: h.position.z };
    sim.mount(h.id, 1, 0, at, 'pilot');
    sim.mount(h.id, 2, 0, at, 'passenger');
    check(!sim.passengerCanFire(1, h.rotation.y - Math.PI),
      'a pilot flying the aircraft cannot fire, however they are looking');
    check(sim.passengerCanFire(2, h.rotation.y - Math.PI),
      'the gunner can fire straight over the nose');
    check(!sim.passengerCanFire(2, h.rotation.y),
      'but not backwards through the bulkhead');
    check(sim.passengerCanFire(99, 0),
      'and someone who is not aboard anything is unaffected by the rule');
  }

  // The BOMB RACK still works end to end after the rework: one release per
  // round, a cooldown between them, and exactly one impact per bomb.
  {
    const sim = freeSim();
    const h = sim.spawn('Ana', 0, { x: 0, y: 90, z: 0 }, 6);
    sim.mount(h.id, 1, 0, { x: h.position.x, y: h.position.y, z: h.position.z }, 'pilot');
    const maxBombs = helicopterStats(6).bombs;
    sim.service(h, helicopterStats(6).fuel, maxBombs, 0);
    check(h.bombs === maxBombs, 'the rack fills to the airframe\'s capacity');
    let released = 0;
    let impacts = 0;
    let guard = 0;
    while (guard++ < 4000 && (h.bombs > 0 || sim.bombs.size)) {
      if (sim.dropBomb(1).length) released++;
      for (const ev of sim.tick(0.05)) if (ev.kind === 'bombImpact') impacts++;
    }
    check(released === maxBombs, `every round on the rack can be released (${released})`);
    check(impacts === maxBombs, 'and each one produces exactly one impact');
    check(h.bombs === 0 && sim.dropBomb(1).length === 0, 'an empty rack releases nothing');
  }
}

// --- Field deploy: an airframe without a helipad ----------------------------------
{
  const g = new GameServer(1337, mulberry32(71));
  g.addPlayer(1, { username: 'Ana', faction: 0,
    warfare: { version: 1, xp: WARFARE_TREE_COST, nodes: [] } });
  for (const n of WARFARE_TREE) g.handle(1, { t: 'warfareBuy', node: n.id });
  const owned = g.warfareOf('Ana');
  check(warfareOwns(owned, 'air_aux_tanks') &&
    warfareOwns(owned, 'air_long_range_tanks') && warfareOwns(owned, 'air_fast_rope'),
  `server purchase route authorizes all airframe modules (${owned.nodes.length} nodes)`);
  type HeliList = { t: string; list: { id: number; pilot: number; ropeDeployed: boolean }[] };
  const heliListOf = (out: ReturnType<GameServer['handle']>): HeliList['list'] | undefined =>
    (out.map((o) => o.msg).filter((m) => m.t === 'helis') as HeliList[]).at(-1)?.list;
  const errOf = (out: ReturnType<GameServer['handle']>): string | undefined =>
    (out.map((o) => o.msg).find((m) => m.t === 'warfareErr') as { reason: string } | undefined)
      ?.reason;

  // Stand somewhere with a solid cell under us — well clear of any helipad —
  // and assemble an airframe straight onto it.
  const PAD_Y = 140;   // above any terrain, so the footing is exactly what we lay
  g.handle(1, { t: 'xform', x: 400, y: PAD_Y, z: 400, yaw: 0, pitch: 0 });
  g.handle(1, { t: 'edit', x: 400, y: PAD_Y - 1, z: 400, block: Block.Stone });
  const deployed = heliListOf(g.handle(1, { t: 'heliDeploy', x: 400, y: PAD_Y, z: 400 }));
  check(deployed?.length === 1,
    'a Helicopter Airframe deploys on open ground with no helipad in sight');

  // Out of reach is refused, so this cannot conjure aircraft across the map.
  const far = g.handle(1, { t: 'heliDeploy', x: 900, y: PAD_Y, z: 900 });
  check(heliListOf(far) === undefined, 'deploying out of arm\'s reach is refused');

  // Mid-air is refused: the skids need something to stand on.
  const air = g.handle(1, { t: 'heliDeploy', x: 401, y: PAD_Y + 4, z: 401 });
  check(!!errOf(air) && heliListOf(air) === undefined,
    'and so is assembling one in mid-air');

  // Boarding one you deployed still works, and a disconnect still frees the seat.
  const id = deployed?.[0]?.id;
  if (id !== undefined) {
    for (const item of [Item.AuxiliaryTank, Item.LongRangeTank, Item.RopeWinch]) {
      const installed = g.handle(1, { t: 'heliModule', id, item });
      check(installed.some((o) => o.to === 1 && o.msg.t === 'heliModuleInstalled' &&
        o.msg.item === item), `${ITEMS[item].name} installs through server confirmation` +
        (errOf(installed) ? ` (${errOf(installed)})` : ''));
    }
    const seated = heliListOf(g.handle(1, { t: 'heliMount', id, seat: 'pilot' }));
    check(seated?.find((h) => h.id === id)?.pilot === 1,
      'you can board a field-deployed airframe');
    const deployedRope = g.handle(1, { t: 'heliRope', action: 'toggle' });
    check(heliListOf(deployedRope)?.find((h) => h.id === id)?.ropeDeployed === true,
      'the server accepts the installed pilot rope control');
    const transfer = g.handle(1, { t: 'heliRope', action: 'attach' });
    check(transfer.some((o) => o.to === 1 && o.msg.t === 'heliSeat' && o.msg.seat === null) &&
      transfer.some((o) => o.to === 1 && o.msg.t === 'heliRopeState' && o.msg.id === id),
    'F-style transfer leaves the seat and attaches to that airframe rope');
    g.handle(1, { t: 'heliRope', action: 'move', motion: 1 });
    const ropeTick = g.tickWarfare(0.5);
    check(ropeTick.some((o) => o.to === 1 && o.msg.t === 'heliRopeState' && o.msg.progress > 0),
      'rope climb progress is advanced and echoed by the authoritative tick');
    const dropped = g.handle(1, { t: 'heliRope', action: 'drop' });
    check(dropped.some((o) => o.to === 1 && o.msg.t === 'heliRopeState' && o.msg.id === 0),
      'Space-style drop clears authoritative rope membership');
  }
}

// --- Operations modules + persistent demolition ------------------------------
{
  const sim = new VehicleSim({
    solid: () => false, groundY: () => 0, worldHalf: 1000, vaultArena: () => false,
  });
  const h = sim.spawn('Ace', 0, { x: 0, y: 0, z: 0 }, 1);
  check(sim.installModule(h, 'auxTank') && sim.installModule(h, 'longRangeTank') &&
    sim.installModule(h, 'ropeWinch'),
  'landed airframes accept the ordered tank upgrades and fast-rope winch');
  sim.service(h, 1000, 0, 0);
  check(h.fuel === helicopterStats(1).fuel * 3,
    'long-range tanks triple capacity without changing base airframe stats');
  sim.mount(h.id, 77, 0, h.position, 'pilot');
  check(sim.toggleRope(77), 'the pilot can deploy an installed fast rope');
  check(h.ropeLength === FAST_ROPE_LENGTH && FAST_ROPE_LENGTH >= 32,
    'the deployed fast rope reaches far below a hovering helicopter');
  check(fastRopeProgressDelta(1, 1, FAST_ROPE_LENGTH) >
    Math.abs(fastRopeProgressDelta(-1, 1, FAST_ROPE_LENGTH)),
  'sliding down the fast rope is quicker than climbing it');
  sim.dismount(77);
  const before = h.fuel, y = h.position.y;
  sim.tick(1);
  check(h.ropeDeployed && h.position.y === y && h.fuel < before,
    'a deployed rope holds pilotless hover while continuing idle fuel burn');
  const attached = sim.attachRope(88, 0,
    { x: h.position.x, y: h.position.y - 0.75 - h.ropeLength, z: h.position.z }, h.id);
  check(attached.ok, 'a nearby faction member attaches to the deployed rope');
  if (attached.ok) {
    const start = attached.rider.progress;
    sim.setRopeMotion(88, -1);
    sim.tick(0.5);
    check((sim.ropeRider(88)?.progress ?? start) < start,
      'W climbs toward the winch in shared simulation state');
    sim.detachRope(88);
    check(sim.ropePosition(88) === null, 'dropping removes the rope position immediately');
  }

}

if (failures.length) throw new Error(`${failures.length} warfare smoke check(s) failed`);
console.log('\nAll warfare smoke tests passed.');
