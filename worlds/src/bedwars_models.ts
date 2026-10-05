// Hand-built, reusable low-poly furnishings for the Bedwars map.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BW_BASES, BW_GENERATORS, type BedwarsBase } from './bedwars_map';

const C = {
  wood: 0x624334, lightWood: 0x9a704b, darkWood: 0x352b29, edge: 0xc99b64,
  brass: 0xd5ae61, gold: 0xffce68, iron: 0xa5bac8, ironDark: 0x445362,
  linen: 0xfaf0d7, seam: 0xe6d1a6, red: 0xbd3d50, redLight: 0xe66e78,
  blue: 0x315faf, blueLight: 0x6c9ce2, jade: 0x39bd92, glass: 0x8de4e5,
  skin: 0xc9956c, ink: 0x242834, leaf: 0x51874d,
};

export interface BedwarsModels {
  group: THREE.Group;
  /** Indexed by team. Client toggles visibility when the corresponding bed breaks. */
  beds: THREE.Group[];
  update(timeSeconds: number): void;
  dispose(): void;
}

/** One shaded unit box per color, one material, cached non-box primitives.
 * Every owned GPU resource is disposed once; nothing shared with other modes. */
class Workshop {
  readonly material = new THREE.MeshBasicMaterial({ vertexColors: true });
  readonly geometries = new Map<string, THREE.BufferGeometry>();
  readonly spriteMaterials: THREE.SpriteMaterial[] = [];
  readonly textures: THREE.Texture[] = [];
  group(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g;
  }
  geometry(key: string, color: number, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
    const id = `${key}/${color}`;
    let geo = this.geometries.get(id);
    if (!geo) {
      geo = create();
      const normals = geo.getAttribute('normal'), count = geo.getAttribute('position').count;
      const colors = new Float32Array(count * 3), c = new THREE.Color(color);
      for (let i = 0; i < count; i++) {
        const light = .73 + normals.getY(i) * .20 + normals.getZ(i) * .07;
        colors[i * 3] = c.r * light; colors[i * 3 + 1] = c.g * light; colors[i * 3 + 2] = c.b * light;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.geometries.set(id, geo);
    }
    return geo;
  }
  box(parent: THREE.Object3D, w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry('box', color, () => new THREE.BoxGeometry(1, 1, 1)), this.material);
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); parent.add(mesh); return mesh;
  }
  cylinder(parent: THREE.Object3D, radius: number, height: number, color: number, x: number, y: number, z: number, top = 1): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry(`cylinder/${top}`, color,
      () => new THREE.CylinderGeometry(top, 1, 1, 8, 1)), this.material);
    mesh.position.set(x, y, z); mesh.scale.set(radius, height, radius); parent.add(mesh); return mesh;
  }
  gem(parent: THREE.Object3D, color: number, x: number, y: number, z: number, scale = 1): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry('gem', color, () => new THREE.OctahedronGeometry(1, 0)), this.material);
    mesh.position.set(x, y, z); mesh.scale.set(.32 * scale, .48 * scale, .32 * scale); parent.add(mesh); return mesh;
  }
  ring(parent: THREE.Object3D, radius: number, color: number, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.geometry('ring', color, () => new THREE.TorusGeometry(1, .025, 5, 48)), this.material);
    mesh.position.set(x, y, z); mesh.scale.setScalar(radius); parent.add(mesh); return mesh;
  }
  label(parent: THREE.Object3D, text: string, x: number, y: number, z: number, color = '#8aa0ba', width = 2.2): void {
    // Labels remain depth-tested and deliberately small, away from the beds.
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    // Light paper tag with ink text, the same look as the rest of the UI.
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.beginPath(); ctx.roundRect(8, 8, 496, 80, 22); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.roundRect(10, 10, 492, 76, 20); ctx.stroke();
    ctx.font = '800 36px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#122032'; ctx.fillText(text, 256, 50, 450);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material); sprite.position.set(x, y, z); sprite.scale.set(width, width * 96 / 512, 1);
    parent.add(sprite); this.textures.push(texture); this.spriteMaterials.push(material);
  }
  /** Bake stationary craft into one draw call. Beds and animated objects get
   * their own batches, preserving visibility toggles and animation pivots. */
  batch(root: THREE.Group, exclude = new Set<THREE.Object3D>()): void {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert(), parts: THREE.BufferGeometry[] = [], meshes: THREE.Mesh[] = [];
    const visit = (object: THREE.Object3D): void => {
      if (exclude.has(object)) return;
      if (object instanceof THREE.Mesh && object.material === this.material) {
        const matrix = inverse.clone().multiply(object.matrixWorld);
        const geometry = object.geometry.clone().applyMatrix4(matrix);
        // Mirrored base furnishings need reflected winding, not double-sided
        // materials. Correcting it here also keeps culling cheap and accurate.
        if (matrix.determinant() < 0) {
          const indices = geometry.getIndex();
          if (indices) for (let i = 0; i < indices.count; i += 3) {
            const first = indices.getX(i); indices.setX(i, indices.getX(i + 2)); indices.setX(i + 2, first);
          }
          else for (const name of Object.keys(geometry.attributes)) {
            const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
            const values = attribute.array;
            for (let i = 0; i < attribute.count; i += 3) for (let j = 0; j < attribute.itemSize; j++) {
              const a = i * attribute.itemSize + j, b = (i + 2) * attribute.itemSize + j;
              const first = values[a]; values[a] = values[b]; values[b] = first;
            }
          }
        }
        // Octahedra are non-indexed; normalise all inputs for one shared batch.
        const flat = geometry.index ? geometry.toNonIndexed() : geometry;
        if (flat !== geometry) geometry.dispose();
        // Some primitives omit UVs, and vertex colors supply all our surface art.
        flat.deleteAttribute('uv');
        parts.push(flat); meshes.push(object);
      }
      for (const child of object.children) visit(child);
    };
    visit(root);
    if (!parts.length) return;
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) throw new Error('Bedwars prop batch has incompatible geometry');
    merged.computeBoundingBox(); merged.computeBoundingSphere();
    this.geometries.set(`batch/${this.geometries.size}`, merged);
    for (const mesh of meshes) mesh.removeFromParent();
    const mesh = new THREE.Mesh(merged, this.material); mesh.name = `${root.name || 'furniture'}-batch`; root.add(mesh);
  }
  dispose(): void {
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear(); this.material.dispose();
    for (const material of this.spriteMaterials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.spriteMaterials.length = 0; this.textures.length = 0;
  }
}

