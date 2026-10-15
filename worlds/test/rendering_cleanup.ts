import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Block, BLOCKS, Tile, MANOR_RUGS } from '../src/blocks';
import { Chunk } from '../src/chunk';
import { Item, ITEMS } from '../src/items';
import { blockCubeGeometry, itemGeometry, itemGeometrySolid } from '../src/item_geometry';
import { RemotePlayers } from '../src/remoteplayers';
import { buildAvatarBody, disposeAvatarBody } from '../src/avatar';
import {
  createAvatarEquipment, createAvatarItemMaterial, attachAvatarEquipment, poseAvatar,
} from '../src/avatar_equipment';
import { defaultCosmetics } from '../src/character';
import { createBowModel } from '../src/bowmodel';
import { createGunModel } from '../src/gunmodels';
import { createGadgetModel } from '../src/gadgetmodels';
import { cloneModelMaterials } from '../src/model_bake';
import { createRatModel } from '../src/ratseek_models';
import { glowOf } from '../src/model_primitives';
import { WORLDS_ART } from '../src/tile_art';
import { MANOR_ART } from '../src/tile_art_manor';
import { BEDWARS_ART } from '../src/tile_art_bedwars';
import { ATLAS_TILES, CELL_PX, tileOrigin, type Atlas } from '../src/textures';
import { World } from '../src/world';
import type { WorldGenerator } from '../src/multiverse';
import { NetClient, type Remote } from '../src/net/client';
import { TransformBuffer, SenderClock, StateTimeline } from '../src/interp';

/** CPU-only regression suite. Canvas pixels are fixtures; no WebGL context,
 * account storage, media capture, or server startup is involved. */
export function runRenderingCleanupTests(): void {
  atlasTests();
  ownershipTests();
  equipmentTests();
  remoteEquipTests();
  worldTests();
}

function equipmentTests(): void {
  const atlas = fakeAtlas(), material = createAvatarItemMaterial(atlas);
  const body = buildAvatarBody(defaultCosmetics(71));
  const state = { walkPhase: .8, speed: 4.5, sneak: .3, pitch: .4, attackSwing: .5 };
  const cases = [
    [Item.BurstRifle, 'gun'], [Item.BridgeBow, 'bow'], [Item.JumpBoost, 'gadget'],
    [Item.IronAxe, 'item'], [Block.TeamWoolC, 'item'],
  ] as const;
  for (const [id, kind] of cases) {
    const equipment = createAvatarEquipment(atlas, id, material)!;
    assert.equal(equipment.kind, kind);
    attachAvatarEquipment(body, equipment);
    assert.equal(equipment.root.parent, kind === 'gun' ? body.group : body.parts[3]);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    equipment.root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) materials.add(mat);
    });
    let borrowedDisposals = 0;
    const disposed = (): void => { borrowedDisposals++; };
    for (const geometry of geometries) geometry.addEventListener('dispose', disposed);
    for (const material of materials) material.addEventListener('dispose', disposed);
    poseAvatar(body, equipment, { ...state, bowPower: .7, aim: .5, reload: .2 });
    if (kind === 'gun') assert.ok(equipment.root.getObjectByName('muzzle'));
    if (kind === 'bow') {
      assert.ok(equipment.root.getObjectByName('limb1:0'), 'bow is modeled rather than an atlas sprite');
      assert.ok(equipment.root.getObjectByName('nock')!.position.z > .3, 'shared avatar pose applies bow draw');
      assert.equal(createBowModel().getObjectByName('nock')!.position.z, .12, 'bow moving nodes are per-copy');
    }
    if (kind === 'item') {
      assert.ok(equipment.root instanceof THREE.Mesh);
      assert.equal(equipment.root.geometry, itemGeometry(atlas, id));
      assert.equal(equipment.root.material, material);
    }
    equipment.dispose(); equipment.dispose();
    assert.equal(equipment.root.parent, null);
    assert.equal(borrowedDisposals, 0, 'equipment disposal keeps borrowed geometry/materials');
    for (const geometry of geometries) geometry.removeEventListener('dispose', disposed);
    for (const material of materials) material.removeEventListener('dispose', disposed);
  }
  poseAvatar(body, null, state);
  assert.equal(body.parts[2].scale.y, 1, 'gun reach scale resets after equipment change');
  assert.equal(body.parts[3].rotation.y, 0, 'gun reach yaw resets after equipment change');
  assert.equal(createAvatarEquipment(atlas, 0, material), null);
  assert.equal(createAvatarEquipment(atlas, Item.Cheese, material), null);
  disposeAvatarBody(body); material.dispose(); atlas.texture.dispose();
}

