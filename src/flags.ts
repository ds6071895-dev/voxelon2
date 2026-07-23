// FACTION FLAGS — the capture-the-flag layer that gives the whole war a spine.
//
// Every faction owns ONE flag, planted dead centre of its half of the
// Heartland. A flag is INVULNERABLE by default; an admin arms them from the
// server console (`flags on`), and even then prising one loose takes a very
// long, very loud beating (FLAG_MAX_HP hits) — you cannot stroll in and pocket
// it. Once it comes free the raider CARRIES it (everyone sees the banner over
// their head, through walls). They only score if they walk it all the way home:
//   · die / log out           → the flag snaps straight back to its own home
//   · reach your own flag pad → CAPTURED: your faction now holds it
//
// The stake: a faction that holds no flag is playing without a safety net —
// running out of hearts eliminates its players PERMANENTLY instead of for a
// day (see hearts.ts + the server's elimination path). Losing your flag is
// survivable, but only if you go and take it back.
//
// PURE + transport-agnostic (no THREE/DOM/Node) so the authoritative server,
// the client's prediction and the smoke tests share one rule set — same
// discipline as machines.ts / claims.ts / teams.ts / war.ts.

import { FACTIONS, isFaction } from './teams';
import { CORE_HALF } from './net/protocol';

/** Hits needed to prise a flag off its pad once flags are armed. Deliberately
 *  brutal: this is meant to take a squad and a long, obvious siege. */
export const FLAG_MAX_HP = 400;
/** Damage one flag hit does (a raider swinging at the pole). */
export const FLAG_HIT_DAMAGE = 1;
/** You must be this close (blocks) to hit a flag or to score a capture. */
export const FLAG_REACH = 4;
/** Seconds between accepted hits from one player (anti macro-spam). */
export const FLAG_HIT_COOLDOWN = 0.25;

export interface FlagHome { x: number; z: number }

/**
 * Home pad for a faction: the middle of its half of the Heartland. With two
 * factions the Heartland splits on X, so Crimson sits at -CORE_HALF/2 and
 * Azure at +CORE_HALF/2, both on the Z axis. Deterministic — the server and
 * every client derive the same spot with no syncing.
 */
export function flagHome(faction: number): FlagHome {
  const n = Math.max(1, FACTIONS.length);
  const i = isFaction(faction) ? faction : 0;
  // Slice the core into N vertical bands and take each band's centre.
  const band = (CORE_HALF * 2) / n;
  return { x: Math.round(-CORE_HALF + band * (i + 0.5)), z: 0 };
}

/** One flag's live state. `holder` is the faction that currently possesses it
 *  (=== faction until somebody captures it); `carrier` is the player id running
 *  it across the map right now, or -1 when it's planted. */
export interface Flag {
  /** Which faction the flag BELONGS to (never changes). */
  faction: number;
  /** Which faction currently possesses it (changes on capture). */
  holder: number;
  /** Remaining pole HP; refills whenever the flag is planted. */
  hp: number;
  /** Player id carrying it, or -1 when planted on a pad. */
  carrier: number;
}

export interface FlagsState {
  /** Admin switch: while false a flag simply cannot be damaged at all. */
  breakable: boolean;
  flags: Flag[];
}

/** All flags planted at home, invulnerable — the default peacetime posture. */
export function newFlags(): FlagsState {
  return {
    breakable: false,
    flags: FACTIONS.map((f) => ({
      faction: f.id, holder: f.id, hp: FLAG_MAX_HP, carrier: -1,
    })),
  };
}

/** Where a flag physically sits right now: its HOLDER's pad (a captured flag
 *  stands as a trophy in the enemy base). Meaningless while carried. */
export function flagPosition(flag: Flag): FlagHome {
  return flagHome(flag.holder);
}

/** The flag a player is currently running, or null. */
export function carriedBy(state: FlagsState, playerId: number): Flag | null {
  return state.flags.find((f) => f.carrier === playerId) ?? null;
}

/** Does this faction possess at least one flag? A faction with none has no
 *  safety net: its players are eliminated PERMANENTLY when hearts run out. */
export function factionHasFlag(state: FlagsState, faction: number): boolean {
  return isFaction(faction) && state.flags.some((f) => f.holder === faction);
}

