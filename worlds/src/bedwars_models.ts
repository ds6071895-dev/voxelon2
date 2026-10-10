// Hand-built, reusable low-poly furnishings for the Bedwars maps: beds,
// shopkeepers, generators and the props around them. Everything stationary is
// baked into a few draw calls and textured with a world-space pixel-noise
// detail map; shopkeepers are real textured player models.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BedwarsBase, BedwarsMap } from './bedwars_map';
import { BW_TEAM_COLORS } from './bedwars_rules';
import { Item } from './items';
import { itemGeometrySolid } from './item_geometry';
import { buildAvatarBody, disposeAvatarBody, type AvatarBody } from './avatar';
import type { Cosmetics } from './character';
import type { Atlas } from './textures';

const C = {
  wood: 0x624334, lightWood: 0x9a704b, darkWood: 0x352b29, edge: 0xc99b64,
  brass: 0xd5ae61, gold: 0xffce68, iron: 0xa5bac8, ironDark: 0x445362,
  linen: 0xfaf0d7, seam: 0xe6d1a6, red: 0xbd3d50, redLight: 0xe66e78,
  blue: 0x315faf, jade: 0x39bd92, glass: 0x8de4e5,
  ink: 0x242834, leaf: 0x51874d,
};
const hex = (css: string): number => parseInt(css.slice(1), 16);
const TEAM = BW_TEAM_COLORS.map(hex);
const TEAM_LIGHT = TEAM.map((c) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), .35).getHex());

