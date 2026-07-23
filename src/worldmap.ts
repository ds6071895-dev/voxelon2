// World map overlay (M key): a top-down view of the world centred on origin,
// with a ZOOM TOGGLE between the HEARTLAND core (inner 1000×1000, where society
// lives) and the full 5000×5000 world (the Wilds). A biome-colored base
// (sampled from the deterministic Terrain, cached PER VIEW — never the full
// 5000² block grid) with big readable landmark icons: surface structures,
// vault entrances, attuned WAYPOINT TOTEMS (click to travel), and
// click-to-drop WAYPOINTS (shown here AND as in-world beacons, persisted in
// localStorage).

import * as THREE from 'three';
import { Biome } from './biomes';
import { factionColor } from './teams';
import { Terrain } from './terrain';
import { CORE_BORDER, CORE_HALF, WORLD_BORDER } from './net/protocol';

const CANVAS_PX = 700;
type MapView = 'core' | 'world';
// Per-view span + biome sample step. Both bases stay ~a few tens of thousands
// of terrain samples (rendered lazily once, cached) — NEVER the full 5000² grid.
const VIEWS: Record<MapView, { span: number; sample: number }> = {
  core: { span: CORE_BORDER + 160, sample: 8 },  // Heartland + a small fringe
  world: { span: WORLD_BORDER, sample: 34 },     // the whole 5000 world
};

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
  [Biome.Jungle]: '#2e7a2a',
  [Biome.Swamp]: '#4a5c38',
  [Biome.CherryGrove]: '#d98cb0',
  [Biome.Crystalfields]: '#b9c6e8',
};

/** Map-icon color per surface-structure kind. */
const STRUCT_COLOR: Record<string, string> = {
  tower: '#c8ccd4',   // ruined watchtower — pale stone
  bunker: '#93a559',  // bunker — military olive
  pod: '#e0913a',     // crashed cargo pod — scorched orange
};

interface Waypoint {
  x: number; z: number; color: number; name: string; show: boolean;
  /** Altitude of the waypoint (older saved points have none). */
  y?: number;
}
export interface TotemPos { x: number; y: number; z: number; }
/** A vault marker for the map (Milestone D). `discovered` vaults (entered once)
 *  render bright with their tier; merely SENSED nearby ones render faint with no
 *  tier (you know something's there, not what). */
export interface VaultMark {
  x: number; z: number; tier: number; cleared: boolean; discovered: boolean;
}
/** A surface structure on the map: position + kind (tower/bunker/pod). */
export interface StructureMark { x: number; z: number; kind: string; }

/** Live game state the map reads each frame it's open. */
export interface MapContext {
  player(): { x: number; z: number; yaw: number };
  faction(): number;
  /** Optional: called when the in-panel ✕ close button is tapped/clicked —
   *  lets the caller re-lock the pointer the same way the M key does. */
  onClose?(): void;
}

