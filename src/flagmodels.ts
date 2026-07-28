// Renders the capture-the-flag layer: a tall banner pole on each faction's home
// pad, a waving banner over whoever is running a stolen flag, and a beacon
// column so a flag is findable from across the Heartland. Presentation only —
// every rule lives in the pure flags.ts and is decided by the server.

import * as THREE from 'three';
import { Flag, FLAG_MAX_HP, flagHome, flagPosition } from './flags';
import { factionColor } from './teams';

/** Height of the pole (blocks) — tall enough to spot over trees. */
const POLE_H = 6.5;
const CLOTH_W = 2.55;
const CLOTH_H = 1.65;

interface Pole {
  group: THREE.Group;
  cloth: THREE.Mesh;
  clothMat: THREE.MeshBasicMaterial;
  clothGeo: THREE.BufferGeometry;
  tassels: THREE.Group;
  halo: THREE.Mesh;
  beam: THREE.Mesh;
  damage: THREE.Mesh;      // a red "health" bar that shrinks as the flag is beaten
  damageMat: THREE.MeshBasicMaterial;
}

/** A banner carried over a player's head (the "I have the flag" marker). */
interface Banner {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
}

export class FlagModels {
  private readonly scene: THREE.Scene;
  private readonly poles = new Map<number, Pole>();   // by flag faction
  private readonly banners = new Map<number, Banner>(); // by carrier player id
  private flags: Flag[] = [];
  private breakable = false;
  private warActive = false;
  private t = 0;
  /** Ground height lookup so a pole stands on the terrain, not in the air. */
  private groundAt: (x: number, z: number) => number = () => 64;

  constructor(scene: THREE.Scene) { this.scene = scene; }

  setGroundProbe(fn: (x: number, z: number) => number): void { this.groundAt = fn; }

  /** Adopt the latest server state. */
  setState(breakable: boolean, flags: Flag[]): void {
    this.breakable = breakable;
    this.flags = flags.map((f) => ({ ...f }));
  }

  /** Wayfinding is a war mechanic: the monument remains in peacetime, but its
   *  sky beam and the map/HUD waypoint do not reveal the base. */
  setWarActive(active: boolean): void { this.warActive = active; }

  /** The flag this player is carrying, or null. */
  carriedBy(playerId: number): Flag | null {
    return this.flags.find((f) => f.carrier === playerId) ?? null;
  }

  /** The planted, enemy-held flag within `reach` of (x, z), or null — used to
   *  show the "hold left-click to take the flag" prompt. */
  plantedInReach(faction: number, x: number, z: number, reach: number): Flag | null {
    for (const f of this.flags) {
      if (f.carrier >= 0 || f.holder === faction) continue;
      const home = flagPosition(f);
      const dx = home.x - x, dz = home.z - z;
      if (dx * dx + dz * dz <= reach * reach) return f;
    }
    return null;
  }

  /** Distance to your own pad (for the "run it home" prompt), or Infinity. */
  distanceToOwnPad(faction: number, x: number, z: number): number {
    const pad = flagHome(faction);
    return Math.hypot(pad.x - x, pad.z - z);
  }

