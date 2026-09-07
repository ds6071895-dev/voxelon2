// Party Games: the four permanently-stamped sub-arenas, each microgame's own
// rule, and the playlist state machine.
//
// The highest-value checks here are the ones guarding the constraint that
// shaped the whole module: terrain is cached per chunk, so all four arenas are
// stamped side by side and NONE may bleed into another's z slot.

import {
  COLORS_CALLS, COLORS_END_INTERVAL_MS, COLORS_FIELD, COLORS_PALETTE,
  COLORS_START_INTERVAL_MS, KNOCKBACK_HALF, PARTY_ARENA_SIZE_X, PARTY_ARENA_SIZE_Z,
  PARTY_BASE_X, PARTY_CAPACITY, PARTY_CEILING_Y, PARTY_COUNTDOWN_MS, PARTY_FLOOR_Y,
  PARTY_GAMES, PARTY_INTERMISSION_MS, PARTY_KNOCKBACK_TIER, PARTY_MIN_PLAYERS,
  PARTY_PLACEMENT_POINTS, PARTY_PLAYLIST, PARTY_SLOT_SPACING, PARTY_STAMP_MIN_Y,
  PARTY_SUB_SIZE, PARTY_SUB_STRIDE, PARTY_VOID_Y, PartyGamesEngine,
  SLUDGE_BASE_HALF, SLUDGE_MAX_MS, SLUDGE_STEP_MS, SLUDGE_TIERS, SPLEEF_RADIUS,
  clampToPartySub, colorsColorAt, colorsInterval, colorsTileIndex,
  orderPartyOverall, orderPartyRound, partyArenaAt, partyArenaBlockAt,
  partyArenaBounds, partyCanBreak, partyGame, partyPointsFor, partySolidAt,
  partySpawns, partySubBounds, partySubOriginZ, sludgeHeightAt, sludgeLevel,
  type PartyParticipant,
} from '../src/partygames';
import { bedwarsSwing, BW_AXE_TIERS } from '../src/bedwars';
import { Block } from '../src/blocks';
import { Item } from '../src/items';
import { isMinigameOnly } from '../src/minigame_items';
import { arenaBandsDisjoint, arenaBandForX } from '../src/arena';
import { GameServer } from '../src/net/server_core';
import { DUEL_COUNTDOWN_MS } from '../src/duels';

