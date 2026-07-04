// Renders other players as boxy, Minecraft-style humanoid avatars with
// per-username procedural skins and floating name tags. Positions are
// interpolated toward the latest networked transform. Also provides a ray
// test against avatars for PvP targeting.

import * as THREE from 'three';
import type { NetClient, Remote } from './net/client';
import { mulberry32 } from './noise';
import { factionColor, isFaction } from './teams';

// Per-face shading (right/left/top/bottom/front/back) — mimics Minecraft's
// directional lighting so the model reads as 3D even without real lights.
const FACE_SHADE = [0.75, 0.6, 1.0, 0.45, 0.85, 0.7];
// Fallback max HP for a remote whose hearts we don't know (lifesteal makes
// max HP per-player: hearts * 2).
const REMOTE_MAX_HEALTH = 20;

/** The deterministic skin tone for a given skin seed — the FIRST three draws of
 *  the avatar's RNG. Shared so the local first-person hand matches the avatar
 *  other players see. Must stay in lockstep with build()'s opening draws. */
export function skinColor(seed: number): THREE.Color {
  const rng = mulberry32(seed);
  const hue = 0.05 + rng() * 0.05;
  const sat = 0.3 + rng() * 0.18;
  const lit = 0.52 + rng() * 0.2;
  return new THREE.Color().setHSL(hue, sat, lit);
}

// ─── geometry helpers ──────────────────────────────────────────────────────

function shadedBox(
  w: number, h: number, d: number, color: THREE.Color,
  shadeOverride?: number[]
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const shade = shadeOverride ?? FACE_SHADE;
  for (let f = 0; f < 6; f++) {
    const s = shade[f];
    for (let v = 0; v < 4; v++) {
      const k = f * 4 + v;
      colors[k * 3]     = color.r * s;
      colors[k * 3 + 1] = color.g * s;
      colors[k * 3 + 2] = color.b * s;
    }
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** A coloured box mesh offset so the pivot is at the TOP of the box. */
function pivotedBox(
  mat: THREE.Material,
  w: number, h: number, d: number,
  color: THREE.Color,
  shade?: number[]
): THREE.Mesh {
  const mesh = new THREE.Mesh(shadedBox(w, h, d, color, shade), mat);
  mesh.position.y = -h / 2; // pivot at top
  return mesh;
}

/** A limb group (pivot at top) placed at (x, y, z). */
function limb(
  mat: THREE.Material,
  w: number, h: number, d: number,
  color: THREE.Color,
  x: number, y: number, z: number,
  shade?: number[]
): THREE.Group {
  const g = new THREE.Group();
  g.add(pivotedBox(mat, w, h, d, color, shade));
  g.position.set(x, y, z);
  return g;
}

// ─── face builder ─────────────────────────────────────────────────────────

/**
 * Paints a flat, friendly blocky face onto the front of the head: chunky
 * two-tone pixel eyes (white + a coloured pupil on the inner edge), soft flat
 * brows in the hair colour, a smile with upturned corners, and faint rosy
 * cheeks. Everything sits a hair proud of the face cube so it doesn't
 * z-fight — no protruding nose or ears, keeping the silhouette a clean cube.
 */
function buildFace(
  parent: THREE.Group,
  mat: THREE.Material,
  skin: THREE.Color,
  hair: THREE.Color,
  eye: THREE.Color,
  headY: number  // local Y of the centre of the head
): void {
  const white = new THREE.Color(0xf5f7f9);
  const mouth = new THREE.Color(skin).multiplyScalar(0.55);
  const blush = new THREE.Color(skin).lerp(new THREE.Color(0xe86a55), 0.3);
  // Flat front-face shading (features read straight-on, not directionally lit).
  const flat = [1, 1, 1, 1, 1, 1];

  const addBox = (
    w: number, h: number, d: number,
    color: THREE.Color,
    x: number, y: number, z: number
  ) => {
    const mesh = new THREE.Mesh(shadedBox(w, h, d, color, flat), mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
  };

  const fz = -0.252; // just proud of the front face of the 0.5-deep head

  for (const side of [-1, 1]) {
    const ex = side * 0.125;
    // Chunky two-pixel eye: white outer half, coloured pupil on the inner half.
    addBox(0.14, 0.11, 0.02, white, ex, headY + 0.04, fz);
    addBox(0.07, 0.11, 0.025, eye, ex - side * 0.035, headY + 0.04, fz - 0.001);
    // Flat relaxed brow in the hair colour.
    addBox(0.14, 0.03, 0.02, hair, ex, headY + 0.125, fz);
    // Rosy cheek dot just outside each eye.
    addBox(0.05, 0.04, 0.02, blush, side * 0.185, headY - 0.05, fz);
  }
  // Smile: a short bar with raised corner nubs.
  addBox(0.14, 0.035, 0.02, mouth, 0, headY - 0.145, fz);
  addBox(0.035, 0.035, 0.02, mouth, -0.085, headY - 0.115, fz);
  addBox(0.035, 0.035, 0.02, mouth, 0.085, headY - 0.115, fz);
}

// ─── name/health tag helpers ───────────────────────────────────────────────

function drawHealthBar(canvas: HTMLCanvasElement, frac: number): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Pill-shaped background
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  const r = h / 2;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, r);
  ctx.fill();

  // Empty track
  ctx.fillStyle = '#2a0a0a';
  ctx.beginPath();
  ctx.roundRect(3, 3, w - 6, h - 6, r - 2);
  ctx.fill();

  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) {
    // Filled portion — colour shifts green→yellow→red
    ctx.fillStyle = f > 0.5 ? '#3fd63a' : f > 0.25 ? '#e8c43a' : '#e84040';
    ctx.beginPath();
    ctx.roundRect(3, 3, Math.round((w - 6) * f), h - 6, r - 2);
    ctx.fill();
  }
}

