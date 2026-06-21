// Renders other players as boxy, Minecraft-style humanoid avatars with
// per-username procedural skins and floating name tags. Positions are
// interpolated toward the latest networked transform. Also provides a ray
// test against avatars for PvP targeting.

import * as THREE from 'three';
import type { NetClient, Remote } from './net/client';
import { mulberry32 } from './noise';

const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8]; // +x -x +y -y +z -z

interface Avatar {
  group: THREE.Group;
  parts: THREE.Object3D[]; // [leftLeg, rightLeg, leftArm, rightArm]
  material: THREE.MeshBasicMaterial;
  nameTex: THREE.CanvasTexture;
  sprite: THREE.Sprite;
  dx: number; dy: number; dz: number; dyaw: number;
  walkPhase: number;
  lastX: number; lastZ: number;
}

function shadedBox(
  w: number, h: number, d: number, color: THREE.Color
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let f = 0; f < 6; f++) {
    const s = FACE_SHADE[f];
    for (let v = 0; v < 4; v++) {
      const k = f * 4 + v;
      colors[k * 3] = color.r * s;
      colors[k * 3 + 1] = color.g * s;
      colors[k * 3 + 2] = color.b * s;
    }
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

/** Part pivoted at its top so it swings like a limb. */
function limb(
  mat: THREE.Material, w: number, h: number, d: number,
  color: THREE.Color, x: number, y: number, z: number
): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(shadedBox(w, h, d, color), mat);
  mesh.position.y = -h / 2;
  g.add(mesh);
  g.position.set(x, y, z);
  return g;
}

export class RemotePlayers {
  private readonly scene: THREE.Scene;
  private readonly net: NetClient;
  private readonly avatars = new Map<number, Avatar>();

  constructor(scene: THREE.Scene, net: NetClient) {
    this.scene = scene;
    this.net = net;
  }

  private build(remote: Remote): Avatar {
    const rng = mulberry32(remote.info.skin);
    const skin = new THREE.Color().setHSL(0.06 + rng() * 0.06, 0.5, 0.45 + rng() * 0.2);
    const shirt = new THREE.Color().setHSL(rng(), 0.6, 0.5);
    const pants = new THREE.Color().setHSL(rng(), 0.5, 0.35);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });

    const group = new THREE.Group();
    // body + head (fixed); legs + arms (swinging).
    const body = new THREE.Mesh(shadedBox(0.5, 0.7, 0.26, shirt), mat);
    body.position.y = 1.15;
    group.add(body);
    const head = new THREE.Mesh(shadedBox(0.5, 0.5, 0.5, skin), mat);
    head.position.y = 1.75;
    group.add(head);
    // eyes on the forward (-z) face so you can read which way they look.
    const eyeGeo = shadedBox(0.1, 0.1, 0.05, new THREE.Color(0x101018));
    for (const ex of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(eyeGeo, mat);
      eye.position.set(ex, 1.8, -0.255);
      group.add(eye);
    }
    const ll = limb(mat, 0.24, 0.75, 0.24, pants, -0.13, 0.75, 0);
    const rl = limb(mat, 0.24, 0.75, 0.24, pants, 0.13, 0.75, 0);
    const la = limb(mat, 0.2, 0.7, 0.2, shirt, -0.35, 1.45, 0);
    const ra = limb(mat, 0.2, 0.7, 0.2, shirt, 0.35, 1.45, 0);
    group.add(ll, rl, la, ra);

    const { tex, sprite } = this.makeNameTag(remote.info.username);
    sprite.position.y = 2.25;
    group.add(sprite);

    this.scene.add(group);
    return {
      group, parts: [ll, rl, la, ra], material: mat, nameTex: tex, sprite,
      dx: remote.tx, dy: remote.ty, dz: remote.tz, dyaw: remote.tyaw,
      walkPhase: 0, lastX: remote.tx, lastZ: remote.tz,
    };
  }

  private makeNameTag(name: string): { tex: THREE.CanvasTexture; sprite: THREE.Sprite } {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 14, 256, 36);
    ctx.font = 'bold 26px Lucida Console, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(name, 128, 33);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false,
    }));
    sprite.scale.set(1.6, 0.4, 1);
    sprite.renderOrder = 50;
    return { tex, sprite };
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
      av.group.visible = !r.dead;

      // Walk animation from horizontal movement.
      const speed = Math.hypot(av.dx - av.lastX, av.dz - av.lastZ) / Math.max(dt, 1e-3);
      av.lastX = av.dx; av.lastZ = av.dz;
      av.walkPhase += Math.min(speed, 6) * dt * 2.2;
      const swing = Math.sin(av.walkPhase) * Math.min(1, speed / 4) * 0.7;
      av.parts[0].rotation.x = swing;   // legs + arms counter-swing
      av.parts[1].rotation.x = -swing;
      av.parts[2].rotation.x = -swing;
      av.parts[3].rotation.x = swing;
    }
  }

  /** Id of a living avatar whose body contains the point, else -1 (projectile
   *  point-collision; uses the same AABB as the ray test). */
  avatarAtPoint(p: THREE.Vector3): number {
    for (const [id, av] of this.avatars) {
      const r = this.net.remotes.get(id);
      if (!r || r.dead) continue;
      if (p.x >= av.dx - 0.35 && p.x <= av.dx + 0.35 &&
        p.y >= av.dy && p.y <= av.dy + 1.95 &&
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
      const min = new THREE.Vector3(av.dx - 0.35, av.dy, av.dz - 0.35);
      const max = new THREE.Vector3(av.dx + 0.35, av.dy + 1.95, av.dz + 0.35);
      const tHit = rayBox(origin, dir, min, max);
      if (tHit !== null && tHit < bestT) { bestT = tHit; best = id; }
    }
    return best;
  }

  private dispose(av: Avatar): void {
    this.scene.remove(av.group);
    av.group.traverse((o) => {
      // Skip the name-tag Sprite: it shares THREE's singleton sprite
      // geometry, so disposing it would corrupt every other sprite.
      if ((o as THREE.Sprite).isSprite) return;
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    av.material.dispose();
    av.nameTex.dispose();
    (av.sprite.material as THREE.SpriteMaterial).dispose();
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function rayBox(
  origin: THREE.Vector3, dir: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3
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