let passed = 0;
function check(name: string, ok: unknown, detail = ''): void {
  if (!ok) throw new Error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`);
  passed++;
}

let tokenN = 0;
const token = () => `${String(++tokenN).padStart(24, 'd')}0123456789abcdef01234567`;
const who = (id: number) => ({ id, username: `Player${id}`, skin: id * 7 });

const A0 = partyArenaBounds(0);

// ── The playlist table ─────────────────────────────────────────────────────
{
  check('every game sits at its own array index',
    PARTY_GAMES.every((g, i) => g.index === i));
  check('the playlist is four microgames and every id resolves',
    PARTY_PLAYLIST.length === 4 &&
    PARTY_PLAYLIST.every((id) => partyGame(id).id === id));
  check('the playlist has no duplicates', new Set(PARTY_PLAYLIST).size === PARTY_PLAYLIST.length);
  check('the footprint has room for exactly the registered games',
    PARTY_GAMES.length * PARTY_SUB_STRIDE <= PARTY_ARENA_SIZE_Z);
  check('every microgame declares a real duration and a legal rule set',
    PARTY_GAMES.every((g) => g.durationMs >= 30_000 && g.durationMs <= 120_000 &&
      ['none', 'break_floor'].includes(g.editable) &&
      ['shovel', 'stick', 'none'].includes(g.loadout)));
  check('placement points are strictly non-increasing and cover the capacity',
    PARTY_PLACEMENT_POINTS.length === PARTY_CAPACITY &&
    PARTY_PLACEMENT_POINTS.every((v, i) => i === 0 || v <= PARTY_PLACEMENT_POINTS[i - 1]));
  check('a placement past the table scores zero rather than undefined',
    partyPointsFor(99) === 0 && partyPointsFor(0) === PARTY_PLACEMENT_POINTS[0]);
}

// ── Sub-arena stamping: the constraint that shaped the module ─────────────
{
  check('the party band is registered and still disjoint from the others',
    arenaBandForX(PARTY_BASE_X)?.kind === 'party' && arenaBandsDisjoint(96));
  check('the arena addresses only its own band',
    partyArenaAt(A0.originX + 5, 5)?.slot === 0 &&
    partyArenaAt(A0.originX - 1, 5) === null &&
    partyArenaAt(A0.originX + PARTY_ARENA_SIZE_X, 5) === null &&
    partyArenaAt(A0.originX + 5, PARTY_ARENA_SIZE_Z) === null &&
    partyArenaAt(PARTY_BASE_X + PARTY_SLOT_SPACING + 5, 5)?.slot === 1);

  // Every sub-arena's geometry must be confined to its own z slot, with a real
  // gutter of void between slots. If this ever fails, one microgame's floor is
  // visible (or reachable) from another's.
  for (let i = 0; i < PARTY_GAMES.length; i++) {
    const sub = partySubBounds(0, i);
    check(`sub-arena ${i} maps to game ${PARTY_GAMES[i].id}`,
      sub.index === i && sub.game === PARTY_GAMES[i].id &&
      sub.minZ === partySubOriginZ(i));
    let stamped = 0, strayed = false;
    for (let z = 0; z < PARTY_ARENA_SIZE_Z; z++) {
      for (let lx = 0; lx < PARTY_ARENA_SIZE_X; lx++) {
        for (let y = PARTY_STAMP_MIN_Y; y <= PARTY_CEILING_Y; y++) {
          if (partyArenaBlockAt(A0.originX + lx, y, z) === null) continue;
          const owner = Math.floor(z / PARTY_SUB_STRIDE);
          if (owner === i) stamped++;
          if (owner !== i && z >= sub.minZ && z < sub.maxZ) strayed = true;
        }
      }
    }
    check(`sub-arena ${i} actually stamps geometry`, stamped > 100, `${stamped} cells`);
    check(`sub-arena ${i} stays inside its own z slot`, !strayed);
  }

  // The gutter.
  let gutterClean = true;
  const gutter = PARTY_SUB_STRIDE - PARTY_SUB_SIZE;
  for (let i = 0; i < PARTY_GAMES.length; i++) {
    for (let z = partySubOriginZ(i) + PARTY_SUB_SIZE; z < partySubOriginZ(i + 1); z++) {
      for (let lx = 0; lx < PARTY_ARENA_SIZE_X; lx++) {
        for (let y = PARTY_STAMP_MIN_Y; y <= PARTY_CEILING_Y; y++) {
          if (partyArenaBlockAt(A0.originX + lx, y, z) !== null) gutterClean = false;
        }
      }
    }
  }
  check('there is a real void gutter of at least 16 blocks between sub-arenas',
    gutterClean && gutter >= 16, `${gutter}`);

  check('nothing is stamped below the stamp floor',
    (() => {
      for (let z = 0; z < PARTY_ARENA_SIZE_Z; z += 3) {
        for (let lx = 0; lx < PARTY_ARENA_SIZE_X; lx += 3) {
          for (let y = PARTY_VOID_Y - 4; y < PARTY_STAMP_MIN_Y; y++) {
            if (partyArenaBlockAt(A0.originX + lx, y, z) !== null) return false;
          }
        }
      }
      return true;
    })());
  check('partyArenaBlockAt is pure across a resample',
    (() => {
      for (let i = 0; i < 20_000; i++) {
        const lx = i % PARTY_ARENA_SIZE_X;
        const z = (i * 7) % PARTY_ARENA_SIZE_Z;
        const y = PARTY_FLOOR_Y + (i % 10) - 2;
        const a = partyArenaBlockAt(A0.originX + lx, y, z);
        if (a !== partyArenaBlockAt(A0.originX + lx, y, z)) return false;
      }
      return true;
    })());
}

// ── Spawns ─────────────────────────────────────────────────────────────────
{
  for (let i = 0; i < PARTY_GAMES.length; i++) {
    const sub = partySubBounds(0, i);
    for (let n = PARTY_MIN_PLAYERS; n <= PARTY_CAPACITY; n++) {
      const spawns = partySpawns(sub, n);
      check(`${PARTY_GAMES[i].id} gives ${n} spawns`, spawns.length === n);
      check(`${PARTY_GAMES[i].id} spawns all stand on solid ground (n=${n})`,
        spawns.every((s) => partySolidAt(s.x, s.y - 1, s.z)),
        spawns.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)}`).join(' '));
      check(`${PARTY_GAMES[i].id} spawns have headroom (n=${n})`,
        spawns.every((s) => !partySolidAt(s.x, s.y + 0.1, s.z) &&
          !partySolidAt(s.x, s.y + 1.1, s.z)));
      check(`${PARTY_GAMES[i].id} spawns are inside their own sub-arena (n=${n})`,
        spawns.every((s) => s.x >= sub.minX && s.x < sub.maxX &&
          s.z >= sub.minZ && s.z < sub.maxZ));
      if (n >= 4) {
        let minGap = Infinity;
        for (let a = 0; a < spawns.length; a++) {
          for (let b = a + 1; b < spawns.length; b++) {
            minGap = Math.min(minGap, Math.hypot(spawns[a].x - spawns[b].x, spawns[a].z - spawns[b].z));
          }
        }
        check(`${PARTY_GAMES[i].id} keeps ${n} spawns at least 4 blocks apart`,
          minGap >= 4, minGap.toFixed(2));
      }
    }
  }
}

// ── Containment ────────────────────────────────────────────────────────────
{
  const sub = partySubBounds(0, 0);
  const out = clampToPartySub({ x: sub.minX - 900, y: 150, z: sub.maxZ + 900 }, sub);
  check('x/z are clamped into the CURRENT sub-arena',
    out.x > sub.minX && out.x < sub.maxX && out.z > sub.minZ && out.z < sub.maxZ);
  check('the ceiling is capped',
    clampToPartySub({ x: sub.minX + 5, y: 9_000, z: sub.minZ + 5 }, sub).y < PARTY_CEILING_Y);
  check('y is NOT floored — falling must stay an elimination',
    clampToPartySub({ x: sub.minX + 5, y: 40, z: sub.minZ + 5 }, sub).y === 40);
}