function fakeAtlas(pixel = 255, uvOffset = 0): Atlas {
  const canvas = {
    width: ATLAS_TILES * CELL_PX, height: ATLAS_TILES * CELL_PX,
    getContext: () => ({ getImageData: () => {
      const data = new Uint8ClampedArray(16 * 16 * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = pixel; data[i + 3] = pixel;
      }
      return { data };
    } }),
  } as unknown as HTMLCanvasElement;
  return {
    canvas, texture: new THREE.CanvasTexture(canvas),
    uvRect(tile) {
      const { x, y } = tileOrigin(tile), span = canvas.width;
      return [x / span + uvOffset, 1 - (y + 16) / span,
        (x + 16) / span + uvOffset, 1 - y / span];
    },
  };
}

function atlasTests(): void {
  const cells = [...Object.keys(WORLDS_ART), ...Object.keys(MANOR_ART), ...Object.keys(BEDWARS_ART)];
  assert.equal(new Set(cells).size, cells.length, 'painter registries have disjoint atlas cells');
  for (const tile of [Tile.TeamWoolC, Tile.TeamWoolD]) {
    assert.ok(tile < Tile.ManorRug0 || tile >= Tile.ManorRug0 + MANOR_RUGS.length);
    assert.ok(WORLDS_ART[tile], 'relocated wool is painted');
  }
  assert.equal(Block.TeamWoolC, 32);
  assert.equal(Block.TeamWoolD, 33);
  assert.equal(Item.ClassScout, 316);
  assert.equal(ITEMS[Item.Cheese], undefined, 'legacy currency inventory slot is retired');
  assert.ok(BLOCKS[Block.ManorExchangeBase] && BLOCKS[Block.ManorExchangeTop]);
  const a = fakeAtlas(), b = fakeAtlas(0, .01);
  const cubeA = blockCubeGeometry(a, Block.TeamWoolC);
  const cubeB = blockCubeGeometry(b, Block.TeamWoolC);
  assert.equal(cubeA, blockCubeGeometry(a, Block.TeamWoolC));
  assert.notEqual(cubeA, cubeB, 'block geometry belongs to its atlas');
  assert.notEqual(cubeA.getAttribute('uv').getX(0), cubeB.getAttribute('uv').getX(0));
  assert.notEqual(itemGeometry(a, Block.TeamWoolC), itemGeometry(b, Block.TeamWoolC));
  const solidA = itemGeometrySolid(a, Item.IronAxe);
  const solidB = itemGeometrySolid(b, Item.IronAxe);
  assert.notEqual(solidA.getAttribute('position').count, solidB.getAttribute('position').count,
    'different atlas pixels produce different item rims');
  assert.notEqual(itemGeometrySolid(a, Item.IronAxe, .451),
    itemGeometrySolid(a, Item.IronAxe, .452), 'fractional sizes do not alias');
  a.texture.dispose(); b.texture.dispose();
}

function ownershipTests(): void {
  const body = buildAvatarBody(defaultCosmetics(17));
  const bow = createBowModel();
  body.parts[3].add(bow);
  const owned = new Map(body.geometries.map(g => [g, 0]));
  const materials = new Map(body.materials.map(m => [m, 0]));
  for (const material of materials.keys()) material.addEventListener('dispose', () =>
    materials.set(material, materials.get(material)! + 1));
  for (const geometry of owned.keys()) geometry.addEventListener('dispose', () =>
    owned.set(geometry, owned.get(geometry)! + 1));
  const borrowed = new Set<THREE.BufferGeometry>();
  bow.traverse(o => { if (o instanceof THREE.Mesh) borrowed.add(o.geometry); });
  let borrowedDisposals = 0;
  for (const geometry of borrowed) geometry.addEventListener('dispose', () => borrowedDisposals++);
  const sourceMaterials = new Set<THREE.Material>();
  body.group.traverse(o => {
    if (o instanceof THREE.Mesh) sourceMaterials.add(o.material as THREE.Material);
  });
  const glow = glowOf(body.group);
  const glowMaterials = new Set<THREE.Material>();
  body.group.traverse(o => {
    if (o instanceof THREE.Mesh && !sourceMaterials.has(o.material as THREE.Material))
      glowMaterials.add(o.material as THREE.Material);
  });
  let sharedGlowDisposals = 0;
  const sharedDisposed = (): void => { sharedGlowDisposals++; };
  for (const material of glowMaterials) material.addEventListener('dispose', sharedDisposed);
  glow.set(true); glow.dispose(); glow.dispose();
  disposeAvatarBody(body); disposeAvatarBody(body);
  assert.ok([...owned.values()].every(n => n === 1), 'owned body geometry disposed once');
  assert.equal(borrowedDisposals, 0, 'bow geometry survives glow and body teardown');
  assert.ok([...materials.values()].every(n => n === 1), 'owned body materials disposed once');
  assert.equal(sharedGlowDisposals, 0, 'glow teardown keeps borrowed global materials');
  for (const material of glowMaterials) material.removeEventListener('dispose', sharedDisposed);
  assert.ok([...borrowed].every(g => g.getAttribute('position').count > 0));
  const person = buildAvatarBody(defaultCosmetics(3));
  const rat = createRatModel();
  person.group.add(rat.group);
  const ratGeometry = new Map<THREE.BufferGeometry, number>();
  rat.group.traverse(o => {
    if (o instanceof THREE.Mesh) ratGeometry.set(o.geometry, 0);
  });
  for (const geometry of ratGeometry.keys()) geometry.addEventListener('dispose', () =>
    ratGeometry.set(geometry, ratGeometry.get(geometry)! + 1));
  rat.dispose(); disposeAvatarBody(person);
  assert.ok([...ratGeometry.values()].every(n => n === 1), 'rat geometry is uniquely owned, including glow copies');
  for (const create of [createBowModel, createGunModel, createGadgetModel]) {
    const model = create(), original = new Set<THREE.Material>();
    model.traverse(o => {
      if (o instanceof THREE.Mesh) original.add(o.material as THREE.Material);
    });
    const clones = cloneModelMaterials(model, true);
    assert.ok(clones.length > 0);
    assert.equal(clones.length, new Set(clones).size);
    assert.ok(clones.every(m => !original.has(m)), 'tint materials are owned copies');
    for (const material of clones) material.dispose();
  }
}

