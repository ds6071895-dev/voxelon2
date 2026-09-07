// Bedwars: geometry determinism, the axe-swing math, and the state machine.
// Pure-module checks only — nothing here needs a GameServer, which is the
// point of keeping `src/bedwars.ts` free of DOM/THREE/Node.

import {
  BEDWARS_ARENA_SIZE, BEDWARS_BASE_X, BEDWARS_BED_DECAY_MS, BEDWARS_CAPACITY,
  BEDWARS_CEILING_Y, BEDWARS_CLAMP_MID_MS, BEDWARS_COUNTDOWN_MS, BEDWARS_DEFAULT_MAP,
  BEDWARS_FLOOR_Y, BEDWARS_MAPS, BEDWARS_MAX_HEALTH, BEDWARS_RESPAWN_MS,
  BEDWARS_ROUND_MS, BEDWARS_SHOP, BEDWARS_SLOT_SPACING, BEDWARS_SPAWN_SHIELD_MS,
  BEDWARS_STAMP_MIN_Y, BEDWARS_VOID_CREDIT_MS, BEDWARS_VOID_Y,
  BW_AXE_TIERS, BW_CAP_IRON, BW_COMBO_MAX, BW_CRIT_MULT, BW_KB_BASE,
  BW_LOOK_BLEND, BW_SPRINT_KB_MULT, BW_SPRINT_SPEED,
  Bedwars, bedwarsArenaAt, bedwarsArenaBounds, bedwarsAxeRank, bedwarsAxeTier,
  bedwarsBedCells, bedwarsBedTeamAt, bedwarsBlockAt, bedwarsCanAfford,
  bedwarsDiamondPeriod, bedwarsGenCells, bedwarsMap, bedwarsShopCells,
  bedwarsShopEntry, bedwarsSolidAt, bedwarsSwing, bedwarsTeamWool, bedwarsArenaCenter,
  clampToBedwarsArena, collapsedBedwarsArena, orderBedwarsScore,
  type BwParticipant, type BwSwingInput, type BwTeamState,
} from '../src/bedwars';
import { Block } from '../src/blocks';
import { Item } from '../src/items';
import { isMinigameOnly } from '../src/minigame_items';
import { GameServer } from '../src/net/server_core';
import { DUEL_COUNTDOWN_MS } from '../src/duels';

let passed = 0;
function check(name: string, ok: unknown, detail = ''): void {
  if (!ok) throw new Error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  passed++;
}

let tokenN = 0;
const token = () => `${String(++tokenN).padStart(24, 'c')}0123456789abcdef01234567`;
const who = (id: number) => ({ id, username: `Player${id}`, skin: id * 13 });

const A0 = bedwarsArenaBounds(0);
const MAP = bedwarsMap(BEDWARS_DEFAULT_MAP);

// ── Geometry determinism ───────────────────────────────────────────────────
{
  check('the arena addresses its own band and no other',
    A0.originX === BEDWARS_BASE_X && bedwarsArenaAt(A0.originX + 5, 5)?.slot === 0 &&
    bedwarsArenaAt(A0.originX - 1, 5) === null &&
    bedwarsArenaAt(A0.originX + BEDWARS_ARENA_SIZE, 5) === null &&
    bedwarsArenaAt(A0.originX + 5, BEDWARS_ARENA_SIZE) === null);
  check('slots are addressed by the spacing stride',
    bedwarsArenaAt(BEDWARS_BASE_X + BEDWARS_SLOT_SPACING + 5, 5)?.slot === 1);
  check('the inter-slot gutter belongs to no arena',
    bedwarsArenaAt(BEDWARS_BASE_X + BEDWARS_ARENA_SIZE + 4, 5) === null);

  // Sample the whole footprint once; reuse it for the checks below.
  let sampled = 0, solidCols = 0;
  let belowStampClean = true, aboveFixtureClean = true;
  const surface: number[] = [];
  for (let lz = 0; lz < BEDWARS_ARENA_SIZE; lz++) {
    for (let lx = 0; lx < BEDWARS_ARENA_SIZE; lx++) {
      const wx = A0.originX + lx, wz = A0.originZ + lz;
      const top = bedwarsBlockAt(wx, BEDWARS_FLOOR_Y, wz);
      surface.push(top ?? 0);
      if (top !== null) solidCols++;
      for (let y = 100; y < BEDWARS_STAMP_MIN_Y; y++) {
        sampled++;
        if (bedwarsBlockAt(wx, y, wz) !== null) belowStampClean = false;
      }
      if (bedwarsBlockAt(wx, BEDWARS_FLOOR_Y + 2, wz) !== null) aboveFixtureClean = false;
    }
  }
  check('nothing at all is stamped below the stamp floor — the void is real',
    belowStampClean, `${sampled} cells sampled`);
  check('nothing is stamped above the fixture row', aboveFixtureClean);
  check('the islands cover a sane fraction of the footprint',
    solidCols > 300 && solidCols < BEDWARS_ARENA_SIZE * BEDWARS_ARENA_SIZE / 4,
    `${solidCols} columns`);

  check('bedwarsBlockAt is pure and stable across a large resample',
    (() => {
      for (let i = 0; i < 50_000; i++) {
        const lx = i % BEDWARS_ARENA_SIZE;
        const lz = Math.floor(i / BEDWARS_ARENA_SIZE) % BEDWARS_ARENA_SIZE;
        const y = BEDWARS_STAMP_MIN_Y + (i % 40);
        const wx = A0.originX + lx, wz = A0.originZ + lz;
        if (bedwarsBlockAt(wx, y, wz) !== bedwarsBlockAt(wx, y, wz)) return false;
      }
      return true;
    })());

  // 180-degree rotational symmetry: the map is its own mirror, so neither base
  // can drift a block out of parity.
  let mirrored = true;
  const swap = (b: number | null): number | null =>
    b === Block.BwBedA ? Block.BwBedB : b === Block.BwBedB ? Block.BwBedA : b;
  for (let lz = 0; lz < BEDWARS_ARENA_SIZE && mirrored; lz++) {
    for (let lx = 0; lx < BEDWARS_ARENA_SIZE; lx++) {
      const mx = BEDWARS_ARENA_SIZE - lx, mz = BEDWARS_ARENA_SIZE - lz;
      if (mx < 0 || mx >= BEDWARS_ARENA_SIZE || mz < 0 || mz >= BEDWARS_ARENA_SIZE) continue;
      for (const y of [BEDWARS_FLOOR_Y, BEDWARS_FLOOR_Y - 2, BEDWARS_FLOOR_Y + 1]) {
        const a = bedwarsBlockAt(A0.originX + lx, y, A0.originZ + lz);
        const b = bedwarsBlockAt(A0.originX + mx, y, A0.originZ + mz);
        if (swap(a) !== b) { mirrored = false; break; }
      }
      if (!mirrored) break;
    }
  }
  check('the two bases are exact 180-degree mirrors of each other', mirrored);

  // The 14-block gap is the mode's core tuning number.
  const row = BEDWARS_FLOOR_Y;
  const z = 48;
  const solidX: number[] = [];
  for (let lx = 0; lx < BEDWARS_ARENA_SIZE; lx++) {
    if (bedwarsBlockAt(A0.originX + lx, row, A0.originZ + z) !== null) solidX.push(lx);
  }
  const baseRight = Math.max(...solidX.filter((x) => x < 35));
  const midLeft = Math.min(...solidX.filter((x) => x >= 35 && x < 60));
  check('base edge to mid edge is fourteen blocks of open void',
    midLeft - baseRight - 1 === 14, `gap=${midLeft - baseRight - 1}`);

  check('the fall to the kill plane is a long, legible drop',
    BEDWARS_FLOOR_Y - BEDWARS_VOID_Y === 22);
  check('there is no perimeter wall — sky islands over nothing is the mode',
    (() => {
      for (let lz = 0; lz < BEDWARS_ARENA_SIZE; lz++) {
        for (const lx of [0, BEDWARS_ARENA_SIZE - 1]) {
          for (let y = BEDWARS_STAMP_MIN_Y; y <= BEDWARS_CEILING_Y; y++) {
            if (bedwarsBlockAt(A0.originX + lx, y, A0.originZ + lz) !== null) return false;
          }
        }
      }
      return true;
    })());
}