function bed(w: Workshop, parent: THREE.Group, base: BedwarsBase): THREE.Group {
  const g = w.group(parent, base.bed.x + .5, base.bed.y, base.bed.z + 1);
  g.name = `bed-${base.team}`;
  const color = base.team === 0 ? C.red : C.blue, light = base.team === 0 ? C.redLight : C.blueLight;
  // A carved cabinet bed: the lower plinth conceals the entire 1 x .5 x 2
  // collision proxy, including its sides. No exposed collision slab or z-fight.
  w.box(g, 1.06, .34, 2.06, C.darkWood, 0, .17, 0);
  w.box(g, 1.13, .12, 2.14, C.wood, 0, .34, 0);
  w.box(g, 1.08, .22, 2.08, C.linen, 0, .50, 0);
  w.box(g, 1.10, .035, 2.10, C.seam, 0, .405, 0);
  for (const x of [-.54, .54]) {
    w.box(g, .075, .22, 1.98, C.lightWood, x, .22, 0);
    w.box(g, .085, .035, 2.03, C.edge, x, .355, 0);
    for (const z of [-.48, .48]) {
      w.box(g, .082, .13, .84, C.wood, x, .20, z);
      w.box(g, .09, .028, .11, C.brass, x, .215, z);
    }
  }
  for (const x of [-.54, .54]) for (const z of [-1.01, 1.01]) {
    w.box(g, .16, .43, .16, C.wood, x, .215, z);
    w.box(g, .18, .06, .18, C.brass, x, .05, z);
    w.box(g, .13, .10, .13, C.lightWood, x, .445, z);
  }
  // Head and foot boards have inlaid panels, cap rails and brass finials.
  for (const [z, h] of [[-1.035, 1.07], [1.035, .72]]) {
    w.box(g, 1.13, h - .28, .12, C.wood, 0, .28 + (h - .28) / 2, z);
    w.box(g, .86, h - .43, .025, C.lightWood, 0, .31 + (h - .43) / 2, z + Math.sign(z) * .072);
    w.box(g, 1.24, .075, .19, C.edge, 0, h, z);
    for (const x of [-.54, .54]) {
      w.box(g, .14, h, .16, C.wood, x, h / 2, z);
      w.box(g, .18, .065, .20, C.brass, x, h + .055, z);
    }
    for (const x of [-.30, 0, .30]) w.box(g, .024, h - .46, .035, C.brass, x, .33 + (h - .46) / 2, z + Math.sign(z) * .09);
  }
  w.box(g, 1.105, .075, 1.39, color, 0, .64, .315);
  // Quilt drops over the long rails, with ivory piping and visible stitches.
  for (const x of [-.55, .55]) {
    w.box(g, .05, .22, 1.41, color, x, .56, .315);
    w.box(g, .055, .025, 1.43, C.seam, x, .455, .315);
  }
  w.box(g, 1.115, .023, .10, light, 0, .687, -.31);
  w.box(g, 1.115, .018, .025, C.seam, 0, .699, -.36);
  for (const x of [-.40, .40]) w.box(g, .024, .013, 1.22, C.seam, x, .686, .32);
  for (let z = -.18; z <= .88; z += .18) for (const x of [-.46, .46])
    w.box(g, .065, .014, .022, C.seam, x, .69, z);
  for (let x = -.3; x <= .31; x += .2) for (let z = -.1; z <= .81; z += .3) {
    const stitch = w.box(g, .055, .009, .055, light, x, .686, z); stitch.rotation.y = Math.PI / 4;
  }
  w.box(g, .83, .14, .39, C.seam, 0, .64, -.735);
  w.box(g, .80, .13, .37, C.linen, 0, .675, -.735);
  for (const x of [-.34, .34]) w.box(g, .022, .012, .28, C.seam, x, .746, -.735);
  return g;
}

