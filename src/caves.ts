// Large cave landmarks are analytic, world-space shapes. Sampling the same
// column gives identical arches, floors and waterlines in any chunk order.
import { Block } from './blocks';
import { hash2, Noise2D } from './noise';
import { plazaDistance, PLAZA_CLEAR } from './plaza';
import { vaultAnchorAt, VAULT_REACH } from './vaults';
import type { StructureCtx } from './structures';

type CaveContext = Pick<StructureCtx, 'height'> & Partial<StructureCtx>;
export type CaveStyle = 'lush' | 'crystal' | 'limestone';
export interface CaveLandmark {
  x: number; z: number; floor: number; ceiling: number; rx: number; rz: number;
  style: CaveStyle; mouthX: number; mouthZ: number; mouthY: number;
  width: number; entrance: boolean;
}
export interface CaveSlice {
  floor: number; ceiling: number; style: CaveStyle; pool: boolean; entrance: boolean;
  /** A sloping rock bridge survives where an entrance crosses a deeper room. */
  rampFloor?: number;
}

const CELL = 128;
export class Caves {
  private readonly landmarks = new Map<string, CaveLandmark | null>();
  private readonly chunks = new Map<string, CaveLandmark[]>();
  private readonly vaults = new Map<string, boolean>();
  private readonly detail: Noise2D;
  constructor(private readonly seed: number, private readonly ctx: CaveContext) {
    this.detail = new Noise2D(seed ^ 0xcca71);
  }

  private approachClear(x: number, z: number, px: number, pz: number): boolean {
    if (!this.ctx.ravineDepth || !this.ctx.biomeWithWater) return true;
    const margin = VAULT_REACH * 16 + 24;
    for (let cx = Math.floor((Math.min(x, px) - margin) / 16); cx <= Math.floor((Math.max(x, px) + margin) / 16); cx++) {
      for (let cz = Math.floor((Math.min(z, pz) - margin) / 16); cz <= Math.floor((Math.max(z, pz) + margin) / 16); cz++) {
        const key = `${cx},${cz}`;
        let occupied = this.vaults.get(key);
        if (occupied === undefined) {
          occupied = vaultAnchorAt(this.seed, cx, cz, this.ctx as StructureCtx);
          if (this.vaults.size > 8192) this.vaults.clear();
          this.vaults.set(key, occupied);
        }
        if (occupied) return false;
      }
    }
    return true;
  }

  landmark(cx: number, cz: number): CaveLandmark | null {
    const key = `${cx},${cz}`;
    if (this.landmarks.has(key)) return this.landmarks.get(key)!;
    const h = (salt: number) => hash2(this.seed ^ salt, cx, cz);
    const x = cx * CELL + 40 + Math.floor(h(0xca01) * 48);
    const z = cz * CELL + 40 + Math.floor(h(0xca02) * 48);
    const ground = this.ctx.height(x, z);
    let result: CaveLandmark | null = null;
    if (ground > 67 && plazaDistance(x, z) > PLAZA_CLEAR + 65) {
      const rx = 32 + h(0xca03) * 19, rz = 32 + h(0xca04) * 19;
      const floor = 13 + Math.floor(h(0xca05) * 16);
      const ceiling = Math.min(ground - 9, floor + 34 + Math.floor(h(0xca06) * 34));
      // Search the surrounding hillside for a low, dry approach. The mouth
      // connects directly to the chamber, rather than opening onto solid rock.
      let mouthX = x, mouthZ = z, mouthY = 256;
      const rotation = h(0xca07) * Math.PI * 2;
      for (let i = 0; i < 16; i++) {
        const a = rotation + i * Math.PI / 8;
        const px = Math.round(x + Math.cos(a) * (rx + 23));
        const pz = Math.round(z + Math.sin(a) * (rz + 23));
        // Keep each approach in its own district. Deep domes may join, but
        // crossing two entrance ramps at different heights creates a cliff.
        if (px < cx * CELL + 13 || px > (cx + 1) * CELL - 13 ||
            pz < cz * CELL + 13 || pz > (cz + 1) * CELL - 13) continue;
        const py = this.ctx.height(px, pz);
        if (py >= 67 && py < mouthY && plazaDistance(px, pz) > PLAZA_CLEAR + 22) {
          const length = Math.hypot(x - px, z - pz);
          let dry = true;
          for (let step = 0; step <= length && dry; step += 4) {
            for (const side of [-12, 0, 12]) {
              const sx = Math.round(px + (x - px) * step / length + (z - pz) * side / length);
              const sz = Math.round(pz + (z - pz) * step / length - (x - px) * side / length);
              if (this.ctx.height(sx, sz) <= 65) { dry = false; break; }
            }
          }
          if (!dry) continue;
          if (!this.approachClear(x, z, px, pz)) continue;
          mouthX = px; mouthZ = pz; mouthY = py;
        }
      }
      result = { x, z, rx, rz, floor, ceiling, mouthX, mouthZ, mouthY,
        style: h(0xca08) < 0.38 ? 'lush' : h(0xca08) < 0.7 ? 'crystal' : 'limestone',
        width: 7 + h(0xca09) * 5,
        entrance: mouthY < 150 && mouthY - floor <= Math.hypot(x - mouthX, z - mouthZ) * 0.95 };
    }
    if (this.landmarks.size > 4096) this.landmarks.clear();
    this.landmarks.set(key, result);
    return result;
  }

