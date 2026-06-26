// World map overlay (M key): a top-down 1000×1000 view of the world centred on
// origin. A biome-colored base (sampled from the deterministic Terrain, cached)
// with a faction-colored region board + CLAIM overlay, the player's position
// + heading, and click-to-drop WAYPOINTS (shown here AND as in-world beacons,
// persisted in localStorage). A legend shows each faction's % of claimed land.

import * as THREE from 'three';
import { Biome } from './biomes';
import { CHUNK_X, CHUNK_Z } from './chunk';
import { Claims, claimChunkKeys } from './claims';
import { FACTIONS, NO_FACTION, factionColor, factionName } from './teams';
import {
  REGION_COUNT, capitalFaction, isCapital, regionBounds, regionCenter,
} from './regions';
import { Terrain } from './terrain';

const MAP_SPAN = 1000;     // world units shown (centred on origin: -500..500)
const HALF = MAP_SPAN / 2;
const CANVAS_PX = 700;
const SCALE = CANVAS_PX / MAP_SPAN; // px per world unit
const SAMPLE = 8;          // biome base sampled every N blocks

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

interface Waypoint { x: number; z: number; color: number; name: string; show: boolean; }

/** Live game state the map reads each frame it's open. */
export interface MapContext {
  player(): { x: number; z: number; yaw: number };
  faction(): number;
  /** Region board: owner faction id per region index (Phase 1). */
  regions(): number[];
  /** Per-region capture meters (Phase 2): filling faction + 0..1 fraction. */
  captureMeters(): { faction: number[]; progress: number[] };
}

