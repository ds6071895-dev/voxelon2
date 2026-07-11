// GOLDWARS: a link-invite, bedwars-style minigame. Two teams spawn on
// floating sky islands over the void, each defending a glowing GOLD BLOCK.
// While your gold stands you respawn; once it's mined out, every death is
// final — the last team standing wins. Swords only (guns are rejected).
//
// PURE + transport-agnostic (no THREE/DOM/Node) like teams.ts/machines.ts:
// the map is a fixed, deterministic region of the shared world so the client
// terrain and the authoritative server agree block-for-block. Up to GW_SLOTS
// matches run at once — one arena strip per slot, far out in a world corner
// nobody treks to (the columns outside the islands are pure void).

import { Block } from './blocks';
import { Item } from './items';

// --- Teams -------------------------------------------------------------------
// Two fixed sides. Colors intentionally MATCH the faction palette (Crimson /
// Azure) so avatar tinting can reuse the faction render path via disguises.
export interface GwTeam { id: number; name: string; color: number; css: string }
export const GW_TEAMS: GwTeam[] = [
  { id: 0, name: 'Crimson', color: 0xe23b3b, css: '#e23b3b' },
  { id: 1, name: 'Azure', color: 0x3b78e2, css: '#3b78e2' },
];
export function gwTeamName(id: number): string {
  return GW_TEAMS[id]?.name ?? '???';
}

// --- Arena geometry ----------------------------------------------------------
export const GW_SLOTS = 4;            // concurrent matches supported
export const GW_FLOOR_Y = 150;        // island altitude (well above any terrain here)
export const GW_VOID_Y = GW_FLOOR_Y - 26; // fall below this = death
export const GW_CENTER_X = -2080;     // arena strip: far SW corner of the world
export const GW_CENTER_Z0 = -2080;    // slot i is centred at Z0 + i * SPACING
export const GW_SLOT_SPACING = 160;
/** Long axis is X: base islands at ±BASE_X, gold at ±GOLD_X, bridges between. */
const BASE_X0 = 32, BASE_X1 = 52;     // base island |x| span
const BASE_HZ = 10;                   // base island half-width in z
const MID_HX = 10, MID_HZ = 12;       // centre island half-extents
const BRIDGE_HZ = 1;                  // bridge half-width (3 wide)
const GOLD_X = 46;                    // gold pedestal |x|
/** Region margin so the whole strip (plus falling players) tests as "inside". */
const REGION_MARGIN = 16;

export const GW_MIN_PLAYERS = 2;      // lobby can start at 2 (1v1)
export const GW_SWORD_DAMAGE = 7;     // server-applied sword hit in Goldwars

/** The fresh-spawn Goldwars kit (granted client-side every respawn). */
export const GW_KIT: [number, number][] = [
  [Item.Sword, 1],
  [Item.IronPickaxe, 1],
  [Block.OakPlanks, 64],
];

/** Is (x, z) anywhere inside the Goldwars arena strip (all slots + margin)?
 *  Terrain generation, spawning, structures and vaults all steer clear. */
export function inGoldwarsXZ(x: number, z: number): boolean {
  return x >= GW_CENTER_X - BASE_X1 - REGION_MARGIN &&
    x <= GW_CENTER_X + BASE_X1 + REGION_MARGIN &&
    z >= GW_CENTER_Z0 - MID_HZ - REGION_MARGIN &&
    z <= GW_CENTER_Z0 + (GW_SLOTS - 1) * GW_SLOT_SPACING + MID_HZ + REGION_MARGIN;
}

/** Which arena slot (x, z) falls in, or null (uses the same margin as the
 *  region test, so anything "inside Goldwars" resolves to a slot). */
export function gwSlotAt(x: number, z: number): number | null {
  if (!inGoldwarsXZ(x, z)) return null;
  const i = Math.round((z - GW_CENTER_Z0) / GW_SLOT_SPACING);
  return i >= 0 && i < GW_SLOTS ? i : null;
}

const slotCz = (slot: number): number => GW_CENTER_Z0 + slot * GW_SLOT_SPACING;

/** Each team's GOLD BLOCK position (the objective) for a slot. */
export function goldPos(slot: number, team: number): { x: number; y: number; z: number } {
  return {
    x: GW_CENTER_X + (team === 0 ? -GOLD_X : GOLD_X),
    y: GW_FLOOR_Y + 2,
    z: slotCz(slot),
  };
}

/** A scattered spawn point on a team's base island. */
export function gwSpawn(
  slot: number, team: number, rng: () => number
): { x: number; y: number; z: number } {
  const sign = team === 0 ? -1 : 1;
  return {
    x: GW_CENTER_X + sign * (35 + Math.floor(rng() * 4)) + 0.5,
    y: GW_FLOOR_Y + 1,
    z: slotCz(slot) + Math.floor((rng() * 2 - 1) * (BASE_HZ - 3)) + 0.5,
  };
}

