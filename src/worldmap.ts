// World atlas: cached shaded terrain, attuned totems, live flags and saved pins.
// Hidden structures remain unmarked so exploration stays player-driven.

import * as THREE from 'three';
import './worldmap.css';
import { Biome } from './biomes';
import { factionColor } from './teams';
import { Terrain } from './terrain';
import { CORE_BORDER, CORE_HALF, WORLD_BORDER } from './net/protocol';
import { iconSvg } from './emoji_icons';

const CANVAS_PX = 700;
const MAX_ZOOM = 10;
type MapView = 'core' | 'world';
// Per-view span + biome sample step. Both bases stay ~a few tens of thousands
// of terrain samples (rendered lazily once, cached) — NEVER the full 5000² grid.
const VIEWS: Record<MapView, { span: number; sample: number }> = {
  core: { span: CORE_BORDER + 160, sample: 4 },  // Heartland + a small fringe
  world: { span: WORLD_BORDER, sample: 18 },     // the whole 5000 world
};

const BIOME_COLOR: Record<number, string> = {
  [Biome.Ocean]: '#244d60',
  [Biome.Beach]: '#c4ba8d',
  [Biome.Plains]: '#829765',
  [Biome.Forest]: '#4f7652',
  [Biome.BirchForest]: '#6ba64c',
  [Biome.Desert]: '#ddca7c',
  [Biome.Snowy]: '#e6eef3',
  [Biome.Mountains]: '#8a9690',
  [Biome.SnowyMountains]: '#c5d4d2',
  [Biome.Mesa]: '#b06a39',
  [Biome.Ashlands]: '#3a3640',
  [Biome.Jungle]: '#2e7a2a',
  [Biome.Swamp]: '#4a5c38',
  [Biome.CherryGrove]: '#d98cb0',
  [Biome.Crystalfields]: '#b9c6e8',
  [Biome.Savanna]: '#cbb04a',
  [Biome.Taiga]: '#2f7d5c',
  [Biome.SnowyTaiga]: '#a7c4bd',
  [Biome.AutumnForest]: '#c9722a',
  [Biome.Meadow]: '#8ed44a',
  [Biome.SunflowerPlains]: '#d9d24e',
  [Biome.IceSpikes]: '#d6f0f7',
  [Biome.Highlands]: '#6f9a5a',
  [Biome.RedwoodForest]: '#2a5c3c',
  [Biome.TropicalCoast]: '#efe3b4',
  [Biome.Steppe]: '#b6b165',
  [Biome.Heath]: '#8d7fa0',
};

