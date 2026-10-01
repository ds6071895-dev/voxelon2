// The dragon of Dragon Chase, and its fire — presentation only.
//
// The server owns where the dragon is (a course order, `front`) and whom its
// fire hits. This draws it: a jointed voxel rig whose neck, body and tail
// follow the head along its own flight trail, so it snakes round the course
// the way it flew, wings beating and jaw opening as it breathes. Fireballs
// are drawn along the same lob the server resolves, with a warning ring on
// the ground where each one will come down.
import * as THREE from 'three';
import { box, joint } from './ratseek_models';
import type { ParkourCourse } from './parkour_course';
import {
  DRAGON_GRACE_MS, DRAGON_LAIR_FRONT, FIREBALL_RADIUS, dragonPoint, fireballAt,
} from './parkour_mechanics';
import type { Particles } from './particles';
import type { ParkourTheme } from './parkour_themes';

interface Segment { group: THREE.Group; at: number }
interface Flight {
  id: number;
  to: THREE.Vector3;
  from: THREE.Vector3 | null;
  launchAt: number;
  landAt: number;
  ball: THREE.Mesh;
  ring: THREE.Mesh;
  disc: THREE.Mesh;
}

/** What the dragon did this frame, for sound and camera. */
export interface DragonEvents {
  roar?: THREE.Vector3;
  wing?: THREE.Vector3;
  breath?: THREE.Vector3;
  impacts: THREE.Vector3[];
}

const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0xffe36b });
const FIRE_MAT = new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false });
const CORE_MAT = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
const RING_MAT = new THREE.MeshBasicMaterial({ color: 0xff3b2e, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide });
const DISC_MAT = new THREE.MeshBasicMaterial({ color: 0xff5a2e, transparent: true, opacity: .25, depthWrite: false, side: THREE.DoubleSide });

export class DragonView {
  private readonly root = new THREE.Group();
  private readonly model = new THREE.Group();
  private head: THREE.Group | null = null;
  private jaw: THREE.Group | null = null;
  private segments: Segment[] = [];
  private wings: { shoulder: THREE.Group; elbow: THREE.Group; side: number }[] = [];
  private legs: THREE.Group[] = [];
  private course: ParkourCourse | null = null;
  private offset = new THREE.Vector3();
  /** Server's word on the dragon, and the front we are showing. */
  private front = DRAGON_LAIR_FRONT;
  private shown = DRAGON_LAIR_FRONT;
  private speed = 0;
  private syncAt = 0;
  /** Head positions, newest first, for the body to follow. */
  private trail: THREE.Vector3[] = [];
  private readonly headPos = new THREE.Vector3();
  private flights: Flight[] = [];
  private flap = 0;
  private lastFlapSign = 1;
  private awake = false;
  private breathUntil = 0;
  private readonly ballGeo = new THREE.IcosahedronGeometry(.7, 1);
  private readonly coreGeo = new THREE.IcosahedronGeometry(.38, 0);
  private readonly ringGeo = new THREE.TorusGeometry(FIREBALL_RADIUS, .09, 6, 40);
  private readonly discGeo = new THREE.CircleGeometry(FIREBALL_RADIUS, 32);
  private emitAcc = 0;

  constructor(scene: THREE.Scene, private readonly particles: Particles) {
    scene.add(this.root);
    this.root.add(this.model);
    this.root.visible = false;
  }