function makeNameTag(
  name: string, team: THREE.Color, factioned: boolean
): { tex: THREE.CanvasTexture; sprite: THREE.Sprite } {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 72;
  const ctx = canvas.getContext('2d')!;

  // Rounded dark pill background
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 8, 320, 54, 10);
  ctx.fill();

  // Left faction-color accent stripe
  if (factioned) {
    const tr = team.r * 255 | 0, tg = team.g * 255 | 0, tb = team.b * 255 | 0;
    ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
    ctx.beginPath();
    ctx.roundRect(0, 8, 7, 54, [10, 0, 0, 10]);
    ctx.fill();
  }

  // Shadow then name text
  ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillText(name, 162, 37);  // shadow
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 160, 35);  // main

  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false,
  }));
  sprite.scale.set(1.8, 0.4, 1);
  sprite.renderOrder = 50;
  return { tex, sprite };
}

// ─── avatar state ─────────────────────────────────────────────────────────

interface Avatar {
  group: THREE.Group;
  head: THREE.Group;    // separate group so we can pitch it with look-dir
  /** [leftLeg, rightLeg, leftArm, rightArm] — each pivots at its hip/shoulder. */
  parts: THREE.Group[];
  material: THREE.MeshBasicMaterial;
  nameTex: THREE.CanvasTexture;
  sprite: THREE.Sprite;
  healthCanvas: HTMLCanvasElement;
  healthTex: THREE.CanvasTexture;
  healthSprite: THREE.Sprite;
  lastHealth: number;
  dx: number; dy: number; dz: number; dyaw: number;
  walkPhase: number;
  lastX: number; lastZ: number;
}

// ─── main class ───────────────────────────────────────────────────────────

export class RemotePlayers {
  private readonly scene: THREE.Scene;
  private readonly net: NetClient;
  private readonly avatars = new Map<number, Avatar>();
  private hovered = -1;

  constructor(scene: THREE.Scene, net: NetClient) {
    this.scene = scene;
    this.net = net;
  }

  /** Mark which avatar the local crosshair is over (-1 = none). */
  setHovered(id: number): void { this.hovered = id; }

