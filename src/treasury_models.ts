// THE STRONGBOX — the faction treasury as a thing standing in the world.
//
// Built the same way as the flag poles (flagmodels.ts): pure PRESENTATION over a
// position that treasury.ts derives from `flagHome()`. It is deliberately NOT a
// block and NOT a chest — no edit-log entry, no container hookup, nothing that
// could be mined, moved, or opened through the generic chest path. A
// server-owned faction asset should never depend on the state of one voxel.
//
// It reports itself at a glance: the lid lifts as the box fills, the faction's
// colour burns through the seam, and the whole thing pulses red while a war
// window is open and it can actually be forced.

import * as THREE from 'three';
import { treasuryInReach, treasuryLocation } from './treasury';
import { FACTIONS, factionColor } from './teams';

/** Footprint of the box, in blocks. */
const BOX_W = 1.5, BOX_D = 1.1, BODY_H = 0.62, LID_H = 0.26;
/** Item count at which the fill indicator reads full (a packed 27-slot box). */
const FULL_AT = 27 * 64;
/** How far the lid lifts when the box is stuffed. */
const LID_LIFT = 0.34;

interface Box {
  group: THREE.Group;
  lid: THREE.Group;
  /** The glowing seam under the lid: brightness tracks how full the box is. */
  seamMat: THREE.MeshBasicMaterial;
  /** The war-time alarm ring around the plinth. */
  alarm: THREE.Mesh;
  alarmMat: THREE.MeshBasicMaterial;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
}

export class TreasuryModels {
  private readonly scene: THREE.Scene;
  private readonly boxes = new Map<number, Box>();
  /** Item count per faction, from the politics sync. Drives the fill glow. */
  private counts: Record<number, number> = {};
  private warActive = false;
  private t = 0;
  private groundAt: (x: number, z: number) => number = () => 64;

  constructor(scene: THREE.Scene) { this.scene = scene; }

  setGroundProbe(fn: (x: number, z: number) => number): void { this.groundAt = fn; }

  /** Adopt the latest per-faction item counts. */
  setCounts(counts: Record<number, number>): void { this.counts = { ...counts }; }

  /** A strongbox can only be forced while a war window is open — the model says
   *  so, so nobody has to read a rulebook to find that out. */
  setWarActive(active: boolean): void { this.warActive = active; }

  /** The faction whose strongbox the player is standing at, or null.
   *
   *  Delegates to the PURE `treasuryInReach` rather than re-deriving the test,
   *  so the prompt on screen and the server's own check can never disagree
   *  about whether you are close enough. */
  inReach(x: number, z: number): number | null {
    return treasuryInReach(x, z);
  }

  /** World-space centre of a strongbox, for aim tests and effects. */
  centre(faction: number): THREE.Vector3 {
    const loc = treasuryLocation(faction);
    return new THREE.Vector3(
      loc.x + 0.5, this.groundAt(loc.x, loc.z) + 0.7, loc.z + 0.5);
  }

