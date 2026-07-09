// PROGRESSION — personal + faction XP earned by killing mobs and players.
// Kills grant XP to YOU (level up, spend skill points on a big five-branch
// SKILL TREE) and to YOUR FACTION's shared pool (faction levels grant small
// automatic perks to every member).
//
// The tree: 5 branches × 20 nodes = 100 upgrades. Node costs RISE with depth
// (ranks 1–5 cost 1 point, 6–10 cost 2, 11–15 cost 3, 16–20 cost 4 — 50 points
// to finish one branch) and every 5th node is a uniquely-named CAPSTONE with a
// bigger bonus. A maxed level-100 character has 99 points against a 250-point
// tree, so you SPECIALIZE — you can never own everything.
//
// PURE + transport-agnostic (no THREE/DOM/Node), like machines.ts/war.ts: the
// same rules run on the authoritative server (faction pool + PvP awards), the
// online client (personal XP is client-owned, persisted via saveState like the
// inventory), and offline single-player.

/** XP per mob kill, by mob kind (client-simulated mobs report these). */
export const XP_MOB: Record<string, number> = {
  zombie: 5,
  skitter: 6,
  spitter: 8,
  brute: 40,
};
/** XP for a PvP kill (server-awarded — never client-reported). */
export const XP_PLAYER_KILL = 25;
/** Server clamp on a single client mob-XP report (anti-grief ceiling). */
export const XP_REPORT_CAP = 50;

// --- Personal levels ---------------------------------------------------------
// Total XP to REACH level L: 12·(L−1)² + 28·(L−1). Level 2 ≈ 8 zombies; the
// road to 100 is ~120k XP — hours of play, with each level a bit further away.
export const MAX_LEVEL = 100;

/** Total XP needed to reach a level. */
export function xpForLevel(level: number): number {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1;
  return 12 * l * l + 28 * l;
}
/** Personal level for an XP total (level 1 at 0 XP, capped at MAX_LEVEL). */
export function levelFor(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  // Invert 12l² + 28l = xp for l = level − 1.
  const l = Math.floor((-28 + Math.sqrt(784 + 48 * xp)) / 24);
  return Math.max(1, Math.min(MAX_LEVEL, l + 1));
}
/** Progress fraction [0,1] toward the next level (1 when max level). */
export function levelProgress(xp: number): number {
  const l = levelFor(xp);
  if (l >= MAX_LEVEL) return 1;
  const cur = xpForLevel(l), next = xpForLevel(l + 1);
  return Math.max(0, Math.min(1, (xp - cur) / (next - cur)));
}

// --- The skill tree ------------------------------------------------------------

export type BranchId = 'gunner' | 'tank' | 'scout' | 'miner' | 'slayer';

/** Every effect axis a node can grant. Amounts are summed over owned nodes. */
export type EffectKind =
  | 'speed'   // +fraction move speed
  | 'armor'   // +armor points (on top of worn gear; server caps total at 20)
  | 'reload'  // −fraction gun reload time
  | 'gundmg'  // +fraction gun damage
  | 'spread'  // −fraction gun spread/bloom
  | 'melee'   // +flat melee damage (mobs only — PvP is guns-only)
  | 'mine'    // +fraction mining speed
  | 'energy'  // −fraction sprint energy drain
  | 'fall'    // −fraction fall damage
  | 'xp';     // +fraction mob-kill XP

export interface SkillNode {
  id: string;
  branch: BranchId;
  /** 0-based position in the branch; the prerequisite is index − 1. */
  index: number;
  name: string;
  desc: string;
  icon: string;
  /** Skill-point cost (rises with depth: 1/1/1/1/1/2/2/…/4). */
  cost: number;
  effects: Partial<Record<EffectKind, number>>;
}

export const BRANCH_LENGTH = 20;
/** Capstone positions within each branch (uniquely named, bigger bonuses). */
const CAPSTONE_AT = [4, 9, 14, 19];