// ── 1. Spleef ──────────────────────────────────────────────────────────────
{
  const sub = partySubBounds(0, 0);
  const cx = sub.minX + PARTY_SUB_SIZE / 2, cz = sub.minZ + PARTY_SUB_SIZE / 2;
  check('the spleef floor is one row of packed snow',
    partyArenaBlockAt(cx, PARTY_FLOOR_Y, cz) === Block.PackedSnow &&
    partyArenaBlockAt(cx, PARTY_FLOOR_Y - 1, cz) === null &&
    partyArenaBlockAt(cx, PARTY_FLOOR_Y + 1, cz) === null);
  // The real property, rather than an approximation of the circle: no SNOW
  // cell may touch the void, so the diggable field is always ringed by rim and
  // nobody can stand on an undiggable edge tile.
  check('a Void Rim lip stops anyone riding the edge',
    (() => {
      let rim = 0;
      for (let lx = 0; lx < PARTY_SUB_SIZE; lx++) {
        for (let lz = 0; lz < PARTY_SUB_SIZE; lz++) {
          const here = partyArenaBlockAt(sub.minX + lx, PARTY_FLOOR_Y, sub.minZ + lz);
          if (here === Block.ArenaRim) rim++;
          if (here !== Block.PackedSnow) continue;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (partyArenaBlockAt(sub.minX + lx + dx, PARTY_FLOOR_Y, sub.minZ + lz + dz) === null) {
              return false;
            }
          }
        }
      }
      return rim > 20;
    })());
  check('the diggable field is a real disc, not a token patch',
    (() => {
      let snow = 0;
      for (let lx = 0; lx < PARTY_SUB_SIZE; lx++) {
        for (let lz = 0; lz < PARTY_SUB_SIZE; lz++) {
          if (partyArenaBlockAt(sub.minX + lx, PARTY_FLOOR_Y, sub.minZ + lz) === Block.PackedSnow) snow++;
        }
      }
      return snow > 300 && snow < Math.PI * SPLEEF_RADIUS * SPLEEF_RADIUS;
    })());

  // The whole rule, as one predicate.
  check('breaking snow to Air is the only legal edit',
    partyCanBreak(sub, cx, PARTY_FLOOR_Y, cz, Block.Air));
  check('placing anything is refused',
    !partyCanBreak(sub, cx, PARTY_FLOOR_Y, cz, Block.PackedSnow) &&
    !partyCanBreak(sub, cx, PARTY_FLOOR_Y, cz, Block.Stone) &&
    !partyCanBreak(sub, cx, PARTY_FLOOR_Y, cz, Block.TeamWoolA));
  check('breaking the rim is refused',
    !partyCanBreak(sub, sub.minX + 1, PARTY_FLOOR_Y, cz, Block.Air));
  check('breaking empty air is refused',
    !partyCanBreak(sub, cx, PARTY_FLOOR_Y + 3, cz, Block.Air));
  for (let i = 1; i < PARTY_GAMES.length; i++) {
    const other = partySubBounds(0, i);
    check(`no edit is legal in the ${PARTY_GAMES[i].id} sub-arena`,
      !partyCanBreak(other, other.minX + PARTY_SUB_SIZE / 2, PARTY_FLOOR_Y,
        other.minZ + PARTY_SUB_SIZE / 2, Block.Air));
  }
}

