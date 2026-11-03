// Draws the vanilla modes' server entities: dropped items, projectiles, primed
// TNT, falling blocks, end crystals, lingering clouds and mobs. Positions come
// from the server at 20 Hz and are eased toward, so motion stays smooth at any
// frame rate. Mob models and their animation live in mob_models.ts.

import * as THREE from 'three';
import { box } from '../../model_primitives';
import { blockCubeGeometry, itemGeometry, itemGeometrySolid } from '../../item_geometry';
import { BLOCKS } from '../../blocks';
import { ITEMS } from '../../items';
import type { Atlas } from '../../textures';
import { ENT_FLAG, type EntityView } from '../messages';
import { MOB_KINDS, animateMob, buildMob, mobFlags, type MobRig } from './mob_models';

interface View extends MobRig {
  target: THREE.Vector3; prev: THREE.Vector3; hp?: number;
  spin: number;
  fuse?: THREE.Mesh; size?: number;
  /** Driven locally (the boat you're sitting in): server moves are ignored. */
  held?: boolean;
}

/** How long a killed mob lies on its side before it vanishes (seconds). */
const DEATH_S = .9;

export class EntityView3D {
  readonly group = new THREE.Group();
  private readonly views = new Map<number, View>();
  private readonly itemMat: THREE.MeshBasicMaterial;
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: .5, depthWrite: false });
  private readonly flameMat = new THREE.MeshBasicMaterial({ color: 0xf2581a, transparent: true, opacity: .85, depthWrite: false });
  private readonly flameCoreMat = new THREE.MeshBasicMaterial({ color: 0xffd24a, depthWrite: false, transparent: true, opacity: .95 });

  constructor(scene: THREE.Scene, private readonly atlas: Atlas) {
    this.group.name = 'vanilla-entities';
    this.itemMat = new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: .4, vertexColors: true, side: THREE.DoubleSide });
    scene.add(this.group);
  }

  apply(msg: { spawn?: EntityView[]; u?: number[]; gone?: number[]; dead?: number[]; reset?: boolean }): void {
    if (msg.reset) this.clear();
    for (const e of msg.spawn ?? []) if (!this.views.has(e.id)) this.add(e);
    const u = msg.u ?? [];
    for (let i = 0; i + 6 < u.length; i += 7) {
      const v = this.views.get(u[i]);
      if (!v || v.held) continue;
      v.prev.copy(v.group.position);
      v.target.set(u[i + 1] / 100, u[i + 2] / 100, u[i + 3] / 100);
      v.yaw = u[i + 4] / 100;
      const now = performance.now();
      if ((u[i + 5] & ENT_FLAG.hurt) && !(v.flags & ENT_FLAG.hurt)) v.hurtUntil = now + 350;
      if ((u[i + 5] & ENT_FLAG.swing) && !(v.flags & ENT_FLAG.swing)) { v.swingAt = now; if (v.kind === 'skeleton') v.aimUntil = now + 1600; }
      v.flags = u[i + 5];
      if (u[i + 6] >= 0) v.hp = u[i + 6];
    }
    // Killed mobs fall over first; everything else just goes.
    for (const id of msg.dead ?? []) { const v = this.views.get(id); if (v && MOB_KINDS.has(v.kind) && v.dying === undefined) v.dying = 0; }
    for (const id of msg.gone ?? []) if (this.views.get(id)?.dying === undefined) this.remove(id);
  }

  /** Pose an entity locally each frame (your own boat), or hand it back to the server (null). */
  hold(id: number, at: { x: number; y: number; z: number; yaw: number } | null): void {
    const v = this.views.get(id);
    if (!v) return;
    v.held = !!at;
    if (!at) return;
    v.group.position.set(at.x, at.y, at.z);
    v.target.copy(v.group.position); v.prev.copy(v.group.position);
    v.yaw = at.yaw; v.group.rotation.y = at.yaw;
  }

  /** Where a lead ties onto an entity (a sheep's neck), in world space. */
  tiePoint(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const v = this.views.get(id);
    if (!v) return null;
    if (v.head) { v.group.updateMatrixWorld(true); return v.head.localToWorld(out.set(0, -.12, .02)); }
    return out.copy(v.group.position).setY(v.group.position.y + .8);
  }

  /** Body positions for client-side aiming (attack rays). */
  hitTargets(): { id: number; x: number; y: number; z: number; w: number; h: number; kind: string }[] {
    const out: { id: number; x: number; y: number; z: number; w: number; h: number; kind: string }[] = [];
    for (const v of this.views.values()) {
      const dims = DIMS[v.kind];
      if (!dims || v.dying !== undefined) continue;
      const s = v.baby ? .5 : 1;
      out.push({ id: v.id, x: v.group.position.x, y: v.group.position.y, z: v.group.position.z, w: dims[0] * s, h: dims[1] * s, kind: v.kind });
    }
    return out;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 18);
    const now = performance.now();
    for (const v of this.views.values()) {
      v.age += dt;
      const before = v.group.position.clone();
      v.group.position.lerp(v.target, k);
      const moved = Math.hypot(v.group.position.x - before.x, v.group.position.z - before.z) / Math.max(dt, 1e-3);
      if (v.kind === 'item') {
        v.spin += dt * 2;
        v.group.rotation.y = v.spin;
        v.group.children[0].position.y = .15 + Math.sin(v.age * 2.4) * .06;
        continue;
      }
      if (MOB_KINDS.has(v.kind)) {
        if (v.dying !== undefined) {
          v.dying += dt;
          if (v.dying >= DEATH_S) { this.remove(v.id); continue; }
        }
        v.vy = (v.group.position.y - before.y) / Math.max(dt, 1e-3);
        mobFlags(v, this.flameMat, this.flameCoreMat);
        // Front is -z, so a positive x rotation raises an arm or leg forward.
        animateMob(v, dt, v.dying !== undefined ? 0 : moved, now);
        continue;
      } else if (v.kind === 'arrow' || v.kind === 'spectral_arrow' || v.kind === 'trident' || v.kind === 'firework') {
        const dir = v.target.clone().sub(v.prev);
        if (dir.lengthSq() > 1e-5) v.group.lookAt(v.group.position.clone().add(dir));
      } else if (v.kind === 'end_crystal') {
        v.group.children[0].rotation.y += dt * 1.8; v.group.children[0].rotation.x += dt * 1.1;
        v.group.children[0].position.y = 1 + Math.sin(v.age * 2) * .2;
      } else if (v.kind === 'display') {
        v.group.rotation.y = v.kind === 'display' && v.group.children[0]?.type === 'Mesh' && (v.group.children[0] as THREE.Mesh).geometry.type === 'CylinderGeometry' ? v.age * 2.5 : v.group.rotation.y;
        if (v.group.children.length === 2 && (v.group.children[0] as THREE.Mesh).geometry?.type === 'BoxGeometry') { v.group.rotation.x += dt * 3; v.group.rotation.z += dt * 2; }
      } else if (v.kind === 'cloud' && v.size) {
        v.group.scale.set(v.size / 3, 1, v.size / 3);
      }
      if (v.fuse) v.fuse.visible = Math.floor(v.age * 6) % 2 === 0;
      const hurt = now < v.hurtUntil;
      if (v.group.userData.hurt !== hurt) {
        v.group.userData.hurt = hurt;
        v.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.userData.ownMat && m.userData.tint !== false && m.material instanceof THREE.MeshBasicMaterial) m.material.color.setHex(hurt ? 0xff8080 : 0xffffff); });
      }
    }
  }

  private add(e: EntityView): void {
    const group = new THREE.Group();
    const v: View = {
      id: e.id, kind: e.kind, group, target: new THREE.Vector3(e.x, e.y, e.z), prev: new THREE.Vector3(e.x, e.y, e.z), yaw: e.yaw,
      flags: e.flags, legs: [], arms: [], walk: 0, spin: Math.random() * 6, age: 0, hurtUntil: 0, size: e.size,
    };
    group.position.set(e.x, e.y, e.z);
    group.rotation.y = e.yaw;
    this.build(v, e);
    this.views.set(e.id, v);
    this.group.add(group);
  }
  private remove(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    v.glow?.dispose();
    for (const m of v.mats?.values() ?? []) m.dispose();
    v.eyes?.dispose();
    v.group.removeFromParent();
    v.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.userData.ownGeo) m.geometry.dispose();
      if (m.userData.ownMat) (m.material as THREE.Material).dispose();
    });
    this.views.delete(id);
  }
  clear(): void { for (const id of [...this.views.keys()]) this.remove(id); }
  dispose(): void { this.clear(); this.itemMat.dispose(); this.glowMat.dispose(); this.flameMat.dispose(); this.flameCoreMat.dispose(); this.group.removeFromParent(); }

  private build(v: View, e: EntityView): void {
    const g = v.group;
    const tinted = (mesh: THREE.Mesh) => { mesh.material = (mesh.material as THREE.Material).clone(); mesh.userData.ownMat = true; return mesh; };
    switch (e.kind) {
      case 'item': {
        const id = e.item?.id ?? 0;
        const block = ITEMS[id]?.kind === 'block' ? BLOCKS[ITEMS[id]!.block!] : null;
        const geo = block && block.shape === 'cube' ? itemGeometry(this.atlas, id) : itemGeometrySolid(this.atlas, id, .42, .05);
        const mesh = new THREE.Mesh(geo, this.itemMat);
        mesh.userData.tint = false;
        mesh.scale.setScalar(block ? .9 : 1);
        g.add(mesh);
        if ((e.item?.count ?? 1) > 1) { const m2 = mesh.clone(); m2.position.set(.08, .05, .06); mesh.add(m2); }
        return;
      }
      case 'tnt': case 'falling_block': {
        const id = e.kind === 'tnt' ? findBlock('TNT') : e.block ?? 0;
        const mesh = new THREE.Mesh(blockCubeGeometry(this.atlas, id), this.itemMat);
        mesh.scale.setScalar(4); mesh.position.y = .5; mesh.userData.tint = false;
        g.add(mesh);
        if (e.kind === 'tnt') {
          v.fuse = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .45, depthWrite: false }));
          v.fuse.position.y = .5; v.fuse.userData.ownGeo = true; v.fuse.userData.ownMat = true; v.fuse.userData.tint = false;
          g.add(v.fuse);
        }
        return;
      }
      case 'arrow': case 'spectral_arrow': {
        const shaft = box(g, .04, .04, .7, e.kind === 'spectral_arrow' ? 0xc89a30 : 0x8b6334, 0, 0, 0);
        box(shaft, .1, .1, .12, 0x9ca1a6, 0, 0, -.38);
        box(shaft, .12, .02, .14, 0xe8ecef, 0, 0, .3);
        return;
      }
      case 'trident': {
        const shaft = box(g, .05, .05, 1.2, 0x3a8a88, 0, 0, 0);
        box(shaft, .3, .05, .05, 0x5ab0aa, 0, 0, -.55); box(shaft, .05, .05, .25, 0x8ad8cf, .13, 0, -.65); box(shaft, .05, .05, .25, 0x8ad8cf, -.13, 0, -.65);
        return;
      }
      case 'snowball': case 'egg': case 'ender_pearl': case 'wind_charge': case 'potion': case 'fireball': case 'firework': case 'bobber': {
        const color = e.kind === 'snowball' ? 0xf2f6fa : e.kind === 'egg' ? 0xece0c8 : e.kind === 'ender_pearl' ? 0x2a8a7a : e.kind === 'wind_charge' ? 0xc8dceb
          : e.kind === 'potion' ? (e.color ?? 0x5a7ad0) : e.kind === 'fireball' ? 0xff8a2a : e.kind === 'firework' ? 0xc23030 : 0xe8e8e8;
        const size = e.kind === 'fireball' ? .9 : e.kind === 'bobber' ? .14 : .22;
        const m = new THREE.Mesh(new THREE.SphereGeometry(size / 2, 8, 6), new THREE.MeshBasicMaterial({ color }));
        m.userData.ownGeo = true; m.userData.ownMat = true; m.userData.tint = false;
        g.add(m);
        return;
      }
      case 'end_crystal': {
        const inner = new THREE.Group(); inner.position.y = 1; g.add(inner);
        tinted(box(inner, .7, .7, .7, 0xf0b0f8, 0, 0, 0));
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
        frame.userData.ownGeo = true; frame.userData.ownMat = true; inner.add(frame);
        box(g, 1.6, .4, 1.6, 0x2b2d33, 0, .2, 0);
        return;
      }
      case 'cloud': {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, .08, 24), new THREE.MeshBasicMaterial({ color: e.color ?? 0x87a363, transparent: true, opacity: .35, depthWrite: false }));
        m.position.y = .1; m.userData.ownGeo = true; m.userData.ownMat = true; m.userData.tint = false;
        g.add(m);
        return;
      }
      case 'zombie': case 'husk': case 'skeleton': case 'creeper': case 'silverfish': case 'wolf': case 'sheep': case 'chicken':
        buildMob(v, e);
        return;
      case 'boat': {
        // An open oak hull, long along its heading (−z), with a bench and paddles.
        const wood = 0x9c7445, dark = 0x7a5a34;
        tinted(box(g, 1.0, .1, 1.5, dark, 0, .08, 0));
        for (const x of [-.5, .5]) tinted(box(g, .1, .36, 1.5, wood, x, .3, 0));
        for (const z of [-.75, .75]) tinted(box(g, 1.1, .36, .1, wood, 0, .3, z));
        tinted(box(g, .9, .06, .26, dark, 0, .3, .2));
        for (const x of [-.62, .62]) tinted(box(g, .06, .06, 1.0, 0x6b4a2a, x, .46, .05));
        return;
      }
      case 'minecart': {
        tinted(box(g, .9, .1, .9, 0x3e424a, 0, .1, 0));
        for (const x of [-.45,.45]) tinted(box(g,.08,.5,.98,0x737b86,x,.35,0));
        for (const z of [-.45,.45]) tinted(box(g,.98,.5,.08,0x737b86,0,.35,z));
        for (const x of [-.32,.32]) for (const z of [-.3,.3]) tinted(box(g,.14,.14,.2,0x272b32,x,.05,z));
        return;
      }
      case 'display': {
        const own = (m: THREE.Mesh) => { m.userData.ownGeo = true; m.userData.ownMat = true; m.userData.tint = false; return m; };
        if (e.variant === 'coin') {
          const mesh = own(new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .1, 16), new THREE.MeshBasicMaterial({ color: 0xf3c653 })));
          mesh.rotation.x = Math.PI / 2;
          g.add(mesh);
        } else if (e.variant === 'key') {
          const ring = own(new THREE.Mesh(new THREE.TorusGeometry(.18, .06, 6, 16), new THREE.MeshBasicMaterial({ color: 0xf3c653 })));
          g.add(ring);
          for (const [w,h,x,y] of [[.09,.5,0,-.35],[.2,.09,.06,-.48],[.2,.09,.06,-.32]]) {
            const part = own(new THREE.Mesh(new THREE.BoxGeometry(w,h,.09), new THREE.MeshBasicMaterial({ color: 0xf3c653 })));
            part.position.set(x,y,0);g.add(part);
          }
        } else if (e.variant === 'anvil') {
          const mat = new THREE.MeshBasicMaterial({ color: 0x777d86, transparent: true, opacity: .75 });
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(.9,.75,.65), mat);
          mesh.position.y=.375; g.add(own(mesh));
        } else if (e.variant === 'meteor') {
          const s = e.size ?? 2;
          g.add(own(new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshBasicMaterial({ color: 0xff7a1a }))));
          g.add(own(new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s * 1.5, s * 1.5), new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: .25, depthWrite: false }))));
        } else if (e.variant === 'tornado') {
          const cone = own(new THREE.Mesh(new THREE.CylinderGeometry(8.3, .8, 34, 18, 6, true), new THREE.MeshBasicMaterial({ color: 0x8a8f96, transparent: true, opacity: .42, side: THREE.DoubleSide, depthWrite: false })));
          cone.position.y = 17;
          g.add(cone);
          const inner = own(new THREE.Mesh(new THREE.CylinderGeometry(5.5, .5, 30, 14, 4, true), new THREE.MeshBasicMaterial({ color: 0x5f646b, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false })));
          inner.position.y = 15;
          g.add(inner);
        } else if (e.variant === 'tsunami') {
          const wave = new THREE.Group();
          wave.rotation.y = e.yaw;
          const body = own(new THREE.Mesh(new THREE.BoxGeometry(120, 11, 8), new THREE.MeshBasicMaterial({ color: 0x2a6fd0, transparent: true, opacity: .72, depthWrite: false })));
          body.position.set(0, 5.5, -4);
          const crest = own(new THREE.Mesh(new THREE.BoxGeometry(120, 1.4, 4), new THREE.MeshBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: .9 })));
          crest.position.set(0, 11, -1);
          const slope = own(new THREE.Mesh(new THREE.BoxGeometry(120, 1.2, 14), new THREE.MeshBasicMaterial({ color: 0x5fa8ec, transparent: true, opacity: .6, depthWrite: false })));
          slope.position.set(0, 4, -12); slope.rotation.x = .5;
          wave.add(body, crest, slope);
          g.add(wave);
        }
        return;
      }
      default: {
        const m = new THREE.Mesh(new THREE.BoxGeometry(.4, .4, .4), this.glowMat);
        m.userData.ownGeo = true; m.userData.tint = false; g.add(m);
      }
    }
  }
}

/** [width, height] for aim rays at living things. */
const DIMS: Record<string, [number, number]> = {
  zombie: [.6, 1.95], husk: [.6, 1.95], skeleton: [.6, 1.99], creeper: [.6, 1.7], silverfish: [.4, .3], wolf: [.6, .85],
  sheep: [.9, 1.3], chicken: [.4, .7], end_crystal: [2, 2], boat: [1.375, .5625], minecart: [.98, .7],
};

let tntId = -1;
function findBlock(name: string): number {
  if (tntId >= 0) return tntId;
  for (const [id, b] of Object.entries(BLOCKS)) if (b.name === name) { tntId = Number(id); break; }
  return tntId;
}
