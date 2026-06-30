// Circular HUD minimap (top-left). A north-up radar over the ACTUAL terrain:
//   • a biome-colored base (sampled once from the deterministic Terrain, cached)
//     cropped to a window around the player,
//   • a faction TINT over the whole disc (blue for Azure, red for Crimson),
//   • the player as a white arrow at the centre (points where they face),
//   • every saved waypoint as a colored diamond, both CAPITALS as colored stars.
// Markers further than RANGE blocks clamp to the rim so off-screen objectives
// still read as a direction.
import { Biome } from './biomes';
import { Terrain } from './terrain';
import { WORLD_HALF } from './net/protocol';
import { REGION_COUNT, regionCenter, capitalFaction, isCapital } from './regions';
import { factionColor, isFaction } from './teams';

const SIZE = 150;         // canvas pixels (a square; the circle is inscribed)
const RANGE = 260;        // world blocks from the centre to the rim
const BASE_SAMPLE = 6;    // world blocks per cached-base pixel (lower = sharper)
const BASE_RES = Math.ceil((WORLD_HALF * 2) / BASE_SAMPLE); // base canvas px/side

const BIOME_COLOR: Record<number, string> = {
  [Biome.Ocean]: '#1d3a6b',
  [Biome.Beach]: '#d6c98f',
  [Biome.Plains]: '#74ad48',
  [Biome.Forest]: '#4d8a37',
  [Biome.BirchForest]: '#6ba64c',
  [Biome.Desert]: '#ddca7c',
  [Biome.Snowy]: '#e6eef3',
  [Biome.Mountains]: '#8d8d8d',
  [Biome.SnowyMountains]: '#cdd7df',
  [Biome.Mesa]: '#b06a39',
  [Biome.Ashlands]: '#3a3640',
};

export interface MinimapMarker { x: number; z: number; color: number; }

const css = (c: number): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly capitals: { x: number; z: number; faction: number }[] = [];
  private base: HTMLCanvasElement | null = null; // cached biome render (lazy)

  constructor(parent: HTMLElement, private readonly terrain: Terrain) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.canvas.style.cssText =
      'position:absolute;top:10px;left:10px;z-index:11;width:150px;height:150px;' +
      'border-radius:50%;pointer-events:none;display:none;' +
      'box-shadow:0 0 0 2px #0b0e16,0 2px 8px rgba(0,0,0,0.6);';
    this.ctx = this.canvas.getContext('2d')!;
    parent.appendChild(this.canvas);
    // The board layout is fixed for the run — precompute the capital centres once.
    for (let i = 0; i < REGION_COUNT; i++) {
      if (isCapital(i)) {
        const c = regionCenter(i);
        this.capitals.push({ x: c.x, z: c.z, faction: capitalFaction(i) });
      }
    }
  }

  setVisible(v: boolean): void { this.canvas.style.display = v ? 'block' : 'none'; }

  /** Sample the biome base ONCE (terrain is static). Lazy so it doesn't block boot. */
  private renderBase(): void {
    const c = document.createElement('canvas');
    c.width = BASE_RES; c.height = BASE_RES;
    const g = c.getContext('2d')!;
    for (let bx = 0; bx < BASE_RES; bx++) {
      const wx = -WORLD_HALF + bx * BASE_SAMPLE;
      for (let by = 0; by < BASE_RES; by++) {
        const wz = -WORLD_HALF + by * BASE_SAMPLE;
        const b = this.terrain.biomeWithWater(wx, wz, this.terrain.height(wx, wz));
        g.fillStyle = BIOME_COLOR[b] ?? '#444';
        g.fillRect(bx, by, 1, 1);
      }
    }
    this.base = c;
  }

  /** Redraw the radar for the current player pose, waypoints, and war flags. */
  update(px: number, pz: number, yaw: number, faction: number,
    waypoints: ReadonlyArray<MinimapMarker>, flags: ReadonlyArray<MinimapMarker> = []): void {
    if (!this.base) this.renderBase();
    const ctx = this.ctx;
    const R = SIZE / 2, cx = R, cy = R;
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip(); // circular mask

    // Terrain: crop the cached base to a RANGE-radius window around the player.
    ctx.fillStyle = '#0d1018'; ctx.fillRect(0, 0, SIZE, SIZE); // backdrop past the edges
    const sx = (px + WORLD_HALF - RANGE) / BASE_SAMPLE; // base-px of window's left edge
    const sy = (pz + WORLD_HALF - RANGE) / BASE_SAMPLE; // ...and its top edge
    const sw = (RANGE * 2) / BASE_SAMPLE;
    ctx.drawImage(this.base!, sx, sy, sw, sw, 0, 0, SIZE, SIZE);

    // Territory tint (Azure land -> blue, Crimson land -> red); none if neutral.
    if (isFaction(faction)) {
      ctx.globalAlpha = 0.28; ctx.fillStyle = css(factionColor(faction));
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.globalAlpha = 1;
    }
    // A mid-range ring for distance sense.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2); ctx.stroke();

    const scale = R / RANGE, max = R - 9;
    // World -> screen (north-up), clamping distant markers to the rim.
    const plot = (wx: number, wz: number): { x: number; y: number; edge: boolean } => {
      let dx = (wx - px) * scale, dy = (wz - pz) * scale; // +z is south -> down
      const d = Math.hypot(dx, dy);
      let edge = false;
      if (d > max) { const k = max / d; dx *= k; dy *= k; edge = true; }
      return { x: cx + dx, y: cy + dy, edge };
    };

    // Capitals: faction-colored stars.
    for (const cap of this.capitals) {
      const p = plot(cap.x, cap.z);
      this.star(p.x, p.y, p.edge ? 4 : 5.5, css(factionColor(cap.faction)));
    }
    // Waypoints: colored diamonds.
    for (const w of waypoints) {
      const p = plot(w.x, w.z);
      ctx.fillStyle = css(w.color);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x + 4, p.y);
      ctx.lineTo(p.x, p.y + 4); ctx.lineTo(p.x - 4, p.y);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // War flags: a little flag glyph (pole + pennant) in the faction color.
    for (const f of flags) {
      const p = plot(f.x, f.z);
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x, p.y + 5); ctx.lineTo(p.x, p.y - 6); ctx.stroke();
      ctx.fillStyle = css(f.color);
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x + 7, p.y - 3.5); ctx.lineTo(p.x, p.y - 1);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // Player arrow at the centre, rotated to the facing direction.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-yaw); // yaw 0 faces -z (up); see player forward = (-sin,-cos)
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.5, 5.5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5.5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    ctx.restore(); // drop the clip

    // Rim + a small 'N' at the top so north is unambiguous.
    ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, 8);
  }

  private star(x: number, y: number, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? r : r * 0.45;
      const sx = x + Math.cos(ang) * rad, sy = y + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
}