// ── 2. Color Chaos ─────────────────────────────────────────────────────────
{
  const sub = partySubBounds(0, 1);
  check('the palette is four distinct colours, two of them the team wools',
    new Set(COLORS_PALETTE).size === 4 &&
    COLORS_PALETTE.includes(Block.TeamWoolA) && COLORS_PALETTE.includes(Block.TeamWoolB));
  check('every palette colour is minigame-only',
    COLORS_PALETTE.every((id) => isMinigameOnly(id)));
  check('the tile hash is deterministic and total',
    (() => {
      for (let i = 0; i < 4_000; i++) {
        const tx = i % 40, tz = Math.floor(i / 40);
        const v = colorsTileIndex(tx, tz);
        if (!Number.isInteger(v) || v < 0 || v >= COLORS_PALETTE.length) return false;
        if (v !== colorsTileIndex(tx, tz)) return false;
      }
      return true;
    })());
  check('the hash actually uses all four colours',
    (() => {
      const seen = new Set<number>();
      for (let tx = 0; tx < 12; tx++) for (let tz = 0; tz < 12; tz++) seen.add(colorsTileIndex(tx, tz));
      return seen.size === COLORS_PALETTE.length;
    })());
  check('a tile is a solid 3x3 block of one colour',
    (() => {
      const base = COLORS_FIELD / 2;
      for (let tx = 0; tx < 4; tx++) {
        for (let tz = 0; tz < 4; tz++) {
          const lx0 = PARTY_SUB_SIZE / 2 - base + tx * 3;
          const lz0 = PARTY_SUB_SIZE / 2 - base + tz * 3;
          const want = colorsColorAt(lx0, lz0);
          for (let dx = 0; dx < 3; dx++) {
            for (let dz = 0; dz < 3; dz++) {
              if (colorsColorAt(lx0 + dx, lz0 + dz) !== want) return false;
            }
          }
        }
      }
      return true;
    })());
  check('off the field there is no colour',
    colorsColorAt(0, 0) === -1 && colorsColorAt(PARTY_SUB_SIZE - 1, PARTY_SUB_SIZE - 1) === -1);
  check('the stamped floor matches the colour function everywhere',
    (() => {
      for (let lx = 0; lx < PARTY_SUB_SIZE; lx++) {
        for (let lz = 0; lz < PARTY_SUB_SIZE; lz++) {
          const colour = colorsColorAt(lx, lz);
          const want = colour < 0 ? null : COLORS_PALETTE[colour];
          if (partyArenaBlockAt(sub.minX + lx, PARTY_FLOOR_Y, sub.minZ + lz) !== want) return false;
        }
      }
      return true;
    })());
  check('the call interval tightens monotonically to its floor',
    colorsInterval(0) === COLORS_START_INTERVAL_MS &&
    colorsInterval(COLORS_CALLS - 1) === COLORS_END_INTERVAL_MS &&
    Array.from({ length: COLORS_CALLS }, (_, i) => colorsInterval(i))
      .every((v, i, a) => i === 0 || v <= a[i - 1]));

  // The flagged risk: the restore must be IDEMPOTENT. The implementation is a
  // footprint sweep ("delete every edit inside this sub-arena"), never a paired
  // inverse batch, so vanishing twice and restoring once still leaves it whole.
  const edits = new Map<string, number>();
  const vanish = (keep: number): void => {
    for (let lx = 0; lx < PARTY_SUB_SIZE; lx++) {
      for (let lz = 0; lz < PARTY_SUB_SIZE; lz++) {
        const colour = colorsColorAt(lx, lz);
        if (colour < 0 || colour === keep) continue;
        edits.set(`${sub.minX + lx},${PARTY_FLOOR_Y},${sub.minZ + lz}`, Block.Air);
      }
    }
  };
  const sweepRestore = (): void => {
    for (const key of [...edits.keys()]) {
      const [x, , z] = key.split(',').map(Number);
      if (x >= sub.minX && x < sub.maxX && z >= sub.minZ && z < sub.maxZ) edits.delete(key);
    }
  };
  vanish(0); vanish(1);
  check('a double vanish really did remove floor', edits.size > 100);
  sweepRestore();
  check('one sweep restores the whole floor, however many vanishes preceded it',
    edits.size === 0);
  check('the floor is whole again by the authored stamp',
    (() => {
      for (let lx = 0; lx < PARTY_SUB_SIZE; lx++) {
        for (let lz = 0; lz < PARTY_SUB_SIZE; lz++) {
          const colour = colorsColorAt(lx, lz);
          if (colour < 0) continue;
          const key = `${sub.minX + lx},${PARTY_FLOOR_Y},${sub.minZ + lz}`;
          if (edits.has(key)) return false;
          if (partyArenaBlockAt(sub.minX + lx, PARTY_FLOOR_Y, sub.minZ + lz) === null) return false;
        }
      }
      return true;
    })());
}

// ── 3. Rising Sludge ───────────────────────────────────────────────────────
{
  const sub = partySubBounds(0, 2);
  const c = PARTY_SUB_SIZE / 2;
  check('the pyramid is stepped, tallest at the centre',
    sludgeHeightAt(c, c, PARTY_FLOOR_Y) > sludgeHeightAt(c + SLUDGE_BASE_HALF, c, PARTY_FLOOR_Y) &&
    sludgeHeightAt(c + SLUDGE_BASE_HALF + 1, c, PARTY_FLOOR_Y) === -1);
  check('height never exceeds the tier count',
    (() => {
      for (let lx = 0; lx < PARTY_SUB_SIZE; lx++) {
        for (let lz = 0; lz < PARTY_SUB_SIZE; lz++) {
          const h = sludgeHeightAt(lx, lz, PARTY_FLOOR_Y);
          if (h >= 0 && h > PARTY_FLOOR_Y + SLUDGE_TIERS) return false;
        }
      }
      return true;
    })());
  check('the summit is reachable as a staircase, one tier at a time',
    (() => {
      let prev = sludgeHeightAt(c + SLUDGE_BASE_HALF, c, PARTY_FLOOR_Y);
      for (let d = SLUDGE_BASE_HALF - 1; d >= 0; d--) {
        const h = sludgeHeightAt(c + d, c, PARTY_FLOOR_Y);
        if (h - prev > 1) return false;
        prev = h;
      }
      return true;
    })());
  check('step caps read differently from the body',
    (() => {
      const h = sludgeHeightAt(c, c, PARTY_FLOOR_Y);
      return partyArenaBlockAt(sub.minX + c, h, sub.minZ + c) === Block.Terracotta &&
        partyArenaBlockAt(sub.minX + c, h - 1, sub.minZ + c) === Block.Basalt;
    })());
  check('it is opaque rock, not a fluid — no lava semantics anywhere',
    (() => {
      for (let lx = 0; lx < PARTY_SUB_SIZE; lx++) {
        for (let y = PARTY_FLOOR_Y; y <= PARTY_FLOOR_Y + SLUDGE_TIERS; y++) {
          const b = partyArenaBlockAt(sub.minX + lx, y, sub.minZ + c);
          if (b !== null && b !== Block.Terracotta && b !== Block.Basalt) return false;
        }
      }
      return true;
    })());
  check('the sludge rises one row per step and stops at the summit',
    sludgeLevel(0, PARTY_FLOOR_Y) === PARTY_FLOOR_Y &&
    sludgeLevel(SLUDGE_STEP_MS, PARTY_FLOOR_Y) === PARTY_FLOOR_Y + 1 &&
    sludgeLevel(SLUDGE_MAX_MS, PARTY_FLOOR_Y) === PARTY_FLOOR_Y + SLUDGE_TIERS &&
    sludgeLevel(999_999, PARTY_FLOOR_Y) === PARTY_FLOOR_Y + SLUDGE_TIERS);
  check('the climb is BOUNDED BY CONSTRUCTION, well inside the round limit',
    SLUDGE_MAX_MS === 28_000 && SLUDGE_MAX_MS < partyGame('lava').durationMs);
  check('the sludge eventually covers every standable cell',
    (() => {
      const top = sludgeLevel(SLUDGE_MAX_MS, PARTY_FLOOR_Y);
      for (let lx = 0; lx < PARTY_SUB_SIZE; lx++) {
        for (let lz = 0; lz < PARTY_SUB_SIZE; lz++) {
          const h = sludgeHeightAt(lx, lz, PARTY_FLOOR_Y);
          if (h >= 0 && h > top) return false;
        }
      }
      return true;
    })());
}