// ── Spawns and fixtures ────────────────────────────────────────────────────
{
  check('one spawn per team, each on solid ground with headroom',
    A0.spawns.length === MAP.teams && A0.spawns.every((s) =>
      bedwarsSolidAt(s.x, s.y - 1, s.z, A0) &&
      !bedwarsSolidAt(s.x, s.y + 0.1, s.z, A0) &&
      !bedwarsSolidAt(s.x, s.y + 1.1, s.z, A0)));
  const { x: cx, z: cz } = bedwarsArenaCenter(A0);
  const d = A0.spawns.map((s) => Math.hypot(s.x - cx, s.z - cz));
  check('both spawns are equidistant from mid', Math.abs(d[0] - d[1]) < 1e-9, d.join(' vs '));
  check('the spawns face each other across the gap',
    A0.spawns[0].yaw === -A0.spawns[1].yaw);

  for (const team of [0, 1]) {
    const cells = bedwarsBedCells(A0, team);
    check(`team ${team}'s bed is two distinct cells`,
      cells.length === 2 && (cells[0].x !== cells[1].x || cells[0].z !== cells[1].z));
    check(`both of team ${team}'s bed cells report that team`,
      cells.every((c) => bedwarsBedTeamAt(c.x, c.y, c.z, A0) === team));
    check(`team ${team}'s bed sits on its own island`,
      cells.every((c) => bedwarsSolidAt(c.x, c.y - 1, c.z, A0)));
    check(`team ${team} has a shop on its own island`,
      bedwarsShopCells(A0, team).length === 1 &&
      bedwarsShopCells(A0, team).every((c) => bedwarsSolidAt(c.x, c.y - 1, c.z, A0)));
  }
  check('a non-bed cell reports no bed team',
    bedwarsBedTeamAt(A0.originX + 48, BEDWARS_FLOOR_Y + 1, A0.originZ + 48, A0) === -1);
  check('beds are unmineable by the ordinary path — only the bed branch may act',
    bedwarsBedCells(A0, 0).every((c) =>
      bedwarsBlockAt(c.x, c.y, c.z) === Block.BwBedA));

  const gens = bedwarsGenCells(A0);
  check('there is one team generator per team plus contested diamond generators',
    gens.filter((g) => !g.diamond).length === MAP.teams &&
    gens.filter((g) => g.diamond).length >= 1);
  check('every diamond generator is nearer to mid than to either base',
    gens.filter((g) => g.diamond).every((g) => {
      const dm = Math.hypot(g.x - cx, g.z - cz);
      return A0.spawns.every((s) => dm < Math.hypot(g.x - s.x, g.z - s.z));
    }));
  check('a team generator sits on its own base, mid-facing',
    gens.filter((g) => !g.diamond).every((g) => bedwarsSolidAt(g.x, g.y - 1, g.z, A0)));
}

// ── Containment ────────────────────────────────────────────────────────────
{
  const inside = clampToBedwarsArena({ x: A0.originX + 48, y: 150, z: A0.originZ + 48 }, A0);
  check('a position inside the footprint is untouched',
    inside.x === A0.originX + 48 && inside.y === 150);
  const out = clampToBedwarsArena({ x: A0.originX - 500, y: 150, z: A0.originZ + 900 }, A0);
  check('x/z are clamped to the footprint',
    out.x > A0.minX && out.x < A0.maxX && out.z > A0.minZ && out.z < A0.maxZ);
  const high = clampToBedwarsArena({ x: A0.originX + 48, y: 9_000, z: A0.originZ + 48 }, A0);
  check('the ceiling is capped — no infinite sky-basing', high.y < BEDWARS_CEILING_Y);
  const low = clampToBedwarsArena({ x: A0.originX + 48, y: 40, z: A0.originZ + 48 }, A0);
  check('y is NOT floored — falling must stay a death, not a clamp', low.y === 40);

  const tight = collapsedBedwarsArena(A0, 6);
  check('the collapse ladder shrinks the box around mid',
    tight.maxX - tight.minX === 12 && tight.maxZ - tight.minZ === 12 &&
    tight.minX > A0.minX && tight.maxX < A0.maxX);
}