interface Capstone {
  name: string; icon: string; desc: string;
  effects: Partial<Record<EffectKind, number>>;
}
export interface BranchDef {
  id: BranchId; name: string; icon: string;
  /** The small bonus EVERY node in the branch grants. */
  perNode: { kind: EffectKind; amount: number; label: string };
  capstones: Capstone[]; // one per CAPSTONE_AT slot, shallow → deep
}

export const BRANCHES: BranchDef[] = [
  {
    id: 'gunner', name: 'Gunslinger', icon: '🔫',
    perNode: { kind: 'reload', amount: 0.02, label: '−2% reload time' },
    capstones: [
      { name: 'Steady Hands', icon: '🎯', effects: { spread: 0.15 }, desc: '−15% gun spread' },
      { name: 'Hollow Points', icon: '💥', effects: { gundmg: 0.06 }, desc: '+6% gun damage' },
      { name: 'Marksman', icon: '🔭', effects: { spread: 0.20 }, desc: '−20% gun spread' },
      { name: 'Deadeye', icon: '💀', effects: { gundmg: 0.12 }, desc: '+12% gun damage' },
    ],
  },
  {
    id: 'tank', name: 'Juggernaut', icon: '🛡',
    perNode: { kind: 'armor', amount: 0.3, label: '+0.3 armor' },
    capstones: [
      { name: 'Soft Landing', icon: '🪂', effects: { fall: 0.15 }, desc: '−15% fall damage' },
      { name: 'Iron Skin', icon: '🛡', effects: { armor: 1 }, desc: '+1 armor' },
      { name: 'Cat Feet', icon: '🐈', effects: { fall: 0.25 }, desc: '−25% fall damage' },
      { name: 'Unbreakable', icon: '💎', effects: { armor: 2 }, desc: '+2 armor' },
    ],
  },
  {
    id: 'scout', name: 'Windrunner', icon: '👟',
    perNode: { kind: 'speed', amount: 0.01, label: '+1% move speed' },
    capstones: [
      { name: 'Second Wind', icon: '🌬', effects: { energy: 0.12 }, desc: '−12% sprint drain' },
      { name: 'Pathfinder', icon: '🧭', effects: { speed: 0.02 }, desc: '+2% move speed' },
      { name: 'Marathoner', icon: '🏃', effects: { energy: 0.18 }, desc: '−18% sprint drain' },
      { name: 'Zephyr', icon: '⚡', effects: { speed: 0.04 }, desc: '+4% move speed' },
    ],
  },
  {
    id: 'miner', name: 'Prospector', icon: '⛏',
    perNode: { kind: 'mine', amount: 0.03, label: '+3% mining speed' },
    capstones: [
      { name: 'Heavy Swing', icon: '🔨', effects: { melee: 1 }, desc: '+1 melee damage' },
      { name: 'Efficiency', icon: '⚙', effects: { mine: 0.08 }, desc: '+8% mining speed' },
      { name: 'Demolitionist', icon: '🧨', effects: { melee: 1.5 }, desc: '+1.5 melee damage' },
      { name: 'Earthbreaker', icon: '🌋', effects: { mine: 0.15 }, desc: '+15% mining speed' },
    ],
  },
  {
    id: 'slayer', name: 'Slayer', icon: '☠',
    perNode: { kind: 'melee', amount: 0.25, label: '+0.25 melee damage' },
    capstones: [
      { name: 'Trophy Hunter', icon: '🏆', effects: { xp: 0.10 }, desc: '+10% mob XP' },
      { name: 'Bloodlust', icon: '🩸', effects: { melee: 1 }, desc: '+1 melee damage' },
      { name: 'Headhunter', icon: '🗡', effects: { xp: 0.15 }, desc: '+15% mob XP' },
      { name: 'Reaper', icon: '⚰', effects: { melee: 2, xp: 0.15 }, desc: '+2 melee · +15% mob XP' },
    ],
  },
];

/** Node cost by branch position: ranks 1–5 → 1pt, 6–10 → 2, 11–15 → 3, 16–20 → 4. */
export function nodeCost(index: number): number {
  return 1 + Math.floor(index / 5);
}

