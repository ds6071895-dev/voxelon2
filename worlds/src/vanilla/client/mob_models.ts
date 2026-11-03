// Mob models and animation for the vanilla modes (Lucky Pillars spawn eggs,
// Disaster City's zombie hordes, Party Games' sheep and maze husks).
//
// Models are boxes in Minecraft's own proportions (1px = 1/16 block), facing
// −z, with pixel-texture multipliers from mob_textures.ts over each palette
// colour. Every mob owns a handful of materials (one per surface), so the hurt
// flash, creeper fuse flash and death tint recolour the whole body at once.

import * as THREE from 'three';
import { box, joint, glowOf } from '../../model_primitives';
import { ENT_FLAG, type EntityView } from '../messages';
import { mobTexture, type MobSurface } from './mob_textures';

type Surf = MobSurface | 'plain';

export interface MobRig {
  id: number; kind: string; group: THREE.Group;
  yaw: number; flags: number; age: number;
  legs: THREE.Object3D[]; arms: THREE.Object3D[]; head?: THREE.Object3D; walk: number;
  hurtUntil: number;
  root?: THREE.Object3D; tail?: THREE.Object3D; bow?: THREE.Object3D; wings?: THREE.Object3D[]; segs?: THREE.Object3D[];
  mats?: Map<string, THREE.MeshBasicMaterial>;
  eyes?: THREE.MeshBasicMaterial;
  swingAt?: number; aimUntil?: number; dying?: number; baby?: boolean;
  glow?: { set(on: boolean): void; dispose(): void };
  flames?: THREE.Group; flash?: THREE.Mesh[]; tintKey?: string; grazeAt?: number; vy?: number;
}

export const MOB_KINDS: ReadonlySet<string> = new Set(['zombie', 'husk', 'skeleton', 'creeper', 'silverfish', 'wolf', 'sheep', 'chicken']);

const PX = 1 / 16;
/** The creeper's white blink: a translucent white shell over every part (shared, never disposed). */
const FLASH_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5, depthWrite: false });