interface Waypoint {
  x: number; z: number; color: number; name: string; show: boolean;
  /** Altitude of the waypoint (older saved points have none). */
  y?: number;
}
interface DynamicMarker {
  x: number; z: number; color: number; name: string;
  /** Optional range for its in-world badge; it remains visible on the map. */
  beaconRange?: number;
}
export interface TotemPos { x: number; y: number; z: number; }
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
  private selected: Waypoint | null = null;
  private tracked: Waypoint | null = null;
  private editor!: HTMLFormElement;
  private readout!: HTMLDivElement;
  private search = '';
  private legendMarkup = '';
  private view: MapView = 'core';
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragStart: { x: number; y: number } | null = null;
  private suppressClickUntil = 0;
  private readonly bases = new Map<MapView, HTMLCanvasElement>(); // cached biome renders
  private waypoints: Waypoint[] = [];
  /** Attuned Waypoint Totems (B4) — click one on the map to travel to it. */
  private totems: TotemPos[] = [];
  /** Fired when the player clicks an attuned totem marker (main runs the
   *  wind-up + the actual teleport). */
  onTotemTravel?: (t: TotemPos) => void;

  // Dynamic markers (war flags): server-driven, NOT persisted; shown on the map
  // + as in-world beacons exactly like waypoints. Refreshed each frame by main.
  private dynamicMarkers: DynamicMarker[] = [];
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
    this.el.className = 'atlas-overlay';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'World atlas');
    this.el.innerHTML = `
      <section class="atlas-panel">
        <header class="atlas-header"><div><span class="atlas-eyebrow">VOXELON / EXPLORATION</span><h1>World atlas<span>Find your next horizon.</span></h1></div><button class="atlas-close" aria-label="Close map">×</button></header>
        <div class="atlas-body"><div class="atlas-main">
          <nav class="atlas-toolbar" aria-label="Map region"><div class="atlas-tabs"><button data-view="core" aria-pressed="true">Heartland</button><button data-view="world" aria-pressed="false">Full world</button></div><span class="atlas-region">TERRAIN SURVEY</span></nav>
          <div class="atlas-chart"><canvas aria-label="World map. Scroll or pinch to zoom, drag to pan, select a marker to edit or terrain to create a waypoint."></canvas><span class="atlas-north">N<span>↑</span></span><div class="atlas-zoom"><button type="button" data-zoom="in" aria-label="Zoom in">+</button><span aria-live="off">100%</span><button type="button" data-zoom="out" aria-label="Zoom out">−</button></div></div><div class="atlas-readout"></div>
        </div><aside class="atlas-sidebar"><div class="atlas-sidehead"><span class="atlas-eyebrow">YOUR JOURNEY</span><h2>Waypoints</h2><button class="atlas-primary" data-here>+ Mark my location</button></div>
          <form class="atlas-editor" hidden></form>
          <label class="atlas-search"><input type="search" placeholder="Find a waypoint…" aria-label="Find a waypoint"></label><div class="atlas-list"></div>
          <div class="atlas-key"><span>◆ Saved waypoint</span><span>◇ Attuned totem · tap to travel</span><span>↑ Your position & heading</span></div>
        </aside></div><footer class="atlas-footer"><span>Scroll or pinch to zoom · Drag to pan · Click terrain to place a pin</span><span><kbd>Esc</kbd> Close atlas</span></footer>
      </section>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.canvas.width = CANVAS_PX; this.canvas.height = CANVAS_PX;
    this.ctx = this.canvas.getContext('2d')!;
    this.legend = this.el.querySelector('.atlas-list')!;
    this.editor = this.el.querySelector('.atlas-editor')!;
    this.readout = this.el.querySelector('.atlas-readout')!;
    app.appendChild(this.el);
    this.el.querySelector('.atlas-close')!.addEventListener('click', () => { this.hide(); this.mapCtx.onClose?.(); });
    this.el.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
      button.addEventListener('click', () => this.setView(button.dataset.view as MapView));
    });
    this.el.querySelector('[data-here]')!.addEventListener('click', () => {
      const p = this.mapCtx.player(); this.openEditor(null, Math.round(p.x), Math.round(p.z));
    });
    this.el.querySelector('input[type=search]')!.addEventListener('input', e => {
      this.search = (e.target as HTMLInputElement).value.toLowerCase(); this.drawLegend();
    });
    this.el.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!this.editor.hidden) this.editor.hidden = true;
        else { this.hide(); this.mapCtx.onClose?.(); }
      }
      if (e.key === 'Tab') {
        const items = [...this.el.querySelectorAll<HTMLElement>('button,input')].filter(el => el.offsetParent !== null);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    this.el.addEventListener('keyup', e => e.stopPropagation());
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const p = this.canvasPoint(e.clientX, e.clientY);
      this.setZoom(this.zoom * Math.exp(-e.deltaY * .002), p.x, p.y);
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', e => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', e => this.onPointerEnd(e));
    this.canvas.addEventListener('pointercancel', e => this.onPointerEnd(e));
    this.canvas.addEventListener('click', e => this.onClick(e));
    this.el.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach(button => {
      button.addEventListener('click', () => this.setZoom(this.zoom * (button.dataset.zoom === 'in' ? 1.5 : 1 / 1.5)));
    });
    this.legend.addEventListener('click', e => this.onLegendClick(e));
  }

  private setView(view: MapView): void {
    this.view = view;
    this.zoom = 1; this.panX = 0; this.panY = 0;
    this.el.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    this.draw();
  }

  private openEditor(w: Waypoint | null, x = 0, z = 0): void {
    this.selected = w;
    this.editor.hidden = false;
    const color = (w?.color ?? factionColor(this.mapCtx.faction())).toString(16).padStart(6, '0');
    this.editor.innerHTML = `<div class="atlas-editor-title">${w ? 'Edit waypoint' : 'New waypoint'}<button type="button" data-cancel aria-label="Cancel waypoint">×</button></div>
      <label>Name<input name="name" maxlength="24" required value="${this.escape(w?.name ?? `Waypoint ${this.waypoints.length + 1}`)}" autocomplete="off"></label>
      <div class="atlas-editor-row"><label>Pin color<input type="color" name="color" value="#${color}"></label><span>X ${w?.x ?? x} / Z ${w?.z ?? z}</span></div>
      <button class="atlas-primary" type="submit">${w ? 'Save changes' : 'Create waypoint'}</button>`;
    this.editor.querySelector('[data-cancel]')!.addEventListener('click', () => { this.editor.hidden = true; });
    this.editor.onsubmit = e => {
      e.preventDefault();
      const data = new FormData(this.editor), name = String(data.get('name')).trim().slice(0, 24);
      if (!name) return;
      const color = parseInt(String(data.get('color')).slice(1), 16);
      if (w) { w.name = name; w.color = color; }
      else {
        const point = { x, z, y: this.terrain.height(x, z) + 1, name, color, show: true };
        this.waypoints.push(point); this.selected = point; this.tracked = point;
      }
      this.editor.hidden = true; this.saveWaypoints(); this.draw();
    };
    const input = this.editor.querySelector<HTMLInputElement>('input')!; input.focus(); input.select();
    this.draw();
  }

  toggle(): void { this.open ? this.hide() : this.show(); }
  show(): void { this.open = true; this.el.style.display = 'flex'; this.draw(); this.el.querySelector<HTMLButtonElement>('.atlas-close')!.focus(); }
  hide(): void {
    this.open = false;
    this.el.style.display = 'none';
    this.editor.hidden = true;
  }

  /** Redraw while open (player + claims + nodes move). */
  update(): void { if (this.open) this.draw(); }

  // --- coordinate transforms (world <-> canvas), per the active view ---
  private get half(): number { return VIEWS[this.view].span / 2; }
  private get scale(): number { return CANVAS_PX / VIEWS[this.view].span; }
  private cx(x: number): number { return (x + this.half) * this.scale; }
  private cy(z: number): number { return (z + this.half) * this.scale; }
  private worldX(px: number): number { return ((px - this.panX) / this.zoom) / this.scale - this.half; }
  private worldZ(py: number): number { return ((py - this.panY) / this.zoom) / this.scale - this.half; }

  private canvasPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) * CANVAS_PX / rect.width,
      y: (clientY - rect.top) * CANVAS_PX / rect.height };
  }

  private clampPan(): void {
    const min = CANVAS_PX * (1 - this.zoom);
    this.panX = Math.max(min, Math.min(0, this.panX));
    this.panY = Math.max(min, Math.min(0, this.panY));
  }

  private setZoom(next: number, x = CANVAS_PX / 2, y = CANVAS_PX / 2): void {
    const zoom = Math.max(1, Math.min(MAX_ZOOM, next));
    this.panX = x - (x - this.panX) * zoom / this.zoom;
    this.panY = y - (y - this.panY) * zoom / this.zoom;
    this.zoom = zoom;
    this.clampPan();
    this.draw();
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.canvasPoint(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) this.dragStart = p;
    else { this.dragStart = null; this.suppressClickUntil = performance.now() + 500; }
  }

  private onPointerMove(e: PointerEvent): void {
    const old = this.pointers.get(e.pointerId);
    if (!old) return;
    const p = this.canvasPoint(e.clientX, e.clientY);
    if (this.pointers.size === 2) {
      const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(old.x - other.x, old.y - other.y);
      const after = Math.hypot(p.x - other.x, p.y - other.y);
      const oldMid = { x: (old.x + other.x) / 2, y: (old.y + other.y) / 2 };
      const newMid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 };
      if (before > 0) this.setZoom(this.zoom * after / before, oldMid.x, oldMid.y);
      this.panX += newMid.x - oldMid.x;
      this.panY += newMid.y - oldMid.y;
      this.clampPan();
      this.suppressClickUntil = performance.now() + 500;
      this.draw();
    } else {
      if (this.dragStart && Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y) > 5)
        this.suppressClickUntil = performance.now() + 500;
      if (performance.now() < this.suppressClickUntil) {
        this.panX += p.x - old.x; this.panY += p.y - old.y;
        this.clampPan(); this.draw();
      }
    }
    this.pointers.set(e.pointerId, p);
  }

  private onPointerEnd(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.dragStart = null;
  }

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
        const h = this.terrain.height(x, z);
        const b = this.terrain.biomeWithWater(x, z, h);
        g.fillStyle = BIOME_COLOR[b] ?? '#444';
        g.fillRect(this.cx(x), this.cy(z), step + 1, step + 1);
        const slope = h - this.terrain.height(x - sample, z - sample);
        g.fillStyle = slope > 0 ? `rgba(255,245,210,${Math.min(.24, slope * .018)})` : `rgba(5,20,30,${Math.min(.32, -slope * .022) + .08})`;
        g.fillRect(this.cx(x), this.cy(z), step + 1, step + 1);
      }
    }
    this.bases.set(this.view, c);
    return c;
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    ctx.save();
    ctx.setTransform(this.zoom, 0, 0, this.zoom, this.panX, this.panY);
    ctx.drawImage(this.renderBase(), 0, 0);

    ctx.save();
    ctx.strokeStyle = 'rgba(220,242,236,.12)'; ctx.lineWidth = 1;
    for (let n = 1; n < 10; n++) {
      ctx.beginPath(); ctx.moveTo(n * 70, 0); ctx.lineTo(n * 70, 700); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, n * 70); ctx.lineTo(700, n * 70); ctx.stroke();
    }
    const shade = ctx.createRadialGradient(350, 350, 180, 350, 350, 500);
    shade.addColorStop(0, 'transparent'); shade.addColorStop(1, 'rgba(4,16,23,.5)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, 700, 700);
    if (this.tracked) {
      const p = this.mapCtx.player();
      ctx.setLineDash([5, 7]); ctx.strokeStyle = this.rgba(this.tracked.color, .9); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(this.cx(p.x), this.cy(p.z)); ctx.lineTo(this.cx(this.tracked.x), this.cy(this.tracked.z)); ctx.stroke();
    }
    ctx.restore();

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

    this.drawWaypoints();

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

    this.drawDynamicMarkers();

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

    ctx.restore();
    this.el.querySelector('.atlas-zoom span')!.textContent = `${Math.round(this.zoom * 100)}%`;
    this.readout.textContent = `X ${Math.round(p.x)} / Z ${Math.round(p.z)}   ·   ${this.view === 'core' ? 'HEARTLAND' : 'FULL WORLD'}   ·   Grid ${Math.round(VIEWS[this.view].span / 10)} m${this.tracked ? `   ·   To ${this.tracked.name}: ${Math.round(Math.hypot(this.tracked.x - p.x, this.tracked.z - p.z))} m` : ''}`;
    this.drawLegend();
  }

  /** The player's saved waypoints. */
  private drawWaypoints(): void {
    const ctx = this.ctx;
    for (const w of this.waypoints) {
      const px = this.cx(w.x), py = this.cy(w.z);
      ctx.save();
      ctx.globalAlpha = w.show ? 1 : .45;
      if (w === this.selected || w === this.tracked) {
        ctx.fillStyle = this.rgba(w.color, .18); ctx.strokeStyle = this.rgba(w.color, .85); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, 17, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
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
  }

  /** Live war flags, pushed each frame by the game. */
  private drawDynamicMarkers(): void {
    const ctx = this.ctx;
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
  }

  private drawLegend(): void {
    const p = this.mapCtx.player();
    const cards = this.waypoints.map((w, i) => {
      if (!w.name.toLowerCase().includes(this.search)) return '';
      const dist = Math.round(Math.hypot(w.x - p.x, w.z - p.z));
      return `<article class="atlas-card ${w === this.tracked ? 'is-tracked' : ''}" style="--pin:${this.rgba(w.color, 1)}">
        <button class="atlas-card-name" data-edit="${i}"><span class="atlas-pin">◆</span><span><strong>${this.escape(w.name)}</strong><small>X ${w.x} · Z ${w.z}${w.y !== undefined ? ` · Y ${w.y}` : ''}</small></span><b>${dist < 1000 ? `${dist} m` : `${(dist / 1000).toFixed(1)} km`}</b></button>
        <div class="atlas-card-actions"><button data-track="${i}" aria-pressed="${w === this.tracked}">${w === this.tracked ? '◉ Tracking' : '◎ Track'}</button><button data-eye="${i}" aria-pressed="${w.show}">${w.show ? 'Visible' : 'Hidden'}</button><button data-del="${i}" aria-label="Delete ${this.escape(w.name)}">${iconSvg('close')}</button></div></article>`;
    }).join('');
    const flags = this.dynamicMarkers.map(m => `<div class="atlas-flag"><span style="color:${this.rgba(m.color, 1)}">⚑</span> ${this.escape(m.name)}<small>${Math.round(Math.hypot(m.x - p.x, m.z - p.z))} m</small></div>`).join('');
    const markup = `<div class="atlas-list-label">SAVED LOCATIONS <span>${this.waypoints.length}</span></div>${cards || `<div class="atlas-empty"><span>◇</span><strong>${this.search ? 'No matching waypoints' : 'Every journey starts somewhere'}</strong><p>${this.search ? 'Try another name.' : 'Click the map to save a place worth returning to.'}</p></div>`}${flags ? `<div class="atlas-list-label">LIVE FLAGS</div>${flags}` : ''}`;
    if (markup !== this.legendMarkup) {
      // Keep keyboard focus when live distance updates replace the cards.
      const focused = document.activeElement as HTMLElement | null;
      const action = focused && this.legend.contains(focused)
        ? ['edit', 'track', 'eye', 'del'].find(key => focused.dataset[key] !== undefined) : undefined;
      const index = action ? focused!.dataset[action] : undefined;
      this.legend.innerHTML = markup; this.legendMarkup = markup;
      if (action) this.legend.querySelector<HTMLButtonElement>(`[data-${action}="${index}"]`)?.focus({ preventScroll: true });
    }
  }

  private escape(s: string): string {
    return s.replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
  }

  private onLegendClick(e: MouseEvent): void {
    const button = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!button) return;
    const action = ['edit', 'track', 'eye', 'del'].find(key => button.dataset[key] !== undefined);
    if (!action) return;
    const i = Number(button.dataset[action]), w = this.waypoints[i];
    if (!w) return;
    if (action === 'edit') { this.openEditor(w); return; }
    if (action === 'track') {
      this.tracked = this.tracked === w ? null : w;
      if (this.tracked) {
        w.show = true;
        if (Math.abs(w.x) > VIEWS.core.span / 2 || Math.abs(w.z) > VIEWS.core.span / 2) this.setView('world');
      }
    }
    if (action === 'eye') { w.show = !w.show; if (!w.show && this.tracked === w) this.tracked = null; }
    if (action === 'del') {
      this.waypoints.splice(i, 1);
      if (this.tracked === w) this.tracked = null;
      if (this.selected === w) { this.selected = null; this.editor.hidden = true; }
    }
    this.saveWaypoints(); this.draw();
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
    if (this.open) this.draw();
    return name;
  }

  /** Replace the attuned-totem markers (click-to-travel). */
  setTotems(list: TotemPos[]): void {
    this.totems = list;
    if (this.open) this.draw();
  }

  /** Replace the dynamic (war-flag) markers shown on the map + as beacons. */
  setDynamicMarkers(list: DynamicMarker[]): void {
    this.dynamicMarkers = list;
    if (this.open) this.draw();
  }

  private onClick(e: MouseEvent): void {
    if (performance.now() < this.suppressClickUntil) return;
    const { x: px, y: py } = this.canvasPoint(e.clientX, e.clientY);
    const wx = Math.round(this.worldX(px)), wz = Math.round(this.worldZ(py));
    if (e.button === 0) {
      // An attuned totem within click radius wins over dropping a waypoint.
      let bestT: TotemPos | null = null, bestTD = 14 / (this.scale * this.zoom);
      for (const t of this.totems) {
        const d = Math.hypot(t.x - wx, t.z - wz);
        if (d < bestTD) { bestTD = d; bestT = t; }
      }
      if (bestT) { this.onTotemTravel?.(bestT); return; }
    }
    if (e.button !== 0) return;
    let best: Waypoint | null = null, distance = 18 / (this.scale * this.zoom);
    for (const w of this.waypoints) {
      const d = Math.hypot(w.x - wx, w.z - wz);
      if (d < distance) { best = w; distance = d; }
    }
    this.openEditor(best, wx, wz);
  }

  /** Keep the in-world waypoint pillars in sync with the list (only the ones the
   *  player has chosen to show in-world get a 3D beacon). */
  private syncMarkers(): void {
    const shown = this.waypoints.filter((w) => w.show);
    while (this.markerGroup.children.length > shown.length) {
      const m = this.markerGroup.children[this.markerGroup.children.length - 1] as THREE.Mesh;
      this.markerGroup.remove(m);
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
    const p = this.mapCtx.player();
    const shown = this.open ? []
      : [...this.waypoints.filter((w) => w.show), ...this.dynamicMarkers.filter((m) =>
        m.beaconRange === undefined || Math.hypot(m.x - p.x, m.z - p.z) <= m.beaconRange)];
    // Grow/shrink the pool of badge elements to match.
    while (this.beaconEls.length > shown.length) {
      this.beaconLayer.removeChild(this.beaconEls.pop()!);
    }
    while (this.beaconEls.length < shown.length) {
      const el = document.createElement('div');
      el.className = 'atlas-beacon';
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
    const margin = Math.min(100, width / 4);

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
      if (!Number.isFinite(sx)) sx = width / 2;
      if (!Number.isFinite(sy)) sy = height / 2;
      sx = Math.max(margin, Math.min(width - margin, sx));
      sy = Math.max(margin, Math.min(height - margin, sy));
      const dist = Math.round(Math.hypot(w.x - p.x, w.z - p.z));
      const col = this.rgba(w.color, 1);
      const alt = wy !== undefined ? ` · Y${wy}` : '';
      el.style.display = '';
      el.style.left = `${sx}px`;
      el.style.top = `${sy}px`;
      el.style.opacity = dist > 600 ? '0.6' : '0.95';
      const badge =
        `<div style="width:9px;height:9px;margin:0 auto 2px;background:${col};` +
        `border:1px solid #000;transform:rotate(45deg)"></div>` +
        `${w === this.tracked ? '◎ ' : ''}${this.escape(w.name)}<br><span style="color:#cfe0ff">${dist}m${alt}</span>`;
      if (el.dataset.badge !== badge) { el.innerHTML = badge; el.dataset.badge = badge; }
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
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) this.waypoints = (parsed as Partial<Waypoint>[])
        .filter((w) => w && Number.isFinite(w.x) && Number.isFinite(w.z))
        .map((w, i) => ({
          x: w.x as number, z: w.z as number,
          y: Number.isFinite(w.y) ? (w.y as number) : undefined,
          color: Number.isFinite(w.color) ? ((w.color as number) & 0xffffff) : 0xffffff,
          name: typeof w.name === 'string' && w.name ? w.name.slice(0, 24) : `WP ${i + 1}`,
          show: w.show !== false, // default ON (older saved points had no flag)
        }));
      const tracked = localStorage.getItem('voxelon.waypointTarget');
      if (tracked !== null) {
        const point = this.waypoints[Number(tracked)];
        if (point?.show) this.tracked = point;
      }
    } catch { /* ignore */ }
    this.syncMarkers();
  }
  private saveWaypoints(): void {
    this.syncMarkers();
    try {
      localStorage.setItem('voxelon.waypoints', JSON.stringify(this.waypoints));
      if (this.tracked) localStorage.setItem('voxelon.waypointTarget', String(this.waypoints.indexOf(this.tracked)));
      else localStorage.removeItem('voxelon.waypointTarget');
    } catch { /* Storage can be unavailable in private browsing. */ }
  }
}