export class WorldMap {
  open = false;
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly legend: HTMLDivElement;
  private base: HTMLCanvasElement | null = null; // cached biome render
  private landChunks = 1;                         // non-ocean chunks in the window
  private waypoints: Waypoint[] = [];
  private readonly markerGroup = new THREE.Group();
  private readonly markerGeo = new THREE.BoxGeometry(1.2, 30, 1.2);
  // In-world MC-mod-style screen markers (one DOM badge per shown waypoint).
  private readonly beaconLayer: HTMLDivElement;
  private readonly beaconEls: HTMLDivElement[] = [];
  private readonly _v = new THREE.Vector3();
  private readonly _camPos = new THREE.Vector3();
  private readonly _camFwd = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly terrain: Terrain,
    private readonly claims: Claims,
    private readonly mapCtx: MapContext,
  ) {
    this.scene.add(this.markerGroup);

    // Full-screen, click-through overlay that hosts the floating waypoint badges.
    this.beaconLayer = document.createElement('div');
    this.beaconLayer.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:15;overflow:hidden;';
    document.getElementById('app')!.appendChild(this.beaconLayer);

    this.loadWaypoints();

    const app = document.getElementById('app')!;
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:absolute;inset:0;display:none;z-index:30;align-items:center;' +
      'justify-content:center;background:rgba(6,8,14,0.78);';
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:#11141c;border:2px solid #2a3550;padding:14px 16px;' +
      'display:flex;flex-direction:column;gap:10px;';
    const title = document.createElement('div');
    title.className = 'mc-font';
    title.textContent = 'WORLD MAP';
    title.style.cssText = 'color:#cfe0ff;font-size:16px;text-shadow:none;letter-spacing:1px;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:14px;align-items:flex-start;';
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_PX;
    this.canvas.height = CANVAS_PX;
    this.canvas.style.cssText = 'border:1px solid #2a3550;cursor:crosshair;image-rendering:pixelated;';
    this.ctx = this.canvas.getContext('2d')!;
    this.legend = document.createElement('div');
    this.legend.className = 'mc-font';
    this.legend.style.cssText = 'width:200px;font-size:12px;color:#dfe6f2;text-shadow:none;line-height:1.7;';
    row.append(this.canvas, this.legend);
    const hint = document.createElement('div');
    hint.className = 'mc-font';
    hint.style.cssText = 'font-size:11px;color:#8da0c0;text-shadow:none;';
    hint.textContent = 'Left-click: add named waypoint  ·  Right-click a marker: remove  ·  M / Esc: close';
    panel.append(title, row, hint);
    this.el.appendChild(panel);
    app.appendChild(this.el);

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => this.onClick(e));
    // Legend hosts the per-waypoint list; clicks there toggle world-visibility
    // or delete (event-delegated so we don't rebind on every redraw).
    this.legend.addEventListener('click', (e) => this.onLegendClick(e));
  }

  toggle(): void { this.open ? this.hide() : this.show(); }
  show(): void { this.open = true; this.el.style.display = 'flex'; this.draw(); }
  hide(): void { this.open = false; this.el.style.display = 'none'; }

  /** Redraw while open (player + claims + nodes move). */
  update(): void { if (this.open) this.draw(); }

  // --- coordinate transforms (world <-> canvas) ---
  private cx(x: number): number { return (x + HALF) * SCALE; }
  private cy(z: number): number { return (z + HALF) * SCALE; }
  private worldX(px: number): number { return px / SCALE - HALF; }
  private worldZ(py: number): number { return py / SCALE - HALF; }

  /** Render the biome base ONCE (terrain is static) + count land chunks. */
  private renderBase(): void {
    const c = document.createElement('canvas');
    c.width = CANVAS_PX; c.height = CANVAS_PX;
    const g = c.getContext('2d')!;
    const step = SAMPLE * SCALE;
    for (let x = -HALF; x < HALF; x += SAMPLE) {
      for (let z = -HALF; z < HALF; z += SAMPLE) {
        const b = this.terrain.biomeWithWater(x, z, this.terrain.height(x, z));
        g.fillStyle = BIOME_COLOR[b] ?? '#444';
        g.fillRect(this.cx(x), this.cy(z), step + 1, step + 1);
      }
    }
    this.base = c;
    // Count non-ocean chunks in the window (denominator for land %).
    let land = 0, total = 0;
    const cmin = Math.floor(-HALF / CHUNK_X), cmax = Math.floor(HALF / CHUNK_X);
    for (let chx = cmin; chx < cmax; chx++) {
      for (let chz = cmin; chz < cmax; chz++) {
        const wx = chx * CHUNK_X + 8, wz = chz * CHUNK_Z + 8;
        total++;
        if (this.terrain.biomeWithWater(wx, wz, this.terrain.height(wx, wz)) !== Biome.Ocean) land++;
      }
    }
    this.landChunks = Math.max(1, land);
    void total;
  }

  private draw(): void {
    if (!this.base) this.renderBase();
    const ctx = this.ctx;
    ctx.drawImage(this.base!, 0, 0);

    // Region board: faction-tinted grid of territories with a capital star on
    // each home region (Phase 1). Drawn first so claims/nodes sit on top.
    const owners = this.mapCtx.regions();
    const meters = this.mapCtx.captureMeters();
    const regionByFaction: Record<number, number> = {};
    for (let i = 0; i < REGION_COUNT && i < owners.length; i++) {
      const owner = owners[i];
      const b = regionBounds(i);
      const x = this.cx(b.minX), y = this.cy(b.minZ);
      const w = (b.maxX - b.minX) * SCALE, h = (b.maxZ - b.minZ) * SCALE;
      if (owner !== NO_FACTION) {
        ctx.fillStyle = this.rgba(factionColor(owner), 0.22);
        ctx.fillRect(x, y, w, h);
        regionByFaction[owner] = (regionByFaction[owner] ?? 0) + 1;
      }
      ctx.strokeStyle = 'rgba(10,14,22,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      // Capture meter: a small filling bar at the region's foot in the attacker's
      // color, plus a pulsing attacker-colored border so the front pops.
      const capF = meters.faction?.[i] ?? NO_FACTION;
      const frac = Math.max(0, Math.min(1, meters.progress?.[i] ?? 0));
      if (capF !== NO_FACTION && frac > 0.001) {
        const bw = w - 8, bx = x + 4, by = y + h - 8;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx, by, bw, 5);
        ctx.fillStyle = this.rgba(factionColor(capF), 1);
        ctx.fillRect(bx, by, bw * frac, 5);
        ctx.strokeStyle = this.rgba(factionColor(capF), 0.9);
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      }
      if (isCapital(i)) this.drawCapital(regionCenter(i), capitalFaction(i));
    }

    // Claim overlays (faction-colored translucent footprints).
    const claimedByFaction: Record<number, number> = {};
    for (const claim of this.claims.list()) {
      const x0 = (claim.cx - 1) * CHUNK_X, z0 = (claim.cz - 1) * CHUNK_Z;
      const w = 3 * CHUNK_X, h = 3 * CHUNK_Z;
      const col = factionColor(claim.faction);
      ctx.fillStyle = this.rgba(col, 0.4);
      ctx.fillRect(this.cx(x0), this.cy(z0), w * SCALE, h * SCALE);
      ctx.strokeStyle = this.rgba(col, 0.9);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(this.cx(x0), this.cy(z0), w * SCALE, h * SCALE);
      claimedByFaction[claim.faction] = (claimedByFaction[claim.faction] ?? 0) + claimChunkKeys(claim.cx, claim.cz).length;
    }

    // Waypoints.
    for (const w of this.waypoints) {
      const px = this.cx(w.x), py = this.cy(w.z);
      ctx.fillStyle = this.rgba(w.color, 1);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py - 5); ctx.lineTo(px + 5, py); ctx.lineTo(px, py + 5); ctx.lineTo(px - 5, py);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // Player marker (heading triangle).
    const p = this.mapCtx.player();
    const px = this.cx(p.x), py = this.cy(p.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-p.yaw); // map +z is down; yaw 0 faces -z (up)
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    this.drawLegend(claimedByFaction, regionByFaction);
    this.syncMarkers();
  }

  /** A capital marker: a faction-colored star at the home region centre. */
  private drawCapital(c: { x: number; z: number }, faction: number): void {
    const ctx = this.ctx;
    const px = this.cx(c.x), py = this.cy(c.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = this.rgba(factionColor(faction), 1);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
      const a2 = a + Math.PI / 5;
      ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
      ctx.lineTo(Math.cos(a2) * 4, Math.sin(a2) * 4);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawLegend(
    claimedByFaction: Record<number, number>,
    regionByFaction: Record<number, number>,
  ): void {
    const me = this.mapCtx.faction();
    const lines = ['<b>WAR MAP — REGIONS</b>'];
    for (const f of FACTIONS) {
      const regions = regionByFaction[f.id] ?? 0;
      const pct = (regions / REGION_COUNT) * 100;
      const mine = f.id === me ? ' ◀ you' : '';
      lines.push(
        `<span style="color:${this.rgba(f.color, 1)}">■</span> ${factionName(f.id)}: ` +
        `${regions} <span style="color:#8da0c0">(${pct.toFixed(0)}%)</span>${mine}`);
    }
    const neutral = REGION_COUNT - Object.values(regionByFaction).reduce((a, b) => a + b, 0);
    if (neutral > 0) lines.push(`<span style="color:#8da0c0">Neutral: ${neutral}</span>`);
    lines.push('');
    lines.push('<b>YOUR BASES</b>');
    for (const f of FACTIONS) {
      const chunks = claimedByFaction[f.id] ?? 0;
      const pct = (chunks / this.landChunks) * 100;
      const mine = f.id === me ? ' ◀' : '';
      lines.push(
        `<span style="color:${this.rgba(f.color, 1)}">■</span> ${factionName(f.id)}: ` +
        `${pct.toFixed(1)}%${mine}`);
    }
    lines.push('');
    lines.push(`<b>WAYPOINTS</b> (${this.waypoints.length})`);
    const p = this.mapCtx.player();
    this.waypoints.forEach((w, i) => {
      const dist = Math.round(Math.hypot(w.x - p.x, w.z - p.z));
      const eye = w.show ? '👁' : '–';
      lines.push(
        `<span style="color:${this.rgba(w.color, 1)}">■</span> ` +
        `${this.escape(w.name)} <span style="color:#8da0c0">${dist}m</span> ` +
        `<a data-eye="${i}" title="Show in world" ` +
        `style="cursor:pointer;text-decoration:none">${eye}</a> ` +
        `<a data-del="${i}" title="Delete" style="cursor:pointer;color:#ff8a7a">✕</a>`);
    });
    if (!this.waypoints.length) lines.push('<span style="color:#8da0c0">none yet — click the map</span>');
    this.legend.innerHTML = lines.join('<br>');
  }

  private escape(s: string): string {
    return s.replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
  }

  private onLegendClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const eye = t.getAttribute('data-eye');
    const del = t.getAttribute('data-del');
    if (eye !== null) {
      const i = Number(eye);
      if (this.waypoints[i]) { this.waypoints[i].show = !this.waypoints[i].show; this.saveWaypoints(); this.draw(); }
    } else if (del !== null) {
      const i = Number(del);
      if (this.waypoints[i]) { this.waypoints.splice(i, 1); this.saveWaypoints(); this.draw(); }
    }
  }

  // --- waypoints ---
  private onClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (CANVAS_PX / rect.width);
    const py = (e.clientY - rect.top) * (CANVAS_PX / rect.height);
    const wx = Math.round(this.worldX(px)), wz = Math.round(this.worldZ(py));
    if (e.button === 2) {
      // Remove the nearest waypoint within a small radius.
      let best = -1, bestD = 18 / SCALE;
      this.waypoints.forEach((w, i) => {
        const d = Math.hypot(w.x - wx, w.z - wz);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) { this.waypoints.splice(best, 1); this.saveWaypoints(); this.draw(); }
      return;
    }
    if (e.button !== 0) return;
    const def = `WP ${this.waypoints.length + 1}`;
    const name = (prompt('Waypoint name:', def) ?? def).trim().slice(0, 24) || def;
    this.waypoints.push({ x: wx, z: wz, color: factionColor(this.mapCtx.faction()), name, show: true });
    this.saveWaypoints();
    this.draw();
  }

  /** Keep the in-world waypoint pillars in sync with the list (only the ones the
   *  player has chosen to show in-world get a 3D beacon). */
  private syncMarkers(): void {
    const shown = this.waypoints.filter((w) => w.show);
    while (this.markerGroup.children.length > shown.length) {
      const m = this.markerGroup.children.pop() as THREE.Mesh;
      (m.material as THREE.Material).dispose();
    }
    while (this.markerGroup.children.length < shown.length) {
      this.markerGroup.add(new THREE.Mesh(this.markerGeo,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })));
    }
    shown.forEach((w, i) => {
      const m = this.markerGroup.children[i] as THREE.Mesh;
      const gy = this.terrain.height(Math.round(w.x), Math.round(w.z));
      m.position.set(w.x + 0.5, gy + 15, w.z + 0.5);
      (m.material as THREE.MeshBasicMaterial).color.setHex(w.color);
    });
  }

  /** Project shown waypoints to floating on-screen badges (square + name +
   *  distance), MC-waypoint-mod style: clamped to the screen edge so a marker
   *  in any direction stays visible, pointing where to walk. Call each rendered
   *  frame while playing; pass the canvas size. */
  renderBeacons(width: number, height: number): void {
    const shown = this.open ? [] : this.waypoints.filter((w) => w.show);
    // Grow/shrink the pool of badge elements to match.
    while (this.beaconEls.length > shown.length) {
      this.beaconLayer.removeChild(this.beaconEls.pop()!);
    }
    while (this.beaconEls.length < shown.length) {
      const el = document.createElement('div');
      el.className = 'mc-font';
      el.style.cssText =
        'position:absolute;transform:translate(-50%,-50%);text-align:center;' +
        'text-shadow:0 1px 2px #000;font-size:11px;color:#fff;white-space:nowrap;' +
        'line-height:1.3;will-change:left,top;';
      this.beaconLayer.appendChild(el);
      this.beaconEls.push(el);
    }
    if (!shown.length) return;

    const cam = this.camera;
    cam.getWorldPosition(this._camPos);
    cam.getWorldDirection(this._camFwd);
    const p = this.mapCtx.player();
    const margin = 26;

    shown.forEach((w, i) => {
      const el = this.beaconEls[i];
      const gy = this.terrain.height(Math.round(w.x), Math.round(w.z)) + 2;
      this._v.set(w.x + 0.5, gy, w.z + 0.5);
      const front =
        (this._v.x - this._camPos.x) * this._camFwd.x +
        (this._v.y - this._camPos.y) * this._camFwd.y +
        (this._v.z - this._camPos.z) * this._camFwd.z > 0;
      const ndc = this._v.project(cam); // mutates _v into NDC space
      let sx: number, sy: number;
      if (front) {
        sx = (ndc.x * 0.5 + 0.5) * width;
        sy = (-ndc.y * 0.5 + 0.5) * height;
      } else {
        // Behind the camera: NDC is mirrored — push to the opposite edge so the
        // badge still indicates the bearing.
        sx = ndc.x < 0 ? width - margin : margin;
        sy = height - margin;
      }
      sx = Math.max(margin, Math.min(width - margin, sx));
      sy = Math.max(margin, Math.min(height - margin, sy));
      const dist = Math.round(Math.hypot(w.x - p.x, w.z - p.z));
      const col = this.rgba(w.color, 1);
      el.style.display = '';
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      el.style.opacity = dist > 600 ? '0.6' : '0.95';
      el.innerHTML =
        `<div style="width:9px;height:9px;margin:0 auto 2px;background:${col};` +
        `border:1px solid #000;transform:rotate(45deg)"></div>` +
        `${this.escape(w.name)}<br><span style="color:#cfe0ff">${dist}m</span>`;
    });
  }

  /** Hide all floating badges (used on the title screen). */
  hideBeacons(): void {
    for (const el of this.beaconEls) el.style.display = 'none';
  }

  private rgba(hex: number, a: number): string {
    return `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
  }

  private loadWaypoints(): void {
    try {
      const raw = localStorage.getItem('voxelon.waypoints');
      if (raw) this.waypoints = (JSON.parse(raw) as Partial<Waypoint>[])
        .filter((w) => Number.isFinite(w.x) && Number.isFinite(w.z))
        .map((w, i) => ({
          x: w.x as number, z: w.z as number,
          color: Number.isFinite(w.color) ? (w.color as number) : 0xffffff,
          name: typeof w.name === 'string' && w.name ? w.name : `WP ${i + 1}`,
          show: w.show !== false, // default ON (older saved points had no flag)
        }));
    } catch { /* ignore */ }
    this.syncMarkers();
  }
  private saveWaypoints(): void {
    try { localStorage.setItem('voxelon.waypoints', JSON.stringify(this.waypoints)); } catch { /* ignore */ }
  }
}