  private nearby(x: number, z: number): CaveLandmark[] {
    const chunkX = Math.floor(x / 16), chunkZ = Math.floor(z / 16);
    const key = `${chunkX},${chunkZ}`;
    const cached = this.chunks.get(key);
    if (cached) return cached;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const out: CaveLandmark[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = this.landmark(cx + dx, cz + dz);
      if (l && Math.abs(l.x - (chunkX * 16 + 8)) < 108 && Math.abs(l.z - (chunkZ * 16 + 8)) < 108) out.push(l);
    }
    if (this.chunks.size > 2048) this.chunks.clear();
    this.chunks.set(key, out);
    return out;
  }

  column(x: number, z: number): CaveSlice[] {
    if (plazaDistance(x, z) < PLAZA_CLEAR + 5) return [];
    const out: CaveSlice[] = [];
    const ground = this.ctx.height(x, z);
    const rough = this.detail.noise(x * 0.095, z * 0.095);
    for (const l of this.nearby(x, z)) {
      // Two overlapping unequal domes make an asymmetric cathedral, with a
      // narrower gallery beyond its shoulder and stepped natural balconies.
      for (let room = 0; room < 2; room++) {
        const dx = (x - l.x - (room ? l.rx * 0.64 : 0)) / (l.rx * (room ? 0.7 : 1));
        const dz = (z - l.z - (room ? l.rz * 0.32 : 0)) / (l.rz * (room ? 0.66 : 1));
        const d = dx * dx + dz * dz;
        if (d >= 1) continue;
        const arch = Math.sqrt(1 - d);
        const floor = Math.floor(l.floor + (1 - arch) * 10 + rough * 1.8 + room * 3);
        const ceiling = Math.min(ground - 7, Math.floor(l.floor + 13 + (l.ceiling - l.floor - 13) * arch + rough * 2));
        const pool = room === 0 && d < 0.22 && rough < -0.16;
        if (ceiling > floor + 4) out.push({ floor: pool ? l.floor : floor, ceiling, style: l.style,
          pool, entrance: false });
      }
      if (!l.entrance || ground <= 65) continue;
      const vx = l.x - l.mouthX, vz = l.z - l.mouthZ;
      const length = Math.hypot(vx, vz);
      const along = ((x - l.mouthX) * vx + (z - l.mouthZ) * vz) / length;
      const across = ((x - l.mouthX) * vz - (z - l.mouthZ) * vx) / length;
      const width = l.width * (1 - 0.3 * Math.max(0, along / length));
      if (along < -12 || along > length || Math.abs(across) >= width) continue;
      const t = Math.max(0, along / length);
      const floor = Math.floor(l.mouthY - 2 + (l.floor + 2 - l.mouthY) * t);
      const arch = Math.sqrt(1 - (across / width) ** 2);
      const ceiling = Math.floor(floor + 3 + arch * (12 + l.width * 0.4) + rough);
      out.push({ floor: Math.max(5, floor), ceiling, style: l.style, pool: false, entrance: true,
        rampFloor: Math.max(5, floor) });
    }
    // Merge overlapping lobes before decorating: no false floors or hanging
    // lakes where two chambers meet, and no seams along the entry passage.
    out.sort((a, b) => a.floor - b.floor);
    const merged: CaveSlice[] = [];
    for (const s of out) {
      const last = merged[merged.length - 1];
      if (last && s.floor <= last.ceiling + 1) {
        last.ceiling = Math.max(last.ceiling, s.ceiling);
        if (s.rampFloor !== undefined) last.rampFloor = Math.max(last.rampFloor ?? last.floor, s.rampFloor);
        last.entrance ||= s.entrance;
        last.pool = last.pool && s.pool && !last.entrance;
      } else merged.push({ ...s });
    }
    return merged;
  }