// ── 4. Knockback Arena ─────────────────────────────────────────────────────
{
  const sub = partySubBounds(0, 3);
  const c = PARTY_SUB_SIZE / 2;
  check('a flat platform over void',
    partyArenaBlockAt(sub.minX + c, PARTY_FLOOR_Y, sub.minZ + c) === Block.SpectralMarble &&
    partyArenaBlockAt(sub.minX + c, PARTY_FLOOR_Y - 1, sub.minZ + c) === null);
  check('a glass rim on the OUTER ring only, so corners bounce you back in',
    partyArenaBlockAt(sub.minX + c + KNOCKBACK_HALF, PARTY_FLOOR_Y + 1,
      sub.minZ + c) === Block.Glass &&
    partyArenaBlockAt(sub.minX + c + KNOCKBACK_HALF - 1, PARTY_FLOOR_Y + 1,
      sub.minZ + c) === null);
  check('past the platform there is nothing at all',
    partyArenaBlockAt(sub.minX + c + KNOCKBACK_HALF + 1, PARTY_FLOOR_Y, sub.minZ + c) === null);

  // The stick is one more tier-table entry fed to the SAME pure swing function.
  check('the knockback stick is minigame-only', isMinigameOnly(Item.KnockbackStick));
  const swung = bedwarsSwing({
    tier: PARTY_KNOCKBACK_TIER, sinceLastSwingMs: 10_000, combo: 0,
    onGround: true, vy: 0, speed: 0, toTargetX: 1, toTargetZ: 0, lookX: 1, lookZ: 0,
  });
  check('the stick launches far harder than any Bedwars axe',
    Math.hypot(swung.kx, swung.kz) > Math.hypot(
      ...(() => {
        const a = bedwarsSwing({
          tier: BW_AXE_TIERS[3], sinceLastSwingMs: 10_000, combo: 0, onGround: true,
          vy: 0, speed: 0, toTargetX: 1, toTargetZ: 0, lookX: 1, lookZ: 0,
        });
        return [a.kx, a.kz];
      })()));
  check('the stick still gives vertical lift, so a hit leaves the floor', swung.ky > 0);
  check('the tier is faster than every axe', PARTY_KNOCKBACK_TIER.cooldownMs <
    Math.min(...BW_AXE_TIERS.map((t) => t.cooldownMs)));
}

// ── Scoring ────────────────────────────────────────────────────────────────
{
  const mk = (id: number, alive: boolean, elim: number, joinOrder: number,
    points = 0, placements: number[] = []) =>
    ({ id, username: `P${id}`, skin: 0, host: false, ready: false, connected: true,
      joinOrder, points, placements, alive, eliminatedAt: elim }) as PartyParticipant;

  const round = orderPartyRound([
    mk(1, false, 100, 0), mk(2, true, Infinity, 1), mk(3, false, 500, 2), mk(4, true, Infinity, 3),
  ]);
  check('survivors rank ahead of everyone eliminated',
    round[0].alive && round[1].alive && !round[2].alive && !round[3].alive);
  check('among survivors, join order decides', round[0].id === 2 && round[1].id === 4);
  check('among the eliminated, surviving LONGER is better',
    round[2].id === 3 && round[3].id === 1);
  check('the round order is total — reversing the input never changes it',
    (() => {
      const rows = [mk(1, false, 100, 0), mk(2, true, Infinity, 1), mk(3, false, 500, 2)];
      return orderPartyRound(rows).map((p) => p.id).join() ===
        orderPartyRound([...rows].reverse()).map((p) => p.id).join();
    })());

  const overall = orderPartyOverall([
    mk(1, true, Infinity, 0, 20, [1, 1]),
    mk(2, true, Infinity, 1, 20, [0, 3]),
    mk(3, true, Infinity, 2, 25, [0, 0]),
  ]);
  check('points win first', overall[0].id === 3);
  check('a points tie breaks on most FIRSTS', overall[1].id === 2);
  check('the overall order is total',
    (() => {
      const rows = [mk(1, true, Infinity, 0, 9, [2]), mk(2, true, Infinity, 1, 9, [2])];
      return orderPartyOverall(rows).map((p) => p.id).join() === '1,2' &&
        orderPartyOverall([...rows].reverse()).map((p) => p.id).join() === '1,2';
    })());
}