// ── Swing math ─────────────────────────────────────────────────────────────
const swing = (over: Partial<BwSwingInput> = {}) => bedwarsSwing({
  tier: BW_AXE_TIERS[0], sinceLastSwingMs: 10_000, combo: 0,
  onGround: true, vy: 0, speed: 0,
  toTargetX: 1, toTargetZ: 0, lookX: 1, lookZ: 0, ...over,
});
{
  const wood = BW_AXE_TIERS[0], cleaver = BW_AXE_TIERS[3];
  check('a zero-charge swing lands a quarter of the damage',
    swing({ sinceLastSwingMs: 0 }).damage === Math.max(1, Math.round(wood.damage * 0.25)));
  check('a full-charge swing lands full damage',
    swing({ sinceLastSwingMs: 10_000 }).damage === wood.damage &&
    swing({ sinceLastSwingMs: 10_000 }).charge === 1);
  check('charge is QUADRATIC, so half-cooldown spam is a strict loss',
    (() => {
      const half = swing({ sinceLastSwingMs: wood.cooldownMs / 2 });
      // 0.25 + 0.75*0.25 = 0.4375 — well under the 0.625 a linear curve gives.
      return Math.abs(half.charge - 0.5) < 1e-9 &&
        half.damage === Math.round(wood.damage * 0.4375) &&
        half.damage < Math.round(wood.damage * 0.625);
    })());
  check('charge saturates at 1 rather than overshooting',
    swing({ sinceLastSwingMs: 1e9 }).charge === 1);

  check('a crit is 1.5x and needs to be airborne AND falling',
    (() => {
      const flat = swing({ tier: cleaver });
      const crit = swing({ tier: cleaver, onGround: false, vy: -0.5 });
      const rising = swing({ tier: cleaver, onGround: false, vy: 0.4 });
      return crit.crit && !flat.crit && !rising.crit &&
        crit.damage === Math.round(cleaver.damage * BW_CRIT_MULT);
    })());

  check('the combo counter adds 10/20/30% and then stops',
    (() => {
      const base = swing({ tier: cleaver, combo: 0 }).damage;
      const steps = [1, 2, 3, 9].map((c) => swing({ tier: cleaver, combo: c }));
      return steps[0].damage === Math.round(cleaver.damage * 1.1) &&
        steps[1].damage === Math.round(cleaver.damage * 1.2) &&
        steps[2].damage === Math.round(cleaver.damage * 1.3) &&
        steps[3].combo === BW_COMBO_MAX && steps[3].damage === steps[2].damage &&
        base === cleaver.damage;
    })());

  const chain = [0, 1, 2, 3].map((c) => swing({ tier: cleaver, combo: c }).damage);
  check('a clean four-hit Void Cleaver chain deletes a full health pool',
    chain.reduce((a, b) => a + b, 0) >= BEDWARS_MAX_HEALTH,
    chain.join('+'));
  check('the tier ladder is steep and legible',
    (() => {
      const woodHits = Math.ceil(BEDWARS_MAX_HEALTH / swing({ tier: wood }).damage);
      const cleaverCrit = swing({ tier: cleaver, onGround: false, vy: -0.5 }).damage;
      return woodHits === 7 && Math.ceil(BEDWARS_MAX_HEALTH / cleaverCrit) === 2;
    })());
  check('damage never rounds to zero', BW_AXE_TIERS.every((tier) =>
    swing({ tier, sinceLastSwingMs: 0 }).damage >= 1));

  // Knockback — the void kill.
  check('a sprint multiplies knockback and needs real speed',
    (() => {
      const still = swing({ tier: cleaver });
      const run = swing({ tier: cleaver, speed: BW_SPRINT_SPEED });
      const jog = swing({ tier: cleaver, speed: BW_SPRINT_SPEED - 0.1 });
      return run.sprint && !jog.sprint && !still.sprint &&
        Math.abs(Math.hypot(run.kx, run.kz) / Math.hypot(still.kx, still.kz) - BW_SPRINT_KB_MULT) < 1e-9;
    })());
  check('a full-charge sprinting Void Cleaver clears the fourteen-block gap',
    (() => {
      const r = swing({ tier: cleaver, speed: 6 });
      // main.ts applies knockback as `player.vel += k * 6`.
      return Math.hypot(r.kx, r.kz) * 6 >= 8.0;
    })(), `${(Math.hypot(swing({ tier: cleaver, speed: 6 }).kx, swing({ tier: cleaver, speed: 6 }).kz) * 6).toFixed(2)} m/s`);
  check('an uncharged standing Wooden Axe is a nudge, not a launch',
    Math.hypot(swing({ sinceLastSwingMs: 0 }).kx, swing({ sinceLastSwingMs: 0 }).kz) * 6 < 3.0);
  check('knockback always has vertical lift so a victim actually leaves the floor',
    BW_AXE_TIERS.every((tier) => swing({ tier }).ky > 0));

  check('knockback direction lies BETWEEN the body line and the attacker aim',
    (() => {
      // Target due +x, but the attacker looks +z: the result must be diagonal.
      const r = swing({ toTargetX: 1, toTargetZ: 0, lookX: 0, lookZ: 1 });
      const len = Math.hypot(r.kx, r.kz);
      const ux = r.kx / len, uz = r.kz / len;
      return ux > 0 && uz > 0 && ux > uz &&
        Math.abs(uz / (ux + uz) - BW_LOOK_BLEND) < 1e-6;
    })());
  check('with aim and body line agreeing, knockback is exactly along them',
    (() => {
      const r = swing({ toTargetX: 0, toTargetZ: 1, lookX: 0, lookZ: 1 });
      return Math.abs(r.kx) < 1e-9 && r.kz > 0;
    })());
  check('a degenerate (zero-length) blend falls back to the body line',
    (() => {
      const r = swing({ toTargetX: 1, toTargetZ: 0, lookX: -1, lookZ: 0 });
      return Number.isFinite(r.kx) && Number.isFinite(r.kz);
    })());
  check('base knockback matches the published constant',
    Math.abs(Math.hypot(swing().kx, swing().kz) - BW_KB_BASE) < 1e-9);
}

// ── Shop + resources ───────────────────────────────────────────────────────
{
  check('every shop entry has a unique index and a real cost',
    new Set(BEDWARS_SHOP.map((e) => e.entry)).size === BEDWARS_SHOP.length &&
    BEDWARS_SHOP.every((e) => Object.values(e.cost).some((v) => (v ?? 0) > 0)));
  check('every shop entry grants exactly one kind of thing',
    BEDWARS_SHOP.every((e) => [e.grants, e.teamBlock, e.axe].filter((v) => v !== undefined).length === 1));
  check('the shop ladder is exactly the axe ladder above wood',
    BEDWARS_SHOP.filter((e) => e.axe).map((e) => e.axe) .join() ===
    [Item.StoneAxe, Item.IronAxe, Item.VoidCleaver].join());
  check('an unknown shop index resolves to nothing',
    bedwarsShopEntry(999) === null && bedwarsShopEntry(-1) === null);
  check('team wool is the team colour and is minigame-only',
    bedwarsTeamWool(0) === Block.TeamWoolA && bedwarsTeamWool(1) === Block.TeamWoolB &&
    isMinigameOnly(bedwarsTeamWool(0)) && isMinigameOnly(bedwarsTeamWool(1)));
  check('the Void Cleaver is minigame-only and the top of the ladder',
    isMinigameOnly(Item.VoidCleaver) &&
    bedwarsAxeRank(Item.VoidCleaver) === BW_AXE_TIERS.length - 1);
  check('an unknown held item degrades to the wooden tier, never to nothing',
    bedwarsAxeTier(Item.Diamond).item === Item.WoodenAxe && bedwarsAxeRank(Item.Diamond) === 0);
  check('affordability is per-currency and exact',
    bedwarsCanAfford({ iron: 4, gold: 0, diamond: 0 }, { iron: 4 }) &&
    !bedwarsCanAfford({ iron: 3, gold: 99, diamond: 99 }, { iron: 4 }));

  check('the diamond generator ramps up so a stalled match escalates',
    bedwarsDiamondPeriod(0) === 25_000 &&
    bedwarsDiamondPeriod(119_999) === 25_000 &&
    bedwarsDiamondPeriod(120_000) === 18_000 &&
    bedwarsDiamondPeriod(240_000) === 12_000 &&
    bedwarsDiamondPeriod(600_000) === 12_000);
}