/** Build a mob into `v.group`. */
export function buildMob(v: MobRig, e: EntityView): void {
  v.mats = new Map();
  v.baby = !!(e.flags & ENT_FLAG.baby);
  const mat = (surf: Surf, key: string = surf): THREE.MeshBasicMaterial => {
    let m = v.mats!.get(key);
    if (!m) { m = new THREE.MeshBasicMaterial({ vertexColors: true, map: surf === 'plain' ? null : mobTexture(surf) }); v.mats!.set(key, m); }
    return m;
  };
  const part = (parent: THREE.Object3D, w: number, h: number, d: number, color: number, x: number, y: number, z: number, surf: Surf = 'plain', key?: string): THREE.Mesh => {
    const m = box(parent, w, h, d, color, x, y, z, mat(surf, key));
    m.userData.ownGeo = true;
    return m;
  };
  const root = joint(v.group, 0, 0, 0);
  v.root = root;
  if (v.baby) root.scale.setScalar(.5);
  const babyHead = (h: THREE.Object3D) => { if (v.baby) h.scale.setScalar(1.5); };

  switch (e.kind) {
    case 'zombie': case 'husk': {
      const husk = e.kind === 'husk';
      if (husk) root.scale.multiplyScalar(1.0625);
      const skin = husk ? 0xb59c6c : 0x6b9e57, skinDark = husk ? 0x8f7a52 : 0x4c7a3e;
      const shirt = husk ? 0x7a6644 : 0x2f8f9a, pants = husk ? 0x55452f : 0x3b3f8f;
      const flesh: Surf = husk ? 'dry' : 'flesh';
      for (const x of [-2 * PX, 2 * PX]) {
        const l = joint(root, x, 12 * PX, 0);
        part(l, 4 * PX, 12 * PX, 4 * PX, pants, 0, -6 * PX, 0, 'denim');
        part(l, 4.1 * PX, 2 * PX, 4.1 * PX, skinDark, 0, -11 * PX, 0, flesh);
        v.legs.push(l);
      }
      part(root, 8 * PX, 12 * PX, 4 * PX, shirt, 0, 18 * PX, 0, 'cloth');
      for (const x of [-6 * PX, 6 * PX]) {
        const a = joint(root, x, 22 * PX, 0);
        part(a, 4 * PX, 12 * PX, 4 * PX, skin, 0, -4 * PX, 0, flesh);
        part(a, 4.3 * PX, 4 * PX, 4.3 * PX, shirt, 0, 0, 0, 'cloth');
        v.arms.push(a);
      }
      const h = joint(root, 0, 24 * PX, 0); v.head = h; babyHead(h);
      part(h, 8 * PX, 8 * PX, 8 * PX, skin, 0, 4 * PX, 0, flesh);
      if (!husk) part(h, 8.3 * PX, 2 * PX, 8.3 * PX, 0x3a5e30, 0, 7.2 * PX, 0, 'fur');
      // Face: a heavy brow, sunken dark eyes with a dull glint, a nose and a slack mouth.
      const z = -4 * PX - .006;
      part(h, 8.1 * PX, 1 * PX, .02, skinDark, 0, 5.5 * PX, z, flesh);
      for (const sx of [-1, 1]) {
        part(h, 2 * PX, 1.2 * PX, .02, husk ? 0x2a1d10 : 0x101a0c, sx * 2 * PX, 4.4 * PX, z - .002);
        part(h, .8 * PX, .6 * PX, .02, husk ? 0x6a5430 : 0x3c6a34, sx * 1.6 * PX, 4.5 * PX, z - .004);
      }
      part(h, 2 * PX, 1.4 * PX, .03, skinDark, 0, 3.2 * PX, z - .004, flesh);
      part(h, 4 * PX, .8 * PX, .02, husk ? 0x3a2a18 : 0x24361e, 0, 1.6 * PX, z - .002);
      return;
    }
    case 'skeleton': {
      const bone = 0xd9d9d0, boneDark = 0xa9a99f;
      for (const x of [-2 * PX, 2 * PX]) {
        const l = joint(root, x, 12 * PX, 0);
        part(l, 2 * PX, 12 * PX, 2 * PX, bone, 0, -6 * PX, 0, 'bone');
        part(l, 2.6 * PX, 1.4 * PX, 2.6 * PX, boneDark, 0, -6 * PX, 0, 'bone');
        v.legs.push(l);
      }
      // Pelvis, spine and ribcage instead of a solid torso.
      part(root, 7 * PX, 1.6 * PX, 3 * PX, bone, 0, 12.8 * PX, 0, 'bone');
      part(root, 1.6 * PX, 12 * PX, 1.6 * PX, boneDark, 0, 18 * PX, 1 * PX, 'bone');
      for (const y of [16, 18.4, 20.8]) part(root, 8 * PX, 1.4 * PX, 4 * PX, bone, 0, y * PX, 0, 'bone');
      part(root, 8.2 * PX, 1.6 * PX, 3 * PX, bone, 0, 23 * PX, 0, 'bone');
      for (const x of [-5 * PX, 5 * PX]) {
        const a = joint(root, x, 22 * PX, 0);
        part(a, 2 * PX, 12 * PX, 2 * PX, bone, 0, -5 * PX, 0, 'bone');
        part(a, 2.5 * PX, 1.4 * PX, 2.5 * PX, boneDark, 0, -5 * PX, 0, 'bone');
        v.arms.push(a);
      }
      // A recurve bow in the right hand; its limbs run along the arm's z so it
      // stands upright when the arm is raised to aim, string toward the shoulder.
      const bowAt = joint(v.arms[1], 0, -10.5 * PX, 0); v.bow = bowAt;
      // Limbs follow y = c·z² (tips curl toward the string), one box per chord.
      const wood = 0x7a5530, arc = (z: number) => .05 * z * z;
      const zs = [-7.5, -6, -4, -2, 0, 2, 4, 6, 7.5];
      for (let i = 0; i + 1 < zs.length; i++) {
        const z0 = zs[i], z1 = zs[i + 1], dy = arc(z1) - arc(z0), dz = z1 - z0;
        const seg = part(bowAt, 1 * PX, 1 * PX, (Math.hypot(dy, dz) + .4) * PX, wood, 0, (arc(z0) + arc(z1)) / 2 * PX, (z0 + z1) / 2 * PX, 'wood');
        seg.rotation.x = -Math.atan2(dy, dz);
      }
      part(bowAt, 1.5 * PX, 1.5 * PX, 3 * PX, 0x4a3420, 0, 0, 0, 'wood');
      part(bowAt, .3 * PX, .3 * PX, 15 * PX, 0xeeeeea, 0, arc(7.5) * PX, 0);
      const h = joint(root, 0, 24 * PX, 0); v.head = h; babyHead(h);
      part(h, 8 * PX, 8 * PX, 8 * PX, bone, 0, 4 * PX, 0, 'bone');
      const z = -4 * PX - .006;
      for (const sx of [-1, 1]) part(h, 2 * PX, 2 * PX, .02, 0x1a1a1a, sx * 2 * PX, 4 * PX, z);
      part(h, 1 * PX, 1 * PX, .02, 0x2a2a2a, 0, 2.5 * PX, z);
      part(h, 5 * PX, 1 * PX, .02, 0x262626, 0, 1 * PX, z);
      for (const x of [-1.5, 0, 1.5]) part(h, .6 * PX, 1 * PX, .022, bone, x * PX, 1 * PX, z - .002);
      return;
    }
    case 'creeper': {
      const green = 0x5db04a;
      for (const [x, z] of [[-2, -4], [2, -4], [-2, 4], [2, 4]]) {
        const l = joint(root, x * PX, 6 * PX, z * PX);
        part(l, 4 * PX, 6 * PX, 4 * PX, 0x4f9a3a, 0, -3 * PX, 0, 'creeper');
        v.legs.push(l);
      }
      part(root, 8 * PX, 12 * PX, 4 * PX, green, 0, 12 * PX, 0, 'creeper');
      const h = joint(root, 0, 18 * PX, 0); v.head = h; babyHead(h);
      part(h, 8 * PX, 8 * PX, 8 * PX, 0x66bd52, 0, 4 * PX, 0, 'creeper');
      if (e.flags & ENT_FLAG.charged) {
        const aura = new THREE.Mesh(new THREE.BoxGeometry(9.5 * PX, 27 * PX, 6 * PX), new THREE.MeshBasicMaterial({ color: 0x7ac8ff, transparent: true, opacity: .25, depthWrite: false, blending: THREE.AdditiveBlending }));
        aura.position.y = 13 * PX; aura.userData.ownGeo = true; aura.userData.ownMat = true; root.add(aura);
      }
      // The face, pixel for pixel: 2x2 eyes, a mouth that widens and splits at the chin.
      const face = 0x0f1a0e, z = -4 * PX - .006, fx = (c: number) => -4 * PX + c * PX, fy = (r: number) => 8 * PX - r * PX;
      for (const c of [1, 5]) part(h, 2 * PX, 2 * PX, .02, face, fx(c + 1), fy(3), z);
      part(h, 2 * PX, 1 * PX, .02, face, fx(4), fy(4.5), z);
      part(h, 4 * PX, 2 * PX, .02, face, fx(4), fy(6), z);
      for (const c of [2, 5]) part(h, 1 * PX, 1 * PX, .02, face, fx(c + .5), fy(7.5), z);
      const meshes: THREE.Mesh[] = [];
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'BoxGeometry' && o.parent) meshes.push(o as THREE.Mesh); });
      v.flash = meshes.map((m) => {
        const c = new THREE.Mesh(m.geometry, FLASH_MAT);
        c.position.copy(m.position); c.quaternion.copy(m.quaternion); c.scale.copy(m.scale).multiplyScalar(1.02);
        c.visible = false; c.renderOrder = 3; m.parent!.add(c);
        return c;
      });
      return;
    }
    case 'silverfish': {
      // Seven plates tapering from a broad middle; the body slithers by bending each.
      const grey = 0x8b9098, sizes = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [5, 3, 2], [4, 3, 2], [3, 2, 1], [2, 1, 2]];
      v.segs = [];
      let z = -5 * PX;
      sizes.forEach(([w, h, d], i) => {
        const s = joint(root, 0, 0, z + d * PX / 2);
        part(s, w * PX, h * PX, d * PX, i === 0 ? 0x9da2aa : grey, 0, h * PX / 2, 0, 'shell');
        if (i >= 1 && i <= 3) for (const sx of [-1, 1]) { const l = joint(s, sx * w * PX / 2, .6 * PX, 0); part(l, 1.5 * PX, .6 * PX, .6 * PX, 0x4c5056, sx * .6 * PX, 0, 0); v.legs.push(l); }
        if (i === 0) { for (const sx of [-1, 1]) part(s, .4 * PX, .4 * PX, 2.4 * PX, 0x5a5e66, sx * 1 * PX, 1.6 * PX, -1.6 * PX); for (const sx of [-1, 1]) part(s, .5 * PX, .5 * PX, .02, 0x111111, sx * 1 * PX, 1.2 * PX, -1 * PX - .006); }
        if (i === 2 || i === 4) part(s, (w - 1) * PX, .8 * PX, (d - .4) * PX, 0x7a7f87, 0, (h + .4) * PX, 0, 'shell');
        v.segs!.push(s);
        z += d * PX;
      });
      return;
    }
    case 'wolf': {
      const tamed = !!(e.flags & ENT_FLAG.tamed);
      const fur = 0xd8d4ce, back = 0xb9b3ab, light = 0xe9e6e1;
      for (const [x, z] of [[-1.5, -4], [1.5, -4], [-1.5, 5], [1.5, 5]]) {
        const l = joint(root, x * PX, 8 * PX, z * PX);
        part(l, 2 * PX, 8 * PX, 2 * PX, fur, 0, -4 * PX, 0, 'fur');
        part(l, 2.2 * PX, 1 * PX, 2.4 * PX, back, 0, -7.5 * PX, -.2 * PX, 'fur');
        v.legs.push(l);
      }
      part(root, 6 * PX, 6 * PX, 9 * PX, fur, 0, 10 * PX, 2.5 * PX, 'fur');
      part(root, 6.2 * PX, 1.4 * PX, 8 * PX, back, 0, 13.2 * PX, 3 * PX, 'fur');
      part(root, 8 * PX, 7 * PX, 6 * PX, light, 0, 10.5 * PX, -3 * PX, 'fur');
      if (tamed) part(root, 8.4 * PX, 1.4 * PX, 6.4 * PX, 0xc23030, 0, 11 * PX, -3.6 * PX, 'cloth');
      const t = joint(root, 0, 12 * PX, 7 * PX); v.tail = t;
      part(t, 2 * PX, 8 * PX, 2 * PX, fur, 0, -3.5 * PX, 0, 'fur');
      part(t, 2.2 * PX, 2 * PX, 2.2 * PX, light, 0, -7 * PX, 0, 'fur');
      const h = joint(root, 0, 11.5 * PX, -6 * PX); v.head = h; babyHead(h);
      part(h, 6 * PX, 6 * PX, 4 * PX, fur, 0, 0, -2 * PX, 'fur');
      part(h, 3 * PX, 3 * PX, 4 * PX, light, 0, -1.5 * PX, -6 * PX, 'fur');
      part(h, 1.4 * PX, 1 * PX, 1 * PX, 0x1a1614, 0, -.2 * PX, -8 * PX);
      part(h, 2 * PX, .5 * PX, .02, 0x3a2a26, 0, -2.6 * PX, -8 * PX - .006);
      for (const sx of [-1, 1]) {
        part(h, 2 * PX, 2 * PX, 1 * PX, back, sx * 2 * PX, 4 * PX, -1.5 * PX, 'fur');
        part(h, 1.2 * PX, 1.2 * PX, .02, 0x6a5040, sx * 2 * PX, 3.8 * PX, -2 * PX - .006);
      }
      const eyes = new THREE.MeshBasicMaterial({ color: 0x1a1414 }); v.eyes = eyes;
      for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1 * PX, 1 * PX, .02), eyes); m.position.set(sx * 1.5 * PX, 1 * PX, -4 * PX - .006); m.userData.ownGeo = true; h.add(m); }
      return;
    }
    case 'sheep': {
      // A fleece with some loft (core + crown + rump tufts), wool sleeves on the
      // legs, and a proper face: pale muzzle under a wool cap, ears, eyes, nose.
      const wool = e.color ?? 0xf2f2f0;
      const shade = new THREE.Color(wool).multiplyScalar(.86).getHex();
      const skin = 0xcdb9a4, face = 0xe6d6c4;
      for (const [x, z] of [[-.19, -.32], [.19, -.32], [-.19, .32], [.19, .32]]) {
        const l = joint(root, x, .52, z);
        part(l, .14, .52, .14, skin, 0, -.26, 0, 'fur');
        part(l, .2, .2, .2, shade, 0, -.08, 0, 'wool');
        part(l, .15, .05, .15, 0x4a3c30, 0, -.5, 0, 'hoof');
        v.legs.push(l);
      }
      part(root, .74, .58, 1.02, wool, 0, .83, 0, 'wool');
      part(root, .62, .1, .86, wool, 0, 1.15, .02, 'wool');
      part(root, .8, .38, .7, shade, 0, .8, .06, 'wool');
      part(root, .56, .42, .14, wool, 0, .86, .54, 'wool');
      part(root, .1, .1, .1, wool, 0, 1.02, .6, 'wool');
      const h = joint(root, 0, 1.02, -.56); v.head = h; babyHead(h);
      part(h, .32, .32, .36, face, 0, -.04, -.14, 'fur');
      part(h, .4, .16, .3, wool, 0, .14, -.06, 'wool');
      part(h, .36, .2, .1, wool, 0, .04, .06, 'wool');
      for (const sx of [-1, 1]) {
        part(h, .14, .06, .09, skin, sx * .24, .04, -.06, 'fur');
        part(h, .07, .07, .02, 0xffffff, sx * .09, .02, -.32);
        part(h, .04, .05, .02, 0x1a1410, sx * .1, .015, -.335);
      }
      part(h, .12, .06, .03, 0xc98e8e, 0, -.12, -.33);
      return;
    }
    case 'chicken': {
      const baby = v.baby;
      const white = baby ? 0xf4dc5a : 0xf6f5f0, wingC = baby ? 0xe6c84a : 0xe6e4dc, orange = 0xe2a030;
      for (const x of [-1.5 * PX, 1.5 * PX]) {
        const l = joint(root, x, 5 * PX, 1 * PX);
        part(l, 1 * PX, 5 * PX, 1 * PX, orange, 0, -2.5 * PX, 0, 'hoof');
        part(l, 3 * PX, .6 * PX, 3 * PX, orange, 0, -4.7 * PX, -.8 * PX, 'hoof');
        v.legs.push(l);
      }
      part(root, 6 * PX, 6 * PX, 8 * PX, white, 0, 8 * PX, 1 * PX, 'feather');
      part(root, 4 * PX, 3 * PX, 1.5 * PX, wingC, 0, 10.5 * PX, 5.6 * PX, 'feather');
      v.wings = [];
      for (const sx of [-1, 1]) {
        const w = joint(root, sx * 3 * PX, 11 * PX, 1 * PX);
        part(w, 1 * PX, 4 * PX, 6 * PX, wingC, sx * .5 * PX, -2 * PX, 0, 'feather');
        v.wings.push(w);
      }
      const h = joint(root, 0, 10 * PX, -3 * PX); v.head = h; babyHead(h);
      part(h, 4 * PX, 6 * PX, 3 * PX, white, 0, 3 * PX, -1 * PX, 'feather');
      part(h, 4 * PX, 2 * PX, 2 * PX, orange, 0, 3.6 * PX, -3.5 * PX, 'hoof');
      if (!baby) {
        part(h, 2 * PX, 2 * PX, 1.4 * PX, 0xc8282a, 0, 1.6 * PX, -3 * PX);
        part(h, 1 * PX, 1.6 * PX, 2.6 * PX, 0xc8282a, 0, 6.6 * PX, -1 * PX);
      }
      for (const sx of [-1, 1]) part(h, .02, 1 * PX, 1 * PX, 0x111111, sx * (2 * PX + .006), 4.5 * PX, -1.8 * PX);
      return;
    }
  }
}

