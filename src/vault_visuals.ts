import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { bossSurface } from './boss_surface';
import { BossAttackEffects } from './boss_effects';
import { BossStageEffects } from './boss_stage';
import { bossTextures } from './boss_textures';
import type {
  EncounterActorKind, EncounterHazard, EncounterObjectKind, EncounterSnapshot,
} from './vault_encounter';

const FAMILY_COLOR: Record<EncounterSnapshot['family'], number> = {
  crypt: 0xa66cff, mire: 0x38e0ad, ember: 0xff5b2c,
  crystal: 0x63c8ff, gilded: 0xf2bd3f,
};

const WHITE = new THREE.Color(0xffffff);

const TELEGRAPH_GEOMETRY = {
  circle: new THREE.CircleGeometry(1, 48),
  ring: new THREE.RingGeometry(0.82, 1, 48),
  line: new THREE.PlaneGeometry(1, 1),
  cone: new THREE.CircleGeometry(1, 48, -Math.PI * 0.4, Math.PI * 0.8),
  quadrant: new THREE.CircleGeometry(1, 48, -Math.PI / 2, Math.PI / 2),
};
/** A thin outline for round telegraphs, so the exact edge of the danger is
 *  never a guess at a soft decal's fade. */
const EDGE_GEOMETRY = new THREE.RingGeometry(0.955, 1, 64);
const coneGeometry = new Map<number, THREE.CircleGeometry>();
const ringGeometry = new Map<number, THREE.RingGeometry>();
const OBJECT_GEOMETRY = {
  box: new RoundedBoxGeometry(1.2, 1.8, 1.2, 3, 0.12),
  pillar: new THREE.CylinderGeometry(0.48, 0.65, 2.4, 32),
  prism: new THREE.OctahedronGeometry(0.85, 1),
  pool: new THREE.CylinderGeometry(1.1, 1.1, 0.25, 48),
  mine: new THREE.CylinderGeometry(0.55, 0.7, 0.22, 32),
};
const ACTOR_GEOMETRY = {
  brute: new THREE.SphereGeometry(0.62, 24, 16),
  skitter: new THREE.SphereGeometry(0.5, 24, 16),
  guard: new RoundedBoxGeometry(0.9, 1.0, 0.65, 3, 0.12),
  clone: new THREE.OctahedronGeometry(0.7, 2),
  skeleton: new THREE.CylinderGeometry(0.24, 0.42, 1.0, 24),
  spitter: new THREE.ConeGeometry(0.58, 1.0, 24),
  bog: new THREE.DodecahedronGeometry(0.68, 2),
  ember: new THREE.ConeGeometry(0.5, 1.2, 24),
  magma: new THREE.IcosahedronGeometry(0.7, 2),
  drone: new THREE.TorusGeometry(0.5, 0.16, 12, 40),
};

function hazardGeometry(h: EncounterHazard): THREE.BufferGeometry {
  if (h.shape === 'line') return TELEGRAPH_GEOMETRY.line;
  if (h.shape === 'cone') {
    const key = Math.round(h.angle * 1000);
    let geometry = coneGeometry.get(key);
    if (!geometry) {
      geometry = new THREE.CircleGeometry(1, 48, -h.angle / 2, h.angle);
      coneGeometry.set(key, geometry);
    }
    return geometry;
  }
  if (h.shape === 'quadrant') return TELEGRAPH_GEOMETRY.quadrant;
  if (h.shape === 'ring') {
    const ratio = Math.max(0, Math.min(0.999, (h.radius - h.width) / Math.max(0.01, h.radius + h.width)));
    const key = Math.round(ratio * 1000);
    let geometry = ringGeometry.get(key);
    if (!geometry) {
      geometry = new THREE.RingGeometry(ratio, 1, 48);
      ringGeometry.set(key, geometry);
    }
    return geometry;
  }
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
  if (kind === 'skeleton') return ACTOR_GEOMETRY.skeleton;
  if (kind === 'spitter') return ACTOR_GEOMETRY.spitter;
  if (kind === 'bog_brute') return ACTOR_GEOMETRY.bog;
  if (kind === 'emberling') return ACTOR_GEOMETRY.ember;
  if (kind === 'magma_brute') return ACTOR_GEOMETRY.magma;
  if (kind === 'clockwork_drone') return ACTOR_GEOMETRY.drone;
  if (kind === 'clockwork_guard') return ACTOR_GEOMETRY.guard;
  if (kind === 'mirror_clone') return ACTOR_GEOMETRY.clone;
  return ACTOR_GEOMETRY.brute;
}