function generator(block: number): WorldGenerator {
  return {
    seed: 1, minY: 0, maxY: 0,
    bounds: { minX: -32, minZ: -32, maxX: 32, maxZ: 32 },
    blockAt: (_x, y) => y === 0 ? block : Block.Air,
    fill(chunk) {
      if (block === Block.Air) return;
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) chunk.set(x, 0, z, block);
    },
    tints: () => ({ grass: [1, 1, 1], foliage: [1, 1, 1], water: [1, 1, 1] }),
  };
}

function worldTests(): void {
  const chunk = new Chunk(0, 0);
  chunk.set(0, 255, 0, Block.ManorLantern);
  chunk.set(1, 255, 0, Block.Stone);
  chunk.set(0, 4, 0, Block.Stone);
  chunk.set(0, 255, 0, Block.Air);
  assert.equal(chunk.maxY, 256, 'another cell still holds the tallest layer');
  assert.equal(chunk.lights.size, 0);
  chunk.set(1, 255, 0, Block.Air);
  assert.equal(chunk.maxY, 5, 'height shrinks after tallest layer is removed');
  chunk.set(0, 4, 0, Block.Air);
  assert.equal(chunk.maxY, 0);
  const atlas = fakeAtlas();
  for (const block of [Block.Air, Block.Water]) {
    const scene = new THREE.Scene(), world = new World(scene, atlas, generator(block));
    world.update(0, 0, 1000, 0);
    const center = world.getChunk(0, 0)!;
    assert.equal(center.meshed, true);
    assert.equal(center.opaqueMesh, null, 'empty and water-only chunks need no sentinel mesh');
    assert.equal(!!center.waterMesh, block === Block.Water);
    world.setBlock(8, 1, 8, Block.Stone);
    assert.equal(world.getChunk(1, 0)!.meshed, false, 'edits do not promote data-only chunks');
    world.update(1000, 1000, -1, 0);
    assert.equal(scene.children.length, 0, 'unload runs even with no meshing budget');
    assert.equal(world.getChunk(0, 0), undefined);
    world.setGenerator(generator(Block.Air));
  }
  lightBatchTests(atlas);
  lightPatchTests(atlas);
  opacityTests(atlas);
  atlas.texture.dispose();
}