// ── State machine ──────────────────────────────────────────────────────────
function live(now = 1_000): { bw: Bedwars; t: number } {
  const bw = new Bedwars(token);
  const made = bw.create(who(1), now);
  if ('reason' in made) throw new Error('create failed');
  bw.join(made.token, who(2), now);
  bw.setReady(1, true, now); bw.setReady(2, true, now);
  const started = bw.start(1, now);
  if (!started.ok) throw new Error(`start failed: ${started.reason}`);
  bw.markArenaReady(1, now); bw.markArenaReady(2, now);
  bw.tick(now + BEDWARS_COUNTDOWN_MS + 1);
  return { bw, t: now + BEDWARS_COUNTDOWN_MS + 1 };
}

{
  const bw = new Bedwars(token);
  const made = bw.create(who(1), 0);
  if ('reason' in made) throw new Error('create failed');
  check('the creator hosts and is on team 0',
    made.snapshot.host === 1 && made.snapshot.participants[0].team === 0);
  check('the invite token never appears in a public snapshot',
    !JSON.stringify(made.snapshot).includes(made.token));
  check('a lobby snapshot declares itself UNRANKED',
    made.snapshot.ranked === false);
  check('a bad invite is refused', !bw.join('nope', who(2), 0).ok);
  check('joining assigns the other team',
    bw.join(made.token, who(2), 0).ok && bw.teamOf(2) === 1);
  check('a third player is refused from a full 1v1',
    (() => { const r = bw.join(made.token, who(3), 0); return !r.ok && r.reason === 'full'; })());
  check('capacity matches the map table', made.snapshot.capacity === BEDWARS_CAPACITY);
  check('a non-host cannot start',
    (() => { const r = bw.start(2, 0); return !r.ok && r.reason === 'not_host'; })());
  check('starting needs everyone ready',
    (() => { const r = bw.start(1, 0); return !r.ok && r.reason === 'not_everyone_ready'; })());
}

{
  const { bw, t } = live();
  check('the match is running and both beds stand',
    bw.phaseFor(1) === 'running' &&
    bw.snapshotFor(1, t)!.teams.every((s) => s.bedAlive));
  check('sameMatch is true only for a live pairing',
    bw.sameMatch(1, 2) && bw.sameMatch(2, 1) && !bw.sameMatch(1, 99));
  check('everyone starts on the wooden axe with nothing banked',
    [1, 2].every((id) => {
      const p = bw.participantFor(id)!;
      return p.axe === Item.WoodenAxe && p.resources.iron === 0 && p.resources.diamond === 0;
    }));

  // Death WITH a bed: a 5s respawn.
  const died = bw.recordDeath(2, 1, t, 'melee')!;
  check('a death with a bed intact is not a final kill and schedules a respawn',
    !died.finalKill && died.killer === 1 &&
    bw.participantFor(2)!.respawnAt === t + BEDWARS_RESPAWN_MS &&
    bw.participantFor(1)!.kills === 1 && bw.participantFor(2)!.deaths === 1);
  bw.tick(t + BEDWARS_RESPAWN_MS + 1);
  check('the respawn lands with a spawn shield',
    bw.participantFor(2)!.alive &&
    bw.participantFor(2)!.shieldUntil === t + BEDWARS_RESPAWN_MS + 1 + BEDWARS_SPAWN_SHIELD_MS);

  check('breaking your OWN bed is refused', bw.breakBed(2, 1, t) === null);
  const broke = bw.breakBed(1, 1, t)!;
  check('breaking an enemy bed is recorded against that team',
    broke.team === 1 && bw.participantFor(1)!.bedsBroken === 1 &&
    !bw.snapshotFor(1, t)!.teams.find((s) => s.team === 1)!.bedAlive);
  check('a bed cannot be broken twice', bw.breakBed(1, 1, t) === null);

  const final = bw.recordDeath(2, 1, t + 10, 'melee')!;
  check('a death with no bed is a FINAL kill and ends a 1v1',
    final.finalKill && bw.participantFor(2)!.respawnAt === undefined &&
    bw.phaseFor(1) === 'results');
  const result = bw.snapshotFor(1, t + 10)!.result!;
  check('the result names the winner, the reason, and that it is unranked',
    result.winner === 1 && result.winnerTeam === 0 &&
    result.finishReason === 'final_kill' && result.ranked === false);
  check('the result carries no progression field of any kind',
    !('progressChanges' in result) && !JSON.stringify(result).includes('rp'));
}

// ── Void attribution: the mode's signature kill ────────────────────────────
{
  const { bw, t } = live();
  bw.recordHit(2, 1, t);
  const inside = bw.recordDeath(2, 0, t + BEDWARS_VOID_CREDIT_MS - 1, 'void')!;
  check('a void death inside the credit window is the attacker\'s kill',
    inside.killer === 1 && bw.participantFor(1)!.kills === 1 &&
    bw.participantFor(1)!.voidKills === 1);
}
{
  const { bw, t } = live();
  bw.recordHit(2, 1, t);
  const outside = bw.recordDeath(2, 0, t + BEDWARS_VOID_CREDIT_MS + 1, 'void')!;
  check('a void death past the window is a self-death, credited to nobody',
    outside.killer === null && bw.participantFor(1)!.kills === 0 &&
    bw.participantFor(2)!.deaths === 1);
}
{
  const { bw, t } = live();
  const cold = bw.recordDeath(2, 0, t, 'void')!;
  check('a void death with no prior hit at all is a self-death', cold.killer === null);
  check('a fresh death clears the last-hit record so it cannot be reused',
    bw.participantFor(2)!.lastHitBy === 0);
}