/** Blocks one detail-texture tile spans (it is 32 px: 16 texels per block). */
const DETAIL_BLOCKS = 2;
function detailTexture(): THREE.Texture {
  const size = 32, data = new Uint8Array(size * size * 4);
  let seed = 9173;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Mostly light pixels with darker flecks, and faint streaks like grain.
    const grain = (y % 4 === 0 ? -10 : 0) + (rnd() < .12 ? -26 : 0);
    const v = Math.max(170, Math.min(255, 238 + Math.floor(rnd() * 17) + grain));
    data.set([v, v, v, 255], (y * size + x) * 4);
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Pixel art for a gem block (Minecraft's diamond/emerald block look). */
function gemBlockTexture(base: number, light: number, dark: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const css = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = css(base); ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = css(dark);
  ctx.fillRect(0, 15, 16, 1); ctx.fillRect(15, 0, 1, 16);
  for (const [x, y] of [[3, 3], [9, 5], [5, 10], [11, 11], [2, 7], [12, 2]]) ctx.fillRect(x, y, 2, 1);
  ctx.fillStyle = css(light);
  ctx.fillRect(0, 0, 16, 1); ctx.fillRect(0, 0, 1, 16);
  for (const [x, y] of [[4, 2], [10, 4], [6, 9], [12, 10], [2, 12], [8, 13]]) { ctx.fillRect(x, y, 2, 2); ctx.fillRect(x + 1, y - 1, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
  /** Every prop is vertex-coloured and multiplied by a pixel-noise detail
   *  texture laid out in world space at 16 texels per block, so wood, cloth
   *  and metal read as Minecraft textures instead of flat plastic. */
  readonly detail = detailTexture();
  readonly material = new THREE.MeshBasicMaterial({ vertexColors: true, map: this.detail });
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
  /** A floating name tag: a bold title and a small hint line, Hypixel style. */
  label(parent: THREE.Object3D, title: string, hint: string, x: number, y: number, z: number, color: string, width = 1.9): void {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = hint ? 150 : 96;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = 'rgba(16,22,32,.62)';
    ctx.beginPath(); ctx.roundRect(6, 6, 500, canvas.height - 12, 18); ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 48px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = color;
    ctx.fillText(title, 256, hint ? 54 : 48, 470);
    if (hint) { ctx.font = '800 32px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#ffd95c'; ctx.fillText(hint, 256, 108, 470); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material); sprite.position.set(x, y, z); sprite.scale.set(width, width * canvas.height / 512, 1);
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
        // World-space texel UVs: each face samples the detail texture by the
        // two axes it spans, so a 1-block face shows 16 x 16 texels.
        flat.deleteAttribute('uv');
        const pos = flat.getAttribute('position'), nor = flat.getAttribute('normal'), uv = new Float32Array(pos.count * 2);
        const world = new THREE.Vector3(), n = new THREE.Vector3(), normalMatrix = new THREE.Matrix3().getNormalMatrix(root.matrixWorld);
        for (let i = 0; i < pos.count; i++) {
          world.fromBufferAttribute(pos, i).applyMatrix4(root.matrixWorld);
          n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix);
          const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
          const [a, b] = ax >= ay && ax >= az ? [world.z, world.y] : ay >= az ? [world.x, world.z] : [world.x, world.y];
          uv[i * 2] = a / DETAIL_BLOCKS; uv[i * 2 + 1] = b / DETAIL_BLOCKS;
        }
        flat.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
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
    this.geometries.clear(); this.material.dispose(); this.detail.dispose();
    for (const material of this.spriteMaterials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.spriteMaterials.length = 0; this.textures.length = 0;
  }
  /** Construction is complete: retain only owned geometries still in the tree.
   * Atlas/item geometry has never been put in this workshop's ownership map. */
  releaseSources(root: THREE.Object3D): void {
    const retained = new Set<THREE.BufferGeometry>();
    root.traverse(object => { if (object instanceof THREE.Mesh) retained.add(object.geometry); });
    for (const [key, geometry] of this.geometries) if (!retained.has(geometry)) {
      geometry.dispose(); this.geometries.delete(key);
    }
  }
}

function bed(w: Workshop, parent: THREE.Group, base: BedwarsBase): THREE.Group {
  // Centred on the two bed cells; local -z is the pillow end, +z the foot.
  const g = w.group(parent, (base.bed.x + base.bedFoot.x) / 2 + .5, base.bed.y, (base.bed.z + base.bedFoot.z) / 2 + .5);
  g.rotation.y = Math.atan2(base.bedFoot.x - base.bed.x, base.bedFoot.z - base.bed.z);
  g.name = `bed-${base.team}`;
  const color = TEAM[base.team], light = TEAM_LIGHT[base.team];
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

/** Shopkeepers are textured player models in a team-coloured or green shirt,
 *  idly looking around, with a Hypixel-style tag over their heads. */
const SHOPKEEPER: Cosmetics = { skin: 2, hairStyle: 0, hair: 1, eyes: 1, shirt: 0, pants: 2, hat: 0, hatColor: 0, face: 0 };
const UPGRADER: Cosmetics = { skin: 5, hairStyle: 0, hair: 3, eyes: 2, shirt: 0, pants: 4, hat: 3, hatColor: 3, face: 0 };

function baseProps(w: Workshop, parent: THREE.Group, base: BedwarsBase, active: boolean, people: AvatarBody[]): void {
  // Local frame: +x points into the courtyard (toward the middle), +z across.
  const hall = w.group(parent, base.center.x, 97, base.center.z);
  hall.rotation.y = Math.atan2(-base.inward.z, base.inward.x);
  const team = TEAM[base.team];
  for (const z of [-7, 7]) {
    const upgrades = z > 0;
    // The counter, with wares laid out on it.
    w.box(hall, .96, .10, 3.06, C.lightWood, -7, 1.04, z);
    w.box(hall, 1.02, .045, 3.14, C.brass, -7, 1.105, z);
    if (!upgrades) {
      for (let i = 0; i < 3; i++) w.box(hall, .50, .12, .56, i % 2 ? C.linen : team, -7, 1.19 + i * .13, z - .8);
      w.box(hall, .46, .12, .25, C.iron, -7, 1.20, z + .65);
      w.box(hall, .35, .12, .21, C.gold, -7, 1.32, z + .68);
      w.box(hall, .08, .035, .71, C.iron, -6.81, 1.19, z);
      w.box(hall, .25, .05, .055, C.brass, -6.81, 1.20, z + .34);
    } else {
      books(w, hall, -7, 1.21, z - .7);
      for (let i = 0; i < 3; i++) {
        w.cylinder(hall, .10, .25, [C.jade, C.redLight, C.glass][i], -7, 1.27, z + .45 + i * .3, .8);
        w.cylinder(hall, .045, .095, C.brass, -7, 1.435, z + .45 + i * .3);
      }
    }
    if (!active) continue;
    const body = buildAvatarBody(upgrades ? UPGRADER : SHOPKEEPER, new THREE.Color(upgrades ? 0x3f6b58 : team));
    body.group.position.set(-8, 0, z);
    body.group.rotation.y = -Math.PI / 2;
    for (const arm of body.parts.slice(2)) arm.rotation.x = -.35;
    hall.add(body.group);
    people.push(body);
    w.label(hall, upgrades ? 'TEAM UPGRADES' : 'ITEM SHOP', 'Press E', -8, 2.45, z, upgrades ? '#7cf0c4' : '#7fe3ff');
  }
  const storage = w.group(hall, -4.8, 0, 9.3); storage.rotation.y = -Math.PI / 2; chest(w, storage);
  if (active) w.label(hall, 'TEAM CHEST', '', -4.8, 1.55, 9.3, '#ffe08a', 1.2);
  barrel(w, hall, -9.4, 0, 9.4); barrel(w, hall, -9.4, 0, -9.4);
  // Team banners on the hall's eaves.
  for (const z of [-4, 4]) {
    const flag = w.group(hall, -1.36, 4.7, z);
    w.box(flag, .10, .10, 1.8, C.brass, 0, 0, 0);
    w.box(flag, .065, 1.45, 1.22, team, 0, -.71, 0);
    for (const zz of [-.48, .48]) w.box(flag, .074, 1.5, .045, C.brass, .003, -.73, zz);
    for (const zz of [-.40, .40]) w.box(flag, .065, .28, .4, team, 0, -1.54, zz);
    const emblem = w.box(flag, .08, .40, .40, C.linen, .05, -.69, 0); emblem.rotation.x = Math.PI / 4;
  }
  // Garden benches and planters.
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
      w.box(hall, .16, .09, .16, i % 2 ? C.linen : team, x, 1.04, zz);
    }
  }
}

/** The forge: a stone hearth ring with iron and gold ingots turning over it,
 *  side by side on the island's centre line. */
function forge(w: Workshop, parent: THREE.Group, base: BedwarsBase, atlas: Atlas, spinners: THREE.Object3D[]): void {
  const g = w.group(parent, base.forge.x, 97, base.forge.z);
  g.rotation.y = Math.atan2(-base.inward.z, base.inward.x);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    w.box(g, .22, .08, .22, i % 2 ? C.ironDark : C.brass, Math.cos(a) * 1.25, .04, Math.sin(a) * 1.25);
  }
  const spin = new THREE.Group(); spin.position.set(0, 1.3, 0); g.add(spin);
  const material = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: .4, side: THREE.DoubleSide });
  for (const [item, z] of [[Item.IronIngot, -.32], [Item.GoldIngot, .32]] as const) {
    const m = new THREE.Mesh(itemGeometrySolid(atlas, item, .42, .06), material);
    m.position.z = z; m.rotation.y = Math.PI / 2;
    spin.add(m);
  }
  spin.userData.dispose = () => material.dispose();
  spinners.push(spin);
  w.label(g, 'FORGE', 'Iron · Gold', 0, 2.25, 0, '#ffd27a', 1.25);
}