function opacityTests(atlas: Atlas): void {
  const floor = generator(Block.Stone);
  const roof: WorldGenerator = { ...floor, maxY: 3, fill(chunk) {
    floor.fill(chunk);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) chunk.set(x, 3, z, Block.Stone);
  } };
  const world = new World(new THREE.Scene(), atlas, roof);
  for (let i = 0; i < 3; i++) world.update(0, 0, 1000, 1);
  const neighbor = world.getChunk(-1, 0)!;
  const floorLight = (): number => {
    const geo = neighbor.opaqueMesh!.geometry;
    const position = geo.getAttribute('position'), light = geo.getAttribute('skyblock');
    let brightest = 0;
    for (let i = 0; i < position.count; i++) if (position.getY(i) <= 1)
      brightest = Math.max(brightest, light.getX(i));
    return brightest;
  };
  assert.equal(floorLight(), 0);
  world.setBlock(8, 3, 8, Block.Air);
  assert.equal(floorLight(), 0, 'an interior edit leaves the neighbour for the streamer');
  world.update(0, 0, 1000, 1);
  assert.ok(floorLight() > 0, 'interior opacity edit opens skylight into the neighboring chunk');
  world.setBlock(8, 3, 8, Block.Stone);
  world.update(0, 0, 1000, 1);
  assert.equal(floorLight(), 0, 'closing the opening clears neighboring skylight');
  const centre = world.getChunk(0, 0)!, centreGeo = centre.opaqueMesh!.geometry;
  const neighbourGeo = neighbor.opaqueMesh!.geometry;
  world.setBlock(0, 3, 8, Block.Air);
  assert.notEqual(centre.opaqueMesh!.geometry, centreGeo, 'the edited chunk remeshes at once');
  assert.notEqual(neighbor.opaqueMesh!.geometry, neighbourGeo, 'a border edit remeshes the face-sharing neighbour at once');
  // The opening is 16 blocks from chunk (1, 0): no light reaches it, so it
  // keeps its mesh instead of waiting for a pointless remesh.
  assert.equal(world.getChunk(1, 0)!.dirty, false, 'neighbours whose light did not change keep their mesh');
  world.setGenerator(generator(Block.Air));
}

/** Edits patch each chunk's cached light from one solve around them; after
 *  any mix of edits that must equal solving every chunk from scratch. */
function lightPatchTests(atlas: Atlas): void {
  const hills: WorldGenerator = { ...generator(Block.Stone), maxY: 40, fill(chunk) {
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const wx = chunk.cx * 16 + x, wz = chunk.cz * 16 + z, h = 10 + ((wx * 3 + wz * 5) & 7);
      for (let y = 0; y < h; y++) chunk.set(x, y, z, y > 6 && y < 9 && (wx & 3) ? Block.Air : Block.Stone);
      if (((wx + wz) & 15) === 3) chunk.set(x, h + 4, z, Block.Stone);
    }
  } };
  const world = new World(new THREE.Scene(), atlas, hills);
  for (let i = 0; i < 4; i++) world.update(8, 8, 1000, 2);
  let seed = 7;
  const rnd = (n: number): number => (seed = (seed * 1103515245 + 12345) >>> 0) % n;
  const ids = [Block.Air, Block.Air, Block.Stone, Block.Leaves, Block.Water, Block.ManorLantern];
  const field = world as unknown as { solveChunkLight(c: Chunk): void; chunks: Map<string, Chunk> };
  for (let round = 0; round < 30; round++) {
    const batch = round % 4 === 3;
    if (batch) world.beginBatch();
    for (let k = batch ? 6 : 1; k > 0; k--) world.setBlock(rnd(40) - 12, 4 + rnd(24), rnd(40) - 12, ids[rnd(ids.length)]);
    if (batch) world.endBatch();
    if (round % 5 === 4) world.update(8, 8, 1000, 2);
    for (const chunk of field.chunks.values()) {
      if (!chunk.meshed || chunk.relight || !chunk.light) continue;
      const patched = chunk.light.slice(), lo = chunk.lightLo, hi = chunk.lightHi;
      field.solveChunkLight(chunk);
      // Compare where both spans overlap: a patched span may have grown.
      const H0 = hi - lo, H1 = chunk.lightHi - chunk.lightLo;
      for (let col = 0; col < 18 * 18; col++) {
        for (let y = Math.max(lo, chunk.lightLo); y < Math.min(hi, chunk.lightHi); y++) {
          assert.equal(patched[col * H0 + y - lo], chunk.light[col * H1 + y - chunk.lightLo],
            `patched light matches a full solve (round ${round}, chunk ${chunk.cx},${chunk.cz})`);
        }
      }
    }
  }
  world.setGenerator(generator(Block.Air));
}