export class WorldMap {
  open = false;
  private readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly legend: HTMLDivElement;
  private view: MapView = 'core';
  private readonly bases = new Map<MapView, HTMLCanvasElement>(); // cached biome renders
  private waypoints: Waypoint[] = [];
  /** Attuned Waypoint Totems (B4) — click one on the map to travel to it. */
  private totems: TotemPos[] = [];
  /** Discovered vaults (Milestone D) + the world's total (collection pressure). */
  private vaults: VaultMark[] = [];
  private vaultTotal = 0;
  /** Every surface structure (shown as icons so the map reads as a treasure map). */
  private structures: StructureMark[] = [];
  /** Fired when the player clicks an attuned totem marker (main runs the
   *  wind-up + the actual teleport). */
  onTotemTravel?: (t: TotemPos) => void;
  // Dynamic markers (war flags): server-driven, NOT persisted; shown on the map
  // + as in-world beacons exactly like waypoints. Refreshed each frame by main.
  private dynamicMarkers: { x: number; z: number; color: number; name: string }[] = [];
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
    // Responsive: never exceed the viewport (small screens clipped the map +
    // legend before) — cap to the viewport and scroll inside if needed.
    panel.style.cssText =
      'background:#11141c;border:2px solid #2a3550;padding:14px 16px;box-sizing:border-box;' +
      'display:flex;flex-direction:column;gap:10px;max-width:96vw;max-height:96vh;overflow:auto;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:14px;';
    const title = document.createElement('div');
    title.className = 'mc-font';
    title.style.cssText = 'color:#cfe0ff;font-size:16px;text-shadow:none;letter-spacing:1px;';
    // Zoom toggle: the Heartland core (dense, readable) <-> the full 5000 world.
    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'mc-font';
    zoomBtn.style.cssText =
      'font-size:11px;padding:4px 10px;cursor:pointer;border:2px solid;' +
      'border-color:#fff #555 #555 #fff;background:#6b6b6b;color:#fff;text-shadow:none;';
    const syncZoom = (): void => {
      title.textContent = this.view === 'core' ? 'WORLD MAP — HEARTLAND' : 'WORLD MAP — FULL WORLD';
      zoomBtn.textContent = this.view === 'core' ? '🔍 Full world' : '🔍 Heartland';
    };
    zoomBtn.addEventListener('click', () => {
      this.view = this.view === 'core' ? 'world' : 'core';
      syncZoom();
      this.draw();
    });
    syncZoom();
    const closeBtn = document.createElement('button');
    closeBtn.className = 'mc-font';
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
      'margin-left:auto;font-size:14px;width:28px;height:28px;cursor:pointer;border:2px solid;' +
      'border-color:#fff #555 #555 #fff;background:#6b6b6b;color:#fff;text-shadow:none;';
    closeBtn.addEventListener('click', () => {
      this.hide();
      this.mapCtx.onClose?.();
    });
    header.append(title, zoomBtn, closeBtn);
    const row = document.createElement('div');
    // Wrap on narrow screens so the legend drops below the map instead of being
    // pushed off-screen.
    row.style.cssText = 'display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;justify-content:center;';
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_PX;
    this.canvas.height = CANVAS_PX;
    // The canvas renders at CANVAS_PX internally but DISPLAYS at a size that
    // fits the viewport (square kept via aspect-ratio); click math already
    // rescales via the element's rendered rect, so hit-testing stays correct.
    this.canvas.style.cssText =
      'border:1px solid #2a3550;cursor:crosshair;image-rendering:pixelated;' +
      'width:min(700px,88vw,74vh);height:auto;aspect-ratio:1/1;max-width:100%;flex:0 0 auto;';
    this.ctx = this.canvas.getContext('2d')!;
    this.legend = document.createElement('div');
    this.legend.className = 'mc-font';
    this.legend.style.cssText =
      'flex:1 1 200px;min-width:180px;max-width:100%;font-size:12px;color:#dfe6f2;' +
      'text-shadow:none;line-height:1.7;';
    row.append(this.canvas, this.legend);
    const hint = document.createElement('div');
    hint.className = 'mc-font';
    hint.style.cssText = 'font-size:11px;color:#8da0c0;text-shadow:none;';
    hint.textContent = 'Tap a gold totem: travel there  ·  Tap: add waypoint  ·  Right-click a marker: remove  ·  B in-game: waypoint at your feet  ·  ✕ / M / Esc: close';
    panel.append(header, row, hint);
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

  // --- coordinate transforms (world <-> canvas), per the active view ---
  private get half(): number { return VIEWS[this.view].span / 2; }
  private get scale(): number { return CANVAS_PX / VIEWS[this.view].span; }
  private cx(x: number): number { return (x + this.half) * this.scale; }
  private cy(z: number): number { return (z + this.half) * this.scale; }
  private worldX(px: number): number { return px / this.scale - this.half; }
  private worldZ(py: number): number { return py / this.scale - this.half; }