  private build(remote: Remote): Avatar {
    const rng = mulberry32(remote.info.skin);

    // Skin tone: warm peachy spectrum, gentle saturation & lightness.
    // NOTE: these three draws must stay in lockstep with skinColor() above.
    const skinHue = 0.05 + rng() * 0.05;
    const skinSat = 0.3 + rng() * 0.18;
    const skinLit = 0.52 + rng() * 0.2;
    const skin = new THREE.Color().setHSL(skinHue, skinSat, skinLit);

    // Eye colour: a small friendly palette picked deterministically per skin.
    const EYES = [0x3a5fa8, 0x4a7a3e, 0x6b4a2e, 0x40707a];
    const eye = new THREE.Color(EYES[Math.floor(rng() * EYES.length)]);

    const faction = remote.info.faction;
    const team    = new THREE.Color(factionColor(faction));
    const shirt   = isFaction(faction) ? team : new THREE.Color().setHSL(rng(), 0.55, 0.45);
    // Pants: distinctly darker, slightly desaturated
    const pantsH  = rng();
    const pants   = new THREE.Color().setHSL(pantsH, 0.3, 0.25);
    // Shoes: near-black with a slight hue
    const shoe    = new THREE.Color().setHSL(pantsH, 0.2, 0.12);
    // Hair: dark variant of skin hue
    const hair    = new THREE.Color().setHSL(skinHue, 0.4, 0.18 + rng() * 0.12);

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';

    // Classic Minecraft proportions, in world blocks (feet at y=0):
    //   head 0.5³ · torso 0.5w×0.75h×0.25d · arms/legs 0.25×0.75×0.25.
    // Total height ≈ 2.0. Single-segment limbs (no forearms/shins) for the
    // crisp blocky look; hands/feet are short skin/shoe caps on each limb.
    const TORSO_W = 0.5, TORSO_H = 0.75, TORSO_D = 0.26;
    const LIMB_W = 0.24, LIMB_H = 0.74, LIMB_D = 0.24;
    const HEAD = 0.5;
    const HIP_Y = 0.75;        // top of the legs / bottom of the torso
    const SHOULDER_Y = 1.46;   // arm pivot
    const NECK_Y = 1.5;        // bottom of the head / neck base

    // ── Torso ──────────────────────────────────────────────────────────────
    const torso = new THREE.Mesh(shadedBox(TORSO_W, TORSO_H, TORSO_D, shirt), mat);
    torso.position.y = HIP_Y + TORSO_H / 2;
    group.add(torso);
    // Belt strip (pants-colored) at the waist for a two-tone read.
    const belt = new THREE.Mesh(shadedBox(TORSO_W + 0.006, 0.16, TORSO_D + 0.006, pants), mat);
    belt.position.y = HIP_Y + 0.08;
    group.add(belt);

    // Neck
    const neck = new THREE.Mesh(shadedBox(0.2, 0.1, 0.2, skin), mat);
    neck.position.y = NECK_Y + 0.04;
    group.add(neck);

    // ── Head ──────────────────────────────────────────────────────────────
    // Separate group, pivot at the neck base so it can pitch with look-dir.
    const headGroup = new THREE.Group();
    const headY_local = HEAD / 2 + 0.05; // centre of the head above the pivot
    const headMesh = new THREE.Mesh(shadedBox(HEAD, HEAD, HEAD, skin), mat);
    headMesh.position.y = headY_local;
    headGroup.add(headMesh);

    // Hair: overhanging cap + front fringe over the brow + side panels + a
    // fuller back panel, so the head reads as a styled haircut, not a bald cube.
    const hairCap = new THREE.Mesh(shadedBox(HEAD + 0.04, 0.13, HEAD + 0.04, hair), mat);
    hairCap.position.y = headY_local + HEAD / 2 - 0.025;
    headGroup.add(hairCap);
    const fringe = new THREE.Mesh(shadedBox(HEAD + 0.02, 0.07, 0.035, hair), mat);
    fringe.position.set(0, headY_local + 0.18, -HEAD / 2 - 0.005);
    headGroup.add(fringe);
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(shadedBox(0.035, 0.2, HEAD + 0.02, hair), mat);
      panel.position.set(side * (HEAD / 2 + 0.005), headY_local + HEAD / 2 - 0.18, 0);
      headGroup.add(panel);
    }
    const hairBack = new THREE.Mesh(shadedBox(HEAD + 0.02, 0.3, 0.045, hair), mat);
    hairBack.position.set(0, headY_local + 0.08, HEAD / 2 - 0.01);
    headGroup.add(hairBack);

