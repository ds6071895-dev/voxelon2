// Dropped item entities: spinning, bobbing mini-blocks / sprites that
// scatter on spawn, merge with nearby stacks, magnet to the player and get
// picked up into the inventory.

import * as THREE from 'three';
import { BLOCKS, BlockInfo, isSolid, Tile } from './blocks';
import type { Inventory } from './inventory';
import { Item, ITEMS } from './items';
import { createBowModel, poseBowModel } from './bowmodel';
import type { Player } from './player';
import type { Atlas } from './textures';
import type { World } from './world';
import { createGunModel, isGunItem, poseGunModel } from './gunmodels';
import { createGadgetModel, isModeledGadget, poseGadgetModel } from './gadgetmodels';

// Shared mini-block / sprite geometry per item id (held view uses it too).
const geoCache = new Map<number, THREE.BufferGeometry>();

const GRASS_TINT: [number, number, number] = [0.57, 0.74, 0.35];

// A 0.25 cube with one upright quad per face: bottom-left, bottom-right,
// top-right, top-left -> uv (0,0),(1,0),(1,1),(0,1). Shade per vanilla
// face brightness; grass tints only the top, foliage tints every face.
function buildCubeGeometry(atlas: Atlas, block: BlockInfo): THREE.BufferGeometry {
  const h = 0.125;
  const faces: {
    tile: Tile; shade: number; tinted: boolean;
    c: [number, number, number][];
  }[] = [
    { tile: block.top, shade: 1.0, tinted: block.tint !== null,
      c: [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]] },          // +y top
    { tile: block.bottom, shade: 0.5, tinted: block.tint === 'foliage',
      c: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]] },      // -y bottom
    { tile: block.side, shade: 0.8, tinted: block.tint === 'foliage',
      c: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },          // +z
    { tile: block.side, shade: 0.8, tinted: block.tint === 'foliage',
      c: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },      // -z
    { tile: block.side, shade: 0.6, tinted: block.tint === 'foliage',
      c: [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]] },          // +x
    { tile: block.side, shade: 0.6, tinted: block.tint === 'foliage',
      c: [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]] },      // -x
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const quadUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    const base = positions.length / 3;
    const [u0, v0, u1, v1] = atlas.uvRect(f.tile);
    for (let i = 0; i < 4; i++) {
      positions.push(f.c[i][0], f.c[i][1], f.c[i][2]);
      uvs.push(u0 + (u1 - u0) * quadUV[i][0], v0 + (v1 - v0) * quadUV[i][1]);
      const t = f.tinted ? GRASS_TINT : [1, 1, 1];
      colors.push(f.shade * t[0], f.shade * t[1], f.shade * t[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

/** Mini-cube for cube blocks, flat sprite for items/plants/torches. */
export function itemGeometry(atlas: Atlas, id: number): THREE.BufferGeometry {
  let geo = geoCache.get(id);
  if (geo) return geo;
  const info = ITEMS[id];
  const block = info?.kind === 'block' ? BLOCKS[info.block!] : null;

  if (block && block.shape === 'cube') {
    // Hand-built cube with explicit, upright per-face UVs and vanilla face
    // shading (top brightest). BoxGeometry's built-in UVs mis-orient the top
    // face; building it ourselves keeps every face textured correctly so the
    // held block reads like its hotbar icon.
    geo = buildCubeGeometry(atlas, block);
  } else {
    const tile: Tile = block ? block.side : info?.sprite ?? Tile.Stone;
    geo = new THREE.PlaneGeometry(0.45, 0.45);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const [u0, v0, u1, v1] = atlas.uvRect(tile);
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, u0 + (u1 - u0) * uv.getX(k), v0 + (v1 - v0) * uv.getY(k));
    }
    const colors = new Float32Array(uv.count * 3).fill(1);
    if (block?.tint === 'grass') {
      for (let k = 0; k < uv.count; k++) {
        colors[k * 3] = 0.57; colors[k * 3 + 1] = 0.74; colors[k * 3 + 2] = 0.35;
      }
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  geoCache.set(id, geo);
  return geo;
}

const GRAVITY = 16;
const RADIUS = 0.125;
const MERGE_RADIUS = 0.75;
const MAGNET_RADIUS = 1.6;
const PICKUP_RADIUS = 0.45;
const PICKUP_DELAY = 0.5; // seconds before a fresh drop can be collected
const DESPAWN = 300;
const MAX_ENTITIES = 300;

interface Drop {
  id: number;
  count: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  phase: number;
  mesh: THREE.Object3D;
}

export class ItemEntities {
  private readonly list: Drop[] = [];
  private readonly scene: THREE.Scene;
  private readonly world: World;
  private readonly atlas: Atlas;
  private readonly material: THREE.MeshBasicMaterial;
  private mergeTimer = 0;

  constructor(scene: THREE.Scene, world: World, atlas: Atlas) {
    this.scene = scene;
    this.world = world;
    this.atlas = atlas;
    this.material = new THREE.MeshBasicMaterial({
      map: atlas.texture,
      alphaTest: 0.4,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
  }

  get count(): number {
    return this.list.length;
  }

  /** Spawn a drop at a block position with a small scatter burst. */
  spawn(x: number, y: number, z: number, id: number, count: number): void {
    if (this.list.length >= MAX_ENTITIES) return;
    const mesh = isGunItem(id)
      ? createGunModel(id)
      : isModeledGadget(id)
        ? createGadgetModel(id)
        : id === Item.BridgeBow ? createBowModel()
        : new THREE.Mesh(itemGeometry(this.atlas, id), this.material);
    if (isGunItem(id)) poseGunModel(mesh, 'drop');
    else if (isModeledGadget(id)) poseGadgetModel(mesh, 'drop');
    else if (id === Item.BridgeBow) poseBowModel(mesh, 'drop');
    this.scene.add(mesh);
    this.list.push({
      id, count,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 2.4, 2.6 + Math.random(), (Math.random() - 0.5) * 2.4
      ),
      age: 0,
      phase: Math.random() * Math.PI * 2,
      mesh,
    });
  }

  update(dt: number, player: Player, inventory: Inventory, sunlight: number): void {
    // One shared material: approximate world lighting with the sun factor.
    this.material.color.setScalar(0.45 + 0.55 * sunlight);

    const playerCenter = player.pos.clone();
    playerCenter.y += 0.9;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.age += dt;
      if (d.age > DESPAWN) {
        this.remove(i);
        continue;
      }

      // Magnet + pickup.
      const dist = d.pos.distanceTo(playerCenter);
      if (d.age > PICKUP_DELAY && dist < MAGNET_RADIUS && inventory.canAccept(d.id)) {
        if (dist < PICKUP_RADIUS) {
          const left = inventory.add(d.id, d.count);
          if (left === 0) {
            this.remove(i);
            continue;
          }
          d.count = left;
        } else {
          d.vel.copy(playerCenter).sub(d.pos).normalize().multiplyScalar(6);
        }
      } else {
        d.vel.y -= GRAVITY * dt;
      }

      // Integrate with simple voxel collision around the entity center.
      const next = d.pos.clone().addScaledVector(d.vel, dt);
      if (this.solidAt(d.pos.x, next.y - RADIUS, d.pos.z)) {
        next.y = Math.floor(next.y - RADIUS) + 1 + RADIUS;
        d.vel.y = 0;
        d.vel.x *= Math.max(0, 1 - 8 * dt); // ground friction
        d.vel.z *= Math.max(0, 1 - 8 * dt);
      }
      if (this.solidAt(next.x, d.pos.y, d.pos.z)) {
        next.x = d.pos.x;
        d.vel.x = 0;
      }
      if (this.solidAt(d.pos.x, d.pos.y, next.z)) {
        next.z = d.pos.z;
        d.vel.z = 0;
      }
      d.pos.copy(next);

      d.mesh.position.set(
        d.pos.x,
        d.pos.y + 0.1 + Math.sin(d.age * 2 + d.phase) * 0.06,
        d.pos.z
      );
      d.mesh.rotation.y += dt * 1.8;
    }

    // Merge nearby identical stacks (cheap O(n^2), throttled).
    this.mergeTimer += dt;
    if (this.mergeTimer > 0.25) {
      this.mergeTimer = 0;
      for (let i = 0; i < this.list.length; i++) {
        for (let j = this.list.length - 1; j > i; j--) {
          const a = this.list[i], b = this.list[j];
          if (
            a.id === b.id &&
            a.count + b.count <= (ITEMS[a.id]?.maxStack ?? 64) &&
            a.pos.distanceTo(b.pos) < MERGE_RADIUS
          ) {
            a.count += b.count;
            this.remove(j);
          }
        }
      }
    }
  }

  private solidAt(x: number, y: number, z: number): boolean {
    return isSolid(this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  private remove(i: number): void {
    this.scene.remove(this.list[i].mesh);
    this.list.splice(i, 1);
  }
}