function buildTree(): SkillNode[] {
  const out: SkillNode[] = [];
  for (const b of BRANCHES) {
    for (let i = 0; i < BRANCH_LENGTH; i++) {
      const cap = CAPSTONE_AT.indexOf(i);
      const effects: Partial<Record<EffectKind, number>> = {
        [b.perNode.kind]: b.perNode.amount,
      };
      let name = `${b.name} ${i + 1}`;
      let desc = b.perNode.label;
      let icon = b.icon;
      if (cap >= 0) {
        const c = b.capstones[cap];
        name = c.name;
        icon = c.icon;
        desc = `${b.perNode.label} · ${c.desc}`;
        for (const [k, v] of Object.entries(c.effects)) {
          const kind = k as EffectKind;
          effects[kind] = (effects[kind] ?? 0) + (v as number);
        }
      }
      out.push({ id: `${b.id}${i}`, branch: b.id, index: i, name, desc, icon,
        cost: nodeCost(i), effects });
    }
  }
  return out;
}

export const SKILL_TREE: SkillNode[] = buildTree();
const NODE_BY_ID = new Map(SKILL_TREE.map((n) => [n.id, n]));

export function nodeById(id: string): SkillNode | undefined {
  return NODE_BY_ID.get(id);
}
export function branchNodes(branch: BranchId): SkillNode[] {
  return SKILL_TREE.filter((n) => n.branch === branch);
}

/** A player's progression state (client-owned, persisted like the inventory). */
export interface ProgressState {
  xp: number;
  /** Purchased node ids (contiguous from each branch's root — enforced). */
  nodes: string[];
}

export function newProgress(): ProgressState {
  return { xp: 0, nodes: [] };
}

/** Skill points earned by a level (one per level past 1 — 99 at the cap). */
export function totalPointsFor(level: number): number {
  return Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)) - 1);
}
export function pointsSpent(s: ProgressState): number {
  let n = 0;
  for (const id of s.nodes) n += NODE_BY_ID.get(id)?.cost ?? 0;
  return n;
}
export function pointsAvailable(s: ProgressState): number {
  return Math.max(0, totalPointsFor(levelFor(s.xp)) - pointsSpent(s));
}

/** How many nodes of a branch are owned (always a contiguous root prefix). */
export function branchRank(s: ProgressState, branch: BranchId): number {
  let n = 0;
  for (const id of s.nodes) if (NODE_BY_ID.get(id)?.branch === branch) n++;
  return n;
}

export function ownsNode(s: ProgressState, id: string): boolean {
  return s.nodes.includes(id);
}

/** Can this node be bought right now? (exists, not owned, prereq owned,
 *  enough points). */
export function canBuyNode(s: ProgressState, id: string): boolean {
  const node = NODE_BY_ID.get(id);
  if (!node || ownsNode(s, id)) return false;
  if (node.index > 0 && !ownsNode(s, `${node.branch}${node.index - 1}`)) return false;
  return pointsAvailable(s) >= node.cost;
}

/** Buy a node. Returns whether it was applied. */
export function buyNode(s: ProgressState, id: string): boolean {
  if (!canBuyNode(s, id)) return false;
  s.nodes.push(id);
  return true;
}

/** The player's aggregate personal buffs from every owned node. */
export interface PersonalBuffs {
  speedMult: number;
  armorBonus: number;
  reloadMult: number;
  gunDamageMult: number;
  spreadMult: number;
  meleeBonus: number;
  mineMult: number;
  energyMult: number;
  fallMult: number;
  xpMult: number;
}

export function personalBuffs(s: ProgressState): PersonalBuffs {
  const sum: Record<EffectKind, number> = {
    speed: 0, armor: 0, reload: 0, gundmg: 0, spread: 0,
    melee: 0, mine: 0, energy: 0, fall: 0, xp: 0,
  };
  for (const id of s.nodes) {
    const node = NODE_BY_ID.get(id);
    if (!node) continue;
    for (const [k, v] of Object.entries(node.effects)) {
      sum[k as EffectKind] += v as number;
    }
  }
  return {
    speedMult: 1 + sum.speed,
    armorBonus: Math.round(sum.armor * 10) / 10,
    reloadMult: Math.max(0.4, 1 - sum.reload),
    gunDamageMult: 1 + sum.gundmg,
    spreadMult: Math.max(0.3, 1 - sum.spread),
    meleeBonus: sum.melee,
    mineMult: 1 + sum.mine,
    energyMult: Math.max(0.3, 1 - sum.energy),
    fallMult: Math.max(0.2, 1 - sum.fall),
    xpMult: 1 + sum.xp,
  };
}