    buildFace(headGroup, mat, skin, hair, eye, headY_local);

    headGroup.position.y = NECK_Y;
    group.add(headGroup);

    // ── Legs (single segment, pivot at the hip) ────────────────────────────
    const ll = limb(mat, LIMB_W, LIMB_H, LIMB_D, pants, -0.12, HIP_Y, 0);
    const rl = limb(mat, LIMB_W, LIMB_H, LIMB_D, pants,  0.12, HIP_Y, 0);
    // Shoes — short caps at the foot of each leg (swing with the leg).
    for (const leg of [ll, rl]) {
      const foot = new THREE.Mesh(shadedBox(LIMB_W + 0.01, 0.12, LIMB_D + 0.06, shoe), mat);
      foot.position.set(0, -LIMB_H + 0.06, -0.02);
      leg.add(foot);
    }

    // ── Arms (single segment, pivot at the shoulder) ───────────────────────
    const armX = TORSO_W / 2 + LIMB_W / 2;
    const la = limb(mat, LIMB_W, LIMB_H, LIMB_D, shirt, -armX, SHOULDER_Y, 0);
    const ra = limb(mat, LIMB_W, LIMB_H, LIMB_D, shirt,  armX, SHOULDER_Y, 0);
    // Hands — skin-colored caps below the sleeve (swing with the arm).
    for (const arm of [la, ra]) {
      const hand = new THREE.Mesh(shadedBox(LIMB_W + 0.006, 0.14, LIMB_D + 0.006, skin), mat);
      hand.position.y = -LIMB_H + 0.07;
      arm.add(hand);
    }

    group.add(ll, rl, la, ra);

    // ── Name tag ───────────────────────────────────────────────────────────
    const { tex, sprite } = makeNameTag(remote.info.username, team, isFaction(faction));
    sprite.position.y = 2.34;
    group.add(sprite);