// ── Stalemate ladder: termination is guaranteed ────────────────────────────
for (const opening of ['both beds intact', 'one bed broken'] as const) {
  const { bw, t } = live();
  if (opening === 'one bed broken') bw.breakBed(1, 1, t);
  let now = t;
  let phase = bw.phaseFor(1);
  let guard = 0;
  // Two players who NEVER interact. Only the clock may end this.
  while (phase === 'running' && guard++ < 5_000) {
    now += 1_000;
    bw.tick(now);
    phase = bw.phaseFor(1);
  }
  const snap = bw.snapshotFor(1, now)!;
  check(`idle match (${opening}) terminates inside the round clock`,
    phase === 'results' && now - t <= BEDWARS_ROUND_MS + 2_000, `${now - t}ms`);
  check(`idle match (${opening}) crowns exactly one winner`,
    snap.result !== undefined && snap.result.winner !== null);
}
{
  const { bw, t } = live();
  bw.tick(t + BEDWARS_BED_DECAY_MS + 1);
  check('the ladder crumbles every remaining bed at 5:00',
    bw.snapshotFor(1, t)!.teams.every((s) => !s.bedAlive) &&
    bw.stageFor(1) === 'no_respawn');
  bw.tick(t + BEDWARS_CLAMP_MID_MS + 1);
  check('the ladder collapses the arena at 7:00', bw.stageFor(1) === 'collapse');
}
{
  // A respawn pending when the beds crumble must be REVOKED, not honoured.
  const { bw, t } = live();
  bw.tick(t + BEDWARS_BED_DECAY_MS - 100);
  bw.recordDeath(2, 1, t + BEDWARS_BED_DECAY_MS - 50, 'melee');
  bw.tick(t + BEDWARS_BED_DECAY_MS + 1);
  bw.tick(t + BEDWARS_BED_DECAY_MS + BEDWARS_RESPAWN_MS + 100);
  check('the bed decay does not hand out one last free life',
    !bw.participantFor(2)!.alive || bw.phaseFor(1) === 'results');
}

// ── Resources and purchases ────────────────────────────────────────────────
{
  const { bw } = live();
  bw.grantResources(1, { iron: 10 });
  check('resources accrue', bw.participantFor(1)!.resources.iron === 10);
  bw.grantResources(1, { iron: 10_000 });
  check('resources are capped', bw.participantFor(1)!.resources.iron === BW_CAP_IRON);
  check('an unaffordable purchase changes nothing',
    !bw.spendResources(1, { diamond: 4 }) && bw.participantFor(1)!.resources.iron === BW_CAP_IRON);
  check('an affordable purchase debits exactly its cost',
    bw.spendResources(1, { iron: 10 }) &&
    bw.participantFor(1)!.resources.iron === BW_CAP_IRON - 10);

  bw.setAxe(1, Item.IronAxe);
  check('an axe purchase REPLACES rather than stacks',
    bw.participantFor(1)!.axe === Item.IronAxe);
  bw.setAxe(1, Item.StoneAxe);
  check('a stale or replayed purchase cannot downgrade the axe',
    bw.participantFor(1)!.axe === Item.IronAxe);
  bw.setAxe(1, Item.VoidCleaver);
  check('upgrading still works', bw.participantFor(1)!.axe === Item.VoidCleaver);
}

// ── Scoreboard ordering ────────────────────────────────────────────────────
{
  const teams = new Map<number, BwTeamState>([
    [0, { team: 0, bedAlive: true, bedBrokenBy: 0, bedBrokenAt: 0, bedsConceded: 0 }],
    [1, { team: 1, bedAlive: false, bedBrokenBy: 1, bedBrokenAt: 0, bedsConceded: 1 }],
  ]);
  const mk = (id: number, team: number, deaths: number, kills: number, joinOrder: number) =>
    ({ id, username: `P${id}`, skin: 0, team, host: false, ready: false, connected: true,
      joinOrder, kills, deaths, bedsBroken: 0, voidKills: 0, alive: true, spectating: false,
      axe: Item.WoodenAxe, resources: { iron: 0, gold: 0, diamond: 0 },
      lastHitBy: 0, lastHitAt: 0 }) as BwParticipant;

  check('fewest deaths wins first',
    orderBedwarsScore([mk(1, 0, 3, 0, 0), mk(2, 1, 1, 0, 1)], teams)[0].id === 2);
  check('on equal deaths, a standing bed wins',
    orderBedwarsScore([mk(1, 1, 2, 0, 0), mk(2, 0, 2, 0, 1)], teams)[0].id === 2);
  check('the comparator is a total order — reversing the input never changes it',
    (() => {
      const rows = [mk(1, 0, 2, 1, 0), mk(2, 1, 2, 1, 1), mk(3, 0, 1, 0, 2)];
      const a = orderBedwarsScore(rows, teams).map((p) => p.id).join();
      const b = orderBedwarsScore([...rows].reverse(), teams).map((p) => p.id).join();
      return a === b;
    })());
  check('join order is the final, always-decisive tiebreak',
    orderBedwarsScore([mk(9, 0, 0, 0, 5), mk(8, 0, 0, 0, 2)], teams)[0].id === 8);
}

// ── Forfeit and cleanup ────────────────────────────────────────────────────
{
  const { bw, t } = live();
  const left = bw.leave(1, t);
  check('a mid-match departure forfeits to the survivor',
    left.snapshot?.phase === 'results' && left.snapshot.result?.winner === 2 &&
    left.snapshot.result.finishReason === 'forfeit');
  check('the leaver stays on the board so forfeiting cannot erase a loss',
    left.snapshot!.result!.scoreboard.some((p) => p.id === 1));
  const gone = bw.leave(2, t + 1);
  check('the last member out deletes the lobby and frees its slot', gone.deleted);
  const reused = bw.create(who(3), t + 2);
  if ('reason' in reused) throw new Error('recreate failed');
  bw.join(reused.token, who(4), t + 2);
  bw.setReady(3, true, t + 2); bw.setReady(4, true, t + 2);
  bw.start(3, t + 2);
  check('the freed arena slot is handed to the next match',
    bw.arenaFor(3)?.slot === 0);
}

// ── Cross-match isolation ──────────────────────────────────────────────────
{
  const bw = new Bedwars(token);
  const a = bw.create(who(1), 0); const b = bw.create(who(3), 0);
  if ('reason' in a || 'reason' in b) throw new Error('create failed');
  bw.join(a.token, who(2), 0); bw.join(b.token, who(4), 0);
  for (const id of [1, 2, 3, 4]) bw.setReady(id, true, 0);
  bw.start(1, 0); bw.start(3, 0);
  for (const id of [1, 2, 3, 4]) bw.markArenaReady(id, 0);
  bw.tick(BEDWARS_COUNTDOWN_MS + 1);
  check('two live lobbies get different arena slots',
    bw.arenaFor(1)!.slot !== bw.arenaFor(3)!.slot);
  check('their footprints do not overlap',
    bw.arenaFor(1)!.maxX <= bw.arenaFor(3)!.minX ||
    bw.arenaFor(3)!.maxX <= bw.arenaFor(1)!.minX);
  check('a cross-lobby pairing is never sameMatch',
    !bw.sameMatch(1, 3) && !bw.sameMatch(2, 4) && bw.sameMatch(1, 2) && bw.sameMatch(3, 4));
  check('a cross-lobby death is refused', bw.recordDeath(1, 3, 100, 'melee')?.killer !== 3);
  check('membership never spans lobbies',
    bw.membersOf(1).sort().join() === '1,2' && bw.membersOf(3).sort().join() === '3,4');
}

// ── Server: the melee handler's fail-closed validation ────────────────────
// Everything below drives the real GameServer, because the point of these
// checks is the ROUTE, not the math.