/** A middle generator: a spinning gem block over a brass ring. */
function gemGenerator(w: Workshop, parent: THREE.Group, x: number, y: number, z: number, kind: 'diamond' | 'emerald',
  spinners: THREE.Object3D[], textures: THREE.Texture[]): void {
  const color = kind === 'diamond' ? 0x69d8e8 : 0x4bdfa1;
  const halo = w.ring(parent, .77, C.brass, x, y + .025, z); halo.rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    w.box(parent, .16, .05, .16, color, x + Math.cos(a) * .83, y + .04, z + Math.sin(a) * .83);
  }
  const tex = kind === 'diamond' ? gemBlockTexture(0x4fd8d0, 0xc8fff6, 0x2a9ea0) : gemBlockTexture(0x2fc46d, 0xa6f5c2, 0x168a45);
  const spin = new THREE.Group(); spin.position.set(x, y + 1.15, z); parent.add(spin);
  if (tex) {
    textures.push(tex);
    const block = new THREE.Mesh(new THREE.BoxGeometry(.62, .62, .62), new THREE.MeshBasicMaterial({ map: tex }));
    block.rotation.set(Math.PI / 4, 0, Math.PI / 4);
    spin.add(block);
    spin.userData.dispose = () => { block.geometry.dispose(); (block.material as THREE.Material).dispose(); };
  }
  spinners.push(spin);
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

export function createBedwarsModels(map: BedwarsMap, teamCount: number, atlas: Atlas): BedwarsModels {
  const w = new Workshop(), group = new THREE.Group(); group.name = 'bedwars-models';
  const beds: THREE.Group[] = [], people: AvatarBody[] = [], spinners: THREE.Object3D[] = [], gemTextures: THREE.Texture[] = [];
  for (const base of map.bases) {
    const active = base.team < teamCount;
    if (active) beds[base.team] = bed(w, group, base);
    baseProps(w, group, base, active, people);
    if (active) forge(w, group, base, atlas, spinners);
  }
  const astronomy = map.theme === 'garden' ? armillary(w, group) : null;
  for (const g of map.generators) if (g.team === undefined) gemGenerator(w, group, g.pos.x, g.pos.y, g.pos.z, g.kind as 'diamond' | 'emerald', spinners, gemTextures);
  const animated = new Set<THREE.Object3D>([...beds.filter(Boolean), ...(astronomy ? [astronomy] : []), ...spinners]);
  for (const b of beds) if (b) w.batch(b);
  if (astronomy) w.batch(astronomy as THREE.Group);
  // Avatars and spinners keep their own materials; everything else bakes.
  const skip = new Set<THREE.Object3D>([...animated, ...people.map((p) => p.group)]);
  w.batch(group, skip);
  w.releaseSources(group);
  const spinnerHeights = spinners.map(s => s.position.y);
  let disposed = false;
  return {
    group, beds,
    update(timeSeconds: number): void {
      if (disposed) return;
      const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
      spinners.forEach((s, i) => { s.rotation.y = t * 1.6 + i; s.position.y = spinnerHeights[i] + Math.sin(t * 1.8 + i) * .04; });
      people.forEach((p, i) => { p.head.rotation.y = Math.sin(t * .45 + i * 1.7) * .55; p.head.rotation.x = Math.sin(t * .3 + i) * .08; });
      if (astronomy) astronomy.rotation.y = t * .065;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true; group.removeFromParent();
      for (const p of people) disposeAvatarBody(p);
      for (const s of spinners) (s.userData.dispose as (() => void) | undefined)?.();
      for (const t of gemTextures) t.dispose();
      group.clear(); w.dispose();
    },
  };
}