function merchant(w: Workshop, parent: THREE.Object3D, upgrades: boolean, team: 0 | 1): void {
  const coat = upgrades ? 0x526d63 : team === 0 ? C.red : C.blue;
  for (const x of [-.15, .15]) {
    w.box(parent, .22, .52, .26, C.darkWood, x, .35, 0);
    w.box(parent, .25, .13, .36, C.wood, x, .065, -.045);
  }
  w.box(parent, .65, .65, .38, coat, 0, .98, 0);
  w.box(parent, .45, .49, .025, C.linen, 0, .87, -.205);
  w.box(parent, .68, .09, .41, C.lightWood, 0, .76, 0);
  w.box(parent, .10, .12, .035, C.brass, 0, .765, -.23);
  w.box(parent, .45, .43, .42, C.skin, 0, 1.52, -.015);
  w.box(parent, .48, .14, .44, upgrades ? 0xb8b0a0 : C.darkWood, 0, 1.76, .01);
  for (const x of [-.125, .125]) {
    w.box(parent, .055, .055, .026, C.ink, x, 1.565, -.235);
    w.box(parent, .015, .019, .008, C.linen, x - .009, 1.58, -.253);
    w.box(parent, .11, .026, .035, C.darkWood, x, 1.635, -.24);
  }
  w.box(parent, .105, .12, .11, C.skin, 0, 1.48, -.265);
  w.box(parent, .24, .06, .03, upgrades ? 0xb8b0a0 : C.wood, 0, 1.365, -.238);
  // Apron sleeves and hands lean naturally over the counter.
  for (const s of [-1, 1]) {
    const arm = w.group(parent, s * .39, 1.20, 0); arm.rotation.x = -.5; arm.rotation.z = s * .08;
    w.box(arm, .23, .40, .25, coat, 0, -.17, 0);
    w.box(arm, .20, .18, .22, C.skin, 0, -.43, 0);
  }
  if (upgrades) {
    w.box(parent, .54, .15, .47, 0x47665b, 0, 1.84, .015);
    w.box(parent, .61, .055, .52, C.brass, 0, 1.76, -.015);
    w.gem(parent, C.jade, 0, 1.86, -.24, .20);
    for (const x of [-.13, .13]) {
      const lens = w.ring(parent, .087, C.brass, x, 1.565, -.259); lens.scale.z = .5;
    }
  } else {
    w.box(parent, .57, .11, .48, C.linen, 0, 1.83, 0);
    w.box(parent, .44, .20, .41, coat, 0, 1.94, .015);
    w.box(parent, .44, .04, .42, C.brass, 0, 1.87, .015);
  }
}

