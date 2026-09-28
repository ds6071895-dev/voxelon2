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

/** Through-the-walls outline: every mesh of `source`, redrawn a little larger
 *  on top of everything in a flat warm colour. */
export const GLOW_MAT = new THREE.MeshBasicMaterial({
  color: 0xfff0a0, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false,
});
function glowOf(source: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  source.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(source.matrixWorld).invert();
  source.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.material === GLOW_MAT) return;
    const m = new THREE.Mesh(o.geometry, GLOW_MAT);
    m.matrixAutoUpdate = false;
    m.matrix.multiplyMatrices(inv, o.matrixWorld).multiply(new THREE.Matrix4().makeScale(1.12, 1.12, 1.12));
    m.renderOrder = 900;
    g.add(m);
  });
  g.visible = false;
  return g;
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
  group.add(glow);
  const model: RatModel = {
    group,
    setCaged(on) {
      furMat.color.setHex(on ? 0x5a5a60 : 0xffffff);
      bellyMat.color.setHex(on ? 0x6a6a70 : 0xffffff);
      for (const s of stripes) s.visible = on;
    },
    setGlow(on) { glow.visible = on; },
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
  update(sit: boolean, speed: number, t: number): void;
}
export function createCatModel(): CatModel {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const BLACK = 0x1c1a20, DARK = 0x2a2830;
  box(body, 0.32, 0.3, 0.62, BLACK, 0, 0.4, 0);
  const head = joint(body, 0, 0.58, -0.36);
  box(head, 0.32, 0.28, 0.28, BLACK, 0, 0, 0);
  box(head, 0.16, 0.1, 0.08, DARK, 0, -0.07, -0.16);
  box(head, 0.05, 0.035, 0.02, 0xe07a8a, 0, -0.04, -0.205);
  for (const x of [-0.09, 0.09]) {
    box(head, 0.07, 0.06, 0.02, 0xf2d23a, x, 0.04, -0.145);
    box(head, 0.025, 0.05, 0.022, 0x0a0a0a, x, 0.04, -0.15);
    box(head, 0.09, 0.1, 0.05, BLACK, x * 1.1, 0.18, 0.02);
    box(head, 0.05, 0.06, 0.02, 0xc07a86, x * 1.1, 0.17, -0.01);
  }
  // A red collar with a brass bell.
  box(body, 0.34, 0.06, 0.1, 0xb02a2a, 0, 0.5, -0.27);
  box(body, 0.06, 0.06, 0.06, 0xe0b040, 0, 0.45, -0.33);
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[-0.1, -0.22], [0.1, -0.22], [-0.1, 0.22], [0.1, 0.22]]) {
    const leg = joint(body, x, 0.28, z);
    box(leg, 0.09, 0.28, 0.09, BLACK, 0, -0.14, 0);
    legs.push(leg);
  }
  const tail = joint(body, 0, 0.5, 0.3);
  box(tail, 0.06, 0.06, 0.4, BLACK, 0, 0.08, 0.18);
  const tag = nameSprite('Mr. Whiskers');
  tag.position.y = 1.05;
  group.add(tag);
  let phase = 0;
  return {
    group,
    update(sit, speed, t) {
      phase += speed * 0.05;
      const run = Math.min(1, speed / 4);
      const swing = Math.sin(phase * 4) * 0.7 * run;
      legs[0].rotation.x = swing; legs[3].rotation.x = swing; legs[1].rotation.x = -swing; legs[2].rotation.x = -swing;
      body.rotation.x = sit ? -0.45 : 0;
      body.position.y = sit ? -0.12 : 0;
      if (sit) { legs[2].rotation.x = 1.2; legs[3].rotation.x = 1.2; }
      tail.rotation.x = sit ? 1.1 : -0.6 + Math.sin(t * 2) * 0.15;
      tail.rotation.y = Math.sin(t * (sit ? 0.8 : 2.6)) * 0.4;
      head.rotation.y = sit ? Math.sin(t * 0.4) * 0.3 : 0;
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
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 72;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
  const w = Math.min(508, Math.ceil(ctx.measureText(text).width) + 36);
  ctx.fillStyle = 'rgba(12,10,6,0.62)';
  ctx.beginPath(); ctx.roundRect(256 - w / 2, 18, w, 42, 10); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 40);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
  sprite.scale.set(3.4, 0.48, 1);
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

/** A seeker's through-walls outline: a lit frame the size of a person. */
export function createPersonGlow(): THREE.Group {
  const g = new THREE.Group();
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.7, 1.9, 0.45)),
    new THREE.LineBasicMaterial({ color: 0xfff0a0, depthTest: false, transparent: true, opacity: 0.9 }));
  edges.position.y = 0.95;
  edges.renderOrder = 901;
  const fill = new THREE.Mesh(new THREE.BoxGeometry(0.66, 1.86, 0.42), new THREE.MeshBasicMaterial({
    color: 0xfff0a0, transparent: true, opacity: 0.18, depthTest: false, depthWrite: false,
  }));
  fill.position.y = 0.95;
  fill.renderOrder = 900;
  g.add(edges, fill);
  g.visible = false;
  return g;
}

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
