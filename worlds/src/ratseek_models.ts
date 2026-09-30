// Rat and Seek's 3D props, built from shaded boxes in the same flat,
// vertex-coloured style as Worlds' avatars: the rat every hider becomes,
// Mr. Whiskers the house cat, cheese wedges, the Trickster's decoy, the four
// hall chandeliers, glow silhouettes and flashlight beams.

import * as THREE from 'three';

/** Face shading in BoxGeometry face order (+x, -x, +y, -y, +z, -z). */
const SHADE = [0.62, 0.62, 1.0, 0.5, 0.82, 0.82];

function shaded(w: number, h: number, d: number, color: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const c = new THREE.Color(color);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const k = (f * 4 + v) * 3;
    colors[k] = c.r * SHADE[f]; colors[k + 1] = c.g * SHADE[f]; colors[k + 2] = c.b * SHADE[f];
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}
const BODY_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
function box(parent: THREE.Object3D, w: number, h: number, d: number, color: number,
  x: number, y: number, z: number, mat: THREE.Material = BODY_MAT): THREE.Mesh {
  const m = new THREE.Mesh(shaded(w, h, d, color), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
/** A leg or tail joint: a group pivoting at its top. */
function joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Behind walls only. It is opaque and drawn AFTER the world but BEFORE the body (see
 *  glowOf), so only what a wall hides is painted; the body then covers the rest. */
export const GLOW_MAT = new THREE.MeshBasicMaterial({
  color: 0xf2c65a, depthFunc: THREE.GreaterDepth, depthWrite: false,
});
/** In the open: a thin bright rim, drawn as an inverted hull behind the body. */
export const GLOW_EDGE_MAT = new THREE.MeshBasicMaterial({
  color: 0xffe28a, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false,
});

/** A glow that rides on the source's own limbs, so it follows every animated
 *  joint: each mesh gets two slightly larger copies as its siblings. */
export interface Glow { set(on: boolean): void }
export function glowOf(source: THREE.Object3D): Glow {
  const meshes: THREE.Mesh[] = [];
  source.traverse((o) => {
    if (o instanceof THREE.Mesh && o.visible && o.material !== GLOW_MAT && o.material !== GLOW_EDGE_MAT) meshes.push(o);
  });
  const copies: THREE.Mesh[] = [];
  for (const o of meshes) {
    if (!o.parent) continue;
    o.renderOrder = Math.max(o.renderOrder, 2);
    for (const [mat, grow, order] of [[GLOW_EDGE_MAT, 1.16, 899], [GLOW_MAT, 1.08, 1]] as const) {
      const m = new THREE.Mesh(o.geometry, mat);
      m.position.copy(o.position);
      m.quaternion.copy(o.quaternion);
      m.scale.copy(o.scale).multiplyScalar(grow);
      m.renderOrder = order;
      m.visible = false;
      o.parent.add(m);
      copies.push(m);
    }
  }
  return { set(on) { for (const m of copies) m.visible = on; } };
}

// ── The rat ─────────────────────────────────────────────────────────────────

const FUR = 0x6b4a35, BELLY = 0x8a6a55, PINK = 0xe8a0a8, STRIPE = 0xe8e4da;

export interface RatModel {
  group: THREE.Group;
  setCaged(caged: boolean): void;
  setGlow(on: boolean): void;
  /** Animate: ground speed (blocks/s), a running phase, and the clock. */
  pose(speed: number, phase: number, t: number): void;
  dispose(): void;
}

/** A rat about 0.9 blocks nose to rump, facing -z (Worlds' forward). */
export function createRatModel(caged = false): RatModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const materials: THREE.MeshBasicMaterial[] = [];
  const mat = (): THREE.MeshBasicMaterial => { const m = new THREE.MeshBasicMaterial({ vertexColors: true }); materials.push(m); return m; };
  const furMat = mat(), bellyMat = mat();
  box(body, 0.34, 0.28, 0.56, FUR, 0, 0.3, 0.04, furMat);
  box(body, 0.28, 0.06, 0.46, BELLY, 0, 0.16, 0.04, bellyMat);
  const stripes: THREE.Mesh[] = [];
  for (const z of [-0.12, 0.04, 0.2]) {
    const s = box(body, 0.35, 0.29, 0.05, STRIPE, 0, 0.3, z);
    s.visible = false;
    stripes.push(s);
  }
  // Head, snout, nose, eyes, ears, whiskers.
  const head = joint(body, 0, 0.36, -0.26);
  box(head, 0.26, 0.22, 0.22, FUR, 0, 0, -0.08, furMat);
  box(head, 0.15, 0.12, 0.12, BELLY, 0, -0.03, -0.24, bellyMat);
  box(head, 0.06, 0.05, 0.04, PINK, 0, -0.01, -0.31);
  for (const x of [-0.08, 0.08]) {
    box(head, 0.04, 0.04, 0.02, 0x0c0c0e, x, 0.04, -0.195);
    box(head, 0.11, 0.11, 0.03, FUR, x * 1.3, 0.14, -0.04, furMat);
    box(head, 0.07, 0.07, 0.035, PINK, x * 1.3, 0.14, -0.045);
    for (const dy of [-0.02, 0.02]) box(head, 0.16, 0.008, 0.008, 0xf2f2f2, x * 1.6, -0.03 + dy, -0.27);
  }
  // Legs pivot at the hip.
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[-0.12, -0.14], [0.12, -0.14], [-0.12, 0.2], [0.12, 0.2]]) {
    const leg = joint(body, x, 0.2, z);
    box(leg, 0.08, 0.16, 0.09, FUR, 0, -0.07, 0, furMat);
    box(leg, 0.09, 0.03, 0.12, PINK, 0, -0.15, -0.02);
    legs.push(leg);
  }
  // A long segmented tail, curling behind.
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = body, tz = 0.32, ty = 0.26;
  for (let i = 0; i < 5; i++) {
    const seg = joint(parent, 0, i === 0 ? ty : 0, i === 0 ? tz : 0.12);
    box(seg, 0.05 - i * 0.006, 0.05 - i * 0.006, 0.13, PINK, 0, 0, 0.06);
    tail.push(seg);
    parent = seg;
  }
  const glow = glowOf(group);
  const model: RatModel = {
    group,
    setCaged(on) {
      furMat.color.setHex(on ? 0x5a5a60 : 0xffffff);
      bellyMat.color.setHex(on ? 0x6a6a70 : 0xffffff);
      for (const s of stripes) s.visible = on;
    },
    setGlow(on) { glow.set(on); },
    pose(speed, phase, t) {
      const run = Math.min(1, speed / 5);
      const swing = Math.sin(phase * 1.6) * 0.9 * run;
      legs[0].rotation.x = swing; legs[3].rotation.x = swing;
      legs[1].rotation.x = -swing; legs[2].rotation.x = -swing;
      body.position.y = Math.abs(Math.sin(phase * 1.6)) * 0.04 * run;
      head.rotation.x = Math.sin(t * 2.3) * 0.06 * (1 - run);
      head.rotation.y = Math.sin(t * 0.9) * 0.18 * (1 - run);
      for (let i = 0; i < tail.length; i++) {
        tail[i].rotation.y = Math.sin(t * 3 + i * 0.7) * (0.12 + 0.18 * run);
        tail[i].rotation.x = i === 0 ? -0.35 : 0.12;
      }
    },
    dispose() { for (const m of materials) m.dispose(); },
  };
  model.setCaged(caged);
  return model;
}

