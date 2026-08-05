import * as THREE from 'three';
import type {
  EncounterActorKind, EncounterHazard, EncounterObjectKind, EncounterSnapshot,
} from './vault_encounter';

const FAMILY_COLOR: Record<EncounterSnapshot['family'], number> = {
  crypt: 0xa66cff, mire: 0x38e0ad, ember: 0xff5b2c,
  crystal: 0x63c8ff, gilded: 0xf2bd3f,
};

const TELEGRAPH_GEOMETRY = {
  circle: new THREE.CircleGeometry(1, 48),
  ring: new THREE.RingGeometry(0.82, 1, 48),
  line: new THREE.PlaneGeometry(1, 1),
  cone: new THREE.CircleGeometry(1, 48, -Math.PI * 0.4, Math.PI * 0.8),
  quadrant: new THREE.CircleGeometry(1, 32, 0, Math.PI / 2),
};
const OBJECT_GEOMETRY = {
  box: new THREE.BoxGeometry(1.2, 1.8, 1.2),
  pillar: new THREE.CylinderGeometry(0.48, 0.65, 2.4, 8),
  prism: new THREE.OctahedronGeometry(0.85, 0),
  pool: new THREE.CylinderGeometry(1.1, 1.1, 0.25, 20),
  mine: new THREE.CylinderGeometry(0.55, 0.7, 0.22, 10),
};
const ACTOR_GEOMETRY = {
  brute: new THREE.OctahedronGeometry(0.62, 0),
  skitter: new THREE.TetrahedronGeometry(0.62, 0),
  guard: new THREE.BoxGeometry(0.9, 1.25, 0.9),
  clone: new THREE.OctahedronGeometry(0.7, 0),
};

function hazardGeometry(h: EncounterHazard): THREE.BufferGeometry {
  if (h.shape === 'line') return TELEGRAPH_GEOMETRY.line;
  if (h.shape === 'cone') return TELEGRAPH_GEOMETRY.cone;
  if (h.shape === 'quadrant') return TELEGRAPH_GEOMETRY.quadrant;
  if (h.shape === 'ring') return TELEGRAPH_GEOMETRY.ring;
  return TELEGRAPH_GEOMETRY.circle;
}

function objectGeometry(kind: EncounterObjectKind): THREE.BufferGeometry {
  if (kind === 'sarcophagus' || kind === 'cover' || kind === 'crusher_wall') {
    return OBJECT_GEOMETRY.box;
  }
  if (kind === 'prism') return OBJECT_GEOMETRY.prism;
  if (kind === 'brood_pool' || kind === 'safe_island') return OBJECT_GEOMETRY.pool;
  if (kind === 'mine') return OBJECT_GEOMETRY.mine;
  return OBJECT_GEOMETRY.pillar;
}

function actorGeometry(kind: EncounterActorKind): THREE.BufferGeometry {
  if (kind === 'skitter' || kind === 'mireling') return ACTOR_GEOMETRY.skitter;
  if (kind === 'clockwork_guard') return ACTOR_GEOMETRY.guard;
  if (kind === 'mirror_clone') return ACTOR_GEOMETRY.clone;
  return ACTOR_GEOMETRY.brute;
}

/**
 * Fixed-size visual pools for every encounter mechanic. Telegraphs use their
 * real geometry (line/cone/ring/impact), while wards, summons and the boss aura
 * pulse from authoritative snapshot time. Nothing writes world blocks.
 */
