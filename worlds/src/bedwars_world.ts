// Everything Bedwars puts in the 3D scene besides the map and the players:
// items on the ground, arrows/TNT/pearls in flight, the shrinking safe zone and
// the crack on a bed an enemy is working on. Movement of drops is simulated
// here with the same `stepDrop` the server runs, so only events cross the wire.
import * as THREE from 'three';
import { BW_Y } from './bedwars_map';
import type { BwBreakView, BwDropView, BwProjectileView, BwSafeZone } from './bedwars_rules';
import { stepDrop, type BwDropBody } from './bedwars_drops';
import { itemGeometry, itemGeometrySolid } from './item_geometry';
import { ITEMS } from './items';
import type { Atlas } from './textures';
import type { World } from './world';

interface DropView extends BwDropBody { id: number; item: number; count: number; group: THREE.Group; phase: number; shown: number }
interface Fly { group: THREE.Group; from: THREE.Vector3; to: () => THREE.Vector3 | null; t: number; arc: number }
interface ProjectileView { object: THREE.Group; target: THREE.Vector3; previous: THREE.Vector3; kind: string; at: number; fuse: number }

const PICKUP_FLIGHT = 0.2;

export class BedwarsWorld {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshBasicMaterial;
  private readonly drops = new Map<number, DropView>();
  private readonly flying: Fly[] = [];
  private readonly projectiles = new Map<number, ProjectileView>();
  private readonly shared: THREE.BufferGeometry[] = [];
  private zone: THREE.Group | null = null;
  private readonly cracks = new Map<number, THREE.Mesh>();
  private readonly crackMaterial: THREE.MeshBasicMaterial;
  private elapsed = 0;