function chest(w: Workshop, parent: THREE.Object3D): void {
  w.box(parent, 1.25, .64, .83, C.wood, 0, .38, 0);
  w.box(parent, 1.30, .17, .88, C.lightWood, 0, .78, 0);
  w.box(parent, 1.14, .08, .80, C.edge, 0, .90, 0);
  for (const x of [-.47, .47]) {
    w.box(parent, .09, .81, .90, C.ironDark, x, .48, 0);
    for (const y of [.2, .65, .82]) w.box(parent, .037, .037, .025, C.brass, x, y, -.463);
  }
  for (const x of [-.55, .55]) for (const z of [-.33, .33]) w.box(parent, .16, .14, .16, C.darkWood, x, .07, z);
  for (const y of [.2, .4, .6]) w.box(parent, .82, .012, .018, C.darkWood, 0, y, -.424);
  w.box(parent, .18, .23, .045, C.brass, 0, .59, -.473);
  w.box(parent, .035, .07, .02, C.ink, 0, .60, -.502);
}

function books(w: Workshop, parent: THREE.Object3D, x: number, y: number, z: number): void {
  const colors = [C.red, C.jade, C.blue];
  for (let i = 0; i < 3; i++) {
    const yy = y + i * .13;
    w.box(parent, .40 - i * .02, .105, .32, colors[i], x + i * .025, yy, z);
    w.box(parent, .33 - i * .02, .072, .325, C.linen, x + i * .025, yy, z);
    w.box(parent, .055, .11, .33, colors[i], x - .18 + i * .035, yy, z);
  }
}

function barrel(w: Workshop, parent: THREE.Object3D, x: number, y: number, z: number): void {
  w.cylinder(parent, .35, .76, C.lightWood, x, y + .38, z);
  for (const yy of [.10, .63]) w.cylinder(parent, .36, .065, C.ironDark, x, y + yy, z);
  w.cylinder(parent, .30, .035, C.wood, x, y + .778, z);
}