  /** A new run: build the dragon in this world's colours and put it to bed. */
  enter(course: ParkourCourse, theme: ParkourTheme, minX: number, minZ: number): void {
    this.clear();
    this.course = course;
    this.offset.set(minX, 0, minZ);
    this.build(theme.dragon);
    this.front = this.shown = DRAGON_LAIR_FRONT;
    this.speed = 0;
    this.syncAt = 0;
    this.awake = false;
    this.trail = [];
    this.root.visible = true;
  }
  clear(): void {
    for (const f of this.flights) this.dropFlight(f);
    this.flights = [];
    this.model.clear();
    this.segments = [];
    this.wings = [];
    this.legs = [];
    this.head = this.jaw = null;
    this.course = null;
    this.root.visible = false;
  }
  /** The server's position report. */
  sync(front: number, speed: number, at: number): void {
    this.front = front;
    this.speed = speed;
    this.syncAt = at;
  }
  /** The dragon breathes at someone. */
  fireball(f: { id: number; tx: number; ty: number; tz: number; launchAt: number; landAt: number }): void {
    const ball = new THREE.Mesh(this.ballGeo, FIRE_MAT);
    ball.add(new THREE.Mesh(this.coreGeo, CORE_MAT));
    ball.visible = false;
    const ring = new THREE.Mesh(this.ringGeo, RING_MAT.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(f.tx, f.ty + .08, f.tz);
    const disc = new THREE.Mesh(this.discGeo, DISC_MAT.clone());
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(f.tx, f.ty + .06, f.tz);
    this.root.add(ball, ring, disc);
    this.flights.push({ id: f.id, to: new THREE.Vector3(f.tx, f.ty, f.tz), from: null, launchAt: f.launchAt, landAt: f.landAt, ball, ring, disc });
    this.breathUntil = f.launchAt + 250;
  }
  /** Where the head is drawn (world space). */
  headPosition(): THREE.Vector3 { return this.headPos; }
  /** The front the dragon is shown at (course order). */
  shownFront(): number { return this.shown; }

  update(dt: number, serverNow: number, startedAt: number | null, reducedMotion: boolean): DragonEvents {
    const events: DragonEvents = { impacts: [] };
    if (!this.course || !this.head) return events;
    // Where the server says it is now, eased into so a correction never jumps.
    const target = this.syncAt ? this.front + this.speed * Math.max(0, Math.min(.6, (serverNow - this.syncAt) / 1000)) : this.front;
    this.shown += (target - this.shown) * Math.min(1, dt * 5);
    const t = startedAt === null ? -1 : serverNow - startedAt;
    const flying = t >= DRAGON_GRACE_MS;
    if (flying && !this.awake) { this.awake = true; events.roar = this.headPos.clone(); }
    if (!flying) this.awake = false;
    const p = dragonPoint(this.course, this.shown);
    const bob = flying ? Math.sin(serverNow / 520) * .8 : Math.sin(serverNow / 900) * .15;
    const want = new THREE.Vector3(p.x, p.y + bob, p.z).add(this.offset);
    if (!this.trail.length) this.headPos.copy(want);
    else this.headPos.lerp(want, Math.min(1, dt * 8));
    if (!this.trail.length || this.trail[0].distanceTo(this.headPos) > .12) {
      this.trail.unshift(this.headPos.clone());
      let len = 0;
      for (let i = 1; i < this.trail.length; i++) {
        len += this.trail[i].distanceTo(this.trail[i - 1]);
        if (len > 26) { this.trail.length = i + 1; break; }
      }
    }
    // Head, neck, body and tail along the trail.
    const breathing = serverNow < this.breathUntil;
    for (const s of this.segments) {
      const at = this.trailAt(s.at), ahead = this.trailAt(s.at - .7);
      s.group.position.copy(at);
      s.group.lookAt(ahead);
    }
    this.model.position.set(0, 0, 0);
    // Wings: folded in the lair, beating in the air.
    const rate = flying ? 4.2 + Math.min(3, this.speed * 1.6) : .8;
    this.flap += dt * rate;
    const beat = Math.sin(this.flap);
    for (const w of this.wings) {
      if (flying) {
        w.shoulder.rotation.z = w.side * (.25 + .6 * beat);
        w.elbow.rotation.z = w.side * (.1 + .45 * Math.sin(this.flap - .9));
        w.shoulder.rotation.y = 0;
      } else {
        w.shoulder.rotation.z = w.side * (-.35 + .05 * beat);
        w.shoulder.rotation.y = -w.side * .9;
        w.elbow.rotation.z = -w.side * 1.4;
      }
    }
    if (flying && Math.sign(beat) !== this.lastFlapSign) {
      this.lastFlapSign = Math.sign(beat);
      if (beat < 0) events.wing = this.headPos.clone();
    }
    for (const leg of this.legs) leg.rotation.x = flying ? 1.1 : .2 + .05 * beat;
    if (this.jaw) {
      const open = breathing ? .75 : flying ? .12 + .06 * Math.sin(serverNow / 300) : .05;
      this.jaw.rotation.x += (open - this.jaw.rotation.x) * Math.min(1, dt * 10);
    }
    // Smoke from the nostrils, embers while it breathes.
    this.emitAcc += dt;
    if (this.emitAcc > (breathing ? .03 : .18)) {
      this.emitAcc = 0;
      const mouth = this.mouth();
      if (breathing) this.particles.burst(mouth.x, mouth.y, mouth.z, 3, 0xffa23a, 3, .4, { gravity: -2, spread: .5, scale: 1.4, additive: true });
      else if (flying && !reducedMotion) this.particles.burst(mouth.x, mouth.y + .3, mouth.z, 1, 0x6b6470, 1, .9, { gravity: -2, spread: .3, scale: 1.2 });
    }
    // Fire.
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      const warn = Math.max(0, Math.min(1, 1 - (f.landAt - serverNow) / (f.landAt - f.launchAt + 450)));
      (f.ring.material as THREE.MeshBasicMaterial).opacity = .45 + .45 * Math.abs(Math.sin(serverNow / 80));
      f.disc.scale.setScalar(.15 + .85 * warn);
      (f.disc.material as THREE.MeshBasicMaterial).opacity = .15 + .3 * warn;
      if (serverNow >= f.launchAt && !f.from) {
        f.from = this.mouth();
        events.breath = f.from.clone();
      }
      if (f.from && serverNow < f.landAt) {
        const k = Math.max(0, Math.min(1, (serverNow - f.launchAt) / (f.landAt - f.launchAt)));
        const q = fireballAt(f.from, f.to, k);
        f.ball.visible = true;
        f.ball.position.set(q.x, q.y, q.z);
        f.ball.rotation.y += dt * 9;
        f.ball.scale.setScalar(.8 + .25 * Math.sin(serverNow / 40));
        if (!reducedMotion) this.particles.burst(q.x, q.y, q.z, 1, Math.random() < .5 ? 0xff7a1a : 0xffd04a, 1.5, .5, { gravity: -1, spread: .35, scale: 1.3, additive: true });
      }
      if (serverNow >= f.landAt) {
        const at = f.to.clone();
        this.particles.burst(at.x, at.y + .4, at.z, 34, 0xff7a1a, 8, .7, { gravity: 6, spread: 1.2, scale: 1.5, additive: true });
        this.particles.burst(at.x, at.y + .4, at.z, 18, 0xffe08a, 5, .5, { gravity: 4, spread: .8, scale: 1.1, additive: true });
        this.particles.burst(at.x, at.y + .8, at.z, 14, 0x4a4450, 2.5, 1.3, { gravity: -2.5, spread: 1.4, scale: 2 });
        events.impacts.push(at);
        this.dropFlight(f);
        this.flights.splice(i, 1);
      }
    }
    return events;
  }