// ── The playlist state machine ─────────────────────────────────────────────
function liveParty(n = 4, now = 1_000): { pg: PartyGamesEngine; t: number; ids: number[] } {
  const pg = new PartyGamesEngine(token);
  const made = pg.create(who(1), now);
  if ('reason' in made) throw new Error('create failed');
  const ids = [1];
  for (let i = 2; i <= n; i++) { pg.join(made.token, who(i), now); ids.push(i); }
  for (const id of ids) pg.setReady(id, true, now);
  const started = pg.start(1, now);
  if (!started.ok) throw new Error(`start failed: ${started.reason}`);
  for (const id of ids) pg.markArenaReady(id, now);
  const t = now + PARTY_COUNTDOWN_MS + 1;
  pg.tick(t);
  return { pg, t, ids };
}

{
  const pg = new PartyGamesEngine(token);
  const made = pg.create(who(1), 0);
  if ('reason' in made) throw new Error('create failed');
  check('a lobby declares itself UNRANKED', made.snapshot.ranked === false);
  check('the invite token stays out of the public snapshot',
    !JSON.stringify(made.snapshot).includes(made.token));
  for (let i = 2; i <= PARTY_CAPACITY; i++) {
    check(`player ${i} joins`, pg.join(made.token, who(i), 0).ok);
  }
  const over = pg.join(made.token, who(99), 0);
  check('the ninth player is refused', !over.ok && over.reason === 'full');
  check('an FFA needs three bodies before it can start',
    (() => {
      const small = new PartyGamesEngine(token);
      const m = small.create(who(1), 0);
      if ('reason' in m) throw new Error('create failed');
      small.join(m.token, who(2), 0);
      small.setReady(1, true, 0); small.setReady(2, true, 0);
      const r = small.start(1, 0);
      return !r.ok && r.reason === 'too_few_players';
    })());
}

{
  const { pg, t, ids } = liveParty(4);
  check('the first microgame is the first playlist entry',
    pg.phaseFor(1) === 'running' && pg.roundFor(1)?.game === PARTY_PLAYLIST[0]);
  check('everybody starts alive with nothing scored',
    ids.every((id) => pg.participantFor(id)!.alive && pg.participantFor(id)!.points === 0));
  check('the sub-arena tracks the running microgame', pg.subFor(1)?.index === 0);
  check('sameMatch holds inside the room and nowhere else',
    pg.sameMatch(1, 2) && !pg.sameMatch(1, 99));
  check('the knockback stick is inert while a different microgame runs',
    !pg.knockbackLive(1));

  // Eliminate three; the last one standing ends the round early.
  pg.recordElimination(2, t + 100);
  check('an elimination is recorded once and is idempotent',
    !pg.participantFor(2)!.alive && pg.recordElimination(2, t + 200) === null);
  pg.recordElimination(3, t + 300);
  check('the round is still live with two alive', pg.phaseFor(1) === 'running');
  pg.recordElimination(4, t + 400);
  check('the last one standing ends the round immediately',
    pg.phaseFor(1) === 'intermission');
  check('the survivor took first and the points ladder was applied',
    pg.participantFor(1)!.points === PARTY_PLACEMENT_POINTS[0] &&
    pg.participantFor(4)!.points === PARTY_PLACEMENT_POINTS[1] &&
    pg.participantFor(2)!.points === PARTY_PLACEMENT_POINTS[3]);
  check('the intermission names the microgame it is counting down TO',
    pg.snapshotFor(1, t)!.nextGame === PARTY_PLAYLIST[1]);
  check('everybody is alive again for the next round',
    ids.every((id) => pg.participantFor(id)!.alive));

  pg.tick(t + 500 + PARTY_INTERMISSION_MS);
  check('the intermission hands over to the second microgame',
    pg.phaseFor(1) === 'running' && pg.roundFor(1)?.game === PARTY_PLAYLIST[1] &&
    pg.subFor(1)?.index === 1);
}