function baseProps(w: Workshop, parent: THREE.Group, base: BedwarsBase): void {
  const side = base.team === 0 ? -1 : 1;
  // Local model frame: x points into the courtyard, z stays along the hall.
  const hall = w.group(parent, side * 62 + .5, 97, .5);
  hall.scale.x = -side;
  for (const z of [-7, 7]) {
    const person = w.group(hall, -8, 0, z); person.rotation.y = -Math.PI / 2;
    merchant(w, person, z > 0, base.team);
    w.box(hall, .96, .10, 3.06, C.lightWood, -7, 1.04, z);
    w.box(hall, 1.02, .045, 3.14, C.brass, -7, 1.105, z);
    // Handcrafted counter wares: folded cloth, ingots, a blade, potions.
    if (z < 0) {
      for (let i = 0; i < 3; i++) w.box(hall, .50, .12, .56, i % 2 ? C.linen : base.team === 0 ? C.red : C.blue, -7, 1.19 + i * .13, z - .8);
      w.box(hall, .46, .12, .25, C.iron, -7, 1.20, z + .65);
      w.box(hall, .35, .12, .21, C.gold, -7, 1.32, z + .68);
      w.box(hall, .08, .035, .71, C.iron, -6.81, 1.19, z);
      w.box(hall, .25, .05, .055, C.brass, -6.81, 1.20, z + .34);
      w.box(hall, .075, .065, .18, C.wood, -6.81, 1.20, z + .44);
    } else {
      books(w, hall, -7, 1.21, z - .7);
      for (let i = 0; i < 3; i++) {
        w.cylinder(hall, .10, .25, [C.jade, C.redLight, C.glass][i], -7, 1.27, z + .45 + i * .3, .8);
        w.cylinder(hall, .045, .095, C.brass, -7, 1.435, z + .45 + i * .3);
      }
      w.box(hall, .42, .045, .49, C.linen, -6.9, 1.18, z - .05);
    }
    // Brass-framed hanging boards under the awning.
    w.box(hall, .12, .44, 2.35, C.darkWood, -6.4, 3.26, z);
    for (const zz of [z - 1.1, z + 1.1]) {
      w.box(hall, .13, .48, .045, C.brass, -6.4, 3.26, zz);
      w.box(hall, .035, .52, .035, C.brass, -6.4, 3.68, zz);
    }
    const labelX = side * (62 + 5.7) + .5;
    w.label(parent, z < 0 ? 'Item Shop' : 'Upgrades', labelX, 100.25, z + .5, '#2d6ee0', 2.2);
  }
  const storage = w.group(hall, -4.8, 0, 9.3); storage.rotation.y = -Math.PI / 2; chest(w, storage);
  barrel(w, hall, -9.4, 0, 9.4); barrel(w, hall, -9.4, 0, -9.4);
  // Forge's side anvil leaves all resource spawn cells walkable.
  const anvil = w.group(hall, -8.5, 0, 2.2);
  w.box(anvil, .85, .22, .69, C.darkWood, 0, .11, 0);
  w.box(anvil, .66, .13, .53, C.ironDark, 0, .29, 0);
  w.box(anvil, .37, .35, .36, C.ironDark, 0, .48, 0);
  w.box(anvil, .87, .20, .48, C.iron, 0, .72, 0);
  w.box(anvil, .29, .15, .29, C.iron, .53, .72, 0);
  w.box(anvil, .19, .08, .16, C.iron, .76, .72, 0);
  w.box(anvil, .065, .06, .53, C.wood, -.15, .86, .12);
  w.box(anvil, .25, .12, .15, C.ironDark, -.15, .89, -.12);
  w.label(parent, 'Forge', side * 70.6 + .5, 99.8, 1.5, '#e3a12a', 1.3);
  // Banner poles, sewn swallowtails and the guild's small diamond emblem.
  for (const z of [-4, 4]) {
    const flag = w.group(hall, -1.36, 4.7, z);
    w.box(flag, .10, .10, 1.8, C.brass, 0, 0, 0);
    const color = base.team === 0 ? C.red : C.blue;
    w.box(flag, .065, 1.45, 1.22, color, 0, -.71, 0);
    for (const zz of [-.48, .48]) w.box(flag, .074, 1.5, .045, C.brass, .003, -.73, zz);
    for (const zz of [-.40, .40]) w.box(flag, .065, .28, .4, color, 0, -1.54, zz);
    const emblem = w.box(flag, .08, .40, .40, C.linen, .05, -.69, 0); emblem.rotation.x = Math.PI / 4;
  }
  // Garden benches, terracotta tubs and delicate brass lamps.
  for (const z of [-8, 8]) {
    const bench = w.group(hall, 4.5, 0, z);
    for (const x of [-.65, .65]) for (const zz of [-.22, .22]) w.box(bench, .12, .47, .12, C.ironDark, x, .235, zz);
    for (const zz of [-.22, 0, .22]) w.box(bench, 1.65, .09, .18, C.lightWood, 0, .52, zz);
    for (const x of [-.7, .7]) w.box(bench, .09, .65, .10, C.ironDark, x, .75, Math.sign(z) * .31);
    for (const y of [.78, 1.0]) w.box(bench, 1.65, .13, .08, C.lightWood, 0, y, Math.sign(z) * .31);
    w.cylinder(hall, .37, .58, 0xb77354, 1, .29, z, 1.18);
    w.cylinder(hall, .43, .08, 0xd8966c, 1, .60, z);
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5, x = 1 + Math.cos(angle) * .18, zz = z + Math.sin(angle) * .18;
      w.box(hall, .03, .46, .03, C.leaf, x, .8, zz);
      w.box(hall, .16, .09, .16, i % 2 ? C.linen : C.redLight, x, 1.04, zz);
      w.box(hall, .05, .04, .05, C.gold, x, 1.10, zz);
    }
  }
}