// ── Mr. Whiskers ────────────────────────────────────────────────────────────

export interface CatModel {
  group: THREE.Group;
  /** Animate: sitting, ground speed (blocks/s), the clock, and mid-pounce. */
  update(sit: boolean, speed: number, t: number, pounce?: boolean): void;
}

const ease = (a: number, b: number, k: number): number => a + (b - a) * k;

/** Mr. Whiskers: a sleek tuxedo cat with jointed legs, a chained tail, ears
 *  that twitch, a blink, and a gait that turns from a walk into a gallop. */
export function createCatModel(): CatModel {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const BLACK = 0x2b2833, SHEEN = 0x3b3746, WHITE = 0xf1eee6, PINK = 0xe58a9a, EAR_IN = 0xc9707f;
  const torso = joint(rig, 0, 0.42, 0);

  // Body: a broad chest, a narrower waist and a rounder rump.
  box(torso, 0.31, 0.31, 0.3, BLACK, 0, 0.01, -0.15);
  box(torso, 0.26, 0.27, 0.16, BLACK, 0, -0.005, 0.02);
  box(torso, 0.29, 0.29, 0.3, BLACK, 0, 0, 0.16);
  box(torso, 0.2, 0.03, 0.44, SHEEN, 0, 0.155, 0.02);       // glossy back
  box(torso, 0.15, 0.17, 0.02, WHITE, 0, -0.03, -0.305);    // chest bib
  box(torso, 0.15, 0.02, 0.3, WHITE, 0, -0.146, -0.06);     // belly
  box(torso, 0.335, 0.06, 0.09, 0xc23030, 0, 0.085, -0.27);  // collar
  box(torso, 0.055, 0.055, 0.05, 0xe6b840, 0, 0.03, -0.32);  // bell

  // Head.
  const head = joint(torso, 0, 0.1, -0.33);
  box(head, 0.29, 0.25, 0.25, BLACK, 0, 0.03, -0.05);
  box(head, 0.16, 0.09, 0.06, WHITE, 0, -0.045, -0.19);
  box(head, 0.05, 0.03, 0.02, PINK, 0, -0.005, -0.225);
  for (const s of [-1, 1]) box(head, 0.05, 0.06, 0.05, WHITE, s * 0.13, -0.05, -0.13);
  const eyes = joint(head, 0, 0.065, -0.18);
  for (const s of [-1, 1]) {
    box(eyes, 0.075, 0.07, 0.02, 0xb8e04a, s * 0.08, 0, 0);
    box(eyes, 0.02, 0.062, 0.022, 0x0a0a0a, s * 0.08, 0, -0.004);
    box(eyes, 0.02, 0.02, 0.022, 0xffffff, s * 0.08 + 0.014, 0.018, -0.006);
  }
  const ears: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const ear = joint(head, s * 0.095, 0.15, -0.03);
    box(ear, 0.1, 0.07, 0.05, BLACK, 0, 0.035, 0);
    box(ear, 0.06, 0.06, 0.045, BLACK, 0, 0.09, 0);
    box(ear, 0.045, 0.07, 0.02, EAR_IN, 0, 0.06, -0.022);
    ear.rotation.z = -s * 0.14;
    ears.push(ear);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const w = box(head, 0.2, 0.008, 0.008, 0xe8e6ee, s * 0.17, -0.03 + i * 0.02, -0.16);
    w.rotation.z = s * (i - 1) * 0.13;
    w.rotation.y = -s * 0.2;
  }

  // Legs: a shoulder/hip joint, a knee and a white paw on each.
  interface Leg { hip: THREE.Group; knee: THREE.Group; paw: THREE.Group }
  const makeLeg = (x: number, y: number, z: number, hind: boolean): Leg => {
    const hip = joint(torso, x, y, z);
    if (hind) box(hip, 0.13, 0.19, 0.2, BLACK, 0, -0.08, 0.01);
    else box(hip, 0.1, 0.17, 0.1, BLACK, 0, -0.085, 0);
    const knee = joint(hip, 0, -0.17, 0);
    box(knee, 0.075, hind ? 0.15 : 0.14, 0.075, BLACK, 0, hind ? -0.075 : -0.07, 0);
    const paw = joint(knee, 0, hind ? -0.15 : -0.14, 0);
    box(paw, 0.095, 0.05, 0.13, WHITE, 0, -0.025, -0.02);
    return { hip, knee, paw };
  };
  const fl = makeLeg(-0.085, -0.06, -0.17, false);
  const fr = makeLeg(0.085, -0.06, -0.17, false);
  const hl = makeLeg(-0.095, -0.05, 0.19, true);
  const hr = makeLeg(0.095, -0.05, 0.19, true);

  // Tail: five chained segments so it can curl and whip.
  const tailBase = joint(torso, 0, 0.05, 0.3);
  const tail: THREE.Group[] = [];
  let parent: THREE.Group = tailBase;
  for (let i = 0; i < 5; i++) {
    const seg = joint(parent, 0, 0, i ? 0.125 : 0);
    box(seg, 0.06 - i * 0.004, 0.06 - i * 0.004, 0.14, i === 4 ? WHITE : BLACK, 0, 0, 0.065);
    tail.push(seg);
    parent = seg;
  }

  const tag = nameSprite('Mr. Whiskers');
  tag.position.y = 1.05;
  group.add(tag);

  let phase = 0, lastT = -1, gallop = 0, sitAmt = 0, pounceAmt = 0;
  let nextBlink = 1.5, blinkStart = -1, nextTwitch = 3, twitchStart = -1, twitchSide = 0;
  return {
    group,
    update(sit, speed, t, pounce = false) {
      const dt = lastT < 0 ? 0.016 : Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      const k = Math.min(1, dt * 9);
      sitAmt = ease(sitAmt, sit ? 1 : 0, k * 0.6);
      pounceAmt = ease(pounceAmt, pounce ? 1 : 0, k);
      const mv = Math.min(1, speed / 1.2) * (1 - sitAmt) * (1 - pounceAmt);
      gallop = ease(gallop, Math.max(0, Math.min(1, (speed - 4.2) / 2)), Math.min(1, dt * 6));
      phase += dt * speed * 0.6 * Math.PI * 2;

      // Gait: diagonal pairs at a walk, bounding pairs at a gallop.
      const amp = (0.42 + 0.4 * gallop) * mv;
      const offs = { fl: 0, fr: ease(Math.PI, 0.3, gallop), hl: ease(Math.PI, 1.4, gallop), hr: ease(0, 1.6, gallop) };
      const drive = (leg: Leg, off: number, front: boolean): void => {
        const a = phase + off;
        const lift = Math.max(0, Math.cos(a)) * mv;
        // Stretched while pouncing, folded while sitting, striding otherwise.
        const free = 1 - sitAmt - pounceAmt;
        const sitPose = front ? -0.75 : 0.82;
        const pouncePose = front ? 1.15 : -0.85;
        leg.hip.rotation.x = Math.sin(a) * amp * free + sitPose * sitAmt + pouncePose * pounceAmt;
        leg.knee.rotation.x = -lift * (front ? 0.95 : 1.05) * (1 - gallop * 0.3) + (front ? 0 : -1.9) * sitAmt;
        leg.paw.rotation.x = -leg.knee.rotation.x * 0.45 + (front ? 0 : 1.1 * sitAmt);
      };
      drive(fl, offs.fl, true); drive(fr, offs.fr, true);
      drive(hl, offs.hl, false); drive(hr, offs.hr, false);

      // Body: bob with each footfall, pitch and sway at speed, sit back on the haunches.
      const bob = Math.abs(Math.sin(phase)) * 0.018 * mv * (1 + gallop * 1.5);
      rig.position.y = bob + pounceAmt * 0.06;
      torso.position.y = ease(0.42, 0.3, sitAmt) - pounceAmt * 0.06;
      torso.rotation.x = 0.75 * sitAmt - 0.16 * pounceAmt + Math.sin(phase + 0.7) * 0.08 * gallop * mv;
      torso.rotation.z = Math.sin(phase) * 0.03 * mv * (1 - gallop);
      torso.rotation.y = Math.sin(phase) * 0.04 * mv * (1 - gallop);
      torso.scale.y = 1 + Math.sin(t * 2.4) * 0.012 * (1 - mv);

      // Head keeps level against the body pitch and glances around when idle.
      const idle = 1 - mv;
      head.rotation.x = -torso.rotation.x * 0.85 - Math.sin(phase * 2) * 0.04 * mv - 0.05 * pounceAmt;
      head.rotation.y = Math.sin(t * 0.55) * 0.3 * idle * (0.4 + sitAmt) * (1 - pounceAmt);
      head.rotation.z = Math.sin(t * 0.37 + 1) * 0.05 * idle;

      // Blinks and ear twitches.
      if (t > nextBlink) { blinkStart = t; nextBlink = t + 2 + Math.random() * 3; }
      const bp = blinkStart >= 0 ? (t - blinkStart) / 0.16 : 1;
      eyes.scale.y = bp >= 1 ? 1 : Math.max(0.08, Math.abs(bp * 2 - 1));
      if (t > nextTwitch) { twitchStart = t; twitchSide = Math.random() < 0.5 ? 0 : 1; nextTwitch = t + 2.5 + Math.random() * 4; }
      const tp = twitchStart >= 0 ? (t - twitchStart) / 0.3 : 1;
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? -1 : 1;
        const flick = tp < 1 && i === twitchSide ? Math.sin(tp * Math.PI * 3) * 0.3 * (1 - tp) : 0;
        ears[i].rotation.z = -s * (0.14 + flick + 0.25 * pounceAmt);
        ears[i].rotation.x = 0.7 * pounceAmt + (gallop > 0.5 ? 0.25 : 0);
      }

      // Tail: held up and swaying, curled round the paws when sitting.
      const rate = 2.2 + speed * 0.3;
      for (let i = 0; i < tail.length; i++) {
        const up = -0.5 - 0.22 * i, curl = 0.28 + 0.05 * i;
        tail[i].rotation.x = (ease(up, curl, sitAmt) + Math.sin(phase * 2 - i) * 0.05 * mv) * (1 - pounceAmt) + 0.2 * pounceAmt;
        tail[i].rotation.y = Math.sin(t * rate - i * 0.7) * (0.18 + 0.06 * i) * (1 - sitAmt * 0.6) + sitAmt * 0.45;
      }
    },
  };
}

function nameSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 72;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 25px "Segoe UI", Arial, sans-serif';
  const w = Math.min(316, Math.ceil(ctx.measureText(text).width) + 34);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(160 - w / 2, 22, w, 40, 10); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d8d4e6';
  ctx.fillText(text, 160, 42);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
  sprite.scale.set(1.6, 0.36, 1);
  return sprite;
}
/** A floating label (the Cheese Exchange's price board). */
export function labelSprite(text: string, color = '#ffd35a'): THREE.Sprite {
  // One line per "\n"; the font shrinks until the widest line fits inside the plate.
  const lines = text.split('\n');
  const W = 512, PAD = 22, LINE = 44;
  const H = lines.length * LINE + 2 * PAD;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  let size = 30;
  const setFont = (px: number): void => { ctx.font = `bold ${px}px "Segoe UI", Arial, sans-serif`; };
  setFont(size);
  const maxW = W - 2 * PAD - 16;
  const widest = (): number => Math.max(...lines.map((l) => ctx.measureText(l).width));
  while (size > 12 && widest() > maxW) setFont(--size);
  const w = Math.ceil(widest()) + 32;
  ctx.fillStyle = 'rgba(12,10,6,0.62)';
  ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, PAD / 2, w, H - PAD, 12); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, PAD + LINE * (i + 0.5)));
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
  sprite.scale.set(3.4, 3.4 * H / W, 1);
  return sprite;
}

