import * as THREE from 'three';
import { bedwarsGenCells, bedwarsMap, BEDWARS_FLOOR_Y, type BwArenaBounds, type BwLobbySnapshot } from './bedwars';
import { Item } from './items';
import { itemGeometry } from './itementity';
import type { Atlas } from './textures';

/** Match-local presentation. Resource meshes are driven by server stock;
 * no world item broadcasts or local pickup predictions are involved. */
export class BedwarsVisuals {
  private readonly root = new THREE.Group();
  private readonly drops = new THREE.Group();
  private readonly beds = new Map<number, THREE.Sprite>();
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly itemMaterial: THREE.MeshBasicMaterial;
  private arenaKey = '';

  constructor(scene: THREE.Scene, private readonly atlas: Atlas) {
    scene.add(this.root);
    this.root.add(this.drops);
    this.itemMaterial = new THREE.MeshBasicMaterial({
      map: atlas.texture, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide,
    });
  }

  private label(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(8,16,28,.88)'; ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = color; ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    const material = new THREE.SpriteMaterial({ map: texture, depthWrite: false });
    this.materials.push(material);
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3.8, 0.71, 1);
    this.root.add(sprite);
    return sprite;
  }

  private box(x: number, y: number, z: number, w: number, h: number, d: number, color: number): void {
    const geometry = new THREE.BoxGeometry(w, h, d);
    const material = new THREE.MeshLambertMaterial({ color });
    this.geometries.push(geometry); this.materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); this.root.add(mesh);
  }

  private build(arena: BwArenaBounds): void {
    this.clear();
    this.arenaKey = `${arena.slot}:${arena.mapId}`;
    const def = bedwarsMap(arena.mapId), y = BEDWARS_FLOOR_Y + 1;
    for (const shop of def.shops) {
      const x = arena.originX + shop.x + 0.5, z = arena.originZ + shop.z + 0.5;
      const color = shop.team === 0 ? 0xdc5669 : 0x518fec;
      // A striped canopy and brass posts frame the existing clickable counter.
      for (const dx of [-0.7, 0.7]) this.box(x + dx, y + 1.35, z, .1, 2.7, .1, 0xd8b16c);
      for (let i = 0; i < 5; i++) this.box(x - .68 + i * .34, y + 2.65, z, .34, .18, 1.5, i % 2 ? 0xffefc8 : color);
      this.box(x, y + 1.4, z, .46, .7, .38, color);
      this.box(x, y + 1.97, z, .42, .42, .42, 0xe6bb91);
      this.box(x, y + 2.19, z, .5, .12, .5, 0x263951);
      this.label('SHOP · RIGHT CLICK', '#ffe0a0').position.set(x, y + 3.35, z);
    }
    for (const gen of bedwarsGenCells(arena)) {
      this.label(gen.diamond ? 'DIAMONDS · CONTEST MID' : 'IRON + GOLD · COLLECT HERE',
        gen.diamond ? '#6ee7f2' : '#ffe0a0').position.set(gen.x, y + 3.1, gen.z);
    }
    for (const bed of def.beds) {
      const label = this.label(bed.team === 0 ? 'CRIMSON BED' : 'COBALT BED', bed.team === 0 ? '#ff8794' : '#91baff');
      label.position.set(arena.originX + bed.x + .5, y + 2, arena.originZ + bed.z + 1);
      this.beds.set(bed.team, label);
    }
  }

  setSnapshot(snapshot: BwLobbySnapshot): void {
    if (!snapshot.arena || snapshot.phase === 'lobby') { this.clear(); return; }
    if (this.arenaKey !== `${snapshot.arena.slot}:${snapshot.arena.mapId}`) this.build(snapshot.arena);
    for (const team of snapshot.teams) {
      const label = this.beds.get(team.team);
      if (label) label.visible = team.bedAlive;
    }
    this.drops.clear();
    for (const pile of snapshot.generators ?? []) {
      const resources = [[Item.IronIngot, pile.iron, -.2], [Item.GoldIngot, pile.gold, .2], [Item.Diamond, pile.diamond, 0]];
      for (const [id, count, offset] of resources) {
        if (!count) continue;
        const mesh = new THREE.Mesh(itemGeometry(this.atlas, id), this.itemMaterial);
        mesh.scale.setScalar(1.5);
        mesh.position.set(pile.x + offset, pile.y, pile.z);
        mesh.userData.baseY = pile.y;
        this.drops.add(mesh);
      }
    }
  }

  update(now: number): void {
    this.drops.children.forEach((mesh, i) => {
      mesh.rotation.y = now * 1.7 + i;
      mesh.position.y = mesh.userData.baseY + Math.sin(now * 2.8 + i) * .09;
    });
  }

  clear(): void {
    this.root.clear(); this.drops.clear(); this.root.add(this.drops);
    this.beds.clear(); this.arenaKey = '';
    this.materials.splice(0).forEach((m) => m.dispose());
    this.geometries.splice(0).forEach((g) => g.dispose());
    this.textures.splice(0).forEach((t) => t.dispose());
  }
}