function armillary(w: Workshop, parent: THREE.Group): THREE.Group {
  const g = w.group(parent, .5, 97, .5);
  g.name = 'center-armillary';
  w.cylinder(g, 1.15, .20, 0xe3d7bb, 0, .10, 0);
  w.cylinder(g, .82, .18, C.brass, 0, .29, 0);
  w.cylinder(g, .40, 1.28, 0xd2c5ac, 0, .97, 0, .78);
  w.cylinder(g, .63, .16, C.brass, 0, 1.67, 0);
  const sphere = w.group(g, 0, 3.1, 0);
  const equator = w.ring(sphere, 1.50, C.brass, 0, 0, 0); equator.rotation.x = Math.PI / 2;
  w.ring(sphere, 1.50, C.brass, 0, 0, 0);
  const meridian = w.ring(sphere, 1.48, C.edge, 0, 0, 0); meridian.rotation.y = Math.PI / 2;
  const zodiac = w.ring(sphere, 1.60, C.gold, 0, 0, 0); zodiac.rotation.x = .65; zodiac.rotation.y = .35;
  w.cylinder(sphere, .055, 3.75, C.brass, 0, 0, 0);
  w.gem(sphere, C.jade, 0, 0, 0, 1.3);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    w.box(sphere, .085, .10, .085, C.linen, Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5);
  }
  w.gem(sphere, C.gold, 0, 1.95, 0, .32);
  // A reading desk and telescope, nestled beside the arcade's columns.
  const desk = w.group(parent, -3.9, 97, 4.6); desk.rotation.y = -.4;
  for (const x of [-.5, .5]) for (const z of [-.3, .3]) w.box(desk, .11, .85, .11, C.wood, x, .425, z);
  w.box(desk, 1.28, .12, .92, C.lightWood, 0, .9, 0);
  w.box(desk, .83, .025, .58, C.linen, -.10, .975, 0);
  for (let i = 0; i < 3; i++) w.box(desk, .43 - i * .08, .01, .018, C.ironDark, -.15, .994, -.12 + i * .12);
  books(w, desk, .44, 1.03, .15);
  const scope = w.group(parent, 4.4, 97, -4.1);
  for (let i = 0; i < 3; i++) {
    const leg = w.group(scope, 0, 1.0, 0); leg.rotation.y = i * Math.PI * 2 / 3;
    const shaft = w.box(leg, .08, 1.2, .08, C.wood, 0, -.48, .23); shaft.rotation.x = -.45;
  }
  const tube = w.group(scope, 0, 1.28, 0); tube.rotation.z = -.65;
  w.cylinder(tube, .16, 1.3, C.brass, 0, .24, 0);
  for (const y of [-.4, .3, .9]) w.cylinder(tube, .18, .10, C.darkWood, 0, y, 0);
  w.cylinder(tube, .14, .016, C.glass, 0, .956, 0);
  return sphere;
}

export function createBedwarsModels(): BedwarsModels {
  const w = new Workshop(), group = new THREE.Group(); group.name = 'bedwars-models';
  const beds: THREE.Group[] = [];
  for (const base of BW_BASES) { beds[base.team] = bed(w, group, base); baseProps(w, group, base); }
  const astronomy = armillary(w, group);
  const floating: { object: THREE.Group; y: number; phase: number }[] = [];
  for (const generator of BW_GENERATORS) {
    const { kind, pos } = generator;
    const g = w.group(group, pos.x, pos.y + (kind === 'iron' || kind === 'gold' ? .72 : 1.15), pos.z);
    g.name = `generator-resource-${generator.id}`;
    if (kind === 'iron' || kind === 'gold') {
      const color = kind === 'gold' ? C.gold : C.iron;
      w.box(g, .42, .16, .23, color, 0, 0, 0);
      w.box(g, .31, .035, .18, kind === 'gold' ? 0xffe2a0 : 0xdce9ef, 0, .09, 0);
    } else {
      const color = kind === 'diamond' ? 0x69d8e8 : 0x4bdfa1;
      w.gem(g, color, 0, 0, 0, 1.1);
      const halo = w.ring(group, .77, C.brass, pos.x, pos.y + .025, pos.z); halo.rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        w.box(group, .16, .05, .16, color, pos.x + Math.cos(a) * .83, pos.y + .04, pos.z + Math.sin(a) * .83);
      }
      w.label(group, kind === 'diamond' ? 'Diamond' : 'Emerald', pos.x, pos.y + 2.05, pos.z,
        kind === 'diamond' ? '#3fd3e0' : '#2fc46d', 1.45);
    }
    floating.push({ object: g, y: g.position.y, phase: generator.id * .79 });
  }
  const animated = new Set<THREE.Object3D>([...beds, astronomy, ...floating.map(f => f.object)]);
  for (const root of animated) w.batch(root as THREE.Group);
  w.batch(group, animated);
  let disposed = false;
  return {
    group, beds,
    update(timeSeconds: number): void {
      if (disposed) return;
      const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
      for (const { object, y, phase } of floating) {
        object.position.y = y + Math.sin(t * 1.7 + phase) * .105;
        object.rotation.y = t * .55 + phase;
      }
      astronomy.rotation.y = t * .065;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true; group.removeFromParent(); group.clear(); w.dispose();
    },
  };
}