function lightBatchTests(atlas: Atlas): void {
  const scene = new THREE.Scene(), world = new World(scene, atlas, generator(Block.Stone));
  for (let i = 0; i < 3; i++) world.update(0, 0, 1000, 1);
  const neighbor = world.getChunk(-1, 0)!;
  const previous = neighbor.opaqueMesh!.geometry;
  let neighborDisposals = 0;
  previous.addEventListener('dispose', () => neighborDisposals++);
  world.beginBatch();
  world.beginBatch();
  world.setBlock(8, 1, 8, Block.ManorLantern);
  world.setBlock(9, 1, 8, Block.ManorLantern);
  world.endBatch();
  assert.equal(neighborDisposals, 0, 'nested batches do not flush early');
  world.endBatch();
  assert.equal(neighborDisposals, 0, 'an interior batch defers the neighbour to the streamer');
  assert.equal(neighbor.dirty, true);
  world.update(0, 0, 1000, 1);
  assert.equal(neighborDisposals, 1, 'each light-footprint consumer remeshes once per batch');
  const light = neighbor.opaqueMesh!.geometry.getAttribute('skyblock');
  let lit = false;
  for (let i = 0; i < light.count; i++) if (light.getY(i) > 0) lit = true;
  assert.equal(lit, true, 'an interior emitter lights the neighboring chunk');
  const geometry = neighbor.opaqueMesh!.geometry;
  world.setBlock(8, 1, 8, Block.ManorLantern);
  assert.equal(neighbor.opaqueMesh!.geometry, geometry, 'echoed edits do not remesh');
  world.beginBatch();
  world.setBlock(8, 1, 8, Block.Air);
  world.setBlock(9, 1, 8, Block.Air);
  world.endBatch();
  world.update(0, 0, 1000, 1);
  const unlit = neighbor.opaqueMesh!.geometry.getAttribute('skyblock');
  assert.ok(Array.from({ length: unlit.count }, (_, i) => unlit.getY(i)).every(n => n === 0),
    'removing emitters clears neighboring baked light');
  world.update(0, 0, -1, 0);
  assert.equal(neighbor.meshed, false, 'render-radius contraction drops old meshes');
  assert.equal(neighbor.opaqueMesh, null);
  world.setGenerator(generator(Block.Air));
}

function remoteEquipTests(): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement() {
      const canvas = { width: 0, height: 0, getContext: () => ({
        clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, fillText() {},
        measureText: () => ({ width: 24 }),
      }) };
      return canvas;
    },
  } });
  try {
    const net = new NetClient();
    const remote: Remote = {
      info: { id: 1, username: 'Fixture', skin: 2, x: 0, y: 0, z: 0,
        yaw: 0, pitch: 0, health: 20, dead: false },
      tx: 0, ty: 0, tz: 0, tyaw: 0, tpitch: 0, seenAt: 0,
      buf: new TransformBuffer(), clock: new SenderClock(), poses: new StateTimeline(),
      health: 20, dead: false, sneaking: false, held: Block.TeamWoolC,
      swing: 0, aiming: false, reloading: false,
    };
    net.remotes.set(1, remote);
    const atlas = fakeAtlas(), scene = new THREE.Scene();
    const players = new RemotePlayers(scene, net, atlas);
    let rat = false;
    players.styleOf = () => ({ rat, caged: false, glow: true, hidden: false, tag: true });
    players.update(1 / 60);
    remoteTransitions(players, scene, remote, atlas, value => { rat = value; });
    net.remotes.clear(); players.update(1 / 60);
    assert.equal(scene.children.length, 0, 'roster removal detaches the complete avatar');
    atlas.texture.dispose();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

function remoteTransitions(players: RemotePlayers, scene: THREE.Scene, remote: Remote,
  atlas: Atlas, setRat: (value: boolean) => void): void {
  const references = (geometry: THREE.BufferGeometry): THREE.Mesh[] => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse(o => {
      if (o instanceof THREE.Mesh && o.geometry === geometry) meshes.push(o);
    });
    return meshes;
  };
  const original = itemGeometry(atlas, Block.TeamWoolC);
  assert.equal(references(original).length, 3, 'initial equipment has two borrowed glow copies');
  remote.held = Block.TeamWoolD; players.update(1 / 60);
  assert.equal(references(original).length, 0, 'gear swap removes old geometry and glow copies');
  const next = itemGeometry(atlas, Block.TeamWoolD);
  assert.equal(references(next).length, 3, 'glow rebuilt for new equipment');
  setRat(true); players.update(1 / 60);
  assert.equal(references(next).length, 1);
  assert.equal(references(next)[0].visible, false, 'rat hides existing equipment');
  remote.held = Block.TeamWoolC; players.update(1 / 60);
  assert.equal(references(original).length, 1);
  assert.equal(references(original)[0].visible, false, 'rat hides newly equipped gear');
  setRat(false); players.update(1 / 60);
  assert.equal(references(original).length, 3, 'returning person rebuilds equipment glow');
  const item = references(original).find(m =>
    m.material instanceof THREE.MeshBasicMaterial && m.material.map === atlas.texture)!;
  assert.equal(item.visible, true, 'person restores gear equipped as a rat');
}