  constructor(scene: THREE.Scene, private readonly world: World, private readonly atlas: Atlas,
    private readonly crackTextures: THREE.Texture[]) {
    this.group.name = 'bedwars-world';
    this.material = new THREE.MeshBasicMaterial({ map: atlas.texture, alphaTest: 0.4, vertexColors: true, side: THREE.DoubleSide });
    this.crackMaterial = new THREE.MeshBasicMaterial({ map: crackTextures[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.zone = this.createZone(); this.group.add(this.zone);
    scene.add(this.group);
  }

  // ── Items on the ground ────────────────────────────────────────────────
  applyDrops(msg: { reset?: boolean; add?: BwDropView[]; gone?: { id: number; by?: number; into?: number }[]; count?: { id: number; count: number }[] },
    where: (playerId: number) => THREE.Vector3 | null): void {
    if (msg.reset) { for (const d of this.drops.values()) this.release(d.group); this.drops.clear(); }
    for (const a of msg.add ?? []) if (!this.drops.has(a.id)) this.addDrop(a);
    for (const c of msg.count ?? []) { const d = this.drops.get(c.id); if (d) d.count = c.count; }
    for (const g of msg.gone ?? []) {
      const d = this.drops.get(g.id);
      if (!d) continue;
      this.drops.delete(g.id);
      const target = g.by !== undefined ? () => where(g.by!) : g.into !== undefined ? () => { const o = this.drops.get(g.into!); return o ? new THREE.Vector3(o.x, o.y + 0.3, o.z) : null; } : null;
      if (target) this.flying.push({ group: d.group, from: d.group.position.clone(), to: target, t: 0, arc: 0.35 });
      else this.release(d.group);
    }
  }
  get dropCount(): number { return this.drops.size; }
  private addDrop(a: BwDropView): void {
    const group = new THREE.Group();
    group.position.set(a.x, a.y + 0.22, a.z);
    const view: DropView = { id: a.id, item: a.item, count: a.count, x: a.x, y: a.y, z: a.z, vx: a.vx, vy: a.vy, vz: a.vz, rest: false, group, phase: a.id * 1.7, shown: 0 };
    this.drops.set(a.id, view);
    this.group.add(group);
    this.rebuild(view);
  }
  /** One to three copies of the item, so a bigger pile looks bigger. */
  private rebuild(d: DropView): void {
    const copies = d.count >= 24 ? 3 : d.count >= 6 ? 2 : 1;
    d.shown = copies;
    for (const child of [...d.group.children]) d.group.remove(child);
    const block = ITEMS[d.item]?.kind === 'block';
    const geo = block ? itemGeometry(this.atlas, d.item) : itemGeometrySolid(this.atlas, d.item, 0.42, 0.05);
    for (let i = 0; i < copies; i++) {
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.position.set((i - (copies - 1) / 2) * 0.13, i * 0.03, (i % 2 ? 1 : -1) * 0.07 * (copies > 1 ? 1 : 0));
      mesh.rotation.z = block ? 0 : -0.15 * i;
      d.group.add(mesh);
    }
  }
  private release(object: THREE.Object3D): void { object.removeFromParent(); object.clear(); }

  // ── Projectiles ────────────────────────────────────────────────────────
  setProjectiles(list: BwProjectileView[]): void {
    const ids = new Set(list.map(v => v.id));
    for (const [id, view] of this.projectiles) if (!ids.has(id)) { this.disposeGroup(view.object); this.projectiles.delete(id); }
    const now = performance.now();
    for (const data of list) {
      let view = this.projectiles.get(data.id);
      if (!view) {
        const object = this.createProjectile(data.kind); object.position.set(data.x, data.y, data.z);
        this.group.add(object);
        view = { object, target: object.position.clone(), previous: object.position.clone(), kind: data.kind, at: now, fuse: data.fuse ?? 0 };
        this.projectiles.set(data.id, view);
      }
      view.previous.copy(view.object.position); view.target.set(data.x, data.y, data.z); view.at = now; view.fuse = data.fuse ?? 0;
      if (data.kind === 'arrow') {
        const direction = view.target.clone().sub(view.previous);
        if (direction.lengthSq() > .00001) view.object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
      }
    }
  }
  /** Where TNT went off, for the blast effect: projectiles that vanish while their fuse ran out. */
  takeDetonations(list: BwProjectileView[]): THREE.Vector3[] {
    const live = new Set(list.map(v => v.id)), out: THREE.Vector3[] = [];
    for (const [id, view] of this.projectiles) if (!live.has(id) && view.kind === 'tnt' && view.fuse < 0.25) out.push(view.target.clone());
    return out;
  }

  // ── Zone and enemy cracks ─────────────────────────────────────────────
  setZone(z: BwSafeZone, visible: boolean): void {
    if (!this.zone) return;
    this.zone.visible = z.active && visible;
    this.zone.position.set(z.x, BW_Y + 6, z.z);
    this.zone.scale.set(z.radius, 60, z.radius);
  }
  setBreaks(breaks: BwBreakView[], selfId: number): void {
    const live = new Set<number>();
    for (const b of breaks) {
      if (b.id === selfId) continue;
      live.add(b.id);
      let mesh = this.cracks.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(1.001, 1.001, 1.001), this.crackMaterial.clone());
        this.cracks.set(b.id, mesh); this.group.add(mesh);
      }
      (mesh.material as THREE.MeshBasicMaterial).map = this.crackTextures[Math.max(0, Math.min(9, Math.floor(b.progress * 10)))];
      mesh.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5); mesh.visible = true;
    }
    for (const [id, mesh] of this.cracks) if (!live.has(id)) { mesh.removeFromParent(); (mesh.material as THREE.Material).dispose(); mesh.geometry.dispose(); this.cracks.delete(id); }
  }