export class VaultEncounterVisuals {
  private readonly root = new THREE.Group();
  private readonly hazards: THREE.Mesh[] = [];
  private readonly objects: THREE.Mesh[] = [];
  private readonly actors: THREE.Mesh[] = [];
  private readonly aura: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(TELEGRAPH_GEOMETRY.circle, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.58,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.root.add(mesh);
      this.hazards.push(mesh);
    }
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(OBJECT_GEOMETRY.box, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.86,
      }));
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.objects.push(mesh);
    }
    for (let i = 0; i < 16; i++) {
      const mesh = new THREE.Mesh(ACTOR_GEOMETRY.brute, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.9,
      }));
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.actors.push(mesh);
    }
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(i ? 0.84 : 0.9, 1, 48),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: i ? 0.18 : 0.35,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 2;
      this.root.add(ring);
      this.aura.push(ring);
    }
  }

  update(
    snapshot: EncounterSnapshot | null, highContrast = false, reducedMotion = false,
  ): void {
    if (!snapshot) { this.hide(); return; }
    this.root.visible = true;
    const color = FAMILY_COLOR[snapshot.family];
    const pulse = reducedMotion ? 1 : 1 + Math.sin(snapshot.time * 7) * 0.06;
    this.hazards.forEach((mesh, i) => {
      const h = snapshot.hazards[i];
      mesh.visible = !!h;
      if (!h) return;
      mesh.geometry = hazardGeometry(h);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(highContrast ? 0xffffff : color);
      const countdown = Math.max(0, h.executeAt - snapshot.time);
      const urgency = Math.max(0, Math.min(1, 1 - countdown / 1.2));
      mat.opacity = highContrast ? 0.92 : 0.42 + urgency * 0.38;
      mesh.rotation.set(-Math.PI / 2, 0, 0);
      mesh.position.set(h.origin.x, h.origin.y + 0.045, h.origin.z);
      if (h.shape === 'line') {
        const target = h.target ?? { x: h.origin.x + 1, z: h.origin.z };
        const dx = target.x - h.origin.x, dz = target.z - h.origin.z;
        const len = Math.max(0.01, Math.hypot(dx, dz));
        mesh.position.x += dx / len * h.radius / 2;
        mesh.position.z += dz / len * h.radius / 2;
        mesh.rotation.z = Math.atan2(dz, dx) + Math.PI / 2;
        mesh.scale.set(Math.max(0.1, h.width), Math.max(0.2, h.radius), 1);
      } else {
        const s = Math.max(0.2, h.radius) * pulse;
        mesh.scale.set(s, s, 1);
        if (h.shape === 'cone' && h.target) {
          mesh.rotation.z = Math.atan2(
            h.target.z - h.origin.z, h.target.x - h.origin.x,
          ) - Math.PI / 2;
        } else if (h.shape === 'quadrant') {
          mesh.rotation.z = (h.id & 3) * Math.PI / 2;
        }
      }
    });
    this.objects.forEach((mesh, i) => {
      const o = snapshot.objects[i];
      mesh.visible = !!o;
      if (!o) return;
      mesh.geometry = objectGeometry(o.kind);
      const hp = Math.max(0.2, o.maxHp > 0 ? o.hp / o.maxHp : 1);
      mesh.position.set(o.position.x, o.position.y +
        (o.kind === 'mine' || o.kind === 'brood_pool' ? 0.14 : 0.9), o.position.z);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(color);
      mat.opacity = o.critical ? 0.92 : 0.72;
      mesh.rotation.y = reducedMotion ? 0 : snapshot.time * (o.kind === 'prism' ? 1.2 : 0.25);
      mesh.scale.set(1, 0.65 + hp * 0.35, 1);
      if (o.kind === 'crusher_wall') mesh.scale.set(2.8, 2.2, 0.5);
      else if (o.kind === 'cover') mesh.scale.set(2.2, 0.8, 0.55);
      else if (o.critical) mesh.scale.multiplyScalar(pulse);
    });
    this.actors.forEach((mesh, i) => {
      const a = snapshot.actors[i];
      mesh.visible = !!a;
      if (!a) return;
      mesh.geometry = actorGeometry(a.kind);
      const hp = Math.max(0.3, a.maxHp > 0 ? a.hp / a.maxHp : 1);
      mesh.position.set(a.position.x, a.position.y + 0.65, a.position.z);
      mesh.rotation.y = reducedMotion ? 0 : snapshot.time * 2 + i;
      mesh.scale.set(0.8 + hp * 0.2, 0.8 + hp * 0.2, 0.8 + hp * 0.2);
      (mesh.material as THREE.MeshBasicMaterial).color.set(color);
    });
    this.aura.forEach((ring, i) => {
      ring.visible = snapshot.status === 'intro' || snapshot.status === 'active';
      ring.position.set(snapshot.boss.position.x, snapshot.boss.position.y + 0.055 + i * 0.01,
        snapshot.boss.position.z);
      const radius = (i ? 3.4 : 2.2) * (reducedMotion ? 1 : pulse);
      ring.scale.setScalar(radius);
      ring.rotation.z = reducedMotion ? 0 : snapshot.time * (i ? -0.35 : 0.5);
      (ring.material as THREE.MeshBasicMaterial).color.set(color);
    });
  }

  /** Pick a ward/summon with a melee ray; the legacy boss body is picked by Mobs. */
  rayTarget(
    snapshot: EncounterSnapshot | null, origin: THREE.Vector3,
    direction: THREE.Vector3, maxDistance: number,
  ): { id: number; hit: THREE.Vector3 } | null {
    if (!snapshot) return null;
    const ray = new THREE.Ray(origin, direction.clone().normalize());
    const hit = new THREE.Vector3();
    const box = new THREE.Box3();
    let best: { id: number; hit: THREE.Vector3; distance: number } | null = null;
    const consider = (id: number, position: { x: number; y: number; z: number },
      halfWidth: number, height: number): void => {
      box.min.set(position.x - halfWidth, position.y, position.z - halfWidth);
      box.max.set(position.x + halfWidth, position.y + height, position.z + halfWidth);
      if (!ray.intersectBox(box, hit)) return;
      const distance = origin.distanceTo(hit);
      if (distance > maxDistance || (best && distance >= best.distance)) return;
      best = { id, hit: hit.clone(), distance };
    };
    for (const actor of snapshot.actors) consider(actor.id, actor.position, 0.75, 1.5);
    for (const object of snapshot.objects) {
      const wide = object.kind === 'cover' || object.kind === 'crusher_wall';
      consider(object.id, object.position, wide ? 1.8 : 0.85,
        object.kind === 'mine' || object.kind === 'brood_pool' ? 0.6 : 2.2);
    }
    const result = best as { id: number; hit: THREE.Vector3; distance: number } | null;
    return result ? { id: result.id, hit: result.hit } : null;
  }

  /** Point collision for sub-stepped bullets and rockets. */
  targetAtPoint(
    snapshot: EncounterSnapshot | null, point: THREE.Vector3,
  ): { id: number; hit: THREE.Vector3 } | null {
    if (!snapshot) return null;
    for (const actor of snapshot.actors) {
      if (Math.abs(point.x - actor.position.x) <= 0.75 &&
          point.y >= actor.position.y && point.y <= actor.position.y + 1.5 &&
          Math.abs(point.z - actor.position.z) <= 0.75) {
        return { id: actor.id, hit: point.clone() };
      }
    }
    for (const object of snapshot.objects) {
      const wide = object.kind === 'cover' || object.kind === 'crusher_wall';
      const halfWidth = wide ? 1.8 : 0.85;
      const height = object.kind === 'mine' || object.kind === 'brood_pool' ? 0.6 : 2.2;
      if (Math.abs(point.x - object.position.x) <= halfWidth &&
          point.y >= object.position.y && point.y <= object.position.y + height &&
          Math.abs(point.z - object.position.z) <= halfWidth) {
        return { id: object.id, hit: point.clone() };
      }
    }
    return null;
  }

  hide(): void {
    this.root.visible = false;
    for (const pool of [this.hazards, this.objects, this.actors, this.aura]) {
      for (const mesh of pool) mesh.visible = false;
    }
  }
}
