import * as THREE from 'three';
import { ParkourScenery } from './parkour_scenery';
import {
  BRIDGE_ARROW_GRAVITY, BRIDGE_ARROW_LIFE_MS, BRIDGE_CAGE_FLOOR, BRIDGE_CAGE_ROOF, BRIDGE_GOALS,
  BRIDGE_GOAL_RESET_MS, PARTY_COUNTDOWN_MS, PARTY_FLOOR_Y,
  bridgeCageSpawn, bridgeSpawn, parkourCourse, type PartyLobbySnapshot,
} from './partygames';
import {
  BLINK_WARN_MS, blinkSolid, blinkWarning, COLLAPSE_GRACE_MS, parkourCollapseFront, parkourVoidY,
} from './parkour_mechanics';

/** The unit torus (tube included) is scaled by the marker radius. */
const RING_TUBE = .08;
/** One arrow being drawn. The server owns whether it hit anything; this is the
 *  same launch integrated with the same gravity, purely so the shot is a thing
 *  you can watch, lead and duck. */
interface DrawnArrow {
  id: number;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}
/** Presentation only: every marker is derived from the server snapshot and the
 * server clock. No animation callback changes scores or terrain. */
export class PartyVisuals {
  private readonly scenery: ParkourScenery;
  private readonly root = new THREE.Group();
  private readonly boxes: THREE.Mesh[] = [];
  private readonly rings: THREE.Mesh[] = [];
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly ringGeometry = new THREE.TorusGeometry(1, RING_TUBE, 8, 32);
  /** Crimson and cobalt, matching the wool each side builds with. */
  static readonly TEAM_COLOR = [0xff5f76, 0x5aa8ff];
  private readonly arrows: DrawnArrow[] = [];
  private readonly arrowGeometry = new THREE.BoxGeometry(.07, .07, .9);
  private readonly arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xf2e4c4 });
  private readonly arrowRoot = new THREE.Group();
  constructor(scene: THREE.Scene) {
    this.scenery = new ParkourScenery(scene);
    scene.add(this.root);
    scene.add(this.arrowRoot);
    this.root.visible = false;
  }
  clear(): void { this.root.visible = false; this.scenery.clear(); this.clearArrows(); }
  clearArrows(): void {
    for (const a of this.arrows) this.arrowRoot.remove(a.mesh);
    this.arrows.length = 0;
  }
  /** An arrow left somebody's bow. */
  spawnArrow(a: { id: number; x: number; y: number; z: number; dx: number; dy: number; dz: number; speed: number }): void {
    const mesh = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial);
    mesh.position.set(a.x, a.y, a.z);
    this.arrowRoot.add(mesh);
    this.arrows.push({
      id: a.id, mesh,
      pos: new THREE.Vector3(a.x, a.y, a.z),
      vel: new THREE.Vector3(a.dx, a.dy, a.dz).multiplyScalar(a.speed),
      life: BRIDGE_ARROW_LIFE_MS / 1000,
    });
  }
  /** The server says that arrow is finished. */
  endArrow(id: number): void {
    const i = this.arrows.findIndex(a => a.id === id);
    if (i < 0) return;
    this.arrowRoot.remove(this.arrows[i].mesh);
    this.arrows.splice(i, 1);
  }
  /** Fly what is in the air. Presentation only — nothing here damages anyone,
   *  and an arrow the server has not ended simply times out on its own. */
  updateArrows(dt: number): void {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.vel.y -= BRIDGE_ARROW_GRAVITY * dt;
      a.pos.addScaledVector(a.vel, dt);
      a.mesh.position.copy(a.pos);
      // Point the shaft along the flight, so the arc reads as an arc.
      a.mesh.lookAt(a.pos.clone().add(a.vel));
      a.life -= dt;
      if (a.life <= 0) {
        this.arrowRoot.remove(a.mesh);
        this.arrows.splice(i, 1);
      }
    }
  }
  private marker(index: number, ring = false): THREE.Mesh {
    const pool = ring ? this.rings : this.boxes;
    if (!pool[index]) {
      pool[index] = new THREE.Mesh(ring ? this.ringGeometry : this.boxGeometry, new THREE.MeshBasicMaterial({ color: 0xffd25e, transparent: true, opacity: .5, depthWrite: false }));
      this.root.add(pool[index]);
    }
    return pool[index];
  }
  /** Cage fields are seen from INSIDE, so their marker boxes draw both faces. */
  private twoSided(index: number): void {
    const mat = this.marker(index).material as THREE.MeshBasicMaterial;
    if (mat.side !== THREE.DoubleSide) { mat.side = THREE.DoubleSide; mat.needsUpdate = true; }
  }
  update(s: PartyLobbySnapshot, me: number, now: number): void {
    const sub = s.sub, round = s.round;
    if (sub && round && s.phase !== 'lobby')
      this.scenery.update(sub, now);
    else
      this.scenery.clear();
    this.root.visible = !!sub && !!round && s.phase !== 'results' && s.phase !== 'lobby';
    if (!this.root.visible || !sub || !round)
      return;
    this.root.position.set(sub.minX, 0, sub.minZ);
    for (const m of [...this.boxes, ...this.rings])
      if (m)
        m.visible = false;
    const mine = s.participants.find(p => p.id === me);
    const box = (i: number, x: number, y: number, z: number, w: number, h: number, d: number, color: number, opacity = .4) => {
      const m = this.marker(i);
      m.rotation.set(0, 0, 0);
      m.visible = true;
      m.position.set(x, y, z);
      m.scale.set(w, h, d);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color);
      mat.opacity = opacity;
    };
    const ring = (i: number, x: number, y: number, z: number, radius: number, color: number, opacity = .9) => {
      const m = this.marker(i, true);
      m.visible = true;
      m.position.set(x, y, z);
      m.scale.setScalar(radius);
      (m.material as THREE.MeshBasicMaterial).color.setHex(color);
      (m.material as THREE.MeshBasicMaterial).opacity = opacity;
      m.rotation.set(-Math.PI / 2, 0, 0);
    };
    const pulse = .6 + .25 * Math.sin(now / 180);
    if (round.game === 'parkour') {
      const course = parkourCourse(sub.seed), next = (mine?.progress ?? 0) + 1;
      const t = s.phase === 'running' ? now - round.startedAt : -1;
      const { mode } = course.variant;
      let rings = 0, boxes = 0;
      const centre = (p: typeof course.platforms[number]) => ({
        x: Math.floor(p.x - p.width / 2) + p.width / 2, z: Math.floor(p.z - p.depth / 2) + p.depth / 2,
      });
      course.platforms.forEach((p) => {
        if (p.order < next || (!p.checkpoint && p.order !== next))
          return;
        // The ring has to stay ON the pad it is marking. A one-block stepping
        // stone is narrower than the marker used to be, so a fixed radius drew
        // a circle hanging out over the void — which reads as somewhere you
        // could land. Fit it inside the footprint (the torus' own tube included)
        // and it always describes real ground. At a fork, both branches glow.
        const { x, z } = centre(p);
        const fit = (Math.min(p.width, p.depth) / 2 - .08) / (1 + RING_TUBE);
        ring(rings++, x, p.y + .12, z, Math.min(p.order === next ? 1.2 : .8, fit),
          p.order === next ? 0x72ffcb : 0xffd25e);
        if (p.order === next)
          box(boxes++, x, p.y + 2, z, .18, 4, .18, 0x72ffcb, pulse);
      });
      for (const p of course.platforms) {
        const { x, z } = centre(p);
        // A throw pad shows which way it throws: a tall pillar of light for a
        // launch, a long streak along the ground for a boost.
        if (p.kind === 'launch')
          box(boxes++, x, p.y + 2.5, z, .5, 5, .5, 0x78ecff, .18 + .12 * pulse);
        else if (p.kind === 'boost') {
          const along = p.heading % 2 ? [3.2, .12, .5] : [.5, .12, 3.2];
          const [dx, dz] = [[0, 1], [1, 0], [0, -1], [-1, 0]][p.heading];
          box(boxes++, x + dx * 1.6, p.y + .1, z + dz * 1.6, along[0], along[1], along[2], 0xffc454, .35 + .2 * pulse);
        } else if (p.kind === 'blink' && t >= 0) {
          // A blink stone that is about to go flickers first; one that is
          // gone leaves a faint outline of where it will be.
          if (blinkWarning(p.group, t))
            box(boxes++, x, p.y - .5, z, p.width + .08, 1.08, p.depth + .08, 0xff5a6e, (Math.floor(now / 90) % 2) ? .55 : .15);
          else if (!blinkSolid(p.group, t))
            box(boxes++, x, p.y - .5, z, p.width, 1, p.depth, 0x7bffb0, blinkSolid(p.group, t + BLINK_WARN_MS) ? .3 : .08);
        }
      }
      if (mode === 'void' && t >= 0) {
        // The void: a sheet across the whole venue at the kill height.
        const y = parkourVoidY(course, t), w = sub.maxX - sub.minX, l = sub.maxZ - sub.minZ;
        box(boxes++, w / 2, y, l / 2, w + 40, .06, l + 40, 0x3a1450, .75);
        box(boxes++, w / 2, y + .4 + .15 * Math.sin(now / 300), l / 2, w + 40, .04, l + 40, 0xb04cff, .25);
      }
      if (mode === 'collapse' && t >= COLLAPSE_GRACE_MS) {
        // The collapse front: a curtain across the route at the pad it has reached.
        const front = parkourCollapseFront(t), step = course.steps[Math.min(course.steps.length - 1, Math.floor(front))]?.[0];
        if (step) {
          const { x, z } = centre(step);
          box(boxes++, x, step.y - 3, z, step.width + 6, 12, step.depth + 6, 0xff6a3a, .12 + .06 * pulse);
        }
      }
      return;
    }
    // The Bridge: the portal you are attacking gets a beam you can line up on
    // from your own deck; the one you are defending gets a quiet ring.
    const team = mine?.team ?? 0;
    BRIDGE_GOALS.forEach((g, i) => {
      const x = (g.minX + g.maxX) / 2, z = (g.minZ + g.maxZ) / 2;
      const target = g.team !== team;
      const color = PartyVisuals.TEAM_COLOR[g.team];
      // Sized to the portal collar, not to the old venue: the ring has to sit
      // on the gilded rim rather than out over the deck around it.
      ring(i, x, PARTY_FLOOR_Y + .12, z, target ? 2.4 : 1.8, color, target ? .95 : .45);
      box(i, x, PARTY_FLOOR_Y + (target ? 11 : 4), z, target ? .5 : .25, target ? 22 : 8, target ? .5 : .25,
        color, target ? pulse : .2);
      if (target)
        ring(2 + i, x, PARTY_FLOOR_Y + .12, z, 2.4 + (now % 1400) / 1400 * 1.8, color, .5 - (now % 1400) / 2800);
    });
    // THE CAGES. While a round is held — the opening countdown, and the three
    // seconds after every goal — both pods wear a humming force field in their
    // team's colour, and a ring on the hatch shrinks toward the drop, so
    // "how long until I fall" is read off the floor of the cage you are in.
    const heldUntil = s.phase === 'countdown' ? s.countdownEndsAt
      : s.goalResetAt && now < s.goalResetAt ? s.goalResetAt : undefined;
    if (heldUntil !== undefined && heldUntil > now) {
      const span = s.phase === 'countdown' ? PARTY_COUNTDOWN_MS : BRIDGE_GOAL_RESET_MS;
      const left = Math.max(0, Math.min(1, (heldUntil - now) / span));
      const hum = .5 + .5 * Math.sin(now / 90);
      for (const t of [0, 1]) {
        const c = bridgeCageSpawn(sub, t, 0);
        const cx = c.x - sub.minX, cz = c.z - sub.minZ;
        const floor = PARTY_FLOOR_Y + BRIDGE_CAGE_FLOOR + 1, roof = PARTY_FLOOR_Y + BRIDGE_CAGE_ROOF;
        const color = PartyVisuals.TEAM_COLOR[t];
        this.twoSided(5 + t);
        box(5 + t, cx, (floor + roof) / 2, cz, 5.25, roof - floor + .3, 5.25, color,
          (t === team ? .16 : .1) + .08 * hum + (1 - left) * .12);
        ring(4 + t, cx, floor + .06, cz, .3 + 2.1 * left, t === team ? 0xffffff : color, .55 + .35 * hum);
      }
    }
    // Your own base glows underfoot while a goal is being reset, so the pause
    // reads as "everyone is home" rather than "the game stopped".
    if (s.goalResetAt && now < s.goalResetAt) {
      const home = BRIDGE_GOALS.find(g => g.team === team);
      if (home)
        box(4, (home.minX + home.maxX) / 2, PARTY_FLOOR_Y + 1.04,
          bridgeSpawn(sub, team, 0).z - sub.minZ, 9, .08, 5,
          PartyVisuals.TEAM_COLOR[team], .4);
    }
  }
}
