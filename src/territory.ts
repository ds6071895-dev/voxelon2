// Oil-field TERRITORY CONTROL — the engine of the war economy (M20). Control
// nodes are derived DETERMINISTICALLY from the terrain's oil-field richness
// peaks (pure, seed-based) so every client agrees on where they are with zero
// extra state. A node is controlled by a FACTION (single-faction presence in
// radius); controlling nodes earns OIL INCOME that the server auto-distributes
// to that faction's claims — so seizing territory fuels your shields and losing
// it starves them. The dominance readout tracks faction node control over time.
// PURE + transport-agnostic; the GameServer owns the mutable scoreboard.

import { factionName } from './teams';

/** Oil income (oil/sec) a faction earns per controlled node, fed into each of
 *  that faction's claims (M20 — territory fuels shields). */
export const NODE_OIL_RATE = 6;

export interface ControlNode {
  id: number;
  x: number; z: number;   // node centre (world coords)
  radius: number;         // capture radius
  richness: number;       // oil richness at the peak (flavour + tie-break)
}

/** Live status of one node for the HUD. */
export interface NodeStatus {
  id: number;
  x: number; z: number; radius: number;
  controller: string;     // controlling faction's NAME ('' = uncontrolled / contested)
  faction: number;        // controlling faction id (-1 = uncontrolled / contested)
  contested: boolean;
}

export interface ScoreEntry { name: string; score: number; }

export const TERRITORY_TARGET_SCORE = 300; // first to this wins the round
export const NODE_RADIUS = 10;
const SCAN_RADIUS = 640;   // world units scanned around origin for peaks
const SCAN_STEP = 40;      // grid spacing of candidate samples
const MIN_RICHNESS = 0.45; // a peak must be at least this rich to be a node
const NODE_SPACING = 96;   // minimum separation between chosen nodes
export const MAX_NODES = 6;

/**
 * Deterministically derive control nodes from oil-field richness peaks. Scans a
 * coarse grid around the origin, keeps local maxima above MIN_RICHNESS, then
 * greedily picks the richest, well-separated peaks up to MAX_NODES. Pure: same
 * sampler -> same nodes on every client and the server.
 */
export function deriveControlNodes(
  oilRichness: (x: number, z: number) => number,
): ControlNode[] {
  const candidates: { x: number; z: number; r: number }[] = [];
  for (let x = -SCAN_RADIUS; x <= SCAN_RADIUS; x += SCAN_STEP) {
    for (let z = -SCAN_RADIUS; z <= SCAN_RADIUS; z += SCAN_STEP) {
      const r = oilRichness(x, z);
      if (r < MIN_RICHNESS) continue;
      // Local-maximum test against the 8 grid neighbours.
      let peak = true;
      for (let dx = -1; dx <= 1 && peak; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          if (oilRichness(x + dx * SCAN_STEP, z + dz * SCAN_STEP) > r) { peak = false; break; }
        }
      }
      if (peak) candidates.push({ x, z, r });
    }
  }
  candidates.sort((a, b) => b.r - a.r || a.x - b.x || a.z - b.z);
  const chosen: ControlNode[] = [];
  for (const c of candidates) {
    if (chosen.length >= MAX_NODES) break;
    if (chosen.some((n) => Math.hypot(n.x - c.x, n.z - c.z) < NODE_SPACING)) continue;
    chosen.push({ id: chosen.length, x: c.x, z: c.z, radius: NODE_RADIUS, richness: c.r });
  }
  return chosen;
}

export interface PresencePlayer { faction: number; x: number; z: number; dead: boolean; }

/**
 * Resolve which FACTION controls a node from live presence: collect the factions
 * of living players within the radius. A node is controlled iff exactly one
 * faction is present (its members may number any — team play); two or more
 * distinct factions present -> contested (no control); none -> uncontrolled.
 */
export function resolveNode(node: ControlNode, players: PresencePlayer[]): NodeStatus {
  const present = new Set<number>();
  const r2 = node.radius * node.radius;
  for (const p of players) {
    if (p.dead || !(p.faction >= 0)) continue;
    const dx = p.x - node.x, dz = p.z - node.z;
    if (dx * dx + dz * dz <= r2) present.add(p.faction);
  }
  if (present.size === 1) {
    const f = [...present][0];
    return { id: node.id, x: node.x, z: node.z, radius: node.radius,
      controller: factionName(f), faction: f, contested: false };
  }
  return { id: node.id, x: node.x, z: node.z, radius: node.radius,
    controller: '', faction: -1, contested: present.size > 1 };
}

/** Top-N scoreboard from a name->score map, descending. */
export function topScores(scores: Map<string, number>, limit = 8): ScoreEntry[] {
  return [...scores.entries()]
    .map(([name, score]) => ({ name, score: Math.floor(score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