  private buildPole(faction: number): Pole {
    const color = new THREE.Color(factionColor(faction));
    const group = new THREE.Group();

    const poleMat = new THREE.MeshBasicMaterial({ color: 0x302a25 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.14, POLE_H, 8), poleMat);
    pole.position.y = POLE_H / 2;
    group.add(pole);

    // A layered faction monument: broad dark footing, bevel-like stone step,
    // glowing inset and iron collar. It reads cleanly from every direction.
    const footing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.65, 1.85, 0.28, 8),
      new THREE.MeshBasicMaterial({ color: 0x24262c })
    );
    footing.position.y = 0.14;
    group.add(footing);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.28, 1.52, 0.34, 8),
      new THREE.MeshBasicMaterial({ color: 0x686b72 })
    );
    base.position.y = 0.42;
    group.add(base);
    const inset = new THREE.Mesh(
      new THREE.CylinderGeometry(0.93, 1.16, 0.09, 8),
      new THREE.MeshBasicMaterial({ color })
    );
    inset.position.y = 0.635;
    group.add(inset);
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.4, 0.55, 8),
      new THREE.MeshBasicMaterial({ color: 0x373b43 })
    );
    collar.position.y = 0.89;
    group.add(collar);

    const crossbar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, CLOTH_W + 0.28, 8),
      poleMat
    );
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set((CLOTH_W + 0.28) / 2, POLE_H - 0.2, 0);
    group.add(crossbar);
    const finial = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22),
      new THREE.MeshBasicMaterial({ color: 0xe8c76a })
    );
    finial.position.y = POLE_H + 0.2;
    group.add(finial);

    const clothMat = new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide,
    });
    // Five vertical strips give the banner a real travelling wave. The pointed
    // lower edge, pale charge and tassels make it a faction standard, not a
    // plain coloured rectangle.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(CLOTH_W, 0);
    shape.lineTo(CLOTH_W, -CLOTH_H * 0.72);
    shape.lineTo(CLOTH_W * 0.82, -CLOTH_H);
    shape.lineTo(CLOTH_W * 0.62, -CLOTH_H * 0.78);
    shape.lineTo(CLOTH_W * 0.42, -CLOTH_H);
    shape.lineTo(CLOTH_W * 0.22, -CLOTH_H * 0.78);
    shape.lineTo(0, -CLOTH_H * 0.86);
    shape.closePath();
    const clothGeo = new THREE.ShapeGeometry(shape, 8);
    const cloth = new THREE.Mesh(clothGeo, clothMat);
    cloth.position.set(0.12, POLE_H - 0.28, 0);
    group.add(cloth);

    const charge = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34, 0),
      new THREE.MeshBasicMaterial({ color: 0xf5e8bf, side: THREE.DoubleSide })
    );
    charge.scale.set(1, 1.35, 0.12);
    charge.position.set(CLOTH_W * 0.48, -CLOTH_H * 0.46, -0.018);
    cloth.add(charge);

    const tassels = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const tassel = new THREE.Mesh(
        new THREE.ConeGeometry(0.095, 0.38, 5),
        new THREE.MeshBasicMaterial({ color: 0xe8c76a })
      );
      tassel.position.set(CLOTH_W * (0.23 + i * 0.2), -CLOTH_H * (i === 1 ? 1.02 : 0.84), 0);
      tassels.add(tassel);
    }
    cloth.add(tassels);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.16, 0.045, 5, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.72;
    group.add(halo);

    // A wide light column: visible from far away, faction-coloured.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 90, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.16, depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    beam.position.y = 45;
    group.add(beam);

    // Damage bar: full width when untouched, shrinking as the pole is beaten.
    const damageMat = new THREE.MeshBasicMaterial({
      color: 0x4ce04c, depthTest: false, transparent: true,
    });
    const damage = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.18), damageMat);
    damage.position.y = POLE_H + 0.5;
    damage.renderOrder = 60;
    damage.visible = false;
    group.add(damage);

    this.scene.add(group);
    return { group, cloth, clothMat, clothGeo, tassels, halo, beam, damage, damageMat };
  }

  private buildBanner(faction: number): Banner {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: factionColor(faction), side: THREE.DoubleSide,
      depthTest: false, transparent: true, opacity: 0.95,
    });
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), mat);
    cloth.position.set(0.5, 0, 0);
    cloth.renderOrder = 61;
    const stick = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 1.1, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x2b2b33, depthTest: false })
    );
    stick.position.y = -0.25;
    stick.renderOrder = 61;
    group.add(cloth, stick);
    this.scene.add(group);
    return { group, mat };
  }

  /**
   * Rebuild/refresh every visual for this frame. `positionOf` resolves a
   * carrier's player id to a world position (local player or remote avatar);
   * carriers it can't resolve simply don't get a banner drawn.
   */
  update(
    dt: number, camera: THREE.Camera,
    positionOf: (playerId: number) => THREE.Vector3 | null
  ): void {
    this.t += dt;
    const liveBanners = new Set<number>();

    for (const flag of this.flags) {
      let pole = this.poles.get(flag.faction);
      if (!pole) { pole = this.buildPole(flag.faction); this.poles.set(flag.faction, pole); }

      // A captured flag flies at its captor's base, so the pad follows `holder`.
      const home = flagPosition(flag);
      const y = this.groundAt(home.x, home.z);
      pole.group.position.set(home.x + 0.5, y, home.z + 0.5);
      // The pole itself always stands (it's the site); the cloth is what's gone
      // while somebody is running it.
      const planted = flag.carrier < 0;
      pole.cloth.visible = planted;
      pole.beam.visible = planted && this.warActive;
      pole.halo.visible = planted;
      pole.halo.rotation.z = this.t * 0.22;
      // Cloth ripple: deform the actual banner surface instead of rotating a
      // cardboard plane. The pole edge stays pinned while the fly edge rolls.
      const pos = pole.clothGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        pos.setZ(i, Math.sin(this.t * 2.1 - x * 2.35) * 0.13 * (x / CLOTH_W));
      }
      pos.needsUpdate = true;
      pole.tassels.rotation.z = Math.sin(this.t * 2.1) * 0.035;

      // Damage bar only while the flag is under attack (armed + chipped).
      const hurt = this.breakable && planted && flag.hp < FLAG_MAX_HP;
      pole.damage.visible = hurt;
      if (hurt) {
        const frac = Math.max(0, flag.hp / FLAG_MAX_HP);
        pole.damage.scale.x = Math.max(0.02, frac);
        pole.damageMat.color.setHex(frac > 0.5 ? 0x4ce04c : frac > 0.2 ? 0xe0c24c : 0xe04c4c);
        pole.damage.quaternion.copy(camera.quaternion);
      }

      if (!planted) {
        const pos = positionOf(flag.carrier);
        if (pos) {
          liveBanners.add(flag.carrier);
          let banner = this.banners.get(flag.carrier);
          if (!banner) {
            banner = this.buildBanner(flag.faction);
            this.banners.set(flag.carrier, banner);
          }
          banner.mat.color.setHex(factionColor(flag.faction));
          banner.group.position.set(pos.x, pos.y + 2.9, pos.z);
          banner.group.quaternion.copy(camera.quaternion);
          // Bob so a fleeing carrier is easy to track across a battlefield.
          banner.group.position.y += Math.sin(this.t * 3) * 0.08;
        }
      }
    }

    for (const [id, banner] of this.banners) {
      if (!liveBanners.has(id)) {
        this.scene.remove(banner.group);
        banner.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
        this.banners.delete(id);
      }
    }
  }
}