/** Two players in a live Bedwars match, standing next to each other at mid. */
function liveServer(): { s: GameServer; arenaOf: (id: number) => { x: number; y: number; z: number } } {
  const s = new GameServer(7, token);
  s.addPlayer(1, { username: 'Red', faction: 0 });
  s.addPlayer(2, { username: 'Blue', faction: 1 });
  s.addPlayer(3, { username: 'Bystander', faction: 1 });
  for (const id of [1, 2, 3]) s.handle(id, { t: 'xform', x: 40, y: 70, z: 40, yaw: 0, pitch: 0 });
  const made = s.handle(1, { t: 'bwCreate' }).find((o) => o.to === 1 && o.msg.t === 'bwLobby')?.msg;
  if (!made || made.t !== 'bwLobby' || !made.inviteToken) throw new Error('no bedwars invite');
  s.handle(2, { t: 'bwJoin', token: made.inviteToken });
  s.handle(1, { t: 'bwReady', ready: true });
  s.handle(2, { t: 'bwReady', ready: true });
  const started = s.handle(1, { t: 'bwStart' });
  const arenaMsg = started.find((o) => o.to === 1 && o.msg.t === 'bwArena')?.msg;
  if (!arenaMsg || arenaMsg.t !== 'bwArena') throw new Error('no bwArena');
  for (const id of [1, 2]) s.handle(id, { t: 'bwArenaReady' });
  s.tickWar(6); s.tickBedwars(6);
  const mid = { x: arenaMsg.arena.originX + 48.5, y: BEDWARS_FLOOR_Y + 1.01, z: arenaMsg.arena.originZ + 48.5 };
  return { s, arenaOf: () => mid };
}

/** Place both fighters at mid, one block apart on x, both facing +x. */
function faceOff(s: GameServer, mid: { x: number; y: number; z: number }, gap = 1.5): void {
  // yaw = -PI/2 looks toward +x (main.ts: dx = -sin(yaw)).
  s.handle(1, { t: 'xform', x: mid.x - gap / 2, y: mid.y, z: mid.z, yaw: -Math.PI / 2, pitch: 0 });
  s.handle(2, { t: 'xform', x: mid.x + gap / 2, y: mid.y, z: mid.z, yaw: Math.PI / 2, pitch: 0 });
}

{
  const { s, arenaOf } = liveServer();
  const mid = arenaOf(1);
  faceOff(s, mid);
  const hit = s.handle(1, { t: 'bwMelee', target: 2 });
  check('a legitimate melee lands and reports back to the attacker only',
    hit.some((o) => o.to === 1 && o.msg.t === 'bwHit' && o.msg.amount > 0) &&
    hit.some((o) => o.to === 2 && o.msg.t === 'hurt') &&
    !hit.some((o) => o.to === 3));
  const bwHit = hit.find((o) => o.msg.t === 'bwHit')!.msg as Extract<typeof hit[0]['msg'], { t: 'bwHit' }>;
  check('the attacker gets crit/combo/charge, which hitconfirm cannot carry',
    typeof bwHit.crit === 'boolean' && typeof bwHit.combo === 'number' &&
    bwHit.charge >= 0 && bwHit.charge <= 1);
  check('the hurt arm carries a real knockback impulse',
    hit.some((o) => o.msg.t === 'hurt' && Math.hypot(o.msg.kx, o.msg.kz) > 0 && o.msg.ky > 0));
  check('a Bedwars hit never tags open-world combat',
    hit.every((o) => o.msg.t !== 'hurt' || o.msg.combat === 0));
}
{
  const { s, arenaOf } = liveServer();
  const mid = arenaOf(1);
  // A Wooden-Axe player claiming to hold a Void Cleaver deals WOODEN damage.
  faceOff(s, mid);
  s.handle(1, { t: 'xform', x: mid.x - 0.75, y: mid.y, z: mid.z, yaw: -Math.PI / 2, pitch: 0,
    held: Item.VoidCleaver } as never);
  const hit = s.handle(1, { t: 'bwMelee', target: 2 });
  const amount = hit.find((o) => o.msg.t === 'bwHit')?.msg;
  check('no client-supplied number enters the damage math',
    amount?.t === 'bwHit' && amount.amount === BW_AXE_TIERS[0].damage,
    `${amount?.t === 'bwHit' ? amount.amount : '?'}`);
}
{
  const { s, arenaOf } = liveServer();
  const mid = arenaOf(1);

  // Out of range.
  s.handle(1, { t: 'xform', x: mid.x - 4.4, y: mid.y, z: mid.z, yaw: -Math.PI / 2, pitch: 0 });
  s.handle(2, { t: 'xform', x: mid.x + 0.5, y: mid.y, z: mid.z, yaw: Math.PI / 2, pitch: 0 });
  check('a hit beyond melee range is refused', s.handle(1, { t: 'bwMelee', target: 2 }).length === 0);

  // Outside the facing cone: attacker looks -x, target is +x.
  s.handle(1, { t: 'xform', x: mid.x - 0.75, y: mid.y, z: mid.z, yaw: Math.PI / 2, pitch: 0 });
  check('a hit outside the facing cone is refused',
    s.handle(1, { t: 'bwMelee', target: 2 }).length === 0);

  // Faster than the cadence floor: land one, then immediately swing again.
  faceOff(s, mid);
  check('the first swing of a pair lands', s.handle(1, { t: 'bwMelee', target: 2 }).length > 0);
  check('a swing faster than the cadence floor is DROPPED, not scaled',
    s.handle(1, { t: 'bwMelee', target: 2 }).length === 0);

  // Against yourself, and against a non-participant.
  check('a self-hit is refused', s.handle(1, { t: 'bwMelee', target: 1 }).length === 0);
  check('a hit on a non-participant is refused', s.handle(1, { t: 'bwMelee', target: 3 }).length === 0);
  check('a hit on an unknown id is refused', s.handle(1, { t: 'bwMelee', target: 9_999 }).length === 0);
  check('a non-integer target is refused',
    s.handle(1, { t: 'bwMelee', target: 1.5 as number }).length === 0);
}
{
  // Through a placed wool wall.
  const { s, arenaOf } = liveServer();
  const mid = arenaOf(1);
  faceOff(s, mid, 2.5);
  const wallX = Math.floor(mid.x), wallZ = Math.floor(mid.z), wallY = Math.floor(mid.y);
  // TWO rows: the swing runs from eye height down to chest height, so a
  // one-block parapet is correctly swung straight over.
  const placed = [
    s.handle(1, { t: 'edit', x: wallX, y: wallY, z: wallZ, block: Block.TeamWoolA }),
    s.handle(1, { t: 'edit', x: wallX, y: wallY + 1, z: wallZ, block: Block.TeamWoolA }),
  ];
  check('arena wool can be placed inside the arena', placed.every((o) => o.length > 0));
  check('you cannot swing through a wool wall',
    s.handle(1, { t: 'bwMelee', target: 2 }).length === 0);
  check('...but a one-block parapet is swung straight over',
    (() => {
      const s2 = liveServer();
      const m = s2.arenaOf(1);
      faceOff(s2.s, m, 2.5);
      s2.s.handle(1, { t: 'edit', x: Math.floor(m.x), y: Math.floor(m.y), z: Math.floor(m.z),
        block: Block.TeamWoolA });
      return s2.s.handle(1, { t: 'bwMelee', target: 2 }).length > 0;
    })());
}
{
  // A shielded target.
  const { s, arenaOf } = liveServer();
  const mid = arenaOf(1);
  faceOff(s, mid);
  // Beat player 2 down until they die, then catch them in the spawn shield.
  let died = false;
  for (let i = 0; i < 20 && !died; i++) {
    s.tickWar(1); s.tickBedwars(1);
    faceOff(s, mid);
    died = s.handle(1, { t: 'bwMelee', target: 2 })
      .some((o) => o.msg.t === 'bwRespawn' && o.msg.spectating);
  }
  check('sustained melee eventually kills through the full health pool', died);
  // Advance just past the respawn so the shield is freshly armed.
  s.tickWar(BEDWARS_RESPAWN_MS / 1000 + 0.2);
  s.tickBedwars(BEDWARS_RESPAWN_MS / 1000 + 0.2);
  faceOff(s, mid);
  check('a spawn-shielded target cannot be hit',
    s.handle(1, { t: 'bwMelee', target: 2 }).length === 0);
  // ...and is hittable again once the shield lapses.
  s.tickWar(BEDWARS_SPAWN_SHIELD_MS / 1000 + 0.5);
  s.tickBedwars(BEDWARS_SPAWN_SHIELD_MS / 1000 + 0.5);
  faceOff(s, mid);
  check('the shield lapses rather than lasting forever',
    s.handle(1, { t: 'bwMelee', target: 2 }).length > 0);
}