  // ── Per-frame ──────────────────────────────────────────────────────────
  update(dt: number): void {
    this.elapsed += dt;
    const get = (x: number, y: number, z: number) => this.world.getBlock(x, y, z);
    let n = 0;
    for (const d of this.drops.values()) {
      if (!d.rest || (n++ & 3) === 0) stepDrop(get, d, dt * (d.rest ? 4 : 1));
      const bob = d.rest ? 0.22 + Math.sin(this.elapsed * 2.2 + d.phase) * 0.05 : 0.22;
      d.group.position.set(d.x, d.y + bob, d.z);
      d.group.rotation.y = this.elapsed * 1.5 + d.phase;
      const copies = d.count >= 24 ? 3 : d.count >= 6 ? 2 : 1;
      if (copies !== d.shown) this.rebuild(d);
    }
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt / PICKUP_FLIGHT;
      const to = f.to();
      if (f.t >= 1 || !to) { this.release(f.group); this.flying.splice(i, 1); continue; }
      const k = f.t * f.t;
      f.group.position.lerpVectors(f.from, to, k);
      f.group.position.y += Math.sin(f.t * Math.PI) * f.arc;
      f.group.scale.setScalar(1 - k * 0.7);
    }
    const now = performance.now();
    for (const projectile of this.projectiles.values()) {
      // Interpolate only between received positions; never predict a hit/landing.
      const alpha = Math.min(1, (now - projectile.at) / 55);
      projectile.object.position.lerpVectors(projectile.previous, projectile.target, alpha);
      if (projectile.kind === 'tnt') {
        projectile.object.rotation.x = this.elapsed * 3;
        projectile.object.rotation.z = this.elapsed * 2;
        projectile.object.scale.setScalar(.92 + .12 * Math.sin(this.elapsed * (projectile.fuse < 1 ? 24 : 9)));
      } else if (projectile.kind === 'pearl') projectile.object.rotation.y = this.elapsed * 4;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const view of this.projectiles.values()) this.disposeGroup(view.object);
    for (const mesh of this.cracks.values()) { (mesh.material as THREE.Material).dispose(); mesh.geometry.dispose(); }
    this.cracks.clear(); this.projectiles.clear(); this.drops.clear(); this.flying.length = 0;
    if (this.zone) this.disposeGroup(this.zone);
    this.zone = null;
    this.material.dispose(); this.crackMaterial.dispose();
    for (const g of this.shared) g.dispose();
  }

  private disposeGroup(object: THREE.Object3D): void {
    object.removeFromParent();
    object.traverse(child => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose(); for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
      }
    });
    object.clear();
  }

  private createZone(): THREE.Group {
    const group = new THREE.Group(); group.name = 'bedwars-safe-zone'; group.visible = false;
    group.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x5aa9ff, side: THREE.DoubleSide, transparent: true, opacity: .07, depthWrite: false })));
    const positions: number[] = [];
    for (let i = 0; i < 96; i++) {
      const angle = i / 96 * Math.PI * 2, next = (i + 1) / 96 * Math.PI * 2;
      const x = Math.cos(angle), z = Math.sin(angle), nx = Math.cos(next), nz = Math.sin(next);
      for (const y of [-.1, 0]) positions.push(x, y, z, nx, y, nz);
      if (i % 4 === 0) positions.push(x, -.5, z, x, .5, z);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: .6, depthWrite: false })));
    return group;
  }

  private createProjectile(kind: 'arrow' | 'pearl' | 'tnt' | string): THREE.Group {
    const group = new THREE.Group(); group.name = `bedwars-${kind}`;
    const box = (w: number, h: number, d: number, color: number, z = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
      mesh.position.z = z; group.add(mesh); return mesh;
    };
    if (kind === 'arrow') {
      box(.045, .045, .72, 0xc7a775);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(.08, .18, 4), new THREE.MeshBasicMaterial({ color: 0xdbe5eb }));
      tip.rotation.x = Math.PI / 2; tip.position.z = .42; group.add(tip);
      box(.20, .015, .18, 0xece3ce, -.27); box(.015, .20, .18, 0xece3ce, -.27);
    } else if (kind === 'pearl') {
      group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.18, 1), new THREE.MeshBasicMaterial({ color: 0x55e1bd })));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.23, .025, 4, 16), new THREE.MeshBasicMaterial({ color: 0xf0d69f }));
      ring.rotation.x = .65; group.add(ring);
    } else {
      box(.42, .42, .42, 0xc75354); box(.435, .13, .435, 0xf2dec0);
      const fuse = box(.035, .15, .035, 0x3e3026); fuse.position.y = .26;
      const spark = box(.065, .065, .065, 0xffd777); spark.position.y = .35;
    }
    return group;
  }
}