// ── Cheese ──────────────────────────────────────────────────────────────────

let cheeseGeo: THREE.BufferGeometry | null = null;
/** A wedge of cheese (a triangular prism), yellow with a darker rind. */
export function createCheeseModel(): THREE.Group {
  if (!cheeseGeo) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.18, 0); shape.lineTo(0.18, 0); shape.lineTo(-0.18, 0.2); shape.lineTo(-0.18, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
    geo.translate(0, 0, -0.11);
    const pos = geo.getAttribute('position');
    const normals = geo.getAttribute('normal');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ny = normals.getY(i), nz = Math.abs(normals.getZ(i));
      const rind = nz < 0.5 && ny < 0.9 && pos.getX(i) < -0.17;
      const base = rind ? [0.86, 0.62, 0.12] : [1, 0.84, 0.3];
      const s = ny > 0.5 ? 1 : nz > 0.5 ? 0.85 : 0.72;
      colors[i * 3] = base[0] * s; colors[i * 3 + 1] = base[1] * s; colors[i * 3 + 2] = base[2] * s;
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    cheeseGeo = geo;
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(cheeseGeo, BODY_MAT));
  for (const [x, y, z] of [[-0.08, 0.05, 0.112], [0.02, 0.03, 0.112], [-0.12, 0.12, 0.112]]) {
    box(g, 0.035, 0.035, 0.004, 0xc8901c, x, y, z);
  }
  return g;
}

// ── Chandelier ──────────────────────────────────────────────────────────────

export function createChandelierModel(): THREE.Group {
  const g = new THREE.Group();
  box(g, 0.08, 0.7, 0.08, 0x55555e, 0, 0.62, 0);            // chain
  box(g, 1.6, 0.14, 1.6, 0xd8a52e, 0, 0.2, 0);             // gilt ring
  box(g, 1.2, 0.15, 1.2, 0x2a2016, 0, 0.2, 0);             // (the hollow)
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  for (const [x, z] of [[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.62], [0.62, 0.62]]) {
    box(g, 0.22, 0.3, 0.22, 0x3a3128, x, 0.0, z);
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), glowMat);
    flame.position.set(x, 0.02, z);
    g.add(flame);
  }
  return g;
}

// ── Seeker bits ─────────────────────────────────────────────────────────────

/** A flashlight beam: a soft additive cone, apex at the lens. Length 1 along -z. */
export function createBeam(): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.34, 1, 20, 1, true);
  geo.translate(0, -0.5, 0);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xfff2b8, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 40;
  return m;
}
