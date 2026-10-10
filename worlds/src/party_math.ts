// Deterministic leaf helpers shared by venue generation and match decisions.
// Keep this hash byte-for-byte stable: existing course seeds depend on it.
export interface PartyVec3 { x: number; y: number; z: number }

export function partyHash(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}