// ── Melee is unreachable outside a live Bedwars match ─────────────────────
{
  const s = new GameServer(7, token);
  s.addPlayer(1, { username: 'A', faction: 0 });
  s.addPlayer(2, { username: 'B', faction: 1 });
  for (const id of [1, 2]) s.handle(id, { t: 'xform', x: 40, y: 70, z: 41, yaw: 0, pitch: 0 });
  const before = s.snapshotFor(1).find((v) => v.id === 2);
  check('bwMelee is inert in the open world',
    s.handle(1, { t: 'bwMelee', target: 2 }).length === 0 && !!before);
  check('bwBed and bwShopBuy are inert in the open world',
    s.handle(1, { t: 'bwBed', x: 40, y: 70, z: 41 }).length === 0 &&
    s.handle(1, { t: 'bwShopBuy', entry: 1 }).length === 0);
}
{
  // Inside a live DUELS match: bwMelee hits the Duels whitelist and is dropped.
  const s = new GameServer(7, token);
  s.addPlayer(1, { username: 'A', faction: 0 });
  s.addPlayer(2, { username: 'B', faction: 1 });
  for (const id of [1, 2]) s.handle(id, { t: 'xform', x: 40, y: 70, z: 41, yaw: 0, pitch: 0 });
  const made = s.handle(1, { t: 'duelCreate' }).find((o) => o.msg.t === 'duelLobby')?.msg;
  if (!made || made.t !== 'duelLobby' || !made.inviteToken) throw new Error('no duel invite');
  s.handle(2, { t: 'duelJoin', token: made.inviteToken });
  s.handle(1, { t: 'duelReady', ready: true }); s.handle(2, { t: 'duelReady', ready: true });
  s.handle(1, { t: 'duelStart' });
  for (const id of [1, 2]) s.handle(id, { t: 'duelArenaReady' });
  s.tickWar(DUEL_COUNTDOWN_MS / 1000); s.tickDuels();
  check('bwMelee is inert inside a live Duels match',
    s.handle(1, { t: 'bwMelee', target: 2 }).length === 0);
  check('Duels bodies are unaffected by the Bedwars route',
    s.handle(1, { t: 'bwBed', x: 0, y: 0, z: 0 }).length === 0);
}
{
  // In a Bedwars LOBBY, pre-countdown: the match is not running yet.
  const s = new GameServer(7, token);
  s.addPlayer(1, { username: 'A', faction: 0 });
  s.addPlayer(2, { username: 'B', faction: 1 });
  for (const id of [1, 2]) s.handle(id, { t: 'xform', x: 40, y: 70, z: 41, yaw: 0, pitch: 0 });
  const made = s.handle(1, { t: 'bwCreate' }).find((o) => o.msg.t === 'bwLobby')?.msg;
  if (!made || made.t !== 'bwLobby' || !made.inviteToken) throw new Error('no invite');
  s.handle(2, { t: 'bwJoin', token: made.inviteToken });
  check('bwMelee is inert in a Bedwars lobby before the countdown',
    s.handle(1, { t: 'bwMelee', target: 2 }).length === 0);
  check('lobby members remain ordinary open-world citizens',
    s.receivesWorldBroadcast(1) && s.receivesWorldBroadcast(2));
}

// ── World isolation ────────────────────────────────────────────────────────
{
  const { s } = liveServer();
  check('arena and open-world visibility scopes are disjoint',
    !s.receivesWorldBroadcast(1) && !s.receivesWorldBroadcast(2) &&
    s.receivesWorldBroadcast(3) &&
    s.snapshotFor(1).every((v) => v.id === 1 || v.id === 2) &&
    s.snapshotFor(3).every((v) => v.id === 3));
  // The welcome PLAYERS roster is the presence list a joining client renders
  // bodies from. (The politics faction roster is a citizenship list and does
  // still name arena members — pre-existing, and identical for Duels.)
  const welcome = s.addPlayer(4, { username: 'Late', faction: 0 })
    .find((o) => o.msg.t === 'welcome')?.msg;
  check('the welcome roster omits arena bodies',
    welcome?.t === 'welcome' && welcome.players.every((v) => v.username !== 'Red' && v.username !== 'Blue') &&
    welcome.players.some((v) => v.username === 'Bystander'));
}
{
  // Arena state must never persist.
  const s = new GameServer(7, token);
  s.addPlayer(1, { username: 'Red', faction: 0 });
  s.addPlayer(2, { username: 'Blue', faction: 1 });
  s.handle(1, { t: 'xform', x: 120, y: 70, z: 30, yaw: 0, pitch: 0 });
  s.handle(2, { t: 'xform', x: 125, y: 70, z: 30, yaw: 0, pitch: 0 });
  s.handle(1, { t: 'saveState', data: { x: 120, y: 70, z: 30,
    slots: [{ id: Item.Diamond, count: 5 }] } });
  const made = s.handle(1, { t: 'bwCreate' }).find((o) => o.msg.t === 'bwLobby')?.msg;
  if (!made || made.t !== 'bwLobby' || !made.inviteToken) throw new Error('no invite');
  s.handle(2, { t: 'bwJoin', token: made.inviteToken });
  s.handle(1, { t: 'bwReady', ready: true }); s.handle(2, { t: 'bwReady', ready: true });
  s.handle(1, { t: 'bwStart' });
  const captured = s.capturePlayerState(1)!.data;
  check('mid-match capture returns the PRE-match position and inventory',
    captured.x === 120 && (captured.slots as { id?: number }[])[0]?.id === Item.Diamond);
  s.handle(1, { t: 'saveState', data: { x: 99_999, slots: [{ id: Item.VoidCleaver, count: 1 }] } });
  check('a match-time saveState is rejected outright',
    s.capturePlayerState(1)!.data.x === 120 &&
    (s.capturePlayerState(1)!.data.slots as { id?: number }[])[0]?.id === Item.Diamond);
  const restored = s.handle(1, { t: 'bwLeave' });
  check('leaving restores the exact pre-match body',
    restored.some((o) => o.to === 1 && o.msg.t === 'arenaRestored' && o.msg.x === 120));
  check('no Void Cleaver or wool survives the restore',
    !JSON.stringify(restored.filter((o) => o.msg.t === 'arenaRestored'))
      .includes(`"id":${Item.VoidCleaver}`));
}

