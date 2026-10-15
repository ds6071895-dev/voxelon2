// Remote roster, snapshot playback, name/health tags and mode-specific styles.
// Hit tests use the same interpolated positions that are actually rendered.
import * as THREE from 'three';
import { createRatModel, type RatModel } from './ratseek_models';
import { glowOf, type Glow } from './model_primitives';
import { rayAabb as rayBox } from './ray_aabb';
import { SNAP_DISTANCE, netNow } from './interp';
import type { NetClient, Remote } from './net/client';
import { sanitizeCosmetics } from './character';
import type { Atlas } from './textures';
import { buildAvatarBody, disposeAvatarBody, type AvatarBody } from './avatar';
import {
  createAvatarItemMaterial, createAvatarEquipment, attachAvatarEquipment,
  poseAvatar, type AvatarEquipment,
} from './avatar_equipment';

function drawHealthBar(canvas: HTMLCanvasElement, frac: number): void {
  // Redrawn on every health change: CPU-backed, so its upload is a plain copy.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  const r = h / 2;
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, r); ctx.fill();
  ctx.fillStyle = '#2a0a0a';
  ctx.beginPath(); ctx.roundRect(3, 3, w - 6, h - 6, r - 2); ctx.fill();
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) {
    ctx.fillStyle = f > 0.5 ? '#3fd63a' : f > 0.25 ? '#e8c43a' : '#e84040';
    ctx.beginPath(); ctx.roundRect(3, 3, Math.round((w - 6) * f), h - 6, r - 2); ctx.fill();
  }
}

function makeNameTag(name: string): { tex: THREE.CanvasTexture; sprite: THREE.Sprite } {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 72;
  drawNameTag(canvas, name, '#ffffff');
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(1.8, 0.4, 1);
  sprite.renderOrder = 50;
  return { tex, sprite };
}

function drawNameTag(canvas: HTMLCanvasElement, name: string, color: string): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 25px "Segoe UI", Arial, sans-serif';
  const width = Math.min(316, Math.ceil(ctx.measureText(name).width) + 34);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(160 - width / 2, 22, width, 40, 10); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(name, 162, 44);
  ctx.fillStyle = color; ctx.fillText(name, 160, 42);
}

interface Avatar {
  id: number;
  tagColor: string;
  body: AvatarBody;
  group: THREE.Group;
  nameTex: THREE.CanvasTexture;
  sprite: THREE.Sprite;
  healthCanvas: HTMLCanvasElement;
  healthTex: THREE.CanvasTexture;
  healthSprite: THREE.Sprite;
  lastHealth: number;
  /** Rendered transform: the only position hit tests use. */
  dx: number; dy: number; dz: number; dyaw: number; dpitch: number;
  walkPhase: number;
  lastX: number; lastZ: number;
  /** Low-passed speed keeps late-packet catches from flailing the legs. */
  strideSpeed: number;
  /** Correction error bled off after a late packet. */
  ex: number; ey: number; ez: number;
  rawSpeed: number;
  heldId: number;
  equipment: AvatarEquipment | null;
  lastSwing: number;
  swingT: number;
  sneakT: number;
  aimT: number;
  reloadT: number;
  flash: THREE.Mesh | null;
  flashT: number;
  hurtT: number;
  hurtPeak: number;
  rat: RatModel | null;
  hiddenParts: THREE.Object3D[];
  personGlow: Glow | null;
}

/** A mode's say over body substitution, glow, visibility and name tags. */
export interface BodyStyle {
  rat: boolean;
  caged: boolean;
  glow: boolean;
  hidden: boolean;
  tag: boolean;
  tagColor?: string;
}

/** Scratch boxes for rayHit, which runs every frame. */
const _rayMin = new THREE.Vector3(), _rayMax = new THREE.Vector3();

export class RemotePlayers {
  private readonly avatars = new Map<number, Avatar>();
  private hovered = -1;
  maxHealth = 20;
  styleOf: ((id: number) => BodyStyle | null) | null = null;
  private readonly itemMat: THREE.MeshBasicMaterial;
  private readonly flashGeo = new THREE.OctahedronGeometry(0.13, 0);
  private readonly flashMat: THREE.MeshBasicMaterial;