/** Fail-closed validation of a persisted progression blob: keeps XP, keeps only
 *  valid node ids as a contiguous prefix per branch, and drops the deepest
 *  purchases until they fit the points the XP actually earned. (Old-format
 *  saves with `spent` tracks simply refund into unspent points.) */
export function sanitizeProgress(raw: unknown): ProgressState {
  const s = newProgress();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  s.xp = Number.isFinite(r.xp) ? Math.max(0, Math.floor(r.xp as number)) : 0;
  const rawNodes = Array.isArray(r.nodes)
    ? (r.nodes as unknown[]).filter((n): n is string => typeof n === 'string')
    : [];
  const owned = new Set(rawNodes.filter((id) => NODE_BY_ID.has(id)));
  // Contiguous prefix per branch, then a global budget pass (shallow first so
  // cheap roots survive over deep expensive nodes).
  const keep: SkillNode[] = [];
  for (const b of BRANCHES) {
    for (let i = 0; i < BRANCH_LENGTH; i++) {
      if (!owned.has(`${b.id}${i}`)) break;
      keep.push(NODE_BY_ID.get(`${b.id}${i}`)!);
    }
  }
  keep.sort((a, c) => a.index - c.index);
  let budget = totalPointsFor(levelFor(s.xp));
  const kept = new Set<string>();
  for (const node of keep) {
    if (node.index > 0 && !kept.has(`${node.branch}${node.index - 1}`)) continue;
    if (node.cost > budget) continue;
    budget -= node.cost;
    kept.add(node.id);
  }
  // Preserve branch order (root → deep) in the stored list.
  for (const b of BRANCHES) {
    for (let i = 0; i < BRANCH_LENGTH; i++) {
      if (kept.has(`${b.id}${i}`)) s.nodes.push(`${b.id}${i}`);
      else break;
    }
  }
  return s;
}

// --- Faction pool -------------------------------------------------------------
// The shared pool grows from every member's kills; faction levels come slower
// than personal ones and grant small automatic perks to every member.
const FACTION_LEVEL_XP = 600;
export const FACTION_MAX_LEVEL = 10;

export function factionLevelFor(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  return Math.min(FACTION_MAX_LEVEL, Math.floor(Math.sqrt(xp / FACTION_LEVEL_XP)) + 1);
}
export function factionXpForLevel(level: number): number {
  const l = Math.max(1, Math.min(FACTION_MAX_LEVEL, Math.floor(level)));
  return FACTION_LEVEL_XP * (l - 1) * (l - 1);
}
export function factionLevelProgress(xp: number): number {
  const l = factionLevelFor(xp);
  if (l >= FACTION_MAX_LEVEL) return 1;
  const cur = factionXpForLevel(l), next = factionXpForLevel(l + 1);
  return Math.max(0, Math.min(1, (xp - cur) / (next - cur)));
}

/** Automatic perks every member of a faction at `level` gets. Small on purpose. */
export function factionPerks(level: number): { armor: number; speedMult: number } {
  const l = Math.max(1, Math.min(FACTION_MAX_LEVEL, Math.floor(level)));
  return {
    armor: Math.min(3, Math.floor(l / 3)),                 // +1 armor at 3/6/9
    speedMult: 1 + Math.min(0.04, (l - 1) * 0.005),        // up to +4% speed
  };
}

/** Fail-closed faction-XP array off the wire/disk (one entry per faction id). */
export function sanitizeFactionXp(raw: unknown, factions: number): number[] {
  const out = new Array<number>(factions).fill(0);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < factions; i++) {
    const v = raw[i];
    out[i] = Number.isFinite(v) ? Math.max(0, Math.floor(v as number)) : 0;
  }
  return out;
}