  private build(faction: number): Box {
    const color = new THREE.Color(factionColor(faction));
    const group = new THREE.Group();
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const geo = <T extends THREE.BufferGeometry>(g: T): T => { geometries.push(g); return g; };
    const mat = <T extends THREE.Material>(m: T): T => { materials.push(m); return m; };

    // Plinth: the box sits on a stone pad so it never reads as half-sunk in
    // whatever terrain happens to be under the flag.
    const plinth = new THREE.Mesh(
      geo(new THREE.BoxGeometry(BOX_W + 0.55, 0.2, BOX_D + 0.55)),
      mat(new THREE.MeshBasicMaterial({ color: 0x2b2e35 }))
    );
    plinth.position.y = 0.1;
    group.add(plinth);

    const trim = new THREE.Mesh(
      geo(new THREE.BoxGeometry(BOX_W + 0.3, 0.07, BOX_D + 0.3)),
      mat(new THREE.MeshBasicMaterial({ color }))
    );
    trim.position.y = 0.22;
    group.add(trim);

    // Body.
    const body = new THREE.Mesh(
      geo(new THREE.BoxGeometry(BOX_W, BODY_H, BOX_D)),
      mat(new THREE.MeshBasicMaterial({ color: 0x59422a }))
    );
    body.position.y = 0.25 + BODY_H / 2;
    group.add(body);

    // Iron banding, so it reads as a strongbox rather than a crate.
    for (const dx of [-BOX_W * 0.3, BOX_W * 0.3]) {
      const band = new THREE.Mesh(
        geo(new THREE.BoxGeometry(0.14, BODY_H + 0.02, BOX_D + 0.02)),
        mat(new THREE.MeshBasicMaterial({ color: 0x3a3f47 }))
      );
      band.position.set(dx, 0.25 + BODY_H / 2, 0);
      group.add(band);
    }

    // The seam: a thin glowing slab between body and lid. Its brightness is the
    // fill gauge, readable from across the base.
    const seamMat = mat(new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    const seam = new THREE.Mesh(
      geo(new THREE.BoxGeometry(BOX_W + 0.04, 0.06, BOX_D + 0.04)), seamMat
    );
    seam.position.y = 0.25 + BODY_H;
    group.add(seam);

    // Lid, in its own group so it can hinge open without moving the body.
    const lid = new THREE.Group();
    lid.position.y = 0.25 + BODY_H;
    const lidMesh = new THREE.Mesh(
      geo(new THREE.BoxGeometry(BOX_W + 0.06, LID_H, BOX_D + 0.06)),
      mat(new THREE.MeshBasicMaterial({ color: 0x6a5031 }))
    );
    lidMesh.position.y = LID_H / 2;
    lid.add(lidMesh);
    const lock = new THREE.Mesh(
      geo(new THREE.BoxGeometry(0.22, 0.24, 0.1)),
      mat(new THREE.MeshBasicMaterial({ color: 0xd8b64a }))
    );
    lock.position.set(0, LID_H / 2 - 0.04, BOX_D / 2 + 0.05);
    lid.add(lock);
    group.add(lid);

    // War alarm: a flat ring on the plinth that only appears once the box can
    // actually be forced.
    const alarmMat = mat(new THREE.MeshBasicMaterial({
      color: 0xff3b28, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide,
    }));
    const alarm = new THREE.Mesh(
      geo(new THREE.RingGeometry(BOX_W * 0.72, BOX_W * 0.95, 28)), alarmMat
    );
    alarm.rotation.x = -Math.PI / 2;
    alarm.position.y = 0.21;
    alarm.visible = false;
    group.add(alarm);

    this.scene.add(group);
    return { group, lid, seamMat, alarm, alarmMat, materials, geometries };
  }

  update(dt: number): void {
    this.t += dt;
    for (const f of FACTIONS) {
      let box = this.boxes.get(f.id);
      if (!box) { box = this.build(f.id); this.boxes.set(f.id, box); }

      const loc = treasuryLocation(f.id);
      box.group.position.set(loc.x + 0.5, this.groundAt(loc.x, loc.z), loc.z + 0.5);

      // Fill: the lid creeps open and the seam brightens as the box loads up.
      const fill = Math.max(0, Math.min(1, (this.counts[f.id] ?? 0) / FULL_AT));
      box.lid.position.y = 0.25 + BODY_H + LID_LIFT * fill;
      box.lid.rotation.x = -0.22 * fill;
      // A faint breath on the seam so a full box looks alive rather than lit.
      box.seamMat.opacity = 0.28 + fill * 0.5 + Math.sin(this.t * 1.6) * 0.05 * fill;

      box.alarm.visible = this.warActive;
      box.alarmMat.opacity = this.warActive
        ? 0.3 + 0.28 * (0.5 + 0.5 * Math.sin(this.t * 4.2)) : 0;
    }
  }

  dispose(): void {
    for (const box of this.boxes.values()) {
      this.scene.remove(box.group);
      for (const g of box.geometries) g.dispose();
      for (const m of box.materials) m.dispose();
    }
    this.boxes.clear();
  }
}
