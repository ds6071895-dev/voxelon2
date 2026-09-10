import * as THREE from 'three';
import { parkourCourse, partyHash, type PartySubBounds } from './partygames';
import { parkourTheme, type ParkourTheme } from './parkour_themes';
type BoxStamp = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  turn: number;
};
/** Small instanced architectural details, drawn outside the jump corridor or
* below platforms. They never add invisible obstacles or edit world terrain. */
export class ParkourScenery {
  private readonly root = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  private seedKey = '';
  private readonly materials = new Map<number, THREE.MeshBasicMaterial>();
  private readonly stamps = new Map<number, BoxStamp[]>();
  private motes: THREE.Points | null = null;
  constructor(scene: THREE.Scene) {
    // Baked face light keeps distant details readable in every theme and quality preset.
    const normal = this.geometry.getAttribute('normal'), colors: number[] = [];
    for (let i = 0; i < normal.count; i++) {
      const shade = normal.getY(i) > .5 ? 1 : normal.getY(i) < -.5 ? .42 : normal.getX(i) > .5 ? .78 : .64;
      colors.push(shade, shade, shade);
    }
    this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    scene.add(this.root);
    this.root.visible = false;
  }
  clear(): void { this.root.visible = false; }
  private box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, turn = 0): void {
    let list = this.stamps.get(color);
    if (!list) {
      list = [];
      this.stamps.set(color, list);
    }
    list.push({ x, y, z, w, h, d, turn });
  }
  private island(x: number, y: number, z: number, w: number, theme: ParkourTheme): void {
    this.box(x, y - .4, z, w, .8, w, theme.trim);
    this.box(x, y - 1.5, z, w * .85, 1.4, w * .85, theme.stone);
    this.box(x + .3, y - 3, z - .2, w * .56, 1.7, w * .58, theme.stone);
    this.box(x - .2, y - 4.3, z, w * .24, 1.2, w * .25, theme.accent);
  }
  private lantern(x: number, y: number, z: number, t: ParkourTheme): void {
    this.box(x, y + .9, z, .09, 1.4, .09, t.trim);
    this.box(x, y, z, .42, .55, .42, t.light);
    this.box(x, y + .3, z, .55, .1, .55, t.trim);
    this.box(x, y - .3, z, .5, .1, .5, t.trim);
  }
  private tree(x: number, y: number, z: number, t: ParkourTheme, scale = 1): void {
    this.box(x, y + 1.4 * scale, z, .55 * scale, 2.8 * scale, .55 * scale, t.trim);
    this.box(x + .65 * scale, y + 2.4 * scale, z, .9 * scale, .3 * scale, .4 * scale, t.trim);
    this.box(x, y + 3 * scale, z, 3.6 * scale, 1.4 * scale, 3 * scale, t.foliage);
    this.box(x - .5 * scale, y + 4 * scale, z, 2.4 * scale, .9 * scale, 2.2 * scale, t.id === 'garden' ? t.accent : t.trim);
    this.box(x + 1.4 * scale, y + 2.7 * scale, z + .7 * scale, 1.8 * scale, 1 * scale, 1.5 * scale, t.id === 'garden' ? t.accent : t.foliage);
  }
  private tower(x: number, y: number, z: number, t: ParkourTheme, height: number): void {
    this.box(x, y + height / 2, z, 3.5, height, 3.5, t.stone);
    for (let level = 1; level < height; level += 2.5) {
      this.box(x, y + level, z, 3.8, .2, 3.8, t.trim);
      for (const dx of [-1, 1]) {
        this.box(x + dx, y + level + .8, z - 1.78, .45, .9, .06, t.light);
        this.box(x - 1.78, y + level + .8, z + dx, .06, .9, .45, t.light);
      }
    }
    for (const dx of [-1.7, 1.7])
      for (const dz of [-1.7, 1.7])
        this.box(x + dx, y + height / 2, z + dz, .22, height, .22, t.trim);
    for (let roof = 0; roof < 4; roof++)
      this.box(x, y + height + roof * .42, z, 4.7 - roof, .45, 4.7 - roof, t.accent);
    this.lantern(x, y + height + 2.5, z, t);
  }
  private arch(x: number, y: number, z: number, t: ParkourTheme, scale = 1): void {
    for (const dx of [-2.2, 2.2]) {
      this.box(x + dx * scale, y + 2 * scale, z, .55 * scale, 4 * scale, .65 * scale, t.trim);
      this.box(x + dx * scale, y + .25 * scale, z, 1 * scale, .5 * scale, 1 * scale, t.stone);
      this.box(x + dx * scale, y + 4 * scale, z, .9 * scale, .35 * scale, .9 * scale, t.accent);
    }
    this.box(x, y + 4.4 * scale, z, 5 * scale, .5 * scale, .8 * scale, t.trim);
    this.box(x, y + 4.9 * scale, z, 3.6 * scale, .5 * scale, .8 * scale, t.trim);
    this.box(x, y + 5.3 * scale, z, 1.8 * scale, .3 * scale, .8 * scale, t.accent);
    this.lantern(x, y + 3.8 * scale, z, t);
  }
  private gear(x: number, y: number, z: number, t: ParkourTheme, r: number): void {
    for (let tooth = 0; tooth < 16; tooth++) {
      const a = tooth / 16 * Math.PI * 2;
      this.box(x + Math.cos(a) * r, y, z + Math.sin(a) * r, .55, .28, .55, t.trim, a);
    }
    this.box(x, y, z, r * 1.7, .3, .25, t.accent);
    this.box(x, y, z, .25, .3, r * 1.7, t.accent);
    this.box(x, y, z, .6, .65, .6, t.light);
  }
  private pavilion(x: number, y: number, z: number, t: ParkourTheme, variant: number): void {
    const b = this.box.bind(this);
    this.island(x, y, z, 7 + (variant % 3), t);
    if (t.id === 'garden') {
      this.arch(x, y, z, t, .9);
      this.tree(x + 2, y, z + 1.5, t, .85);
      this.tree(x - 2, y, z - 1.5, t, .6);
      for (let i = 0; i < 6; i++)
        b(x - 3 + i, y - 1.5 - i % 3, z + 3, .3, 2 + i % 3, .3, t.foliage);
      for (let i = 0; i < 4; i++) {
        b(x - 2 + i * 1.4, y + .2, z - 2, 1, .35, .8, t.trim);
        b(x - 2 + i * 1.4, y + .55, z - 2, .6, .4, .5, t.accent);
      }
    }
    else if (t.id === 'clockwork') {
      this.tower(x, y, z, t, 5 + variant % 4);
      this.gear(x + 2.5, y + 1, z - 2, t, 1.4);
      b(x + 2, y + 4, z + 1, .6, 7, .6, t.trim);
      b(x + 1.5, y + 7.5, z + 1, 1.6, .6, .6, t.trim);
      for (let i = 0; i < 3; i++)
        b(x - 2.1, y + 1 + i * 1.5, z + 1.8, .3, 1, .3, t.accent);
    }
    else if (t.id === 'lunar') {
      this.arch(x, y, z, t, 1.3);
      for (let i = 0; i < 4; i++) {
        const h = 2 + (variant + i) % 4;
        b(x - 2.5 + i * 1.6, y + h / 2, z + 2, .55, h, .55, t.stone);
        b(x - 2.5 + i * 1.6, y + h, z + 2, .8, .2, .8, t.light);
      }
      b(x, y + .3, z - 1, 2, .5, 2, t.accent);
      b(x, y + 1, z - 1, .4, 1, .4, t.light);
    }
    else if (t.id === 'coral') {
      this.arch(x, y, z, t, 1.1);
      for (let i = 0; i < 5; i++) {
        const px = x - 2.5 + i * 1.2, pz = z + ((i % 2) * 4 - 2), h = 1.5 + i % 3;
        b(px, y + h / 2, pz, .25, h, .25, i % 2 ? t.accent : t.foliage);
        b(px + .45, y + h * .65, pz, .9, .25, .25, t.accent);
        b(px + .85, y + h * .65 + .35, pz, .25, .7, .25, t.accent);
        b(px, y + h, pz, .55, .3, .55, t.light);
      }
      for (let i = 0; i < 6; i++)
        b(x - 2.5 + i, y - .9, z + 3, .12, 1.7, .12, t.foliage);
    }
    else if (t.id === 'candy') {
      this.tower(x, y, z, t, 3.5);
      for (const dx of [-2.8, 2.8])
        for (let i = 0; i < 6; i++)
          b(x + dx, y + i * .5, z - 2, .4, .5, .4, i % 2 ? t.accent : t.trim);
      b(x - 2.4, y + 2.8, z - 2, 1.2, .4, .4, t.accent);
      b(x + 2.4, y + 2.8, z - 2, 1.2, .4, .4, t.accent);
      for (let i = 0; i < 12; i++)
        b(x - 2.5 + (i % 4) * 1.6, y + .08, z - 2.5 + Math.floor(i / 4) * 2.3, .35, .12, .12, i % 2 ? t.accent : t.foliage, i);
    }
    else if (t.id === 'neon') {
      this.tower(x, y, z, t, 8 + variant % 6);
      b(x, y + 6, z - 1.9, 2.8, 1.4, .2, t.accent);
      for (let i = 0; i < 5; i++)
        b(x - 1 + i * .5, y + 6, z - 2.03, .15, .8, .04, t.light);
      b(x + 2.2, y + 1, z, 1, 1.8, 2, t.trim);
      b(x + 2.2, y + 2, z, .8, .12, 1.7, t.light);
      this.tree(x - 2.7, y, z + 2, t, .5);
    }
    else if (t.id === 'frost') {
      this.tower(x, y, z, t, 6 + variant % 5);
      this.tree(x - 2.7, y, z + 2, t, .8);
      for (let i = 0; i < 6; i++)
        b(x - 2 + i * .8, y - 1.1 - (i % 3) * .4, z - 3, .18, 1 + i % 3 * .8, .18, t.accent);
      for (let i = 0; i < 3; i++)
        b(x + 2.5, y + 1 + i * .7, z - 1, 1 - i * .25, .7, 1 - i * .25, t.light);
    }
    else {
      this.tower(x, y, z, t, 5 + variant % 4);
      for (const dx of [-2.6, 2.6]) {
        b(x + dx, y + 2, z + 1, 1, 4, 1, t.stone);
        b(x + dx, y + 4.3, z + 1, 1.3, .6, 1.3, t.light);
      }
      b(x, y - 3, z - 3, .8, 5, .25, t.light);
      b(x, y - 5.5, z - 2.8, 2, .12, 1, t.accent);
      for (let i = 0; i < 3; i++)
        b(x - 1 + i, y + .04, z + 2, .3, .08, 2, t.light);
    }
  }
  update(sub: PartySubBounds, now: number): void {
    this.root.visible = true;
    const key = `${sub.slot}:${sub.seed}:${sub.index}`;
    if (key !== this.seedKey) {
      this.seedKey = key;
      this.build(sub);
    }
    if (this.motes) {
      this.motes.rotation.y = Math.sin(now / 16000) * .05;
      this.motes.position.y = Math.sin(now / 3000) * .5;
    }
  }
  private build(sub: PartySubBounds): void {
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      if (child instanceof THREE.InstancedMesh)
        child.dispose();
      if (child instanceof THREE.Points) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.motes = null;
    this.stamps.clear();
    this.root.position.set(sub.minX, 0, sub.minZ);
    const theme = parkourTheme(sub.seed), b = this.box.bind(this);
    const width = sub.maxX - sub.minX, length = sub.maxZ - sub.minZ;
    if (sub.game === 'parkour')
      this.buildParkour(sub, theme);
    else
      this.buildBridge(sub, theme);
    // The buildings sit outside the playing footprint on their own islands,
    // flanking the venue down its length so the route always has a horizon.
    const flanks = Math.max(8, Math.round(length / 22));
    for (let i = 0; i < flanks; i++) {
      const h = partyHash(sub.seed, i + 700), side = i % 2 ? 1 : -1;
      const x = width / 2 + side * (width * .55 + 8 + h % 12);
      const z = 8 + (i + .5) * (length - 16) / flanks + (h >>> 8) % 9;
      this.pavilion(x, sub.floor - 4 + (h >>> 16) % 9, z, theme, h % 16);
    }
    // Hanging lanterns give the drop below the route a readable scale.
    const lamps = Math.max(12, Math.round(length / 14));
    for (let i = 0; i < lamps; i++) {
      const side = i % 2 ? 1 : -1, t = (i + .5) / lamps;
      b(width / 2 + side * (width * .5 + 5), sub.floor - 2 + Math.sin(t * 9) * 2, t * length, .1, 1.2, .1, theme.trim);
      this.lantern(width / 2 + side * (width * .5 + 5), sub.floor - 4 + Math.sin(t * 9) * 2, t * length, theme);
    }
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), axis = new THREE.Vector3(0, 1, 0);
    for (const [color, stamps] of this.stamps) {
      let material = this.materials.get(color);
      if (!material) {
        material = new THREE.MeshBasicMaterial({ color, vertexColors: true });
        this.materials.set(color, material);
      }
      const mesh = new THREE.InstancedMesh(this.geometry, material, stamps.length);
      stamps.forEach((s, i) => { quaternion.setFromAxisAngle(axis, s.turn); matrix.compose(new THREE.Vector3(s.x, s.y, s.z), quaternion, new THREE.Vector3(s.w, s.h, s.d)); mesh.setMatrixAt(i, matrix); });
      mesh.computeBoundingSphere();
      this.root.add(mesh);
    }
    const positions: number[] = [];
    for (let i = 0; i < 180; i++) {
      const h = partyHash(sub.seed, i + 1000);
      positions.push((h % 1000) / 1000 * (width + 24) - 12,
        sub.floor - 8 + ((h >>> 10) % 300) / 10,
        ((h >>> 19) % 1000) / 1000 * length);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.motes = new THREE.Points(geometry, new THREE.PointsMaterial({ color: theme.light, size: theme.id === 'frost' ? .12 : .07, transparent: true, opacity: .6, depthWrite: false }));
    this.root.add(this.motes);
  }

  /** Underpinnings for the straight jump lane: every platform gets a plinth,
   *  and the finish gets an arch you can see from the start terrace. */
  private buildParkour(sub: PartySubBounds, theme: ParkourTheme): void {
    const b = this.box.bind(this), course = parkourCourse(sub.seed);
    course.forEach((p, i) => {
      const cx = Math.floor(p.x - p.width / 2) + p.width / 2, cz = Math.floor(p.z - p.depth / 2) + p.depth / 2;
      b(cx, p.y - 1.15, cz, p.width + .14, .3, p.depth + .14, theme.trim);
      b(cx, p.y - 2, cz, p.width * .75, 1.4, p.depth * .75, theme.stone);
      b(cx, p.y - 3, cz, p.width * .35, .7, p.depth * .35, theme.accent);
      for (const dx of [-1, 1])
        b(cx + dx * (p.width / 2 - .2), p.y - 1.55, cz, .16, .5, p.depth * .7, theme.accent);
      if (p.checkpoint) {
        // Lamps hang beneath saved platforms; the landing surface stays clear.
        this.lantern(cx, p.y - 3, cz, theme);
        for (const dx of [-1, 1])
          for (const dz of [-1, 1])
            b(cx + dx * (p.width / 2 - .22), p.y + .025, cz + dz * (p.depth / 2 - .22), .22, .045, .22, theme.light);
      }
      if (theme.id === 'garden' || theme.id === 'coral')
        for (let v = 0; v < 2; v++)
          b(cx + v, p.y - 2.7 - (i % 3) * .3, cz + 1, .15, 2 + i % 3, .15, theme.foliage);
      if (theme.id === 'frost')
        b(cx, p.y - 3.8, cz, .2, 1.5, .2, theme.light);
    });
    const start = course[0], end = course[course.length - 1];
    this.arch(end.x, end.y, end.z, theme, 1);
    this.arch(start.x, start.y, start.z - 4, theme, .8);
  }

  /** The Bridge is stamped in real blocks, so the scenery only has to build a
   *  world around it: buttresses under each base and a chasm you can read.
   *
   *  Everything here is measured off the venue's own footprint rather than
   *  written out in absolute blocks — the venue is half the size it once was,
   *  and a chasm authored in fixed numbers would have hung out past both ends
   *  of it. `base` is the depth of one base, which is what every landmark on
   *  this side is actually anchored to. */
  private buildBridge(sub: PartySubBounds, theme: ParkourTheme): void {
    const b = this.box.bind(this), width = sub.maxX - sub.minX, length = sub.maxZ - sub.minZ;
    const base = 17, mid = length / 2;
    for (const front of [0, 1]) {
      const flip = front ? -1 : 1, edge = front ? length : 0;
      // A buttressed cliff falling away under each base.
      for (let i = 0; i < 7; i++) {
        const inset = i * 1.3;
        b(width / 2, sub.floor - 7 - i * 2.6, edge + flip * (base / 2 + i),
          width - 4 - inset * 2, 2.6, base + 2 - inset * 3, i < 3 ? theme.stone : theme.trim);
      }
      b(width / 2, sub.floor - 27, edge + flip * (base / 2), 4, 11, 4, theme.accent);
      for (const dx of [-1, 1])
        this.tower(width / 2 + dx * (width / 2 + 5), sub.floor - 3, edge + flip * (base / 2), theme, 11);
      // Braziers flanking the mouth of the span — set well back from the
      // walkway, because nothing beside it may ever look like a foothold.
      for (const dx of [-1, 1])
        for (const dz of [base + 3, base + 12])
          this.lantern(width / 2 + dx * 5, sub.floor + 3, edge + flip * dz, theme);
    }
    // A lit spine under the middle island, so the crossing has a bottom to it.
    for (let i = 0; i < 9; i++)
      b(width / 2, sub.floor - 13 - i * 2.2, mid, 9 - i, 2, 9 - i, i % 2 ? theme.stone : theme.trim);
    b(width / 2, sub.floor - 36, mid, 1.4, 12, 1.4, theme.light);
    // Chains hanging off the span itself. They are scenery — never blocks —
    // so the walkway stays exactly one block wide with nothing beside it, and
    // they give the drop under your feet something to fall past.
    const span = length - 2 * (base + 3);
    for (let i = 0; i < 18; i++) {
      const z = base + 3 + i * span / 17;
      b(width / 2, sub.floor - 2.2, z, .25, 1.6, .25, theme.trim);
      if (i % 3 === 0) this.lantern(width / 2, sub.floor - 6, z, theme);
    }
  }
}