  /** Render the active view's biome base ONCE (terrain is static; cached per
   *  view). The sample step scales with the span so cost stays bounded. */
  private renderBase(): HTMLCanvasElement {
    const cached = this.bases.get(this.view);
    if (cached) return cached;
    const { sample } = VIEWS[this.view];
    const half = this.half;
    const c = document.createElement('canvas');
    c.width = CANVAS_PX; c.height = CANVAS_PX;
    const g = c.getContext('2d')!;
    const step = sample * this.scale;
    for (let x = -half; x < half; x += sample) {
      for (let z = -half; z < half; z += sample) {
        const b = this.terrain.biomeWithWater(x, z, this.terrain.height(x, z));
        g.fillStyle = BIOME_COLOR[b] ?? '#444';
        g.fillRect(this.cx(x), this.cy(z), step + 1, step + 1);
      }
    }
    this.bases.set(this.view, c);
    return c;
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.drawImage(this.renderBase(), 0, 0);

    // The HEARTLAND boundary: a gold square at ±CORE_HALF. In the full-world
    // view, label the two societies so kids can read the geography at a glance.
    ctx.strokeStyle = 'rgba(255,216,74,0.9)';
    ctx.lineWidth = this.view === 'world' ? 1.5 : 2;
    ctx.strokeRect(this.cx(-CORE_HALF), this.cy(-CORE_HALF),
      CORE_BORDER * this.scale, CORE_BORDER * this.scale);
    if (this.view === 'world') {
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,216,74,0.95)';
      ctx.fillText('HEARTLAND', this.cx(0), this.cy(-CORE_HALF) - 5);
      ctx.fillStyle = 'rgba(190,205,230,0.8)';
      ctx.fillText('WILDS', this.cx(0), this.cy(-WORLD_BORDER * 0.36));
    }

    // Surface structures: big, readable kind-shaped icons with a drop shadow.
    for (const st of this.structures) {
      this.drawStructure(this.cx(st.x), this.cy(st.z), st.kind);
    }

    // Vault markers (Milestone D): discovered vaults are bright + tier-labeled;
    // merely SENSED nearby ones are faint with a '?'. Cleared ones dim.
    for (const v of this.vaults) {
      const px = this.cx(v.x), py = this.cy(v.z);
      ctx.save();
      ctx.globalAlpha = !v.discovered ? 0.5 : (v.cleared ? 0.6 : 1);
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4;
      ctx.fillStyle = '#171224';
      ctx.strokeStyle = '#b9a5ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = v.discovered ? '#efe6ff' : '#a898e0';
      ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(v.discovered ? '☠' : '?', px, py);
      if (v.discovered) {
        ctx.fillStyle = '#c9b8ff';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(['I', 'II', 'III'][v.tier - 1] ?? '?', px, py + 15);
      }
      ctx.restore();
    }

