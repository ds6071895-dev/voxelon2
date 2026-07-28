import * as THREE from 'three';
import type { EncounterSnapshot } from './vault_encounter';

const FAMILY_COLOR: Record<EncounterSnapshot['family'], number> = {
  crypt: 0xa66cff, mire: 0x38e0ad, ember: 0xff5b2c,
  crystal: 0x63c8ff, gilded: 0xf2bd3f,
};

/**
 * Small fixed pools for telegraphs, encounter objects and summons. Nothing in
 * this renderer writes blocks or survives hide/reset.
 */
export class VaultEncounterVisuals {
  private readonly root = new THREE.Group();
  private readonly hazards: THREE.Mesh[] = [];
  private readonly objects: THREE.Mesh[] = [];
  private readonly actors: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    const hazardGeo = new THREE.RingGeometry(0.82, 1, 48);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(hazardGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.root.add(mesh);
      this.hazards.push(mesh);
    }
    const objectGeo = new THREE.BoxGeometry(1.2, 1.8, 1.2);
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(objectGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.82,
      }));
      mesh.visible = false;
      this.root.add(mesh);
      this.objects.push(mesh);
    }
    const actorGeo = new THREE.OctahedronGeometry(0.55, 0);
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(actorGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      mesh.visible = false;
      this.root.add(mesh);
      this.actors.push(mesh);
    }
  }

  update(snapshot: EncounterSnapshot | null, highContrast = false): void {
    if (!snapshot) { this.hide(); return; }
    this.root.visible = true;
    const color = FAMILY_COLOR[snapshot.family];
    this.hazards.forEach((mesh, i) => {
      const h = snapshot.hazards[i];
      mesh.visible = !!h;
      if (!h) return;
      mesh.position.set(h.origin.x, h.origin.y + 0.035, h.origin.z);
      mesh.scale.setScalar(Math.max(0.2, h.radius));
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(highContrast ? 0xffffff : color);
      mat.opacity = highContrast ? 0.9 : 0.55;
    });
    this.objects.forEach((mesh, i) => {
      const o = snapshot.objects[i];
      mesh.visible = !!o;
      if (!o) return;
      mesh.position.set(o.position.x, o.position.y + 0.9, o.position.z);
      (mesh.material as THREE.MeshBasicMaterial).color.set(color);
      mesh.scale.y = o.kind === 'crusher_wall' ? 2.2 : 1;
      mesh.scale.x = o.kind === 'cover' || o.kind === 'crusher_wall' ? 2.5 : 1;
    });
    this.actors.forEach((mesh, i) => {
      const a = snapshot.actors[i];
      mesh.visible = !!a;
      if (!a) return;
      mesh.position.set(a.position.x, a.position.y + 0.65, a.position.z);
      mesh.rotation.y += 0.08;
      (mesh.material as THREE.MeshBasicMaterial).color.set(color);
    });
  }

  hide(): void {
    this.root.visible = false;
    for (const pool of [this.hazards, this.objects, this.actors]) {
      for (const mesh of pool) mesh.visible = false;
    }
  }
}