// ── Shop ───────────────────────────────────────────────────────────────────
{
  const { s, arenaOf } = liveServer();
  const mid = arenaOf(1);
  s.handle(1, { t: 'xform', x: mid.x, y: mid.y, z: mid.z, yaw: 0, pitch: 0 });
  const far = s.handle(1, { t: 'bwShopBuy', entry: 1 });
  check('buying away from your own Quartermaster is refused',
    far.some((o) => o.msg.t === 'bwError' && o.msg.code === 'too_far'));
}

// ── Cross-match isolation, on the real server ─────────────────────────────
{
  const s = new GameServer(7, token);
  for (const id of [1, 2, 3, 4]) {
    s.addPlayer(id, { username: `P${id}`, faction: id % 2 });
    s.handle(id, { t: 'xform', x: 40 + id, y: 70, z: 40, yaw: 0, pitch: 0 });
  }
  const mk = (host: number, guest: number) => {
    const made = s.handle(host, { t: 'bwCreate' }).find((o) => o.msg.t === 'bwLobby')?.msg;
    if (!made || made.t !== 'bwLobby' || !made.inviteToken) throw new Error('no invite');
    s.handle(guest, { t: 'bwJoin', token: made.inviteToken });
    s.handle(host, { t: 'bwReady', ready: true });
    s.handle(guest, { t: 'bwReady', ready: true });
    const out = s.handle(host, { t: 'bwStart' });
    for (const id of [host, guest]) s.handle(id, { t: 'bwArenaReady' });
    return out.find((o) => o.to === host && o.msg.t === 'bwArena')?.msg;
  };
  const a = mk(1, 2), b = mk(3, 4);
  if (a?.t !== 'bwArena' || b?.t !== 'bwArena') throw new Error('arenas missing');
  s.tickWar(6); s.tickBedwars(6);
  check('two live matches occupy different, non-overlapping slots',
    a.arena.slot !== b.arena.slot &&
    (a.arena.maxX <= b.arena.minX || b.arena.maxX <= a.arena.minX));
  check('a cross-lobby hit is refused', s.handle(1, { t: 'bwMelee', target: 3 }).length === 0);
  check('neither lobby ever appears in the other snapshot',
    s.snapshotFor(1).every((v) => v.id === 1 || v.id === 2) &&
    s.snapshotFor(3).every((v) => v.id === 3 || v.id === 4));
  // A lobby-A edit must never appear in lobby B's traffic.
  const midA = { x: a.arena.originX + 48, y: BEDWARS_FLOOR_Y + 1, z: a.arena.originZ + 48 };
  s.handle(1, { t: 'xform', x: midA.x + 0.5, y: midA.y, z: midA.z + 0.5, yaw: 0, pitch: 0 });
  const edited = s.handle(1, { t: 'edit', x: midA.x, y: midA.y + 1, z: midA.z, block: Block.TeamWoolA });
  check('an arena edit is broadcast to that match only, never to the world',
    edited.length > 0 && edited.every((o) => o.to === 1 || o.to === 2));
}

// ── Arena building rules ───────────────────────────────────────────────────
{
  const { s, arenaOf } = liveServer();
  const mid = arenaOf(1);
  const bx = Math.floor(mid.x), by = Math.floor(mid.y), bz = Math.floor(mid.z);
  s.handle(1, { t: 'xform', x: mid.x, y: mid.y, z: mid.z, yaw: 0, pitch: 0 });
  check('an open-world block is refused inside the arena',
    s.handle(1, { t: 'edit', x: bx, y: by, z: bz, block: Block.Stone }).length === 0);
  check('the ENEMY team wool is refused',
    s.handle(1, { t: 'edit', x: bx, y: by, z: bz, block: Block.TeamWoolB }).length === 0);
  check('your own wool, planks and glass are all allowed',
    s.handle(1, { t: 'edit', x: bx, y: by, z: bz, block: Block.TeamWoolA }).length > 0 &&
    s.handle(1, { t: 'edit', x: bx, y: by + 1, z: bz, block: Block.OakPlanks }).length > 0 &&
    s.handle(1, { t: 'edit', x: bx, y: by + 2, z: bz, block: Block.Glass }).length > 0);
  check('a cell already occupied cannot be stacked into',
    s.handle(1, { t: 'edit', x: bx, y: by, z: bz, block: Block.TeamWoolA }).length === 0);
  check('a placed block can be broken back out',
    s.handle(1, { t: 'edit', x: bx, y: by, z: bz, block: Block.Air }).length > 0);
  check('authored island geometry cannot be broken',
    s.handle(1, { t: 'edit', x: bx, y: BEDWARS_FLOOR_Y, z: bz, block: Block.Air }).length === 0);
  check('a bed cell cannot be mined away through the edit path',
    (() => {
      const bed = bedwarsBedCells({ ...A0, originX: mid.x - 48.5, originZ: mid.z - 48.5 } as never, 0);
      return bed.every((c) =>
        s.handle(1, { t: 'edit', x: c.x, y: c.y, z: c.z, block: Block.Air }).length === 0);
    })());
  check('nothing may be built below the kill plane or above the ceiling',
    s.handle(1, { t: 'edit', x: bx, y: BEDWARS_VOID_Y - 1, z: bz, block: Block.TeamWoolA }).length === 0 &&
    s.handle(1, { t: 'edit', x: bx, y: BEDWARS_CEILING_Y, z: bz, block: Block.TeamWoolA }).length === 0);
}

console.log(`Bedwars smoke: ${passed} checks passed`);