  private dropFlight(f: Flight): void {
    this.root.remove(f.ball, f.ring, f.disc);
    (f.ring.material as THREE.Material).dispose();
    (f.disc.material as THREE.Material).dispose();
  }

  /** The point `s` blocks back along the trail. Past its end the trail runs
   *  straight on the way it was going (into the cave, at the start). */
  private trailAt(s: number): THREE.Vector3 {
    const tr = this.trail;
    if (!tr.length) return this.headPos.clone();
    if (s <= 0) {
      const dir = tr.length > 1 ? tr[0].clone().sub(tr[1]).normalize() : new THREE.Vector3(0, 0, 1);
      return tr[0].clone().addScaledVector(dir, -s);
    }
    let left = s;
    for (let i = 1; i < tr.length; i++) {
      const d = tr[i].distanceTo(tr[i - 1]);
      if (d >= left) return tr[i - 1].clone().lerp(tr[i], left / d);
      left -= d;
    }
    const last = tr[tr.length - 1];
    const dir = tr.length > 1 ? last.clone().sub(tr[tr.length - 2]).normalize() : new THREE.Vector3(0, 0, -1);
    return last.clone().addScaledVector(dir, left);
  }

  private mouth(): THREE.Vector3 {
    if (!this.head) return this.headPos.clone();
    return this.head.localToWorld(new THREE.Vector3(0, -.2, 2.3));
  }