/** Extras that depend on live flags: the glowing outline (golden sheep) and flames. */
export function mobFlags(v: MobRig, flameMat: THREE.Material, coreMat: THREE.Material): void {
  const glowing = !!(v.flags & ENT_FLAG.glowing);
  if (glowing && !v.glow) { v.glow = glowOf(v.root ?? v.group); }
  v.glow?.set(glowing && v.dying === undefined);
  const burning = !!(v.flags & ENT_FLAG.burning);
  if (burning && !v.flames) {
    const f = new THREE.Group(), h = (HEIGHT[v.kind] ?? 1) * (v.baby ? .5 : 1);
    const r = Math.min(.34, h * .3);
    for (let i = 0; i < 8; i++) {
      // A tongue of flame: orange shell around a yellow core, licking upward.
      const m = new THREE.Mesh(new THREE.BoxGeometry(.14, .26, .14), flameMat);
      const core = new THREE.Mesh(new THREE.BoxGeometry(.07, .16, .07), coreMat);
      core.position.y = -.03; core.renderOrder = 1; m.add(core);
      m.position.set(Math.sin(i * 2.4) * r, (i / 8) * h * .85 + .08, Math.cos(i * 2.4) * r);
      m.userData.ownGeo = true; core.userData.ownGeo = true; m.userData.phase = i * 1.7; m.userData.y0 = m.position.y;
      f.add(m);
    }
    v.flames = f; v.group.add(f);
  }
  if (v.flames) v.flames.visible = burning;
}