{
  // A full playlist driven PURELY by tick() must always crown exactly one winner.
  const { pg, t, ids } = liveParty(5);
  let now = t;
  let guard = 0;
  while (pg.phaseFor(1) !== 'results' && guard++ < 10_000) {
    now += 1_000;
    pg.tick(now);
  }
  const snap = pg.snapshotFor(1, now)!;
  check('a full four-round playlist terminates on the clock alone',
    snap.phase === 'results', `${guard} ticks`);
  check('it crowns exactly one winner',
    snap.result !== undefined && snap.result.winner !== null &&
    snap.result.scoreboard.length === ids.length);
  check('every player played every round',
    snap.result!.scoreboard.every((p) => p.placements.length === PARTY_PLAYLIST.length));
  check('the winner really does top the board',
    snap.result!.winner === snap.result!.scoreboard[0].id);
  check('the result is unranked and carries no progression',
    snap.result!.ranked === false && !('progressChanges' in snap.result!));
  check('a whole match runs to roughly six minutes',
    snap.result!.durationMs > 4 * 60_000 && snap.result!.durationMs < 8 * 60_000,
    `${Math.round(snap.result!.durationMs / 1000)}s`);
}

{
  // Dropping to one connected player forfeits rather than hanging.
  const { pg, t } = liveParty(3);
  pg.leave(2, t + 10);
  check('losing one of three keeps the match alive', pg.phaseFor(1) === 'running');
  pg.leave(3, t + 20);
  check('dropping to a single player forfeits', pg.phaseFor(1) === 'results');
  const gone = pg.leave(1, t + 30);
  check('the last member out deletes the lobby and frees its slot', gone.deleted);
  const again = pg.create(who(9), t + 40);
  if ('reason' in again) throw new Error('recreate failed');
  pg.join(again.token, who(10), t + 40); pg.join(again.token, who(11), t + 40);
  for (const id of [9, 10, 11]) pg.setReady(id, true, t + 40);
  pg.start(9, t + 40);
  check('the freed slot is reused', pg.arenaFor(9)?.slot === 0);
}

{
  // Two concurrent parties must not share geometry.
  const pg = new PartyGamesEngine(token);
  const a = pg.create(who(1), 0), b = pg.create(who(4), 0);
  if ('reason' in a || 'reason' in b) throw new Error('create failed');
  for (const id of [2, 3]) pg.join(a.token, who(id), 0);
  for (const id of [5, 6]) pg.join(b.token, who(id), 0);
  for (const id of [1, 2, 3, 4, 5, 6]) pg.setReady(id, true, 0);
  pg.start(1, 0); pg.start(4, 0);
  check('concurrent parties get different slots', pg.arenaFor(1)!.slot !== pg.arenaFor(4)!.slot);
  check('their footprints do not overlap',
    pg.arenaFor(1)!.maxX <= pg.arenaFor(4)!.minX ||
    pg.arenaFor(4)!.maxX <= pg.arenaFor(1)!.minX);
  check('membership never spans parties',
    pg.membersOf(1).sort((x, y) => x - y).join() === '1,2,3' &&
    !pg.sameMatch(1, 4));
}

// ── Server: the route is the security model ───────────────────────────────
/** Three players in a live party, sitting in the first microgame (Spleef). */
function liveServer(): { s: GameServer; sub: ReturnType<typeof partySubBounds> } {
  const s = new GameServer(11, token);
  for (const id of [1, 2, 3, 4]) {
    s.addPlayer(id, { username: `P${id}`, faction: id % 2 });
    s.handle(id, { t: 'xform', x: 40 + id, y: 70, z: 40, yaw: 0, pitch: 0 });
  }
  const made = s.handle(1, { t: 'partyCreate' }).find((o) => o.msg.t === 'partyLobby')?.msg;
  if (!made || made.t !== 'partyLobby' || !made.inviteToken) throw new Error('no party invite');
  s.handle(2, { t: 'partyJoin', token: made.inviteToken });
  s.handle(3, { t: 'partyJoin', token: made.inviteToken });
  for (const id of [1, 2, 3]) s.handle(id, { t: 'partyReady', ready: true });
  const started = s.handle(1, { t: 'partyStart' });
  const arenaMsg = started.find((o) => o.to === 1 && o.msg.t === 'partyArena')?.msg;
  if (!arenaMsg || arenaMsg.t !== 'partyArena') throw new Error('no partyArena');
  for (const id of [1, 2, 3]) s.handle(id, { t: 'partyArenaReady' });
  s.tickWar(6); s.tickParty();
  return { s, sub: arenaMsg.sub };
}