  constructor(private readonly scene: THREE.Scene, private readonly net: NetClient, private readonly atlas: Atlas) {
    this.itemMat = createAvatarItemMaterial(atlas);
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
  }

  renderedPos(id: number): THREE.Vector3 | null { return this.avatars.get(id)?.group.position ?? null; }

  aimPoint(id: number): THREE.Vector3 | null {
    const av = this.avatars.get(id);
    if (!av?.group.visible || this.net.remotes.get(id)?.dead) return null;
    const [, height] = this.dims(id);
    return new THREE.Vector3(av.dx, av.dy + height * .55, av.dz);
  }

  setHovered(id: number): void { this.hovered = id; }
  muzzleFlash(id: number): void {
    const av = this.avatars.get(id);
    if (av?.flash) av.flashT = 1;
  }

  hurtFlash(id: number, strength = 1): void {
    const av = this.avatars.get(id);
    if (!av) return;
    av.hurtPeak = Math.max(av.hurtPeak * av.hurtT, Math.max(0.25, Math.min(1, strength)));
    av.hurtT = 1;
  }

  private build(remote: Remote): Avatar {
    const body = buildAvatarBody(sanitizeCosmetics(remote.info.cosmetics, remote.info.skin));
    const { group } = body;
    const { tex, sprite } = makeNameTag(remote.info.username);
    sprite.position.y = 2.34;
    group.add(sprite);
    const healthCanvas = document.createElement('canvas');
    healthCanvas.width = 160; healthCanvas.height = 20;
    const healthTex = new THREE.CanvasTexture(healthCanvas);
    const healthSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: healthTex, transparent: true, depthTest: false }));
    healthSprite.scale.set(1.2, 0.15, 1);
    healthSprite.position.y = 2.62;
    healthSprite.renderOrder = 51;
    healthSprite.visible = false;
    group.add(healthSprite);
    this.scene.add(group);
    return {
      body, group, id: remote.info.id, tagColor: '#ffffff', nameTex: tex, sprite,
      healthCanvas, healthTex, healthSprite, lastHealth: -1,
      dx: remote.tx, dy: remote.ty, dz: remote.tz, dyaw: remote.tyaw, dpitch: remote.tpitch,
      walkPhase: 0, lastX: remote.tx, lastZ: remote.tz,
      strideSpeed: 0, ex: 0, ey: 0, ez: 0, rawSpeed: 0,
      heldId: 0, equipment: null,
      lastSwing: remote.swing | 0, swingT: 1, sneakT: 0, aimT: 0, reloadT: 0,
      flash: null, flashT: 0, hurtT: 0, hurtPeak: 0,
      rat: null, hiddenParts: [], personGlow: null,
    };
  }

  private syncEquip(av: Avatar, r: Remote): void {
    const held = r.held | 0;
    if (held === av.heldId) return;
    // Glow copies borrow old equipment; detach them before changing the graph.
    av.personGlow?.dispose(); av.personGlow = null;
    av.equipment?.dispose();
    av.heldId = held;
    av.equipment = createAvatarEquipment(this.atlas, held, this.itemMat);
    av.flash = null; av.flashT = 0;
    if (!av.equipment) return;
    attachAvatarEquipment(av.body, av.equipment);
    if (av.equipment.kind === 'gun') {
      const flash = new THREE.Mesh(this.flashGeo, this.flashMat);
      flash.visible = false; flash.renderOrder = 60;
      (av.equipment.root.getObjectByName('muzzle') ?? av.equipment.root).add(flash);
      av.flash = flash;
    }
  }

  /** Reconcile the roster and replay all avatars at one buffered instant. */
  update(dt: number): void {
    for (const [id, av] of this.avatars) {
      if (!this.net.remotes.has(id)) { this.dispose(av); this.avatars.delete(id); }
    }
    const renderTime = netNow() - this.net.renderDelay(dt);
    this.net.applyRemotePoses(renderTime);
    const fallback = Math.min(1, 14 * dt);
    for (const [id, r] of this.net.remotes) {
      let av = this.avatars.get(id);
      if (!av) { av = this.build(r); this.avatars.set(id, av); }
      const s = r.buf.sample(renderTime);
      if (s) {
        // Absorb late-packet catch-up, preserving steady fast travel and teleports.
        const jump = Math.hypot(s.x - (av.dx - av.ex), s.y - (av.dy - av.ey), s.z - (av.dz - av.ez));
        const expected = av.rawSpeed * dt;
        av.rawSpeed = jump / Math.max(dt, 1e-4);
        if (jump - expected > 0.3 && jump < SNAP_DISTANCE) {
          av.ex = av.dx - s.x; av.ey = av.dy - s.y; av.ez = av.dz - s.z;
        } else if (jump >= SNAP_DISTANCE) av.ex = av.ey = av.ez = 0;
        const bleed = Math.exp(-dt * 14);
        av.ex *= bleed; av.ey *= bleed; av.ez *= bleed;
        av.dx = s.x + av.ex; av.dy = s.y + av.ey; av.dz = s.z + av.ez;
        av.dyaw = s.yaw; av.dpitch = s.pitch;
      } else {
        av.dx += (r.tx - av.dx) * fallback;
        av.dy += (r.ty - av.dy) * fallback;
        av.dz += (r.tz - av.dz) * fallback;
        av.dyaw += wrap(r.tyaw - av.dyaw) * fallback;
        av.dpitch += (r.tpitch - av.dpitch) * fallback;
      }
      av.group.position.set(av.dx, av.dy, av.dz);
      av.group.rotation.y = av.dyaw;
      av.group.visible = !r.dead;
      this.syncEquip(av, r);
      const style = this.styleOf?.(id) ?? null;
      this.applyStyle(av, style);
      if (style?.hidden) av.group.visible = false;
      if (av.hurtT > 0) {
        av.hurtT = Math.max(0, av.hurtT - dt / (0.12 + av.hurtPeak * 0.16));
        const tint = av.hurtT * av.hurtPeak;
        for (const mat of av.body.materials) mat.color.setRGB(1, 1 - tint * 0.78, 1 - tint * 0.8);
        if (av.hurtT <= 0) av.hurtPeak = 0;
      }
      if (av.flash) {
        av.flashT = Math.max(0, av.flashT - dt / 0.07);
        av.flash.visible = av.flashT > 0;
        if (av.flashT > 0) av.flash.scale.setScalar(0.6 + av.flashT * 0.8);
      }
      if ((r.swing | 0) !== av.lastSwing) { av.lastSwing = r.swing | 0; av.swingT = 0; }
      if (av.swingT < 1) av.swingT = Math.min(1, av.swingT + dt / 0.25);
      const attackSwing = av.swingT < 1 ? Math.sin(av.swingT * Math.PI) : 0;
      const gunHeld = av.equipment?.kind === 'gun';
      av.aimT += ((gunHeld && r.aiming ? 1 : 0) - av.aimT) * Math.min(1, dt * 12);
      av.reloadT = r.reloading ? (av.reloadT + dt / 1.1) % 1 : 0;
      av.sneakT += ((r.sneaking ? 1 : 0) - av.sneakT) * Math.min(1, 12 * dt);
      const hspeed = Math.hypot(av.dx - av.lastX, av.dz - av.lastZ) / Math.max(dt, 1e-4);
      av.lastX = av.dx; av.lastZ = av.dz;
      av.strideSpeed += (Math.min(hspeed, 9) - av.strideSpeed) * Math.min(1, dt * 9);
      const showHealth = id === this.hovered && av.group.visible;
      av.healthSprite.visible = showHealth;
      if (showHealth && av.lastHealth !== r.health) {
        drawHealthBar(av.healthCanvas, Math.min(1, r.health / Math.max(1, this.maxHealth)));
        av.healthTex.needsUpdate = true; av.lastHealth = r.health;
      }
      av.walkPhase += Math.min(av.strideSpeed, 7) * dt * 2.4;
      if (av.rat) { av.rat.pose(av.strideSpeed, av.walkPhase, performance.now() / 1000); continue; }
      poseAvatar(av.body, av.equipment, {
        walkPhase: av.walkPhase, speed: av.strideSpeed, sneak: av.sneakT,
        pitch: av.dpitch, attackSwing, aim: av.aimT,
        reload: r.reloading ? Math.sin(av.reloadT * Math.PI) : 0,
      });
    }
  }

  private applyStyle(av: Avatar, st: BodyStyle | null): void {
    const rat = !!st?.rat;
    if (rat && !av.rat) {
      av.personGlow?.dispose(); av.personGlow = null;
      av.rat = createRatModel(!!st?.caged);
      for (const c of av.group.children) {
        if (c === av.sprite || c === av.healthSprite || !c.visible) continue;
        c.visible = false; av.hiddenParts.push(c);
      }
      av.group.add(av.rat.group);
    } else if (!rat && av.rat) {
      av.group.remove(av.rat.group); av.rat.dispose(); av.rat = null;
      for (const c of av.hiddenParts) c.visible = true;
      av.hiddenParts = [];
    }
    // Visibility must be final before glow snapshots the equipment graph.
    if (av.equipment) av.equipment.root.visible = !rat;
    if (av.rat) {
      av.rat.setCaged(!!st?.caged); av.rat.setGlow(!!st?.glow);
    } else if (st?.glow || av.personGlow) {
      if (!av.personGlow && st?.glow) av.personGlow = glowOf(av.group);
      av.personGlow?.set(!!st?.glow);
    }
    av.sprite.visible = st ? st.tag : true;
    const color = st?.tagColor ?? '#ffffff';
    if (color !== av.tagColor) {
      av.tagColor = color;
      drawNameTag(av.nameTex.image as HTMLCanvasElement, this.net.remotes.get(av.id)?.info.username ?? '', color);
      av.nameTex.needsUpdate = true;
    }
  }

  private dims(id: number): [number, number] { return this.avatars.get(id)?.rat ? [0.24, 0.6] : [0.35, 2.0]; }

  avatarAtPoint(p: THREE.Vector3): number {
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead) continue;
      const [hw, h] = this.dims(id);
      if (p.x >= av.dx - hw && p.x <= av.dx + hw && p.y >= av.dy && p.y <= av.dy + h &&
          p.z >= av.dz - hw && p.z <= av.dz + hw) return id;
    }
    return -1;
  }

  avatarAtSegment(from: THREE.Vector3, to: THREE.Vector3): number {
    SEG_DIR.subVectors(to, from);
    const length = SEG_DIR.length();
    if (length < 1e-9) return this.avatarAtPoint(to);
    SEG_DIR.multiplyScalar(1 / length);
    let best = -1, bestT = length;
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead) continue;
      const [hw, h] = this.dims(id);
      SEG_MIN.set(av.dx - hw, av.dy, av.dz - hw);
      SEG_MAX.set(av.dx + hw, av.dy + h, av.dz + hw);
      const tHit = rayBox(from, SEG_DIR, SEG_MIN, SEG_MAX);
      if (tHit !== null && tHit <= bestT) { bestT = tHit; best = id; }
    }
    return best;
  }

  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let best = -1, bestT = maxDist;
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead || !av.group.visible) continue;
      const [hw, h] = this.dims(id);
      const tHit = rayBox(origin, dir, _rayMin.set(av.dx - hw, av.dy, av.dz - hw), _rayMax.set(av.dx + hw, av.dy + h, av.dz + hw));
      if (tHit !== null && tHit < bestT) { bestT = tHit; best = id; }
    }
    return best;
  }

  invalidate(id: number): void {
    const av = this.avatars.get(id);
    if (av) { this.dispose(av); this.avatars.delete(id); }
  }

  private dispose(av: Avatar): void {
    this.scene.remove(av.group);
    av.personGlow?.dispose(); av.personGlow = null;
    if (av.rat) av.group.remove(av.rat.group);
    av.rat?.dispose();
    av.equipment?.dispose(); av.equipment = null;
    disposeAvatarBody(av.body);
    av.nameTex.dispose(); av.sprite.material.dispose();
    av.healthTex.dispose(); av.healthSprite.material.dispose();
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const SEG_DIR = new THREE.Vector3();
const SEG_MIN = new THREE.Vector3();
const SEG_MAX = new THREE.Vector3();