/** The centre of a slot (client pre-loads chunks around it). */
export function gwSlotCenter(slot: number): { x: number; y: number; z: number } {
  return { x: GW_CENTER_X, y: GW_FLOOR_Y + 1, z: slotCz(slot) };
}

/**
 * The BASE map blocks of one world column inside the arena region ([] = pure
 * void). Deterministic and cheap — Terrain.fill calls it per column, and the
 * server uses it to reset a slot between matches.
 */
export function gwColumnBlocks(wx: number, wz: number): { y: number; id: number }[] {
  const slot = gwSlotAt(wx, wz);
  if (slot === null) return [];
  const lx = wx - GW_CENTER_X;
  const lz = wz - slotCz(slot);
  const ax = Math.abs(lx);
  const out: { y: number; id: number }[] = [];
  const F = GW_FLOOR_Y;

  const onBase = ax >= BASE_X0 && ax <= BASE_X1 && Math.abs(lz) <= BASE_HZ;
  const onMid = ax <= MID_HX && Math.abs(lz) <= MID_HZ;
  const onBridge = Math.abs(lz) <= BRIDGE_HZ && ax > MID_HX && ax < BASE_X0;

  if (onBase) {
    const team = lx < 0 ? 0 : 1;
    // Team-tinted deck (crimson red sand vs pale sandstone) on a stone slab.
    out.push({ y: F - 1, id: Block.Stone });
    out.push({ y: F, id: team === 0 ? Block.RedSand : Block.Sandstone });
    // A knee-high cobble parapet along the island rim (not the bridge mouth).
    const rim = ax === BASE_X1 || Math.abs(lz) === BASE_HZ ||
      (ax === BASE_X0 && Math.abs(lz) > BRIDGE_HZ + 1);
    if (rim) out.push({ y: F + 1, id: Block.Cobblestone });
    // The gold pedestal: a cobble plinth with the GOLD BLOCK on top, torch-lit
    // corners one block out.
    if (ax === GOLD_X && lz === 0) {
      out.push({ y: F + 1, id: Block.Cobblestone });
      out.push({ y: F + 2, id: Block.GoldBlock });
    } else if (ax >= GOLD_X - 1 && ax <= GOLD_X + 1 && Math.abs(lz) === 1) {
      if ((ax === GOLD_X - 1 || ax === GOLD_X + 1)) {
        out.push({ y: F + 1, id: Block.Torch });
      }
    }
    // Spawn-side lighting.
    if (ax === BASE_X0 + 2 && Math.abs(lz) === BASE_HZ - 2) {
      out.push({ y: F + 1, id: Block.Torch });
    }
  } else if (onMid) {
    // Centre island: stone deck with a glowing crystal beacon at its heart.
    out.push({ y: F - 1, id: Block.Stone });
    out.push({ y: F, id: Block.Stone });
    if (lx === 0 && lz === 0) out.push({ y: F + 1, id: Block.CrystalBlock });
    if (Math.abs(lx) === MID_HX - 1 && Math.abs(lz) === MID_HZ - 1) {
      out.push({ y: F + 1, id: Block.Torch });
    }
  } else if (onBridge) {
    // The killing lanes: bare 3-wide plank bridges over the void.
    out.push({ y: F, id: Block.OakPlanks });
  }
  return out;
}

/** The BASE block at an exact world cell (Air outside the map shapes) — the
 *  server resets a slot by writing these over any leftover match edits. */
export function gwBaseBlockAt(x: number, y: number, z: number): number {
  for (const b of gwColumnBlocks(x, z)) if (b.y === y) return b.id;
  return Block.Air;
}

/** Bounds a live match clamps its players into (a slot rect + margin). */
export function gwSlotBounds(slot: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const cz = slotCz(slot);
  return {
    minX: GW_CENTER_X - BASE_X1 - REGION_MARGIN,
    maxX: GW_CENTER_X + BASE_X1 + REGION_MARGIN,
    minZ: cz - GW_SLOT_SPACING / 2,
    maxZ: cz + GW_SLOT_SPACING / 2,
  };
}

/** Roll a 5-letter invite code (unambiguous alphabet). */
export function newGwCode(rng: () => number): string {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alpha[Math.floor(rng() * alpha.length)];
  return code;
}

/** Auto-balance a joiner onto the smaller team (ties → Crimson). */
export function gwBalancedTeam(counts: [number, number]): number {
  return counts[1] < counts[0] ? 1 : 0;
}