/**
 * Fixed-size visual pools for every encounter mechanic. Telegraphs use their
 * real geometry (line/cone/ring/impact), while arena props, summons and the boss aura
 * pulse from authoritative snapshot time. Nothing writes world blocks.
 */
export class VaultEncounterVisuals {
  private readonly root = new THREE.Group();
  private readonly hazards: THREE.Mesh[] = [];
  private readonly effects: BossAttackEffects;
  private readonly stage: BossStageEffects;
  private readonly objects: THREE.Mesh[] = [];
  private readonly actors: THREE.Mesh[] = [];
  private readonly aura: THREE.Mesh[] = [];
  private readonly healingBeams: THREE.Mesh[] = [];
  private readonly seal: THREE.Mesh;
  private readonly moveMarker: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.root.name = 'vault-encounter-visuals';
    scene.add(this.root);
    this.effects = new BossAttackEffects(this.root);
    this.stage = new BossStageEffects(this.root);
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(TELEGRAPH_GEOMETRY.circle, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.58,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 4;
      // The FILL grows from the attack's origin to its full reach over the
      // wind-up, so how long you have left is read off the floor rather than
      // guessed; the EDGE marks the exact boundary.
      const fill = new THREE.Mesh(TELEGRAPH_GEOMETRY.circle, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.3,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      fill.position.z = 0.004;
      fill.renderOrder = 5;
      fill.name = 'fill';
      const edge = new THREE.Mesh(EDGE_GEOMETRY, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      edge.position.z = 0.008;
      edge.renderOrder = 6;
      edge.name = 'edge';
      mesh.add(fill, edge);
      this.root.add(mesh);
      mesh.name = `boss-telegraph-${i}`;
      this.hazards.push(mesh);
    }
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(OBJECT_GEOMETRY.box, bossSurface(0xffffff, true));
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.objects.push(mesh);
    }
    for (let i = 0; i < 32; i++) {
      const mesh = new THREE.Mesh(ACTOR_GEOMETRY.brute, bossSurface(0xffffff));
      mesh.visible = false;
      mesh.renderOrder = 3;
      // Small articulated silhouettes replace floating placeholder polyhedra.
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), mesh.material);
      face.position.set(0, 0.62, 0.1); mesh.add(face);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8),
          new THREE.MeshBasicMaterial({color: 0xffedbd}));
        eye.position.set(side * 0.11, 0.68, 0.34); mesh.add(eye);
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.32, 4, 12), mesh.material);
        leg.position.set(side * 0.28, -0.4, 0); mesh.add(leg);
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.4, 4, 12), mesh.material);
        arm.position.set(side * 0.47, 0.02, 0.05); arm.rotation.z = side * 0.3; mesh.add(arm);
      }
      this.root.add(mesh);
      this.actors.push(mesh);
    }
    for (let i = 0; i < 8; i++) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.09, 1, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62,
          depthWrite: false }));
      beam.visible = false; beam.renderOrder = 3; this.root.add(beam);
      this.healingBeams.push(beam);
    }
    this.seal = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5,
        depthWrite: false }));
    this.seal.visible = false; this.seal.renderOrder = 4; this.root.add(this.seal);
    this.moveMarker = new THREE.Mesh(new THREE.RingGeometry(0.76, 1, 36),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.68,
        side: THREE.DoubleSide, depthWrite: false }));
    this.moveMarker.rotation.x = -Math.PI / 2; this.moveMarker.visible = false;
    this.moveMarker.renderOrder = 4; this.root.add(this.moveMarker);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(i ? 0.84 : 0.9, 1, 48),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: i ? 0.06 : 0.12,
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
    this.effects.update(snapshot, reducedMotion);
    this.stage.update(snapshot, color, reducedMotion);
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
      mat.opacity = highContrast ? 0.8 : snapshot.time >= h.executeAt ? 0.16 : 0.13 + urgency * 0.17;
      const [fill, edge] = mesh.children as THREE.Mesh[];
      const windup = Math.max(0.05, h.executeAt - h.telegraphAt);
      const progress = Math.max(0, Math.min(1, (snapshot.time - h.telegraphAt) / windup));
      const since = snapshot.time - h.executeAt;
      fill.geometry = mesh.geometry;
      fill.position.y = 0;
      fill.scale.set(1, 1, 1);
      if (h.shape === 'line') {
        // Local +y runs from the origin toward the target: grow along it.
        fill.scale.set(1, Math.max(0.001, progress), 1);
        fill.position.y = -0.5 + progress / 2;
      } else if (h.shape !== 'ring') {
        fill.scale.set(Math.max(0.001, progress), Math.max(0.001, progress), 1);
      }
      const fillMat = fill.material as THREE.MeshBasicMaterial;
      fillMat.color.set(highContrast ? 0xffffff : color).lerp(WHITE, progress * progress * 0.55);
      fillMat.opacity = since >= 0
        ? Math.max(0, 0.75 * (1 - since / 0.3))      // the strike: a white flash
        : (h.shape === 'ring' ? 0.08 + progress * 0.3 : 0.2 + progress * 0.22);
      if (since >= 0) fillMat.color.copy(WHITE);
      edge.visible = h.shape === 'circle' || h.shape === 'ring' || h.shape === 'rain';
      const edgeMat = edge.material as THREE.MeshBasicMaterial;
      edgeMat.color.set(highContrast ? 0xffffff : color).lerp(WHITE, 0.35 + urgency * 0.5);
      edgeMat.opacity = since >= 0 ? Math.max(0, 0.9 * (1 - since / 0.25))
        : 0.45 + urgency * 0.45 * (reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(snapshot.time * 24));
      mesh.rotation.set(-Math.PI / 2, 0, 0);
      mesh.position.set(h.origin.x, h.origin.y + 0.045, h.origin.z);
      if (h.shape === 'line') {
        const target = h.target ?? { x: h.origin.x + 1, z: h.origin.z };
        const dx = target.x - h.origin.x, dz = target.z - h.origin.z;
        const len = Math.max(0.01, Math.hypot(dx, dz));
        mesh.position.x += dx / len * h.radius / 2;
        mesh.position.z += dz / len * h.radius / 2;
        mesh.rotation.z = -Math.atan2(dz, dx) - Math.PI / 2;
        mesh.scale.set(Math.max(0.1, h.width), Math.max(0.2, h.radius), 1);
      } else {
        const s = Math.max(0.2, h.radius + (h.shape === 'ring' ? h.width : 0));
        mesh.scale.set(s, s, 1);
        if (h.shape === 'cone' && h.target) {
          mesh.rotation.z = -Math.atan2(
            h.target.z - h.origin.z, h.target.x - h.origin.x,
          );
        } else if (h.shape === 'quadrant') {
          mesh.rotation.z = -(h.id & 3) * Math.PI / 2;
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
      const mat = mesh.material as THREE.MeshMatcapMaterial;
      if (mat.userData.family !== snapshot.kind) {
        const textures = bossTextures(snapshot.kind, true);
        mat.map = textures.map; mat.bumpMap = textures.bumpMap; mat.bumpScale = 0.04;
        mat.userData.family = snapshot.kind; mat.needsUpdate = true;
      }
      mat.color.set(color);
      // Critical styling remains for snapshot compatibility. Current boss
      // phases only use temporary props, which sit flat and never gate damage.
      if (o.critical && !reducedMotion) {
        mat.color.lerp(WHITE, 0.3 + Math.sin(snapshot.time * 5.5 + i) * 0.28);
      } else if (o.critical) {
        mat.color.lerp(WHITE, 0.3);
      }
      mat.opacity = o.critical ? 0.96 : 0.72;
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
      const previous = mesh.userData.actorPosition as THREE.Vector3 | undefined;
      if (previous && mesh.userData.actorId === a.id) {
        const dx = a.position.x - previous.x, dz = a.position.z - previous.z;
        if (Math.hypot(dx, dz) > 0.005) mesh.rotation.y = Math.atan2(dx, dz);
      } else mesh.rotation.y = 0;
      mesh.userData.actorPosition ??= new THREE.Vector3();
      mesh.userData.actorPosition.set(a.position.x, a.position.y, a.position.z);
      mesh.userData.actorId = a.id;
      for (const part of mesh.children) {
        if (part.position.y < 0) part.rotation.x = reducedMotion ? 0 :
          Math.sin(snapshot.time * 7 + Math.sign(part.position.x) * 1.5) * 0.3;
      }
      mesh.scale.set(0.8 + hp * 0.2, 0.8 + hp * 0.2, 0.8 + hp * 0.2);
      const skin = mesh.material as THREE.MeshMatcapMaterial;
      if (skin.userData.family !== snapshot.kind) {
        const textures = bossTextures(snapshot.kind, false);
        skin.map = textures.map; skin.bumpMap = textures.bumpMap; skin.bumpScale = 0.04;
        skin.userData.family = snapshot.kind; skin.needsUpdate = true;
      }
      skin.color.set(color);
    });
    const critical = snapshot.objects.filter((o) => o.critical && o.hp > 0);
    this.healingBeams.forEach((beam, i) => {
      const source = snapshot.healing.active ? critical[i] : undefined;
      beam.visible = !!source;
      if (!source) return;
      const a = new THREE.Vector3(source.position.x, source.position.y + 1,
        source.position.z);
      const b = new THREE.Vector3(snapshot.boss.position.x,
        snapshot.boss.position.y + 1.2, snapshot.boss.position.z);
      const d = b.clone().sub(a); const len = Math.max(0.01, d.length());
      beam.position.copy(a).addScaledVector(d, 0.5);
      beam.scale.set(1, len, 1);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      const mat = beam.material as THREE.MeshBasicMaterial;
      mat.color.set(color); mat.opacity = reducedMotion ? 0.5 : 0.48 +
        Math.sin(snapshot.time * 10 + i) * 0.14;
    });
    const seal = snapshot.seal.geometry;
    this.seal.visible = snapshot.seal.sealed && !!seal;
    if (seal) {
      this.seal.position.set(seal.center.x, seal.center.y + seal.height / 2, seal.center.z);
      this.seal.rotation.set(0, seal.axis === 'z' ? Math.PI / 2 : 0, 0);
      this.seal.scale.set(1, seal.height, seal.halfWidth * 2);
      const mat = this.seal.material as THREE.MeshBasicMaterial;
      mat.color.set(highContrast ? 0xffffff : color);
      mat.opacity = reducedMotion ? 0.48 : 0.42 + Math.sin(snapshot.time * 8) * 0.12;
    }
    this.moveMarker.visible = !!snapshot.movement;
    if (snapshot.movement) {
      this.moveMarker.position.set(snapshot.movement.to.x, snapshot.movement.to.y + 0.07,
        snapshot.movement.to.z);
      const left = Math.max(0, snapshot.movement.executeAt - snapshot.time);
      const size = 1.3 + Math.min(1, left) * 0.7;
      this.moveMarker.scale.setScalar(size);
      (this.moveMarker.material as THREE.MeshBasicMaterial).color.set(color);
    }
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

  /** Pick an arena prop/summon with a melee ray; the boss body is picked by Mobs. */
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
    return null;
  }

  hide(): void {
    this.root.visible = false;
    this.effects.clear();
    this.stage.hide();
    this.seal.visible = false;
    this.moveMarker.visible = false;
    for (const pool of [this.hazards, this.objects, this.actors, this.aura, this.healingBeams]) {
      for (const mesh of pool) mesh.visible = false;
    }
  }
}