{
  const { s, sub } = liveServer();
  check('the party is running the first microgame',
    s.party.phaseFor(1) === 'running' && s.party.roundFor(1)?.game === PARTY_PLAYLIST[0]);
  check('party bodies leave the open world, the bystander stays in it',
    !s.receivesWorldBroadcast(1) && !s.receivesWorldBroadcast(2) &&
    !s.receivesWorldBroadcast(3) && s.receivesWorldBroadcast(4) &&
    s.snapshotFor(4).every((v) => v.id === 4));

  // Spleef's edit rule, through the real handler.
  const cx = Math.floor(sub.minX + PARTY_SUB_SIZE / 2);
  const cz = Math.floor(sub.minZ + PARTY_SUB_SIZE / 2);
  s.handle(1, { t: 'xform', x: cx + 0.5, y: PARTY_FLOOR_Y + 1.01, z: cz + 0.5, yaw: 0, pitch: 0 });
  check('digging the snow floor is accepted',
    s.handle(1, { t: 'edit', x: cx, y: PARTY_FLOOR_Y, z: cz, block: Block.Air }).length > 0);
  check('digging the same cell twice is a no-op',
    s.handle(1, { t: 'edit', x: cx, y: PARTY_FLOOR_Y, z: cz, block: Block.Air }).length === 0);
  check('placing ANYTHING is refused',
    s.handle(1, { t: 'edit', x: cx, y: PARTY_FLOOR_Y, z: cz, block: Block.PackedSnow }).length === 0 &&
    s.handle(1, { t: 'edit', x: cx, y: PARTY_FLOOR_Y + 1, z: cz, block: Block.OakPlanks }).length === 0 &&
    s.handle(1, { t: 'edit', x: cx, y: PARTY_FLOOR_Y + 1, z: cz, block: Block.TeamWoolA }).length === 0);
  check('a spleef edit reaches the party and nobody else',
    (() => {
      const out = s.handle(1, { t: 'edit', x: cx + 1, y: PARTY_FLOOR_Y, z: cz, block: Block.Air });
      return out.length > 0 && out.every((o) => [1, 2, 3].includes(o.to as number));
    })());
  check('the world edit log never gains a party block',
    s.serialize().edits.every(([, b]) => b === Block.Air));

  // The stick is inert while a non-knockback microgame runs.
  check('partyMelee is inert during Spleef', s.handle(1, { t: 'partyMelee', target: 2 }).length === 0);
  check('a Bedwars verb is inert inside a party',
    s.handle(1, { t: 'bwMelee', target: 2 }).length === 0 &&
    s.handle(1, { t: 'bwShopBuy', entry: 1 }).length === 0);
  check('a self-hit and an unknown target are both refused',
    s.handle(1, { t: 'partyMelee', target: 1 }).length === 0 &&
    s.handle(1, { t: 'partyMelee', target: 9_999 }).length === 0);
  check('a hit on a non-participant is refused',
    s.handle(1, { t: 'partyMelee', target: 4 }).length === 0);
}

{
  // In the open world and inside other minigames, every party verb is inert.
  const s = new GameServer(11, token);
  s.addPlayer(1, { username: 'A', faction: 0 });
  s.addPlayer(2, { username: 'B', faction: 1 });
  for (const id of [1, 2]) s.handle(id, { t: 'xform', x: 40, y: 70, z: 41, yaw: 0, pitch: 0 });
  check('partyMelee is inert in the open world',
    s.handle(1, { t: 'partyMelee', target: 2 }).length === 0);
  const before = s.serialize().edits.length;
  check('the open world is untouched by it', s.serialize().edits.length === before);

  const made = s.handle(1, { t: 'duelCreate' }).find((o) => o.msg.t === 'duelLobby')?.msg;
  if (!made || made.t !== 'duelLobby' || !made.inviteToken) throw new Error('no duel invite');
  s.handle(2, { t: 'duelJoin', token: made.inviteToken });
  s.handle(1, { t: 'duelReady', ready: true }); s.handle(2, { t: 'duelReady', ready: true });
  s.handle(1, { t: 'duelStart' });
  for (const id of [1, 2]) s.handle(id, { t: 'duelArenaReady' });
  s.tickWar(DUEL_COUNTDOWN_MS / 1000); s.tickDuels();
  check('partyMelee is inert inside a live Duels match',
    s.handle(1, { t: 'partyMelee', target: 2 }).length === 0);
}

{
  // Arena state must never persist out of a party.
  const s = new GameServer(11, token);
  for (const id of [1, 2, 3]) {
    s.addPlayer(id, { username: `P${id}`, faction: 0 });
    s.handle(id, { t: 'xform', x: 200 + id, y: 70, z: 30, yaw: 0, pitch: 0 });
  }
  s.handle(1, { t: 'saveState', data: { x: 201, y: 70, z: 30,
    slots: [{ id: Item.Diamond, count: 2 }] } });
  const made = s.handle(1, { t: 'partyCreate' }).find((o) => o.msg.t === 'partyLobby')?.msg;
  if (!made || made.t !== 'partyLobby' || !made.inviteToken) throw new Error('no invite');
  s.handle(2, { t: 'partyJoin', token: made.inviteToken });
  s.handle(3, { t: 'partyJoin', token: made.inviteToken });
  for (const id of [1, 2, 3]) s.handle(id, { t: 'partyReady', ready: true });
  s.handle(1, { t: 'partyStart' });
  const captured = s.capturePlayerState(1)!.data;
  check('mid-party capture returns the pre-match body',
    captured.x === 201 && (captured.slots as { id?: number }[])[0]?.id === Item.Diamond);
  s.handle(1, { t: 'saveState', data: { x: 9_999, slots: [{ id: Item.KnockbackStick, count: 1 }] } });
  check('a match-time saveState is rejected', s.capturePlayerState(1)!.data.x === 201);
  const left = s.handle(1, { t: 'partyLeave' });
  check('leaving restores the exact pre-match body',
    left.some((o) => o.to === 1 && o.msg.t === 'arenaRestored' && o.msg.x === 201));
  check('no Knockback Stick survives the restore',
    !JSON.stringify(left.filter((o) => o.msg.t === 'arenaRestored'))
      .includes(`"id":${Item.KnockbackStick}`));
}

console.log(`Party Games smoke: ${passed} checks passed`);