  entranceAt(x: number, z: number): boolean {
    const h = this.ctx.height(x, z);
    return this.column(x, z).some(s => s.entrance && s.floor < h && s.ceiling >= h - 1);
  }

  /** Only runs for cave landmark columns; all writes remain column-local. */
  decorate(x: number, z: number, slices: CaveSlice[], get: (y: number) => number, put: (y: number, id: number) => void): void {
    const roll = hash2(this.seed ^ 0xcadec, x, z);
    for (const s of slices) {
      const { ceiling, style } = s;
      const floor = s.rampFloor ?? s.floor;
      if (get(floor + 1) !== Block.Air || get(floor) === Block.Bedrock) continue;
      const lining = style === 'lush' ? Block.Mud : style === 'crystal' ? Block.Stone : Block.Sandstone;
      for (let y = floor - 2; y <= floor; y++) if (y > 4) put(y, y === floor && style === 'lush' && !s.pool ? Block.Grass : lining);
      if (s.pool && !s.entrance) {
        // Shallow reflective pools have a sealed basin and one shared waterline.
        put(floor, Block.Water);
        // Occasional ceiling springs fall into the sealed pools below.
        if (roll < 0.012 && ceiling - floor > 20) {
          for (let y = floor + 1; y <= ceiling; y++) put(y, Block.Water);
        }
        continue;
      }
      // Leave the broad entry ramps open, with occasional guiding glow plants.
      if (s.entrance) {
        if (roll < 0.025) put(floor + 1, Block.GlowFungus);
        continue;
      }
      // Each formation has a shared centre and taper across several columns,
      // so these read as broad mineral clusters instead of random voxel poles.
      const gx = Math.floor(x / 12), gz = Math.floor(z / 12);
      const mineral = hash2(this.seed ^ 0xcac1, gx, gz);
      const mx = gx * 12 + 3 + hash2(this.seed ^ 0xcac2, gx, gz) * 6;
      const mz = gz * 12 + 3 + hash2(this.seed ^ 0xcac3, gx, gz) * 6;
      const radius = 2.2 + mineral * 2;
      const distance = Math.hypot(x - mx, z - mz);
      const taper = Math.max(0, 1 - distance / radius);
      const tall = Math.min(ceiling - floor - 5, Math.floor((5 + mineral * 11) * taper));
      if (mineral > 0.94 && distance < 1.6 && ceiling - floor > 16) {
        for (let y = floor + 1; y <= ceiling; y++) put(y, lining);
      } else if (tall > 0 && mineral > 0.25) {
        for (let y = 1; y <= tall; y++) put(floor + y, style === 'crystal' && y >= tall - 2 ? Block.CrystalBlock : lining);
      } else if (style === 'lush' && roll < 0.12) {
        put(floor + 1, roll < 0.055 ? Block.GlowFungus : Block.TallGrass);
      } else if (roll < 0.022) put(floor + 1, Block.GlowFungus);
      if (get(ceiling + 1) !== Block.Air && get(ceiling + 1) !== Block.Water) {
        if (mineral < 0.55 && tall > 0) {
          for (let y = 0; y < tall; y++) put(ceiling - y, style === 'crystal' && y === tall - 1 ? Block.CrystalBlock : lining);
        } else if (style === 'lush' && roll > 0.89) {
          for (let y = 0; y < 2 + Math.floor(roll * 3); y++) put(ceiling - y, Block.Leaves);
          put(ceiling - 4, Block.GlowFungus);
        } else if (roll < 0.018) put(ceiling, Block.GlowFungus);
      }
    }
  }
}