  /** The rig. Every segment faces +z (it is turned to look along the trail). */
  private build(c: ParkourTheme['dragon']): void {
    const BODY = c.body, BELLY = c.belly, WING = c.wing, DARK = new THREE.Color(c.body).multiplyScalar(.6).getHex();
    const HORN = 0xe8dcc0;
    const eye = EYE_MAT.clone();
    eye.color.setHex(c.eye);
    const seg = (at: number): THREE.Group => {
      const g = new THREE.Group();
      this.model.add(g);
      this.segments.push({ group: g, at });
      return g;
    };
    // Head.
    const head = seg(0);
    this.head = head;
    box(head, 1.5, 1.15, 1.7, BODY, 0, 0, 0);
    box(head, 1.1, .75, 1.5, BODY, 0, -.12, 1.35);
    box(head, 1.15, .18, 1.2, DARK, 0, .45, .6);
    for (const s of [-1, 1]) {
      box(head, .3, .22, .12, c.eye, s * .6, .28, .7, eye);
      box(head, .22, .2, .2, DARK, s * .28, .12, 2.05);
      const horn = joint(head, s * .5, .55, -.5);
      box(horn, .22, .22, 1.3, HORN, 0, 0, -.6);
      box(horn, .14, .14, .6, HORN, 0, .1, -1.4);
      horn.rotation.x = .55;
      horn.rotation.y = s * .25;
      for (let k = 0; k < 3; k++) box(head, .12, .25, .12, 0xffffff, s * .38, -.45, 1.2 + k * .35);
    }
    const jaw = joint(head, 0, -.5, .1);
    box(jaw, 1.0, .3, 1.9, BELLY, 0, -.1, 1.0);
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) box(jaw, .1, .2, .1, 0xffffff, s * .36, .12, 1.3 + k * .35);
    this.jaw = jaw;
    // Neck.
    for (let i = 0; i < 4; i++) {
      const g = seg(1.4 + i * 1.05);
      const w = 1.05 + i * .12;
      box(g, w, w * .95, 1.25, BODY, 0, 0, 0);
      box(g, w * .7, .15, 1.1, BELLY, 0, -w * .48, 0);
      box(g, .2, .38, .45, DARK, 0, w * .55, 0);
    }
    // Body, with the wings and legs.
    const chest = seg(6.0), hips = seg(7.9);
    for (const [g, w, h] of [[chest, 2.3, 1.8], [hips, 2.0, 1.6]] as const) {
      box(g, w, h, 2.1, BODY, 0, 0, 0);
      box(g, w * .7, .2, 1.9, BELLY, 0, -h * .5, 0);
      for (const z of [-.5, .5]) box(g, .25, .55, .5, DARK, 0, h * .55, z);
    }
    for (const [g, z] of [[chest, .4], [hips, -.3]] as const)
      for (const s of [-1, 1]) {
        const hip = joint(g, s * .85, -.7, z);
        box(hip, .45, 1.0, .5, BODY, 0, -.4, 0);
        const foot = joint(hip, 0, -.9, 0);
        box(foot, .4, .25, .7, DARK, 0, -.1, .2);
        this.legs.push(hip);
      }
    for (const s of [-1, 1]) {
      const shoulder = joint(chest, s * 1.1, .6, .4);
      box(shoulder, 3.8, .35, .35, DARK, s * 1.9, 0, 0);
      const elbow = joint(shoulder, s * 3.8, 0, 0);
      box(elbow, 3.6, .28, .28, DARK, s * 1.8, 0, 0);
      box(elbow, .25, .25, 1.2, HORN, s * 3.6, 0, .4);
      // Membrane: panels stepping back from the arm and the finger.
      for (let k = 0; k < 4; k++) box(shoulder, .95, .07, 3.3 - k * .2, WING, s * (.55 + k * .95), -.05, -1.75 + k * .1);
      for (let k = 0; k < 4; k++) box(elbow, .9, .07, 2.4 - k * .55, WING, s * (.45 + k * .9), -.05, -1.25 + k * .27);
      this.wings.push({ shoulder, elbow, side: s });
    }
    // Tail.
    for (let i = 0; i < 8; i++) {
      const g = seg(9.6 + i * 1.05);
      const w = 1.5 - i * .15;
      box(g, w, w * .9, 1.2, i === 7 ? WING : BODY, 0, 0, 0);
      if (i < 7) box(g, .18, .3, .4, DARK, 0, w * .5, 0);
      else box(g, 1.2, .1, 1.0, WING, 0, 0, -.6);
    }
  }
}