    // Waypoints: big named diamonds.
    for (const w of this.waypoints) {
      const px = this.cx(w.x), py = this.cy(w.z);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 3;
      ctx.fillStyle = this.rgba(w.color, 1);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px, py - 8); ctx.lineTo(px + 8, py); ctx.lineTo(px, py + 8); ctx.lineTo(px - 8, py);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3;
      ctx.strokeText(w.name, px, py + 10);
      ctx.fillStyle = '#fff';
      ctx.fillText(w.name, px, py + 10);
      ctx.restore();
    }

    // Attuned Waypoint Totems (B4): gold ringed markers — CLICK to travel.
    for (const t of this.totems) {
      const px = this.cx(t.x), py = this.cy(t.z);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffd84a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath();
      ctx.moveTo(px, py - 5); ctx.lineTo(px + 5, py); ctx.lineTo(px, py + 5); ctx.lineTo(px - 5, py);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // Dynamic markers (the war flags): a pole with a coloured pennant + label.
    for (const m of this.dynamicMarkers) {
      const fx = this.cx(m.x), fy = this.cy(m.z);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(fx, fy + 8); ctx.lineTo(fx, fy - 14); ctx.stroke();
      ctx.fillStyle = this.rgba(m.color, 1);
      ctx.beginPath();
      ctx.moveTo(fx, fy - 14); ctx.lineTo(fx + 14, fy - 9); ctx.lineTo(fx, fy - 4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      // Name under the pole, outlined so it survives any terrain colour.
      ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3;
      ctx.strokeText(m.name, fx, fy + 10);
      ctx.fillStyle = '#fff';
      ctx.fillText(m.name, fx, fy + 10);
      ctx.restore();
    }



    // Player marker: a big outlined heading arrow with a soft glow.
    const p = this.mapCtx.player();
    const px = this.cx(p.x), py = this.cy(p.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-p.yaw); // map +z is down; yaw 0 faces -z (up)
    ctx.shadowColor = 'rgba(255,255,255,0.7)'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    this.drawLegend();
    this.syncMarkers();
  }

  /** A big, kind-shaped structure icon (tower/bunker/pod) with a drop shadow. */
  private drawStructure(px: number, py: number, kind: string): void {
    const ctx = this.ctx;
    const col = STRUCT_COLOR[kind] ?? '#c9c9c9';
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 3;
    ctx.fillStyle = col;
    ctx.strokeStyle = 'rgba(10,12,18,0.9)'; ctx.lineWidth = 1.5;
    if (kind === 'tower') {
      // A little watchtower: a tall keep with crenellations.
      ctx.beginPath();
      ctx.moveTo(px - 4, py + 5); ctx.lineTo(px - 4, py - 3);
      ctx.lineTo(px - 5, py - 3); ctx.lineTo(px - 5, py - 6); ctx.lineTo(px - 2, py - 6);
      ctx.lineTo(px - 2, py - 4); ctx.lineTo(px + 2, py - 4); ctx.lineTo(px + 2, py - 6);
      ctx.lineTo(px + 5, py - 6); ctx.lineTo(px + 5, py - 3); ctx.lineTo(px + 4, py - 3);
      ctx.lineTo(px + 4, py + 5);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (kind === 'bunker') {
      // A dome bunker with a slit.
      ctx.beginPath();
      ctx.moveTo(px - 6, py + 4);
      ctx.arc(px, py + 4, 6, Math.PI, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(10,12,18,0.85)';
      ctx.fillRect(px - 3, py, 6, 1.6);
    } else {
      // Crashed cargo pod: a canted crate with a cross strap.
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4.5, -4.5, 9, 9);
      ctx.strokeRect(-4.5, -4.5, 9, 9);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(10,12,18,0.7)';
      ctx.fillRect(-4.5, -0.8, 9, 1.6);
      ctx.fillRect(-0.8, -4.5, 1.6, 9);
    }
    ctx.restore();
  }

  private drawLegend(): void {
    const lines: string[] = [];
    // Vault collection line (Milestone D): dungeon-hunting pressure.
    if (this.vaultTotal > 0) {
      lines.push(`<b>☠ VAULTS</b> — found ${this.vaults.length}/${this.vaultTotal}`);
      lines.push('');
    }
    // Surface structures legend (icon key + total).
    if (this.structures.length) {
      const c = (k: string): number =>
        this.structures.reduce((n, s) => n + (s.kind === k ? 1 : 0), 0);
      lines.push(`<b>◼ STRUCTURES</b> (${this.structures.length})`);
      lines.push(
        `<span style="color:${STRUCT_COLOR.tower}">◼</span> Towers ${c('tower')} · ` +
        `<span style="color:${STRUCT_COLOR.bunker}">◼</span> Bunkers ${c('bunker')} · ` +
        `<span style="color:${STRUCT_COLOR.pod}">◼</span> Pods ${c('pod')}`);
      lines.push('');
    }
    const p = this.mapCtx.player();
    // War flags (server-driven): always listed, with the distance to each, so
    // "where is our flag right now" is answerable at a glance.
    if (this.dynamicMarkers.length) {
      lines.push('<b>FLAGS</b>');
      for (const m of this.dynamicMarkers) {
        const dist = Math.round(Math.hypot(m.x - p.x, m.z - p.z));
        lines.push(
          `<span style="color:${this.rgba(m.color, 1)}">■</span> ` +
          `${this.escape(m.name)} <span style="color:#8da0c0">${dist}m</span>`);
      }
      lines.push('');
    }
    lines.push(`<b>WAYPOINTS</b> (${this.waypoints.length})`);
    this.waypoints.forEach((w, i) => {
      const dist = Math.round(Math.hypot(w.x - p.x, w.z - p.z));
      const alt = w.y !== undefined ? ` · Y${w.y}` : '';
      const eye = w.show ? '👁' : '–';
      lines.push(
        `<span style="color:${this.rgba(w.color, 1)}">■</span> ` +
        `${this.escape(w.name)} <span style="color:#8da0c0">${dist}m${alt}</span> ` +
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
  /** Read-only view of the saved waypoints (for the HUD minimap). */
  listWaypoints(): ReadonlyArray<{ x: number; z: number; color: number; name: string }> {
    return this.waypoints;
  }

  /** Drop a waypoint at a world position (the B hotkey / a Vault Compass) —
   *  auto-named unless given one; shown in-world immediately. Returns the name. */
  addWaypointAt(x: number, y: number, z: number, wantName?: string): string {
    const name = (wantName ?? '').trim().slice(0, 24) || `WP ${this.waypoints.length + 1}`;
    this.waypoints.push({
      x: Math.round(x), y: Math.round(y), z: Math.round(z),
      color: factionColor(this.mapCtx.faction()), name, show: true,
    });
    this.saveWaypoints();
    this.syncMarkers();
    if (this.open) this.draw();
    return name;
  }

  /** Replace the attuned-totem markers (click-to-travel). */
  setTotems(list: TotemPos[]): void {
    this.totems = list;
    if (this.open) this.draw();
  }

  /** Replace the discovered-vault markers (Milestone D). `total` is the whole
   *  world's vault count for the "found X / Y" collection line. */
  setVaults(list: VaultMark[], total: number): void {
    this.vaults = list;
    this.vaultTotal = total;
    if (this.open) this.draw();
  }

  /** Replace the surface-structure markers (shown as icons on the map). */
  setStructures(list: StructureMark[]): void {
    this.structures = list;
    if (this.open) this.draw();
  }

  /** Replace the dynamic (war-flag) markers shown on the map + as beacons. */
  setDynamicMarkers(list: { x: number; z: number; color: number; name: string }[]): void {
    this.dynamicMarkers = list;
    if (this.open) this.draw();
  }

  private onClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (CANVAS_PX / rect.width);
    const py = (e.clientY - rect.top) * (CANVAS_PX / rect.height);
    const wx = Math.round(this.worldX(px)), wz = Math.round(this.worldZ(py));
    if (e.button === 0) {
      // An attuned totem within click radius wins over dropping a waypoint.
      let bestT: TotemPos | null = null, bestTD = 14 / this.scale;
      for (const t of this.totems) {
        const d = Math.hypot(t.x - wx, t.z - wz);
        if (d < bestTD) { bestTD = d; bestT = t; }
      }
      if (bestT) { this.onTotemTravel?.(bestT); return; }
    }
    if (e.button === 2) {
      // Remove the nearest waypoint within a small radius.
      let best = -1, bestD = 18 / this.scale;
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
    this.waypoints.push({
      x: wx, y: this.terrain.height(wx, wz) + 1, z: wz,
      color: factionColor(this.mapCtx.faction()), name, show: true,
    });
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
      const gy = w.y ?? this.terrain.height(Math.round(w.x), Math.round(w.z));
      m.position.set(w.x + 0.5, gy + 15, w.z + 0.5);
      (m.material as THREE.MeshBasicMaterial).color.setHex(w.color);
    });
  }

  /** Project shown waypoints to floating on-screen badges (square + name +
   *  distance), MC-waypoint-mod style: clamped to the screen edge so a marker
   *  in any direction stays visible, pointing where to walk. Call each rendered
   *  frame while playing; pass the canvas size. */
  renderBeacons(width: number, height: number): void {
    // War flags always show as beacons; saved waypoints only when toggled on.
    const shown = this.open ? []
      : [...this.waypoints.filter((w) => w.show), ...this.dynamicMarkers];
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
      const wy = (w as { y?: number }).y;
      const gy = (wy ?? this.terrain.height(Math.round(w.x), Math.round(w.z))) + 2;
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
      const alt = wy !== undefined ? ` · Y${wy}` : '';
      el.style.display = '';
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      el.style.opacity = dist > 600 ? '0.6' : '0.95';
      el.innerHTML =
        `<div style="width:9px;height:9px;margin:0 auto 2px;background:${col};` +
        `border:1px solid #000;transform:rotate(45deg)"></div>` +
        `${this.escape(w.name)}<br><span style="color:#cfe0ff">${dist}m${alt}</span>`;
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
          y: Number.isFinite(w.y) ? (w.y as number) : undefined,
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