const HEIGHT: Record<string, number> = { zombie: 1.95, husk: 1.95, skeleton: 1.99, creeper: 1.7, silverfish: .3, wolf: .85, sheep: 1.3, chicken: .7 };

/** Per-frame pose. `speed` is horizontal blocks/s, `now` performance.now(). */
export function animateMob(v: MobRig, dt: number, speed: number, now: number): void {
  const moving = Math.min(1, speed / 2);
  v.walk += dt * Math.min(speed, 6) * (v.kind === 'chicken' || v.kind === 'silverfish' ? 4 : 2.6);
  const swing = Math.sin(v.walk) * moving * .8;
  const t = v.age, idle = 1 - moving;

  // Death: the body tips onto its side over half a second (vanilla's fall-over).
  if (v.dying !== undefined) {
    v.group.rotation.z = -Math.min(1, v.dying / .5) * Math.PI / 2;
    v.legs.forEach((l) => { l.rotation.x *= .9; });
  } else {
    const dy = ((v.yaw - v.group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    v.group.rotation.y += dy * Math.min(1, dt * 10);
  }

  const quad = v.kind === 'creeper' || v.kind === 'wolf' || v.kind === 'sheep';
  if (quad) v.legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? swing : -swing) * (v.kind === 'creeper' ? .7 : 1); });
  else if (v.kind !== 'silverfish') v.legs.forEach((l, i) => { l.rotation.x = i % 2 ? swing : -swing; });

  // Heads glance around when idle and lead the body when it turns.
  const lookYaw = Math.sin(t * .55 + v.id) * .45 * idle, lookPitch = Math.sin(t * .4 + v.id * 1.7) * .12 * idle;
  const swungAgo = v.swingAt ? (now - v.swingAt) / 1000 : 99;

  switch (v.kind) {
    case 'zombie': case 'husk': {
      // Arms out front with a slow lurching sway; an attack slaps them down and back up.
      const hit = swungAgo < .35 ? Math.sin(swungAgo / .35 * Math.PI) * .75 : 0;
      v.arms.forEach((a, i) => {
        a.rotation.x = 1.4 + Math.sin(t * 1.6 + i * 1.3) * .07 + (i % 2 ? -swing : swing) * .25 - hit;
        a.rotation.z = (i ? -1 : 1) * (.05 + Math.sin(t * 1.1 + i) * .03);
      });
      if (v.head) { v.head.rotation.y = lookYaw * .6; v.head.rotation.x = .1 + lookPitch + Math.sin(t * 1.7) * .04; v.head.rotation.z = Math.sin(t * .9 + v.id) * .06; }
      if (v.root) v.root.rotation.z = Math.sin(v.walk) * moving * .04;
      break;
    }
    case 'skeleton': {
      // A shot (server swing flag) raises the bow: drawn pose for a moment, then lowered.
      const aiming = (v.aimUntil ?? 0) > now;
      v.arms.forEach((a, i) => {
        if (aiming) {
          a.rotation.x = Math.PI / 2 + (i ? 0 : .08);
          a.rotation.y = i ? -.08 : .4;
          a.rotation.z = 0;
          if (!i && swungAgo < .15) a.rotation.y += .25;
        } else {
          a.rotation.x = (i % 2 ? -swing : swing) * .6 + Math.sin(t * 1.3 + i) * .05;
          a.rotation.y = 0; a.rotation.z = (i ? -1 : 1) * .06;
        }
      });
      if (v.head) { v.head.rotation.y = aiming ? 0 : lookYaw; v.head.rotation.x = aiming ? 0 : lookPitch; }
      // Lowered, the bow hangs along the arm; raised, it stands upright in front.
      if (v.bow) v.bow.rotation.x += ((aiming ? 0 : -Math.PI / 2) - v.bow.rotation.x) * Math.min(1, dt * 14);
      break;
    }
    case 'creeper': {
      if (v.head) { v.head.rotation.y = lookYaw * .5; v.head.rotation.x = lookPitch * .5; }
      const fuse = !!(v.flags & ENT_FLAG.fuse);
      const s = fuse ? 1.08 + Math.sin(t * 22) * .05 : 1;
      if (v.root) { const b = v.baby ? .5 : 1; v.root.scale.set(b * s, b * (fuse ? 1 + (s - 1) * .5 : 1), b * s); }
      break;
    }
    case 'silverfish': {
      v.segs?.forEach((sg, i) => {
        sg.position.x = Math.sin(v.walk * 1.2 - i * .9) * (.03 + moving * .05);
        sg.rotation.y = Math.cos(v.walk * 1.2 - i * .9) * (.1 + moving * .25);
      });
      v.legs.forEach((l, i) => { l.rotation.y = Math.sin(v.walk * 2 + i) * .6 * moving; });
      break;
    }
    case 'wolf': {
      const angry = !!(v.flags & ENT_FLAG.angry), tamed = !!(v.flags & ENT_FLAG.tamed);
      if (v.tail) {
        v.tail.rotation.x = angry ? -1.35 : tamed ? -1.0 : -.55;
        v.tail.rotation.z = Math.sin(t * (tamed && !angry ? 14 : 3)) * (tamed && !angry ? .45 : .12);
      }
      if (v.head) {
        v.head.rotation.y = lookYaw * .7;
        v.head.rotation.x = angry ? .25 : lookPitch;
        v.head.rotation.z = !angry && idle > .9 ? Math.sin(t * .35 + v.id) * .18 : 0;
      }
      if (v.eyes) v.eyes.color.setHex(angry ? 0xd02020 : 0x1a1414);
      break;
    }
    case 'sheep': {
      // Grazing: a standing sheep sometimes dips its head for a couple of seconds.
      if (v.head) {
        if (moving > .2) v.grazeAt = undefined;
        else if (v.grazeAt === undefined && idle > .95 && Math.random() < dt * .12) v.grazeAt = t;
        const g = v.grazeAt !== undefined ? t - v.grazeAt : -1;
        if (g > 2.6) v.grazeAt = undefined;
        const dip = g >= 0 ? Math.min(1, g / .3, (2.6 - g) / .3) : 0;
        v.head.rotation.x = dip * 1.0 + lookPitch * (1 - dip) + (dip > .9 ? Math.sin(t * 9) * .05 : 0);
        v.head.rotation.y = lookYaw * (1 - dip) * .7;
      }
      break;
    }
    case 'chicken': {
      // Wings flutter while falling or hopping; the head bobs back and forth with each step.
      const air = Math.abs(v.vy ?? 0) > .6;
      v.wings?.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * (air ? .6 + Math.sin(t * 40) * .6 : Math.max(0, Math.sin(t * 2 + v.id)) * .05); });
      if (v.head) { v.head.position.z = -3 * PX + Math.sin(v.walk * 2) * moving * .05; v.head.rotation.y = lookYaw; v.head.rotation.x = lookPitch; }
      break;
    }
  }

  if (v.flames?.visible) for (const f of v.flames.children) {
    const ph = f.userData.phase as number;
    const lick = (t * 1.8 + ph) % 1;
    f.position.y = (f.userData.y0 as number) + lick * .25;
    f.scale.setScalar(1 - lick * .7);
    f.rotation.y = t * 3 + ph;
  }

  // One colour for the whole body: red while hurt or dying, white pulses on a lit fuse.
  const hurt = now < v.hurtUntil || v.dying !== undefined;
  const flash = !!(v.flags & ENT_FLAG.fuse) && Math.floor(t * 8) % 2 === 0;
  const key = hurt ? 'h' : 'n';
  if (v.flash) for (const c of v.flash) c.visible = flash && !hurt;
  if (key !== v.tintKey && v.mats) {
    v.tintKey = key;
    for (const m of v.mats.values()) {
      if (hurt) m.color.setRGB(1, .45, .45);
      else m.color.setHex(0xffffff);
    }
  }
}