/** Every faction that currently holds nothing (used for warnings/UI). */
export function flaglessFactions(state: FlagsState): number[] {
  return FACTIONS.map((f) => f.id).filter((id) => !factionHasFlag(state, id));
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

/** The flag a player at (x, z) is standing next to and is ALLOWED to hit: an
 *  enemy-held, planted flag within reach. Null when there's nothing to swing at. */
export function flagInReach(
  state: FlagsState, faction: number, x: number, z: number
): Flag | null {
  for (const f of state.flags) {
    if (f.carrier >= 0) continue;             // already being run
    if (f.holder === faction) continue;       // never rip up your own
    const home = flagPosition(f);
    if (dist2(x, z, home.x, home.z) <= FLAG_REACH * FLAG_REACH) return f;
  }
  return null;
}

export type FlagEvent =
  | { kind: 'hit'; flag: Flag; hp: number }
  | { kind: 'taken'; flag: Flag; by: number }
  | { kind: 'returned'; flag: Flag }
  | { kind: 'captured'; flag: Flag; by: number; faction: number };

/**
 * A raider swings at the flag they're standing next to. Fails closed: no
 * damage while flags are disarmed, out of reach, on your own flag, or on one
 * that's already moving. When the pole finally gives, the raider picks it up.
 */
export function hitFlag(
  state: FlagsState, playerId: number, faction: number, x: number, z: number
): FlagEvent | null {
  if (!state.breakable) return null;
  if (!isFaction(faction)) return null;
  if (carriedBy(state, playerId)) return null; // one flag per pair of hands
  const flag = flagInReach(state, faction, x, z);
  if (!flag) return null;
  flag.hp = Math.max(0, flag.hp - FLAG_HIT_DAMAGE);
  if (flag.hp > 0) return { kind: 'hit', flag, hp: flag.hp };
  flag.carrier = playerId;
  flag.hp = FLAG_MAX_HP; // refills for whoever has to break it next time
  return { kind: 'taken', flag, by: playerId };
}

/** Send a carried flag home (death, disconnect, admin reset). Returns the event
 *  if the player really was carrying something. */
export function returnFlag(state: FlagsState, playerId: number): FlagEvent | null {
  const flag = carriedBy(state, playerId);
  if (!flag) return null;
  flag.carrier = -1;
  flag.hp = FLAG_MAX_HP;
  return { kind: 'returned', flag };
}

/**
 * Scoring: a carrier who reaches THEIR OWN faction's pad plants the stolen flag
 * there and their faction takes possession of it. (You must actually still own
 * a pad to score on — a faction whose own flag has been captured has to take
 * that one back first, at the enemy base, the hard way.)
 */
export function tryCapture(
  state: FlagsState, playerId: number, faction: number, x: number, z: number
): FlagEvent | null {
  const flag = carriedBy(state, playerId);
  if (!flag || !isFaction(faction)) return null;
  const pad = flagHome(faction);
  if (dist2(x, z, pad.x, pad.z) > FLAG_REACH * FLAG_REACH) return null;
  flag.carrier = -1;
  flag.hp = FLAG_MAX_HP;
  flag.holder = faction;
  return { kind: 'captured', flag, by: playerId, faction };
}

/** Fail-closed validation of a FlagsState off the wire/disk. Anything odd
 *  falls back to a fresh, fully-planted set — never a half-broken war. */
export function sanitizeFlags(raw: unknown): FlagsState {
  const fresh = newFlags();
  if (!raw || typeof raw !== 'object') return fresh;
  const r = raw as { breakable?: unknown; flags?: unknown };
  const out = newFlags();
  out.breakable = r.breakable === true;
  if (!Array.isArray(r.flags)) return out;
  for (const f of out.flags) {
    const src = (r.flags as Record<string, unknown>[])
      .find((s) => s && Number(s.faction) === f.faction);
    if (!src) continue;
    const holder = Number(src.holder);
    if (isFaction(holder)) f.holder = holder;
    const hp = Number(src.hp);
    if (Number.isFinite(hp)) f.hp = Math.max(1, Math.min(FLAG_MAX_HP, Math.floor(hp)));
    // Carriers are session-scoped: a flag never restores mid-run (that would
    // hand it to whoever happens to get that player id next boot).
    f.carrier = -1;
  }
  return out;
}