    // ── Health bar ─────────────────────────────────────────────────────────
    const healthCanvas = document.createElement('canvas');
    healthCanvas.width = 160; healthCanvas.height = 20;
    const healthTex = new THREE.CanvasTexture(healthCanvas);
    const healthSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: healthTex, transparent: true, depthTest: false,
    }));
    healthSprite.scale.set(1.2, 0.15, 1);
    healthSprite.position.y = 2.62;
    healthSprite.renderOrder = 51;
    healthSprite.visible = false;
    group.add(healthSprite);

    this.scene.add(group);
    return {
      group, head: headGroup,
      parts: [ll, rl, la, ra],
      material: mat, nameTex: tex, sprite,
      healthCanvas, healthTex, healthSprite, lastHealth: -1,
      dx: remote.tx, dy: remote.ty, dz: remote.tz, dyaw: remote.tyaw,
      walkPhase: 0, lastX: remote.tx, lastZ: remote.tz,
    };
  }

  /** Reconcile avatars with the net roster and interpolate, once per frame. */
  update(dt: number): void {
    // Remove avatars whose players left.
    for (const [id, av] of this.avatars) {
      if (!this.net.remotes.has(id)) {
        this.dispose(av);
        this.avatars.delete(id);
      }
    }
    const t = Math.min(1, 14 * dt);
    for (const [id, r] of this.net.remotes) {
      let av = this.avatars.get(id);
      if (!av) { av = this.build(r); this.avatars.set(id, av); }

      av.dx += (r.tx - av.dx) * t;
      av.dy += (r.ty - av.dy) * t;
      av.dz += (r.tz - av.dz) * t;
      av.dyaw += wrap(r.tyaw - av.dyaw) * t;
      av.group.position.set(av.dx, av.dy, av.dz);
      av.group.rotation.y = av.dyaw;
      av.group.visible = !r.dead && r.info.mode !== 'spectator';

      // Health bar
      const showHealth = id === this.hovered && av.group.visible;
      av.healthSprite.visible = showHealth;
      if (showHealth && av.lastHealth !== r.health) {
        const remoteMax = Number.isFinite(r.info.hearts) && r.info.hearts > 0
          ? r.info.hearts * 2 : REMOTE_MAX_HEALTH;
        drawHealthBar(av.healthCanvas, Math.min(1, r.health / remoteMax));
        av.healthTex.needsUpdate = true;
        av.lastHealth = r.health;
      }

      // ── Pose / animation ──── parts = [leftLeg, rightLeg, leftArm, rightArm] ─
      if (r.gliding) {
        // Body tilts forward like a hang-glider; arms swept forward like wings.
        av.group.rotation.x = 1.05;
        av.parts[0].rotation.x = 0.2;  // legs trail together behind
        av.parts[1].rotation.x = 0.2;
        av.parts[2].rotation.x = 1.2;  // arms out front holding the glider bar
        av.parts[3].rotation.x = 1.2;
        av.head.rotation.x = -0.9;     // head up to look forward despite the tilt
      } else {
        av.group.rotation.x = 0;
        av.head.rotation.x = 0;

        // Walk/idle animation based on horizontal movement speed.
        const hspeed = Math.hypot(av.dx - av.lastX, av.dz - av.lastZ) / Math.max(dt, 1e-4);
        av.lastX = av.dx; av.lastZ = av.dz;
        av.walkPhase += Math.min(hspeed, 7) * dt * 2.4;

        // Amplitude scales from 0 (idle) → ~0.8 (full run). Legs alternate;
        // arms counter-swing (opposite phase) like a real stride.
        const amp = Math.sin(av.walkPhase) * Math.min(1, hspeed / 4.5) * 0.8;
        av.parts[0].rotation.x =  amp;   // left leg forward
        av.parts[1].rotation.x = -amp;   // right leg back
        av.parts[2].rotation.x = -amp;   // left arm back
        av.parts[3].rotation.x =  amp;   // right arm forward
      }
    }
  }

  /** Id of a living avatar whose body contains the point, else -1. */
  avatarAtPoint(p: THREE.Vector3): number {
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead) continue;
      if (p.x >= av.dx - 0.35 && p.x <= av.dx + 0.35 &&
          p.y >= av.dy         && p.y <= av.dy + 2.0 &&
          p.z >= av.dz - 0.35 && p.z <= av.dz + 0.35) return id;
    }
    return -1;
  }

  /** Nearest living avatar hit by the ray within maxDist, else -1. */
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let best = -1, bestT = maxDist;
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead) continue;
      const min = new THREE.Vector3(av.dx - 0.35, av.dy,        av.dz - 0.35);
      const max = new THREE.Vector3(av.dx + 0.35, av.dy + 2.0, av.dz + 0.35);
      const tHit = rayBox(origin, dir, min, max);
      if (tHit !== null && tHit < bestT) { bestT = tHit; best = id; }
    }
    return best;
  }

  /** Force one avatar to rebuild (e.g. spy disguise changed faction). */
  invalidate(id: number): void {
    const av = this.avatars.get(id);
    if (av) { this.dispose(av); this.avatars.delete(id); }
  }

  private dispose(av: Avatar): void {
    this.scene.remove(av.group);
    av.group.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) return; // shared sprite geo — don't dispose
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    av.material.dispose();
    av.nameTex.dispose();
    (av.sprite.material as THREE.SpriteMaterial).dispose();
    av.healthTex.dispose();
    (av.healthSprite.material as THREE.SpriteMaterial).dispose();
  }
}

// ─── utility ──────────────────────────────────────────────────────────────

function wrap(a: number): number {
  while (a >  Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function rayBox(
  origin: THREE.Vector3, dir: THREE.Vector3,
  min: THREE.Vector3,   max: THREE.Vector3
): number | null {
  let tmin = 0, tmax = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    const d = dir[k];
    if (Math.abs(d) < 1e-9) {
      if (origin[k] < min[k] || origin[k] > max[k]) return null;
      continue;
    }
    let t1 = (min[k] - origin[k]) / d, t2 = (max[k] - origin[k]) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
